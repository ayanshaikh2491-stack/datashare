import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'websocket_service.dart';

/// Donor side: opens real TCP sockets to the internet on behalf of the
/// receiver. Bytes flow over the relay as TCP_DATA frames.
class DonorTunnel {
  final WebSocketService ws;
  final Map<String, Socket> _sockets = {};
  final Map<String, List<int>> _pending = {};
  StreamSubscription<Map<String, dynamic>>? _sub;
  bool _running = false;

  DonorTunnel(this.ws);

  void start() {
    if (_running) return;
    _running = true;
    _sub = ws.messages.listen(_onWsMessage);
    debugPrint('OPENSHARE_DONOR_TUNNEL started');
  }

  void _onWsMessage(Map<String, dynamic> msg) {
    final type = msg['type'];
    if (type == 'DISCONNECTED') {
      dispose();
      return;
    }
    final id = msg['tcpId'] as String?;
    if (id == null) return;

    switch (type) {
      case 'OPEN_TCP':
        final host = (msg['host'] as String?) ?? '';
        final port = (msg['port'] as num?)?.toInt() ?? 0;
        _open(id, host, port);
        break;
      case 'TCP_DATA':
        final data = msg['data'] is String
            ? base64Decode(msg['data'] as String)
            : null;
        if (data == null) break;
        final socket = _sockets[id];
        if (socket != null) {
          try {
            socket.add(data);
            socket.flush();
          } catch (_) {}
        } else {
          _pending.putIfAbsent(id, () => []).addAll(data);
        }
        break;
      case 'TCP_CLOSE':
        _sockets.remove(id)?.destroy();
        _pending.remove(id);
        break;
    }
  }

  Future<void> _open(String id, String host, int port) async {
    debugPrint('OPENSHARE_TCP_OPEN id=$id host=$host port=$port');
    try {
      final socket = await Socket.connect(
        host,
        port,
        timeout: const Duration(seconds: 15),
      );
      _sockets[id] = socket;
      ws.sendTcpReady(id);
      debugPrint('OPENSHARE_TCP_READY id=$id host=$host port=$port');

      final pending = _pending.remove(id);
      if (pending != null && pending.isNotEmpty) {
        socket.add(pending);
        socket.flush();
      }

      socket.listen(
        (chunk) {
          try {
            ws.sendTcpData(id, chunk);
          } catch (_) {}
        },
        onDone: () {
          ws.sendTcpClose(id);
          _sockets.remove(id);
        },
        onError: (_) {
          ws.sendTcpClose(id);
          _sockets.remove(id);
        },
        cancelOnError: true,
      );
    } catch (e) {
      debugPrint('OPENSHARE_TCP_FAIL id=$id err=$e');
      ws.sendTcpClose(id);
      _pending.remove(id);
    }
  }

  void dispose() {
    _sub?.cancel();
    for (final s in _sockets.values) {
      try {
        s.destroy();
      } catch (_) {}
    }
    _sockets.clear();
    _pending.clear();
    _running = false;
    debugPrint('OPENSHARE_DONOR_TUNNEL stopped');
  }
}

/// Receiver side: local HTTP(S) proxy that converts every connection into a
/// tunneled TCP stream through the relay, which the donor completes against
/// the real internet. Point apps / curl at 127.0.0.1:[port].
class ReceiverProxy {
  final WebSocketService ws;
  ServerSocket? _server;
  final Map<String, _Tunnel> _tunnels = {};
  StreamSubscription<Map<String, dynamic>>? _sub;
  int _seq = 0;
  bool _running = false;

  ReceiverProxy(this.ws);

  String _newId() =>
      'p${DateTime.now().microsecondsSinceEpoch}_${_seq++}';

  Future<void> start({int port = 8787}) async {
    if (_running) return;
    _running = true;
    _sub = ws.messages.listen(_onWsMessage);
    _server = await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
    debugPrint('OPENSHARE_PROXY_LISTENING port=$port');
    _server!.listen(_onClient, onError: (e) {
      debugPrint('OPENSHARE_PROXY_ERROR $e');
    });
  }

  Future<void> stop() async {
    _running = false;
    _sub?.cancel();
    for (final t in _tunnels.values) {
      try {
        t.client.destroy();
      } catch (_) {}
    }
    _tunnels.clear();
    try {
      await _server?.close();
    } catch (_) {}
    _server = null;
    debugPrint('OPENSHARE_PROXY_STOPPED');
  }

  void _onClient(Socket client) {
    final t = _Tunnel(_newId(), client);
    _tunnels[t.id] = t;
    debugPrint('OPENSHARE_PROXY_CLIENT id=${t.id}');
    client.listen(
      (data) => _onClientData(t, data),
      onDone: () => _closeTunnel(t, notify: true),
      onError: (_) => _closeTunnel(t, notify: true),
      cancelOnError: true,
    );
  }

