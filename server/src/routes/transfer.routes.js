const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// POST /api/transfer/update - Update transfer progress (called periodically during transfer)
router.post('/update', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, data_mb, speed_mbps, is_transferring } = req.body;

    if (!connection_id) {
      return res.status(400).json({ error: 'connection_id required' });
    }

    const updateData = {};
    if (data_mb !== undefined) updateData.data_transferred_mb = data_mb;
    if (speed_mbps !== undefined) updateData.transfer_speed_mbps = speed_mbps;
    if (is_transferring !== undefined) updateData.is_transferring = is_transferring;

    const { data: connection, error } = await getSupabase()
      .from('connections')
      .update(updateData)
      .eq('id', connection_id)
      .select()
      .single();

    if (error) throw error;

    // Notify both parties
    const update = {
      type: 'transfer_update',
      connection_id,
      data_mb: connection.data_transferred_mb,
      speed_mbps: connection.transfer_speed_mbps,
      is_transferring: connection.is_transferring
    };

    // Send to donor
    if (connection.donor_id) {
      const { data: donor } = await getSupabase()
        .from('donors')
        .select('user_id')
        .eq('id', connection.donor_id)
        .single();
      if (donor) websocket.sendToUser(donor.user_id, update);
    }

    // Send to receiver
    if (connection.receiver_id) {
      const { data: receiver } = await getSupabase()
        .from('receivers')
        .select('user_id')
        .eq('id', connection.receiver_id)
        .single();
      if (receiver) websocket.sendToUser(receiver.user_id, update);
    }

    res.json({ message: 'Transfer updated' });
  } catch (err) {
    logger.error('Transfer update error:', err.message);
    res.status(500).json({ error: 'Failed to update transfer', details: err.message });
  }
});

// GET /api/transfer/:connectionId - Get transfer details
router.get('/:connectionId', async (req, res) => {
  try {
    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('id', req.params.connectionId)
      .single();

    if (!connection) return res.status(404).json({ error: 'Connection not found' });

    res.json({ connection });
  } catch (err) {
    logger.error('Transfer details error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfer', details: err.message });
  }
});

// POST /api/transfer/complete - Mark transfer as complete
router.post('/complete', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, final_data_mb } = req.body;

    if (!connection_id) {
      return res.status(400).json({ error: 'connection_id required' });
    }

    const { data: connection } = await getSupabase()
      .from('connections')
      .update({
        data_transferred_mb: final_data_mb || 0,
        is_transferring: false,
        transfer_speed_mbps: 0
      })
      .eq('id', connection_id)
      .select()
      .single();

    // Notify both parties
    const update = {
      type: 'transfer_complete',
      connection_id,
      total_data_mb: connection?.data_transferred_mb || 0
    };

    if (connection?.donor_id) {
      const { data: donor } = await getSupabase()
        .from('donors')
        .select('user_id')
        .eq('id', connection.donor_id)
        .single();
      if (donor) websocket.sendToUser(donor.user_id, update);
    }

    if (connection?.receiver_id) {
      const { data: receiver } = await getSupabase()
        .from('receivers')
        .select('user_id')
        .eq('id', connection.receiver_id)
        .single();
      if (receiver) websocket.sendToUser(receiver.user_id, update);
    }

    logger.info(`✅ Transfer complete: ${connection_id} - ${final_data_mb}MB`);
    res.json({ message: 'Transfer complete', total_mb: connection?.data_transferred_mb || 0 });
  } catch (err) {
    logger.error('Transfer complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete transfer', details: err.message });
  }
});

// GET /api/transfer/active - Get active transfers for current user
router.get('/active', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check as donor
    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .single();

    // Check as receiver
    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('id')
      .eq('user_id', userId)
      .single();

    let transfers = [];

    if (donor) {
      const { data: donorTransfers } = await getSupabase()
        .from('connections')
        .select('*')
        .eq('donor_id', donor.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      transfers = transfers.concat(donorTransfers || []);
    }

    if (receiver) {
      const { data: receiverTransfers } = await getSupabase()
        .from('connections')
        .select('*')
        .eq('receiver_id', receiver.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      transfers = transfers.concat(receiverTransfers || []);
    }

    res.json({ transfers });
  } catch (err) {
    logger.error('Active transfers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfers', details: err.message });
  }
});

module.exports = router;
