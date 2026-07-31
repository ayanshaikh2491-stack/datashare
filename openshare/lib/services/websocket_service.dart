import 'dart:convert';
import 'dart:async';
import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionState { disconnected, connecting, connected }

class WebSocketService {
  WebSocketChannel? _channel;
  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();

  ConnectionState _state = ConnectionState.disconnected;
  String? _sessionId;
  String? _donorId;
  bool _isDonor = false;

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  ConnectionState get state => _state;
  String? get sessionId => _sessionId;
  String? get donorId => _donorId;
  bool get isDonor => _isDonor;

  static final WebSocketService _instance = WebSocketService._();
  factory WebSocketService() => _instance;
  WebSocketService._();

  Future<bool> connect(String serverUrl) async {
    if (_state == ConnectionState.connecting ||
        _state == ConnectionState.connected) {
      disconnect();
    }

    _state = ConnectionState.connecting;

    try {
      final uri = Uri.parse(serverUrl);
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;

      _state = ConnectionState.connected;

      _channel!.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message as String) as Map<String, dynamic>;
            _handleMessage(data);
          } catch (e) {
            // Ignore malformed messages
          }
        },
        onDone: () {
          _state = ConnectionState.disconnected;
          _messageController
              .add({'type': 'DISCONNECTED'});
        },
        onError: (error) {
          _state = ConnectionState.disconnected;
          _messageController
              .add({'type': 'ERROR', 'message': error.toString()});
        },
      );

      return true;
    } catch (e) {
      _state = ConnectionState.disconnected;
      return false;
    }
  }

  void _handleMessage(Map<String, dynamic> data) {
    final type = data['type'] as String?;

    switch (type) {
      case 'DONOR_REGISTERED':
        _donorId = data['donorId'] as String?;
        break;
      case 'SESSION_STARTED':
        _sessionId = data['sessionId'] as String?;
        break;
      case 'SESSION_START':
        _sessionId = data['sessionId'] as String?;
        break;
      case 'SESSION_END':
        _sessionId = null;
        break;
    }

    _messageController.add(data);
  }

  void registerAsDonor(Map<String, dynamic> metadata) {
    _isDonor = true;
    _send({
      'type': 'DONOR_REGISTER',
      'metadata': metadata,
    });
  }

  void requestDonors() {
    _isDonor = false;
    _send({'type': 'REQUEST_DONORS'});
  }

  void selectDonor(String donorId, {Map<String, dynamic>? receiverInfo}) {
    _send({
      'type': 'SELECT_DONOR',
      'donorId': donorId,
      'receiverInfo': receiverInfo ?? {},
    });
  }

  void sendTunnelData(String data) {
    _send({
      'type': 'TUNNEL_DATA',
      'data': data,
      'sessionId': _sessionId,
    });
  }

  void endSession() {
    _send({'type': 'SESSION_END', 'sessionId': _sessionId});
    _sessionId = null;
  }

  void _send(Map<String, dynamic> data) {
    if (_channel != null && _state == ConnectionState.connected) {
      _channel!.sink.add(jsonEncode(data));
    }
  }

  void disconnect() {
    try {
      _channel?.sink.close();
    } catch (_) {}
    _state = ConnectionState.disconnected;
    _sessionId = null;
    _donorId = null;
    _isDonor = false;
  }

  void dispose() {
    disconnect();
    _messageController.close();
  }
}
