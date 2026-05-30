require('dotenv').config({ path: '../config/.env' });

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  
  // Headscale (Open Source)
  HEADSCALE_URL: process.env.HEADSCALE_URL || 'http://localhost:8080',
  HEADSCALE_API_KEY: process.env.HEADSCALE_API_KEY,
  HEADSCALE_NAMESPACE: process.env.HEADSCALE_NAMESPACE || 'datashare',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-to-super-secret-key',
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  
  // Donor Settings
  MAX_CONNECTIONS_PER_DONOR: parseInt(process.env.MAX_CONNECTIONS_PER_DONOR) || 3,
  DEFAULT_DATA_LIMIT_MB: parseInt(process.env.DEFAULT_DATA_LIMIT_MB) || 500,
  DEFAULT_SESSION_TIME_MIN: parseInt(process.env.DEFAULT_SESSION_TIME_MIN) || 60,
  DEFAULT_DAILY_TOTAL_GB: parseInt(process.env.DEFAULT_DAILY_TOTAL_GB) || 5,
  
  // Receiver Settings
  MAX_RECEIVERS_PER_DAY: parseInt(process.env.MAX_RECEIVERS_PER_DAY) || 5,
  MAX_DATA_PER_RECEIVER_MB: parseInt(process.env.MAX_DATA_PER_RECEIVER_MB) || 2048,
  CONNECTION_COOLDOWN_SEC: parseInt(process.env.CONNECTION_COOLDOWN_SEC) || 600,
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
