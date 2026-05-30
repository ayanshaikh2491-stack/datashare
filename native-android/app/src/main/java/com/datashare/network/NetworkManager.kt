package com.datashare.network

import android.content.Context
import android.util.Log
import okhttp3.*
import okio.ByteString
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

/**
 * NetworkManager - Handles WebSocket signaling and packet tunneling
 *
 * For RECEIVER:
 *  - Connects to signaling server
 *  - Sends IP packets from TUN to server (relayed to donor)
 *  - Receives response packets from donor via server
 *
 * For DONOR:
 *  - Receives packets from receiver via server
 *  - Forwards packets to internet (NAT)
 *  - Sends responses back to receiver
 */
class NetworkManager(
    private val context: Context,
    private val mode: String,
    private val userId: String,
    private val token: String,
    private val donorId: String? = null,
    private val serverUrl: String,
    private val onPacketFromTunnel: (ByteArray) -> Unit,
    private val onStatsUpdate: (Long, Long) -> Unit
) {
    companion object {
        private const val TAG = "NetworkManager"
    }

    private var webSocket: WebSocketClient? = null
    private val packetSendQueue = ConcurrentLinkedQueue<ByteArray>()
    private val bytesSentToServer = AtomicLong(0)
    private val bytesReceivedFromServer = AtomicLong(0)
    private var isConnected = false

    // For donor NAT proxy
    private var natProxy: NatProxy? = null

    fun connect() {
        Log.d(TAG, "Connecting to signaling server: $serverUrl (mode=$mode)")

        val uri = URI("$serverUrl?userId=$userId&token=$token&mode=$mode${if(donorId != null) "&donorId=$donorId" else ""}")

        webSocket = object : WebSocketClient(uri) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                Log.d(TAG, "WebSocket connected")
                isConnected = true

                // Send connection ready message
                val msg = JSONObject().apply {
                    put("type", "vpn_connect")
                    put("userId", userId)
                    put("mode", mode)
                    donorId?.let { put("donorId", it) }
                }
                send(msg.toString())

                // Start donor NAT proxy if in donor mode
                if (mode == "donor") {
                    natProxy = NatProxy(
                        onSendPacket = { packet ->
                            // Send packet back to receiver
                            sendPacketToReceiver(packet)
                        },
                        onStatsUpdate = { sent, recv ->
                            onStatsUpdate(sent, recv)
                        }
                    )
                }
            }

            override fun onMessage(message: String?) {
                message?.let { handleMessage(it) }
            }

            override fun onMessage(bytes: ByteBuffer?) {
                bytes?.let {
                    val data = it.array().copyOf(it.remaining())
                    bytesReceivedFromServer.addAndGet(data.size.toLong())
                    Log.d(TAG, "Received binary packet: ${data.size} bytes")
                    onPacketFromTunnel(data)
                }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                Log.w(TAG, "WebSocket closed: $code $reason")
                isConnected = false
                natProxy?.stop()
            }

            override fun onError(ex: Exception?) {
                Log.e(TAG, "WebSocket error: ${ex?.message}", ex)
            }
        }

        webSocket?.connect()
    }

    fun disconnect() {
        Log.d(TAG, "Disconnecting from server")
        isConnected = false
        natProxy?.stop()

        try {
            val msg = JSONObject().apply {
                put("type", "vpn_disconnect")
                put("userId", userId)
            }
            webSocket?.send(msg.toString())
            webSocket?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error disconnecting: ${e.message}")
        }

        webSocket = null
    }

    /**
     * Send IP packet to donor (from receiver's TUN)
     */
    fun sendPacket(packet: ByteArray) {
        if (!isConnected || webSocket == null) return

        try {
            // For small packets, send as base64 text
            // For large packets, send as binary
            if (packet.size > 1000) {
                webSocket?.send(packet)
            } else {
                val msg = JSONObject().apply {
                    put("type", "vpn_packet")
                    put("packet", android.util.Base64.encodeToString(packet, android.util.Base64.NO_WRAP))
                }
                webSocket?.send(msg.toString())
            }
            bytesSentToServer.addAndGet(packet.size.toLong())
            onStatsUpdate(bytesSentToServer.get(), bytesReceivedFromServer.get())
        } catch (e: Exception) {
            Log.e(TAG, "Error sending packet: ${e.message}")
        }
    }

    /**
     * Send packet from donor to receiver (NAT proxy responses)
     */
    private fun sendPacketToReceiver(packet: ByteArray) {
        if (!isConnected || webSocket == null) return

        try {
            webSocket?.send(packet)
            bytesSentToServer.addAndGet(packet.size.toLong())
        } catch (e: Exception) {
            Log.e(TAG, "Error sending to receiver: ${e.message}")
        }
    }

    /**
     * Forward packet to internet (donor side NAT)
     */
    fun forwardToInternet(packet: ByteArray) {
        natProxy?.processPacket(packet)
    }

    private fun handleMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.optString("type")

            when (type) {
                "vpn_connected" -> {
                    Log.d(TAG, "VPN tunnel established")
                }
                "vpn_packet" -> {
                    val base64 = json.optString("packet")
                    if (base64.isNotEmpty()) {
                        val data = android.util.Base64.decode(base64, android.util.Base64.NO_WRAP)
                        bytesReceivedFromServer.addAndGet(data.size.toLong())
                        onPacketFromTunnel(data)
                    }
                }
                "vpn_stats" -> {
                    val sent = json.optLong("bytes_sent", 0)
                    val recv = json.optLong("bytes_received", 0)
                    Log.d(TAG, "Stats: sent=$sent recv=$recv")
                }
                "donor_online" -> {
                    Log.d(TAG, "Donor is online, ready to connect")
                }
                "error" -> {
                    Log.e(TAG, "Server error: ${json.optString("message")}")
                }
                else -> {
                    Log.d(TAG, "Unknown message type: $type")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing message: ${e.message}")
        }
    }

    fun getStats(): Pair<Long, Long> {
        return Pair(bytesSentToServer.get(), bytesReceivedFromServer.get())
    }
}
