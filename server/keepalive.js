// One-shot keep-alive ping. Called by cron/CI every 5 minutes.
// Usage: node server/keepalive.js  (RELAY_URL env overrides target)
const TARGET = process.env.RELAY_URL || 'https://ayanshaikh2-datashare-relay.hf.space/';
fetch(TARGET).then(r => {
  console.log(`[${new Date().toISOString()}] relay ping -> ${r.status}`);
  process.exit(r.status === 200 ? 0 : 1);
}).catch(e => {
  console.error(`[${new Date().toISOString()}] ping error: ${e.message}`);
  process.exit(1);
});
