// Pre-deploy checker: Tests ALL endpoints before allowing deploy
// If any critical endpoint fails, deploy is blocked
const http = require('http');

const BASE = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const TOKEN = process.env.TEST_TOKEN || '';

const criticalEndpoints = [
  { method: 'GET', path: '/api/health', name: 'Health Check' },
  { method: 'GET', path: '/api/transfer/active', name: 'Active Transfers', auth: true },
  { method: 'GET', path: '/api/receiver/donors', name: 'Receiver Donors', auth: true },
  { method: 'GET', path: '/api/reviews/my', name: 'Reviews', auth: true },
  { method: 'GET', path: '/api/donor/status', name: 'Donor Status', auth: true },
  { method: 'GET', path: '/api/usage/stats', name: 'Usage Stats', auth: true },
];

function fetch(ep, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: new URL(BASE).hostname,
      port: new URL(BASE).port || 80,
      path: ep.path,
      method: ep.method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (ep.auth && token) opts.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function runChecks() {
  console.log('🔍 Pre-deploy check started...');
  let passed = 0, failed = 0;

  for (const ep of criticalEndpoints) {
    try {
      const r = await fetch(ep, TOKEN);
      if (r.status >= 200 && r.status < 400) {
        console.log(`  ✅ ${ep.name} (${ep.method} ${ep.path}) → ${r.status}`);
        passed++;
      } else {
        console.log(`  ❌ ${ep.name} (${ep.method} ${ep.path}) → ${r.status} ${JSON.stringify(r.data)}`);
        failed++;
      }
    } catch(e) {
      console.log(`  ❌ ${ep.name} (${ep.method} ${ep.path}) → ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${criticalEndpoints.length}`);

  if (failed > 0) {
    console.log('\n🚨 CRITICAL: Some endpoints are broken! Fix before deploying.');
    process.exit(1);
  } else {
    console.log('\n✅ All endpoints working. Safe to deploy!');
    process.exit(0);
  }
}

runChecks();
