const { createClient } = require('@supabase/supabase-js');
const config = require('../../config/env');
const logger = require('../utils/logger');

let supabase = null;

function getSupabase() {
  if (!supabase) {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
      logger.error('❌ Supabase credentials missing! Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
      throw new Error('Supabase credentials not configured');
    }
    
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'public' },
      global: { headers: { 'X-Client-Info': 'datashare-server/v1' } }
    });
    logger.info('✅ Supabase client initialized');
  }
  return supabase;
}

// Health check
async function checkSupabaseHealth() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('users').select('count').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    logger.info('✅ Supabase health check passed');
    return true;
  } catch (err) {
    logger.error('❌ Supabase health check failed:', err.message);
    return false;
  }
}

module.exports = { getSupabase, checkSupabaseHealth };
