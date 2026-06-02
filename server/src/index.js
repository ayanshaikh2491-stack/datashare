const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('../config/env');
const logger = require('./utils/logger');
const { getSupabase, checkSupabaseHealth } = require('./services/supabase.service');
const headscale = require('./services/headscale.service');

const transferSimulator = require('./services/transfer-simulator.service');
const monitoringAgents = require('./services/monitoring-agents.service');
const apiMonitor = require('./services/api-monitor.service');
const vpnTunnel = require('./services/vpn-tunnel.service');

// Keep-alive: Prevent Render free tier from sleeping
// Render free tier sleeps after 15 min of inactivity
// We ping every 5 min to stay awake
let lastRequest = Date.now();
let keepAliveCount = 0;
function keepAlivePing() {
  const serviceUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVICE_URL;
  if (!serviceUrl) {
    // Fallback: use the actual deployed URL
    logger.warn('⚠️ No RENDER_EXTERNAL_URL set — keep-alive disabled');
    return;
  }
  // Ping immediately on start
  http.get(`${serviceUrl}/api/health`, (res) => {
    res.resume();
    logger.info(`🔄 Keep-alive ping #${++keepAliveCount}: ${res.statusCode}`);
  }).on('error', (e) => logger.warn(`⚠️ Keep-alive error: ${e.message}`));
  // Then every 5 minutes
  setInterval(() => {
    http.get(`${serviceUrl}/api/health`, (res) => {
      res.resume();
      logger.info(`🔄 Keep-alive ping #${++keepAliveCount}: ${res.statusCode}`);
    }).on('error', (e) => logger.warn(`⚠️ Keep-alive error: ${e.message}`));
  }, 5 * 60 * 1000); // Every 5 minutes
  logger.info('🔄 Keep-alive started (pings every 5 min)');
}

// Routes
const authRoutes = require('./routes/auth.routes');
const donorRoutes = require('./routes/donor.routes');
const receiverRoutes = require('./routes/receiver.routes');
const usageRoutes = require('./routes/usage.routes');
const reviewRoutes = require('./routes/review.routes');
const transferRoutes = require('./routes/transfer.routes');
const webrtcRoutes = require('./routes/webrtc.routes');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple rate limiting (lightweight, no extra package)
const rateLimiter = new Map();
app.use((req, res, next) => {
  lastRequest = Date.now(); // Track last request for keep-alive
  const ip = req.ip;
  const now = Date.now();
  const window = config.RATE_LIMIT_WINDOW_MS;
  const max = config.RATE_LIMIT_MAX_REQUESTS;

  if (!rateLimiter.has(ip)) rateLimiter.set(ip, []);
  const requests = rateLimiter.get(ip).filter(t => now - t < window);
  rateLimiter.set(ip, requests);

  if (requests.length >= max) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  requests.push(now);
  next();
});

// Serve web app (static files) — NO CACHE for HTML
const webDir = path.join(__dirname, '../../web');
if (fs.existsSync(webDir)) {
  // Serve static files WITHOUT index.html auto-serve
  app.use(express.static(webDir, { index: false, maxAge: '1d' }));

  // No-cache routes for HTML — must come AFTER static
  app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  app.get('/download', (req, res) => {
    res.sendFile(path.join(webDir, 'download.html'));
  });
  app.get('/', (req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });
  // Force APK download with proper headers — prefer GitHub release
  app.get('/app-release.apk', async (req, res) => {
    // Redirect to GitHub release for always-fresh APK
    const githubUrl = 'https://github.com/ayanshaikh2491-stack/datashare/releases/latest/download/app-debug.apk';
    res.redirect(302, githubUrl);
  });
}

