# OpenShare Relay v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenShare relay server never error (24/7 via keep-alive pinger, heartbeat cleanup, logging), add app auto-reconnect, and add a local relay mode so a zero-internet receiver can use a nearby donor's mobile data.

**Architecture:** Harden the existing Node.js `ws` relay (`server/index.js`) with a health endpoint + heartbeat + stale cleanup + timestamped logging. Add a GitHub Actions scheduled workflow that pings the HF space every 5 minutes so it never sleeps. In the Flutter app, add auto-reconnect to `WebSocketService` and simplify Share/Browse screens to a direct Start/Stop flow. Add a Dart in-app relay server (`LocalRelayServer`) plus a Kotlin `LocalOnlyHotspot` bridge so the donor hosts a private "OpenShare" WiFi network; a zero-internet receiver joins it and tunnels through the donor's phone (no cloud needed).

**Tech Stack:** Node.js 20 + `ws`, Flutter 3.27.4 + Dart, `web_socket_channel`, GitHub Actions (ubuntu-latest), Hugging Face Spaces (docker, node:20-slim).

## Global Constraints

- Keep `flutter analyze` clean (0 issues) and `flutter test` passing on every app task.
- Relay message protocol stays unchanged: `DONOR_REGISTER`, `DONOR_REGISTERED`, `REQUEST_DONORS`, `DONOR_LIST`, `SELECT_DONOR`, `SESSION_START`, `SESSION_STARTED`, `TUNNEL_DATA`, `OPEN_TCP`, `TCP_READY`, `TCP_DATA`, `TCP_CLOSE`, `SESSION_END`, `ERROR`, `DISCONNECTED`.
- Default relay URL stays `wss://ayanshaikh2-datashare-relay.hf.space`.
- Keep code simple; no new npm packages, no new pub packages (use `dart:io` + existing deps only).
- Every CI run must upload `internet-proof.log` (internet sharing proof) and `relay-test.log` (server tests) as artifacts.
- Windows dev shell is `cmd.exe`; write PowerShell/`.cmd` scripts instead of inline quoting.

---

### Task 1: Write the relay server test (health + heartbeat + cleanup + session)

**Files:**
- Create: `server/relay_test.js`

**Interfaces:**
- Produces: runnable via `node server/relay_test.js`. It spawns `server/index.js` with `PORT`, `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS` env vars, so the server must read those (Task 2). Exits 0 only if all assertions pass.

- [ ] **Step 1: Write the failing test**

```js
// Relay server test: health endpoint, heartbeat, stale cleanup, session flow.
// Run: node server/relay_test.js
const { spawn } = require('child_process');

const PORT = 8090;
const HEARTBEAT_MS = 400;
const HB_TIMEOUT_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, label) {
  if (cond) { console.log('PASS:', label); }
  else { console.error('FAIL:', label); process.exitCode = 1; }
}

function connect() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], waits: [] };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const w = c.waits.find(x => x.type === m.type);
    if (w) { c.waits = c.waits.filter(x => x !== w); w.done(m); }
    else c.msgs.push(m);
  };
  c.send = o => ws.send(JSON.stringify(o));
  c.wait = type => new Promise(done => {
    const i = c.msgs.findIndex(m => m.type === type);
    if (i >= 0) done(c.msgs.splice(i, 1)[0]);
    else c.waits.push({ type, done });
  });
  return new Promise(res => { ws.onopen = () => res(c); });
}

async function main() {
  const relay = spawn('node', ['index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HEARTBEAT_INTERVAL_MS: String(HEARTBEAT_MS),
      HEARTBEAT_TIMEOUT_MS: String(HB_TIMEOUT_MS),
    },
  });
  relay.stdout.on('data', d => process.stdout.write('[relay] ' + d));
  await sleep(800);

  // 1. Health endpoint (for keep-alive pinger)
  const health = await fetch(`http://localhost:${PORT}/`);
  assert(health.status === 200, 'GET / returns 200 (pinger health endpoint)');

  // 2. Session flow: donor registers, receiver joins
  const donor = await connect();
  donor.send({ type: 'DONOR_REGISTER', metadata: { name: 'Donor' } });
  await donor.wait('DONOR_REGISTERED');
  const receiver = await connect();
  receiver.send({ type: 'REQUEST_DONORS' });
  const list = await receiver.wait('DONOR_LIST');
  assert(list.donors.length === 1, 'donor appears in DONOR_LIST');
  receiver.send({ type: 'SELECT_DONOR', donorId: list.donors[0].id });
  await Promise.all([donor.wait('SESSION_START'), receiver.wait('SESSION_STARTED')]);
  assert(true, 'session starts between donor and receiver');

  // 3. Heartbeat keeps a healthy donor alive across several intervals
  await sleep(HEARTBEAT_MS * 5);
  receiver.send({ type: 'REQUEST_DONORS' });
  const list2 = await receiver.wait('DONOR_LIST');
  assert(list2.donors.length === 1, 'healthy donor survives heartbeat intervals');

  // 4. Abrupt disconnect is cleaned up (donor list empty, session ended)
  const deadWs = donor.ws;
  deadWs.terminate();
  await sleep(600);
  receiver.send({ type: 'REQUEST_DONORS' });
  const list3 = await receiver.wait('DONOR_LIST');
  assert(list3.donors.length === 0, 'dead donor removed after disconnect');
  await receiver.wait('SESSION_END');
  assert(true, 'receiver notified SESSION_END after donor vanished');

  donor.ws.close();
  receiver.ws.close();
  relay.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/relay_test.js`
Expected: FAIL on "GET / returns 200" (current server returns 404/426 on plain GET) and possibly others.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/relay_test.js
git commit -m "test: relay server health, heartbeat, cleanup, session"
```

