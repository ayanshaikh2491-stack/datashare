const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidation, rules } = require('../middleware/validation.middleware');
const config = require('../../config/env');
const logger = require('../utils/logger');

router.use(authenticateToken);

// POST /api/usage/report
router.post('/report', handleValidation(rules.usageReport), async (req, res) => {
  try {
    const { connection_id, data_mb, activity_type = 'general' } = req.body;

    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('id', connection_id)
      .single();

    if (!connection || connection.status !== 'active') {
      return res.status(404).json({ error: 'No active connection found', code: 'NO_ACTIVE_CONNECTION' });
    }

    await getSupabase()
      .from('usage_logs')
      .insert([{ connection_id, receiver_id: connection.receiver_id, data_mb, activity_type }]);

    const newDataUsed = (connection.data_used_mb || 0) + data_mb;
    await getSupabase()
      .from('connections')
      .update({ data_used_mb: newDataUsed })
      .eq('id', connection_id);

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('settings, current_receivers, user_id')
      .eq('id', connection.donor_id)
      .single();

    const dataLimitMB = donor?.settings?.data_limit_mb || config.DEFAULT_DATA_LIMIT_MB;

    if (newDataUsed >= dataLimitMB) {
      logger.warn(`🚨 Data limit exceeded: ${connection_id} (${newDataUsed}/${dataLimitMB} MB)`);

      await getSupabase()
        .from('connections')
        .update({ status: 'completed', ended_at: new Date().toISOString(), disconnect_reason: 'data_limit_exceeded' })
        .eq('id', connection_id);

      await getSupabase()
        .from('donors')
        .update({ current_receivers: Math.max(0, (donor?.current_receivers || 0) - 1) })
        .eq('id', connection.donor_id);

      websocket.sendToUser(connection.receiver_id, {
        type: 'disconnected',
        reason: 'Data limit exceeded by donor',
        data_used_mb: newDataUsed,
        data_limit_mb: dataLimitMB
      });

      if (donor?.user_id) {
        websocket.sendToUser(donor.user_id, {
          type: 'data_limit_reached',
          connectionId: connection_id,
          receiverId: connection.receiver_id,
          data_used_mb: newDataUsed
        });
      }

      return res.json({
        message: 'Usage reported. DISCONNECTED: data limit exceeded',
        data_used_mb: newDataUsed,
        data_limit_mb: dataLimitMB,
        disconnected: true
      });
    }

    websocket.sendToUser(connection.receiver_id, {
      type: 'usage_update',
      data_used_mb: newDataUsed,
      data_limit_mb: dataLimitMB,
      percent_used: Math.round((newDataUsed / dataLimitMB) * 100)
    });

    res.json({
      message: 'Usage reported',
      data_used_mb: newDataUsed,
      data_limit_mb: dataLimitMB,
      percent_used: Math.round((newDataUsed / dataLimitMB) * 100),
      disconnected: false
    });
  } catch (err) {
    logger.error('Usage report error:', err.message);
    res.status(500).json({ error: 'Failed to report usage', details: err.message });
  }
});

// GET /api/monitoring/stats
router.get('/stats', async (req, res) => {
  try {
    const wsOnline = websocket.getOnlineCount();

    const { data: donorCount } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('status', 'online');

    const { data: activeConnections } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('status', 'active');

    const { data: todayConnections } = await getSupabase()
      .from('connections')
      .select('data_used_mb')
      .gte('started_at', new Date().toISOString().split('T')[0]);

    const totalDataToday = (todayConnections || []).reduce((sum, c) => sum + (c.data_used_mb || 0), 0);

    res.json({
      online: { donors: donorCount?.length || 0, receivers: wsOnline.receivers, websocket_connections: wsOnline.total },
      active_connections: activeConnections?.length || 0,
      data_today_mb: totalDataToday,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
  }
});

// GET /api/monitoring/connection/:id
router.get('/connection/:id', async (req, res) => {
  try {
    const { data: connection } = await getSupabase()
      .from('connections')
      .select('*, donors (user_id, location, settings), receivers (user_id, location)')
      .eq('id', req.params.id)
      .single();

    if (!connection) return res.status(404).json({ error: 'Connection not found' });

    const { data: logs } = await getSupabase()
      .from('usage_logs')
      .select('*')
      .eq('connection_id', req.params.id)
      .order('timestamp', { ascending: false })
      .limit(10);

    res.json({ connection, recent_logs: logs || [] });
  } catch (err) {
    logger.error('Connection details error:', err.message);
    res.status(500).json({ error: 'Failed to fetch connection details', details: err.message });
  }
});

// GET /api/monitoring/donor-history
router.get('/donor-history', async (req, res) => {
  try {
    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', req.user.userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const { data: connections } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('donor_id', donor.id)
      .order('started_at', { ascending: false })
      .limit(50);

    const totalData = (connections || []).reduce((sum, c) => sum + (c.data_used_mb || 0), 0);

    res.json({ connections: connections || [], total_connections: connections?.length || 0, total_data_shared_mb: totalData });
  } catch (err) {
    logger.error('Donor history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});

module.exports = router;
