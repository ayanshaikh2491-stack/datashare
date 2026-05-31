package com.datashare

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.os.PowerManager.WakeLock
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * DataShareVpnService — TCP Socket Relay VPN
 *
 * HOW IT WORKS (SIMPLE):
 *
 * RECEIVER phone wants internet:
 *   App (YouTube) → TUN captures packet → App parses TCP
 *   → Sends "connect to 8.8.8.8:80" via WebSocket
 *
 * DONOR phone receives request:
 *   → Opens REAL Java Socket to 8.8.8.8:80 (uses DONOR's internet!)
 *   → Sends "connected" back to receiver
 *
 * RECEIVER gets "connected":
 *   → Sends SYN-ACK to YouTube app via TUN
 *   → YouTube sends HTTP GET → relayed to donor
 *   → Donor writes to Socket → internet response → relayed back
 *
 * RESULT: Receiver uses Donor's internet! NO ROOT NEEDED! 🎉
 */
class DataShareVpnService : VpnService() {

    companion object {
        private const val TAG = "DataShareVpn"
        const val ACTION_START_VPN = "com.datashare.START_VPN"
        const val ACTION_STOP_VPN = "com.datashare.STOP_VPN"
        const val EXTRA_MODE = "mode"
        const val EXTRA_DONOR_ID = "donorId"
        const val EXTRA_USER_ID = "userId"

        // TUN config
        private const val TUN_MTU = 1500
        const val RECEIVER_TUN_IP = "10.8.0.2"
        const val DONOR_TUN_IP = "10.8.0.1"
        private const val TUN_PREFIX = 24
        private const val VPN_SUBNET = "10.8.0.0"

        // Power management
        private const val IDLE_TIMEOUT_MS = 120_000L
        private const val WAKE_LOCK_TIMEOUT_MS = 10_000L
        private const val PACKET_BUFFER_SIZE = TUN_MTU * 2

        // NAT: Fake server sequence number start
        private const val FAKE_SERVER_SEQ = 1000000
    }

    // Core state
    private var tunFd: ParcelFileDescriptor? = null
    private var networkManager: NetworkManager? = null
    private var mode: String = VpnStateManager.MODE_RECEIVER
    private var userId: String = ""
    private var donorId: String = ""

    // Threading
    private val shouldRun = AtomicBoolean(false)
    private val threadPool = Executors.newCachedThreadPool { r ->
        Thread(r, "vpn-worker").apply { isDaemon = true }
    }

    // Power
    private var wakeLock: WakeLock? = null
    private var lastActivityTime = System.currentTimeMillis()

    // Reusable TUN buffers
    private val readBuffer = ByteArray(PACKET_BUFFER_SIZE)

    // ================================================================
    // DONOR MODE: Socket connections (DONOR opens real sockets)
    // ================================================================
    private val socketConnections = ConcurrentHashMap<Int, Socket>()

    // ================================================================
    // RECEIVER MODE: TCP connection tracking
    // ================================================================
    data class TcpConn(
        val id: Int,
        val srcIp: Int,    // 10.8.0.2 packed
        val dstIp: Int,    // internet IP packed
        val srcPort: Int,  // receiver's port
        val dstPort: Int,  // dest port (80, 443)
        var clientSeq: Long,
        var serverSeq: Long
    )
    private val receiverConns = ConcurrentHashMap<Int, TcpConn>()
    private val connCounter = AtomicInteger(0)

    // ================================================================
    // SERVICE LIFECYCLE
    // ================================================================

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_VPN -> {
                mode = intent.getStringExtra(EXTRA_MODE) ?: VpnStateManager.MODE_RECEIVER
                userId = intent.getStringExtra(EXTRA_USER_ID) ?: "user_${System.currentTimeMillis()}"
                donorId = intent.getStringExtra(EXTRA_DONOR_ID) ?: ""

                VpnStateManager.mode = mode
                VpnStateManager.isVpnRunning = true
                VpnStateManager.connectionStartTime = System.currentTimeMillis()

                startForeground(NOTIFICATION_ID, createNotification())
                setupVpnAndConnect()
            }
            ACTION_STOP_VPN -> stopVpn()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopVpn()
        releaseWakeLock()
        super.onDestroy()
    }

    // ================================================================
    // VPN SETUP
    // ================================================================

    private fun setupVpnAndConnect() {
        try {
            val builder = Builder()
            builder.setSession("DataShare VPN")
            builder.setMtu(TUN_MTU)

            when (mode) {
                VpnStateManager.MODE_RECEIVER -> {
                    // Receiver: capture ALL traffic through TUN
                    builder.addAddress(RECEIVER_TUN_IP, TUN_PREFIX)
                    builder.addRoute("0.0.0.0", 0)
                    builder.addRoute("0:0:0:0:0:0:0:0", 0)
                    builder.addDnsServer("8.8.8.8")
                    builder.addDnsServer("1.1.1.1")
                }
                VpnStateManager.MODE_DONOR -> {
                    // Donor: TUN only for receiving responses
                    // Donor opens REAL sockets (not writing to TUN)
                    builder.addAddress(DONOR_TUN_IP, TUN_PREFIX)
                    builder.addRoute(VPN_SUBNET, TUN_PREFIX)
                }
            }

            builder.addDisallowedApplication(packageName)

            tunFd = builder.establish()
            if (tunFd == null) {
                Log.e(TAG, "TUN establishment failed!")
                VpnStateManager.updateState(VpnStateManager.STATE_ERROR)
                stopSelf()
                return
            }

            Log.i(TAG, "TUN established ($mode)")

            // Start TUN I/O based on mode
            if (mode == VpnStateManager.MODE_RECEIVER) {
                // Receiver: parse TCP from TUN, send connect/data
                startReceiverTunReader()
            } else {
                // Donor: TUN for monitoring only (responses come via sockets)
                startDonorTunMonitor()
            }

            // Start idle monitor
            startIdleMonitor()

            // Connect WebSocket
            setupNetworkManager()
            networkManager?.connect(mode, userId, donorId)

        } catch (e: Exception) {
            Log.e(TAG, "Setup failed: ${e.message}", e)
            VpnStateManager.updateState(VpnStateManager.STATE_ERROR)
            stopVpn()
        }
    }

    // ================================================================
    // RECEIVER MODE: Parse TCP from TUN → Send via WS
    // ================================================================

    private fun startReceiverTunReader() {
        shouldRun.set(true)
        threadPool.execute {
            try {
                val tunInput = FileInputStream(tunFd!!.fileDescriptor)
                Log.i(TAG, "RECEIVER TUN reader started")

                while (shouldRun.get()) {
                    val len = tunInput.read(readBuffer)
                    if (len <= 0) continue

                    lastActivityTime = System.currentTimeMillis()
                    val packet = readBuffer.copyOf(len)
                    processReceiverPacket(packet)
                }
            } catch (e: Exception) {
                if (shouldRun.get()) Log.w(TAG, "TUN read error: ${e.message}")
            }
        }
    }

    /**
     * Process packet from receiver's TUN.
     * For TCP: parse connections, send connect/data to donor.
     * For other: send raw (DNS, etc.)
     */
    private fun processReceiverPacket(packet: ByteArray) {
        if (packet.size < 20) return // Too small for IP header

        val version = (packet[0].toInt() shr 4) and 0x0F
        if (version != 4) return // Only IPv4

        val ipHeaderLen = (packet[0].toInt() and 0x0F) * 4
        if (ipHeaderLen < 20 || ipHeaderLen > packet.size) return

        val protocol = packet[9].toInt() and 0xFF
        val srcIp = getInt(packet, 12)
        val dstIp = getInt(packet, 16)

        if (protocol == 6) { // TCP
            processTcpFromTun(packet, ipHeaderLen, srcIp, dstIp)
        } else if (protocol == 17) { // UDP
            // Send raw UDP packets via binary for now
            networkManager?.sendBinaryPacket(packet)
        } else {
            // Other protocols - send raw
            networkManager?.sendBinaryPacket(packet)
        }
    }

    /**
     * Parse TCP packet from receiver's TUN.
     * SYN → new connection request
     * Data → send data to existing connection
     */
    private fun processTcpFromTun(packet: ByteArray, ipHeaderLen: Int, srcIp: Int, dstIp: Int) {
        if (packet.size < ipHeaderLen + 20) return

        val srcPort = readShort(packet, ipHeaderLen)
        val dstPort = readShort(packet, ipHeaderLen + 2)
        val tcpHeaderLen = ((packet[ipHeaderLen + 12].toInt() shr 4) and 0x0F) * 4
        val flags = packet[ipHeaderLen + 13].toInt() and 0xFF
        val seq = getInt(packet, ipHeaderLen + 4)
        val payloadLen = packet.size - ipHeaderLen - tcpHeaderLen

        val isSYN = flags and 0x02 != 0
        val isACK = flags and 0x10 != 0
        val isFIN = flags and 0x01 != 0
        val isRST = flags and 0x04 != 0

        if (isSYN && !isACK) {
            // === NEW TCP CONNECTION ===
            val connId = connCounter.incrementAndGet()

            val conn = TcpConn(
                id = connId, srcIp = srcIp, dstIp = dstIp,
                srcPort = srcPort, dstPort = dstPort,
                clientSeq = seq.toLong() and 0xFFFFFFFFL,
                serverSeq = 0  // Will be set when SYN-ACK is sent
            )
            receiverConns[connId] = conn

            // Build dest IP string
            val dstIpStr = ipToString(dstIp)
            Log.i(TAG, "New TCP: $dstIpStr:$dstPort (conn=$connId)")

            // Send connection request to DONOR
            networkManager?.sendConnect(dstIpStr, dstPort, srcPort)

        } else if (payloadLen > 0) {
            // === DATA ON EXISTING CONNECTION ===
            val conn = findReceiverConn(srcPort, dstPort)
            if (conn != null) {
                conn.clientSeq = seq.toLong() and 0xFFFFFFFFL
                val payload = packet.copyOfRange(ipHeaderLen + tcpHeaderLen, packet.size)
                networkManager?.sendTcpData(conn.id, payload)
            }
        }

        if (isFIN || isRST) {
            // Connection closing
            val conn = findReceiverConn(srcPort, dstPort)
            if (conn != null) {
                networkManager?.sendDisconnect(conn.id)
                receiverConns.remove(conn.id)
            }
        }
    }

    /**
     * Find a tracked connection by src/dst ports
     */
    private fun findReceiverConn(srcPort: Int, dstPort: Int): TcpConn? {
        for (conn in receiverConns.values) {
            if (conn.srcPort == srcPort && conn.dstPort == dstPort) return conn
            if (conn.srcPort == dstPort && conn.dstPort == srcPort) return conn
        }
        return null
    }

    // ================================================================
    // DONOR MODE: TUN monitor + Socket management
    // ================================================================

    private fun startDonorTunMonitor() {
        shouldRun.set(true)
        Log.i(TAG, "DONOR mode - using REAL sockets (not TUN forwarding)")
        // TUN is established but we don't use it for forwarding
        // Instead, donor opens real Java Socket connections
    }

    /**
     * DONOR: Open a REAL socket connection when receiver asks
     */
    private fun openRealSocket(connId: Int, destIp: String, destPort: Int) {
        threadPool.execute {
            var socket: Socket? = null
            try {
                Log.i(TAG, "DONOR opening socket: $destIp:$destPort (conn=$connId)")
                socket = Socket()
                socket.connect(InetSocketAddress(destIp, destPort), 20000)
                socket.tcpNoDelay = true
                socket.soTimeout = 60000
                socketConnections[connId] = socket

                Log.i(TAG, "DONOR socket connected: $destIp:$destPort (conn=$connId)")

                // Tell receiver: connection established!
                networkManager?.sendConnectionEstablished(connId)

                // Read socket responses → send to receiver
                val input = socket.getInputStream()
                val buf = ByteArray(4096)
                while (shouldRun.get() && socket.isConnected && !socket.isClosed) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    lastActivityTime = System.currentTimeMillis()
                    val data = buf.copyOf(n)
                    networkManager?.sendTcpData(connId, data)
                }

            } catch (e: Exception) {
                Log.w(TAG, "Socket $connId error: ${e.message}")
            } finally {
                socketConnections.remove(connId)
                try { socket?.close() } catch (_: Exception) {}
                networkManager?.sendConnectionClosed(connId)
            }
        }
    }

    /**
     * DONOR: Write TCP data to the real socket
     */
    private fun writeToSocket(connId: Int, data: ByteArray) {
        val socket = socketConnections[connId] ?: return
        threadPool.execute {
            try {
                val output = socket.getOutputStream()
                output.write(data)
                output.flush()
                lastActivityTime = System.currentTimeMillis()
                VpnStateManager.addBytes(data.size.toLong())
            } catch (e: Exception) {
                Log.w(TAG, "Socket write error conn=$connId: ${e.message}")
            }
        }
    }

    // ================================================================
    // RECEIVER: Write response to TUN (build TCP segment)
    // ================================================================

    /**
     * RECEIVER: Build a TCP segment and write to TUN.
     * This is called when data arrives from the donor.
     */
    private fun writeResponseToTun(connId: Int, data: ByteArray) {
        val conn = receiverConns[connId] ?: return
        if (tunFd == null) return

        try {
            val tcpHeaderLen = 20 // No options
            val ipTotalLen = 20 + tcpHeaderLen + data.size
            val packet = ByteArray(ipTotalLen)

            // === IP HEADER (20 bytes) ===
            packet[0] = 0x45 // Version 4, IHL 5
            writeShort(packet, 2, ipTotalLen) // Total length
            packet[8] = 64 // TTL
            packet[9] = 6 // TCP protocol

            // Source IP = original destination (the internet server)
            writeInt(packet, 12, conn.dstIp)
            // Dest IP = receiver's TUN IP (back to app)
            writeInt(packet, 16, conn.srcIp)

            // IP checksum
            writeShort(packet, 10, 0)
            writeShort(packet, 10, ipChecksum(packet, 20))

            // === TCP HEADER (20 bytes) ===
            // Source port = original destination port
            writeShort(packet, 20, conn.dstPort)
            // Dest port = original source port (back to app)
            writeShort(packet, 22, conn.srcPort)

            // Sequence number (server side)
            val serverSeq = conn.serverSeq
            writeInt(packet, 24, serverSeq.toInt())
            conn.serverSeq = serverSeq + data.size

            // Ack number (client's next expected byte)
            writeInt(packet, 28, conn.clientSeq.toInt())

            // Data offset + flags: ACK=0x10, PSH=0x08
            packet[32] = (0x50 or (tcpHeaderLen / 4)).toByte() // Data offset
            packet[33] = 0x18 // ACK + PSH flags

            // Window size
            writeShort(packet, 34, 65535)

            // Copy payload
            System.arraycopy(data, 0, packet, 20 + tcpHeaderLen, data.size)

            // TCP checksum (with pseudo-header)
            writeShort(packet, 36, 0)
            writeShort(packet, 36, tcpChecksum(packet, 20, tcpHeaderLen, data.size, conn.dstIp, conn.srcIp))

            // Write to TUN
            val tunOutput = FileOutputStream(tunFd!!.fileDescriptor)
            tunOutput.write(packet)
            tunOutput.flush()

            lastActivityTime = System.currentTimeMillis()
            VpnStateManager.addBytes(packet.size.toLong())

        } catch (e: Exception) {
            Log.w(TAG, "TUN write error conn=$connId: ${e.message}")
        }
    }

    /**
     * RECEIVER: Send SYN-ACK to app (TCP handshake complete)
     */
    private fun sendSynAckToApp(conn: TcpConn) {
        if (tunFd == null) return
        try {
            val serverSeq = FAKE_SERVER_SEQ + conn.id
            conn.serverSeq = (serverSeq + 1).toLong() // +1 for SYN

            val tcpHeaderLen = 20
            val ipTotalLen = 20 + tcpHeaderLen
            val packet = ByteArray(ipTotalLen)

            // IP header
            packet[0] = 0x45
            writeShort(packet, 2, ipTotalLen)
            packet[8] = 64
            packet[9] = 6
            writeInt(packet, 12, conn.dstIp) // src = internet server
            writeInt(packet, 16, conn.srcIp) // dst = receiver app
            writeShort(packet, 10, 0)
            writeShort(packet, 10, ipChecksum(packet, 20))

            // TCP header - SYN-ACK
            writeShort(packet, 20, conn.dstPort)
            writeShort(packet, 22, conn.srcPort)
            writeInt(packet, 24, serverSeq) // server seq
            writeInt(packet, 28, (conn.clientSeq + 1).toInt()) // ack = client seq + 1
            packet[32] = 0x50.toByte()
            packet[33] = 0x12 // SYN + ACK
            writeShort(packet, 34, 65535)
            writeShort(packet, 36, 0)
            writeShort(packet, 36, tcpChecksum(packet, 20, tcpHeaderLen, 0, conn.dstIp, conn.srcIp))

            val tunOutput = FileOutputStream(tunFd!!.fileDescriptor)
            tunOutput.write(packet)
            tunOutput.flush()

            lastActivityTime = System.currentTimeMillis()
            Log.d(TAG, "SYN-ACK sent for conn ${conn.id}")

        } catch (e: Exception) {
            Log.w(TAG, "SYN-ACK error: ${e.message}")
        }
    }

    // ================================================================
    // NETWORK MANAGER CALLBACKS
    // ================================================================

    private fun setupNetworkManager() {
        networkManager = NetworkManager(object : NetworkManager.NetworkListener {
            override fun onConnected(sessionId: String) {
                Log.i(TAG, "WS connected: $sessionId")
            }

            override fun onDisconnected() {
                Log.w(TAG, "WS disconnected")
                VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
            }

            override fun onError(message: String) {
                Log.e(TAG, "WS error: $message")
                VpnStateManager.updateState(VpnStateManager.STATE_ERROR)
            }

            override fun onPairingComplete(sessionId: String, peerId: String) {
                Log.i(TAG, "Paired! Session: $sessionId")
                VpnStateManager.sessionId = sessionId
                VpnStateManager.updateState(VpnStateManager.STATE_CONNECTED)
            }

            override fun onWaitingForDonor() {
                Log.i(TAG, "Waiting for donor...")
                VpnStateManager.updateState(VpnStateManager.STATE_CONNECTING)
            }

            /**
             * Called when TCP data arrives via WebSocket
             * Donor mode: data from receiver → write to socket
             * Receiver mode: data from donor → write to TUN
             */
            override fun onTcpDataReceived(connectionId: Int, data: ByteArray) {
                if (mode == VpnStateManager.MODE_DONOR) {
                    // DONOR: Write data to real socket
                    writeToSocket(connectionId, data)
                } else {
                    // RECEIVER: Build TCP segment, write to TUN
                    writeResponseToTun(connectionId, data)
                }
            }

            /**
             * Called when a new TCP connection request arrives
             * Donor mode: open real socket
             */
            override fun onNewConnection(destIp: String, destPort: Int, srcPort: Int, connId: Int) {
                if (mode == VpnStateManager.MODE_DONOR) {
                    // DONOR: Open a REAL socket to the internet!
                    openRealSocket(connId, destIp, destPort)
                }
            }

            /**
             * Called when connection is established (SYN-ACK from donor)
             * Receiver mode: send SYN-ACK to app
             */
            override fun onConnectionEstablished(connId: Int, serverSeq: Long) {
                if (mode == VpnStateManager.MODE_RECEIVER) {
                    val conn = receiverConns[connId]
                    if (conn != null) {
                        sendSynAckToApp(conn)
                    }
                }
            }

            override fun onPeerDisconnected() {
                Log.w(TAG, "Peer disconnected!")
                VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
                stopVpn()
            }

            /**
             * Raw binary packets (fallback for UDP/DNS)
             */
            override fun onBinaryPacketReceived(packet: ByteArray) {
                if (mode == VpnStateManager.MODE_DONOR) {
                    // Donor mode: try to parse TCP, otherwise ignore
                    if (packet.size > 20) {
                        val protocol = packet[9].toInt() and 0xFF
                        if (protocol == 6) {
                            // Try to handle as TCP data
                            val ipHeaderLen = (packet[0].toInt() and 0x0F) * 4
                            val srcPort = readShort(packet, ipHeaderLen)
                            val dstPort = readShort(packet, ipHeaderLen + 2)
                            val dataStart = ipHeaderLen + ((packet[ipHeaderLen+12].toInt() shr 4) and 0x0F) * 4
                            if (dataStart < packet.size) {
                                // Find connection by dest port
                                for ((id, socket) in socketConnections) {
                                    if (socket.isConnected) {
                                        try {
                                            socket.getOutputStream().write(packet.copyOfRange(dataStart, packet.size))
                                            socket.getOutputStream().flush()
                                        } catch (_: Exception) {}
                                        break
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Receiver: this shouldn't happen in socket mode
                    Log.w(TAG, "Unexpected binary packet in receiver mode")
                }
            }

            override fun onConnectionClosed(connId: Int) {
                if (mode == VpnStateManager.MODE_RECEIVER) {
                    receiverConns.remove(connId)
                }
            }
        })
    }

    // ================================================================
    // NETWORK MANAGER EXTENSION METHODS
    // ================================================================

    // Add these methods to NetworkManager via the listener

    // ================================================================
    // POWER MANAGEMENT
    // ================================================================

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "DataShare:VpnWakeLock"
            )
            wakeLock?.acquire(WAKE_LOCK_TIMEOUT_MS)
            Log.i(TAG, "WakeLock acquired")
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock failed: ${e.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                Log.i(TAG, "WakeLock released")
            }
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock release error: ${e.message}")
        }
    }

    private fun refreshWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
            wakeLock?.acquire(WAKE_LOCK_TIMEOUT_MS)
        } catch (e: Exception) { }
    }

    // ================================================================
    // IDLE MONITOR
    // ================================================================

    private fun startIdleMonitor() {
        threadPool.execute {
            while (shouldRun.get()) {
                val idleTime = System.currentTimeMillis() - lastActivityTime
                if (idleTime > IDLE_TIMEOUT_MS && VpnStateManager.bytesTransferred == 0L) {
                    Log.i(TAG, "Idle timeout — stopping")
                    stopVpn()
                    break
                } else if (idleTime > 5_000 && VpnStateManager.bytesTransferred > 0) {
                    refreshWakeLock()
                }
                try { Thread.sleep(10_000) } catch (_: InterruptedException) { break }
            }
        }
    }

    // ================================================================
    // STOP
    // ================================================================

    private fun stopVpn() {
        Log.i(TAG, "Stopping VPN service")

        shouldRun.set(false)

        // Close all donor sockets
        for ((_, socket) in socketConnections) {
            try { socket.close() } catch (_: Exception) {}
        }
        socketConnections.clear()

        // Clear receiver connections
        receiverConns.clear()

        networkManager?.disconnect()
        networkManager = null

        threadPool.shutdownNow()
        try { threadPool.awaitTermination(1, TimeUnit.SECONDS) } catch (_: InterruptedException) {}

        try { tunFd?.close() } catch (_: Exception) {}
        tunFd = null

        VpnStateManager.reset()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ================================================================
    // NOTIFICATION
    // ================================================================

    private val NOTIFICATION_ID = 1
    private val CHANNEL_ID = "datashare_vpn"

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "DataShare VPN", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "VPN tunnel notification"
                setShowBadge(false)
            }
            (getSystemService(NotificationManager::class.java)).createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val stopIntent = Intent(this, DataShareVpnService::class.java).apply { action = ACTION_STOP_VPN }
        val pendingStop = PendingIntent.getService(
            this, 0, stopIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            else PendingIntent.FLAG_UPDATE_CURRENT
        )
        val text = if (mode == VpnStateManager.MODE_DONOR) "Sharing data as Donor" else "Connected via VPN tunnel"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DataShare VPN Active")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", pendingStop)
            .build()
    }

    // ================================================================
    // PACKET UTILITIES (IP/TCP checksums, etc.)
    // ================================================================

    private fun getInt(data: ByteArray, offset: Int): Int {
        return ((data[offset].toInt() and 0xFF) shl 24) or
               ((data[offset+1].toInt() and 0xFF) shl 16) or
               ((data[offset+2].toInt() and 0xFF) shl 8) or
               (data[offset+3].toInt() and 0xFF)
    }

    private fun writeInt(data: ByteArray, offset: Int, value: Int) {
        data[offset] = (value shr 24 and 0xFF).toByte()
        data[offset+1] = (value shr 16 and 0xFF).toByte()
        data[offset+2] = (value shr 8 and 0xFF).toByte()
        data[offset+3] = (value and 0xFF).toByte()
    }

    private fun readShort(data: ByteArray, offset: Int): Int {
        return ((data[offset].toInt() and 0xFF) shl 8) or (data[offset+1].toInt() and 0xFF)
    }

    private fun writeShort(data: ByteArray, offset: Int, value: Int) {
        data[offset] = (value shr 8 and 0xFF).toByte()
        data[offset+1] = (value and 0xFF).toByte()
    }

    private fun ipToString(ip: Int): String {
        return "${ip shr 24 and 0xFF}.${ip shr 16 and 0xFF}.${ip shr 8 and 0xFF}.${ip and 0xFF}"
    }

    private fun ipChecksum(header: ByteArray, headerLen: Int): Int {
        var sum = 0
        var i = 0
        while (i < headerLen - 1) {
            sum += readShort(header, i)
            i += 2
        }
        while (sum shr 16 > 0) {
            sum = (sum and 0xFFFF) + (sum shr 16)
        }
        return (sum.inv() and 0xFFFF)
    }

    private fun tcpChecksum(packet: ByteArray, tcpOffset: Int, tcpHeaderLen: Int, dataLen: Int,
                            srcIp: Int, dstIp: Int): Int {
        var sum = 0L
        var i = tcpOffset

        // Pseudo-header (12 bytes)
        // Source IP
        sum += (srcIp.toLong() ushr 16) and 0xFFFF
        sum += srcIp.toLong() and 0xFFFF
        // Dest IP
        sum += (dstIp.toLong() ushr 16) and 0xFFFF
        sum += dstIp.toLong() and 0xFFFF
        // Zero + Protocol (6 for TCP)
        sum += 6
        // TCP segment length
        sum += (tcpHeaderLen + dataLen)

        // TCP header + data
        val totalLen = tcpHeaderLen + dataLen
        i = tcpOffset
        while (i < tcpOffset + totalLen - 1) {
            sum += readShort(packet, i)
            i += 2
        }
        if ((tcpOffset + totalLen) % 2 == 1) {
            sum += (packet[i].toInt() and 0xFF) shl 8
        }

        while (sum shr 16 > 0) {
            sum = (sum and 0xFFFF) + (sum shr 16)
        }

        return (sum.inv().toInt() and 0xFFFF)
    }
}
