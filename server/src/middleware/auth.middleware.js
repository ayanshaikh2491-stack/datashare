const jwt = require('jsonwebtoken');
const config = require('../../config/env');
const logger = require('../utils/logger');

/**
 * Lightweight cookie parser. Avoids adding the `cookie-parser`
 * dependency; only handles a single named cookie (ds_token).
 */
function parseCookie(header, name) {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Extract a JWT from either the Authorization header (Bearer ...) or the
 * `ds_token` httpOnly cookie set by /api/auth/login-or-register (C5).
 */
function extractToken(req) {
  const fromCookie = parseCookie(req.headers.cookie, 'ds_token');
  if (fromCookie) return fromCookie;

  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  }
  return null;
}

function authenticateToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('Invalid token:', err.message);
    return res.status(403).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      phone: user.phone,
      role: user.role
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRY }
  );
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    }
    if (!roles.includes(req.user.role) && !roles.includes('both')) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'WRONG_ROLE' });
    }
    next();
  };
}

function verifyOwnership(getResourceOwnerId) {
  return (req, res, next) => {
    const ownerId = getResourceOwnerId(req);
    if (ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied', code: 'NOT_OWNER' });
    }
    next();
  };
}

module.exports = { authenticateToken, generateToken, requireRole, verifyOwnership };
