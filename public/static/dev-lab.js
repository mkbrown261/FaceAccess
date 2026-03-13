// ═══════════════════════════════════════════════════════════════════════════
// FaceAccess Dev Lab — Frontend Controller  v1.0
// /dev-lab  — Internal Biometric Testing Sandbox
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const API = '';  // same-origin

// ── State ──────────────────────────────────────────────────────────────────
let _enrollStream   = null;  // MediaStream for enrollment cam
let _authStream     = null;  // MediaStream for auth cam
let _enrollVideo    = null;
let _authVideo      = null;
let _camFacingMode  = 'user';
let _camDeviceIndex = 0;
let _camSrc         = 'webcam';  // webcam|laptop|rtsp
let _frameLoop      = null;
let _debugMode      = false;
let _profiles       = [];
let _lastAuthResult = null;
let _historyChart   = null;
let _ringCharts     = {};

// Enrollment angle definitions
const ANGLES = [
  { label: 'center',    icon: '○', hint: 'Look straight at the camera' },
  { label: 'left',      icon: '←', hint: 'Turn head slightly left' },
  { label: 'right',     icon: '→', hint: 'Turn head slightly right' },
  { label: 'up',        icon: '↑', hint: 'Tilt head slightly up' },
  { label: 'down',      icon: '↓', hint: 'Tilt head slightly down' },
  { label: 'left_up',   icon: '↖', hint: 'Head left and up' },
  { label: 'right_up',  icon: '↗', hint: 'Head right and up' },
];
let _capturedAngles = {};   // { label: true }
let _activeAngle    = 0;    // index into ANGLES
let _enrollProfile  = null; // selected profile id
let _autoEnrolling  = false;

// ── Utilities ──────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el  = document.getElementById('toast');
  const ico = document.getElementById('toast-icon');
  const txt = document.getElementById('toast-msg');
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
  ico.textContent = icons[type] || '●';
  txt.textContent = msg;
  el.className = 'toast show';
  setTimeout(() => el.classList.remove('show'), 3200);
}

function debugLog(msg, data) {
  const el = document.getElementById('debug-output');
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  const line = `<div style="color:#64748b;font-size:10px;padding:2px 0;border-bottom:1px solid #1e1e3a10">
    <span style="color:#6366f1">[${ts}]</span> <span style="color:#e2e8f0">${msg}</span>
    ${data ? `\n<span style="color:#94a3b8;font-size:10px">${JSON.stringify(data, null, 2)}</span>` : ''}
  </div>`;
  el.innerHTML += line;
  el.scrollTop = el.scrollHeight;
}

function pct(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  return (v * 100).toFixed(dec) + '%';
}

function fmt(v, dec = 3) {
  if (v == null || isNaN(v)) return '—';
  return (+v).toFixed(dec);
}

function tierBadge(tier) {
  const map = {
    trusted:   'badge-green',
    standard:  'badge-blue',
    watchlist: 'badge-yellow',
    blocked:   'badge-red',
  };
  return `<span class="badge ${map[tier] || 'badge-gray'}">${tier || '—'}</span>`;
}

function decisionBadge(d) {
  if (d === 'granted')  return '<span class="badge badge-green"><i class="fas fa-check"></i> Granted</span>';
  if (d === 'denied')   return '<span class="badge badge-red"><i class="fas fa-times"></i> Denied</span>';
  if (d === 'pending')  return '<span class="badge badge-yellow"><i class="fas fa-clock"></i> Pending</span>';
  return '<span class="badge badge-gray">—</span>';
}

function timeAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return d.toLocaleTimeString();
}

// ── Sidebar navigation ─────────────────────────────────────────────────────
const SECTION_META = {
  enroll:     { title: 'Face Enrollment',       sub: 'Capture facial embeddings for test profiles' },
  auth:       { title: 'Authentication Test',   sub: 'Run full biometric pipeline against stored profiles' },
  confidence: { title: 'Confidence Visualizer', sub: 'Real-time score breakdown and history charts' },
  profiles:   { title: 'Test Profiles',         sub: 'Create and manage dev-lab user records' },
  logs:       { title: 'Security Log',          sub: 'Real-time activity log of all authentication attempts' },
  controls:   { title: 'Dev Controls',          sub: 'Reset, debug mode, pipeline configuration' },
};

function showSection(name) {
  document.querySelectorAll('.section-page').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  if (sec) sec.style.display = '';
  const nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');
  const meta = SECTION_META[name] || {};
  document.getElementById('page-title').textContent = meta.title || name;
  document.getElementById('page-sub').textContent   = meta.sub   || '';

  // Lazy-load section data
  if (name === 'profiles')   loadProfiles();
  if (name === 'logs')       loadLogs();
  if (name === 'controls')   loadLabStats();
  if (name === 'confidence') { loadConfidenceHistory(); initRingCharts(); }
  if (name === 'enroll')     { loadProfiles(); renderAngleDots(); populateProfileSelect(); }
}

// ── Stats refresh ──────────────────────────────────────────────────────────
async function refreshStats() {
  try {
    const r = await axios.get(`${API}/api/devlab/stats`);
    const d = r.data;
    const a = d.attempts || {};
    const sidebar = document.getElementById('sidebar-stats');
    sidebar.innerHTML = `
      <div style="color:#6366f1;font-weight:700;font-size:12px;margin-bottom:4px">Lab Stats</div>
      <div>Profiles: <b style="color:#e2e8f0">${d.profiles?.total || 0}</b> (${d.profiles?.enrolled || 0} enrolled)</div>
      <div>Attempts: <b style="color:#e2e8f0">${a.total_attempts || 0}</b></div>
      <div>Granted: <b style="color:#10b981">${a.granted || 0}</b> / Denied: <b style="color:#ef4444">${a.denied || 0}</b></div>
      <div>Avg Conf: <b style="color:#e2e8f0">${pct(a.avg_confidence)}</b></div>
    `;
  } catch {}
}

