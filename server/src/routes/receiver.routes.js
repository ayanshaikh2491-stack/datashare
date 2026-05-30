const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const matching = require('../services/matching.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidation, rules } = require('../middleware/validation.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// ALIAS: Web app uses /donors (GET) to list online donors
router.get('/donors', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: onlineDonors } = await getSupabase()
      .from('donors')
      .select('id, user_id, location, max_receivers, current_receivers, status, settings, last_seen')
      .eq('status', 'online')
      .order('last_seen', { ascending: false });

    // Add donor names from users table
    const donors = onlineDonors || [];
    if (donors.length > 0) {
      const userIds = donors.map(d => d.user_id);
      const { data: users } = await getSupabase()
        .from('users')
        .select('id, name')
        .in('id', userIds);
      
      const userMap = {};
      (users || []).forEach(u => { userMap[u.id] = u.name; });
      donors.forEach(d => {
        d.name = userMap[d.user_id] || 'Donor';
      });
    }

    logger.info(`📡 ${donors.length} online donors found`);
    res.json({ donors, total: donors.length });
  } catch (err) {
    logger.error('Available donors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch donors', details: err.message });
  }
});

// ALIAS: Web app uses /requests (GET) to get user's requests
router.get('/requests', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const { data: connections } = await getSupabase()
      .from('connections')
      .select('id, donor_id, started_at, data_used_mb, status, ended_at')
      .eq('receiver_id', receiver.id)
      .order('started_at', { ascending: false })
      .limit(20);

    // Add donor names
    const requests = connections || [];
    if (requests.length > 0) {
      const donorIds = requests.map(r => r.donor_id);
      const { data: donors } = await getSupabase()
        .from('donors')
        .select('id, user_id')
        .in('id', donorIds);
      
      const donorUserIds = (donors || []).map(d => d.user_id);
      const { data: users } = await getSupabase()
        .from('users')
        .select('id, name')
        .in('id', donorUserIds);
      
      const userMap = {};
      (users || []).forEach(u => { userMap[u.id] = u.name; });
      const donorMap = {};
      (donors || []).forEach(d => { donorMap[d.id] = userMap[d.user_id] || 'Donor'; });
      
      requests.forEach(r => {
        r.donor_name = donorMap[r.donor_id] || 'Unknown';
        r.amount_requested = r.data_used_mb || 0;
      });
    }

    res.json({ requests, total: requests.length });
  } catch (err) {
    logger.error('Requests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch requests', details: err.message });
  }
});

// ALIAS: Web app uses /requests (POST) to create a data request
router.post('/requests', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount_mb, donor_id } = req.body;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    // Check for active connection
    const { data: activeConnection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('receiver_id', receiver.id)
      .eq('status', 'active')
      .single();

    if (activeConnection) {
      return res.status(409).json({ error: 'Already have active request', code: 'ALREADY_ACTIVE' });
    }

    if (donor_id) {
      // Request specific donor
      const { data: donor } = await getSupabase()
        .from('donors')
        .select('*')
        .eq('id', donor_id)
        .single();

      if (!donor) return res.status(404).json({ error: 'Donor not found' });
      if (donor.status !== 'online') return res.status(400).json({ error: 'Donor not online' });

      const { data: connection } = await getSupabase()
        .from('connections')
        .insert([{ donor_id, receiver_id: receiver.id, started_at: new Date().toISOString(), status: 'active' }])
        .select()
        .single();

      logger.info(`📡 Receiver ${userId} requested from donor ${donor_id}`);
      return res.json({ message: 'Request sent to donor', connection });
    }

    // Auto-match: find best available donor
    const { data: onlineDonors } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('status', 'online')
      .order('last_seen', { ascending: false })
      .limit(1);

    if (!onlineDonors || onlineDonors.length === 0) {
      return res.status(404).json({ error: 'No donors available online', code: 'NO_DONORS' });
    }

    const donor = onlineDonors[0];

    const { data: connection } = await getSupabase()
      .from('connections')
      .insert([{ donor_id: donor.id, receiver_id: receiver.id, started_at: new Date().toISOString(), status: 'active' }])
      .select()
      .single();

    await getSupabase()
      .from('donors')
      .update({ current_receivers: (donor.current_receivers || 0) + 1 })
      .eq('id', donor.id);

    await getSupabase()
      .from('receivers')
      .update({ data_needed_mb: amount_mb || receiver.data_needed_mb || 100, status: 'connected' })
      .eq('id', receiver.id);

    logger.info(`🔗 Auto-matched: receiver ${userId} → donor ${donor.id}`);
    res.json({ message: 'Connected to donor', connection, donor });
  } catch (err) {
    logger.error('Create request error:', err.message);
    res.status(500).json({ error: 'Request failed', details: err.message });
  }
});

