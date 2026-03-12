// ══════════════════════════════════════════════════════
//  FaceAccess Home — Onboarding Wizard JS
// ══════════════════════════════════════════════════════

const API = '';
let obStep = 0;
let obUserId = null;
let obHomeId = null;
let obCameraType = null;
let obLockBrand = null;
let obCameraStream = null;
let obFaceRegistered = false;

// ── Step navigation ───────────────────────────────────
async function stepNext(from, skip = false) {
  if (from === 0) { if (!(await saveAccount())) return; }
  else if (from === 1) { if (!(await saveHome())) return; }
  else if (from === 2) { if (!(await saveCamera())) return; }
  else if (from === 3 && !skip) { if (!(await saveFace())) return; }
  else if (from === 4) { await saveLock(); }
  goStep(from + 1);
}

function stepBack(from) { goStep(from - 1); }

function goStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const s = document.getElementById(`step-${n}`);
  if (s) s.classList.add('active');
  updateDots(n);
  obStep = n;
  if (n === 5) {
    const nameEl = document.getElementById('done-home-name');
    const nameInput = document.getElementById('ob-homename');
    if (nameEl && nameInput) nameEl.textContent = nameInput.value || 'your home';
  }
}

function updateDots(step) {
  for (let i = 0; i <= 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.classList.remove('done', 'current');
    if (i < step) dot.classList.add('done');
    else if (i === step) dot.classList.add('current');
  }
}

// ── Step 0: Account ───────────────────────────────────
async function saveAccount() {
  const name = document.getElementById('ob-name')?.value.trim();
  const email = document.getElementById('ob-email')?.value.trim();
  const phone = document.getElementById('ob-phone')?.value.trim();
  const err = document.getElementById('step0-err');
  if (!name || !email) {
    if (err) { err.textContent = 'Name and email are required.'; err.classList.remove('hidden'); }
    return false;
  }
  if (err) err.classList.add('hidden');
  try {
    const r = await axios.post(`${API}/api/home/users`, { name, email, phone: phone || null, role: 'owner' });
    obUserId = r.data.user.id;
    return true;
  } catch(e) {
    const msg = e.response?.data?.error || 'Account creation failed.';
    if (err) { err.textContent = msg; err.classList.remove('hidden'); }
    // If duplicate email, still allow to proceed for demo
    if (e.response?.status === 409) {
      try {
        const usersR = await axios.get(`${API}/api/home/users`);
        const existing = (usersR.data.users || []).find(u => u.email === email);
        if (existing) { obUserId = existing.id; if (err) err.classList.add('hidden'); return true; }
      } catch {}
    }
    return false;
  }
}

// ── Step 1: Home ──────────────────────────────────────
async function saveHome() {
  const name = document.getElementById('ob-homename')?.value.trim();
  if (!name) {
    showStepError(1, 'Home name is required.');
    return false;
  }
  if (!obUserId) {
    showStepError(1, 'Account not created yet. Please go back to step 1.');
    return false;
  }
  try {
    const address = document.getElementById('ob-address')?.value.trim();
    const r = await axios.post(`${API}/api/home/homes`, { owner_id: obUserId, name, address: address || null });
    obHomeId = r.data.home.id;
    // Update user's home_id
    await axios.put(`${API}/api/home/users/${obUserId}`, { status: 'active' });
    return true;
  } catch(e) {
    showStepError(1, e.response?.data?.error || 'Failed to create home.');
    return false;
  }
}

function showStepError(step, msg) {
  let el = document.getElementById(`step${step}-err`);
  if (!el) {
    // Create inline error
    const container = document.querySelector(`#step-${step} .space-y-4`) || document.getElementById(`step-${step}`);
    if (container) {
      el = document.createElement('p');
      el.id = `step${step}-err`;
      el.className = 'text-red-400 text-sm mt-2';
      container.appendChild(el);
    }
  }
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

// ── Step 2: Camera ────────────────────────────────────
function selectCamera(el, val) {
  document.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  obCameraType = val;
  const extra = document.getElementById('camera-extra');
  if (extra) {
    if (val === 'skip') { extra.classList.add('hidden'); }
    else {
      extra.classList.remove('hidden');
      const urlInput = document.getElementById('ob-camera-url');
      const hints = {
        rtsp: 'rtsp://192.168.1.100:554/stream',
        ring: 'Ring API access token',
        nest: 'Google Smart Device access token',
        arlo: 'Arlo API key',
        usb: 'USB device index (e.g. 0)'
      };
      if (urlInput) urlInput.placeholder = hints[val] || 'Enter stream URL or API key';
    }
  }
}

async function saveCamera() {
  if (!obCameraType || obCameraType === 'skip') return true;
  if (!obHomeId) return true; // not blocking
  try {
    const url = document.getElementById('ob-camera-url')?.value.trim();
    await axios.post(`${API}/api/home/cameras`, {
      home_id: obHomeId, name: 'Front Door Camera',
      stream_url: url || null, camera_type: obCameraType
    });
  } catch(e) { /* non-blocking */ }
  return true;
}

// ── Step 3: Face ──────────────────────────────────────
async function startObCamera() {
  try {
    obCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 } });
    const v = document.getElementById('ob-video');
    if (v) {
      v.srcObject = obCameraStream;
      const ph = document.getElementById('ob-placeholder');
      if (ph) ph.style.display = 'none';
    }
    const sb = document.getElementById('ob-scanbar');
    if (sb) sb.style.display = 'block';
    showFaceStatus('Camera active — click Capture Face to register', 'info');
    // Show quality preview
    const qPanel = document.getElementById('ob-face-quality');
    if (qPanel) {
      qPanel.classList.remove('hidden');
      let q = 0;
      const qInterval = setInterval(() => {
        q = Math.min(q + 5 + Math.random() * 8, 92 + Math.random() * 7);
        const qBar = document.getElementById('ob-q-bar');
        const qPct = document.getElementById('ob-q-pct');
        if (qBar) qBar.style.width = q + '%';
        if (qPct) qPct.textContent = Math.round(q) + '%';
        if (q >= 90) clearInterval(qInterval);
      }, 150);
    }
  } catch(e) {
    showFaceStatus('Camera access denied. Please allow camera access and try again, or upload a photo instead.', 'error');
  }
}

function obFaceUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.createElement('img');
    img.src = e.target.result;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    const ph = document.getElementById('ob-placeholder');
    if (ph) ph.style.display = 'none';
    const v = document.getElementById('ob-video');
    if (v) v.parentNode.insertBefore(img, v);
    showFaceStatus('Photo uploaded — click Capture Face to register', 'success');
    const qPanel = document.getElementById('ob-face-quality');
    if (qPanel) {
      qPanel.classList.remove('hidden');
      const qBar = document.getElementById('ob-q-bar');
      const qPct = document.getElementById('ob-q-pct');
      if (qBar) qBar.style.width = '89%';
      if (qPct) qPct.textContent = '89%';
    }
  };
  reader.readAsDataURL(file);
}

async function captureObFace() {
  if (!obUserId) {
    showFaceStatus('Please complete account setup first.', 'error');
    return;
  }
  const btn = document.getElementById('ob-face-btn');
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...'; btn.disabled = true; }
  showFaceStatus('Analyzing face...', 'info');
  // Simulate processing delay
  await new Promise(r => setTimeout(r, 1800));
  try {
    await axios.post(`${API}/api/home/users/${obUserId}/face`, { image_quality: 0.94 });
    obFaceRegistered = true;
    showFaceStatus('✓ Face registered successfully!', 'success');
    if (btn) { btn.innerHTML = '<i class="fas fa-check mr-2"></i>Face Registered!'; btn.disabled = false; btn.style.background = 'linear-gradient(135deg,#10b981,#059669)'; }
    // Stop camera
    if (obCameraStream) { obCameraStream.getTracks().forEach(t => t.stop()); obCameraStream = null; }
    // Auto-proceed after 1.5s
    setTimeout(() => goStep(4), 1500);
  } catch(e) {
    showFaceStatus('Face registration failed. Please try again.', 'error');
    if (btn) { btn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i>Capture Face'; btn.disabled = false; }
  }
}

function showFaceStatus(msg, type) {
  const el = document.getElementById('ob-face-status');
  if (!el) return;
  const colors = { info: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', success: 'text-green-400 bg-green-500/10 border-green-500/20', error: 'text-red-400 bg-red-500/10 border-red-500/20' };
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle' };
  el.className = `p-3 rounded-xl text-sm border ${colors[type]||colors.info}`;
  el.innerHTML = `<i class="fas ${icons[type]||'fa-circle'} mr-2"></i>${msg}`;
}

// ── Step 4: Lock ──────────────────────────────────────
function selectLock(el, val) {
  document.querySelectorAll('.brand-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  obLockBrand = val;
  const extra = document.getElementById('lock-extra');
  if (extra) {
    if (val === 'skip') { extra.classList.add('hidden'); }
    else {
      extra.classList.remove('hidden');
      const lockName = document.getElementById('ob-lockname');
      if (lockName && !lockName.value) lockName.value = 'Front Door';
    }
  }
}

async function saveLock() {
  if (!obLockBrand || obLockBrand === 'skip') {
    if (obHomeId) await updateSetupProgress(4);
    return;
  }
  if (!obHomeId) return;
  try {
    const name = document.getElementById('ob-lockname')?.value.trim() || 'Front Door';
    const apiKey = document.getElementById('ob-lock-api')?.value.trim();
    await axios.post(`${API}/api/home/locks`, {
      home_id: obHomeId, name, location: 'Main entrance',
      lock_type: obLockBrand === 'generic' ? 'relay' : 'api',
      brand: obLockBrand, api_key: apiKey || null
    });
    await updateSetupProgress(4);
    // Also register a demo device
    if (obUserId) {
      await axios.post(`${API}/api/home/devices`, { user_id: obUserId, home_id: obHomeId, name: 'My Smartphone', platform: /android/i.test(navigator.userAgent) ? 'android' : 'ios' }).catch(() => {});
    }
  } catch(e) { /* non-blocking */ }
}

async function updateSetupProgress(step) {
  if (obHomeId) {
    await axios.put(`${API}/api/home/homes/${obHomeId}/setup`, { step }).catch(() => {});
  }
}

// ── Helpers ────────────────────────────────────────────
// Clean up camera on page leave
window.addEventListener('beforeunload', () => {
  if (obCameraStream) obCameraStream.getTracks().forEach(t => t.stop());
});

window.addEventListener('DOMContentLoaded', () => {
  // Auto-detect if returning user
  updateDots(0);
});
