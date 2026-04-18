/* Pluto Capital Funding — v14.0 — Premium Dashboard */
const API='https://pluto-platform-production.up.railway.app';
let token=localStorage.getItem('pcf_token'),user=null,currentEval='one_step',selectedPlan=null;
const $=id=>document.getElementById(id);
const F=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n);
const B=s=>`<span class="badge b-${s}">${s.replace(/_/g,' ')}</span>`;
const pct=n=>`${n>=0?'+':''}${n.toFixed(2)}%`;
const LOADING=`<div style="display:flex;align-items:center;justify-content:center;padding:80px;gap:12px;color:var(--t3)"><div style="width:20px;height:20px;border:2.5px solid var(--brd);border-top-color:var(--ac);border-radius:50%;animation:spin .6s linear infinite"></div><span style="font-size:.86rem">Loading...</span></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

// THEME
const MOON_SVG=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
const SUN_SVG=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem('pcf_theme',t);
  const isLight=t==='light';
  const icon=$('navThemeIcon');if(icon)icon.outerHTML=(isLight?MOON_SVG:SUN_SVG).replace('<svg','<svg id="navThemeIcon"');
  const lbl=$('sbThemeLabel');if(lbl)lbl.textContent=isLight?'LIGHT':'DARK';
}
function toggleTheme(){applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');}
// Init theme immediately (before render to avoid flash)
applyTheme(localStorage.getItem('pcf_theme')||'dark');
async function api(u,o={}){const h={'Content-Type':'application/json'};if(token)h['Authorization']='Bearer '+token;const r=await fetch(API+u,{...o,headers:h});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
function showAuth(m){$('authModal').classList.remove('hidden');showAuthScreen(m==='login'?'formLogin':'formRegister')}
function showAuthScreen(id){['formLogin','formRegister','formVerify','formForgot','formReset'].forEach(f=>{const el=$(f);if(el)el.classList.add('hidden')});const t=$(id);if(t)t.classList.remove('hidden')}
function hideAuth(){$('authModal').classList.add('hidden')}

// Enter key submits whichever auth form is visible
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const active=['formLogin','formRegister','formVerify','formForgot','formReset'].find(id=>{const el=$(id);return el&&!el.classList.contains('hidden');});
  if(!active)return;
  const form=$(active)?.querySelector('form');
  if(form){e.preventDefault();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
});

// Enter on discount code input
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement?.id==='discountInput'){e.preventDefault();validateCode();updateOrderSummary&&updateOrderSummary();}
});
function selectPlan(size){window._buySize=size;window._buyType=currentEval;if(token){navigate('buy')}else{selectedPlan={size,type:currentEval};showAuth('register')}}
function toast(m,t='info'){const e=document.createElement('div');e.className='toast toast-'+t;e.textContent=m;document.body.appendChild(e);setTimeout(()=>{e.style.opacity='0';e.style.transform='translateY(-10px)';e.style.transition='all .3s';setTimeout(()=>e.remove(),300)},3000)}
let pendingVerifyEmail='';
async function doLogin(e){e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('loginEmail').value,password:$('loginPass').value})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;hideAuth();enterDashboard()}catch(x){toast(x.message,'error')}}
async function doRegister(e){e.preventDefault();const ta=$('regTerms');if(!ta||!ta.checked){toast('You must accept the Terms of Service','error');return}try{const email=$('regEmail').value;const d=await api('/api/auth/register',{method:'POST',body:JSON.stringify({email,password:$('regPass').value,first_name:$('regFirst').value,last_name:$('regLast').value,terms_accepted:true})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;pendingVerifyEmail=email;$('verifyEmailDisplay').textContent=email;showAuthScreen('formVerify');toast('Check your email for a verification code','info')}catch(x){toast(x.message,'error')}}
async function doVerify(e){e.preventDefault();try{await api('/api/auth/verify-email',{method:'POST',body:JSON.stringify({email:pendingVerifyEmail,code:$('verifyCode').value})});toast('Email verified!','success');hideAuth();enterDashboard();if(selectedPlan)setTimeout(()=>{navigate('buy');toast('Select your plan','info')},500)}catch(x){toast(x.message,'error')}}
async function resendCode(){try{await api('/api/auth/resend-code',{method:'POST',body:JSON.stringify({email:pendingVerifyEmail})});toast('New code sent!','success')}catch(x){toast(x.message,'error')}}
let pendingResetEmail='';
async function doForgot(e){e.preventDefault();try{pendingResetEmail=$('forgotEmail').value;await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:pendingResetEmail})});showAuthScreen('formReset');const re=$('resetEmail');if(re)re.value=pendingResetEmail;toast('Check your email for a reset code.','info')}catch(x){toast(x.message,'error')}}
async function doReset(e){e.preventDefault();try{const em=$('resetEmail')?.value||pendingResetEmail;await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({email:em,code:$('resetCode').value,new_password:$('resetNewPass').value})});toast('Password reset! You can now sign in.','success');showAuth('login')}catch(x){toast(x.message,'error')}}
async function resendResetCode(){const em=$('resetEmail')?.value||pendingResetEmail;if(!em){toast('Enter your email first','error');return;}try{await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:em})});toast('New code sent — check your email','info')}catch(x){toast(x.message,'error')}}
function logout(){token=null;user=null;localStorage.removeItem('pcf_token');$('app').style.display='none';$('landing').style.display='block'}
function toggleMobile(){const s=document.getElementById('dashSidebar');const o=document.getElementById('mobileOverlay');if(s.classList.contains('mobile-open')){closeMobile()}else{s.classList.add('mobile-open');o.classList.add('open')}}
function closeMobile(){const s=document.getElementById('dashSidebar');const o=document.getElementById('mobileOverlay');s.classList.remove('mobile-open');o.classList.remove('open')}
async function enterDashboard(){try{user=await api('/api/users/profile');$('landing').style.display='none';$('authModal').classList.add('hidden');showWelcomeSplash(user.first_name||'Trader',()=>{$('app').style.display='block';$('userName').textContent=(user.first_name+' '+user.last_name).trim()||'Trader';$('userEmail').textContent=user.email;if(user.role==='admin')$('adminMenuItem').classList.remove('hidden');applyTheme(localStorage.getItem('pcf_theme')||'dark');navigate('dashboard')})}catch(x){logout()}}

function showWelcomeSplash(firstName,onDone){
  const splash=$('welcomeSplash');
  const canvas=$('splashCanvas');
  const ctx=canvas.getContext('2d');
  splash.style.display='block';
  splash.style.opacity='1';

  // Set canvas size
  function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;}
  resize();
  window.addEventListener('resize',resize);

  // --- CANDLESTICK ANIMATION ---
  const candles=[];
  const NUM=42;
  let basePrice=1.0850;
  function genCandles(){
    candles.length=0;
    let p=basePrice;
    for(let i=0;i<NUM;i++){
      const open=p;
      const move=(Math.random()-.48)*.003;
      const close=open+move;
      const high=Math.max(open,close)+(Math.random()*.0015);
      const low=Math.min(open,close)-(Math.random()*.0015);
      candles.push({open,close,high,low,born:Date.now()+i*60});
      p=close;
    }
  }
  genCandles();

  let raf;
  function draw(){
    const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);

    // Subtle grid lines
    ctx.strokeStyle='rgba(139,92,246,0.04)';
    ctx.lineWidth=1;
    for(let y=0;y<H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    for(let x=0;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.moveTo(x,H);ctx.lineTo(x,H);ctx.stroke();}

    // Price range
    const prices=candles.flatMap(c=>[c.high,c.low]);
    const minP=Math.min(...prices),maxP=Math.max(...prices);
    const range=maxP-minP||0.01;
    const pad=H*0.18;
    const toY=p=>pad+((maxP-p)/range)*(H-pad*2);

    // Draw area under closing prices
    const pts=candles.map((c,i)=>{const cw=(W-80)/NUM;const cx=40+i*cw+cw/2;return[cx,toY(c.close)];});
    if(pts.length>1){
      ctx.beginPath();
      ctx.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
      ctx.lineTo(pts[pts.length-1][0],H);
      ctx.lineTo(pts[0][0],H);
      ctx.closePath();
      const grad=ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0,'rgba(139,92,246,0.12)');
      grad.addColorStop(1,'rgba(139,92,246,0)');
      ctx.fillStyle=grad;
      ctx.fill();
    }

    // Draw candles
    const cw=Math.max(6,Math.floor((W-80)/NUM)-3);
    candles.forEach((c,i)=>{
      const now=Date.now();
      if(now<c.born)return;
      const x=40+i*((W-80)/NUM);
      const bull=c.close>=c.open;
      const alpha=Math.min(1,(now-c.born)/300);
      ctx.globalAlpha=alpha*0.7;
      const col=bull?'#34d399':'#f87171';
      // Wick
      ctx.strokeStyle=col;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(x+cw/2,toY(c.high));ctx.lineTo(x+cw/2,toY(c.low));ctx.stroke();
      // Body
      ctx.fillStyle=col;
      const oy=toY(Math.max(c.open,c.close)),cy=toY(Math.min(c.open,c.close));
      const bh=Math.max(2,cy-oy);
      ctx.fillRect(x,oy,cw,bh);
      ctx.globalAlpha=1;
    });

    // Glowing price line
    if(pts.length>1){
      ctx.beginPath();
      ctx.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
      ctx.strokeStyle='rgba(167,139,250,0.5)';
      ctx.lineWidth=1.5;
      ctx.stroke();
    }

    // Floating ticker label
    const last=candles[candles.length-1];
    const lx=pts[pts.length-1][0]+10,ly=toY(last.close);
    ctx.fillStyle='rgba(167,139,250,0.15)';
    ctx.beginPath();ctx.roundRect(lx,ly-11,90,22,4);ctx.fill();
    ctx.fillStyle='rgba(167,139,250,0.8)';ctx.font='700 12px "JetBrains Mono",monospace';
    ctx.fillText('EUR/USD '+last.close.toFixed(4),lx+8,ly+4);

    raf=requestAnimationFrame(draw);
  }
  draw();

  // Animate text in
  requestAnimationFrame(()=>{
    $('splashName').textContent=firstName.toUpperCase();
    setTimeout(()=>{
      $('splashTag').style.opacity='1';$('splashTag').style.transform='translateY(0)';
      $('splashWelcome').style.opacity='1';$('splashWelcome').style.transform='translateY(0)';
      $('splashName').style.opacity='1';$('splashName').style.transform='translateY(0) scale(1)';
      $('splashSub').style.opacity='1';
      $('splashBar').style.opacity='1';
      setTimeout(()=>$('splashProgress').style.width='100%',50);
    },80);
  });

  // Fade out & hand off
  setTimeout(()=>{
    splash.style.transition='opacity .55s ease';
    splash.style.opacity='0';
    setTimeout(()=>{
      cancelAnimationFrame(raf);
      window.removeEventListener('resize',resize);
      splash.style.display='none';
      onDone();
    },580);
  },2600);
}
function navigate(p){closeMobile();document.querySelectorAll('.page').forEach(e=>e.classList.add('hidden'));document.querySelectorAll('.sb-link').forEach(l=>l.classList.remove('active'));const el=$('page-'+p);if(el){el.classList.remove('hidden');el.classList.add('fade')}const lk=document.querySelector(`[data-page="${p}"]`);if(lk)lk.classList.add('active');if(window['render_'+p])window['render_'+p]()}
const PLANS={one_step:[{size:5000,fee:32,target:10,daily:5,dd:8,split:80,lev:'1:30'},{size:10000,fee:59,target:10,daily:5,dd:8,split:80,lev:'1:30'},{size:25000,fee:144,target:10,daily:5,dd:8,split:80,lev:'1:30'},{size:50000,fee:225,target:10,daily:5,dd:8,split:80,lev:'1:30'},{size:100000,fee:399,target:10,daily:5,dd:8,split:80,lev:'1:30'},{size:200000,fee:799,target:10,daily:5,dd:8,split:80,lev:'1:30'}],two_step:[{size:5000,fee:29,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'},{size:10000,fee:49,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'},{size:25000,fee:129,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'},{size:50000,fee:199,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'},{size:100000,fee:359,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'},{size:200000,fee:719,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:30'}]};
function renderPricing(plans,c,action){c.innerHTML=plans.map((p,i)=>`<div class="plan ${i===4?'popular':''}" onclick="${action}(${p.size})"><div class="plan-size">${F(p.size)}</div><div class="plan-price">${F(p.fee)}</div><div class="plan-detail">${p.target}% Target</div><div class="plan-detail">${p.daily}% Daily Loss</div><div class="plan-detail">${p.dd}% Max DD</div><div class="plan-detail">${p.split}% Split</div><div class="plan-detail">${p.lev} Leverage</div><div class="plan-detail">20% Consistency</div><button class="btn btn-primary btn-sm btn-full" style="margin-top:16px">${action==='selectPlan'?'Get Funded':'Select Plan'}</button></div>`).join('')}
function switchEval(type){currentEval=type;document.querySelectorAll('#pricing .eval-tab').forEach(t=>t.classList.remove('active'));event.target.classList.add('active');renderPricing(PLANS[type],$('landingPricing'),"selectPlan")}
function G(label,value,max,color,warn){const p=Math.min(100,Math.abs(value)/max*100);const c=warn&&p>70?'var(--rd)':color;return`<div style="flex:1;min-width:160px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:.7rem;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;font-weight:700">${label}</span><span style="font-size:.84rem;font-family:var(--fm);font-weight:700;color:${warn&&p>70?'var(--rd)':'var(--t1)'}">${value.toFixed(2)}% <span style="color:var(--t3);font-weight:400">/ ${max}%</span></span></div><div class="bar" style="height:6px"><div class="bar-fill" style="width:${p}%;background:${c}"></div></div></div>`}
function M(label,value,color){return`<div style="padding:16px;background:var(--bg);border-radius:var(--r2);border:1px solid var(--brd);text-align:center"><div style="font-size:.64rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">${label}</div><div style="font-size:1.15rem;font-family:var(--fm);font-weight:700;${color?'color:'+color:''}">${value}</div></div>`}
function R(l,v,c){return`<div class="row"><span class="row-label">${l}</span><span class="row-value"${c?' style="color:'+c+'"':''}>${v}</span></div>`}
function QA(icon,title,sub,page){return`<div onclick="navigate('${page}')" style="padding:18px 16px;background:var(--sf);border:1px solid var(--brd);border-radius:var(--r2);cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:14px" onmouseover="this.style.borderColor='var(--ac-gl)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--brd)';this.style.transform='none'"><div style="width:40px;height:40px;border-radius:10px;background:var(--ac-bg);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">${icon}</div><div><div style="font-weight:700;font-size:.88rem;color:var(--t1)">${title}</div><div style="font-size:.74rem;color:var(--t3);margin-top:1px">${sub}</div></div></div>`}

// DASHBOARD
window.render_dashboard=async function(){$('page-dashboard').innerHTML=LOADING;try{const s=await api('/api/dashboard/stats');const pending=s.challenges.filter(c=>c.status==='pending_payment');const active=s.challenges.filter(c=>c.status==='active');const passed=s.challenges.filter(c=>c.status==='passed').length;const failed=s.challenges.filter(c=>c.status==='failed').length;
$('page-dashboard').innerHTML=`<div class="page-head"><h1>Dashboard</h1><p>Welcome back, ${user.first_name}. Here's your trading overview.</p></div>
<div class="stats"><div class="stat s-purple"><div class="stat-label">Total Profit</div><div class="stat-value" style="color:${s.total_profit>=0?'var(--gr)':'var(--rd)'}">${F(s.total_profit)}</div></div><div class="stat s-green"><div class="stat-label">Payouts</div><div class="stat-value">${F(s.total_payouts)}</div></div><div class="stat s-blue"><div class="stat-label">Evaluations</div><div class="stat-value">${s.active_challenges}</div></div><div class="stat s-cyan"><div class="stat-label">Funded</div><div class="stat-value">${s.active_funded}</div></div><div class="stat s-amber"><div class="stat-label">Win Rate</div><div class="stat-value">${s.win_rate}%</div></div><div class="stat s-green"><div class="stat-label">Trades</div><div class="stat-value">${s.total_trades}</div></div></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:24px">${QA('&#128176;','New Challenge','Start an evaluation','buy')}${QA('&#128200;','Metrics','Account analytics','challenges')}${QA('&#129302;','AI Coach','Trading insights','coach')}${QA('&#128179;','Payouts','Withdraw profits','payouts')}</div>
${pending.length?`<div class="card" style="border-color:rgba(251,191,36,.2);background:linear-gradient(135deg,rgba(251,191,36,.04),transparent)"><div class="card-title" style="color:var(--am)">&#9202; Pending Payment</div>${pending.map(c=>`<div class="row"><span class="row-label">${F(c.account_size)} ${c.challenge_type==='two_step'?'2-Step':'1-Step'}</span><span class="row-value" style="color:var(--am)">Awaiting confirmation</span></div>`).join('')}</div>`:''}
${active.length?`<div class="card"><div class="card-title">Active Evaluations</div>${active.map(c=>{const pp=((c.current_balance-c.starting_balance)/c.starting_balance*100);const tp=Math.min(100,Math.max(0,pp/c.profit_target_pct*100));const du=((c.highest_balance-c.lowest_equity)/c.starting_balance*100);const dp=Math.min(100,du/c.max_total_loss_pct*100);const phase=c.challenge_type==='two_step'?(c.phase===2?' — Phase 2':' — Phase 1'):'';return`<div class="detail" style="cursor:pointer" onclick="navigate('challenges')"><div class="detail-head"><div><div class="detail-title">${F(c.account_size)} ${c.challenge_type==='two_step'?'2-Step':'1-Step'}${phase}</div><div class="detail-sub">Terminal: <span style="color:var(--ac2)">PlutoTrader</span></div></div>${B(c.status)}<a href="/terminal.html?challenge="+c.id+"" target="_blank" onclick="event.stopPropagation()" style="text-decoration:none"><button class="btn btn-primary btn-sm" style="gap:5px">&#9654; Trade Now</button></a></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px">${M('Balance',F(c.current_balance))}${M('Profit',pct(pp),pp>=0?'var(--gr)':'var(--rd)')}${M('Trades',String(c.total_trades))}${M('Win Rate',(c.total_trades?Math.round(c.winning_trades/c.total_trades*100):0)+'%')}</div><div style="display:flex;gap:20px;flex-wrap:wrap">${G('Target',pp,c.profit_target_pct,'var(--gr)',false)}${G('Drawdown',du,c.max_total_loss_pct,'var(--ac2)',true)}</div></div>`}).join('')}</div>`:`<div class="card" style="text-align:center;padding:52px"><div style="width:56px;height:56px;border-radius:14px;background:var(--ac-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:1.6rem">&#128640;</div><div style="font-weight:700;font-size:1.08rem;margin-bottom:6px">No active evaluations</div><div style="color:var(--t2);font-size:.88rem;margin-bottom:22px">Start a challenge to prove your edge.</div><button class="btn btn-primary" onclick="navigate('buy')">Buy Challenge &rarr;</button></div>`}
${(passed||failed)?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div class="card" style="text-align:center"><div style="font-size:.72rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Passed</div><div style="font-size:2.2rem;font-weight:600;font-family:var(--fd);letter-spacing:-.03em;color:var(--gr)">${passed}</div></div><div class="card" style="text-align:center"><div style="font-size:.72rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Failed</div><div style="font-size:2.2rem;font-weight:600;font-family:var(--fd);letter-spacing:-.03em;color:var(--rd)">${failed}</div></div></div>`:''}`}catch(e){$('page-dashboard').innerHTML=`<div class="card"><div class="empty">Failed to load. <a onclick="navigate('dashboard')">Retry</a></div></div>`}};

