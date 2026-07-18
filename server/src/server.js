/**
 * DataShare v5.5.0 — Donor-Relay Internet Sharing
 *
 * REAL ARCHITECTURE:
 *   Receiver ←→ Server ←→ Donor ←→ Internet
 *
 *   - Donor HAS internet (WiFi/Mobile data)
 *   - Donor connects ONCE to server (persistent WebSocket tunnel)
 *   - Server routes receiver traffic THROUGH donor's connection
 *   - Donor phone is lightweight — just forwards raw TCP data
 *   - Server handles ALL session management, credits, buffering
 *
 * FLOW:
 *   1. Donor connects → "I'm here, I have internet"
 *   2. Receiver connects → "I need internet for example.com:80"
 *   3. Server → Donor: "open TCP to example.com:80 (connId=5)"
 *   4. Donor → opens real TCP → internet
 *   5. Donor → Server: binary data [connId(2B)] + [payload]
 *   6. Server → Receiver: same binary frame
 *   7. Zero manual work for donor — server auto-routes everything
 */

const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const crypto = require('crypto');

const uuidv4 = () => crypto.randomUUID();

// ─── Config ───
const PORT = process.env.PORT || 7860;
const MAX_RECEIVERS_PER_DONOR = 5;
const MAX_DATA_PER_RECEIVER_MB = 500;
const TCP_CONNECT_TIMEOUT_MS = 10000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const BINARY_HEADER_SIZE = 2; // 2-byte connId prefix

// ─── In-Memory Stores ───
const users = new Map();
const donorCredits = new Map();
const sessions = new Map();

// Donor state: donorId → { ws, receivers: Map<receiverId, { ws, conns: Map<connId, socket> }> }
const donorTunnels = new Map();

// ─── Express App ───
const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get('/', (req, res) => {
  const totalDonors = donorTunnels.size;
  let totalConns = 0;
  for (const d of donorTunnels.values()) {
    for (const r of d.receivers.values()) {
      totalConns += r.conns.size;
    }
  }
  res.json({
    name: 'DataShare Server',
    version: '5.5.0',
    status: 'running',
    architecture: 'donor-relay',
    uptime: Math.floor(process.uptime()),
    activeDonors: totalDonors,
    activeConnections: totalConns,
    activeSessions: sessions.size,
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Auth API ───
app.post('/api/auth/register', (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.json({ success: false, error: 'Phone required' });

  for (const u of users.values()) {
    if (u.phone === phone) {
      const token = uuidv4();
      u.token = token;
      return res.json({ success: true, data: { token, user: { id: u.id, phone: u.phone, name: u.name, role: u.role } } });
    }
  }

  const userId = 'u_' + uuidv4().slice(0, 8);
  const token = uuidv4();
  const user = { id: userId, phone, name: name || '', role: 'both', token };
  users.set(userId, user);
  donorCredits.set(userId, { totalMB: 500, usedMB: 0, activeReceivers: new Set() });
  return res.json({ success: true, data: { token, user: { id: userId, phone, name: user.name, role: user.role } } });
});

app.post('/api/auth/login', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ success: false, error: 'Phone required' });
  for (const u of users.values()) {
    if (u.phone === phone) {
      const token = uuidv4();
      u.token = token;
      return res.json({ success: true, data: { token, user: { id: u.id, phone: u.phone, name: u.name, role: u.role } } });
    }
  }
  return res.json({ success: false, error: 'User not found' });
});

// ─── Donor API ───
app.post('/api/donor/deposit', (req, res) => {
  const { donorId, mb } = req.body;
  if (!donorId || !mb) return res.json({ success: false, error: 'donorId and mb required' });
  const credits = donorCredits.get(donorId);
  if (!credits) return res.json({ success: false, error: 'Donor not found' });
  credits.totalMB += Number(mb);
  return res.json({ success: true, data: { totalMB: credits.totalMB, usedMB: credits.usedMB } });
});

app.get('/api/donor/status/:userId', (req, res) => {
  const credits = donorCredits.get(req.params.userId);
  if (!credits) return res.json({ success: false, error: 'Not found' });
  return res.json({
    success: true,
    data: {
      totalMB: credits.totalMB,
      usedMB: credits.usedMB,
      availableMB: credits.totalMB - credits.usedMB,
      activeReceivers: credits.activeReceivers.size,
      online: donorTunnels.has(req.params.userId),
    }
  });
});

// ─── Receiver API ───
app.get('/api/receiver/donors', (req, res) => {
  const available = [];
  for (const [userId, credits] of donorCredits) {
    const tunnel = donorTunnels.get(userId);
    if (tunnel && tunnel.ws.readyState === WebSocket.OPEN && credits.activeReceivers.size < MAX_RECEIVERS_PER_DONOR) {
      available.push({
        id: userId,
        name: users.get(userId)?.name || 'Donor',
        availableMB: credits.totalMB - credits.usedMB,
        slots: MAX_RECEIVERS_PER_DONOR - credits.activeReceivers.size,
      });
    }
  }
  return res.json({ success: true, data: { donors: available } });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.json({ success: false, error: 'Not found' });
  return res.json({
    success: true,
    data: {
      id: session.id,
      dataUsedMB: (session.dataUsed / (1024 * 1024)).toFixed(2),
      startedAt: session.startedAt,
      donorName: users.get(session.donorId)?.name || 'Donor',
    }
  });
});

// ─── WebSocket Server ───
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = url.searchParams.get('userId');
  const role = url.searchParams.get('role');
  const sessionId = url.searchParams.get('sessionId');
  const donorId = url.searchParams.get('donorId'); // receiver specifies which donor

  if (!userId || !role) {
    ws.close(4001, 'userId and role required');
    return;
  }

  if (role === 'donor') {
    handleDonor(ws, userId);
  } else if (role === 'receiver') {
    handleReceiver(ws, userId, sessionId, donorId);
  } else {
    ws.close(4002, 'Invalid role');
  }
});

