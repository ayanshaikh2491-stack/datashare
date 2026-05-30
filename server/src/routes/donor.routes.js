const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const headscale = require('../services/headscale.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidation, rules } = require('../middleware/validation.middleware');
const config = require('../../config/env');
const logger = require('../utils/logger');

router.use(authenticateToken);

// POST /api/donor/register
router.post('/register', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: existing } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existing) {
      return res.json({ message: 'Already registered as donor', donor: existing });
    }

    const settings = {
      data_limit_mb: config.DEFAULT_DATA_LIMIT_MB,
      time_limit_min: config.DEFAULT_SESSION_TIME_MIN,
      daily_total_gb: config.DEFAULT_DAILY_TOTAL_GB
    };

    const { data: donor, error } = await getSupabase()
      .from('donors')
      .insert([{
        user_id: userId,
        max_receivers: config.MAX_CONNECTIONS_PER_DONOR,
        current_receivers: 0,
        status: 'offline',
        settings
      }])
      .select()
      .single();

    if (error) throw error;
    logger.info(`✅ Donor registered: ${userId}`);
    res.status(201).json({ message: 'Donor registered', donor });
  } catch (err) {
    logger.error('Donor registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// ALIAS: Web app uses /online instead of /go-online
router.post('/online', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { lat, lng, location } = req.body;
    const loc = location || { lat: lat || 0, lng: lng || 0 };

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not registered' });

    // Update donor status - skip headscale if not configured
    const { data: updated, error: updateError } = await getSupabase()
      .from('donors')
      .update({
        location: loc,
        status: 'online',
        last_seen: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Try to notify receivers via websocket
    try {
      const { broadcastToReceivers } = require('../services/websocket.service');
      broadcastToReceivers({ type: 'donor_online', donor: updated });
    } catch(e) {}

    logger.info(`🟢 Donor online: ${userId}`);
    res.json({ message: 'Donor is now online', donor: updated });
  } catch (err) {
    logger.error('Go online error:', err.message);
    res.status(500).json({ error: 'Failed to go online', details: err.message });
  }
});

// ALIAS: Web app uses /offline instead of /go-offline
router.post('/offline', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: updated } = await getSupabase()
      .from('donors')
      .update({ status: 'offline', last_seen: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    await getSupabase()
      .from('connections')
      .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: 'donor_offline' })
      .eq('status', 'active')
      .in('donor_id', [updated?.id]);

    try {
      const { broadcastToReceivers } = require('../services/websocket.service');
      broadcastToReceivers({ type: 'donor_offline', donorId: updated?.id, reason: 'donor_offline' });
    } catch(e) {}

    logger.info(`🔴 Donor offline: ${userId}`);
    res.json({ message: 'Donor is now offline', donor: updated });
  } catch (err) {
    logger.error('Go offline error:', err.message);
    res.status(500).json({ error: 'Failed to go offline', details: err.message });
  }
});

// ALIAS: Web app uses /accept/:id (receiver_id in URL)
router.post('/accept/:receiverId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const receiverId = req.params.receiverId;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if (donor.current_receivers >= donor.max_receivers) {
      return res.status(429).json({ error: 'Max receivers reached', code: 'MAX_RECEIVERS' });
    }

    const { data: connection } = await getSupabase()
      .from('connections')
      .insert([{ donor_id: donor.id, receiver_id: receiverId, started_at: new Date().toISOString(), status: 'active' }])
      .select()
      .single();

    await getSupabase()
      .from('donors')
      .update({ current_receivers: donor.current_receivers + 1 })
      .eq('id', donor.id);

    try {
      const { sendToUser } = require('../services/websocket.service');
      sendToUser(receiverId, { type: 'connection_accepted', connectionId: connection.id, donorId: donor.id });
    } catch(e) {}

    logger.info(`✅ Donor ${userId} accepted receiver ${receiverId}`);
    res.json({ message: 'Receiver accepted', connection });
  } catch (err) {
    logger.error('Accept error:', err.message);
    res.status(500).json({ error: 'Failed to accept', details: err.message });
  }
});

// ALIAS: Web app uses /reject/:id (receiver_id in URL)
router.post('/reject/:receiverId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const receiverId = req.params.receiverId;
    const { reason } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    try {
      const { sendToUser } = require('../services/websocket.service');
      sendToUser(receiverId, { type: 'connection_rejected', donorId: donor.id, reason: reason || 'Donor declined' });
    } catch(e) {}

    logger.info(`❌ Donor ${userId} rejected receiver ${receiverId}`);
    res.json({ message: 'Receiver rejected' });
  } catch (err) {
    logger.error('Reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject', details: err.message });
  }
});

