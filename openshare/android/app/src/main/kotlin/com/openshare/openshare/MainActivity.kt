package com.openshare.openshare

import android.content.Intent
import android.net.VpnService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.openshare/vpn"

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

    companion object {
        private const val VPN_REQUEST_CODE = 1001
    }
}
