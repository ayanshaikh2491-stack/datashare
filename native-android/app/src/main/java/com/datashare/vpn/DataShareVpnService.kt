package com.datashare.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.InetAddress
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

/**
 * DataShare VPN Service
 * 
 * Captures ALL device traffic through TUN interface,
 * routes packets to Donor via WebSocket tunnel,
 * receives responses and writes back to TUN.
 * 
 * Receiver uses Donor's mobile data for ALL apps.
 */
class DataShareVpnService : VpnService() {

    companion object {
        private const val TAG = "DataShareVPN"
        private const val NOTIFICATION_CHANNEL_ID = "datashare_vpn_channel"
        private const val NOTIFICATION_ID = 1

        // TUN interface configuration
        private const val VPN_ADDRESS = "10.0.0.2"
        private const val VPN_ROUTE = "0.0.0.0"
        private const val VPN_PREFIX = 0
        private const val MTU = 1500

        // Server configuration
        const val SERVER_URL = "wss://datashare-server.onrender.com"
        const val WS_SIGNALING_URL = "wss://datashare-server.onrender.com/ws-vpn"
    }

    // TUN interface
    private var tunInterface: ParcelFileDescriptor? = null
    private var inputStream: FileInputStream? = null
    private var outputStream: FileOutputStream? = null

    // Packet buffer
    private val packetBuffer = ByteArray(MTU)
    private val packetQueue = ConcurrentLinkedQueue<ByteArray>()

    // Traffic tracking
    private val bytesSent = AtomicLong(0)
    private val bytesReceived = AtomicLong(0)
    private val bytesReceivedFromDonor = AtomicLong(0)

    // State
    private var isRunning = false
    private var mode: String = "receiver" // "donor" or "receiver"
    private var userId: String = ""
    private var token: String = ""
    private var donorId: String? = null

    // Coroutines
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Network manager
    private var networkManager: NetworkManager? = null

    // Callbacks
    var onStatusChanged: ((String, Long, Long) -> Unit)? = null
    var onPacketReceived: ((ByteArray) -> Unit)? = null
    var onSendPacket: ((ByteArray) -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "VPN Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "VPN Service start command: ${intent?.action}")

        when (intent?.action) {
            ACTION_CONNECT -> {
                userId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
                token = intent.getStringExtra(EXTRA_TOKEN) ?: ""
                mode = intent.getStringExtra(EXTRA_MODE) ?: "receiver"
                donorId = intent.getStringExtra(EXTRA_DONOR_ID)

                startForeground(NOTIFICATION_ID, createNotification())
                connectVpn()
            }
            ACTION_DISCONNECT -> {
                disconnectVpn()
            }
            ACTION_UPDATE_STATS -> {
                notifyStats()
            }
        }

        return START_STICKY
    }

    private fun connectVpn() {
        Log.d(TAG, "Connecting VPN in $mode mode for user $userId")

        try {
            // Setup TUN interface
            val builder = Builder()
            builder.setSession("DataShare VPN")
            builder.setMtu(MTU)
            builder.addAddress(VPN_ADDRESS, 32)

            if (mode == "receiver") {
                // Route ALL traffic through VPN
                builder.addRoute(VPN_ROUTE, VPN_PREFIX)
                // Allow all apps
                builder.addDnsServer("8.8.8.8")
                builder.addDnsServer("1.1.1.1")
            } else {
                // Donor mode - only route DataShare traffic
                builder.addRoute("10.0.0.0", 24)
            }

            // Bypass DataShare app itself to avoid routing loops
            builder.addAllowedApplication(packageName)

            builder.setBlocking(true)

            tunInterface = builder.establish()
            if (tunInterface == null) {
                Log.e(TAG, "Failed to establish TUN interface")
                stopSelf()
                return
            }

            inputStream = FileInputStream(tunInterface!!.fileDescriptor)
            outputStream = FileOutputStream(tunInterface!!.fileDescriptor)

            Log.d(TAG, "TUN interface established")

            // Initialize network manager
            networkManager = NetworkManager(
                context = this,
                mode = mode,
                userId = userId,
                token = token,
                donorId = donorId,
                serverUrl = WS_SIGNALING_URL,
                onPacketFromTunnel = { packet ->
                    // Write packet from donor to TUN
                    writePacketToTun(packet)
                },
                onStatsUpdate = { sent, received ->
                    bytesSent.set(sent)
                    bytesReceivedFromDonor.set(received)
                    notifyStats()
                }
            )

            isRunning = true

            // Start packet reading loop
            scope.launch {
                readPacketsFromTun()
            }

            // Start network manager
            networkManager?.connect()

            updateNotification(true)
            Log.d(TAG, "VPN connected successfully")

        } catch (e: Exception) {
            Log.e(TAG, "VPN connection failed: ${e.message}", e)
            stopSelf()
        }
    }

