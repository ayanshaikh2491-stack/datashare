import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:web_socket_channel/web_socket_channel.dart';

class WebSocketService {
  static const String wsUrl = 'wss://datashare-server.onrender.com';
  WebSocketChannel? _channel;
  StreamController<Map<String, dynamic>> _messageController = StreamController.broadcast();
  String? _userId;
  String? _role;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _intentionalDisconnect = false;

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  bool get isConnected => _channel != null;

  Future<void> connect(String userId, String role) async {
    _userId = userId;
    _role = role;
    _intentionalDisconnect = false;
    _reconnectAttempt = 0;
    _disconnect();

    try {
      final uri = Uri.parse('$wsUrl?userId=$userId&role=$role');
      _channel = WebSocketChannel.connect(uri);

      _channel!.stream.listen(
        (data) {
          try {
            final message = jsonDecode(data as String) as Map<String, dynamic>;
            _messageController.add(message);
          } catch (e) {
            print('WebSocket parse error: $e');
          }
        },
        onError: (error) {
          print('WebSocket error: $error');
          _scheduleReconnect();
        },
        onDone: () {
          print('WebSocket disconnected');
          _scheduleReconnect();
        },
        cancelOnError: true,
      );

      // Start ping timer
      _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
        _sendPing();
      });

      _reconnectAttempt = 0;
      print('WebSocket connected: $userId ($role)');
    } catch (e) {
      print('WebSocket connection failed: $e');
      _scheduleReconnect();
    }
  }

  void _sendPing() {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode({'type': 'ping'}));
    }
  }

  /// Capped exponential backoff with jitter (2s → 60s).
  /// Render free-tier cold-starts can take 30-60s; the previous fixed
  /// 5s retry made the app feel like it "exited" on every cold start.
  void _scheduleReconnect() {
    if (_intentionalDisconnect) return;
    if (_userId == null || _role == null) return;
    if (_reconnectTimer != null) return;

    _reconnectAttempt = min(_reconnectAttempt + 1, 6);
    final baseMs = min(60000, 2000 * pow(2, _reconnectAttempt - 1).toInt());
    final jitterMs = Random().nextInt(1000);
    final delay = Duration(milliseconds: baseMs + jitterMs);
    print('WebSocket reconnect in ${delay.inSeconds}s (attempt $_reconnectAttempt)');

    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      if (_userId != null && _role != null && !_intentionalDisconnect) {
        connect(_userId!, _role!);
      }
    });
  }

  void _disconnect() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _channel?.sink.close();
    _channel = null;
  }

  void disconnect() {
    _intentionalDisconnect = true;
    _disconnect();
    _userId = null;
    _role = null;
    _reconnectAttempt = 0;
  }

  void sendMessage(Map<String, dynamic> message) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(message));
    }
  }

  void dispose() {
    _messageController.close();
    disconnect();
  }
}
