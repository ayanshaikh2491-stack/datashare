// Keep-alive endpoint for Render free tier
// Render spins down after 15 min inactivity — this prevents it
const http = require('http');
const url = process.env.RENDER_SERVICE_URL || 'https://datashare-server.onrender.com';

// Ping self every 14 minutes (before Render spins down)
function keepAlive() {
  setInterval(() => {
    http.get(url + '/api/health', (res) => {
      console.log(`[${new Date().toISOString()}] Keep-alive ping: ${res.statusCode}`);
      res.resume();
    }).on('error', (err) => {
      console.error(`Keep-alive error: ${err.message}`);
    });
  }, 14 * 60 * 1000); // 14 minutes
}

module.exports = { keepAlive };
