-- Add reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  donor_id UUID REFERENCES donors(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES receivers(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add real-time stats columns to connections
ALTER TABLE connections ADD COLUMN IF NOT EXISTS data_transferred_mb NUMERIC DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS transfer_speed_mbps NUMERIC DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS is_transferring BOOLEAN DEFAULT FALSE;

-- Create view for donor dashboard stats
CREATE OR REPLACE VIEW donor_dashboard AS
SELECT
  d.id as donor_id,
  d.user_id,
  d.status,
  d.max_receivers,
  d.current_receivers,
  d.settings,
  COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active') as active_connections,
  COALESCE(SUM(c.data_transferred_mb) FILTER (WHERE c.status = 'active'), 0) as active_data_mb,
  COALESCE(SUM(c.data_used_mb) FILTER (WHERE c.status = 'completed'), 0) as total_shared_mb,
  COUNT(DISTINCT c.receiver_id) FILTER (WHERE c.status = 'completed') as total_receivers_helped,
  COALESCE(AVG(r.rating), 0) as avg_rating,
  COUNT(r.id) as total_reviews
FROM donors d
LEFT JOIN connections c ON c.donor_id = d.id
LEFT JOIN reviews r ON r.donor_id = d.id
GROUP BY d.id, d.user_id, d.status, d.max_receivers, d.current_receivers, d.settings;

-- Create view for receiver dashboard stats
CREATE OR REPLACE VIEW receiver_dashboard AS
SELECT
  r.id as receiver_id,
  r.user_id,
  r.status,
  r.data_needed_mb,
  COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active') as active_connections,
  COALESCE(SUM(c.data_transferred_mb) FILTER (WHERE c.status = 'active'), 0) as active_received_mb,
  COALESCE(SUM(c.data_used_mb) FILTER (WHERE c.status = 'completed'), 0) as total_received_mb,
  COUNT(DISTINCT c.donor_id) FILTER (WHERE c.status = 'completed') as total_donors_connected,
  COALESCE(AVG(rv.rating), 0) as avg_given_rating
FROM receivers r
LEFT JOIN connections c ON c.receiver_id = r.id
LEFT JOIN reviews rv ON rv.receiver_id = r.id
GROUP BY r.id, r.user_id, r.status, r.data_needed_mb;
