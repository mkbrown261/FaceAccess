-- FaceAccess System - Initial Schema

-- Users / Employees table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  department TEXT,
  phone TEXT,
  avatar_url TEXT,
  face_embedding TEXT,
  face_registered INTEGER DEFAULT 0,
  mobile_token TEXT,
  mobile_device_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Doors / Access Points table
CREATE TABLE IF NOT EXISTS doors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  floor TEXT,
  building TEXT,
  camera_id TEXT,
  relay_ip TEXT,
  relay_port INTEGER,
  requires_2fa INTEGER DEFAULT 0,
  security_level TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Role permissions - which roles can access which doors
CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  door_id TEXT NOT NULL,
  time_start TEXT DEFAULT '00:00',
  time_end TEXT DEFAULT '23:59',
  days_allowed TEXT DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
  requires_2fa INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (door_id) REFERENCES doors(id) ON DELETE CASCADE
);

-- Individual user overrides
CREATE TABLE IF NOT EXISTS user_door_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  door_id TEXT NOT NULL,
  access_type TEXT DEFAULT 'allow',
  time_start TEXT DEFAULT '00:00',
  time_end TEXT DEFAULT '23:59',
  days_allowed TEXT DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (door_id) REFERENCES doors(id) ON DELETE CASCADE
);

-- Access log - every attempt
CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  door_id TEXT NOT NULL,
  door_name TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  method TEXT DEFAULT 'face',
  result TEXT NOT NULL,
  confidence REAL,
  denial_reason TEXT,
  ip_address TEXT,
  requires_2fa INTEGER DEFAULT 0,
  two_fa_status TEXT,
  liveness_score REAL,
  device_proximity INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (door_id) REFERENCES doors(id) ON DELETE CASCADE
);

-- Pending 2FA verifications
CREATE TABLE IF NOT EXISTS pending_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  door_id TEXT NOT NULL,
  door_name TEXT,
  confidence REAL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  responded_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (door_id) REFERENCES doors(id) ON DELETE CASCADE
);

-- Cameras table
CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  stream_url TEXT,
  camera_type TEXT DEFAULT 'ip',
  door_id TEXT,
  status TEXT DEFAULT 'active',
  last_heartbeat TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (door_id) REFERENCES doors(id) ON DELETE SET NULL
);

-- System settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_door_id ON access_logs(door_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_logs_result ON access_logs(result);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_door ON role_permissions(door_id);
CREATE INDEX IF NOT EXISTS idx_pending_verifications_user ON pending_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_verifications_status ON pending_verifications(status);
