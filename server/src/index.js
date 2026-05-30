const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('../config/env');
const logger = require('./utils/logger');
const { getSupabase, checkSupabaseHealth } = require('./services/supabase.service');
const headscale = require('./services/headscale.service');
const websocket = require('./services/websocket.service');

// Keep-alive: Prevent Render free tier from sleeping
let lastRequest = Date.now();
function keepAlivePing() {
  const serviceUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVICE_URL;
  if (!serviceUrl) return;
  setInterval(() => {
    http.get(`${serviceUrl}/api/health`, (res) => {
      res.resume();
      logger.info(`🔄 Keep-alive ping: ${res.statusCode}`);
    }).on('error', () => {});
  }, 14 * 60 * 1000); // Every 14 minutes (Render sleeps after 15 min)
  logger.info('🔄 Keep-alive started (pings every 14 min)');
}

// Routes
const authRoutes = require('./routes/auth.routes');
const donorRoutes = require('./routes/donor.routes');
const receiverRoutes = require('./routes/receiver.routes');
const usageRoutes = require('./routes/usage.routes');
const reviewRoutes = require('./routes/review.routes');
const transferRoutes = require('./routes/transfer.routes');

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
  // Force APK download with proper headers
  app.get('/app-release.apk', (req, res) => {
    const apkPath = path.join(webDir, 'app-release.apk');
    res.setHeader('Content-Disposition', 'attachment; filename="DataShare-v1.0.apk"');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.sendFile(apkPath);
  });
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const supabaseOk = await checkSupabaseHealth();
    const headscaleOk = await headscale.healthCheck().catch(() => false);
    const wsOnline = websocket.getOnlineCount();

    res.json({
      status: 'ok',
      version: '1.0.1',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        supabase: supabaseOk ? 'connected' : 'disconnected',
        headscale: headscaleOk ? 'connected' : 'disconnected',
        websocket: wsOnline
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

// Init WebSocket
websocket.init(server);

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

startServer();
