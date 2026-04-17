/* Pluto Capital — Gesture Control Module
   TensorFlow.js HandPose, runs 100% locally, no API key */

window.GestureControl = (function () {

  // ── DOM refs (created dynamically) ─────────────────────────────────────────
  let videoEl, canvasEl, ctx, cursorEl, pinchRingEl, flashEl;
  let model = null;
  let running = false;
  let loaded  = false;

  // ── State ───────────────────────────────────────────────────────────────────
  let curX = window.innerWidth / 2, curY = window.innerHeight / 2;
  let targetX = curX, targetY = curY;
  let isPinching = false, wasPinching = false;
  let pinchCooldown = 0, pinchStart = 0;
  let animId = null;

  // ── Finger chain indices ────────────────────────────────────────────────────
  const CHAINS = [
    [0,1,2,3,4],
    [0,5,6,7,8],
    [0,9,10,11,12],
    [0,13,14,15,16],
    [0,17,18,19,20],
  ];

  // ── Inject DOM elements ─────────────────────────────────────────────────────
  function injectDOM() {
    if (document.getElementById('g-video')) return;

    // Camera video
    videoEl = document.createElement('video');
    videoEl.id = 'g-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:9980;display:none;opacity:0;transition:opacity .6s ease';
    document.body.appendChild(videoEl);

    // Overlay darkener (keeps UI readable)
    const ov = document.createElement('div');
    ov.id = 'g-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(6,5,10,.48);z-index:9981;display:none;pointer-events:none';
    document.body.appendChild(ov);

    // Hand skeleton canvas
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'g-canvas';
    canvasEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9982;pointer-events:none;display:none';
    document.body.appendChild(canvasEl);
    ctx = canvasEl.getContext('2d');

    // Screen flash
    flashEl = document.createElement('div');
    flashEl.id = 'g-flash';
    flashEl.style.cssText = 'position:fixed;inset:0;z-index:9990;pointer-events:none;opacity:0;background:rgba(167,139,250,.07);transition:opacity .1s';
    document.body.appendChild(flashEl);

    // Cursor
    cursorEl = document.createElement('div');
    cursorEl.id = 'g-cursor';
    cursorEl.style.cssText = 'position:fixed;pointer-events:none;z-index:9995;transform:translate(-50%,-50%);display:none;transition:none';
    cursorEl.innerHTML = `
      <div id="g-cur-outer" style="width:42px;height:42px;border-radius:50%;border:1.8px solid rgba(167,139,250,.75);background:rgba(139,92,246,.1);display:flex;align-items:center;justify-content:center;transition:all .12s ease">
        <div id="g-cur-inner" style="width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.9);transition:all .12s ease"></div>
      </div>`;
    document.body.appendChild(cursorEl);

    // Pinch progress ring
    pinchRingEl = document.createElement('div');
    pinchRingEl.id = 'g-pinch-ring';
    pinchRingEl.style.cssText = 'position:fixed;pointer-events:none;z-index:9994;transform:translate(-50%,-50%);display:none';
    pinchRingEl.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(167,139,250,.15)" stroke-width="2"/>
      <circle id="g-ring-arc" cx="32" cy="32" r="24" fill="none" stroke="#a78bfa" stroke-width="2.5"
        stroke-dasharray="150.8" stroke-dashoffset="150.8" stroke-linecap="round"
        transform="rotate(-90 32 32)" style="transition:stroke-dashoffset .08s linear"/>
    </svg>`;
    document.body.appendChild(pinchRingEl);

    // Gesture status badge (top-right, only shown in gesture mode)
    const badge = document.createElement('div');
    badge.id = 'g-badge';
    badge.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9996;display:none;align-items:center;gap:8px;padding:6px 14px;background:rgba(17,16,27,.9);border:1px solid rgba(139,92,246,.25);border-radius:20px;backdrop-filter:blur(12px)';
    badge.innerHTML = `
      <div style="width:7px;height:7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 8px #a78bfa;animation:gpulse 2s ease-in-out infinite"></div>
      <span id="g-badge-text" style="font-size:.68rem;font-weight:700;letter-spacing:.12em;color:#a78bfa;font-family:'JetBrains Mono',monospace;text-transform:uppercase">GESTURE ON</span>
      <button onclick="GestureControl.disable()" style="background:none;border:none;color:#5a5672;cursor:pointer;font-size:.8rem;padding:0 0 0 6px;line-height:1">✕</button>`;
    document.body.appendChild(badge);

    // Inject keyframe
    if (!document.getElementById('g-styles')) {
      const s = document.createElement('style');
      s.id = 'g-styles';
      s.textContent = `
        @keyframes gpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}
        #g-cursor.pinching #g-cur-outer{width:26px!important;height:26px!important;border-color:#fff!important;background:rgba(167,139,250,.45)!important;box-shadow:0 0 22px rgba(167,139,250,.7)}
        #g-cursor.pinching #g-cur-inner{width:12px!important;height:12px!important;background:#fff!important}
        #g-cursor.hovering #g-cur-outer{width:54px!important;height:54px!important;background:rgba(139,92,246,.2)!important}
        .g-ripple{position:fixed;pointer-events:none;z-index:9993;width:60px;height:60px;margin-left:-30px;margin-top:-30px;border-radius:50%;border:2px solid #a78bfa;animation:g-rip .5s ease-out forwards}
        @keyframes g-rip{0%{transform:scale(0);opacity:.9}100%{transform:scale(2.8);opacity:0}}
      `;
      document.head.appendChild(s);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!canvasEl) return;
    canvasEl.width  = window.innerWidth;
    canvasEl.height = window.innerHeight;
  }

  // ── Show/hide layers ─────────────────────────────────────────────────────────
  function showLayers(on) {
    const ids = ['g-video','g-overlay','g-canvas','g-cursor','g-badge'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = on ? (id === 'g-badge' ? 'flex' : 'block') : 'none';
    });
    if (on) setTimeout(() => { if (videoEl) videoEl.style.opacity = '1'; }, 50);
    else if (videoEl) videoEl.style.opacity = '0';
  }

  // ── Smooth cursor (60fps, independent of detection) ─────────────────────────
  function startCursorLoop() {
    function loop() {
      if (!running) return;
      const EASE = 0.2;
      curX += (targetX - curX) * EASE;
      curY += (targetY - curY) * EASE;

      if (cursorEl) {
        cursorEl.style.left = curX + 'px';
        cursorEl.style.top  = curY + 'px';
      }
      if (pinchRingEl) {
        pinchRingEl.style.left = curX + 'px';
        pinchRingEl.style.top  = curY + 'px';
      }

      // Hover: highlight any interactive element under cursor
      const el = document.elementFromPoint(curX, curY);
      if (el) {
        let t = el;
        let foundHover = false;
        for (let i = 0; i < 6; i++) {
          if (!t) break;
          if (t.classList && (
            t.classList.contains('sb-link') ||
            t.classList.contains('btn') ||
            t.tagName === 'BUTTON' ||
            t.tagName === 'A' ||
            t.classList.contains('card') ||
            t.classList.contains('gBtn')
          )) { foundHover = true; break; }
          t = t.parentElement;
        }
        if (cursorEl) cursorEl.classList.toggle('hovering', foundHover && !isPinching);
      }
      animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function flash() {
    if (!flashEl) return;
    flashEl.style.opacity = '1';
    setTimeout(() => { flashEl.style.opacity = '0'; }, 120);
  }

  function ripple(x, y) {
    const r = document.createElement('div');
    r.className = 'g-ripple';
    r.style.left = x + 'px';
    r.style.top  = y + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  function updateBadge(text, color) {
    const t = document.getElementById('g-badge-text');
    if (t) { t.textContent = text; t.style.color = color || '#a78bfa'; }
  }

  function gestureClick(x, y) {
    ripple(x, y);
    flash();
    if (cursorEl) cursorEl.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (cursorEl) cursorEl.style.display = 'block';
    if (!el) return;
    let t = el;
    for (let i = 0; i < 8; i++) {
      if (!t) break;
      const tag = t.tagName;
      const cls = t.classList;
      if (tag === 'BUTTON' || tag === 'A' ||
          cls.contains('sb-link') || cls.contains('btn') ||
          cls.contains('gBtn') || cls.contains('card') ||
          t.getAttribute('onclick')) {
        t.click();
        return;
      }
      t = t.parentElement;
    }
  }

  // ── Draw hand skeleton ───────────────────────────────────────────────────────
  function drawHand(lm) {
    if (!ctx || !videoEl) return;
    const W = canvasEl.width, H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);

    // Map landmarks (mirror x to match CSS-mirrored video)
    const pts = lm.map(([x, y]) => [
      (1 - x / videoEl.videoWidth)  * W,
      (    y / videoEl.videoHeight) * H,
    ]);

    // Draw chains
    CHAINS.forEach((chain, fi) => {
      ctx.beginPath();
      chain.forEach((idx, i) => i === 0 ? ctx.moveTo(pts[idx][0], pts[idx][1]) : ctx.lineTo(pts[idx][0], pts[idx][1]));
      ctx.strokeStyle = fi === 1 ? 'rgba(167,139,250,.65)' : 'rgba(139,92,246,.38)';
      ctx.lineWidth   = fi === 1 ? 2.5 : 1.8;
      ctx.stroke();
    });

    // Joints
    pts.forEach(([x, y], i) => {
      const isIdx = i === 8, isThm = i === 4, isTip = [4,8,12,16,20].includes(i);
      ctx.beginPath();
      ctx.arc(x, y, isIdx || isThm ? 7 : isTip ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isIdx ? '#a78bfa' : isThm ? '#34d399' : isTip ? 'rgba(167,139,250,.55)' : 'rgba(100,90,180,.35)';
      ctx.fill();
      if (isIdx || isThm) {
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = isIdx ? 'rgba(167,139,250,.1)' : 'rgba(52,211,153,.1)';
        ctx.fill();
      }
    });

    // Pinch proximity line
    const [tx, ty] = pts[4], [ix, iy] = pts[8];
    const dist = Math.hypot(tx - ix, ty - iy);
    const alpha = Math.max(0, 1 - dist / 160);
    if (alpha > 0.05) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.strokeStyle = `rgba(167,139,250,${alpha * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function updatePinchRing(progress) {
    const arc = document.getElementById('g-ring-arc');
    if (!arc) return;
    const C = 2 * Math.PI * 24; // circumference r=24
    arc.style.strokeDashoffset = C * (1 - progress);
    if (pinchRingEl) pinchRingEl.style.display = progress > 0 ? 'block' : 'none';
  }

  // ── Detection loop ───────────────────────────────────────────────────────────
  async function detectLoop() {
    if (!running || !model || !videoEl) return;
    if (videoEl.readyState < 2) { requestAnimationFrame(detectLoop); return; }

    let predictions;
    try { predictions = await model.estimateHands(videoEl); }
    catch (e) { requestAnimationFrame(detectLoop); return; }

    if (predictions.length > 0) {
      const lm = predictions[0].landmarks;
      drawHand(lm);

      const [ix, iy] = lm[8];
      const [tx, ty] = lm[4];

      targetX = (1 - ix / videoEl.videoWidth)  * window.innerWidth;
      targetY = (    iy / videoEl.videoHeight) * window.innerHeight;

      const dist = Math.hypot(ix - tx, iy - ty);
      isPinching = dist < 40;

      if (cursorEl) cursorEl.classList.toggle('pinching', isPinching);
      updateBadge(isPinching ? '🤌 PINCHING' : '✋ GESTURE ON', isPinching ? '#fbbf24' : '#a78bfa');

      const now = Date.now();
      if (isPinching) {
        if (!wasPinching) pinchStart = now;
        const progress = Math.min(1, (now - pinchStart) / 550);
        updatePinchRing(progress);
        if (progress >= 1 && now > pinchCooldown) {
          pinchCooldown = now + 900;
          pinchStart = now;
          gestureClick(targetX, targetY);
        }
      } else {
        updatePinchRing(0);
      }
      wasPinching = isPinching;

    } else {
      if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      updateBadge('NO HAND — RAISE IT', '#5a5672');
      updatePinchRing(0);
      wasPinching = false;
      isPinching = false;
      if (cursorEl) cursorEl.classList.remove('pinching', 'hovering');
    }

    requestAnimationFrame(detectLoop);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  async function enable() {
    injectDOM();

    if (!loaded) {
      updateBadge('LOADING MODEL…', '#fbbf24');
      showLayers(true);

      // Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width:{ ideal:640 }, height:{ ideal:480 }, facingMode:'user' },
          audio: false,
        });
        videoEl.srcObject = stream;
        await new Promise(r => { videoEl.onloadedmetadata = r; });
        await videoEl.play();
      } catch(e) {
        alert('Camera access denied. Please allow camera and try again.');
        showLayers(false);
        return;
      }

      // Model
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        model = await handpose.load({ detectionConfidence: 0.88, scoreThreshold: 0.75 });
        // Warm up
        const wc = document.createElement('canvas');
        wc.width = 64; wc.height = 64;
        await model.estimateHands(wc);
        loaded = true;
      } catch(e) {
        alert('Hand tracking model failed to load: ' + e.message);
        showLayers(false);
        return;
      }
    } else {
      showLayers(true);
    }

    running = true;
    resizeCanvas();
    startCursorLoop();
    detectLoop();

    // Update toggle button state
    const btn = document.getElementById('gestureToggleBtn');
    if (btn) {
      btn.classList.add('active');
      btn.title = 'Disable gesture control';
    }
  }

  function disable() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    showLayers(false);
    if (ctx) ctx.clearRect(0, 0, canvasEl ? canvasEl.width : 0, canvasEl ? canvasEl.height : 0);
    if (cursorEl) { cursorEl.classList.remove('pinching','hovering'); }
    updatePinchRing(0);
    wasPinching = false;
    isPinching  = false;

    const btn = document.getElementById('gestureToggleBtn');
    if (btn) {
      btn.classList.remove('active');
      btn.title = 'Enable gesture control';
    }
  }

  function toggle() {
    running ? disable() : enable();
  }

  return { enable, disable, toggle };
})();