// CHALLENGES (Account Metrics)
window.render_challenges=async function(){$('page-challenges').innerHTML=LOADING;const d=await api('/api/challenges');if(!d.length){$('page-challenges').innerHTML=`<div class="page-head"><h1>Account Metrics</h1><p>Evaluation analytics and credentials</p></div><div class="card" style="text-align:center;padding:52px"><div style="font-size:1.6rem;margin-bottom:12px">&#128202;</div><div style="font-weight:700;margin-bottom:6px">No challenges yet</div><div style="color:var(--t2);font-size:.86rem;margin-bottom:18px">Purchase an evaluation to see metrics.</div><button class="btn btn-primary btn-sm" onclick="navigate('buy')">Buy Challenge</button></div>`;return}
$('page-challenges').innerHTML=`<div class="page-head"><h1>Account Metrics</h1><p>Detailed analytics for each evaluation</p></div>${d.map(c=>{const profit=c.current_balance-c.starting_balance;const profitPct=profit/c.starting_balance*100;const ddUsed=(c.highest_balance-c.lowest_equity)/c.starting_balance*100;const wr=c.total_trades?Math.round(c.winning_trades/c.total_trades*100):0;const isActive=c.status==='active';const isPassed=c.status==='passed';const isFailed=c.status==='failed';const isPending=c.status==='pending_payment';const phase=c.challenge_type==='two_step'?(c.phase===2?' — Phase 2':' — Phase 1'):'';
const tgtAmt=c.starting_balance*c.profit_target_pct/100;const tgtRemain=Math.max(0,tgtAmt-profit);const tgtProg=Math.min(100,Math.max(0,profit/tgtAmt*100));
const ddMax=c.starting_balance*c.max_total_loss_pct/100;const ddUsedAmt=c.highest_balance-c.current_equity;const ddRemain=Math.max(0,ddMax-ddUsedAmt);const ddProg=Math.min(100,ddUsedAmt/ddMax*100);
const dlMax=c.starting_balance*c.max_daily_loss_pct/100;const dlUsedAmt=Math.max(0,c.day_start_balance-c.current_equity);const dlRemain=Math.max(0,dlMax-dlUsedAmt);const dlProg=Math.min(100,dlUsedAmt/dlMax*100);
const threshold=c.starting_balance-ddMax;
return`<div class="card" style="margin-bottom:20px;padding:0;overflow:hidden"><div style="padding:20px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);flex-wrap:wrap;gap:10px"><div><div style="font-size:1.1rem;font-weight:700">${F(c.account_size)} ${c.challenge_type==='two_step'?'2-Step':'1-Step'}${phase}</div><div style="font-size:.76rem;color:var(--t3);margin-top:2px">ID: ${c.id.slice(0,8)} &bull; ${new Date(c.created_at).toLocaleDateString()}</div></div><div style="display:flex;align-items:center;gap:8px">${isActive?`<button class="btn btn-outline btn-sm" onclick="showCredentials('${c.ctrader_login||user?.email||''}')">Terminal Login</button>`:''} ${B(c.status)}</div></div>
${isPending?`<div style="padding:24px;text-align:center;color:var(--am)"><div style="font-size:1.2rem;margin-bottom:8px">&#9202;</div><strong>Awaiting Payment</strong></div>`:''}
${isActive||isPassed||isFailed?`<div style="padding:24px">
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px">
<div style="padding:16px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:.7rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Profit Target</div><span style="font-size:.72rem;font-weight:700;color:${tgtProg>=100?'var(--gr)':'var(--t2)'}">${Math.round(tgtProg)}%</span></div><div style="height:6px;background:var(--sf);border-radius:3px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:${tgtProg}%;background:var(--gr);border-radius:3px;transition:width .3s"></div></div><div style="display:flex;justify-content:space-between;font-size:.78rem"><span style="color:var(--t2)">Remaining</span><span style="color:var(--gr);font-weight:700;font-family:var(--fm)">${F(tgtRemain)}</span></div><div style="display:flex;justify-content:space-between;font-size:.72rem;margin-top:4px"><span style="color:var(--t3)">Target</span><span style="color:var(--t2);font-family:var(--fm)">${F(tgtAmt)}</span></div></div>
<div style="padding:16px;background:var(--bg);border:1px solid ${dlProg>70?'rgba(248,113,113,.2)':'var(--brd)'};border-radius:var(--r2)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:.7rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Daily Loss Limit</div><span style="font-size:.72rem;font-weight:700;color:${dlProg>70?'var(--rd)':'var(--t2)'}">${Math.round(dlProg)}% used</span></div><div style="height:6px;background:var(--sf);border-radius:3px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:${dlProg}%;background:${dlProg>70?'var(--rd)':'var(--am)'};border-radius:3px;transition:width .3s"></div></div><div style="display:flex;justify-content:space-between;font-size:.78rem"><span style="color:var(--t2)">Remaining</span><span style="color:${dlProg>70?'var(--rd)':'var(--am)'};font-weight:700;font-family:var(--fm)">${F(dlRemain)}</span></div><div style="display:flex;justify-content:space-between;font-size:.72rem;margin-top:4px"><span style="color:var(--t3)">Max daily loss</span><span style="color:var(--t2);font-family:var(--fm)">${F(dlMax)}</span></div></div>
<div style="padding:16px;background:var(--bg);border:1px solid ${ddProg>70?'rgba(248,113,113,.2)':'var(--brd)'};border-radius:var(--r2)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:.7rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Max Drawdown</div><span style="font-size:.72rem;font-weight:700;color:${ddProg>70?'var(--rd)':'var(--t2)'}">${Math.round(ddProg)}% used</span></div><div style="height:6px;background:var(--sf);border-radius:3px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:${ddProg}%;background:${ddProg>70?'var(--rd)':'var(--ac2)'};border-radius:3px;transition:width .3s"></div></div><div style="display:flex;justify-content:space-between;font-size:.78rem"><span style="color:var(--t2)">Remaining</span><span style="color:${ddProg>70?'var(--rd)':'var(--ac2)'};font-weight:700;font-family:var(--fm)">${F(ddRemain)}</span></div><div style="display:flex;justify-content:space-between;font-size:.72rem;margin-top:4px"><span style="color:var(--t3)">Breach at</span><span style="color:var(--t2);font-family:var(--fm)">${F(threshold)}</span></div></div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:20px">${M('Balance',F(c.current_balance))}${M('Equity',F(c.current_equity))}${M('Profit',F(profit),profit>=0?'var(--gr)':'var(--rd)')}${M('Win Rate',wr+'%')}${M('Trades',c.total_trades)}${M('W / L',`<span style="color:var(--gr)">${c.winning_trades}</span><span style="color:var(--t3)"> / </span><span style="color:var(--rd)">${c.losing_trades}</span>`)}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--brd);border-radius:var(--r2);overflow:hidden"><div style="padding:12px 16px;background:var(--bg)"><div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Platform</div><div style="font-size:.88rem;font-weight:600">PlutoTrader</div></div><div style="padding:12px 16px;background:var(--bg)"><div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Login</div><div style="font-size:.88rem;font-family:var(--fm);font-weight:700;color:var(--ac2)">${c.ctrader_login||'—'}</div></div><div style="padding:12px 16px;background:var(--bg)"><div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Terminal</div><div style="font-size:.88rem;font-weight:600">PlutoTrader</div></div><div style="padding:12px 16px;background:var(--bg)"><div style="font-size:.62rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Leverage</div><div style="font-size:.88rem;font-weight:600">${c.leverage||'1:30'}</div></div></div></div>`:''} 
${isFailed?`<div style="padding:0 24px 20px"><div style="padding:12px 16px;background:var(--rd-bg);border:1px solid rgba(248,113,113,.12);border-radius:var(--r2);font-size:.86rem"><strong style="color:var(--rd)">Breach:</strong> <span style="color:var(--t2)">${c.breach_reason||'Rule violation'}</span></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary btn-sm" onclick="navigate('buy')">New Challenge</button><button class="btn btn-outline btn-sm" onclick="resetChallenge('${c.id}')">Reset Account (10% off)</button></div></div>`:''}${isPassed?`<div style="padding:0 24px 20px"><div style="padding:12px 16px;background:var(--gr-bg);border:1px solid rgba(52,211,153,.12);border-radius:var(--r2);font-size:.86rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><span style="color:var(--gr);font-weight:600">&#10004; Evaluation Passed</span><button class="btn btn-outline btn-sm" onclick="showCertificate('pass',{name:'${(user?.first_name||'')+' '+(user?.last_name||'')}',size:'${F(c.account_size)}',type:'${c.challenge_type==='two_step'?'2-Step':'1-Step'}',date:'${c.passed_at?new Date(c.passed_at).toLocaleDateString():new Date(c.created_at).toLocaleDateString()}',id:'${c.id.slice(0,8).toUpperCase()}'})">View Certificate</button></div></div>`:''}\n${isActive||isPassed?`\n<div style="padding:0 24px 20px">\n  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">\n    <div style="background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2);padding:14px">\n      <div style="font-size:.62rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Balance / Equity Curve</div>\n      <div id="bchart-${c.id}" style="width:100%;height:90px"></div>\n    </div>\n    <div style="background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2);padding:14px">\n      <div style="font-size:.62rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Daily P&amp;L Calendar</div>\n      <div id="pcal-${c.id}" style="width:100%;min-height:90px;font-size:.58rem"></div>\n    </div>\n  </div>\n</div>`:''}\n</div>`}).join('')}`;
  // Post-render: draw charts for each active challenge
  d.forEach(c => {
    if (c.status === 'active' || c.status === 'passed') {
      drawBalanceChart(c.id, c.starting_balance, c.starting_balance * (1 + c.profit_target_pct / 100), c.starting_balance * (1 - c.max_total_loss_pct / 100));
      drawDailyCalendar(c.id);
    }
  });
};

