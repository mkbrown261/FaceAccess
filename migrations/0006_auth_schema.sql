-- FaceAccess Production Auth Schema
-- Covers: business accounts, home accounts, mobile accounts, sessions, audit trail

-- ── Business / Enterprise Accounts ─────────────────────────────
CREATE TABLE IF NOT EXISTS business_accounts (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  phone      TEXT,
  password_hash TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin',   -- superadmin | admin | operator | viewer
  org_name   TEXT,
  org_size   TEXT,
  status     TEXT NOT NULL DEFAULT 'active',  -- active | suspended | pending
  email_verified INTEGER DEFAULT 0,
  last_login TEXT,
  login_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Home / Residential Accounts ────────────────────────────────
CREATE TABLE IF NOT EXISTS home_accounts (
  id         TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  phone      TEXT,
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'home',  -- home | mobile
  status     TEXT NOT NULL DEFAULT 'active',
  email_verified INTEGER DEFAULT 0,
  last_login TEXT,
  login_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Link home_accounts to homes (one account can own multiple homes)
CREATE TABLE IF NOT EXISTS home_account_homes (
  account_id TEXT NOT NULL,
  home_id    TEXT NOT NULL,
  role       TEXT DEFAULT 'owner',
  linked_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, home_id),
  FOREIGN KEY (account_id) REFERENCES home_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id)    REFERENCES homes(id) ON DELETE CASCADE
);

-- ── Session Store ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          TEXT PRIMARY KEY,       -- session token (UUID)
  account_id  TEXT NOT NULL,
  account_type TEXT NOT NULL,         -- business | home | mobile
  ip_address  TEXT,
  user_agent  TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  last_active TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_account   ON auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON auth_sessions(expires_at);

-- ── Auth Audit Log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  account_type TEXT,
  email       TEXT,
  event_type  TEXT NOT NULL,  -- login_success | login_failed | logout | register | password_reset | token_refresh
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_account ON auth_audit_log(account_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email   ON auth_audit_log(email);
CREATE INDEX IF NOT EXISTS idx_auth_audit_type    ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at);

-- ── Add password field to home_users for PIN/password unlock ───
ALTER TABLE home_users ADD COLUMN password_hash TEXT;
ALTER TABLE home_users ADD COLUMN account_id TEXT;

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_biz_accounts_email  ON business_accounts(email);
CREATE INDEX IF NOT EXISTS idx_home_accounts_email ON home_accounts(email);
