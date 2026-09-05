// ─────────────────────────────────────────────────────────────
// Business API — org-scoped. Every route requires a business session.
// Resources: users, doors, permissions, recognize, 2FA, logs,
//            analytics, cameras, settings, team, org
// ─────────────────────────────────────────────────────────────
import { Hono } from 'hono'
import {
  Bindings, Session, nanoid, sanitize, isEmail, isPhone, isValidId, parseIntParam, now, isoPlus, bad,
  getSession, checkDayAllowed, checkTimeAllowed, euclidean, isValidDescriptor, logAuthEvent
} from '../lib/shared'
import { ORG_ROLES, INVITE_TTL_MS } from './business-auth'

type Vars = { sess: Session; orgId: string }
const api = new Hono<{ Bindings: Bindings; Variables: Vars }>()

const USER_ROLES = ['employee', 'manager', 'admin', 'contractor', 'visitor']
const DESCRIPTOR_DIMS = 128

// ── Auth guard: business session + active org ──────────────────
api.use('*', async (c, next) => {
  const sess = await getSession(c)
  if (!sess || sess.account_type !== 'business') return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401)
  if (!sess.org_id) return c.json({ error: 'Account is not linked to an organization', code: 'NO_ORG' }, 403)
  c.set('sess', sess)
  c.set('orgId', sess.org_id)
  await next()
})

/** Only admins may perform destructive/config operations */
function requireRole(...roles: string[]) {
  return async (c: any, next: any) => {
    const sess = c.get('sess') as Session
    if (!roles.includes(sess.account.role)) return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403)
    await next()
  }
}
const adminOnly = requireRole('admin', 'superadmin')
const operatorUp = requireRole('admin', 'superadmin', 'operator')

async function getOrgSettings(DB: D1Database, orgId: string): Promise<Record<string, string>> {
  const { results } = await DB.prepare('SELECT key,value FROM settings WHERE org_id=?').bind(orgId).all()
  const s: Record<string, string> = {}
  for (const r of results as any[]) s[r.key] = r.value
  return s
}

// ═══════════════════════════════════════════════════════════════
// ORGANIZATION
// ═══════════════════════════════════════════════════════════════
api.get('/org', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const org = await DB.prepare('SELECT * FROM organizations WHERE id=?').bind(orgId).first()
  const counts = await DB.prepare(`SELECT
    (SELECT COUNT(*) FROM users WHERE org_id=? AND status='active') as users,
    (SELECT COUNT(*) FROM users WHERE org_id=? AND status='active' AND face_registered=1) as enrolled,
    (SELECT COUNT(*) FROM doors WHERE org_id=? AND status='active') as doors,
    (SELECT COUNT(*) FROM business_accounts WHERE org_id=? AND status='active') as team`).bind(orgId, orgId, orgId, orgId).first()
  return c.json({ org, counts })
})

api.put('/org', adminOnly, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120) || null
  const industry = sanitize(body.industry, 80) || null
  const size = ['1-10', '11-50', '51-200', '201-1000', '1000+'].includes(body.size) ? body.size : null
  await DB.prepare(`UPDATE organizations SET name=COALESCE(?,name), industry=COALESCE(?,industry), size=COALESCE(?,size), updated_at=? WHERE id=?`)
    .bind(name, industry, size, now(), orgId).run()
  if (name) await DB.prepare(`INSERT OR REPLACE INTO settings (org_id,key,value,updated_at) VALUES (?,'company_name',?,?)`).bind(orgId, name, now()).run()
  const org = await DB.prepare('SELECT * FROM organizations WHERE id=?').bind(orgId).first()
  return c.json({ org, message: 'Organization updated' })
})

// ═══════════════════════════════════════════════════════════════
// TEAM (dashboard accounts) + INVITATIONS
// ═══════════════════════════════════════════════════════════════
api.get('/team', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const { results: members } = await DB.prepare(`SELECT id,first_name,last_name,email,phone,role,status,last_login,login_count,created_at
    FROM business_accounts WHERE org_id=? ORDER BY created_at`).bind(orgId).all()
  const { results: invitations } = await DB.prepare(`SELECT id,email,role,status,expires_at,created_at FROM org_invitations
    WHERE org_id=? AND status='pending' AND expires_at > datetime('now') ORDER BY created_at DESC`).bind(orgId).all()
  return c.json({ members, invitations })
})

api.post('/team/invite', adminOnly, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const sess = c.get('sess')
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const role = (ORG_ROLES as readonly string[]).includes(body.role) ? body.role : 'operator'
  if (!isEmail(email)) return bad(c, 'Invalid email address')
  const exists = await DB.prepare('SELECT id FROM business_accounts WHERE email=?').bind(email).first()
  if (exists) return bad(c, 'An account with this email already exists', 409)
  await DB.prepare(`UPDATE org_invitations SET status='revoked' WHERE org_id=? AND email=? AND status='pending'`).bind(orgId, email).run()
  const id = 'inv-' + nanoid(10)
  const token = nanoid(32)
  await DB.prepare(`INSERT INTO org_invitations (id,org_id,email,role,token,invited_by,status,expires_at,created_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`).bind(id, orgId, email, role, token, sess.account.id, isoPlus(INVITE_TTL_MS), now()).run()
  const origin = new URL(c.req.url).origin
  return c.json({ message: 'Invitation created', invitation: { id, email, role, token, invite_url: `${origin}/?invite=${token}`, expires_at: isoPlus(INVITE_TTL_MS) } }, 201)
})

api.delete('/team/invite/:id', adminOnly, async (c) => {
  const { DB } = c.env
  await DB.prepare(`UPDATE org_invitations SET status='revoked' WHERE id=? AND org_id=?`).bind(c.req.param('id'), c.get('orgId')).run()
  return c.json({ message: 'Invitation revoked' })
})