  void _onClientData(_Tunnel t, List<int> data) {
    if (!t.headParsed) {
      t.buffer.addAll(data);
      final idx = _indexOfHeaderEnd(t.buffer);
      if (idx < 0) {
        if (t.buffer.length > 65536) {
          _closeTunnel(t, notify: true);
        }
        return;
      }
      final headBytes = t.buffer.sublist(0, idx + 4);
      t.buffer.removeRange(0, idx + 4);
      t.headParsed = true;
      _parseHead(t, headBytes);
      return;
    }
    if (!t.ready) {
      t.buffer.addAll(data);
      return;
    }
    try {
      ws.sendTcpData(t.id, data);
      t.tx += data.length;
    } catch (_) {}
  }

  void _parseHead(_Tunnel t, List<int> headBytes) {
    final headText = utf8.decode(headBytes, allowMalformed: true);
    final lines = headText.split('\r\n');
    if (lines.isEmpty) {
      _closeTunnel(t, notify: true);
      return;
    }
    final parts = lines[0].split(' ');
    if (parts.length < 3) {
      _closeTunnel(t, notify: true);
      return;
    }
    final method = parts[0].toUpperCase();
    final target = parts[1];

    String host;
    int port;

    if (method == 'CONNECT') {
      final hp = target.split(':');
      host = hp[0];
      port = int.tryParse(hp.length > 1 ? hp[1] : '443') ?? 443;
      t.isConnect = true;
    } else {
      Uri? uri;
      if (target.startsWith('http://') || target.startsWith('https://')) {
        uri = Uri.parse(target);
      } else {
        String? hostHeader;
        for (final l in lines.skip(1)) {
          final idx = l.indexOf(':');
          if (idx > 0 && l.substring(0, idx).toLowerCase() == 'host') {
            hostHeader = l.substring(idx + 1).trim();
            break;
          }
        }
        if (hostHeader == null) {
          _closeTunnel(t, notify: true);
          return;
        }
        uri = Uri.parse('http://$hostHeader');
      }
      host = uri.host;
      port = uri.hasPort ? uri.port : (uri.scheme == 'https' ? 443 : 80);

      final newPath = uri.hasQuery
          ? '${uri.path.isEmpty ? '/' : uri.path}?${uri.query}'
          : (uri.path.isEmpty ? '/' : uri.path);
      final newHead = [
        '$method $newPath ${parts[2]}',
        ...lines.skip(1),
      ].join('\r\n');
      t.forwardHead = utf8.encode('$newHead\r\n\r\n');
    }

    debugPrint(
        'OPENSHARE_PROXY_TARGET id=${t.id} method=$method host=$host port=$port');
    ws.sendTcpOpen(t.id, host, port);
  }

  void _onWsMessage(Map<String, dynamic> msg) {
    final type = msg['type'];
    if (type == 'DISCONNECTED') {
      stop();
      return;
    }
    final id = msg['tcpId'] as String?;
    if (id == null) return;
    final t = _tunnels[id];
    if (t == null) return;

    switch (type) {
      case 'TCP_READY':
        t.ready = true;
        debugPrint('OPENSHARE_PROXY_READY id=$id');
        if (t.isConnect) {
          try {
            t.client.add(
                utf8.encode('HTTP/1.1 200 Connection Established\r\n\r\n'));
            t.client.flush();
          } catch (_) {}
        }
        if (t.forwardHead != null && t.forwardHead!.isNotEmpty) {
          try {
            ws.sendTcpData(id, t.forwardHead!);
            t.tx += t.forwardHead!.length;
          } catch (_) {}
          t.forwardHead = null;
        }
        if (t.buffer.isNotEmpty) {
          final b = List<int>.from(t.buffer);
          t.buffer = [];
          try {
            ws.sendTcpData(id, b);
            t.tx += b.length;
          } catch (_) {}
        }
        break;
      case 'TCP_DATA':
        final data = msg['data'] is String
            ? base64Decode(msg['data'] as String)
            : null;
        if (data != null) {
          t.rx += data.length;
          try {
            t.client.add(data);
            t.client.flush();
          } catch (_) {}
        }
        break;
      case 'TCP_CLOSE':
        _closeTunnel(t, notify: false);
        break;
    }
  }

  void _closeTunnel(_Tunnel t, {required bool notify}) {
    if (!_tunnels.containsKey(t.id)) return;
    _tunnels.remove(t.id);
    if (notify) {
      try {
        ws.sendTcpClose(t.id);
      } catch (_) {}
    }
    try {
      t.client.destroy();
    } catch (_) {}
    debugPrint(
        'OPENSHARE_PROXY_CLOSED id=${t.id} tx=${t.tx} rx=${t.rx}');
  }
}

class _Tunnel {
  final String id;
  final Socket client;
  bool headParsed = false;
  bool ready = false;
  bool isConnect = false;
  List<int> buffer = [];
  List<int>? forwardHead;
  int tx = 0;
  int rx = 0;

  _Tunnel(this.id, this.client);
}

int _indexOfHeaderEnd(List<int> buf) {
  if (buf.length < 4) return -1;
  for (int i = 0; i <= buf.length - 4; i++) {
    if (buf[i] == 13 &&
        buf[i + 1] == 10 &&
        buf[i + 2] == 13 &&
        buf[i + 3] == 10) {
      return i;
    }
  }
  return -1;
}
