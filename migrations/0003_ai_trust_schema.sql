-- FaceAccess AI – Migration 003
-- Predictive Behavior, Trust Scoring & Anomaly Detection

-- ─────────────────────────────────────────────────────────
-- User Trust Profiles (dynamic per-user trust score)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_trust_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  home_id TEXT NOT NULL,

  -- Composite trust score (0.0–1.0)
  trust_score REAL DEFAULT 0.70,
  trust_tier TEXT DEFAULT 'standard',  -- trusted | standard | watchlist | blocked

  -- Component scores (each 0.0–1.0)
  face_confidence_avg REAL DEFAULT 0.70,
  behavioral_score    REAL DEFAULT 0.70,
  predictive_score    REAL DEFAULT 0.70,
  anomaly_penalty     REAL DEFAULT 0.00,

  -- Rolling counters (last 30 days)
  total_attempts      INTEGER DEFAULT 0,
  successful_unlocks  INTEGER DEFAULT 0,
  denied_count        INTEGER DEFAULT 0,
  anomaly_count       INTEGER DEFAULT 0,
  false_alarm_count   INTEGER DEFAULT 0,

  -- Behavioral metadata
  typical_access_times TEXT DEFAULT '[]',   -- JSON array of typical hour ranges
  typical_days         TEXT DEFAULT '[]',   -- JSON array of typical weekdays
  typical_locks        TEXT DEFAULT '[]',   -- JSON array of typical lock IDs
  avg_ble_usage_rate   REAL DEFAULT 0.80,
  avg_wifi_usage_rate  REAL DEFAULT 0.50,

  -- State
  last_updated TEXT DEFAULT (datetime('now')),
  last_access  TEXT,
  created_at   TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- Behavioral Access Patterns (raw time-series for ML)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS behavioral_patterns (
  id TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  home_id  TEXT NOT NULL,
  lock_id  TEXT,

  -- Temporal features
  access_hour    INTEGER NOT NULL,   -- 0–23
  access_minute  INTEGER NOT NULL,   -- 0–59
  access_dow     INTEGER NOT NULL,   -- 0=Sun…6=Sat
  access_date    TEXT NOT NULL,      -- YYYY-MM-DD

  -- Context features
  ble_detected   INTEGER DEFAULT 0,
  wifi_matched   INTEGER DEFAULT 0,
  face_confidence REAL,
  liveness_score REAL,
  result         TEXT NOT NULL,      -- granted | denied | pending

  -- Derived
  is_typical     INTEGER DEFAULT 1,  -- within normal pattern
  anomaly_score  REAL DEFAULT 0.0,   -- 0=normal, 1=very anomalous
  session_id     TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- Anomaly Detection Log
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_events (
  id TEXT PRIMARY KEY,
  user_id   TEXT,
  home_id   TEXT NOT NULL,
  lock_id   TEXT,

  anomaly_type TEXT NOT NULL,
  -- Types: unusual_time | unusual_location | device_mismatch | repeated_failures |
  --        impossible_travel | high_frequency | spoof_attempt | unknown_device |
  --        off_schedule | behavioral_drift

  severity TEXT DEFAULT 'medium',    -- low | medium | high | critical
  confidence REAL DEFAULT 0.70,      -- AI confidence that this is anomalous

  -- Details (JSON)
  details TEXT DEFAULT '{}',
  -- e.g. {"expected_hours":[7,8,9],"actual_hour":2,"deviation":5}

  -- Trust impact
  trust_delta REAL DEFAULT -0.05,    -- change applied to trust score

  -- State
  acknowledged INTEGER DEFAULT 0,
  resolved     INTEGER DEFAULT 0,
  admin_note   TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE SET NULL,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- Predictive Access Sessions (pre-loaded auth checks)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS predictive_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  lock_id TEXT,

  -- Prediction metadata
  predicted_arrival   TEXT,          -- ISO datetime of predicted arrival
  prediction_window   INTEGER DEFAULT 15,  -- minutes before/after
  prediction_confidence REAL DEFAULT 0.70,
  prediction_basis    TEXT DEFAULT 'pattern',  -- pattern | schedule | manual | ble_proximity

  -- Pre-auth state
  pre_auth_ready      INTEGER DEFAULT 0,
  pre_auth_score      REAL,
  pre_auth_at         TEXT,

  -- Outcome
  actual_arrival      TEXT,
  outcome             TEXT DEFAULT 'pending',  -- pending | matched | missed | expired

  -- Notification
  notification_sent   INTEGER DEFAULT 0,
  notification_at     TEXT,

  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- AI Recommendations (admin dashboard suggestions)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  user_id TEXT,

  recommendation_type TEXT NOT NULL,
  -- Types: pre_approve_guest | revoke_access | upgrade_verification |
  --        add_trusted_device | schedule_restriction | review_anomalies

  priority TEXT DEFAULT 'medium',    -- low | medium | high | urgent

  title   TEXT NOT NULL,
  message TEXT NOT NULL,
  action_data TEXT DEFAULT '{}',     -- JSON with action params

  -- State
  dismissed INTEGER DEFAULT 0,
  acted_on  INTEGER DEFAULT 0,
  expires_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trust_profiles_user    ON user_trust_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_profiles_home    ON user_trust_profiles(home_id);
CREATE INDEX IF NOT EXISTS idx_trust_profiles_tier    ON user_trust_profiles(trust_tier);
CREATE INDEX IF NOT EXISTS idx_behavioral_user        ON behavioral_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_home        ON behavioral_patterns(home_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_date        ON behavioral_patterns(access_date);
CREATE INDEX IF NOT EXISTS idx_anomaly_home           ON anomaly_events(home_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_user           ON anomaly_events(user_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity       ON anomaly_events(severity);
CREATE INDEX IF NOT EXISTS idx_predictive_user        ON predictive_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictive_home        ON predictive_sessions(home_id);
CREATE INDEX IF NOT EXISTS idx_predictive_expires     ON predictive_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_recs_home           ON ai_recommendations(home_id);
CREATE INDEX IF NOT EXISTS idx_ai_recs_dismissed      ON ai_recommendations(dismissed);
