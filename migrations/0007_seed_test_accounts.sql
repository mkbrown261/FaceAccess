-- ════════════════════════════════════════════════════════════
--  FaceAccess — Auth Schema Indexes (safe to apply)
--  QA test accounts are created via API (not SQL) because
--  password hashing uses Web Crypto API on the server.
-- ════════════════════════════════════════════════════════════

-- Ensure home_users account_id column exists (added in 0006)
-- (idempotent - uses IF NOT EXISTS patterns where possible)

-- Index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_auth_sessions_created ON auth_sessions(created_at);

-- Index for home_users by account_id
CREATE INDEX IF NOT EXISTS idx_home_users_account ON home_users(account_id);

-- Index for home_account_homes lookups  
CREATE INDEX IF NOT EXISTS idx_hah_home ON home_account_homes(home_id);
CREATE INDEX IF NOT EXISTS idx_hah_account ON home_account_homes(account_id);