// FUNDED
window.render_funded=async function(){$('page-funded').innerHTML=LOADING;const d=await api('/api/funded');if(!d.length){$('page-funded').innerHTML=`<div class="page-head"><h1>Funded Accounts</h1><p>Your funded trading accounts</p></div><div class="card" style="text-align:center;padding:52px"><div style="font-size:1.6rem;margin-bottom:12px">&#128176;</div><div style="font-weight:700;margin-bottom:6px">No funded accounts</div><div style="color:var(--t2);font-size:.86rem;margin-bottom:18px">Pass an evaluation to get funded.</div><button class="btn btn-primary btn-sm" onclick="navigate('buy')">Start Challenge</button></div>`;return}
$('page-funded').innerHTML=`<div class="page-head"><h1>Funded Accounts</h1><p>Your active funded accounts</p></div>${d.map(a=>{const profit=a.current_balance-a.starting_balance;return`<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px"><div style="padding:20px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd)"><div style="font-size:1.1rem;font-weight:700">${F(a.account_size)} Funded</div>${B(a.status)}</div><div style="padding:24px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:20px">${M('Balance',F(a.current_balance))}${M('Profit',F(profit),profit>=0?'var(--gr)':'var(--rd)')}${M('Split',a.profit_split_pct+'%','var(--ac2)')}${M('Payouts',F(a.total_payouts),'var(--gr)')}</div>${R('Login (email)',a.ctrader_login||usr?.email||'—','var(--ac2)')}${R('Total Trades',a.total_trades||0)}${R('Payout Count',a.payout_count||0)}<button class="btn btn-primary btn-full" style="margin-top:20px" onclick="showPayoutModal('${a.id}')">Request Payout</button></div></div>`}).join('')}`;};

// BUY
window.render_buy=async function(){
const sz=window._buySize||100000;
const tp=window._buyType||'one_step';
$('page-buy').innerHTML=`<div class="page-head"><h1>New Challenge</h1><p>Configure your evaluation and start trading</p></div>
<div style="display:grid;grid-template-columns:1fr 380px;gap:24px;align-items:start">
<div>

<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Challenge Type</div>
<div style="padding:14px 20px;font-size:.82rem;color:var(--t3);margin-bottom:-4px">Choose the type of challenge you want to take</div>
<div style="padding:0 20px 20px;display:grid;grid-template-columns:1fr 1fr;gap:10px" id="buyTypeGrid"></div>
</div>

<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Account Size</div>
<div style="padding:14px 20px;font-size:.82rem;color:var(--t3);margin-bottom:-4px">Choose your preferred account size</div>
<div style="padding:0 20px 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px" id="buySizeGrid"></div>
</div>

<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Trading Platform</div>
<div style="padding:14px 20px;font-size:.82rem;color:var(--t3);margin-bottom:-4px">Choose your preferred trading platform</div>
<div style="padding:0 20px 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px" id="buyPlatGrid"></div>
</div>

<div class="card" style="padding:0;overflow:hidden">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);display:flex;align-items:center;gap:10px"><div style="width:28px;height:28px;border-radius:8px;background:var(--ac-bg);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#9881;</div><div><div style="font-family:var(--fd);font-weight:600;font-size:.95rem">Trading Rules</div><div style="font-size:.78rem;color:var(--t3)">Rules for your selected configuration</div></div></div>
<div style="padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px" id="buyRulesGrid"></div>
</div>

</div>
<div style="position:sticky;top:20px">

<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Coupon Code</div>
<div style="padding:14px 20px;display:flex;gap:8px;align-items:center"><input id="discountInput" placeholder="Enter coupon code" style="flex:1;padding:10px 14px;background:var(--bg);border:1px solid var(--brd2);border-radius:var(--r);color:var(--t1);font-family:var(--ff);font-size:.84rem"><button class="btn btn-outline btn-sm" onclick="validateCode();updateOrderSummary()">Apply</button></div>
<div id="discountStatus" style="padding:0 20px 14px;font-size:.8rem"></div>
</div>

<div class="card" style="padding:0;overflow:hidden;border-color:var(--ac-gl);margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Order Summary</div>
<div id="orderSummary" style="padding:16px 20px"></div>
</div>

<div class="card" style="padding:16px 20px;margin-bottom:16px">
<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:.78rem;color:var(--t2);line-height:1.55"><input type="checkbox" id="buyTerms" style="margin-top:3px;accent-color:var(--ac)"><span>I agree with the <a href="#" style="color:var(--ac2)" onclick="event.preventDefault();navigate('rules')">Terms of Use</a>, <a href="#" style="color:var(--ac2)" onclick="event.preventDefault()">Terms &amp; Conditions</a>, and confirm that all information provided is correct. I confirm I am not a U.S. citizen or resident.</span></label>
</div>

<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
<div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-family:var(--fd);font-weight:600;font-size:.95rem">Payment Method</div>
<div style="padding:14px 20px;display:flex;flex-direction:column;gap:8px" id="buyPayGrid"></div>
</div>

<button class="btn btn-primary btn-full" style="padding:16px;font-size:.95rem" onclick="submitChallengePurchase()">Continue to Payment</button>

</div>
</div>`;
renderBuySelectors();
};

// === CONFIGURATOR STATE ===
window._buySize=window._buySize||100000;
window._buyType=window._buyType||'one_step';
window._buyPay=window._buyPay||'crypto';
let activeDiscount=null;
let selectedPlatform='plutotrade';
window.PLATFORMS=[
  {id:'plutotrade',name:'PlutoTrader',status:'available',surcharge:0},
  {id:'plutotrade',name:'PlutoTrader',status:'active',surcharge:0},
];

