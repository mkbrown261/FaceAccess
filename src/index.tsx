import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './public' }))

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────
function nanoid(len = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0]
}

// Simulated face embedding cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// Generate a deterministic fake embedding from a string seed
function seedEmbedding(seed: string): number[] {
  const emb: number[] = []
  for (let i = 0; i < 128; i++) {
    const x = Math.sin(seed.charCodeAt(i % seed.length) * (i + 1) * 0.7853) * 43758.5453
    emb.push(x - Math.floor(x) - 0.5)
  }
  const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0))
  return emb.map(v => v / norm)
}

function checkDayAllowed(daysAllowed: string): boolean {
  const today = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()]
  return daysAllowed.split(',').includes(today)
}

function checkTimeAllowed(timeStart: string, timeEnd: string): boolean {
  const now = new Date()
  const [sh, sm] = timeStart.split(':').map(Number)
  const [eh, em] = timeEnd.split(':').map(Number)
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return cur >= start && cur <= end
}

// ─────────────────────────────────────────────
// API: USERS
// ─────────────────────────────────────────────
app.get('/api/users', async (c) => {
  const { DB } = c.env
  const role = c.req.query('role')
  const status = c.req.query('status') || 'active'
  let query = 'SELECT id,name,email,role,department,phone,face_registered,status,created_at FROM users WHERE 1=1'
  const args: string[] = []
  if (role) { query += ' AND role=?'; args.push(role) }
  if (status !== 'all') { query += ' AND status=?'; args.push(status) }
  query += ' ORDER BY name ASC'
  const { results } = await DB.prepare(query).bind(...args).all()
  return c.json({ users: results })
})

app.get('/api/users/:id', async (c) => {
  const { DB } = c.env
  const user = await DB.prepare('SELECT * FROM users WHERE id=?').bind(c.req.param('id')).first()
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ user })
})

app.post('/api/users', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, email, role, department, phone } = body
  if (!name || !email || !role) return c.json({ error: 'name, email, role required' }, 400)
  const existing = await DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()
  if (existing) return c.json({ error: 'Email already registered' }, 409)
  const id = 'usr-' + nanoid(8)
  await DB.prepare(`INSERT INTO users (id,name,email,role,department,phone,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'active',?,?)`).bind(id, name, email, role, department||null, phone||null, now(), now()).run()
  const user = await DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first()
  return c.json({ user, message: 'User created' }, 201)
})

app.put('/api/users/:id', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, email, role, department, phone, status } = body
  await DB.prepare(`UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email),
    role=COALESCE(?,role), department=COALESCE(?,department), phone=COALESCE(?,phone),
    status=COALESCE(?,status), updated_at=? WHERE id=?`)
    .bind(name||null, email||null, role||null, department||null, phone||null, status||null, now(), c.req.param('id')).run()
  const user = await DB.prepare('SELECT * FROM users WHERE id=?').bind(c.req.param('id')).first()
  return c.json({ user, message: 'User updated' })
})

app.delete('/api/users/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE users SET status=?,face_embedding=NULL,face_registered=0,updated_at=? WHERE id=?')
    .bind('deleted', now(), c.req.param('id')).run()
  return c.json({ message: 'User deleted' })
})

// Register face embedding
app.post('/api/users/:id/face', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { embedding, image_quality } = body

  let embeddingData: number[]
  // If real embedding passed use it, else generate simulated one from userId
  if (embedding && Array.isArray(embedding) && embedding.length >= 64) {
    embeddingData = embedding
  } else {
    // Simulate: generate from userId + timestamp for demo
    embeddingData = seedEmbedding(c.req.param('id') + Date.now())
  }

  await DB.prepare('UPDATE users SET face_embedding=?,face_registered=1,updated_at=? WHERE id=?')
    .bind(JSON.stringify(embeddingData), now(), c.req.param('id')).run()

  return c.json({ message: 'Face registered successfully', quality: image_quality || 0.95 })
})

app.delete('/api/users/:id/face', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE users SET face_embedding=NULL,face_registered=0,updated_at=? WHERE id=?')
    .bind(now(), c.req.param('id')).run()
  return c.json({ message: 'Face data deleted (biometric erasure complete)' })
})

// ─────────────────────────────────────────────
// API: DOORS
// ─────────────────────────────────────────────
app.get('/api/doors', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare('SELECT * FROM doors ORDER BY building, floor, name').all()
  return c.json({ doors: results })
})

