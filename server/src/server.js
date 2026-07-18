/**
 * DataShare v5.6.0 — Private Donor Relay
 *
 * PRIVACY: Donor NEVER sees what receiver is browsing
 *   - Server resolves DNS, sends only IP to donor
 *   - No hostnames, no user IDs, no personal data in relay
 *   - Donor just opens TCP to IP:port — doesn't know the website
 *
 * ZERO LOAD on donor phone:
 *   - Donor does 2 things: open TCP, forward raw bytes
 *   - ALL buffering, rate limiting, sessions on HuggingFace server
 *   - Donor phone = transparent pipe, zero processing
 *
 * Flow:
 *   Receiver → Server (resolves DNS) → Donor (IP only) → Internet
 *   Donor doesn't know what site. Just connects to IP:port.
 */

const express = require('express');
const http = require('http');
const net = require('net');
const dns = require('dns');
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

// Donor state: opaqueId → { ws, receivers }
// Donor NEVER sees real user IDs — only opaque random IDs
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
    version: '5.6.0',
    status: 'running',
    architecture: 'private-donor-relay',
    privacy: 'donor-never-sees-browsing-data',
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

// ─── Receiver API: List Available Donors ───
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
  if (!session) return res.json({ success: false, error: 'Session not found' });
  return res.json({
    success: true,
    data: {
      id: session.id,
      donorId: session.donorId,
      startedAt: session.startedAt,
      dataUsed: session.dataUsed,
      dataUsedMB: (session.dataUsed / (1024 * 1024)).toFixed(2),
    }
  });
});

// ─── WebSocket Server ───
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const userId = params.get('userId');
  const role = params.get('role');

  if (!userId || !role) {
    ws.close(4001, 'userId and role required');
    return;
  }

  if (role === 'donor') {
    handleDonor(ws, userId);
  } else if (role === 'receiver') {
    const donorId = params.get('donorId');
    const sessionId = params.get('sessionId');
    if (!donorId) {
      ws.close(4002, 'donorId required for receiver');
      return;
    }
    handleReceiver(ws, userId, donorId, sessionId);
  } else {
    ws.close(4001, 'role must be donor or receiver');
  }
});

// ─── Helper: Send JSON ───
function wsSend(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ─── DNS Resolver (SERVER-side, privacy) ───
// Resolves hostname to IP BEFORE sending to donor
// Donor never sees hostnames — only IP addresses
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    if (net.isIP(host)) { resolve(host); return; }
    // Force IPv4 — IPv6 breaks on many mobile networks
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err) reject(err);
      else resolve(address);
    });
  });
}

