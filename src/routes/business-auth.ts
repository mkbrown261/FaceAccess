// ─────────────────────────────────────────────────────────────
// Business Auth — organizations, accounts, sessions, invitations
// ─────────────────────────────────────────────────────────────
import { Hono } from 'hono'
import {
  Bindings, nanoid, sanitize, isEmail, isPhone, isStrongPassword, now, isoPlus, bad,
  hashPassword, verifyPassword, makeSessionToken, getSession, logAuthEvent, clientIp, bearerToken
} from '../lib/shared'

const auth = new Hono<{ Bindings: Bindings }>()

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const INVITE_TTL_MS  = 7 * 24 * 60 * 60 * 1000   // 7 days
const ORG_ROLES = ['admin', 'operator', 'viewer'] as const
const ORG_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+']

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'org'
}

async function createSession(DB: D1Database, accountId: string, ip: string, ua: string): Promise<string> {
  const token = makeSessionToken()
  await DB.prepare(`INSERT INTO auth_sessions (id,account_id,account_type,ip_address,user_agent,expires_at,created_at,last_active)
    VALUES (?,?,'business',?,?,?,?,?)`)
    .bind(token, accountId, ip, ua.slice(0, 300), isoPlus(SESSION_TTL_MS), now(), now()).run()
  return token
}

function publicAccount(a: any, org: any) {
  return {
    id: a.id, first_name: a.first_name, last_name: a.last_name, email: a.email, phone: a.phone,
    role: a.role, account_type: 'business', org_id: a.org_id,
    org: org ? { id: org.id, name: org.name, slug: org.slug, plan: org.plan, status: org.status, trial_ends_at: org.trial_ends_at } : null
  }
}

async function seedOrgDefaults(DB: D1Database, orgId: string, orgName: string) {
  const defaults: Record<string, string> = {
    company_name: orgName,
    face_match_threshold_high: '0.45',   // euclidean distance — lower is stricter
    face_match_threshold_medium: '0.60',
    face_match_margin: '0.05',           // min gap to runner-up
    liveness_enabled: 'true',
    two_fa_timeout_seconds: '120',
    retention_days_logs: '365',
    retention_days_biometric: '1095'
  }
  const stmts = Object.entries(defaults).map(([k, v]) =>
    DB.prepare('INSERT OR IGNORE INTO settings (org_id,key,value,updated_at) VALUES (?,?,?,?)').bind(orgId, k, v, now()))
  await DB.batch(stmts)
}

