import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:openshare/services/local_relay_server.dart';
import 'dart:io';

void main() {
  test('LocalRelayServer runs full donor/receiver flow', () async {
    final relay = LocalRelayServer();
    await relay.start();
    final port = relay.port;
    expect(relay.running, isTrue);

    final donor = await WebSocket.connect('ws://127.0.0.1:$port');
    final donorMsgs = <Map<String, dynamic>>[];
    donor.listen((d) => donorMsgs.add(jsonDecode(d as String) as Map<String, dynamic>));

    donor.add(jsonEncode({'type': 'DONOR_REGISTER', 'metadata': {'name': 'Donor'}}));
    await waitFor(() => donorMsgs.any((m) => m['type'] == 'DONOR_REGISTERED'));
    expect(donorMsgs.any((m) => m['type'] == 'DONOR_REGISTERED'), isTrue);

    final receiver = await WebSocket.connect('ws://127.0.0.1:$port');
    final receiverMsgs = <Map<String, dynamic>>[];
    receiver.listen((d) => receiverMsgs.add(jsonDecode(d as String) as Map<String, dynamic>));

    receiver.add(jsonEncode({'type': 'REQUEST_DONORS'}));
    await waitFor(() => receiverMsgs.any((m) => m['type'] == 'DONOR_LIST'));
    final list = receiverMsgs.firstWhere((m) => m['type'] == 'DONOR_LIST');
    final donorId = (list['donors'] as List).first['id'] as String;

    receiver.add(jsonEncode({'type': 'SELECT_DONOR', 'donorId': donorId}));
    await waitFor(() => donorMsgs.any((m) => m['type'] == 'SESSION_START'));
    expect(donorMsgs.any((m) => m['type'] == 'SESSION_START'), isTrue);

    // Round-trip a tunnel data frame.
    receiver.add(jsonEncode({'type': 'TUNNEL_DATA', 'data': 'ping'}));
    await waitFor(() => donorMsgs.any((m) => m['type'] == 'TUNNEL_DATA'));
    expect(donorMsgs.any((m) => m['type'] == 'TUNNEL_DATA' && m['data'] == 'ping'), isTrue);

    await relay.stop();
    expect(relay.running, isFalse);
  });

  test('LocalRelayServer ends old session when receiver re-selects another donor', () async {
    final relay = LocalRelayServer();
    await relay.start();
    final port = relay.port;

    final donor1 = await WebSocket.connect('ws://127.0.0.1:$port');
    final d1msgs = <Map<String, dynamic>>[];
    donor1.listen((d) => d1msgs.add(jsonDecode(d as String) as Map<String, dynamic>));
    donor1.add(jsonEncode({'type': 'DONOR_REGISTER'}));
    await waitFor(() => d1msgs.any((m) => m['type'] == 'DONOR_REGISTERED'));

    final donor2 = await WebSocket.connect('ws://127.0.0.1:$port');
    final d2msgs = <Map<String, dynamic>>[];
    donor2.listen((d) => d2msgs.add(jsonDecode(d as String) as Map<String, dynamic>));
    donor2.add(jsonEncode({'type': 'DONOR_REGISTER'}));
    await waitFor(() => d2msgs.any((m) => m['type'] == 'DONOR_REGISTERED'));

    final receiver = await WebSocket.connect('ws://127.0.0.1:$port');
    final rmsgs = <Map<String, dynamic>>[];
    receiver.listen((d) => rmsgs.add(jsonDecode(d as String) as Map<String, dynamic>));

    // Fresh donor list: two donors.
    receiver.add(jsonEncode({'type': 'REQUEST_DONORS'}));
    await waitFor(() => rmsgs.any((m) => m['type'] == 'DONOR_LIST' && (m['donors'] as List).length == 2));
    final donorIds = ((rmsgs.lastWhere((m) => m['type'] == 'DONOR_LIST'))['donors'] as List)
        .map((d) => (d as Map)['id'] as String)
        .toList();

    // Join donor1.
    receiver.add(jsonEncode({'type': 'SELECT_DONOR', 'donorId': donorIds[0]}));
    await waitFor(() => d1msgs.any((m) => m['type'] == 'SESSION_START'));
    expect(rmsgs.any((m) => m['type'] == 'SESSION_STARTED'), isTrue);

    // Re-select donor2: old session must end, donor1 must be freed and re-listed.
    receiver.add(jsonEncode({'type': 'SELECT_DONOR', 'donorId': donorIds[1]}));
    await waitFor(() => d1msgs.any((m) => m['type'] == 'SESSION_END'));
    expect(d1msgs.any((m) => m['type'] == 'SESSION_END'), isTrue);
    expect(d2msgs.any((m) => m['type'] == 'SESSION_START'), isTrue);

    // Donor1 is no longer hidden: it appears in the broadcast donor list again.
    await waitFor(() => rmsgs.any((m) =>
        m['type'] == 'DONOR_LIST' &&
        (m['donors'] as List).any((d) => (d as Map)['id'] == donorIds[0])));
    expect(
      rmsgs.any((m) =>
          m['type'] == 'DONOR_LIST' &&
          (m['donors'] as List).any((d) => (d as Map)['id'] == donorIds[0])),
      isTrue,
    );

    await relay.stop();
    expect(relay.running, isFalse);
  });
}

Future<void> waitFor(bool Function() cond, {int timeoutMs = 5000}) async {
  final deadline = DateTime.now().add(Duration(milliseconds: timeoutMs));
  while (!cond() && DateTime.now().isBefore(deadline)) {
    await Future.delayed(const Duration(milliseconds: 50));
  }
  expect(cond(), isTrue);
}