---

### Task 2: Harden the relay server

**Files:**
- Modify: `server/index.js` (full replacement)

**Interfaces:**
- Consumes: `PORT`, `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS` env vars (defaults 8080 / 30000 / 15000).
- Produces: HTTP `GET /` and `/health` → 200 `{"ok":true,...}`; WebSocket server on same port speaking the unchanged protocol; timestamped `[ISO]` logs for every connect/disconnect/session; heartbeat that terminates silent clients.

- [ ] **Step 1: Replace `server/index.js` with the hardened version**

```js
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.PORT || 8080);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS || 15000);

// Plain HTTP server on the same port: health endpoint for the keep-alive pinger.
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'openshare-relay',
      time: new Date().toISOString(),
    }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server: httpServer });

// donorId -> { socket, metadata, sessionId }
const donors = new Map();
// sessionId -> { donorId, receiverSocket, donorSocket }
const sessions = new Map();

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function donorList() {
  const list = [];
  for (const [id, donor] of donors) {
    if (!donor.sessionId) list.push({ id, ...donor.metadata });
  }
  return list;
}

function broadcastDonorList() {
  const msg = JSON.stringify({ type: 'DONOR_LIST', donors: donorList() });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (e) {}
    }
  }
}

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  let role = null;          // 'donor' | 'receiver'
  let donorId = null;
  let currentSession = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const heartbeat = setInterval(() => {
    if (ws.isAlive === false) {
      log('heartbeat timeout, terminating client', clientId);
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      return send(ws, { type: 'ERROR', message: 'Invalid JSON' });
    }

    switch (msg.type) {

      case 'DONOR_REGISTER': {
        role = 'donor';
        donorId = clientId;
        donors.set(donorId, {
          socket: ws,
          metadata: msg.metadata || { name: 'Donor', network: 'unknown' },
          sessionId: null,
        });
        send(ws, { type: 'DONOR_REGISTERED', donorId });
        broadcastDonorList();
        log('donor registered', donorId);
        break;
      }

      case 'DONOR_HEARTBEAT': {
        // app-level keepalive; socket ping already handled above
        break;
      }

      case 'REQUEST_DONORS': {
        role = 'receiver';
        send(ws, { type: 'DONOR_LIST', donors: donorList() });
        break;
      }

      case 'SELECT_DONOR': {
        const targetId = msg.donorId;
        const donor = donors.get(targetId);
        if (!donor) return send(ws, { type: 'ERROR', message: 'Donor not found' });
        if (donor.sessionId) return send(ws, { type: 'ERROR', message: 'Donor busy' });

        const sessionId = uuidv4();
        currentSession = sessionId;
        donor.sessionId = sessionId;
        sessions.set(sessionId, {
          donorId: targetId,
          receiverSocket: ws,
          donorSocket: donor.socket,
        });

        send(donor.socket, {
          type: 'SESSION_START',
          sessionId,
          receiverInfo: msg.receiverInfo || {},
        });
        send(ws, { type: 'SESSION_STARTED', sessionId, donorId: targetId });
        broadcastDonorList();
        log('session started', sessionId, 'receiver=' + clientId, 'donor=' + targetId);
        break;
      }

      case 'TUNNEL_DATA': {
        const found = findSessionBySocket(ws);
        if (!found) return;
        currentSession = found.sessionId;
        const session = sessions.get(currentSession);
        if (!session) return;
        const target = ws === session.donorSocket ? session.receiverSocket : session.donorSocket;
        send(target, { type: 'TUNNEL_DATA', data: msg.data, sessionId: currentSession });
        break;
      }

      case 'OPEN_TCP':
      case 'TCP_READY':
      case 'TCP_DATA':
      case 'TCP_CLOSE': {
        const found = findSessionBySocket(ws);
        if (!found) return;
        currentSession = found.sessionId;
        const session = sessions.get(currentSession);
        if (!session) return;
        const target = ws === session.donorSocket ? session.receiverSocket : session.donorSocket;
        send(target, msg);
        break;
      }

      case 'SESSION_END': {
        if (currentSession) endSession(currentSession);
        break;
      }

      default:
        send(ws, { type: 'ERROR', message: 'Unknown message type' });
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    log('client disconnected', clientId);
    if (donorId && donors.has(donorId)) {
      donors.delete(donorId);
      broadcastDonorList();
    }
    if (currentSession) endSession(currentSession);
  });

  ws.on('error', () => {});
});

// Safety net: drop any donor whose socket died without a close event.
setInterval(() => {
  let changed = false;
  for (const [id, donor] of donors) {
    if (donor.socket.readyState !== 1) { donors.delete(id); changed = true; }
  }
  if (changed) broadcastDonorList();
}, 15000);

function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  send(session.receiverSocket, { type: 'SESSION_END', sessionId });
  send(session.donorSocket, { type: 'SESSION_END', sessionId });
  const donor = donors.get(session.donorId);
  if (donor) donor.sessionId = null;
  sessions.delete(sessionId);
  broadcastDonorList();
  log('session ended', sessionId);
}

function findSessionBySocket(ws) {
  for (const [sid, s] of sessions) {
    if (s.donorSocket === ws || s.receiverSocket === ws) return { sessionId: sid, session: s };
  }
  return null;
}

httpServer.listen(PORT, () => log('OpenShare Server running on port', PORT));
```

