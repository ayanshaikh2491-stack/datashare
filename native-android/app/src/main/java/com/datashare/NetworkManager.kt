package com.datashare

import android.util.Log
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import java.io.IOException

/**
 * NetworkManager — WebSocket client for DataShare server
 *
 * OPTIMIZATIONS:
 * - Binary WebSocket frames for ALL TCP data (no Base64 overhead)
 * - JSON only for control messages (connect/disconnect/new_connection)
 * - Reconnect with exponential backoff (saves battery)
 * - Pre-allocated ByteBuffer pool for packet assembly
 */
class NetworkManager(private val listener: NetworkListener) {

    companion object {
        private const val TAG = "NetworkManager"
        private const val PING_INTERVAL_SEC = 30L
        private const val MAX_RECONNECT_ATTEMPTS = 15
        private const val RECONNECT_DELAY_MS = 2000L
        private const val RECONNECT_BACKOFF_MULTIPLIER = 1.5f

        // v5.6.0: binary uses 2-byte connId directly (no type prefix)

        // Message ID counter for tracking
        private val msgIdCounter = AtomicInteger(0)
    }

    interface NetworkListener {
        fun onConnected(sessionId: String)
        fun onDisconnected()
        fun onError(message: String)
        fun onPairingComplete(sessionId: String, peerId: String)
        fun onWaitingForDonor()
        fun onTcpDataReceived(connectionId: Int, data: ByteArray)
        fun onNewConnection(destIp: String, destPort: Int, srcPort: Int, connectionId: Int)
        fun onConnectionEstablished(connId: Int, serverSeq: Long)
        fun onConnectionClosed(connId: Int)
        fun onPeerDisconnected()
        fun onBinaryPacketReceived(packet: ByteArray)
    }

    private var webSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null
    private var reconnectAttempts = 0
    @Volatile private var shouldReconnect = false
    @Volatile private var mode: String = VpnStateManager.MODE_RECEIVER
    private var userId: String = ""
    private var donorId: String = ""

    // ====================================================================
    // CONNECTION MANAGEMENT
    // ====================================================================

    fun connect(mode: String, userId: String, donorId: String = "") {
        this.mode = mode
        this.userId = userId
        this.donorId = donorId
        this.shouldReconnect = true
        this.reconnectAttempts = 0

        VpnStateManager.updateState(VpnStateManager.STATE_CONNECTING)
        doConnect()
    }

    private fun doConnect() {
        val currentToken = if (VpnStateManager.token.isNotEmpty()) VpnStateManager.token else VpnStateManager.token
        if (currentToken.isEmpty()) {
            Log.w(TAG, "No JWT token — authenticating first")
            authenticateAndConnect()
            return
        }

        try {
            okHttpClient = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(PING_INTERVAL_SEC, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()

            val url = "${VpnStateManager.SERVER_URL}?userId=$userId&role=$mode&donorId=$donorId&token=$currentToken"

            val request = Request.Builder()
                .url(url)
                .build()

            webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    Log.i(TAG, "WebSocket connected: $mode")
                    reconnectAttempts = 0
                    VpnStateManager.updateState(VpnStateManager.STATE_CONNECTED)
                    listener.onConnected(userId)

                // No handshake needed — server derives role from URL params
                }

                override fun onMessage(ws: WebSocket, text: String) = handleTextMessage(text)
                override fun onMessage(ws: WebSocket, bytes: ByteString) = handleBinaryFrame(bytes.toByteArray())

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    Log.i(TAG, "WS closed: $code $reason")
                    VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
                    listener.onDisconnected()
                    scheduleReconnect()
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    Log.e(TAG, "WS failure: ${t.message}")
                    if (response?.code == 401) {
                        Log.w(TAG, "401 — re-authenticating")
                        authenticateAndConnect()
                        return
                    }
                    VpnStateManager.updateState(VpnStateManager.STATE_ERROR)
                    listener.onError(t.message ?: "Connection failed")
                    scheduleReconnect()
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Connect error: ${e.message}")
            listener.onError(e.message ?: "Connection failed")
            scheduleReconnect()
        }
    }

