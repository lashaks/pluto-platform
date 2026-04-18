/* ═══════════════════════════════════════════════════════════════
   Pluto Capital — Landing Animation v3
   
   SELF-CONTAINED. Creates its own canvas on document.body.
   Draws the page background + animated elements.
   Works in both dark and light themes.
   
   Usage: <script src="/js/pluto-anim.js"></script> at end of body
═══════════════════════════════════════════════════════════════ */
(function(){
  // Don't run inside dashboard
  if (!document.getElementById('landing')) return;
  
  // Remove old heroCanvas if exists (avoid doubles)
  var old = document.getElementById('heroCanvas');
  if (old) old.style.display = 'none';

  // Create canvas
  var cv = document.createElement('canvas');
  cv.id = 'plutoAnim';
  cv.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
  document.body.insertBefore(cv, document.body.firstChild);
  
  var ctx = cv.getContext('2d');
  var W, H, mx = 0.5, my = 0.5, raf;

  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('mousemove', function(e) { mx = e.clientX / W; my = e.clientY / H; });

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  // ── DARK THEME: Orbital rings + floating particles ───────
  var rings = [
    { rx:160, ry:48,  rot:-30, spd:.14, ph:0,   al:.35, lw:1.5, dotR:3.5 },
    { rx:270, ry:78,  rot:-22, spd:.10, ph:1.4, al:.28, lw:1.2, dotR:3 },
    { rx:380, ry:105, rot:-14, spd:.08, ph:2.7, al:.22, lw:1.1, dotR:2.5 },
    { rx:490, ry:130, rot:-8,  spd:.06, ph:3.9, al:.17, lw:1.0, dotR:2 },
    { rx:600, ry:155, rot:-3,  spd:.04, ph:5.1, al:.13, lw:0.8, dotR:1.8 },
  ];

  var orbs = [];
  for (var i = 0; i < 45; i++) orbs.push({
    x: Math.random() * 1920, y: Math.random() * 1080,
    r: Math.random() * 3 + 1, vy: .18 + Math.random() * .35,
    drift: Math.random() * Math.PI * 2, al: .35 + Math.random() * .45
  });

  // ── LIGHT THEME: Mesh grid + blobs ───────────────────────
  var COLS = 10, ROWS = 7;
  var nodes = [];
  for (var gy = 0; gy <= ROWS; gy++)
    for (var gx = 0; gx <= COLS; gx++)
      nodes.push({ gx:gx, gy:gy, ox:0, oy:0, ph:Math.random()*Math.PI*2, amp:.9+Math.random(), spd:.25+Math.random()*.35 });

  var ldots = [];
  for (var j = 0; j < 25; j++) ldots.push({
    x: Math.random(), y: Math.random() * 1.3,
    r: Math.random() * 3 + 1.5, vy: .00035 + Math.random() * .00025,
    drift: Math.random() * Math.PI * 2, al: .45 + Math.random() * .4
  });

  function drawDark(t) {
    // Dark background
    ctx.fillStyle = '#06050a';
    ctx.fillRect(0, 0, W, H);

    var cx = W * .42 + mx * W * .16;
    var cy = H * .44 + my * H * .12;

    // Nebula glow
    var g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .6);
    g1.addColorStop(0, 'rgba(109,40,217,.18)');
    g1.addColorStop(0.4, 'rgba(88,28,195,.07)');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

    var g2 = ctx.createRadialGradient(W * .75, H * .6, 0, W * .75, H * .6, W * .3);
    g2.addColorStop(0, 'rgba(96,165,250,.1)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

    // Orbital rings + dots
    ctx.save(); ctx.translate(cx, cy);
    for (var k = 0; k < rings.length; k++) {
      var r = rings[k];
      var wobble = Math.sin(t * r.spd + r.ph) * 3;
      ctx.save();
      ctx.rotate((r.rot + wobble) * Math.PI / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, r.rx, r.ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(167,139,250,' + r.al + ')';
      ctx.lineWidth = r.lw;
      ctx.stroke();
      ctx.restore();

      // Orbiting dot
      var a = t * r.spd + r.ph;
      var ox = Math.cos(a) * r.rx, oy = Math.sin(a) * r.ry;
      var rr = r.rot * Math.PI / 180;
      var fx = ox * Math.cos(rr) - oy * Math.sin(rr);
      var fy = ox * Math.sin(rr) + oy * Math.cos(rr);
      var gd = ctx.createRadialGradient(fx, fy, 0, fx, fy, r.dotR * 5);
      gd.addColorStop(0, 'rgba(221,214,254,.8)');
      gd.addColorStop(1, 'rgba(221,214,254,0)');
      ctx.fillStyle = gd;
      ctx.beginPath(); ctx.arc(fx, fy, r.dotR * 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(fx, fy, r.dotR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(237,233,254,.95)'; ctx.fill();
    }
    ctx.restore();

    // Floating orbs
    for (var n = 0; n < orbs.length; n++) {
      var o = orbs[n];
      o.y -= o.vy; o.x += Math.sin(t + o.drift) * .5;
      if (o.y < -15) { o.y = H + 15; o.x = Math.random() * W; }
      var al = o.al + Math.sin(t * 2 + o.drift) * .1;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139,92,246,' + (al * .22) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(196,181,253,' + al + ')'; ctx.fill();
    }
  }

  function drawLight(t) {
    // Light background
    ctx.fillStyle = '#f4f3f8';
    ctx.fillRect(0, 0, W, H);

    // Gradient wash
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(210,225,255,.75)');
    bg.addColorStop(0.5, 'rgba(225,215,255,.55)');
    bg.addColorStop(1, 'rgba(205,230,255,.65)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Mesh grid
    var pw = W / COLS, ph = H / ROWS;
    for (var ni = 0; ni < nodes.length; ni++) {
      var nd = nodes[ni];
      var tx = nd.gx * pw + Math.sin(t * nd.spd + nd.ph) * nd.amp * pw * .2 + (mx - .5) * pw * .15;
      var ty = nd.gy * ph + Math.cos(t * nd.spd * .65 + nd.ph) * nd.amp * ph * .18 + (my - .5) * ph * .12;
      nd.ox += (tx - nd.ox) * .07;
      nd.oy += (ty - nd.oy) * .07;
    }
    for (var gy2 = 0; gy2 <= ROWS; gy2++) for (var gx2 = 0; gx2 <= COLS; gx2++) {
      var idx = gy2 * (COLS + 1) + gx2, nd2 = nodes[idx];
      if (gx2 < COLS) {
        var n2 = nodes[idx + 1], d = Math.hypot(n2.ox - nd2.ox, n2.oy - nd2.oy);
        var a2 = Math.max(0, .28 - d / (pw * 6));
        if (a2 > .004) { ctx.strokeStyle = 'rgba(79,70,229,' + a2 + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nd2.ox, nd2.oy); ctx.lineTo(n2.ox, n2.oy); ctx.stroke(); }
      }
      if (gy2 < ROWS) {
        var n2b = nodes[idx + COLS + 1], db = Math.hypot(n2b.ox - nd2.ox, n2b.oy - nd2.oy);
        var ab = Math.max(0, .28 - db / (ph * 6));
        if (ab > .004) { ctx.strokeStyle = 'rgba(79,70,229,' + ab + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nd2.ox, nd2.oy); ctx.lineTo(n2b.ox, n2b.oy); ctx.stroke(); }
      }
    }
    for (var ni2 = 0; ni2 < nodes.length; ni2++) {
      var nd3 = nodes[ni2], p = .5 + Math.sin(t * nd3.spd + nd3.ph) * .5;
      ctx.beginPath(); ctx.arc(nd3.ox, nd3.oy, 2 + p * .8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,70,229,' + (0.22 + p * .16) + ')'; ctx.fill();
    }

    // Drifting blobs
    for (var li = 0; li < ldots.length; li++) {
      var lo = ldots[li];
      lo.y -= lo.vy; lo.x += Math.sin(t * .35 + lo.drift) * .0006;
      if (lo.y < -.06) lo.y = 1.12;
      var la = lo.al + Math.sin(t * 1.1 + lo.drift) * .1;
      var lx = lo.x * W, ly = lo.y * H;
      var gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, lo.r * 18);
      gr.addColorStop(0, 'rgba(99,102,241,' + (la * .65) + ')');
      gr.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(lx, ly, lo.r * 18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(lx, ly, lo.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,70,229,' + (la * .85) + ')'; ctx.fill();
    }

    // Corner accent
    var gc = ctx.createRadialGradient(W * .8, H * .18, 0, W * .8, H * .18, W * .32);
    gc.addColorStop(0, 'rgba(37,99,235,.12)'); gc.addColorStop(1, 'rgba(37,99,235,0)');
    ctx.fillStyle = gc; ctx.fillRect(0, 0, W, H);
  }

  function draw() {
    if (isLight()) drawLight(Date.now() * .001);
    else drawDark(Date.now() * .001);
    raf = requestAnimationFrame(draw);
  }

  // Theme change listener
  new MutationObserver(function() {
    cancelAnimationFrame(raf);
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Hide when dashboard is shown, show when landing is shown
  var observer = new MutationObserver(function() {
    var landing = document.getElementById('landing');
    cv.style.display = (landing && landing.style.display !== 'none') ? '' : 'none';
  });
  observer.observe(document.getElementById('landing') || document.body, { attributes: true, attributeFilter: ['style'] });

  draw();
})();
