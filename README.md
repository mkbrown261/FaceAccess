# FaceAccess — Facial Recognition Access Control System

## Project Overview
A complete facial recognition-based access control system replacing traditional keycards. Enterprise-grade security with role-based access, real-time monitoring, and mobile 2FA companion app.

**Live Demo:** [https://3000-i3ubg32zacalv1wqttedz-cbeee0f9.sandbox.novita.ai](https://3000-i3ubg32zacalv1wqttedz-cbeee0f9.sandbox.novita.ai)

**Mobile App:** [https://3000-i3ubg32zacalv1wqttedz-cbeee0f9.sandbox.novita.ai/mobile](https://3000-i3ubg32zacalv1wqttedz-cbeee0f9.sandbox.novita.ai/mobile)

---

## Features Implemented

### ✅ Core System
- **Real-time face recognition** — cosine similarity matching against stored AES-256 encrypted embeddings
- **Confidence scoring** — high (auto-grant), medium (triggers 2FA), low (denied)
- **Liveness detection** — anti-spoofing score validation
- **Webcam capture** — live camera feed with face scanning overlay
- **Image upload** — register faces via file upload

### ✅ User Management (10-second onboarding)
- Add user: enter name + email + role → done
- Instant face registration modal auto-opens after user creation
- Roles: `employee`, `manager`, `admin`, `visitor`
- Full CRUD: edit, suspend, delete users
- Biometric erasure (GDPR right to erasure)

### ✅ Access Control
- **8 pre-configured access zones** (Main Entrance, Server Room, Executive Suite, Research Lab, etc.)
- **Role-based permissions** with time windows and day restrictions
- **Per-user door overrides**
- **Security levels**: low / standard / high / critical
- **Two-Factor Authentication** per door or per role

### ✅ Mobile Companion App (`/mobile`)
- Access request notifications with countdown timer
- **Approve / Deny** with single tap
- **Proximity verification** (Bluetooth BLE + WiFi simulation)
- Prevents remote approvals — must be physically near the door
- Access history, profile management
- Biometric data deletion control

### ✅ Admin Dashboard
- **Live Monitor** — real-time event feed, auto-refresh every 5s
- **Face ID Test Console** — test recognition against any door
- **Analytics** — hourly activity charts, door traffic, access rate pie chart
- **Attendance Tracking** — days present, last access, total events
- **Camera Management** — IP/USB/RTSP cameras
- **System Settings** — thresholds, liveness toggle, lockout rules

### ✅ Security & Privacy
- Face embeddings stored (not raw images) — AES-256 encryption
- Rate limiting hooks (configurable max attempts + lockout)
- Device authentication for mobile app
- GDPR-compliant data deletion
- Full audit log of every access attempt
- TLS 1.3 in transit (Cloudflare edge)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Camera / Browser                    │
│  getUserMedia() → Frame capture → Embedding gen     │
└──────────────────────┬───────────────────────────────┘
                       │ POST /api/recognize
┌──────────────────────▼───────────────────────────────┐
│              Hono Edge Worker (Cloudflare)            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Face Match  │  │ RBAC Check   │  │ 2FA Engine │  │
│  │ (cosine sim)│  │ (role+time)  │  │ (pending   │  │
│  └─────────────┘  └──────────────┘  │  verif.)   │  │
│                                     └────────────┘  │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│                Cloudflare D1 (SQLite)                 │
│  users · doors · role_permissions · access_logs      │
│  pending_verifications · cameras · settings          │
└──────────────────────────────────────────────────────┘
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List users (filter: role, status) |
| `POST` | `/api/users` | Create user |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user (biometric erasure) |
| `POST` | `/api/users/:id/face` | Register face embedding |
| `DELETE` | `/api/users/:id/face` | Erase biometric data |
| `POST` | `/api/recognize` | **Core** — Face recognition + access decision |
| `GET` | `/api/verify/:id` | Check 2FA verification status |
| `POST` | `/api/verify/:id/respond` | Approve/deny via mobile |
| `GET` | `/api/doors` | List doors |
| `POST` | `/api/doors` | Add door |
| `GET` | `/api/permissions` | List role permissions |
| `POST` | `/api/permissions` | Add permission rule |
| `GET` | `/api/logs` | Access log with filters |
| `GET` | `/api/analytics/summary` | Dashboard stats + charts |
| `GET` | `/api/analytics/attendance` | Employee attendance |
| `GET` | `/api/mobile/pending/:user_id` | Mobile: pending approvals |
| `POST` | `/api/mobile/register` | Register mobile device |
| `GET` | `/api/cameras` | Camera list |
| `GET/PUT` | `/api/settings` | System configuration |

---

## Data Models

### User
```json
{ "id": "usr-xxx", "name": "John Smith", "email": "...", "role": "employee|manager|admin|visitor",
  "face_embedding": "[128-dim AES-encrypted vector]", "face_registered": 1,
  "mobile_device_id": "...", "status": "active|inactive|suspended" }
```

### Access Decision Flow
```
Camera → POST /api/recognize { door_id, embedding, liveness_score }
  → liveness < 0.5? → denied (liveness_failed)
  → confidence < 65%? → denied (no_match)
  → no role permission? → denied (no_permission)
  → outside hours? → denied (outside_hours)
  → confidence < 85% OR door requires 2FA?
      → pending_2fa → push to mobile → approve/deny
  → else → granted
```

---

## Tech Stack
- **Runtime**: Cloudflare Pages + Workers (edge)
- **Framework**: Hono v4
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Tailwind CSS (CDN) + Chart.js + Axios
- **AI/ML**: FaceNet-compatible embedding (cosine similarity matching)
- **Build**: Vite + @hono/vite-build

---

## Local Development

```bash
npm install
npm run db:migrate:local   # Create local D1 tables
npm run db:seed            # Seed demo data
npm run build              # Build worker
pm2 start ecosystem.config.cjs  # Start dev server

# Reset database
npm run db:reset
```

## Production Deployment (Cloudflare Pages)

```bash
npx wrangler d1 create faceaccess-production
# Add database_id to wrangler.jsonc
npx wrangler d1 migrations apply faceaccess-production
npm run build
npx wrangler pages deploy dist --project-name faceaccess
```

---

## Demo Users
| Name | Role | Email |
|------|------|-------|
| Sarah Chen | Admin | sarah.chen@acme.com |
| James Wilson | Manager | james.wilson@acme.com |
| Michael Park | Employee | michael.park@acme.com |
| Alex Martinez | Visitor | alex.martinez@visitor.com |

---

## Deployment Status
- **Platform**: Cloudflare Pages / Workers
- **Status**: 🔄 Development (sandbox)
- **Last Updated**: 2026-03-12
