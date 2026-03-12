import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// ── Security middleware ──────────────────────────────
// CORS: locked to known origins; wildcard acceptable for demo
app.use('/api/*', cors({
  origin: ['https://faceaccess.pages.dev', 'http://localhost:3000'],
  allowMethods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowHeaders: ['Content-Type','Authorization'],
  exposeHeaders: ['X-Request-Id'],
}))

// Security headers on every response
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-XSS-Protection', '1; mode=block')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(self), microphone=()')
})

app.use('/static/*', serveStatic({ root: './public' }))

// ─────────────────────────────────────────────
// Input validation helpers
// ─────────────────────────────────────────────

/** Validate an ID param is safe (alphanumeric, dash, underscore only) */
function isValidId(id: string | undefined | null): boolean {
  if (!id) return false
  return /^[a-zA-Z0-9_\-]{1,64}$/.test(id)
}

/** Parse integer query param with default and max */
function parseIntParam(v: string | undefined, def: number, max: number): number {
  const n = parseInt(v || String(def))
  if (isNaN(n) || n < 0) return def
  return Math.min(n, max)
}

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

/** Cryptographically secure random ID using Web Crypto API (available in CF Workers). */
function nanoid(len = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < len; i++) result += chars[bytes[i] % chars.length]
  return result
}

/** Sanitize a string — strip dangerous characters, trim, cap length. */
function sanitize(val: unknown, maxLen = 512): string {
  if (val == null) return ''
  return String(val).replace(/[<>"'`;]/g, '').slice(0, maxLen).trim()
}

/** Validate that a string looks like a valid email address. */
function isEmail(e: unknown): boolean {
  return typeof e === 'string' && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,64}$/.test(e)
}

/** Return 400 with error message. */
function bad(c: any, msg: string) {
  return c.json({ error: msg }, 400)
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
// AI TRUST ENGINE (v3.0)
// ─────────────────────────────────────────────

/**
 * Compute composite trust score from component scores.
 * Weights: face 35%, behavioral 35%, predictive 20%, anomaly penalty 10%
 */
function computeTrustScore(
  faceAvg: number,
  behavioralScore: number,
  predictiveScore: number,
  anomalyPenalty: number
): number {
  const raw = faceAvg * 0.35 + behavioralScore * 0.35 + predictiveScore * 0.20 - anomalyPenalty * 0.10
  return Math.min(1, Math.max(0, raw))
}

/** Map trust score (0-1) to tier label */
function trustTier(score: number): string {
  if (score >= 0.85) return 'trusted'
  if (score >= 0.60) return 'standard'
  if (score >= 0.40) return 'watchlist'
  return 'blocked'
}

/**
 * Analyze access patterns for a user: return behavioral score
 * and whether current access is "typical" (within normal window).
 */
function analyzePatterns(patterns: any[], currentHour: number, currentDow: number): {
  behavioralScore: number
  isTypical: boolean
  anomalyScore: number
  typicalHours: number[]
  typicalDows: number[]
} {
  if (!patterns || patterns.length < 3) {
    return { behavioralScore: 0.70, isTypical: true, anomalyScore: 0.0, typicalHours: [], typicalDows: [] }
  }

  // Build frequency maps
  const hourFreq: Record<number, number> = {}
  const dowFreq: Record<number, number>  = {}
  let successCount = 0

  for (const p of patterns) {
    hourFreq[p.access_hour] = (hourFreq[p.access_hour] || 0) + 1
    dowFreq[p.access_dow]   = (dowFreq[p.access_dow]   || 0) + 1
    if (p.result === 'granted') successCount++
  }

  const total = patterns.length
  const successRate = successCount / total

  // Typical hours = top 70% of access hours
  const sortedHours = Object.entries(hourFreq).sort((a, b) => Number(b[1]) - Number(a[1]))
  const hourThreshold = total * 0.10  // hours with at least 10% share
  const typicalHours = sortedHours.filter(([, cnt]) => Number(cnt) >= hourThreshold).map(([h]) => Number(h))

  const sortedDows = Object.entries(dowFreq).sort((a, b) => Number(b[1]) - Number(a[1]))
  const dowThreshold = total * 0.08
  const typicalDows = sortedDows.filter(([, cnt]) => Number(cnt) >= dowThreshold).map(([d]) => Number(d))

  // Check if current access is within typical window
  const hourOk = typicalHours.length === 0 || typicalHours.includes(currentHour) ||
    typicalHours.some(h => Math.abs(h - currentHour) <= 2)
  const dowOk  = typicalDows.length  === 0 || typicalDows.includes(currentDow)
  const isTypical = hourOk && dowOk

  // Behavioral score: success rate * consistency bonus
  const consistencyBonus = isTypical ? 0.10 : -0.15
  const behavioralScore = Math.min(1, Math.max(0, successRate * 0.80 + 0.20 + consistencyBonus))

  // Anomaly score for this specific access
  const hourDeviation = typicalHours.length > 0
    ? Math.min(...typicalHours.map(h => Math.abs(h - currentHour))) / 12
    : 0
  const anomalyScore = isTypical ? hourDeviation * 0.3 : 0.45 + hourDeviation * 0.3

  return { behavioralScore, isTypical, anomalyScore: Math.min(1, anomalyScore), typicalHours, typicalDows }
}

/**
 * Detect anomaly type and severity from an access event.
 */
function detectAnomalyType(
  isTypical: boolean,
  anomalyScore: number,
  failedRecentCount: number,
  antiSpoof: number | null,
  currentHour: number
): { type: string; severity: string; trustDelta: number } | null {
  if (antiSpoof !== null && antiSpoof < 0.35) {
    return { type: 'spoof_attempt', severity: 'critical', trustDelta: -0.25 }
  }
  if (failedRecentCount >= 3) {
    return { type: 'repeated_failures', severity: 'high', trustDelta: -0.15 }
  }
  if (!isTypical && anomalyScore > 0.7) {
    const isNight = currentHour < 5 || currentHour >= 23
    return {
      type: isNight ? 'unusual_time' : 'off_schedule',
      severity: isNight ? 'high' : 'medium',
      trustDelta: isNight ? -0.12 : -0.05
    }
  }
  if (!isTypical && anomalyScore > 0.45) {
    return { type: 'behavioral_drift', severity: 'low', trustDelta: -0.03 }
  }
  return null
}

/**
 * Predict arrival window based on historical patterns.
 * Returns predicted next arrival datetime (ISO string) and confidence.
 */
function predictNextArrival(patterns: any[]): {
  predictedAt: string
  confidence: number
  basisHour: number
} | null {
  if (!patterns || patterns.length < 5) return null

  const now = new Date()
  const currentDow = now.getDay()

  // Group by day-of-week, find average arrival hour for that day
  const dowHours: Record<number, number[]> = {}
  for (const p of patterns) {
    if (p.result === 'granted') {
      if (!dowHours[p.access_dow]) dowHours[p.access_dow] = []
      dowHours[p.access_dow].push(p.access_hour + p.access_minute / 60)
    }
  }

  // Try today first, then tomorrow
  for (let offset = 0; offset <= 1; offset++) {
    const targetDow = (currentDow + offset) % 7
    const hours = dowHours[targetDow]
    if (!hours || hours.length === 0) continue

    const avgHour = hours.reduce((s, h) => s + h, 0) / hours.length
    const stdDev  = Math.sqrt(hours.reduce((s, h) => s + Math.pow(h - avgHour, 2), 0) / hours.length)

    // Only predict if std deviation is low enough (< 2 hours = consistent)
    if (stdDev > 2.5) continue

    const predDate = new Date(now)
    predDate.setDate(predDate.getDate() + offset)
    predDate.setHours(Math.floor(avgHour), Math.round((avgHour % 1) * 60), 0, 0)

    // Skip if predicted time already passed
    if (predDate <= now) continue

    const confidence = Math.min(0.95, 0.50 + hours.length * 0.05 - stdDev * 0.10)
    return {
      predictedAt: predDate.toISOString().replace('T', ' ').split('.')[0],
      confidence,
      basisHour: Math.floor(avgHour)
    }
  }
  return null
}

/**
 * Generate AI recommendations for a home based on anomalies and trust profiles.
 */
function generateRecommendations(
  anomalies: any[],
  trustProfiles: any[],
  guestPasses: any[]
): Array<{ type: string; priority: string; title: string; message: string; actionData: any }> {
  const recs: Array<{ type: string; priority: string; title: string; message: string; actionData: any }> = []

  // Watchlist/blocked users
  for (const tp of trustProfiles) {
    if (tp.trust_tier === 'blocked') {
      recs.push({
        type: 'revoke_access',
        priority: 'urgent',
        title: `Review blocked user: ${tp.user_name || tp.user_id}`,
        message: `Trust score dropped to ${Math.round(tp.trust_score * 100)}%. Multiple anomalies detected. Consider revoking access.`,
        actionData: { user_id: tp.user_id }
      })
    } else if (tp.trust_tier === 'watchlist') {
      recs.push({
        type: 'upgrade_verification',
        priority: 'high',
        title: `Increase verification for ${tp.user_name || tp.user_id}`,
        message: `Trust score at ${Math.round(tp.trust_score * 100)}%. Recommend requiring device proximity for all unlocks.`,
        actionData: { user_id: tp.user_id }
      })
    }
  }

  // Guest passes expiring within 7 days
  for (const gp of guestPasses) {
    const daysLeft = Math.ceil((new Date(gp.valid_until).getTime() - Date.now()) / 86400000)
    if (daysLeft >= 0 && daysLeft <= 7) {
      recs.push({
        type: 'pre_approve_guest',
        priority: 'medium',
        title: `Guest pass expiring: ${gp.name}`,
        message: `"${gp.name}" guest pass expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew or revoke.`,
        actionData: { guest_id: gp.id }
      })
    }
  }

  // Critical anomalies in last 24h
  const criticalCount = anomalies.filter(a => a.severity === 'critical' && !a.resolved).length
  if (criticalCount > 0) {
    recs.push({
      type: 'review_anomalies',
      priority: 'urgent',
      title: `${criticalCount} critical security alert${criticalCount > 1 ? 's' : ''}`,
      message: `Potential spoof attempts or critical anomalies detected in the last 24 hours. Review immediately.`,
      actionData: { filter: 'critical' }
    })
  }

  return recs.slice(0, 10)  // max 10 recommendations
}

/**
 * Upsert a user trust profile after an access event.
 * Calculates new composite score and persists it.
 */
async function updateTrustProfile(
  DB: D1Database,
  userId: string,
  homeId: string,
  eventResult: 'granted' | 'denied' | 'pending',
  faceConfidence: number,
  behavioralScore: number,
  anomalyScore: number,
  isTypical: boolean
): Promise<{ trust_score: number; trust_tier: string }> {
  // Load existing profile
  const existing: any = await DB.prepare(
    'SELECT * FROM user_trust_profiles WHERE user_id=?'
  ).bind(userId).first()

  const prev = existing || {
    trust_score: 0.70,
    face_confidence_avg: 0.70,
    behavioral_score: 0.70,
    predictive_score: 0.70,
    anomaly_penalty: 0.00,
    total_attempts: 0,
    successful_unlocks: 0,
    denied_count: 0,
    anomaly_count: 0
  }

  // Exponential moving average (alpha=0.15 – slow adaptation for stability)
  const alpha = 0.15
  const newFaceAvg  = prev.face_confidence_avg  * (1 - alpha) + faceConfidence * alpha
  const newBehav    = prev.behavioral_score     * (1 - alpha) + behavioralScore * alpha
  const newPredictive = prev.predictive_score   // updated separately by prediction engine
  const anomalyDelta  = anomalyScore > 0.5 ? anomalyScore * 0.1 : -0.01  // heal slowly
  const newPenalty  = Math.min(0.5, Math.max(0, prev.anomaly_penalty + anomalyDelta))

  const newScore = computeTrustScore(newFaceAvg, newBehav, newPredictive, newPenalty)
  const tier     = trustTier(newScore)

  const newTotal    = prev.total_attempts + 1
  const newSuccess  = prev.successful_unlocks + (eventResult === 'granted' ? 1 : 0)
  const newDenied   = prev.denied_count       + (eventResult === 'denied'  ? 1 : 0)
  const newAnomalies= prev.anomaly_count      + (anomalyScore > 0.5 ? 1 : 0)

  if (existing) {
    await DB.prepare(`
      UPDATE user_trust_profiles
      SET trust_score=?, trust_tier=?, face_confidence_avg=?, behavioral_score=?,
          anomaly_penalty=?, total_attempts=?, successful_unlocks=?, denied_count=?,
          anomaly_count=?, last_updated=?, last_access=?
      WHERE user_id=?
    `).bind(
      newScore, tier, newFaceAvg, newBehav,
      newPenalty, newTotal, newSuccess, newDenied,
      newAnomalies, now(), now(), userId
    ).run()
  } else {
    const profileId = 'tp-' + nanoid(10)
    await DB.prepare(`
      INSERT INTO user_trust_profiles
        (id, user_id, home_id, trust_score, trust_tier, face_confidence_avg,
         behavioral_score, predictive_score, anomaly_penalty,
         total_attempts, successful_unlocks, denied_count, anomaly_count,
         last_updated, last_access, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      profileId, userId, homeId, newScore, tier, newFaceAvg,
      newBehav, newPredictive, newPenalty,
      newTotal, newSuccess, newDenied, newAnomalies,
      now(), now(), now()
    ).run()
  }

  return { trust_score: newScore, trust_tier: tier }
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
  const body = await c.req.json().catch(() => ({}))
  const name  = sanitize(body.name, 120)
  const email = sanitize(body.email, 254).toLowerCase()
  const role  = sanitize(body.role, 30)
  const department = sanitize(body.department, 120)
  const phone = sanitize(body.phone, 30)
  if (!name || !email || !role) return bad(c, 'name, email, role required')
  if (!isEmail(email)) return bad(c, 'Invalid email address')
  const validRoles = ['employee','manager','admin','visitor']
  if (!validRoles.includes(role)) return bad(c, `role must be one of: ${validRoles.join(', ')}`)
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
  const body = await c.req.json().catch(() => ({}))
  const name   = sanitize(body.name, 120) || null
  const email  = body.email ? sanitize(body.email, 254).toLowerCase() : null
  const role   = sanitize(body.role, 30) || null
  const department = sanitize(body.department, 120) || null
  const phone  = sanitize(body.phone, 30) || null
  const status = sanitize(body.status, 20) || null
  if (email && !isEmail(email)) return bad(c, 'Invalid email address')
  const validRoles = ['employee','manager','admin','visitor']
  if (role && !validRoles.includes(role)) return bad(c, `role must be one of: ${validRoles.join(', ')}`)
  const validStatuses = ['active','inactive','deleted']
  if (status && !validStatuses.includes(status)) return bad(c, 'Invalid status')
  await DB.prepare(`UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email),
    role=COALESCE(?,role), department=COALESCE(?,department), phone=COALESCE(?,phone),
    status=COALESCE(?,status), updated_at=? WHERE id=?`)
    .bind(name, email, role, department, phone, status, now(), c.req.param('id')).run()
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

// ═══════════════════════════════════════════════════════
// ██  FACEACCESS HOME — Consumer Product API           ██
// ═══════════════════════════════════════════════════════

// ── Home management ───────────────────────────────────
app.get('/api/home/homes', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT h.*, hu.name as owner_name, hu.email as owner_email,
      (SELECT COUNT(*) FROM home_users WHERE home_id=h.id AND status='active') as member_count,
      (SELECT COUNT(*) FROM smart_locks WHERE home_id=h.id AND status='active') as lock_count,
      (SELECT COUNT(*) FROM home_cameras WHERE home_id=h.id AND status='active') as camera_count
    FROM homes h JOIN home_users hu ON h.owner_id=hu.id ORDER BY h.created_at DESC`).all()
  return c.json({ homes: results })
})

app.get('/api/home/homes/:id', async (c) => {
  const { DB } = c.env
  const home = await DB.prepare(`SELECT h.*, hu.name as owner_name FROM homes h JOIN home_users hu ON h.owner_id=hu.id WHERE h.id=?`).bind(c.req.param('id')).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)
  return c.json({ home })
})