api.put('/team/:id', adminOnly, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const sess = c.get('sess')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const role = (ORG_ROLES as readonly string[]).includes(body.role) ? body.role : null
  const status = ['active', 'suspended'].includes(body.status) ? body.status : null
  if (id === sess.account.id && (role && role !== 'admin' || status === 'suspended')) return bad(c, 'You cannot demote or suspend your own account')
  const target = await DB.prepare('SELECT id FROM business_accounts WHERE id=? AND org_id=?').bind(id, orgId).first()
  if (!target) return bad(c, 'Team member not found', 404)
  await DB.prepare(`UPDATE business_accounts SET role=COALESCE(?,role), status=COALESCE(?,status), updated_at=? WHERE id=? AND org_id=?`)
    .bind(role, status, now(), id, orgId).run()
  if (status === 'suspended') await DB.prepare('DELETE FROM auth_sessions WHERE account_id=?').bind(id).run()
  return c.json({ message: 'Team member updated' })
})

// ═══════════════════════════════════════════════════════════════
// USERS (people who walk through doors)
// ═══════════════════════════════════════════════════════════════
api.get('/users', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const role = c.req.query('role')
  const status = c.req.query('status') || 'active'
  const q = sanitize(c.req.query('q'), 80)
  let sql = `SELECT id,name,email,role,department,phone,employee_id,face_registered,face_enrolled_at,face_sample_count,status,created_at
    FROM users WHERE org_id=?`
  const args: any[] = [orgId]
  if (role && USER_ROLES.includes(role)) { sql += ' AND role=?'; args.push(role) }
  if (status !== 'all') { sql += ' AND status=?'; args.push(status) }
  if (q) { sql += ' AND (name LIKE ? OR email LIKE ? OR department LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ' ORDER BY name ASC LIMIT 500'
  const { results } = await DB.prepare(sql).bind(...args).all()
  return c.json({ users: results })
})

api.get('/users/:id', async (c) => {
  const { DB } = c.env
  const user = await DB.prepare(`SELECT id,org_id,name,email,role,department,phone,employee_id,face_registered,face_enrolled_at,face_sample_count,status,created_at,updated_at
    FROM users WHERE id=? AND org_id=?`).bind(c.req.param('id'), c.get('orgId')).first()
  if (!user) return bad(c, 'User not found', 404)
  return c.json({ user })
})

api.post('/users', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120)
  const email = sanitize(body.email, 254).toLowerCase()
  const role = sanitize(body.role, 30) || 'employee'
  const department = sanitize(body.department, 120) || null
  const phone = sanitize(body.phone, 30) || null
  const employee_id = sanitize(body.employee_id, 60) || null
  if (!name || !email) return bad(c, 'name and email are required')
  if (!isEmail(email)) return bad(c, 'Invalid email address')
  if (phone && !isPhone(phone)) return bad(c, 'Invalid phone number')
  if (!USER_ROLES.includes(role)) return bad(c, `role must be one of: ${USER_ROLES.join(', ')}`)
  const dup = await DB.prepare('SELECT id FROM users WHERE org_id=? AND email=?').bind(orgId, email).first()
  if (dup) return bad(c, 'A user with this email already exists in your organization', 409)
  const id = 'usr-' + nanoid(10)
  await DB.prepare(`INSERT INTO users (id,org_id,name,email,role,department,phone,employee_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'active',?,?)`).bind(id, orgId, name, email, role, department, phone, employee_id, now(), now()).run()
  const user = await DB.prepare('SELECT id,name,email,role,department,phone,employee_id,face_registered,status,created_at FROM users WHERE id=?').bind(id).first()
  return c.json({ user, message: 'User created' }, 201)
})

api.put('/users/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120) || null
  const email = body.email ? sanitize(body.email, 254).toLowerCase() : null
  const role = sanitize(body.role, 30) || null
  const department = body.department !== undefined ? (sanitize(body.department, 120) || null) : undefined
  const phone = body.phone !== undefined ? (sanitize(body.phone, 30) || null) : undefined
  const employee_id = body.employee_id !== undefined ? (sanitize(body.employee_id, 60) || null) : undefined
  const status = sanitize(body.status, 20) || null
  if (email && !isEmail(email)) return bad(c, 'Invalid email address')
  if (role && !USER_ROLES.includes(role)) return bad(c, `role must be one of: ${USER_ROLES.join(', ')}`)
  if (status && !['active', 'inactive'].includes(status)) return bad(c, 'status must be active or inactive')
  const existing = await DB.prepare('SELECT * FROM users WHERE id=? AND org_id=?').bind(id, orgId).first() as any
  if (!existing) return bad(c, 'User not found', 404)
  if (email && email !== existing.email) {
    const dup = await DB.prepare('SELECT id FROM users WHERE org_id=? AND email=? AND id!=?').bind(orgId, email, id).first()
    if (dup) return bad(c, 'Another user already has this email', 409)
  }
  await DB.prepare(`UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), role=COALESCE(?,role),
      department=CASE WHEN ? THEN ? ELSE department END,
      phone=CASE WHEN ? THEN ? ELSE phone END,
      employee_id=CASE WHEN ? THEN ? ELSE employee_id END,
      status=COALESCE(?,status), updated_at=? WHERE id=? AND org_id=?`)
    .bind(name, email, role,
      department !== undefined ? 1 : 0, department ?? null,
      phone !== undefined ? 1 : 0, phone ?? null,
      employee_id !== undefined ? 1 : 0, employee_id ?? null,
      status, now(), id, orgId).run()
  const user = await DB.prepare('SELECT id,name,email,role,department,phone,employee_id,face_registered,status,created_at,updated_at FROM users WHERE id=?').bind(id).first()
  return c.json({ user, message: 'User updated' })
})