// App version check (for auto-update) — tries GitHub first, falls back to local
app.get('/api/app/version', async (req, res) => {
  try {
    // Try to get latest version from GitHub (always fresh)
    const response = await fetch('https://raw.githubusercontent.com/ayanshaikh2491-stack/datashare/main/web/version.json', {
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      res.json(data);
      return;
    }
  } catch (e) {
    // GitHub unreachable, fall through to local
  }
  
  // Fallback: local file
  const versionPath = path.join(webDir, 'version.json');
  if (fs.existsSync(versionPath)) {
    res.sendFile(versionPath);
  } else {
    res.json({
      versionCode: 8,
      versionName: '5.3.0',
      updateUrl: 'https://github.com/ayanshaikh2491-stack/datashare/releases/latest/download/app-debug.apk',
      forceUpdate: false
    });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const supabaseOk = await checkSupabaseHealth();
    const headscaleOk = await headscale.healthCheck().catch(() => false);
    const vpnStats = vpnTunnel.getVpnStats();

    res.json({
      status: 'ok',
      version: '1.0.1',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        supabase: supabaseOk ? 'connected' : 'disconnected',
        headscale: headscaleOk ? 'connected' : 'disconnected',
        websocket: {
          total: 0,
          donors: vpnStats.activeDonors,
          receivers: vpnStats.pendingReceivers
        },
        vpnTunnel: {
          sessions: vpnTunnel.getVpnStats().activeSessions,
          donors: vpnTunnel.getVpnStats().activeDonors,
          receivers: vpnTunnel.getVpnStats().pendingReceivers
        }
      },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      }
    });
  } catch (err) {
    res.json({ status: 'degraded', error: err.message });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/donor', donorRoutes);
app.use('/api/receiver', receiverRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/monitoring', usageRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/webrtc', webrtcRoutes);

// Frontend error reporter — browser errors get sent here
app.post('/api/report-error', (req, res) => {
  const { error, url, line, userAgent, timestamp } = req.body;
  logger.error(`🖥️ FRONTEND ERROR: ${error} at ${url}:${line} (${userAgent})`);
  res.json({ message: 'Error reported' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: config.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Init VPN Tunnel WebSocket FIRST (for native Android VPN app on /ws-vpn)
vpnTunnel.initVpnTunnel(server);
logger.info('🔐 VPN Tunnel WebSocket initialized on /ws-vpn');

// WebSocket is handled by vpnTunnel.initVpnTunnel (merged: /ws-vpn, /ws, /)

// Start server
async function startServer() {
  // Init Headscale (optional)
  const headscaleReady = await headscale.initialize();
  if (!headscaleReady) {
    logger.warn('⚠️  Headscale not available — mesh network features limited');
    logger.warn('💡 Install Headscale: https://github.com/juanfont/headscale');
  }

  // Check Supabase
  try {
    const supabaseReady = await checkSupabaseHealth();
    if (!supabaseReady) {
      logger.error('❌ Supabase connection failed — check SUPABASE_URL and SUPABASE_SERVICE_KEY');
    }
  } catch (err) {
    logger.error('❌ Supabase not configured yet');
  }

  server.listen(config.PORT, () => {
    logger.info('='.repeat(50));
    logger.info('🚀 DataShare Server Started');
    logger.info(`📡 Server: http://localhost:${config.PORT}`);
    logger.info(`🌐 Environment: ${config.NODE_ENV}`);
    logger.info(`🧠 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
    logger.info('='.repeat(50));
    keepAlivePing(); // Start keep-alive to prevent Render sleep
    // Start 10 monitoring agents (auto-fix backend issues silently)
    monitoringAgents.startAllAgents();
    // Start API endpoint monitor (tests all endpoints every 60s)
    setInterval(() => apiMonitor.runAPIChecks(), 60000);
    setTimeout(() => apiMonitor.runAPIChecks(), 5000); // First check after 5s
    logger.info('🔍 API endpoint monitor started (60s interval)');
    // NO fake transfer simulator — only REAL WebRTC transfer data will be shown
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('🛑 Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('🛑 Shutting down...');
  server.close(() => process.exit(0));
});

// Prevent crash on unhandled errors (Supabase missing, etc.)
process.on('uncaughtException', (err) => {
  logger.error(`💥 Uncaught: ${err.message}`);
  logger.debug(err.stack);
});

process.on('unhandledRejection', (err) => {
  logger.error(`💥 Unhandled Rejection: ${err.message}`);
});

startServer();
