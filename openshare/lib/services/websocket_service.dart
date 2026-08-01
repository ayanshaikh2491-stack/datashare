import 'dart:async';
import 'dart:convert';
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

  bool _autoReconnect = false;
  int _gen = 0;
  int _reconnectAttempts = 0;
  String? _lastUrl;
  Timer? _reconnectTimer;

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  ConnectionState get state => _state;
  String? get sessionId => _sessionId;
  String? get donorId => _donorId;
  bool get isDonor => _isDonor;

  WebSocketService();

  void enableAutoReconnect() => _autoReconnect = true;

  void disableAutoReconnect() {
    _autoReconnect = false;
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
  }

  Future<bool> connect(String serverUrl) async {
    if (_state == ConnectionState.connecting ||
        _state == ConnectionState.connected) {
      disconnect();
    }

    _gen++;
    final gen = _gen;
    _state = ConnectionState.connecting;
    _lastUrl = serverUrl;
    _reconnectAttempts = 0;

    _channel = WebSocketChannel.connect(Uri.parse(serverUrl));
    try {
      await _channel!.ready.timeout(const Duration(seconds: 10));
    } catch (e) {
      if (gen == _gen) {
        _state = ConnectionState.disconnected;
        try {
          _channel!.sink.close();
        } catch (_) {}
      }
      return false;
    }

    if (gen != _gen) return true; // superseded by a newer connect/disconnect
    _onChannelReady(gen);
    return true;
  }

  void _onChannelReady(int gen) {
    if (gen != _gen) return;
    _state = ConnectionState.connected;
    if (_reconnectAttempts > 0) {
      _messageController.add({'type': 'RECONNECTED'});
    }

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
        if (gen != _gen) return;
        _state = ConnectionState.disconnected;
        _messageController.add({'type': 'DISCONNECTED'});
        _scheduleReconnect(gen);
      },
      onError: (error) {
        if (gen != _gen) return;
        _state = ConnectionState.disconnected;
        _messageController.add({'type': 'ERROR', 'message': error.toString()});
        _scheduleReconnect(gen);
      },
    );
  }

  void _scheduleReconnect(int gen) {
    if (!_autoReconnect || _lastUrl == null) return;
    _reconnectTimer?.cancel();
    final delay = Duration(seconds: _reconnectAttempts < 3 ? 2 : 10);
    _reconnectAttempts++;
    _reconnectTimer = Timer(delay, () {
      if (!_autoReconnect || gen != _gen) return;
      _state = ConnectionState.connecting;
      _messageController.add({'type': 'RECONNECTING'});
      _channel = WebSocketChannel.connect(Uri.parse(_lastUrl!));
      _channel!.ready.then((_) {
        if (gen != _gen) return;
        _onChannelReady(gen);
      }).catchError((_) {
        if (gen != _gen) return;
        _scheduleReconnect(gen);
      });
    });
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
    _send({'type': 'DONOR_REGISTER', 'metadata': metadata});
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
    _send({'type': 'TUNNEL_DATA', 'data': data, 'sessionId': _sessionId});
  }

  // ---- TCP tunnel (real internet sharing) ----

  void sendTcpOpen(String tcpId, String host, int port) {
    _send({'type': 'OPEN_TCP', 'tcpId': tcpId, 'host': host, 'port': port});
  }

  void sendTcpReady(String tcpId) {
    _send({'type': 'TCP_READY', 'tcpId': tcpId});
  }

  void sendTcpData(String tcpId, List<int> bytes) {
    _send({
      'type': 'TCP_DATA',
      'tcpId': tcpId,
      'data': base64Encode(bytes),
    });
  }

  void sendTcpClose(String tcpId) {
    _send({'type': 'TCP_CLOSE', 'tcpId': tcpId});
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
    _gen++;
    disableAutoReconnect();
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