api.delete('/users/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const r = await DB.prepare(`UPDATE users SET status='deleted', face_embedding=NULL, face_registered=0, face_sample_count=0, updated_at=? WHERE id=? AND org_id=?`)
    .bind(now(), c.req.param('id'), orgId).run()
  if (!r.meta.changes) return bad(c, 'User not found', 404)
  await DB.prepare('DELETE FROM user_door_permissions WHERE user_id=? AND org_id=?').bind(c.req.param('id'), orgId).run()
  return c.json({ message: 'User removed and biometric data erased' })
})

// ── Face enrollment: store REAL descriptor (128-dim, dlib ResNet) ──
api.post('/users/:id/face', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const { descriptor, descriptors, quality, sample_count } = body

  // Accept either a single averaged descriptor or an array of descriptors to average server-side
  let final: number[] | null = null
  let samples = 0
  if (Array.isArray(descriptors) && descriptors.length > 0) {
    if (!descriptors.every((d: unknown) => isValidDescriptor(d, DESCRIPTOR_DIMS))) return bad(c, `Each descriptor must be ${DESCRIPTOR_DIMS} finite numbers`)
    const avg = new Array(DESCRIPTOR_DIMS).fill(0)
    for (const d of descriptors as number[][]) for (let i = 0; i < DESCRIPTOR_DIMS; i++) avg[i] += d[i] / descriptors.length
    final = avg; samples = descriptors.length
  } else if (isValidDescriptor(descriptor, DESCRIPTOR_DIMS)) {
    final = descriptor; samples = Number(sample_count) || 1
  } else {
    return bad(c, `A face descriptor (${DESCRIPTOR_DIMS}-dim) is required. No synthetic fallback exists.`)
  }

  const user = await DB.prepare('SELECT id,name FROM users WHERE id=? AND org_id=? AND status=?').bind(id, orgId, 'active').first() as any
  if (!user) return bad(c, 'User not found', 404)

  // Duplicate-identity guard: refuse if this face is already enrolled for a different user in this org
  const { results: others } = await DB.prepare('SELECT id,name,face_embedding FROM users WHERE org_id=? AND face_registered=1 AND status=? AND id!=?').bind(orgId, 'active', id).all() as any
  const settings = await getOrgSettings(DB, orgId)
  const strict = parseFloat(settings.face_match_threshold_high || '0.45')
  for (const o of others) {
    try {
      const d = euclidean(final, JSON.parse(o.face_embedding))
      if (d < strict) return c.json({ error: `This face is already enrolled for another user (${o.name}). One person cannot be enrolled twice.`, code: 'DUPLICATE_FACE', conflict_user_id: o.id }, 409)
    } catch {}
  }

  await DB.prepare(`UPDATE users SET face_embedding=?, face_registered=1, face_enrolled_at=?, face_sample_count=?, updated_at=? WHERE id=? AND org_id=?`)
    .bind(JSON.stringify(final.map(v => Math.round(v * 1e6) / 1e6)), now(), samples, now(), id, orgId).run()
  return c.json({ message: 'Face enrolled', user_id: id, sample_count: samples, quality: quality ?? null })
})

api.delete('/users/:id/face', operatorUp, async (c) => {
  const { DB } = c.env
  const r = await DB.prepare(`UPDATE users SET face_embedding=NULL, face_registered=0, face_sample_count=0, face_enrolled_at=NULL, updated_at=? WHERE id=? AND org_id=?`)
    .bind(now(), c.req.param('id'), c.get('orgId')).run()
  if (!r.meta.changes) return bad(c, 'User not found', 404)
  return c.json({ message: 'Biometric data erased' })
})

// ═══════════════════════════════════════════════════════════════
// DOORS
// ═══════════════════════════════════════════════════════════════
api.get('/doors', async (c) => {
  const { DB } = c.env
  const status = c.req.query('status') || 'active'
  let sql = `SELECT d.*, (SELECT COUNT(*) FROM cameras WHERE door_id=d.id AND org_id=d.org_id AND status='active') as camera_count
    FROM doors d WHERE d.org_id=?`
  const args: any[] = [c.get('orgId')]
  if (status !== 'all') { sql += ' AND d.status=?'; args.push(status) }
  sql += ' ORDER BY d.building, d.floor, d.name'
  const { results } = await DB.prepare(sql).bind(...args).all()
  return c.json({ doors: results })
})

api.post('/doors', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120)
  const location = sanitize(body.location, 200)
  const floor = sanitize(body.floor, 40) || null
  const building = sanitize(body.building, 120) || null
  const relay_ip = sanitize(body.relay_ip, 60) || null
  const relay_port = body.relay_port ? Math.min(65535, Math.max(1, parseInt(body.relay_port) || 0)) || null : null
  const security_level = ['standard', 'elevated', 'high', 'restricted'].includes(body.security_level) ? body.security_level : 'standard'
  if (!name || !location) return bad(c, 'name and location are required')
  const id = 'door-' + nanoid(10)
  await DB.prepare(`INSERT INTO doors (id,org_id,name,location,floor,building,relay_ip,relay_port,requires_2fa,security_level,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`)
    .bind(id, orgId, name, location, floor, building, relay_ip, relay_port, body.requires_2fa ? 1 : 0, security_level, now()).run()
  const door = await DB.prepare('SELECT * FROM doors WHERE id=?').bind(id).first()
  return c.json({ door, message: 'Door created' }, 201)
})

