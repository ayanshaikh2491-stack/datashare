import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// In-app relay for local mode. The donor phone hosts this on its local
/// "OpenShare" WiFi (see Task 8b). A zero-internet receiver joins that WiFi
/// and connects here at `ws://<donor-ip>:8080`. Same protocol as server/index.js.
class LocalRelayServer {
  HttpServer? _http;
  final Map<String, WebSocket> _donors = {}; // donorId -> socket
  final Map<WebSocket, String> _idOf = {}; // socket -> donorId
  final Map<String, _Session> _sessions = {}; // sessionId -> session
  int _seq = 0;
  bool _running = false;

  bool get running => _running;
  int get port => _http?.port ?? 0;

  Future<void> start({int port = 8080}) async {
    if (_running) return;
    _http = await HttpServer.bind(InternetAddress.anyIPv4, port);
    _http!.listen(_onHttp);
    _running = true;
    debugPrint('OPENSHARE_LOCAL_RELAY listening :$port');
  }

  Future<void> stop() async {
    _running = false;
    for (final s in _donors.values) {
      try {
        s.close();
      } catch (_) {}
    }
    _donors.clear();
    _idOf.clear();
    for (final s in _sessions.values) {
      try {
        s.donor.close();
      } catch (_) {}
      try {
        s.receiver.close();
      } catch (_) {}
    }
    _sessions.clear();
    try {
      await _http?.close(force: true);
    } catch (_) {}
    _http = null;
    debugPrint('OPENSHARE_LOCAL_RELAY stopped');
  }

  void _onHttp(HttpRequest req) {
    if (WebSocketTransformer.isUpgradeRequest(req)) {
      WebSocketTransformer.upgrade(req).then(_onSocket).catchError((_) {});
      return;
    }
    req.response
      ..statusCode = HttpStatus.ok
      ..headers.contentType = ContentType.json
      ..write('{"ok":true}')
      ..close();
  }

  void _onSocket(WebSocket ws) {
    ws.listen(
      (raw) {
        Map<String, dynamic> msg;
        try {
          msg = jsonDecode(raw as String) as Map<String, dynamic>;
        } catch (_) {
          return;
        }
        _handle(ws, msg);
      },
      onDone: () => _cleanup(ws),
      onError: (_) => _cleanup(ws),
    );
  }

  void _handle(WebSocket ws, Map<String, dynamic> msg) {
    switch (msg['type']) {
      case 'DONOR_REGISTER':
        final id = 'd${DateTime.now().microsecondsSinceEpoch}_${_seq++}';
        _donors[id] = ws;
        _idOf[ws] = id;
        _send(ws, {'type': 'DONOR_REGISTERED', 'donorId': id});
        _broadcastDonors();
        break;
      case 'REQUEST_DONORS':
        _send(ws, {'type': 'DONOR_LIST', 'donors': _donorList()});
        break;
      case 'SELECT_DONOR':
        final target = _donors[msg['donorId']];
        if (target == null || _sessionFor(target) != null) {
          _send(ws, {'type': 'ERROR', 'message': 'Donor unavailable'});
          break;
        }
        // A receiver cannot join a second session while one is active:
        // end any existing session for this socket first (matches server).
        final existing = _sessionFor(ws);
        if (existing != null) _endSession(existing);
        final sid = 's${DateTime.now().microsecondsSinceEpoch}_${_seq++}';
        _sessions[sid] = _Session(sid, ws, target);
        _send(target, {
          'type': 'SESSION_START',
          'sessionId': sid,
          'receiverInfo': msg['receiverInfo'] ?? {},
        });
        _send(ws, {
          'type': 'SESSION_STARTED',
          'sessionId': sid,
          'donorId': msg['donorId'],
        });
        _broadcastDonors();
        break;
      case 'TUNNEL_DATA':
      case 'OPEN_TCP':
      case 'TCP_READY':
      case 'TCP_DATA':
      case 'TCP_CLOSE':
        _route(ws, msg);
        break;
      case 'SESSION_END':
        final s = _sessionFor(ws);
        if (s != null) _endSession(s);
        break;
      default:
        _send(ws, {'type': 'ERROR', 'message': 'Unknown message type'});
    }
  }

  void _route(WebSocket ws, Map<String, dynamic> msg) {
    final s = _sessionFor(ws);
    if (s == null) return;
    final target = ws == s.donor ? s.receiver : s.donor;
    _send(target, msg);
  }

  _Session? _sessionFor(WebSocket ws) {
    for (final s in _sessions.values) {
      if (s.donor == ws || s.receiver == ws) return s;
    }
    return null;
  }

  List<Map<String, dynamic>> _donorList() {
    final list = <Map<String, dynamic>>[];
    for (final e in _donors.entries) {
      if (_sessionFor(e.value) == null) {
        list.add({'id': e.key, 'name': 'OpenShare Donor', 'network': 'Local'});
      }
    }
    return list;
  }

  void _broadcastDonors() {
    final msg = jsonEncode({'type': 'DONOR_LIST', 'donors': _donorList()});
    for (final ws in _donors.values) {
      try {
        ws.add(msg);
      } catch (_) {}
    }
  }

  void _endSession(_Session s) {
    _send(s.receiver, {'type': 'SESSION_END', 'sessionId': s.id});
    _send(s.donor, {'type': 'SESSION_END', 'sessionId': s.id});
    _sessions.remove(s.id);
    _broadcastDonors();
  }

  void _cleanup(WebSocket ws) {
    final id = _idOf.remove(ws);
    if (id != null) {
      _donors.remove(id);
      _broadcastDonors();
    }
    final s = _sessionFor(ws);
    if (s != null) _endSession(s);
  }

  void _send(WebSocket ws, Map<String, dynamic> obj) {
    try {
      ws.add(jsonEncode(obj));
    } catch (_) {}
  }
}

class _Session {
  final String id;
  final WebSocket receiver;
  final WebSocket donor;
  _Session(this.id, this.receiver, this.donor);
}
