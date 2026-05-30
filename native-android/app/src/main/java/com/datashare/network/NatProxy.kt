package com.datashare.network

import android.util.Log
import okhttp3.*
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * NatProxy - NAT Gateway for Donor side
 *
 * Receives IP packets from receiver via tunnel,
 * forwards them to the internet via actual network interfaces,
 * captures responses, and sends them back through the tunnel.
 *
 * This acts as a Layer 3 NAT gateway:
 *  - Receives raw IP packets from TUN (via tunnel)
 *  - Extracts TCP/UDP payload
 *  - Opens real socket to destination
 *  - Forwards response back as IP packet
 */
class NatProxy(
    private val onSendPacket: (ByteArray) -> Unit,
    private val onStatsUpdate: (Long, Long) -> Unit
) {
    companion object {
        private const val TAG = "NatProxy"
    }

    private val running = true
    private val bytesOut = AtomicLong(0)
    private val bytesIn = AtomicLong(0)

    // Active connections: connectionId -> OkHttp Call
    private val activeConnections = ConcurrentHashMap<String, Call>()

    // OkHttp client for internet requests
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    /**
     * Process an IP packet from receiver:
     * 1. Parse IP header
     * 2. Extract TCP/UDP payload
     * 3. Forward to internet
     * 4. Send response back
     */
    fun processPacket(packet: ByteArray) {
        try {
            if (packet.size < 20) {
                Log.d(TAG, "Packet too small: ${packet.size}")
                return
            }

            val version = (packet[0].toInt() shr 4) and 0xF
            if (version != 4) {
                Log.d(TAG, "Not IPv4: version=$version")
                return
            }

            val headerLength = (packet[0].toInt() and 0x0F) * 4
            val totalLength = ((packet[2].toInt() and 0xFF) shl 8) or (packet[3].toInt() and 0xFF)
            val protocol = packet[9].toInt() and 0xFF

            val destIp = "${packet[16].toInt() and 0xFF}.${packet[17].toInt() and 0xFF}.${packet[18].toInt() and 0xFF}.${packet[19].toInt() and 0xFF}"
            val srcIp = "${packet[12].toInt() and 0xFF}.${packet[13].toInt() and 0xFF}.${packet[14].toInt() and 0xFF}.${packet[15].toInt() and 0xFF}"

            // Skip non-TCP/UDP (ICMP, etc.)
            if (protocol != 6 && protocol != 17) { // 6=TCP, 17=UDP
                Log.d(TAG, "Skipping protocol=$protocol to $destIp")
                return
            }

            if (headerLength + 4 > packet.size) {
                Log.d(TAG, "Packet too small for TCP/UDP header")
                return
            }

            val srcPort = ((packet[headerLength].toInt() and 0xFF) shl 8) or (packet[headerLength + 1].toInt() and 0xFF)
            val destPort = ((packet[headerLength + 2].toInt() and 0xFF) shl 8) or (packet[headerLength + 3].toInt() and 0xFF)

            val connectionId = "${srcIp}_$srcPort"

            Log.d(TAG, "NAT: $srcIp:$srcPort -> $destIp:$destPort (proto=$protocol, size=${packet.size})")

            if (protocol == 6) {
                // TCP - handle via OkHttp for HTTP traffic
                handleTcpPacket(packet, connectionId, destIp, destPort, headerLength)
            } else {
                // UDP - simple forward
                handleUdpPacket(packet, connectionId, destIp, destPort, headerLength)
            }

            bytesOut.addAndGet(packet.size.toLong())
            onStatsUpdate(bytesOut.get(), bytesIn.get())

        } catch (e: Exception) {
            Log.e(TAG, "Error processing packet: ${e.message}", e)
        }
    }

    private fun handleTcpPacket(
        packet: ByteArray,
        connectionId: String,
        destIp: String,
        destPort: Int,
        headerLength: Int
    ) {
        // TCP flags
        val tcpFlags = packet[headerLength + 13].toInt() and 0xFF
        val syn = (tcpFlags and 0x02) != 0
        val ack = (tcpFlags and 0x10) != 0
        val fin = (tcpFlags and 0x01) != 0
        val rst = (tcpFlags and 0x04) != 0

        // SYN - new connection
        if (syn && !ack) {
            Log.d(TAG, "TCP SYN to $destIp:$destPort")
            // Send SYN-ACK response (fake handshake)
            sendSynAck(packet, connectionId, destIp, destPort, headerLength)
            return
        }

        // Data packet (ACK with payload)
        if (ack && packet.size > headerLength + 20) {
            val payloadStart = headerLength + 20 // Skip TCP options
            if (payloadStart < packet.size) {
                val payload = packet.copyOfRange(payloadStart, packet.size)

                // Try HTTP for port 80/443
                if (destPort == 80 || destPort == 443) {
                    fetchHttp(destIp, destPort, payload, connectionId, packet, headerLength)
                } else {
                    // Generic TCP - echo ACK
                    sendTcpAck(packet, connectionId, destIp, destPort, headerLength)
                }
            }
        }

        // FIN - close connection
        if (fin) {
            Log.d(TAG, "TCP FIN from $connectionId")
            activeConnections.remove(connectionId)?.cancel()
            sendFinAck(packet, connectionId, destIp, destPort, headerLength)
        }

        // RST - reset connection
        if (rst) {
            Log.d(TAG, "TCP RST from $connectionId")
            activeConnections.remove(connectionId)?.cancel()
        }
    }

    private fun sendSynAck(packet: ByteArray, connId: String, destIp: String, destPort: Int, headerLen: Int) {
        // Construct SYN-ACK response
        val response = buildTcpResponse(
            originalPacket = packet,
            srcIp = destIp, srcPort = destPort,
            destIp = extractIp(packet, 12), destPort = extractPort(packet, headerLen),
            flags = 0x12 // SYN+ACK
        )
        onSendPacket(response)
        Log.d(TAG, "Sent SYN-ACK to ${extractIp(packet, 12)}:${extractPort(packet, headerLen)}")
    }

    private fun sendTcpAck(packet: ByteArray, connId: String, destIp: String, destPort: Int, headerLen: Int) {
        val response = buildTcpResponse(
            originalPacket = packet,
            srcIp = destIp, srcPort = destPort,
            destIp = extractIp(packet, 12), destPort = extractPort(packet, headerLen),
            flags = 0x10 // ACK
        )
        onSendPacket(response)
    }

    private fun sendFinAck(packet: ByteArray, connId: String, destIp: String, destPort: Int, headerLen: Int) {
        val response = buildTcpResponse(
            originalPacket = packet,
            srcIp = destIp, srcPort = destPort,
            destIp = extractIp(packet, 12), destPort = extractPort(packet, headerLen),
            flags = 0x11 // FIN+ACK
        )
        onSendPacket(response)
    }

    private fun fetchHttp(
        destIp: String, destPort: Int,
        payload: ByteArray, connId: String,
        originalPacket: ByteArray, headerLen: Int
    ) {
        val requestStr = String(payload)
        Log.d(TAG, "HTTP request: ${requestStr.take(100)}")

        // Parse HTTP request line
        val firstLine = requestStr.lineSequence().firstOrNull() ?: return
        val parts = firstLine.split(" ")
        if (parts.size < 2) return

        val method = parts[0]
        val path = parts[1]
        val hostHeader = requestStr.lines().find { it.startsWith("Host:", true) }
            ?.substringAfter(":")?.trim() ?: destIp

        val scheme = if (destPort == 443) "https" else "http"
        val url = "$scheme://$hostHeader$path"

        Log.d(TAG, "Fetching: $url")

        val request = Request.Builder()
            .url(url)
            .apply {
                // Copy headers from original request
                requestStr.lines().forEach { line ->
                    if (line.contains(":") && !line.startsWith("Host:") &&
                        !line.startsWith("Content-Length:") && !line.startsWith("Connection:")) {
                        val (key, value) = line.split(":", limit = 2)
                        header(key.trim(), value.trim())
                    }
                }
            }
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "HTTP fetch failed: ${e.message}")
                // Send error response
                val errorResponse = buildHttpResponse(502, "Bad Gateway", "Failed to fetch: ${e.message}")
                sendHttpBack(originalPacket, connId, destIp, destPort, headerLen, errorResponse)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val body = response.body?.bytes() ?: ByteArray(0)
                    val statusCode = response.code
                    val headers = buildString {
                        response.headers.forEach { (name, value) ->
                            append("$name: $value\r\n")
                        }
                    }

                    val fullResponse = buildHttpResponse(statusCode, response.message, headers, body)
                    sendHttpBack(originalPacket, connId, destIp, destPort, headerLen, fullResponse)

                    bytesIn.addAndGet(fullResponse.size.toLong())
                    onStatsUpdate(bytesOut.get(), bytesIn.get())
                } catch (e: Exception) {
                    Log.e(TAG, "Error sending HTTP response: ${e.message}")
                } finally {
                    response.close()
                }
            }
        })
    }

    private fun sendHttpBack(
        originalPacket: ByteArray, connId: String,
        destIp: String, destPort: Int, headerLen: Int,
        httpResponse: ByteArray
    ) {
        // Wrap HTTP response in TCP/IP packet
        val srcIp = extractIp(originalPacket, 12)
        val srcPort = extractPort(originalPacket, headerLen)

        val packet = buildTcpWithPayload(
            srcIp = destIp, srcPort = destPort,
            destIp = srcIp, destPort = srcPort,
            payload = httpResponse
        )
        onSendPacket(packet)
        Log.d(TAG, "Sent HTTP response: ${httpResponse.size} bytes to $srcIp:$srcPort")
    }

    private fun handleUdpPacket(
        packet: ByteArray,
        connId: String,
        destIp: String, destPort: Int,
        headerLen: Int
    ) {
        // UDP DNS resolution (port 53)
        if (destPort == 53) {
            handleDnsQuery(packet, connId, destIp, headerLen)
            return
        }

        // Generic UDP - not supported yet
        Log.d(TAG, "UDP packet to $destIp:$destPort (not supported)")
    }

    private fun handleDnsQuery(
        packet: ByteArray, connId: String, destIp: String, headerLen: Int
    ) {
        // Extract DNS query and respond with the actual IP
        // For simplicity, return the destination IP itself
        val srcIp = extractIp(packet, 12)
        val srcPort = extractPort(packet, headerLen)

        // Build a simple DNS response pointing to the real IP
        val dnsResponse = buildDnsResponse(packet, destIp)
        onSendPacket(dnsResponse)
        Log.d(TAG, "DNS response for $destIp")
    }

    // ===== PACKET BUILDING HELPERS =====

    private fun buildTcpResponse(
        originalPacket: ByteArray,
        srcIp: String, srcPort: Int,
        destIp: String, destPort: Int,
        flags: Int
    ): ByteArray {
        val response = ByteArray(40) // 20 IP + 20 TCP

        // IP Header
        response[0] = 0x45 // Version 4, IHL 5
        response[2] = 0
        response[3] = 40.toByte() // Total length
        response[6] = 0x40 // Don't fragment
        response[7] = 0
        response[8] = 64.toByte() // TTL
        response[9] = 6.toByte() // TCP
        setIp(response, 12, srcIp)
        setIp(response, 16, destIp)
        computeIpChecksum(response)

        // TCP Header
        setPort(response, 20, srcPort)
        setPort(response, 22, destPort)
        response[33] = flags.toByte() // Flags
        response[32] = 0x50 // Data offset (5 words)

        return response
    }

    private fun buildTcpWithPayload(
        srcIp: String, srcPort: Int,
        destIp: String, destPort: Int,
        payload: ByteArray
    ): ByteArray {
        val tcpLen = 20 + payload.size
        val totalLen = 20 + tcpLen
        val packet = ByteArray(totalLen)

        // IP Header
        packet[0] = 0x45
        packet[2] = (totalLen shr 8).toByte()
        packet[3] = (totalLen and 0xFF).toByte()
        packet[6] = 0x40
        packet[7] = 0
        packet[8] = 64.toByte()
        packet[9] = 6.toByte()
        setIp(packet, 12, srcIp)
        setIp(packet, 16, destIp)
        computeIpChecksum(packet)

        // TCP Header
        setPort(packet, 20, srcPort)
        setPort(packet, 22, destPort)
        packet[32] = 0x50
        packet[33] = 0x18 // PSH+ACK

        // Copy payload
        System.arraycopy(payload, 0, packet, 40, payload.size)

        return packet
    }

    private fun buildHttpResponse(
        statusCode: Int, statusText: String,
        headers: String, body: ByteArray
    ): ByteArray {
        val statusLine = "HTTP/1.1 $statusCode $statusText\r\n"
        val headerBlock = "$headers\r\n"
        val contentLength = "Content-Length: ${body.size}\r\n"
        val separator = "\r\n"

        val headerBytes = (statusLine + contentLength + headerBlock + separator).toByteArray()
        val fullResponse = ByteArray(headerBytes.size + body.size)
        System.arraycopy(headerBytes, 0, fullResponse, 0, headerBytes.size)
        System.arraycopy(body, 0, fullResponse, headerBytes.size, body.size)
        return fullResponse
    }

    private fun buildHttpResponse(statusCode: Int, statusText: String, body: String): ByteArray {
        return buildHttpResponse(statusCode, statusText, "Content-Type: text/html; charset=utf-8\r\nConnection: close", body.toByteArray())
    }

    private fun buildDnsResponse(query: ByteArray, answerIp: String): ByteArray {
        val response = ByteArray(query.size + 16 + 4)
        System.arraycopy(query, 0, response, 0, query.size)

        // Set QR=1 (response), AA=1
        response[2] = response[2].toInt().or(0x80).toByte()
        response[3] = response[3].toInt().or(0x04).toByte()

        // ANCOUNTER = 1
        response[6] = 0
        response[7] = 1.toByte()

        // Answer RR
        var offset = query.size
        response[offset++] = 0xC0 // Name pointer
        response[offset++] = 0x0C
        response[offset++] = 0 // Type A
        response[offset++] = 1.toByte()
        response[offset++] = 0 // Class IN
        response[offset++] = 1.toByte()
        response[offset++] = 0 // TTL
        response[offset++] = 0
        response[offset++] = 0
        response[offset++] = 4.toByte()
        response[offset++] = 0 // RDLENGTH = 4

        val ipParts = answerIp.split(".")
        response[offset++] = ipParts[0].toByte()
        response[offset++] = ipParts[1].toByte()
        response[offset++] = ipParts[2].toByte()
        response[offset++] = ipParts[3].toByte()

        return response.copyOf(offset)
    }

    private fun extractIp(packet: ByteArray, offset: Int): String {
        return "${packet[offset].toInt() and 0xFF}.${packet[offset + 1].toInt() and 0xFF}.${packet[offset + 2].toInt() and 0xFF}.${packet[offset + 3].toInt() and 0xFF}"
    }

    private fun extractPort(packet: ByteArray, tcpHeaderOffset: Int): Int {
        return ((packet[tcpHeaderOffset].toInt() and 0xFF) shl 8) or (packet[tcpHeaderOffset + 1].toInt() and 0xFF)
    }

    private fun setIp(packet: ByteArray, offset: Int, ip: String) {
        val parts = ip.split(".")
        packet[offset] = parts[0].toByte()
        packet[offset + 1] = parts[1].toByte()
        packet[offset + 2] = parts[2].toByte()
        packet[offset + 3] = parts[3].toByte()
    }

    private fun setPort(packet: ByteArray, offset: Int, port: Int) {
        packet[offset] = (port shr 8).toByte()
        packet[offset + 1] = (port and 0xFF).toByte()
    }

    private fun computeIpChecksum(packet: ByteArray) {
        packet[10] = 0
        packet[11] = 0
        var sum = 0L
        for (i in 0..9 step 2) {
            sum += ((packet[i].toInt() and 0xFF) shl 8) or (packet[i + 1].toInt() and 0xFF)
        }
        for (i in 12..19 step 2) {
            sum += ((packet[i].toInt() and 0xFF) shl 8) or (packet[i + 1].toInt() and 0xFF)
        }
        while (sum shr 16 > 0) {
            sum = (sum and 0xFFFF) + (sum shr 16)
        }
        val checksum = (sum.inv() and 0xFFFF).toInt()
        packet[10] = (checksum shr 8).toByte()
        packet[11] = (checksum and 0xFF).toByte()
    }

    fun stop() {
        Log.d(TAG, "NAT Proxy stopping")
        activeConnections.values.forEach { it.cancel() }
        activeConnections.clear()
        httpClient.dispatcher.executorService.shutdown()
    }
}