api.put('/doors/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120) || null
  const location = sanitize(body.location, 200) || null
  const floor = sanitize(body.floor, 40) || null
  const building = sanitize(body.building, 120) || null
  const relay_ip = sanitize(body.relay_ip, 60) || null
  const security_level = ['standard', 'elevated', 'high', 'restricted'].includes(body.security_level) ? body.security_level : null
  const status = ['active', 'inactive', 'maintenance'].includes(body.status) ? body.status : null
  const r = await DB.prepare(`UPDATE doors SET name=COALESCE(?,name), location=COALESCE(?,location), floor=COALESCE(?,floor),
    building=COALESCE(?,building), relay_ip=COALESCE(?,relay_ip), requires_2fa=COALESCE(?,requires_2fa),
    security_level=COALESCE(?,security_level), status=COALESCE(?,status) WHERE id=? AND org_id=?`)
    .bind(name, location, floor, building, relay_ip, body.requires_2fa !== undefined ? (body.requires_2fa ? 1 : 0) : null,
      security_level, status, c.req.param('id'), orgId).run()
  if (!r.meta.changes) return bad(c, 'Door not found', 404)
  const door = await DB.prepare('SELECT * FROM doors WHERE id=?').bind(c.req.param('id')).first()
  return c.json({ door, message: 'Door updated' })
})

api.delete('/doors/:id', adminOnly, async (c) => {
  const { DB } = c.env
  const r = await DB.prepare(`UPDATE doors SET status='inactive' WHERE id=? AND org_id=?`).bind(c.req.param('id'), c.get('orgId')).run()
  if (!r.meta.changes) return bad(c, 'Door not found', 404)
  return c.json({ message: 'Door deactivated' })
})

// ═══════════════════════════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════════════════════════
api.get('/permissions', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const role = c.req.query('role')
  let sql = `SELECT rp.*, d.name as door_name, d.location as door_location, d.security_level
    FROM role_permissions rp JOIN doors d ON rp.door_id=d.id WHERE rp.org_id=? AND d.status!='inactive'`
  const args: any[] = [orgId]
  if (role) { sql += ' AND rp.role=?'; args.push(role) }
  sql += ' ORDER BY rp.role, d.name'
  const { results: rolePerms } = await DB.prepare(sql).bind(...args).all()
  const { results: userPerms } = await DB.prepare(`SELECT up.*, u.name as user_name, u.email as user_email, d.name as door_name
    FROM user_door_permissions up JOIN users u ON u.id=up.user_id JOIN doors d ON d.id=up.door_id
    WHERE up.org_id=? AND u.status='active' ORDER BY u.name, d.name`).bind(orgId).all()
  return c.json({ permissions: rolePerms, user_overrides: userPerms })
})

function validSchedule(b: any) {
  const t = /^([01]\d|2[0-3]):[0-5]\d$/
  const time_start = t.test(b.time_start || '') ? b.time_start : '00:00'
  const time_end = t.test(b.time_end || '') ? b.time_end : '23:59'
  const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const days = String(b.days_allowed || 'mon,tue,wed,thu,fri').split(',').map((d: string) => d.trim().toLowerCase()).filter((d: string) => validDays.includes(d))
  return { time_start, time_end, days_allowed: (days.length ? days : ['mon', 'tue', 'wed', 'thu', 'fri']).join(',') }
}

api.post('/permissions', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const role = sanitize(body.role, 30)
  const door_id = sanitize(body.door_id, 40)
  if (!USER_ROLES.includes(role)) return bad(c, `role must be one of: ${USER_ROLES.join(', ')}`)
  const door = await DB.prepare('SELECT id FROM doors WHERE id=? AND org_id=?').bind(door_id, orgId).first()
  if (!door) return bad(c, 'Door not found', 404)
  const { time_start, time_end, days_allowed } = validSchedule(body)
  const dup = await DB.prepare('SELECT id FROM role_permissions WHERE org_id=? AND role=? AND door_id=?').bind(orgId, role, door_id).first() as any
  const id = dup?.id || 'rp-' + nanoid(10)
  if (dup) {
    await DB.prepare(`UPDATE role_permissions SET time_start=?,time_end=?,days_allowed=?,requires_2fa=? WHERE id=?`)
      .bind(time_start, time_end, days_allowed, body.requires_2fa ? 1 : 0, id).run()
  } else {
    await DB.prepare(`INSERT INTO role_permissions (id,org_id,role,door_id,time_start,time_end,days_allowed,requires_2fa,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, orgId, role, door_id, time_start, time_end, days_allowed, body.requires_2fa ? 1 : 0, now()).run()
  }
  return c.json({ message: dup ? 'Permission updated' : 'Permission created', id }, dup ? 200 : 201)
})

api.delete('/permissions/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const r = await DB.prepare('DELETE FROM role_permissions WHERE id=? AND org_id=?').bind(c.req.param('id'), c.get('orgId')).run()
  if (!r.meta.changes) return bad(c, 'Permission not found', 404)
  return c.json({ message: 'Permission removed' })
})

api.post('/permissions/user', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const user_id = sanitize(body.user_id, 40), door_id = sanitize(body.door_id, 40)
  const access_type = body.access_type === 'deny' ? 'deny' : 'allow'
  const u = await DB.prepare('SELECT id FROM users WHERE id=? AND org_id=?').bind(user_id, orgId).first()
  const d = await DB.prepare('SELECT id FROM doors WHERE id=? AND org_id=?').bind(door_id, orgId).first()
  if (!u || !d) return bad(c, 'User or door not found', 404)
  const { time_start, time_end, days_allowed } = validSchedule(body)
  const expires_at = body.expires_at && !isNaN(Date.parse(body.expires_at)) ? new Date(body.expires_at).toISOString().replace('T', ' ').split('.')[0] : null
  await DB.prepare('DELETE FROM user_door_permissions WHERE org_id=? AND user_id=? AND door_id=?').bind(orgId, user_id, door_id).run()
  const id = 'up-' + nanoid(10)
  await DB.prepare(`INSERT INTO user_door_permissions (id,org_id,user_id,door_id,access_type,time_start,time_end,days_allowed,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, orgId, user_id, door_id, access_type, time_start, time_end, days_allowed, expires_at, now()).run()
  return c.json({ message: 'User override saved', id }, 201)
})

api.delete('/permissions/user/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const r = await DB.prepare('DELETE FROM user_door_permissions WHERE id=? AND org_id=?').bind(c.req.param('id'), c.get('orgId')).run()
  if (!r.meta.changes) return bad(c, 'Override not found', 404)
  return c.json({ message: 'Override removed' })
})

