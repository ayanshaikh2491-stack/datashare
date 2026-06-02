const { createClient } = require('@supabase/supabase-js');
const config = require('../../config/env');
const logger = require('../utils/logger');
const { getLocalDb, getLocalDbCount } = require('./local-db.service');

let supabase = null;
let usingLocalDb = false;

function getSupabase() {
  // If already using local fallback, return that immediately
  if (usingLocalDb) {
    return getLocalDb();
  }

  // If real supabase already initialized, return it
  if (supabase) {
    return supabase;
  }

  // Try to initialize real Supabase
  if (config.SUPABASE_URL && config.SUPABASE_SERVICE_KEY &&
      !config.SUPABASE_URL.includes('localhost') &&
      !config.SUPABASE_URL.includes('mock')) {
    try {
      supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'public' },
        global: { headers: { 'X-Client-Info': 'datashare-server/v1' } }
      });
      logger.info('✅ Supabase client initialized');
      return supabase;
    } catch (err) {
      logger.warn(`⚠️ Supabase init failed: ${err.message}`);
    }
  }

  // Fallback to in-memory storage
  logger.warn('⚠️ Supabase not available — using in-memory storage fallback');
  logger.warn('💡 Set SUPABASE_URL and SUPABASE_SERVICE_KEY for persistent storage');
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
