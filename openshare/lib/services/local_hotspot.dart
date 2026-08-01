import 'package:flutter/services.dart';

class LocalHotspot {
  static const MethodChannel _channel = MethodChannel('com.openshare/local');

  /// Starts an "OpenShare" local-only WiFi network (no internet, no carrier
  /// involvement). Returns {'ssid': ..., 'enabled': true} on success, or
  /// {'permissionRequired': true} when the native side showed the system
  /// permission dialog (Android 13+ NEARBY_WIFI_DEVICES / pre-13
  /// ACCESS_FINE_LOCATION) and the caller should retry once the user answers.
  static Future<Map<String, dynamic>> start() async {
    final r = await _channel.invokeMethod('start');
    if (r is String) {
      return r == 'permission_required' ? const {'permissionRequired': true} : const {};
    }
    return (r as Map?)?.cast<String, dynamic>() ?? const {};
  }

  static Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
