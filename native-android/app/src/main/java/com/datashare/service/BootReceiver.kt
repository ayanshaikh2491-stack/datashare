package com.datashare.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BootReceiver - Auto-start VPN after device reboot
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = DataSharePreferences(context)
            if (prefs.autoConnect && prefs.isLoggedIn()) {
                VpnStateManager.connect(
                    context = context,
                    userId = prefs.userId,
                    token = prefs.token,
                    mode = prefs.userRole,
                    donorId = if (prefs.donorId.isNotEmpty()) prefs.donorId else null
                )
            }
        }
    }
}
