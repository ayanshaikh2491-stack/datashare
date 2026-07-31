import 'dart:async';
import 'package:flutter/services.dart';

class VpnHelper {
  static const _channel = MethodChannel('com.openshare/vpn');

  static final VpnHelper _instance = VpnHelper._();
  factory VpnHelper() => _instance;
  VpnHelper._();

  final StreamController<ByteArray> _packetController =
      StreamController<ByteArray>.broadcast();
  final StreamController<VpnStatus> _statusController =
      StreamController<VpnStatus>.broadcast();

  Stream<ByteArray> get packets => _packetController.stream;
  Stream<VpnStatus> get status => _statusController.stream;

  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    // Set up callbacks from native side
    _channel.setMethodCallHandler((call) async {
      switch (call.method) {
        case 'onPacketCaptured':
          final data = call.arguments as Uint8List?;
          if (data != null) {
            _packetController.add(ByteArray(data));
          }
          break;
        case 'onVpnStatus':
          final args = call.arguments as Map<String, dynamic>?;
          final status = args?['status'] as String?;
          final msg = args?['message'] as String?;
          if (status != null) {
            _statusController.add(VpnStatus(status, msg));
          }
          break;
      }
      return null;
    });
  }

  Future<String?> startVpn() async {
    try {
      final result = await _channel.invokeMethod<String>('startVpn');
      return result;
    } on PlatformException catch (e) {
      return 'error: ${e.message}';
    }
  }

  Future<void> stopVpn() async {
    try {
      await _channel.invokeMethod('stopVpn');
    } on PlatformException {
      // Ignore
    }
  }

  Future<void> writeToTun(Uint8List data) async {
    try {
      await _channel.invokeMethod('writeToTun', {'data': data});
    } on PlatformException {
      // Ignore
    }
  }

  void dispose() {
    _packetController.close();
    _statusController.close();
  }
}

class ByteArray {
  final Uint8List data;
  const ByteArray(this.data);
}

class VpnStatus {
  final String status;
  final String? message;
  const VpnStatus(this.status, this.message);
}