app.post('/api/home/homes', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const owner_id = sanitize(body.owner_id, 30)
  const name     = sanitize(body.name, 120)
  const address  = sanitize(body.address, 300) || null
  const timezone = sanitize(body.timezone, 60) || 'UTC'
  if (!owner_id || !name) return bad(c, 'owner_id and name required')
  // Verify owner exists
  const ownerCheck = await DB.prepare("SELECT id FROM home_users WHERE id=?").bind(owner_id).first()
  if (!ownerCheck) return c.json({ error: 'Owner user not found' }, 404)
  const id = 'home-' + nanoid(8)
  const invite_code = nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0,8)
  await DB.prepare(`INSERT INTO homes (id,owner_id,name,address,timezone,invite_code,setup_step,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`)
    .bind(id, owner_id, name, address, timezone, invite_code, now(), now()).run()
  await DB.prepare('UPDATE home_users SET home_id=? WHERE id=?').bind(id, owner_id).run()
  const home = await DB.prepare('SELECT * FROM homes WHERE id=?').bind(id).first()
  return c.json({ home, message: 'Home created' }, 201)
})

app.put('/api/home/homes/:id/setup', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { step } = body
  const complete = step >= 4 ? 1 : 0
  await DB.prepare('UPDATE homes SET setup_step=?,setup_complete=?,updated_at=? WHERE id=?')
    .bind(step, complete, now(), c.req.param('id')).run()
  return c.json({ message: 'Setup progress saved', step, complete })
})

// ── Home Users ────────────────────────────────────────
app.get('/api/home/users', async (c) => {
  const { DB } = c.env
  const home_id = c.req.query('home_id')
  let q = `SELECT hu.*, (SELECT COUNT(*) FROM home_devices WHERE user_id=hu.id AND status='active') as device_count FROM home_users hu WHERE hu.status != 'deleted'`
  const args: string[] = []
  if (home_id) { q += ' AND hu.home_id=?'; args.push(home_id) }
  q += ' ORDER BY hu.role, hu.name'
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ users: results })
})

app.post('/api/home/users', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const home_id = sanitize(body.home_id, 30) || null
  const name    = sanitize(body.name, 120)
  const email   = sanitize(body.email, 254).toLowerCase()
  const phone   = sanitize(body.phone, 30) || null
  const role    = sanitize(body.role, 20) || 'member'
  if (!name || !email) return bad(c, 'name and email required')
  if (!isEmail(email)) return bad(c, 'Invalid email address')
  const validRoles = ['owner','member','guest','admin']
  if (!validRoles.includes(role)) return bad(c, `role must be one of: ${validRoles.join(', ')}`)
  const existing = await DB.prepare('SELECT id FROM home_users WHERE email=?').bind(email).first()
  if (existing) return c.json({ error: 'Email already registered' }, 409)
  const id = 'hu-' + nanoid(8)
  const colors = ['#6366f1','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899']
  const color = colors[Math.floor(Math.random() * colors.length)]
  await DB.prepare(`INSERT INTO home_users (id,home_id,name,email,phone,role,avatar_color,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?)`)
    .bind(id, home_id, name, email, phone, role, color, now()).run()
  const user = await DB.prepare('SELECT * FROM home_users WHERE id=?').bind(id).first()
  return c.json({ user, message: 'User created' }, 201)
})

app.put('/api/home/users/:id', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const { name, phone, role, status } = body
  await DB.prepare(`UPDATE home_users SET name=COALESCE(?,name),phone=COALESCE(?,phone),role=COALESCE(?,role),status=COALESCE(?,status),updated_at=? WHERE id=?`)
    .bind(name||null, phone||null, role||null, status||null, now(), c.req.param('id')).run()
  return c.json({ message: 'Updated' })
})

app.delete('/api/home/users/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE home_users SET status=?,face_embedding=NULL,face_registered=0,updated_at=? WHERE id=?')
    .bind('deleted', now(), c.req.param('id')).run()
  return c.json({ message: 'Member removed and biometric data erased' })
})

app.post('/api/home/users/:id/face', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')

  // Verify user exists and is active before accepting biometric data
  const user = await DB.prepare('SELECT id,status FROM home_users WHERE id=?').bind(userId).first() as any
  if (!user) return c.json({ error: 'User not found' }, 404)
  if (user.status === 'deleted') return c.json({ error: 'Cannot enroll deleted user' }, 403)

  // Rate limit: max 5 enrollment attempts per user per hour
  const recentEnrollments = await DB.prepare(`
    SELECT COUNT(*) as cnt FROM home_events
    WHERE user_id=? AND event_type='face_enrolled' AND created_at >= datetime('now','-1 hour')
  `).bind(userId).first() as any
  if (recentEnrollments?.cnt >= 5) {
    return c.json({ error: 'Too many enrollment attempts — wait 1 hour' }, 429)
  }

  const body = await c.req.json().catch(() => ({}))
  const {
    embedding,
    image_quality,
    liveness_score,
    anti_spoof_score,
    angles_captured,
    enrollment_version,
  } = body

  // Validate numeric scores are in range [0,1]
  const quality    = Math.min(1, Math.max(0, Number(image_quality)   || 0.96))
  const liveness   = Math.min(1, Math.max(0, Number(liveness_score)  || 0.95))
  const antiSpoof  = Math.min(1, Math.max(0, Number(anti_spoof_score)|| 0.90))
  const version    = sanitize(enrollment_version, 10) || '1.0'

  // Validate angles_captured is a safe array of strings
  let anglesJson: string | null = null
  if (Array.isArray(angles_captured)) {
    const safeAngles = angles_captured
      .slice(0, 20)
      .map((a: unknown) => sanitize(a, 30))
      .filter(Boolean)
    anglesJson = JSON.stringify(safeAngles)
  }

  let embToStore: string
  if (typeof embedding === 'string' && embedding.length > 20 && embedding.length < 65536) {
    // v2: encrypted base64 embedding from FaceID engine
    embToStore = embedding
  } else if (Array.isArray(embedding) && embedding.length >= 64 && embedding.length <= 512) {
    // Legacy: plain array — validate all values are finite numbers in [-1,1]
    const valid = embedding.every((v: unknown) => typeof v === 'number' && isFinite(v))
    if (!valid) return bad(c, 'Embedding contains invalid values')
    embToStore = JSON.stringify(embedding)
  } else {
    // Fallback: deterministic seed (demo mode)
    embToStore = JSON.stringify(seedEmbedding('home-' + userId + '-' + Date.now()))
  }

  await DB.prepare(`UPDATE home_users
    SET face_embedding=?, face_registered=1, updated_at=?,
        status=CASE WHEN status='pending' THEN 'active' ELSE status END
    WHERE id=?`)
    .bind(embToStore, now(), userId).run()

  // Log the enrollment event
  const evId = 'hev-' + nanoid(10)
  await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,event_type,method,created_at)
    SELECT ?,home_id,id,name,'face_enrolled',?,? FROM home_users WHERE id=?`)
    .bind(evId, version, now(), userId).run()

  return c.json({
    message:    'Face enrolled successfully',
    quality,
    liveness,
    anti_spoof: antiSpoof,
    angles:     anglesJson ? JSON.parse(anglesJson) : null,
    version,
    enrolled_at: now(),
  })
})

app.delete('/api/home/users/:id/face', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE home_users SET face_embedding=NULL,face_registered=0,updated_at=? WHERE id=?')
    .bind(now(), c.req.param('id')).run()
  return c.json({ message: 'Biometric data erased' })
})

// ── Smart Locks ───────────────────────────────────────
app.get('/api/home/locks', async (c) => {
  const { DB } = c.env
  const home_id = c.req.query('home_id')
  let q = `SELECT sl.*, hc.name as camera_name FROM smart_locks sl LEFT JOIN home_cameras hc ON hc.lock_id=sl.id WHERE sl.status != 'deleted'`
  const args: string[] = []
  if (home_id) { q += ' AND sl.home_id=?'; args.push(home_id) }
  q += ' ORDER BY sl.name'
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ locks: results })
})

app.post('/api/home/locks', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const home_id     = sanitize(body.home_id, 30)
  const name        = sanitize(body.name, 120)
  const location    = sanitize(body.location, 200) || null
  const lock_type   = sanitize(body.lock_type, 20)
  const brand       = sanitize(body.brand, 50)
  const api_endpoint = sanitize(body.api_endpoint, 500) || null
  const api_key     = body.api_key ? sanitize(body.api_key, 500) : null
  const relay_ip    = sanitize(body.relay_ip, 45) || null
  const relay_port  = body.relay_port ? Number(body.relay_port) : null
  if (!home_id || !name) return bad(c, 'home_id and name required')
  const validTypes  = ['api','relay','ble','zigbee','manual']
  const validBrands = ['august','schlage','yale','nuki','generic','other']
  if (lock_type && !validTypes.includes(lock_type))   return bad(c, `lock_type must be one of: ${validTypes.join(', ')}`)
  if (brand && !validBrands.includes(brand)) return bad(c, `brand must be one of: ${validBrands.join(', ')}`)
  const id = 'lock-' + nanoid(8)
  await DB.prepare(`INSERT INTO smart_locks (id,home_id,name,location,lock_type,brand,api_endpoint,api_key,relay_ip,relay_port,is_locked,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,'active',?)`)
    .bind(id, home_id, name, location, lock_type||'api', brand||'generic',
      api_endpoint, api_key, relay_ip, relay_port, now()).run()
  const lock = await DB.prepare('SELECT * FROM smart_locks WHERE id=?').bind(id).first()
  return c.json({ lock, message: 'Lock added' }, 201)
})

app.put('/api/home/locks/:id', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const name        = sanitize(body.name, 120) || null
  const location    = sanitize(body.location, 200) || null
  const lock_type   = sanitize(body.lock_type, 20) || null
  const brand       = sanitize(body.brand, 50) || null
  const api_endpoint = sanitize(body.api_endpoint, 500) || null
  const api_key     = body.api_key ? sanitize(body.api_key, 500) : null
  const relay_ip    = sanitize(body.relay_ip, 45) || null
  const status      = sanitize(body.status, 20) || null
  const validTypes   = ['api','relay','ble','zigbee','manual',null]
  const validBrands  = ['august','schlage','yale','nuki','generic','other',null]
  const validStatuses = ['active','inactive','deleted',null]
  if (lock_type && !validTypes.includes(lock_type)) return bad(c, 'Invalid lock_type')
  if (brand && !validBrands.includes(brand)) return bad(c, 'Invalid brand')
  if (status && !validStatuses.includes(status)) return bad(c, 'Invalid status')
  await DB.prepare(`UPDATE smart_locks SET name=COALESCE(?,name),location=COALESCE(?,location),lock_type=COALESCE(?,lock_type),
    brand=COALESCE(?,brand),api_endpoint=COALESCE(?,api_endpoint),api_key=COALESCE(?,api_key),
    relay_ip=COALESCE(?,relay_ip),status=COALESCE(?,status) WHERE id=?`)
    .bind(name,location,lock_type,brand,api_endpoint,api_key,relay_ip,status,c.req.param('id')).run()
  return c.json({ message: 'Lock updated' })
})

// Lock / Unlock command  
app.post('/api/home/locks/:id/command', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const command = sanitize(body.command, 10)
  const user_id = sanitize(body.user_id, 30) || null
  if (!['lock','unlock'].includes(command)) return bad(c, 'command must be lock or unlock')
  const lock = await DB.prepare("SELECT * FROM smart_locks WHERE id=? AND status='active'").bind(c.req.param('id')).first() as any
  if (!lock) return c.json({ error: 'Lock not found' }, 404)
  const newState = command === 'unlock' ? 0 : 1
  await DB.prepare('UPDATE smart_locks SET is_locked=?,last_event=? WHERE id=?').bind(newState, now(), c.req.param('id')).run()
  const user = user_id ? await DB.prepare('SELECT name FROM home_users WHERE id=?').bind(user_id).first() as any : null
  const evId = 'hev-' + nanoid(10)
  await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,lock_id,lock_name,event_type,method,created_at) VALUES (?,?,?,?,?,?,'manual','manual',?)`)
    .bind(evId, lock.home_id, user_id, user?.name||'Remote', lock.id, lock.name, now()).run()
  return c.json({ success: true, state: command === 'unlock' ? 'unlocked' : 'locked', lock_id: lock.id })
})

app.delete('/api/home/locks/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare("UPDATE smart_locks SET status='deleted' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ message: 'Lock removed' })
})

// ── Home Cameras ──────────────────────────────────────
app.get('/api/home/cameras', async (c) => {
  const { DB } = c.env
  const home_id = c.req.query('home_id')
  let q = `SELECT hc.*, sl.name as lock_name FROM home_cameras hc LEFT JOIN smart_locks sl ON hc.lock_id=sl.id WHERE hc.status != 'deleted'`
  const args: string[] = []
  if (home_id) { q += ' AND hc.home_id=?'; args.push(home_id) }
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ cameras: results })
})

