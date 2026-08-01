package com.openshare.openshare

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.net.wifi.WifiManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.openshare/vpn"
    private val LOCAL_CHANNEL = "com.openshare/local"
    private var localReservation: WifiManager.LocalOnlyHotspotReservation? = null
    private val LOCAL_HOTSPOT_REQUEST = 1002

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startVpn" -> {
                    val intent = VpnService.prepare(this)
                    if (intent != null) {
                        // Need to ask user for permission
                        startActivityForResult(intent, VPN_REQUEST_CODE)
                        result.success("permission_required")
                    } else {
                        // Permission already granted
                        startVpnService()
                        result.success("started")
                    }
                }
                "stopVpn" -> {
                    val stopIntent = Intent(this, VpnTunnelService::class.java)
                    stopIntent.action = "STOP"
                    startService(stopIntent)
                    result.success("stopped")
                }
                "writeToTun" -> {
                    val data = call.argument<ByteArray>("data")
                    if (data != null) {
                        val writeIntent = Intent(this, VpnTunnelService::class.java)
                        writeIntent.action = "WRITE_DATA"
                        writeIntent.putExtra("data", data)
                        startService(writeIntent)
                    }
                    result.success(true)
                }
                "isVpnRunning" -> {
                    result.success(VpnTunnelService.onStatusCallback != null)
                }
                else -> result.notImplemented()
            }
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LOCAL_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> startLocalHotspot(result)
                "stop" -> { stopLocalHotspot(); result.success(true) }
                else -> result.notImplemented()
            }
        }

        // Test automation hook: expose launch intent extras to Dart.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.openshare/test").setMethodCallHandler { call, result ->
            when (call.method) {
                "extras" -> {
                    val map = HashMap<String, Any?>()
                    val extras = intent?.extras
                    if (extras != null) {
                        for (key in extras.keySet()) {
                            map[key] = extras.get(key)
                        }
                    }
                    result.success(map)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == RESULT_OK) {
                startVpnService()
            }
        }
    }

    private fun startVpnService() {
        val intent = Intent(this, VpnTunnelService::class.java)
        intent.action = "START"
        intent.putExtra("methodChannelName", CHANNEL)
        startService(intent)
    }

    private fun startLocalHotspot(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.error("unsupported", "Local hotspot needs Android 8+", null)
            return
        }
        // Android 13+ requires NEARBY_WIFI_DEVICES (runtime); older versions use
        // ACCESS_FINE_LOCATION (declared with maxSdkVersion=32). Request whichever
        // applies and keep the MethodChannel result pending until the user answers,
        // then start the hotspot (or report denial) from onRequestPermissionsResult.
        val missing = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }
        if (missing.isNotEmpty()) {
            pendingHotspotResult = result
            requestPermissions(missing.toTypedArray(), LOCAL_HOTSPOT_REQUEST)
            return
        }
        startLocalHotspotNow(result)
    }

    private fun startLocalHotspotNow(result: MethodChannel.Result) {
        val wm = getSystemService(WIFI_SERVICE) as WifiManager
        val callback = object : WifiManager.LocalOnlyHotspotCallback() {
            override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
                localReservation = reservation
                val ssid = reservation.wifiConfiguration?.SSID?.removeSurrounding("\"") ?: "OpenShare"
                result.success(mapOf("ssid" to ssid, "enabled" to true))
            }

            override fun onFailed(reason: Int) {
                result.error("hotspot_failed", "Hotspot failed (code $reason)", null)
            }

            override fun onStopped() {
                localReservation = null
            }
        }
        // WifiManager has no single-argument overload; the (callback, handler)
        // form is the only one available (added in API 26). Handler may be null.
        wm.startLocalOnlyHotspot(callback, null)
    }

    private fun stopLocalHotspot() {
        try { localReservation?.close() } catch (_: Exception) {}
        localReservation = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCAL_HOTSPOT_REQUEST) return
        val pending = pendingHotspotResult ?: return
        pendingHotspotResult = null
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            startLocalHotspotNow(pending)
        } else {
            pending.error("permission_denied", "Hotspot permission denied", null)
        }
    }

    companion object {
        private const val VPN_REQUEST_CODE = 1001
        private var pendingHotspotResult: MethodChannel.Result? = null
    }
}
