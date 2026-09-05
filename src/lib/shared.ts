// ─────────────────────────────────────────────────────────────
// Shared helpers — validation, IDs, time, crypto, sessions
// ─────────────────────────────────────────────────────────────

export type Bindings = { DB: D1Database }

/** Cryptographically secure random ID */
export function nanoid(len = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

/** Strip dangerous chars, trim, cap length */
export function sanitize(val: unknown, maxLen = 512): string {
  if (val == null) return ''
  return String(val).replace(/[<>"'`;]/g, '').slice(0, maxLen).trim()
}

export function isEmail(e: unknown): boolean {
  return typeof e === 'string' && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,64}$/.test(e)
}

export function isPhone(p: unknown): boolean {
  if (typeof p !== 'string') return false
  return /^\+?[\d\s\-\(\)]{7,20}$/.test(p.trim())
}

export function isStrongPassword(p: string): boolean {
  return typeof p === 'string' && p.length >= 8 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p)
}

export function isValidId(id: string | undefined | null): boolean {
  if (!id) return false
  return /^[a-zA-Z0-9_\-]{1,64}$/.test(id)
}

export function parseIntParam(v: string | undefined, def: number, max: number): number {
  const n = parseInt(v || String(def))
  if (isNaN(n) || n < 0) return def
  return Math.min(n, max)
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0]
}

export function isoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').split('.')[0]
}

export function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status)
}

// ── Schedule checks ───────────────────────────────────────────
export function checkDayAllowed(daysAllowed: string): boolean {
  const today = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()]
  return (daysAllowed || '').split(',').map(s => s.trim()).includes(today)
}

export function checkTimeAllowed(timeStart: string, timeEnd: string): boolean {
  const d = new Date()
  const [sh, sm] = (timeStart || '00:00').split(':').map(Number)
  const [eh, em] = (timeEnd || '23:59').split(':').map(Number)
  const cur = d.getHours() * 60 + d.getMinutes()
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return cur >= start && cur <= end
}

// ── Vector math (face descriptors) ────────────────────────────
/** Euclidean distance between two equal-length vectors */
export function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const den = Math.sqrt(na) * Math.sqrt(nb)
  return den === 0 ? 0 : dot / den
}

/** Validate a face descriptor: array of finite numbers, expected dimension */
export function isValidDescriptor(v: unknown, dims = 128): v is number[] {
  return Array.isArray(v) && v.length === dims && v.every(x => typeof x === 'number' && isFinite(x))
}

// ── Password hashing (PBKDF2-SHA256, 100k iterations) ─────────
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = nanoid(16)
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, keyMat, 256)
  const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${salt}:${hex}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = (stored || '').split(':')
    if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false
    const [, salt, storedHash] = parts
    const enc = new TextEncoder()
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, keyMat, 256)
    const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
    // constant-time compare
    if (hex.length !== storedHash.length) return false
    let diff = 0
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ storedHash.charCodeAt(i)
    return diff === 0
  } catch { return false }
}

export function makeSessionToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

// ── Sessions ──────────────────────────────────────────────────
export type Session = {
  account: any
  session: any
  org_id: string | null
  account_type: 'business' | 'home' | 'mobile'
}

export function bearerToken(c: any): string | null {
  const h = c.req.header('Authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

export async function getSession(c: any): Promise<Session | null> {
  const { DB } = c.env as Bindings
  const token = bearerToken(c)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const session = await DB.prepare(`SELECT * FROM auth_sessions WHERE id=? AND expires_at > datetime('now')`).bind(token).first() as any
  if (!session) return null
  // Touch last_active at most once per minute to avoid write amplification
  if (!session.last_active || Date.now() - new Date(session.last_active.replace(' ', 'T') + 'Z').getTime() > 60_000) {
    await DB.prepare(`UPDATE auth_sessions SET last_active=? WHERE id=?`).bind(now(), token).run()
  }
  let account: any = null
  if (session.account_type === 'business') {
    account = await DB.prepare(`SELECT * FROM business_accounts WHERE id=? AND status='active'`).bind(session.account_id).first()
  } else {
    account = await DB.prepare(`SELECT * FROM home_accounts WHERE id=? AND status='active'`).bind(session.account_id).first()
  }
  if (!account) return null
  return { account, session, org_id: account.org_id ?? null, account_type: session.account_type }
}

export async function logAuthEvent(DB: D1Database, data: {
  account_id?: string, account_type?: string, email?: string,
  event_type: string, ip?: string, ua?: string, metadata?: Record<string, unknown>
}) {
  await DB.prepare(`INSERT INTO auth_audit_log (id,account_id,account_type,email,event_type,ip_address,user_agent,metadata,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind('aal-' + nanoid(10), data.account_id || null, data.account_type || null, data.email || null,
      data.event_type, data.ip || null, (data.ua || '').slice(0, 300), JSON.stringify(data.metadata || {}), now())
    .run()
}

export function clientIp(c: any): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
}
