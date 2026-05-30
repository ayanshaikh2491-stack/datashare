const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const { authenticateToken, generateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, name, role = 'both' } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name required' });
    }

    // Store email in phone column (DB has phone, not email)
    const { data: existing } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .single();

    if (existing) {
      const token = generateToken(existing);
      return res.json({ message: 'User already registered', token, user: existing });
    }

    // Create user
    const { data: user, error } = await getSupabase()
      .from('users')
      .insert([{ phone: email, name, role: role, is_active: true }])
      .select()
      .single();

    if (error) throw error;

    const token = generateToken(user);

    // Auto-create donor profile if role is donor or both
    if (role === 'donor' || role === 'both') {
      await getSupabase().from('donors').insert([{
        user_id: user.id,
        status: 'offline',
        max_receivers: 3,
        settings: { data_limit_mb: 500, time_limit_min: 60, daily_total_gb: 5 }
      }]);
      logger.info(`✅ Donor profile created for ${email}`);
    }

    // Auto-create receiver profile if role is receiver or both
    if (role === 'receiver' || role === 'both') {
      await getSupabase().from('receivers').insert([{
        user_id: user.id,
        status: 'disconnected',
        data_needed_mb: 0
      }]);
      logger.info(`✅ Receiver profile created for ${email}`);
    }

    logger.info(`✅ New user registered: ${email} (${role})`);
    res.status(201).json({ message: 'User registered successfully', token, user });
  } catch (err) {
    logger.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found. Please register first.', code: 'USER_NOT_FOUND' });
    }

    const token = generateToken(user);
    logger.info(`✅ User logged in: ${email}`);

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

    // Rename phone back to email in response
    const userData = { ...user, email: user.phone };
    delete userData.phone;

    res.json({ user: userData });
  } catch (err) {
    logger.error('Get profile error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