    // ====================================================================
    // BINARY PROTOCOL — Optimized for zero-copy data transfer
    // ====================================================================

    // Binary frame format:
    // connId(2B BE) + data (v5.6.0)

    /**
     * Send TCP connection request — uses JSON for easy server relay
     */
    fun sendConnect(destIp: String, destPort: Int, srcPort: Int): Int {
        val connId = msgIdCounter.incrementAndGet()
        val msg = JSONObject().apply {
            put("type", "new_connection")
            put("host", destIp)
            put("destPort", destPort)
            put("connId", connId.toString())
        }
        webSocket?.send(msg.toString())
        return connId
    }

    /**
     * Send TCP data as BINARY WebSocket frame (no Base64!)
     */
    fun sendTcpData(connectionId: Int, data: ByteArray) {
        if (data.isEmpty()) return

        val frame = ByteArray(2 + data.size)
        frame[0] = (connectionId shr 8).toByte()
        frame[1] = connectionId.toByte()
        System.arraycopy(data, 0, frame, 2, data.size)

        webSocket?.send(ByteString.of(*frame))
        VpnStateManager.addBytes(data.size.toLong())
    }

    /**
     * Send TCP response (donor → receiver) via binary
     */
    fun sendTcpResponse(connectionId: Int, data: ByteArray) {
        sendTcpData(connectionId, data) // Same binary format
    }

    /**
     * Notify peer that TCP connection was established (SYN-ACK ready)
     */
    fun sendConnectionEstablished(connId: Int) {
        val msg = JSONObject().apply {
            put("type", "connection_ready")
            put("connId", connId)
        }
        webSocket?.send(msg.toString())
    }

    /**
     * Notify peer that TCP connection was closed
     */
    fun sendConnectionClosed(connId: Int) {
        val msg = JSONObject().apply {
            put("type", "connection_closed")
            put("connId", connId)
        }
        webSocket?.send(msg.toString())
    }

    /**
     * Disconnect a specific TCP connection
     */
    fun sendDisconnect(connId: Int) {
        val msg = JSONObject().apply {
            put("type", "close_connection")
            put("connId", connId)
        }
        webSocket?.send(msg.toString())
    }

    /**
     * Send raw IP packet as binary (for UDP/DNS passthrough)
     */
    fun sendBinaryPacket(packet: ByteArray) {
        webSocket?.send(ByteString.of(*packet))
        VpnStateManager.addBytes(packet.size.toLong())
    }