- [ ] **Step 2: Run the relay test to verify it passes**

Run: `node server/relay_test.js`
Expected: all 6 assertions PASS, exit 0.

- [ ] **Step 3: Run the existing internet-sharing proof (still works)**

Run: `node server/real_internet_share_test.js`
Expected: prints `INTERNET_SHARING=WORKING`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(server): health endpoint, heartbeat, stale cleanup, logging"
```

---

### Task 3: Keep-alive pinger (24/7, no sleep)

**Files:**
- Create: `server/keepalive.js`
- Create: `.github/workflows/keepalive.yml`

**Interfaces:**
- Produces: `node server/keepalive.js` pings the relay health endpoint once and exits 0 on 200; a GitHub Actions scheduled workflow runs it every 5 minutes.

- [ ] **Step 1: Write the one-shot pinger script**

```js
// One-shot keep-alive ping. Called by cron/CI every 5 minutes.
// Usage: node server/keepalive.js  (RELAY_URL env overrides target)
const TARGET = process.env.RELAY_URL || 'https://ayanshaikh2-datashare-relay.hf.space/';
fetch(TARGET).then(r => {
  console.log(`[${new Date().toISOString()}] relay ping -> ${r.status}`);
  process.exit(r.status === 200 ? 0 : 1);
}).catch(e => {
  console.error(`[${new Date().toISOString()}] ping error: ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify**

Run: `node server/keepalive.js`
Expected: `relay ping -> 200`, exit 0.

- [ ] **Step 3: Write the scheduled workflow**

```yaml
name: Relay keep-alive

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Ping relay health endpoint
        run: |
          code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 https://ayanshaikh2-datashare-relay.hf.space/)
          echo "relay_health=$code"
          test "$code" = "200"
```

- [ ] **Step 4: Commit**

```bash
git add server/keepalive.js .github/workflows/keepalive.yml
git commit -m "ci: keep-alive pinger every 5 min (relay never sleeps)"
```

---

### Task 4: CI build pipeline runs server tests + proof + APK

**Files:**
- Modify: `.github/workflows/internet-proof.yml`

**Interfaces:**
- Consumes: `server/relay_test.js` (Task 1) and `server/real_internet_share_test.js`.
- Produces: uploaded artifacts `relay-test.log`, `internet-proof.log`, `openshare-debug-apk` (arm64).

- [ ] **Step 1: Update the workflow to run both tests and upload both logs**

Change the "Real internet sharing test" step and upload steps in `.github/workflows/internet-proof.yml` to:

```yaml
      - name: Install server deps
        run: |
          cd server
          npm install --omit=dev >/dev/null 2>&1 || true

      - name: Relay server tests (health, heartbeat, cleanup)
        run: |
          cd server
          node relay_test.js 2>&1 | tee /tmp/relay-test.log

      - name: Real internet sharing test (donor tunnel)
        run: |
          cd server
          node real_internet_share_test.js 2>&1 | tee /tmp/internet_proof.log

      - name: Build arm64 debug APK (small)
        run: |
          cd openshare
          flutter pub get
          flutter build apk --debug --target-platform android-arm64 --split-per-abi

      - name: Upload relay test log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: relay-test-log
          path: /tmp/relay-test.log

      - name: Upload proof log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: internet-proof-log
          path: /tmp/internet_proof.log

      - name: Upload arm64 debug APK
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: openshare-debug-apk
          path: openshare/build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk
```

- [ ] **Step 2: Commit and push; confirm CI is green**

```bash
git add .github/workflows/internet-proof.yml
git commit -m "ci: run relay server tests + proof, upload both logs"
git push origin main
```

Expected: GitHub Actions run completes with `relay-test.log` (all PASS) and `internet-proof.log` (`INTERNET_SHARING=WORKING`), plus arm64 APK artifact.

---

### Task 5: App auto-reconnect in WebSocketService

**Files:**
- Modify: `openshare/lib/services/websocket_service.dart`
- Test: `openshare/test/websocket_service_test.dart`

**Interfaces:**
- Consumes: none new.
- Produces: `WebSocketService.enableAutoReconnect()`, `disableAutoReconnect()`, new message types `RECONNECTING` and `RECONNECTED`, and a 10s connect timeout. `connect()` returns `false` quickly on failure.

- [ ] **Step 1: Write the failing test**

```dart
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/websocket_service_test.dart`
Expected: FAIL (`connections` stays 1 because current service never reconnects).

- [ ] **Step 3: Implement auto-reconnect in the service**

Replace `openshare/lib/services/websocket_service.dart` with:

```dart
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `flutter test test/websocket_service_test.dart`
Expected: PASS (2 connections, state connected).

- [ ] **Step 5: Verify analyze + full test suite**

Run: `flutter analyze && flutter test`
Expected: No issues; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add openshare/lib/services/websocket_service.dart openshare/test/websocket_service_test.dart
git commit -m "feat(app): WebSocketService auto-reconnect with retry + timeout"
```

---

### Task 6: ShareScreen direct Start/Stop (no URL typing, cold-start retry)

**Files:**
- Modify: `openshare/lib/screens/share_screen.dart`

**Interfaces:**
- Consumes: `WebSocketService.enableAutoReconnect()`, `disableAutoReconnect()` (Task 5).
- Produces: Start button connects to default URL directly (TestHooks.serverUrl still overrides for CI), up to 3 initial attempts for cold start, Stop fully disconnects.

- [ ] **Step 1: Update ShareScreen**

In `_ShareScreenState`:
- Remove the `_serverUrlController` `TextField` widget from the UI (lines with `TextField` in `build`).
- Keep the controller but default from `TestHooks.serverUrl`, used only for the connect call:

```dart
final _serverUrlController = TextEditingController(
  text: TestHooks.serverUrl ?? 'wss://ayanshaikh2-datashare-relay.hf.space',
);
```

- Replace `_startSharing` connect block with cold-start retry + auto-reconnect:

```dart
  Future<void> _startSharing() async {
    final url = _serverUrlController.text.trim();
    if (url.isEmpty) return;

    setState(() => _isSharing = true);

    // Cold-start retry: a fresh HF space may need a few seconds to wake.
    var connected = false;
    for (var attempt = 0; attempt < 3 && mounted && !connected; attempt++) {
      connected = await ws.connect(url);
      if (!connected && mounted) {
        await Future.delayed(const Duration(seconds: 2));
      }
    }

    if (!connected && mounted) {
      setState(() => _isSharing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to connect to server. Check your internet and try again.')),
      );
      return;
    }

    ws.enableAutoReconnect();
    ws.registerAsDonor({
      'name': 'OpenShare Donor',
      'network': 'Mobile Data',
      'device': 'Android',
    });

    _tunnel = DonorTunnel(ws)..start();
    _sub = ws.messages.listen((msg) {
      if (!mounted) return;
      switch (msg['type']) {
        case 'DONOR_REGISTERED':
          setState(() => _isConnected = true);
          break;
        case 'RECONNECTING':
          setState(() => _isConnected = false);
          break;
        case 'RECONNECTED':
          setState(() => _isConnected = true);
          break;
        case 'SESSION_START':
          setState(() => _connectedReceiver = 'Receiver connected');
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('🔗 A receiver connected to you!'),
              backgroundColor: Colors.green,
            ),
          );
          break;
        case 'SESSION_END':
          setState(() => _connectedReceiver = null);
          break;
        case 'DISCONNECTED':
          setState(() {
            _isConnected = false;
            _isSharing = false;
            _connectedReceiver = null;
          });
          break;
      }
    });
  }
```

- Update `_stopSharing` to disable auto-reconnect before disconnecting:

```dart
  void _stopSharing() {
    _sub?.cancel();
    _tunnel?.dispose();
    _tunnel = null;
    ws.disableAutoReconnect();
    ws.disconnect();
    setState(() {
      _isSharing = false;
      _isConnected = false;
      _connectedReceiver = null;
    });
  }
```

- In `build`, when `!_isSharing`, remove the `TextField` block and show a helper text instead:

```dart
            if (!_isSharing) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E2E),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Text(
                  'Tap Start to share your mobile internet.\n'
                  'No server URL needed - connects automatically.',
                  style: TextStyle(color: Colors.white70, fontSize: 15),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 24),
            ],