// ── Camera Management ──────────────────────────────────────────────────────
function setCamSrc(src) {
  _camSrc = src;
  document.querySelectorAll('#src-webcam,#src-laptop,#src-rtsp').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('src-' + src);
  if (btn) btn.classList.add('active');
  document.getElementById('rtsp-row').style.display = src === 'rtsp' ? '' : 'none';
}

async function startCamera(panel = 'enroll') {
  const isAuth  = panel === 'auth';
  const videoEl = document.getElementById(isAuth ? 'auth-video' : 'cam-video');
  const statusEl = document.getElementById(isAuth ? 'auth-cam-status' : 'enroll-cam-status');
  const wrapEl  = document.getElementById(isAuth ? 'auth-cam-wrapper' : 'enroll-cam-wrapper');
  const placeholderEl = document.getElementById(isAuth ? 'auth-placeholder' : 'cam-placeholder');
  const startBtn  = document.getElementById(isAuth ? 'auth-cam-start-btn' : 'cam-start-btn');
  const stopBtn   = document.getElementById(isAuth ? 'auth-cam-stop-btn' : 'cam-stop-btn');
  const scanLine  = document.getElementById(isAuth ? 'auth-scan-line' : 'scan-line');

  try {
    // Stop previous stream if any
    if (isAuth && _authStream) { _authStream.getTracks().forEach(t => t.stop()); }
    if (!isAuth && _enrollStream) { _enrollStream.getTracks().forEach(t => t.stop()); }

    const constraints = {
      video: {
        facingMode: _camFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();

    if (isAuth) { _authStream = stream; _authVideo = videoEl; }
    else        { _enrollStream = stream; _enrollVideo = videoEl; }

    // Update UI
    if (placeholderEl) placeholderEl.style.display = 'none';
    statusEl.innerHTML = '<i class="fas fa-circle"></i> Live';
    statusEl.className = 'badge badge-green';
    wrapEl.classList.add('scanning');
    if (scanLine) scanLine.style.display = '';
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn)  stopBtn.style.display = '';

    // Enable capture buttons
    if (!isAuth) {
      document.getElementById('capture-frame-btn').disabled = false;
      if (_enrollProfile) document.getElementById('auto-enroll-btn').disabled = false;
      // Start metrics loop
      startMetricsLoop(videoEl);
    }

    debugLog(`Camera started [${panel}]`, { facingMode: _camFacingMode });
    toast('Camera started', 'success');
  } catch (err) {
    statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
    statusEl.className = 'badge badge-red';
    if (wrapEl) wrapEl.classList.add('error');
    toast('Camera error: ' + err.message, 'error');
    debugLog('Camera error', { message: err.message, name: err.name });
  }
}

function stopCamera(panel = 'enroll') {
  const isAuth = panel === 'auth';
  const stream = isAuth ? _authStream : _enrollStream;
  const statusEl = document.getElementById(isAuth ? 'auth-cam-status' : 'enroll-cam-status');
  const wrapEl   = document.getElementById(isAuth ? 'auth-cam-wrapper' : 'enroll-cam-wrapper');
  const scanLine = document.getElementById(isAuth ? 'auth-scan-line' : 'scan-line');
  const startBtn = document.getElementById(isAuth ? 'auth-cam-start-btn' : 'cam-start-btn');
  const stopBtn  = document.getElementById(isAuth ? 'auth-cam-stop-btn' : 'cam-stop-btn');

  if (stream) stream.getTracks().forEach(t => t.stop());
  if (isAuth) { _authStream = null; } else { _enrollStream = null; }

  statusEl.innerHTML = '<i class="fas fa-circle"></i> Offline';
  statusEl.className = 'badge badge-gray';
  if (wrapEl) { wrapEl.classList.remove('scanning', 'enrolled', 'error'); }
  if (scanLine) scanLine.style.display = 'none';
  if (startBtn) startBtn.style.display = '';
  if (stopBtn)  stopBtn.style.display = 'none';

  if (!isAuth) {
    stopMetricsLoop();
    document.getElementById('capture-frame-btn').disabled = true;
    document.getElementById('auto-enroll-btn').disabled = true;
  }
}

async function switchCamera() {
  _camFacingMode = _camFacingMode === 'user' ? 'environment' : 'user';
  if (_enrollStream) {
    stopCamera('enroll');
    await startCamera('enroll');
  }
}

// ── Metrics Loop ───────────────────────────────────────────────────────────
function startMetricsLoop(videoEl) {
  stopMetricsLoop();
  const canvas = document.getElementById('cam-canvas');
  const ctx = canvas.getContext('2d');
  _frameLoop = setInterval(() => {
    if (!videoEl || videoEl.readyState < 2) return;
    canvas.width  = videoEl.videoWidth  || 640;
    canvas.height = videoEl.videoHeight || 480;
    ctx.drawImage(videoEl, 0, 0);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const metrics = analyzeFrame(frame, canvas.width, canvas.height);
    document.getElementById('met-bright').textContent  = metrics.brightness.toFixed(0);
    document.getElementById('met-sharp').textContent   = metrics.sharpness.toFixed(0);
    document.getElementById('met-spoof').textContent   = pct(metrics.antiSpoof);
    document.getElementById('met-quality').textContent = pct(metrics.quality);
    // Draw face overlay
    drawFaceOverlay(ctx, canvas.width, canvas.height, metrics);
  }, 200);
}

function stopMetricsLoop() {
  if (_frameLoop) { clearInterval(_frameLoop); _frameLoop = null; }
}

function analyzeFrame(imageData, w, h) {
  const data = imageData.data;
  let brightness = 0, sharpness = 0, skinCount = 0;
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    brightness += (r + g + b) / 3;
    // Skin tone detection (simplified)
    if (r > 80 && g > 40 && b > 20 && r > g && r > b && (r - g) > 10) skinCount++;
  }
  brightness /= pixels;

  // Edge sharpness (simple variance)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const p0  = data[idx], p1 = data[idx + 4], p2 = data[(y+1)*w*4 + x*4];
      sharpness += Math.abs(p0 - p1) + Math.abs(p0 - p2);
    }
  }
  sharpness = Math.min(100, sharpness / (w * h) * 5);

  const skinRatio = skinCount / pixels;
  const antiSpoof = Math.min(1, 0.40 + skinRatio * 3.0 + (sharpness / 100) * 0.2);
  const quality = Math.min(1,
    (brightness / 200) * 0.35 +
    (sharpness / 100)  * 0.35 +
    skinRatio           * 0.30
  );

  return { brightness, sharpness, antiSpoof, quality, skinRatio };
}

