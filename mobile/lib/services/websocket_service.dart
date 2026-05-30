import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class WebSocketService {
  static const String wsUrl = 'wss://datashare-server.onrender.com';
  WebSocketChannel? _channel;
  StreamController<Map<String, dynamic>> _messageController = StreamController.broadcast();
  String? _userId;
  String? _role;
  Timer? _pingTimer;

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  bool get isConnected => _channel != null;

  Future<void> connect(String userId, String role) async {
    _userId = userId;
    _role = role;
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
          _reconnect();
        },
        onDone: () {
          print('WebSocket disconnected');
          _reconnect();
        },
      );

      // Start ping timer
      _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
        _sendPing();
      });

      print('WebSocket connected: $userId ($role)');
    } catch (e) {
      print('WebSocket connection failed: $e');
      _reconnect();
    }
  }

  void _sendPing() {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode({'type': 'ping'}));
    }
  }

  void _reconnect() {
    Future.delayed(const Duration(seconds: 5), () {
      if (_userId != null && _role != null) {
        connect(_userId!, _role!);
      }
    });
  }

  void _disconnect() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _channel?.sink.close();
    _channel = null;
  }

  void disconnect() {
    _disconnect();
    _userId = null;
    _role = null;
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
