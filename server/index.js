const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// Registry: { donorId: { socket, metadata, sessionId? } }
const donors = new Map();
// Sessions: { sessionId: { donorId, receiverSocket, donorSocket } }
const sessions = new Map();

console.log(`[OpenShare Server] Running on port ${PORT}`);

function broadcastDonorList() {
  const list = [];
  for (const [id, donor] of donors) {
    if (!donor.sessionId) { // Only show available donors
      list.push({ id, ...donor.metadata });
    }
  }
  const msg = JSON.stringify({ type: 'DONOR_LIST', donors: list });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  let role = null; // 'donor' | 'receiver'
  let donorId = null;
  let currentSession = null;

  console.log(`[+] Client connected: ${clientId}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
    }

    switch (msg.type) {

      case 'DONOR_REGISTER': {
        role = 'donor';
        donorId = clientId;
        donors.set(donorId, {
          socket: ws,
          metadata: msg.metadata || { name: 'Donor', network: 'unknown' },
          sessionId: null
        });
        ws.clientId = donorId;
        ws.send(JSON.stringify({ type: 'DONOR_REGISTERED', donorId }));
        broadcastDonorList();
        console.log(`[Donor] Registered: ${donorId}`);
        break;
      }

      case 'DONOR_HEARTBEAT': {
        if (donors.has(clientId)) {
          // Keep alive
        }
        break;
      }

      case 'REQUEST_DONORS': {
        role = 'receiver';
        const list = [];
        for (const [id, donor] of donors) {
          if (!donor.sessionId) {
            list.push({ id, ...donor.metadata });
          }
        }
        ws.send(JSON.stringify({ type: 'DONOR_LIST', donors: list }));
        break;
      }

      case 'SELECT_DONOR': {
        const targetId = msg.donorId;
        const donor = donors.get(targetId);
        if (!donor) {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Donor not found' }));
        }
        if (donor.sessionId) {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Donor busy' }));
        }

        const sessionId = uuidv4();
        currentSession = sessionId;
        donor.sessionId = sessionId;
        sessions.set(sessionId, {
          donorId: targetId,
          receiverSocket: ws,
          donorSocket: donor.socket
        });

        // Notify donor about new session
        donor.socket.send(JSON.stringify({
          type: 'SESSION_START',
          sessionId,
          receiverInfo: msg.receiverInfo || {}
        }));

        ws.send(JSON.stringify({ type: 'SESSION_STARTED', sessionId, donorId: targetId }));
        broadcastDonorList();
        console.log(`[Session] Started: ${sessionId} (receiver=${clientId}, donor=${targetId})`);
        break;
      }

      case 'TUNNEL_DATA': {
        if (!currentSession) {
          // Try to find session from either side
          const found = findSessionBySocket(ws);
          if (!found) return;
          currentSession = found.sessionId;
        }

        const session = sessions.get(currentSession);
        if (!session) return;

        // Route data to the other side
        const targetSocket = (ws === session.donorSocket)
          ? session.receiverSocket
          : session.donorSocket;

        if (targetSocket && targetSocket.readyState === 1) {
          targetSocket.send(JSON.stringify({
            type: 'TUNNEL_DATA',
            data: msg.data,
            sessionId: currentSession
          }));
        }
        break;
      }

      // TCP tunnel: real sockets opened on the donor side for the receiver's
      // local HTTP(S) proxy. These are session-scoped just like TUNNEL_DATA.
      case 'OPEN_TCP':
      case 'TCP_READY':
      case 'TCP_DATA':
      case 'TCP_CLOSE': {
        const found = findSessionBySocket(ws);
        if (!found) return;
        currentSession = found.sessionId;
        const session = sessions.get(currentSession);
        if (!session) return;

        const targetSocket = (ws === session.donorSocket)
          ? session.receiverSocket
          : session.donorSocket;

        if (targetSocket && targetSocket.readyState === 1) {
          targetSocket.send(JSON.stringify(msg));
        }
        break;
      }

      case 'SESSION_END': {
        if (currentSession) {
          endSession(currentSession);
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected: ${clientId}`);
    // Clean up donor registry
    if (donorId && donors.has(donorId)) {
      donors.delete(donorId);
      broadcastDonorList();
    }
    // Clean up any session
    if (currentSession) {
      endSession(currentSession);
    }
  });

  ws.on('error', () => {});
});

function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Notify both sides
  try {
    if (session.receiverSocket && session.receiverSocket.readyState === 1) {
      session.receiverSocket.send(JSON.stringify({ type: 'SESSION_END', sessionId }));
    }
  } catch (e) {}
  try {
    if (session.donorSocket && session.donorSocket.readyState === 1) {
      session.donorSocket.send(JSON.stringify({ type: 'SESSION_END', sessionId }));
    }
  } catch (e) {}

  // Free donor
  const donor = donors.get(session.donorId);
  if (donor) donor.sessionId = null;

  sessions.delete(sessionId);
  broadcastDonorList();
  console.log(`[Session] Ended: ${sessionId}`);
}

function findSessionBySocket(ws) {
  for (const [sid, s] of sessions) {
    if (s.donorSocket === ws || s.receiverSocket === ws) {
      return { sessionId: sid, session: s };
    }
  }
  return null;
}
