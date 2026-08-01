import 'package:flutter/services.dart';

class LocalHotspot {
  static const MethodChannel _channel = MethodChannel('com.openshare/local');

  /// Starts an "OpenShare" local-only WiFi network (no internet, no carrier
  /// involvement). Returns {'ssid': ..., 'enabled': true} on success.
  ///
  /// The native side keeps this call pending while it shows the system runtime
  /// permission dialog (NEARBY_WIFI_DEVICES on Android 13+, ACCESS_FINE_LOCATION
  /// before), then either starts the hotspot or throws a PlatformException with
  /// code 'permission_denied' / 'hotspot_failed'.
  static Future<Map<String, dynamic>> start() async {
    final r = await _channel.invokeMethod('start');
    return (r as Map?)?.cast<String, dynamic>() ?? const {};
  }

  static Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
