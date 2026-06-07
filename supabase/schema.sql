-- ============================================
-- DATASHARE - Supabase Database Schema
-- Open Source Community Data Sharing Platform
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  role VARCHAR(20) CHECK (role IN ('donor', 'receiver', 'both')) DEFAULT 'both',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- DONORS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS donors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  location JSONB,
  max_receivers INTEGER DEFAULT 3,
  current_receivers INTEGER DEFAULT 0,
  wireguard_public_key TEXT,
  wireguard_endpoint TEXT,
  status VARCHAR(20) CHECK (status IN ('online', 'offline', 'busy')) DEFAULT 'offline',
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{
    "data_limit_mb": 500,
    "time_limit_min": 60,
    "daily_total_gb": 5
  }',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- RECEIVERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS receivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  location JSONB,
  data_needed_mb INTEGER DEFAULT 0,
  status VARCHAR(20) CHECK (status IN ('waiting', 'connected', 'disconnected')) DEFAULT 'disconnected',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CONNECTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id UUID REFERENCES donors(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES receivers(id) ON DELETE CASCADE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  data_used_mb DECIMAL(10, 2) DEFAULT 0,
  status VARCHAR(20) CHECK (status IN ('active', 'completed', 'rejected')) DEFAULT 'active',
  disconnect_reason TEXT
);

-- ============================================
-- USAGE LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES receivers(id) ON DELETE CASCADE NOT NULL,
  data_mb DECIMAL(10, 2) NOT NULL,
  activity_type VARCHAR(50) DEFAULT 'general',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- BLOCKLIST TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS blocklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id UUID REFERENCES donors(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES receivers(id) ON DELETE CASCADE NOT NULL,
  reason TEXT DEFAULT 'blocked by donor',
  blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(donor_id, receiver_id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_donors_status ON donors(status);
CREATE INDEX IF NOT EXISTS idx_donors_user_id ON donors(user_id);
CREATE INDEX IF NOT EXISTS idx_receivers_user_id ON receivers(user_id);
CREATE INDEX IF NOT EXISTS idx_receivers_status ON receivers(status);
CREATE INDEX IF NOT EXISTS idx_connections_donor ON connections(donor_id);
CREATE INDEX IF NOT EXISTS idx_connections_receiver ON connections(receiver_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
CREATE INDEX IF NOT EXISTS idx_usage_logs_connection ON usage_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_blocklist_donor ON blocklist(donor_id);
CREATE INDEX IF NOT EXISTS idx_blocklist_receiver ON blocklist(receiver_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocklist ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users read own data" ON users
  FOR SELECT USING (auth.uid()::text = id::text);

-- Donors can read/update their own donor record
CREATE POLICY "Donors read own" ON donors
  FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "Donors update own" ON donors
  FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Donors insert own" ON donors
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Receivers can read/update their own receiver record
CREATE POLICY "Receivers read own" ON receivers
  FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "Receivers update own" ON receivers
  FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Receivers insert own" ON receivers
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Connections: donors and receivers can see their own connections
CREATE POLICY "Connection participants read" ON connections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM donors WHERE donors.id = connections.donor_id AND donors.user_id::text = auth.uid()::text)
    OR
    EXISTS (SELECT 1 FROM receivers WHERE receivers.id = connections.receiver_id AND receivers.user_id::text = auth.uid()::text)
  );
CREATE POLICY "Donors insert connections" ON connections
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM donors WHERE donors.id = connections.donor_id AND donors.user_id::text = auth.uid()::text)
  );

-- Usage logs: participants can see
CREATE POLICY "Usage participants read" ON usage_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM connections WHERE connections.id = usage_logs.connection_id AND (
      EXISTS (SELECT 1 FROM donors WHERE donors.id = connections.donor_id AND donors.user_id::text = auth.uid()::text)
      OR
      EXISTS (SELECT 1 FROM receivers WHERE receivers.id = connections.receiver_id AND receivers.user_id::text = auth.uid()::text)
    ))
  );
-- M1: previously `WITH CHECK (true)` — any logged-in user could insert
-- usage for any connection. Now restricted to participants via a helper
-- function that the policy calls.
CREATE OR REPLACE FUNCTION usage_log_participant(_connection_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM connections c
    WHERE c.id = _connection_id
      AND (
        EXISTS (SELECT 1 FROM donors d WHERE d.id = c.donor_id AND d.user_id::text = auth.uid()::text)
        OR
        EXISTS (SELECT 1 FROM receivers r WHERE r.id = c.receiver_id AND r.user_id::text = auth.uid()::text)
      )
  );
$$;

DROP POLICY IF EXISTS "Anyone insert usage" ON usage_logs;
CREATE POLICY "Participants insert usage" ON usage_logs
  FOR INSERT WITH CHECK (usage_log_participant(connection_id));

-- Blocklist: donors can manage their own blocklist
CREATE POLICY "Donors manage blocklist" ON blocklist
  FOR ALL USING (
    EXISTS (SELECT 1 FROM donors WHERE donors.id = blocklist.donor_id AND donors.user_id::text = auth.uid()::text)
  );

-- ============================================
-- SERVICE ROLE BYPASS (for server-side operations)
-- Note: Server uses service role key which bypasses RLS
-- ============================================

-- ============================================
-- VIEWS FOR EASY QUERYING
-- ============================================

-- Active connections view
CREATE OR REPLACE VIEW active_connections AS
SELECT
  c.id,
  c.started_at,
  c.data_used_mb,
  c.disconnect_reason,
  d.id AS donor_id,
  d.user_id AS donor_user_id,
  d.location AS donor_location,
  d.settings AS donor_settings,
  d.status AS donor_status,
  r.id AS receiver_id,
  r.user_id AS receiver_user_id,
  r.location AS receiver_location,
  r.data_needed_mb
FROM connections c
JOIN donors d ON c.donor_id = d.id
JOIN receivers r ON c.receiver_id = r.id
WHERE c.status = 'active';

-- Donor stats view
CREATE OR REPLACE VIEW donor_stats AS
SELECT
  d.id AS donor_id,
  d.user_id,
  d.status,
  d.max_receivers,
  d.current_receivers,
  COUNT(DISTINCT c.id) AS total_connections,
  COALESCE(SUM(c.data_used_mb), 0) AS total_data_shared_mb,
  MAX(c.started_at) AS last_connection
FROM donors d
LEFT JOIN connections c ON c.donor_id = d.id
GROUP BY d.id, d.user_id, d.status, d.max_receivers, d.current_receivers;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update donor status based on current receivers
CREATE OR REPLACE FUNCTION update_donor_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE donors SET current_receivers = current_receivers + 1,
                      status = CASE WHEN current_receivers + 1 >= max_receivers THEN 'busy' ELSE 'online' END
    WHERE id = NEW.donor_id;
  ELSIF (OLD.status = 'active' AND NEW.status IN ('completed', 'rejected')) THEN
    UPDATE donors SET current_receivers = GREATEST(0, current_receivers - 1),
                      status = 'online'
    WHERE id = NEW.donor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for connection status changes
CREATE TRIGGER trg_connection_status_change
AFTER UPDATE OF status ON connections
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_donor_status();

-- ============================================
-- DONE! ✅
-- ============================================
