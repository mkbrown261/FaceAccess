-- Seed data for FaceAccess System

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('company_name', 'Acme Corporation'),
  ('face_match_threshold_high', '0.85'),
  ('face_match_threshold_medium', '0.65'),
  ('liveness_enabled', 'true'),
  ('two_fa_enabled', 'true'),
  ('max_failed_attempts', '5'),
  ('lockout_duration_minutes', '15'),
  ('log_retention_days', '90'),
  ('timezone', 'UTC');

-- Demo Doors
INSERT OR IGNORE INTO doors (id, name, location, floor, building, requires_2fa, security_level, status) VALUES
  ('door-main-001', 'Main Entrance', 'Building A - Lobby', 'Ground', 'Building A', 0, 'standard', 'active'),
  ('door-main-002', 'Side Entrance', 'Building A - Side', 'Ground', 'Building A', 0, 'standard', 'active'),
  ('door-office-001', 'Office Floor A', 'Building A - 2nd Floor', '2nd', 'Building A', 0, 'standard', 'active'),
  ('door-office-002', 'Office Floor B', 'Building A - 3rd Floor', '3rd', 'Building A', 0, 'standard', 'active'),
  ('door-server-001', 'Server Room', 'Building A - Basement', 'Basement', 'Building A', 1, 'high', 'active'),
  ('door-exec-001', 'Executive Suite', 'Building A - 5th Floor', '5th', 'Building A', 1, 'high', 'active'),
  ('door-lab-001', 'Research Lab', 'Building B - 1st Floor', '1st', 'Building B', 1, 'critical', 'active'),
  ('door-parking-001', 'Parking Garage', 'Parking Structure', 'G', 'Parking', 0, 'low', 'active');

-- Role permissions - Employee
INSERT OR IGNORE INTO role_permissions (id, role, door_id, time_start, time_end, days_allowed, requires_2fa) VALUES
  ('rp-emp-001', 'employee', 'door-main-001', '07:00', '20:00', 'mon,tue,wed,thu,fri', 0),
  ('rp-emp-002', 'employee', 'door-main-002', '07:00', '20:00', 'mon,tue,wed,thu,fri', 0),
  ('rp-emp-003', 'employee', 'door-office-001', '07:00', '20:00', 'mon,tue,wed,thu,fri', 0),
  ('rp-emp-004', 'employee', 'door-parking-001', '06:00', '22:00', 'mon,tue,wed,thu,fri,sat', 0);

