const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/auth/login-or-register', (req, res) => {
  const { email, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const token = crypto.randomBytes(32).toString('hex');
  res.json({ message: 'Login successful', token, user: { id: 'u_' + Date.now(), phone: email, name: name || email.split('@')[0], role: 'both' }, isNew: false });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/api/app/version', (req, res) => {
  res.json({ versionCode: 1, versionName: '1.0.0', updateUrl: 'https://github.com/ayanshaikh2491-stack/datashare/releases/download/v5.3.2/app-debug.apk', features: ['DataShare Marketplace v1'], minVersion: 1, forceUpdate: false, releaseDate: '2026-07-05' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const listings = new Map();
const sessions = new Map();
const userListings = new Map();
const directDonors = new Map();  // For Android direct pairing
const directPending = new Map();
let listingCounter = 0;

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = url.searchParams.get('userId') || 'user_' + Date.now();
  ws.userId = userId; // Store for binary relay lookup
  const mode = url.searchParams.get('mode');
  const donorId = url.searchParams.get('donorId');
  
  // DIRECT PAIRING: For Android app compatibility (marketplace flow also works)
  if (mode === 'donor') {
    // Donor connects - check if any receiver waiting
    directDonors.set(userId, ws);
    for (const [rid, recvWs] of directPending) {
      if (rid === donorId || true) { // Match any waiting receiver
        const sid = 'sess_' + Date.now();
        sessions.set(sid, { id: sid, donorId: userId, receiver: { userId: rid } });
        ws.send(JSON.stringify({ type: 'paired', role: 'donor', sessionId: sid }));
        recvWs.send(JSON.stringify({ type: 'paired', role: 'receiver', sessionId: sid }));
        directPending.delete(rid);
        break;
      }
    }
  } else if (mode === 'receiver' && donorId) {
    // Receiver connects with specific donorId
    const donorWs = directDonors.get(donorId);
    if (donorWs && donorWs.readyState === 1) {
      const sid = 'sess_' + Date.now();
      sessions.set(sid, { id: sid, donorId, receiver: { userId } });
      ws.send(JSON.stringify({ type: 'paired', role: 'receiver', sessionId: sid }));
      donorWs.send(JSON.stringify({ type: 'paired', role: 'donor', sessionId: sid }));
    } else {
      directPending.set(userId, ws);
    }
  }
  const isText = (data, isBinary) => !isBinary && (typeof data === 'string' || !Buffer.isBuffer(data));

  function handleText(text) {
    try {
      const msg = JSON.parse(text);
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return true; }
      if (msg.type === 'auth') { ws.send(JSON.stringify({ type: 'auth_ok', userId })); return true; }
      if (msg.type === 'create_listing') {
        const id = 'lst_' + (++listingCounter);
        const listing = { id, donorId: userId, dataMB: msg.dataMB || 500, timeMin: msg.timeMin || 60, maxPeers: msg.maxPeers || 5, status: 'active', peers: [], dataUsed: 0, createdAt: Date.now() };
        listings.set(id, listing);
        if (!userListings.has(userId)) userListings.set(userId, []);
        userListings.get(userId).push(id);
        ws.send(JSON.stringify({ type: 'listing_created', listing }));
        broadcastListings();
        return true;
      }
      if (msg.type === 'close_listing') {
        const listing = listings.get(msg.listingId);
        if (listing && listing.donorId === userId) { listing.status = 'closed'; broadcastListings(); }
        return true;
      }
      if (msg.type === 'get_listings') {
        const active = [...listings.values()].filter(l => l.status === 'active').map(l => ({ id: l.id, dataMB: l.dataMB, timeMin: l.timeMin, maxPeers: l.maxPeers, peers: l.peers.length }));
        ws.send(JSON.stringify({ type: 'listings', listings: active }));
        return true;
      }
      if (msg.type === 'join_listing') {
        const listing = listings.get(msg.listingId);
        if (!listing || listing.status !== 'active') return true;
        if (listing.peers.length >= listing.maxPeers) return true;
        const sessionId = 'sess_' + Date.now();
        const peerInfo = { userId };
        listing.peers.push(peerInfo);
        sessions.set(sessionId, { id: sessionId, donorId: listing.donorId, receiver: peerInfo });
        ws.send(JSON.stringify({ type: 'joined', sessionId, listingId: msg.listingId }));
        broadcastListings();
        return true;
      }
      if (msg.type === 'leave_listing') {
        for (const [, listing] of listings) { listing.peers = listing.peers.filter(p => p.userId !== userId); }
        broadcastListings();
        return true;
      }
      if (msg.type === 'my_listings') {
        const ids = userListings.get(userId) || [];
        ws.send(JSON.stringify({ type: 'my_listings', listings: ids.map(id => listings.get(id)).filter(Boolean) }));
        return true;
      }
    } catch (e) {}
    return false;
  }

  ws.on('message', (data, isBinary) => {
    // ws v8+ sends text as Buffer with isBinary=false. Check isBinary first.
    if (!isBinary) {
      if (handleText(typeof data === 'string' ? data : data.toString())) return;
    }
    // Binary relay - use ws.userId (stored on connection) to find receiver
    for (const [sid, s] of sessions) {
      if (s.donorId === userId || s.receiver?.userId === userId) {
        const targetUserId = s.donorId === userId ? s.receiver?.userId : s.donorId;
        if (targetUserId) {
          wss.clients.forEach(client => {
            if (client.readyState === 1 && client.userId === targetUserId) {
              client.send(data);
            }
          });
        }
      }
    }
  });

  ws.on('close', () => {
    for (const [lid, l] of listings) { l.peers = l.peers.filter(p => p.userId !== userId); }
  });

  ws.send(JSON.stringify({ type: 'connected', userId }));
});

function broadcastListings() {
  const active = [...listings.values()].filter(l => l.status === 'active').map(l => ({ id: l.id, dataMB: l.dataMB, timeMin: l.timeMin, maxPeers: l.maxPeers, peers: l.peers.length }));
  const msg = JSON.stringify({ type: 'listings', listings: active });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

const PORT = process.env.PORT || 7860;
server.listen(PORT, () => console.log(`DataShare Marketplace on ${PORT}`));