app.post('/api/home/cameras', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const home_id     = sanitize(body.home_id, 30)
  const lock_id     = sanitize(body.lock_id, 30) || null
  const name        = sanitize(body.name, 120)
  const stream_url  = sanitize(body.stream_url, 500) || null
  const camera_type = sanitize(body.camera_type, 20) || 'rtsp'
  const api_key     = body.api_key ? sanitize(body.api_key, 500) : null
  if (!home_id || !name) return bad(c, 'home_id and name required')
  const validTypes = ['rtsp','ring','nest','arlo','webrtc','usb','ip']
  if (!validTypes.includes(camera_type)) return bad(c, `camera_type must be one of: ${validTypes.join(', ')}`)
  const id = 'hcam-' + nanoid(8)
  await DB.prepare(`INSERT INTO home_cameras (id,home_id,lock_id,name,stream_url,camera_type,api_key,status,created_at)
    VALUES (?,?,?,?,?,?,?,'active',?)`)
    .bind(id, home_id, lock_id, name, stream_url, camera_type, api_key, now()).run()
  return c.json({ camera: await DB.prepare('SELECT * FROM home_cameras WHERE id=?').bind(id).first(), message: 'Camera added' }, 201)
})

app.delete('/api/home/cameras/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare("UPDATE home_cameras SET status='deleted' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ message: 'Camera removed' })
})

// ── Trusted Devices ───────────────────────────────────
app.get('/api/home/devices', async (c) => {
  const { DB } = c.env
  const user_id = c.req.query('user_id')
  const home_id = c.req.query('home_id')
  let q = `SELECT d.*, hu.name as user_name FROM home_devices d JOIN home_users hu ON d.user_id=hu.id WHERE d.status='active'`
  const args: string[] = []
  if (user_id) { q += ' AND d.user_id=?'; args.push(user_id) }
  if (home_id) { q += ' AND d.home_id=?'; args.push(home_id) }
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ devices: results })
})

app.post('/api/home/devices', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const user_id            = sanitize(body.user_id, 30)
  const home_id            = sanitize(body.home_id, 30)
  const name               = sanitize(body.name, 120)
  const platform           = sanitize(body.platform, 20) || 'ios'
  const device_fingerprint = sanitize(body.device_fingerprint, 200) || null
  const push_token         = body.push_token ? sanitize(body.push_token, 500) : null
  if (!user_id || !home_id || !name) return bad(c, 'user_id, home_id and name required')
  const validPlatforms = ['ios','android','web']
  if (!validPlatforms.includes(platform)) return bad(c, `platform must be one of: ${validPlatforms.join(', ')}`)
  // Verify user belongs to this home
  const userCheck = await DB.prepare("SELECT id FROM home_users WHERE id=? AND home_id=? AND status='active'")
    .bind(user_id, home_id).first()
  if (!userCheck) return c.json({ error: 'User not found in this home' }, 404)
  const id = 'dev-' + nanoid(8)
  const ble_uuid = 'FA-BLE-' + nanoid(4).toUpperCase() + '-' + nanoid(4).toUpperCase()
  await DB.prepare(`INSERT INTO home_devices (id,user_id,home_id,name,platform,device_fingerprint,ble_uuid,push_token,trusted,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,1,'active',?)`)
    .bind(id, user_id, home_id, name, platform, device_fingerprint, ble_uuid, push_token, now()).run()
  const device = await DB.prepare('SELECT * FROM home_devices WHERE id=?').bind(id).first()
  return c.json({ device, ble_uuid, message: 'Device registered and trusted' }, 201)
})

app.put('/api/home/devices/:id/trust', async (c) => {
  const { DB } = c.env
  const { trusted } = await c.req.json()
  await DB.prepare('UPDATE home_devices SET trusted=?,last_seen=? WHERE id=?').bind(trusted?1:0, now(), c.req.param('id')).run()
  return c.json({ message: trusted ? 'Device trusted' : 'Device untrusted' })
})

app.delete('/api/home/devices/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare("UPDATE home_devices SET status='removed' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ message: 'Device removed' })
})

// ── Home Face Recognition ─────────────────────────────
app.post('/api/home/recognize', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))

  // Sanitize all inputs
  const lock_id            = sanitize(body.lock_id, 30)
  const ble_detected       = body.ble_detected  === true  || body.ble_detected  === 1
  const wifi_matched       = body.wifi_matched   === true  || body.wifi_matched   === 1
  const wifi_ssid          = sanitize(body.wifi_ssid, 100) || null
  const verification_version = sanitize(body.verification_version, 10) || '1.0'

  // Clamp numeric inputs to [0,1]
  const client_confidence = (body.client_confidence != null)
    ? Math.min(1, Math.max(0, Number(body.client_confidence) || 0))
    : null
  const anti_spoof_score  = (body.anti_spoof_score != null)
    ? Math.min(1, Math.max(0, Number(body.anti_spoof_score) || 0))
    : null
  const liveness_score_raw = (body.liveness_score != null)
    ? Math.min(1, Math.max(0, Number(body.liveness_score) || 0))
    : null

  // Validate embedding if provided
  const embedding = body.embedding
  if (embedding !== undefined && embedding !== null) {
    if (!Array.isArray(embedding)) return bad(c, 'embedding must be an array')
    if (embedding.length < 64 || embedding.length > 512) return bad(c, 'embedding must have 64–512 dimensions')
    const valid = embedding.every((v: unknown) => typeof v === 'number' && isFinite(v))
    if (!valid) return bad(c, 'embedding contains invalid values')
  }

  if (!lock_id) return bad(c, 'lock_id required')

  // Rate limiting: check recent attempts from this lock (simple sliding window)
  const recentAttempts = await DB.prepare(`
    SELECT COUNT(*) as cnt FROM home_events
    WHERE lock_id=? AND created_at >= datetime('now','-1 minute')
    AND event_type IN ('denied','unlock','guest_entry')
  `).bind(lock_id).first() as any
  if (recentAttempts?.cnt > 10) {
    return c.json({ result: 'denied', reason: 'rate_limited', message: 'Too many attempts — wait 60 seconds' }, 429)
  }

  const lock = await DB.prepare('SELECT * FROM smart_locks WHERE id=? AND status=?').bind(lock_id, 'active').first() as any
  if (!lock) return c.json({ error: 'Lock not found' }, 404)

  // Liveness / anti-spoof gate
  // v2: use anti_spoof_score if present, otherwise use liveness_score
  const antiSpoof = anti_spoof_score ?? null
  const liveness  = liveness_score_raw ?? (0.88 + Math.random() * 0.12)

  // Hard reject on clear spoof
  if (antiSpoof !== null && antiSpoof < 0.35) {
    const evId = 'hev-' + nanoid(10)
    await DB.prepare(`INSERT INTO home_events (id,home_id,lock_id,lock_name,event_type,method,liveness_score,denial_reason,created_at)
      VALUES (?,?,?,?,'denied','face',?,'spoof_detected',?)`)
      .bind(evId, lock.home_id, lock_id, lock.name, antiSpoof, now()).run()
    return c.json({ result: 'denied', reason: 'spoof_detected', message: '⚠️ Anti-spoof check failed', liveness_score: antiSpoof })
  }

  if (liveness < 0.5) {
    const evId = 'hev-' + nanoid(10)
    await DB.prepare(`INSERT INTO home_events (id,home_id,lock_id,lock_name,event_type,method,liveness_score,denial_reason,created_at)
      VALUES (?,?,?,?,'denied','face',?,'liveness_failed',?)`)
      .bind(evId, lock.home_id, lock_id, lock.name, liveness, now()).run()
    return c.json({ result: 'denied', reason: 'liveness_failed', liveness_score: liveness })
  }

  // Match against home_users in this home
  const { results: homeUsers } = await DB.prepare(`
    SELECT id,name,role,face_embedding FROM home_users
    WHERE home_id=? AND face_registered=1 AND status='active'`).bind(lock.home_id).all() as any

  // Also check active guest passes for this lock
  const { results: guests } = await DB.prepare(`
    SELECT id,name,face_embedding,lock_ids,valid_from,valid_until,time_start,time_end,days_allowed
    FROM guest_passes WHERE home_id=? AND face_registered=1 AND status='active'
    AND valid_from <= datetime('now') AND valid_until >= datetime('now')`).bind(lock.home_id).all() as any

  let matchedUser: any = null
  let matchedGuest: any = null
  let confidence = 0
  let isGuest = false

  if (embedding && Array.isArray(embedding) && embedding.length >= 64) {
    for (const u of [...homeUsers, ...guests.map((g: any) => ({...g, _isGuest:true}))]) {
      if (!u.face_embedding) continue
      try {
        const score = cosineSimilarity(embedding, JSON.parse(u.face_embedding))
        if (score > confidence) { confidence = score; if (u._isGuest) { matchedGuest = u; matchedUser = null } else { matchedUser = u; matchedGuest = null } }
      } catch {}
    }
    isGuest = !!matchedGuest
  } else if (client_confidence !== null && client_confidence !== undefined) {
    // v2 engine: client sent real-time confidence from camera analysis
    // Use it combined with a randomized server-side validation factor
    const serverValidation = 0.90 + Math.random() * 0.08 // server trust factor
    confidence = client_confidence * serverValidation
    if (confidence >= 0.65 && homeUsers.length > 0) {
      // Pick best matching enrolled user (in production: match against stored embeddings)
      matchedUser = homeUsers[Math.floor(Math.random() * homeUsers.length)]
    }
    isGuest = false
  } else {
    // Demo mode simulation (no embedding, no client_confidence)
    const roll = Math.random()
    if (roll < 0.60 && homeUsers.length > 0) {
      matchedUser = homeUsers[Math.floor(Math.random() * homeUsers.length)]
      confidence = 0.88 + Math.random() * 0.10
    } else if (roll < 0.72 && homeUsers.length > 0) {
      matchedUser = homeUsers[0]; confidence = 0.70 + Math.random() * 0.12
    } else {
      confidence = 0.15 + Math.random() * 0.30
    }
  }

  const matched = matchedUser || matchedGuest
  // Use v2 thresholds: High ≥85%, Medium 65-84%, Low <65%
  const HIGH = 0.85, MED = 0.65

  if (confidence < MED || !matched) {
    const evId = 'hev-' + nanoid(10)
    await DB.prepare(`INSERT INTO home_events (id,home_id,lock_id,lock_name,event_type,method,face_confidence,liveness_score,ble_detected,wifi_matched,denial_reason,created_at)
      VALUES (?,?,?,?,'denied','face',?,?,?,?,'no_match',?)`)
      .bind(evId, lock.home_id, lock_id, lock.name, confidence, liveness, ble_detected?1:0, wifi_matched?1:0, now()).run()
    return c.json({ result: 'denied', reason: 'no_match', confidence })
  }

  // Guest checks
  if (isGuest && matchedGuest) {
    const lockIds = JSON.parse(matchedGuest.lock_ids || '[]')
    if (!lockIds.includes(lock_id)) {
      const evId = 'hev-' + nanoid(10)
      await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,lock_id,lock_name,event_type,method,face_confidence,liveness_score,denial_reason,created_at)
        VALUES (?,?,?,?,?,?,'denied','face',?,?,?,?)`)
        .bind(evId, lock.home_id, matchedGuest.id, matchedGuest.name, lock_id, lock.name, confidence, liveness, 'no_permission', now()).run()
      return c.json({ result: 'denied', reason: 'no_permission', confidence })
    }
    if (!checkTimeAllowed(matchedGuest.time_start, matchedGuest.time_end) || !checkDayAllowed(matchedGuest.days_allowed)) {
      const evId = 'hev-' + nanoid(10)
      await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,lock_id,lock_name,event_type,method,face_confidence,liveness_score,denial_reason,created_at)
        VALUES (?,?,?,?,?,?,'denied','face',?,?,?,?)`)
        .bind(evId, lock.home_id, matchedGuest.id, matchedGuest.name, lock_id, lock.name, confidence, liveness, 'outside_hours', now()).run()
      return c.json({ result: 'denied', reason: 'outside_hours', confidence })
    }
  }

  // === TWO-FACTOR: phone proximity ===
  const bleOk = ble_detected === true || ble_detected === 1
  const wifiOk = wifi_matched === true || wifi_matched === 1

  // Check if user has a trusted device registered
  const trustedDevice = matched && !isGuest
    ? await DB.prepare('SELECT * FROM home_devices WHERE user_id=? AND trusted=1 AND status=? LIMIT 1').bind(matched.id, 'active').first() as any
    : null

  const proximityScore = bleOk ? 0.95 : wifiOk ? 0.78 : 0.0
  const proximityVerified = bleOk || wifiOk

  // ── AI: Load behavioral patterns for matched user ──────
  const currentHour = new Date().getHours()
  const currentDow  = new Date().getDay()
  let behavioralScore = 0.70
  let isTypical       = true
  let anomalyScore    = 0.0
  let typicalHours:   number[] = []
  let typicalDows:    number[] = []
  let trustInfo: { trust_score: number; trust_tier: string } | null = null

  if (matched && !isGuest) {
    const { results: patterns } = await DB.prepare(`
      SELECT access_hour, access_minute, access_dow, result
      FROM behavioral_patterns
      WHERE user_id=? AND home_id=?
      ORDER BY created_at DESC LIMIT 90
    `).bind(matched.id, lock.home_id).all() as any

    const analysis = analyzePatterns(patterns as any[], currentHour, currentDow)
    behavioralScore = analysis.behavioralScore
    isTypical       = analysis.isTypical
    anomalyScore    = analysis.anomalyScore
    typicalHours    = analysis.typicalHours
    typicalDows     = analysis.typicalDows

    // Recent failure count for anomaly detection
    const failRow: any = await DB.prepare(`
      SELECT COUNT(*) as cnt FROM behavioral_patterns
      WHERE user_id=? AND result='denied'
      AND created_at >= datetime('now','-30 minutes')
    `).bind(matched.id).first()
    const failedRecentCount = failRow?.cnt || 0

    // Detect anomalies
    const anomaly = detectAnomalyType(isTypical, anomalyScore, failedRecentCount, antiSpoof, currentHour)
    if (anomaly) {
      const aId = 'ae-' + nanoid(10)
      await DB.prepare(`
        INSERT INTO anomaly_events (id,user_id,home_id,lock_id,anomaly_type,severity,confidence,details,trust_delta,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(
        aId, matched.id, lock.home_id, lock_id,
        anomaly.type, anomaly.severity, anomalyScore,
        JSON.stringify({ hour: currentHour, dow: currentDow, isTypical, anomalyScore, typicalHours }),
        anomaly.trustDelta, now()
      ).run()
    }
  }

  // High confidence + proximity → grant immediately
  if (confidence >= HIGH && (proximityVerified || !trustedDevice)) {
    const method = bleOk ? 'face+ble' : wifiOk ? 'face+wifi' : 'face'
    await DB.prepare('UPDATE smart_locks SET is_locked=0,last_event=? WHERE id=?').bind(now(), lock_id).run()
    const evId = 'hev-' + nanoid(10)
    const et = isGuest ? 'guest_entry' : 'unlock'
    await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,lock_id,lock_name,event_type,method,face_confidence,liveness_score,ble_detected,wifi_matched,proximity_score,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(evId, lock.home_id, matched.id, matched.name, lock_id, lock.name, et, method, confidence, liveness, bleOk?1:0, wifiOk?1:0, proximityScore, now()).run()

    // Log behavioral pattern
    if (!isGuest) {
      const bpId = 'bp-' + nanoid(10)
      await DB.prepare(`
        INSERT INTO behavioral_patterns (id,user_id,home_id,lock_id,access_hour,access_minute,access_dow,access_date,ble_detected,wifi_matched,face_confidence,liveness_score,result,is_typical,anomaly_score,created_at)
        VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,'granted',?,?,?)
      `).bind(bpId, matched.id, lock.home_id, lock_id, currentHour, new Date().getMinutes(), currentDow, bleOk?1:0, wifiOk?1:0, confidence, liveness, isTypical?1:0, anomalyScore, now()).run()

      // Update trust profile
      trustInfo = await updateTrustProfile(DB, matched.id, lock.home_id, 'granted', confidence, behavioralScore, anomalyScore, isTypical)
    }

    return c.json({
      result: 'granted', method,
      user: { id: matched.id, name: matched.name, role: isGuest?'guest':matched.role },
      confidence, proximity_score: proximityScore, liveness_score: liveness, anti_spoof_score: antiSpoof,
      trust_score: trustInfo?.trust_score ?? null,
      trust_tier:  trustInfo?.trust_tier  ?? null,
      behavioral_typical: isTypical,
      engine_version: '3.0'
    })
  }

  // Medium confidence OR no proximity → request remote approval
  if (matched && !isGuest) {
    // Log behavioral pattern (pending)
    const bpId = 'bp-' + nanoid(10)
    await DB.prepare(`
      INSERT INTO behavioral_patterns (id,user_id,home_id,lock_id,access_hour,access_minute,access_dow,access_date,ble_detected,wifi_matched,face_confidence,liveness_score,result,is_typical,anomaly_score,created_at)
      VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,'pending',?,?,?)
    `).bind(bpId, matched.id, lock.home_id, lock_id, currentHour, new Date().getMinutes(), currentDow, bleOk?1:0, wifiOk?1:0, confidence, liveness, isTypical?1:0, anomalyScore, now()).run()

    const verId = 'hev-' + nanoid(10)
    const expiresAt = new Date(Date.now() + 120000).toISOString().replace('T',' ').split('.')[0]
    await DB.prepare(`INSERT INTO home_verifications (id,home_id,user_id,lock_id,lock_name,face_confidence,liveness_score,expires_at,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?)`)
      .bind(verId, lock.home_id, matched.id, lock_id, lock.name, confidence, liveness, expiresAt, now()).run()
    return c.json({
      result: 'pending_approval',
      verification_id: verId,
      reason: proximityVerified ? 'medium_confidence' : 'phone_not_nearby',
      user: { id: matched.id, name: matched.name },
      confidence,
      proximity_score: proximityScore,
      behavioral_typical: isTypical,
      message: 'Approval request sent to your phone'
    })
  }

  // Denied — log behavioral pattern
  if (matched && !isGuest) {
    const bpId = 'bp-' + nanoid(10)
    await DB.prepare(`
      INSERT INTO behavioral_patterns (id,user_id,home_id,lock_id,access_hour,access_minute,access_dow,access_date,ble_detected,wifi_matched,face_confidence,liveness_score,result,is_typical,anomaly_score,created_at)
      VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,'denied',?,?,?)
    `).bind(bpId, matched.id, lock.home_id, lock_id, currentHour, new Date().getMinutes(), currentDow, bleOk?1:0, wifiOk?1:0, confidence, liveness, isTypical?1:0, anomalyScore, now()).run()
    await updateTrustProfile(DB, matched.id, lock.home_id, 'denied', confidence, behavioralScore, anomalyScore, isTypical)
  }

  return c.json({ result: 'denied', reason: 'no_match', confidence })
})

// ── Home Verifications (remote approval) ──────────────
app.get('/api/home/verifications/pending/:user_id', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT hv.*, sl.name as lock_full_name, sl.location as lock_location, h.name as home_name
    FROM home_verifications hv
    JOIN smart_locks sl ON hv.lock_id=sl.id
    JOIN homes h ON hv.home_id=h.id
    WHERE hv.user_id=? AND hv.status='pending' AND hv.expires_at > datetime('now')
    ORDER BY hv.created_at DESC`).bind(c.req.param('user_id')).all()
  return c.json({ pending: results })
})

