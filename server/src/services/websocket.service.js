// Compatibility shim — routes import this module for `sendToUser` and
// `broadcastToReceivers`, but the real WebSocket server lives in
// `vpn-tunnel.service.js` (initialized in `server/src/index.js`).
//
// Previously this class kept its own `clients` / `donorClients` /
// `receiverClients` Maps that were never populated because `init()` was
// never called. The result: `sendToUser(donorId, ...)` was a silent
// no-op, so donors never received `new_connection` events, the
// WebRTC offer/answer handshake never started, and the donor/receiver
// flows appeared to "exit" immediately after connecting.
//
// This module now re-exports the live `vpnTunnel` state so the routes
// hit the same Maps that `handleGeneralConnection` writes to.
const vpnTunnel = require('./vpn-tunnel.service');

function sendToUser(userId, message) {
  return vpnTunnel.sendToGeneralUser(userId, message);
}

function broadcastToReceivers(message) {
  return vpnTunnel.broadcastToGeneralReceivers(message);
}

function broadcastToDonors(message) {
  return vpnTunnel.broadcastToGeneralDonors(message);
}

// `donorClients.has(userId)` is read by `donor.routes.js` GET /status
// to mark a donor as "online" in the in-memory WS sense (separate from
// the Supabase `status` field which is the persistent online flag).
const donorClients = {
  has(userId) {
    return vpnTunnel.generalDonors.has(userId);
  },
  get size() {
    return vpnTunnel.generalDonors.size;
  }
};

const receiverClients = {
  has(userId) {
    return vpnTunnel.generalReceivers.has(userId);
  },
  get size() {
    return vpnTunnel.generalReceivers.size;
  }
};

const clients = {
  get size() {
    return vpnTunnel.generalClients.size;
  }
};

module.exports = {
  init() {
    // No-op: vpnTunnel.initVpnTunnel() owns the real WSS.
  },
  sendToUser,
  broadcastToReceivers,
  broadcastToDonors,
  donorClients,
  receiverClients,
  clients
};