// ─── DONOR HANDLER ───
// Donor connects ONCE. Server sends TCP open requests. Donor just forwards data.
function handleDonor(ws, donorId) {
  console.log(`[Donor] ${donorId} connected — tunnel established`);

  const tunnel = { ws, receivers: new Map() };
  donorTunnels.set(donorId, tunnel);

  wsSend(ws, { type: 'tunnel_ready', donorId });

  ws.on('message', (data) => {
    const buf = Buffer.from(data);

    // Binary frame: [connId(2B)] + [payload] → relay to receiver
    if (buf.length >= BINARY_HEADER_SIZE) {
      const first2 = buf.readUInt16BE(0);
      // Check if this looks like a valid connId (small number)
      if (first2 < 10000 && buf.length > BINARY_HEADER_SIZE) {
        const connId = first2;
        const payload = buf.subarray(BINARY_HEADER_SIZE);

        // Find which receiver owns this connId
        for (const [receiverId, receiver] of tunnel.receivers) {
          if (receiver.conns.has(connId)) {
            // Forward to receiver
            if (receiver.ws && receiver.ws.readyState === WebSocket.OPEN) {
              receiver.ws.send(data, { binary: true });
              // Track usage
              const session = sessions.get(receiver.sessionId);
              if (session) session.dataUsed += payload.length;
              const credits = donorCredits.get(donorId);
              if (credits) credits.usedMB += payload.length / (1024 * 1024);
            }
            return;
          }
        }
      }
    }

    // JSON control messages from donor
    try {
      const msg = JSON.parse(buf.toString());
      handleDonorControl(tunnel, donorId, msg);
    } catch (e) {
      console.error('[Donor] Bad message');
    }
  });

  ws.on('close', () => {
    console.log(`[Donor] ${donorId} disconnected — tunnel closed`);
    donorTunnels.delete(donorId);

    // Notify all receivers that donor is gone
    for (const [receiverId, receiver] of tunnel.receivers) {
      if (receiver.ws && receiver.ws.readyState === WebSocket.OPEN) {
        wsSend(receiver.ws, { type: 'donor_disconnected', donorId });
      }
    }
  });
}

function handleDonorControl(tunnel, donorId, msg) {
  switch (msg.type) {
    case 'connection_ready': {
      // Donor TCP connected → relay to receiver
      const { connId } = msg;
      for (const [, receiver] of tunnel.receivers) {
        if (receiver.conns.has(connId)) {
          receiver.conns.get(connId).state = 'ready';
          wsSend(receiver.ws, { type: 'connection_ready', connId });
          break;
        }
      }
      break;
    }
    case 'connection_closed': {
      // Donor closed a TCP connection → notify receiver
      const { connId } = msg;
      for (const [receiverId, receiver] of tunnel.receivers) {
        if (receiver.conns.has(connId)) {
          receiver.conns.delete(connId);
          wsSend(receiver.ws, { type: 'connection_closed', connId });
          break;
        }
      }
      break;
    }
    case 'connection_error': {
      const { connId, error } = msg;
      for (const [receiverId, receiver] of tunnel.receivers) {
        if (receiver.conns.has(connId)) {
          receiver.conns.delete(connId);
          wsSend(receiver.ws, { type: 'connection_error', connId, error });
          break;
        }
      }
      break;
    }
  }
}