```

- [ ] **Step 2: Verify**

Run: `flutter analyze`
Expected: No issues.

- [ ] **Step 3: Commit**

```bash
git add openshare/lib/screens/share_screen.dart
git commit -m "feat(app): direct Start/Stop with cold-start retry + auto-reconnect"
```

---

### Task 7: BrowseScreen direct connect + reconnect rescan

**Files:**
- Modify: `openshare/lib/screens/browse_screen.dart`

**Interfaces:**
- Consumes: `WebSocketService.enableAutoReconnect()` (Task 5).
- Produces: "Connect" button uses default URL (TestHooks override), auto-reconnect, and re-requests the donor list after a reconnect.

- [ ] **Step 1: Update BrowseScreen**

In `_BrowseScreenState`:
- Default the URL from TestHooks, same as ShareScreen:

```dart
  final _serverUrlController = TextEditingController(
    text: TestHooks.serverUrl ?? 'wss://ayanshaikh2-datashare-relay.hf.space',
  );
```

- Replace `_connectToServer` with cold-start retry + auto-reconnect:

```dart
  Future<void> _connectToServer() async {
    final url = _serverUrlController.text.trim();
    if (url.isEmpty) return;

    setState(() => _isScanning = true);

    var connected = false;
    for (var attempt = 0; attempt < 3 && mounted && !connected; attempt++) {
      connected = await ws.connect(url);
      if (!connected && mounted) {
        await Future.delayed(const Duration(seconds: 2));
      }
    }

    if (!connected && mounted) {
      setState(() => _isScanning = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to connect to server. Check your internet and try again.')),
      );
      return;
    }

    ws.enableAutoReconnect();
    setState(() => _isConnected = true);
    ws.requestDonors();
  }