app.post('/api/doors', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, location, floor, building, requires_2fa, security_level } = body
  if (!name || !location) return c.json({ error: 'name and location required' }, 400)
  const id = 'door-' + nanoid(8)
  await DB.prepare(`INSERT INTO doors (id,name,location,floor,building,requires_2fa,security_level,status,created_at)
    VALUES (?,?,?,?,?,?,?,'active',?)`).bind(id, name, location, floor||null, building||null,
    requires_2fa ? 1 : 0, security_level||'standard', now()).run()
  const door = await DB.prepare('SELECT * FROM doors WHERE id=?').bind(id).first()
  return c.json({ door, message: 'Door created' }, 201)
})

app.put('/api/doors/:id', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, location, floor, building, requires_2fa, security_level, status } = body
  await DB.prepare(`UPDATE doors SET name=COALESCE(?,name), location=COALESCE(?,location),
    floor=COALESCE(?,floor), building=COALESCE(?,building),
    requires_2fa=COALESCE(?,requires_2fa), security_level=COALESCE(?,security_level),
    status=COALESCE(?,status) WHERE id=?`)
    .bind(name||null, location||null, floor||null, building||null,
      requires_2fa !== undefined ? (requires_2fa ? 1 : 0) : null,
      security_level||null, status||null, c.req.param('id')).run()
  const door = await DB.prepare('SELECT * FROM doors WHERE id=?').bind(c.req.param('id')).first()
  return c.json({ door, message: 'Door updated' })
})

app.delete('/api/doors/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE doors SET status=? WHERE id=?').bind('inactive', c.req.param('id')).run()
  return c.json({ message: 'Door deactivated' })
})

// ─────────────────────────────────────────────
// API: ROLE PERMISSIONS
// ─────────────────────────────────────────────
app.get('/api/permissions', async (c) => {
  const { DB } = c.env
  const role = c.req.query('role')
  let query = `SELECT rp.*, d.name as door_name, d.location as door_location, d.security_level
    FROM role_permissions rp JOIN doors d ON rp.door_id=d.id WHERE 1=1`
  const args: string[] = []
  if (role) { query += ' AND rp.role=?'; args.push(role) }
  const { results } = await DB.prepare(query).bind(...args).all()
  return c.json({ permissions: results })
})

