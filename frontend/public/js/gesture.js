/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Gesture Control v2
   Controls the ENTIRE page: hover, click, scroll, all elements
   TensorFlow.js HandPose — 100% local, no API key, no cost
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
  const GC_IDS=['gc-video','gc-overlay','gc-canvas','gc-cursor','gc-ring','gc-flash','gc-badge','gc-scroll-hint'];

  function injectDOM(){
    if(document.getElementById('gc-video'))return;
    videoEl=Object.assign(document.createElement('video'),{id:'gc-video',autoplay:true,playsInline:true,muted:true});
    videoEl.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:8800;display:none;opacity:0;transition:opacity .5s';
    document.body.appendChild(videoEl);
    const ov=document.createElement('div');
    ov.id='gc-overlay';ov.style.cssText='position:fixed;inset:0;background:rgba(6,5,10,.44);z-index:8801;display:none;pointer-events:none';
    document.body.appendChild(ov);
    canvasEl=document.createElement('canvas');
    canvasEl.id='gc-canvas';canvasEl.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:8802;pointer-events:none;display:none';
    document.body.appendChild(canvasEl);ctx=canvasEl.getContext('2d');
    flashEl=document.createElement('div');flashEl.id='gc-flash';
    flashEl.style.cssText='position:fixed;inset:0;z-index:8900;pointer-events:none;opacity:0;background:rgba(167,139,250,.07);transition:opacity .1s';
    document.body.appendChild(flashEl);
    cursorEl=document.createElement('div');cursorEl.id='gc-cursor';
    cursorEl.style.cssText='position:fixed;pointer-events:none;z-index:8950;transform:translate(-50%,-50%);display:none';
    cursorEl.innerHTML=`<div id="gc-cur-ring" style="width:44px;height:44px;border-radius:50%;border:2px solid rgba(167,139,250,.7);background:rgba(139,92,246,.08);display:flex;align-items:center;justify-content:center;transition:all .12s ease"><div id="gc-cur-dot" style="width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.9);transition:all .12s ease"></div></div>`;
    document.body.appendChild(cursorEl);
    ringEl=document.createElement('div');ringEl.id='gc-ring';
    ringEl.style.cssText='position:fixed;pointer-events:none;z-index:8949;transform:translate(-50%,-50%);display:none';
    ringEl.innerHTML=`<svg width="68" height="68" viewBox="0 0 68 68"><circle cx="34" cy="34" r="26" fill="none" stroke="rgba(167,139,250,.1)" stroke-width="2"/><circle id="gc-arc" cx="34" cy="34" r="26" fill="none" stroke="#a78bfa" stroke-width="3" stroke-dasharray="163.4" stroke-dashoffset="163.4" stroke-linecap="round" transform="rotate(-90 34 34)" style="transition:stroke-dashoffset .06s linear"/></svg>`;
    document.body.appendChild(ringEl);ringArc=document.getElementById('gc-arc');
    badgeEl=document.createElement('div');badgeEl.id='gc-badge';
    badgeEl.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:8960;display:none;align-items:center;gap:8px;padding:6px 16px 6px 10px;background:rgba(11,10,18,.92);border:1px solid rgba(139,92,246,.3);border-radius:24px;backdrop-filter:blur(14px);white-space:nowrap';
    badgeEl.innerHTML=`<div style="width:7px;height:7px;border-radius:50%;background:#a78bfa;box-shadow:0 0 8px #a78bfa;animation:gc-pulse 2s ease-in-out infinite;flex-shrink:0"></div><span id="gc-badge-text" style="font-size:.68rem;font-weight:700;letter-spacing:.12em;color:#a78bfa;font-family:'JetBrains Mono',monospace;text-transform:uppercase">GESTURE ON</span><button onclick="GestureControl.disable()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#9ca3af;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;margin-left:4px;flex-shrink:0;pointer-events:all">✕</button>`;
    document.body.appendChild(badgeEl);badgeText=document.getElementById('gc-badge-text');
    const sh=document.createElement('div');sh.id='gc-scroll-hint';
    sh.style.cssText='position:fixed;right:16px;top:50%;transform:translateY(-50%);z-index:8960;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;transition:opacity .2s';
    sh.innerHTML=`<div style="width:22px;height:22px;border-radius:50%;background:rgba(139,92,246,.2);border:1px solid rgba(167,139,250,.3);display:flex;align-items:center;justify-content:center;font-size:10px;color:#a78bfa">▲</div><div style="width:1px;height:28px;background:rgba(167,139,250,.2)"></div><div style="width:22px;height:22px;border-radius:50%;background:rgba(139,92,246,.2);border:1px solid rgba(167,139,250,.3);display:flex;align-items:center;justify-content:center;font-size:10px;color:#a78bfa">▼</div>`;
    document.body.appendChild(sh);
    if(!document.getElementById('gc-styles')){
      const s=document.createElement('style');s.id='gc-styles';
      s.textContent=`
        @keyframes gc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.65)}}
        @keyframes gc-rip{0%{transform:scale(0);opacity:.85}100%{transform:scale(2.8);opacity:0}}
        .gc-ripple{position:fixed;pointer-events:none;z-index:8940;border-radius:50%;border:2px solid #a78bfa;animation:gc-rip .5s ease-out forwards}
        #gc-cursor.pinching #gc-cur-ring{width:26px!important;height:26px!important;border-color:#fff!important;background:rgba(167,139,250,.5)!important;box-shadow:0 0 22px rgba(167,139,250,.7)!important}
        #gc-cursor.pinching #gc-cur-dot{width:12px!important;height:12px!important;background:#fff!important}
        #gc-cursor.hovering #gc-cur-ring{width:54px!important;height:54px!important;border-color:rgba(167,139,250,.9)!important;background:rgba(139,92,246,.16)!important}
        .gc-hovered{outline:2px solid rgba(167,139,250,.65)!important;outline-offset:3px!important;box-shadow:0 0 0 5px rgba(139,92,246,.1)!important;border-radius:6px!important}
      `;
      document.head.appendChild(s);
    }
    window.addEventListener('resize',resizeCanvas);resizeCanvas();
  }

  function resizeCanvas(){if(!canvasEl)return;canvasEl.width=window.innerWidth;canvasEl.height=window.innerHeight;}

  function showLayers(on){
    GC_IDS.forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      if(id==='gc-badge')el.style.display=on?'flex':'none';
      else if(id==='gc-scroll-hint')el.style.display=on?'flex':'none';
      else el.style.display=on?'block':'none';
    });
    if(on)requestAnimationFrame(()=>{if(videoEl)videoEl.style.opacity='1';});
    else if(videoEl)videoEl.style.opacity='0';
    if(!on)clearHover();
  }

  // ── Universal clickable detection ─────────────────────────────────────────
  function isClickable(el){
    if(!el||el===document.body||el===document.documentElement)return false;
    if(el.id&&el.id.startsWith('gc-'))return false;
    const tag=el.tagName;
    if(['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(tag))return true;
    if(el.getAttribute('onclick')||el.getAttribute('role')==='button')return true;
    const cls=el.classList;
    if(cls&&(cls.contains('sb-link')||cls.contains('btn')||cls.contains('card')||
      cls.contains('detail')||cls.contains('feat')||cls.contains('hs')||
      cls.contains('pricing-card')||cls.contains('plan-card')||cls.contains('eval-tab')||
      cls.contains('badge')||cls.contains('row')))return true;
    try{if(window.getComputedStyle(el).cursor==='pointer')return true;}catch(_){}
    return false;
  }

  function hideLayers(fn){
    const saved=GC_IDS.map(id=>{const el=document.getElementById(id);const v=el?el.style.visibility:'';if(el)el.style.visibility='hidden';return v;});
    const result=fn();
    GC_IDS.forEach((id,i)=>{const el=document.getElementById(id);if(el)el.style.visibility=saved[i];});
    return result;
  }

  function findClickable(x,y){
    return hideLayers(()=>{
      const el=document.elementFromPoint(x,y);
      if(!el)return null;
      let t=el;
      for(let i=0;i<10;i++){
        if(!t||t===document.body)break;
        if(isClickable(t))return t;
        t=t.parentElement;
      }
      return el;
    });
  }

  function setHover(el){
    if(el===lastHovered)return;
    clearHover();
    if(el&&el!==document.body&&!(el.id&&el.id.startsWith('gc-'))){el.classList.add('gc-hovered');lastHovered=el;}
  }

  function clearHover(){if(lastHovered){lastHovered.classList.remove('gc-hovered');lastHovered=null;}}

  // ── 60fps cursor + hover loop ─────────────────────────────────────────────
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

  function doFlash(){if(!flashEl)return;flashEl.style.opacity='1';setTimeout(()=>{flashEl.style.opacity='0';},110);}

  function ripple(x,y){
    const r=document.createElement('div');r.className='gc-ripple';
    r.style.cssText=`width:58px;height:58px;left:${x-29}px;top:${y-29}px`;
    document.body.appendChild(r);setTimeout(()=>r.remove(),550);
  }

  function updateBadge(text,color){if(!badgeText)return;badgeText.textContent=text;badgeText.style.color=color||'#a78bfa';}

  function setPinchRing(p){
    if(!ringArc)return;
    const C=2*Math.PI*26;
    ringArc.style.strokeDashoffset=C*(1-Math.max(0,Math.min(1,p)));
    if(ringEl)ringEl.style.display=p>0?'block':'none';
  }

  // ── Fire real click with full mouse event chain ───────────────────────────
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
    setTimeout(()=>updateBadge('GESTURE ON','#a78bfa'),700);
  }

  // ── Scroll: open hand + wrist movement ───────────────────────────────────
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
      const hint=document.getElementById('gc-scroll-hint');
      if(hint){hint.style.opacity='1';clearTimeout(hint._t);hint._t=setTimeout(()=>{hint.style.opacity='0';},400);}
      scrollAccum=0;
    }
  }

  function findScrollable(x,y){
    return hideLayers(()=>{
      let el=document.elementFromPoint(x,y);
      while(el&&el!==document.body){
        const s=window.getComputedStyle(el);
        if(['auto','scroll'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight)return el;
        el=el.parentElement;
      }
      return null;
    });
  }

  // ── Draw hand skeleton ─────────────────────────────────────────────────────
  function drawHand(lm){
    if(!ctx||!videoEl||!canvasEl)return;
    const W=canvasEl.width,H=canvasEl.height;
    ctx.clearRect(0,0,W,H);
    const pts=lm.map(([x,y])=>[(1-x/videoEl.videoWidth)*W,(y/videoEl.videoHeight)*H]);
    CHAINS.forEach((chain,fi)=>{
      ctx.beginPath();chain.forEach((i,idx)=>idx===0?ctx.moveTo(pts[i][0],pts[i][1]):ctx.lineTo(pts[i][0],pts[i][1]));
      ctx.strokeStyle=fi===1?'rgba(167,139,250,.65)':'rgba(100,80,200,.38)';ctx.lineWidth=fi===1?2.5:1.6;ctx.stroke();
    });
    pts.forEach(([x,y],i)=>{
      const isIdx=i===8,isThm=i===4,isTip=[4,8,12,16,20].includes(i);
      ctx.beginPath();ctx.arc(x,y,isIdx||isThm?7:isTip?4:2.5,0,Math.PI*2);
      ctx.fillStyle=isIdx?'#a78bfa':isThm?'#34d399':isTip?'rgba(167,139,250,.5)':'rgba(90,80,160,.3)';ctx.fill();
      if(isIdx||isThm){ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fillStyle=isIdx?'rgba(167,139,250,.1)':'rgba(52,211,153,.1)';ctx.fill();}
    });
    const[tx,ty]=pts[4],[ix,iy]=pts[8];
    const d=Math.hypot(tx-ix,ty-iy),a=Math.max(0,1-d/150);
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
      }else{setPinchRing(0);updateBadge('✋ GESTURE ON','#a78bfa');}
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
      updateBadge('STARTING CAMERA…','#fbbf24');showLayers(true);
      try{
        stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
        videoEl.srcObject=stream;await new Promise(r=>{videoEl.onloadedmetadata=r;});await videoEl.play();
      }catch(e){alert('Camera access denied. Please allow camera and try again.');showLayers(false);return;}
      updateBadge('LOADING MODEL…','#fbbf24');
      try{
        await tf.setBackend('webgl');await tf.ready();
        model=await handpose.load({detectionConfidence:0.88,scoreThreshold:0.75});
        const wc=document.createElement('canvas');wc.width=64;wc.height=64;await model.estimateHands(wc);
        loaded=true;
      }catch(e){alert('Hand tracking failed: '+e.message);showLayers(false);return;}
    }else{showLayers(true);}
    running=true;resizeCanvas();startCursorLoop();detectLoop();
    const btn=document.getElementById('gestureToggleBtn');
    if(btn){btn.classList.add('active');btn.title='Disable gesture control';}
  }

  // ── Disable ────────────────────────────────────────────────────────────────
  function disable(){
    running=false;if(animId)cancelAnimationFrame(animId);
    showLayers(false);clearHover();setPinchRing(0);
    if(ctx&&canvasEl)ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
    if(cursorEl){cursorEl.classList.remove('pinching','hovering');}
    prevWristY=null;wasPinching=false;isPinching=false;
    const btn=document.getElementById('gestureToggleBtn');
    if(btn){btn.classList.remove('active');btn.title='Enable gesture control';}
  }

  function toggle(){running?disable():enable();}
  return{enable,disable,toggle};
})();
