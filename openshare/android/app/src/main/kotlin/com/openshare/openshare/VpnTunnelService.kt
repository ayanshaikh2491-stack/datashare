package com.openshare.openshare

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import io.flutter.Log
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.*
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

class VpnTunnelService : VpnService() {
    private var vpnInterface: ParcelFileDescriptor? = null
    private var inputStream: FileInputStream? = null
    private var outputStream: FileOutputStream? = null
    private var isRunning = false
    private var methodChannel: MethodChannel? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val packetQueue = java.util.concurrent.ConcurrentLinkedQueue<ByteArray>()
    private var writeJob: Job? = null

    companion object {
        const val CHANNEL_ID = "OpenShareVPN"
        const val NOTIFICATION_ID = 1
        const val TAG = "VpnTunnelService"
        const val METHOD_CHANNEL = "com.openshare/vpn"
        
        // TCP flags
        const val TCP_FIN = 0x01
        const val TCP_SYN = 0x02
        const val TCP_RST = 0x04
        const val TCP_PSH = 0x08
        const val TCP_ACK = 0x10

        var onPacketCallback: ((ByteArray) -> Unit)? = null
        var onStatusCallback: ((String, String?) -> Unit)? = null
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, android.app.Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("OpenShare")
            .setContentText("VPN is running")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .build())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") {
            stopVpn()
            return START_NOT_STICKY
        }
        
        if (intent?.action == "WRITE_DATA") {
            val data = intent.getByteArrayExtra("data")
            if (data != null) {
                writeToTun(data)
            }
            return START_STICKY
        }

        startVpn(intent?.getStringExtra("methodChannelName"))
        return START_STICKY
    }

    private fun startVpn(channelName: String?) {
        try {
            val builder = Builder()
            builder.setSession("OpenShare Tunnel")
            builder.setMtu(1500)
            
            // Add addresses
            builder.addAddress("10.0.0.2", 32)
            // Add routes for all traffic
            builder.addRoute("0.0.0.0", 0)
            // Add DNS
            builder.addDnsServer("8.8.8.8")
            builder.addDnsServer("8.8.4.4")
            
            // Allow apps (all for now)
            builder.setBlocking(true)

            // Allow all apps through VPN
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            vpnInterface = builder.establish()
            
            if (vpnInterface == null) {
                onStatusCallback?.invoke("error", "Failed to establish VPN interface")
                return
            }

            inputStream = FileInputStream(vpnInterface!!.fileDescriptor)
            outputStream = FileOutputStream(vpnInterface!!.fileDescriptor)

            isRunning = true
            onStatusCallback?.invoke("started", null)

            // Start read loop
            scope.launch {
                readPackets()
            }

            // Start write loop
            writeJob = scope.launch {
                writePackets()
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error starting VPN: ${e.message}")
            onStatusCallback?.invoke("error", e.message)
        }
    }

    private suspend fun readPackets() {
        val buffer = ByteArray(65535)
        val byteBuffer = ByteBuffer.wrap(buffer).order(ByteOrder.BIG_ENDIAN)

        while (isRunning) {
            try {
                val bytesRead = inputStream?.read(buffer) ?: -1
                if (bytesRead > 0) {
                    val packet = buffer.copyOf(bytesRead)
                    onPacketCallback?.invoke(packet)
                } else if (bytesRead == -1) {
                    // Stream closed
                    break
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Log.e(TAG, "Error reading packet: ${e.message}")
                }
                break
            }
        }
    }

    private suspend fun writePackets() {
        while (isRunning) {
            try {
                val packet = packetQueue.poll()
                if (packet == null) {
                    delay(10) // Small delay if queue is empty
                    continue
                }
                outputStream?.write(packet)
                outputStream?.flush()
            } catch (e: Exception) {
                if (isRunning) {
                    Log.e(TAG, "Error writing packet: ${e.message}")
                }
            }
        }
    }

    fun writeToTun(data: ByteArray) {
        if (isRunning) {
            packetQueue.add(data)
        }
    }

    private fun stopVpn() {
        isRunning = false
        try {
            inputStream?.close()
            outputStream?.close()
            vpnInterface?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing VPN: ${e.message}")
        }
        inputStream = null
        outputStream = null
        vpnInterface = null
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        onStatusCallback?.invoke("stopped", null)
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "OpenShare VPN",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