// ═══════════════════════════════════════════════════════════════
// RECOGNITION — the access decision
// ═══════════════════════════════════════════════════════════════
async function logAccess(DB: D1Database, orgId: string, row: {
  user_id?: string | null, user_name?: string | null, door_id: string, door_name: string, method?: string,
  result: 'granted' | 'denied' | 'pending', confidence?: number | null, denial_reason?: string | null,
  liveness_score?: number | null, requires_2fa?: number, two_fa_status?: string | null,
  match_distance?: number | null, second_best_distance?: number | null, ip?: string | null
}) {
  const id = 'log-' + nanoid(12)
  await DB.prepare(`INSERT INTO access_logs (id,org_id,user_id,user_name,door_id,door_name,timestamp,method,result,confidence,denial_reason,
    liveness_score,requires_2fa,two_fa_status,match_distance,second_best_distance,ip_address,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, orgId, row.user_id ?? null, row.user_name ?? null, row.door_id, row.door_name, now(), row.method || 'face', row.result,
      row.confidence ?? null, row.denial_reason ?? null, row.liveness_score ?? null, row.requires_2fa ?? 0, row.two_fa_status ?? null,
      row.match_distance ?? null, row.second_best_distance ?? null, row.ip ?? null, now()).run()
  return id
}

/** Map euclidean distance → confidence 0..1 for display (1.0 at d=0, 0 at d>=1.0) */
function distanceToConfidence(d: number): number { return Math.max(0, Math.min(1, 1 - d)) }

api.post('/recognize', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const ip = c.req.header('CF-Connecting-IP') || null
  const body = await c.req.json().catch(() => ({}))
  const door_id = sanitize(body.door_id, 40)
  const descriptor = body.descriptor
  const liveness = body.liveness_score != null ? Math.min(1, Math.max(0, Number(body.liveness_score) || 0)) : null

  if (!door_id) return bad(c, 'door_id is required')
  if (!isValidDescriptor(descriptor, DESCRIPTOR_DIMS)) return bad(c, `A ${DESCRIPTOR_DIMS}-dim face descriptor is required`)

  const door = await DB.prepare(`SELECT * FROM doors WHERE id=? AND org_id=?`).bind(door_id, orgId).first() as any
  if (!door) return bad(c, 'Door not found', 404)
  if (door.status !== 'active') {
    await logAccess(DB, orgId, { door_id, door_name: door.name, result: 'denied', denial_reason: 'door_inactive', ip })
    return c.json({ result: 'denied', reason: 'door_inactive', message: 'This door is not active' })
  }

  // Rate limit: 20 attempts / minute / door
  const rl = await DB.prepare(`SELECT COUNT(*) as n FROM access_logs WHERE org_id=? AND door_id=? AND timestamp > datetime('now','-1 minute')`).bind(orgId, door_id).first() as any
  if ((rl?.n || 0) >= 20) return c.json({ result: 'denied', reason: 'rate_limited', message: 'Too many attempts at this door. Wait 60 seconds.' }, 429)

  const settings = await getOrgSettings(DB, orgId)
  const T_HIGH = parseFloat(settings.face_match_threshold_high || '0.45')
  const T_MED = parseFloat(settings.face_match_threshold_medium || '0.60')
  const MARGIN = parseFloat(settings.face_match_margin || '0.05')
  const livenessRequired = settings.liveness_enabled !== 'false'

  if (livenessRequired && liveness !== null && liveness < 0.5) {
    await logAccess(DB, orgId, { door_id, door_name: door.name, result: 'denied', denial_reason: 'liveness_failed', liveness_score: liveness, ip })
    return c.json({ result: 'denied', reason: 'liveness_failed', message: 'Liveness check failed' })
  }

  // 1:N match against enrolled users in THIS org
  const { results: enrolled } = await DB.prepare(`SELECT id,name,role,face_embedding FROM users WHERE org_id=? AND face_registered=1 AND status='active'`).bind(orgId).all() as any
  if (enrolled.length === 0) {
    await logAccess(DB, orgId, { user_name: 'Unknown', door_id, door_name: door.name, result: 'denied', denial_reason: 'no_enrolled_users', liveness_score: liveness, ip })
    return c.json({ result: 'denied', reason: 'no_enrolled_users', message: 'No users have enrolled faces yet', confidence: 0 })
  }

  let best: any = null, bestD = Infinity, secondD = Infinity
  for (const u of enrolled) {
    let stored: number[]
    try { stored = JSON.parse(u.face_embedding) } catch { continue }
    if (!isValidDescriptor(stored, DESCRIPTOR_DIMS)) continue
    const d = euclidean(descriptor, stored)
    if (d < bestD) { secondD = bestD; bestD = d; best = u }
    else if (d < secondD) secondD = d
  }

  const confidence = distanceToConfidence(bestD)
  const ambiguous = isFinite(secondD) && (secondD - bestD) < MARGIN

  // No match / too far / ambiguous between two people
  if (!best || bestD > T_MED || (ambiguous && bestD > T_HIGH)) {
    await logAccess(DB, orgId, { user_name: 'Unknown', door_id, door_name: door.name, result: 'denied',
      denial_reason: ambiguous ? 'ambiguous_match' : 'no_match', confidence, liveness_score: liveness, match_distance: isFinite(bestD) ? bestD : null,
      second_best_distance: isFinite(secondD) ? secondD : null, ip })
    return c.json({ result: 'denied', reason: ambiguous ? 'ambiguous_match' : 'no_match', confidence, distance: isFinite(bestD) ? bestD : null })
  }

  // Permission check: user override first, then role permission
  const override = await DB.prepare(`SELECT * FROM user_door_permissions WHERE org_id=? AND user_id=? AND door_id=?
    AND (expires_at IS NULL OR expires_at > datetime('now'))`).bind(orgId, best.id, door_id).first() as any
  const rolePerm = await DB.prepare(`SELECT * FROM role_permissions WHERE org_id=? AND role=? AND door_id=?`).bind(orgId, best.role, door_id).first() as any
  const effective = override || rolePerm
  const allowed = override ? override.access_type === 'allow' : !!rolePerm

  const userOut = { id: best.id, name: best.name, role: best.role }
  if (!allowed) {
    await logAccess(DB, orgId, { user_id: best.id, user_name: best.name, door_id, door_name: door.name, result: 'denied', denial_reason: 'no_permission',
      confidence, liveness_score: liveness, match_distance: bestD, second_best_distance: isFinite(secondD) ? secondD : null, ip })
    return c.json({ result: 'denied', reason: 'no_permission', user: userOut, confidence })
  }
  if (!checkTimeAllowed(effective.time_start, effective.time_end) || !checkDayAllowed(effective.days_allowed)) {
    await logAccess(DB, orgId, { user_id: best.id, user_name: best.name, door_id, door_name: door.name, result: 'denied', denial_reason: 'outside_hours',
      confidence, liveness_score: liveness, match_distance: bestD, second_best_distance: isFinite(secondD) ? secondD : null, ip })
    return c.json({ result: 'denied', reason: 'outside_hours', user: userOut, confidence, schedule: { time_start: effective.time_start, time_end: effective.time_end, days_allowed: effective.days_allowed } })
  }

  // Step-up: door requires 2FA, permission requires 2FA, or match is only medium-confidence
  const needs2FA = !!door.requires_2fa || !!effective.requires_2fa || bestD > T_HIGH
  if (needs2FA) {
    const verId = 'ver-' + nanoid(12)
    const ttl = (parseInt(settings.two_fa_timeout_seconds || '120') || 120) * 1000
    await DB.prepare(`INSERT INTO pending_verifications (id,org_id,user_id,door_id,door_name,confidence,created_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,'pending')`)
      .bind(verId, orgId, best.id, door_id, door.name, confidence, now(), isoPlus(ttl)).run()
    await logAccess(DB, orgId, { user_id: best.id, user_name: best.name, door_id, door_name: door.name, method: 'face+2fa', result: 'pending', confidence,
      liveness_score: liveness, requires_2fa: 1, two_fa_status: 'pending', match_distance: bestD, second_best_distance: isFinite(secondD) ? secondD : null, ip })
    return c.json({ result: 'pending_2fa', verification_id: verId, user: userOut, door: { id: door.id, name: door.name }, confidence,
      reason: bestD > T_HIGH ? 'medium_confidence' : 'policy', expires_in_seconds: ttl / 1000 })
  }

  await logAccess(DB, orgId, { user_id: best.id, user_name: best.name, door_id, door_name: door.name, result: 'granted', confidence,
    liveness_score: liveness, match_distance: bestD, second_best_distance: isFinite(secondD) ? secondD : null, ip })
  return c.json({ result: 'granted', user: userOut, door: { id: door.id, name: door.name }, confidence, method: 'face' })
})

// ── 2FA ─────────────────────────────────────────────────────────
api.get('/verify/pending', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`SELECT v.*, u.name as user_name FROM pending_verifications v LEFT JOIN users u ON u.id=v.user_id
    WHERE v.org_id=? AND v.status='pending' AND v.expires_at > datetime('now') ORDER BY v.created_at DESC`).bind(c.get('orgId')).all()
  return c.json({ pending: results })
})

api.get('/verify/:id', async (c) => {
  const { DB } = c.env
  const ver = await DB.prepare('SELECT v.*, u.name as user_name FROM pending_verifications v LEFT JOIN users u ON u.id=v.user_id WHERE v.id=? AND v.org_id=?')
    .bind(c.req.param('id'), c.get('orgId')).first() as any
  if (!ver) return bad(c, 'Verification not found', 404)
  const expired = new Date(ver.expires_at.replace(' ', 'T') + 'Z') < new Date()
  return c.json({ ...ver, expired })
})

api.post('/verify/:id/respond', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const sess = c.get('sess')
  const body = await c.req.json().catch(() => ({}))
  const action = body.action
  if (!['approve', 'deny'].includes(action)) return bad(c, 'action must be approve or deny')
  const ver = await DB.prepare(`SELECT v.*, u.name as user_name FROM pending_verifications v LEFT JOIN users u ON u.id=v.user_id WHERE v.id=? AND v.org_id=? AND v.status='pending'`)
    .bind(c.req.param('id'), orgId).first() as any
  if (!ver) return bad(c, 'Verification not found or already completed', 404)
  if (new Date(ver.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    await DB.prepare(`UPDATE pending_verifications SET status='expired' WHERE id=?`).bind(ver.id).run()
    return bad(c, 'Verification expired', 410)
  }
  const status = action === 'approve' ? 'approved' : 'denied'
  await DB.prepare('UPDATE pending_verifications SET status=?, responded_at=? WHERE id=?').bind(status, now(), ver.id).run()
  await logAccess(DB, orgId, { user_id: ver.user_id, user_name: ver.user_name, door_id: ver.door_id, door_name: ver.door_name, method: 'face+2fa',
    result: action === 'approve' ? 'granted' : 'denied', confidence: ver.confidence, requires_2fa: 1, two_fa_status: status,
    denial_reason: action === 'deny' ? 'operator_denied' : null })
  await logAuthEvent(DB, { account_id: sess.account.id, account_type: 'business', event_type: `2fa_${status}`, metadata: { verification_id: ver.id, user_id: ver.user_id } })
  return c.json({ result: action === 'approve' ? 'granted' : 'denied', message: action === 'approve' ? 'Access approved by operator' : 'Access denied by operator' })
})

// ═══════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════
api.get('/logs', async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const door_id = c.req.query('door_id'), user_id = c.req.query('user_id'), result = c.req.query('result')
  const from = c.req.query('from'), to = c.req.query('to')
  const limit = parseIntParam(c.req.query('limit'), 50, 500), offset = parseIntParam(c.req.query('offset'), 0, 100000)
  let where = 'WHERE org_id=?'
  const args: any[] = [orgId]
  if (door_id && isValidId(door_id)) { where += ' AND door_id=?'; args.push(door_id) }
  if (user_id && isValidId(user_id)) { where += ' AND user_id=?'; args.push(user_id) }
  if (result && ['granted', 'denied', 'pending'].includes(result)) { where += ' AND result=?'; args.push(result) }
  if (from && !isNaN(Date.parse(from))) { where += ' AND timestamp >= ?'; args.push(from) }
  if (to && !isNaN(Date.parse(to))) { where += ' AND timestamp <= ?'; args.push(to) }
  const { results } = await DB.prepare(`SELECT * FROM access_logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all()
  const total = await DB.prepare(`SELECT COUNT(*) as n FROM access_logs ${where}`).bind(...args).first() as any
  return c.json({ logs: results, total: total?.n || 0, limit, offset })
})