    private fun disconnectVpn() {
        Log.d(TAG, "Disconnecting VPN")
        isRunning = false

        scope.cancel()

        networkManager?.disconnect()
        networkManager = null

        try {
            inputStream?.close()
            outputStream?.close()
            tunInterface?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing TUN: ${e.message}")
        }

        inputStream = null
        outputStream = null
        tunInterface = null

        stopForeground(true)
        stopSelf()

        updateNotification(false)
        Log.d(TAG, "VPN disconnected")
    }

    /**
     * Read packets from TUN interface and send to donor via tunnel
     */
    private suspend fun readPacketsFromTun() {
        Log.d(TAG, "Starting packet read loop")

        while (isRunning && inputStream != null) {
            try {
                val bytesRead = inputStream!!.read(packetBuffer)
                if (bytesRead > 0) {
                    val packet = packetBuffer.copyOf(bytesRead)
                    bytesSent.addAndGet(bytesRead.toLong())

                    // Log packet info (first 20 bytes = IP header)
                    if (bytesRead >= 20) {
                        val version = (packet[0].toInt() shr 4) and 0xF
                        val protocol = packet[9].toInt() and 0xFF
                        val destIp = "${packet[16].toInt() and 0xFF}.${packet[17].toInt() and 0xFF}.${packet[18].toInt() and 0xFF}.${packet[19].toInt() and 0xFF}"

                        Log.d(TAG, "Packet: v$version proto=$protocol dest=$destIp size=$bytesRead")
                    }

                    // Send packet to donor via network manager
                    networkManager?.sendPacket(packet)

                    // Callback for UI
                    onPacketReceived?.invoke(packet)

                    notifyStats()
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Log.e(TAG, "Error reading from TUN: ${e.message}", e)
                    delay(100)
                }
            }
        }
    }

    /**
     * Write packet from donor to TUN interface
     */
    private fun writePacketToTun(packet: ByteArray) {
        if (!isRunning || outputStream == null) return

        try {
            outputStream!!.write(packet)
            outputStream!!.flush()
            bytesReceived.addAndGet(packet.size.toLong())
            notifyStats()
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to TUN: ${e.message}", e)
        }
    }

    /**
     * Send packet to donor (called from NAT proxy on donor side)
     */
    fun sendToDonor(packet: ByteArray) {
        if (mode == "donor") {
            // On donor side: forward packet to internet
            networkManager?.forwardToInternet(packet)
        }
    }

    private fun notifyStats() {
        val sent = bytesSent.get()
        val received = bytesReceived.get()
        onStatusChanged?.invoke(mode, sent, received)
    }

    // ===== NOTIFICATIONS =====

    private fun createNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "DataShare VPN",
                NotificationManager.IMPORTANCE_LOW
            )
            channel.description = "Data sharing via VPN tunnel"
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("DataShare VPN")
            .setContentText("Sharing data via VPN tunnel")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(connected: Boolean) {
        val manager = getSystemService(NotificationManager::class.java)
        val notification = createNotification()
        manager.notify(NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        Log.d(TAG, "VPN Service destroyed")
        disconnectVpn()
        super.onDestroy()
    }

    override fun onRevoke() {
        Log.d(TAG, "VPN revoked by system")
        disconnectVpn()
        super.onRevoke()
    }

    companion object {
        const val ACTION_CONNECT = "com.datashare.CONNECT"
        const val ACTION_DISCONNECT = "com.datashare.DISCONNECT"
        const val ACTION_UPDATE_STATS = "com.datashare.UPDATE_STATS"

        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_MODE = "mode"
        const val EXTRA_DONOR_ID = "donor_id"

        fun createConnectIntent(
            context: android.content.Context,
            userId: String,
            token: String,
            mode: String,
            donorId: String? = null
        ): Intent {
            return Intent(context, DataShareVpnService::class.java).apply {
                action = ACTION_CONNECT
                putExtra(EXTRA_USER_ID, userId)
                putExtra(EXTRA_TOKEN, token)
                putExtra(EXTRA_MODE, mode)
                donorId?.let { putExtra(EXTRA_DONOR_ID, it) }
            }
        }

        fun createDisconnectIntent(context: android.content.Context): Intent {
            return Intent(context, DataShareVpnService::class.java).apply {
                action = ACTION_DISCONNECT
            }
        }
    }
}