app.post('/api/home/verifications/:id/respond', async (c) => {
  const { DB } = c.env
  const { action, proximity_verified, ble_confirmed } = await c.req.json()
  if (!['approve','deny'].includes(action)) return c.json({ error: 'action must be approve or deny' }, 400)

  const ver = await DB.prepare('SELECT * FROM home_verifications WHERE id=? AND status=?').bind(c.req.param('id'), 'pending').first() as any
  if (!ver) return c.json({ error: 'Not found or already responded' }, 404)
  if (new Date(ver.expires_at) < new Date()) {
    await DB.prepare("UPDATE home_verifications SET status='expired' WHERE id=?").bind(ver.id).run()
    return c.json({ error: 'Verification expired' }, 410)
  }

  const status = action === 'approve' ? 'approved' : 'denied'
  await DB.prepare('UPDATE home_verifications SET status=?,responded_at=? WHERE id=?').bind(status, now(), ver.id).run()

  if (action === 'approve') {
    await DB.prepare('UPDATE smart_locks SET is_locked=0,last_event=? WHERE id=?').bind(now(), ver.lock_id).run()
    const user = await DB.prepare('SELECT name FROM home_users WHERE id=?').bind(ver.user_id).first() as any
    const evId = 'hev-' + nanoid(10)
    await DB.prepare(`INSERT INTO home_events (id,home_id,user_id,user_name,lock_id,lock_name,event_type,method,face_confidence,liveness_score,ble_detected,created_at)
      VALUES (?,?,?,?,?,?,'unlock','face+remote',?,?,?,?)`)
      .bind(evId, ver.home_id, ver.user_id, user?.name||'User', ver.lock_id, ver.lock_name, ver.face_confidence, ver.liveness_score, ble_confirmed?1:0, now()).run()
  }
  return c.json({ result: action === 'approve' ? 'granted' : 'denied', message: action === 'approve' ? 'Door unlocked remotely' : 'Access denied' })
})

// ── Guest Passes ──────────────────────────────────────
app.get('/api/home/guests', async (c) => {
  const { DB } = c.env
  const home_id = c.req.query('home_id')
  let q = `SELECT gp.*, hu.name as created_by_name FROM guest_passes gp JOIN home_users hu ON gp.created_by=hu.id WHERE 1=1`
  const args: string[] = []
  if (home_id) { q += ' AND gp.home_id=?'; args.push(home_id) }
  q += ' ORDER BY gp.valid_until DESC'
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ guests: results })
})

app.post('/api/home/guests', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({}))
  const home_id    = sanitize(body.home_id, 30)
  const created_by = sanitize(body.created_by, 30)
  const name       = sanitize(body.name, 120)
  const email      = body.email ? sanitize(body.email, 254).toLowerCase() : null
  const phone      = sanitize(body.phone, 30) || null
  const valid_from = sanitize(body.valid_from, 30)
  const valid_until = sanitize(body.valid_until, 30)
  const time_start = sanitize(body.time_start, 10) || '00:00'
  const time_end   = sanitize(body.time_end, 10) || '23:59'
  const days_allowed = sanitize(body.days_allowed, 50) || 'mon,tue,wed,thu,fri,sat,sun'

  if (!home_id || !created_by || !name || !valid_from || !valid_until)
    return bad(c, 'Required fields: home_id, created_by, name, valid_from, valid_until')
  if (email && !isEmail(email)) return bad(c, 'Invalid email address')

  // Validate lock_ids is a safe array of known IDs
  let lock_ids: string[] = []
  if (Array.isArray(body.lock_ids)) {
    lock_ids = body.lock_ids
      .slice(0, 20)
      .map((id: unknown) => sanitize(id, 30))
      .filter(Boolean)
  }

  // Validate date formats
  if (!/^\d{4}-\d{2}-\d{2}/.test(valid_from) || !/^\d{4}-\d{2}-\d{2}/.test(valid_until))
    return bad(c, 'Dates must be in YYYY-MM-DD format')

  // Validate time format
  if (!/^\d{2}:\d{2}$/.test(time_start) || !/^\d{2}:\d{2}$/.test(time_end))
    return bad(c, 'Times must be in HH:MM format')

  const id = 'gp-' + nanoid(8)
  const token = 'GP-' + nanoid(6).toUpperCase()
  await DB.prepare(`INSERT INTO guest_passes (id,home_id,created_by,name,email,phone,lock_ids,valid_from,valid_until,time_start,time_end,days_allowed,invite_token,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`)
    .bind(id, home_id, created_by, name, email, phone, JSON.stringify(lock_ids),
      valid_from, valid_until, time_start, time_end, days_allowed, token, now()).run()
  const pass = await DB.prepare('SELECT * FROM guest_passes WHERE id=?').bind(id).first()
  return c.json({ pass, invite_token: token, message: 'Guest pass created' }, 201)
})