api.get('/logs/export', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`SELECT timestamp,result,user_name,door_name,method,confidence,denial_reason,liveness_score,two_fa_status
    FROM access_logs WHERE org_id=? ORDER BY timestamp DESC LIMIT 10000`).bind(c.get('orgId')).all()
  const esc = (v: any) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`
  const header = 'timestamp,result,user,door,method,confidence,denial_reason,liveness,two_fa_status'
  const rows = (results as any[]).map(r => [r.timestamp, r.result, r.user_name, r.door_name, r.method, r.confidence != null ? (r.confidence * 100).toFixed(1) + '%' : '', r.denial_reason, r.liveness_score, r.two_fa_status].map(esc).join(','))
  return new Response([header, ...rows].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="access-logs-${now().slice(0, 10)}.csv"` } })
})

// ═══════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════
api.get('/analytics/summary', async (c) => {
  const { DB } = c.env
  const o = c.get('orgId')
  const [summary, byDoor, hourly, recentDenials, topUsers, daily] = await Promise.all([
    DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE org_id=? AND status='active') as total_users,
      (SELECT COUNT(*) FROM users WHERE org_id=? AND status='active' AND face_registered=1) as registered_faces,
      (SELECT COUNT(*) FROM doors WHERE org_id=? AND status='active') as total_doors,
      (SELECT COUNT(*) FROM access_logs WHERE org_id=? AND result='granted' AND timestamp >= date('now')) as today_granted,
      (SELECT COUNT(*) FROM access_logs WHERE org_id=? AND result='denied' AND timestamp >= date('now')) as today_denied,
      (SELECT COUNT(*) FROM access_logs WHERE org_id=? AND timestamp >= datetime('now','-24 hours')) as access_24h,
      (SELECT COUNT(*) FROM pending_verifications WHERE org_id=? AND status='pending' AND expires_at > datetime('now')) as pending_2fa`)
      .bind(o, o, o, o, o, o, o).first(),
    DB.prepare(`SELECT door_id, door_name, COUNT(*) as total, SUM(result='granted') as granted, SUM(result='denied') as denied
      FROM access_logs WHERE org_id=? AND timestamp >= datetime('now','-24 hours') GROUP BY door_id, door_name ORDER BY total DESC LIMIT 20`).bind(o).all(),
    DB.prepare(`SELECT strftime('%H', timestamp) as hour, COUNT(*) as total, SUM(result='granted') as granted
      FROM access_logs WHERE org_id=? AND timestamp >= datetime('now','-24 hours') GROUP BY hour ORDER BY hour`).bind(o).all(),
    DB.prepare(`SELECT * FROM access_logs WHERE org_id=? AND result='denied' ORDER BY timestamp DESC LIMIT 5`).bind(o).all(),
    DB.prepare(`SELECT user_id, user_name, COUNT(*) as accesses FROM access_logs WHERE org_id=? AND result='granted' AND timestamp >= date('now') AND user_id IS NOT NULL
      GROUP BY user_id, user_name ORDER BY accesses DESC LIMIT 5`).bind(o).all(),
    DB.prepare(`SELECT date(timestamp) as day, COUNT(*) as total, SUM(result='granted') as granted, SUM(result='denied') as denied
      FROM access_logs WHERE org_id=? AND timestamp >= date('now','-13 days') GROUP BY day ORDER BY day`).bind(o).all(),
  ])
  return c.json({ summary, by_door: byDoor.results, hourly: hourly.results, recent_denials: recentDenials.results, top_users: topUsers.results, daily: daily.results })
})

api.get('/analytics/attendance', async (c) => {
  const { DB } = c.env
  const days = parseIntParam(c.req.query('days'), 30, 365)
  const { results } = await DB.prepare(`
    SELECT u.id, u.name, u.role, u.department, u.face_registered,
      COUNT(DISTINCT date(al.timestamp)) as days_present,
      MAX(al.timestamp) as last_access,
      COUNT(al.id) as total_accesses
    FROM users u LEFT JOIN access_logs al ON u.id=al.user_id AND al.result='granted' AND al.timestamp >= date('now', ?)
    WHERE u.org_id=? AND u.status='active'
    GROUP BY u.id ORDER BY days_present DESC, u.name ASC`).bind(`-${days} days`, c.get('orgId')).all()
  return c.json({ attendance: results, window_days: days })
})

// ═══════════════════════════════════════════════════════════════
// CAMERAS
// ═══════════════════════════════════════════════════════════════
api.get('/cameras', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`SELECT c.*, d.name as door_name FROM cameras c LEFT JOIN doors d ON c.door_id=d.id WHERE c.org_id=? AND c.status!='deleted' ORDER BY c.name`).bind(c.get('orgId')).all()
  return c.json({ cameras: results })
})

api.post('/cameras', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120), location = sanitize(body.location, 200)
  const stream_url = typeof body.stream_url === 'string' ? body.stream_url.trim().slice(0, 500) : null
  const camera_type = ['ip', 'rtsp', 'usb', 'browser', 'onvif'].includes(body.camera_type) ? body.camera_type : 'browser'
  const door_id = sanitize(body.door_id, 40) || null
  if (!name || !location) return bad(c, 'name and location are required')
  if (stream_url && !/^(rtsp|rtsps|http|https):\/\/.+/i.test(stream_url)) return bad(c, 'stream_url must be rtsp://, rtsps://, http:// or https://')
  if (door_id) { const d = await DB.prepare('SELECT id FROM doors WHERE id=? AND org_id=?').bind(door_id, orgId).first(); if (!d) return bad(c, 'Door not found', 404) }
  const id = 'cam-' + nanoid(10)
  await DB.prepare(`INSERT INTO cameras (id,org_id,name,location,stream_url,camera_type,door_id,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?)`)
    .bind(id, orgId, name, location, stream_url, camera_type, door_id, now()).run()
  const cam = await DB.prepare('SELECT * FROM cameras WHERE id=?').bind(id).first()
  return c.json({ camera: cam, message: 'Camera added' }, 201)
})

api.put('/cameras/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const name = sanitize(body.name, 120) || null, location = sanitize(body.location, 200) || null
  const stream_url = typeof body.stream_url === 'string' ? body.stream_url.trim().slice(0, 500) : null
  const door_id = body.door_id !== undefined ? (sanitize(body.door_id, 40) || null) : undefined
  const status = ['active', 'inactive'].includes(body.status) ? body.status : null
  const r = await DB.prepare(`UPDATE cameras SET name=COALESCE(?,name), location=COALESCE(?,location), stream_url=COALESCE(?,stream_url),
    door_id=CASE WHEN ? THEN ? ELSE door_id END, status=COALESCE(?,status) WHERE id=? AND org_id=?`)
    .bind(name, location, stream_url, door_id !== undefined ? 1 : 0, door_id ?? null, status, c.req.param('id'), orgId).run()
  if (!r.meta.changes) return bad(c, 'Camera not found', 404)
  return c.json({ message: 'Camera updated' })
})

api.delete('/cameras/:id', operatorUp, async (c) => {
  const { DB } = c.env
  const r = await DB.prepare(`UPDATE cameras SET status='deleted' WHERE id=? AND org_id=?`).bind(c.req.param('id'), c.get('orgId')).run()
  if (!r.meta.changes) return bad(c, 'Camera not found', 404)
  return c.json({ message: 'Camera removed' })
})

api.put('/cameras/:id/heartbeat', async (c) => {
  const { DB } = c.env
  await DB.prepare('UPDATE cameras SET last_heartbeat=? WHERE id=? AND org_id=?').bind(now(), c.req.param('id'), c.get('orgId')).run()
  return c.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
const SETTING_KEYS: Record<string, (v: string) => boolean> = {
  company_name: v => v.length > 0 && v.length <= 120,
  face_match_threshold_high: v => !isNaN(+v) && +v >= 0.3 && +v <= 0.6,
  face_match_threshold_medium: v => !isNaN(+v) && +v >= 0.4 && +v <= 0.7,
  face_match_margin: v => !isNaN(+v) && +v >= 0 && +v <= 0.2,
  liveness_enabled: v => v === 'true' || v === 'false',
  two_fa_timeout_seconds: v => !isNaN(+v) && +v >= 30 && +v <= 600,
  retention_days_logs: v => !isNaN(+v) && +v >= 30 && +v <= 3650,
  retention_days_biometric: v => !isNaN(+v) && +v >= 30 && +v <= 1095,
  notification_email: v => v === '' || isEmail(v),
  timezone: v => v.length <= 60,
}

api.get('/settings', async (c) => c.json({ settings: await getOrgSettings(c.env.DB, c.get('orgId')) }))

api.put('/settings', adminOnly, async (c) => {
  const { DB } = c.env
  const orgId = c.get('orgId')
  const body = await c.req.json().catch(() => ({}))
  const errors: string[] = []
  const stmts: D1PreparedStatement[] = []
  for (const [k, raw] of Object.entries(body)) {
    const validate = SETTING_KEYS[k]
    if (!validate) { errors.push(`Unknown setting: ${k}`); continue }
    const v = sanitize(raw, 200)
    if (!validate(v)) { errors.push(`Invalid value for ${k}`); continue }
    stmts.push(DB.prepare('INSERT OR REPLACE INTO settings (org_id,key,value,updated_at) VALUES (?,?,?,?)').bind(orgId, k, v, now()))
  }
  if (errors.length) return bad(c, errors.join('; '))
  if (stmts.length) await DB.batch(stmts)
  if (body.company_name) await DB.prepare('UPDATE organizations SET name=?, updated_at=? WHERE id=?').bind(sanitize(body.company_name, 120), now(), orgId).run()
  return c.json({ message: 'Settings updated', settings: await getOrgSettings(DB, orgId) })
})

// ── Auth audit for this org ─────────────────────────────────────
api.get('/audit', adminOnly, async (c) => {
  const { DB } = c.env
  const limit = parseIntParam(c.req.query('limit'), 50, 200)
  const { results } = await DB.prepare(`SELECT a.* FROM auth_audit_log a JOIN business_accounts b ON b.id=a.account_id
    WHERE b.org_id=? ORDER BY a.created_at DESC LIMIT ?`).bind(c.get('orgId'), limit).all()
  return c.json({ events: results })
})

export default api
