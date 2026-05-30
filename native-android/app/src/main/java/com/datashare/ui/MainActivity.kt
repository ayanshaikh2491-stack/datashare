package com.datashare.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.datashare.R
import com.datashare.databinding.ActivityMainBinding
import com.datashare.service.DataSharePreferences
import com.datashare.service.VpnStateManager
import kotlinx.coroutines.launch

/**
 * MainActivity - DataShare VPN App
 *
 * UI for Donor/Receiver mode selection, login, connection, and stats.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: DataSharePreferences
    private var isVpnRunning = false

    companion object {
        private const val VPN_REQUEST_CODE = 100
        private const val PERMISSION_REQUEST_CODE = 200
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = DataSharePreferences(this)

        setupUI()
        checkPermissions()
        restoreState()
    }

    private fun setupUI() {
        // Check if user is logged in
        if (prefs.userId.isEmpty()) {
            showLoginScreen()
        } else {
            showMainScreen()
        }

        // Connect button
        binding.btnConnect.setOnClickListener {
            if (isVpnRunning) {
                disconnectVpn()
            } else {
                connectVpn()
            }
        }

        // Mode toggle
        binding.btnToggleMode.setOnClickListener {
            toggleMode()
        }

        // Logout
        binding.btnLogout.setOnClickListener {
            logout()
        }

        // Settings
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    private fun showLoginScreen() {
        binding.layoutLogin.visibility = View.VISIBLE
        binding.layoutMain.visibility = View.GONE

        binding.btnLogin.setOnClickListener {
            val email = binding.etEmail.text.toString().trim()
            val name = binding.etName.text.toString().trim()

            if (email.isEmpty()) {
                binding.etEmail.error = "Email required"
                return@setOnClickListener
            }

            login(email, name)
        }
    }

    private fun showMainScreen() {
        binding.layoutLogin.visibility = View.GONE
        binding.layoutMain.visibility = View.VISIBLE

        // Show user info
        binding.tvUserName.text = "Hi, ${prefs.userName}!"
        updateModeDisplay()
        updateConnectionState()
    }

    private fun login(email: String, name: String) {
        binding.btnLogin.isEnabled = false
        binding.btnLogin.text = "Logging in..."

        lifecycleScope.launch {
            try {
                val apiService = ApiService.getInstance()
                val response = apiService.login(email, name)

                if (response.success) {
                    prefs.userId = response.userId
                    prefs.userName = response.name
                    prefs.token = response.token
                    prefs.userRole = response.role
                    prefs.userEmail = email

                    Toast.makeText(this@MainActivity, "Welcome, ${response.name}!", Toast.LENGTH_SHORT).show()
                    showMainScreen()
                } else {
                    Toast.makeText(this@MainActivity, "Login failed: ${response.message}", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                binding.btnLogin.isEnabled = true
                binding.btnLogin.text = "Login"
            }
        }
    }

    private fun toggleMode() {
        prefs.userRole = if (prefs.userRole == "donor") "receiver" else "donor"
        updateModeDisplay()
        updateConnectionState()

        val modeText = if (prefs.userRole == "donor") "Donor Mode" else "Receiver Mode"
        Toast.makeText(this, "Switched to $modeText", Toast.LENGTH_SHORT).show()
    }

    private fun updateModeDisplay() {
        if (prefs.userRole == "donor") {
            binding.tvMode.text = "🎁 Donor Mode"
            binding.tvModeDescription.text = "Share your mobile data with others"
            binding.btnConnect.text = "📡 Start Sharing"
            binding.btnConnect.setBackgroundResource(R.drawable.btn_gradient_donor)
        } else {
            binding.tvMode.text = "📶 Receiver Mode"
            binding.tvModeDescription.text = "Use donor's mobile data for all apps"
            binding.btnConnect.text = "🔗 Connect to Donor"
            binding.btnConnect.setBackgroundResource(R.drawable.btn_gradient_receiver)
        }
    }

    private fun connectVpn() {
        // Prepare VPN intent
        val intent = VpnService.prepare(this)
        if (intent != null) {
            // User needs to grant VPN permission
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            // Already have permission, start VPN directly
            onActivityResult(VPN_REQUEST_CODE, RESULT_OK, null)
        }
    }

    private fun disconnectVpn() {
        lifecycleScope.launch {
            try {
                VpnStateManager.disconnect(this@MainActivity)
                isVpnRunning = false
                updateConnectionState()
                Toast.makeText(this@MainActivity, "VPN disconnected", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Disconnect error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateConnectionState() {
        if (isVpnRunning) {
            binding.btnConnect.text = "⏹ Disconnect"
            binding.btnConnect.setBackgroundResource(R.drawable.btn_gradient_disconnect)
            binding.tvStatus.text = "🟢 VPN Active"
            binding.tvStatus.setTextColor(getColor(R.color.green))
        } else {
            updateModeDisplay()
            binding.tvStatus.text = "⚪ Not Connected"
            binding.tvStatus.setTextColor(getColor(R.color.gray))
        }
    }

    private fun startVpnService() {
        val serviceIntent = Intent(
            this,
            com.datashare.vpn.DataShareVpnService::class.java
        ).apply {
            action = com.datashare.vpn.DataShareVpnService.ACTION_CONNECT
            putExtra(com.datashare.vpn.DataShareVpnService.EXTRA_USER_ID, prefs.userId)
            putExtra(com.datashare.vpn.DataShareVpnService.EXTRA_TOKEN, prefs.token)
            putExtra(com.datashare.vpn.DataShareVpnService.EXTRA_MODE, prefs.userRole)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        isVpnRunning = true
        updateConnectionState()
    }

    private fun logout() {
        disconnectVpn()
        prefs.clear()
        showLoginScreen()
        Toast.makeText(this, "Logged out", Toast.LENGTH_SHORT).show()
    }

    private fun checkPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private fun restoreState() {
        // Check if VPN was running before app restart
        lifecycleScope.launch {
            val wasRunning = VpnStateManager.isRunning(this@MainActivity)
            if (wasRunning) {
                isVpnRunning = true
                updateConnectionState()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == RESULT_OK) {
                startVpnService()
            } else {
                Toast.makeText(this, "VPN permission denied", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Update stats periodically
        lifecycleScope.launch {
            while (isVpnRunning) {
                val stats = VpnStateManager.getStats(this@MainActivity)
                binding.tvDataUsed.text = formatBytes(stats.bytesSent + stats.bytesReceived)
                kotlinx.coroutines.delay(1000)
            }
        }
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}
