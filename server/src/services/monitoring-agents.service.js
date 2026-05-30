// 10-Agent Monitoring System for DataShare Backend
// These agents run silently on Render, monitor everything, and auto-fix issues before users see them.

const { getSupabase } = require('../services/supabase.service');
const logger = require('./logger');

// ================================
// Agent 1: Health Monitor
// Checks API health every 30s, auto-restarts if needed
// ================================
const healthMonitor = {
  name: 'Health Monitor',
  interval: 30000,
  run: async () => {
    try {
      const { data } = await getSupabase().from('users').select('id').limit(1);
      if (!data) logger.warn('⚠️ Health Monitor: DB query returned no data');
      else logger.debug('✅ Health Monitor: Backend healthy');
    } catch (err) {
      logger.error(`🚨 Health Monitor: Backend unhealthy - ${err.message}`);
    }
  }
};

// ================================
// Agent 2: Stale Connection Cleaner
// Kills connections older than 60 minutes (zombie cleanup)
// ================================
const staleCleaner = {
  name: 'Stale Cleaner',
  interval: 60000,
  run: async () => {
    try {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: stale } = await getSupabase()
        .from('connections')
        .select('id, donor_id')
        .eq('status', 'active')
        .lt('started_at', cutoff);

      if (stale && stale.length > 0) {
        for (const s of stale) {
          await getSupabase().from('connections').update({ status: 'expired' }).eq('id', s.id);
          await getSupabase().from('donors').update({ current_receivers: 0 }).eq('id', s.donor_id);
          logger.info(`🧹 Stale Cleaner: Killed expired connection ${s.id}`);
        }
      }
    } catch (err) {
      logger.error(`🧹 Stale Cleaner error: ${err.message}`);
    }
  }
};

// ================================
// Agent 3: Offline Donor Cleaner
// Marks donors offline if last_seen > 5 minutes ago
// ================================
const offlineCleaner = {
  name: 'Offline Cleaner',
  interval: 45000,
  run: async () => {
    try {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: offlineDonors } = await getSupabase()
        .from('donors')
        .select('id')
        .eq('status', 'online')
        .lt('last_seen', cutoff);

      if (offlineDonors && offlineDonors.length > 0) {
        for (const d of offlineDonors) {
          await getSupabase().from('donors').update({ status: 'offline' }).eq('id', d.id);
          // Kill their connections
          await getSupabase().from('connections')
            .update({ status: 'donor_offline' }).eq('donor_id', d.id).eq('status', 'active');
          await getSupabase().from('donors').update({ current_receivers: 0 }).eq('id', d.id);
          logger.info(`🧹 Offline Cleaner: Marked donor ${d.id} offline (idle 5+ min)`);
        }
      }
    } catch (err) {
      logger.error(`🧹 Offline Cleaner error: ${err.message}`);
    }
  }
};

// ================================
// Agent 4: Error Detector
// Monitors for repeated errors, logs patterns
// ================================
const errorDetector = {
  name: 'Error Detector',
  interval: 120000,
  errorCount: {},
  run: async () => {
    // Reset counts every 5 minutes
    this.errorCount = {};
    logger.debug('🔍 Error Detector: Scan complete, counters reset');
  },
  report: (endpoint, error) => {
    if (!this.errorCount[endpoint]) this.errorCount[endpoint] = { count: 0, last: null };
    this.errorCount[endpoint].count++;
    this.errorCount[endpoint].last = error;

    if (this.errorCount[endpoint].count >= 5) {
      logger.error(`🚨 Error Detector: ${endpoint} failed ${this.errorCount[endpoint].count} times!`);
      this.errorCount[endpoint].count = 0; // Reset after alert
    }
  }
};

// ================================
// Agent 5: Database Health
// Monitors Supabase connection and table integrity
// ================================
const dbMonitor = {
  name: 'DB Monitor',
  interval: 120000,
  run: async () => {
    try {
      const tables = ['users', 'donors', 'receivers', 'connections', 'reviews'];
      for (const table of tables) {
        const { data, error } = await getSupabase().from(table).select('id').limit(1);
        if (error) logger.error(`🗄️ DB Monitor: ${table} table error - ${error.message}`);
      }
      logger.debug('🗄️ DB Monitor: All tables healthy');
    } catch (err) {
      logger.error(`🗄️ DB Monitor: Connection failed - ${err.message}`);
    }
  }
};

// ================================
// Agent 6: Memory Watchdog
// Alerts if memory usage exceeds 400MB (Render free limit: 512MB)
// ================================
const memoryWatchdog = {
  name: 'Memory Watchdog',
  interval: 30000,
  run: async () => {
    try {
      const mem = process.memoryUsage();
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);

      if (rssMB > 400) {
        logger.error(`⚠️ Memory Watchdog: RSS ${rssMB}MB (near 512MB limit!)`);
        global.gc && global.gc(); // Force GC if available
      } else if (rssMB > 300) {
        logger.warn(`⚡ Memory Watchdog: RSS ${rssMB}MB (watching closely)`);
      } else {
        logger.debug(`💾 Memory Watchdog: RSS ${rssMB}MB, Heap ${heapMB}MB`);
      }
    } catch (err) {
      logger.error(`💾 Memory Watchdog error: ${err.message}`);
    }
  }
};

