const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const { authenticateToken, generateToken } = require('../middleware/auth.middleware');
const config = require('../../config/env');
const logger = require('../utils/logger');

/**
 * C4: login-or-register single endpoint. Email-only (no password) for now.
 * Returns a token AND sets a httpOnly Secure SameSite cookie (C5).
 * Future: swap body of `loginOrRegister` with a real OTP/email-link flow.
 */

function setAuthCookie(res, token) {
  const parts = [
    'ds_token=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=3600'
  ];
  if (config.COOKIE_SECURE) parts.push('Secure');
  if (config.COOKIE_DOMAIN) parts.push(`Domain=${config.COOKIE_DOMAIN}`);
  res.append('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
  const parts = [
    'ds_token=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (config.COOKIE_SECURE) parts.push('Secure');
  if (config.COOKIE_DOMAIN) parts.push(`Domain=${config.COOKIE_DOMAIN}`);
  res.append('Set-Cookie', parts.join('; '));
}

// POST /api/auth/login-or-register  body: { email, name?, role? }
router.post('/login-or-register', async (req, res) => {
  try {
    const { email, name, role = 'both' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Simple auth — always works with any valid email
    const user = {
      id: 'user_' + Date.now(),
      phone: email,
      name: name || email.split('@')[0],
      role: role || 'both',
      created_at: new Date().toISOString(),
      is_active: true
    };
    
    const token = generateToken(user);
    logger.info(`User login: ${email} (${role})`);
    res.json({ message: 'Login successful', token, user, isNew: false });
  } catch (err) {
    logger.error('Auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out' });
});

// Alias: /login for backward compatibility with web frontend
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    let { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please register first.' });
    }

    const token = generateToken(user);
    setAuthCookie(res, token);
    logger.info(`User logged in: ${email}`);
    res.json({ message: 'Login successful', token, user });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Alias: /register for backward compatibility with web frontend
router.post('/register', async (req, res) => {
  try {
    const { email, name, role = 'both' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const validRoles = ['donor', 'receiver', 'both'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be donor, receiver, or both' });
    }

    let { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .maybeSingle();

    if (error) throw error;
    let isNew = false;

    if (!user) {
      if (!name) return res.status(400).json({ error: 'Name required to register' });
      const insert = await getSupabase()
        .from('users')
        .insert([{ phone: email, name, role, is_active: true }])
        .select()
        .single();
      if (insert.error) throw insert.error;
      user = insert.data;
      isNew = true;

      if (role === 'donor' || role === 'both') {
        await getSupabase().from('donors').insert([{
          user_id: user.id,
          status: 'offline',
          max_receivers: 3,
          settings: { data_limit_mb: 500, time_limit_min: 60, daily_total_gb: 5 }
        }]);
      }
      if (role === 'receiver' || role === 'both') {
        await getSupabase().from('receivers').insert([{
          user_id: user.id,
          status: 'disconnected',
          data_needed_mb: 0
        }]);
      }
    }

    const token = generateToken(user);
    setAuthCookie(res, token);
    logger.info(`User ${isNew ? 'registered' : 'already exists'}: ${email}`);
    res.status(isNew ? 201 : 200).json({ message: isNew ? 'User registered' : 'User already exists', token, user, isNew });
  } catch (err) {
    logger.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    const userData = { ...user, email: user.phone };
    delete userData.phone;
    res.json({ user: userData });
  } catch (err) {
    logger.error('Get profile error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