function renderBuySelectors(){
  // Type
  const types=[{id:'one_step',label:'One Step',desc:'Single phase evaluation'},{id:'two_step',label:'Two Step',desc:'Two phase evaluation'}];
  $('buyTypeGrid').innerHTML=types.map(t=>{
    const sel=window._buyType===t.id;
    return`<div onclick="window._buyType='${t.id}';renderBuySelectors()" style="padding:14px 16px;border-radius:var(--r2);border:1.5px solid ${sel?'var(--ac2)':'var(--brd2)'};background:${sel?'var(--ac-bg)':'var(--bg)'};cursor:pointer;transition:.15s"><div style="display:flex;align-items:center;gap:10px"><div style="width:18px;height:18px;border-radius:50%;border:2px solid ${sel?'var(--ac2)':'var(--brd3)'};display:flex;align-items:center;justify-content:center">${sel?'<div style="width:8px;height:8px;border-radius:50%;background:var(--ac2)"></div>':''}</div><div><div style="font-weight:600;font-size:.88rem">${t.label}</div><div style="font-size:.74rem;color:var(--t3)">${t.desc}</div></div></div></div>`;
  }).join('');

  // Sizes
  const sizes=[5000,10000,25000,50000,100000,200000];
  $('buySizeGrid').innerHTML=sizes.map(s=>{
    const sel=window._buySize===s;
    return`<div onclick="window._buySize=${s};renderBuySelectors()" style="padding:12px 14px;border-radius:var(--r2);border:1.5px solid ${sel?'var(--ac2)':'var(--brd2)'};background:${sel?'var(--ac-bg)':'var(--bg)'};cursor:pointer;transition:.15s;text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:8px"><div style="width:16px;height:16px;border-radius:50%;border:2px solid ${sel?'var(--ac2)':'var(--brd3)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">${sel?'<div style="width:7px;height:7px;border-radius:50%;background:var(--ac2)"></div>':''}</div><span style="font-family:var(--fd);font-weight:600;font-size:.92rem">${F(s)}</span></div></div>`;
  }).join('');

  // Platform
  $('buyPlatGrid').innerHTML=PLATFORMS.map(p=>{
    const sel=selectedPlatform===p.id;
    const dis=p.status==='coming_soon';
    const click=dis?'':('selectPlatform(&quot;'+p.id+'&quot;)');
    return'<div onclick="'+click+'" style="padding:12px 14px;border-radius:var(--r2);border:1.5px solid '+(sel?'var(--ac2)':'var(--brd2)')+';background:'+(sel?'var(--ac-bg)':dis?'rgba(255,255,255,.015)':'var(--bg)')+';cursor:'+(dis?'not-allowed':'pointer')+';opacity:'+(dis?'.45':'1')+';transition:.15s;text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:8px"><div style="width:16px;height:16px;border-radius:50%;border:2px solid '+(sel?'var(--ac2)':'var(--brd3)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(sel?'<div style="width:7px;height:7px;border-radius:50%;background:var(--ac2)"></div>':'')+'</div><span style="font-weight:600;font-size:.86rem">'+p.name+'</span></div>'+(p.surcharge?'<div style="font-size:.7rem;color:var(--am);margin-top:4px">+'+F(p.surcharge)+'</div>':'')+(dis?'<div style="font-size:.62rem;color:var(--t3);margin-top:4px;text-transform:uppercase;letter-spacing:.1em">Coming Soon</div>':'')+'</div>';
  }).join('');

  // Rules
  const plan=PLANS[window._buyType].find(p=>p.size===window._buySize)||PLANS[window._buyType][4];
  const ruleItem=(icon,label,value)=>`<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r)"><div style="font-size:.68rem;color:var(--t3);margin-bottom:3px">${icon} ${label}</div><div style="font-weight:600;font-size:.88rem;font-family:var(--fd)">${value}</div></div>`;
  $('buyRulesGrid').innerHTML=
    ruleItem('&#127919;','Profit Target',plan.target+'%')+
    ruleItem('&#128200;','Max Daily Loss',plan.daily+'%')+
    ruleItem('&#128201;','Max Drawdown',plan.dd+'%')+
    ruleItem('&#128176;','Profit Split',plan.split+'%')+
    ruleItem('&#9878;','Leverage',plan.lev)+
    ruleItem('&#128338;','Time Limit','Unlimited');

  // Payment
  const pays=[{id:'crypto',label:'Cryptocurrency',icon:'&#8383;',sub:'BTC, USDT, ETH, LTC & more'},{id:'card',label:'Credit / Debit Card',icon:'&#128179;',sub:'Visa, Mastercard',dis:true}];
  $('buyPayGrid').innerHTML=pays.map(p=>{
    const sel=window._buyPay===p.id;
    const click=p.dis?'':('setBuyPay(&quot;'+p.id+'&quot;)');
    return'<div onclick="'+click+'" style="padding:12px 16px;border-radius:var(--r2);border:1.5px solid '+(sel?'var(--ac2)':'var(--brd2)')+';background:'+(sel?'var(--ac-bg)':'var(--bg)')+';cursor:'+(p.dis?'not-allowed':'pointer')+';opacity:'+(p.dis?'.4':'1')+';transition:.15s;display:flex;align-items:center;gap:12px"><div style="width:16px;height:16px;border-radius:50%;border:2px solid '+(sel?'var(--ac2)':'var(--brd3)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(sel?'<div style="width:7px;height:7px;border-radius:50%;background:var(--ac2)"></div>':'')+'</div><div style="flex:1"><div style="font-weight:600;font-size:.86rem">'+p.label+'</div><div style="font-size:.72rem;color:var(--t3)">'+p.sub+'</div></div><div style="font-size:1.2rem">'+p.icon+'</div>'+(p.dis?'<div style="font-size:.6rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em">Soon</div>':'')+'</div>';
  }).join('');

  updateOrderSummary();
}

function updateOrderSummary(){
  const plan=PLANS[window._buyType].find(p=>p.size===window._buySize)||PLANS[window._buyType][4];
  let fee=plan.fee;
  if(window._buyType==='two_step')fee=Math.round(fee*0.8);
  const platSurcharge=(PLATFORMS.find(p=>p.id===selectedPlatform)||{}).surcharge||0;
  fee+=platSurcharge;
  let discount=0;
  if(activeDiscount)discount=Math.round(fee*activeDiscount.discount_pct/100);
  const total=fee-discount;
  const typeLabel=window._buyType==='two_step'?'Two Step':'One Step';
  const platLabel='PlutoTrader';
  const el=$('orderSummary');if(!el)return;
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--brd)">
      <div><div style="font-weight:600;font-size:.88rem">${F(window._buySize)} — ${typeLabel}</div><div style="font-size:.74rem;color:var(--t3);margin-top:3px">Platform: ${platLabel}</div></div>
      <div style="font-family:var(--fd);font-weight:600;font-size:.92rem">${F(fee+discount)}</div>
    </div>
    ${discount?`<div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:.84rem"><span style="color:var(--gr)">Coupon discount (${activeDiscount.discount_pct}%)</span><span style="color:var(--gr);font-weight:600">-${F(discount)}</span></div>`:''}
    ${platSurcharge?`<div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:.84rem"><span>Platform fee</span><span style="font-weight:600">+${F(platSurcharge)}</span></div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid var(--brd)">
      <span style="font-weight:600;font-size:.92rem">Total</span>
      <span style="font-family:var(--fd);font-weight:600;font-size:1.5rem;color:var(--t1)">${F(total)}</span>
    </div>`;
}

async function submitChallengePurchase(){
  if(!token){showAuth('register');return}
  if(!$('buyTerms')?.checked){toast('Please accept the terms to continue','error');return}
  const plan=PLANS[window._buyType].find(p=>p.size===window._buySize);
  if(!plan){toast('Select an account size','error');return}
  try{
    const body={account_size:window._buySize,challenge_type:window._buyType,payment_method:window._buyPay,platform:selectedPlatform};
    if(activeDiscount)body.discount_code=activeDiscount.code;
    const d=await api('/api/challenges/purchase',{method:'POST',body:JSON.stringify(body)});
    if(d.payment_url){window.location.href=d.payment_url}
    else{toast('Challenge activated!','success');navigate('challenges')}
  }catch(x){toast(x.message,'error')}
}
window.switchBuyEval=function(){};
window.renderPlatformSelector=function(){};
window.selectPlatform=function(id){selectedPlatform=id;renderBuySelectors();};
window.setBuyPay=function(id){window._buyPay=id;renderBuySelectors();};
async function validateCode(){const code=$('discountInput')?.value?.trim();if(!code){toast('Enter a code','info');return}try{const d=await api('/api/challenges/validate-code?code='+encodeURIComponent(code));if(d.valid){activeDiscount=d;$('discountStatus').innerHTML=`<span style="color:var(--gr)">&#10004; ${d.code}: ${d.discount_pct}% off</span>`;toast(d.discount_pct+'% discount applied!','success')}else{activeDiscount=null;$('discountStatus').innerHTML=`<span style="color:var(--rd)">&#10006; ${d.error||'Invalid code'}</span>`}}catch(x){toast(x.message,'error')}updateOrderSummary()}

// PAYOUT MODAL
function showPayoutModal(id){const m=document.createElement("div");m.className="modal-bg";m.id="payoutModal";m.innerHTML=`<div class="modal"><button class="modal-close" onclick="document.getElementById('payoutModal').remove()">&times;</button><div style="text-align:center;margin-bottom:20px"><div style="width:48px;height:48px;border-radius:12px;background:var(--gr-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:1.4rem">&#128179;</div><h2>Request Payout</h2><p style="color:var(--t2);font-size:.86rem">Choose method &amp; enter wallet</p></div><div style="padding:12px;background:var(--am-bg);border:1px solid rgba(251,191,36,.15);border-radius:var(--r2);margin-bottom:14px;font-size:.8rem;color:var(--t2);line-height:1.5"><strong style="color:var(--am)">Important:</strong> Close all positions first. Account goes view-only during processing. Balance resets after payout.</div><div class="field" style="margin-bottom:14px"><label style="font-size:.8rem;color:var(--t3);margin-bottom:4px;display:block">Wallet Address / Bank Details</label><input id="payoutWallet" placeholder="TRC-20 / ERC-20 address or bank IBAN" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--brd2);border-radius:var(--r);color:var(--t1);font-family:var(--fm);font-size:.82rem"></div><div style="display:flex;flex-direction:column;gap:10px"><button class="btn btn-primary btn-full" onclick="submitPayout('${id}','crypto_usdt')">USDT (TRC-20)</button><button class="btn btn-primary btn-full" onclick="submitPayout('${id}','crypto_usdc')">USDC (ERC-20)</button><button class="btn btn-outline btn-full" onclick="submitPayout('${id}','bank_transfer')">Bank Transfer</button></div></div>`;document.body.appendChild(m)}
async function submitPayout(id,method){const wallet=$("payoutWallet")?.value||"";document.getElementById("payoutModal")?.remove();try{const d=await api("/api/payouts/request",{method:"POST",body:JSON.stringify({funded_account_id:id,payout_method:method,wallet_address:wallet})});toast("Payout requested: "+F(d.trader_amount),"success");navigate("payouts")}catch(x){toast(x.message,"error")}}

// PAYOUTS
window.render_payouts=async function(){$('page-payouts').innerHTML=LOADING;const d=await api('/api/payouts');const paid=d.filter(p=>p.status==='paid').reduce((s,p)=>s+p.trader_amount,0);const pending=d.filter(p=>['requested','approved','processing'].includes(p.status)).reduce((s,p)=>s+p.trader_amount,0);
$('page-payouts').innerHTML=`<div class="page-head"><h1>Payouts</h1><p>Withdrawal history and pending requests</p></div><div class="stats"><div class="stat s-green"><div class="stat-label">Total Received</div><div class="stat-value" style="color:var(--gr)">${F(paid)}</div></div><div class="stat s-purple"><div class="stat-label">Pending</div><div class="stat-value">${F(pending)}</div></div><div class="stat s-blue"><div class="stat-label">Count</div><div class="stat-value">${d.filter(p=>p.status==='paid').length}</div></div></div><div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem">History</div>${d.length?`<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Gross</th><th>Split</th><th>Payout</th><th>Method</th><th>Status</th></tr></thead><tbody>${d.map(p=>`<tr><td>${new Date(p.requested_at).toLocaleDateString()}</td><td class="mono">${F(p.gross_profit)}</td><td>${p.split_pct}%</td><td class="pos" style="font-weight:700">${F(p.trader_amount)}</td><td style="font-size:.78rem">${(p.payout_method||'').replace(/_/g,' ').toUpperCase()}</td><td>${B(p.status)}</td></tr>`).join('')}</tbody></table></div>`:`<div style="padding:48px;text-align:center;color:var(--t3);font-size:.88rem">No payouts yet.</div>`}</div>`};

// TRADES
window.render_trades=async function(){$('page-trades').innerHTML=LOADING;const d=await api('/api/trades');const totalPnl=d.reduce((s,t)=>s+t.profit,0);const wins=d.filter(t=>t.profit>0).length;
$('page-trades').innerHTML=`<div class="page-head"><h1>Trade History</h1><p>Closed positions across all accounts</p></div>${d.length?`<div class="stats"><div class="stat s-green"><div class="stat-label">Total P&L</div><div class="stat-value" style="color:${totalPnl>=0?'var(--gr)':'var(--rd)'}">${F(totalPnl)}</div></div><div class="stat s-blue"><div class="stat-label">Trades</div><div class="stat-value">${d.length}</div></div><div class="stat s-purple"><div class="stat-label">Win Rate</div><div class="stat-value">${Math.round(wins/d.length*100)}%</div></div></div>`:''}<div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem">Closed Positions</div>${d.length?`<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Symbol</th><th>Dir</th><th>Vol</th><th>Open</th><th>Close</th><th>P&L</th><th>Time</th></tr></thead><tbody>${d.map(t=>`<tr><td class="fw">${t.symbol}</td><td>${B(t.direction==='BUY'?'active':'failed')}</td><td class="mono">${t.volume}</td><td class="mono">${t.open_price?.toFixed(5)||'—'}</td><td class="mono">${t.close_price?.toFixed(5)||'—'}</td><td class="${t.profit>=0?'pos':'neg'}" style="font-weight:700">${F(t.profit)}</td><td class="muted" style="font-size:.74rem;white-space:nowrap">${t.close_time?new Date(t.close_time).toLocaleString():'—'}</td></tr>`).join('')}</tbody></table></div>`:`<div style="padding:48px;text-align:center;color:var(--t3);font-size:.88rem">No trades yet.</div>`}</div>`};

// AI COACH
window.render_coach=async function(){$('page-coach').innerHTML=LOADING;
try{
  const s=await api('/api/dashboard/stats');
  const trades=await api('/api/trades');
  const ch=s.challenges.filter(c=>c.status==='active'||c.status==='passed'||c.status==='failed');
  const hasTrades=trades.length>0;
  const wins=trades.filter(t=>t.profit>0);
  const losses=trades.filter(t=>t.profit<=0);
  const wr=trades.length?Math.round(wins.length/trades.length*100):0;
  const avgWin=wins.length?(wins.reduce((a,t)=>a+t.profit,0)/wins.length):0;
  const avgLoss=losses.length?Math.abs(losses.reduce((a,t)=>a+t.profit,0)/losses.length):0;
  const pf=avgLoss>0?(avgWin*wins.length)/(avgLoss*losses.length):0;
  const totalPnl=trades.reduce((a,t)=>a+t.profit,0);

  // Calculate AI scores
  const consistencyScore=hasTrades?Math.min(100,Math.round(wr*0.5+(pf>1?30:pf*30)+(trades.length>10?20:trades.length*2))):0;
  const riskScore=hasTrades?Math.min(100,Math.round((avgLoss<avgWin?40:20)+(wr>50?30:wr*0.6)+(pf>1.5?30:pf*20))):0;
  const edgeScore=hasTrades?Math.min(100,Math.round(pf*25+(wr>55?30:wr*0.55)+(trades.length>20?20:trades.length))):0;
  const slScore=hasTrades?Math.min(100,Math.round(trades.filter(t=>t.stop_loss).length/Math.max(1,trades.length)*80+(pf>1?20:10))):0;
  const aiScore=hasTrades?Math.round((consistencyScore+riskScore+edgeScore)/3):0;

  // Find best/worst symbols
  const symbolMap={};
  trades.forEach(t=>{if(!symbolMap[t.symbol])symbolMap[t.symbol]={wins:0,losses:0,pnl:0,count:0};symbolMap[t.symbol].count++;symbolMap[t.symbol].pnl+=t.profit;if(t.profit>0)symbolMap[t.symbol].wins++;else symbolMap[t.symbol].losses++});
  const symbols=Object.entries(symbolMap).sort((a,b)=>b[1].pnl-a[1].pnl);
  const bestSymbol=symbols[0];
  const worstSymbol=symbols[symbols.length-1];

  function scoreColor(v){return v>=70?'var(--gr)':v>=40?'var(--am)':'var(--rd)'}

  $('page-coach').innerHTML=`<div class="page-head"><h1>AI Trade Coach</h1><p>${hasTrades?'Analysis based on '+trades.length+' closed trade'+(trades.length>1?'s':''):'Start trading to unlock AI insights'}</p></div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px">
  <div class="stat s-purple"><div class="stat-label">AI Score</div><div class="stat-value" style="color:${hasTrades?scoreColor(aiScore):'var(--t3)'}">${hasTrades?aiScore+'/100':'—'}</div></div>
  <div class="stat s-green"><div class="stat-label">Consistency</div><div class="stat-value" style="color:${hasTrades?scoreColor(consistencyScore):'var(--t3)'}">${hasTrades?consistencyScore+'/100':'—'}</div></div>
  <div class="stat s-blue"><div class="stat-label">Risk Rating</div><div class="stat-value" style="color:${hasTrades?scoreColor(riskScore):'var(--t3)'}">${hasTrades?riskScore+'/100':'—'}</div></div>
  <div class="stat s-amber"><div class="stat-label">Edge Score</div><div class="stat-value" style="color:${hasTrades?scoreColor(edgeScore):'var(--t3)'}">${hasTrades?edgeScore+'/100':'—'}</div></div>
</div>

${hasTrades?`<div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
  <div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem">Performance Summary</div>
  <div style="padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
    ${M('Win Rate',wr+'%',wr>=50?'var(--gr)':'var(--rd)')}
    ${M('Profit Factor',pf.toFixed(2),pf>=1?'var(--gr)':'var(--rd)')}
    ${M('Avg Win',F(avgWin),'var(--gr)')}
    ${M('Avg Loss',F(avgLoss),'var(--rd)')}
    ${M('Total P&L',F(totalPnl),totalPnl>=0?'var(--gr)':'var(--rd)')}
    ${M('Trades',String(trades.length))}
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem">&#128200; Instrument Analysis</div>
    <div style="padding:16px 20px">
      ${symbols.map(([sym,d])=>{const swr=d.count?Math.round(d.wins/d.count*100):0;return`<div class="row"><span class="row-label">${sym} <span style="color:var(--t3);font-size:.74rem">(${d.count} trades)</span></span><span class="row-value" style="color:${d.pnl>=0?'var(--gr)':'var(--rd)'}"> ${F(d.pnl)} &bull; ${swr}% WR</span></div>`}).join('')}
    </div>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem">&#127919; AI Insights</div>
    <div style="padding:16px 20px;font-size:.86rem;color:var(--t2);line-height:1.8">
      ${wr>=55?`<div style="padding:8px 12px;background:var(--gr-bg);border-left:3px solid var(--gr);border-radius:0 var(--r) var(--r) 0;margin-bottom:8px">Your ${wr}% win rate is strong. Maintain your edge by keeping position sizes consistent.</div>`:`<div style="padding:8px 12px;background:var(--rd-bg);border-left:3px solid var(--rd);border-radius:0 var(--r) var(--r) 0;margin-bottom:8px">Win rate at ${wr}%. Focus on entry quality over frequency.</div>`}
      ${pf>=1.2?`<div style="padding:8px 12px;background:var(--gr-bg);border-left:3px solid var(--gr);border-radius:0 var(--r) var(--r) 0;margin-bottom:8px">Profit factor of ${pf.toFixed(2)} shows your winners outpace your losers.</div>`:`<div style="padding:8px 12px;background:var(--am-bg);border-left:3px solid var(--am);border-radius:0 var(--r) var(--r) 0;margin-bottom:8px">Profit factor at ${pf.toFixed(2)}. Consider widening targets or tightening stops.</div>`}
      ${bestSymbol?`<div style="padding:8px 12px;background:var(--bl-bg);border-left:3px solid var(--bl);border-radius:0 var(--r) var(--r) 0;margin-bottom:8px">Best instrument: ${bestSymbol[0]} with ${F(bestSymbol[1].pnl)} profit. Consider allocating more size here.</div>`:''}
      ${worstSymbol&&worstSymbol[1].pnl<0?`<div style="padding:8px 12px;background:var(--rd-bg);border-left:3px solid var(--rd);border-radius:0 var(--r) var(--r) 0">Worst instrument: ${worstSymbol[0]} at ${F(worstSymbol[1].pnl)}. Review your setup criteria for this pair.</div>`:''}
    </div>
  </div>
</div>`:
`<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
  <div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem"><span>&#128200;</span> Entry &amp; Exit Analysis</div><div style="padding:16px 20px"><p style="color:var(--t2);font-size:.84rem;line-height:1.65;margin-bottom:14px">AI evaluates every entry and exit against optimal levels, support/resistance, and market structure.</p><div style="padding:12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--brd);border-left:3px solid var(--ac)"><div style="font-size:.66rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Sample</div><div style="font-size:.82rem;color:var(--t2);line-height:1.5">"EURUSD long entered 12 pips above support. Limit at 1.0842 improves R:R from 1.8 to 2.4."</div></div></div></div>
  <div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem"><span>&#128202;</span> Risk Management</div><div style="padding:16px 20px"><p style="color:var(--t2);font-size:.84rem;line-height:1.65;margin-bottom:14px">Real-time drawdown monitoring, position sizing analysis, and lot exposure tracking.</p><div style="padding:12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--brd);border-left:3px solid var(--rd)"><div style="font-size:.66rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Sample</div><div style="font-size:.82rem;color:var(--t2);line-height:1.5">"3.8% daily loss with 2 open. A 30-pip move triggers breach."</div></div></div></div>
  <div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem"><span>&#128337;</span> Pattern Detection</div><div style="padding:16px 20px"><p style="color:var(--t2);font-size:.84rem;line-height:1.65;margin-bottom:14px">Discover which sessions, pairs, and timeframes produce your best results.</p><div style="padding:12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--brd);border-left:3px solid var(--gr)"><div style="font-size:.66rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Sample</div><div style="font-size:.82rem;color:var(--t2);line-height:1.5">"78% win rate XAUUSD London vs 34% Asian. Avoid gold before 8:00 GMT."</div></div></div></div>
  <div class="card" style="padding:0;overflow:hidden"><div style="padding:16px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem"><span>&#127919;</span> Discipline Score</div><div style="padding:16px 20px"><p style="color:var(--t2);font-size:.84rem;line-height:1.65;margin-bottom:14px">Each session scored on sizing, compliance, consistency, and risk-adjusted return.</p><div style="padding:12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--brd);border-left:3px solid var(--am)"><div style="font-size:.66rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Sample</div><div style="font-size:.82rem;color:var(--t2);line-height:1.5">"Tuesday: 87/100. Strong entries. Deducted for holding through NFP."</div></div></div></div>
</div>`}

<div class="card" style="background:linear-gradient(135deg,rgba(139,92,246,.03),transparent);border-color:var(--ac-gl);display:flex;align-items:center;gap:20px;flex-wrap:wrap">
  <div style="width:48px;height:48px;border-radius:12px;background:var(--ac-bg);border:1px solid var(--ac-gl);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">&#129302;</div>
  <div style="flex:1;min-width:240px">
    <div style="font-weight:700;font-size:1rem;margin-bottom:4px">${hasTrades?'Coach is analyzing your trades':'Activating when you trade'}</div>
    <div style="color:var(--t2);font-size:.86rem;line-height:1.6">${hasTrades?'Insights update automatically as you close more trades. The more data, the better the analysis.':'Start a challenge and place your first trades — insights generated within 24 hours.'}</div>
  </div>
  ${hasTrades?'':`<button class="btn btn-primary btn-sm" onclick="navigate('buy')" style="flex-shrink:0">Start Challenge</button>`}
</div>
${hasTrades?`<div style="display:grid;grid-template-columns:auto 1fr;gap:14px;margin-top:4px;align-items:start">
  <div class="card" style="padding:16px 20px;width:220px">
    <div style="font-size:.62rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">🎯 Trader Score Radar</div>
    <div id="radarChart"></div>
  </div>
  <div class="card" style="padding:16px 20px">
    <div style="font-size:.62rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px">📊 Score Breakdown</div>
    <div id="scoreBreakdown"></div>
  </div>
</div>`:''}`;
  if(hasTrades) setTimeout(()=>drawRadarChart(aiScore,wr,pf,consistencyScore,riskScore,slScore),50);
}catch(e){$('page-coach').innerHTML=`<div class="card"><div class="empty">Failed to load AI Coach. <a onclick="navigate('coach')">Retry</a></div></div>`}};