```

- Add `RECONNECTING` and `RECONNECTED` handling in `_handleMessage`:

```dart
      case 'RECONNECTING':
        setState(() {
          _isConnected = false;
          _isScanning = true;
        });
        break;
      case 'RECONNECTED':
        setState(() => _isConnected = true);
        ws.requestDonors();
        break;
```

- In `build`, when `!_isConnected`, replace the `TextField` block with the same helper text as Task 6, keeping the Connect button:

```dart
            if (!_isConnected) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E2E),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Text(
                  'Connect to find donors sharing their internet.\n'
                  'No server URL needed - connects automatically.',
                  style: TextStyle(color: Colors.white70, fontSize: 15),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _connectToServer,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6C63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text('Connect', style: TextStyle(fontSize: 17)),
                ),
              ),
            ],
```

- [ ] **Step 2: Verify**

Run: `flutter analyze`
Expected: No issues.

- [ ] **Step 3: Commit**

```bash
git add openshare/lib/screens/browse_screen.dart
git commit -m "feat(app): BrowseScreen direct connect with auto-reconnect rescan"
```

---

### Task 8: Local relay mode (zero-internet receiver)

Split into 8a (Dart in-app relay server, CI-testable) and 8b (Kotlin hotspot + wiring, build-verified, manual device test).

#### Task 8a: In-app relay server (`LocalRelayServer`)

**Files:**
- Create: `openshare/lib/services/local_relay_server.dart`
- Test: `openshare/test/local_relay_server_test.dart`

**Interfaces:**
- Produces: `LocalRelayServer.start({port})`, `stop()`, `running`, `port`. Speaks the same relay protocol over `ws://<ip>:8080` so the receiver app (BrowseScreen) can connect to the donor phone directly.

