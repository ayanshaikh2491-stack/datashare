const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// ===== SPECIFIC ROUTES FIRST (before :connectionId) =====

// GET /api/transfer/active - Get active transfers for current user
router.get('/active', async (req, res) => {
  try {
    const userId = req.user.userId;
    let transfers = [];

    // Check as donor
    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (donor) {
      const { data: donorTransfers } = await getSupabase()
        .from('connections')
        .select('*, receivers!connections_receiver_id_fkey(user_id)')
        .eq('donor_id', donor.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      if (donorTransfers) transfers = transfers.concat(donorTransfers);
    }

    // Check as receiver
    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (receiver) {
      const { data: receiverTransfers } = await getSupabase()
        .from('connections')
        .select('*, donors!connections_donor_id_fkey(user_id)')
        .eq('receiver_id', receiver.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      if (receiverTransfers) transfers = transfers.concat(receiverTransfers);
    }

    res.json({ transfers });
  } catch (err) {
    logger.error('Active transfers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfers', details: err.message });
  }
});

// POST /api/transfer/update - Update transfer progress
router.post('/update', async (req, res) => {
  try {
    const { connection_id, data_mb, speed_mbps, is_transferring } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

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

    const update = { type: 'transfer_update', connection_id, data_mb: connection.data_transferred_mb, speed_mbps: connection.transfer_speed_mbps, is_transferring: connection.is_transferring };

    if (connection.donor_id) {
      const { data: d } = await getSupabase().from('donors').select('user_id').eq('id', connection.donor_id).maybeSingle();
      if (d) websocket.sendToUser(d.user_id, update);
    }
    if (connection.receiver_id) {
      const { data: r } = await getSupabase().from('receivers').select('user_id').eq('id', connection.receiver_id).maybeSingle();
      if (r) websocket.sendToUser(r.user_id, update);
    }

    res.json({ message: 'Transfer updated' });
  } catch (err) {
    logger.error('Transfer update error:', err.message);
    res.status(500).json({ error: 'Failed to update transfer', details: err.message });
  }
});

// POST /api/transfer/complete - Mark transfer as complete
router.post('/complete', async (req, res) => {
  try {
    const { connection_id, final_data_mb } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

    const { data: connection } = await getSupabase()
      .from('connections')
      .update({ data_transferred_mb: final_data_mb || 0, is_transferring: false, transfer_speed_mbps: 0 })
      .eq('id', connection_id)
      .select()
      .single();

    const update = { type: 'transfer_complete', connection_id, total_data_mb: connection?.data_transferred_mb || 0 };
    if (connection?.donor_id) {
      const { data: d } = await getSupabase().from('donors').select('user_id').eq('id', connection.donor_id).maybeSingle();
      if (d) websocket.sendToUser(d.user_id, update);
    }
    if (connection?.receiver_id) {
      const { data: r } = await getSupabase().from('receivers').select('user_id').eq('id', connection.receiver_id).maybeSingle();
      if (r) websocket.sendToUser(r.user_id, update);
    }

    logger.info(`✅ Transfer complete: ${connection_id} - ${final_data_mb}MB`);
    res.json({ message: 'Transfer complete', total_mb: connection?.data_transferred_mb || 0 });
  } catch (err) {
    logger.error('Transfer complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete transfer', details: err.message });
  }
});

// POST /api/transfer/connect - Create a connection (receiver connects to donor)
router.post('/connect', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { donor_id, amount_mb } = req.body;

    if (!donor_id) return res.status(400).json({ error: 'donor_id required' });

    const { data: receiver } = await getSupabase().from('receivers').select('id').eq('user_id', userId).maybeSingle();
    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const { data: donor } = await getSupabase().from('donors').select('*').eq('id', donor_id).maybeSingle();
    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if (donor.status !== 'online') return res.status(400).json({ error: 'Donor not online' });
    if (donor.current_receivers >= donor.max_receivers) return res.status(429).json({ error: 'Donor is full' });

    const { data: connection, error } = await getSupabase()
      .from('connections')
      .insert([{ donor_id, receiver_id: receiver.id, started_at: new Date().toISOString(), status: 'active' }])
      .select()
      .single();
    if (error) throw error;

    await getSupabase().from('donors').update({ current_receivers: (donor.current_receivers || 0) + 1 }).eq('id', donor_id);

    // Notify donor
    const { data: d } = await getSupabase().from('donors').select('user_id').eq('id', donor_id).maybeSingle();
    if (d) websocket.sendToUser(d.user_id, { type: 'new_connection', connection, receiver });

    logger.info(`🔗 Connected: receiver ${userId} → donor ${donor_id}`);
    res.json({ message: 'Connected to donor', connection });
  } catch (err) {
    logger.error('Connect error:', err.message);
    res.status(500).json({ error: 'Connection failed', details: err.message });
  }
});

// ===== CATCH-ALL ROUTE LAST =====

// GET /api/transfer/:connectionId - Get transfer details
router.get('/:connectionId', async (req, res) => {
  try {
    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('id', req.params.connectionId)
      .maybeSingle();
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    res.json({ connection });
  } catch (err) {
    logger.error('Transfer details error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfer', details: err.message });
  }
});

module.exports = router;