-- Role permissions - Manager
INSERT OR IGNORE INTO role_permissions (id, role, door_id, time_start, time_end, days_allowed, requires_2fa) VALUES
  ('rp-mgr-001', 'manager', 'door-main-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-mgr-002', 'manager', 'door-main-002', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-mgr-003', 'manager', 'door-office-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-mgr-004', 'manager', 'door-office-002', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-mgr-005', 'manager', 'door-exec-001', '08:00', '19:00', 'mon,tue,wed,thu,fri', 1),
  ('rp-mgr-006', 'manager', 'door-parking-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0);

-- Role permissions - Admin
INSERT OR IGNORE INTO role_permissions (id, role, door_id, time_start, time_end, days_allowed, requires_2fa) VALUES
  ('rp-adm-001', 'admin', 'door-main-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-adm-002', 'admin', 'door-main-002', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-adm-003', 'admin', 'door-office-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-adm-004', 'admin', 'door-office-002', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0),
  ('rp-adm-005', 'admin', 'door-server-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 1),
  ('rp-adm-006', 'admin', 'door-exec-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 1),
  ('rp-adm-007', 'admin', 'door-lab-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 1),
  ('rp-adm-008', 'admin', 'door-parking-001', '00:00', '23:59', 'mon,tue,wed,thu,fri,sat,sun', 0);

-- Demo cameras
INSERT OR IGNORE INTO cameras (id, name, location, stream_url, camera_type, door_id, status) VALUES
  ('cam-001', 'Main Entrance Camera', 'Building A - Lobby', 'rtsp://192.168.1.100:554/stream1', 'rtsp', 'door-main-001', 'active'),
  ('cam-002', 'Side Entrance Camera', 'Building A - Side', 'rtsp://192.168.1.101:554/stream1', 'rtsp', 'door-main-002', 'active'),
  ('cam-003', 'Office Floor A Camera', 'Building A - 2nd Floor', 'rtsp://192.168.1.102:554/stream1', 'rtsp', 'door-office-001', 'active'),
  ('cam-004', 'Server Room Camera', 'Building A - Basement', 'rtsp://192.168.1.103:554/stream1', 'rtsp', 'door-server-001', 'active');

-- Demo users (face embeddings are simulated 128-dim vectors)
INSERT OR IGNORE INTO users (id, name, email, role, department, phone, face_registered, status) VALUES
  ('usr-admin-001', 'Sarah Chen', 'sarah.chen@acme.com', 'admin', 'IT Security', '+1-555-0101', 1, 'active'),
  ('usr-mgr-001', 'James Wilson', 'james.wilson@acme.com', 'manager', 'Engineering', '+1-555-0102', 1, 'active'),
  ('usr-mgr-002', 'Emily Rodriguez', 'emily.rodriguez@acme.com', 'manager', 'Operations', '+1-555-0103', 1, 'active'),
  ('usr-emp-001', 'Michael Park', 'michael.park@acme.com', 'employee', 'Engineering', '+1-555-0104', 1, 'active'),
  ('usr-emp-002', 'Jessica Thompson', 'jessica.thompson@acme.com', 'employee', 'Marketing', '+1-555-0105', 1, 'active'),
  ('usr-emp-003', 'David Kumar', 'david.kumar@acme.com', 'employee', 'Finance', '+1-555-0106', 1, 'active'),
  ('usr-vis-001', 'Alex Martinez', 'alex.martinez@visitor.com', 'visitor', 'External', '+1-555-0201', 0, 'active');

-- Sample access log entries (recent activity simulation)
INSERT OR IGNORE INTO access_logs (id, user_id, user_name, door_id, door_name, timestamp, method, result, confidence, liveness_score) VALUES
  ('log-001', 'usr-emp-001', 'Michael Park', 'door-main-001', 'Main Entrance', datetime('now', '-2 hours'), 'face', 'granted', 0.94, 0.98),
  ('log-002', 'usr-emp-002', 'Jessica Thompson', 'door-main-001', 'Main Entrance', datetime('now', '-1 hour', '-45 minutes'), 'face', 'granted', 0.91, 0.97),
  ('log-003', 'usr-mgr-001', 'James Wilson', 'door-office-001', 'Office Floor A', datetime('now', '-1 hour', '-30 minutes'), 'face', 'granted', 0.96, 0.99),
  ('log-004', NULL, 'Unknown', 'door-server-001', 'Server Room', datetime('now', '-1 hour'), 'face', 'denied', 0.42, 0.95),
  ('log-005', 'usr-emp-003', 'David Kumar', 'door-main-001', 'Main Entrance', datetime('now', '-45 minutes'), 'face', 'granted', 0.89, 0.96),
  ('log-006', 'usr-admin-001', 'Sarah Chen', 'door-server-001', 'Server Room', datetime('now', '-30 minutes'), 'face+2fa', 'granted', 0.98, 0.99),
  ('log-007', NULL, 'Unknown', 'door-main-001', 'Main Entrance', datetime('now', '-20 minutes'), 'face', 'denied', 0.31, 0.72),
  ('log-008', 'usr-emp-001', 'Michael Park', 'door-office-001', 'Office Floor A', datetime('now', '-10 minutes'), 'face', 'granted', 0.93, 0.97),
  ('log-009', 'usr-mgr-002', 'Emily Rodriguez', 'door-exec-001', 'Executive Suite', datetime('now', '-5 minutes'), 'face+2fa', 'granted', 0.97, 0.98),
  ('log-010', NULL, 'Unknown', 'door-main-001', 'Main Entrance', datetime('now', '-2 minutes'), 'face', 'denied', 0.28, 0.45);
