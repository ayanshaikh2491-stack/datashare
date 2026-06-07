const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const { broadcastToGeneralReceivers, sendToGeneralUser, generalDonors } = require('../services/vpn-tunnel.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidation, rules } = require('../middleware/validation.middleware');
const config = require('../../config/env');
const logger = require('../utils/logger');

router.use(authenticateToken);

/**
 * Resolve a receiver row to the underlying user_id.
 * The WS maps are keyed by users.id (UUID), not receivers.id. Callers
 * historically passed `receiverId` (which is the receivers table id) into
 * sendToUser(), so the WebSocket never matched and the receiver never
 * received the event (H8). Always go through this helper.
 */
async function resolveReceiverUserId(receiverId) {
  const { data } = await getSupabase()
    .from('receivers')
    .select('user_id')
    .eq('id', receiverId)
    .maybeSingle();
  return data?.user_id || null;
}

// POST /api/donor/register
router.post('/register', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: existing } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

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
    logger.info(`Donor registered: ${userId}`);
    res.status(201).json({ message: 'Donor registered', donor });
  } catch (err) {
    logger.error('Donor registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// POST /api/donor/online
router.post('/online', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { lat, lng, location, hotspot_name, hotspot_password } = req.body;
    const loc = location || { lat: lat || 0, lng: lng || 0 };

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not registered' });

    const settings = donor.settings || {};
    if (hotspot_name !== undefined) settings.hotspot_name = hotspot_name;
    if (hotspot_password !== undefined) settings.hotspot_password = hotspot_password;

    const { data: updated, error: updateError } = await getSupabase()
      .from('donors')
      .update({
        location: loc,
        status: 'online',
        last_seen: new Date().toISOString(),
        settings
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;

    // H3: log instead of silently swallow
    try {
      broadcastToGeneralReceivers({ type: 'donor_online', donor: updated });
    } catch (e) {
      logger.warn(`donor_online broadcast failed: ${e.message}`);
    }

    logger.info(`Donor online: ${userId}`);
    res.json({ message: 'Donor is now online', donor: updated });
  } catch (err) {
    logger.error('Go online error:', err.message);
    res.status(500).json({ error: 'Failed to go online', details: err.message });
  }
});

// POST /api/donor/offline
router.post('/offline', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: updated } = await getSupabase()
      .from('donors')
      .update({ status: 'offline', last_seen: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    // H4: only update connections if the donor row actually exists. The
    // previous `in('donor_id', [updated?.id])` would expand to
    // `WHERE donor_id IN (NULL)` which matches no rows, leaving
    // connections stuck in `active` after the donor went offline.
    if (updated?.id) {
      await getSupabase()
        .from('connections')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          disconnect_reason: 'donor_offline'
        })
        .eq('status', 'active')
        .eq('donor_id', updated.id);
    }

    try {
      broadcastToGeneralReceivers({
        type: 'donor_offline',
        donorId: updated?.id,
        reason: 'donor_offline'
      });
    } catch (e) {
      logger.warn(`donor_offline broadcast failed: ${e.message}`);
    }

    logger.info(`Donor offline: ${userId}`);
    res.json({ message: 'Donor is now offline', donor: updated });
  } catch (err) {
    logger.error('Go offline error:', err.message);
    res.status(500).json({ error: 'Failed to go offline', details: err.message });
  }
});

