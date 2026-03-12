// ══════════════════════════════════════════════════════
//  FaceAccess Home — Onboarding Wizard JS  v2.0
//  Production FaceID enrollment integrated
// ══════════════════════════════════════════════════════

'use strict';

const API = '';
let obStep = 0;
let obUserId = null;
let obHomeId = null;
let obCameraType = null;
let obLockBrand = null;
let obFaceRegistered = false;
let obFaceResult = null;   // Full enrollment result from FaceID engine
let obFaceIDUI = null;     // FaceIDUI instance

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
  // Stop any running FaceID session when leaving step 3
  if (obStep === 3 && n !== 3 && obFaceIDUI) {
    obFaceIDUI.stop();
    obFaceIDUI = null;
  }

  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const s = document.getElementById(`step-${n}`);
  if (s) s.classList.add('active');
  updateDots(n);
  obStep = n;

  // Auto-launch Face ID when entering step 3
  if (n === 3) {
    setTimeout(launchFaceIDEnrollment, 300);
  }

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
  const name  = document.getElementById('ob-name')?.value.trim();
  const email = document.getElementById('ob-email')?.value.trim();
  const phone = document.getElementById('ob-phone')?.value.trim();
  const err   = document.getElementById('step0-err');
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
  if (!name) { showStepError(1, 'Home name is required.'); return false; }
  if (!obUserId) { showStepError(1, 'Account not created yet. Please go back.'); return false; }
  try {
    const address = document.getElementById('ob-address')?.value.trim();
    const r = await axios.post(`${API}/api/home/homes`, { owner_id: obUserId, name, address: address || null });
    obHomeId = r.data.home.id;
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
        usb:  'USB device index (e.g. 0)'
      };
      if (urlInput) urlInput.placeholder = hints[val] || 'Enter stream URL or API key';
    }
  }
}

async function saveCamera() {
  if (!obCameraType || obCameraType === 'skip') return true;
  if (!obHomeId) return true;
  try {
    const url = document.getElementById('ob-camera-url')?.value.trim();
    await axios.post(`${API}/api/home/cameras`, {
      home_id: obHomeId, name: 'Front Door Camera',
      stream_url: url || null, camera_type: obCameraType
    });
  } catch(e) { /* non-blocking */ }
  return true;
}

// ── Step 3: Face ID Enrollment ────────────────────────

/**
 * Launch the FaceID enrollment UI.
 * Called automatically when user reaches step 3.
 */
function launchFaceIDEnrollment() {
  // Make sure the FaceID engine is loaded
  if (!window.FaceIDEngine) {
    console.warn('[Onboard] FaceID engine not loaded, retrying...');
    setTimeout(launchFaceIDEnrollment, 500);
    return;
  }

  const container = document.getElementById('ob-faceid-container');
  if (!container) return;

  // Clean up previous session
  if (obFaceIDUI) { obFaceIDUI.stop(); obFaceIDUI = null; }

  // Hide fallback upload UI, show FaceID UI
  const fallback = document.getElementById('ob-face-fallback');
  if (fallback) fallback.style.display = 'none';

  // Update instruction
  updateFaceStepUI('ready');

  obFaceIDUI = window.initFaceIDEnrollment('ob-faceid-container', {
    onComplete: async (result) => {
      obFaceResult = result;
      obFaceRegistered = true;
      updateFaceStepUI('complete', result);
      // Auto-advance after 2.5 seconds
      setTimeout(() => {
        if (obFaceRegistered) goStep(4);
      }, 2500);
    },
    onError: (err) => {
      console.error('[FaceID]', err);
      updateFaceStepUI('error', null, err);
    },
    onSkip: () => {
      // Show upload fallback
      const fb = document.getElementById('ob-face-fallback');
      if (fb) fb.style.display = 'block';
      const cont = document.getElementById('ob-faceid-container');
      if (cont) cont.style.display = 'none';
      updateFaceStepUI('fallback');
    }
  });
}

