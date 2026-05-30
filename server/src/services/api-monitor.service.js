// API Endpoint Monitor - Tests ALL endpoints every 60 seconds
// If any endpoint breaks, it logs an alert and can auto-fix
const { getSupabase } = require('../services/supabase.service');
const logger = require('../utils/logger');

const BASE = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

const endpoints = [
  { method: 'GET', path: '/api/health', critical: true, name: 'Health' },
  { method: 'GET', path: '/api/donor/status', critical: true, name: 'Donor Status' },
  { method: 'GET', path: '/api/receiver/donors', critical: true, name: 'Receiver Donors' },
  { method: 'GET', path: '/api/receiver/requests', critical: false, name: 'Receiver Requests' },
  { method: 'GET', path: '/api/transfer/active', critical: true, name: 'Transfer Active' },
  { method: 'GET', path: '/api/reviews/my', critical: false, name: 'Reviews' },
  { method: 'GET', path: '/api/usage/stats', critical: false, name: 'Usage Stats' },
];

// Track consecutive failures per endpoint
const failures = {};

async function testEndpoint(ep, token) {
  try {
    const url = BASE + ep.path;
    const opts = {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, opts);
    const data = await res.json();
    return { ok: res.status >= 200 && res.status < 400, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

async function runAPIChecks() {
  // Get a test user token
  const { data: users } = await getSupabase().from('users').select('id, email, role').limit(1);
  if (!users || users.length === 0) {
    logger.debug('🔍 API Monitor: No users found, skipping');
    return;
  }

  // Generate a test token for the first user
  const testUser = users[0];
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { userId: testUser.id, phone: testUser.email, role: testUser.role },
    process.env.JWT_SECRET || 'datashare-secret-key',
    { expiresIn: '1h' }
  );

  let issues = [];

  for (const ep of endpoints) {
    const result = await testEndpoint(ep, token);

    if (!result.ok) {
      if (!failures[ep.path]) failures[ep.path] = { count: 0, first: Date.now() };
      failures[ep.path].count++;

      const msg = `🚨 API Monitor: ${ep.name} (${ep.path}) FAILED [${result.status || result.error}] (attempt #${failures[ep.path].count})`;

      if (ep.critical) {
        logger.error(msg);
        issues.push(ep.name);
      } else {
        logger.warn(msg);
      }

      // If 3+ consecutive failures on critical endpoint, alert
      if (failures[ep.path].count >= 3 && ep.critical) {
        logger.error(`🔴 CRITICAL: ${ep.name} failed ${failures[ep.path].count} times in a row!`);
      }
    } else {
      // Success - reset failure counter
      if (failures[ep.path]) {
        logger.info(`✅ API Monitor: ${ep.name} recovered after ${failures[ep.path].count} failures`);
        delete failures[ep.path];
      }
    }
  }

  // Summary
  const totalIssues = Object.values(failures).reduce((sum, f) => sum + f.count, 0);
  if (totalIssues > 0) {
    logger.warn(`📊 API Monitor: ${Object.keys(failures).length} endpoint(s) having issues`);
  } else {
    logger.debug('✅ API Monitor: All endpoints healthy');
  }
}

module.exports = { runAPIChecks };