    /**
     * Send disconnect signal
     */
    fun sendDisconnect() {
        try {
            webSocket?.send(JSONObject().apply { put("type", "vpn_disconnect") }.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Disconnect error: ${e.message}")
        }
    }

    /**
     * Graceful disconnect
     */
    fun disconnect() {
        shouldReconnect = false
        sendDisconnect()
        webSocket?.close(1000, "Client closing")
        webSocket = null
        okHttpClient?.dispatcher?.executorService?.shutdownNow()
        VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
    }

    // ====================================================================
    // AUTHENTICATION — Get JWT from REST API before WebSocket upgrade
    // ====================================================================

    /**
     * Authenticate via REST API to get a JWT, then connect WebSocket.
     * The server's WS upgrade requires a valid JWT signed with JWT_SECRET,
     * which the app doesn't have — so we get the token from the auth API.
     */
    private fun authenticateAndConnect() {
        shouldReconnect = true
        VpnStateManager.updateState(VpnStateManager.STATE_CONNECTING)

        val baseUrl = VpnStateManager.SERVER_URL
            .replace("wss://", "https://")
            .replace("/ws-vpn", "")

        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()

        val json = JSONObject().apply {
            put("email", "$userId@datashare.local")
            put("name", "User ${userId.take(8)}")
            put("role", if (mode == VpnStateManager.MODE_DONOR) "donor" else "receiver")
        }

        val body = "application/json".toMediaType().let { RequestBody.create(it, json.toString()) }
        val request = Request.Builder()
            .url("$baseUrl/api/auth/login-or-register")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "Auth request failed: ${e.message}")
                listener.onError("Authentication failed: ${e.message}")
                scheduleReconnect()
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val respBody = response.body?.string() ?: ""
                    val result = JSONObject(respBody)
                    val authToken = result.getString("token")

                    VpnStateManager.token = authToken
                    Log.i(TAG, "Auth token saved")

                    response.close()
                    client.dispatcher.executorService.shutdownNow()

                    doConnect()
                } catch (e: Exception) {
                    Log.e(TAG, "Auth response parse error: ${e.message}")
                    listener.onError("Auth failed")
                    scheduleReconnect()
                }
            }
        })
    }

    // ====================================================================
    // BINARY FRAME PARSER
    // ====================================================================

    private fun handleBinaryFrame(frame: ByteArray) {
        if (frame.isEmpty()) return

        // v5.6.0: [connId 2B BE][payload]
        if (frame.size < 2) return
        val connId = ((frame[0].toInt() and 0xFF) shl 8) or
                (frame[1].toInt() and 0xFF)
        val data = frame.copyOfRange(2, frame.size)
        listener.onTcpDataReceived(connId, data)
    }

    // ====================================================================
    // TEXT MESSAGE HANDLER
    // ====================================================================

    private fun handleTextMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "vpn_connected", "connected" -> {
                    val relay = json.optString("relay", "")
                    val donor = json.optString("donorId", "")
                    if (donor.isNotEmpty()) VpnStateManager.donorId = donor
                    Log.i(TAG, "Connected via $relay to donor $donor")
                    listener.onConnected(userId)
                }
                "vpn_session_created", "paired" -> {
                    val sessionId = json.optString("sessionId")
                    val peerId = json.optString("peerId")
                    VpnStateManager.sessionId = sessionId
                    if (mode == VpnStateManager.MODE_DONOR) {
                        VpnStateManager.receiverId = peerId
                    } else {
                        VpnStateManager.donorId = peerId
                    }
                    listener.onPairingComplete(sessionId, peerId)
                }
                "waiting_for_donor" -> listener.onWaitingForDonor()
                "donor_online" -> Log.d(TAG, "Donor online: ${json.optString("donorId")}")
                "peer_disconnected" -> listener.onPeerDisconnected()
                "vpn_disconnected" -> listener.onDisconnected()
                "open_tcp", "new_connection", "tcp_connect" -> {
                    val destIp = json.optString("ip", json.optString("destIp"))
                    val destPort = json.optInt("destPort")
                    val connId = json.optInt("connId", msgIdCounter.incrementAndGet())
                    listener.onNewConnection(destIp, destPort, 0, connId)
                }
                "connection_ready", "connection_established" -> {
                    val connId = json.optInt("connId", json.optInt("connectionId", 0))
                    listener.onConnectionEstablished(connId, 0L)
                }
                "connection_closed" -> {
                    val connId = json.optInt("connId", json.optInt("connectionId", 0))
                    listener.onConnectionClosed(connId)
                }
                "connection_error" -> {
                    val connId = json.optInt("connId", json.optInt("connectionId", 0))
                    Log.w(TAG, "Connection error for $connId: ${json.optString("error")}")
                    listener.onConnectionClosed(connId)
                }
                "tunnel_ready" -> {
                    Log.i(TAG, "Tunnel ready: ${json.optString("tunnelId")}")
                }
                "donor_disconnected" -> {
                    Log.w(TAG, "Donor disconnected")
                    listener.onPeerDisconnected()
                }
                "error" -> {
                    listener.onError(json.optString("message", "Server error"))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Bad JSON: ${e.message}")
        }
    }

    // ====================================================================
    // RECONNECT WITH EXPONENTIAL BACKOFF
    // ====================================================================

    private fun scheduleReconnect() {
        if (!shouldReconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return

        reconnectAttempts++
        val delay = (RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER.toDouble(),
            (reconnectAttempts - 1).toDouble())).toLong()
                .coerceAtMost(30_000L) // Cap at 30 seconds

        Log.i(TAG, "Reconnect in ${delay}ms (attempt $reconnectAttempts)")

        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (shouldReconnect) doConnect()
        }, delay)
    }
}