// POST /api/receiver/register
router.post('/register', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: existing } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existing) {
      return res.json({ message: 'Already registered as receiver', receiver: existing });
    }

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .insert([{ user_id: userId, data_needed_mb: 0, status: 'disconnected' }])
      .select()
      .single();

    logger.info(`✅ Receiver registered: ${userId}`);
    res.status(201).json({ message: 'Receiver registered', receiver });
  } catch (err) {
    logger.error('Receiver registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// POST /api/receiver/request
router.post('/request', handleValidation(rules.location), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { location, data_needed_mb = 100 } = req.body;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayConnections } = await getSupabase()
      .from('connections')
      .select('id')
      .eq('receiver_id', receiver.id)
      .gte('started_at', todayStart.toISOString());

    const todayCount = todayConnections?.length || 0;
    if (todayCount >= 5) {
      return res.status(429).json({
        error: 'Daily donor limit reached (5/day)',
        code: 'DAILY_LIMIT_REACHED',
        connections_today: todayCount
      });
    }

    const { data: activeConnection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('receiver_id', receiver.id)
      .eq('status', 'active')
      .single();

    if (activeConnection) {
      return res.status(409).json({
        error: 'Already connected to a donor',
        code: 'ALREADY_CONNECTED',
        connection: activeConnection
      });
    }

    await getSupabase()
      .from('receivers')
      .update({ location, data_needed_mb, status: 'waiting' })
      .eq('id', receiver.id);

    const matchResult = await matching.findBestDonor(location, receiver.id);
    logger.info(`📡 Receiver ${userId} requesting data. Found ${matchResult.donors?.length || 0} donors`);

    res.json({
      message: matchResult.donors?.length > 0 ? 'Donors found' : 'No donors available',
      receiver: { id: receiver.id, status: 'waiting' },
      donors: matchResult.donors || [],
      total_donors: matchResult.total || 0,
      auto_match: matchResult.donors?.length > 0 ? matchResult.donors[0] : null
    });
  } catch (err) {
    logger.error('Request error:', err.message);
    res.status(500).json({ error: 'Request failed', details: err.message });
  }
});

// POST /api/receiver/connect
router.post('/connect', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { donor_id } = req.body;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('*')
      .eq('id', donor_id)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });
    if (donor.status !== 'online') {
      return res.status(400).json({ error: 'Donor is not online', code: 'DONOR_OFFLINE' });
    }
    if (donor.current_receivers >= donor.max_receivers) {
      return res.status(429).json({ error: 'Donor is at max capacity', code: 'DONOR_FULL' });
    }

    websocket.sendToUser(donor.user_id, {
      type: 'connection_request',
      receiver: { id: receiver.id, location: receiver.location, data_needed_mb: receiver.data_needed_mb },
      donor
    });

    logger.info(`📡 Receiver ${userId} requested connection to donor ${donor_id}`);
    res.json({ message: 'Connection request sent to donor', status: 'waiting_for_acceptance' });
  } catch (err) {
    logger.error('Connect error:', err.message);
    res.status(500).json({ error: 'Connection failed', details: err.message });
  }
});

// POST /api/receiver/auto-connect
router.post('/auto-connect', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const matchResult = await matching.autoMatch(receiver.id);

    if (!matchResult.success) {
      return res.status(matchResult.limit ? 429 : matchResult.cooldown ? 429 : 400).json({
        error: matchResult.error,
        code: matchResult.cooldown ? 'COOLDOWN' : matchResult.limit ? 'DAILY_LIMIT' : 'NO_MATCH'
      });
    }

    const donor = matchResult.donor;

    const { data: connection } = await getSupabase()
      .from('connections')
      .insert([{
        donor_id: donor.id,
        receiver_id: receiver.id,
        started_at: new Date().toISOString(),
        status: 'active'
      }])
      .select()
      .single();

    await getSupabase()
      .from('donors')
      .update({ current_receivers: (donor.current_receivers || 0) + 1, status: 'busy' })
      .eq('id', donor.id);

    await getSupabase()
      .from('receivers')
      .update({ status: 'connected' })
      .eq('id', receiver.id);

    websocket.sendToUser(donor.user_id, {
      type: 'receiver_connected_auto',
      connectionId: connection.id,
      receiver
    });
    websocket.sendToUser(userId, {
      type: 'connected',
      connectionId: connection.id,
      donor
    });

    logger.info(`🔗 Auto-connected: receiver ${userId} → donor ${donor.id}`);
    res.json({
      message: 'Connected to donor automatically',
      connection,
      donor: { id: donor.id, settings: donor.settings, location: donor.location }
    });
  } catch (err) {
    logger.error('Auto-connect error:', err.message);
    res.status(500).json({ error: 'Auto-connect failed', details: err.message });
  }
});

// POST /api/receiver/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('receiver_id', receiver.id)
      .eq('status', 'active')
      .single();

    if (!connection) return res.status(404).json({ error: 'No active connection' });

    await getSupabase()
      .from('connections')
      .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: 'receiver_disconnect' })
      .eq('id', connection.id);

    await getSupabase()
      .from('donors')
      .update({ current_receivers: Math.max(0, (connection.current_receivers || 1) - 1) })
      .eq('id', connection.donor_id);

    await getSupabase()
      .from('receivers')
      .update({ status: 'disconnected' })
      .eq('id', receiver.id);

    websocket.sendToUser(connection.user_id, {
      type: 'receiver_disconnected',
      receiverId: receiver.id,
      connectionId: connection.id
    });

    logger.info(`🔌 Receiver ${userId} disconnected`);
    res.json({ message: 'Disconnected successfully' });
  } catch (err) {
    logger.error('Disconnect error:', err.message);
    res.status(500).json({ error: 'Disconnect failed', details: err.message });
  }
});

// GET /api/receiver/available-donors
router.get('/available-donors', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const matchResult = await matching.findBestDonor(receiver.location, receiver.id);
    res.json({ donors: matchResult.donors || [], total: matchResult.total || 0, message: matchResult.message || '' });
  } catch (err) {
    logger.error('Available donors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch donors', details: err.message });
  }
});

// GET /api/receiver/status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not registered' });

    const { data: activeConnection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('receiver_id', receiver.id)
      .eq('status', 'active')
      .single();

    res.json({ receiver, active_connection: activeConnection, connected: !!activeConnection });
  } catch (err) {
    logger.error('Status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch status', details: err.message });
  }
});

module.exports = router;
