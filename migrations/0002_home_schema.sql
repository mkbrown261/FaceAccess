-- FaceAccess Home - Migration 002
-- Consumer home product extension

-- Homes (properties owned by a homeowner account)
CREATE TABLE IF NOT EXISTS homes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT DEFAULT 'UTC',
  plan TEXT DEFAULT 'free',       -- free | pro | family
  setup_step INTEGER DEFAULT 0,   -- onboarding step 0-4
  setup_complete INTEGER DEFAULT 0,
  invite_code TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES home_users(id) ON DELETE CASCADE
);

-- Home users (consumer accounts, separate from enterprise users)
CREATE TABLE IF NOT EXISTS home_users (
  id TEXT PRIMARY KEY,
  home_id TEXT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT DEFAULT 'owner',      -- owner | member | guest
  face_embedding TEXT,
  face_registered INTEGER DEFAULT 0,
  avatar_color TEXT DEFAULT '#6366f1',
  status TEXT DEFAULT 'active',
  last_seen TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Trusted mobile devices bound to home users
CREATE TABLE IF NOT EXISTS home_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,             -- e.g. "John's iPhone 15"
  platform TEXT DEFAULT 'ios',    -- ios | android
  device_fingerprint TEXT,        -- hashed device ID
  ble_uuid TEXT,                  -- BLE advertised UUID
  wifi_ssid TEXT,                 -- trusted home WiFi SSID
  push_token TEXT,
  last_seen TEXT,
  trusted INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE,
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Smart locks connected to a home
CREATE TABLE IF NOT EXISTS smart_locks (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,             -- "Front Door", "Back Gate"
  location TEXT,
  lock_type TEXT DEFAULT 'api',   -- api | relay | ble | zigbee
  brand TEXT,                     -- august | schlage | yale | nuki | generic
  api_key TEXT,
  api_endpoint TEXT,
  relay_ip TEXT,
  relay_port INTEGER,
  ble_address TEXT,
  is_locked INTEGER DEFAULT 1,
  battery_pct INTEGER,
  last_event TEXT,
  status TEXT DEFAULT 'active',   -- active | offline | error
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Home cameras
CREATE TABLE IF NOT EXISTS home_cameras (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  lock_id TEXT,                   -- camera guarding this lock
  name TEXT NOT NULL,
  stream_url TEXT,                -- rtsp:// or https://
  camera_type TEXT DEFAULT 'rtsp',-- rtsp | webrtc | ring | nest | arlo
  api_key TEXT,
  device_id TEXT,
  status TEXT DEFAULT 'active',
  last_heartbeat TEXT,
  thumbnail_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  FOREIGN KEY (lock_id) REFERENCES smart_locks(id) ON DELETE SET NULL
);

-- Guest access passes
CREATE TABLE IF NOT EXISTS guest_passes (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,             -- "Cleaner", "Dog Walker"
  email TEXT,
  phone TEXT,
  face_embedding TEXT,
  face_registered INTEGER DEFAULT 0,
  lock_ids TEXT DEFAULT '[]',     -- JSON array of lock IDs
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  time_start TEXT DEFAULT '00:00',
  time_end TEXT DEFAULT '23:59',
  days_allowed TEXT DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
  requires_device_present INTEGER DEFAULT 0,
  invite_token TEXT UNIQUE,
  status TEXT DEFAULT 'pending',  -- pending | active | expired | revoked
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES home_users(id)
);

-- Home access events log
CREATE TABLE IF NOT EXISTS home_events (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  lock_id TEXT,
  lock_name TEXT,
  camera_id TEXT,
  event_type TEXT NOT NULL,       -- unlock | denied | alert | guest_entry | manual
  method TEXT DEFAULT 'face+ble', -- face+ble | face+wifi | face+remote | pin | manual
  face_confidence REAL,
  liveness_score REAL,
  ble_detected INTEGER DEFAULT 0,
  wifi_matched INTEGER DEFAULT 0,
  proximity_score REAL,
  denial_reason TEXT,
  thumbnail_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE SET NULL
);

-- Pending remote approvals (when phone not nearby)
CREATE TABLE IF NOT EXISTS home_verifications (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  lock_id TEXT NOT NULL,
  lock_name TEXT,
  face_confidence REAL,
  liveness_score REAL,
  expires_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | approved | denied | expired
  responded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES home_users(id) ON DELETE CASCADE
);

-- Home automation rules
CREATE TABLE IF NOT EXISTS home_automations (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT,              -- arrival | departure | time | manual
  action_type TEXT,               -- unlock | lock | notify | scene
  conditions TEXT DEFAULT '{}',   -- JSON
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_home_users_email ON home_users(email);
CREATE INDEX IF NOT EXISTS idx_home_users_home ON home_users(home_id);
CREATE INDEX IF NOT EXISTS idx_home_devices_user ON home_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_home_events_home ON home_events(home_id);
CREATE INDEX IF NOT EXISTS idx_home_events_created ON home_events(created_at);
CREATE INDEX IF NOT EXISTS idx_guest_passes_home ON guest_passes(home_id);
CREATE INDEX IF NOT EXISTS idx_guest_passes_token ON guest_passes(invite_token);
CREATE INDEX IF NOT EXISTS idx_home_verifications_status ON home_verifications(status);
CREATE INDEX IF NOT EXISTS idx_smart_locks_home ON smart_locks(home_id);
