const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../utils/logger');

// Verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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

// Generate token for user
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

// Verify user role
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

// Verify user owns the resource
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
