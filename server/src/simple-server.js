const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Simple auth
app.post('/api/auth/login-or-register', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const token = crypto.randomBytes(32).toString('hex');
  res.json({
    message: 'Login successful',
    token,
    user: { id: 'u1', phone: email, name: email.split('@')[0], role: 'both' },
    isNew: false
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/app/version', (req, res) => {
  res.json({ versionCode: 1, versionName: '1.0.0', updateUrl: '', features: ['DataShare Relay'], minVersion: 1, forceUpdate: false, releaseDate: new Date().toISOString().split('T')[0] });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket relay
const donors = new Map(), receivers = new Map(), pending = new Map(), sessions = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = url.searchParams.get('userId') || 'anon_' + Date.now();
  const mode = url.searchParams.get('mode');
  const donorId = url.searchParams.get('donorId');
  const client = { ws, userId, mode, donorId, bytesSent: 0, bytesReceived: 0 };

  ws.on('message', (data, isBinary) => {
    if (isBinary || Buffer.isBuffer(data)) {
      // Binary packet relay
      let session = null;
      for (const s of sessions.values()) {
        if (s.donor?.userId === userId || s.receiver?.userId === userId) { session = s; break; }
      }
      if (!session) return;
      if (client.mode === 'receiver' && session.donor) session.donor.ws.send(data);
      else if (client.mode === 'donor' && session.receiver) session.receiver.ws.send(data);
      return;
    }
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    } catch (e) {}
  });

  ws.on('close', () => {
    donors.delete(userId); receivers.delete(userId); pending.delete(userId);
    for (const [id, s] of sessions) {
      if (s.donor?.userId === userId || s.receiver?.userId === userId) { sessions.delete(id); break; }
    }
  });

  if (mode === 'donor') {
    donors.set(userId, client);
    ws.send(JSON.stringify({ type: 'connected', userId, mode: 'donor' }));
    // Check pending receivers
    for (const [rid, recv] of pending) {
      if (recv.donorId === userId) {
        const sid = 'sess_' + Date.now();
        sessions.set(sid, { donor: client, receiver: recv });
        ws.send(JSON.stringify({ type: 'paired', role: 'donor', sessionId: sid }));
        recv.ws.send(JSON.stringify({ type: 'paired', role: 'receiver', sessionId: sid }));
        pending.delete(rid);
        break;
      }
    }
  } else {
    if (donorId && donors.has(donorId)) {
      const sid = 'sess_' + Date.now();
      sessions.set(sid, { donor: donors.get(donorId), receiver: client });
      ws.send(JSON.stringify({ type: 'paired', role: 'receiver', sessionId: sid }));
      donors.get(donorId).ws.send(JSON.stringify({ type: 'paired', role: 'donor', sessionId: sid }));
    } else {
      pending.set(userId, client);
      ws.send(JSON.stringify({ type: 'waiting_for_donor', message: 'Waiting for donor...' }));
    }
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`DataShare Relay on ${PORT}`));
