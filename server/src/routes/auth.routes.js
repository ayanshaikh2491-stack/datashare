const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const { authenticateToken, generateToken } = require('../middleware/auth.middleware');
const { handleValidation, rules } = require('../middleware/validation.middleware');
const logger = require('../utils/logger');

// POST /api/auth/register
router.post('/register', handleValidation(rules.register), async (req, res) => {
  try {
    const { phone, name, role = 'both' } = req.body;

    const { data: existing } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existing) {
      const token = generateToken(existing);
      return res.json({ message: 'User already registered', token, user: existing });
    }

    const { data: user, error } = await getSupabase()
      .from('users')
      .insert([{ phone, name, role, is_active: true }])
      .select()
      .single();

    if (error) throw error;

    const token = generateToken(user);
    logger.info(`✅ New user registered: ${phone} (${role})`);

    res.status(201).json({ message: 'User registered successfully', token, user });
  } catch (err) {
    logger.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// POST /api/auth/login
router.post('/login', handleValidation(rules.login), async (req, res) => {
  try {
    const { phone } = req.body;

    const { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const token = generateToken(user);
    logger.info(`✅ User logged in: ${phone}`);

    res.json({ message: 'Login successful', token, user });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    logger.error('Get profile error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