// ─── RECEIVER HANDLER ───
// Receiver asks server for internet. Server routes through donor's tunnel.
function handleReceiver(ws, receiverId, sessionId, donorId) {
  // If no donorId specified, use first available donor
  if (!donorId) {
    for (const [dId, credits] of donorCredits) {
      const tunnel = donorTunnels.get(dId);
      if (tunnel && tunnel.ws.readyState === WebSocket.OPEN && credits.activeReceivers.size < MAX_RECEIVERS_PER_DONOR) {
        donorId = dId;
        break;
      }
    }
  }

  if (!donorId || !donorTunnels.has(donorId)) {
    wsSend(ws, { type: 'error', message: 'No donor available. Ask a donor to connect first.' });
    ws.close(4003, 'No donor available');
    return;
  }

  const tunnel = donorTunnels.get(donorId);
  const credits = donorCredits.get(donorId);

  // Create session
  if (sessionId) {
    sessions.set(sessionId, {
      id: sessionId,
      donorId,
      receiverId,
      startedAt: new Date().toISOString(),
      dataUsed: 0,
    });
  }

  // Register receiver in tunnel
  const receiverState = { ws, conns: new Map(), sessionId };
  tunnel.receivers.set(receiverId, receiverState);
  if (credits) credits.activeReceivers.add(receiverId);

  console.log(`[Receiver] ${receiverId} connected via donor ${donorId}`);
  wsSend(ws, { type: 'connected', receiverId, donorId, sessionId });

  ws.on('message', (data) => {
    const buf = Buffer.from(data);

    // Binary frame: [connId(2B)] + [payload] → relay to donor
    if (buf.length >= BINARY_HEADER_SIZE) {
      const first2 = buf.readUInt16BE(0);
      if (first2 < 10000 && buf.length > BINARY_HEADER_SIZE) {
        // Forward raw to donor — donor opens the actual TCP connection
        if (tunnel.ws && tunnel.ws.readyState === WebSocket.OPEN) {
          tunnel.ws.send(data, { binary: true });
        }
        return;
      }
    }

    // JSON control messages
    try {
      const msg = JSON.parse(buf.toString());
      handleReceiverControl(ws, receiverId, receiverState, tunnel, donorId, msg, sessionId);
    } catch (e) {
      console.error('[Receiver] Bad message');
    }
  });

  ws.on('close', () => {
    console.log(`[Receiver] ${receiverId} disconnected`);
    tunnel.receivers.delete(receiverId);
    if (credits) credits.activeReceivers.delete(receiverId);

    // Tell donor to close all TCP connections for this receiver
    if (tunnel.ws && tunnel.ws.readyState === WebSocket.OPEN) {
      for (const [connId] of receiverState.conns) {
        wsSend(tunnel.ws, { type: 'close_connection', connId });
      }
    }
    receiverState.conns.clear();
  });
}

function handleReceiverControl(ws, receiverId, state, tunnel, donorId, msg, sessionId) {
  switch (msg.type) {
    case 'new_connection': {
      // Receiver wants to connect to internet → ask donor to open TCP
      const { host, destPort, connId } = msg;

      if (state.conns.size >= 5) {
        wsSend(ws, { type: 'connection_error', connId, error: 'Too many connections (max 5)' });
        return;
      }

      // Check data limit
      const session = sessionId ? sessions.get(sessionId) : null;
      if (session) {
        if (session.dataUsed / (1024 * 1024) >= MAX_DATA_PER_RECEIVER_MB) {
          wsSend(ws, { type: 'connection_error', connId, error: `Data limit ${MAX_DATA_PER_RECEIVER_MB}MB reached` });
          return;
        }
      }

      console.log(`[Relay] ${receiverId} → ${host}:${destPort} (connId=${connId}) via donor ${donorId}`);

      // Ask DONOR to open TCP connection (donor has the internet!)
      state.conns.set(connId, { host, destPort, state: 'connecting' });
      wsSend(tunnel.ws, { type: 'open_connection', connId, host, destPort });

      // Tell receiver we're connecting
      wsSend(ws, { type: 'connecting', connId, host, destPort });
      break;
    }

    case 'close_connection': {
      const { connId } = msg;
      state.conns.delete(connId);
      wsSend(tunnel.ws, { type: 'close_connection', connId });
      break;
    }

    case 'connection_ready': {
      // Donor confirmed TCP connected → tell receiver
      const { connId } = msg;
      if (state.conns.has(connId)) {
        state.conns.get(connId).state = 'ready';
        wsSend(ws, { type: 'connection_ready', connId });
      }
      break;
    }

    default:
      break;
  }
}

// ─── Helpers ───
function wsSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ─── Start ───
server.listen(PORT, () => {
  console.log(`
\x1b[36m╔══════════════════════════════════════════════╗
║  DataShare Server v5.5.0 (Donor Relay)       ║
║  Port: ${PORT}                                  ║
║  Architecture: Donor's internet shared        ║
║  Flow: Receiver ←→ Server ←→ Donor ←→ Net    ║
╚══════════════════════════════════════════════╝\x1b[0m
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  for (const tunnel of donorTunnels.values()) {
    for (const receiver of tunnel.receivers.values()) {
      for (const socket of receiver.conns.values()) socket.destroy();
    }
  }
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => process.exit(0));
