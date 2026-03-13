-- FaceAccess AI – Migration 004
-- Multi-Model Biometric Pipeline, Trust Engine v4, Audit Logging

-- ─────────────────────────────────────────────────────────────────────
-- Biometric Decision Audit Log
-- Full record of every authentication decision for compliance/forensics
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biometric_audit_log (
  id TEXT PRIMARY KEY,
  home_id  TEXT,
  user_id  TEXT,
  lock_id  TEXT,

  -- Decision outcome
  decision         TEXT NOT NULL,   -- granted | denied | pending | error
  denial_reason    TEXT,            -- no_match | liveness_failed | spoof_detected | rate_limited | ...

  -- Multi-model pipeline scores (0.0–1.0 each)
  arcface_score        REAL DEFAULT NULL,
  insightface_score    REAL DEFAULT NULL,
  facenet_score        REAL DEFAULT NULL,
  combined_confidence  REAL DEFAULT NULL,

  -- Anti-spoof & liveness
  anti_spoof_score  REAL DEFAULT NULL,
  liveness_score    REAL DEFAULT NULL,

  -- Edge AI preprocessing
  edge_confidence   REAL DEFAULT NULL,
  quality_score     REAL DEFAULT NULL,
  landmark_quality  REAL DEFAULT NULL,

  -- Pipeline tracing
  stage_reached         TEXT,     -- e.g., "edge→arcface→insightface"
  pipeline_latency_ms   INTEGER,
  model_agreement       REAL,     -- 0.0–1.0 agreement between models
  engine_version        TEXT DEFAULT '4.0',
  is_borderline         INTEGER DEFAULT 0,

  -- Trust engine
  trust_score     REAL DEFAULT NULL,
  trust_tier      TEXT DEFAULT NULL,
  behavioral_typical  INTEGER DEFAULT NULL,
  anomaly_score   REAL DEFAULT NULL,

  -- Device proximity
  ble_detected    INTEGER DEFAULT 0,
  wifi_matched    INTEGER DEFAULT 0,
  proximity_score REAL DEFAULT NULL,

  -- Enrollment context
  embedding_dims    INTEGER DEFAULT NULL,   -- 512 | 256 | 128
  enrolled_angles   INTEGER DEFAULT NULL,   -- number of enrolled angles

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_home_time ON biometric_audit_log(home_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON biometric_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_decision  ON biometric_audit_log(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_lock      ON biometric_audit_log(lock_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- Multi-Model Enrollment Store
-- Stores per-model embeddings separately for maximum accuracy
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multimodel_embeddings (
  id TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  home_id  TEXT NOT NULL,

  -- Per-model embeddings (base64-encoded Float32Array)
  arcface_embedding     TEXT DEFAULT NULL,   -- 512-dim ArcFace embedding
  insightface_embedding TEXT DEFAULT NULL,   -- 256-dim InsightFace embedding
  facenet_embedding     TEXT DEFAULT NULL,   -- 128-dim FaceNet embedding

  -- Per-model quality scores at enrollment time
  arcface_quality       REAL DEFAULT NULL,
  insightface_quality   REAL DEFAULT NULL,
  facenet_quality       REAL DEFAULT NULL,

  -- Enrollment metadata
  enrollment_angles     TEXT DEFAULT '[]',   -- JSON array: ["center","left","right",...]
  liveness_score        REAL DEFAULT NULL,
  anti_spoof_score      REAL DEFAULT NULL,
  enrollment_version    TEXT DEFAULT '4.0',
  edge_processed        INTEGER DEFAULT 0,   -- was edge AI preprocessing used?

  -- Continuous learning state
  adaptation_count      INTEGER DEFAULT 0,   -- times template has been adapted
  last_adapted          TEXT DEFAULT NULL,
  confidence_history    TEXT DEFAULT '[]',   -- JSON: last 20 confidence scores

  -- Lifecycle
  status     TEXT DEFAULT 'active',          -- active | archived | deleted
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mme_user_home ON multimodel_embeddings(user_id, home_id);
CREATE INDEX IF NOT EXISTS idx_mme_home ON multimodel_embeddings(home_id);

-- ─────────────────────────────────────────────────────────────────────
-- Behavioral Anomaly Learning
-- Continuous model state for each user's behavioral patterns
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS behavioral_models (
  id TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL UNIQUE,
  home_id  TEXT NOT NULL,

  -- Learned typical patterns (JSON)
  typical_hours_json    TEXT DEFAULT '[]',   -- e.g., [8,9,17,18]
  typical_days_json     TEXT DEFAULT '[]',   -- e.g., [1,2,3,4,5]
  typical_locks_json    TEXT DEFAULT '[]',   -- typical lock IDs
  typical_duration_min  INTEGER DEFAULT 5,   -- typical session length

  -- Statistical parameters
  hour_mean      REAL DEFAULT 12.0,
  hour_std       REAL DEFAULT 4.0,
  day_freq_json  TEXT DEFAULT '{}',   -- {0:0.1, 1:0.2, ...} day-of-week frequencies
  arrival_windows_json TEXT DEFAULT '[]', -- predicted arrival windows per day

  -- Model confidence
  n_samples       INTEGER DEFAULT 0,
  model_confidence REAL DEFAULT 0.0,  -- 0 = no data, 1 = high confidence
  last_trained    TEXT DEFAULT NULL,

  -- Drift detection
  drift_detected  INTEGER DEFAULT 0,
  drift_detected_at TEXT DEFAULT NULL,
  drift_magnitude REAL DEFAULT 0.0,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bm_home ON behavioral_models(home_id);

-- ─────────────────────────────────────────────────────────────────────
-- Trust Engine History (time-series of trust score changes)
-- For visualization and trend analysis
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trust_score_history (
  id TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  home_id  TEXT NOT NULL,

  -- Score snapshot
  trust_score         REAL NOT NULL,
  trust_tier          TEXT NOT NULL,
  face_confidence_avg REAL DEFAULT NULL,
  behavioral_score    REAL DEFAULT NULL,
  anomaly_penalty     REAL DEFAULT NULL,

  -- What triggered the change
  trigger_event  TEXT DEFAULT NULL,  -- 'access_granted' | 'access_denied' | 'anomaly' | 'recalculate'
  delta          REAL DEFAULT 0.0,   -- change from previous score

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tsh_user_time ON trust_score_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsh_home      ON trust_score_history(home_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- Alter existing tables to add new columns
-- (SQLite: add columns with ALTER TABLE, no DROP)
-- ─────────────────────────────────────────────────────────────────────

-- Add multi-model columns to behavioral_patterns if not already present
ALTER TABLE behavioral_patterns ADD COLUMN arcface_score      REAL DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN insightface_score  REAL DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN facenet_score      REAL DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN combined_confidence REAL DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN pipeline_latency_ms INTEGER DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN model_agreement    REAL DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN stage_reached      TEXT DEFAULT NULL;
ALTER TABLE behavioral_patterns ADD COLUMN audit_id           TEXT DEFAULT NULL;

-- Add multi-model columns to anomaly_events if not already present
ALTER TABLE anomaly_events ADD COLUMN arcface_score      REAL DEFAULT NULL;
ALTER TABLE anomaly_events ADD COLUMN insightface_score  REAL DEFAULT NULL;
ALTER TABLE anomaly_events ADD COLUMN combined_confidence REAL DEFAULT NULL;
ALTER TABLE anomaly_events ADD COLUMN pipeline_stage     TEXT DEFAULT NULL;

-- Add multi-model columns to user_trust_profiles
ALTER TABLE user_trust_profiles ADD COLUMN arcface_avg       REAL DEFAULT NULL;
ALTER TABLE user_trust_profiles ADD COLUMN insightface_avg   REAL DEFAULT NULL;
ALTER TABLE user_trust_profiles ADD COLUMN model_count       INTEGER DEFAULT 1;
ALTER TABLE user_trust_profiles ADD COLUMN avg_pipeline_latency_ms INTEGER DEFAULT NULL;
ALTER TABLE user_trust_profiles ADD COLUMN last_arcface_score REAL DEFAULT NULL;
ALTER TABLE user_trust_profiles ADD COLUMN last_pipeline_version TEXT DEFAULT '3.0';
