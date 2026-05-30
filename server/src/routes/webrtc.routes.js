// WebRTC Signaling Routes
const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const webrtc = require('../services/webrtc.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// POST /api/webrtc/create-session — Donor creates a WebRTC session when connection is established
router.post('/create-session', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, receiver_id } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

    const session = webrtc.createSession(connection_id, userId, receiver_id);

    // Notify receiver that session is ready
    websocket.sendToUser(receiver_id, {
      type: 'webrtc_session_created',
      connection_id,
      donor_id: userId
    });

    res.json({ message: 'WebRTC session created', connection_id });
  } catch (err) {
    logger.error('WebRTC create session error:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// POST /api/webrtc/offer — Donor sends WebRTC offer
router.post('/offer', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, offer } = req.body;
    if (!connection_id || !offer) return res.status(400).json({ error: 'connection_id and offer required' });

    const session = webrtc.setOffer(connection_id, offer, userId);
    if (!session) return res.status(404).json({ error: 'Session not found or unauthorized' });

    // Forward offer to receiver
    websocket.sendToUser(session.receiverId, {
      type: 'webrtc_offer',
      connection_id,
      offer
    });

    res.json({ message: 'Offer sent to receiver' });
  } catch (err) {
    logger.error('WebRTC offer error:', err.message);
    res.status(500).json({ error: 'Failed to send offer' });
  }
});

// POST /api/webrtc/answer — Receiver sends WebRTC answer
router.post('/answer', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, answer } = req.body;
    if (!connection_id || !answer) return res.status(400).json({ error: 'connection_id and answer required' });

    const session = webrtc.setAnswer(connection_id, answer, userId);
    if (!session) return res.status(404).json({ error: 'Session not found or unauthorized' });

    // Forward answer to donor
    websocket.sendToUser(session.donorId, {
      type: 'webrtc_answer',
      connection_id,
      answer
    });

    res.json({ message: 'Answer sent to donor' });
  } catch (err) {
    logger.error('WebRTC answer error:', err.message);
    res.status(500).json({ error: 'Failed to send answer' });
  }
});

// POST /api/webrtc/ice — Exchange ICE candidates
router.post('/ice', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, candidate } = req.body;
    if (!connection_id || !candidate) return res.status(400).json({ error: 'connection_id and candidate required' });

    const session = webrtc.addIceCandidate(connection_id, candidate, userId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Forward ICE candidate to the other party
    const targetId = userId === session.donorId ? session.receiverId : session.donorId;
    websocket.sendToUser(targetId, {
      type: 'webrtc_ice',
      connection_id,
      candidate,
      from: userId === session.donorId ? 'donor' : 'receiver'
    });

    res.json({ message: 'ICE candidate forwarded' });
  } catch (err) {
    logger.error('WebRTC ICE error:', err.message);
    res.status(500).json({ error: 'Failed to forward ICE' });
  }
});

// GET /api/webrtc/session/:connectionId — Get session details
router.get('/session/:connectionId', async (req, res) => {
  try {
    const session = webrtc.getSession(req.params.connectionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ session });
  } catch (err) {
    logger.error('WebRTC session get error:', err.message);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// POST /api/webrtc/close — Close WebRTC session
router.post('/close', async (req, res) => {
  try {
    const { connection_id } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

    webrtc.removeSession(connection_id);
    res.json({ message: 'Session closed' });
  } catch (err) {
    logger.error('WebRTC close error:', err.message);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

// STUN/TURN server config for WebRTC
router.get('/config', async (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // Free STUN servers only — no TURN (TURN costs money)
    ]
  });
});

module.exports = router;