app.put('/api/home/guests/:id/activate', async (c) => {
  const { DB } = c.env
  await DB.prepare("UPDATE guest_passes SET status='active' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ message: 'Guest pass activated' })
})

app.delete('/api/home/guests/:id', async (c) => {
  const { DB } = c.env
  await DB.prepare("UPDATE guest_passes SET status='revoked' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ message: 'Guest pass revoked' })
})

app.post('/api/home/guests/:id/face', async (c) => {
  const { DB } = c.env
  const { embedding } = await c.req.json()
  let emb = embedding && Array.isArray(embedding) ? embedding : seedEmbedding('guest-'+c.req.param('id')+Date.now())
  await DB.prepare('UPDATE guest_passes SET face_embedding=?,face_registered=1 WHERE id=?')
    .bind(JSON.stringify(emb), c.req.param('id')).run()
  return c.json({ message: 'Guest face registered' })
})

// ── Home Events / Activity Log ────────────────────────
app.get('/api/home/events', async (c) => {
  const { DB } = c.env
  const home_id = c.req.query('home_id')
  const limit = parseInt(c.req.query('limit') || '50')
  const event_type = c.req.query('type')
  let q = 'SELECT * FROM home_events WHERE 1=1'
  const args: (string|number)[] = []
  if (home_id) { q += ' AND home_id=?'; args.push(home_id) }
  if (event_type) { q += ' AND event_type=?'; args.push(event_type) }
  q += ' ORDER BY created_at DESC LIMIT ?'
  args.push(limit)
  const { results } = await DB.prepare(q).bind(...args).all()
  return c.json({ events: results })
})

// ── Home Analytics ────────────────────────────────────
app.get('/api/home/analytics/:home_id', async (c) => {
  const { DB } = c.env
  const hid = c.req.param('home_id')

  const [unlocks, denied, total24h, bleUsed, remoteUsed, uniqueUsers] = await Promise.all([
    DB.prepare("SELECT COUNT(*) as n FROM home_events WHERE home_id=? AND event_type='unlock' AND created_at >= date('now')").bind(hid).first() as any,
    DB.prepare("SELECT COUNT(*) as n FROM home_events WHERE home_id=? AND event_type='denied' AND created_at >= date('now')").bind(hid).first() as any,
    DB.prepare("SELECT COUNT(*) as n FROM home_events WHERE home_id=? AND created_at >= datetime('now','-24 hours')").bind(hid).first() as any,
    DB.prepare("SELECT COUNT(*) as n FROM home_events WHERE home_id=? AND method='face+ble' AND created_at >= datetime('now','-7 days')").bind(hid).first() as any,
    DB.prepare("SELECT COUNT(*) as n FROM home_events WHERE home_id=? AND method='face+remote' AND created_at >= datetime('now','-7 days')").bind(hid).first() as any,
    DB.prepare("SELECT COUNT(DISTINCT user_id) as n FROM home_events WHERE home_id=? AND created_at >= date('now')").bind(hid).first() as any,
  ])

  const { results: byLock } = await DB.prepare(`
    SELECT lock_name, COUNT(*) as total,
      SUM(CASE WHEN event_type='unlock' THEN 1 ELSE 0 END) as unlocks,
      SUM(CASE WHEN event_type='denied' THEN 1 ELSE 0 END) as denied
    FROM home_events WHERE home_id=? AND created_at >= datetime('now','-7 days')
    GROUP BY lock_id,lock_name ORDER BY total DESC`).bind(hid).all()

  const { results: hourly } = await DB.prepare(`
    SELECT strftime('%H',created_at) as hour, COUNT(*) as total
    FROM home_events WHERE home_id=? AND created_at >= datetime('now','-24 hours')
    GROUP BY hour ORDER BY hour`).bind(hid).all()

  const { results: recentAlerts } = await DB.prepare(`
    SELECT * FROM home_events WHERE home_id=? AND (event_type='denied' OR event_type='alert')
    ORDER BY created_at DESC LIMIT 5`).bind(hid).all()

  return c.json({
    summary: {
      unlocks_today: (unlocks as any)?.n || 0,
      denied_today: (denied as any)?.n || 0,
      events_24h: (total24h as any)?.n || 0,
      ble_used_7d: (bleUsed as any)?.n || 0,
      remote_used_7d: (remoteUsed as any)?.n || 0,
      unique_users_today: (uniqueUsers as any)?.n || 0,
    },
    by_lock: byLock,
    hourly,
    recent_alerts: recentAlerts
  })
})

// ── Automations ───────────────────────────────────────
app.get('/api/home/automations/:home_id', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare('SELECT * FROM home_automations WHERE home_id=?').bind(c.req.param('home_id')).all()
  return c.json({ automations: results })
})

app.put('/api/home/automations/:id/toggle', async (c) => {
  const { DB } = c.env
  const auto = await DB.prepare('SELECT enabled FROM home_automations WHERE id=?').bind(c.req.param('id')).first() as any
  if (!auto) return c.json({ error: 'Not found' }, 404)
  await DB.prepare('UPDATE home_automations SET enabled=? WHERE id=?').bind(auto.enabled ? 0 : 1, c.req.param('id')).run()
  return c.json({ enabled: !auto.enabled })
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

// FaceAccess Home routes
app.get('/home', (c) => c.html(getHomeLandingHTML()))
app.get('/home/dashboard', (c) => c.html(getHomeDashboardHTML()))
app.get('/home/dashboard/*', (c) => c.html(getHomeDashboardHTML()))
app.get('/home/mobile', (c) => c.html(getHomeMobileHTML()))
app.get('/home/mobile/*', (c) => c.html(getHomeMobileHTML()))
app.get('/home/onboard', (c) => c.html(getHomeOnboardHTML()))
app.get('/home/onboard/*', (c) => c.html(getHomeOnboardHTML()))

// ──────────────────────────────────────────────────────────
// NOTE: AI API routes are registered BEFORE the catch-all *
// See bottom of file for implementation — moved above here
// ──────────────────────────────────────────────────────────

// catch-all SPA route MOVED to bottom of file after AI routes

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

// ─────────────────────────────────────────────
// FaceAccess Home — Landing Page
// ─────────────────────────────────────────────
function getHomeLandingHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FaceAccess Home — Smart Home Security</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<style>
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #060612; color: #e2e8f0; margin: 0; overflow-x: hidden; }
.hero-glow { background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.25) 0%, transparent 70%); }
.feature-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 20px; transition: all 0.3s; }
.feature-card:hover { background: rgba(99,102,241,0.07); border-color: rgba(99,102,241,0.3); transform: translateY(-4px); }
.gradient-text { background: linear-gradient(135deg, #818cf8, #c084fc, #fb7185); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.btn-cta { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 14px; padding: 16px 36px; font-size: 18px; font-weight: 700; cursor: pointer; transition: all 0.3s; text-decoration: none; display: inline-flex; align-items: center; gap: 10px; }
.btn-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(99,102,241,0.5); }
.btn-outline { background: transparent; color: #a5b4fc; border: 2px solid rgba(99,102,241,0.4); border-radius: 14px; padding: 14px 32px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
.btn-outline:hover { border-color: #6366f1; background: rgba(99,102,241,0.1); }
.step-num { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; flex-shrink: 0; }
.phone-frame { background: #0a0a18; border: 2px solid #23233a; border-radius: 40px; padding: 8px; box-shadow: 0 40px 80px rgba(0,0,0,0.8), 0 0 60px rgba(99,102,241,0.15); }
.pulse-ring { animation: pulseRing 2.5s ease-out infinite; }
@keyframes pulseRing { 0% { transform:scale(1); opacity:0.8; } 100% { transform:scale(1.6); opacity:0; } }
.float { animation: float 4s ease-in-out infinite; }
@keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-12px); } }
.plan-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 32px; transition: all 0.3s; }
.plan-card.featured { background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)); border-color: rgba(99,102,241,0.4); }
.lock-anim { position: relative; display: inline-block; }
.lock-anim .lock-icon { font-size: 64px; transition: all 0.5s; }
.lock-anim.unlocking .lock-icon { color: #10b981; transform: scale(1.1); }
nav a { color: #94a3b8; text-decoration: none; font-weight: 500; transition: color 0.2s; }
nav a:hover { color: #e2e8f0; }
</style>
</head>
<body>

<!-- Nav -->
<nav class="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur border-b border-white/5">
  <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-2.5">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
        <i class="fas fa-house-lock text-white text-sm"></i>
      </div>
      <div>
        <span class="font-bold text-white text-base">FaceAccess</span>
        <span class="text-indigo-400 font-bold text-base"> Home</span>
      </div>
    </div>
    <div class="hidden md:flex items-center gap-8">
      <a href="#how-it-works">How it works</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="/home/dashboard" class="text-indigo-400">Dashboard →</a>
    </div>
    <div class="flex items-center gap-3">
      <a href="/home/dashboard" class="btn-outline text-sm py-2.5 px-5">Sign In</a>
      <a href="/home/onboard" class="btn-cta text-sm py-2.5 px-5"><i class="fas fa-rocket"></i> Get Started Free</a>
    </div>
  </div>
</nav>

<!-- Hero -->
<section class="hero-glow min-h-screen flex items-center pt-20">
  <div class="max-w-6xl mx-auto px-6 py-24">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      <div>
        <div class="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-2 mb-6">
          <div class="w-2 h-2 rounded-full bg-green-400 pulse-ring"></div>
          <span class="text-indigo-300 text-sm font-medium">Now available — consumer early access</span>
        </div>
        <h1 class="text-5xl lg:text-6xl font-black text-white leading-tight mb-6">
          Your face is your<br>
          <span class="gradient-text">house key.</span>
        </h1>
        <p class="text-gray-400 text-xl leading-relaxed mb-8">
          FaceAccess Home replaces keys and codes with facial recognition
          + phone proximity verification. Hands-free, keyless, effortless.
        </p>
        <div class="flex flex-wrap gap-4 mb-10">
          <a href="/home/onboard" class="btn-cta">
            <i class="fas fa-rocket"></i> Set Up in 5 Minutes
          </a>
          <a href="/home/dashboard" class="btn-outline">
            <i class="fas fa-th-large"></i> View Demo
          </a>
        </div>
        <div class="flex flex-wrap gap-6 text-sm text-gray-500">
          <span class="flex items-center gap-2"><i class="fas fa-check text-green-400"></i> No monthly subscription on free plan</span>
          <span class="flex items-center gap-2"><i class="fas fa-check text-green-400"></i> Works with existing locks</span>
          <span class="flex items-center gap-2"><i class="fas fa-check text-green-400"></i> GDPR compliant</span>
        </div>
      </div>

      <!-- Phone mockup -->
      <div class="flex justify-center float">
        <div class="phone-frame w-72">
          <div class="bg-gray-950 rounded-3xl overflow-hidden p-5 min-h-96">
            <!-- Status bar -->
            <div class="flex justify-between text-xs text-gray-600 mb-6">
              <span>9:41</span><span>●●●●○ 87%</span>
            </div>
            <!-- Face scan UI -->
            <div class="text-center mb-6">
              <div class="text-sm font-semibold text-white mb-1">Front Door</div>
              <div class="text-xs text-gray-500">142 Maple Street</div>
            </div>
            <div class="relative w-48 h-48 mx-auto mb-6">
              <div class="absolute inset-0 rounded-full border-2 border-indigo-500/30 pulse-ring"></div>
              <div class="absolute inset-2 rounded-full border-2 border-indigo-500/50"></div>
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center border-2 border-indigo-500">
                  <i class="fas fa-face-smile text-indigo-300 text-4xl"></i>
                </div>
              </div>
              <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-0.5 bg-gradient-to-r from-transparent via-indigo-500 to-transparent" style="animation:scan 2s linear infinite"></div>
            </div>
            <div class="space-y-2 mb-5">
              <div class="flex items-center justify-between bg-white/5 rounded-xl p-3">
                <div class="flex items-center gap-2 text-xs">
                  <i class="fas fa-face-grin-wide text-indigo-400"></i>
                  <span class="text-gray-300">Face match</span>
                </div>
                <span class="text-green-400 text-xs font-bold">97%</span>
              </div>
              <div class="flex items-center justify-between bg-white/5 rounded-xl p-3">
                <div class="flex items-center gap-2 text-xs">
                  <i class="fas fa-bluetooth text-blue-400"></i>
                  <span class="text-gray-300">Phone nearby</span>
                </div>
                <span class="text-green-400 text-xs font-bold">✓ BLE</span>
              </div>
            </div>
            <div class="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-4 text-center">
              <i class="fas fa-door-open text-white text-2xl mb-1"></i>
              <div class="text-white font-bold">Welcome home, Jordan!</div>
              <div class="text-green-100 text-xs mt-1">Door unlocked automatically</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- How it works -->
<section id="how-it-works" class="py-24 border-t border-white/5">
  <div class="max-w-6xl mx-auto px-6">
    <div class="text-center mb-16">
      <h2 class="text-4xl font-black text-white mb-4">Two factors. Zero effort.</h2>
      <p class="text-gray-400 text-lg max-w-2xl mx-auto">Every entry requires both your face AND your phone to be nearby. Even if someone has a photo of you, they can't get in without your device.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
      <div class="text-center">
        <div class="w-20 h-20 rounded-3xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center mx-auto mb-5">
          <i class="fas fa-camera text-indigo-400 text-3xl"></i>
        </div>
        <div class="text-4xl font-black text-white mb-1">1</div>
        <h3 class="text-xl font-bold text-white mb-2">Camera detects you</h3>
        <p class="text-gray-400 text-sm leading-relaxed">Door camera spots your face as you approach. Liveness detection confirms you're real — not a photo or screen.</p>
      </div>
      <div class="text-center">
        <div class="w-20 h-20 rounded-3xl bg-purple-500/15 border border-purple-500/20 flex items-center justify-center mx-auto mb-5">
          <i class="fas fa-bluetooth text-purple-400 text-3xl"></i>
        </div>
        <div class="text-4xl font-black text-white mb-1">2</div>
        <h3 class="text-xl font-bold text-white mb-2">Phone confirms presence</h3>
        <p class="text-gray-400 text-sm leading-relaxed">The system checks your phone is physically near the door via BLE beacon or home WiFi. No phone nearby = no entry.</p>
      </div>
      <div class="text-center">
        <div class="w-20 h-20 rounded-3xl bg-green-500/15 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
          <i class="fas fa-unlock text-green-400 text-3xl"></i>
        </div>
        <div class="text-4xl font-black text-white mb-1">3</div>
        <h3 class="text-xl font-bold text-white mb-2">Door unlocks instantly</h3>
        <p class="text-gray-400 text-sm leading-relaxed">Both factors confirmed — door unlocks in under a second. Hands full of groceries? No problem. No tap, no key, no code.</p>
      </div>
    </div>

    <!-- Setup steps -->
    <div class="bg-white/3 border border-white/7 rounded-3xl p-10">
      <h3 class="text-2xl font-bold text-white text-center mb-8">Setup in 4 steps — takes about 5 minutes</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
        ${[
          ['Install the app', 'Download FaceAccess Home and create your account', 'fa-mobile-alt'],
          ['Connect your camera', 'Add your doorbell or IP camera via RTSP or API key', 'fa-camera'],
          ['Register your face', 'Take a 10-second selfie video for face enrollment', 'fa-face-smile'],
          ['Connect your lock', 'Link August, Schlage, Yale, Nuki or a relay controller', 'fa-lock']
        ].map(([title, desc, icon], i) => `
        <div class="flex items-start gap-4 p-4 bg-white/3 rounded-2xl">
          <div class="step-num">${i+1}</div>
          <div>
            <div class="font-semibold text-white">${title}</div>
            <div class="text-sm text-gray-400 mt-0.5">${desc}</div>
          </div>
        </div>`).join('')}
      </div>
      <div class="text-center mt-8">
        <a href="/home/onboard" class="btn-cta"><i class="fas fa-play"></i> Start Setup Now</a>
      </div>
    </div>
  </div>
</section>

<!-- Features -->
<section id="features" class="py-24 border-t border-white/5">
  <div class="max-w-6xl mx-auto px-6">
    <h2 class="text-4xl font-black text-white text-center mb-16">Everything you need to protect your home</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${[
        ['fa-face-grin-wide','Facial Recognition','FaceNet-powered face matching with 128-dimensional embeddings. Works in low light and at angles.','indigo'],
        ['fa-bluetooth','BLE Proximity','Phone broadcasts a secure BLE beacon. Door hub detects it within 5 meters. No app interaction needed.','blue'],
        ['fa-shield-halved','Liveness Detection','Blink and movement detection rejects photos, videos, and 3D masks. Spoof attempts are logged.','green'],
        ['fa-ticket','Guest Passes','Create time-limited passes for cleaners, dog walkers, friends. Set days, hours, and which doors.','purple'],
        ['fa-bell','Smart Notifications','Get notified when anyone enters, when recognition fails, or when an unknown person approaches.','yellow'],
        ['fa-lock','Smart Lock Support','Native integrations with August, Schlage, Yale, and Nuki. Relay controller support for any electric lock.','rose'],
        ['fa-wifi','WiFi Backup','If BLE isn\'t available, home WiFi network matching serves as proximity confirmation.','cyan'],
        ['fa-mobile-alt','Remote Unlock','Not home? Approve entry from anywhere via the mobile app with a single tap.','orange'],
        ['fa-chart-line','Activity Feed','Every entry and attempt logged with face confidence score, method, and timestamp.','teal'],
      ].map(([icon,title,desc,color]) => `
      <div class="feature-card p-6">
        <div class="w-12 h-12 rounded-2xl bg-${color}-500/15 flex items-center justify-center mb-4">
          <i class="fas ${icon} text-${color}-400 text-xl"></i>
        </div>
        <h3 class="font-bold text-white mb-2">${title}</h3>
        <p class="text-gray-400 text-sm leading-relaxed">${desc}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- Pricing -->
<section id="pricing" class="py-24 border-t border-white/5">
  <div class="max-w-5xl mx-auto px-6">
    <div class="text-center mb-16">
      <h2 class="text-4xl font-black text-white mb-4">Simple pricing</h2>
      <p class="text-gray-400">Start free, upgrade when your family grows.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="plan-card">
        <div class="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-2">Free</div>
        <div class="text-4xl font-black text-white mb-1">$0</div>
        <div class="text-gray-500 text-sm mb-6">Forever</div>
        <ul class="space-y-3 text-sm text-gray-300 mb-8">
          ${['1 home address','2 household members','1 smart lock','7-day activity log','Mobile app'].map(f=>`<li class="flex gap-2"><i class="fas fa-check text-green-400 mt-0.5 flex-shrink-0"></i>${f}</li>`).join('')}
        </ul>
        <a href="/home/onboard" class="block text-center bg-white/5 border border-white/10 rounded-xl py-3 text-white font-semibold hover:bg-white/10 transition-colors">Get Started</a>
      </div>

      <div class="plan-card featured relative">
        <div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-bold px-4 py-1.5 rounded-full">MOST POPULAR</div>
        <div class="text-indigo-400 text-sm font-semibold uppercase tracking-wider mb-2">Pro</div>
        <div class="text-4xl font-black text-white mb-1">$9<span class="text-lg font-normal text-gray-400">/mo</span></div>
        <div class="text-gray-500 text-sm mb-6">Per home</div>
        <ul class="space-y-3 text-sm text-gray-300 mb-8">
          ${['1 home address','Up to 10 members','Unlimited locks & cameras','90-day activity log','Guest passes (unlimited)','Smart automations','Priority support'].map(f=>`<li class="flex gap-2"><i class="fas fa-check text-indigo-400 mt-0.5 flex-shrink-0"></i>${f}</li>`).join('')}
        </ul>
        <a href="/home/onboard" class="btn-cta w-full justify-center py-3 rounded-xl text-base">Get Pro</a>
      </div>

      <div class="plan-card">
        <div class="text-purple-400 text-sm font-semibold uppercase tracking-wider mb-2">Family</div>
        <div class="text-4xl font-black text-white mb-1">$19<span class="text-lg font-normal text-gray-400">/mo</span></div>
        <div class="text-gray-500 text-sm mb-6">Up to 3 homes</div>
        <ul class="space-y-3 text-sm text-gray-300 mb-8">
          ${['Up to 3 properties','Unlimited members','All Pro features','1-year activity log','Vacation mode','Dedicated support','Coming: FaceAccess Lock'].map(f=>`<li class="flex gap-2"><i class="fas fa-check text-purple-400 mt-0.5 flex-shrink-0"></i>${f}</li>`).join('')}
        </ul>
        <a href="/home/onboard" class="block text-center bg-white/5 border border-white/10 rounded-xl py-3 text-white font-semibold hover:bg-white/10 transition-colors">Get Family</a>
      </div>
    </div>
  </div>
</section>

<!-- CTA footer -->
<section class="py-24 border-t border-white/5">
  <div class="max-w-3xl mx-auto px-6 text-center">
    <div class="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-6">
      <i class="fas fa-house-lock text-white text-3xl"></i>
    </div>
    <h2 class="text-4xl font-black text-white mb-4">Your home deserves better than a key.</h2>
    <p class="text-gray-400 text-lg mb-8">Set up FaceAccess Home in under 5 minutes. No subscriptions required to start.</p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="/home/onboard" class="btn-cta text-lg px-10 py-5"><i class="fas fa-rocket"></i> Start Free Setup</a>
      <a href="/home/dashboard" class="btn-outline text-lg px-10 py-5"><i class="fas fa-eye"></i> Live Demo</a>
    </div>
    <p class="text-gray-600 text-sm mt-6">Also for businesses? <a href="/" class="text-indigo-400 hover:underline">See FaceAccess Enterprise →</a></p>
  </div>
</section>

<footer class="border-t border-white/5 py-8">
  <div class="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
    <div class="flex items-center gap-2 text-gray-500 text-sm">
      <i class="fas fa-house-lock text-indigo-400"></i>
      <span>FaceAccess Home — a product of FaceAccess Inc.</span>
    </div>
    <div class="flex gap-6 text-sm text-gray-600">
      <a href="#" class="hover:text-gray-400">Privacy</a>
      <a href="#" class="hover:text-gray-400">Security</a>
      <a href="#" class="hover:text-gray-400">Docs</a>
      <a href="/" class="hover:text-gray-400">Enterprise</a>
    </div>
  </div>
</footer>
<style>@keyframes scan{0%{top:0}100%{top:100%}} .pulse{animation:pulse2 2s infinite} @keyframes pulse2{0%,100%{opacity:1}50%{opacity:.4}}</style>
</body>
</html>`
}

// ─────────────────────────────────────────────
// FaceAccess Home — Dashboard
// ─────────────────────────────────────────────
function getHomeDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FaceAccess Home — Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#070712;color:#e2e8f0;margin:0}
.sidebar{background:#0d0d1c;border-right:1px solid #1a1a2e;width:260px;flex-shrink:0}
.card{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:16px}
.btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;padding:9px 20px;cursor:pointer;font-weight:700;transition:all .2s}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-ghost{background:transparent;color:#94a3b8;border:1px solid #1e1e35;border-radius:10px;padding:9px 18px;cursor:pointer;transition:all .2s}
.btn-ghost:hover{border-color:#6366f1;color:#a5b4fc}
.btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:10px;padding:9px 18px;cursor:pointer;font-weight:700}
.input{background:#07071a;border:1px solid #1e1e35;border-radius:10px;padding:10px 14px;color:#e2e8f0;width:100%;outline:none;transition:border .2s}
.input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:10px;cursor:pointer;color:#475569;transition:all .2s;font-weight:500;text-decoration:none}
.nav-item:hover{background:rgba(99,102,241,.08);color:#94a3b8}
.nav-item.active{background:rgba(99,102,241,.12);color:#818cf8;border-left:3px solid #6366f1}
.lock-card{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:16px;padding:20px;transition:all .2s}
.lock-card:hover{border-color:#2d2d4a;transform:translateY(-2px)}
.lock-card.unlocked{border-left:4px solid #10b981}
.lock-card.locked{border-left:4px solid #6366f1}
.member-avatar{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0}
.event-row{border-left:3px solid transparent;padding:12px;border-radius:8px;margin-bottom:4px;transition:background .15s}
.event-row:hover{background:rgba(255,255,255,.02)}
.event-unlock{border-left-color:#10b981;background:rgba(16,185,129,.03)}
.event-denied{border-left-color:#ef4444;background:rgba(239,68,68,.03)}
.event-alert{border-left-color:#f59e0b;background:rgba(245,158,11,.03)}
.badge{display:inline-flex;align-items:center;gap:3px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase}
.badge-green{background:rgba(16,185,129,.12);color:#10b981;border:1px solid rgba(16,185,129,.25)}
.badge-red{background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.25)}
.badge-indigo{background:rgba(99,102,241,.12);color:#818cf8;border:1px solid rgba(99,102,241,.25)}
.badge-yellow{background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.25)}
.badge-gray{background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid rgba(148,163,184,.2)}
.conf-bar{height:5px;border-radius:3px;background:#1a1a2e;overflow:hidden}
.conf-fill{height:100%;border-radius:3px;transition:width .6s}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);z-index:50;display:flex;align-items:center;justify-content:center}
.modal{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:20px;padding:28px;max-width:500px;width:92%;max-height:90vh;overflow-y:auto}
.face-ring{width:200px;height:200px;border-radius:50%;border:3px solid #6366f1;position:relative;margin:0 auto}
.face-ring video{width:100%;height:100%;object-fit:cover;border-radius:50%}
.scan-line{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#6366f1,transparent);animation:scanAnim 2s linear infinite}
@keyframes scanAnim{0%{top:0}100%{top:100%}}
select.input option{background:#0f0f1e}
.stat-mini{background:linear-gradient(135deg,#0f0f1e,#0c0c18);border:1px solid #1a1a2e;border-radius:14px;padding:18px}
.tab-btn{padding:8px 18px;border:none;background:transparent;color:#475569;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
.tab-btn.active{color:#818cf8;border-bottom-color:#6366f1}
</style>
</head>
<body class="flex h-screen overflow-hidden">

<!-- Sidebar -->
<aside class="sidebar flex flex-col h-screen overflow-y-auto">
  <div class="p-5 border-b border-gray-900">
    <div class="flex items-center gap-3 mb-1">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <i class="fas fa-house-lock text-white text-sm"></i>
      </div>
      <div>
        <div class="font-bold text-white text-sm leading-tight">FaceAccess <span class="text-indigo-400">Home</span></div>
        <div class="text-xs text-gray-600">Kim Residence</div>
      </div>
    </div>
  </div>

  <nav class="p-3 flex-1 space-y-1">
    <div class="text-xs font-semibold text-gray-700 uppercase tracking-widest px-3 py-2">Home</div>
    <a onclick="showTab('overview')" class="nav-item active" id="nav-overview">
      <i class="fas fa-th-large w-4 text-center"></i> Overview
    </a>
    <a onclick="showTab('live')" class="nav-item" id="nav-live">
      <i class="fas fa-video w-4 text-center"></i> Live View
      <span class="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 pulse"></span>
    </a>
    <a onclick="showTab('recognize')" class="nav-item" id="nav-recognize">
      <i class="fas fa-face-grin-wide w-4 text-center"></i> Face Test
    </a>

    <div class="text-xs font-semibold text-gray-700 uppercase tracking-widest px-3 py-2 mt-2">Security</div>
    <a onclick="showTab('locks')" class="nav-item" id="nav-locks">
      <i class="fas fa-lock w-4 text-center"></i> Smart Locks
    </a>
    <a onclick="showTab('members')" class="nav-item" id="nav-members">
      <i class="fas fa-users w-4 text-center"></i> Household
    </a>
    <a onclick="showTab('guests')" class="nav-item" id="nav-guests">
      <i class="fas fa-ticket w-4 text-center"></i> Guest Passes
    </a>
    <a onclick="showTab('devices')" class="nav-item" id="nav-devices">
      <i class="fas fa-mobile-alt w-4 text-center"></i> Trusted Devices
    </a>

    <div class="text-xs font-semibold text-gray-700 uppercase tracking-widest px-3 py-2 mt-2">Monitoring</div>
    <a onclick="showTab('activity')" class="nav-item" id="nav-activity">
      <i class="fas fa-list-timeline w-4 text-center"></i> Activity Log
    </a>
    <a onclick="showTab('cameras')" class="nav-item" id="nav-cameras">
      <i class="fas fa-camera w-4 text-center"></i> Cameras
    </a>
    <a onclick="showTab('automations')" class="nav-item" id="nav-automations">
      <i class="fas fa-bolt w-4 text-center"></i> Automations
    </a>

    <div class="text-xs font-semibold text-gray-700 uppercase tracking-widest px-3 py-2 mt-2">AI Intelligence</div>
    <a onclick="showTab('ai')" class="nav-item" id="nav-ai">
      <i class="fas fa-brain w-4 text-center"></i> AI Dashboard
      <span class="ml-auto text-xs bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full font-medium">NEW</span>
    </a>
    <a onclick="showTab('anomalies')" class="nav-item" id="nav-anomalies">
      <i class="fas fa-exclamation-triangle w-4 text-center"></i> Anomalies
    </a>

    <div class="mt-4 border-t border-gray-900 pt-3">
      <a href="/home/mobile" target="_blank" class="nav-item text-purple-400">
        <i class="fas fa-mobile-alt w-4 text-center"></i> Mobile App
        <i class="fas fa-external-link-alt ml-auto text-xs"></i>
      </a>
      <a href="/home" class="nav-item text-gray-600">
        <i class="fas fa-arrow-left w-4 text-center"></i> Back to Home
      </a>
    </div>
  </nav>

  <div class="p-4 border-t border-gray-900">
    <div class="flex items-center gap-3">
      <div class="member-avatar" style="background:#6366f120;color:#818cf8">JK</div>
      <div class="text-sm">
        <div class="font-medium text-white">Jordan Kim</div>
        <div class="text-xs text-gray-600">Owner · Pro plan</div>
      </div>
      <div class="ml-auto w-2 h-2 rounded-full bg-green-500"></div>
    </div>
  </div>
</aside>

<!-- Main -->
<main class="flex-1 overflow-y-auto">
  <header class="sticky top-0 z-10 bg-gray-950/80 backdrop-blur border-b border-gray-900 px-6 py-3 flex items-center gap-4">
    <div id="page-title" class="font-semibold text-white text-lg flex-1">Overview</div>
    <div class="flex items-center gap-3">
      <div id="alert-badge" class="hidden items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full cursor-pointer" onclick="showTab('activity')">
        <i class="fas fa-exclamation-triangle"></i> <span id="alert-count">0</span> alerts
      </div>
      <div class="text-xs text-gray-600" id="live-clock"></div>
      <div class="flex items-center gap-1.5 text-xs text-green-400"><div class="w-1.5 h-1.5 rounded-full bg-green-400 pulse"></div> All systems normal</div>
    </div>
  </header>

  <!-- Tab pages -->
  <div id="tab-overview" class="tab-page p-6"></div>
  <div id="tab-live" class="tab-page p-6 hidden"></div>
  <div id="tab-recognize" class="tab-page p-6 hidden"></div>
  <div id="tab-locks" class="tab-page p-6 hidden"></div>
  <div id="tab-members" class="tab-page p-6 hidden"></div>
  <div id="tab-guests" class="tab-page p-6 hidden"></div>
  <div id="tab-devices" class="tab-page p-6 hidden"></div>
  <div id="tab-activity" class="tab-page p-6 hidden"></div>
  <div id="tab-cameras" class="tab-page p-6 hidden"></div>
  <div id="tab-automations" class="tab-page p-6 hidden"></div>
  <div id="tab-ai" class="tab-page p-6 hidden"></div>
  <div id="tab-anomalies" class="tab-page p-6 hidden"></div>
</main>

<!-- Toast -->
<div id="toast" class="fixed bottom-6 right-6 z-50 hidden">
  <div class="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 shadow-2xl">
    <div id="toast-icon" class="text-green-400"><i class="fas fa-check-circle text-lg"></i></div>
    <div id="toast-msg" class="text-sm font-medium"></div>
  </div>
</div>

<!-- Modal -->
<div id="modal-overlay" class="modal-overlay hidden" onclick="closeModal(event)">
  <div id="modal-content" class="modal" onclick="event.stopPropagation()"></div>
</div>

<script src="/static/faceid-engine.js"></script>
<script src="/static/home-dashboard.js"></script>
</body>
</html>`
}

// ─────────────────────────────────────────────
// FaceAccess Home — Onboarding Wizard
// ─────────────────────────────────────────────
function getHomeOnboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FaceAccess Home — Setup</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#070712;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wizard{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:24px;padding:40px;max-width:560px;width:92%;min-height:540px}
.step{display:none}
.step.active{display:block}
.step-dot{width:10px;height:10px;border-radius:50%;background:#1a1a2e;transition:all .3s}
.step-dot.done{background:#6366f1}
.step-dot.current{background:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.25)}
.btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:12px;padding:14px 28px;cursor:pointer;font-weight:700;font-size:16px;transition:all .2s;width:100%}
.btn-primary:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 6px 25px rgba(99,102,241,.4)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-back{background:transparent;color:#64748b;border:1px solid #1e1e35;border-radius:12px;padding:14px 28px;cursor:pointer;font-weight:600;font-size:15px;transition:all .2s}
.btn-back:hover{border-color:#4a4a6a;color:#94a3b8}
.input{background:#07071a;border:1px solid #1e1e35;border-radius:10px;padding:12px 16px;color:#e2e8f0;width:100%;outline:none;transition:border .2s;font-size:15px}
.input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
.option-card{background:#07071a;border:2px solid #1e1e35;border-radius:16px;padding:18px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:14px}
.option-card:hover{border-color:#3d3d6a}
.option-card.selected{border-color:#6366f1;background:rgba(99,102,241,.07)}
.face-ring{width:180px;height:180px;border-radius:50%;border:3px solid #6366f1;position:relative;margin:0 auto;overflow:hidden}
.face-ring video{width:100%;height:100%;object-fit:cover}
.scan-bar{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#6366f1,transparent);animation:scan 2s linear infinite}
@keyframes scan{0%{top:0}100%{top:100%}}
.check-anim{animation:checkBounce .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes checkBounce{0%{transform:scale(0)}100%{transform:scale(1)}}
.brand-btn{background:#07071a;border:1px solid #1e1e35;border-radius:14px;padding:14px;cursor:pointer;transition:all .2s;text-align:center}
.brand-btn:hover{border-color:#6366f1;background:rgba(99,102,241,.05)}
.brand-btn.selected{border-color:#6366f1;background:rgba(99,102,241,.1)}
</style>
</head>
<body>
<div class="wizard">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <i class="fas fa-house-lock text-white text-xs"></i>
      </div>
      <span class="font-bold text-white">FaceAccess <span class="text-indigo-400">Home</span></span>
    </div>
    <div class="flex items-center gap-2" id="step-dots">
      <div class="step-dot current" id="dot-0"></div>
      <div class="w-6 h-0.5 bg-gray-800"></div>
      <div class="step-dot" id="dot-1"></div>
      <div class="w-6 h-0.5 bg-gray-800"></div>
      <div class="step-dot" id="dot-2"></div>
      <div class="w-6 h-0.5 bg-gray-800"></div>
      <div class="step-dot" id="dot-3"></div>
      <div class="w-6 h-0.5 bg-gray-800"></div>
      <div class="step-dot" id="dot-4"></div>
    </div>
  </div>

  <!-- Step 0: Account -->
  <div class="step active" id="step-0">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-3xl bg-indigo-500/15 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-user-plus text-indigo-400 text-2xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-2">Welcome to FaceAccess Home</h2>
      <p class="text-gray-400">Let's get you set up in about 5 minutes.</p>
    </div>
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Your Full Name</label>
        <input id="ob-name" class="input" placeholder="Jordan Kim" autofocus>
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Email Address</label>
        <input id="ob-email" type="email" class="input" placeholder="jordan@email.com">
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Phone (for notifications)</label>
        <input id="ob-phone" type="tel" class="input" placeholder="+1 555 0100">
      </div>
    </div>
    <div id="step0-err" class="text-red-400 text-sm mt-3 hidden"></div>
    <button class="btn-primary mt-6" onclick="stepNext(0)">Continue <i class="fas fa-arrow-right ml-2"></i></button>
    <p class="text-center text-xs text-gray-600 mt-4">Already have an account? <a href="/home/dashboard" class="text-indigo-400">Sign in</a></p>
  </div>

  <!-- Step 1: Home Setup -->
  <div class="step" id="step-1">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-3xl bg-indigo-500/15 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-house text-indigo-400 text-2xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-2">Name your home</h2>
      <p class="text-gray-400">You can add more properties later.</p>
    </div>
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Home Name</label>
        <input id="ob-homename" class="input" placeholder="My Home, Beach House, Parents'…">
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Address (optional)</label>
        <input id="ob-address" class="input" placeholder="142 Maple Street, Austin TX">
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button class="btn-back" onclick="stepBack(1)"><i class="fas fa-arrow-left mr-2"></i> Back</button>
      <button class="btn-primary" onclick="stepNext(1)">Continue <i class="fas fa-arrow-right ml-2"></i></button>
    </div>
  </div>

  <!-- Step 2: Camera Setup -->
  <div class="step" id="step-2">
    <div class="text-center mb-6">
      <div class="w-16 h-16 rounded-3xl bg-purple-500/15 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-camera text-purple-400 text-2xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-2">Connect a camera</h2>
      <p class="text-gray-400 text-sm">What camera do you have at your door?</p>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-4">
      ${[
        ['rtsp','fa-video','RTSP / IP Camera','Any camera with RTSP stream'],
        ['ring','fa-bell','Ring Doorbell','Connect via Ring API key'],
        ['nest','fa-google','Google Nest','Link your Google account'],
        ['arlo','fa-shield','Arlo Camera','Arlo API integration'],
        ['usb','fa-usb','USB / Webcam','Connect a USB camera'],
        ['skip','fa-forward','Skip for now','Add camera later'],
      ].map(([val, icon, label, sub]) => `
      <div class="option-card" data-val="${val}" onclick="selectCamera(this,'${val}')">
        <i class="fas ${icon} text-indigo-400 text-xl w-6 text-center flex-shrink-0"></i>
        <div>
          <div class="text-sm font-semibold text-white">${label}</div>
          <div class="text-xs text-gray-500">${sub}</div>
        </div>
      </div>`).join('')}
    </div>
    <div id="camera-extra" class="hidden mb-4">
      <label class="text-xs text-gray-500 mb-1.5 block font-medium">Stream URL / API Key</label>
      <input id="ob-camera-url" class="input" placeholder="rtsp://192.168.1.50:554/stream or API key">
    </div>
    <div class="flex gap-3">
      <button class="btn-back" onclick="stepBack(2)"><i class="fas fa-arrow-left mr-2"></i> Back</button>
      <button class="btn-primary" onclick="stepNext(2)">Continue <i class="fas fa-arrow-right ml-2"></i></button>
    </div>
  </div>

  <!-- Step 3: Face ID Enrollment — Production Grade -->
  <div class="step" id="step-3">
    <!-- Compact header above the FaceID widget -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <h2 style="font-size:20px;font-weight:900;color:#fff;margin:0 0 3px;">Set up Face ID</h2>
        <p style="font-size:12px;color:rgba(255,255,255,0.4);margin:0;">Multi-angle capture · liveness · anti-spoof</p>
      </div>
      <span id="ob-face-badge" style="display:none;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;"></span>
    </div>

    <!-- FaceID engine widget (rendered by home-onboard.js) -->
    <div id="ob-faceid-container"></div>

    <!-- Fallback upload (shown only if camera unavailable) -->
    <div id="ob-face-fallback" style="display:none;margin-top:12px;">
      <label style="
        display:flex;align-items:center;justify-content:center;gap:10px;
        background:rgba(255,255,255,0.05);border:2px dashed rgba(255,255,255,0.12);
        border-radius:14px;padding:20px;cursor:pointer;color:rgba(255,255,255,0.5);
        font-size:14px;transition:all .2s;
      ">
        <i class="fas fa-upload"></i> Upload a photo instead
        <input type="file" accept="image/*" style="display:none" onchange="obFaceUpload(event)">
      </label>
      <p style="font-size:11px;color:rgba(255,255,255,0.25);text-align:center;margin-top:8px;">
        Photo enrollment is less secure than live capture
      </p>
    </div>

    <!-- Status bar (completion, errors) -->
    <div id="ob-face-statusbar" style="margin-top:12px;"></div>

    <!-- Navigation -->
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn-back" onclick="stepBack(3)"><i class="fas fa-arrow-left mr-2"></i>Back</button>
      <button class="btn-primary" id="ob-face-next" style="display:none;" onclick="stepNext(3)">Continue <i class="fas fa-arrow-right ml-2"></i></button>
    </div>
    <button style="width:100%;background:none;border:none;color:rgba(255,255,255,0.25);font-size:12px;
      padding:10px;cursor:pointer;margin-top:4px;" onclick="stepNext(3,true)">
      Skip — register face later
    </button>
    <div id="step3-err" class="hidden" style="color:#ef4444;font-size:12px;margin-top:6px;text-align:center;"></div>
  </div>

  <!-- Step 4: Lock Setup -->
  <div class="step" id="step-4">
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-yellow-500/15 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-lock text-yellow-400 text-2xl"></i>
      </div>
      <h2 class="text-2xl font-black text-white mb-1">Connect your smart lock</h2>
      <p class="text-gray-400 text-sm">Which lock brand do you have?</p>
    </div>
    <div class="grid grid-cols-3 gap-3 mb-5">
      ${[
        ['august','August'],['schlage','Schlage'],['yale','Yale'],
        ['nuki','Nuki'],['generic','Generic/Relay'],['skip','Skip'],
      ].map(([val,label]) => `
      <div class="brand-btn" data-val="${val}" onclick="selectLock(this,'${val}')">
        <i class="fas fa-lock text-indigo-400 text-lg mb-1.5 block"></i>
        <div class="text-sm font-semibold text-white">${label}</div>
      </div>`).join('')}
    </div>
    <div id="lock-extra" class="hidden mb-4 space-y-3">
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">Lock Name</label>
        <input id="ob-lockname" class="input" placeholder="Front Door">
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1.5 block font-medium">API Credentials / Access Token</label>
        <input id="ob-lock-api" class="input" placeholder="Paste your August/Schlage API key">
      </div>
    </div>
    <div class="flex gap-3">
      <button class="btn-back" onclick="stepBack(4)"><i class="fas fa-arrow-left mr-2"></i> Back</button>
      <button class="btn-primary" onclick="stepNext(4)"><i class="fas fa-check mr-2"></i> Finish Setup</button>
    </div>
  </div>

  <!-- Step 5: Done -->
  <div class="step" id="step-5">
    <div class="text-center py-8">
      <div class="w-24 h-24 rounded-3xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 check-anim">
        <i class="fas fa-check text-white text-4xl"></i>
      </div>
      <h2 class="text-3xl font-black text-white mb-3">You're all set! 🎉</h2>
      <p class="text-gray-400 mb-2">FaceAccess Home is ready to protect <span id="done-home-name" class="text-white font-semibold"></span>.</p>
      <p class="text-sm text-gray-500 mb-8">Add family members and guests from your dashboard.</p>
      <div class="space-y-3">
        <a href="/home/dashboard" class="btn-primary block text-center py-4 text-lg no-underline" style="text-decoration:none">
          <i class="fas fa-th-large mr-2"></i> Open Dashboard
        </a>
        <a href="/home/mobile" target="_blank" class="block text-center py-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl font-semibold hover:bg-purple-500/20 transition-colors no-underline" style="text-decoration:none">
          <i class="fas fa-mobile-alt mr-2"></i> Open Mobile App
        </a>
      </div>
    </div>
  </div>
</div>

<script src="/static/faceid-engine.js"></script>
<script src="/static/home-onboard.js"></script>
</body>
</html>`
}

// ─────────────────────────────────────────────
// FaceAccess Home — Mobile App
// ─────────────────────────────────────────────
function getHomeMobileHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>FaceAccess Home — Mobile</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,sans-serif;background:#07071a;color:#e2e8f0;max-width:430px;margin:0 auto;min-height:100vh;overflow-x:hidden}
.card{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:18px}
.btn-approve{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:18px;padding:18px;font-size:18px;font-weight:800;width:100%;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:all .2s;box-shadow:0 4px 20px rgba(16,185,129,.3)}
.btn-approve:hover{transform:scale(1.02)}
.btn-deny{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:18px;padding:18px;font-size:18px;font-weight:800;width:100%;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:all .2s;box-shadow:0 4px 20px rgba(239,68,68,.3)}
.btn-deny:hover{transform:scale(1.02)}
.tab-btn{flex:1;padding:12px;border:none;background:transparent;color:#475569;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-size:14px}
.tab-btn.active{color:#818cf8;border-bottom-color:#6366f1}
.ble-ring{width:100px;height:100px;border-radius:50%;border:2.5px solid #6366f1;display:flex;align-items:center;justify-content:center;position:relative;margin:0 auto}
.ble-ring::before{content:'';position:absolute;inset:-14px;border:2px solid rgba(99,102,241,.25);border-radius:50%;animation:pulsate 2s infinite}
.ble-ring::after{content:'';position:absolute;inset:-28px;border:2px solid rgba(99,102,241,.12);border-radius:50%;animation:pulsate 2s .5s infinite}
@keyframes pulsate{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.5}}
.lock-row{background:#0f0f1e;border:1px solid #1a1a2e;border-radius:14px;padding:16px;display:flex;align-items:center;gap:12px}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.slide-in{animation:slideIn .3s ease}
@keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="min-h-screen flex flex-col">
  <!-- Header -->
  <header class="bg-gray-900/90 backdrop-blur sticky top-0 z-10 px-5 py-4 border-b border-gray-800/50">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <i class="fas fa-house-lock text-white text-sm"></i>
      </div>
      <div>
        <div class="font-bold text-white text-sm">FaceAccess <span class="text-indigo-400">Home</span></div>
        <div class="text-xs text-gray-500" id="hm-home-name">Kim Residence</div>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <div class="w-1.5 h-1.5 rounded-full bg-green-400 pulse"></div>
        <span class="text-xs text-green-400">Online</span>
      </div>
    </div>
  </header>

  <!-- Tabs -->
  <div class="flex border-b border-gray-800/50 bg-gray-900/40">
    <button class="tab-btn active" onclick="hmTab('home')" id="htab-home"><i class="fas fa-house mr-1"></i> Home</button>
    <button class="tab-btn" onclick="hmTab('locks')" id="htab-locks"><i class="fas fa-lock mr-1"></i> Locks</button>
    <button class="tab-btn" onclick="hmTab('activity')" id="htab-activity"><i class="fas fa-history mr-1"></i> Activity</button>
    <button class="tab-btn" onclick="hmTab('profile')" id="htab-profile"><i class="fas fa-user mr-1"></i> Me</button>
  </div>

  <div class="flex-1 p-4 space-y-4" id="hm-content"></div>
</div>

<script src="/static/home-mobile.js"></script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════
// AI TRUST & BEHAVIORAL API ROUTES (v3.0)
// ═══════════════════════════════════════════════════════════

// ── GET /api/ai/trust/:home_id ─────────────────────────────
// Returns all trust profiles for a home, joined with user names
app.get('/api/ai/trust/:home_id', async (c) => {
  const { DB } = c.env
  const homeId = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')

  const { results } = await DB.prepare(`
    SELECT tp.*, hu.name as user_name, hu.email as user_email,
           hu.avatar_color, hu.role as user_role
    FROM user_trust_profiles tp
    JOIN home_users hu ON tp.user_id = hu.id
    WHERE tp.home_id = ?
    ORDER BY tp.trust_score ASC
  `).bind(homeId).all()

  return c.json({ trust_profiles: results })
})

// ── GET /api/ai/trust/user/:user_id ───────────────────────
// Returns single user trust profile with recent patterns
app.get('/api/ai/trust/user/:user_id', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('user_id')
  if (!isValidId(userId)) return bad(c, 'Invalid user_id')

  const profile = await DB.prepare(`
    SELECT tp.*, hu.name as user_name, hu.email as user_email, hu.role as user_role
    FROM user_trust_profiles tp
    JOIN home_users hu ON tp.user_id = hu.id
    WHERE tp.user_id = ?
  `).bind(userId).first()

  // Recent 30-day patterns aggregated by hour
  const { results: hourDist } = await DB.prepare(`
    SELECT access_hour, COUNT(*) as cnt,
           ROUND(AVG(face_confidence), 3) as avg_confidence,
           SUM(CASE WHEN result='granted' THEN 1 ELSE 0 END) as granted_count
    FROM behavioral_patterns
    WHERE user_id=? AND created_at >= datetime('now','-30 days')
    GROUP BY access_hour ORDER BY access_hour
  `).bind(userId).all()

  const { results: recent } = await DB.prepare(`
    SELECT access_hour, access_dow, result, face_confidence, anomaly_score, is_typical, created_at
    FROM behavioral_patterns WHERE user_id=? ORDER BY created_at DESC LIMIT 20
  `).bind(userId).all()

  return c.json({ profile, hour_distribution: hourDist, recent_patterns: recent })
})

// ── POST /api/ai/trust/recalculate/:user_id ────────────────
// Force-recalculate trust score from all historical data
app.post('/api/ai/trust/recalculate/:user_id', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('user_id')
  if (!isValidId(userId)) return bad(c, 'Invalid user_id')

  const user: any = await DB.prepare('SELECT * FROM home_users WHERE id=? AND status=?').bind(userId, 'active').first()
  if (!user) return c.json({ error: 'User not found' }, 404)

  const { results: patterns } = await DB.prepare(`
    SELECT * FROM behavioral_patterns WHERE user_id=? ORDER BY created_at DESC LIMIT 200
  `).bind(userId).all() as any

  const hour = new Date().getHours()
  const dow  = new Date().getDay()
  const analysis = analyzePatterns(patterns as any[], hour, dow)

  const profile: any = await DB.prepare('SELECT * FROM user_trust_profiles WHERE user_id=?').bind(userId).first()
  const faceAvg = profile?.face_confidence_avg || 0.70

  const newScore = computeTrustScore(faceAvg, analysis.behavioralScore, profile?.predictive_score || 0.70, profile?.anomaly_penalty || 0.0)
  const tier = trustTier(newScore)

  if (profile) {
    await DB.prepare(`
      UPDATE user_trust_profiles SET trust_score=?, trust_tier=?, behavioral_score=?, last_updated=? WHERE user_id=?
    `).bind(newScore, tier, analysis.behavioralScore, now(), userId).run()
  }

  return c.json({ user_id: userId, trust_score: newScore, trust_tier: tier, behavioral_score: analysis.behavioralScore })
})

// ── GET /api/ai/anomalies/:home_id ────────────────────────
// Returns anomaly events for a home
app.get('/api/ai/anomalies/:home_id', async (c) => {
  const { DB } = c.env
  const homeId   = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')
  const severity = c.req.query('severity')
  const resolved = c.req.query('resolved')
  const limit    = parseIntParam(c.req.query('limit'), 50, 200)

  let q = `
    SELECT ae.*, hu.name as user_name, sl.name as lock_name
    FROM anomaly_events ae
    LEFT JOIN home_users hu ON ae.user_id = hu.id
    LEFT JOIN smart_locks sl ON ae.lock_id = sl.id
    WHERE ae.home_id=?`
  const args: any[] = [homeId]

  if (severity) { q += ' AND ae.severity=?'; args.push(sanitize(severity, 20)) }
  if (resolved !== undefined) { q += ' AND ae.resolved=?'; args.push(resolved === '1' ? 1 : 0) }
  q += ' ORDER BY ae.created_at DESC LIMIT ?'; args.push(limit)

  const { results } = await DB.prepare(q).bind(...args).all()
  const countRow: any = await DB.prepare(`
    SELECT COUNT(*) as cnt FROM anomaly_events WHERE home_id=? AND resolved=0 AND acknowledged=0
  `).bind(homeId).first()

  return c.json({ anomalies: results, unacknowledged_count: countRow?.cnt || 0 })
})

// ── PUT /api/ai/anomalies/:id/acknowledge ─────────────────
app.put('/api/ai/anomalies/:id/acknowledge', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  if (!isValidId(id)) return bad(c, 'Invalid id')
  const body = await c.req.json().catch(() => ({}))
  const note = sanitize(body.admin_note || '', 500)
  await DB.prepare(`UPDATE anomaly_events SET acknowledged=1, admin_note=? WHERE id=?`).bind(note, id).run()
  return c.json({ ok: true })
})

// ── PUT /api/ai/anomalies/:id/resolve ─────────────────────
app.put('/api/ai/anomalies/:id/resolve', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  if (!isValidId(id)) return bad(c, 'Invalid id')
  await DB.prepare(`UPDATE anomaly_events SET resolved=1, acknowledged=1 WHERE id=?`).bind(id).run()
  return c.json({ ok: true })
})

// ── GET /api/ai/predictions/:home_id ─────────────────────
// Returns active predictive sessions
app.get('/api/ai/predictions/:home_id', async (c) => {
  const { DB } = c.env
  const homeId = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')

  const { results } = await DB.prepare(`
    SELECT ps.*, hu.name as user_name, sl.name as lock_name
    FROM predictive_sessions ps
    LEFT JOIN home_users hu ON ps.user_id = hu.id
    LEFT JOIN smart_locks sl ON ps.lock_id = sl.id
    WHERE ps.home_id=? AND ps.outcome='pending' AND ps.expires_at > datetime('now')
    ORDER BY ps.predicted_arrival ASC
  `).bind(homeId).all()

  return c.json({ predictions: results })
})

// ── POST /api/ai/predictions/generate/:home_id ────────────
// Analyze all users' patterns and create predictive sessions for next arrivals
app.post('/api/ai/predictions/generate/:home_id', async (c) => {
  const { DB } = c.env
  const homeId = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')

  const { results: users } = await DB.prepare(`
    SELECT id, name FROM home_users WHERE home_id=? AND status='active'
  `).bind(homeId).all() as any

  const created: any[] = []

  for (const user of users as any[]) {
    const { results: patterns } = await DB.prepare(`
      SELECT access_hour, access_minute, access_dow, result
      FROM behavioral_patterns WHERE user_id=? AND result='granted'
      ORDER BY created_at DESC LIMIT 60
    `).bind(user.id).all() as any

    const prediction = predictNextArrival(patterns as any[])
    if (!prediction) continue

    // Check if a similar prediction already exists
    const existing: any = await DB.prepare(`
      SELECT id FROM predictive_sessions
      WHERE user_id=? AND outcome='pending' AND expires_at > datetime('now')
    `).bind(user.id).first()
    if (existing) continue

    const psId = 'ps-' + nanoid(10)
    const expiresAt = new Date(new Date(prediction.predictedAt).getTime() + 3600000).toISOString().replace('T', ' ').split('.')[0]

    await DB.prepare(`
      INSERT INTO predictive_sessions (id,user_id,home_id,predicted_arrival,prediction_confidence,prediction_basis,pre_auth_ready,expires_at,created_at)
      VALUES (?,?,?,?,?,'pattern',0,?,?)
    `).bind(psId, user.id, homeId, prediction.predictedAt, prediction.confidence, expiresAt, now()).run()

    created.push({ user_id: user.id, user_name: user.name, predicted_at: prediction.predictedAt, confidence: prediction.confidence })
  }

  return c.json({ generated: created.length, predictions: created })
})

// ── GET /api/ai/recommendations/:home_id ─────────────────
// Returns AI-generated access management recommendations
app.get('/api/ai/recommendations/:home_id', async (c) => {
  const { DB } = c.env
  const homeId = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')
  const refresh = c.req.query('refresh') === '1'

  if (!refresh) {
    // Return stored recommendations first
    const { results: stored } = await DB.prepare(`
      SELECT r.*, hu.name as user_name FROM ai_recommendations r
      LEFT JOIN home_users hu ON r.user_id = hu.id
      WHERE r.home_id=? AND r.dismissed=0
      AND (r.expires_at IS NULL OR r.expires_at > datetime('now'))
      ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, r.created_at DESC
      LIMIT 10
    `).bind(homeId).all()
    if ((stored as any[]).length > 0) return c.json({ recommendations: stored })
  }

  // Generate fresh recommendations
  const { results: trustProfiles } = await DB.prepare(`
    SELECT tp.*, hu.name as user_name FROM user_trust_profiles tp
    JOIN home_users hu ON tp.user_id=hu.id WHERE tp.home_id=?
  `).bind(homeId).all() as any

  const { results: anomalies } = await DB.prepare(`
    SELECT * FROM anomaly_events WHERE home_id=? AND resolved=0
    AND created_at >= datetime('now','-24 hours')
  `).bind(homeId).all() as any

  const { results: guestPasses } = await DB.prepare(`
    SELECT * FROM guest_passes WHERE home_id=? AND status='active'
    AND valid_until <= datetime('now','+7 days')
  `).bind(homeId).all() as any

  const recs = generateRecommendations(anomalies as any[], trustProfiles as any[], guestPasses as any[])

  // Persist new recommendations
  await DB.prepare(`DELETE FROM ai_recommendations WHERE home_id=? AND dismissed=0 AND acted_on=0`).bind(homeId).run()
  for (const rec of recs) {
    const recId = 'ar-' + nanoid(10)
    const expiresAt = new Date(Date.now() + 86400000 * 3).toISOString().replace('T', ' ').split('.')[0]
    await DB.prepare(`
      INSERT INTO ai_recommendations (id,home_id,user_id,recommendation_type,priority,title,message,action_data,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      recId, homeId, rec.actionData?.user_id || null, rec.type,
      rec.priority, rec.title, rec.message, JSON.stringify(rec.actionData), expiresAt, now()
    ).run()
  }

  const { results: fresh } = await DB.prepare(`
    SELECT * FROM ai_recommendations WHERE home_id=? AND dismissed=0
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
    LIMIT 10
  `).bind(homeId).all()

  return c.json({ recommendations: fresh })
})

// ── PUT /api/ai/recommendations/:id/dismiss ───────────────
app.put('/api/ai/recommendations/:id/dismiss', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  if (!isValidId(id)) return bad(c, 'Invalid id')
  await DB.prepare('UPDATE ai_recommendations SET dismissed=1 WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

// ── GET /api/ai/dashboard/:home_id ───────────────────────
// Aggregated AI dashboard data (trust, anomalies, predictions)
app.get('/api/ai/dashboard/:home_id', async (c) => {
  const { DB } = c.env
  const homeId = c.req.param('home_id')
  if (!isValidId(homeId)) return bad(c, 'Invalid home_id')

  const [trustRow, anomalyRow, predRow, recRow] = await Promise.all([
    DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN trust_tier='trusted'   THEN 1 ELSE 0 END) as trusted_count,
        SUM(CASE WHEN trust_tier='standard'  THEN 1 ELSE 0 END) as standard_count,
        SUM(CASE WHEN trust_tier='watchlist' THEN 1 ELSE 0 END) as watchlist_count,
        SUM(CASE WHEN trust_tier='blocked'   THEN 1 ELSE 0 END) as blocked_count,
        ROUND(AVG(trust_score), 3) as avg_trust_score
      FROM user_trust_profiles WHERE home_id=?
    `).bind(homeId).first(),
    DB.prepare(`
      SELECT
        COUNT(*) as total_unresolved,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN severity='high'     THEN 1 ELSE 0 END) as high_count,
        SUM(CASE WHEN severity='medium'   THEN 1 ELSE 0 END) as medium_count
      FROM anomaly_events WHERE home_id=? AND resolved=0
    `).bind(homeId).first(),
    DB.prepare(`
      SELECT COUNT(*) as active_predictions FROM predictive_sessions
      WHERE home_id=? AND outcome='pending' AND expires_at > datetime('now')
    `).bind(homeId).first(),
    DB.prepare(`
      SELECT COUNT(*) as pending_recs FROM ai_recommendations
      WHERE home_id=? AND dismissed=0 AND acted_on=0
    `).bind(homeId).first(),
  ])

  // Top trust score changes in last 7 days
  const { results: trustTrend } = await DB.prepare(`
    SELECT tp.user_id, hu.name, tp.trust_score, tp.trust_tier, tp.trust_score - 0.70 as delta
    FROM user_trust_profiles tp
    JOIN home_users hu ON tp.user_id=hu.id
    WHERE tp.home_id=?
    ORDER BY tp.trust_score ASC LIMIT 5
  `).bind(homeId).all()

  // Recent anomalies
  const { results: recentAnomalies } = await DB.prepare(`
    SELECT ae.*, hu.name as user_name FROM anomaly_events ae
    LEFT JOIN home_users hu ON ae.user_id=hu.id
    WHERE ae.home_id=? AND ae.resolved=0
    ORDER BY ae.created_at DESC LIMIT 5
  `).bind(homeId).all()

  // Behavioral activity heatmap (accesses per hour last 7 days)
  const { results: heatmap } = await DB.prepare(`
    SELECT access_hour, access_dow,
           COUNT(*) as count,
           ROUND(AVG(CASE WHEN result='granted' THEN 1.0 ELSE 0 END), 2) as success_rate
    FROM behavioral_patterns
    WHERE home_id=? AND created_at >= datetime('now','-7 days')
    GROUP BY access_hour, access_dow
    ORDER BY access_dow, access_hour
  `).bind(homeId).all()

  return c.json({
    trust_summary:     trustRow,
    anomaly_summary:   anomalyRow,
    predictions:       predRow,
    recommendations:   recRow,
    trust_watchlist:   trustTrend,
    recent_anomalies:  recentAnomalies,
    behavioral_heatmap: heatmap
  })
})

// ── GET /api/ai/behavioral/:user_id ──────────────────────
// Full behavioral analysis for a user
app.get('/api/ai/behavioral/:user_id', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('user_id')
  if (!isValidId(userId)) return bad(c, 'Invalid user_id')
  const days = parseIntParam(c.req.query('days'), 30, 90)

  const { results: patterns } = await DB.prepare(`
    SELECT * FROM behavioral_patterns
    WHERE user_id=? AND created_at >= datetime('now','-${days} days')
    ORDER BY created_at DESC
  `).bind(userId).all() as any

  const hour = new Date().getHours()
  const dow  = new Date().getDay()
  const analysis = analyzePatterns(patterns as any[], hour, dow)
  const prediction = predictNextArrival(patterns as any[])

  // Day-of-week distribution
  const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dowDist: Record<string, number> = {}
  for (const p of (patterns as any[])) {
    const label = dowLabels[p.access_dow]
    dowDist[label] = (dowDist[label] || 0) + 1
  }

  return c.json({
    user_id: userId,
    days_analyzed: days,
    total_events: (patterns as any[]).length,
    analysis,
    prediction,
    dow_distribution: dowDist,
    typical_hours: analysis.typicalHours,
    typical_days:  analysis.typicalDows.map(d => dowLabels[d])
  })
})

// ═══════════════════════════════════════════════════════════
// Catch-all SPA route (MUST be last — after all API routes)
// ═══════════════════════════════════════════════════════════
app.get('*', (c) => {
  return c.html(getMainHTML())
})

export default app
