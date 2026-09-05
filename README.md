# FaceAccess Business — Facial Recognition Access Control

Multi-tenant access-control console for businesses. Each customer gets an isolated
**organization** with its own people, doors, permissions, access logs, team accounts and
recognition settings. Face matching runs on real 128-dimensional face descriptors — no
demo data, no fake fallbacks.

- **Stack:** Cloudflare Pages + Hono (TypeScript) + D1 (SQLite) · vanilla JS frontend
- **Face engine (browser):** [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) 1.7.15, self-hosted.
  TinyFaceDetector → 68-point landmarks → dlib ResNet-34 face-recognition net (128-d descriptor).
  Liveness = landmark-based head-pose challenge (5 prompts, ≥ 2 of 4 movements required).
- **Matching (server):** Euclidean distance against every enrolled descriptor in the org.
  `≤ high` → granted · `high < d ≤ medium` → pending approval · `> medium` → denied.
  A second-best candidate within `margin` downgrades the result to pending approval.

> Not in scope of this release: the consumer "Home" surfaces (`/home/*`) and the Dev Lab
> (`/dev-lab`). They remain in the repo but are not part of the business product and are
> not covered by the test suites.

---

## What's in the box

| Area | Details |
|---|---|
| **Tenancy** | `organizations` table; `org_id` on every business table; every query is org-scoped; cross-org access returns 404 |
| **Team accounts** | Roles `admin` / `operator` / `viewer`. First registrant is admin. Invite by link (7-day token); admins can change roles, suspend members, revoke invites |
| **People** | Employees, managers, admins, contractors, visitors. Camera enrollment captures multiple descriptors per person; duplicate-face detection across the org; one-click biometric erasure |
| **Doors & permissions** | Role → door schedules (time window, weekdays, 2FA flag) plus per-person overrides with expiry. Deny-by-default |
| **Recognition** | `POST /api/business/recognize` with a descriptor → granted / denied / pending_2fa. Liveness score enforced when enabled |
| **Approvals** | Medium-confidence matches queue for an operator decision; auto-expire after the configured timeout |
| **Logs & analytics** | Full access log with CSV export, summary/hourly/daily analytics, attendance, admin-only audit trail |
| **Settings (per org)** | Distance thresholds, margin, liveness on/off, approval timeout, retention windows, timezone, notification email |
| **Auth** | PBKDF2-SHA256 (100k iters), bearer session tokens, suspended orgs/members rejected at login and per request |

---

## Quick start (local)

```bash
npm install
npm run build                 # vite → dist/_worker.js
npm run db:reset              # wipe local D1 and apply migrations 0001–0008 (creates an EMPTY database)
npm start                     # pm2: wrangler pages dev dist --port 3000
open http://localhost:3000    # click "Create your organization"
```

There are no seed accounts. The first thing you do is register an organization; that account
becomes its admin.

### Tests

```bash
npm run test:e2e                 # 98 API checks: auth, roles, enrollment, recognition, approvals, isolation
npm run test:ui                  # Playwright: real UI registration, model loading, every page, invite flow
npm run test:camera              # Playwright + virtual webcam: enrol → liveness → recognise → imposter (see below)
npm run test:faces               # Real photos: descriptor distances vs. thresholds + live /recognize probes
```

Set `BASE=https://faceaccess.pages.dev` (or any deployment) to run every suite against production instead of `localhost:3000`.

`scripts/e2e.sh` needs `curl` and `python3`. The Playwright scripts need `pip install playwright && playwright install chromium`.

**Real-face validation (`scripts/face_matrix.py`).** Runs the exact vendored face-api build + models the app
serves, against 6 real group photos (22 faces, 231 pairs, from the face-api demo set):

| Measurement | Result |
|---|---|
| Pairs of guaranteed-different people (same photo) | 31 |
| Closest different-people distance | 0.468 |
| Different people that would be **auto-granted** (≤ 0.45) | **0** |
| Different people that would fall in the approval band (0.45 – 0.60) | 2 |
| Same person across photos (heavy makeup / face paint) | 0.564, 0.607 |

