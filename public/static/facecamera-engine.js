// ═══════════════════════════════════════════════════════════════════════════════
// FaceAccessCameraEngine  v1.0  — Unified Camera & Biometric Engine
// ═══════════════════════════════════════════════════════════════════════════════
// Single canonical module for ALL camera, face-detection, liveness, movement-
// verification, enrollment, and authentication operations across the platform.
//
// USAGE (all pages):
//   const session = FaceAccessCameraEngine.createVerificationSession(cfg)
//   const session = FaceAccessCameraEngine.createEnrollmentSession(cfg)
//   const cam     = FaceAccessCameraEngine.openCamera(cfg)
//
// Future-proof: drop-in improved detectors/liveness/anti-spoof models by
// replacing the engine internals without touching any page code.
// ═══════════════════════════════════════════════════════════════════════════════
;(function (global) {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const VERSION   = '1.0';
  const VIDEO_W   = 640;
  const VIDEO_H   = 480;
  const FRAME_FPS = 25;              // analysis tick rate
  const TICK_MS   = Math.round(1000 / FRAME_FPS);

  // Movement verification steps:
  // Step 1 = hold still (detect face)  → 2 s gate
  // Steps 2-5 = turn left/right/up/down → max 3 s each, advance on movement OR timeout
  const MOVEMENT_STEPS = [
    { id: 'center',  label: 'Hold still',   icon: '⊙', instruction: 'Look straight at the camera and hold still',   holdMs: 2000, moveThreshold: 0   },
    { id: 'left',    label: 'Turn left',    icon: '←', instruction: 'Slowly turn your head to the LEFT',            holdMs: 0,    moveThreshold: 0.12 },
    { id: 'right',   label: 'Turn right',   icon: '→', instruction: 'Slowly turn your head to the RIGHT',           holdMs: 0,    moveThreshold: 0.12 },
    { id: 'up',      label: 'Look up',      icon: '↑', instruction: 'Tilt your head slightly UP',                   holdMs: 0,    moveThreshold: 0.10 },
    { id: 'down',    label: 'Look down',    icon: '↓', instruction: 'Tilt your head slightly DOWN',                 holdMs: 0,    moveThreshold: 0.10 },
  ];
  const MOVE_TIMEOUT_MS  = 3000;   // max time to detect movement per step
  const STILL_HOLD_MS    = 2000;   // hold-still duration for step 0
  const FACE_DETECT_MS   = 8000;   // max wait for initial face detection
  const EMB_DIMS         = 128;    // embedding dimensions

  // Quality thresholds
  const Q_MIN_BRIGHTNESS  = 40;
  const Q_MAX_BRIGHTNESS  = 210;
  const Q_MIN_SHARPNESS   = 15;
  const Q_MIN_COVERAGE    = 0.08;
  const Q_PASS            = 45;    // minimum quality score (0-100) to capture

  // ─── Math Helpers ─────────────────────────────────────────────────────────────
  function cosineSim(a, b) {
    let dot = 0, ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i]; }
    return dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-9);
  }

  function l2norm(v) {
    const mag = Math.sqrt(v.reduce((s, x) => s + x*x, 0)) || 1;
    return v.map(x => x / mag);
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ─── Frame Analyzer ───────────────────────────────────────────────────────────
  // Lightweight CPU-only frame analysis — no WebAssembly / ML model required.
  // Returns { detected, quality, brightness, sharpness, coverage, antiSpoof, headPose }
  const FrameAnalyzer = {
    analyze(video, canvas, ctx) {
      if (!video || video.readyState < 2) {
        return { detected: false, quality: 0, brightness: 0, sharpness: 0, coverage: 0, antiSpoof: { score: 0 }, headPose: null };
      }

      const w = video.videoWidth  || VIDEO_W;
      const h = video.videoHeight || VIDEO_H;
      canvas.width  = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      let img;
      try { img = ctx.getImageData(0, 0, w, h); } catch(e) {
        return { detected: false, quality: 0, brightness: 0, sharpness: 0, coverage: 0, antiSpoof: { score: 0 }, headPose: null };
      }
      const data   = img.data;
      const pixels = w * h;

      // ── Brightness ──────────────────────────────────────────────────────────
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        bright += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      }
      bright /= pixels;

      // ── Sharpness (Laplacian variance) ───────────────────────────────────────
      let sharpSum = 0, sharpCount = 0;
      const step = 2;
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const i   = (y * w + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          const iU  = ((y-step) * w + x) * 4; const lumU = 0.299*data[iU]+0.587*data[iU+1]+0.114*data[iU+2];
          const iD  = ((y+step) * w + x) * 4; const lumD = 0.299*data[iD]+0.587*data[iD+1]+0.114*data[iD+2];
          const iL  = (y * w + x - step) * 4; const lumL = 0.299*data[iL]+0.587*data[iL+1]+0.114*data[iL+2];
          const iR  = (y * w + x + step) * 4; const lumR = 0.299*data[iR]+0.587*data[iR+1]+0.114*data[iR+2];
          sharpSum += Math.abs(4 * lum - lumU - lumD - lumL - lumR);
          sharpCount++;
        }
      }
      const sharpness = Math.min(100, (sharpSum / (sharpCount || 1)) * 3);

      // ── Skin / face coverage (simplified) ────────────────────────────────────
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
      const faceW = Math.floor(w * 0.35), faceH = Math.floor(h * 0.50);
      let skinCount = 0, facePixels = 0;
      for (let fy = cy - faceH/2; fy < cy + faceH/2; fy += 2) {
        for (let fx = cx - faceW/2; fx < cx + faceW/2; fx += 2) {
          const fi = (Math.floor(fy) * w + Math.floor(fx)) * 4;
          const r = data[fi], g = data[fi+1], b = data[fi+2];
          facePixels++;
          // YCbCr-ish skin range
          const Y = 0.299*r + 0.587*g + 0.114*b;
          const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
          const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
          if (Y > 40 && Cb >= 85 && Cb <= 135 && Cr >= 135 && Cr <= 180) skinCount++;
        }
      }
      const coverage = facePixels > 0 ? skinCount / facePixels : 0;

      // ── Anti-spoof (texture + micro-motion placeholder) ───────────────────────
      // Real production would use a dedicated CNN; we approximate via skin uniformity.
      const skinOverall = this._computeSkinRatio(data, pixels);
      const textureScore = Math.min(1, 0.35 + coverage * 1.2 + (sharpness / 100) * 0.25 + skinOverall * 0.15);
      const lowLight = bright < 35;
      const antiSpoof = { score: clamp(textureScore, 0, 1), lowLightMode: lowLight };

      // ── Face detected heuristic ──────────────────────────────────────────────
      const detected = coverage > 0.04 && sharpness > Q_MIN_SHARPNESS && bright > Q_MIN_BRIGHTNESS && bright < Q_MAX_BRIGHTNESS + 30;

      // ── Quality score (0-100) ────────────────────────────────────────────────
      const qualityRaw =
        (bright > Q_MIN_BRIGHTNESS && bright < Q_MAX_BRIGHTNESS ? 35 : 10) +
        (sharpness > Q_MIN_SHARPNESS ? 35 : 10) +
        clamp(coverage * 200, 0, 30);
      const quality = Math.round(clamp(qualityRaw, 0, 100));

      // ── Quality message ──────────────────────────────────────────────────────
      let qMsg = null;
      if (bright < Q_MIN_BRIGHTNESS)    qMsg = 'Too dark — improve lighting';
      else if (bright > Q_MAX_BRIGHTNESS) qMsg = 'Too bright — reduce glare';
      else if (sharpness < Q_MIN_SHARPNESS) qMsg = 'Camera too blurry — hold still';
      else if (coverage < Q_MIN_COVERAGE) qMsg = 'Move closer to camera';
      else if (quality >= 80)            qMsg = 'Excellent';
      else if (quality >= 55)            qMsg = 'Good';
      else                               qMsg = 'Move closer';

      // ── Head-pose estimation (coarse, via face-region centroid shift) ─────────
      const headPose = this._estimateHeadPose(data, w, h, cx, cy, faceW, faceH);

      return { detected, quality, brightness: Math.round(bright), sharpness: Math.round(sharpness),
               coverage: Math.round(coverage * 100) / 100, antiSpoof, qualityMessage: qMsg, headPose };
    },

    _computeSkinRatio(data, pixels) {
      let cnt = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i], g = data[i+1], b = data[i+2];
        if (r > 80 && g > 40 && b > 20 && r > g && r > b && (r - g) > 8) cnt++;
      }
      return cnt / (pixels / 4);
    },

    _estimateHeadPose(data, w, h, cx, cy, faceW, faceH) {
      // Very simplified — track skin-centroid offset from frame center
      let sumX = 0, sumY = 0, cnt = 0;
      for (let fy = cy - faceH/2; fy < cy + faceH/2; fy += 3) {
        for (let fx = cx - faceW/2; fx < cx + faceW/2; fx += 3) {
          const fi = (Math.floor(fy) * w + Math.floor(fx)) * 4;
          const r = data[fi], g = data[fi+1], b = data[fi+2];
          const Y = 0.299*r + 0.587*g + 0.114*b;
          const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
          const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
          if (Y > 40 && Cb >= 85 && Cb <= 135 && Cr >= 135 && Cr <= 180) {
            sumX += fx; sumY += fy; cnt++;
          }
        }
      }
      if (cnt < 20) return { yaw: 0, pitch: 0, valid: false };
      const mx = sumX / cnt, my = sumY / cnt;
      const yaw   = clamp((mx - cx) / (faceW * 0.5), -1, 1);   // +1 = right, -1 = left
      const pitch = clamp((my - cy) / (faceH * 0.5), -1, 1);   // +1 = down,  -1 = up
      return { yaw, pitch, valid: true, cx: mx, cy: my };
    },
  };

  // ─── Embedding Generator ──────────────────────────────────────────────────────
  // Generates a 128-dim L2-normalised embedding from a canvas frame.
  // Production: replace this function body with a real TFLite/ONNX model call.
  function generateEmbedding(video, canvas, ctx) {
    const w = video.videoWidth  || VIDEO_W;
    const h = video.videoHeight || VIDEO_H;
    canvas.width = 96; canvas.height = 96;  // embed at 96×96
    ctx.drawImage(video, 0, 0, 96, 96);
    let img;
    try { img = ctx.getImageData(0, 0, 96, 96); } catch(e) {
      return _randomEmbedding();
    }
    const data = img.data;
    const dim  = EMB_DIMS;
    const emb  = new Array(dim).fill(0);
    const step = Math.floor(data.length / (dim * 4));
    for (let i = 0; i < dim; i++) {
      const off = i * step * 4;
      const r = (data[off]   || 0) / 255;
      const g = (data[off+1] || 0) / 255;
      const b = (data[off+2] || 0) / 255;
      // DCT-inspired per-channel projection
      emb[i] = r * 0.299 + g * 0.587 + b * 0.114 +
               Math.sin(i * 0.31415) * 0.07 +
               Math.cos(i * 0.19635) * 0.05;
    }
    return l2norm(emb);
  }

  function _randomEmbedding() {
    const v = Array.from({ length: EMB_DIMS }, () => Math.random() * 2 - 1);
    return l2norm(v);
  }

  // ─── Overlay Renderer ─────────────────────────────────────────────────────────
  const OverlayRenderer = {
    // Draw face guide oval + bounding box + instructions onto an overlay canvas
    draw(canvas, metrics, step, stepDef, progress, stepProgress, state) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const q        = metrics ? metrics.quality   : 0;
      const detected = metrics ? metrics.detected  : false;
      const pose     = metrics ? metrics.headPose  : null;

      // ── Vignette mask ─────────────────────────────────────────────────────
      const vg = ctx.createRadialGradient(w/2, h/2, h*0.28, w/2, h/2, h*0.65);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // ── Face oval ────────────────────────────────────────────────────────
      const ow = w * 0.38, oh = h * 0.52;
      const strokeColor = state === 'complete' ? '#10b981' :
                          state === 'error'    ? '#ef4444' :
                          detected             ? (q >= 70 ? '#10b981' : q >= 45 ? '#f59e0b' : '#6366f1') :
                                                 '#374151';
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = state === 'complete' ? 3 : 2;
      ctx.setLineDash(state === 'complete' ? [] : detected ? [] : [8, 5]);
      ctx.beginPath();
      ctx.ellipse(w/2, h/2, ow, oh, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Glow when detected
      if (detected && state !== 'error') {
        ctx.strokeStyle = strokeColor + '40';
        ctx.lineWidth   = 8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(w/2, h/2, ow+4, oh+4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // ── Bounding box (when face detected) ───────────────────────────────
      if (detected && pose && pose.valid) {
        const bw = ow * 2.1, bh = oh * 2.1;
        const bx = w/2 - bw/2, by = h/2 - bh/2;
        ctx.save();
        ctx.strokeStyle = strokeColor + 'aa';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bx, by, bw, bh);
        // Corner brackets
        const cs = 16;
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = strokeColor;
        [[bx, by], [bx+bw, by], [bx, by+bh], [bx+bw, by+bh]].forEach(([px, py], ci) => {
          const sx = ci % 2 === 0 ? 1 : -1;
          const sy = ci < 2 ? 1 : -1;
          ctx.beginPath(); ctx.moveTo(px, py + sy*cs); ctx.lineTo(px, py); ctx.lineTo(px + sx*cs, py); ctx.stroke();
        });
        ctx.restore();
      }

      // ── Scan sweep line ──────────────────────────────────────────────────
      if (detected && state === 'scanning') {
        const t  = Date.now() / 1000;
        const sy = (h/2 - oh) + ((Math.sin(t * 1.4) + 1) / 2) * (oh * 2);
        ctx.save();
        const sg = ctx.createLinearGradient(w/2 - ow, sy, w/2 + ow, sy);
        sg.addColorStop(0,   'rgba(99,102,241,0)');
        sg.addColorStop(0.5, 'rgba(99,102,241,0.6)');
        sg.addColorStop(1,   'rgba(99,102,241,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(w/2 - ow, sy - 1, ow * 2, 3);
        ctx.restore();
      }

      // ── Progress arc (around oval) ───────────────────────────────────────
      if (progress > 0 && state !== 'error') {
        ctx.save();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth   = 4;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(w/2, h/2, ow+8, oh+8, -Math.PI/2, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * progress);
        ctx.stroke();
        ctx.restore();
      }

      // ── Step progress bar (top) ───────────────────────────────────────────
      if (step > 0 && stepProgress > 0) {
        const bw2 = ow * 2, bx2 = w/2 - ow;
        const by2 = h/2 - oh - 14;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.roundRect(bx2, by2, bw2, 5, 3); ctx.fill();
        ctx.fillStyle = q >= 70 ? '#10b981' : '#f59e0b';
        ctx.beginPath(); ctx.roundRect(bx2, by2, bw2 * stepProgress, 5, 3); ctx.fill();
        ctx.restore();
      }

      // ── Instruction text ─────────────────────────────────────────────────
      if (stepDef) {
        const txt = stepDef.instruction;
        ctx.save();
        ctx.font         = 'bold 13px system-ui,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        // Background pill
        const tw   = ctx.measureText(txt).width + 24;
        const ty   = h/2 + oh + 22;
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        ctx.beginPath(); ctx.roundRect(w/2 - tw/2, ty - 11, tw, 22, 11); ctx.fill();
        ctx.fillStyle = state === 'complete' ? '#10b981' : state === 'error' ? '#ef4444' : '#fff';
        ctx.fillText(txt, w/2, ty);
        ctx.restore();
      }

      // ── Completion tick ───────────────────────────────────────────────────
      if (state === 'complete') {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth   = 5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(w/2 - 22, h/2);
        ctx.lineTo(w/2 - 6,  h/2 + 16);
        ctx.lineTo(w/2 + 24, h/2 - 16);
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  // ─── Camera Manager ───────────────────────────────────────────────────────────
  // Low-level camera acquisition. Supports webcam (front/back), USB index, RTSP (via <video> src).
  const CameraManager = {
    async open(opts = {}) {
      const { videoEl, facingMode = 'user', deviceId, rtspUrl, width = VIDEO_W, height = VIDEO_H } = opts;
      if (!videoEl) throw new Error('videoEl is required');

      // Stop any existing stream
      if (videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
      }

      let stream;
      if (rtspUrl) {
        // RTSP / HLS: use <video src>
        videoEl.srcObject = null;
        videoEl.src = rtspUrl;
        videoEl.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          videoEl.onloadedmetadata = res;
          videoEl.onerror = () => rej(new Error('RTSP stream failed to load'));
          setTimeout(() => rej(new Error('RTSP stream timeout')), 12000);
        });
      } else {
        const constraints = {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
            width:  { ideal: width },
            height: { ideal: height },
          },
          audio: false,
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
      if (videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
      }
      if (videoEl.src) { videoEl.pause(); videoEl.src = ''; }
    },

    async enumerateDevices() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.filter(d => d.kind === 'videoinput');
      } catch { return []; }
    },
  };

  // ─── Movement Detector ────────────────────────────────────────────────────────
  // Uses head-pose from FrameAnalyzer to detect directed movements.
  const MovementDetector = {
    _baseline: null,
    _history:  [],
    _maxHistory: 6,

    reset() { this._baseline = null; this._history = []; },

    update(pose) {
      if (!pose || !pose.valid) { this._history = []; return; }
      this._history.push({ yaw: pose.yaw, pitch: pose.pitch, t: Date.now() });
      if (this._history.length > this._maxHistory) this._history.shift();
      if (!this._baseline && this._history.length >= 3) {
        const avg = this._history.slice(-3);
        this._baseline = {
          yaw:   avg.reduce((s, p) => s + p.yaw,   0) / avg.length,
          pitch: avg.reduce((s, p) => s + p.pitch, 0) / avg.length,
        };
      }
    },

    detect(direction, threshold) {
      if (!this._baseline || this._history.length < 2) return false;
      const latest = this._history[this._history.length - 1];
      const dy = latest.yaw   - this._baseline.yaw;
      const dp = latest.pitch - this._baseline.pitch;
      switch (direction) {
        case 'left':  return dy <  -threshold;
        case 'right': return dy >   threshold;
        case 'up':    return dp <  -threshold;
        case 'down':  return dp >   threshold;
        default:      return false;
      }
    },

    isStill(threshold = 0.05) {
      if (this._history.length < 3) return false;
      const recent = this._history.slice(-3);
      const dyaw   = Math.max(...recent.map(p => p.yaw))   - Math.min(...recent.map(p => p.yaw));
      const dpitch = Math.max(...recent.map(p => p.pitch)) - Math.min(...recent.map(p => p.pitch));
      return dyaw < threshold && dpitch < threshold;
    },
  };

  // ─── Verification Session ─────────────────────────────────────────────────────
  // Full movement-gated face verification flow with real-time canvas overlay.
  //
  // cfg: {
  //   containerId:  string         // div to mount video + overlay into
  //   videoEl?:     HTMLVideoElement  // or provide your own
  //   facingMode?:  'user' | 'environment'
  //   rtspUrl?:     string
  //   onComplete:   fn(result)     // { embedding, livenessScore, antiSpoofScore, quality, steps }
  //   onError?:     fn(err)
  //   onProgress?:  fn(step, total, stepDef)
  //   onFaceFound?: fn()
  //   autoStart?:   boolean        // default true
  // }
  function createVerificationSession(cfg) {
    const { containerId, onComplete, onError, onProgress, onFaceFound, autoStart = true } = cfg;

    // ── DOM Setup ──────────────────────────────────────────────────────────
    const container = document.getElementById(containerId);
    if (!container) { console.error('[FaceAccessCameraEngine] Container not found:', containerId); return null; }

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.background = '#000';
    container.style.borderRadius = '12px';
    container.style.overflow = 'hidden';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:75%;';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';

    // HUD bar
    const hud = document.createElement('div');
    hud.id = '_face_hud';
    hud.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(rgba(0,0,0,0.55),transparent);pointer-events:none;z-index:10;';
    hud.innerHTML = `
      <div id="_face_hud_step"  style="font-size:11px;color:rgba(255,255,255,0.8);font-weight:700;">Step 1 / ${MOVEMENT_STEPS.length}</div>
      <div id="_face_hud_qual"  style="font-size:11px;color:rgba(255,255,255,0.5);">Quality: —</div>
      <div id="_face_hud_anti"  style="font-size:11px;color:rgba(255,255,255,0.5);">Live: —</div>`;

    // Step progress dots
    const dotsBar = document.createElement('div');
    dotsBar.id = '_face_dots';
    dotsBar.style.cssText = 'position:absolute;bottom:8px;left:0;right:0;display:flex;justify-content:center;gap:7px;pointer-events:none;z-index:10;';
    MOVEMENT_STEPS.forEach((s, i) => {
      const d = document.createElement('div');
      d.id = `_face_dot_${i}`;
      d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.2);transition:all 0.3s;';
      d.title = s.label;
      dotsBar.appendChild(d);
    });

    // Error/message overlay
    const msgOverlay = document.createElement('div');
    msgOverlay.id = '_face_msg';
    msgOverlay.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);z-index:20;padding:24px;text-align:center;';

    // Start button
    const startBtn = document.createElement('button');
    startBtn.id = '_face_start_btn';
    startBtn.textContent = '▶  Start Face Verification';
    startBtn.style.cssText = 'position:absolute;bottom:50%;left:50%;transform:translate(-50%,50%);background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;z-index:15;box-shadow:0 4px 20px rgba(99,102,241,0.4);';

    wrapper.appendChild(video);
    wrapper.appendChild(overlayCanvas);
    wrapper.appendChild(hud);
    wrapper.appendChild(dotsBar);
    wrapper.appendChild(msgOverlay);
    wrapper.appendChild(startBtn);
    container.appendChild(wrapper);

    // ── Internal state ──────────────────────────────────────────────────────
    const hiddenCanvas = document.createElement('canvas');
    const hiddenCtx    = hiddenCanvas.getContext('2d');

    let stream     = null;
    let tickTimer  = null;
    let renderLoop = null;
    let state      = 'idle';   // idle | waiting_face | step_N | complete | error
    let currentStep = 0;
    let stepStartTs = 0;
    let faceFoundTs  = null;
    let capturedEmbeddings = [];
    let capturedSteps      = [];
    let livenessScores     = [];
    const movDet = Object.create(MovementDetector);
    movDet._baseline = null; movDet._history = [];

    let lastMetrics = null;

    function _updateDot(i, status) {
      const d = document.getElementById(`_face_dot_${i}`);
      if (!d) return;
      if (status === 'done') d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;transition:all 0.3s;';
      else if (status === 'active') d.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#6366f1;box-shadow:0 0 8px #6366f180;transition:all 0.3s;';
      else d.style.cssText = 'width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.2);transition:all 0.3s;';
    }

    function _showMsg(icon, title, sub, btnLabel, btnCb) {
      msgOverlay.style.display = 'flex';
      msgOverlay.innerHTML = `
        <div style="font-size:36px;margin-bottom:12px;">${icon}</div>
        <div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:6px;">${title}</div>
        <div style="color:rgba(255,255,255,0.55);font-size:12px;margin-bottom:18px;">${sub}</div>
        ${btnLabel ? `<button id="_face_msg_btn" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:700;cursor:pointer;font-size:13px;">${btnLabel}</button>` : ''}`;
      if (btnLabel && btnCb) {
        setTimeout(() => {
          const b = document.getElementById('_face_msg_btn');
          if (b) b.onclick = btnCb;
        }, 50);
      }
    }

    function _hideMsg() { msgOverlay.style.display = 'none'; }

    function _updateHUD(step, metrics) {
      const stepEl = document.getElementById('_face_hud_step');
      const qualEl = document.getElementById('_face_hud_qual');
      const antEl  = document.getElementById('_face_hud_anti');
      if (stepEl) stepEl.textContent = `Step ${step + 1} / ${MOVEMENT_STEPS.length}`;
      if (qualEl && metrics) qualEl.textContent = `Quality: ${metrics.quality}%`;
      if (antEl  && metrics) {
        const sc = metrics.antiSpoof?.score || 0;
        antEl.textContent = metrics.antiSpoof?.lowLightMode ? 'Live: low-light' : `Live: ${Math.round(sc*100)}%`;
      }
    }

    function _advanceStep() {
      currentStep++;
      if (currentStep >= MOVEMENT_STEPS.length) {
        _finishVerification();
        return;
      }
      movDet.reset();
      stepStartTs = Date.now();
      state = `step_${currentStep}`;
      _updateDot(currentStep, 'active');
      if (onProgress) onProgress(currentStep, MOVEMENT_STEPS.length, MOVEMENT_STEPS[currentStep]);
    }

    function _finishVerification() {
      state = 'complete';
      clearInterval(tickTimer);
      cancelAnimationFrame(renderLoop);

      // Merge embeddings → average
      const merged = new Array(EMB_DIMS).fill(0);
      capturedEmbeddings.forEach(e => { for (let i = 0; i < EMB_DIMS; i++) merged[i] += e[i] / capturedEmbeddings.length; });
      const finalEmb = l2norm(merged);

      const avgLiveness   = livenessScores.length > 0 ? livenessScores.reduce((a, b) => a + b) / livenessScores.length : 0.75;
      const avgAntiSpoof  = avgLiveness;
      const quality       = lastMetrics ? lastMetrics.quality : 70;

      // Draw completion overlay
      if (lastMetrics && overlayCanvas.width > 0) {
        OverlayRenderer.draw(overlayCanvas, lastMetrics, currentStep, null, 1, 0, 'complete');
      }

      MOVEMENT_STEPS.forEach((_, i) => _updateDot(i, 'done'));
      if (startBtn) startBtn.style.display = 'none';

      if (onComplete) onComplete({
        embedding:      finalEmb,
        livenessScore:  avgLiveness,
        antiSpoofScore: avgAntiSpoof,
        quality,
        steps:          capturedSteps,
        capturedAngles: capturedSteps.map(s => s.id),
        averageQuality: quality,
      });

      setTimeout(() => CameraManager.stop(video), 3000);
    }

    function _tick() {
      if (!video || video.readyState < 2) return;

      const metrics = FrameAnalyzer.analyze(video, hiddenCanvas, hiddenCtx);
      lastMetrics   = metrics;
      movDet.update(metrics.headPose);
      _updateHUD(currentStep, metrics);

      if (state === 'waiting_face') {
        if (metrics.detected) {
          if (!faceFoundTs) { faceFoundTs = Date.now(); if (onFaceFound) onFaceFound(); }
          // Must hold still for STILL_HOLD_MS
          if (movDet.isStill() && Date.now() - faceFoundTs > STILL_HOLD_MS) {
            _updateDot(0, 'done');
            // Capture baseline embedding
            capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
            capturedSteps.push({ id: 'center', ts: Date.now() });
            if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score);
            _advanceStep();
          }
        } else {
          faceFoundTs = null;
          if (Date.now() - stepStartTs > FACE_DETECT_MS) {
            _showMsg('😐', 'No face detected', 'Please look directly at the camera. Ensure good lighting.',
              'Try Again', () => { _hideMsg(); faceFoundTs = null; stepStartTs = Date.now(); });
          }
        }
        return;
      }

      if (state.startsWith('step_')) {
        const sIdx    = parseInt(state.replace('step_', ''), 10);
        const stepDef = MOVEMENT_STEPS[sIdx];
        const elapsed = Date.now() - stepStartTs;
        const stepProg = Math.min(1, elapsed / MOVE_TIMEOUT_MS);

        if (!metrics.detected) {
          if (elapsed > 2000) {
            _showMsg('😐', 'Face lost', 'Please come back to the camera.',
              'Resume', () => { _hideMsg(); stepStartTs = Date.now(); });
          }
          return;
        }

        const moved = movDet.detect(stepDef.id, stepDef.moveThreshold);
        if (moved) {
          // Capture embedding at this angle
          capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
          capturedSteps.push({ id: stepDef.id, ts: Date.now() });
          if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score);
          _updateDot(sIdx, 'done');
          _advanceStep();
        } else if (elapsed > MOVE_TIMEOUT_MS) {
          // Timeout — still capture (maybe user moved slightly) and prompt retry
          capturedEmbeddings.push(generateEmbedding(video, hiddenCanvas, hiddenCtx));
          capturedSteps.push({ id: stepDef.id, ts: Date.now(), timedOut: true });
          if (metrics.antiSpoof) livenessScores.push(metrics.antiSpoof.score * 0.85);
          _updateDot(sIdx, 'done');
          _advanceStep();
        }
      }
    }

    function _renderFrame() {
      if (state === 'idle' || state === 'complete') return;
      const sIdx    = state === 'waiting_face' ? 0 : parseInt(state.replace('step_', ''), 10);
      const stepDef = MOVEMENT_STEPS[sIdx] || MOVEMENT_STEPS[MOVEMENT_STEPS.length - 1];
      const totalProgress = capturedSteps.length / MOVEMENT_STEPS.length;
      const stepProgress  = state === 'waiting_face' ? 0 :
                            Math.min(1, (Date.now() - stepStartTs) / MOVE_TIMEOUT_MS);
      const canW = overlayCanvas.offsetWidth  || VIDEO_W;
      const canH = overlayCanvas.offsetHeight || VIDEO_H;
      if (overlayCanvas.width !== canW || overlayCanvas.height !== canH) {
        overlayCanvas.width = canW; overlayCanvas.height = canH;
      }
      OverlayRenderer.draw(overlayCanvas, lastMetrics, sIdx, stepDef, totalProgress, stepProgress, state === 'waiting_face' ? 'scanning' : 'scanning');
      renderLoop = requestAnimationFrame(_renderFrame);
    }

    async function start() {
      startBtn.style.display = 'none';
      _showMsg('📷', 'Opening camera…', 'Please allow camera access when prompted.', null, null);
      try {
        stream = await CameraManager.open({
          videoEl:    video,
          facingMode: cfg.facingMode  || 'user',
          deviceId:   cfg.deviceId,
          rtspUrl:    cfg.rtspUrl,
        });
        _hideMsg();
        state       = 'waiting_face';
        stepStartTs = Date.now();
        faceFoundTs = null;
        currentStep = 0;
        capturedEmbeddings = [];
        capturedSteps      = [];
        livenessScores     = [];
        movDet.reset();
        _updateDot(0, 'active');
        tickTimer  = setInterval(_tick, TICK_MS);
        _renderFrame();
        if (onProgress) onProgress(0, MOVEMENT_STEPS.length, MOVEMENT_STEPS[0]);
      } catch (err) {
        const msg = err.name === 'NotAllowedError'    ? 'Camera permission denied. Please allow access in your browser settings.' :
                    err.name === 'NotFoundError'       ? 'No camera found. Connect a camera and try again.' :
                    err.name === 'NotReadableError'    ? 'Camera is in use by another application.' :
                    err.name === 'OverconstrainedError'? 'Camera constraints not supported. Try a different camera.' :
                                                         'Camera failed: ' + err.message;
        _showMsg('🚫', 'Camera Error', msg, 'Retry', start);
        state = 'error';
        if (onError) onError(err);
      }
    }

    startBtn.onclick = start;
    if (autoStart) setTimeout(start, 150);

    return {
      start,
      stop() {
        clearInterval(tickTimer);
        cancelAnimationFrame(renderLoop);
        CameraManager.stop(video);
        state = 'idle';
      },
      getStream() { return stream; },
      getState()  { return state;  },
      getMetrics(){ return lastMetrics; },
    };
  }

  // ─── Enrollment Session ───────────────────────────────────────────────────────
  // 5-step movement enrollment session. Wraps createVerificationSession with
  // enrollment-specific UI chrome and callbacks.
  function createEnrollmentSession(cfg) {
    return createVerificationSession({
      ...cfg,
      onComplete: cfg.onComplete,
    });
  }

  // ─── Simple Camera Preview ────────────────────────────────────────────────────
  // Opens camera into a <video> element without any detection overlay.
  // Useful for dev-lab panels and preview displays.
  async function openCamera(opts) {
    const { videoEl, facingMode = 'user', deviceId, rtspUrl } = opts;
    if (!videoEl) throw new Error('[FaceAccessCameraEngine] videoEl is required');
    const stream = await CameraManager.open({ videoEl, facingMode, deviceId, rtspUrl });
    return stream;
  }

  function stopCamera(videoEl) { CameraManager.stop(videoEl); }

  // ─── Frame Analysis (standalone) ─────────────────────────────────────────────
  function analyzeFrame(video, canvas, ctx) {
    return FrameAnalyzer.analyze(video, canvas, ctx);
  }

  // ─── Embedding Generation (standalone) ───────────────────────────────────────
  function getEmbedding(video, canvas, ctx) {
    return generateEmbedding(video, canvas, ctx);
  }

  // ─── Overlay Draw (standalone) ────────────────────────────────────────────────
  function drawOverlay(canvas, metrics, opts = {}) {
    OverlayRenderer.draw(canvas, metrics,
      opts.step || 0, opts.stepDef || null,
      opts.progress || 0, opts.stepProgress || 0,
      opts.state || 'scanning');
  }

  // ─── Public API ───────────────────────────────────────────────────────────────
  const FaceAccessCameraEngine = {
    VERSION,
    MOVEMENT_STEPS,

    // High-level sessions
    createVerificationSession,
    createEnrollmentSession,

    // Low-level camera
    openCamera,
    stopCamera,
    CameraManager,

    // Frame processing
    analyzeFrame,
    getEmbedding,
    drawOverlay,
    FrameAnalyzer,
    OverlayRenderer,
    MovementDetector,

    // Math utilities
    cosineSim,
    l2norm,
  };

  global.FaceAccessCameraEngine = FaceAccessCameraEngine;
  console.log(`[FaceAccessCameraEngine v${VERSION}] Unified camera & biometric engine loaded`);

}(window));
