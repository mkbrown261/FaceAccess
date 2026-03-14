# FaceAccess — AI-Enhanced Facial Recognition Access Control System v4.2

## Project Overview
A complete facial recognition-based access control system with a **multi-model biometric pipeline** (ArcFace + InsightFace + FaceNet), AI Trust Engine v4, predictive behavioral analysis, real-time anomaly detection, a **dedicated internal Developer Testing Lab**, and a full **legal compliance framework** covering privacy, biometrics, SMS, and AI transparency.

**Production:** [https://faceaccess.pages.dev](https://faceaccess.pages.dev)  
**Home Dashboard:** [https://faceaccess.pages.dev/home/dashboard](https://faceaccess.pages.dev/home/dashboard)  
**Mobile App:** [https://faceaccess.pages.dev/home/mobile](https://faceaccess.pages.dev/home/mobile)  
**🔬 Dev Lab:** [https://faceaccess.pages.dev/dev-lab](https://faceaccess.pages.dev/dev-lab)

### 📋 Legal Pages
| Page | URL | Status |
|---|---|---|
| Privacy Policy | [/legal/privacy](https://faceaccess.pages.dev/legal/privacy) | ✅ Live |
| Terms of Use | [/legal/terms](https://faceaccess.pages.dev/legal/terms) | ✅ Live |
| SMS Consent Agreement | [/legal/sms-consent](https://faceaccess.pages.dev/legal/sms-consent) | ✅ Live |
| Biometric Data Retention Policy | [/legal/biometric-retention](https://faceaccess.pages.dev/legal/biometric-retention) | ✅ Live |
| AI & Facial Recognition Disclosure | [/legal/ai-disclosure](https://faceaccess.pages.dev/legal/ai-disclosure) | ✅ Live |
| Enterprise Security Compliance | [/legal/enterprise-security](https://faceaccess.pages.dev/legal/enterprise-security) | ✅ Live |

---

## ✅ Completed Features

### ⚖️ Legal Compliance Framework (v1.0 — NEW)
Full legal policy ecosystem covering BIPA, CCPA, TCPA, and GDPR requirements.

**6 Legal Pages (all live at `/legal/*`):**
- **Privacy Policy** — Biometric data handling, SMS communications, data rights, contact information
- **Terms of Use** — Service agreement, biometric consent, SMS consent, acceptable use, limitation of liability
- **SMS Consent Agreement** — Twilio-compliant TCPA consent language, STOP/HELP keywords, opt-out instructions, message types
- **Biometric Data Retention Policy** — BIPA-compliant written retention schedule, 3-year max, 30-day deletion SLA, IL/TX/WA/CA compliance
- **AI & Facial Recognition Disclosure** — Algorithm transparency, 128-dim embeddings, anti-spoof threshold (0.72), accuracy limitations, demographic fairness
- **Enterprise Security Compliance** — Cloudflare edge security, AES-256 encryption, RBAC, rate limiting, SOC2/ISO27001 vendor compliance

**Consent Checkboxes at Every Signup Entry Point:**
All 4 registration flows now include dual consent checkboxes:
1. ✅ **Required:** Terms of Use + Privacy Policy + Biometric data consent
2. ☐ **Optional:** SMS text message consent (TCPA-compliant)

Registration flows updated:
- **Business Registration** (`bizDoRegister`) — validates `biz-reg-consent-terms` required
- **Home Registration** (`homeDoRegister`) — validates `home-reg-consent-terms` required
- **Mobile Registration** (`mobDoRegister`) — validates `mob-reg-consent-terms` required
- **Home Onboarding Step 0** (`saveAccount`) — validates `ob-consent-terms` required
- `sms_consent` flag passed to all backend registration APIs


### 🔬 Developer Testing Lab (v1.0 — NEW at `/dev-lab`)
Internal sandbox environment for validating biometric pipeline accuracy, enrollment quality, and trust engine logic — fully isolated from production data.

**Six integrated panels:**

1. **Face Enrollment Panel**
   - USB webcam / laptop camera / optional RTSP stream connection
   - Start/stop/switch camera controls with real-time feed
   - Live quality metrics: brightness, sharpness, anti-spoof score
   - 7-angle progress dots (center, left, right, up, down, left_up, right_up)
   - One-click capture per angle or **Auto-Enroll** (captures all 7 angles automatically)
   - Embedding generation via frame pixel analysis (128-dim L2-normalized vector)
   - Clear embeddings per profile

2. **Authentication Test Panel**
   - Three test modes: **Live Camera**, **Demo (simulated)**, **Manual**
   - Simulated lock selector (Lab-Door-01/02, Lab-Entrance, Server-Room)
   - BLE proximity + Wi-Fi match toggles
   - Full pipeline simulation: cosine similarity → multi-model scoring → trust calculation
   - Debug mode toggle for raw pipeline values

3. **Lock Simulation**
   - Animated **Access Granted — Door Unlocked** (green unlock + pulse glow)
   - **Access Denied** shake animation (red pulse)
   - Pending approval state indicator

4. **Confidence Visualization Panel**
   - Three doughnut rings: Identity Confidence, Liveness, Trust Score
   - 8-metric score bars: ArcFace, InsightFace, FaceNet, Combined, Final, Liveness, Anti-Spoof, Proximity
   - Full breakdown table with visual bars per metric
   - Confidence history line chart (last 20 tests)
   - Pipeline trace: stage badges (edge → arcface → insightface → fusion → trust) + latency

5. **Security Log Panel**
   - Real-time table: timestamp, result badge, matched user, similarity, combined confidence, trust tier/score, latency, lock, test mode
   - Stats bar: total, granted, denied, avg confidence, avg latency
   - Filter by result (granted/denied/pending)
   - Clear all logs

6. **Dev Controls Panel**
   - Reset lab (clear embeddings + logs, keep profiles)
   - Delete all test profiles
   - Debug mode (raw model values in debug console)
   - Pipeline config display (all thresholds)
   - Debug console (monospace live output)
   - Lab statistics dashboard

**Dev Lab API endpoints (10 routes under `/api/devlab/`):**
```
GET/POST     /api/devlab/profiles         — CRUD test profiles (name, email, role, device ID)
GET          /api/devlab/profiles/:id     — Single profile
DELETE       /api/devlab/profiles/:id     — Delete profile + embeddings
POST         /api/devlab/enroll/:id       — Store face embedding (64-512 floats)
GET          /api/devlab/enroll/:id       — List embeddings for profile
DELETE       /api/devlab/enroll/:id       — Clear all embeddings for profile
POST         /api/devlab/authenticate     — Full auth pipeline simulation
GET/DELETE   /api/devlab/logs             — Security log (filter by decision)
GET          /api/devlab/stats            — Aggregate lab statistics
DELETE       /api/devlab/reset            — Full lab reset
```

**DB tables:** `devlab_profiles`, `devlab_embeddings`, `devlab_test_log`, `devlab_sessions`

### Multi-Model Biometric Pipeline (v4.0 — Latest)
- **Tiered Recognition Pipeline**: Face detection → Alignment → ArcFace primary → Cosine check → If borderline → InsightFace secondary → FaceNet tertiary
- **ArcFace ResNet100** — 512-dim embeddings, primary model (weight 50%), angular margin softmax, highest discriminability
- **InsightFace MobileNetV3** — 256-dim embeddings, secondary model (weight 30%), fast inference for borderline cases
- **FaceNet Inception** — 128-dim embeddings, tertiary model (weight 20%), invoked only when first two disagree
- **Score Fusion Formula**: `combined = ArcFace×0.50 + InsightFace×0.30 + FaceNet×0.20`
- **Borderline Detection** — Scores 60-90% trigger secondary verification automatically
- **Model Agreement Score** — Measures consistency between all active models; low agreement flags suspicious cases
- **Edge AI Preprocessing** — Face alignment, landmark detection, anti-spoof pre-check run on-device before cloud verification
- **Continuous Learning Engine** — EMA-based template adaptation after successful authentications (α=0.05 update per success)
- **Full Audit Logging** — Every authentication decision logged with all model scores, latency, and decision path

### AI Trust Engine v4
- **Multi-Model Trust Formula**: `trust = face_avg×0.35 + behavioral×0.35 + predictive×0.20 − penalty×0.10`
- **Per-Model Tracking** — `arcface_avg`, `insightface_avg` stored per user in trust profiles
- **Trust Score History** — Time-series of trust score changes for trend visualization
- **Tiers**: `trusted` (≥85%) instant unlock; `standard` (≥60%); `watchlist` (≥40%) extra verification; `blocked` (<40%)
- **EMA Adaptation** — α=0.15 for stable trust evolution
- **Behavioral Model** — Continuous learning of typical arrival times, doors, device proximity patterns
- **Behavioral Drift Detection** — Compares recent vs 7-day prior pattern distributions; flags significant shifts

### Biometric Audit Log (Compliance)
Every authentication decision records:
- Decision: `granted` | `denied` | `pending` | `error`
- All model scores: `arcface_score`, `insightface_score`, `facenet_score`, `combined_confidence`
- `anti_spoof_score`, `liveness_score`, `edge_confidence`, `quality_score`
- Pipeline trace: `stage_reached` (e.g., `edge→arcface→insightface→fusion`)
- `pipeline_latency_ms`, `model_agreement`, `is_borderline`
- Trust context: `trust_score`, `trust_tier`, `behavioral_typical`, `anomaly_score`
- Device signals: `ble_detected`, `wifi_matched`, `proximity_score`

### AI Intelligence Dashboard (v3.0+)
- **Multi-Model Pipeline Status Panel** — Visual stage flow with per-model accuracy, avg latency, model agreement
- **Pipeline Performance Metrics** — 7-day total verifications, borderline cases, latency distribution
- **Trust Engine Formula Display** — Real-time weighted formula visualization
- **Trust Score Cards** — Trusted / Standard / Watchlist / Anomalies count
- **User Trust Profile Modal** — Multi-model biometric stats per user (ArcFace, InsightFace, FaceNet averages)
- **Behavioral Heatmap** — 24×7 access frequency visualization
- **Arrival Predictions** — Next predicted arrival per user
- **AI Recommendations** — Auto-generated: revoke blocked, upgrade watchlist, renew guest passes
- **Anomaly Feed** — Real-time anomaly events with resolve/acknowledge actions

### Core Face Recognition
- Liveness detection (eye-open ratio, motion history, challenge-response)
- Anti-spoofing: contrast variance, Sobel texture, highlight ratio, screen artifact detection
- Cosine similarity matching against AES-256 encrypted embeddings
- Confidence tiers: High ≥85% (auto-grant), Medium 65–84% (triggers 2FA), Low <65% (denied)
- Phone proximity verification (BLE + WiFi)
- Multi-angle enrollment: 7 angles, 3 liveness challenges

### FaceAccess Home
- Multi-lock smart home security (August, Schlage, Yale, Nuki, Generic)
- Real-time face recognition at door via FaceID Engine v2.0
- Guest pass management with time windows and day restrictions
- Remote approval: push notification → mobile approve/deny
- Device registration + BLE proximity fingerprinting

### Security & Privacy
- AES-256 GCM encrypted biometric embeddings (Web Crypto API)
- GDPR-compliant biometric erasure (`DELETE /api/home/users/:id/face`)
- Server-side rate limiting: 10 attempts/min per lock
- Client-side rate limiting: 5 attempts/min with 60s lockout
- Hard rejection: anti-spoof score < 0.35, liveness < 0.50
- No raw photos stored; only 512-dim normalized vectors

---

## API Reference

### Multi-Model Biometric (v4.0)
```
POST /api/home/recognize
  Body: { lock_id, arcface_score, insightface_score, facenet_score,
          combined_confidence, anti_spoof_score, liveness_score,
          edge_confidence, model_agreement, pipeline_latency_ms,
          stage_reached, is_borderline, ble_detected, wifi_matched,
          verification_version: "4.0" }

GET  /api/ai/pipeline/stats/:home_id   — 7-day pipeline performance metrics
GET  /api/ai/audit/:home_id            — Biometric audit log (compliance)
GET  /api/ai/audit/user/:user_id       — Per-user audit + model stats
POST /api/ai/multimodel/enroll/:user_id — Store multi-model embeddings
GET  /api/ai/multimodel/embeddings/:user_id — Enrollment metadata
GET  /api/ai/behavioral/model/:user_id — Behavioral model + drift analysis
GET  /api/ai/trust/history/:user_id   — Trust score trend history
```

### AI Trust & Anomaly (v3.0)
```
GET  /api/ai/dashboard/:home_id        — Aggregated AI dashboard data
GET  /api/ai/trust/:home_id            — All trust profiles
GET  /api/ai/trust/user/:user_id       — Single user trust + hour distribution
POST /api/ai/trust/recalculate/:user_id — Force recalculate from history
GET  /api/ai/anomalies/:home_id        — Anomaly events
PUT  /api/ai/anomalies/:id/acknowledge
PUT  /api/ai/anomalies/:id/resolve
GET  /api/ai/predictions/:home_id      — Active predictive sessions
POST /api/ai/predictions/generate/:home_id
GET  /api/ai/recommendations/:home_id
GET  /api/ai/behavioral/:user_id       — Full behavioral analysis
```

---

## Data Architecture

### Storage: Cloudflare D1 (SQLite)

**Core tables:**
- `homes`, `home_users`, `home_devices`, `smart_locks`, `home_cameras`
- `guest_passes`, `home_events`, `home_verifications`, `home_automations`

**AI tables (v3.0):**
- `user_trust_profiles` — Dynamic trust scores with EMA
- `behavioral_patterns` — Raw time-series access events (w/ multi-model scores)
- `anomaly_events` — Detected anomalies with severity and trust delta
- `predictive_sessions` — Predicted arrival windows
- `ai_recommendations` — Auto-generated access management suggestions

**Multi-model tables (v4.0):**
- `biometric_audit_log` — Full compliance audit record for every authentication
- `multimodel_embeddings` — Per-model embedding storage (ArcFace, InsightFace, FaceNet)
- `behavioral_models` — Continuous learning state with drift detection
- `trust_score_history` — Time-series of trust score changes

### Multi-Model Pipeline Algorithms

**Score Fusion:**
```
combined = arcface × 0.50 + insightface × 0.30 + facenet × 0.20
adjusted = combined × (anti_spoof_adjustment) × (0.90 + edge_confidence × 0.10)
```

**Trust Score:**
```
trust = face_avg × 0.35 + behavioral × 0.35 + predictive × 0.20 - penalty × 0.10
EMA:  new = prev × 0.85 + current × 0.15  (α = 0.15)
```

**Anomaly Types:**
| Type | Severity | Trust Delta |
|------|----------|-------------|
| spoof_attempt | critical | −25% |
| repeated_failures | high | −15% |
| unusual_time | high | −12% |
| off_schedule | medium | −5% |
| behavioral_drift | low | −3% |

**Borderline Handling:**
- If ArcFace score 0.60–0.90 → automatically invoke InsightFace
- If ArcFace & InsightFace disagree by >10% → invoke FaceNet
- Model agreement = 1 - std_dev(all_scores) × 4

---

## User Guide

### Admin Dashboard
1. Visit https://faceaccess.pages.dev/home/dashboard
2. **AI Intelligence tab** → Multi-Model Pipeline Status, Trust Scores, Anomaly Feed
3. Click on a user's trust profile to see per-model (ArcFace/InsightFace/FaceNet) biometric stats
4. **Face Recognition tab** → Start camera → Click "Verify Identity" → See pipeline stages in result panel
5. **Anomaly Detection tab** → Review and resolve security alerts

### Mobile App
1. Visit https://faceaccess.pages.dev/home/mobile
2. Profile tab shows trust score gauge with security tier
3. Home tab shows pending door approvals with confidence breakdown
4. Approve/deny with biometric confirmation

### API Integration (v4.0)
```json
POST /api/home/recognize
{
  "lock_id": "lock-xxxx",
  "arcface_score": 0.91,
  "insightface_score": 0.88,
  "facenet_score": 0.87,
  "combined_confidence": 0.895,
  "anti_spoof_score": 0.88,
  "liveness_score": 0.94,
  "edge_confidence": 0.87,
  "model_agreement": 0.96,
  "pipeline_latency_ms": 342,
  "stage_reached": "edge→arcface→insightface→fusion",
  "is_borderline": false,
  "ble_detected": true,
  "verification_version": "4.0"
}
```

---

## Deployment

- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Active
- **Engine Version**: v4.0
- **Tech Stack**: Hono + TypeScript + TailwindCSS + Cloudflare D1
- **Last Updated**: 2026-03-13

### New Files (v4.0)
- `public/static/arcface-engine.js` — Multi-model biometric pipeline (ArcFace, InsightFace, FaceNet, Edge AI, ContinuousLearning, AuditLogger)
- `migrations/0004_multimodel_schema.sql` — biometric_audit_log, multimodel_embeddings, behavioral_models, trust_score_history + ALTER TABLE statements
