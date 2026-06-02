package com.datashare

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.os.Environment
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import kotlin.concurrent.thread
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL

/**
 * MainActivity — DataShare VPN App
 *
 * Simple UI for Donor/Receiver modes
 *   - Donor Mode: Share your internet with someone
 *   - Receiver Mode: Use donor's internet via VPN tunnel
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val VPN_REQUEST_CODE = 100
        const val ACTION_VPN_STATE_CHANGED = "com.datashare.VPN_STATE_CHANGED"
        const val EXTRA_STATE = "state"
        const val EXTRA_DATA_USED = "data_used"
    }

    // UI elements
    private lateinit var btnConnect: Button
    private lateinit var btnToggleMode: Button
    private lateinit var btnSettings: Button
    private lateinit var tvMode: TextView
    private lateinit var tvModeDescription: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvDataUsed: TextView
    private lateinit var tvSessionInfo: TextView

    private var isVpnRunning = false

    // Broadcast receiver for VPN state updates
    private val vpnStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_VPN_STATE_CHANGED -> {
                    val state = intent.getStringExtra(EXTRA_STATE) ?: ""
                    updateConnectionState(state)
                    val data = intent.getLongExtra(EXTRA_DATA_USED, 0)
                    updateDataUsed(data)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize VpnStateManager
        VpnStateManager.mode = VpnStateManager.MODE_RECEIVER

        // Bind views
        bindViews()

        // Register local broadcast receiver
        LocalBroadcastManager.getInstance(this).registerReceiver(
            vpnStateReceiver,
            IntentFilter(ACTION_VPN_STATE_CHANGED)
        )

        // Set up VpnStateManager UI callbacks
        VpnStateManager.setOnStateChangeListener { state ->
            runOnUiThread {
                updateConnectionState(state)
                // Also broadcast for service-side updates
                val intent = Intent(ACTION_VPN_STATE_CHANGED).apply {
                    putExtra(EXTRA_STATE, state)
                    putExtra(EXTRA_DATA_USED, VpnStateManager.bytesTransferred)
                }
                LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
            }
        }

        VpnStateManager.setOnDataUpdateListener { bytes ->
            runOnUiThread { updateDataUsed(bytes) }
        }

        // Connect button
        btnConnect.setOnClickListener {
            if (isVpnRunning) {
                stopVpnTunnel()
            } else {
                startVpnTunnel()
            }
        }

        // Toggle mode button
        btnToggleMode.setOnClickListener {
            if (!isVpnRunning) {
                toggleMode()
            } else {
                Toast.makeText(this, "Disconnect first to switch mode", Toast.LENGTH_SHORT).show()
            }
        }

        // Settings button
        btnSettings.setOnClickListener {
            showSettingsDialog()
        }

        // Set initial UI state
        updateModeUI()
    }

    override fun onDestroy() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(vpnStateReceiver)
        super.onDestroy()
    }

    // ====================================================================
    // UI SETUP
    // ====================================================================

    private fun bindViews() {
        btnConnect = findViewById(R.id.btnConnect)
        btnToggleMode = findViewById(R.id.btnToggleMode)
        btnSettings = findViewById(R.id.btnSettings)
        tvMode = findViewById(R.id.tvMode)
        tvModeDescription = findViewById(R.id.tvModeDescription)
        tvStatus = findViewById(R.id.tvStatus)
        tvDataUsed = findViewById(R.id.tvDataUsed)
        tvSessionInfo = findViewById(R.id.tvSessionInfo)
    }

    private fun updateModeUI() {
        if (VpnStateManager.mode == VpnStateManager.MODE_DONOR) {
            tvMode.text = "🎁 Donor Mode"
            tvModeDescription.text = "Share your mobile data with someone else"
            btnConnect.text = "📡 Start Sharing"
        } else {
            tvMode.text = "📶 Receiver Mode"
            tvModeDescription.text = "Use donor's mobile data for all apps"
            btnConnect.text = "🔗 Connect to Donor"
        }
    }

    private fun toggleMode() {
        VpnStateManager.mode = if (VpnStateManager.mode == VpnStateManager.MODE_DONOR) {
            VpnStateManager.MODE_RECEIVER
        } else {
            VpnStateManager.MODE_DONOR
        }
        updateModeUI()
    }

    private fun updateConnectionState(state: String) {
        when (state) {
            VpnStateManager.STATE_DISCONNECTED -> {
                tvStatus.text = "⚪ Not Connected"
                tvStatus.setTextColor(getColor(R.color.gray))
                isVpnRunning = false
                updateModeUI()
            }
            VpnStateManager.STATE_CONNECTING -> {
                tvStatus.text = "🟡 Connecting..."
                tvStatus.setTextColor(getColor(R.color.orange))
            }
            VpnStateManager.STATE_CONNECTED -> {
                val mode = if (VpnStateManager.mode == VpnStateManager.MODE_DONOR) "Sharing" else "Connected"
                tvStatus.text = "🟢 $mode via VPN Tunnel"
                tvStatus.setTextColor(getColor(R.color.green))
                btnConnect.text = "⏹ Disconnect"

                // Show session info
                tvSessionInfo.text = buildString {
                    if (VpnStateManager.sessionId.isNotEmpty()) {
                        append("Session: ${VpnStateManager.sessionId.take(20)}...\n")
                    }
                    if (VpnStateManager.donorId.isNotEmpty()) {
                        append("Donor: ${VpnStateManager.donorId.take(16)}...\n")
                    }
                    if (VpnStateManager.receiverId.isNotEmpty()) {
                        append("Receiver: ${VpnStateManager.receiverId.take(16)}...\n")
                    }
                }
                tvSessionInfo.visibility = android.view.View.VISIBLE
            }
            VpnStateManager.STATE_ERROR -> {
                tvStatus.text = "🔴 Connection Error"
                tvStatus.setTextColor(getColor(R.color.red))
                isVpnRunning = false
            }
        }
    }

    private fun updateDataUsed(bytes: Long) {
        tvDataUsed.text = VpnStateManager.formatBytes(bytes)
    }

    // ====================================================================
    // VPN CONTROL
    // ====================================================================

    private fun startVpnTunnel() {
        // First request VPN permission
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            onActivityResult(VPN_REQUEST_CODE, RESULT_OK, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == RESULT_OK) {
                // Permission granted — start VPN service
                val serviceIntent = Intent(this, DataShareVpnService::class.java).apply {
                    action = DataShareVpnService.ACTION_START_VPN
                    putExtra(DataShareVpnService.EXTRA_MODE, VpnStateManager.mode)
                    putExtra(DataShareVpnService.EXTRA_USER_ID,
                        "user_${System.currentTimeMillis()}")
                    if (VpnStateManager.mode == VpnStateManager.MODE_RECEIVER
                        && VpnStateManager.donorId.isNotEmpty()) {
                        putExtra(DataShareVpnService.EXTRA_DONOR_ID, VpnStateManager.donorId)
                    }
                }
                startForegroundService(serviceIntent)

                isVpnRunning = true
                VpnStateManager.updateState(VpnStateManager.STATE_CONNECTING)
                Toast.makeText(this, "Starting VPN tunnel...", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "VPN permission denied!", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun stopVpnTunnel() {
        // Stop service properly - use stopService + stop intent for safety
        val serviceIntent = Intent(this, DataShareVpnService::class.java).apply {
            action = DataShareVpnService.ACTION_STOP_VPN
        }
        startService(serviceIntent)
        
        // Also stop via stopService as fallback
        try {
            stopService(Intent(this, DataShareVpnService::class.java))
        } catch (e: Exception) {
            Log.w(TAG, "stopService failed: ${e.message}")
        }
        
        isVpnRunning = false
        VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
        Toast.makeText(this, "VPN disconnected", Toast.LENGTH_SHORT).show()
        tvSessionInfo.text = ""
        tvSessionInfo.visibility = android.view.View.GONE
        updateModeUI()
    }

    // ====================================================================
    // AUTO-UPDATE SYSTEM
    // ====================================================================

    override fun onResume() {
        super.onResume()
        checkForUpdate()
    }

    private fun checkForUpdate() {
        thread {
            try {
                val url = URL("${VpnStateManager.SERVER_URL.replace("wss://", "https://").replace("/ws-vpn", "")}/api/app/version")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val json = JSONObject(conn.inputStream.bufferedReader().readText())
                conn.disconnect()

                val serverVersion = json.getInt("versionCode")
                val currentVersion = 6 // BuildConfig.VERSION_CODE
                val updateUrl = json.getString("updateUrl")
                val forceUpdate = json.optBoolean("forceUpdate", false)

                if (serverVersion > currentVersion) {
                    runOnUiThread {
                        showUpdateDialog(updateUrl, forceUpdate)
                    }
                }
            } catch (e: Exception) {
                // Server unreachable — skip update check
            }
        }
    }

    private fun showUpdateDialog(updateUrl: String, forceUpdate: Boolean) {
        val builder = AlertDialog.Builder(this)
        builder.setTitle("📲 Update Available!")
        builder.setMessage("New version of DataShare is available.\nTap Download to get the latest features!")
        builder.setPositiveButton("⬇ Download") { _, _ ->
            downloadAndInstall(updateUrl)
        }
        builder.setNegativeButton("Later", null)
        builder.setCancelable(!forceUpdate)
        if (forceUpdate) {
            builder.setNegativeButton("Exit") { _, _ -> finish() }
        }
        builder.show()
    }

    private fun downloadAndInstall(updateUrl: String) {
        try {
            val fullUrl = VpnStateManager.SERVER_URL.replace("wss://", "https://").replace("/ws-vpn", "") + updateUrl
            val downloadManager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            val request = DownloadManager.Request(Uri.parse(fullUrl))
            request.setTitle("DataShare Update")
            request.setDescription("Downloading latest version...")
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "DataShare-Update.apk")
            downloadManager.enqueue(request)

            Toast.makeText(this, "Download started! Check notifications.", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            // Fallback: open browser
            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(VpnStateManager.SERVER_URL.replace("wss://", "https://").replace("/ws-vpn", "") + updateUrl))
            startActivity(browserIntent)
        }
    }

    // ====================================================================
    // SETTINGS DIALOG
    // ====================================================================

    private fun showSettingsDialog() {
        val items = arrayOf(
            "Server: ${VpnStateManager.SERVER_URL.take(40)}...",
            if (VpnStateManager.mode == VpnStateManager.MODE_RECEIVER)
                "Donor ID: ${VpnStateManager.donorId.ifEmpty { "Not set" }}" else
                "Share this user ID: ${VpnStateManager.donorId.ifEmpty { "connect to see" }}"
        )

        AlertDialog.Builder(this)
            .setTitle("⚙️ Settings")
            .setItems(items) { _, _ -> }
            .setPositiveButton("Set Donor ID") { _, _ ->
                showDonorIdInput()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun showDonorIdInput() {
        val input = android.widget.EditText(this).apply {
            hint = "Enter Donor ID"
            setText(VpnStateManager.donorId)
        }

        AlertDialog.Builder(this)
            .setTitle("Donor ID")
            .setMessage("Enter the donor's user ID to connect to:")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                VpnStateManager.donorId = input.text.toString().trim()
                Toast.makeText(this, "Donor ID saved!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