// POST /api/donor/accept  body: { receiver_id }
// (Single canonical route — old /accept/:receiverId alias removed: L2.)
router.post('/accept', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if ((donor.current_receivers || 0) >= (donor.max_receivers || 3)) {
      return res.status(429).json({ error: 'Max receivers reached', code: 'MAX_RECEIVERS' });
    }

    const { data: connection } = await getSupabase()
      .from('connections')
      .insert([{
        donor_id: donor.id,
        receiver_id,
        started_at: new Date().toISOString(),
        status: 'active'
      }])
      .select()
      .single();

    await getSupabase()
      .from('donors')
      .update({ current_receivers: (donor.current_receivers || 0) + 1 })
      .eq('id', donor.id);

    // H8: send to the underlying user_id, not the receivers.id.
    const receiverUserId = await resolveReceiverUserId(receiver_id);
    if (receiverUserId) {
      try {
        sendToGeneralUser(receiverUserId, {
          type: 'connection_accepted',
          connectionId: connection.id,
          donorId: donor.id
        });
      } catch (e) {
        logger.warn(`connection_accepted WS send failed: ${e.message}`);
      }
    } else {
      logger.warn(`Could not resolve receiver ${receiver_id} to a user_id for accept`);
    }

    logger.info(`Donor ${userId} accepted receiver ${receiver_id}`);
    res.json({ message: 'Receiver accepted', connection });
  } catch (err) {
    logger.error('Accept error:', err.message);
    res.status(500).json({ error: 'Failed to accept', details: err.message });
  }
});

// POST /api/donor/reject  body: { receiver_id, reason? }
router.post('/reject', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const receiverUserId = await resolveReceiverUserId(receiver_id);
    if (receiverUserId) {
      try {
        sendToGeneralUser(receiverUserId, {
          type: 'connection_rejected',
          donorId: donor.id,
          reason: reason || 'Donor declined'
        });
      } catch (e) {
        logger.warn(`connection_rejected WS send failed: ${e.message}`);
      }
    }

    logger.info(`Donor ${userId} rejected receiver ${receiver_id}`);
    res.json({ message: 'Receiver rejected' });
  } catch (err) {
    logger.error('Reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject', details: err.message });
  }
});

// POST /api/donor/disconnect  body: { receiver_id, reason? }
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('donor_id', donor.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!connection) return res.status(404).json({ error: 'No active connection found' });

    await getSupabase()
      .from('connections')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        disconnect_reason: reason || 'donor_disconnect'
      })
      .eq('id', connection.id);

    // H5: query the donor's current_receivers and decrement; do not use
    // connection.current_receivers (it doesn't exist on connections rows).
    await getSupabase()
      .from('donors')
      .update({ current_receivers: Math.max(0, (donor.current_receivers || 0) - 1) })
      .eq('id', donor.id);

    const receiverUserId = await resolveReceiverUserId(receiver_id);
    if (receiverUserId) {
      try {
        sendToGeneralUser(receiverUserId, {
          type: 'disconnected',
          reason: reason || 'Donor disconnected you',
          connectionId: connection.id
        });
      } catch (e) {
        logger.warn(`disconnected WS send failed: ${e.message}`);
      }
    }

    logger.info(`Donor ${userId} disconnected receiver ${receiver_id}`);
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

    logger.info(`Donor settings updated: ${userId}`);
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
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not registered' });

    const { data: connections } = await getSupabase()
      .from('connections')
      .select('receiver_id, started_at, data_used_mb')
      .eq('donor_id', donor.id)
      .eq('status', 'active');

    res.json({
      donor,
      active_connections: connections || [],
      online: generalDonors.has(userId)
    });
  } catch (err) {
    logger.error('Status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch status', details: err.message });
  }
});

// POST /api/donor/block  body: { receiver_id, reason? }
router.post('/block', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { receiver_id, reason } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    await getSupabase()
      .from('connections')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        disconnect_reason: 'blocked'
      })
      .eq('donor_id', donor.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'active');

    await getSupabase()
      .from('blocklist')
      .upsert([{ donor_id: donor.id, receiver_id, reason: reason || 'blocked by donor' }], {
        onConflict: 'donor_id,receiver_id'
      });

    logger.info(`Donor ${userId} blocked receiver ${receiver_id}`);
    res.json({ message: 'Receiver blocked' });
  } catch (err) {
    logger.error('Block error:', err.message);
    res.status(500).json({ error: 'Failed to block', details: err.message });
  }
});

module.exports = router;
