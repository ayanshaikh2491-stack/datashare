// Auto-transfer progress simulator
// When a connection is active, this simulates realistic data transfer
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const logger = require('../utils/logger');

// Speed ranges in MB/s (simulating real WiFi Direct / hotspot speeds)
const SPEED_MIN = 2;   // 2 MB/s minimum
const SPEED_MAX = 15;  // 15 MB/s max
const INTERVAL_MS = 5000; // Update every 5 seconds

function randomSpeed() {
  return SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
}

async function simulateTransferProgress() {
  try {
    const { data: connections } = await getSupabase()
      .from('connections')
      .select('*')
      .eq('status', 'active')
      .eq('is_transferring', true);

    if (!connections || connections.length === 0) return;

    for (const conn of connections) {
      const currentMB = conn.data_transferred_mb || 0;
      const speed = randomSpeed();
      const dataGained = speed * (INTERVAL_MS / 1000); // MB gained in this interval
      const newTotal = currentMB + dataGained;

      // Check if limit reached (default 500MB)
      const limit = 500;
      if (newTotal >= limit) {
        // Transfer complete
        await getSupabase()
          .from('connections')
          .update({
            data_transferred_mb: limit,
            transfer_speed_mbps: 0,
            is_transferring: false
          })
          .eq('id', conn.id);

        // Decrease donor's current receivers
        await getSupabase()
          .from('donors')
          .update({ current_receivers: Math.max(0, (conn.current_receivers || 1) - 1) })
          .eq('id', conn.donor_id);

        // Notify both parties
        const complete = { type: 'transfer_complete', connection_id: conn.id, total_data_mb: limit };
        if (conn.donor_id) {
          const { data: d } = await getSupabase().from('donors').select('user_id').eq('id', conn.donor_id).maybeSingle();
          if (d) websocket.sendToUser(d.user_id, complete);
        }
        if (conn.receiver_id) {
          const { data: r } = await getSupabase().from('receivers').select('user_id').eq('id', conn.receiver_id).maybeSingle();
          if (r) websocket.sendToUser(r.user_id, complete);
        }
        logger.info(`✅ Transfer complete: ${conn.id} - ${limit}MB`);
      } else {
        // Update progress
        await getSupabase()
          .from('connections')
          .update({
            data_transferred_mb: newTotal,
            transfer_speed_mbps: speed
          })
          .eq('id', conn.id);

        // Notify both parties
        const update = { type: 'transfer_update', connection_id: conn.id, data_mb: newTotal, speed_mbps: speed, is_transferring: true };
        if (conn.donor_id) {
          const { data: d } = await getSupabase().from('donors').select('user_id').eq('id', conn.donor_id).maybeSingle();
          if (d) websocket.sendToUser(d.user_id, update);
        }
        if (conn.receiver_id) {
          const { data: r } = await getSupabase().from('receivers').select('user_id').eq('id', conn.receiver_id).maybeSingle();
          if (r) websocket.sendToUser(r.user_id, update);
        }
      }
    }
  } catch (err) {
    logger.error('Transfer simulation error:', err.message);
  }
}

let intervalId = null;

function startTransferSimulator() {
  if (intervalId) return;
  logger.info('🔄 Transfer progress simulator started (5s interval)');
  intervalId = setInterval(simulateTransferProgress, INTERVAL_MS);
}

function stopTransferSimulator() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('⏹ Transfer simulator stopped');
  }
}

module.exports = { startTransferSimulator, stopTransferSimulator, simulateTransferProgress };
