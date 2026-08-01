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
  let pingTimeout = null;
  const armPingTimeout = () => {
    clearTimeout(pingTimeout);
    pingTimeout = setTimeout(() => {
      log('heartbeat timeout, terminating client', clientId);
      ws.terminate();
    }, HEARTBEAT_TIMEOUT_MS);
  };
  ws.on('pong', () => { ws.isAlive = true; clearTimeout(pingTimeout); });

  // Protocol-level ping every INTERVAL; if the client does not pong within
  // TIMEOUT of a ping, terminate it. A pong clears the deadline timer.
  const heartbeat = setInterval(() => {
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
    armPingTimeout();
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
        // A receiver cannot join a second session while one is active:
        // end any existing session for this socket first.
        const existing = findSessionBySocket(ws);
        if (existing) endSession(existing.sessionId);

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
        const found = findSessionBySocket(ws);
        if (found) endSession(found.sessionId);
        break;
      }

      default:
        send(ws, { type: 'ERROR', message: 'Unknown message type' });
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(pingTimeout);
    log('client disconnected', clientId);
    if (donorId && donors.has(donorId)) {
      donors.delete(donorId);
      broadcastDonorList();
    }
    // End any session this socket belongs to (works for BOTH sides: the
    // donor never sets currentSession locally, so findSessionBySocket is
    // required to clean up when a donor vanishes).
    const sess = findSessionBySocket(ws);
    if (sess) endSession(sess.sessionId);
  });

  ws.on('error', () => {});
});

// Safety net: drop any donor whose socket died without a close event and
// end any session it belonged to (zombie-session guard).
setInterval(() => {
  let changed = false;
  for (const [id, donor] of donors) {
    if (donor.socket.readyState !== 1) {
      const sess = findSessionBySocket(donor.socket);
      donors.delete(id);
      if (sess) endSession(sess.sessionId);
      changed = true;
    }
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
