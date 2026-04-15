/* Pluto Capital Funding — v6.0 */
const API='https://pluto-platform-production.up.railway.app';
let token=localStorage.getItem('pcf_token'),user=null,currentEval='one_step',selectedPlan=null;
const $=id=>document.getElementById(id);
const F=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(n);
const B=s=>`<span class="badge b-${s}">${s.replace(/_/g,' ')}</span>`;
const pct=n=>`${n>=0?'+':''}${n.toFixed(2)}%`;
const LOADING='<div style="text-align:center;padding:60px;color:var(--t3)"><div style="width:28px;height:28px;border:3px solid var(--brd);border-top-color:var(--ac);border-radius:50%;animation:spin .6s linear infinite;margin:0 auto"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';

async function api(u,o={}){const h={'Content-Type':'application/json'};if(token)h['Authorization']='Bearer '+token;const r=await fetch(API+u,{...o,headers:h});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}

function showAuth(m){$('authModal').classList.remove('hidden');showAuthScreen(m==='login'?'formLogin':'formRegister')}
function showAuthScreen(id){['formLogin','formRegister','formVerify','formForgot','formReset'].forEach(f=>{const el=$(f);if(el)el.classList.add('hidden')});const t=$(id);if(t)t.classList.remove('hidden')}
function hideAuth(){$('authModal').classList.add('hidden')}
function selectPlan(size){selectedPlan={size,type:currentEval};showAuth('register')}
function toast(m,t='info'){const e=document.createElement('div');e.className='toast toast-'+t;e.textContent=m;document.body.appendChild(e);setTimeout(()=>{e.style.opacity='0';e.style.transform='translateY(-10px)';e.style.transition='all .3s';setTimeout(()=>e.remove(),300)},3000)}

let pendingVerifyEmail='';
async function doLogin(e){e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('loginEmail').value,password:$('loginPass').value})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;hideAuth();enterDashboard()}catch(x){toast(x.message,'error')}}
async function doRegister(e){e.preventDefault();try{const email=$('regEmail').value;const d=await api('/api/auth/register',{method:'POST',body:JSON.stringify({email,password:$('regPass').value,first_name:$('regFirst').value,last_name:$('regLast').value})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;pendingVerifyEmail=email;$('verifyEmailDisplay').textContent=email;showAuthScreen('formVerify');toast('Check your email for a verification code','info')}catch(x){toast(x.message,'error')}}
async function doVerify(e){e.preventDefault();try{await api('/api/auth/verify-email',{method:'POST',body:JSON.stringify({email:pendingVerifyEmail,code:$('verifyCode').value})});toast('Email verified! Welcome to Pluto Capital.','success');hideAuth();enterDashboard();if(selectedPlan){setTimeout(()=>{navigate('buy');toast('Select your plan to continue','info')},500)}}catch(x){toast(x.message,'error')}}
async function resendCode(){try{await api('/api/auth/resend-code',{method:'POST',body:JSON.stringify({email:pendingVerifyEmail})});toast('New code sent! Check your email.','success')}catch(x){toast(x.message,'error')}}
let pendingResetEmail='';
async function doForgot(e){e.preventDefault();try{pendingResetEmail=$('forgotEmail').value;await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:pendingResetEmail})});showAuthScreen('formReset');toast('If this email is registered, you will receive a reset code.','info')}catch(x){toast(x.message,'error')}}
async function doReset(e){e.preventDefault();try{await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({email:pendingResetEmail,code:$('resetCode').value,new_password:$('resetNewPass').value})});toast('Password reset! You can now sign in.','success');showAuth('login')}catch(x){toast(x.message,'error')}}
function logout(){token=null;user=null;localStorage.removeItem('pcf_token');$('app').style.display='none';$('landing').style.display='block'}
function toggleMobile(){document.querySelector('.sidebar').classList.toggle('mobile-open')}

async function enterDashboard(){try{user=await api('/api/users/profile');$('landing').style.display='none';$('app').style.display='block';$('userName').textContent=(user.first_name+' '+user.last_name).trim()||'Trader';$('userEmail').textContent=user.email;if(user.role==='admin')$('adminMenuItem').classList.remove('hidden');navigate('dashboard')}catch(x){logout()}}

