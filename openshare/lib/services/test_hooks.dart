import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Automation hooks used by the cloud E2E test (GitHub Actions).
/// Enabled via intent extras when launching the app:
///   am start ... --ez autoShare true --ez autoBrowse true --es serverUrl ws://...
/// In normal use no extras are present, so this is a no-op.
class TestHooks {
  static bool autoShare = false;
  static bool autoBrowse = false;
  static String? serverUrl;

  static const MethodChannel _channel = MethodChannel('com.openshare/test');

  static Future<void> load() async {
    try {
      final extras = await _channel.invokeMapMethod<String, dynamic>('extras');
      if (extras == null || extras.isEmpty) return;
      autoShare = _truthy(extras['autoShare']);
      autoBrowse = _truthy(extras['autoBrowse']);
      final url = extras['serverUrl'] as String?;
      if (url != null && url.isNotEmpty) serverUrl = url;
      if (autoShare || autoBrowse) {
        debugPrint(
            'OPENSHARE_TEST_HOOKS autoShare=$autoShare autoBrowse=$autoBrowse url=$serverUrl');
      }
    } catch (e) {
      debugPrint('OPENSHARE_TEST_HOOKS load failed: $e');
    }
  }

  static bool _truthy(Object? v) => v == true || v == 'true' || v == 1;
}