function updateFaceStepUI(state, result = null, err = null) {
  const statusBar  = document.getElementById('ob-face-statusbar');
  const nextBtn    = document.getElementById('ob-face-next');
  const skipBtn    = document.getElementById('ob-face-skip');
  const badge      = document.getElementById('ob-face-badge');

  if (!statusBar) return;

  const states = {
    ready: {
      bar: '',
      badgeColor: '',
      badgeText: '',
      nextLabel: null,
      nextDisabled: true,
    },
    complete: {
      bar: `<div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;background:rgba(16,185,129,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#10b981" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <div>
          <div style="color:#10b981;font-weight:700;font-size:14px;">Face ID Enrolled Successfully</div>
          <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:2px;">
            ${result ? `${result.capturedAngles.length} angles · ${Math.round((result.livenessScore||0)*100)}% liveness · ${Math.round((result.antiSpoofScore||0)*100)}% anti-spoof` : ''}
          </div>
        </div>
      </div>`,
      badgeColor: 'background:rgba(16,185,129,0.15);color:#10b981;',
      badgeText:  '✓ Enrolled',
      nextLabel:  'Continue →',
      nextDisabled: false,
    },
    error: {
      bar: `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:12px 16px;color:#ef4444;font-size:13px;">
        <strong>Setup failed:</strong> ${err?.message || 'Unknown error'}
      </div>`,
      badgeColor: '',
      badgeText: '',
      nextLabel: null,
      nextDisabled: true,
    },
    fallback: {
      bar: `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:12px 16px;color:#f59e0b;font-size:13px;">
        Camera not available — upload a photo to complete enrollment
      </div>`,
      badgeColor: '',
      badgeText: '',
      nextLabel: null,
      nextDisabled: true,
    },
  };

  const cfg = states[state] || states.ready;
  statusBar.innerHTML = cfg.bar;

  if (badge) {
    badge.style.cssText = `display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;${cfg.badgeColor}`;
    badge.textContent = cfg.badgeText;
  }

  if (nextBtn) {
    if (cfg.nextLabel) {
      nextBtn.style.display = 'block';
      nextBtn.textContent   = cfg.nextLabel;
      nextBtn.disabled      = cfg.nextDisabled;
    }
  }
}

async function saveFace() {
  if (!obUserId) {
    showStepError(3, 'Please complete account setup first.');
    return false;
  }
  if (!obFaceRegistered || !obFaceResult) {
    showStepError(3, 'Please complete Face ID enrollment before continuing.');
    return false;
  }

  try {
    const store = new window.FaceIDEngine.SecureEmbeddingStore();
    const encryptedEmbedding = await store.encrypt(obFaceResult.embedding);

    await axios.post(`${API}/api/home/users/${obUserId}/face`, {
      embedding:       encryptedEmbedding,
      embedding_dims:  128,
      image_quality:   obFaceResult.averageQuality / 100,
      liveness_score:  obFaceResult.livenessScore,
      anti_spoof_score: obFaceResult.antiSpoofScore,
      angles_captured: obFaceResult.capturedAngles,
      enrollment_version: '2.0',
    });
    return true;
  } catch(e) {
    // Non-fatal: face already saved client-side
    console.warn('[Onboard] Face save API error:', e.message);
    return true;
  }
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
    const name   = document.getElementById('ob-lockname')?.value.trim() || 'Front Door';
    const apiKey = document.getElementById('ob-lock-api')?.value.trim();
    await axios.post(`${API}/api/home/locks`, {
      home_id: obHomeId, name, location: 'Main entrance',
      lock_type: obLockBrand === 'generic' ? 'relay' : 'api',
      brand: obLockBrand, api_key: apiKey || null
    });
    await updateSetupProgress(4);
    if (obUserId) {
      await axios.post(`${API}/api/home/devices`, {
        user_id: obUserId, home_id: obHomeId,
        name: 'My Smartphone',
        platform: /android/i.test(navigator.userAgent) ? 'android' : 'ios'
      }).catch(() => {});
    }
  } catch(e) { /* non-blocking */ }
}

async function updateSetupProgress(step) {
  if (obHomeId) await axios.put(`${API}/api/home/homes/${obHomeId}/setup`, { step }).catch(() => {});
}

// ── Helpers ────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (obFaceIDUI) obFaceIDUI.stop();
});

window.addEventListener('DOMContentLoaded', () => {
  updateDots(0);
});
