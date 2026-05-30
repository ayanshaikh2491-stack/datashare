const { getSupabase } = require('./supabase.service');
const config = require('../../config/env');
const logger = require('../utils/logger');

class MatchingService {
  // Find best donor for a receiver
  async findBestDonor(receiverLocation, receiverId) {
    try {
      const { data: donors, error } = await getSupabase()
        .from('donors')
        .select('*')
        .eq('status', 'online')
        .lt('current_receivers', 'max_receivers');

      if (error) {
        logger.error('Error finding donors:', error);
        return { donors: [], error: error.message };
      }

      if (!donors || donors.length === 0) {
        logger.info('No available donors found');
        return { donors: [], message: 'No donors available right now' };
      }

      // Filter out donors who have blocked this receiver
      const { data: blocked } = await getSupabase()
        .from('blocklist')
        .select('donor_id')
        .eq('receiver_id', receiverId);

      const blockedDonorIds = new Set(blocked?.map(b => b.donor_id) || []);

      // Filter out blocked donors and sort by capacity + distance
      const availableDonors = donors
        .filter(d => !blockedDonorIds.has(d.id))
        .map(d => ({
          ...d,
          distance: receiverLocation ? this.calculateDistance(
            d.location, receiverLocation
          ) : 999,
          priority: this.calculatePriority(d)
        }))
        .sort((a, b) => b.priority - a.priority || a.distance - b.distance);

      logger.info(`Found ${availableDonors.length} available donors for receiver ${receiverId}`);
      return { donors: availableDonors, total: availableDonors.length };
    } catch (err) {
      logger.error('Matching service error:', err.message);
      return { donors: [], error: err.message };
    }
  }

  // Calculate priority score for donor
  calculatePriority(donor) {
    let score = 100;
    // More capacity = higher priority
    const remainingSlots = donor.max_receivers - (donor.current_receivers || 0);
    score += remainingSlots * 10;
    // More generous limits = higher priority
    const settings = donor.settings || {};
    score += (settings.data_limit_mb || 500) / 100;
    score -= (donor.current_receivers || 0) * 5; // Penalize busy donors
    return Math.max(0, score);
  }

  // Calculate distance between two locations (km)
  calculateDistance(loc1, loc2) {
    if (!loc1 || !loc2) return 999;
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(loc2.lat - loc1.lat);
    const dLon = this.toRad(loc2.lng - loc1.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.lat)) * Math.cos(this.toRad(loc2.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Auto-match: connect receiver to best available donor
  async autoMatch(receiverId) {
    try {
      const { data: receiver } = await getSupabase()
        .from('receivers')
        .select('*')
        .eq('id', receiverId)
        .single();

      if (!receiver) {
        return { success: false, error: 'Receiver not found' };
      }

      // Check receiver limits
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: todayConnections } = await getSupabase()
        .from('connections')
        .select('*')
        .eq('receiver_id', receiverId)
        .gte('started_at', todayStart.toISOString());

      if ((todayConnections?.length || 0) >= config.MAX_RECEIVERS_PER_DAY) {
        return { success: false, error: 'Daily donor limit reached (5/day)', limit: true };
      }

      const { data: activeConnection } = await getSupabase()
        .from('connections')
        .select('*')
        .eq('receiver_id', receiverId)
        .eq('status', 'active')
        .single();

      if (activeConnection) {
        return { success: false, error: 'Already connected to a donor' };
      }

      // Check cooldown
      if (todayConnections?.length > 0) {
        const lastConnection = todayConnections
          .sort((a, b) => new Date(b.ended_at || b.started_at) - new Date(a.ended_at || a.started_at))[0];
        const lastEnd = new Date(lastConnection.ended_at || lastConnection.started_at);
        const now = new Date();
        const elapsedSec = (now - lastEnd) / 1000;

        if (elapsedSec < config.CONNECTION_COOLDOWN_SEC) {
          const remaining = config.CONNECTION_COOLDOWN_SEC - elapsedSec;
          return { success: false, error: `Cooldown: wait ${Math.ceil(remaining)} seconds`, cooldown: true, remaining };
        }
      }

      // Find best donor
      const result = await this.findBestDonor(receiver.location, receiverId);
      if (!result.donors || result.donors.length === 0) {
        return { success: false, error: result.message || 'No donors available' };
      }

      // Return best donor for connection
      const bestDonor = result.donors[0];
      logger.info(`Auto-matched: receiver ${receiverId} → donor ${bestDonor.id} (priority: ${bestDonor.priority})`);
      return { success: true, donor: bestDonor };
    } catch (err) {
      logger.error('Auto-match error:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new MatchingService();
