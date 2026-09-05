-- ════════════════════════════════════════════════════════════════════
--  FaceAccess Business — Multi-tenant Organizations
--  Every business account belongs to an organization. Every business
--  resource (users, doors, permissions, logs, cameras, settings) is
--  scoped by org_id. No cross-tenant reads are possible.
-- ════════════════════════════════════════════════════════════════════

-- ── Purge all demo / seed data (production starts clean) ─────────────
DELETE FROM access_logs;
DELETE FROM pending_verifications;
DELETE FROM user_door_permissions;
DELETE FROM role_permissions;
DELETE FROM cameras;
DELETE FROM doors;
DELETE FROM users;
DELETE FROM settings;

-- ── Organizations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  industry    TEXT,
  size        TEXT,                       -- 1-10 | 11-50 | 51-200 | 201-1000 | 1000+
  plan        TEXT NOT NULL DEFAULT 'trial',   -- trial | starter | business | enterprise
  status      TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  trial_ends_at TEXT,
  created_by  TEXT,                       -- business_accounts.id
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Link business accounts to their org
ALTER TABLE business_accounts ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_biz_accounts_org ON business_accounts(org_id);

-- ── Rebuild users: email unique PER ORG, not globally ────────────────
CREATE TABLE users_v2 (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  department TEXT,
  phone TEXT,
  employee_id TEXT,
  avatar_url TEXT,
  face_embedding TEXT,          -- JSON array, 128-dim float (dlib ResNet descriptor)
  face_registered INTEGER DEFAULT 0,
  face_enrolled_at TEXT,
  face_sample_count INTEGER DEFAULT 0,
  mobile_token TEXT,
  mobile_device_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (org_id, email)
);
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_org    ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(org_id, role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(org_id, status);
CREATE INDEX IF NOT EXISTS idx_users_face   ON users(org_id, face_registered, status);

-- ── Add org_id to remaining business tables ──────────────────────────
ALTER TABLE doors ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_doors_org ON doors(org_id);

ALTER TABLE role_permissions ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_role_perm_org ON role_permissions(org_id);

ALTER TABLE user_door_permissions ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_user_door_perm_org ON user_door_permissions(org_id);

ALTER TABLE access_logs ADD COLUMN org_id TEXT REFERENCES organizations(id);
ALTER TABLE access_logs ADD COLUMN match_distance REAL;     -- raw euclidean distance of best match
ALTER TABLE access_logs ADD COLUMN second_best_distance REAL; -- margin check vs. runner-up
CREATE INDEX IF NOT EXISTS idx_access_logs_org      ON access_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_org_time ON access_logs(org_id, timestamp);

ALTER TABLE pending_verifications ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_pending_ver_org ON pending_verifications(org_id);

ALTER TABLE cameras ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_cameras_org ON cameras(org_id);

-- ── Settings: rebuild as (org_id, key) ───────────────────────────────
DROP TABLE settings;
CREATE TABLE settings (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, key)
);

-- ── Org invitations (admins invite staff to the dashboard) ───────────
CREATE TABLE IF NOT EXISTS org_invitations (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'operator',   -- admin | operator | viewer
  token       TEXT UNIQUE NOT NULL,
  invited_by  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',    -- pending | accepted | revoked | expired
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_inv_org   ON org_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_inv_token ON org_invitations(token);

-- ── Purge demo home/consumer + devlab + AI data too ───────────────────
DELETE FROM home_events;
DELETE FROM home_verifications;
DELETE FROM guest_passes;
DELETE FROM home_automations;
DELETE FROM home_devices;
DELETE FROM home_cameras;
DELETE FROM smart_locks;
DELETE FROM homes;
DELETE FROM home_users;
DELETE FROM user_trust_profiles;
DELETE FROM behavioral_patterns;
DELETE FROM anomaly_events;
DELETE FROM predictive_sessions;
DELETE FROM ai_recommendations;
DELETE FROM biometric_audit_log;
DELETE FROM multimodel_embeddings;
DELETE FROM behavioral_models;
DELETE FROM trust_score_history;
DELETE FROM devlab_test_log;
DELETE FROM devlab_embeddings;
DELETE FROM devlab_profiles;
DELETE FROM devlab_sessions;
DELETE FROM auth_sessions;
DELETE FROM auth_audit_log;
DELETE FROM home_account_homes;
DELETE FROM home_accounts;
DELETE FROM business_accounts;