This is why the default medium threshold is 0.60 (face-api's own same-person cutoff): at 0.55 both
same-person pairs were rejected outright. Strangers never cross 0.45, so auto-grant stays strict.

`scripts/real_face_e2e.py` then enrols 6 of those real descriptors into a fresh org and pushes the other 16
through the live `POST /recognize` endpoint: **0 strangers granted**, 11 rejected, 3 routed to admin approval,
and the 2 same-person probes were refused as `ambiguous_match` because a stranger sat within the 0.05 margin
of the true match (the system fails closed, as intended). Single-photo enrolment is the worst case — the app's
camera flow captures multiple samples, which tightens genuine distances considerably.
See "Known limitations" — the photos are harder than live multi-sample enrollment, and this is not a NIST-style FRVT.

**Camera flow (`scripts/camera_flow.py`).** The suites above bypass the camera; this one does not. It runs the
real enrolment modal and the Face ID Test Console in headless Chromium with `getUserMedia` replaced by a
canvas stream showing a real face, and behaves like a cooperative person: it reads the on-screen instruction
("turn LEFT", "look UP", …) and switches the displayed head pose to match. Pose frames are synthesised from the
sample photos by `scripts/make_poses.py` (run automatically when missing). It asserts: 5 samples enrolled and
persisted, liveness passed, the enrolled person is **granted** (distance ≈ 3e-06), a second person at the same
door is **not granted** (lands in the 0.45–0.60 approval band as `pending_2fa`), and zero JS/console errors.
Result against https://faceaccess.pages.dev: PASS.

The engine picks the TensorFlow.js backend at runtime (WebGL, falling back to CPU when WebGL is unavailable —
the `wasm` backend is not shipped and is removed from the registry), and scales detector input size and
liveness time windows to the measured inference time, so the Face ID flow completes on slow or GPU-less devices too.

---

## Deploy to Cloudflare

**Live production:** https://faceaccess.pages.dev
(Cloudflare Pages project `faceaccess` + D1 `faceaccess-production`; migrations 0001–0008 applied; database empty — no seed data).
All four test suites were run against this URL after deploy (98/98 API, UI smoke PASS, camera flow PASS,
real-face 0 false accepts) and the throwaway test organisations were then deleted from the production database.

```bash
export CLOUDFLARE_API_TOKEN=...                     # Pages:Edit + D1:Edit on the account
npm run db:migrate:prod                             # apply any new migrations to faceaccess-production
npm run build && npx wrangler pages deploy dist --project-name faceaccess --branch main
```

To stand up a separate instance on your own account:

```bash
npx wrangler d1 create faceaccess-production        # once; put the id in wrangler.jsonc
npm run db:migrate:prod                             # apply migrations to the remote D1
npm run deploy                                      # build + wrangler pages deploy
```

Static assets under `public/static/` (including the 13 MB of face-api model weights in
`public/static/models/` and the vendored `face-api.js`) are published with the Pages build.

---

## API surface (business)

All routes below require `Authorization: Bearer <token>` and resolve the caller's org from the session.

```
POST /api/auth/business/register   {first_name,last_name,email,password,consent_terms:true,
                                    org_name,org_size?,industry?  |  invite_token}
POST /api/auth/business/login      {email,password}
GET  /api/auth/business/me
POST /api/auth/business/logout
PUT  /api/auth/business/password
GET  /api/auth/business/invite/:token          (public preview)

GET  /api/business/org · PUT /org (admin)
GET  /api/business/team · POST /team/invite (admin) · DELETE /team/invite/:id (admin) · PUT /team/:id (admin)
GET/POST /api/business/users · GET/PUT/DELETE /users/:id (operator+)
POST /api/business/users/:id/face   {descriptor | descriptors[], quality, liveness_score}   → 409 DUPLICATE_FACE
DELETE /api/business/users/:id/face
GET/POST /api/business/doors · PUT/DELETE /doors/:id
GET  /api/business/permissions · POST /permissions · DELETE /permissions/:id
POST /api/business/permissions/user · DELETE /permissions/user/:id
POST /api/business/recognize        {door_id, descriptor[128], liveness_score, image_quality?, device_info?}
GET  /api/business/verify/pending · GET /verify/:id · POST /verify/:id/respond {action:approve|deny} (operator+)
GET  /api/business/logs?limit&offset&result&door_id&user_id&from&to · GET /logs/export (CSV)
GET  /api/business/analytics/summary · GET /analytics/attendance
GET/POST /api/business/cameras · PUT/DELETE /cameras/:id
GET  /api/business/settings · PUT /settings (admin)
GET  /api/business/audit (admin)
```

Errors are JSON `{ error, code? }`. `401 AUTH_REQUIRED`, `403` for role violations, `404` for
anything outside the caller's org.

### Settings keys and valid ranges

| Key | Range / values | Default |
|---|---|---|
| `face_match_threshold_high` | 0.30 – 0.60 | 0.45 |
| `face_match_threshold_medium` | 0.40 – 0.70 | 0.60 |
| `face_match_margin` | 0 – 0.20 | 0.05 |
| `liveness_enabled` | `true` / `false` | `true` |
| `two_fa_timeout_seconds` | 30 – 600 | 120 |
| `retention_days_logs` | 30 – 3650 | 365 |
| `retention_days_biometric` | 30 – 1095 | 365 |
| `company_name`, `timezone`, `notification_email` | strings | — |

Decision logic in `/api/business/recognize`: distance ≤ high **and** runner-up gap ≥ margin → granted;
high < distance ≤ medium → `pending_2fa` (admin approval); otherwise `no_match` / `ambiguous`.

---

## Data model (business)

```
organizations ──< business_accounts (org role: admin/operator/viewer)
             ──< org_invitations
             ──< users (face_embedding = mean of enrolled 128-d descriptors, face_sample_count)
             ──< doors ──< role_permissions / user_door_permissions
             ──< access_logs, pending_verifications, cameras, settings(org_id,key), audit_log
```

Migrations live in `migrations/`; `0008_multitenant_orgs.sql` introduces organizations and
purges any pre-existing single-tenant data.

---

## Repository layout

```
src/index.tsx                    Hono app, HTML shells, home/dev-lab routes (legacy surfaces)
src/routes/business-auth.ts      registration, login, invites, sessions
src/routes/business-api.ts       all org-scoped business endpoints
src/lib/shared.ts                hashing, sessions, validation helpers
public/static/app.js             business console UI
public/static/facecamera-engine.js   camera + face-api pipeline, liveness, descriptor capture
public/static/auth.js            token storage / auth helpers
public/static/vendor/face-api.js, public/static/models/   self-hosted model + weights
scripts/e2e.sh, scripts/ui_smoke.py   test suites
```

## Known limitations

- Invitation emails are not sent; admins copy the invite link from the Team page.
- Retention windows are stored and displayed but not yet enforced by a scheduled job.
- Liveness is a head-movement challenge, not a certified presentation-attack detector.
- Billing/trial limits are stored per organisation but not enforced; no door-relay/webhook integration yet.
- The legacy Home and Dev Lab pages still reference older engine scripts and are untested.