app.post('/api/permissions', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { role, door_id, time_start, time_end, days_allowed, requires_2fa } = body
  if (!role || !door_id) return c.json({ error: 'role and door_id required' }, 400)
  const id = 'rp-' + nanoid(8)
  await DB.prepare(`INSERT INTO role_permissions (id,role,door_id,time_start,time_end,days_allowed,requires_2fa,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id, role, door_id, time_start||'00:00', time_end||'23:59',
    days_allowed||'mon,tue,wed,thu,fri', requires_2fa ? 1 : 0, now()).run()
  return c.json({ message: 'Permission created', id }, 201)
})

app.delete('/api/permissions/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare('DELETE FROM role_permissions WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ message: 'Permission removed' })
})

// ─────────────────────────────────────────────
// API: FACE RECOGNITION - Core Access Check
// ─────────────────────────────────────────────
app.post('/api/recognize', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { embedding, door_id, liveness_score, device_info } = body

  if (!door_id) return c.json({ error: 'door_id required' }, 400)

  // Get door info
  const door = await DB.prepare('SELECT * FROM doors WHERE id=? AND status=?').bind(door_id, 'active').first() as any
  if (!door) return c.json({ error: 'Door not found or inactive' }, 404)

  // Liveness check
  const livenessScore = liveness_score ?? (0.85 + Math.random() * 0.15)
  if (livenessScore < 0.5) {
    const logId = 'log-' + nanoid(10)
    await DB.prepare(`INSERT INTO access_logs (id,door_id,door_name,timestamp,method,result,confidence,denial_reason,liveness_score,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(logId, door_id, door.name, now(), 'face', 'denied', 0, 'liveness_failed', livenessScore, now()).run()
    return c.json({ result: 'denied', reason: 'liveness_failed', liveness_score: livenessScore })
  }

  // If no embedding provided, simulate random result for demo
  let matchedUser: any = null
  let confidence = 0

  if (embedding && Array.isArray(embedding) && embedding.length >= 64) {
    // Real embedding comparison
    const { results: users } = await DB.prepare('SELECT id,name,role,face_embedding FROM users WHERE face_registered=1 AND status=?').bind('active').all() as any
    let bestScore = 0
    let bestUser: any = null
    for (const user of users) {
      if (!user.face_embedding) continue
      try {
        const stored = JSON.parse(user.face_embedding)
        const score = cosineSimilarity(embedding, stored)
        if (score > bestScore) { bestScore = score; bestUser = user }
      } catch {}
    }
    confidence = bestScore
    if (bestScore > 0.65) matchedUser = bestUser
  } else {
    // Demo mode: simulate recognition result
    const scenario = Math.random()
    if (scenario < 0.65) {
      // Simulate a match from seed users
      const { results: users } = await DB.prepare('SELECT id,name,role FROM users WHERE face_registered=1 AND status=? ORDER BY RANDOM() LIMIT 1').bind('active').all() as any
      if (users.length > 0) {
        matchedUser = users[0]
        confidence = 0.82 + Math.random() * 0.16
      }
    } else if (scenario < 0.85) {
      confidence = 0.55 + Math.random() * 0.12 // medium confidence
    } else {
      confidence = 0.1 + Math.random() * 0.35  // low / no match
    }
  }

  const HIGH_THRESHOLD = 0.85
  const MED_THRESHOLD = 0.65

  // No match
  if (confidence < MED_THRESHOLD || !matchedUser) {
    const logId = 'log-' + nanoid(10)
    await DB.prepare(`INSERT INTO access_logs (id,user_id,user_name,door_id,door_name,timestamp,method,result,confidence,denial_reason,liveness_score,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(logId, null, 'Unknown', door_id, door.name, now(), 'face', 'denied', confidence, 'no_match', livenessScore, now()).run()
    return c.json({ result: 'denied', reason: 'no_match', confidence })
  }

  // Check access permission for this user's role on this door
  const perm = await DB.prepare(`SELECT * FROM role_permissions WHERE role=? AND door_id=?`)
    .bind(matchedUser.role, door_id).first() as any

  // Also check individual override
  const override = await DB.prepare(`SELECT * FROM user_door_permissions WHERE user_id=? AND door_id=?`)
    .bind(matchedUser.id, door_id).first() as any

  const hasPermission = override ? override.access_type === 'allow' : !!perm

  if (!hasPermission) {
    const logId = 'log-' + nanoid(10)
    await DB.prepare(`INSERT INTO access_logs (id,user_id,user_name,door_id,door_name,timestamp,method,result,confidence,denial_reason,liveness_score,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(logId, matchedUser.id, matchedUser.name, door_id, door.name, now(), 'face', 'denied', confidence, 'no_permission', livenessScore, now()).run()
    return c.json({ result: 'denied', reason: 'no_permission', user: { name: matchedUser.name, role: matchedUser.role }, confidence })
  }

  // Check time/day restrictions
  const effectivePerm = override || perm
  const timeOk = checkTimeAllowed(effectivePerm.time_start, effectivePerm.time_end)
  const dayOk = checkDayAllowed(effectivePerm.days_allowed)

  if (!timeOk || !dayOk) {
    const logId = 'log-' + nanoid(10)
    await DB.prepare(`INSERT INTO access_logs (id,user_id,user_name,door_id,door_name,timestamp,method,result,confidence,denial_reason,liveness_score,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(logId, matchedUser.id, matchedUser.name, door_id, door.name, now(), 'face', 'denied', confidence, 'outside_hours', livenessScore, now()).run()
    return c.json({ result: 'denied', reason: 'outside_hours', user: { name: matchedUser.name }, confidence })
  }

  // Determine if 2FA needed
  const needs2FA = (door.requires_2fa || effectivePerm.requires_2fa || confidence < HIGH_THRESHOLD)
  const method = needs2FA ? 'face+2fa' : 'face'

  if (needs2FA) {
    // Create pending verification
    const verId = 'ver-' + nanoid(10)
    const expiresAt = new Date(Date.now() + 120000).toISOString().replace('T', ' ').split('.')[0]
    await DB.prepare(`INSERT INTO pending_verifications (id,user_id,door_id,door_name,confidence,created_at,expires_at,status)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(verId, matchedUser.id, door_id, door.name, confidence, now(), expiresAt, 'pending').run()
    return c.json({
      result: 'pending_2fa',
      verification_id: verId,
      user: { id: matchedUser.id, name: matchedUser.name, role: matchedUser.role },
      door: { id: door.id, name: door.name },
      confidence,
      message: 'Push notification sent to mobile device'
    })
  }

  // Grant access
  const logId = 'log-' + nanoid(10)
  await DB.prepare(`INSERT INTO access_logs (id,user_id,user_name,door_id,door_name,timestamp,method,result,confidence,liveness_score,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(logId, matchedUser.id, matchedUser.name, door_id, door.name, now(), method, 'granted', confidence, livenessScore, now()).run()

  return c.json({
    result: 'granted',
    user: { id: matchedUser.id, name: matchedUser.name, role: matchedUser.role },
    door: { id: door.id, name: door.name },
    confidence,
    method
  })
})

// ─────────────────────────────────────────────
// API: 2FA Verification
// ─────────────────────────────────────────────
app.get('/api/verify/:id', async (c) => {
  const { DB } = c.env
  const ver = await DB.prepare('SELECT * FROM pending_verifications WHERE id=?').bind(c.req.param('id')).first() as any
  if (!ver) return c.json({ error: 'Verification not found' }, 404)
  const expired = new Date(ver.expires_at) < new Date()
  return c.json({ ...ver, expired })
})

app.post('/api/verify/:id/respond', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { action, proximity_verified, device_id } = body
  if (!['approve', 'deny'].includes(action)) return c.json({ error: 'action must be approve or deny' }, 400)

  const ver = await DB.prepare('SELECT * FROM pending_verifications WHERE id=? AND status=?')
    .bind(c.req.param('id'), 'pending').first() as any
  if (!ver) return c.json({ error: 'Verification not found or already completed' }, 404)

  if (new Date(ver.expires_at) < new Date()) {
    await DB.prepare('UPDATE pending_verifications SET status=? WHERE id=?').bind('expired', ver.id).run()
    return c.json({ error: 'Verification expired' }, 410)
  }

  // Proximity check (simulated)
  if (action === 'approve' && !proximity_verified) {
    return c.json({ error: 'Proximity verification required', proximity_required: true }, 403)
  }

  const status = action === 'approve' ? 'approved' : 'denied'
  await DB.prepare('UPDATE pending_verifications SET status=?,responded_at=? WHERE id=?')
    .bind(status, now(), ver.id).run()

  const logId = 'log-' + nanoid(10)
  const result = action === 'approve' ? 'granted' : 'denied'
  await DB.prepare(`INSERT INTO access_logs (id,user_id,door_id,door_name,timestamp,method,result,confidence,requires_2fa,two_fa_status,device_proximity,liveness_score,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(logId, ver.user_id, ver.door_id, ver.door_name, now(), 'face+2fa', result,
      ver.confidence, 1, status, proximity_verified ? 1 : 0, 0.95, now()).run()

  return c.json({ result, message: action === 'approve' ? 'Access granted via mobile approval' : 'Access denied by user' })
})

// ─────────────────────────────────────────────
// API: ACCESS LOGS
// ─────────────────────────────────────────────
app.get('/api/logs', async (c) => {
  const { DB } = c.env
  const door_id = c.req.query('door_id')
  const user_id = c.req.query('user_id')
  const result = c.req.query('result')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  let query = 'SELECT * FROM access_logs WHERE 1=1'
  const args: (string | number)[] = []
  if (door_id) { query += ' AND door_id=?'; args.push(door_id) }
  if (user_id) { query += ' AND user_id=?'; args.push(user_id) }
  if (result) { query += ' AND result=?'; args.push(result) }
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  args.push(limit, offset)

  const { results } = await DB.prepare(query).bind(...args).all()
  const totalRow = await DB.prepare('SELECT COUNT(*) as cnt FROM access_logs').first() as any
  return c.json({ logs: results, total: totalRow?.cnt || 0 })
})

// ─────────────────────────────────────────────
// API: ANALYTICS
// ─────────────────────────────────────────────
app.get('/api/analytics/summary', async (c) => {
  const { DB } = c.env

  const totalUsers = await DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE status='active'").first() as any
  const registeredFaces = await DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE face_registered=1 AND status='active'").first() as any
  const totalDoors = await DB.prepare("SELECT COUNT(*) as cnt FROM doors WHERE status='active'").first() as any
  const todayGranted = await DB.prepare("SELECT COUNT(*) as cnt FROM access_logs WHERE result='granted' AND timestamp >= date('now')").first() as any
  const todayDenied = await DB.prepare("SELECT COUNT(*) as cnt FROM access_logs WHERE result='denied' AND timestamp >= date('now')").first() as any
  const total24h = await DB.prepare("SELECT COUNT(*) as cnt FROM access_logs WHERE timestamp >= datetime('now', '-24 hours')").first() as any
  const pending2fa = await DB.prepare("SELECT COUNT(*) as cnt FROM pending_verifications WHERE status='pending'").first() as any

  // Access by door (last 24h)
  const { results: byDoor } = await DB.prepare(`SELECT door_name, COUNT(*) as total,
    SUM(CASE WHEN result='granted' THEN 1 ELSE 0 END) as granted,
    SUM(CASE WHEN result='denied' THEN 1 ELSE 0 END) as denied
    FROM access_logs WHERE timestamp >= datetime('now', '-24 hours')
    GROUP BY door_id, door_name ORDER BY total DESC`).all()

  // Hourly access (last 24h)
  const { results: hourly } = await DB.prepare(`SELECT strftime('%H', timestamp) as hour,
    COUNT(*) as total,
    SUM(CASE WHEN result='granted' THEN 1 ELSE 0 END) as granted
    FROM access_logs WHERE timestamp >= datetime('now', '-24 hours')
    GROUP BY hour ORDER BY hour`).all()

  // Recent denials
  const { results: recentDenials } = await DB.prepare(`SELECT * FROM access_logs WHERE result='denied'
    ORDER BY timestamp DESC LIMIT 5`).all()

  // Top users today
  const { results: topUsers } = await DB.prepare(`SELECT user_name, COUNT(*) as accesses
    FROM access_logs WHERE result='granted' AND timestamp >= date('now') AND user_name != 'Unknown'
    GROUP BY user_id, user_name ORDER BY accesses DESC LIMIT 5`).all()

  return c.json({
    summary: {
      total_users: totalUsers?.cnt || 0,
      registered_faces: registeredFaces?.cnt || 0,
      total_doors: totalDoors?.cnt || 0,
      today_granted: todayGranted?.cnt || 0,
      today_denied: todayDenied?.cnt || 0,
      access_24h: total24h?.cnt || 0,
      pending_2fa: pending2fa?.cnt || 0
    },
    by_door: byDoor,
    hourly,
    recent_denials: recentDenials,
    top_users: topUsers
  })
})

app.get('/api/analytics/attendance', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT u.name, u.role, u.department,
      COUNT(DISTINCT date(al.timestamp)) as days_present,
      MAX(al.timestamp) as last_access,
      COUNT(*) as total_accesses
    FROM users u
    LEFT JOIN access_logs al ON u.id = al.user_id AND al.result='granted'
    WHERE u.status='active'
    GROUP BY u.id, u.name, u.role, u.department
    ORDER BY days_present DESC, u.name ASC
  `).all()
  return c.json({ attendance: results })
})

// ─────────────────────────────────────────────
// API: CAMERAS
// ─────────────────────────────────────────────
app.get('/api/cameras', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`SELECT c.*, d.name as door_name FROM cameras c
    LEFT JOIN doors d ON c.door_id=d.id ORDER BY c.name`).all()
  return c.json({ cameras: results })
})

app.post('/api/cameras', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, location, stream_url, camera_type, door_id } = body
  const id = 'cam-' + nanoid(8)
  await DB.prepare(`INSERT INTO cameras (id,name,location,stream_url,camera_type,door_id,status,created_at)
    VALUES (?,?,?,?,?,?,'active',?)`).bind(id, name, location, stream_url||null, camera_type||'ip', door_id||null, now()).run()
  const cam = await DB.prepare('SELECT * FROM cameras WHERE id=?').bind(id).first()
  return c.json({ camera: cam, message: 'Camera added' }, 201)
})

app.put('/api/cameras/:id/heartbeat', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE cameras SET last_heartbeat=? WHERE id=?').bind(now(), c.req.param('id')).run()
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────
// API: SETTINGS
// ─────────────────────────────────────────────
app.get('/api/settings', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare('SELECT * FROM settings').all()
  const settings: Record<string, string> = {}
  for (const row of results as any[]) settings[row.key] = row.value
  return c.json({ settings })
})

app.put('/api/settings', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  for (const [key, value] of Object.entries(body)) {
    await DB.prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)')
      .bind(key, String(value), now()).run()
  }
  return c.json({ message: 'Settings updated' })
})

// ─────────────────────────────────────────────
// Mobile App companion endpoint
// ─────────────────────────────────────────────
app.get('/api/mobile/pending/:user_id', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`SELECT pv.*, d.name as door_name, d.location as door_location, d.security_level
    FROM pending_verifications pv JOIN doors d ON pv.door_id=d.id
    WHERE pv.user_id=? AND pv.status='pending' AND pv.expires_at > datetime('now')
    ORDER BY pv.created_at DESC`)
    .bind(c.req.param('user_id')).all()
  return c.json({ pending: results })
})

app.post('/api/mobile/register', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { user_id, device_id, push_token } = body
  if (!user_id || !device_id) return c.json({ error: 'user_id and device_id required' }, 400)
  await DB.prepare('UPDATE users SET mobile_token=?,mobile_device_id=?,updated_at=? WHERE id=?')
    .bind(push_token||null, device_id, now(), user_id).run()
  return c.json({ message: 'Mobile device registered' })
})

// ─────────────────────────────────────────────
// Main HTML app (SPA)
// ─────────────────────────────────────────────
app.get('/mobile', (c) => {
  return c.html(getMobileHTML())
})

app.get('/mobile/*', (c) => {
  return c.html(getMobileHTML())
})

app.get('*', (c) => {
  return c.html(getMainHTML())
})

// ─────────────────────────────────────────────
// Main Dashboard HTML
// ─────────────────────────────────────────────
function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FaceAccess — Facial Recognition Access Control</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
:root {
  --accent: #6366f1;
  --accent2: #8b5cf6;
  --success: #10b981;
  --danger: #ef4444;
  --warn: #f59e0b;
}
* { box-sizing: border-box; }
body { font-family: 'Inter', system-ui, sans-serif; background: #0f0f1a; color: #e2e8f0; }
.sidebar { background: #13131f; border-right: 1px solid #1e1e30; }
.card { background: #1a1a2e; border: 1px solid #23233a; border-radius: 12px; }
.card-glass { background: rgba(99,102,241,0.07); backdrop-filter: blur(10px); border: 1px solid rgba(99,102,241,0.2); border-radius: 12px; }
.btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 8px; padding: 8px 18px; cursor: pointer; font-weight: 600; transition: all 0.2s; }
.btn-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 20px rgba(99,102,241,0.4); }
.btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; border-radius: 8px; padding: 8px 18px; cursor: pointer; font-weight: 600; }
.btn-ghost { background: transparent; color: #94a3b8; border: 1px solid #2d2d4a; border-radius: 8px; padding: 8px 18px; cursor: pointer; transition: all 0.2s; }
.btn-ghost:hover { border-color: #6366f1; color: #6366f1; }
.input { background: #0f0f1a; border: 1px solid #2d2d4a; border-radius: 8px; padding: 10px 14px; color: #e2e8f0; width: 100%; outline: none; transition: border 0.2s; }
.input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-employee { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
.badge-manager { background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); }
.badge-admin { background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
.badge-visitor { background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); }
.badge-granted { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
.badge-denied { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
.badge-pending { background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
.badge-standard { background: rgba(99,102,241,0.1); color: #a5b4fc; }
.badge-high { background: rgba(245,158,11,0.1); color: #fbbf24; }
.badge-critical { background: rgba(239,68,68,0.1); color: #f87171; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 8px; cursor: pointer; color: #64748b; transition: all 0.2s; font-weight: 500; }
.nav-item:hover { background: rgba(99,102,241,0.1); color: #a5b4fc; }
.nav-item.active { background: rgba(99,102,241,0.15); color: #818cf8; border-left: 3px solid #6366f1; }
.pulse { animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.scan-ring { animation: scanRing 2s ease-in-out infinite; }
@keyframes scanRing { 0% { transform: scale(0.95); opacity: 1; } 100% { transform: scale(1.15); opacity: 0; } }
.stat-card { background: linear-gradient(135deg, #1a1a2e, #16162a); border: 1px solid #23233a; border-radius: 14px; padding: 20px; transition: transform 0.2s; }
.stat-card:hover { transform: translateY(-2px); }
.table-row { transition: background 0.15s; }
.table-row:hover { background: rgba(99,102,241,0.05); }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 50; display: flex; align-items: center; justify-content: center; }
.modal { background: #1a1a2e; border: 1px solid #23233a; border-radius: 16px; padding: 28px; max-width: 520px; width: 90%; max-height: 90vh; overflow-y: auto; }
.face-scanner { position: relative; width: 280px; height: 280px; margin: 0 auto; }
.face-scanner video { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.face-scanner .ring { position: absolute; inset: -8px; border: 3px solid #6366f1; border-radius: 50%; }
.face-scanner .scan-line { position: absolute; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #6366f1, transparent); animation: scan 2s linear infinite; }
@keyframes scan { 0% { top: 0; } 100% { top: 100%; } }
.confidence-bar { height: 8px; border-radius: 4px; background: #1e1e30; overflow: hidden; }
.confidence-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
.door-card { background: #13131f; border: 1px solid #1e1e30; border-radius: 12px; padding: 16px; transition: all 0.2s; cursor: pointer; }
.door-card:hover { border-color: #6366f1; transform: translateY(-2px); }
.door-card.locked { border-left: 4px solid #ef4444; }
.door-card.unlocked { border-left: 4px solid #10b981; }
.log-row-granted { border-left: 3px solid #10b981; }
.log-row-denied { border-left: 3px solid #ef4444; }
.camera-feed { background: #0a0a14; border: 1px solid #1e1e30; border-radius: 12px; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
select.input option { background: #1a1a2e; }
.glow-indigo { box-shadow: 0 0 30px rgba(99,102,241,0.2); }
.alert-flash { animation: alertFlash 0.5s ease 3; }
@keyframes alertFlash { 0%,100% { background: rgba(239,68,68,0.1); } 50% { background: rgba(239,68,68,0.25); } }
</style>
</head>
<body class="h-full flex">

<!-- Sidebar -->
<aside class="sidebar w-64 flex-shrink-0 flex flex-col h-screen sticky top-0">
  <div class="p-5 border-b border-gray-800">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
        <i class="fas fa-eye text-white text-lg"></i>
      </div>
      <div>
        <h1 class="font-bold text-white text-base leading-tight">FaceAccess</h1>
        <p class="text-xs text-gray-500">Access Control System</p>
      </div>
    </div>
  </div>

  <nav class="p-3 flex-1 space-y-1 overflow-y-auto">
    <div class="text-xs font-semibold text-gray-600 uppercase tracking-widest px-3 py-2">Overview</div>
    <a onclick="showPage('dashboard')" class="nav-item active" id="nav-dashboard">
      <i class="fas fa-th-large w-5 text-center"></i> Dashboard
    </a>
    <a onclick="showPage('live')" class="nav-item" id="nav-live">
      <i class="fas fa-video w-5 text-center"></i> Live Monitor
      <span class="ml-auto w-2 h-2 rounded-full bg-red-500 pulse"></span>
    </a>

    <div class="text-xs font-semibold text-gray-600 uppercase tracking-widest px-3 py-2 mt-2">Access Control</div>
    <a onclick="showPage('recognize')" class="nav-item" id="nav-recognize">
      <i class="fas fa-face-grin-wide w-5 text-center"></i> Face ID Test
    </a>
    <a onclick="showPage('users')" class="nav-item" id="nav-users">
      <i class="fas fa-users w-5 text-center"></i> Users
    </a>
    <a onclick="showPage('doors')" class="nav-item" id="nav-doors">
      <i class="fas fa-door-open w-5 text-center"></i> Doors & Zones
    </a>
    <a onclick="showPage('permissions')" class="nav-item" id="nav-permissions">
      <i class="fas fa-shield-alt w-5 text-center"></i> Permissions
    </a>

    <div class="text-xs font-semibold text-gray-600 uppercase tracking-widest px-3 py-2 mt-2">Insights</div>
    <a onclick="showPage('logs')" class="nav-item" id="nav-logs">
      <i class="fas fa-list-alt w-5 text-center"></i> Access Logs
    </a>
    <a onclick="showPage('analytics')" class="nav-item" id="nav-analytics">
      <i class="fas fa-chart-line w-5 text-center"></i> Analytics
    </a>
    <a onclick="showPage('attendance')" class="nav-item" id="nav-attendance">
      <i class="fas fa-user-clock w-5 text-center"></i> Attendance
    </a>

    <div class="text-xs font-semibold text-gray-600 uppercase tracking-widest px-3 py-2 mt-2">System</div>
    <a onclick="showPage('cameras')" class="nav-item" id="nav-cameras">
      <i class="fas fa-camera w-5 text-center"></i> Cameras
    </a>
    <a onclick="showPage('settings')" class="nav-item" id="nav-settings">
      <i class="fas fa-cog w-5 text-center"></i> Settings
    </a>

    <div class="mt-4">
      <a href="/mobile" target="_blank" class="nav-item text-purple-400">
        <i class="fas fa-mobile-alt w-5 text-center"></i> Mobile App
        <i class="fas fa-external-link-alt ml-auto text-xs"></i>
      </a>
    </div>
  </nav>

  <div class="p-4 border-t border-gray-800">
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <i class="fas fa-user text-white text-xs"></i>
      </div>
      <div class="text-sm">
        <div class="font-medium text-white">Admin</div>
        <div class="text-xs text-gray-500">sarah.chen@acme.com</div>
      </div>
      <div class="ml-auto w-2 h-2 rounded-full bg-green-500"></div>
    </div>
  </div>
</aside>

<!-- Main Content -->
<main class="flex-1 overflow-auto">

  <!-- Top bar -->
  <header class="sticky top-0 z-10 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-6 py-3 flex items-center gap-4">
    <div class="flex-1">
      <div id="page-title" class="font-semibold text-white text-lg">Dashboard</div>
    </div>
    <div class="flex items-center gap-3">
      <div id="alert-badge" class="hidden items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-1.5 rounded-full cursor-pointer" onclick="showPage('logs')">
        <i class="fas fa-exclamation-triangle"></i>
        <span id="alert-count">0</span> alerts
      </div>
      <div class="text-xs text-gray-500" id="live-clock"></div>
      <div class="flex items-center gap-1.5 text-xs text-green-400">
        <div class="w-1.5 h-1.5 rounded-full bg-green-400 pulse"></div> System Online
      </div>
    </div>
  </header>

  <!-- Pages -->
  <div id="page-dashboard" class="page p-6">
    <!-- Dashboard content injected by JS -->
  </div>

  <div id="page-live" class="page p-6 hidden">
  </div>

  <div id="page-recognize" class="page p-6 hidden">
  </div>

  <div id="page-users" class="page p-6 hidden">
  </div>

  <div id="page-doors" class="page p-6 hidden">
  </div>

  <div id="page-permissions" class="page p-6 hidden">
  </div>

  <div id="page-logs" class="page p-6 hidden">
  </div>

  <div id="page-analytics" class="page p-6 hidden">
  </div>

  <div id="page-attendance" class="page p-6 hidden">
  </div>

  <div id="page-cameras" class="page p-6 hidden">
  </div>

  <div id="page-settings" class="page p-6 hidden">
  </div>
</main>

<!-- Notification toast -->
<div id="toast" class="fixed bottom-6 right-6 z-50 hidden">
  <div class="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 shadow-2xl">
    <div id="toast-icon" class="text-green-400"><i class="fas fa-check-circle text-lg"></i></div>
    <div id="toast-msg" class="text-sm font-medium"></div>
  </div>
</div>

<!-- Modal container -->
<div id="modal-overlay" class="modal-overlay hidden" onclick="closeModal(event)">
  <div id="modal-content" class="modal" onclick="event.stopPropagation()">
  </div>
</div>

<script src="/static/app.js"></script>
</body>
</html>`
}

// ─────────────────────────────────────────────
// Mobile App HTML
// ─────────────────────────────────────────────
function getMobileHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>FaceAccess Mobile</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { font-family: system-ui, sans-serif; background: #0a0a14; color: #e2e8f0; max-width: 430px; margin: 0 auto; min-height: 100vh; }
.mobile-card { background: #13131f; border: 1px solid #1e1e30; border-radius: 16px; }
.btn-approve { background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 16px; padding: 18px; font-size: 18px; font-weight: 700; width: 100%; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.2s; }
.btn-approve:hover { transform: scale(1.02); box-shadow: 0 8px 30px rgba(16,185,129,0.3); }
.btn-deny { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; border-radius: 16px; padding: 18px; font-size: 18px; font-weight: 700; width: 100%; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.2s; }
.btn-deny:hover { transform: scale(1.02); box-shadow: 0 8px 30px rgba(239,68,68,0.3); }
.proximity-ring { width: 120px; height: 120px; border-radius: 50%; border: 3px solid #6366f1; display: flex; align-items: center; justify-content: center; position: relative; margin: 0 auto; }
.proximity-ring::before { content: ''; position: absolute; inset: -12px; border: 2px solid rgba(99,102,241,0.3); border-radius: 50%; animation: pulse 2s infinite; }
.proximity-ring::after { content: ''; position: absolute; inset: -24px; border: 2px solid rgba(99,102,241,0.15); border-radius: 50%; animation: pulse 2s 0.5s infinite; }
@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.5; } }
.tab-btn { flex: 1; padding: 10px; border: none; background: transparent; color: #64748b; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
.tab-btn.active { color: #818cf8; border-bottom-color: #6366f1; }
.notification-item { animation: slideIn 0.3s ease; }
@keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>

<div class="min-h-screen flex flex-col">
  <!-- Header -->
  <header class="bg-gray-900/90 backdrop-blur sticky top-0 z-10 px-5 py-4 border-b border-gray-800">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <i class="fas fa-eye text-white"></i>
      </div>
      <div>
        <h1 class="font-bold text-white">FaceAccess</h1>
        <p class="text-xs text-gray-500">Mobile Companion</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-green-400 pulse"></div>
        <span class="text-xs text-green-400">Connected</span>
      </div>
    </div>
  </header>

  <!-- Tabs -->
  <div class="flex border-b border-gray-800 bg-gray-900/50">
    <button class="tab-btn active" onclick="mobileTab('access')" id="tab-access"><i class="fas fa-bell mr-1"></i> Access</button>
    <button class="tab-btn" onclick="mobileTab('profile')" id="tab-profile"><i class="fas fa-user mr-1"></i> Profile</button>
    <button class="tab-btn" onclick="mobileTab('history')" id="tab-history"><i class="fas fa-history mr-1"></i> History</button>
  </div>

  <!-- Content -->
  <div class="flex-1 p-4 space-y-4" id="mobile-content">
  </div>
</div>

<script src="/static/mobile.js"></script>
</body>
</html>`
}

export default app
