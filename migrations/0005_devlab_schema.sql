-- ═══════════════════════════════════════════════════════════════
-- FaceAccess Developer Testing Lab — Schema Migration v5
-- ═══════════════════════════════════════════════════════════════

-- Dev-lab test profiles (isolated from production users)
CREATE TABLE IF NOT EXISTS devlab_profiles (
  id              TEXT PRIMARY KEY,           -- 'dlp-xxxx'
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee', -- employee|admin|visitor
  phone_device_id TEXT,
  face_registered INTEGER NOT NULL DEFAULT 0,
  embedding_count INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Dev-lab face embeddings (separate from production embeddings)
CREATE TABLE IF NOT EXISTS devlab_embeddings (
  id              TEXT PRIMARY KEY,           -- 'dle-xxxx'
  profile_id      TEXT NOT NULL REFERENCES devlab_profiles(id) ON DELETE CASCADE,
  embedding       TEXT NOT NULL,              -- JSON array of 128 floats
  angle_label     TEXT NOT NULL DEFAULT 'center',
  quality_score   REAL NOT NULL DEFAULT 0.0,
  frame_index     INTEGER NOT NULL DEFAULT 0,
  model_version   TEXT NOT NULL DEFAULT '4.0',
  captured_at     TEXT NOT NULL
);

-- Dev-lab authentication test log (per-attempt record)
CREATE TABLE IF NOT EXISTS devlab_test_log (
  id                  TEXT PRIMARY KEY,       -- 'dtl-xxxx'
  profile_id          TEXT,                  -- matched profile (null if no match)
  matched_name        TEXT,
  similarity_score    REAL,
  combined_confidence REAL,
  arcface_score       REAL,
  insightface_score   REAL,
  facenet_score       REAL,
  liveness_score      REAL,
  anti_spoof_score    REAL,
  trust_score         REAL,
  trust_tier          TEXT,
  behavioral_score    REAL,
  proximity_score     REAL,
  decision            TEXT NOT NULL,         -- granted|denied|pending
  denial_reason       TEXT,
  pipeline_latency_ms INTEGER,
  stage_reached       TEXT,
  is_borderline       INTEGER NOT NULL DEFAULT 0,
  debug_data          TEXT,                  -- JSON blob of raw scores
  test_mode           TEXT NOT NULL DEFAULT 'camera', -- camera|manual|replay
  lock_simulated      TEXT NOT NULL DEFAULT 'Lab-Door-01',
  created_at          TEXT NOT NULL
);

-- Dev-lab session metadata
CREATE TABLE IF NOT EXISTS devlab_sessions (
  id              TEXT PRIMARY KEY,           -- 'dls-xxxx'
  label           TEXT NOT NULL DEFAULT 'Test Session',
  total_attempts  INTEGER NOT NULL DEFAULT 0,
  granted_count   INTEGER NOT NULL DEFAULT 0,
  denied_count    INTEGER NOT NULL DEFAULT 0,
  avg_confidence  REAL,
  avg_latency_ms  REAL,
  debug_mode      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  closed_at       TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devlab_embeddings_profile ON devlab_embeddings(profile_id);
CREATE INDEX IF NOT EXISTS idx_devlab_test_log_created ON devlab_test_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_devlab_test_log_profile ON devlab_test_log(profile_id);
CREATE INDEX IF NOT EXISTS idx_devlab_profiles_email ON devlab_profiles(email);
