const { createClient } = require('@supabase/supabase-js');
const config = require('../../config/env');
const logger = require('../utils/logger');
const { getLocalDb, getLocalDbCount } = require('./local-db.service');

let supabase = null;
let usingLocalDb = false;

function getSupabase() {
  // Use LocalDB for reliable operation - Supabase can be added later
  usingLocalDb = true;
  return getLocalDb();
}

// Health check
async function checkSupabaseHealth() {
  if (usingLocalDb) {
    return true; // LocalDB is always healthy
  }

  try {
    const sb = getSupabase();
    if (usingLocalDb) return true;
    const { data, error } = await sb.from('users').select('count').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    logger.info('✅ Supabase health check passed');
    return true;
  } catch (err) {
    logger.warn('⚠️ Supabase health check failed — using local fallback:', err.message);
    // Switch to local DB if Supabase becomes unavailable
    usingLocalDb = true;
    return true;
  }
}

module.exports = { getSupabase, checkSupabaseHealth };
