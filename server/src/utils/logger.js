// Simple lightweight logger (replaces Winston - saves ~5MB RAM)
const config = require('../../config/env');

const COLORS = {
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  debug: '\x1b[36m',   // cyan
  reset: '\x1b[0m'
};

function log(level, ...args) {
  const levels = ['error', 'warn', 'info', 'debug'];
  const currentLevel = levels.indexOf(config.LOG_LEVEL);
  const msgLevel = levels.indexOf(level);
  
  if (msgLevel > currentLevel) return;
  
  const time = new Date().toISOString().slice(11, 19);
  const prefix = `${time} [${level.toUpperCase()}]`;
  const color = COLORS[level] || COLORS.reset;
  
  console.log(`${color}${prefix}${COLORS.reset}`, ...args);
}

const logger = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  debug: (...args) => log('debug', ...args)
};

module.exports = logger;
