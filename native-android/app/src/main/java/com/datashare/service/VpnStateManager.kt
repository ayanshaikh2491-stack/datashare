package com.datashare.service

import android.content.Context
import android.content.Intent
import android.app.ActivityManager
import com.datashare.vpn.DataShareVpnService

/**
 * VpnStateManager - Track VPN service state
 */
object VpnStateManager {

    data class VpnStats(
        val bytesSent: Long = 0,
        val bytesReceived: Long = 0,
        val isConnected: Boolean = false
    )

    fun isRunning(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        for (service in manager.getRunningServices(Integer.MAX_VALUE)) {
            if (DataShareVpnService::class.java.name == service.service.className) {
                return true
            }
        }
        return false
    }

    fun connect(context: Context, userId: String, token: String, mode: String, donorId: String? = null) {
        val intent = DataShareVpnService.createConnectIntent(context, userId, token, mode, donorId)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun disconnect(context: Context) {
        val intent = DataShareVpnService.createDisconnectIntent(context)
        context.startService(intent)
    }

    fun getStats(context: Context): VpnStats {
        return VpnStats(
            isConnected = isRunning(context),
            bytesSent = 0,
            bytesReceived = 0
        )
    }
}