- [ ] **Step 1: Write the failing test**

```dart
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openshare/services/local_relay_server.dart';

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
}

Future<void> waitFor(bool Function() cond, {int timeoutMs = 5000}) async {
  final deadline = DateTime.now().add(Duration(milliseconds: timeoutMs));
  while (!cond() && DateTime.now().isBefore(deadline)) {
    await Future.delayed(const Duration(milliseconds: 50));
  }
  expect(cond(), isTrue);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/local_relay_server_test.dart`
Expected: FAIL (no such file/class yet).

- [ ] **Step 3: Implement LocalRelayServer**

Create `openshare/lib/services/local_relay_server.dart`:

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// In-app relay for local mode. The donor phone hosts this on its local
/// "OpenShare" WiFi (see Task 8b). A zero-internet receiver joins that WiFi
/// and connects here at ws://<donor-ip>:8080. Same protocol as server/index.js.
class LocalRelayServer {
  HttpServer? _http;
  final Map<String, WebSocket> _donors = {}; // donorId -> socket
  final Map<WebSocket, String> _idOf = {};   // socket -> donorId
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
      try { s.close(); } catch (_) {}
    }
    _donors.clear();
    _idOf.clear();
    for (final s in _sessions.values) {
      try { s.donor.close(); } catch (_) {}
      try { s.receiver.close(); } catch (_) {}
    }
    _sessions.clear();
    try { await _http?.close(force: true); } catch (_) {}
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
        final sid = 's${DateTime.now().microsecondsSinceEpoch}_${_seq++}';
        _sessions[sid] = _Session(sid, ws, target);
        _send(target, {
          'type': 'SESSION_START',
          'sessionId': sid,
          'receiverInfo': msg['receiverInfo'] ?? {},
        });
        _send(ws, {'type': 'SESSION_STARTED', 'sessionId': sid, 'donorId': msg['donorId']});
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
      try { ws.add(msg); } catch (_) {}
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
    try { ws.add(jsonEncode(obj)); } catch (_) {}
  }
}