// RULES
window.render_rules=function(){$('page-rules').innerHTML=`<div class="page-head"><h1>Trading Rules</h1><p>Complete rules for all accounts</p></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem;background:linear-gradient(135deg,rgba(139,92,246,.04),transparent)">1-Step Evaluation</div><div style="padding:16px 20px">${R('Profit Target','10%')}${R('Max Daily Loss','5%')}${R('Max Drawdown','8% static')}${R('Profit Split','80%')}${R('Leverage','1:30')}${R('Time Limit','Unlimited','var(--gr)')}${R('Min Days','None','var(--gr)')}</div></div>
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem;background:linear-gradient(135deg,rgba(96,165,250,.04),transparent)">2-Step Evaluation</div><div style="padding:16px 20px">${R('Phase 1 Target','8%')}${R('Phase 2 Target','5%')}${R('Max Daily Loss','5%')}${R('Max Drawdown','10% static')}${R('Profit Split','80%')}${R('Leverage','1:30')}${R('Time Limit','Unlimited','var(--gr)')}</div></div></div>
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem">General Rules</div><div style="padding:16px 20px">${R('Consistency','No single day > 20% of total profit')}${R('News Trading','Close 2 min before/after','var(--rd)')}${R('Weekend (Eval)','Holding allowed','var(--gr)')}${R('Weekend (Funded)','Close by 3:45 PM EST Fri','var(--rd)')}${R('Min Trade Duration','2-min average')}${R('Inactivity','30 days = closed','var(--rd)')}${R('EAs','Allowed (no HFT)','var(--gr)')}${R('Copy (Own)','Allowed','var(--gr)')}${R('Copy (External)','Prohibited','var(--rd)')}${R('Hedge (Same Acct)','Allowed','var(--gr)')}${R('Hedge (Cross-Acct)','Prohibited','var(--rd)')}${R('KYC','Before funded account')}${R('Swap Fees','None — swap-free','var(--gr)')}${R('Min Payout','$50')}</div></div>
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.95rem">Max Lot Exposure</div><div style="padding:16px 20px">${R('$5K','2 lots')}${R('$10K','4 lots')}${R('$25K','10 lots')}${R('$50K','20 lots')}${R('$100K','40 lots')}${R('$200K','80 lots')}</div></div>
<div class="card" style="padding:0;overflow:hidden;border-color:rgba(248,113,113,.12)"><div style="padding:14px 20px;border-bottom:1px solid rgba(248,113,113,.12);font-weight:700;font-size:.95rem;color:var(--rd);background:linear-gradient(135deg,rgba(248,113,113,.04),transparent)">Prohibited</div><div style="padding:16px 20px;color:var(--t2);font-size:.86rem;line-height:2"><div>&#10006; Arbitrage, latency exploitation, tick scalping</div><div>&#10006; HFT</div><div>&#10006; External copy trading</div><div>&#10006; Account sharing</div><div>&#10006; Cross-account hedging</div><div>&#10006; Gambling behavior</div><div>&#10006; News trading in restricted windows</div><div>&#10006; Environment exploitation</div><div>&#10006; VPN circumvention</div></div></div>
<div style="padding:14px 20px;background:var(--sf);border:1px solid var(--brd);border-radius:var(--r2);margin-top:14px;font-size:.84rem;color:var(--t2)">Violations result in immediate termination. Contact <a href="mailto:support@plutocapitalfunding.com" style="color:var(--ac2)">support@plutocapitalfunding.com</a></div>
`};

// PROFILE
window.render_profile=async function(){$('page-profile').innerHTML=LOADING;const u=await api('/api/users/profile');
$('page-profile').innerHTML=`<div class="page-head"><h1>Profile</h1><p>Account settings</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:720px">
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem">Personal Info</div><div style="padding:20px"><form onsubmit="saveProfile(event)"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>First Name</label><input id="pF" value="${u.first_name||''}"></div><div class="field"><label>Last Name</label><input id="pL" value="${u.last_name||''}"></div></div><div class="field" style="margin-top:12px"><label>Email</label><input value="${u.email}" disabled></div><div class="field" style="margin-top:12px"><label>Phone</label><input id="pPh" value="${u.phone||''}"></div><div class="field" style="margin-top:12px"><label>Country</label><input id="pCo" value="${u.country||''}"></div><button type="submit" class="btn btn-primary btn-full" style="margin-top:18px">Save Changes</button></form></div></div>
<div><div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700;font-size:.92rem">Account</div><div style="padding:16px 20px">${R('Email',u.email)}${R('Role',u.role)}${R('KYC',u.kyc_status)}${R('Referral',u.affiliate_code||'—')}${R('Since',new Date(u.created_at).toLocaleDateString())}</div></div></div></div>`};
async function saveProfile(e){e.preventDefault();try{await api('/api/users/profile',{method:'PUT',body:JSON.stringify({first_name:$('pF').value,last_name:$('pL').value,phone:$('pPh').value,country:$('pCo').value})});toast('Saved','success')}catch(x){toast(x.message,'error')}}

