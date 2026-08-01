import 'package:flutter/services.dart';

class LocalHotspot {
  static const MethodChannel _channel = MethodChannel('com.openshare/local');

  /// Starts an "OpenShare" local-only WiFi network (no internet, no carrier
  /// involvement). Returns {'ssid': ..., 'enabled': true}. Throws on failure.
  static Future<Map<String, dynamic>> start() async {
    final r = await _channel.invokeMethod('start');
    return (r as Map?)?.cast<String, dynamic>() ?? const {};
  }

  static Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
