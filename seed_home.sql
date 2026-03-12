-- FaceAccess Home - Seed Data

-- Demo homeowner
INSERT OR IGNORE INTO home_users (id, home_id, name, email, phone, role, face_registered, avatar_color, status) VALUES
  ('hu-owner-001', 'home-001', 'Jordan Kim', 'jordan.kim@email.com', '+1-555-8001', 'owner', 1, '#6366f1', 'active'),
  ('hu-member-001', 'home-001', 'Taylor Kim', 'taylor.kim@email.com', '+1-555-8002', 'member', 1, '#10b981', 'active'),
  ('hu-member-002', 'home-001', 'Casey Kim', 'casey.kim@email.com', '+1-555-8003', 'member', 0, '#f59e0b', 'active'),
  ('hu-owner-002', 'home-002', 'Alex Rivera', 'alex.rivera@email.com', '+1-555-8010', 'owner', 1, '#8b5cf6', 'active');

-- Demo homes
INSERT OR IGNORE INTO homes (id, owner_id, name, address, timezone, plan, setup_step, setup_complete, invite_code) VALUES
  ('home-001', 'hu-owner-001', 'Kim Residence', '142 Maple Street, Austin TX 78701', 'America/Chicago', 'pro', 4, 1, 'KIM-7X2P'),
  ('home-002', 'hu-owner-002', 'Rivera Apartment', '88 Oak Ave #4B, NYC NY 10001', 'America/New_York', 'free', 2, 0, 'RIV-9QK3');

-- Demo smart locks
INSERT OR IGNORE INTO smart_locks (id, home_id, name, location, lock_type, brand, is_locked, battery_pct, status) VALUES
  ('lock-001', 'home-001', 'Front Door', 'Main entrance', 'api', 'august', 0, 87, 'active'),
  ('lock-002', 'home-001', 'Back Door', 'Garden entrance', 'api', 'schlage', 1, 64, 'active'),
  ('lock-003', 'home-001', 'Garage Side', 'Garage side door', 'relay', 'generic', 1, NULL, 'active'),
  ('lock-004', 'home-002', 'Front Door', 'Main entrance', 'api', 'nuki', 1, 92, 'active');

-- Demo cameras
INSERT OR IGNORE INTO home_cameras (id, home_id, lock_id, name, stream_url, camera_type, status) VALUES
  ('hcam-001', 'home-001', 'lock-001', 'Front Doorbell', 'rtsp://192.168.1.50:554/stream', 'rtsp', 'active'),
  ('hcam-002', 'home-001', 'lock-002', 'Back Yard Cam', 'rtsp://192.168.1.51:554/stream', 'rtsp', 'active'),
  ('hcam-003', 'home-001', NULL, 'Living Room', 'rtsp://192.168.1.52:554/stream', 'rtsp', 'active'),
  ('hcam-004', 'home-002', 'lock-004', 'Entry Camera', 'rtsp://10.0.0.30:554/stream', 'rtsp', 'active');

-- Demo trusted devices
INSERT OR IGNORE INTO home_devices (id, user_id, home_id, name, platform, ble_uuid, wifi_ssid, trusted, status) VALUES
  ('dev-001', 'hu-owner-001', 'home-001', "Jordan's iPhone 16", 'ios', 'FA-BLE-7F3A-9C21', 'Kim-Home-5G', 1, 'active'),
  ('dev-002', 'hu-member-001', 'home-001', "Taylor's Pixel 9", 'android', 'FA-BLE-2D8B-1E54', 'Kim-Home-5G', 1, 'active'),
  ('dev-003', 'hu-member-002', 'home-001', "Casey's iPhone SE", 'ios', 'FA-BLE-6A1C-4F77', 'Kim-Home-5G', 0, 'active');

-- Demo guest passes
INSERT OR IGNORE INTO guest_passes (id, home_id, created_by, name, email, lock_ids, valid_from, valid_until, time_start, time_end, days_allowed, status, invite_token) VALUES
  ('gp-001', 'home-001', 'hu-owner-001', 'House Cleaner', 'cleaner@email.com', '["lock-001","lock-003"]',
    datetime('now', '-7 days'), datetime('now', '+23 days'), '09:00', '17:00', 'mon,wed,fri', 'active', 'GP-CLEAN-001'),
  ('gp-002', 'home-001', 'hu-owner-001', 'Dog Walker', 'walker@email.com', '["lock-002"]',
    datetime('now', '-1 days'), datetime('now', '+29 days'), '11:00', '14:00', 'mon,tue,wed,thu,fri', 'active', 'GP-WALK-002'),
  ('gp-003', 'home-001', 'hu-member-001', 'Weekend Guest', 'friend@email.com', '["lock-001"]',
    datetime('now', '+5 days'), datetime('now', '+7 days'), '00:00', '23:59', 'sat,sun', 'pending', 'GP-GUEST-003');

-- Demo home events
INSERT OR IGNORE INTO home_events (id, home_id, user_id, user_name, lock_id, lock_name, event_type, method, face_confidence, liveness_score, ble_detected, wifi_matched, proximity_score) VALUES
  ('hev-001', 'home-001', 'hu-owner-001', 'Jordan Kim', 'lock-001', 'Front Door', 'unlock', 'face+ble', 0.97, 0.99, 1, 1, 0.95),
  ('hev-002', 'home-001', 'hu-member-001', 'Taylor Kim', 'lock-001', 'Front Door', 'unlock', 'face+ble', 0.94, 0.98, 1, 1, 0.91),
  ('hev-003', 'home-001', NULL, 'Unknown', 'lock-001', 'Front Door', 'denied', 'face', 0.28, 0.71, 0, 0, 0.0),
  ('hev-004', 'home-001', 'hu-owner-001', 'Jordan Kim', 'lock-002', 'Back Door', 'unlock', 'face+wifi', 0.96, 0.99, 0, 1, 0.78),
  ('hev-005', 'home-001', 'hu-member-001', 'Taylor Kim', 'lock-001', 'Front Door', 'unlock', 'face+ble', 0.93, 0.97, 1, 1, 0.89),
  ('hev-006', 'home-001', NULL, 'Unknown', 'lock-001', 'Front Door', 'alert', 'face', 0.41, 0.55, 0, 0, 0.0),
  ('hev-007', 'home-001', 'hu-owner-001', 'Jordan Kim', 'lock-001', 'Front Door', 'unlock', 'face+remote', 0.88, 0.96, 0, 0, 0.0),
  ('hev-008', 'home-001', 'hu-owner-001', 'Jordan Kim', 'lock-002', 'Back Door', 'unlock', 'face+ble', 0.95, 0.98, 1, 1, 0.93);

-- Demo automations
INSERT OR IGNORE INTO home_automations (id, home_id, name, trigger_type, action_type, enabled) VALUES
  ('auto-001', 'home-001', 'Auto-lock at midnight', 'time', 'lock', 1),
  ('auto-002', 'home-001', 'Welcome home scene', 'arrival', 'scene', 1),
  ('auto-003', 'home-001', 'Lock on departure', 'departure', 'lock', 1);
