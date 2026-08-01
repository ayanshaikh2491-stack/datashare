import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openshare/services/websocket_service.dart';

void main() {
  test('WebSocketService auto-reconnects after connection drop', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final port = server.port;
    var connections = 0;

    server.listen((req) {
      WebSocketTransformer.upgrade(req).then((ws) {
        connections++;
        if (connections == 1) {
          // Drop the first connection shortly after it opens.
          Timer(const Duration(milliseconds: 300), () => ws.close());
        } else {
          ws.listen((_) {});
        }
      });
    });

    final service = WebSocketService();
    final connected = await service.connect('ws://127.0.0.1:$port');
    expect(connected, isTrue);
    expect(service.state, ConnectionState.connected);

    service.enableAutoReconnect();

    // Wait until the service reconnects (2s retry delay + connect).
    final deadline = DateTime.now().add(const Duration(seconds: 8));
    while (connections < 2 && DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 100));
    }

    expect(connections, greaterThanOrEqualTo(2), reason: 'service should reconnect after drop');
    expect(service.state, ConnectionState.connected);

    service.disconnect();
    await server.close(force: true);
  });
}