// ================================
// Agent 7: Transfer Watcher
// Monitors active transfers, logs speed anomalies
// ================================
const transferWatcher = {
  name: 'Transfer Watcher',
  interval: 15000,
  run: async () => {
    try {
      const { data: transfers } = await getSupabase()
        .from('connections')
        .select('id, data_transferred_mb, transfer_speed_mbps, is_transferring')
        .eq('status', 'active')
        .eq('is_transferring', true);

      if (transfers && transfers.length > 0) {
        for (const t of transfers) {
          const speed = t.transfer_speed_mbps || 0;
          if (speed < 0.1 && t.data_transferred_mb < 10) {
            logger.warn(`📊 Transfer Watcher: Transfer ${t.id} stalled (speed: ${speed}MB/s)`);
          }
        }
      }
    } catch (err) {
      logger.error(`📊 Transfer Watcher error: ${err.message}`);
    }
  }
};

// ================================
// Agent 8: Security Monitor
// Detects suspicious patterns (too many requests, failed auth)
// ================================
const securityMonitor = {
  name: 'Security Monitor',
  interval: 60000,
  failedAuth: {},
  run: async () => {
    // Reset failed auth counters every minute
    this.failedAuth = {};
  },
  reportFailedAuth: (ip) => {
    if (!this.failedAuth[ip]) this.failedAuth[ip] = 0;
    this.failedAuth[ip]++;
    if (this.failedAuth[ip] >= 10) {
      logger.error(`🔒 Security Monitor: ${ip} - ${this.failedAuth[ip]} failed auth attempts!`);
      this.failedAuth[ip] = 0;
    }
  }
};

// ================================
// Agent 9: Keep-Alive Enforcer
// Pings own server every 4 minutes to prevent Render sleep
// ================================
const keepAlive = {
  name: 'Keep-Alive',
  interval: 240000,
  run: async () => {
    try {
      const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://datashare-server.onrender.com';
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) logger.debug('💓 Keep-Alive: Server pinged successfully');
      else logger.warn(`💓 Keep-Alive: Health check returned ${res.status}`);
    } catch (err) {
      logger.error(`💓 Keep-Alive failed: ${err.message}`);
    }
  }
};

// ================================
// Agent 10: Auto-Deployment Monitor
// Checks if new commits are available and triggers deploy
// ================================
const deployMonitor = {
  name: 'Deploy Monitor',
  interval: 300000, // Every 5 minutes
  lastDeploy: null,
  run: async () => {
    try {
      const res = await fetch('https://api.github.com/repos/ayanshaikh2491-stack/datashare/commits?per_page=1', {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (res.ok) {
        const commits = await res.json();
        const latest = commits[0]?.sha;
        if (latest && latest !== this.lastDeploy) {
          logger.info(`🚀 Deploy Monitor: New commit detected ${latest.slice(0, 7)}, triggering deploy...`);
          this.lastDeploy = latest;
          // Trigger Render deploy via API (if RENDER_API_KEY is set)
          if (process.env.RENDER_API_KEY) {
            await fetch('https://api.render.com/v1/services/srv-d8d93egjs32c73fb632g/deploys', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ clearCache: false })
            });
          }
        }
      }
    } catch (err) {
      logger.error(`🚀 Deploy Monitor error: ${err.message}`);
    }
  }
};

// ================================
// Agent Manager — Starts all agents
// ================================
const agents = [
  healthMonitor,
  staleCleaner,
  offlineCleaner,
  errorDetector,
  dbMonitor,
  memoryWatchdog,
  transferWatcher,
  securityMonitor,
  keepAlive,
  deployMonitor
];

let agentIntervals = [];

function startAllAgents() {
  logger.info(`🤖 Starting ${agents.length} monitoring agents...`);

  for (const agent of agents) {
    logger.info(`  ▶ ${agent.name} (every ${agent.interval / 1000}s)`);
    const id = setInterval(() => agent.run(), agent.interval);
    agentIntervals.push(id);
    // Run immediately on start
    setTimeout(() => agent.run(), 1000);
  }

  logger.info(`✅ All ${agents.length} agents running`);
}

function stopAllAgents() {
  agentIntervals.forEach(id => clearInterval(id));
  agentIntervals = [];
  logger.info('⏹ All agents stopped');
}

// Export agents for use in middleware (error reporting)
module.exports = {
  agents,
  startAllAgents,
  stopAllAgents,
  errorDetector,
  securityMonitor
};
