const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// GET /api/transfer/active — Get active transfers
router.get('/active', async (req, res) => {
  try {
    const userId = req.user.userId;
    let transfers = [];

    // As donor: get all active connections where I'm the donor
    const { data: donor } = await getSupabase()
      .from('donors').select('id').eq('user_id', userId).maybeSingle();

    if (donor) {
      const { data: conns } = await getSupabase()
        .from('connections')
        .select('*, receivers!connections_receiver_id_fkey(user_id)')
        .eq('donor_id', donor.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      if (conns) {
        transfers = transfers.concat(conns.map(c => ({ ...c, role: 'donor' })));
      }
    }

    // As receiver: get all active connections where I'm the receiver
    const { data: receiver } = await getSupabase()
      .from('receivers').select('id').eq('user_id', userId).maybeSingle();

    if (receiver) {
      const { data: conns } = await getSupabase()
        .from('connections')
        .select('*, donors!connections_donor_id_fkey(user_id)')
        .eq('receiver_id', receiver.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      if (conns) {
        transfers = transfers.concat(conns.map(c => ({ ...c, role: 'receiver' })));
      }
    }

    // Enrich with names
    if (transfers.length > 0) {
      const donorIds = [...new Set(transfers.map(t => t.donor_id))];
      const { data: donors } = await getSupabase()
        .from('donors').select('id, user_id').in('id', donorIds);
      const donorUserIds = (donors || []).map(d => d.user_id);
      const { data: donorUsers } = await getSupabase()
        .from('users').select('id, name').in('id', donorUserIds);
      const donorNameMap = {};
      (donorUsers || []).forEach(u => { donorNameMap[u.id] = u.name; });
      (donors || []).forEach(d => { donorNameMap[d.id] = donorNameMap[d.user_id] || 'Donor'; });

      const receiverIds = [...new Set(transfers.map(t => t.receiver_id))];
      const { data: receivers } = await getSupabase()
        .from('receivers').select('id, user_id').in('id', receiverIds);
      const receiverUserIds = (receivers || []).map(r => r.user_id);
      const { data: receiverUsers } = await getSupabase()
        .from('users').select('id, name').in('id', receiverUserIds);
      const receiverNameMap = {};
      (receiverUsers || []).forEach(u => { receiverNameMap[u.id] = u.name; });
      (receivers || []).forEach(r => { receiverNameMap[r.id] = receiverNameMap[r.user_id] || 'Receiver'; });

      transfers = transfers.map(t => ({
        ...t,
        donor_name: donorNameMap[t.donor_id] || 'Donor',
        receiver_name: receiverNameMap[t.receiver_id] || 'Receiver'
      }));
    }

    res.json({ transfers });
  } catch (err) {
    logger.error('Active transfers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfers', details: err.message });
  }
});

// POST /api/transfer/update — Update transfer progress (called periodically)
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

    // Notify both parties via WebSocket
    const update = {
      type: 'transfer_update',
      connection_id,
      data_mb: connection.data_transferred_mb || 0,
      speed_mbps: connection.transfer_speed_mbps || 0,
      is_transferring: connection.is_transferring || false
    };

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

// POST /api/transfer/complete — Mark transfer as complete
// H7: ownership-scoped to the connection's donor or receiver.
router.post('/complete', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { connection_id, final_data_mb } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

    // Look up first to authorize
    const { data: existing } = await getSupabase()
      .from('connections').select('id, donor_id, receiver_id').eq('id', connection_id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Connection not found' });

    const [{ data: donor }, { data: receiver }] = await Promise.all([
      getSupabase().from('donors').select('user_id').eq('id', existing.donor_id).maybeSingle(),
      getSupabase().from('receivers').select('user_id').eq('id', existing.receiver_id).maybeSingle()
    ]);
    if (donor?.user_id !== userId && receiver?.user_id !== userId) {
      return res.status(403).json({ error: 'Not a participant in this connection' });
    }

    if (final_data_mb !== undefined && (typeof final_data_mb !== 'number' || final_data_mb < 0 || final_data_mb > 1e7)) {
      return res.status(400).json({ error: 'final_data_mb out of range' });
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

    const update = {
      type: 'transfer_complete',
      connection_id,
      total_data_mb: connection?.data_transferred_mb || 0
    };
    if (donor?.user_id) websocket.sendToUser(donor.user_id, update);
    if (receiver?.user_id) websocket.sendToUser(receiver.user_id, update);

    logger.info(`Transfer complete: ${connection_id} - ${final_data_mb}MB`);
    res.json({ message: 'Transfer complete', total_mb: connection?.data_transferred_mb || 0 });
  } catch (err) {
    logger.error('Transfer complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete transfer', details: err.message });
  }
});

// POST /api/transfer/connect — Create a connection (receiver connects to donor)
router.post('/connect', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { donor_id, amount_mb } = req.body;
    if (!donor_id) return res.status(400).json({ error: 'donor_id required' });

    // Get or create receiver record
    let { data: receiver } = await getSupabase()
      .from('receivers').select('id').eq('user_id', userId).maybeSingle();

    if (!receiver) {
      const { data: newReceiver } = await getSupabase()
        .from('receivers').insert([{ user_id: userId, data_needed_mb: amount_mb || 100, status: 'connected' }])
        .select().single();
      if (!newReceiver) return res.status(400).json({ error: 'Failed to register as receiver' });
      receiver = newReceiver;
    }

    // Check donor
    const { data: donor } = await getSupabase().from('donors').select('*').eq('id', donor_id).maybeSingle();
    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if (donor.status !== 'online') return res.status(400).json({ error: 'Donor not online' });
    if (donor.current_receivers >= donor.max_receivers) return res.status(429).json({ error: 'Donor is full' });

    // Check for existing active connection
    const { data: existing } = await getSupabase()
      .from('connections').select('*').eq('receiver_id', receiver.id).eq('status', 'active').maybeSingle();
    if (existing) return res.status(409).json({ error: 'Already have active connection', connection: existing });

    // Create connection with transfer tracking initialized
    const { data: connection, error } = await getSupabase()
      .from('connections')
      .insert([{
        donor_id,
        receiver_id: receiver.id,
        started_at: new Date().toISOString(),
        status: 'active',
        data_transferred_mb: 0,
        transfer_speed_mbps: 0,
        is_transferring: true
      }])
      .select()
      .single();
    if (error) throw error;

    // Update donor receiver count
    await getSupabase().from('donors')
      .update({ current_receivers: (donor.current_receivers || 0) + 1 })
      .eq('id', donor_id);

    // Update receiver status
    await getSupabase().from('receivers')
      .update({ status: 'connected' })
      .eq('id', receiver.id);

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

// GET /api/transfer/:connectionId — Get transfer details
// L3: scoped to participants only.
router.get('/:connectionId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data: connection } = await getSupabase()
      .from('connections').select('*').eq('id', req.params.connectionId).maybeSingle();
    if (!connection) return res.status(404).json({ error: 'Connection not found' });

    // Look up donor/receiver user_ids
    const [{ data: donor }, { data: receiver }] = await Promise.all([
      getSupabase().from('donors').select('user_id').eq('id', connection.donor_id).maybeSingle(),
      getSupabase().from('receivers').select('user_id').eq('id', connection.receiver_id).maybeSingle()
    ]);

    if (donor?.user_id !== userId && receiver?.user_id !== userId) {
      return res.status(403).json({ error: 'Not a participant in this connection' });
    }

    res.json({ connection });
  } catch (err) {
    logger.error('Transfer details error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transfer', details: err.message });
  }
});

module.exports = router;