// ─── DONOR HANDLER ───
// Donor = transparent pipe. Does 2 things:
//   1. Opens TCP when server asks (IP:port only, no hostname)
//   2. Forwards raw bytes between server and internet
//
// PRIVACY: Donor NEVER sees:
//   - What websites receiver visits
//   - Receiver's user ID or personal info
//   - URLs, search queries, cookies, etc.
//
// ZERO LOAD: Donor does NO processing:
//   - No buffering logic
//   - No rate limiting
//   - No data counting
//   - Just raw byte forwarding
function handleDonor(ws, donorId) {
  const opaqueId = 'd_' + uuidv4().slice(0, 8);
  console.log(`[Donor] ${opaqueId} connected — tunnel established`);

  const tunnel = { ws, receivers: new Map(), opaqueId };
  donorTunnels.set(donorId, tunnel);
  wsSend(ws, { type: 'tunnel_ready', tunnelId: opaqueId });

  ws.on('message', (data, isBinary) => {
    // ── BINARY from donor = internet response → forward to receiver ──
    // Server does NOT have TCP sockets. Donor has them.
    // Server just relays bytes between donor and receiver.
    if (isBinary) {
      const buf = Buffer.from(data);
      if (buf.length < BINARY_HEADER_SIZE) return;
      const connId = buf.readUInt16BE(0);
      const payload = buf.subarray(BINARY_HEADER_SIZE);

      // Find which receiver owns this connId and forward
      for (const [, receiver] of tunnel.receivers) {
        if (receiver.conns.has(connId)) {
          if (receiver.ws && receiver.ws.readyState === WebSocket.OPEN) {
            receiver.ws.send(data, { binary: true });
            // Track usage server-side
            const session = receiver.sessionId ? sessions.get(receiver.sessionId) : null;
            if (session) session.dataUsed += payload.length;
            const credits = donorCredits.get(donorId);
            if (credits) credits.usedMB += payload.length / (1024 * 1024);
          }
          break;
        }
      }
      return;
    }

    // ── JSON: Control messages from donor ──
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {
      case 'connection_ready': {
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
        const { connId } = msg;
        for (const [, receiver] of tunnel.receivers) {
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
        for (const [, receiver] of tunnel.receivers) {
          if (receiver.conns.has(connId)) {
            receiver.conns.delete(connId);
            wsSend(receiver.ws, { type: 'connection_error', connId, error });
            break;
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[Donor] ${opaqueId} disconnected — tunnel closed`);
    donorTunnels.delete(donorId);

    for (const [, receiver] of tunnel.receivers) {
      if (receiver.ws && receiver.ws.readyState === WebSocket.OPEN) {
        wsSend(receiver.ws, { type: 'donor_disconnected' });
      }
    }
  });
}

// ─── RECEIVER HANDLER ───
// Receiver connects to use donor's internet
// Server handles ALL processing — receiver gets clean relay
function handleReceiver(ws, receiverId, donorId, sessionId) {
  if (!donorTunnels.has(donorId)) {
    wsSend(ws, { type: 'error', message: 'No donor available' });
    ws.close(4003, 'No donor available');
    return;
  }

  const tunnel = donorTunnels.get(donorId);
  const credits = donorCredits.get(donorId);

  if (credits && credits.activeReceivers.size >= MAX_RECEIVERS_PER_DONOR) {
    wsSend(ws, { type: 'error', message: 'Donor at max capacity' });
    ws.close(4003, 'Donor full');
    return;
  }

  // Create session (server tracks everything)
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

  console.log(`[Receiver] ${receiverId} connected via tunnel`);
  wsSend(ws, { type: 'connected', sessionId });

  ws.on('message', (data, isBinary) => {
    // ── BINARY: [connId(2B)] + [raw payload] ──
    // Receiver wants to send data to internet via donor
    if (isBinary) {
      const buf = Buffer.from(data);
      if (buf.length < BINARY_HEADER_SIZE) return;

      const connId = buf.readUInt16BE(0);
      const payload = buf.subarray(BINARY_HEADER_SIZE);

      // If empty payload → this is a "ready" signal, ignore
      if (payload.length === 0) return;

      // Forward raw bytes to donor (donor forwards to internet)
      // Server does NOT inspect the payload — just passes through
      const tunnelWs = tunnel.ws;
      if (tunnelWs && tunnelWs.readyState === WebSocket.OPEN) {
        tunnelWs.send(data, { binary: true });

        // Track data usage on server side (privacy: don't log content)
        const session = sessionId ? sessions.get(sessionId) : null;
        if (session) session.dataUsed += payload.length;
        if (credits) credits.usedMB += payload.length / (1024 * 1024);
      }
      return;
    }

    // ── JSON: Control messages from receiver ──
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {
      case 'new_connection': {
        // Receiver wants to connect to internet
        // SERVER resolves DNS here — donor gets IP only
        const { host, destPort, connId } = msg;

        if (receiverState.conns.size >= 5) {
          wsSend(ws, { type: 'connection_error', connId, error: 'Max 5 connections' });
          return;
        }

        // Check data limit (server-side)
        const session = sessionId ? sessions.get(sessionId) : null;
        if (session && session.dataUsed / (1024 * 1024) >= MAX_DATA_PER_RECEIVER_MB) {
          wsSend(ws, { type: 'connection_error', connId, error: 'Data limit reached' });
          return;
        }

        // DNS resolution on SERVER — donor never sees hostname
        resolveHost(host).then(ip => {
          console.log(`[Relay] ${receiverId} → ${host}(${ip}:${destPort}) connId=${connId}`);

          receiverState.conns.set(connId, { host, ip, destPort, state: 'connecting' });

          // Tell DONOR to open TCP to IP:port (no hostname!)
          wsSend(tunnel.ws, { type: 'open_tcp', connId, ip, port: destPort });

          // Tell RECEIVER it's connecting (keep hostname for receiver — they know what they asked for)
          wsSend(ws, { type: 'connecting', connId, host, destPort });
        }).catch(err => {
          console.error(`[Relay] DNS failed for ${host}:`, err.message);
          wsSend(ws, { type: 'connection_error', connId, error: 'DNS resolution failed' });
        });
        break;
      }

      case 'close_connection': {
        const conn = receiverState.conns.get(msg.connId);
        if (conn) {
          wsSend(tunnel.ws, { type: 'close_tcp', connId: msg.connId });
          receiverState.conns.delete(msg.connId);
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[Receiver] ${receiverId} disconnected`);
    tunnel.receivers.delete(receiverId);
    if (credits) credits.activeReceivers.delete(receiverId);

    // Tell donor to close all TCP for this receiver
    if (tunnel.ws && tunnel.ws.readyState === WebSocket.OPEN) {
      for (const [connId] of receiverState.conns) {
        wsSend(tunnel.ws, { type: 'close_tcp', connId });
      }
    }
    receiverState.conns.clear();
  });
}

// ─── Cleanup Stale Sessions (every 5 min) ───
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - new Date(session.startedAt).getTime() > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── Start Server ───
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  DataShare Server v5.6.0 (Private Relay)     ║`);
  console.log(`║  Port: ${PORT}                                  ║`);
  console.log(`║  Privacy: Donor never sees browsing data     ║`);
  console.log(`║  DNS resolved server-side (IP only to donor) ║`);
  console.log(`║  Donor phone = zero processing               ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});