function navigate(p){document.querySelectorAll('.page').forEach(e=>e.classList.add('hidden'));document.querySelectorAll('.sb-link').forEach(l=>l.classList.remove('active'));const el=$('page-'+p);if(el){el.classList.remove('hidden');el.classList.add('fade')}const lk=document.querySelector(`[data-page="${p}"]`);if(lk)lk.classList.add('active');if(window['render_'+p])window['render_'+p]()}

// NEW PRICING — 10% below Funding Pips
const PLANS={
  one_step:[
    {size:5000,fee:32,target:10,daily:5,dd:8,split:80,lev:'1:100'},
    {size:10000,fee:59,target:10,daily:5,dd:8,split:80,lev:'1:100'},
    {size:25000,fee:144,target:10,daily:5,dd:8,split:80,lev:'1:100'},
    {size:50000,fee:225,target:10,daily:5,dd:8,split:80,lev:'1:100'},
    {size:100000,fee:399,target:10,daily:5,dd:8,split:80,lev:'1:100'},
    {size:200000,fee:799,target:10,daily:5,dd:8,split:80,lev:'1:100'}
  ],
  two_step:[
    {size:5000,fee:29,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'},
    {size:10000,fee:49,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'},
    {size:25000,fee:129,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'},
    {size:50000,fee:199,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'},
    {size:100000,fee:359,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'},
    {size:200000,fee:719,target:'8 / 5',daily:5,dd:10,split:80,lev:'1:100'}
  ]
};

function renderPricing(plans,container,action){container.innerHTML=plans.map((p,i)=>`<div class="plan ${i===4?'popular':''}" onclick="${action}(${p.size})"><div class="plan-size">${F(p.size).replace('.00','')}</div><div class="plan-price">${F(p.fee).replace('.00','')}</div><div class="plan-detail">${p.target}% Target</div><div class="plan-detail">${p.daily}% Daily Loss</div><div class="plan-detail">${p.dd}% Max DD</div><div class="plan-detail">${p.split}% Split</div><div class="plan-detail">${p.lev} Leverage</div><div class="plan-detail">30% Consistency</div><button class="btn btn-primary btn-sm btn-full" style="margin-top:14px">${action==='selectPlan'?'Get Funded':'Select Plan'}</button></div>`).join('')}

function switchEval(type){currentEval=type;document.querySelectorAll('#pricing .eval-tab').forEach(t=>t.classList.remove('active'));event.target.classList.add('active');renderPricing(PLANS[type],$('landingPricing'),"selectPlan")}

// DASHBOARD
window.render_dashboard=async function(){$('page-dashboard').innerHTML=LOADING;try{const s=await api('/api/dashboard/stats');
const pendingChallenges=s.challenges.filter(c=>c.status==='pending_payment');
const activeChallenges=s.challenges.filter(c=>c.status==='active');
$('page-dashboard').innerHTML=`<div class="page-head"><h1>Dashboard</h1><p>Welcome back, ${user.first_name}.</p></div>
<div class="stats">
  <div class="stat s-purple"><div class="stat-label">Total Profit</div><div class="stat-value">${F(s.total_profit)}</div></div>
  <div class="stat s-green"><div class="stat-label">Total Payouts</div><div class="stat-value">${F(s.total_payouts)}</div></div>
  <div class="stat s-blue"><div class="stat-label">Active Challenges</div><div class="stat-value">${s.active_challenges}</div></div>
  <div class="stat s-cyan"><div class="stat-label">Funded Accounts</div><div class="stat-value">${s.active_funded}</div></div>
  <div class="stat s-amber"><div class="stat-label">Win Rate</div><div class="stat-value">${s.win_rate}%</div></div>
  <div class="stat s-green"><div class="stat-label">Total Trades</div><div class="stat-value">${s.total_trades}</div></div>
</div>
${pendingChallenges.length?`<div class="card" style="border-color:var(--am);background:var(--am-bg)"><div class="card-title" style="color:var(--am)">&#9888; Pending Payment</div>${pendingChallenges.map(c=>`<div class="row"><span class="row-label">${F(c.account_size)} ${c.challenge_type==='two_step'?'2-Step':'1-Step'}</span><span class="row-value" style="color:var(--am)">Awaiting crypto payment</span></div>`).join('')}</div>`:''}
${activeChallenges.length?`<div class="card"><div class="card-title">Active Accounts</div>${activeChallenges.map(c=>{
  const pp=((c.current_balance-c.starting_balance)/c.starting_balance*100);
  const tp=Math.min(100,Math.max(0,pp/c.profit_target_pct*100));
  const du=((c.highest_balance-c.lowest_equity)/c.starting_balance*100);
  const dp=Math.min(100,du/c.max_total_loss_pct*100);
  return`<div class="detail">
    <div class="detail-head"><div><div class="detail-title">${F(c.account_size)} Challenge</div><div class="detail-sub">Login: ${c.ctrader_login||'\u2014'} &bull; ${c.challenge_type==='two_step'?'2-Step':'1-Step'}</div></div>${B(c.status)}</div>
    <div class="row"><span class="row-label">Profit Target (${c.profit_target_pct}%)</span><span class="row-value ${pp>=0?'pos':'neg'}">${pct(pp)} / ${c.profit_target_pct}%</span></div>
    <div class="bar"><div class="bar-fill bar-green" style="width:${tp}%"></div></div>
    <div class="row" style="margin-top:12px"><span class="row-label">Balance</span><span class="row-value">${F(c.current_balance)}</span></div>
    <div class="row"><span class="row-label">Equity</span><span class="row-value">${F(c.current_equity)}</span></div>
    <div class="row"><span class="row-label">Drawdown Used</span><span class="row-value" style="color:${dp>70?'var(--rd)':'var(--t1)'}">${du.toFixed(2)}% / ${c.max_total_loss_pct}%</span></div>
    <div class="bar"><div class="bar-fill ${dp>70?'bar-red':'bar-purple'}" style="width:${dp}%"></div></div>
    <div class="row" style="margin-top:12px"><span class="row-label">Trades</span><span class="row-value">${c.total_trades} (${c.winning_trades}W / ${c.losing_trades}L)</span></div>
  </div>`}).join('')}</div>`:`<div class="card"><div class="empty">No active challenges yet.<br><a onclick="navigate('buy')">Purchase your first challenge &rarr;</a></div></div>`}`}catch(e){$('page-dashboard').innerHTML='<div class="card"><div class="empty">Failed to load dashboard.</div></div>'}};

window.render_challenges=async function(){$('page-challenges').innerHTML=LOADING;const d=await api('/api/challenges');$('page-challenges').innerHTML=`<div class="page-head"><h1>My Challenges</h1><p>All evaluation accounts</p></div><div class="card"><table class="tbl"><thead><tr><th>Size</th><th>Type</th><th>Status</th><th>Balance</th><th>Profit</th><th>Trades</th><th>Login</th></tr></thead><tbody>${d.map(c=>{const p=c.current_balance-c.starting_balance;return`<tr><td class="fw">${F(c.account_size)}</td><td>${c.challenge_type==='two_step'?'2-Step':'1-Step'}</td><td>${B(c.status)}</td><td class="mono">${F(c.current_balance)}</td><td class="${p>=0?'pos':'neg'}">${F(p)}</td><td>${c.total_trades}</td><td class="mono">${c.ctrader_login||'\u2014'}</td></tr>`}).join('')}</tbody></table>${!d.length?'<div class="empty">No challenges yet. <a onclick="navigate(\'buy\')">Purchase one &rarr;</a></div>':''}</div>`};

window.render_funded=async function(){$('page-funded').innerHTML=LOADING;const d=await api('/api/funded');$('page-funded').innerHTML=`<div class="page-head"><h1>Funded Accounts</h1><p>Your funded trading accounts</p></div>${d.map(a=>`<div class="detail"><div class="detail-head"><div class="detail-title">${F(a.account_size)} Funded</div>${B(a.status)}</div><div class="row"><span class="row-label">Balance</span><span class="row-value">${F(a.current_balance)}</span></div><div class="row"><span class="row-label">Total Profit</span><span class="row-value pos">${F(a.total_profit)}</span></div><div class="row"><span class="row-label">Profit Split</span><span class="row-value">${a.profit_split_pct}%</span></div><div class="row"><span class="row-label">Total Payouts</span><span class="row-value" style="color:var(--gr)">${F(a.total_payouts)}</span></div><button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="showPayoutModal('${a.id}')">Request Payout</button></div>`).join('')||'<div class="card"><div class="empty">No funded accounts yet. Pass an evaluation to get funded.</div></div>'}`};

window.render_buy=async function(){$('page-buy').innerHTML=`<div class="page-head"><h1>Buy Challenge</h1><p>Choose your evaluation type and account size</p></div><div class="eval-tabs"><button class="eval-tab active" onclick="switchBuyEval('one_step',this)">1-Step Evaluation</button><button class="eval-tab" onclick="switchBuyEval('two_step',this)">2-Step Evaluation</button></div><div class="buy-grid" id="buyGrid"></div><div class="card" style="margin-top:18px"><div class="card-title">Included With Every Plan</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;color:var(--t2);font-size:.84rem"><div>&#10003; No time limit</div><div>&#10003; No minimum trading days</div><div>&#10003; Static drawdown (never trails)</div><div>&#10003; EAs and copy trading allowed</div><div>&#10003; Hedging permitted</div><div>&#10003; cTrader &amp; MetaTrader 5</div><div>&#10003; 1:100 leverage</div><div>&#10003; 30% consistency rule</div><div>&#10003; AI Trade Coach included</div></div></div>`;renderPricing(PLANS[currentEval],$('buyGrid'),'purchase')};

window.switchBuyEval=function(type,btn){document.querySelectorAll('#page-buy .eval-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');currentEval=type;renderPricing(PLANS[type],$('buyGrid'),'purchase')};

async function purchase(s){if(!token){showAuth('register');return}if(!confirm('Purchase '+F(s)+' '+(currentEval==='two_step'?'2-Step':'1-Step')+' challenge?\n\nYou will be redirected to pay with crypto.'))return;try{const d=await api('/api/challenges/purchase',{method:'POST',body:JSON.stringify({account_size:s,challenge_type:currentEval,payment_method:'crypto'})});if(d.payment_url){window.location.href=d.payment_url}else if(d.ctrader){toast('Challenge activated! Login: '+d.ctrader.login,'success');navigate('challenges')}else{toast('Challenge created','success');navigate('challenges')}}catch(x){toast(x.message,'error')}}

// PAYOUT MODAL
function showPayoutModal(fundedId){const modal=document.createElement('div');modal.className='modal-bg';modal.id='payoutModal';modal.innerHTML=`<div class="modal"><button class="modal-close" onclick="document.getElementById('payoutModal').remove()">&times;</button><h2>Request Payout</h2><p>Choose your preferred payout method</p><div style="display:flex;flex-direction:column;gap:10px"><button class="btn btn-primary btn-full" onclick="submitPayout('${fundedId}','crypto_usdt')">USDT (TRC-20)</button><button class="btn btn-primary btn-full" onclick="submitPayout('${fundedId}','crypto_usdc')">USDC (ERC-20)</button><button class="btn btn-outline btn-full" onclick="submitPayout('${fundedId}','bank_transfer')">Bank Transfer</button></div></div>`;document.body.appendChild(modal)}
async function submitPayout(id,method){document.getElementById('payoutModal')?.remove();try{const d=await api('/api/payouts/request',{method:'POST',body:JSON.stringify({funded_account_id:id,payout_method:method})});toast('Payout requested: '+F(d.trader_amount),'success');navigate('payouts')}catch(x){toast(x.message,'error')}}

window.render_payouts=async function(){$('page-payouts').innerHTML=LOADING;const d=await api('/api/payouts');const paid=d.filter(p=>p.status==='paid').reduce((s,p)=>s+p.trader_amount,0);const pending=d.filter(p=>['requested','approved','processing'].includes(p.status)).reduce((s,p)=>s+p.trader_amount,0);$('page-payouts').innerHTML=`<div class="page-head"><h1>Payouts</h1><p>Withdrawal history</p></div><div class="stats"><div class="stat s-green"><div class="stat-label">Total Paid</div><div class="stat-value">${F(paid)}</div></div><div class="stat s-purple"><div class="stat-label">Pending</div><div class="stat-value">${F(pending)}</div></div></div><div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Gross</th><th>Split</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${d.map(p=>`<tr><td>${new Date(p.requested_at).toLocaleDateString()}</td><td>${F(p.gross_profit)}</td><td>${p.split_pct}%</td><td class="pos">${F(p.trader_amount)}</td><td>${(p.payout_method||'').replace(/_/g,' ').toUpperCase()}</td><td>${B(p.status)}</td></tr>`).join('')}</tbody></table>${!d.length?'<div class="empty">No payouts yet</div>':''}</div>`};

window.render_trades=async function(){$('page-trades').innerHTML=LOADING;const d=await api('/api/trades');$('page-trades').innerHTML=`<div class="page-head"><h1>Trade History</h1><p>Closed positions</p></div><div class="card"><table class="tbl"><thead><tr><th>Symbol</th><th>Dir</th><th>Volume</th><th>Open</th><th>Close</th><th>P&L</th><th>Time</th></tr></thead><tbody>${d.map(t=>`<tr><td class="fw">${t.symbol}</td><td><span class="badge ${t.direction==='BUY'?'b-active':'b-failed'}">${t.direction}</span></td><td>${t.volume}</td><td class="mono">${t.open_price?.toFixed(2)||'\u2014'}</td><td class="mono">${t.close_price?.toFixed(2)||'\u2014'}</td><td class="${t.profit>=0?'pos':'neg'}">${F(t.profit)}</td><td class="muted" style="font-size:.74rem">${t.close_time?new Date(t.close_time).toLocaleString():'\u2014'}</td></tr>`).join('')}</tbody></table>${!d.length?'<div class="empty">No trades recorded yet</div>':''}</div>`};

// AI TRADE COACH
window.render_coach=async function(){$('page-coach').innerHTML=`<div class="page-head"><h1>AI Trade Coach</h1><p>AI-powered analysis of your trading performance</p></div>
<div class="stats"><div class="stat s-purple"><div class="stat-label">AI Score</div><div class="stat-value">--</div></div><div class="stat s-green"><div class="stat-label">Edge Rating</div><div class="stat-value">--</div></div><div class="stat s-amber"><div class="stat-label">Risk Score</div><div class="stat-value">--</div></div></div>
<div class="card"><div class="card-title">&#129302; How It Works</div><p style="color:var(--t2);font-size:.88rem;line-height:1.7">The AI Trade Coach analyzes every trade you make and provides personalized feedback on your entries, exits, risk management, and consistency. Once you have active trades on your cTrader or MT5 account, the coach will begin generating insights automatically.</p>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:20px">
<div style="padding:20px;border-radius:var(--r3);background:var(--ac-bg);border:1px solid var(--ac-gl)"><h4 style="font-size:.88rem;margin-bottom:6px">&#128200; Entry Analysis</h4><p style="color:var(--t2);font-size:.8rem">Was your entry optimal? Could you have gotten a better price with a limit order?</p></div>
<div style="padding:20px;border-radius:var(--r3);background:var(--gr-bg);border:1px solid rgba(52,211,153,.12)"><h4 style="font-size:.88rem;margin-bottom:6px">&#127919; Exit Analysis</h4><p style="color:var(--t2);font-size:.8rem">Did you exit too early? Too late? The AI compares your exit vs optimal exit points.</p></div>
<div style="padding:20px;border-radius:var(--r3);background:var(--bl-bg);border:1px solid rgba(96,165,250,.12)"><h4 style="font-size:.88rem;margin-bottom:6px">&#128202; Risk Management</h4><p style="color:var(--t2);font-size:.8rem">Position sizing, risk/reward ratio, drawdown trajectory, and lot exposure analysis.</p></div>
<div style="padding:20px;border-radius:var(--r3);background:var(--am-bg);border:1px solid rgba(251,191,36,.12)"><h4 style="font-size:.88rem;margin-bottom:6px">&#128337; Pattern Detection</h4><p style="color:var(--t2);font-size:.8rem">Which sessions, pairs, and strategies produce your best results? AI finds your edge.</p></div>
</div></div>
<div class="card" style="margin-top:16px"><div class="card-title">&#128161; Coming Soon</div><p style="color:var(--t2);font-size:.88rem">The AI Trade Coach is currently in development and will be available once your cTrader or MT5 account is connected. Start a challenge to be among the first to access it.</p><button class="btn btn-primary btn-sm" onclick="navigate('buy')" style="margin-top:12px">Start a Challenge</button></div>`};

window.render_profile=async function(){$('page-profile').innerHTML=LOADING;const u=await api('/api/users/profile');$('page-profile').innerHTML=`<div class="page-head"><h1>Profile</h1><p>Account settings</p></div><div class="card" style="max-width:540px"><form onsubmit="saveProfile(event)"><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div class="field"><label>First Name</label><input id="pF" value="${u.first_name||''}"></div><div class="field"><label>Last Name</label><input id="pL" value="${u.last_name||''}"></div></div><div class="field" style="margin-top:14px"><label>Email</label><input value="${u.email}" disabled></div><div class="field" style="margin-top:14px"><label>Phone</label><input id="pPh" value="${u.phone||''}"></div><div class="field" style="margin-top:14px"><label>Country</label><input id="pCo" value="${u.country||''}"></div><div class="field" style="margin-top:14px"><label>KYC Status</label><input value="${u.kyc_status}" disabled></div><div class="field" style="margin-top:14px"><label>Referral Code</label><input value="${u.affiliate_code||''}" disabled></div><button type="submit" class="btn btn-primary" style="margin-top:22px">Save Changes</button></form></div>`};
async function saveProfile(e){e.preventDefault();try{await api('/api/users/profile',{method:'PUT',body:JSON.stringify({first_name:$('pF').value,last_name:$('pL').value,phone:$('pPh').value,country:$('pCo').value})});toast('Profile updated','success')}catch(x){toast(x.message,'error')}}

window.render_admin=async function(){$('page-admin').innerHTML=LOADING;try{const o=await api('/api/admin/overview');const u=await api('/api/admin/users');const p=await api('/api/admin/payouts');$('page-admin').innerHTML=`<div class="page-head"><h1>Admin Panel</h1><p>Platform management</p></div><div class="stats"><div class="stat s-purple"><div class="stat-label">Revenue</div><div class="stat-value">${F(o.total_revenue)}</div></div><div class="stat s-green"><div class="stat-label">Payouts</div><div class="stat-value">${F(o.total_payouts)}</div></div><div class="stat s-blue"><div class="stat-label">Net Revenue</div><div class="stat-value">${F(o.net_revenue)}</div></div><div class="stat s-cyan"><div class="stat-label">Reserve</div><div class="stat-value">${o.reserve_health}%</div></div><div class="stat s-amber"><div class="stat-label">Users</div><div class="stat-value">${o.total_users}</div></div><div class="stat s-green"><div class="stat-label">Active</div><div class="stat-value">${o.active_challenges}</div></div><div class="stat s-blue"><div class="stat-label">Funded</div><div class="stat-value">${o.total_funded}</div></div><div class="stat s-red"><div class="stat-label">Pending</div><div class="stat-value">${o.pending_payouts}</div></div></div><div class="card"><div class="card-title">Payout Queue</div><table class="tbl"><thead><tr><th>Trader</th><th>Amount</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead><tbody>${p.map(x=>`<tr><td>${x.first_name} ${x.last_name}<br><span class="muted" style="font-size:.68rem">${x.email}</span></td><td class="pos">${F(x.trader_amount)}</td><td>${(x.payout_method||'').replace(/_/g,' ').toUpperCase()}</td><td>${B(x.status)}</td><td>${x.status==='requested'?`<button class="btn btn-primary btn-sm" onclick="admPay('${x.id}','approve')">Approve</button> <button class="btn btn-danger btn-sm" onclick="admPay('${x.id}','reject')">Reject</button>`:x.status==='approved'?`<button class="btn btn-primary btn-sm" onclick="admPay('${x.id}','pay')">Mark Paid</button>`:'\u2014'}</td></tr>`).join('')}</tbody></table></div><div class="card"><div class="card-title">Users (${u.length})</div><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Country</th><th>KYC</th><th>Role</th></tr></thead><tbody>${u.map(x=>`<tr><td class="fw">${x.first_name} ${x.last_name}</td><td>${x.email}</td><td>${x.country||'\u2014'}</td><td>${B(x.kyc_status)}</td><td>${x.role}</td></tr>`).join('')}</tbody></table></div>`}catch(x){$('page-admin').innerHTML='<p style="color:var(--rd);padding:40px">Admin access required</p>'}};
async function admPay(id,a){try{await api('/api/admin/payouts/'+id+'/'+a,{method:'POST'});toast('Payout '+a+'d','success');window.render_admin()}catch(x){toast(x.message,'error')}}

function handleReturnFromPayment(){const params=new URLSearchParams(window.location.search);if(params.get('purchased')==='true'){toast('Payment received! Your challenge will be activated shortly.','success');window.history.replaceState({},'',window.location.pathname)}}

// LEGAL MODALS
function showLegalModal(title,content){const m=document.createElement('div');m.className='modal-bg';m.id='legalModal';m.innerHTML=`<div class="modal" style="max-width:700px;max-height:80vh;overflow-y:auto"><button class="modal-close" onclick="document.getElementById('legalModal').remove()">&times;</button><h2>${title}</h2><div style="color:var(--t2);font-size:.84rem;line-height:1.75;margin-top:16px">${content}</div></div>`;document.body.appendChild(m)}

function showTerms(){showLegalModal('Terms of Service',`
<p><strong>Last Updated: April 15, 2026</strong></p>
<p>By accessing or using the Pluto Capital Funding platform ("Platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Platform.</p>
<p><strong>1. Nature of Services</strong><br>Pluto Capital Funding provides a simulated trading evaluation environment. All trading activity on the Platform occurs in a simulated (demo) environment using virtual funds. No real financial instruments are bought or sold. Pluto Capital Funding is NOT a broker, financial advisor, investment firm, or regulated financial entity. We do not provide financial advice, manage real money portfolios, or execute trades on any live financial market.</p>
<p><strong>2. Eligibility</strong><br>You must be at least 18 years old. You must provide accurate personal information during registration. You must complete KYC verification before receiving any funded account. Residents of sanctioned countries are not eligible.</p>
<p><strong>3. Evaluation Challenges</strong><br>Challenge fees are non-refundable. All fees are for access to the simulated evaluation environment. Passing an evaluation does not guarantee a funded account. Pluto Capital reserves the right to deny funding for any reason, including suspected manipulation, use of prohibited strategies, or violation of these Terms.</p>
<p><strong>4. Trading Rules</strong><br>All traders must adhere to the published trading rules including but not limited to: profit targets, maximum daily loss limits, maximum drawdown limits, the 30% consistency rule, lot size limits, and news trading restrictions. Violation of any rule may result in immediate account termination without refund.</p>
<p><strong>5. Simulated Funded Accounts</strong><br>Funded accounts operate in a simulated environment. Performance-based rewards ("payouts") are paid from Pluto Capital's operational revenue, not from real trading profits. Pluto Capital reserves the right to review all trading activity before processing payouts. KYC verification is required before any payout is processed.</p>
<p><strong>6. Prohibited Activities</strong><br>The following are strictly prohibited: arbitrage, latency exploitation, high-frequency trading (HFT), tick scalping, copy trading from external sources, account sharing, use of third-party trade copiers, hedging across multiple accounts, trading during restricted news events, and any form of market manipulation or exploitation of the simulated environment.</p>
<p><strong>7. Payouts</strong><br>Payouts are processed via cryptocurrency (USDT, USDC) or bank transfer. Pluto Capital reserves the right to withhold or deny payouts if trading activity is deemed to violate these Terms. Payout processing times may vary.</p>
<p><strong>8. Intellectual Property</strong><br>All content, branding, and technology on the Platform is owned by Pluto Capital Funding. You may not copy, reproduce, or distribute any part of the Platform.</p>
<p><strong>9. Limitation of Liability</strong><br>Pluto Capital Funding shall not be liable for any loss, damage, or expense arising from the use of the Platform, including but not limited to: technical failures, data loss, interrupted service, or decisions made based on information provided by the AI Trade Coach feature. The AI Trade Coach provides educational analysis only and does not constitute financial advice.</p>
<p><strong>10. Termination</strong><br>Pluto Capital may terminate your account at any time for violation of these Terms or for any other reason at our sole discretion. You may close your account at any time by contacting support.</p>
<p><strong>11. Amendments</strong><br>Pluto Capital may update these Terms at any time. Continued use of the Platform constitutes acceptance of the updated Terms.</p>
<p><strong>12. Contact</strong><br>For questions regarding these Terms, contact: support@plutocapitalfunding.com</p>
`)}

function showPrivacy(){showLegalModal('Privacy Policy',`
<p><strong>Last Updated: April 15, 2026</strong></p>
<p>Pluto Capital Funding ("we," "us") respects your privacy. This policy explains how we collect, use, and protect your personal information.</p>
<p><strong>Information We Collect:</strong> Name, email address, phone number, country of residence, government-issued ID (for KYC), trading activity data, IP address, browser information, and payment information.</p>
<p><strong>How We Use Your Information:</strong> To provide and maintain the Platform, process evaluations and payouts, verify your identity (KYC), communicate with you about your account, improve our services, and comply with legal obligations.</p>
<p><strong>Data Sharing:</strong> We do not sell your personal data. We may share data with: KYC verification providers (Sumsub), payment processors (NOWPayments, Rise), and law enforcement when required by law.</p>
<p><strong>Data Security:</strong> We use industry-standard encryption, secure servers, and access controls to protect your data. However, no method of electronic storage is 100% secure.</p>
<p><strong>Your Rights:</strong> You may request access to, correction of, or deletion of your personal data by contacting support@plutocapitalfunding.com. Account deletion requests will be processed within 30 days.</p>
<p><strong>Cookies:</strong> We use essential cookies for platform functionality and analytics cookies to improve our services. You may disable non-essential cookies in your browser settings.</p>
<p><strong>Contact:</strong> support@plutocapitalfunding.com</p>
`)}

function showRisk(){showLegalModal('Risk Disclosure',`
<p><strong>Last Updated: April 15, 2026</strong></p>
<p><strong>IMPORTANT: Please read this disclosure carefully before using the Platform.</strong></p>
<p><strong>Simulated Environment:</strong> All trading on Pluto Capital Funding takes place in a simulated (demo) environment. No real money is at risk during trading. The simulated environment is designed to replicate real market conditions but may differ from live market execution in terms of fills, slippage, and liquidity.</p>
<p><strong>No Guarantee of Income:</strong> Purchasing a challenge does not guarantee that you will pass the evaluation or receive a funded account. Statistical data from the industry shows that the majority of traders do not pass evaluation challenges. You should only purchase a challenge with funds you can afford to lose.</p>
<p><strong>Challenge Fees:</strong> All challenge fees are non-refundable. The fee provides access to the simulated evaluation environment and does not represent an investment or deposit.</p>
<p><strong>Performance Rewards:</strong> Performance-based rewards (payouts) are paid from Pluto Capital's operational revenue and are not derived from actual trading profits in financial markets. Payouts are subject to KYC verification, compliance review, and adherence to all trading rules.</p>
<p><strong>AI Trade Coach:</strong> The AI Trade Coach feature provides educational analysis and is not financial advice. Trading decisions should be made based on your own research and risk tolerance. Past performance analysis does not guarantee future results.</p>
<p><strong>Not Financial Advice:</strong> Pluto Capital Funding does not provide financial advice, investment recommendations, or trading signals. All content on the Platform is for educational and informational purposes only.</p>
<p><strong>Contact:</strong> For risk-related questions, contact support@plutocapitalfunding.com</p>
`)}

function loadPricing(){renderPricing(PLANS.one_step,$('landingPricing'),"selectPlan")}
window.addEventListener('scroll',()=>{const n=$('topNav');if(n)n.classList.toggle('scrolled',scrollY>40)});
document.addEventListener('DOMContentLoaded',()=>{loadPricing();handleReturnFromPayment();if(token)enterDashboard()});