class _Session {
  final String id;
  final WebSocket receiver;
  final WebSocket donor;
  _Session(this.id, this.receiver, this.donor);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `flutter test test/local_relay_server_test.dart`
Expected: PASS.

- [ ] **Step 5: Verify analyze**

Run: `flutter analyze`
Expected: No issues.

- [ ] **Step 6: Commit**

```bash
git add openshare/lib/services/local_relay_server.dart openshare/test/local_relay_server_test.dart
git commit -m "feat(app): in-app local relay server for zero-internet mode"
```

#### Task 8b: Donor local hotspot (Kotlin) + receiver local connect

**Files:**
- Modify: `openshare/android/app/src/main/AndroidManifest.xml`
- Modify: `openshare/android/app/src/main/kotlin/com/openshare/openshare/MainActivity.kt`
- Create: `openshare/lib/services/local_hotspot.dart`
- Modify: `openshare/lib/screens/share_screen.dart`
- Modify: `openshare/lib/screens/browse_screen.dart`

**Interfaces:**
- Consumes: `LocalRelayServer` (Task 8a).
- Produces: `LocalHotspot.start()` → `{'ssid': ..., 'enabled': true}` or throws; `LocalHotspot.stop()`. ShareScreen starts/stops relay+hotspot with Start/Stop. BrowseScreen gains a "Connect Local (no internet)" button that tries common local relay gateways.

- [ ] **Step 1: Add permissions to AndroidManifest.xml**

Inside `<manifest>` (after existing uses-permissions):

```xml
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
    <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />
```

- [ ] **Step 2: Add the Kotlin hotspot bridge to MainActivity.kt**

Add imports and members:

```kotlin
import android.Manifest
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
```

Add inside `class MainActivity`:

```kotlin
    private val LOCAL_CHANNEL = "com.openshare/local"
    private var localReservation: WifiManager.LocalOnlyHotspotReservation? = null
    private val LOCAL_HOTSPOT_REQUEST = 1002
```

Register the channel in `configureFlutterEngine` (next to the existing VPN channel):

```kotlin
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LOCAL_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> startLocalHotspot(result)
                "stop" -> { stopLocalHotspot(); result.success(true) }
                else -> result.notImplemented()
            }
        }
```

Add the helper methods (inside the class, after `startVpnService`):

```kotlin
    private fun startLocalHotspot(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.error("unsupported", "Local hotspot needs Android 8+", null)
            return
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), LOCAL_HOTSPOT_REQUEST)
            result.success("permission_required")
            return
        }
        val wm = getSystemService(WIFI_SERVICE) as WifiManager
        wm.startLocalOnlyHotspot(null, object : WifiManager.LocalOnlyHotspotCallback() {
            override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
                localReservation = reservation
                val ssid = reservation.wifiConfiguration?.SSID?.removeSurrounding("\"") ?: "OpenShare"
                result.success(mapOf("ssid" to ssid, "enabled" to true))
            }

            override fun onFailed(reason: Int) {
                result.error("hotspot_failed", "Hotspot failed (code $reason)", null)
            }

            override fun onStopped() {
                localReservation = null
            }
        }, null)
    }

    private fun stopLocalHotspot() {
        try { localReservation?.close() } catch (_: Exception) {}
        localReservation = null
    }
```

Add the permission result override:

```kotlin
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Dart re-invokes start after permission is granted; nothing else needed here.
    }
```

- [ ] **Step 3: Create `openshare/lib/services/local_hotspot.dart`**

```dart
import 'package:flutter/services.dart';

class LocalHotspot {
  static const MethodChannel _channel = MethodChannel('com.openshare/local');

  /// Starts an "OpenShare" local-only WiFi network (no internet, no carrier
  /// involvement). Returns {'ssid': ..., 'enabled': true}. Throws on failure.
  static Future<Map<String, dynamic>> start() async {
    final r = await _channel.invokeMethod('start');
    return (r as Map?)?.cast<String, dynamic>() ?? const {};
  }

  static Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
```

- [ ] **Step 4: Wire into ShareScreen**

In `_ShareScreenState`, add imports and fields:

```dart
import '../services/local_hotspot.dart';
import '../services/local_relay_server.dart';
```

```dart
  LocalRelayServer? _localRelay;
  bool _localReady = false;
```

In `_startSharing`, after `ws.enableAutoReconnect();` and before `ws.registerAsDonor(...)`, start the local relay + hotspot (best effort; failures must not break cloud mode):

```dart
    // Local mode: host an in-app relay on the phone's private "OpenShare" WiFi.
    try {
      _localRelay = LocalRelayServer()..start();
      await LocalHotspot.start();
      _localReady = true;
      debugPrint('OPENSHARE_LOCAL_READY');
    } catch (e) {
      _localReady = false;
      debugPrint('OPENSHARE_LOCAL_FAIL $e');
    }
```

In `_stopSharing`, stop local mode:

```dart
    if (_localReady) {
      try { await LocalHotspot.stop(); } catch (_) {}
      _localReady = false;
    }
    await _localRelay?.stop();
    _localRelay = null;
```

- [ ] **Step 5: Add receiver "Connect Local" to BrowseScreen**

In `_BrowseScreenState`, add a method and a button (shown when `!_isConnected`, under the Connect button):

```dart
  Future<void> _connectLocal() async {
    setState(() => _isScanning = true);
    // Common LocalOnlyHotspot gateways; first one that answers wins.
    const candidates = [
      'ws://192.168.43.1:8080',
      'ws://192.168.49.1:8080',
      'ws://10.0.0.1:8080',
    ];
    for (final url in candidates) {
      final ok = await ws.connect(url);
      if (ok) {
        ws.enableAutoReconnect();
        setState(() => _isConnected = true);
        ws.requestDonors();
        return;
      }
    }
    setState(() => _isScanning = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No OpenShare WiFi found. Join the "OpenShare" network in phone settings first.'),
        ),
      );
    }
  }
```

Button (in the `!_isConnected` block, after the Connect button):

```dart
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton.icon(
                  onPressed: _isScanning ? null : _connectLocal,
                  icon: const Icon(Icons.wifi),
                  label: const Text('Connect Local (no internet)'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white38),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                ),
              ),
```

- [ ] **Step 6: Verify compile + analyze**

Run: `flutter analyze`
Expected: No issues.

- [ ] **Step 7: Commit and push; CI builds APK (Kotlin compiles)**

```bash
git add openshare/android/app/src/main/AndroidManifest.xml \
        openshare/android/app/src/main/kotlin/com/openshare/openshare/MainActivity.kt \
        openshare/lib/services/local_hotspot.dart \
        openshare/lib/screens/share_screen.dart \
        openshare/lib/screens/browse_screen.dart
git commit -m "feat(app): local hotspot + in-app relay for zero-internet sharing"
git push origin main
```

Expected: CI completes with all server tests + proof + arm64 APK artifact.

- [ ] **Step 8: Manual device test (cannot run in CI)**

1. Install the arm64 APK on two phones.
2. Donor: tap Start. Confirm "Sharing..." and (on Android 8+) an "OpenShare" network appears in WiFi settings.
3. Receiver (no internet): open WiFi settings, join "OpenShare", come back to app, tap "Connect Local (no internet)".
4. Confirm donor appears, tap Connect, then open a browser on the receiver — it must load pages using donor's data.

---

### Task 9: README + docs update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Rewrite the setup/usage section to document:
- Relay URL: `wss://ayanshaikh2-datashare-relay.hf.space` (both apps default to it; no typing needed).
- Start/Stop flow on donor; Connect on receiver.
- Local mode: donor hosts "OpenShare" WiFi (Android 8+), zero-internet receiver joins it and taps "Connect Local".
- Server: health endpoint `/`, keep-alive workflow pings every 5 min, heartbeat cleanup every 30s.
- Tests: `node server/relay_test.js`, `node server/real_internet_share_test.js`, `flutter test`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: OpenShare relay v2 usage and architecture"
git push origin main
```

---

## Self-Review

- **Spec coverage:** Health endpoint (Task 2), pinger 24/7 (Task 3), heartbeat/cleanup (Task 2), logging (Task 2), Start/Stop direct UI (Tasks 6-7), auto-reconnect (Task 5), local WiFi mode (Task 8), CI proof + logs (Task 4), docs (Task 9). All 5 success criteria covered.
- **Placeholder scan:** No TBD/TODO; every code step contains full code and expected output.
- **Type consistency:** `enableAutoReconnect`/`disableAutoReconnect` defined in Task 5 and used in Tasks 6, 7, 8b. `LocalRelayServer.start/stop/running/port` defined in Task 8a, used in Task 8b. Protocol types unchanged throughout.
