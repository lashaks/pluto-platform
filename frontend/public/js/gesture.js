/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Gesture Control v3
   Camera goes BEHIND the page UI. Skeleton + cursor go ON TOP.
   The whole dashboard stays fully interactive.
───────────────────────────────────────────────────────────────────────────── */
window.GestureControl = (function () {

  let model=null,running=false,loaded=false,stream=null;
  let curX=window.innerWidth/2,curY=window.innerHeight/2,tgtX=curX,tgtY=curY;
  let isPinching=false,wasPinching=false,pinchStart=0,pinchCooldown=0;
  const PINCH_HOLD=480,PINCH_DIST=42;
  let prevWristY=null,scrollAccum=0;
  let lastHovered=null,animId=null;
  let videoEl,canvasEl,ctx,cursorEl,ringEl,ringArc,flashEl,badgeEl,badgeText;
  const CHAINS=[[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]];

  function injectDOM(){
    if(document.getElementById('gc-video'))return;

    // ── Camera: z-index -1 = behind EVERYTHING ──────────────────────────────
    videoEl=Object.assign(document.createElement('video'),{id:'gc-video',autoplay:true,playsInline:true,muted:true});
    videoEl.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:-1;display:none;opacity:0;transition:opacity .5s';
    document.body.appendChild(videoEl);

    // ── Subtle dark overlay: z-index 0, between camera and UI ───────────────
    const ov=document.createElement('div');
    ov.id='gc-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(6,5,10,.38);z-index:0;display:none;pointer-events:none';
    document.body.appendChild(ov);

    // ── Flash effect: z-index 9985 ──────────────────────────────────────────
    flashEl=document.createElement('div');flashEl.id='gc-flash';
    flashEl.style.cssText='position:fixed;inset:0;z-index:9985;pointer-events:none;opacity:0;background:rgba(167,139,250,.07);transition:opacity .1s';
    document.body.appendChild(flashEl);

    // ── Skeleton canvas: z-index 9990 = above everything ────────────────────
    canvasEl=document.createElement('canvas');canvasEl.id='gc-canvas';
    canvasEl.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:9990;pointer-events:none;display:none';
    document.body.appendChild(canvasEl);ctx=canvasEl.getContext('2d');

    // ── Pinch ring: z-index 9992 ─────────────────────────────────────────────
    ringEl=document.createElement('div');ringEl.id='gc-ring';
    ringEl.style.cssText='position:fixed;pointer-events:none;z-index:9992;transform:translate(-50%,-50%);display:none';
    ringEl.innerHTML=`<svg width="68" height="68" viewBox="0 0 68 68">
      <circle cx="34" cy="34" r="26" fill="none" stroke="rgba(167,139,250,.12)" stroke-width="2"/>
      <circle id="gc-arc" cx="34" cy="34" r="26" fill="none" stroke="#a78bfa" stroke-width="3"
        stroke-dasharray="163.4" stroke-dashoffset="163.4" stroke-linecap="round"
        transform="rotate(-90 34 34)" style="transition:stroke-dashoffset .06s linear"/>
    </svg>`;
    document.body.appendChild(ringEl);ringArc=document.getElementById('gc-arc');

    // ── Cursor: z-index 9995 ─────────────────────────────────────────────────
    cursorEl=document.createElement('div');cursorEl.id='gc-cursor';
    cursorEl.style.cssText='position:fixed;pointer-events:none;z-index:9995;transform:translate(-50%,-50%);display:none';
    cursorEl.innerHTML=`
      <div id="gc-cur-ring" style="width:44px;height:44px;border-radius:50%;border:2px solid rgba(167,139,250,.75);background:rgba(139,92,246,.1);display:flex;align-items:center;justify-content:center;transition:all .12s ease">
        <div id="gc-cur-dot" style="width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.9);transition:all .12s ease"></div>
      </div>`;
    document.body.appendChild(cursorEl);

    // ── Status badge: z-index 9996 ───────────────────────────────────────────
    badgeEl=document.createElement('div');badgeEl.id='gc-badge';
    badgeEl.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9996;display:none;align-items:center;gap:8px;padding:7px 16px 7px 12px;background:rgba(11,10,18,.92);border:1px solid rgba(139,92,246,.3);border-radius:24px;backdrop-filter:blur(14px);white-space:nowrap';
    badgeEl.innerHTML=`
      <div style="width:7px;height:7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 8px #a78bfa;animation:gc-pulse 2s ease-in-out infinite;flex-shrink:0"></div>
      <span id="gc-badge-text" style="font-size:.66rem;font-weight:700;letter-spacing:.12em;color:#a78bfa;font-family:'JetBrains Mono',monospace;text-transform:uppercase">GESTURE ON</span>
      <button onclick="GestureControl.disable()" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#9ca3af;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;margin-left:6px;flex-shrink:0;pointer-events:all;line-height:1">✕</button>`;
    document.body.appendChild(badgeEl);badgeText=document.getElementById('gc-badge-text');

    // ── Global styles ────────────────────────────────────────────────────────
    if(!document.getElementById('gc-styles')){
      const s=document.createElement('style');s.id='gc-styles';
      s.textContent=`
        @keyframes gc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.65)}}
        @keyframes gc-rip{0%{transform:scale(0);opacity:.85}100%{transform:scale(2.8);opacity:0}}
        .gc-ripple{position:fixed;pointer-events:none;z-index:9988;border-radius:50%;border:2px solid #a78bfa;animation:gc-rip .5s ease-out forwards}

        /* Cursor states */
        #gc-cursor.pinching #gc-cur-ring{width:26px!important;height:26px!important;border-color:#fff!important;background:rgba(167,139,250,.5)!important;box-shadow:0 0 22px rgba(167,139,250,.7)!important}
        #gc-cursor.pinching #gc-cur-dot{width:12px!important;height:12px!important;background:#fff!important}
        #gc-cursor.hovering #gc-cur-ring{width:54px!important;height:54px!important;border-color:rgba(167,139,250,.9)!important;background:rgba(139,92,246,.15)!important}

        /* Hover glow on any interactive element */
        .gc-hovered{outline:2px solid rgba(167,139,250,.65)!important;outline-offset:3px!important;box-shadow:0 0 0 5px rgba(139,92,246,.1)!important;border-radius:6px!important;transition:outline .08s,box-shadow .08s!important}

        /* Body transparent so camera shows through */
        body.gc-active{background:transparent!important}
        body.gc-active #heroCanvas{display:none}
      `;
      document.head.appendChild(s);
    }
    window.addEventListener('resize',resizeCanvas);resizeCanvas();
  }

  function resizeCanvas(){if(!canvasEl)return;canvasEl.width=window.innerWidth;canvasEl.height=window.innerHeight;}

  // ── Show/hide layers ───────────────────────────────────────────────────────
  function showLayers(on){
    // Camera + overlay
    if(videoEl){videoEl.style.display=on?'block':'none';requestAnimationFrame(()=>{if(videoEl)videoEl.style.opacity=on?'1':'0';});}
    const ov=document.getElementById('gc-overlay');if(ov)ov.style.display=on?'block':'none';
    // Skeleton canvas
    if(canvasEl)canvasEl.style.display=on?'block':'none';
    // Cursor
    if(cursorEl)cursorEl.style.display=on?'block':'none';
    // Badge
    if(badgeEl)badgeEl.style.display=on?'flex':'none';
    // Ring
    if(ringEl)ringEl.style.display='none';
    // Body: transparent bg so camera (z-index:-1) shows through
    document.body.classList.toggle('gc-active',on);
    if(!on)clearHover();
  }

  // ── Universal clickable check ──────────────────────────────────────────────
  function isClickable(el){
    if(!el||el===document.body||el===document.documentElement)return false;
    if(el.id&&el.id.startsWith('gc-'))return false;
    const tag=el.tagName;
    if(['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(tag))return true;
    if(el.getAttribute('onclick')||el.getAttribute('role')==='button')return true;
    const c=el.classList;
    if(c&&(c.contains('sb-link')||c.contains('btn')||c.contains('card')||c.contains('detail')||
      c.contains('feat')||c.contains('hs')||c.contains('eval-tab')||c.contains('row')||
      c.contains('pricing-card')||c.contains('plan-card')))return true;
    try{if(window.getComputedStyle(el).cursor==='pointer')return true;}catch(_){}
    return false;
  }

  function findAt(x,y){
    // Temporarily hide GC layers so elementFromPoint sees the real page
    const gcEls=['gc-canvas','gc-cursor','gc-ring','gc-flash','gc-badge'].map(id=>document.getElementById(id)).filter(Boolean);
    gcEls.forEach(e=>{e._pev=e.style.pointerEvents;e.style.pointerEvents='none';e._vis=e.style.visibility;e.style.visibility='hidden';});
    const el=document.elementFromPoint(x,y);
    gcEls.forEach(e=>{e.style.pointerEvents=e._pev;e.style.visibility=e._vis;});
    return el;
  }

  function findClickable(x,y){
    const el=findAt(x,y);if(!el)return null;
    let t=el;
    for(let i=0;i<10;i++){if(!t||t===document.body)break;if(isClickable(t))return t;t=t.parentElement;}
    return el;
  }

  function findScrollable(x,y){
    let el=findAt(x,y);
    while(el&&el!==document.body){
      const s=window.getComputedStyle(el);
      if(['auto','scroll'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight)return el;
      el=el.parentElement;
    }
    return null;
  }

  // ── Hover highlight ────────────────────────────────────────────────────────
  function setHover(el){
    if(el===lastHovered)return;clearHover();
    if(el&&el!==document.body&&!(el.id&&el.id.startsWith('gc-'))){el.classList.add('gc-hovered');lastHovered=el;}
  }
  function clearHover(){if(lastHovered){lastHovered.classList.remove('gc-hovered');lastHovered=null;}}

  // ── Smooth cursor 60fps loop ───────────────────────────────────────────────
  function startCursorLoop(){
    function loop(){
      if(!running)return;
      curX+=(tgtX-curX)*0.22;curY+=(tgtY-curY)*0.22;
      if(cursorEl){cursorEl.style.left=curX+'px';cursorEl.style.top=curY+'px';}
      if(ringEl){ringEl.style.left=curX+'px';ringEl.style.top=curY+'px';}
      const hov=findClickable(curX,curY);
      const hoverable=hov&&isClickable(hov);
      setHover(hoverable?hov:null);
      if(cursorEl){cursorEl.classList.toggle('hovering',hoverable&&!isPinching);cursorEl.classList.toggle('pinching',isPinching);}
      animId=requestAnimationFrame(loop);
    }
    animId=requestAnimationFrame(loop);
  }

  // ── Effects ────────────────────────────────────────────────────────────────
  function doFlash(){if(!flashEl)return;flashEl.style.opacity='1';setTimeout(()=>{flashEl.style.opacity='0';},110);}
  function ripple(x,y){const r=document.createElement('div');r.className='gc-ripple';r.style.cssText=`width:58px;height:58px;left:${x-29}px;top:${y-29}px`;document.body.appendChild(r);setTimeout(()=>r.remove(),550);}
  function updateBadge(t,c){if(!badgeText)return;badgeText.textContent=t;badgeText.style.color=c||'#a78bfa';}
  function setPinchRing(p){if(!ringArc)return;const C=2*Math.PI*26;ringArc.style.strokeDashoffset=C*(1-Math.max(0,Math.min(1,p)));if(ringEl)ringEl.style.display=p>0?'block':'none';}

  // ── Gesture click — dispatches real mouse events ───────────────────────────
  function gestureClick(x,y){
    ripple(x,y);doFlash();
    const target=findClickable(x,y);
    if(!target)return;
    ['mouseenter','mouseover','mousedown','mouseup','click'].forEach(type=>{
      try{target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window}));}catch(_){}
    });
    try{target.click();}catch(_){}
    target.classList.add('gc-hovered');
    setTimeout(()=>target.classList.remove('gc-hovered'),280);
    updateBadge('✓ CLICKED','#34d399');
    setTimeout(()=>updateBadge('✋ GESTURE ON','#a78bfa'),700);
  }

  // ── Scroll: wrist Y movement ───────────────────────────────────────────────
  function handleScroll(wristY,pinching){
    if(pinching){prevWristY=null;return;}
    if(prevWristY===null){prevWristY=wristY;return;}
    const delta=wristY-prevWristY;prevWristY=wristY;
    if(Math.abs(delta)<4)return;
    scrollAccum+=delta*3.5;
    if(Math.abs(scrollAccum)>=1){
      const st=findScrollable(curX,curY);
      if(st)st.scrollBy({top:scrollAccum,behavior:'auto'});
      else window.scrollBy({top:scrollAccum,behavior:'auto'});
      scrollAccum=0;
    }
  }

  // ── Draw hand skeleton ─────────────────────────────────────────────────────
  function drawHand(lm){
    if(!ctx||!videoEl||!canvasEl)return;
    const W=canvasEl.width,H=canvasEl.height;
    ctx.clearRect(0,0,W,H);
    const pts=lm.map(([x,y])=>[(1-x/videoEl.videoWidth)*W,(y/videoEl.videoHeight)*H]);
    CHAINS.forEach((chain,fi)=>{
      ctx.beginPath();chain.forEach((i,idx)=>idx===0?ctx.moveTo(pts[i][0],pts[i][1]):ctx.lineTo(pts[i][0],pts[i][1]));
      ctx.strokeStyle=fi===1?'rgba(167,139,250,.7)':'rgba(120,100,220,.4)';ctx.lineWidth=fi===1?2.5:1.7;ctx.stroke();
    });
    pts.forEach(([x,y],i)=>{
      const isIdx=i===8,isThm=i===4,isTip=[4,8,12,16,20].includes(i);
      ctx.beginPath();ctx.arc(x,y,isIdx||isThm?7:isTip?4:2.5,0,Math.PI*2);
      ctx.fillStyle=isIdx?'#a78bfa':isThm?'#34d399':isTip?'rgba(167,139,250,.55)':'rgba(90,80,160,.35)';ctx.fill();
      if(isIdx||isThm){ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fillStyle=isIdx?'rgba(167,139,250,.1)':'rgba(52,211,153,.1)';ctx.fill();}
    });
    const[tx,ty]=pts[4],[ix,iy]=pts[8],d=Math.hypot(tx-ix,ty-iy),a=Math.max(0,1-d/150);
    if(a>0.05){ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(ix,iy);ctx.strokeStyle=`rgba(167,139,250,${a*.75})`;ctx.lineWidth=1.5;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);}
  }

  // ── Detection loop ─────────────────────────────────────────────────────────
  async function detectLoop(){
    if(!running||!model||!videoEl)return;
    if(videoEl.readyState<2){requestAnimationFrame(detectLoop);return;}
    let predictions;
    try{predictions=await model.estimateHands(videoEl);}catch(_){requestAnimationFrame(detectLoop);return;}
    if(predictions.length>0){
      const lm=predictions[0].landmarks;
      drawHand(lm);
      const[ix,iy]=lm[8],[tx,ty]=lm[4],[,wy]=lm[0];
      tgtX=(1-ix/videoEl.videoWidth)*window.innerWidth;
      tgtY=(iy/videoEl.videoHeight)*window.innerHeight;
      const dist=Math.hypot(ix-tx,iy-ty);
      isPinching=dist<PINCH_DIST;
      handleScroll((wy/videoEl.videoHeight)*window.innerHeight,isPinching);
      const now=Date.now();
      if(isPinching){
        if(!wasPinching)pinchStart=now;
        const p=Math.min(1,(now-pinchStart)/PINCH_HOLD);
        setPinchRing(p);
        updateBadge('🤌 HOLD TO CLICK','#fbbf24');
        if(p>=1&&now>pinchCooldown){pinchCooldown=now+950;pinchStart=now;gestureClick(curX,curY);}
      }else{
        setPinchRing(0);
        updateBadge('✋ GESTURE ON','#a78bfa');
      }
      wasPinching=isPinching;
    }else{
      if(ctx)ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
      clearHover();setPinchRing(0);prevWristY=null;wasPinching=false;isPinching=false;
      if(cursorEl){cursorEl.classList.remove('pinching','hovering');}
      updateBadge('NO HAND — RAISE IT ✋','#5a5672');
    }
    requestAnimationFrame(detectLoop);
  }

  // ── Enable ─────────────────────────────────────────────────────────────────
  async function enable(){
    injectDOM();
    if(!loaded){
      // Show badge immediately so user gets feedback
      if(badgeEl)badgeEl.style.display='flex';
      updateBadge('STARTING CAMERA…','#fbbf24');
      try{
        stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
        videoEl.srcObject=stream;
        await new Promise(r=>{videoEl.onloadedmetadata=r;});
        await videoEl.play();
      }catch(e){
        if(badgeEl)badgeEl.style.display='none';
        alert('Camera access denied. Please allow camera access and try again.');
        return;
      }
      updateBadge('LOADING MODEL…','#fbbf24');
      try{
        await tf.setBackend('webgl');await tf.ready();
        model=await handpose.load({detectionConfidence:0.88,scoreThreshold:0.75});
        const wc=document.createElement('canvas');wc.width=64;wc.height=64;
        await model.estimateHands(wc);
        loaded=true;
      }catch(e){
        if(badgeEl)badgeEl.style.display='none';
        alert('Hand tracking failed to load: '+e.message);return;
      }
    }
    showLayers(true);
    running=true;resizeCanvas();startCursorLoop();detectLoop();
    const btn=document.getElementById('gestureToggleBtn');
    if(btn){btn.classList.add('active');btn.title='Disable gesture control';}
  }

  // ── Disable ────────────────────────────────────────────────────────────────
  function disable(){
    running=false;
    if(animId)cancelAnimationFrame(animId);
    showLayers(false);clearHover();setPinchRing(0);
    if(ctx&&canvasEl)ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
    if(cursorEl){cursorEl.classList.remove('pinching','hovering');}
    prevWristY=null;wasPinching=false;isPinching=false;
    document.body.classList.remove('gc-active');
    const btn=document.getElementById('gestureToggleBtn');
    if(btn){btn.classList.remove('active');btn.title='Enable gesture control';}
  }

  function toggle(){running?disable():enable();}
  return{enable,disable,toggle};
})();