// ADMIN
let adminTab='overview';
window.render_admin=async function(){$('page-admin').innerHTML=LOADING;try{
const o=await api('/api/admin/overview');const u=await api('/api/admin/users');const p=await api('/api/admin/payouts');
let codes=[];try{codes=await api('/api/admin/discount-codes')}catch(e){}
let settings={};try{settings=await api('/api/admin/settings')}catch(e){}
const demoOn=settings.demo_mode==='true';
const tb=(id,label)=>`<button class="eval-tab ${adminTab===id?'active':''}" onclick="adminTab='${id}';render_admin()">${label}</button>`;
$('page-admin').innerHTML=`<div class="page-head" style="display:flex;align-items:center;justify-content:space-between"><div><h1>Admin Panel</h1><p>Platform management</p></div><a href="/pluto-admin.html" target="_blank" style="display:flex;align-items:center;gap:7px;padding:8px 16px;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;border-radius:var(--r2);font-size:.76rem;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(139,92,246,.3)">🚀 Open PlutoAdmin Dashboard →</a></div>
<div class="card" style="padding:14px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px"><div style="display:flex;align-items:center;gap:10px"><div style="width:10px;height:10px;border-radius:50%;background:${demoOn?'var(--gr)':'var(--rd)'};box-shadow:0 0 8px ${demoOn?'rgba(52,211,153,.5)':'rgba(248,113,113,.3)'}"></div><span style="font-weight:700;font-size:.9rem">${demoOn?'Demo Mode ON':'Demo Mode OFF'}</span><span style="font-size:.74rem;color:var(--t3)">${demoOn?'Purchases skip payment — PlutoTrader accounts created instantly':'Payments required via NOWPayments'}</span></div><button class="btn ${demoOn?'btn-danger':'btn-primary'} btn-sm" onclick="toggleDemo(${demoOn?'false':'true'})">${demoOn?'Disable Demo':'Enable Demo'}</button></div>
<div class="stats"><div class="stat s-purple"><div class="stat-label">Revenue</div><div class="stat-value">${F(o.total_revenue)}</div></div><div class="stat s-green"><div class="stat-label">Payouts</div><div class="stat-value">${F(o.total_payouts)}</div></div><div class="stat s-blue"><div class="stat-label">Net</div><div class="stat-value">${F(o.net_revenue)}</div></div><div class="stat s-cyan"><div class="stat-label">Reserve</div><div class="stat-value">${o.reserve_health}%</div></div><div class="stat s-amber"><div class="stat-label">Users</div><div class="stat-value">${o.total_users}</div></div><div class="stat s-green"><div class="stat-label">Active</div><div class="stat-value">${o.active_challenges}</div></div><div class="stat s-blue"><div class="stat-label">Funded</div><div class="stat-value">${o.total_funded}</div></div><div class="stat s-red"><div class="stat-label">Pending</div><div class="stat-value">${o.pending_payouts}</div></div></div>
<div class="eval-tabs" style="width:100%;margin-bottom:20px">${tb('overview','Payouts')}${tb('users','Users')}${tb('codes','Promo Codes')}${tb('terminal','PlutoTrader')}${tb('log','Audit Log')}</div>
${adminTab==='overview'?`<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Payout Queue</div>${p.length?'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Trader</th><th>Amount</th><th>Method</th><th>Wallet</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+p.map(x=>'<tr><td>'+x.first_name+' '+x.last_name+'<br><span class="muted" style="font-size:.68rem">'+x.email+'</span></td><td class="pos" style="font-weight:700">'+F(x.trader_amount)+'</td><td style="font-size:.78rem">'+(x.payout_method||'').replace(/_/g,' ').toUpperCase()+'</td><td style="font-size:.7rem;font-family:var(--fm);max-width:160px;word-break:break-all">'+(x.wallet_address||'\u2014')+'</td><td>'+B(x.status)+'</td><td>'+(x.status==='requested'?'<button class="btn btn-primary btn-sm" onclick="admPay(\''+x.id+'\',\'approve\')">Approve</button> <button class="btn btn-danger btn-sm" onclick="admPay(\''+x.id+'\',\'reject\')">Reject</button>':x.status==='approved'?'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input id="tx_'+x.id+'" placeholder="TX hash" style="width:130px;padding:5px 8px;background:var(--bg);border:1px solid var(--brd2);border-radius:var(--r);color:var(--t1);font-family:var(--fm);font-size:.72rem"><button class="btn btn-primary btn-sm" onclick="admPayTx(\''+x.id+'\')">Paid</button></div>':x.status==='paid'?'<span class="muted" style="font-size:.7rem">'+(x.tx_reference||'\u2014')+'</span>':'\u2014')+'</td></tr>').join('')+'</tbody></table></div>':'<div style="padding:32px;text-align:center;color:var(--t3)">No payout requests</div>'}</div>`:''}
${adminTab==='users'?`<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Users (${u.length})</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>KYC</th><th>Terms</th><th>Country</th><th>Joined</th><th>Actions</th></tr></thead><tbody>${u.map(x=>`<tr><td class="fw">${x.first_name} ${x.last_name}</td><td style="font-size:.78rem">${x.email}</td><td>${B(x.kyc_status)}</td><td style="font-size:.72rem">${x.terms_accepted_at?'<span style="color:var(--gr)">&#10004;</span>':'<span style="color:var(--rd)">&#10006;</span>'}</td><td>${x.country||'\u2014'}</td><td style="font-size:.74rem">${x.created_at?new Date(x.created_at).toLocaleDateString():'\u2014'}</td><td style="white-space:nowrap">${x.kyc_status!=='approved'?`<button class="btn btn-primary btn-sm" onclick="admAction('users/${x.id}/kyc-approve','KYC approved')">KYC</button> `:''}${x.is_active!==0&&x.is_active!=='0'?`<button class="btn btn-danger btn-sm" onclick="admAction('users/${x.id}/suspend','Suspended')">Ban</button>`:`<button class="btn btn-primary btn-sm" onclick="admAction('users/${x.id}/activate','Activated')">Unban</button>`}</td></tr>`).join('')}</tbody></table></div></div>`:''}
${adminTab==='codes'?`<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">Promo Codes</span><button class="btn btn-primary btn-sm" onclick="showCreateCodeModal()">+ New Code</button></div>${codes.length?'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Max</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>'+codes.map(c=>'<tr><td class="fw" style="font-family:var(--fm)">'+c.code+'</td><td style="color:var(--gr);font-weight:700">'+c.discount_pct+'%</td><td>'+c.current_uses+'</td><td>'+(c.max_uses||'\u221E')+'</td><td style="font-size:.74rem">'+(c.valid_until||'Never')+'</td><td>'+(c.is_active?'<span style="color:var(--gr)">Active</span>':'<span style="color:var(--rd)">Off</span>')+'</td><td>'+(c.is_active?'<button class="btn btn-danger btn-sm" onclick="admDelCode(\''+c.id+'\')">Disable</button>':'')+'</td></tr>').join('')+'</tbody></table></div>':'<div style="padding:32px;text-align:center;color:var(--t3)">No codes yet</div>'}</div>`:''}
${adminTab==='terminal'?`<div id="ctraderBox"><div class="alert alert-info" style="margin-bottom:0">PlutoTrader is the platform. No external terminal connection required.</div></div>`:''}
${adminTab==='log'?`<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Audit Log</div><div id="auditBox">Loading...</div></div>`:''}`;
if(adminTab==='terminal'){
  try{
    const st={connected:true,accountCount:0,version:'PlutoTrader v1'};
    const dot=(ok)=>'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(ok?'var(--gr)':'var(--rd)')+';box-shadow:0 0 12px '+(ok?'rgba(52,211,153,.5)':'rgba(248,113,113,.5)')+';margin-right:8px;vertical-align:middle"></span>';
    const row=(k,v,mono)=>'<div style="padding:10px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);font-size:.86rem"><span style="color:var(--t2)">'+k+'</span><span style="'+(mono?'font-family:var(--fm);':'')+'color:var(--t1);font-weight:600">'+v+'</span></div>';
    // ctraderBox cleared
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">'+
        '<div class="stat" style="background:'+(st.enabled?'var(--gr-bg)':'rgba(255,255,255,.03)')+';border:1px solid '+(st.enabled?'rgba(52,211,153,.15)':'var(--brd)')+'"><div class="stat-label">Integration</div><div class="stat-value" style="font-size:1.1rem;color:'+(st.enabled?'var(--gr)':'var(--t3)')+'">'+(st.enabled?'ENABLED':'SIMULATED')+'</div></div>'+
        '<div class="stat" style="background:'+(st.connected?'var(--gr-bg)':'var(--rd-bg)')+';border:1px solid '+(st.connected?'rgba(52,211,153,.15)':'rgba(248,113,113,.15)')+'"><div class="stat-label">TLS Connection</div><div class="stat-value" style="font-size:1.1rem;color:'+(st.connected?'var(--gr)':'var(--rd)')+'">'+dot(st.connected)+(st.connected?'ONLINE':'OFFLINE')+'</div></div>'+
        '<div class="stat" style="background:'+(st.authenticated?'var(--gr-bg)':'var(--rd-bg)')+';border:1px solid '+(st.authenticated?'rgba(52,211,153,.15)':'rgba(248,113,113,.15)')+'"><div class="stat-label">Authenticated</div><div class="stat-value" style="font-size:1.1rem;color:'+(st.authenticated?'var(--gr)':'var(--rd)')+'">'+dot(st.authenticated)+(st.authenticated?'YES':'NO')+'</div></div>'+
      '</div>'+

      '<div class="card" style="padding:0;overflow:hidden;margin-bottom:14px"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Connection Details</div>'+
        row('Host',st.host||'\u2014',true)+
        row('Manager ID',st.managerId||'\u2014',true)+
        row('Group ID',st.groupId||'<span style="color:var(--am)">Not configured</span>',true)+
        row('Plant','propsandbox',true)+
        row('Environment','demo',true)+
      '</div>'+

      '<div class="card" style="padding:20px"><div style="font-weight:700;margin-bottom:14px;font-size:.95rem">Integration Capabilities</div>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;font-size:.84rem">'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Account creation</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Balance adjustments</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Trading access control</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Position list</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Trade history</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--gr)"><div style="color:var(--gr);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Ready</div><div>Execution events</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--am)"><div style="color:var(--am);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Partial</div><div>Force close positions</div></div>'+
          '<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);border-left:3px solid var(--t3)"><div style="color:var(--t3);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Phase 2</div><div>OAuth &amp; InApp</div></div>'+
        '</div>'+
      '</div>'+

      (st.enabled&&st.authenticated?'':
        '<div class="card" style="margin-top:14px;padding:16px 20px;background:var(--am-bg);border-color:rgba(251,191,36,.15)"><div style="display:flex;align-items:flex-start;gap:12px"><div style="width:24px;height:24px;border-radius:50%;background:var(--am);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">!</div><div style="font-size:.86rem;color:var(--t2);line-height:1.7"><strong style="color:var(--am)">Setup required.</strong> Set CTRADER_ENABLED=true and CTRADER_GROUP_ID in Railway environment variables, then redeploy. See CTRADER-SETUP.md for full checklist.</div></div></div>');
  }catch(e){
    $('ctraderBox').innerHTML='';
  }
}
if(adminTab==='log'){try{const logs=await api('/api/admin/audit-log');$('auditBox').innerHTML=logs.length?'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Time</th><th>Action</th><th>Details</th></tr></thead><tbody>'+logs.slice(0,100).map(l=>'<tr><td style="font-size:.72rem;white-space:nowrap">'+(l.created_at?new Date(l.created_at).toLocaleString():'\u2014')+'</td><td><span class="badge b-active">'+l.action+'</span></td><td style="font-size:.78rem;color:var(--t2);max-width:300px;overflow:hidden;text-overflow:ellipsis">'+(l.details||'\u2014')+'</td></tr>').join('')+'</tbody></table></div>':'<div style="padding:32px;text-align:center;color:var(--t3)">Empty</div>'}catch(e){$('auditBox').innerHTML='Failed'}}
}catch(x){$('page-admin').innerHTML='<div class="card" style="padding:40px;text-align:center;color:var(--rd)">Admin access required</div>'}};
async function admPay(id,a){try{await api('/api/admin/payouts/'+id+'/'+a,{method:'POST'});toast(a+'d','success');render_admin()}catch(x){toast(x.message,'error')}}
async function admPayTx(id){const tx=$('tx_'+id)?.value||'';try{await api('/api/admin/payouts/'+id+'/pay',{method:'POST',body:JSON.stringify({tx_reference:tx})});toast('Paid','success');render_admin()}catch(x){toast(x.message,'error')}}
async function toggleDemo(enabled){try{await api('/api/admin/settings/demo-mode',{method:'POST',body:JSON.stringify({enabled})});toast(enabled?'Demo Mode ENABLED — payments bypassed':'Demo Mode DISABLED — payments required',enabled?'info':'success');render_admin()}catch(x){toast(x.message,'error')}}
function showCredentials(login){
  const m=document.createElement('div');
  m.className='modal-bg';
  m.id='credModal';
  m.innerHTML=`<div class="modal" style="max-width:440px">
    <button class="modal-close" onclick="document.getElementById('credModal').remove()">&times;</button>
    <h2>PlutoTrader Access</h2>
    <p style="color:var(--t2);font-size:.86rem;margin-bottom:20px">Log into the terminal with your Pluto Capital account credentials — the same email and password you use here on the dashboard.</p>
    <a href="/terminal.html" target="_blank" class="btn btn-primary btn-full" style="margin-bottom:18px;display:block;text-align:center;padding:12px;font-size:.9rem">&#9654; Open PlutoTrader Terminal</a>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r)">
        <div>
          <div style="font-size:.68rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700">Login (Email)</div>
          <div style="font-size:1rem;font-family:var(--fm);font-weight:700;color:var(--ac2);margin-top:2px">${login}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${login}');toast('Email copied','success')">Copy</button>
      </div>
      <div style="padding:12px 16px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r)">
        <div style="font-size:.68rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Password</div>
        <div style="font-size:.84rem;color:var(--t2)">Use your <strong style="color:var(--t1)">Pluto Capital account password</strong> — the same one you used to log in here.</div>
        <div style="font-size:.75rem;color:var(--t3);margin-top:6px">Forgot it? Use the <a href="/" style="color:var(--ac2)">Forgot Password</a> link on the dashboard.</div>
      </div>
      <div style="padding:10px 14px;background:var(--acbg);border:1px solid var(--acgl);border-radius:var(--r);font-size:.78rem;color:var(--ac2)">
        ✓ Your account appears automatically in the terminal — no extra setup needed.
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function resetChallenge(id){if(!confirm('Reset this challenge for 10% off the original price? A new account will be created.'))return;try{const d=await api('/api/challenges/'+id+'/reset',{method:'POST'});toast('Account reset! New challenge created at '+F(d.fee_paid),'success');navigate('challenges')}catch(x){toast(x.message,'error')}}
async function admAction(path,msg){try{await api('/api/admin/'+path,{method:'POST'});toast(msg,'success');render_admin()}catch(x){toast(x.message,'error')}}
async function admDelCode(id){if(!confirm('Disable this code?'))return;try{await api('/api/admin/discount-codes/'+id,{method:'DELETE'});toast('Disabled','success');render_admin()}catch(x){toast(x.message,'error')}}
function showCreateCodeModal(){const m=document.createElement('div');m.className='modal-bg';m.id='codeModal';m.innerHTML=`<div class="modal"><button class="modal-close" onclick="document.getElementById('codeModal').remove()">&times;</button><h2>Create Promo Code</h2><p style="color:var(--t2);font-size:.86rem">Discount code for traders</p><div style="display:flex;flex-direction:column;gap:12px;margin-top:16px"><div class="field"><label>Code</label><input id="newCode" placeholder="LAUNCH20" style="text-transform:uppercase"></div><div class="field"><label>Discount %</label><input id="newPct" type="number" min="1" max="100" placeholder="20"></div><div class="field"><label>Max Uses (0=unlimited)</label><input id="newMax" type="number" min="0" value="0"></div><div class="field"><label>Expires (optional)</label><input id="newExp" type="date"></div><button class="btn btn-primary btn-full" onclick="createCode()">Create</button></div></div>`;document.body.appendChild(m)}
async function createCode(){try{const d=await api('/api/admin/discount-codes',{method:'POST',body:JSON.stringify({code:$('newCode').value,discount_pct:+$('newPct').value,max_uses:+$('newMax').value||0,valid_until:$('newExp').value||''})});document.getElementById('codeModal')?.remove();toast('Code '+d.code+' created!','success');render_admin()}catch(x){toast(x.message,'error')}}


// CERTIFICATES PAGE
window.render_certs=async function(){$('page-certs').innerHTML=LOADING;try{
const s=await api('/api/dashboard/stats');
const passed=s.challenges.filter(c=>c.status==='passed');
const payouts_raw=await api('/api/payouts');
const paidPayouts=payouts_raw.filter(p=>p.status==='paid');
$('page-certs').innerHTML=`<div class="page-head"><h1>Certificates</h1><p>Your achievements and payout confirmations</p></div>
${passed.length?`<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Evaluation Certificates</div>${passed.map(c=>`<div class="row" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd)"><div><span style="font-weight:700">${F(c.account_size)} ${c.challenge_type==='two_step'?'2-Step':'1-Step'}</span><span style="color:var(--t3);font-size:.8rem;margin-left:10px">${c.passed_at?new Date(c.passed_at).toLocaleDateString():''}</span></div><button class="btn btn-outline btn-sm" onclick="showCertificate('pass',{name:'${(user?.first_name||'')+' '+(user?.last_name||'')}',size:'${F(c.account_size)}',type:'${c.challenge_type==='two_step'?'2-Step':'1-Step'}',date:'${c.passed_at?new Date(c.passed_at).toLocaleDateString():new Date(c.created_at).toLocaleDateString()}',id:'${c.id.slice(0,8).toUpperCase()}'})">View Certificate</button></div>`).join('')}</div>`:`<div class="card" style="text-align:center;padding:48px"><div style="font-size:1.4rem;margin-bottom:10px">&#127942;</div><div style="font-weight:700;margin-bottom:6px">No certificates yet</div><div style="color:var(--t2);font-size:.86rem">Pass an evaluation to earn your first certificate.</div></div>`}
${paidPayouts.length?`<div class="card" style="padding:0;overflow:hidden;margin-top:16px"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Payout Certificates</div>${paidPayouts.map(p=>`<div class="row" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd)"><div><span style="font-weight:700;color:var(--gr)">${F(p.trader_amount)}</span><span style="color:var(--t3);font-size:.8rem;margin-left:10px">${p.paid_at?new Date(p.paid_at).toLocaleDateString():''}</span></div><button class="btn btn-outline btn-sm" onclick="showCertificate('payout',{name:'${(user?.first_name||'')+' '+(user?.last_name||'')}',amount:'${F(p.trader_amount)}',date:'${p.paid_at?new Date(p.paid_at).toLocaleDateString():''}',id:'${p.id?.slice(0,8).toUpperCase()||''}'})">View Receipt</button></div>`).join('')}</div>`:''}`}catch(e){$('page-certs').innerHTML='<div class="card"><div class="empty">Failed to load certificates</div></div>'}};
// LEGAL
function showLegalModal(title,content){const m=document.createElement('div');m.className='modal-bg';m.id='legalModal';m.innerHTML=`<div class="modal" style="max-width:700px;max-height:80vh;overflow-y:auto"><button class="modal-close" onclick="document.getElementById('legalModal').remove()">&times;</button><h2>${title}</h2><div style="color:var(--t2);font-size:.84rem;line-height:1.75;margin-top:16px">${content}</div></div>`;document.body.appendChild(m)}

// CERTIFICATE
function showCertificate(type,data){
  const certId=data.id||'PCF-'+Date.now().toString(36).toUpperCase();
  const isPass=type==='pass';
  const m=document.createElement('div');
  m.className='modal-bg';m.id='certModal';
  m.style.cssText='display:flex;align-items:center;justify-content:center;z-index:1000';

  if(isPass){
    m.innerHTML=`<div id="certPrint" style="background:#0f0f14;border:1px solid rgba(139,92,246,.3);border-radius:16px;width:680px;max-width:96vw;overflow:hidden;position:relative;font-family:'Manrope',sans-serif">
      <button onclick="document.getElementById('certModal').remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.06);border:none;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;z-index:10">&times;</button>
      <!-- TOP ACCENT BAR -->
      <div style="height:4px;background:linear-gradient(90deg,#7c3aed,#8b5cf6,#a78bfa,#60a5fa)"></div>
      <!-- HEADER -->
      <div style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07)">
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px">
          <img src="/img/favicon.svg" style="width:28px;height:28px;opacity:.9">
          <span style="font-size:.8rem;font-weight:800;letter-spacing:.22em;color:#a78bfa;text-transform:uppercase">Pluto Capital Funding</span>
        </div>
        <div style="font-size:.62rem;font-weight:700;letter-spacing:.3em;color:#6b7280;text-transform:uppercase;margin-bottom:14px">Certificate of Achievement</div>
        <div style="font-size:.82rem;color:#9ca3af;margin-bottom:10px">This is to certify that</div>
        <div style="font-size:2rem;font-weight:700;color:#f9fafb;letter-spacing:-.03em;margin-bottom:10px;line-height:1.1">${data.name}</div>
        <div style="font-size:.82rem;color:#9ca3af;margin-bottom:8px">has successfully completed the</div>
        <div style="font-size:1.15rem;font-weight:700;color:#a78bfa;margin-bottom:4px">${data.size} ${data.type} Evaluation</div>
        <div style="font-size:.78rem;color:#6b7280">demonstrating consistent discipline, risk control, and trading proficiency</div>
      </div>
      <!-- STATS ROW -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid rgba(255,255,255,.07)">
        <div style="padding:20px;text-align:center;border-right:1px solid rgba(255,255,255,.07)">
          <div style="font-size:.58rem;font-weight:700;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:6px">Account Size</div>
          <div style="font-size:1.1rem;font-weight:700;color:#f9fafb">${data.size}</div>
        </div>
        <div style="padding:20px;text-align:center;border-right:1px solid rgba(255,255,255,.07)">
          <div style="font-size:.58rem;font-weight:700;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:6px">Profit Split</div>
          <div style="font-size:1.1rem;font-weight:700;color:#34d399">80%</div>
        </div>
        <div style="padding:20px;text-align:center">
          <div style="font-size:.58rem;font-weight:700;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:6px">Date Issued</div>
          <div style="font-size:1.1rem;font-weight:700;color:#f9fafb">${data.date}</div>
        </div>
      </div>
      <!-- FOOTER -->
      <div style="padding:18px 40px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:.65rem;color:#4b5563;font-family:'JetBrains Mono',monospace">ID: ${certId}</div>
        <div style="display:flex;gap:8px">
          <button onclick="window.print()" style="background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.25);color:#a78bfa;padding:7px 16px;border-radius:8px;font-size:.76rem;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif">Print</button>
          <button onclick="document.getElementById('certModal').remove()" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#9ca3af;padding:7px 16px;border-radius:8px;font-size:.76rem;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif">Close</button>
        </div>
      </div>
      <!-- BOTTOM ACCENT BAR -->
      <div style="height:2px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.4),transparent)"></div>
    </div>`;
  } else {
    m.innerHTML=`<div id="certPrint" style="background:#0f0f14;border:1px solid rgba(52,211,153,.2);border-radius:16px;width:560px;max-width:96vw;overflow:hidden;position:relative;font-family:'Manrope',sans-serif">
      <button onclick="document.getElementById('certModal').remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.06);border:none;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;z-index:10">&times;</button>
      <div style="height:4px;background:linear-gradient(90deg,#059669,#34d399,#6ee7b7)"></div>
      <div style="padding:36px 40px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07)">
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px">
          <img src="/img/favicon.svg" style="width:28px;height:28px;opacity:.9">
          <span style="font-size:.8rem;font-weight:800;letter-spacing:.22em;color:#34d399;text-transform:uppercase">Pluto Capital Funding</span>
        </div>
        <div style="font-size:.62rem;font-weight:700;letter-spacing:.3em;color:#6b7280;text-transform:uppercase;margin-bottom:14px">Payout Confirmation</div>
        <div style="font-size:.82rem;color:#9ca3af;margin-bottom:10px">Payout issued to</div>
        <div style="font-size:1.8rem;font-weight:700;color:#f9fafb;letter-spacing:-.03em;margin-bottom:18px;line-height:1.1">${data.name}</div>
        <div style="font-size:.62rem;font-weight:700;letter-spacing:.2em;color:#6b7280;text-transform:uppercase;margin-bottom:8px">Amount Paid</div>
        <div style="font-size:2.4rem;font-weight:800;color:#34d399;letter-spacing:-.04em">${data.amount}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(255,255,255,.07)">
        <div style="padding:18px 24px;text-align:center;border-right:1px solid rgba(255,255,255,.07)">
          <div style="font-size:.58rem;font-weight:700;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:6px">Status</div>
          <div style="font-size:.92rem;font-weight:700;color:#34d399">&#10003; Paid</div>
        </div>
        <div style="padding:18px 24px;text-align:center">
          <div style="font-size:.58rem;font-weight:700;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:6px">Date</div>
          <div style="font-size:.92rem;font-weight:700;color:#f9fafb">${data.date}</div>
        </div>
      </div>
      <div style="padding:16px 40px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:.65rem;color:#4b5563;font-family:'JetBrains Mono',monospace">REF: ${certId}</div>
        <div style="display:flex;gap:8px">
          <button onclick="window.print()" style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.2);color:#34d399;padding:7px 16px;border-radius:8px;font-size:.76rem;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif">Print</button>
          <button onclick="document.getElementById('certModal').remove()" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#9ca3af;padding:7px 16px;border-radius:8px;font-size:.76rem;font-weight:600;cursor:pointer;font-family:'Manrope',sans-serif">Close</button>
        </div>
      </div>
      <div style="height:2px;background:linear-gradient(90deg,transparent,rgba(52,211,153,.3),transparent)"></div>
    </div>`;
  }
  document.body.appendChild(m);
}
function showTerms(){showLegalModal('Terms of Service',`<p><strong>Last Updated: April 15, 2026</strong></p><p><strong>1. Nature of Services</strong><br>Pluto Capital Funding provides a simulated trading evaluation environment. All activity occurs in a demo environment using virtual funds. We are NOT a broker, financial advisor, or regulated financial entity.</p><p><strong>2. Eligibility</strong><br>Must be 18+. Accurate info required. KYC before funded account.</p><p><strong>3. Fees</strong><br>Non-refundable. Passing does not guarantee funding.</p><p><strong>4. Rules</strong><br>&bull; Targets: 1-Step 10%, 2-Step 8%/5%<br>&bull; Daily loss: 5%<br>&bull; Drawdown: 1-Step 8%, 2-Step 10% (static)<br>&bull; 20% consistency rule<br>&bull; Lot limits per account size<br>&bull; News: 2-min restriction<br>&bull; Weekend: funded must close Fri 3:45 PM EST<br>&bull; Min 2-min avg trade duration<br>&bull; 30-day inactivity = closure<br>Violations = termination without refund.</p><p><strong>5. Prohibited</strong><br>&bull; Arbitrage, HFT, tick scalping<br>&bull; External copy trading<br>&bull; Account sharing<br>&bull; Cross-account hedging (same-account OK)<br>&bull; Gambling behavior<br>&bull; Environment exploitation<br>&bull; VPN circumvention</p><p><strong>6. Funded Accounts</strong><br>Simulated. Performance-based rewards. KYC required. Weekend holding not permitted.</p><p><strong>7. Payouts</strong><br>USDT, USDC, or bank. Min $50. No open positions. Subject to review.</p><p><strong>8. Liability</strong><br>Limited to fee paid. AI Coach is educational only.</p><p><strong>9. Contact</strong><br>support@plutocapitalfunding.com</p>`)}
function showPrivacy(){showLegalModal('Privacy Policy',`<p><strong>Last Updated: April 15, 2026</strong></p><p><strong>We collect:</strong> Name, email, phone, country, ID (KYC), trading data, IP, payment info.</p><p><strong>Use:</strong> Operations, payouts, KYC, communications, improvement.</p><p><strong>Sharing:</strong> Never sold. Shared with KYC (Sumsub), payments (NOWPayments, Rise), law enforcement.</p><p><strong>Rights:</strong> Access, correction, deletion via support@plutocapitalfunding.com.</p>`)}
function showRisk(){showLegalModal('Risk Disclosure',`<p><strong>Last Updated: April 15, 2026</strong></p><p><strong>Simulated:</strong> All trading is demo. No real money at risk.</p><p><strong>No Guarantee:</strong> Most traders fail. Only use funds you can lose.</p><p><strong>Non-Refundable:</strong> All fees final.</p><p><strong>Payouts:</strong> Performance-based rewards. Subject to KYC and compliance review.</p><p><strong>No Swap Fees:</strong> All accounts are swap-free. No overnight charges on positions.</p><p><strong>AI Coach:</strong> Educational only. Not financial advice.</p><p><strong>Contact:</strong> support@plutocapitalfunding.com</p>`)}

// LEADERBOARD
window.render_leaderboard=async function(){$('page-leaderboard').innerHTML=LOADING;try{
const d=await api('/api/leaderboard');
$('page-leaderboard').innerHTML=`<div class="page-head"><h1>Leaderboard</h1><p>Top performing traders across all evaluations</p></div>
${d.length?`<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Trader</th><th>Country</th><th>Size</th><th>Profit</th><th>%</th><th>Trades</th><th>Win Rate</th></tr></thead><tbody>${d.map((t,i)=>`<tr style="${i<3?'background:rgba(139,92,246,.04)':''}"><td style="font-weight:700;color:${i===0?'var(--am)':i===1?'var(--t2)':i===2?'var(--ac2)':'var(--t3)'};font-size:1rem">${t.rank}</td><td class="fw">${t.name}</td><td>${t.country}</td><td class="mono">${F(t.size)}</td><td class="pos" style="font-weight:700">${F(t.profit)}</td><td style="color:var(--gr)">${t.profit_pct}%</td><td class="mono">${t.trades}</td><td>${t.win_rate}%</td></tr>`).join('')}</tbody></table></div></div>`:`<div class="card" style="text-align:center;padding:52px;color:var(--t3)">No traders on the leaderboard yet. Be the first!</div>`}`}catch(e){$('page-leaderboard').innerHTML='<div class="card"><div class="empty">Failed to load leaderboard</div></div>'}};

// ECONOMIC CALENDAR
window.render_calendar=async function(){
  $('page-calendar').innerHTML=`
  <div class="page-head">
    <h1>Economic Calendar</h1>
    <p>High-impact news events — close all positions 2 min before &amp; after</p>
  </div>
  <!-- News rule banner -->
  <div style="padding:12px 18px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.18);border-radius:var(--r2);margin-bottom:20px;display:flex;align-items:center;gap:12px">
    <span style="font-size:1.2rem">⚠️</span>
    <div>
      <div style="font-weight:700;font-size:.84rem;color:var(--am)">News Trading Rule</div>
      <div style="font-size:.78rem;color:var(--t2);margin-top:2px">Close all positions at least <strong style="color:var(--t1)">2 minutes before</strong> and wait <strong style="color:var(--t1)">2 minutes after</strong> any high-impact event. Violations on funded accounts may result in profit voiding.</div>
    </div>
  </div>
  <!-- Filters -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <span style="font-size:.7rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em">Filter:</span>
    <button class="cal-filter active" data-impact="all" onclick="calFilter(this,'all')">All</button>
    <button class="cal-filter" data-impact="High" onclick="calFilter(this,'High')">🔴 High Only</button>
    <div style="margin-left:auto;font-size:.7rem;color:var(--t3)" id="cal-updated"></div>
  </div>
  <!-- Currency filter -->
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:20px;flex-wrap:wrap">
    <span style="font-size:.7rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.1em">Currency:</span>
    ${['ALL','USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD'].map(c=>`<button class="cal-cur-filter ${c==='ALL'?'active':''}" data-cur="${c}" onclick="calCurFilter(this,'${c}')">${c}</button>`).join('')}
  </div>
  <!-- Calendar body -->
  <div id="cal-body">${LOADING}</div>`;

  // Inject filter styles
  if(!document.getElementById('cal-styles')){
    const s=document.createElement('style');s.id='cal-styles';
    s.textContent=`
      .cal-filter,.cal-cur-filter{padding:4px 12px;border-radius:20px;border:1px solid var(--brd2);background:transparent;color:var(--t3);font-family:var(--ff);font-size:.7rem;font-weight:600;cursor:pointer;transition:all .15s}
      .cal-filter:hover,.cal-cur-filter:hover{color:var(--t1);border-color:var(--brd3)}
      .cal-filter.active,.cal-cur-filter.active{background:var(--ac-bg);border-color:var(--ac-gl);color:var(--ac2)}
      .cal-day-header{padding:10px 0 6px;font-size:.7rem;font-weight:800;color:var(--t3);text-transform:uppercase;letter-spacing:.14em;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--brd)}
      .cal-day-header span{color:var(--t1)}
      .cal-day-header .today-badge{background:var(--ac-bg);color:var(--ac2);padding:2px 8px;border-radius:10px;font-size:.6rem;border:1px solid var(--ac-gl)}
      .cal-event{display:grid;grid-template-columns:70px 44px 1fr auto auto auto;align-items:center;gap:12px;padding:10px 14px;border-radius:var(--r2);margin:4px 0;border:1px solid var(--brd);background:var(--sf);transition:all .15s}
      .cal-event:hover{border-color:var(--brd2);background:var(--sf2)}
      .cal-event.high{border-left:3px solid var(--rd)}
      .cal-event.medium{border-left:3px solid var(--am)}
      .cal-time{font-family:var(--fm);font-size:.74rem;font-weight:600;color:var(--t2)}
      .cal-time.upcoming{color:var(--ac2);font-weight:700}
      .cal-time.live{color:var(--rd);font-weight:800;animation:livepulse 1s ease-in-out infinite}
      @keyframes livepulse{0%,100%{opacity:1}50%{opacity:.5}}
      .cal-flag{font-size:1.1rem;text-align:center}
      .cal-title{font-size:.8rem;font-weight:600;color:var(--t1)}
      .cal-country{font-size:.62rem;color:var(--t3);margin-top:1px}
      .cal-impact-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .impact-High .cal-impact-dot{background:var(--rd);box-shadow:0 0 6px rgba(248,113,113,.5)}
      .impact-Medium .cal-impact-dot{background:var(--am)}
      .cal-data{text-align:right;min-width:52px}
      .cal-data-label{font-size:.52rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
      .cal-data-val{font-size:.72rem;font-family:var(--fm);font-weight:600;color:var(--t1)}
      .cal-data-val.positive{color:var(--gr)}
      .cal-data-val.negative{color:var(--rd)}
      .cal-countdown{font-size:.62rem;font-family:var(--fm);color:var(--t3);text-align:right;min-width:60px}
      .cal-countdown.soon{color:var(--am);font-weight:700}
      .cal-countdown.live{color:var(--rd);font-weight:800}
    `;
    document.head.appendChild(s);
  }

  try {
    const data = await api('/api/calendar');
    window._calData = data;
    window._calImpact = 'all';
    window._calCur = 'ALL';
    renderCalendarBody(data);
    $('cal-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    // Refresh countdown every 30s
    if(window._calTimer) clearInterval(window._calTimer);
    window._calTimer = setInterval(()=>renderCalendarBody(window._calData), 30000);
  } catch(e) {
    $('cal-body').innerHTML = '<div class="card"><div class="empty">Failed to load calendar. Try again.</div></div>';
  }
};

function calFilter(btn, impact) {
  document.querySelectorAll('.cal-filter').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  window._calImpact = impact;
  renderCalendarBody(window._calData);
}
function calCurFilter(btn, cur) {
  document.querySelectorAll('.cal-cur-filter').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  window._calCur = cur;
  renderCalendarBody(window._calData);
}

function renderCalendarBody(data) {
  if (!data) return;
  const now = new Date();
  const impact = window._calImpact || 'all';
  const cur    = window._calCur    || 'ALL';
  const FLAGS  = {USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',JPY:'🇯🇵',AUD:'🇦🇺',CAD:'🇨🇦',CHF:'🇨🇭',NZD:'🇳🇿',CNY:'🇨🇳',CHN:'🇨🇳'};

  let filtered = data.filter(e =>
    (impact === 'all' || e.impact === impact) &&
    (cur === 'ALL' || e.country === cur)
  );

  if (!filtered.length) {
    $('cal-body').innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--t3)">No events match the current filter</div>';
    return;
  }

  // Group by date
  const byDate = {};
  filtered.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const html = Object.entries(byDate).map(([date, events]) => {
    const d     = new Date(date + 'T12:00:00');
    const isToday = date === now.toISOString().split('T')[0];
    const dayName = isToday ? 'Today' : d.toLocaleDateString('en-US',{weekday:'long'});
    const dateFmt = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

    const evHtml = events.map(e => {
      const [h,m]    = (e.time||'00:00').split(':').map(Number);
      const evTime   = new Date(date + 'T' + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':00');
      const diffMs   = evTime - now;
      const diffMin  = Math.round(diffMs / 60000);
      const isLive   = diffMs > -120000 && diffMs < 120000;
      const isSoon   = diffMs > 0 && diffMin <= 30;
      const isPast   = diffMs < -120000;

      let timeCls = '';
      let countdown = '';
      if (isLive)      { timeCls = 'live'; countdown = '🔴 LIVE'; }
      else if (isSoon) { timeCls = 'upcoming'; countdown = `in ${diffMin}m`; }
      else if (!isPast && isToday) {
        if (diffMin < 60) countdown = `in ${diffMin}m`;
        else countdown = `in ${Math.floor(diffMin/60)}h ${diffMin%60}m`;
      }

      const actualCls = e.actual
        ? (parseFloat(e.actual) >= parseFloat(e.forecast || e.previous || '0') ? 'positive' : 'negative')
        : '';

      return `<div class="cal-event ${e.impact?.toLowerCase()||''} impact-${e.impact||''}">
        <div class="cal-time ${timeCls}">${e.time||'TBA'}</div>
        <div class="cal-flag">${FLAGS[e.country]||'🌐'}</div>
        <div>
          <div class="cal-title">${e.title}</div>
          <div class="cal-country">${e.country} · ${e.impact} Impact</div>
        </div>
        <div class="cal-data" style="min-width:52px">
          <div class="cal-data-label">Prev</div>
          <div class="cal-data-val">${e.previous||'—'}</div>
        </div>
        <div class="cal-data" style="min-width:52px">
          <div class="cal-data-label">Fcst</div>
          <div class="cal-data-val">${e.forecast||'—'}</div>
        </div>
        <div class="cal-data" style="min-width:52px">
          <div class="cal-data-label">Actual</div>
          <div class="cal-data-val ${actualCls}">${e.actual||'—'}</div>
        </div>
        ${countdown ? `<div class="cal-countdown ${isLive?'live':isSoon?'soon':''}">${countdown}</div>` : '<div style="min-width:60px"></div>'}
      </div>`;
    }).join('');

    return `<div style="margin-bottom:24px">
      <div class="cal-day-header">
        <span>${dayName}</span>
        <span style="color:var(--t3)">${dateFmt}</span>
        ${isToday?'<span class="today-badge">TODAY</span>':''}
        <span style="margin-left:auto;font-size:.62rem;color:var(--t3)">${events.length} event${events.length!==1?'s':''}</span>
      </div>
      <div style="margin-top:8px">${evHtml}</div>
    </div>`;
  }).join('');

  $('cal-body').innerHTML = html;
}

// AFFILIATE
window.render_affiliate=async function(){$('page-affiliate').innerHTML=LOADING;try{
const d=await api('/api/affiliate/stats');
$('page-affiliate').innerHTML=`<div class="page-head"><h1>Affiliate Program</h1><p>Earn 10% commission on every referral purchase</p></div>
<div class="stats"><div class="stat s-purple"><div class="stat-label">Total Earned</div><div class="stat-value">${F(d.total_earned)}</div></div><div class="stat s-green"><div class="stat-label">Pending</div><div class="stat-value">${F(d.pending)}</div></div><div class="stat s-blue"><div class="stat-label">Referrals</div><div class="stat-value">${d.total_referrals}</div></div></div>
<div class="card"><div style="font-weight:700;font-size:.95rem;margin-bottom:12px">Your Referral Link</div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="refLink" value="${d.referral_link}" readonly style="flex:1;min-width:200px;padding:10px 14px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r);color:var(--ac2);font-family:var(--fm);font-size:.82rem"><button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText($('refLink').value);toast('Link copied!','success')">Copy Link</button></div>
<div style="font-size:.78rem;color:var(--t3);margin-top:8px">Share this link. When someone registers and buys a challenge, you earn 10% of their fee.</div></div>
${d.referrals.length?`<div class="card" style="padding:0;overflow:hidden;margin-top:14px"><div style="padding:14px 20px;border-bottom:1px solid var(--brd);font-weight:700">Your Referrals</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Name</th><th>Joined</th></tr></thead><tbody>${d.referrals.map(r=>`<tr><td>${r.name||'Trader'}</td><td style="font-size:.78rem">${r.joined?new Date(r.joined).toLocaleDateString():'—'}</td></tr>`).join('')}</tbody></table></div></div>`:''}`}catch(e){$('page-affiliate').innerHTML='<div class="card"><div class="empty">Failed to load affiliate data</div></div>'}};

// SHARE
function shareChallenge(size,profit,wr,type){const text=`I'm trading a ${F(size)} ${type} evaluation on Pluto Capital Funding! Current profit: ${F(profit)} | Win rate: ${wr}% | Join me: https://plutocapitalfunding.com`;if(navigator.share){navigator.share({title:'Pluto Capital Funding',text}).catch(()=>{})}else{navigator.clipboard.writeText(text);toast('Stats copied to clipboard!','success')}}

// ─── BALANCE / EQUITY CHART ───────────────────────────────────────────────
async function drawBalanceChart(challengeId, startBal, target, floor) {
  const el = document.getElementById('bchart-'+challengeId);
  if (!el) return;
  el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">Loading…</div>';
  try {
    const data = await api('/api/challenges/'+challengeId+'/balance-history');
    const series = data.series || [];
    if (series.length < 2) {
      el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">No trade history yet</div>';
      return;
    }
    const W = el.offsetWidth || 280, H = 90;
    const vals = series.map(p => p.v);
    const minV = Math.min(...vals, floor) * 0.999;
    const maxV = Math.max(...vals, target) * 1.001;
    const scaleX = i => (i / (series.length - 1)) * (W - 8) + 4;
    const scaleY = v => H - 4 - ((v - minV) / (maxV - minV)) * (H - 8);
    const pts = series.map((p,i) => `${scaleX(i).toFixed(1)},${scaleY(p.v).toFixed(1)}`).join(' ');
    const areaClose = `${scaleX(series.length-1).toFixed(1)},${H} ${scaleX(0).toFixed(1)},${H}`;
    const color = series[series.length-1].v >= startBal ? '#34D399' : '#F87171';
    const tY = scaleY(target).toFixed(1);
    const fY = scaleY(floor).toFixed(1);
    const sY = scaleY(startBal).toFixed(1);
    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block">
      <defs>
        <linearGradient id="bg${challengeId.slice(0,4)}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <!-- Floor line (red) -->
      <line x1="0" y1="${fY}" x2="${W}" y2="${fY}" stroke="#F87171" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>
      <!-- Target line (green) -->
      <line x1="0" y1="${tY}" x2="${W}" y2="${tY}" stroke="#34D399" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>
      <!-- Start line (gray) -->
      <line x1="0" y1="${sY}" x2="${W}" y2="${sY}" stroke="#5A5672" stroke-width="1" opacity="0.6"/>
      <!-- Area fill -->
      <polygon points="${pts} ${areaClose}" fill="url(#bg${challengeId.slice(0,4)})"/>
      <!-- Line -->
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- Current dot -->
      <circle cx="${scaleX(series.length-1).toFixed(1)}" cy="${scaleY(series[series.length-1].v).toFixed(1)}" r="3" fill="${color}"/>
      <!-- Labels -->
      <text x="3" y="${parseFloat(tY)-3}" fill="#34D399" font-size="8" opacity="0.8">Target ${F(target)}</text>
      <text x="3" y="${Math.min(H-3,parseFloat(fY)+9)}" fill="#F87171" font-size="8" opacity="0.8">Floor ${F(floor)}</text>
    </svg>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">Chart unavailable</div>';
  }
}

// ─── DAILY P&L CALENDAR ───────────────────────────────────────────────────
async function drawDailyCalendar(challengeId) {
  const el = document.getElementById('pcal-'+challengeId);
  if (!el) return;
  el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">Loading…</div>';
  try {
    const data = await api('/api/challenges/'+challengeId+'/daily-pnl');
    const days = data.days || {};
    if (!Object.keys(days).length) {
      el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">No trading days yet</div>';
      return;
    }
    const dates = Object.keys(days).sort();
    const start = new Date(dates[0]);
    const end   = new Date(dates[dates.length-1]);
    // Build calendar for the range
    const maxAbs = Math.max(...Object.values(days).map(Math.abs), 1);
    // Compress to last 5 weeks max for space
    const weeks = [];
    let week = [];
    const cur = new Date(start);
    cur.setDate(cur.getDate() - cur.getDay()); // back to Sunday
    const endSun = new Date(end);
    endSun.setDate(endSun.getDate() + (6 - endSun.getDay()));
    while (cur <= endSun) {
      week.push(new Date(cur));
      if (week.length === 7) { weeks.push(week); week = []; }
      cur.setDate(cur.getDate()+1);
    }
    if (week.length) { while(week.length<7) week.push(null); weeks.push(week); }
    const visWeeks = weeks.slice(-8); // show last 8 weeks
    const cw = 11, ch = 11, gap = 2;
    const W = visWeeks.length * (cw+gap) + 28, H = 7*(ch+gap)+16;
    const dayLetters = ['S','M','T','W','T','F','S'];
    let cells = '';
    visWeeks.forEach((wk,wi) => {
      wk.forEach((d,di) => {
        if (!d) return;
        const key = d.toISOString().split('T')[0];
        const pnl = days[key];
        const x = 20 + wi*(cw+gap), y = 12 + di*(ch+gap);
        let fill = '#1A1828';
        if (pnl !== undefined) {
          const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
          if (pnl >= 0) fill = `rgba(52,211,153,${0.15+intensity*0.75})`;
          else fill = `rgba(248,113,113,${0.15+intensity*0.75})`;
        }
        const title = pnl !== undefined ? `${key}: ${pnl>=0?'+':''}${pnl.toFixed(2)}` : key;
        cells += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="2" fill="${fill}" title="${title}">
          <title>${title}</title></rect>`;
      });
    });
    // Day labels
    const labels = dayLetters.map((l,i) =>
      `<text x="14" y="${14+i*(ch+gap)+ch/2+3}" fill="#5A5672" font-size="7" text-anchor="middle">${l}</text>`
    ).join('');
    // Month ticks at top
    let monthTicks = '';
    visWeeks.forEach((wk,wi) => {
      const d = wk.find(d=>d);
      if (!d) return;
      const x = 20 + wi*(cw+gap);
      if (d.getDate() <= 7 || wi===0) {
        monthTicks += `<text x="${x+cw/2}" y="9" fill="#5A5672" font-size="7" text-anchor="middle">${d.toLocaleString('default',{month:'short'})}</text>`;
      }
    });
    el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">
      ${labels}${monthTicks}${cells}
    </svg>
    <div style="display:flex;gap:10px;margin-top:4px;font-size:.6rem;color:var(--t3)">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:rgba(52,211,153,.8);border-radius:2px;display:inline-block"></span>Profit</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:rgba(248,113,113,.8);border-radius:2px;display:inline-block"></span>Loss</span>
      <span style="margin-left:auto;font-weight:700;color:var(--t2)">${data.total_trading_days} trading day${data.total_trading_days!==1?'s':''}</span>
    </div>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--t3);font-size:.7rem;padding:4px">Calendar unavailable</div>';
  }
}

// ─── TRADER SCORE RADAR CHART ─────────────────────────────────────────────
function drawRadarChart(overallScore, wr, pf, consistency, risk, slUsage) {
  const radar = document.getElementById('radarChart');
  const breakdown = document.getElementById('scoreBreakdown');
  if (!radar) return;

  const axes = [
    { label: 'Win Rate',     value: Math.min(100, wr),           color: '#34D399' },
    { label: 'Consistency',  value: Math.min(100, consistency),  color: '#60A5FA' },
    { label: 'Risk Mgmt',    value: Math.min(100, risk),         color: '#A78BFA' },
    { label: 'Profit Factor',value: Math.min(100, Math.round(pf * 33)), color: '#FBBF24' },
    { label: 'SL Discipline',value: Math.min(100, slUsage),      color: '#F87171' },
    { label: 'Overall',      value: Math.min(100, overallScore), color: '#34D399' },
  ];

  const cx = 90, cy = 90, R = 72, n = axes.length;
  const toRad = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i, r) => {
    const a = toRad(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  // Web lines (rings)
  let rings = '';
  [0.25, 0.5, 0.75, 1].forEach(frac => {
    const pts = axes.map((_, i) => { const p = pt(i, R * frac); return `${p.x},${p.y}`; }).join(' ');
    rings += `<polygon points="${pts}" fill="none" stroke="#252238" stroke-width="1"/>`;
  });

  // Axis lines
  let axisLines = '';
  axes.forEach((_, i) => {
    const p = pt(i, R);
    axisLines += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#252238" stroke-width="1"/>`;
  });

  // Data polygon
  const dataR = axes.map(a => R * a.value / 100);
  const dataPts = axes.map((_, i) => { const p = pt(i, dataR[i]); return `${p.x},${p.y}`; }).join(' ');

  // Labels and dots
  let labels = '', dots = '';
  axes.forEach((ax, i) => {
    const lp = pt(i, R + 14);
    const dp = pt(i, dataR[i]);
    labels += `<text x="${lp.x}" y="${lp.y}" text-anchor="middle" dominant-baseline="middle" fill="#8B87A0" font-size="7.5" font-family="Arial">${ax.label}</text>`;
    dots += `<circle cx="${dp.x}" cy="${dp.y}" r="3.5" fill="${ax.color}"/>`;
  });

  // Overall score in center
  const scoreColor = overallScore >= 70 ? '#34D399' : overallScore >= 40 ? '#FBBF24' : '#F87171';

  radar.innerHTML = `<svg width="180" height="180" viewBox="0 0 180 180">
    ${rings}${axisLines}
    <polygon points="${dataPts}" fill="rgba(139,92,246,0.15)" stroke="#7C3AED" stroke-width="1.5"/>
    ${labels}${dots}
    <circle cx="${cx}" cy="${cy}" r="22" fill="#0F0E18" stroke="#252238" stroke-width="1"/>
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="${scoreColor}" font-size="18" font-weight="900" font-family="Arial Narrow,Arial">${overallScore}</text>
    <text x="${cx}" y="${cy + 9}" text-anchor="middle" fill="#8B87A0" font-size="7" font-family="Arial">/100</text>
  </svg>`;

  if (breakdown) {
    const scoreColor2 = s => s >= 70 ? '#34D399' : s >= 40 ? '#FBBF24' : '#F87171';
    breakdown.innerHTML = axes.map(ax => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.8rem;color:#eeedf4">${ax.label}</span>
          <span style="font-size:.8rem;font-weight:700;color:${scoreColor2(ax.value)}">${ax.value}</span>
        </div>
        <div style="height:5px;background:#1A1828;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${ax.value}%;background:${ax.color};border-radius:3px;transition:width .6s ease"></div>
        </div>
      </div>`).join('');
  }
}{const p=new URLSearchParams(window.location.search);if(p.get('purchased')==='true'){toast('Payment received! Activating shortly.','success');window.history.replaceState({},'',window.location.pathname)}}
function loadPricing(){renderPricing(PLANS.one_step,$('landingPricing'),"selectPlan")}

// ── Mobile nav menu ──────────────────────────────────────────────────────────
function toggleNavMenu() {
  const links = $('navLinks');
  const overlay = $('navOverlay');
  const icon = $('navMenuIcon');
  const open = links.classList.toggle('nav-open');
  overlay.style.display = open ? 'block' : 'none';
  // Swap hamburger ↔ X icon
  icon.innerHTML = open
    ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
    : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}
function closeNavMenu() {
  const links = $('navLinks');
  const overlay = $('navOverlay');
  const icon = $('navMenuIcon');
  if (!links) return;
  links.classList.remove('nav-open');
  if (overlay) overlay.style.display = 'none';
  if (icon) icon.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}

window.addEventListener('scroll', () => {
  const n = $('topNav');
  if (n) n.classList.toggle('scrolled', scrollY > 20);
});
// Close mobile menu on resize to desktop
window.addEventListener('resize', () => { if (window.innerWidth > 768) closeNavMenu(); });
document.addEventListener('DOMContentLoaded', () => { loadPricing(); handleReturnFromPayment(); if(token) enterDashboard(); });
