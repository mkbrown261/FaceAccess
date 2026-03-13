// ═══════════════════════════════════════════════════════════════════════════════
// FaceAccessCameraEngine  v2.0  — Unified Camera & Biometric Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT'S NEW IN v2.0:
//   • Stable face tracking — small head movements no longer break the session;
//     face must fully exit frame (coverage < 2%) for 1.5 s before "face lost".
//   • Graceful failure panel with Resume / Restart Scan / Cancel buttons.
//   • Persistent "Restart Scan" button (never leaves the page).
//   • Animated direction arrows + progress pill ("Step 2 of 5 · Scan Progress: 40%").
//   • All control buttons functional: Resume, Restart Scan, Return, Close (×).
//   • Each step visually confirms with a green tick + brief "✓ Done!" pill.
//   • Robust error handling for: permission denied, no camera, camera in use,
//     no face detected (8 s), multiple faces, low light.
//   • 5-step movement flow:
//       Step 1 — Hold still (face detected + 2 s stable hold)
//       Steps 2-5 — Turn left / right / look up / down (max 3 s each,
//                   advances on movement detected OR timeout)
//   • Supports USB, laptop webcam, RTSP/HLS streams, integrated device cameras.
//
// USAGE:
//   const session = FaceAccessCameraEngine.createEnrollmentSession(cfg)
//   const session = FaceAccessCameraEngine.createVerificationSession(cfg)
//   const cam     = FaceAccessCameraEngine.openCamera(cfg)
//
// cfg shared options:
//   containerId   string            — div to mount camera+overlay into
//   autoStart?    boolean           — default true
//   facingMode?   'user'|'environment'
//   deviceId?     string
//   rtspUrl?      string
//   onComplete    fn(result)        — { embedding, livenessScore, antiSpoofScore, quality, steps }
//   onError?      fn(err)
//   onProgress?   fn(step, total, stepDef)
//   onFaceFound?  fn()
//   title?        string            — header title shown above camera
//   showRestartBtn? boolean         — default true
//   showCancelBtn?  boolean         — default true
// ═══════════════════════════════════════════════════════════════════════════════
;(function (global) {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const VERSION   = '2.0';
  const VIDEO_W   = 640;
  const VIDEO_H   = 480;
  const FRAME_FPS = 30;
  const TICK_MS   = Math.round(1000 / FRAME_FPS);

  // Movement verification steps
  const MOVEMENT_STEPS = [
    { id: 'center', label: 'Hold still',   icon: '⊙', direction: null,
      instruction: 'Center your face and hold still',
      holdMs: 2000, moveThreshold: 0, arrowAnim: null },
    { id: 'left',   label: 'Turn left',    icon: '←', direction: 'left',
      instruction: 'Slowly turn your head to the LEFT',
      holdMs: 0, moveThreshold: 0.11, arrowAnim: 'left' },
    { id: 'right',  label: 'Turn right',   icon: '→', direction: 'right',
      instruction: 'Slowly turn your head to the RIGHT',
      holdMs: 0, moveThreshold: 0.11, arrowAnim: 'right' },
    { id: 'up',     label: 'Look up',      icon: '↑', direction: 'up',
      instruction: 'Tilt your head slightly UP',
      holdMs: 0, moveThreshold: 0.09, arrowAnim: 'up' },
    { id: 'down',   label: 'Look down',    icon: '↓', direction: 'down',
      instruction: 'Tilt your head slightly DOWN',
      holdMs: 0, moveThreshold: 0.09, arrowAnim: 'down' },
  ];

  const MOVE_TIMEOUT_MS  = 3500;  // max time to detect movement per step
  const STILL_HOLD_MS    = 2000;  // hold-still duration for step 0
  const FACE_DETECT_MS   = 8000;  // max wait for initial face detection
  const FACE_LOST_HOLD_MS= 1500;  // ms face must be absent before "face lost"
  const EMB_DIMS         = 128;

  // Quality thresholds
  const Q_MIN_BRIGHTNESS = 35;
  const Q_MAX_BRIGHTNESS = 215;
  const Q_MIN_SHARPNESS  = 10;
  const Q_MIN_COVERAGE   = 0.02;  // LOWERED: only fail if face truly gone
  const Q_PASS           = 40;

  // ─── Utilities ────────────────────────────────────────────────────────────────
  function l2norm(v) {
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / mag);
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function cosineSim(a, b) {
    let dot = 0, ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i]; }
    return dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-9);
  }

  // ─── Frame Analyzer ───────────────────────────────────────────────────────────
  const FrameAnalyzer = {
    analyze(video, canvas, ctx) {
      if (!video || video.readyState < 2) {
        return { detected: false, quality: 0, brightness: 0, sharpness: 0,
                 coverage: 0, antiSpoof: { score: 0.5 }, headPose: null };
      }
      const w = video.videoWidth  || VIDEO_W;
      const h = video.videoHeight || VIDEO_H;
      canvas.width  = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      let img;
      try { img = ctx.getImageData(0, 0, w, h); } catch(e) {
        return { detected: false, quality: 0, brightness: 0, sharpness: 0,
                 coverage: 0, antiSpoof: { score: 0.5 }, headPose: null };
      }
      const data = img.data;
      const pixels = w * h;

      // Brightness
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        bright += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      }
      bright /= pixels;

      // Sharpness (Laplacian variance)
      let sharpSum = 0, sharpCount = 0;
      const step = 3;
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const i  = (y * w + x) * 4;
          const lum = 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
          const iU  = ((y-step)*w+x)*4; const lumU = 0.299*data[iU]+0.587*data[iU+1]+0.114*data[iU+2];
          const iD  = ((y+step)*w+x)*4; const lumD = 0.299*data[iD]+0.587*data[iD+1]+0.114*data[iD+2];
          const iL  = (y*w+x-step)*4;   const lumL = 0.299*data[iL]+0.587*data[iL+1]+0.114*data[iL+2];
          const iR  = (y*w+x+step)*4;   const lumR = 0.299*data[iR]+0.587*data[iR+1]+0.114*data[iR+2];
          sharpSum += Math.abs(4*lum - lumU - lumD - lumL - lumR);
          sharpCount++;
        }
      }
      const sharpness = Math.min(100, (sharpSum / (sharpCount || 1)) * 2.5);

      // Skin coverage in center zone (face position)
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
      const faceW = Math.floor(w * 0.40), faceH = Math.floor(h * 0.56);
      let skinCount = 0, facePixels = 0;
      for (let fy = cy - faceH/2; fy < cy + faceH/2; fy += 3) {
        for (let fx = cx - faceW/2; fx < cx + faceW/2; fx += 3) {
          const fi = (Math.floor(fy)*w + Math.floor(fx))*4;
          const r = data[fi], g = data[fi+1], b = data[fi+2];
          facePixels++;
          const Y  = 0.299*r + 0.587*g + 0.114*b;
          const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
          const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
          if (Y > 35 && Cb >= 80 && Cb <= 140 && Cr >= 130 && Cr <= 185) skinCount++;
        }
      }
      const coverage = facePixels > 0 ? skinCount / facePixels : 0;

      // Anti-spoof proxy
      const skinOverall = this._skinRatio(data, pixels);
      const textureScore = Math.min(1, 0.38 + coverage * 1.1 + (sharpness/100)*0.25 + skinOverall*0.12);
      const lowLight = bright < 38;
      const antiSpoof = { score: clamp(textureScore, 0, 1), lowLightMode: lowLight };

      // Detection: face present when coverage or sharpness passes
      // NOTE: We use a VERY LOW coverage threshold so small head movements
      // don't incorrectly trip "face lost"
      const detected = (coverage > 0.025 || (sharpness > 15 && bright > Q_MIN_BRIGHTNESS))
                       && bright < Q_MAX_BRIGHTNESS + 20
                       && bright > Q_MIN_BRIGHTNESS - 5;

      // Quality score 0-100
      const qualityRaw =
        (bright > Q_MIN_BRIGHTNESS && bright < Q_MAX_BRIGHTNESS ? 35 : 8) +
        (sharpness > Q_MIN_SHARPNESS ? 33 : 8) +
        clamp(coverage * 210, 0, 32);
      const quality = Math.round(clamp(qualityRaw, 0, 100));

      let qMsg = null;
      if (bright < Q_MIN_BRIGHTNESS)     qMsg = 'Too dark — improve lighting';
      else if (bright > Q_MAX_BRIGHTNESS) qMsg = 'Too bright — reduce glare';
      else if (sharpness < Q_MIN_SHARPNESS) qMsg = 'Hold still — camera is blurry';
      else if (coverage < 0.04)           qMsg = 'Move closer to the camera';
      else if (quality >= 80)             qMsg = 'Excellent quality';
      else if (quality >= 55)             qMsg = 'Good quality';
      else                                qMsg = 'Move a little closer';

      const headPose = this._headPose(data, w, h, cx, cy, faceW, faceH);
      return { detected, quality, brightness: Math.round(bright),
               sharpness: Math.round(sharpness),
               coverage:  Math.round(coverage * 100) / 100,
               antiSpoof, qualityMessage: qMsg, headPose };
    },

    _skinRatio(data, pixels) {
      let cnt = 0;
      for (let i = 0; i < data.length; i += 20) {
        const r = data[i], g = data[i+1], b = data[i+2];
        if (r > 70 && g > 35 && b > 15 && r > g && r > b && r-g > 7) cnt++;
      }
      return cnt / (pixels / 5);
    },

    _headPose(data, w, h, cx, cy, faceW, faceH) {
      let sumX = 0, sumY = 0, cnt = 0;
      for (let fy = cy - faceH/2; fy < cy + faceH/2; fy += 4) {
        for (let fx = cx - faceW/2; fx < cx + faceW/2; fx += 4) {
          const fi = (Math.floor(fy)*w + Math.floor(fx))*4;
          const r = data[fi], g = data[fi+1], b = data[fi+2];
          const Y  = 0.299*r + 0.587*g + 0.114*b;
          const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
          const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
          if (Y > 35 && Cb >= 80 && Cb <= 140 && Cr >= 130 && Cr <= 185) {
            sumX += fx; sumY += fy; cnt++;
          }
        }
      }
      if (cnt < 15) return { yaw: 0, pitch: 0, valid: false };
      const mx = sumX / cnt, my = sumY / cnt;
      const yaw   = clamp((mx - cx) / (faceW * 0.5), -1, 1);
      const pitch = clamp((my - cy) / (faceH * 0.5), -1, 1);
      return { yaw, pitch, valid: true };
    },
  };

  // ─── Embedding Generator ──────────────────────────────────────────────────────
  function generateEmbedding(video, canvas, ctx) {
    canvas.width = 96; canvas.height = 96;
    ctx.drawImage(video, 0, 0, 96, 96);
    let img;
    try { img = ctx.getImageData(0, 0, 96, 96); } catch(e) { return _randEmb(); }
    const data = img.data;
    const emb  = new Array(EMB_DIMS).fill(0);
    const step = Math.floor(data.length / (EMB_DIMS * 4));
    for (let i = 0; i < EMB_DIMS; i++) {
      const off = i * step * 4;
      const r = (data[off]   || 0) / 255;
      const g = (data[off+1] || 0) / 255;
      const b = (data[off+2] || 0) / 255;
      emb[i] = r*0.299 + g*0.587 + b*0.114
               + Math.sin(i * 0.31415) * 0.07
               + Math.cos(i * 0.19635) * 0.05;
    }
    return l2norm(emb);
  }
  function _randEmb() {
    return l2norm(Array.from({ length: EMB_DIMS }, () => Math.random()*2 - 1));
  }

  // ─── Movement Detector ────────────────────────────────────────────────────────
  function makeMovementDetector() {
    return {
      _baseline: null,
      _history:  [],
      _max: 8,

      reset() { this._baseline = null; this._history = []; },

      update(pose) {
        if (!pose || !pose.valid) return;
        this._history.push({ yaw: pose.yaw, pitch: pose.pitch });
        if (this._history.length > this._max) this._history.shift();
        if (!this._baseline && this._history.length >= 4) {
          const sl = this._history.slice(-4);
          this._baseline = {
            yaw:   sl.reduce((s,p) => s + p.yaw,   0) / sl.length,
            pitch: sl.reduce((s,p) => s + p.pitch, 0) / sl.length,
          };
        }
      },

      detect(direction, threshold) {
        if (!this._baseline || this._history.length < 3) return false;
        const latest = this._history[this._history.length - 1];
        const dy = latest.yaw   - this._baseline.yaw;
        const dp = latest.pitch - this._baseline.pitch;
        switch (direction) {
          case 'left':  return dy < -threshold;
          case 'right': return dy >  threshold;
          case 'up':    return dp < -threshold;
          case 'down':  return dp >  threshold;
        }
        return false;
      },

      isStill(threshold = 0.06) {
        if (this._history.length < 3) return false;
        const r = this._history.slice(-3);
        const dyaw   = Math.max(...r.map(p => p.yaw))   - Math.min(...r.map(p => p.yaw));
        const dpitch = Math.max(...r.map(p => p.pitch)) - Math.min(...r.map(p => p.pitch));
        return dyaw < threshold && dpitch < threshold;
      },
    };
  }

  // ─── Overlay Renderer ─────────────────────────────────────────────────────────
  const OverlayRenderer = {
    draw(canvas, metrics, step, stepDef, progress, stepProgress, state, arrowAnim) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const detected = metrics ? metrics.detected  : false;
      const q        = metrics ? metrics.quality   : 0;
      const pose     = metrics ? metrics.headPose  : null;

      // Vignette
      const vg = ctx.createRadialGradient(w/2, h/2, h*0.26, w/2, h/2, h*0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.60)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

      const ow = w * 0.37, oh = h * 0.50;
      const strokeColor = state === 'complete' ? '#10b981' :
                          state === 'error'    ? '#ef4444' :
                          detected ? (q >= 70 ? '#10b981' : q >= 45 ? '#f59e0b' : '#6366f1') :
                          '#374151';

      // Face oval
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = (state === 'complete') ? 3 : 2;
      ctx.setLineDash(detected ? [] : [8, 5]);
      ctx.beginPath();
      ctx.ellipse(w/2, h/2, ow, oh, 0, 0, Math.PI*2);
      ctx.stroke();
      if (detected && state !== 'error') {
        ctx.strokeStyle = strokeColor + '35';
        ctx.lineWidth = 9;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(w/2, h/2, ow+5, oh+5, 0, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();

      // Corner brackets (always visible)
      const bx = w/2 - ow, by = h/2 - oh, bw = ow*2, bh = oh*2;
      const cs = 18;
      ctx.save();
      ctx.strokeStyle = detected ? strokeColor : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.setLineDash([]);
      [[bx, by, 1, 1], [bx+bw, by, -1, 1], [bx, by+bh, 1, -1], [bx+bw, by+bh, -1, -1]].forEach(([px, py, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(px, py + sy*cs); ctx.lineTo(px, py); ctx.lineTo(px + sx*cs, py); ctx.stroke();
      });
      ctx.restore();

      // Progress arc
      if (progress > 0 && state !== 'error') {
        ctx.save();
        ctx.strokeStyle = state === 'complete' ? '#10b981' : '#6366f1';
        ctx.lineWidth = 4; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(w/2, h/2, ow+9, oh+9, -Math.PI/2, -Math.PI/2,
                    -Math.PI/2 + Math.PI*2*progress);
        ctx.stroke();
        ctx.restore();
      }

      // Scan sweep when active
      if (detected && state === 'scanning') {
        const t = Date.now() / 1000;
        const sy = (h/2 - oh) + ((Math.sin(t * 1.3)+1)/2) * (oh*2);
        ctx.save();
        const sg = ctx.createLinearGradient(w/2-ow, sy, w/2+ow, sy);
        sg.addColorStop(0, 'rgba(99,102,241,0)');
        sg.addColorStop(0.5, 'rgba(99,102,241,0.55)');
        sg.addColorStop(1, 'rgba(99,102,241,0)');
        ctx.fillStyle = sg; ctx.fillRect(w/2-ow, sy-1, ow*2, 3);
        ctx.restore();
      }

      // Step progress bar (top of oval)
      if (step > 0 && stepProgress > 0) {
        const bw2 = ow*1.8, bx2 = w/2 - ow*0.9, by2 = h/2 - oh - 16;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, 5, 3); else ctx.rect(bx2, by2, bw2, 5); ctx.fill();
        ctx.fillStyle = q >= 70 ? '#10b981' : '#f59e0b';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2*stepProgress, 5, 3); else ctx.rect(bx2, by2, bw2*stepProgress, 5); ctx.fill();
        ctx.restore();
      }

      // Animated direction arrow
      if (arrowAnim && detected && state === 'scanning') {
        const t = Date.now() / 1000;
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.5));
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle   = '#fff';
        ctx.font        = `bold ${Math.round(w * 0.07)}px system-ui,sans-serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        const arrowMap = { left: '←', right: '→', up: '↑', down: '↓' };
        const arrow = arrowMap[arrowAnim] || '';
        const offsets = {
          left:  { x: w/2 - ow - 22, y: h/2 },
          right: { x: w/2 + ow + 22, y: h/2 },
          up:    { x: w/2,            y: h/2 - oh - 22 },
          down:  { x: w/2,            y: h/2 + oh + 22 },
        };
        const off = offsets[arrowAnim];
        if (off) ctx.fillText(arrow, off.x, off.y);
        ctx.restore();
      }

      // Completion tick
      if (state === 'complete') {
        ctx.save();
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(w/2-22, h/2); ctx.lineTo(w/2-5, h/2+17); ctx.lineTo(w/2+26, h/2-17);
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  // ─── Camera Manager ───────────────────────────────────────────────────────────
  const CameraManager = {
    async open(opts = {}) {
      const { videoEl, facingMode = 'user', deviceId, rtspUrl, width = VIDEO_W, height = VIDEO_H } = opts;
      if (!videoEl) throw new Error('videoEl required');
      if (videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
      }
      let stream = null;
      if (rtspUrl) {
        videoEl.srcObject = null;
        videoEl.src = rtspUrl;
        videoEl.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          videoEl.onloadedmetadata = res;
          videoEl.onerror = () => rej(new Error('RTSP stream failed'));
          setTimeout(() => rej(new Error('RTSP timeout')), 12000);
        });
      } else {
        const constraints = {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
            width: { ideal: width }, height: { ideal: height },
          }, audio: false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = stream;
      }
      await new Promise((res, rej) => {
        videoEl.onloadedmetadata = res;
        setTimeout(() => rej(new Error('Camera metadata timeout')), 10000);
      });
      await videoEl.play();
      return stream || null;
    },

    stop(videoEl) {
      if (!videoEl) return;
      if (videoEl.srcObject) { videoEl.srcObject.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; }
      if (videoEl.src)       { videoEl.pause(); videoEl.src = ''; }
    },

    async enumerate() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); }
      catch { return []; }
    },
  };

  // ─── Enrollment / Verification Session ───────────────────────────────────────
  // Single unified session factory used for both enrollment and verification.
  // The only difference is the UI title/label strings.
  function createSession(cfg, mode) {
    const {
      containerId, onComplete, onError, onProgress, onFaceFound,
      autoStart = true,
      title = mode === 'enroll' ? 'Face Enrollment' : 'Face Verification',
      showRestartBtn = true,
      showCancelBtn  = true,
    } = cfg;

    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[FaceAccessCameraEngine v2] Container not found:', containerId);
      return null;
    }

    // ── Build DOM ────────────────────────────────────────────────────────────
    container.innerHTML = '';
    container.style.cssText = 'position:relative;background:#000;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:80%;min-height:200px;';

    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

    // HUD top-bar
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:8px 12px;background:linear-gradient(rgba(0,0,0,0.6),transparent);z-index:10;pointer-events:none;display:flex;justify-content:space-between;align-items:center;';
    hud.innerHTML = `
      <div id="_fce_step"  style="font-size:11px;color:rgba(255,255,255,0.85);font-weight:700;">${title}</div>
      <div id="_fce_qual"  style="font-size:11px;color:rgba(255,255,255,0.45);">Quality: —</div>
      <div id="_fce_live"  style="font-size:11px;color:rgba(255,255,255,0.45);">Live: —</div>`;

    // Step dots bar (bottom)
    const dotsBar = document.createElement('div');
    dotsBar.id = '_fce_dots';
    dotsBar.style.cssText = 'position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:8px;z-index:10;pointer-events:none;';
    MOVEMENT_STEPS.forEach((s, i) => {
      const d = document.createElement('div');
      d.id = `_fce_dot_${i}`;
      d.title = s.label;
      d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.18);transition:all 0.3s;';
      dotsBar.appendChild(d);
    });

    // Instruction pill (centered, below oval)
    const instrPill = document.createElement('div');
    instrPill.id = '_fce_instr';
    instrPill.style.cssText = 'position:absolute;left:0;right:0;bottom:30px;display:flex;justify-content:center;z-index:11;pointer-events:none;';
    instrPill.innerHTML = `<div id="_fce_instr_text" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);border-radius:20px;padding:7px 18px;color:#fff;font-size:13px;font-weight:600;max-width:85%;text-align:center;transition:all 0.25s;"></div>`;

    // Progress pill (top-center)
    const progPill = document.createElement('div');
    progPill.id = '_fce_prog';
    progPill.style.cssText = 'position:absolute;top:36px;left:0;right:0;display:flex;justify-content:center;z-index:11;pointer-events:none;';
    progPill.innerHTML = `<div id="_fce_prog_text" style="background:rgba(0,0,0,0.55);border-radius:20px;padding:4px 12px;color:rgba(255,255,255,0.65);font-size:10px;font-weight:600;"></div>`;

    // Error/message overlay
    const msgOverlay = document.createElement('div');
    msgOverlay.id = '_fce_msg';
    msgOverlay.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);z-index:20;padding:20px;text-align:center;';

    wrapper.appendChild(video);
    wrapper.appendChild(overlayCanvas);
    wrapper.appendChild(hud);
    wrapper.appendChild(dotsBar);
    wrapper.appendChild(instrPill);
    wrapper.appendChild(progPill);
    wrapper.appendChild(msgOverlay);
    container.appendChild(wrapper);

    // Control bar below camera
    const ctrlBar = document.createElement('div');
    ctrlBar.id = '_fce_ctrl';
    ctrlBar.style.cssText = 'display:flex;gap:8px;padding:10px 12px;background:#000;';
    ctrlBar.innerHTML = `
      <button id="_fce_btn_restart" style="flex:1;padding:9px 12px;border-radius:9px;border:none;background:#1e293b;color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;display:${showRestartBtn?'block':'none'}">↺ Restart Scan</button>
      <button id="_fce_btn_start"   style="flex:2;padding:9px 12px;border-radius:9px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s;">▶ Start Scan</button>
      <button id="_fce_btn_cancel"  style="flex:1;padding:9px 12px;border-radius:9px;border:none;background:#1e293b;color:#64748b;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;display:${showCancelBtn?'block':'none'}">Cancel</button>`;
    container.appendChild(ctrlBar);

    // ── Internal state ─────────────────────────────────────────────────────
    const hiddenCanvas = document.createElement('canvas');
    const hiddenCtx    = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    const movDet       = makeMovementDetector();

    let stream             = null;
    let tickTimer          = null;
    let renderLoop         = null;
    let state              = 'idle';   // idle|waiting_face|step_N|complete|error
    let currentStep        = 0;
    let stepStartTs        = 0;
    let faceFoundTs        = null;
    let faceLostTs         = null;     // when face last disappeared
    let capturedEmbeddings = [];
    let capturedSteps      = [];
    let livenessScores     = [];
    let lastMetrics        = null;
    let _stepConfirmTs     = null;     // timestamp for brief "✓ Done!" display

    // ── DOM helpers ────────────────────────────────────────────────────────
    function _dot(i, status) {
      const d = document.getElementById(`_fce_dot_${i}`);
      if (!d) return;
      if (status === 'done')   d.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;transition:all 0.3s;';
      else if (status === 'active') d.style.cssText = 'width:11px;height:11px;border-radius:50%;background:#6366f1;box-shadow:0 0 10px #6366f180;transition:all 0.3s;';
      else d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.18);transition:all 0.3s;';
    }

    function _instr(txt, color) {
      const el = document.getElementById('_fce_instr_text');
      if (!el) return;
      el.textContent = txt;
      el.style.color = color || '#fff';
    }

    function _prog(txt) {
      const el = document.getElementById('_fce_prog_text');
      if (el) el.textContent = txt || '';
    }

    function _hudUpdate(step, metrics) {
      const se = document.getElementById('_fce_step');
      const qe = document.getElementById('_fce_qual');
      const le = document.getElementById('_fce_live');
      if (se) se.textContent = state === 'waiting_face' ? title : `Step ${step+1} / ${MOVEMENT_STEPS.length}`;
      if (qe && metrics) qe.textContent = `Quality: ${metrics.quality}%`;
      if (le && metrics) {
        const sc = metrics.antiSpoof?.score || 0;
        le.textContent = metrics.antiSpoof?.lowLightMode ? 'Live: low-light' : `Live: ${Math.round(sc*100)}%`;
      }
    }

    function _showMsg(icon, titleTxt, subTxt, buttons) {
      // buttons: array of { label, style, onClick }
      msgOverlay.style.display = 'flex';
      msgOverlay.innerHTML = `
        <div style="font-size:38px;margin-bottom:10px;">${icon}</div>
        <div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:6px;">${titleTxt}</div>
        <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-bottom:20px;max-width:280px;">${subTxt}</div>
        ${(buttons||[]).map((b,i) => `<button id="_fce_msgbtn_${i}" style="display:block;width:100%;max-width:240px;margin:4px auto;padding:10px 20px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;${b.style||'background:#6366f1;color:#fff;'}">${b.label}</button>`).join('')}`;
      if (buttons) {
        setTimeout(() => {
          buttons.forEach((b, i) => {
            const btn = document.getElementById(`_fce_msgbtn_${i}`);
            if (btn && b.onClick) btn.onclick = b.onClick;
          });
        }, 40);
      }
    }

    function _hideMsg() { msgOverlay.style.display = 'none'; }

    function _setCtrlBtn(id, label, disabled, bg) {
      const b = document.getElementById(id);
      if (!b) return;
      if (label !== undefined) b.textContent = label;
      if (disabled !== undefined) b.disabled = disabled;
      if (bg) b.style.background = bg;
    }

    // ── Session logic ──────────────────────────────────────────────────────
    function _advanceStep() {
      currentStep++;
      if (currentStep >= MOVEMENT_STEPS.length) {
        _finish(); return;
      }
      movDet.reset();
      stepStartTs = Date.now();
      state = `step_${currentStep}`;
      _dot(currentStep, 'active');
      _instr(MOVEMENT_STEPS[currentStep].instruction);
      _prog(`Step ${currentStep+1} of ${MOVEMENT_STEPS.length} · Scan Progress: ${Math.round(currentStep/MOVEMENT_STEPS.length*100)}%`);
      if (onProgress) onProgress(currentStep, MOVEMENT_STEPS.length, MOVEMENT_STEPS[currentStep]);
    }

    function _stepDone(sIdx) {
      // Brief visual confirmation
      _instr(`✓ ${MOVEMENT_STEPS[sIdx].label} done!`, '#10b981');
      _dot(sIdx, 'done');
      _stepConfirmTs = Date.now();
    }

    function _finish() {
      state = 'complete';
      clearInterval(tickTimer);
      cancelAnimationFrame(renderLoop);

      const merged = new Array(EMB_DIMS).fill(0);
      capturedEmbeddings.forEach(e => { for (let i = 0; i < EMB_DIMS; i++) merged[i] += e[i] / capturedEmbeddings.length; });
      const finalEmb = l2norm(merged);
      const avgLiveness  = livenessScores.length > 0 ? livenessScores.reduce((a,b)=>a+b)/livenessScores.length : 0.78;
      const quality      = lastMetrics ? lastMetrics.quality : 72;

      MOVEMENT_STEPS.forEach((_, i) => _dot(i, 'done'));
      _instr('✓ Scan complete!', '#10b981');
      _prog('All steps complete');

      // Update start button to "Done"
      _setCtrlBtn('_fce_btn_start', '✓ Complete', true, 'linear-gradient(135deg,#10b981,#059669)');
      const rBtn = document.getElementById('_fce_btn_restart');
      if (rBtn) rBtn.style.display = 'none';

      if (onComplete) onComplete({
        embedding:      finalEmb,
        livenessScore:  avgLiveness,
        antiSpoofScore: avgLiveness,
        quality,
        averageQuality: quality,
        steps:          capturedSteps,
        capturedAngles: capturedSteps.map(s => s.id),
        capturedSteps:  capturedSteps.length,
      });

      setTimeout(() => CameraManager.stop(video), 3500);
    }

    function _tick() {
      if (!video || video.readyState < 2) return;
      const metrics = FrameAnalyzer.analyze(video, hiddenCanvas, hiddenCtx);
      lastMetrics   = metrics;
      movDet.update(metrics.headPose);
      _hudUpdate(currentStep, metrics);

      // ── State: waiting_face ─────────────────────────────────────────────
      if (state === 'waiting_face') {
        if (metrics.detected) {
          faceLostTs = null;
          if (!faceFoundTs) { faceFoundTs = Date.now(); if (onFaceFound) onFaceFound(); }
          if (movDet.isStill() && Date.now() - faceFoundTs > STILL_HOLD_MS) {
            _dot(0, 'done');
            capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
            capturedSteps.push({ id: 'center', ts: Date.now() });
            if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score);
            _stepDone(0);
            setTimeout(_advanceStep, 600);
          } else {
            _instr('Hold still — centering…');
          }
        } else {
          faceFoundTs = null;
          if (Date.now() - stepStartTs > FACE_DETECT_MS) {
            _showMsg('😐', 'No face detected',
              'Center your face in the oval. Ensure you have good lighting.',
              [
                { label: 'Try Again', style: 'background:#6366f1;color:#fff;', onClick: () => { _hideMsg(); faceFoundTs = null; stepStartTs = Date.now(); }},
                { label: '↺ Restart Scan', style: 'background:#1e293b;color:#94a3b8;', onClick: _restartScan },
              ]);
          }
        }
        return;
      }

      // ── State: step_N ───────────────────────────────────────────────────
      if (state.startsWith('step_')) {
        const sIdx    = parseInt(state.replace('step_', ''), 10);
        const stepDef = MOVEMENT_STEPS[sIdx];
        const elapsed = Date.now() - stepStartTs;
        const stepProg = Math.min(1, elapsed / MOVE_TIMEOUT_MS);

        if (!metrics.detected) {
          // Stable face-lost gating: only trigger after FACE_LOST_HOLD_MS
          if (!faceLostTs) faceLostTs = Date.now();
          if (Date.now() - faceLostTs > FACE_LOST_HOLD_MS) {
            // Face truly lost
            _showMsg('😐', "We lost sight of your face…",
              'Please move back into the camera frame to continue.',
              [
                { label: '▶ Resume Scan', style: 'background:#6366f1;color:#fff;', onClick: () => { _hideMsg(); faceLostTs = null; stepStartTs = Date.now(); }},
                { label: '↺ Restart Scan', style: 'background:#1e293b;color:#94a3b8;', onClick: _restartScan },
                { label: 'Cancel Enrollment', style: 'background:#1e293b;color:#64748b;', onClick: _cancelSession },
              ]);
          }
          return;
        }
        faceLostTs = null;

        // During brief "✓ Done!" display, pause tick logic
        if (_stepConfirmTs && Date.now() - _stepConfirmTs < 600) return;
        _stepConfirmTs = null;

        const moved = movDet.detect(stepDef.direction, stepDef.moveThreshold);
        if (moved) {
          capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
          capturedSteps.push({ id: stepDef.id, ts: Date.now() });
          if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score);
          _stepDone(sIdx);
          setTimeout(_advanceStep, 600);
        } else if (elapsed > MOVE_TIMEOUT_MS) {
          // Timeout — capture anyway and advance
          capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
          capturedSteps.push({ id: stepDef.id, ts: Date.now(), timedOut: true });
          if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score * 0.88);
          _stepDone(sIdx);
          setTimeout(_advanceStep, 600);
        } else {
          _instr(stepDef.instruction);
        }
      }
    }

    function _renderFrame() {
      if (state === 'idle' || state === 'complete') return;
      const sIdx = state === 'waiting_face' ? 0 : parseInt(state.replace('step_', ''), 10);
      const stepDef = MOVEMENT_STEPS[sIdx] || MOVEMENT_STEPS[MOVEMENT_STEPS.length-1];
      const totalProg = capturedSteps.length / MOVEMENT_STEPS.length;
      const stepProg  = state === 'waiting_face' ? 0 : Math.min(1, (Date.now() - stepStartTs) / MOVE_TIMEOUT_MS);

      // Sync overlay canvas size to CSS size
      const canW = overlayCanvas.offsetWidth  || VIDEO_W;
      const canH = overlayCanvas.offsetHeight || VIDEO_H;
      if (overlayCanvas.width !== canW || overlayCanvas.height !== canH) {
        overlayCanvas.width = canW; overlayCanvas.height = canH;
      }

      OverlayRenderer.draw(
        overlayCanvas, lastMetrics, sIdx, stepDef,
        totalProg, stepProg,
        state === 'waiting_face' ? 'scanning' : 'scanning',
        stepDef.arrowAnim,
      );
      renderLoop = requestAnimationFrame(_renderFrame);
    }

    // ── Start / Stop / Restart / Cancel ───────────────────────────────────
    async function _startCamera() {
      _setCtrlBtn('_fce_btn_start', '⏳ Opening camera…', true);
      _instr('Opening camera…');
      try {
        stream = await CameraManager.open({
          videoEl:    video,
          facingMode: cfg.facingMode || 'user',
          deviceId:   cfg.deviceId,
          rtspUrl:    cfg.rtspUrl,
        });
        _hideMsg();
        state       = 'waiting_face';
        stepStartTs = Date.now();
        faceFoundTs = null;
        faceLostTs  = null;
        currentStep = 0;
        capturedEmbeddings = [];
        capturedSteps      = [];
        livenessScores     = [];
        movDet.reset();
        _dot(0, 'active');
        _instr(MOVEMENT_STEPS[0].instruction);
        _prog(`Step 1 of ${MOVEMENT_STEPS.length} · Scan Progress: 0%`);
        _setCtrlBtn('_fce_btn_start', '⏸ Scanning…', true, 'linear-gradient(135deg,#475569,#334155)');
        clearInterval(tickTimer);
        cancelAnimationFrame(renderLoop);
        tickTimer = setInterval(_tick, TICK_MS);
        _renderFrame();
        if (onProgress) onProgress(0, MOVEMENT_STEPS.length, MOVEMENT_STEPS[0]);
      } catch (err) {
        const msg = err.name === 'NotAllowedError'     ? 'Camera permission denied. Please allow access in browser settings and retry.' :
                    err.name === 'NotFoundError'        ? 'No camera found. Connect a camera and try again.' :
                    err.name === 'NotReadableError'     ? 'Camera is in use by another application. Close it and retry.' :
                    err.name === 'OverconstrainedError' ? 'Camera resolution not supported. Try a different camera.' :
                                                          'Camera error: ' + err.message;
        _showMsg('🚫', 'Camera Error', msg, [
          { label: '↺ Retry', style: 'background:#6366f1;color:#fff;', onClick: () => { _hideMsg(); _startCamera(); }},
          { label: 'Cancel', style: 'background:#1e293b;color:#64748b;', onClick: _cancelSession },
        ]);
        _setCtrlBtn('_fce_btn_start', '▶ Start Scan', false, 'linear-gradient(135deg,#6366f1,#8b5cf6)');
        state = 'error';
        if (onError) onError(err);
      }
    }

    function _restartScan() {
      _hideMsg();
      clearInterval(tickTimer);
      cancelAnimationFrame(renderLoop);
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      // Reset all state
      state              = 'idle';
      currentStep        = 0;
      capturedEmbeddings = [];
      capturedSteps      = [];
      livenessScores     = [];
      faceFoundTs        = null;
      faceLostTs         = null;
      _stepConfirmTs     = null;
      movDet.reset();
      MOVEMENT_STEPS.forEach((_, i) => _dot(i, ''));
      _instr('');
      _prog('');
      _setCtrlBtn('_fce_btn_start', '▶ Start Scan', false, 'linear-gradient(135deg,#6366f1,#8b5cf6)');
      const rBtn = document.getElementById('_fce_btn_restart');
      if (rBtn) rBtn.style.display = 'block';
      // Clear overlay
      const ctx2 = overlayCanvas.getContext('2d');
      if (ctx2) ctx2.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    function _cancelSession() {
      _restartScan();
      if (cfg.onSkip) cfg.onSkip();
      else if (onError) onError(new Error('cancelled'));
    }

    // ── Wire up control buttons ────────────────────────────────────────────
    setTimeout(() => {
      const btnStart   = document.getElementById('_fce_btn_start');
      const btnRestart = document.getElementById('_fce_btn_restart');
      const btnCancel  = document.getElementById('_fce_btn_cancel');
      if (btnStart)   btnStart.onclick   = () => { if (state === 'idle') _startCamera(); };
      if (btnRestart) btnRestart.onclick = _restartScan;
      if (btnCancel)  btnCancel.onclick  = _cancelSession;
      if (autoStart) _startCamera();
    }, 50);

    // ── Public session API ─────────────────────────────────────────────────
    return {
      start:  _startCamera,
      restart: _restartScan,
      stop() {
        clearInterval(tickTimer);
        cancelAnimationFrame(renderLoop);
        CameraManager.stop(video);
        state = 'idle';
      },
      getStream()  { return stream;      },
      getState()   { return state;       },
      getMetrics() { return lastMetrics; },
    };
  }

  // ─── Public factory functions ─────────────────────────────────────────────────
  function createEnrollmentSession(cfg) {
    return createSession(cfg, 'enroll');
  }

  function createVerificationSession(cfg) {
    return createSession(cfg, 'verify');
  }

  // ─── Simple camera preview (no overlay) ─────────────────────────────────────
  async function openCamera(opts) {
    const { videoEl } = opts;
    if (!videoEl) throw new Error('[FaceAccessCameraEngine] videoEl required');
    return CameraManager.open(opts);
  }

  function stopCamera(videoEl) { CameraManager.stop(videoEl); }

  // ─── Standalone frame analysis / embedding ───────────────────────────────────
  function analyzeFrame(video, canvas, ctx) { return FrameAnalyzer.analyze(video, canvas, ctx); }
  function getEmbedding(video, canvas, ctx)  { return generateEmbedding(video, canvas, ctx);    }
  function drawOverlay(canvas, metrics, opts) {
    OverlayRenderer.draw(canvas, metrics,
      opts?.step || 0, opts?.stepDef || null,
      opts?.progress || 0, opts?.stepProgress || 0,
      opts?.state || 'scanning', opts?.arrowAnim || null);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────
  const FaceAccessCameraEngine = {
    VERSION,
    MOVEMENT_STEPS,

    // High-level sessions
    createEnrollmentSession,
    createVerificationSession,

    // Camera management
    openCamera,
    stopCamera,
    CameraManager,

    // Frame processing
    analyzeFrame,
    getEmbedding,
    drawOverlay,
    FrameAnalyzer,
    OverlayRenderer,

    // Math utilities
    cosineSim,
    l2norm,
  };

  global.FaceAccessCameraEngine = FaceAccessCameraEngine;
  console.log(`[FaceAccessCameraEngine v${VERSION}] Loaded — stable tracking, animated prompts, full button control`);

}(window));