// POST /api/donor/go-online
router.post('/go-online', handleValidation(rules.location), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { location, device_name } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not registered' });

    const nodeName = `donor-${userId}-${Date.now()}`;
    const headscaleConfig = await headscale.registerNode(nodeName, userId);

    const { data: updated, error: updateError } = await getSupabase()
      .from('donors')
      .update({
        location,
        status: 'online',
        wireguard_public_key: headscaleConfig.nodeName,
        wireguard_endpoint: headscaleConfig.headscaleUrl,
        last_seen: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;

    websocket.broadcastToReceivers({ type: 'donor_online', donor: updated });
    logger.info(`🟢 Donor online: ${userId} at ${location.lat}, ${location.lng}`);

    res.json({
      message: 'Donor is now online',
      donor: updated,
      headscale: {
        nodeName: headscaleConfig.nodeName,
        preAuthKey: headscaleConfig.preAuthKey,
        serverUrl: headscaleConfig.headscaleUrl,
        namespace: headscaleConfig.namespace
      }
    });
  } catch (err) {
    logger.error('Go online error:', err.message);
    res.status(500).json({ error: 'Failed to go online', details: err.message });
  }
});

// POST /api/donor/go-offline
router.post('/go-offline', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: updated } = await getSupabase()
      .from('donors')
      .update({ status: 'offline', last_seen: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    await getSupabase()
      .from('connections')
      .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: 'donor_offline' })
      .eq('donor_id', updated.id)
      .eq('status', 'active');

    websocket.broadcastToReceivers({ type: 'donor_offline', donorId: updated.id, reason: 'donor_offline' });
    logger.info(`🔴 Donor offline: ${userId}`);
    res.json({ message: 'Donor is now offline', donor: updated });
  } catch (err) {
    logger.error('Go offline error:', err.message);
    res.status(500).json({ error: 'Failed to go offline', details: err.message });
  }
});

// POST /api/donor/accept
router.post('/accept', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if (donor.current_receivers >= donor.max_receivers) {
      return res.status(429).json({ error: 'Max receivers reached', code: 'MAX_RECEIVERS' });
    }

    const { data: connection } = await getSupabase()
      .from('connections')
      .insert([{ donor_id: donor.id, receiver_id, started_at: new Date().toISOString(), status: 'active' }])
      .select()
      .single();

    await getSupabase()
      .from('donors')
      .update({ current_receivers: donor.current_receivers + 1 })
      .eq('id', donor.id);

    websocket.sendToUser(receiver_id, { type: 'connection_accepted', connectionId: connection.id, donorId: donor.id });
    logger.info(`✅ Donor ${userId} accepted receiver ${receiver_id}`);
    res.json({ message: 'Receiver accepted', connection });
  } catch (err) {
    logger.error('Accept error:', err.message);
    res.status(500).json({ error: 'Failed to accept', details: err.message });
  }
});

// POST /api/donor/reject
router.post('/reject', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    websocket.sendToUser(receiver_id, { type: 'connection_rejected', donorId: donor.id, reason: reason || 'Donor declined' });
    logger.info(`❌ Donor ${userId} rejected receiver ${receiver_id}`);
    res.json({ message: 'Receiver rejected' });
  } catch (err) {
    logger.error('Reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject', details: err.message });
  }
});

// POST /api/donor/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('donor_id', donor.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'active')
      .single();

    if (!connection) return res.status(404).json({ error: 'No active connection found' });

    await getSupabase()
      .from('connections')
      .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: reason || 'donor_disconnect' })
      .eq('id', connection.id);

    await getSupabase()
      .from('donors')
      .update({ current_receivers: Math.max(0, donor.current_receivers - 1) })
      .eq('id', donor.id);

    websocket.sendToUser(receiver_id, { type: 'disconnected', reason: reason || 'Donor disconnected you', connectionId: connection.id });
    logger.info(`🔴 Donor ${userId} disconnected receiver ${receiver_id}`);
    res.json({ message: 'Receiver disconnected' });
  } catch (err) {
    logger.error('Disconnect error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect', details: err.message });
  }
});

// POST /api/donor/settings
router.post('/settings', handleValidation(rules.donorSettings), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { max_receivers, settings } = req.body;

    const updateData = {};
    if (max_receivers !== undefined) updateData.max_receivers = max_receivers;
    if (settings !== undefined) updateData.settings = settings;

    const { data: donor } = await getSupabase()
      .from('donors')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single();

    logger.info(`⚙️ Donor settings updated: ${userId}`);
    res.json({ message: 'Settings updated', donor });
  } catch (err) {
    logger.error('Settings update error:', err.message);
    res.status(500).json({ error: 'Failed to update settings', details: err.message });
  }
});

// GET /api/donor/status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not registered' });

    const { data: connections } = await getSupabase()
      .from('connections')
      .select('receiver_id, started_at, data_used_mb')
      .eq('donor_id', donor.id)
      .eq('status', 'active');

    res.json({ donor, active_connections: connections || [], online: websocket.donorClients.has(userId) });
  } catch (err) {
    logger.error('Status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch status', details: err.message });
  }
});

// POST /api/donor/block
router.post('/block', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    await getSupabase()
      .from('connections')
      .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: 'blocked' })
      .eq('donor_id', donor.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'active');

    await getSupabase()
      .from('blocklist')
      .insert([{ donor_id: donor.id, receiver_id, reason: reason || 'blocked by donor' }]);

    logger.info(`🚫 Donor ${userId} blocked receiver ${receiver_id}`);
    res.json({ message: 'Receiver blocked' });
  } catch (err) {
    logger.error('Block error:', err.message);
    res.status(500).json({ error: 'Failed to block', details: err.message });
  }
});

module.exports = router;