function drawFaceOverlay(ctx, w, h) {
  // Draw face oval guide
  ctx.save();
  ctx.strokeStyle = '#6366f180';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.ellipse(w/2, h/2, w*0.22, h*0.33, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ── Enrollment Logic ───────────────────────────────────────────────────────
function renderAngleDots() {
  const container = document.getElementById('angle-dots');
  if (!container) return;
  container.innerHTML = ANGLES.map((a, i) => `
    <div class="angle-dot ${_capturedAngles[a.label] ? 'captured' : i === _activeAngle ? 'active' : ''}"
         title="${a.hint}" onclick="setActiveAngle(${i})">
      ${a.icon}
    </div>
  `).join('');
  const count = Object.keys(_capturedAngles).length;
  const countEl = document.getElementById('angle-count');
  if (countEl) countEl.textContent = `${count} / ${ANGLES.length}`;
  document.getElementById('enroll-progress').style.display = count > 0 ? '' : 'none';
  const pct_val = Math.round(count / ANGLES.length * 100);
  const pctEl = document.getElementById('enroll-pct');
  const barEl = document.getElementById('enroll-bar');
  if (pctEl) pctEl.textContent = pct_val + '%';
  if (barEl) barEl.style.width = pct_val + '%';
}

function setActiveAngle(i) {
  _activeAngle = i;
  const hint = document.getElementById('current-angle-hint');
  if (hint) {
    hint.style.display = '';
    hint.textContent = '👉 ' + ANGLES[i].hint;
  }
  renderAngleDots();
}

async function populateProfileSelect() {
  try {
    const r = await axios.get(`${API}/api/devlab/profiles`);
    _profiles = r.data.profiles || [];
    const sel = document.getElementById('enroll-profile-select');
    if (!sel) return;
    const curr = sel.value;
    sel.innerHTML = '<option value="">— Pick a profile —</option>' +
      _profiles.map(p => `<option value="${p.id}" ${p.id === curr ? 'selected' : ''}>${p.full_name} (${p.role}) ${p.face_registered ? '✓' : ''}</option>`).join('');
    if (curr) sel.value = curr;
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('enroll-profile-select');
  if (sel) {
    sel.addEventListener('change', () => {
      const id = sel.value;
      _enrollProfile = id || null;
      const infoEl = document.getElementById('enroll-profile-info');
      const autoBtn = document.getElementById('auto-enroll-btn');
      const clearBtn = document.getElementById('clear-enroll-btn');

      if (id) {
        const p = _profiles.find(x => x.id === id);
        if (p && infoEl) {
          infoEl.style.display = '';
          infoEl.innerHTML = `
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-user" style="color:#6366f1"></i>
              <b style="color:#e2e8f0">${p.full_name}</b>
              <span class="badge badge-gray" style="font-size:10px">${p.role}</span>
            </div>
            <div>${p.email}</div>
            ${p.phone_device_id ? `<div>Device: ${p.phone_device_id}</div>` : ''}
            <div style="margin-top:4px">
              Embeddings stored: <b style="color:${p.face_registered ? '#10b981' : '#ef4444'}">${p.embedding_count || 0}</b>
              ${p.face_registered ? ' <span class="badge badge-green" style="font-size:10px">Enrolled</span>' : ''}
            </div>
          `;
        }
        if (autoBtn) autoBtn.disabled = !_enrollStream;
        if (clearBtn) clearBtn.disabled = false;
        // Reset captured angles to reflect existing
        _capturedAngles = {};
        if (p && p.embedding_count > 0) {
          // Mark first N angles as captured
          for (let i = 0; i < Math.min(p.embedding_count, ANGLES.length); i++) {
            _capturedAngles[ANGLES[i].label] = true;
          }
        }
        renderAngleDots();
      } else {
        if (infoEl) infoEl.style.display = 'none';
        if (autoBtn) autoBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
      }
    });
  }
});

async function captureEnrollFrame() {
  if (!_enrollStream || !_enrollVideo) { toast('Start camera first', 'warn'); return; }
  if (!_enrollProfile) { toast('Select a profile first', 'warn'); return; }

  const angle = ANGLES[_activeAngle];
  const canvas = document.getElementById('cam-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = _enrollVideo.videoWidth || 640;
  canvas.height = _enrollVideo.videoHeight || 480;
  ctx.drawImage(_enrollVideo, 0, 0);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const metrics = analyzeFrame(frame, canvas.width, canvas.height);

  if (metrics.quality < 0.2) {
    toast('Frame quality too low — improve lighting', 'warn');
    return;
  }

  // Generate embedding from frame
  const embedding = generateEmbeddingFromFrame(frame, canvas.width, canvas.height);

  try {
    const r = await axios.post(`${API}/api/devlab/enroll/${_enrollProfile}`, {
      embedding,
      angle_label: angle.label,
      quality_score: metrics.quality,
      frame_index: _activeAngle,
    });

    _capturedAngles[angle.label] = true;

    // Auto-advance to next uncaptured angle
    let next = (_activeAngle + 1) % ANGLES.length;
    while (_capturedAngles[ANGLES[next].label] && next !== _activeAngle) {
      next = (next + 1) % ANGLES.length;
    }
    if (!_capturedAngles[ANGLES[next].label]) _activeAngle = next;

    renderAngleDots();
    document.getElementById('enroll-status').innerHTML =
      `<span style="color:#10b981"><i class="fas fa-check"></i> Captured: ${angle.label} (quality ${pct(metrics.quality)})</span>`;
    toast(`Angle "${angle.label}" captured`, 'success');
    debugLog('Frame enrolled', { angle: angle.label, quality: metrics.quality, embedding_count: r.data.embedding_count });

    // Check completion
    const allDone = ANGLES.every(a => _capturedAngles[a.label]);
    if (allDone) {
      document.getElementById('enroll-complete').style.display = '';
      document.getElementById('enroll-complete-sub').textContent =
        `${ANGLES.length} angles captured — profile ready for authentication testing`;
      const wrapper = document.getElementById('enroll-cam-wrapper');
      wrapper.classList.remove('scanning');
      wrapper.classList.add('enrolled');
      toast('Enrollment complete! ✓', 'success');
    }
    await populateProfileSelect();
  } catch (err) {
    toast('Enrollment failed: ' + (err.response?.data?.error || err.message), 'error');
  }
}

async function autoEnroll() {
  if (!_enrollStream || !_enrollVideo) { toast('Start camera first', 'warn'); return; }
  if (!_enrollProfile) { toast('Select a profile first', 'warn'); return; }
  if (_autoEnrolling) return;

  _autoEnrolling = true;
  const autoBtn = document.getElementById('auto-enroll-btn');
  autoBtn.disabled = true;
  autoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Auto-Enrolling…';

  try {
    for (let i = 0; i < ANGLES.length; i++) {
      const angle = ANGLES[i];
      if (_capturedAngles[angle.label]) continue;

      _activeAngle = i;
      renderAngleDots();
      const hint = document.getElementById('current-angle-hint');
      if (hint) { hint.style.display = ''; hint.textContent = '👉 ' + angle.hint; }
      document.getElementById('enroll-status').textContent = `Capturing: ${angle.label}…`;

      await new Promise(r => setTimeout(r, 800)); // Pause for user to adjust

      const canvas = document.getElementById('cam-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = _enrollVideo.videoWidth || 640;
      canvas.height = _enrollVideo.videoHeight || 480;
      ctx.drawImage(_enrollVideo, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const metrics = analyzeFrame(frame, canvas.width, canvas.height);
      const embedding = generateEmbeddingFromFrame(frame, canvas.width, canvas.height);

      await axios.post(`${API}/api/devlab/enroll/${_enrollProfile}`, {
        embedding,
        angle_label: angle.label,
        quality_score: metrics.quality,
        frame_index: i,
      });

      _capturedAngles[angle.label] = true;
      renderAngleDots();
    }

    document.getElementById('enroll-complete').style.display = '';
    document.getElementById('enroll-complete-sub').textContent =
      `${ANGLES.length} angles auto-captured — profile ready`;
    document.getElementById('enroll-cam-wrapper').classList.replace('scanning', 'enrolled');
    toast('Auto-enrollment complete!', 'success');
    await populateProfileSelect();
  } catch (err) {
    toast('Auto-enroll error: ' + err.message, 'error');
  } finally {
    _autoEnrolling = false;
    autoBtn.disabled = false;
    autoBtn.innerHTML = '<i class="fas fa-magic"></i> Auto-Enroll (7 Angles)';
  }
}

async function clearEnrollment() {
  if (!_enrollProfile) { toast('Select a profile', 'warn'); return; }
  if (!confirm('Clear all face embeddings for this profile?')) return;
  try {
    await axios.delete(`${API}/api/devlab/enroll/${_enrollProfile}`);
    _capturedAngles = {};
    _activeAngle = 0;
    renderAngleDots();
    document.getElementById('enroll-complete').style.display = 'none';
    document.getElementById('enroll-status').textContent = 'Embeddings cleared.';
    toast('Embeddings cleared', 'info');
    await populateProfileSelect();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── Embedding Generator ────────────────────────────────────────────────────
function generateEmbeddingFromFrame(imageData, w, h) {
  // Extract 128-dimensional feature vector from frame pixel data
  // (In production this would be a real neural net; here we sample regions)
  const data = imageData.data;
  const dim = 128;
  const embedding = new Array(dim).fill(0);
  const step = Math.floor(data.length / (dim * 4));

  for (let i = 0; i < dim; i++) {
    const offset = i * step * 4;
    const r = data[offset]   / 255;
    const g = data[offset+1] / 255;
    const b = data[offset+2] / 255;
    // Small DCT-like transform
    embedding[i] = r * 0.299 + g * 0.587 + b * 0.114 + (Math.sin(i * 0.37) * 0.1);
  }

  // L2-normalize
  const mag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map(v => v / mag);
}

// ── Authentication Test ────────────────────────────────────────────────────
async function runAuthTest() {
  const mode  = document.getElementById('auth-mode-select').value;
  const lock  = document.getElementById('auth-lock-select').value;
  const ble   = document.getElementById('ble-toggle').checked;
  const wifi  = document.getElementById('wifi-toggle').checked;
  const debug = _debugMode;

  const btn = document.getElementById('auth-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing…';

  // Show scanning state
  const authWrapper = document.getElementById('auth-cam-wrapper');
  if (authWrapper) authWrapper.classList.add('scanning');
  const authScan = document.getElementById('auth-scan-line');
  if (authScan) authScan.style.display = '';

  try {
    let embedding = null;
    let liveness_score   = 0.92;
    let anti_spoof_score = 0.88;

    if (mode === 'camera' && _authStream && _authVideo) {
      // Capture from live camera
      const canvas = document.getElementById('auth-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = _authVideo.videoWidth || 640;
      canvas.height = _authVideo.videoHeight || 480;
      ctx.drawImage(_authVideo, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const metrics = analyzeFrame(frame, canvas.width, canvas.height);
      embedding = generateEmbeddingFromFrame(frame, canvas.width, canvas.height);
      liveness_score   = Math.min(1, metrics.antiSpoof + 0.05);
      anti_spoof_score = metrics.antiSpoof;
      debugLog('Frame captured for auth', { quality: metrics.quality, antiSpoof: metrics.antiSpoof });
    } else if (mode === 'camera' && !_authStream) {
      toast('Start camera first or switch to Demo mode', 'warn');
      return;
    }
    // mode === 'demo': no embedding → backend will simulate

    const payload = {
      embedding,
      liveness_score,
      anti_spoof_score,
      ble_detected:  ble,
      wifi_matched:  wifi,
      test_mode:     mode,
      lock_simulated: lock,
      debug_mode:    debug,
    };

    debugLog('Sending auth request', { mode, lock, ble, wifi, debug, has_embedding: !!embedding });

    const r = await axios.post(`${API}/api/devlab/authenticate`, payload);
    const res = r.data;
    _lastAuthResult = res;

    // Update all panels
    updateLockPanel(res);
    updateScoreBars(res);
    updateTrustDecision(res);
    updatePipelineTrace(res);
    updateConfidenceViz(res);

    if (debug && res.debug) {
      debugLog('Raw debug data', res.debug);
    }

    // Refresh log
    if (document.getElementById('section-logs').style.display !== 'none') loadLogs();
    await refreshStats();

  } catch (err) {
    toast('Auth test error: ' + (err.response?.data?.error || err.message), 'error');
    debugLog('Auth test error', { message: err.message, status: err.response?.status });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-bolt"></i> Start Authentication Test';
    if (authWrapper) authWrapper.classList.remove('scanning');
    if (authScan) authScan.style.display = 'none';
  }
}

// ── Lock Panel Animation ───────────────────────────────────────────────────
function updateLockPanel(res) {
  const icon  = document.getElementById('lock-icon');
  const label = document.getElementById('lock-label');
  const sub   = document.getElementById('lock-sublabel');
  const name  = document.getElementById('lock-name-display');
  const lock  = document.getElementById('auth-lock-select').value;

  name.textContent = lock;
  icon.className = '';

  if (res.result === 'granted') {
    icon.innerHTML = '<i class="fas fa-lock-open" style="color:#10b981;font-size:56px"></i>';
    icon.className = 'lock-granted';
    label.textContent = 'Access Granted — Door Unlocked';
    label.style.color = '#10b981';
    sub.textContent   = res.matched_profile?.full_name ? `Welcome, ${res.matched_profile.full_name}` : '';
    sub.style.color   = '#34d399';
  } else if (res.result === 'denied') {
    icon.innerHTML = '<i class="fas fa-lock" style="color:#ef4444;font-size:56px"></i>';
    icon.className = 'lock-denied';
    label.textContent = 'Access Denied';
    label.style.color = '#ef4444';
    sub.textContent   = res.reason ? `Reason: ${res.reason.replace(/_/g, ' ')}` : '';
    sub.style.color   = '#fca5a5';
  } else if (res.result === 'pending') {
    icon.innerHTML = '<i class="fas fa-clock" style="color:#f59e0b;font-size:56px"></i>';
    label.textContent = 'Pending Approval';
    label.style.color = '#f59e0b';
    sub.textContent   = '2FA verification required';
    sub.style.color   = '#fcd34d';
  }
}

// ── Score Bars ─────────────────────────────────────────────────────────────
function updateScoreBars(res) {
  const container = document.getElementById('score-bars');
  if (!container || !res.scores) return;
  const s = res.scores;
  const bars = [
    { label: 'ArcFace',     val: s.arcface,     color: '#6366f1' },
    { label: 'InsightFace', val: s.insightface,  color: '#8b5cf6' },
    { label: 'FaceNet',     val: s.facenet,      color: '#3b82f6' },
    { label: 'Combined',    val: s.combined,     color: '#06b6d4' },
    { label: 'Final (w/ Liveness)', val: s.final, color: '#10b981' },
    { label: 'Liveness',    val: s.liveness,     color: '#22d3ee' },
    { label: 'Anti-Spoof',  val: s.anti_spoof,   color: '#f59e0b' },
    { label: 'Proximity',   val: s.proximity,    color: '#a78bfa' },
  ];
  container.innerHTML = bars.map(b => `
    <div>
      <div class="flex justify-between mb-1" style="font-size:11px;color:#94a3b8">
        <span>${b.label}</span>
        <span style="color:#e2e8f0;font-weight:600">${pct(b.val, 1)}</span>
      </div>
      <div class="score-bar-wrap">
        <div class="score-bar-fill" style="width:${(b.val||0)*100}%;background:${b.color}"></div>
      </div>
    </div>
  `).join('');
}

// ── Trust Decision Panel ───────────────────────────────────────────────────
function updateTrustDecision(res) {
  const card = document.getElementById('trust-decision-card');
  if (!card) return;
  card.style.display = '';

  const tierBadgeEl = document.getElementById('trust-tier-badge');
  const tierCls = { trusted:'badge-green', standard:'badge-blue', watchlist:'badge-yellow', blocked:'badge-red' };
  const tier = res.trust?.tier || '—';
  tierBadgeEl.className = `badge ${tierCls[tier] || 'badge-gray'}`;
  tierBadgeEl.textContent = tier;

  document.getElementById('trust-score-val').textContent = pct(res.trust?.score, 1);
  document.getElementById('liveness-val').textContent    = pct(res.scores?.liveness, 1);
  document.getElementById('antispoof-val').textContent   = pct(res.scores?.anti_spoof, 1);

  const matchRow = document.getElementById('matched-user-row');
  const denyRow  = document.getElementById('denial-reason-row');

  if (res.matched_profile) {
    matchRow.style.display = '';
    document.getElementById('matched-user-name').textContent = res.matched_profile.full_name;
    document.getElementById('matched-user-role').textContent = res.matched_profile.role;
    denyRow.style.display = 'none';
  } else if (res.reason) {
    matchRow.style.display = 'none';
    denyRow.style.display = '';
    document.getElementById('denial-reason-text').textContent = res.reason.replace(/_/g, ' ');
  } else {
    matchRow.style.display = 'none';
    denyRow.style.display = 'none';
  }
}

// ── Pipeline Trace ─────────────────────────────────────────────────────────
function updatePipelineTrace(res) {
  const card = document.getElementById('pipeline-card');
  if (!card) return;
  card.style.display = '';

  const lat = res.pipeline?.latency_ms || 0;
  document.getElementById('latency-badge').textContent = lat + ' ms';
  document.getElementById('latency-badge').className   =
    `badge ${lat < 200 ? 'badge-green' : lat < 500 ? 'badge-yellow' : 'badge-red'}`;

  const stages = ['edge', 'arcface', 'insightface', 'fusion', 'trust'];
  const reached = res.pipeline?.stage_reached || 'edge';
  const stageIdx = stages.indexOf(reached);
  const stageColors = ['#64748b', '#6366f1', '#8b5cf6', '#06b6d4', '#10b981'];

  document.getElementById('stage-badges').innerHTML = stages.map((s, i) => {
    const done = i <= stageIdx;
    return `<span class="badge" style="background:${done ? stageColors[i]+'20' : '#ffffff08'};color:${done ? stageColors[i] : '#475569'};border:1px solid ${done ? stageColors[i]+'40' : '#ffffff10'}">
      ${done ? '✓' : '○'} ${s}
    </span>`;
  }).join('') + (res.pipeline?.is_borderline ? ' <span class="badge badge-yellow">borderline</span>' : '');
}

// ── Confidence Visualization Rings ─────────────────────────────────────────
function initRingCharts() {
  const configs = [
    { id: 'ring-identity', color: '#6366f1' },
    { id: 'ring-liveness', color: '#3b82f6' },
    { id: 'ring-trust',    color: '#8b5cf6' },
  ];
  configs.forEach(({ id, color }) => {
    const canvas = document.getElementById(id);
    if (!canvas || _ringCharts[id]) return;
    const ctx = canvas.getContext('2d');
    _ringCharts[id] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [0, 100],
          backgroundColor: [color, '#1e1e3a'],
          borderWidth: 0,
          cutout: '78%',
        }]
      },
      options: { responsive: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 800 } }
    });
  });
}

function updateConfidenceViz(res) {
  if (!res.scores) return;
  const updates = [
    { id: 'ring-identity', val: res.scores.final,    label: 'ring-identity-label', text: `Confidence: ${pct(res.scores.final, 1)}` },
    { id: 'ring-liveness', val: res.scores.liveness, label: 'ring-liveness-label', text: `Liveness: ${pct(res.scores.liveness, 1)}` },
    { id: 'ring-trust',    val: res.trust?.score,    label: 'ring-trust-label',    text: `Trust: ${pct(res.trust?.score, 1)} (${res.trust?.tier})` },
  ];
  updates.forEach(({ id, val, label, text }) => {
    const chart = _ringCharts[id];
    if (chart) {
      const v = (val || 0) * 100;
      chart.data.datasets[0].data = [v, 100 - v];
      chart.update();
    }
    const valEl = document.getElementById(id + '-val');
    if (valEl) valEl.textContent = pct(val, 0);
    const labelEl = document.getElementById(label);
    if (labelEl) labelEl.textContent = text;
  });

  // Update score breakdown table
  const s = res.scores;
  const t = res.trust || {};
  const breakdown = document.getElementById('score-breakdown-table');
  if (breakdown) {
    const rows = [
      ['Face Similarity (raw)', s.similarity, '#6366f1'],
      ['ArcFace Score',         s.arcface,    '#6366f1'],
      ['InsightFace Score',     s.insightface,'#8b5cf6'],
      ['FaceNet Score',         s.facenet,    '#3b82f6'],
      ['Combined (fused)',      s.combined,   '#06b6d4'],
      ['Final (w/ liveness)',   s.final,      '#10b981'],
      ['Liveness Score',        s.liveness,   '#22d3ee'],
      ['Anti-Spoof Score',      s.anti_spoof, '#f59e0b'],
      ['Proximity Score',       s.proximity,  '#a78bfa'],
      ['Trust Score',           t.score,      '#ec4899'],
    ];
    breakdown.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #1e1e3a;color:#64748b">
          <th style="padding:8px 12px;text-align:left">Metric</th>
          <th style="padding:8px 12px;text-align:left">Score</th>
          <th style="padding:8px 12px;text-align:left;width:50%">Visual</th>
        </tr></thead>
        <tbody>
          ${rows.map(([name, val, color]) => `
            <tr class="log-row">
              <td style="padding:7px 12px;color:#e2e8f0">${name}</td>
              <td style="padding:7px 12px;color:${color};font-weight:700;font-family:monospace">${fmt(val)}</td>
              <td style="padding:7px 12px">
                <div class="score-bar-wrap">
                  <div class="score-bar-fill" style="width:${(val||0)*100}%;background:${color}"></div>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  // Also update confidence section rings if that section is open
  initRingCharts();
}

// ── Confidence History Chart ───────────────────────────────────────────────
async function loadConfidenceHistory() {
  try {
    const r = await axios.get(`${API}/api/devlab/logs?limit=20`);
    const logs = (r.data.logs || []).reverse();
    const canvas = document.getElementById('history-chart');
    if (!canvas) return;
    if (_historyChart) { _historyChart.destroy(); _historyChart = null; }
    const ctx = canvas.getContext('2d');
    _historyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: logs.map((_, i) => `#${i+1}`),
        datasets: [
          {
            label: 'Combined Conf',
            data: logs.map(l => ((l.combined_confidence || 0) * 100).toFixed(1)),
            borderColor: '#6366f1', backgroundColor: '#6366f120',
            tension: 0.4, fill: true, pointRadius: 4,
          },
          {
            label: 'ArcFace',
            data: logs.map(l => ((l.arcface_score || 0) * 100).toFixed(1)),
            borderColor: '#8b5cf6', backgroundColor: 'transparent',
            tension: 0.4, pointRadius: 3, borderDash: [4, 3],
          },
          {
            label: 'Trust Score',
            data: logs.map(l => ((l.trust_score || 0) * 100).toFixed(1)),
            borderColor: '#10b981', backgroundColor: 'transparent',
            tension: 0.4, pointRadius: 3,
          },
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: { min: 0, max: 100, grid: { color: '#1e1e3a' }, ticks: { color: '#64748b' } },
          x: { grid: { color: '#1e1e3a' }, ticks: { color: '#64748b' } },
        },
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        }
      }
    });
  } catch (err) {
    debugLog('History chart error', { message: err.message });
  }
}

// ── Profile Management ─────────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const r = await axios.get(`${API}/api/devlab/profiles`);
    _profiles = r.data.profiles || [];
    const container = document.getElementById('profiles-list');
    if (!container) return;
    if (_profiles.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:#475569;padding:40px;font-size:13px">
        <i class="fas fa-user-plus" style="font-size:32px;opacity:.3;display:block;margin-bottom:10px"></i>
        No test profiles yet — create one using the form
      </div>`;
      return;
    }
    container.innerHTML = _profiles.map(p => `
      <div class="card-sm mb-3" style="border-color:${p.face_registered ? '#10b98130' : '#1e1e3a'}">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div style="width:40px;height:40px;border-radius:50%;background:#6366f120;border:2px solid ${p.face_registered ? '#10b981' : '#2d2d50'};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:${p.face_registered ? '#10b981' : '#6366f1'}">
              ${p.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#e2e8f0">${p.full_name}</div>
              <div style="font-size:11px;color:#64748b">${p.email}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="badge ${p.role === 'admin' ? 'badge-purple' : p.role === 'visitor' ? 'badge-yellow' : 'badge-blue'}">${p.role}</span>
            ${p.face_registered
              ? `<span class="badge badge-green"><i class="fas fa-check"></i> Enrolled (${p.embedding_count})</span>`
              : `<span class="badge badge-red"><i class="fas fa-times"></i> Not Enrolled</span>`}
          </div>
        </div>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-ghost btn-sm" onclick="enrollProfile('${p.id}')">
            <i class="fas fa-camera"></i> Enroll
          </button>
          <button class="btn btn-ghost btn-sm" onclick="testProfile('${p.id}')">
            <i class="fas fa-bolt"></i> Test Auth
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteProfile('${p.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        ${p.notes ? `<div style="font-size:11px;color:#475569;margin-top:6px"><i class="fas fa-sticky-note mr-1"></i>${p.notes}</div>` : ''}
        <div style="font-size:10px;color:#334155;margin-top:4px">ID: ${p.id} · Created: ${timeAgo(p.created_at)}</div>
      </div>
    `).join('');
    // Also refresh select
    await populateProfileSelect();
  } catch (err) {
    toast('Failed to load profiles: ' + err.message, 'error');
  }
}

async function createProfile() {
  const name  = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const role  = document.getElementById('new-role').value;
  const device = document.getElementById('new-device-id').value.trim();
  const notes = document.getElementById('new-notes').value.trim();

  if (!name)  { toast('Full name is required', 'warn'); return; }
  if (!email) { toast('Email is required', 'warn'); return; }

  try {
    const r = await axios.post(`${API}/api/devlab/profiles`, { full_name: name, email, role, phone_device_id: device, notes });
    toast(`Profile created: ${name}`, 'success');
    // Clear form
    ['new-name','new-email','new-device-id','new-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('new-role').value = 'employee';
    await loadProfiles();
    debugLog('Profile created', r.data.profile);
  } catch (err) {
    toast('Create failed: ' + (err.response?.data?.error || err.message), 'error');
  }
}

function enrollProfile(id) {
  showSection('enroll');
  setTimeout(() => {
    const sel = document.getElementById('enroll-profile-select');
    if (sel) {
      sel.value = id;
      sel.dispatchEvent(new Event('change'));
    }
  }, 100);
}

function testProfile(id) {
  // Set the selected profile in auth section and start demo
  showSection('auth');
  setTimeout(() => {
    const modeEl = document.getElementById('auth-mode-select');
    if (modeEl) modeEl.value = 'demo';
    toast('Demo mode: testing profile ' + id.substring(0, 12), 'info');
  }, 100);
}

async function deleteProfile(id) {
  const profile = _profiles.find(p => p.id === id);
  if (!confirm(`Delete profile "${profile?.full_name}"? This will remove all embeddings.`)) return;
  try {
    await axios.delete(`${API}/api/devlab/profiles/${id}`);
    toast('Profile deleted', 'info');
    await loadProfiles();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ── Security Log ───────────────────────────────────────────────────────────
async function loadLogs() {
  const filter = document.getElementById('log-filter')?.value || '';
  try {
    const r = await axios.get(`${API}/api/devlab/logs?limit=50${filter ? '&decision=' + filter : ''}`);
    const logs = r.data.logs || [];
    const tbody = document.getElementById('log-tbody');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#475569">No log entries yet — run an authentication test</td></tr>';
    } else {
      tbody.innerHTML = logs.map(l => `
        <tr class="log-row">
          <td style="padding:7px 10px;color:#94a3b8;white-space:nowrap">${timeAgo(l.created_at)}</td>
          <td style="padding:7px 10px">${decisionBadge(l.decision)}</td>
          <td style="padding:7px 10px;color:#e2e8f0">${l.matched_name || '<span style="color:#475569">—</span>'}</td>
          <td style="padding:7px 10px;font-family:monospace;color:#6366f1">${fmt(l.similarity_score)}</td>
          <td style="padding:7px 10px;font-family:monospace;color:#3b82f6">${fmt(l.combined_confidence)}</td>
          <td style="padding:7px 10px">
            <span class="badge ${l.trust_tier === 'trusted' ? 'badge-green' : l.trust_tier === 'standard' ? 'badge-blue' : l.trust_tier === 'watchlist' ? 'badge-yellow' : 'badge-gray'}" style="font-size:10px">${l.trust_tier || '—'}</span>
            <span style="font-family:monospace;font-size:11px;color:#8b5cf6;margin-left:4px">${fmt(l.trust_score)}</span>
          </td>
          <td style="padding:7px 10px;font-family:monospace;color:#f59e0b">${l.pipeline_latency_ms != null ? l.pipeline_latency_ms + 'ms' : '—'}</td>
          <td style="padding:7px 10px;color:#64748b;font-size:11px">${l.lock_simulated || '—'}</td>
          <td style="padding:7px 10px">
            <span class="badge badge-gray" style="font-size:10px">${l.test_mode || '—'}</span>
            ${l.is_borderline ? '<span class="badge badge-yellow" style="font-size:10px;margin-left:2px">borderline</span>' : ''}
          </td>
        </tr>
      `).join('');
    }

    // Update stats
    const statsR = await axios.get(`${API}/api/devlab/stats`);
    const a = statsR.data.attempts || {};
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('log-stat-total',   a.total_attempts || 0);
    setEl('log-stat-granted', a.granted || 0);
    setEl('log-stat-denied',  a.denied  || 0);
    setEl('log-stat-conf',    pct(a.avg_confidence, 1));
    setEl('log-stat-lat',     a.avg_latency_ms ? Math.round(a.avg_latency_ms) + 'ms' : '—');
  } catch (err) {
    toast('Failed to load logs: ' + err.message, 'error');
  }
}

async function clearLogs() {
  if (!confirm('Clear all security log entries?')) return;
  try {
    await axios.delete(`${API}/api/devlab/logs`);
    toast('Logs cleared', 'info');
    await loadLogs();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── Dev Controls ───────────────────────────────────────────────────────────
function toggleDebug(enabled) {
  _debugMode = enabled;
  // Sync checkboxes
  ['debug-toggle', 'ctrl-debug'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = enabled;
  });
  const badge = document.getElementById('debug-badge');
  if (badge) badge.style.display = enabled ? '' : 'none';
  toast(enabled ? 'Debug mode enabled' : 'Debug mode disabled', 'info');
}

async function resetLab() {
  if (!confirm('Reset lab? This clears all embeddings and logs, but keeps profiles.')) return;
  try {
    const r = await axios.delete(`${API}/api/devlab/reset`);
    toast(r.data.message, 'info');
    _capturedAngles = {};
    renderAngleDots();
    document.getElementById('enroll-complete').style.display = 'none';
    await refreshStats();
    await loadProfiles();
  } catch (err) {
    toast('Reset failed: ' + err.message, 'error');
  }
}

async function deleteAllProfiles() {
  if (!confirm('Delete ALL test profiles, embeddings, and logs? This cannot be undone.')) return;
  try {
    const r = await axios.get(`${API}/api/devlab/profiles`);
    const profiles = r.data.profiles || [];
    for (const p of profiles) {
      await axios.delete(`${API}/api/devlab/profiles/${p.id}`);
    }
    await axios.delete(`${API}/api/devlab/logs`);
    toast(`Deleted ${profiles.length} profiles`, 'info');
    _profiles = [];
    _capturedAngles = {};
    renderAngleDots();
    await refreshStats();
    await loadProfiles();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function loadLabStats() {
  try {
    const r = await axios.get(`${API}/api/devlab/stats`);
    const d = r.data;
    const a = d.attempts || {};
    const container = document.getElementById('lab-stats-panel');
    if (!container) return;
    const grantRate = a.total_attempts > 0 ? (a.granted / a.total_attempts * 100).toFixed(1) : 0;
    container.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Total Profiles</div>
          <div style="font-size:22px;font-weight:700;color:#6366f1">${d.profiles?.total || 0}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Enrolled</div>
          <div style="font-size:22px;font-weight:700;color:#10b981">${d.profiles?.enrolled || 0}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Total Tests</div>
          <div style="font-size:22px;font-weight:700;color:#e2e8f0">${a.total_attempts || 0}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Grant Rate</div>
          <div style="font-size:22px;font-weight:700;color:#10b981">${grantRate}%</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Avg Confidence</div>
          <div style="font-size:18px;font-weight:700;color:#6366f1">${pct(a.avg_confidence, 1)}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Avg Latency</div>
          <div style="font-size:18px;font-weight:700;color:#f59e0b">${a.avg_latency_ms ? Math.round(a.avg_latency_ms) + 'ms' : '—'}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Avg Anti-Spoof</div>
          <div style="font-size:18px;font-weight:700;color:#10b981">${pct(a.avg_anti_spoof, 1)}</div>
        </div>
        <div class="card-sm text-center">
          <div style="font-size:10px;color:#64748b">Borderline</div>
          <div style="font-size:18px;font-weight:700;color:#f59e0b">${a.borderline_count || 0}</div>
        </div>
      </div>
    `;
  } catch {}
}

// ── Initialization ─────────────────────────────────────────────────────────
(async function init() {
  // Render initial angle dots
  renderAngleDots();
  // Highlight first angle
  setActiveAngle(0);
  // Load stats
  await refreshStats();
  // Load profiles for select
  await populateProfileSelect();
  // Auto-refresh stats every 10s
  setInterval(refreshStats, 10000);
})();
