/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Gesture Control v4
   FIXES: pinch-only click, two-finger scroll, expanded mapping for sidebar,
          fist=disable, open-palm=cancel, visual gesture HUD
───────────────────────────────────────────────────────────────────────────── */
window.GestureControl = (function () {

  // ── Config ─────────────────────────────────────────────────────────────────
  const CFG = {
    PINCH_DIST:    36,   // px in video space — fingers must be THIS close
    PINCH_FRAMES:   4,   // consecutive frames of pinch before timer starts (debounce)
    PINCH_HOLD:   600,   // ms hold required to fire click
    PINCH_COOL:   900,   // ms cooldown after click
    SCROLL_DEAD:    5,   // px wrist movement deadzone
    SCROLL_SPEED: 4.0,   // scroll multiplier
    FIST_HOLD:   1400,   // ms fist held to disable gesture mode
    SCREEN_PAD:  0.14,   // 14% padding — hand doesn't need to reach camera edge
                         // so sidebar (left edge) is reachable comfortably
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let model=null, running=false, loaded=false, stream=null;
  let curX=window.innerWidth/2, curY=window.innerHeight/2;
  let tgtX=curX, tgtY=curY;

  // Pinch
  let pinchFrames=0, pinchStart=0, pinchCooldown=0, wasPinching=false;
  // Scroll
  let prevScrollY=null, scrollAccum=0;
  // Fist (disable)
  let fistStart=0, wasFist=false;
  // Palm (cancel)
  let wasPalm=false;

  let lastHovered=null, animId=null;
  let videoEl, canvasEl, ctx, cursorEl, ringEl, ringArc;
  let flashEl, badgeEl, badgeText, hudEl;

  const CHAINS=[[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]];

  // ── Finger / gesture analysis ───────────────────────────────────────────────
  // Returns object with all gesture flags from raw landmarks
  function analyzeHand(lm) {
    // lm[i] = [x, y, z] in video pixel space
    // Finger extended: tip.y < pip.y (tip is higher in frame = finger up)
    const ext = {
      index:  lm[8][1]  < lm[6][1],
      middle: lm[12][1] < lm[10][1],
      ring:   lm[16][1] < lm[14][1],
      pinky:  lm[20][1] < lm[18][1],
    };

    // Pinch: thumb tip close to index tip
    const pinchDist = Math.hypot(lm[4][0]-lm[8][0], lm[4][1]-lm[8][1]);
    const isPinching = pinchDist < CFG.PINCH_DIST;

    // Count extended fingers
    const extCount = Object.values(ext).filter(Boolean).length;

    // Gesture classifications
    const isPoint    = ext.index && !ext.middle && !ext.ring && !ext.pinky && !isPinching;
    const isTwoUp    = ext.index && ext.middle  && !ext.ring && !ext.pinky && !isPinching;
    const isOpenPalm = extCount >= 3 && !isPinching;
    // Fist: all 4 fingertips below their PIP joints (fully curled)
    const isFist = !ext.index && !ext.middle && !ext.ring && !ext.pinky;

    return { ext, pinchDist, isPinching, isPoint, isTwoUp, isOpenPalm, isFist };
  }

  // ── Screen mapping with edge padding ───────────────────────────────────────
  // Maps normalized video coord [0,1] to screen, with SCREEN_PAD on each side.
  // So hand only needs to move within center 72% of camera to reach full screen.
  function mapToScreen(normX, normY) {
    const p = CFG.SCREEN_PAD;
    const x = Math.max(0, Math.min(1, (normX - p) / (1 - 2*p)));
    const y = Math.max(0, Math.min(1, (normY - p) / (1 - 2*p)));
    return [x * window.innerWidth, y * window.innerHeight];
  }

  // ── DOM injection ──────────────────────────────────────────────────────────
  function injectDOM() {
    if (document.getElementById('gc-video')) return;

    // Camera — z-index -1 = behind entire page
    videoEl = Object.assign(document.createElement('video'), {id:'gc-video',autoplay:true,playsInline:true,muted:true});
    videoEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:-1;display:none;opacity:0;transition:opacity .5s';
    document.body.appendChild(videoEl);

    // Dark tint — z-index 0, between camera and UI
    const ov = document.createElement('div');
    ov.id = 'gc-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(6,5,10,.38);z-index:0;display:none;pointer-events:none';
    document.body.appendChild(ov);

    // Screen flash
    flashEl = document.createElement('div');
    flashEl.id = 'gc-flash';
    flashEl.style.cssText = 'position:fixed;inset:0;z-index:9985;pointer-events:none;opacity:0;background:rgba(167,139,250,.07);transition:opacity .1s';
    document.body.appendChild(flashEl);

    // Skeleton canvas — z-index 9990 (above all UI)
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'gc-canvas';
    canvasEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9990;pointer-events:none;display:none';
    document.body.appendChild(canvasEl);
    ctx = canvasEl.getContext('2d');

    // Pinch ring
    ringEl = document.createElement('div');
    ringEl.id = 'gc-ring';
    ringEl.style.cssText = 'position:fixed;pointer-events:none;z-index:9992;transform:translate(-50%,-50%);display:none';
    ringEl.innerHTML = `<svg width="68" height="68" viewBox="0 0 68 68">
      <circle cx="34" cy="34" r="26" fill="none" stroke="rgba(167,139,250,.12)" stroke-width="2"/>
      <circle id="gc-arc" cx="34" cy="34" r="26" fill="none" stroke="#a78bfa" stroke-width="3"
        stroke-dasharray="163.4" stroke-dashoffset="163.4" stroke-linecap="round"
        transform="rotate(-90 34 34)" style="transition:stroke-dashoffset .05s linear"/>
    </svg>`;
    document.body.appendChild(ringEl);
    ringArc = document.getElementById('gc-arc');

    // Cursor
    cursorEl = document.createElement('div');
    cursorEl.id = 'gc-cursor';
    cursorEl.style.cssText = 'position:fixed;pointer-events:none;z-index:9995;transform:translate(-50%,-50%);display:none';
    cursorEl.innerHTML = `
      <div id="gc-cur-ring" style="width:42px;height:42px;border-radius:50%;border:2px solid rgba(167,139,250,.75);background:rgba(139,92,246,.1);display:flex;align-items:center;justify-content:center;transition:all .1s ease">
        <div id="gc-cur-dot" style="width:7px;height:7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.9);transition:all .1s ease"></div>
      </div>`;
    document.body.appendChild(cursorEl);

    // HUD — gesture indicator bottom-left
    hudEl = document.createElement('div');
    hudEl.id = 'gc-hud';
    hudEl.style.cssText = 'position:fixed;bottom:72px;left:20px;z-index:9996;pointer-events:none;display:none;flex-direction:column;gap:6px';
    hudEl.innerHTML = `
      <div id="gc-gesture-name" style="font-size:.62rem;font-weight:700;letter-spacing:.15em;color:#5a5672;font-family:\'JetBrains Mono\',monospace;text-transform:uppercase;transition:color .2s">POINT</div>
      <div style="display:flex;gap:5px" id="gc-finger-dots">
        ${['I','M','R','P'].map(f=>`<div data-f="${f}" style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:.52rem;color:#5a5672;font-weight:700;transition:all .15s">${f}</div>`).join('')}
      </div>`;
    document.body.appendChild(hudEl);

    // Status badge — bottom center
    badgeEl = document.createElement('div');
    badgeEl.id = 'gc-badge';
    badgeEl.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9996;display:none;align-items:center;gap:8px;padding:7px 14px 7px 10px;background:rgba(11,10,18,.92);border:1px solid rgba(139,92,246,.3);border-radius:24px;backdrop-filter:blur(14px);white-space:nowrap';
    badgeEl.innerHTML = `
      <div style="width:7px;height:7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 8px #a78bfa;animation:gc-pulse 2s ease-in-out infinite;flex-shrink:0"></div>
      <span id="gc-badge-text" style="font-size:.66rem;font-weight:700;letter-spacing:.12em;color:#a78bfa;font-family:\'JetBrains Mono\',monospace;text-transform:uppercase">GESTURE ON</span>
      <button onclick="GestureControl.disable()" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#9ca3af;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;margin-left:4px;flex-shrink:0;pointer-events:all;line-height:1">✕</button>`;
    document.body.appendChild(badgeEl);
    badgeText = document.getElementById('gc-badge-text');

    // Gesture cheat-sheet (top-right corner)
    const cheat = document.createElement('div');
    cheat.id = 'gc-cheat';
    cheat.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9996;pointer-events:none;display:none;flex-direction:column;gap:5px;opacity:.7';
    cheat.innerHTML = [
      ['☝️','Point','Move cursor'],
      ['🤌','Pinch 0.6s','Click'],
      ['✌️','Two fingers','Scroll'],
      ['🖐️','Open palm','Cancel/Close'],
      ['✊','Fist 1.5s','Disable'],
    ].map(([e,g,a])=>`<div style="display:flex;align-items:center;gap:7px;font-size:.6rem;font-family:\'JetBrains Mono\',monospace"><span>${e}</span><span style="color:#5a5672;font-weight:700;letter-spacing:.08em">${g}</span><span style="color:#3d3955">${a}</span></div>`).join('');
    document.body.appendChild(cheat);

    // Global styles
    if (!document.getElementById('gc-styles')) {
      const s = document.createElement('style');
      s.id = 'gc-styles';
      s.textContent = `
        @keyframes gc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.65)}}
        @keyframes gc-rip{0%{transform:scale(0);opacity:.85}100%{transform:scale(2.8);opacity:0}}
        .gc-ripple{position:fixed;pointer-events:none;z-index:9988;border-radius:50%;border:2px solid #a78bfa;animation:gc-rip .5s ease-out forwards}
        /* Pinching */
        #gc-cursor.pinching #gc-cur-ring{width:24px!important;height:24px!important;border-color:#fff!important;background:rgba(167,139,250,.55)!important;box-shadow:0 0 20px rgba(167,139,250,.8)!important}
        #gc-cursor.pinching #gc-cur-dot{width:11px!important;height:11px!important;background:#fff!important}
        /* Hovering */
        #gc-cursor.hovering #gc-cur-ring{width:52px!important;height:52px!important;border-color:rgba(167,139,250,.9)!important;background:rgba(139,92,246,.15)!important}
        /* Scrolling */
        #gc-cursor.scrolling #gc-cur-ring{border-color:#34d399!important;background:rgba(52,211,153,.12)!important}
        #gc-cursor.scrolling #gc-cur-dot{background:#34d399!important;box-shadow:0 0 10px rgba(52,211,153,.9)!important}
        /* Fist */
        #gc-cursor.fist #gc-cur-ring{border-color:#f87171!important;background:rgba(248,113,113,.12)!important;width:34px!important;height:34px!important}
        #gc-cursor.fist #gc-cur-dot{background:#f87171!important;box-shadow:0 0 10px rgba(248,113,113,.9)!important}
        /* Hover highlight on page elements */
        .gc-hovered{outline:2px solid rgba(167,139,250,.65)!important;outline-offset:3px!important;box-shadow:0 0 0 5px rgba(139,92,246,.1)!important;border-radius:6px!important}
        /* Body transparent so camera shows through */
        body.gc-active{background:transparent!important}
        body.gc-active #heroCanvas{display:none!important}
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

  // ── Layer visibility ───────────────────────────────────────────────────────
  function showLayers(on) {
    ['gc-video','gc-overlay','gc-canvas','gc-cursor','gc-badge','gc-hud','gc-cheat'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const flex = ['gc-badge','gc-hud','gc-cheat'].includes(id);
      el.style.display = on ? (flex ? 'flex' : 'block') : 'none';
    });
    if (ringEl) ringEl.style.display = 'none';
    if (on) requestAnimationFrame(() => { if (videoEl) videoEl.style.opacity = '1'; });
    else if (videoEl) videoEl.style.opacity = '0';
    document.body.classList.toggle('gc-active', on);
    if (!on) clearHover();
  }

  // ── Universal clickable detection ──────────────────────────────────────────
  function isClickable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id && el.id.startsWith('gc-')) return false;
    const tag = el.tagName;
    if (['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(tag)) return true;
    if (el.getAttribute('onclick') || el.getAttribute('role') === 'button') return true;
    const c = el.classList;
    if (c && (c.contains('sb-link') || c.contains('btn') || c.contains('card') ||
      c.contains('detail') || c.contains('feat') || c.contains('hs') ||
      c.contains('eval-tab') || c.contains('row') || c.contains('pricing-card'))) return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch(_) {}
    return false;
  }

  function findAt(x, y) {
    const gcEls = ['gc-canvas','gc-cursor','gc-ring','gc-flash','gc-badge','gc-hud','gc-cheat']
      .map(id => document.getElementById(id)).filter(Boolean);
    gcEls.forEach(e => { e._v = e.style.visibility; e.style.visibility = 'hidden'; });
    const el = document.elementFromPoint(x, y);
    gcEls.forEach(e => { e.style.visibility = e._v; });
    return el;
  }

  function findClickable(x, y) {
    const el = findAt(x, y);
    if (!el) return null;
    let t = el;
    for (let i = 0; i < 10; i++) {
      if (!t || t === document.body) break;
      if (isClickable(t)) return t;
      t = t.parentElement;
    }
    return el;
  }

  function findScrollable(x, y) {
    let el = findAt(x, y);
    while (el && el !== document.body) {
      const s = window.getComputedStyle(el);
      if (['auto','scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── Hover ──────────────────────────────────────────────────────────────────
  function setHover(el) {
    if (el === lastHovered) return;
    clearHover();
    if (el && el !== document.body && !(el.id && el.id.startsWith('gc-'))) {
      el.classList.add('gc-hovered');
      lastHovered = el;
    }
  }
  function clearHover() {
    if (lastHovered) { lastHovered.classList.remove('gc-hovered'); lastHovered = null; }
  }

  // ── 60fps cursor loop ──────────────────────────────────────────────────────
  function startCursorLoop() {
    function loop() {
      if (!running) return;
      curX += (tgtX - curX) * 0.2;
      curY += (tgtY - curY) * 0.2;
      if (cursorEl) { cursorEl.style.left = curX + 'px'; cursorEl.style.top = curY + 'px'; }
      if (ringEl)   { ringEl.style.left   = curX + 'px'; ringEl.style.top  = curY + 'px'; }
      animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);
  }

  // ── Effects ────────────────────────────────────────────────────────────────
  function doFlash() {
    if (!flashEl) return;
    flashEl.style.opacity = '1';
    setTimeout(() => { flashEl.style.opacity = '0'; }, 110);
  }
  function ripple(x, y) {
    const r = document.createElement('div');
    r.className = 'gc-ripple';
    r.style.cssText = `width:56px;height:56px;left:${x-28}px;top:${y-28}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 550);
  }
  function updateBadge(text, color) {
    if (!badgeText) return;
    badgeText.textContent = text;
    badgeText.style.color = color || '#a78bfa';
  }
  function setPinchRing(p) {
    if (!ringArc) return;
    const C = 2 * Math.PI * 26;
    ringArc.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, p)));
    if (ringEl) ringEl.style.display = p > 0 ? 'block' : 'none';
  }

  // ── Update HUD ─────────────────────────────────────────────────────────────
  function updateHUD(gesture, ext) {
    const nameEl = document.getElementById('gc-gesture-name');
    if (nameEl) {
      const labels = { point:'☝️  POINTING', pinch:'🤌  PINCHING', scroll:'✌️  SCROLL', palm:'🖐️  CANCEL', fist:'✊  FIST — HOLD TO EXIT', none:'—' };
      nameEl.textContent = labels[gesture] || gesture;
      const colors = { pinch:'#fbbf24', scroll:'#34d399', palm:'#60a5fa', fist:'#f87171', point:'#a78bfa', none:'#3d3955' };
      nameEl.style.color = colors[gesture] || '#5a5672';
    }
    if (ext) {
      ['I','M','R','P'].forEach((f, i) => {
        const keys = ['index','middle','ring','pinky'];
        const dot = document.querySelector(`#gc-finger-dots [data-f="${f}"]`);
        if (dot) {
          dot.style.background = ext[keys[i]] ? 'rgba(167,139,250,.3)' : 'rgba(255,255,255,.06)';
          dot.style.borderColor = ext[keys[i]] ? 'rgba(167,139,250,.6)' : 'rgba(255,255,255,.1)';
          dot.style.color = ext[keys[i]] ? '#a78bfa' : '#5a5672';
        }
      });
    }
  }

  // ── Gesture click ──────────────────────────────────────────────────────────
  function gestureClick(x, y) {
    ripple(x, y);
    doFlash();
    const target = findClickable(x, y);
    if (!target) return;
    ['mouseenter','mouseover','mousedown','mouseup','click'].forEach(type => {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, view:window })); } catch(_) {}
    });
    try { target.click(); } catch(_) {}
    target.classList.add('gc-hovered');
    setTimeout(() => target.classList.remove('gc-hovered'), 280);
    updateBadge('✓ CLICKED', '#34d399');
    setTimeout(() => updateBadge('✋ GESTURE ON', '#a78bfa'), 800);
  }

  // ── Cancel — close modal or go back ────────────────────────────────────────
  function gestureCancel() {
    // Close any open modal
    const modal = document.querySelector('.modal-bg:not(.hidden)');
    if (modal) {
      const closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
      else modal.remove();
      updateBadge('✕ CANCELLED', '#60a5fa');
      setTimeout(() => updateBadge('✋ GESTURE ON', '#a78bfa'), 800);
      return;
    }
    // Dismiss toasts
    const toast = document.getElementById('toast');
    if (toast && toast.classList.contains('show')) {
      toast.classList.remove('show');
      return;
    }
    updateBadge('NOTHING TO CANCEL', '#5a5672');
    setTimeout(() => updateBadge('✋ GESTURE ON', '#a78bfa'), 600);
  }

  // ── Draw hand ──────────────────────────────────────────────────────────────
  function drawHand(lm) {
    if (!ctx || !videoEl || !canvasEl) return;
    const W = canvasEl.width, H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);
    const pts = lm.map(([x, y]) => [
      (1 - x / videoEl.videoWidth)  * W,
      (    y / videoEl.videoHeight) * H,
    ]);
    CHAINS.forEach((chain, fi) => {
      ctx.beginPath();
      chain.forEach((i, idx) => idx === 0 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]));
      ctx.strokeStyle = fi === 1 ? 'rgba(167,139,250,.72)' : 'rgba(120,100,220,.42)';
      ctx.lineWidth = fi === 1 ? 2.5 : 1.7;
      ctx.stroke();
    });
    pts.forEach(([x, y], i) => {
      const isIdx = i === 8, isThm = i === 4, isTip = [4,8,12,16,20].includes(i);
      ctx.beginPath();
      ctx.arc(x, y, isIdx || isThm ? 7 : isTip ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isIdx ? '#a78bfa' : isThm ? '#34d399' : isTip ? 'rgba(167,139,250,.55)' : 'rgba(90,80,160,.35)';
      ctx.fill();
      if (isIdx || isThm) {
        ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = isIdx ? 'rgba(167,139,250,.1)' : 'rgba(52,211,153,.1)'; ctx.fill();
      }
    });
    // Pinch line
    const [tx,ty] = pts[4], [ix,iy] = pts[8];
    const d = Math.hypot(tx-ix, ty-iy), a = Math.max(0, 1 - d/120);
    if (a > 0.05) {
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(ix, iy);
      ctx.strokeStyle = `rgba(167,139,250,${a * .8})`; ctx.lineWidth = 2;
      ctx.setLineDash([4,5]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // ── Main detection loop ─────────────────────────────────────────────────────
  async function detectLoop() {
    if (!running || !model || !videoEl) return;
    if (videoEl.readyState < 2) { requestAnimationFrame(detectLoop); return; }

    let predictions;
    try { predictions = await model.estimateHands(videoEl); }
    catch (_) { requestAnimationFrame(detectLoop); return; }

    if (predictions.length > 0) {
      const lm = predictions[0].landmarks;
      drawHand(lm);

      const g = analyzeHand(lm);
      const now = Date.now();

      // ── Map index fingertip to screen with edge padding ──────────────────
      const [ix, iy] = lm[8];
      const normX = 1 - ix / videoEl.videoWidth;  // mirror
      const normY = iy / videoEl.videoHeight;
      const [sx, sy] = mapToScreen(normX, normY);
      tgtX = sx; tgtY = sy;

      // ── Hover (always, any gesture) ─────────────────────────────────────
      const hov = findClickable(curX, curY);
      const hoverable = hov && isClickable(hov);
      setHover(hoverable ? hov : null);

      // ── Determine active gesture (priority order) ────────────────────────

      // 1. FIST — disable mode
      if (g.isFist) {
        if (!wasFist) fistStart = now;
        wasFist = true;
        const progress = Math.min(1, (now - fistStart) / CFG.FIST_HOLD);
        updateBadge(`✊ HOLD TO EXIT ${Math.round(progress*100)}%`, '#f87171');
        updateHUD('fist', g.ext);
        setCursorState('fist');
        setPinchRing(0);
        prevScrollY = null; pinchFrames = 0;
        if (progress >= 1) { disable(); return; }
        requestAnimationFrame(detectLoop);
        return;
      } else { wasFist = false; }

      // 2. OPEN PALM — cancel/close
      if (g.isOpenPalm) {
        if (!wasPalm) { wasPalm = true; gestureCancel(); }
        updateHUD('palm', g.ext);
        setCursorState('normal');
        setPinchRing(0);
        prevScrollY = null; pinchFrames = 0;
        requestAnimationFrame(detectLoop);
        return;
      } else { wasPalm = false; }

      // 3. TWO FINGERS UP — scroll
      if (g.isTwoUp) {
        updateHUD('scroll', g.ext);
        setCursorState('scrolling');
        setPinchRing(0);
        pinchFrames = 0;
        // Use middle finger tip Y for scroll (more stable than wrist)
        const [, my] = lm[12];
        const scrollY = (my / videoEl.videoHeight) * window.innerHeight;
        if (prevScrollY !== null) {
          const delta = scrollY - prevScrollY;
          if (Math.abs(delta) > CFG.SCROLL_DEAD) {
            scrollAccum += delta * CFG.SCROLL_SPEED;
            if (Math.abs(scrollAccum) >= 1) {
              const st = findScrollable(curX, curY);
              if (st) st.scrollBy({ top: scrollAccum, behavior: 'auto' });
              else window.scrollBy({ top: scrollAccum, behavior: 'auto' });
              updateBadge(delta > 0 ? '▼ SCROLLING DOWN' : '▲ SCROLLING UP', '#34d399');
              scrollAccum = 0;
            }
          }
        }
        prevScrollY = scrollY;
        requestAnimationFrame(detectLoop);
        return;
      } else { prevScrollY = null; scrollAccum = 0; }

      // 4. PINCH — click (with frame debounce + hold timer)
      if (g.isPinching) {
        pinchFrames++;
        updateHUD('pinch', g.ext);
        setCursorState('pinching');
        if (hoverable) setHover(hov);

        if (pinchFrames >= CFG.PINCH_FRAMES) {
          // Started timing from when debounce completed
          if (!wasPinching) { pinchStart = now; wasPinching = true; }
          const p = Math.min(1, (now - pinchStart) / CFG.PINCH_HOLD);
          setPinchRing(p);
          updateBadge(`🤌 PINCH ${Math.round(p*100)}%`, '#fbbf24');
          if (p >= 1 && now > pinchCooldown) {
            pinchCooldown = now + CFG.PINCH_COOL;
            pinchStart = now;
            gestureClick(curX, curY);
          }
        } else {
          updateBadge('🤌 PINCHING…', '#fbbf24');
          setPinchRing(0);
        }
      } else {
        pinchFrames = 0;
        wasPinching = false;
        setPinchRing(0);
        // 5. POINT — cursor movement only
        updateHUD('point', g.ext);
        setCursorState(hoverable ? 'hovering' : 'normal');
        updateBadge('✋ GESTURE ON', '#a78bfa');
      }

    } else {
      // No hand
      if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      clearHover();
      setPinchRing(0);
      prevScrollY = null; pinchFrames = 0; wasPinching = false; wasFist = false; wasPalm = false;
      setCursorState('normal');
      updateHUD('none', null);
      updateBadge('NO HAND — RAISE IT ✋', '#5a5672');
    }

    requestAnimationFrame(detectLoop);
  }

  function setCursorState(state) {
    if (!cursorEl) return;
    cursorEl.classList.remove('pinching','hovering','scrolling','fist');
    if (state !== 'normal') cursorEl.classList.add(state);
  }

  // ── Enable ─────────────────────────────────────────────────────────────────
  async function enable() {
    injectDOM();
    if (!loaded) {
      if (badgeEl) badgeEl.style.display = 'flex';
      updateBadge('STARTING CAMERA…', '#fbbf24');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width:{ideal:640}, height:{ideal:480}, facingMode:'user' },
          audio: false,
        });
        videoEl.srcObject = stream;
        await new Promise(r => { videoEl.onloadedmetadata = r; });
        await videoEl.play();
      } catch (e) {
        if (badgeEl) badgeEl.style.display = 'none';
        alert('Camera access denied. Please allow camera access and try again.');
        return;
      }
      updateBadge('LOADING MODEL…', '#fbbf24');
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        model = await handpose.load({ detectionConfidence:0.88, scoreThreshold:0.75 });
        const wc = document.createElement('canvas'); wc.width=64; wc.height=64;
        await model.estimateHands(wc);
        loaded = true;
      } catch (e) {
        if (badgeEl) badgeEl.style.display = 'none';
        alert('Hand tracking failed: ' + e.message);
        return;
      }
    }
    showLayers(true);
    running = true;
    resizeCanvas();
    startCursorLoop();
    detectLoop();
    const btn = document.getElementById('gestureToggleBtn');
    if (btn) { btn.classList.add('active'); btn.title = 'Disable gesture control'; }
  }

  // ── Disable ────────────────────────────────────────────────────────────────
  function disable() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    showLayers(false);
    clearHover();
    setPinchRing(0);
    if (ctx && canvasEl) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    setCursorState('normal');
    prevScrollY = null; pinchFrames = 0; wasPinching = false; wasFist = false; wasPalm = false;
    document.body.classList.remove('gc-active');
    const btn = document.getElementById('gestureToggleBtn');
    if (btn) { btn.classList.remove('active'); btn.title = 'Enable gesture control'; }
  }

  function toggle() { running ? disable() : enable(); }
  return { enable, disable, toggle };
})();
