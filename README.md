# FaceAccess — AI-Enhanced Facial Recognition Access Control System

## Project Overview
A complete facial recognition-based access control system with AI-driven predictive behavior, dynamic trust scoring, and real-time anomaly detection. Enterprise-grade security for both corporate and home environments.

**Production:** [https://faceaccess.pages.dev](https://faceaccess.pages.dev)  
**Home Dashboard:** [https://faceaccess.pages.dev/home/dashboard](https://faceaccess.pages.dev/home/dashboard)  
**Mobile App:** [https://faceaccess.pages.dev/home/mobile](https://faceaccess.pages.dev/home/mobile)

---

## ✅ Completed Features

### AI Intelligence (v3.0 — New)
- **Dynamic Trust Scoring** — Composite score: Face (35%) + Behavioral (35%) + Predictive (20%) - Anomaly Penalty (10%)
- **Continuous Learning** — Exponential Moving Average (α=0.15) updates after every access event
- **Trust Tiers**: `trusted` (≥85%) → instant access; `standard` (≥60%); `watchlist` (≥40%) → extra verification; `blocked` (<40%)
- **Behavioral Pattern Analysis** — Hourly/day-of-week frequency maps, typical window detection
- **Predictive Arrival Engine** — Predicts next arrival using historical DoW averages with ≤2.5h std dev threshold
- **Anomaly Detection** — 7 anomaly types: `spoof_attempt` (critical, −25%), `repeated_failures` (high, −15%), `unusual_time` (high, −12%), `off_schedule` (medium, −5%), `behavioral_drift` (low, −3%)
- **AI Recommendations** — Auto-generated suggestions: revoke access, upgrade verification, pre-approve guests, schedule restrictions
- **Admin AI Dashboard** — Real-time trust score cards, behavioral heatmap (24×7), anomaly feed, prediction panel
- **Mobile Trust Display** — Circular trust gauge with score breakdown in mobile profile tab
- **Mobile Predictive Notifications** — Arrival prediction banner + anomaly security alerts on home tab

### Core Face Recognition
- Liveness detection + anti-spoofing validation
- Cosine similarity matching against encrypted embeddings
- Confidence tiers: High ≥85% (auto-grant), Medium 65-84% (triggers 2FA), Low <65% (denied)
- Phone proximity verification (BLE + WiFi)

### FaceAccess Home (Consumer Product)
- Smart lock management (August, Schlage, Yale, Nuki, Generic/Relay, ZigBee)
- Multi-camera support (RTSP, Ring, Nest, Arlo, WebRTC)
- Household member and guest pass management
- Trusted device registration with BLE UUID

### Security Hardening
- Cryptographically secure nanoid (Web Crypto API)
- Input sanitization + enum validation on all endpoints
- Rate limiting (10 req/min on recognize, 5 enrollments/hour)
- XSS prevention with esc() helper
- CORS locked to known origins, security headers on all responses

---

## AI Architecture

```
Camera → POST /api/home/recognize
    ├── Liveness/Spoof Gate (hard reject if <0.35/0.5)
    ├── Rate Limit Check (10/min per lock)
    ├── Face Embedding Cosine Similarity Match
    ├── AI Behavioral Analysis
    │   ├── Load last 90 patterns from behavioral_patterns
    │   ├── analyzePatterns() → behavioralScore, isTypical, anomalyScore
    │   ├── detectAnomalyType() → anomaly_events insert + trustDelta
    │   └── updateTrustProfile() → EMA update → trust_tier
    ├── Proximity Decision (BLE 0.95, WiFi 0.78)
    └── Response includes trust_score, trust_tier, behavioral_typical
```

### Trust Score Formula
```
trust = face_avg×0.35 + behavioral×0.35 + predictive×0.20 - penalty×0.10
```

### Behavioral Score Components
- `success_rate × 0.80 + 0.20` base
- `+0.10` if access is within typical hourly window
- `−0.15` if atypical access detected

### Anomaly Penalty Healing
- Each non-anomalous access heals: `penalty -= 0.01`
- Anomalous access inflicts: `penalty += anomaly_score × 0.1`

---

## Database Schema (5 tables added in v3.0)

| Table | Purpose |
|-------|---------|
| `user_trust_profiles` | Per-user composite trust score + component scores |
| `behavioral_patterns` | Time-series access events (hour, DoW, result, confidence) |
| `anomaly_events` | Detected anomalies with severity, type, trust delta |
| `predictive_sessions` | Predicted arrival windows with pre-auth readiness |
| `ai_recommendations` | Auto-generated admin action recommendations |

---

## AI API Endpoints (New)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai/trust/:home_id` | All trust profiles for a home |
| `GET` | `/api/ai/trust/user/:user_id` | Single user trust + hour distribution |
| `POST` | `/api/ai/trust/recalculate/:user_id` | Force recalculate from history |
| `GET` | `/api/ai/anomalies/:home_id` | Anomaly events (filter: severity, resolved) |
| `PUT` | `/api/ai/anomalies/:id/acknowledge` | Mark anomaly acknowledged |
| `PUT` | `/api/ai/anomalies/:id/resolve` | Mark anomaly resolved |
| `GET` | `/api/ai/predictions/:home_id` | Active predictive sessions |
| `POST` | `/api/ai/predictions/generate/:home_id` | Generate predictions for all users |
| `GET` | `/api/ai/recommendations/:home_id` | AI-generated recommendations |
| `PUT` | `/api/ai/recommendations/:id/dismiss` | Dismiss a recommendation |
| `GET` | `/api/ai/dashboard/:home_id` | Aggregated AI dashboard data |
| `GET` | `/api/ai/behavioral/:user_id` | Full behavioral analysis |

---

## Tech Stack
- **Runtime**: Cloudflare Workers (edge, global)
- **Framework**: Hono v4
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Vanilla JS + Tailwind CSS (CDN) + Chart.js
- **Build**: Vite + TypeScript

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Last Updated**: 2026-03-12
- **Commit**: b91b7c8 (AI trust engine v3.0)