// ── POST /register — creates organization + admin account ──────
auth.post('/register', async (c) => {
  const { DB } = c.env
  const ip = clientIp(c), ua = c.req.header('User-Agent') || ''
  const body = await c.req.json().catch(() => ({}))

  const first_name = sanitize(body.first_name, 80)
  const last_name  = sanitize(body.last_name, 80)
  const email      = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const phone      = sanitize(body.phone, 30) || null
  const password   = typeof body.password === 'string' ? body.password : ''
  const org_name   = sanitize(body.org_name, 120)
  const org_size   = ORG_SIZES.includes(body.org_size) ? body.org_size : null
  const industry   = sanitize(body.industry, 80) || null
  const consent    = body.consent_terms === true
  const sms_consent = body.sms_consent === true
  const invite_token = typeof body.invite_token === 'string' ? body.invite_token.trim() : null

  if (!first_name || !last_name)    return bad(c, 'First and last name are required')
  if (!isEmail(email))              return bad(c, 'Invalid email address')
  if (phone && !isPhone(phone))     return bad(c, 'Invalid phone number format')
  if (!isStrongPassword(password))  return bad(c, 'Password must be at least 8 characters with letters and numbers')
  if (!consent)                     return bad(c, 'You must accept the Terms of Use and Privacy Policy')

  const existing = await DB.prepare('SELECT id FROM business_accounts WHERE email=?').bind(email).first()
  if (existing) return bad(c, 'An account with this email already exists', 409)

  let orgId: string
  let role: string = 'admin'
  let org: any

  if (invite_token) {
    // Joining an existing org via invitation
    const inv = await DB.prepare(`SELECT * FROM org_invitations WHERE token=? AND status='pending' AND expires_at > datetime('now')`).bind(invite_token).first() as any
    if (!inv) return bad(c, 'Invitation is invalid or has expired', 410)
    if (inv.email.toLowerCase() !== email) return bad(c, 'This invitation was issued to a different email address')
    orgId = inv.org_id
    role = inv.role
    org = await DB.prepare('SELECT * FROM organizations WHERE id=? AND status=?').bind(orgId, 'active').first()
    if (!org) return bad(c, 'Organization not found or suspended', 404)
    await DB.prepare(`UPDATE org_invitations SET status='accepted', accepted_at=? WHERE id=?`).bind(now(), inv.id).run()
  } else {
    if (!org_name) return bad(c, 'Company / organization name is required')
    orgId = 'org-' + nanoid(10)
    let slug = slugify(org_name)
    const slugTaken = await DB.prepare('SELECT id FROM organizations WHERE slug=?').bind(slug).first()
    if (slugTaken) slug = `${slug}-${nanoid(4).toLowerCase()}`
    await DB.prepare(`INSERT INTO organizations (id,name,slug,industry,size,plan,status,trial_ends_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'trial','active',?,?,?)`)
      .bind(orgId, org_name, slug, industry, org_size, isoPlus(14 * 24 * 60 * 60 * 1000), now(), now()).run()
    await seedOrgDefaults(DB, orgId, org_name)
    org = await DB.prepare('SELECT * FROM organizations WHERE id=?').bind(orgId).first()
  }

  const id = 'biz-' + nanoid(10)
  const password_hash = await hashPassword(password)
  await DB.prepare(`INSERT INTO business_accounts (id,org_id,first_name,last_name,email,phone,password_hash,role,org_name,org_size,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
    .bind(id, orgId, first_name, last_name, email, phone, password_hash, role, org.name, org_size, now(), now()).run()
  if (!invite_token) await DB.prepare('UPDATE organizations SET created_by=? WHERE id=?').bind(id, orgId).run()

  const token = await createSession(DB, id, ip, ua)
  await logAuthEvent(DB, { account_id: id, account_type: 'business', email, event_type: 'register', ip, ua,
    metadata: { org_id: orgId, via_invite: !!invite_token, sms_consent } })

  const account = await DB.prepare('SELECT * FROM business_accounts WHERE id=?').bind(id).first()
  return c.json({ message: 'Account created', token, account: publicAccount(account, org) }, 201)
})

// ── POST /login ────────────────────────────────────────────────
auth.post('/login', async (c) => {
  const { DB } = c.env
  const ip = clientIp(c), ua = c.req.header('User-Agent') || ''
  const body = await c.req.json().catch(() => ({}))
  const email    = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!isEmail(email) || !password) return bad(c, 'Email and password are required')

  // Basic brute-force guard: 10 failed attempts / 15 min per email
  const fails = await DB.prepare(`SELECT COUNT(*) as n FROM auth_audit_log
    WHERE email=? AND event_type='login_failed' AND created_at > datetime('now','-15 minutes')`).bind(email).first() as any
  if ((fails?.n || 0) >= 10) return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429)

  const account = await DB.prepare(`SELECT * FROM business_accounts WHERE email=?`).bind(email).first() as any
  if (!account || account.status !== 'active' || !(await verifyPassword(password, account.password_hash))) {
    await logAuthEvent(DB, { account_id: account?.id, email, account_type: 'business', event_type: 'login_failed', ip, ua })
    return c.json({ error: 'Invalid email or password' }, 401)
  }
  const org = await DB.prepare('SELECT * FROM organizations WHERE id=?').bind(account.org_id).first() as any
  if (org && org.status !== 'active') return c.json({ error: 'Your organization has been suspended. Contact support.' }, 403)

  const token = await createSession(DB, account.id, ip, ua)
  await DB.prepare(`UPDATE business_accounts SET last_login=?,login_count=login_count+1,updated_at=? WHERE id=?`).bind(now(), now(), account.id).run()
  await logAuthEvent(DB, { account_id: account.id, email, account_type: 'business', event_type: 'login_success', ip, ua })
  return c.json({ message: 'Login successful', token, account: publicAccount(account, org) })
})

// ── GET /me ────────────────────────────────────────────────────
auth.get('/me', async (c) => {
  const sess = await getSession(c)
  if (!sess || sess.account_type !== 'business') return c.json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' }, 401)
  const org = sess.org_id ? await c.env.DB.prepare('SELECT * FROM organizations WHERE id=?').bind(sess.org_id).first() : null
  return c.json({ account: publicAccount(sess.account, org), session_expires: sess.session.expires_at })
})

// ── POST /logout ───────────────────────────────────────────────
auth.post('/logout', async (c) => {
  const { DB } = c.env
  const token = bearerToken(c)
  if (token) {
    const s = await DB.prepare('SELECT account_id FROM auth_sessions WHERE id=?').bind(token).first() as any
    await DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(token).run()
    if (s) await logAuthEvent(DB, { account_id: s.account_id, account_type: 'business', event_type: 'logout' })
  }
  return c.json({ message: 'Logged out' })
})

// ── PUT /password ──────────────────────────────────────────────
auth.put('/password', async (c) => {
  const sess = await getSession(c)
  if (!sess || sess.account_type !== 'business') return c.json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' }, 401)
  const body = await c.req.json().catch(() => ({}))
  const current = typeof body.current_password === 'string' ? body.current_password : ''
  const next    = typeof body.new_password === 'string' ? body.new_password : ''
  if (!(await verifyPassword(current, sess.account.password_hash))) return bad(c, 'Current password is incorrect', 401)
  if (!isStrongPassword(next)) return bad(c, 'New password must be at least 8 characters with letters and numbers')
  await c.env.DB.prepare('UPDATE business_accounts SET password_hash=?, updated_at=? WHERE id=?')
    .bind(await hashPassword(next), now(), sess.account.id).run()
  // Invalidate all other sessions
  await c.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id=? AND id!=?').bind(sess.account.id, sess.session.id).run()
  await logAuthEvent(c.env.DB, { account_id: sess.account.id, account_type: 'business', event_type: 'password_change' })
  return c.json({ message: 'Password updated' })
})

// ── GET /invite/:token — public: preview an invitation ─────────
auth.get('/invite/:token', async (c) => {
  const inv = await c.env.DB.prepare(`SELECT i.email,i.role,i.expires_at,i.status,o.name as org_name
    FROM org_invitations i JOIN organizations o ON o.id=i.org_id WHERE i.token=?`).bind(c.req.param('token')).first() as any
  if (!inv) return c.json({ error: 'Invitation not found' }, 404)
  const expired = inv.status !== 'pending' || new Date(inv.expires_at.replace(' ', 'T') + 'Z') < new Date()
  return c.json({ invitation: { email: inv.email, role: inv.role, org_name: inv.org_name, valid: !expired } })
})

export default auth
export { ORG_ROLES, INVITE_TTL_MS }
