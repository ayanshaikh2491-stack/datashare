package com.datashare.service

import android.content.Context
import android.content.SharedPreferences

/**
 * DataSharePreferences - Store user settings and auth data
 */
class DataSharePreferences(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("datashare_prefs", Context.MODE_PRIVATE)

    var userId: String
        get() = prefs.getString("user_id", "") ?: ""
        set(value) = prefs.edit().putString("user_id", value).apply()

    var userName: String
        get() = prefs.getString("user_name", "") ?: ""
        set(value) = prefs.edit().putString("user_name", value).apply()

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(value) = prefs.edit().putString("token", value).apply()

    var userRole: String
        get() = prefs.getString("user_role", "receiver") ?: "receiver"
        set(value) = prefs.edit().putString("user_role", value).apply()

    var userEmail: String
        get() = prefs.getString("user_email", "") ?: ""
        set(value) = prefs.edit().putString("user_email", value).apply()

    var donorId: String
        get() = prefs.getString("donor_id", "") ?: ""
        set(value) = prefs.edit().putString("donor_id", value).apply()

    var autoConnect: Boolean
        get() = prefs.getBoolean("auto_connect", false)
        set(value) = prefs.edit().putBoolean("auto_connect", value).apply()

    var dataLimitMB: Int
        get() = prefs.getInt("data_limit_mb", 500)
        set(value) = prefs.edit().putInt("data_limit_mb", value).apply()

    var serverUrl: String
        get() = prefs.getString("server_url", "https://datashare-server.onrender.com") ?: "https://datashare-server.onrender.com"
        set(value) = prefs.edit().putString("server_url", value).apply()

    var wsUrl: String
        get() = prefs.getString("ws_url", "wss://datashare-server.onrender.com/ws-vpn") ?: "wss://datashare-server.onrender.com/ws-vpn"
        set(value) = prefs.edit().putString("ws_url", value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun isLoggedIn(): Boolean = userId.isNotEmpty() && token.isNotEmpty()
}
