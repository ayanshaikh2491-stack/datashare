// WebRTC Signaling Service
// Handles offer/answer/ICE exchange between donor and receiver via WebSocket
const logger = require('../utils/logger');

// Store pending WebRTC sessions: connection_id → { donor, receiver, offer, answer, iceCandidates }
const sessions = new Map();

function createSession(connectionId, donorId, receiverId) {
  const session = {
    connectionId,
    donorId,
    receiverId,
    offer: null,
    answer: null,
    donorIce: [],
    receiverIce: [],
    createdAt: Date.now()
  };
  sessions.set(connectionId, session);
  logger.info(`🔗 WebRTC session created: ${connectionId}`);
  return session;
}

function getSession(connectionId) {
  return sessions.get(connectionId);
}

function setOffer(connectionId, offer, userId) {
  const session = sessions.get(connectionId);
  if (!session) return null;
  if (session.donorId !== userId) return null; // Only donor can set offer
  session.offer = offer;
  logger.info(`📤 WebRTC offer set for ${connectionId}`);
  return session;
}

function setAnswer(connectionId, answer, userId) {
  const session = sessions.get(connectionId);
  if (!session) return null;
  if (session.receiverId !== userId) return null; // Only receiver can set answer
  session.answer = answer;
  logger.info(`📥 WebRTC answer set for ${connectionId}`);
  return session;
}

function addIceCandidate(connectionId, candidate, fromUserId) {
  const session = sessions.get(connectionId);
  if (!session) return null;
  if (fromUserId === session.donorId) {
    session.donorIce.push(candidate);
  } else if (fromUserId === session.receiverId) {
    session.receiverIce.push(candidate);
  }
  return session;
}

function removeSession(connectionId) {
  const removed = sessions.delete(connectionId);
  if (removed) logger.info(`🗑️ WebRTC session removed: ${connectionId}`);
  return removed;
}

function getActiveSessions() {
  return Array.from(sessions.values());
}

// Cleanup old sessions (older than 30 minutes)
function cleanupOldSessions() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (now - session.createdAt > maxAge) {
      sessions.delete(id);
      logger.info(`🧹 Cleaned up stale WebRTC session: ${id}`);
    }
  }
}

module.exports = {
  createSession,
  getSession,
  setOffer,
  setAnswer,
  addIceCandidate,
  removeSession,
  getActiveSessions,
  cleanupOldSessions
};
