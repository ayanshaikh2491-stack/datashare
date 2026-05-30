const express = require('express');
const router = express.Router();
const { getSupabase } = require('../services/supabase.service');
const websocket = require('../services/websocket.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

router.use(authenticateToken);

// POST /api/reviews - Submit a review
router.post('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { donor_id, connection_id, rating, comment } = req.body;

    if (!donor_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Donor ID and rating (1-5) required' });
    }

    // Get receiver
    const { data: receiver } = await getSupabase()
      .from('receivers')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    // Check if already reviewed this connection
    if (connection_id) {
      const { data: existing } = await getSupabase()
        .from('reviews')
        .select('id')
        .eq('connection_id', connection_id)
        .single();
      
      if (existing) return res.status(409).json({ error: 'Already reviewed this connection' });
    }

    const { data: review, error } = await getSupabase()
      .from('reviews')
      .insert([{
        donor_id,
        receiver_id: receiver.id,
        connection_id,
        rating,
        comment: comment || ''
      }])
      .select()
      .single();

    if (error) throw error;

    // Notify donor of new review
    const { data: donor } = await getSupabase()
      .from('donors')
      .select('user_id')
      .eq('id', donor_id)
      .single();

    if (donor) {
      websocket.sendToUser(donor.user_id, {
        type: 'new_review',
        review: { rating, comment, from: userId }
      });
    }

    logger.info(`⭐ Review: ${rating}/5 for donor ${donor_id}`);
    res.status(201).json({ message: 'Review submitted', review });
  } catch (err) {
    logger.error('Review error:', err.message);
    res.status(500).json({ error: 'Failed to submit review', details: err.message });
  }
});

// GET /api/reviews/donor/:donorId - Get reviews for a donor
router.get('/donor/:donorId', async (req, res) => {
  try {
    const donorId = req.params.donorId;

    const { data: reviews } = await getSupabase()
      .from('reviews')
      .select('id, rating, comment, created_at, receiver_id')
      .eq('donor_id', donorId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Get reviewer names
    const reviewsWithNames = reviews || [];
    if (reviewsWithNames.length > 0) {
      const receiverIds = reviewsWithNames.map(r => r.receiver_id);
      const { data: receivers } = await getSupabase()
        .from('receivers')
        .select('id, user_id')
        .in('id', receiverIds);

      const userIds = (receivers || []).map(r => r.user_id);
      const { data: users } = await getSupabase()
        .from('users')
        .select('id, name')
        .in('id', userIds);

      const userMap = {};
      (users || []).forEach(u => { userMap[u.id] = u.name; });
      const receiverMap = {};
      (receivers || []).forEach(r => { receiverMap[r.id] = userMap[r.user_id] || 'Anonymous'; });

      reviewsWithNames.forEach(r => { r.from_name = receiverMap[r.receiver_id] || 'Anonymous'; });
    }

    // Calculate average
    const avg = reviewsWithNames.length > 0
      ? reviewsWithNames.reduce((sum, r) => sum + r.rating, 0) / reviewsWithNames.length
      : 0;

    res.json({ reviews: reviewsWithNames, average: Math.round(avg * 10) / 10, total: reviewsWithNames.length });
  } catch (err) {
    logger.error('Get reviews error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reviews', details: err.message });
  }
});

// GET /api/reviews/my - Get my reviews (for donor to see their reviews)
router.get('/my', async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: donor } = await getSupabase()
      .from('donors')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const { data: reviews } = await getSupabase()
      .from('reviews')
      .select('id, rating, comment, created_at, receiver_id')
      .eq('donor_id', donor.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const avg = reviews?.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    res.json({ reviews: reviews || [], average: Math.round(avg * 10) / 10, total: reviews?.length || 0 });
  } catch (err) {
    logger.error('My reviews error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reviews', details: err.message });
  }
});

module.exports = router;
