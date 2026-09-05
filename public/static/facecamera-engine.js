// ═══════════════════════════════════════════════════════════════════════════════
// FaceAccessCameraEngine  v3.0  — Camera + real face recognition (face-api.js)
// ═══════════════════════════════════════════════════════════════════════════════
//
// v3.0 replaces the previous pixel-statistics "embedding" with a real face
// recognition pipeline running fully in the browser:
//
//   • Detection   : TinyFaceDetector (face-api.js)            ~190 KB
//   • Landmarks   : 68-point FaceLandmark68Net                 ~350 KB
//   • Descriptor  : dlib ResNet-34 FaceRecognitionNet (128-d)  ~6.4 MB
//
// Models are self-hosted under /static/models and loaded once per page.
// Descriptors are compared server-side using Euclidean distance (same metric
// as dlib / face-api); a distance below ~0.45-0.55 is the same person.
//
// Liveness: the user follows a 5-step head-movement challenge (hold still, turn
// left, turn right, look up, look down). Head pose is estimated from landmarks,
// so a printed photo or static screen cannot complete the challenge.
//
// USAGE (unchanged from v2):
//   const session = FaceAccessCameraEngine.createEnrollmentSession(cfg)
//   const session = FaceAccessCameraEngine.createVerificationSession(cfg)
//
// cfg:
//   containerId   string         — element to mount into
//   onComplete    fn(result)     — { descriptor:number[128], descriptors:number[][],
//                                    embedding (alias of descriptor), livenessScore,
//                                    antiSpoofScore, quality, averageQuality, steps,
//                                    capturedAngles, capturedSteps, engine, version }
//   onError?      fn(err)        — { code, message }
//   onProgress?   fn(step,total,stepDef)
//   onFaceFound?  fn()
//   autoStart?    boolean (true) | facingMode? | deviceId? | title? | showRestartBtn? | showCancelBtn?
// ═══════════════════════════════════════════════════════════════════════════════
;(function (global) {
  'use strict';

  const VERSION     = '3.0';
  const ENGINE_NAME = 'face-api.js / dlib ResNet-34 (128-d)';
  const MODEL_URL   = '/static/models';
  const VENDOR_URL  = '/static/vendor/face-api.js';
  const VIDEO_W = 640, VIDEO_H = 480;
  const TICK_MS = 120;               // detection cadence (~8 fps) — light on CPU

  const MOVEMENT_STEPS = [
    { id: 'center', label: 'Hold still', icon: '⊙', direction: null,  instruction: 'Center your face and hold still',      holdMs: 1800, arrowAnim: null },
    { id: 'left',   label: 'Turn left',  icon: '←', direction: 'left', instruction: 'Slowly turn your head to the LEFT',    holdMs: 0,    arrowAnim: 'left' },
    { id: 'right',  label: 'Turn right', icon: '→', direction: 'right',instruction: 'Slowly turn your head to the RIGHT',   holdMs: 0,    arrowAnim: 'right' },
    { id: 'up',     label: 'Look up',    icon: '↑', direction: 'up',   instruction: 'Tilt your head slightly UP',           holdMs: 0,    arrowAnim: 'up' },
    { id: 'down',   label: 'Look down',  icon: '↓', direction: 'down', instruction: 'Tilt your head slightly DOWN',         holdMs: 0,    arrowAnim: 'down' },
  ];
  const YAW_THRESHOLD   = 0.09;   // normalized nose offset change
  const PITCH_THRESHOLD = 0.07;
  const MOVE_TIMEOUT_MS = 4500;   // per movement step on a GPU; scaled up when inference is slow (see adaptive timing)
  const FACE_DETECT_MS  = 10000;
  const MIN_TICKS_PER_STEP = 6;   // guarantee at least this many detections per movement step regardless of device speed
  const MIN_HOLD_TICKS     = 3;   // 'center' step: minimum consecutive steady detections
  const FACE_LOST_MS    = 1500;
  const MIN_MOVEMENTS   = 2;      // liveness requires at least 2 of 4 movements
  const MIN_FACE_FRAC   = 0.18;   // face box width / frame width — too small = move closer

  // ─── Model loading (shared across sessions) ─────────────────────────────────
  let _modelsPromise = null;
  let _modelsReady = false;
  const _readyListeners = [];

  function _injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  let _backend = null;
  async function _selectBackend(fa) {
    const tf = fa && fa.tf;
    if (!tf || !tf.setBackend) return;
    // Remove the 'wasm' backend from consideration — its .wasm binaries are not bundled.
    try { if (tf.findBackendFactory && tf.findBackendFactory('wasm') && tf.removeBackend) tf.removeBackend('wasm'); } catch (_) {}
    for (const name of ['webgl', 'cpu']) {
      try {
        if (await tf.setBackend(name)) { await tf.ready(); _backend = tf.getBackend(); break; }
      } catch (_) { /* try next */ }
    }
    if (!_backend) throw new Error('No usable TensorFlow.js backend (webgl/cpu) in this browser');
    if (_backend !== 'webgl') console.warn('[FaceAccessCameraEngine] WebGL unavailable — running on CPU backend (slower, still functional)');
  }

  function ensureModels() {
    if (_modelsPromise) return _modelsPromise;
    _modelsPromise = (async () => {
      if (!global.faceapi) await _injectScript(VENDOR_URL);
      const fa = global.faceapi;
      if (!fa) throw new Error('face-api.js not available');
      // Backend selection. Prefer WebGL (GPU). If WebGL is unavailable (VMs, remote desktops,
      // GPU-blocklisted laptops, privacy browsers), TF's next priority is 'wasm' — whose binaries
      // we do NOT ship — so we must explicitly fall back to the pure-JS 'cpu' backend, otherwise
      // model loading throws and the user sees a generic "engine failed" error.
      await _selectBackend(fa);
      await Promise.all([
        fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      _modelsReady = true;
      _readyListeners.splice(0).forEach(fn => { try { fn(); } catch (_) {} });
      return fa;
    })();
    _modelsPromise.catch(() => { _modelsPromise = null; });
    return _modelsPromise;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function euclidean(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
  function meanDescriptor(list) {
    const n = list.length, out = new Array(128).fill(0);
    for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i];
    for (let i = 0; i < 128; i++) out[i] /= n;
    return out;
  }
  // Adaptive input size: 320 on capable devices; 224 when inference is slow (keeps the UI responsive
  // on low-end tablets / software-rendered WebGL / CPU backend). Detection recall at 224 is unchanged
  // for a face filling >=18% of the frame, which the UX already requires.
  function detectorOptions(inferMs) {
    const inputSize = (inferMs && inferMs > 700) ? 224 : 320;
    return new global.faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 });
  }

  /** Head pose proxies from 68 landmarks. yaw>0 = nose toward image-right (user's left). */
  function poseFromLandmarks(lm) {
    const p = lm.positions;
    const leftJaw = p[0], rightJaw = p[16], nose = p[30], chin = p[8];
    const eyeL = avgPts(p.slice(36, 42)), eyeR = avgPts(p.slice(42, 48));
    const eyeC = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
    const faceW = Math.max(1, rightJaw.x - leftJaw.x);
    const yaw   = (nose.x - leftJaw.x) / faceW - 0.5;                    // -0.5..0.5
    const pitch = (nose.y - eyeC.y) / Math.max(1, chin.y - eyeC.y);       // ~0.35-0.55 neutral
    const roll  = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
    return { yaw, pitch, roll, faceW };
  }
  function avgPts(pts) { let x = 0, y = 0; for (const q of pts) { x += q.x; y += q.y; } return { x: x / pts.length, y: y / pts.length }; }

  /** Brightness + sharpness sampled from a small downscale of the face box. */
  function frameQuality(video, box, canvas, ctx) {
    const w = 64, h = 64;
    canvas.width = w; canvas.height = h;
    try {
      ctx.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, w, h);
    } catch (_) { return { brightness: 0, sharpness: 0 }; }
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0; const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; lum[j] = l; sum += l; }
    const brightness = sum / (w * h);
    let lap = 0, cnt = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w];
      lap += v * v; cnt++;
    }
    return { brightness, sharpness: Math.sqrt(lap / cnt) };
  }

  function qualityScore(det, video, canvas, ctx) {
    const box = det.detection.box;
    const frac = box.width / (video.videoWidth || VIDEO_W);
    const { brightness, sharpness } = frameQuality(video, box, canvas, ctx);
    let q = 100;
    if (frac < MIN_FACE_FRAC) q -= clamp((MIN_FACE_FRAC - frac) * 400, 0, 45);
    if (brightness < 60)  q -= clamp((60 - brightness) * 0.8, 0, 35);
    if (brightness > 200) q -= clamp((brightness - 200) * 0.8, 0, 35);
    if (sharpness < 8)    q -= clamp((8 - sharpness) * 4, 0, 30);
    q -= clamp((0.9 - det.detection.score) * 60, 0, 25);
    return { quality: Math.round(clamp(q, 0, 100)), brightness: Math.round(brightness), sharpness: Math.round(sharpness), faceFrac: frac };
  }

  // ─── Camera manager ──────────────────────────────────────────────────────────
  const CameraManager = {
    async open({ videoEl, facingMode = 'user', deviceId = null }) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw { code: 'unsupported', message: 'Camera API not supported in this browser. Use Chrome, Edge or Safari over HTTPS.' };
      }
      const video = { width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H }, frameRate: { ideal: 30, max: 30 } };
      if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = facingMode;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (e) {
        const n = e && e.name;
        if (n === 'NotAllowedError' || n === 'PermissionDeniedError') throw { code: 'permission_denied', message: 'Camera access was denied. Allow camera access in your browser settings and try again.' };
        if (n === 'NotFoundError' || n === 'DevicesNotFoundError')     throw { code: 'no_camera', message: 'No camera found on this device.' };
        if (n === 'NotReadableError' || n === 'TrackStartError')       throw { code: 'in_use', message: 'The camera is in use by another application.' };
        if (n === 'OverconstrainedError')                              throw { code: 'unavailable', message: 'The selected camera is unavailable.' };
        throw { code: 'camera_error', message: 'Could not start camera: ' + (e && e.message || n) };
      }
      videoEl.srcObject = stream;
      await new Promise((res) => { videoEl.onloadedmetadata = () => { videoEl.play().catch(() => {}); res(); }; setTimeout(res, 2500); });
      return stream;
    },
    stop(videoEl) {
      const s = videoEl && videoEl.srcObject;
      if (s) s.getTracks().forEach(t => t.stop());
      if (videoEl) videoEl.srcObject = null;
    },
    async listCameras() {
      try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter(x => x.kind === 'videoinput'); } catch (_) { return []; }
    }
  };

  // ─── Overlay rendering ───────────────────────────────────────────────────────
  function drawOverlay(canvas, m) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 - H * 0.03, rx = W * 0.23, ry = H * 0.36;
    // Dim outside oval
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill('evenodd');
    ctx.restore();
    // Ring
    const color = m.state === 'success' ? '#22c55e' : m.state === 'error' ? '#ef4444' : m.detected ? (m.quality >= 50 ? '#6366f1' : '#f59e0b') : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3; ctx.strokeStyle = color;
    ctx.setLineDash(m.detected ? [] : [8, 8]);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Progress arc
    if (m.progress > 0) {
      ctx.lineWidth = 5; ctx.strokeStyle = '#22c55e';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.progress); ctx.stroke();
    }
    // Landmark dots (subtle)
    if (m.landmarks) {
      ctx.fillStyle = 'rgba(165,180,252,0.8)';
      const sx = W / m.srcW, sy = H / m.srcH;
      for (const p of m.landmarks) { ctx.beginPath(); ctx.arc(W - p.x * sx, p.y * sy, 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
    // Arrow hint
    if (m.arrow) {
      const t = (Date.now() % 900) / 900, off = Math.sin(t * Math.PI) * 10;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const glyph = { left: '←', right: '→', up: '↑', down: '↓' }[m.arrow];
      const pos = { left: [cx - rx - 40 - off, cy], right: [cx + rx + 40 + off, cy], up: [cx, cy - ry - 34 - off], down: [cx, cy + ry + 34 + off] }[m.arrow];
      ctx.fillText(glyph, pos[0], pos[1]);
    }
  }

  // ─── Session ─────────────────────────────────────────────────────────────────
  function createSession(cfg, mode) {
    const {
      containerId, onComplete, onError, onProgress, onFaceFound,
      autoStart = true, facingMode = 'user', deviceId = null,
      title = mode === 'enroll' ? 'Face Enrollment' : 'Face Verification',
      showRestartBtn = true, showCancelBtn = true,
    } = cfg || {};

    const container = document.getElementById(containerId);
    if (!container) { console.error('[FaceAccessCameraEngine] container not found:', containerId); return null; }

    // DOM
    container.innerHTML = '';
    container.style.cssText = 'position:relative;background:#000;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:80%;min-height:200px;';
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:8px 12px;background:linear-gradient(rgba(0,0,0,0.6),transparent);z-index:10;pointer-events:none;display:flex;justify-content:space-between;align-items:center;';
    hud.innerHTML = `<div class="_fce_step" style="font-size:11px;color:rgba(255,255,255,0.85);font-weight:700;">${title}</div>
      <div class="_fce_qual" style="font-size:11px;color:rgba(255,255,255,0.45);">Quality: —</div>
      <div class="_fce_live" style="font-size:11px;color:rgba(255,255,255,0.45);">Engine: loading…</div>`;
    const dots = document.createElement('div');
    dots.style.cssText = 'position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:8px;z-index:10;pointer-events:none;';
    const dotEls = MOVEMENT_STEPS.map(s => { const d = document.createElement('div'); d.title = s.label; d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.18);transition:all .3s;'; dots.appendChild(d); return d; });
    const instr = document.createElement('div');
    instr.style.cssText = 'position:absolute;left:0;right:0;bottom:30px;display:flex;justify-content:center;z-index:11;pointer-events:none;';
    instr.innerHTML = `<div class="_fce_instr" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);border-radius:20px;padding:7px 18px;color:#fff;font-size:13px;font-weight:600;max-width:85%;text-align:center;transition:all .25s;"></div>`;
    const prog = document.createElement('div');
    prog.style.cssText = 'position:absolute;top:36px;left:0;right:0;display:flex;justify-content:center;z-index:11;pointer-events:none;';
    prog.innerHTML = `<div class="_fce_prog" style="background:rgba(0,0,0,0.55);border-radius:20px;padding:4px 12px;color:rgba(255,255,255,0.65);font-size:10px;font-weight:600;"></div>`;
    const msg = document.createElement('div'); msg.className = '_fce_msg';
    msg.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);z-index:20;padding:20px;text-align:center;';
    [video, overlay, hud, dots, instr, prog, msg].forEach(el => wrapper.appendChild(el));
    container.appendChild(wrapper);
    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'display:flex;gap:8px;padding:10px 12px;background:#000;';
    ctrl.innerHTML = `
      <button class="_fce_restart" style="flex:1;padding:9px 12px;border-radius:9px;border:none;background:#1e293b;color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;display:${showRestartBtn ? 'block' : 'none'}">↺ Restart Scan</button>
      <button class="_fce_start" style="flex:2;padding:9px 12px;border-radius:9px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:13px;font-weight:700;cursor:pointer;">▶ Start Scan</button>
      <button class="_fce_cancel" style="flex:1;padding:9px 12px;border-radius:9px;border:none;background:#1e293b;color:#64748b;font-size:12px;font-weight:600;cursor:pointer;display:${showCancelBtn ? 'block' : 'none'}">Cancel</button>`;
    container.appendChild(ctrl);

    const $ = (cls) => container.querySelector('.' + cls);
    const qCanvas = document.createElement('canvas');
    const qCtx = qCanvas.getContext('2d', { willReadFrequently: true });

    // State
    let state = 'idle';           // idle | loading | detecting | scanning | success | error
    let tick = null, raf = null, busy = false, destroyed = false;
    let stepIdx = 0, stepStart = 0, holdStart = 0;
    let basePose = null, lastSeen = 0, firstDetectAt = 0, faceEverFound = false;
    let captured = [];            // { step, descriptor, quality, pose }
    let movementsDetected = 0;
    let lastDet = null, lastQ = { quality: 0 };
    let inferMs = 150;            // EMA of detection latency; drives adaptive step timeouts
    let steadyTicks = 0;          // consecutive steady detections during 'center'
    const moveWindowMs = () => Math.max(MOVE_TIMEOUT_MS, MIN_TICKS_PER_STEP * (inferMs + TICK_MS));
    const lostWindowMs = () => Math.max(FACE_LOST_MS, 3 * (inferMs + TICK_MS));
    let overlayMetrics = { detected: false, quality: 0, progress: 0, state: 'scanning', arrow: null, landmarks: null, srcW: VIDEO_W, srcH: VIDEO_H };

    const setInstr = (t) => { const e = $('_fce_instr'); if (e) e.textContent = t; };
    const setProg  = (t) => { const e = $('_fce_prog');  if (e) e.textContent = t; };
    const setQual  = (q) => { const e = $('_fce_qual');  if (e) { e.textContent = 'Quality: ' + (q == null ? '—' : q + '%'); e.style.color = q >= 50 ? '#86efac' : q > 0 ? '#fcd34d' : 'rgba(255,255,255,0.45)'; } };
    const setLive  = (t, c) => { const e = $('_fce_live'); if (e) { e.textContent = t; e.style.color = c || 'rgba(255,255,255,0.45)'; } };
    const setDot   = (i, st) => { const d = dotEls[i]; if (!d) return; d.style.background = st === 'done' ? '#22c55e' : st === 'active' ? '#6366f1' : 'rgba(255,255,255,0.18)'; d.style.transform = st === 'active' ? 'scale(1.4)' : 'scale(1)'; };

    function showPanel(icon, titleTxt, body, buttons) {
      msg.style.display = 'flex';
      msg.innerHTML = `<div style="font-size:40px;margin-bottom:8px">${icon}</div>
        <div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:6px">${titleTxt}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:12.5px;max-width:320px;line-height:1.5;margin-bottom:16px">${body}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"></div>`;
      const row = msg.lastElementChild;
      (buttons || []).forEach(b => {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.style.cssText = `padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;${b.primary ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : 'background:#1e293b;color:#94a3b8'}`;
        btn.onclick = b.onClick; row.appendChild(btn);
      });
    }
    const hidePanel = () => { msg.style.display = 'none'; msg.innerHTML = ''; };

    function fail(code, message, opts = {}) {
      state = 'error'; stopLoops();
      overlayMetrics.state = 'error';
      showPanel('⚠️', opts.title || 'Scan interrupted', message, [
        { label: '↺ Restart Scan', primary: true, onClick: restart },
        ...(showCancelBtn ? [{ label: 'Cancel', onClick: cancel }] : []),
      ]);
      if (onError) { try { onError({ code, message }); } catch (_) {} }
    }

    function stopLoops() { if (tick) { clearInterval(tick); tick = null; } if (raf) { cancelAnimationFrame(raf); raf = null; } }

    function renderLoop() {
      if (destroyed) return;
      if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) { overlay.width = overlay.clientWidth || 640; overlay.height = overlay.clientHeight || 512; }
      drawOverlay(overlay, overlayMetrics);
      raf = requestAnimationFrame(renderLoop);
    }

    async function start() {
      if (destroyed) return;
      hidePanel();
      state = 'loading';
      $('_fce_start').style.display = 'none';
      setInstr('Loading face recognition models…');
      setProg('');
      try {
        await Promise.all([ensureModels(), CameraManager.open({ videoEl: video, facingMode, deviceId })]);
      } catch (e) {
        const err = e && e.code ? e : { code: 'model_load_failed', message: 'Could not load the face recognition engine' + (e && e.message ? ' (' + e.message + ')' : '') + '. Check your connection and retry.' };
        // Expected device conditions (no camera / user denied) are warnings; real engine failures are errors.
        const expected = err.code === 'no_camera' || err.code === 'permission_denied' || err.code === 'in_use' || err.code === 'unavailable' || err.code === 'insecure_context';
        (expected ? console.warn : console.error)('[FaceAccessCameraEngine] start failed:', err.code, err.message);
        return fail(err.code, err.message, { title: err.code === 'permission_denied' ? 'Camera blocked' : 'Cannot start' });
      }
      if (destroyed) return;
      setLive('Engine: ready', '#86efac');
      resetScan();
      state = 'detecting';
      firstDetectAt = Date.now();
      setInstr('Position your face inside the oval');
      raf = requestAnimationFrame(renderLoop);
      tick = setInterval(onTick, TICK_MS);
    }

    function resetScan() {
      stepIdx = 0; stepStart = 0; holdStart = 0; basePose = null; captured = []; movementsDetected = 0; faceEverFound = false;
      lastSeen = 0; lastDet = null; lastQ = { quality: 0 }; steadyTicks = 0;
      overlayMetrics = { detected: false, quality: 0, progress: 0, state: 'scanning', arrow: null, landmarks: null, srcW: VIDEO_W, srcH: VIDEO_H };
      dotEls.forEach((_, i) => setDot(i, 'idle'));
      setQual(null); setProg('');
    }

    function restart() { stopLoops(); hidePanel(); resetScan(); if (video.srcObject) { state = 'detecting'; firstDetectAt = Date.now(); setInstr('Position your face inside the oval'); raf = requestAnimationFrame(renderLoop); tick = setInterval(onTick, TICK_MS); } else start(); }
    function cancel() { destroy(); if (onError) { try { onError({ code: 'cancelled', message: 'Scan cancelled' }); } catch (_) {} } }
    function destroy() { destroyed = true; stopLoops(); CameraManager.stop(video); state = 'idle'; }

    async function onTick() {
      if (busy || destroyed || state === 'error' || state === 'success' || video.readyState < 2) return;
      busy = true;
      try {
        const fa = global.faceapi;
        const tInfer = Date.now();
        const dets = await fa.detectAllFaces(video, detectorOptions(inferMs)).withFaceLandmarks();
        inferMs = inferMs * 0.6 + (Date.now() - tInfer) * 0.4;
        const nowT = Date.now();
        overlayMetrics.srcW = video.videoWidth || VIDEO_W; overlayMetrics.srcH = video.videoHeight || VIDEO_H;

        if (dets.length > 1) {
          overlayMetrics.detected = false; overlayMetrics.landmarks = null;
          setInstr('Multiple faces detected — only one person in frame please');
          busy = false; return;
        }
        const det = dets[0];
        if (!det) {
          overlayMetrics.detected = false; overlayMetrics.landmarks = null; setQual(null);
          if (!faceEverFound) {
            if (nowT - firstDetectAt > FACE_DETECT_MS) return fail('no_face', 'No face was detected. Make sure your face is well lit and centered in the oval.', { title: 'No face detected' });
          } else if (lastSeen && nowT - lastSeen > lostWindowMs()) {
            if (state === 'scanning') return fail('face_lost', 'Your face left the frame. Please keep your face inside the oval during the scan.', { title: 'Face lost' });
          }
          busy = false; return;
        }

        lastDet = det; lastSeen = nowT;
        const q = qualityScore(det, video, qCanvas, qCtx);
        lastQ = q; setQual(q.quality);
        const pose = poseFromLandmarks(det.landmarks);
        overlayMetrics.detected = true; overlayMetrics.quality = q.quality; overlayMetrics.landmarks = det.landmarks.positions;

        if (!faceEverFound) { faceEverFound = true; if (onFaceFound) { try { onFaceFound(); } catch (_) {} } }

        if (state === 'detecting') {
          if (q.faceFrac < MIN_FACE_FRAC) { setInstr('Move closer to the camera'); busy = false; return; }
          if (q.brightness < 50) { setInstr('Too dark — find better lighting'); busy = false; return; }
          state = 'scanning'; stepIdx = 0; stepStart = nowT; holdStart = nowT; setDot(0, 'active');
          setInstr(MOVEMENT_STEPS[0].instruction);
          if (onProgress) { try { onProgress(0, MOVEMENT_STEPS.length, MOVEMENT_STEPS[0]); } catch (_) {} }
        }

        if (state !== 'scanning') { busy = false; return; }
        const step = MOVEMENT_STEPS[stepIdx];
        overlayMetrics.arrow = step.arrowAnim;
        setProg(`Step ${stepIdx + 1} of ${MOVEMENT_STEPS.length} · ${Math.round((stepIdx / MOVEMENT_STEPS.length) * 100)}%`);

        if (step.id === 'center') {
          // must hold still & steady for holdMs; accumulate baseline pose
          if (q.faceFrac < MIN_FACE_FRAC || q.quality < 35) { holdStart = nowT; setInstr(q.faceFrac < MIN_FACE_FRAC ? 'Move closer to the camera' : 'Hold still — improve lighting'); busy = false; return; }
          if (!basePose) basePose = { yaw: pose.yaw, pitch: pose.pitch, n: 1 };
          else { basePose.yaw = (basePose.yaw * basePose.n + pose.yaw) / (basePose.n + 1); basePose.pitch = (basePose.pitch * basePose.n + pose.pitch) / (basePose.n + 1); basePose.n++; }
          // Steadiness: compare against the running baseline; tolerance widens slightly on slow devices
          // where frames are further apart. A single jittery frame downgrades the count rather than resetting it.
          const tol = inferMs > 600 ? 1.6 : 1.0;
          const steady = Math.abs(pose.yaw - basePose.yaw) <= 0.06 * tol && Math.abs(pose.pitch - basePose.pitch) <= 0.05 * tol;
          if (steady) steadyTicks++; else { steadyTicks = Math.max(0, steadyTicks - 1); if (steadyTicks === 0) holdStart = nowT; setInstr('Hold still…'); }
          const held = nowT - holdStart;
          const holdDone = held >= step.holdMs && steadyTicks >= Math.min(MIN_HOLD_TICKS, Math.ceil(step.holdMs / (inferMs + TICK_MS)));
          overlayMetrics.progress = clamp(Math.max(held / step.holdMs, steadyTicks / MIN_HOLD_TICKS), 0, 1) / MOVEMENT_STEPS.length;
          if (holdDone) {
            const d = await computeDescriptor(); if (!d) { holdStart = nowT; busy = false; return; }
            captured.push({ step: 'center', descriptor: d, quality: q.quality, pose: { yaw: pose.yaw, pitch: pose.pitch } });
            advance(nowT, true);
          }
        } else {
          const dy = pose.yaw - basePose.yaw, dp = pose.pitch - basePose.pitch;
          let moved = false;
          if (step.id === 'left')  moved = dy >  YAW_THRESHOLD;
          if (step.id === 'right') moved = dy < -YAW_THRESHOLD;
          if (step.id === 'up')    moved = dp < -PITCH_THRESHOLD;
          if (step.id === 'down')  moved = dp >  PITCH_THRESHOLD;
          const elapsed = nowT - stepStart;
          const windowMs = moveWindowMs();
          overlayMetrics.progress = (stepIdx + clamp(elapsed / windowMs, 0, 0.95)) / MOVEMENT_STEPS.length;
          if (moved) {
            movementsDetected++;
            const d = await computeDescriptor();
            if (d) captured.push({ step: step.id, descriptor: d, quality: q.quality, pose: { yaw: pose.yaw, pitch: pose.pitch } });
            advance(nowT, true);
          } else if (elapsed > windowMs) {
            advance(nowT, false);
          }
        }
      } catch (e) {
        console.warn('[FaceAccessCameraEngine] tick error', e);
      } finally { busy = false; }
    }

    async function computeDescriptor() {
      try {
        const fa = global.faceapi;
        const r = await fa.detectSingleFace(video, detectorOptions(inferMs)).withFaceLandmarks().withFaceDescriptor();
        return r ? Array.from(r.descriptor) : null;
      } catch (_) { return null; }
    }

    function advance(nowT, ok) {
      setDot(stepIdx, ok ? 'done' : 'idle');
      if (ok) { setInstr('✓ Done!'); }
      stepIdx++;
      if (stepIdx >= MOVEMENT_STEPS.length) return finish();
      stepStart = nowT; holdStart = nowT;
      setDot(stepIdx, 'active');
      const s = MOVEMENT_STEPS[stepIdx];
      setTimeout(() => { if (state === 'scanning') setInstr(s.instruction); }, ok ? 450 : 0);
      if (onProgress) { try { onProgress(stepIdx, MOVEMENT_STEPS.length, s); } catch (_) {} }
    }

    function finish() {
      stopLoops();
      overlayMetrics.arrow = null; overlayMetrics.progress = 1;
      const centerCaps = captured.filter(c => c.step === 'center');
      if (!centerCaps.length) return fail('no_descriptor', 'We could not compute a face signature. Please retry with better lighting.', { title: 'Scan incomplete' });
      if (movementsDetected < MIN_MOVEMENTS) {
        return fail('liveness_failed', `Liveness check failed (${movementsDetected} of 4 head movements detected). Follow the on-screen arrows and move your head clearly.`, { title: 'Liveness check failed' });
      }
      // Reject inconsistent captures (e.g. person swapped mid-scan)
      const center = centerCaps[0].descriptor;
      const consistent = captured.filter(c => euclidean(c.descriptor, center) < 0.6);
      const descriptors = consistent.map(c => c.descriptor);
      const primary = meanDescriptor(descriptors);
      const avgQ = Math.round(consistent.reduce((s, c) => s + c.quality, 0) / consistent.length);
      const livenessScore = [0.15, 0.4, 0.72, 0.86, 0.95][movementsDetected] || 0.95;
      const antiSpoof = clamp(0.55 + 0.1 * movementsDetected + (consistent.length === captured.length ? 0.05 : -0.15), 0, 0.99);

      state = 'success'; overlayMetrics.state = 'success';
      drawOverlay(overlay, overlayMetrics);
      setInstr(mode === 'enroll' ? '✓ Face captured' : '✓ Verifying…');
      setProg('Step 5 of 5 · 100%');
      setLive('Engine: ' + ENGINE_NAME, '#86efac');
      CameraManager.stop(video);

      const result = {
        descriptor: primary,
        descriptors,
        embedding: primary,                       // backwards-compatible alias
        livenessScore: Number(livenessScore.toFixed(2)),
        antiSpoofScore: Number(antiSpoof.toFixed(2)),
        quality: avgQ, averageQuality: avgQ,
        steps: MOVEMENT_STEPS.length,
        capturedAngles: consistent.length,
        capturedSteps: consistent.map(c => c.step),
        movementsDetected,
        engine: ENGINE_NAME, version: VERSION,
      };
      if (onComplete) { try { onComplete(result); } catch (e) { console.error(e); } }
    }

    // Wire buttons
    $('_fce_start').onclick   = start;
    $('_fce_restart').onclick = restart;
    $('_fce_cancel').onclick  = cancel;
    ensureModels().then(() => setLive('Engine: ready' + (_backend && _backend !== 'webgl' ? ' (CPU)' : ''), '#86efac')).catch((e) => { console.error('[FaceAccessCameraEngine] model load failed:', e); setLive('Engine: failed to load', '#fca5a5'); });
    if (autoStart) setTimeout(start, 50);

    return {
      start, restart, stop: destroy, destroy,
      getState: () => state,
      getStream: () => video.srcObject,
      getMetrics: () => ({ detected: overlayMetrics.detected, quality: lastQ.quality, step: stepIdx, captured: captured.length, movementsDetected, inferMs: Math.round(inferMs), backend: _backend }),
    };
  }

  // ─── Standalone helpers ──────────────────────────────────────────────────────
  async function detectFace(videoOrImg) {
    await ensureModels();
    const r = await global.faceapi.detectSingleFace(videoOrImg, detectorOptions()).withFaceLandmarks();
    return r ? { detected: true, box: r.detection.box, score: r.detection.score, landmarks: r.landmarks.positions, pose: poseFromLandmarks(r.landmarks) } : { detected: false };
  }
  async function computeDescriptor(videoOrImg) {
    await ensureModels();
    const r = await global.faceapi.detectSingleFace(videoOrImg, detectorOptions()).withFaceLandmarks().withFaceDescriptor();
    return r ? Array.from(r.descriptor) : null;
  }

  const FaceAccessCameraEngine = {
    VERSION, ENGINE_NAME, MOVEMENT_STEPS,
    createEnrollmentSession:   (cfg) => createSession(cfg, 'enroll'),
    createVerificationSession: (cfg) => createSession(cfg, 'verify'),
    openCamera: (opts) => CameraManager.open(opts),
    stopCamera: (videoEl) => CameraManager.stop(videoEl),
    listCameras: () => CameraManager.listCameras(),
    ready: ensureModels,
    isReady: () => _modelsReady,
    getBackend: () => _backend,
    onReady: (fn) => { if (_modelsReady) fn(); else _readyListeners.push(fn); },
    detectFace, computeDescriptor,
    getEmbedding: computeDescriptor,           // async in v3
    analyzeFrame: detectFace,                  // async in v3
    euclidean, drawOverlay,
  };

  global.FaceAccessCameraEngine = FaceAccessCameraEngine;
  console.log(`[FaceAccessCameraEngine] v${VERSION} — ${ENGINE_NAME}`);
})(typeof window !== 'undefined' ? window : this);
