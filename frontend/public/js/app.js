/* Pluto Capital Funding — v3.0 — Florent */
const API='https://pluto-platform-production.up.railway.app';let token=localStorage.getItem('pcf_token'),user=null,currentEval='one_step';
const $=id=>document.getElementById(id);
const F=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(n);
const B=s=>`<span class="badge b-${s}">${s}</span>`;
const pct=n=>`${n>=0?'+':''}${n.toFixed(2)}%`;

async function api(u,o={}){const h={'Content-Type':'application/json'};if(token)h['Authorization']='Bearer '+token;const r=await fetch(API+u,{...o,headers:h});const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');return d}

function showAuth(m){$('authModal').classList.remove('hidden');$('formLogin').classList.toggle('hidden',m!=='login');$('formRegister').classList.toggle('hidden',m!=='register')}
function hideAuth(){$('authModal').classList.add('hidden')}
function toast(m,t='info'){const e=document.createElement('div');e.className='toast toast-'+t;e.textContent=m;document.body.appendChild(e);setTimeout(()=>e.remove(),3200)}

async function doLogin(e){e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('loginEmail').value,password:$('loginPass').value})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;hideAuth();enterDashboard()}catch(x){toast(x.message,'error')}}
async function doRegister(e){e.preventDefault();try{const d=await api('/api/auth/register',{method:'POST',body:JSON.stringify({email:$('regEmail').value,password:$('regPass').value,first_name:$('regFirst').value,last_name:$('regLast').value})});token=d.token;localStorage.setItem('pcf_token',token);user=d.user;hideAuth();enterDashboard()}catch(x){toast(x.message,'error')}}
function logout(){token=null;user=null;localStorage.removeItem('pcf_token');$('app').style.display='none';$('landing').style.display='block'}

async function enterDashboard(){try{user=await api('/api/users/profile');$('landing').style.display='none';$('app').style.display='block';$('userName').textContent=user.first_name+' '+user.last_name;$('userEmail').textContent=user.email;if(user.role==='admin')$('adminMenuItem').classList.remove('hidden');navigate('dashboard')}catch(x){logout()}}

function navigate(p){document.querySelectorAll('.page').forEach(e=>e.classList.add('hidden'));document.querySelectorAll('.sb-link').forEach(l=>l.classList.remove('active'));const el=$('page-'+p);if(el){el.classList.remove('hidden');el.classList.add('fade')}const lk=document.querySelector(`[data-page="${p}"]`);if(lk)lk.classList.add('active');if(window['render_'+p])window['render_'+p]()}

// PRICING DATA
const PLANS={
  one_step:[
    {size:10000,fee:79,target:10,daily:5,dd:8,split:80,lev:'1:30'},
    {size:25000,fee:179,target:10,daily:5,dd:8,split:80,lev:'1:30'},
    {size:50000,fee:299,target:10,daily:5,dd:8,split:80,lev:'1:20'},
    {size:100000,fee:499,target:10,daily:5,dd:8,split:80,lev:'1:20'},
    {size:200000,fee:949,target:10,daily:5,dd:8,split:80,lev:'1:20'}
  ],
  two_step:[
    {size:10000,fee:59,target:'8 / 5',daily:5,dd:8,split:80,lev:'1:30'},
    {size:25000,fee:139,target:'8 / 5',daily:5,dd:8,split:80,lev:'1:30'},
    {size:50000,fee:239,target:'8 / 5',daily:5,dd:8,split:80,lev:'1:20'},
    {size:100000,fee:399,target:'8 / 5',daily:5,dd:8,split:80,lev:'1:20'},
    {size:200000,fee:749,target:'8 / 5',daily:5,dd:8,split:80,lev:'1:20'}
  ]
};

function renderPricing(plans,container,action){
  container.innerHTML=plans.map((p,i)=>`<div class="plan ${i===3?'popular':''}" onclick="${action}(${p.size})"><div class="plan-size">${F(p.size).replace('.00','')}</div><div class="plan-price">${F(p.fee).replace('.00','')}</div><div class="plan-detail">${p.target}% Target</div><div class="plan-detail">${p.daily}% Daily Loss</div><div class="plan-detail">${p.dd}% Drawdown</div><div class="plan-detail">${p.split}% Split</div><div class="plan-detail">${p.lev}</div><button class="btn btn-primary btn-sm btn-full" style="margin-top:14px">${action==='showAuth'?'Get Funded':'Select Plan'}</button></div>`).join('');
}

function switchEval(type){
  currentEval=type;
  document.querySelectorAll('.eval-tab').forEach(t=>t.classList.remove('active'));
  event.target.classList.add('active');
  renderPricing(PLANS[type],$('landingPricing'),"showAuth");
}

// DASHBOARD
window.render_dashboard=async function(){const s=await api('/api/dashboard/stats');$('page-dashboard').innerHTML=`
<div class="page-head"><h1>Dashboard</h1><p>Welcome back, ${user.first_name}.</p></div>
<div class="stats">
  <div class="stat s-purple"><div class="stat-label">Total Profit</div><div class="stat-value">${F(s.total_profit)}</div></div>
  <div class="stat s-green"><div class="stat-label">Total Payouts</div><div class="stat-value">${F(s.total_payouts)}</div></div>
  <div class="stat s-blue"><div class="stat-label">Active Challenges</div><div class="stat-value">${s.active_challenges}</div></div>
  <div class="stat s-cyan"><div class="stat-label">Funded Accounts</div><div class="stat-value">${s.active_funded}</div></div>
  <div class="stat s-amber"><div class="stat-label">Win Rate</div><div class="stat-value">${s.win_rate}%</div></div>
  <div class="stat s-green"><div class="stat-label">Total Trades</div><div class="stat-value">${s.total_trades}</div></div>
</div>
${s.challenges.filter(c=>c.status==='active').length?`<div class="card"><div class="card-title">Active Accounts</div>
${s.challenges.filter(c=>c.status==='active').map(c=>{
  const pp=((c.current_balance-c.starting_balance)/c.starting_balance*100);
  const tp=Math.min(100,Math.max(0,pp/c.profit_target_pct*100));
  const du=((c.highest_balance-c.lowest_equity)/c.starting_balance*100);
  const dp=Math.min(100,du/c.max_total_loss_pct*100);
  return`<div class="detail">
  <div class="detail-head"><div><div class="detail-title">${F(c.account_size)} Challenge</div><div class="detail-sub">Login: ${c.ctrader_login||'\u2014'} | ${c.challenge_type==='two_step'?'2-Step':'1-Step'}</div></div>${B(c.status)}</div>
  <div class="row"><span class="row-label">Profit Target (${c.profit_target_pct}%)</span><span class="row-value ${pp>=0?'pos':'neg'}">${pct(pp)} / ${c.profit_target_pct}%</span></div>
  <div class="bar"><div class="bar-fill bar-green" style="width:${tp}%"></div></div>
  <div class="row" style="margin-top:10px"><span class="row-label">Balance</span><span class="row-value">${F(c.current_balance)}</span></div>
  <div class="row"><span class="row-label">Equity</span><span class="row-value">${F(c.current_equity)}</span></div>
  <div class="row"><span class="row-label">Drawdown Used</span><span class="row-value" style="color:${dp>70?'var(--rd)':'var(--t1)'}">${du.toFixed(2)}% / ${c.max_total_loss_pct}%</span></div>
  <div class="bar"><div class="bar-fill ${dp>70?'bar-red':'bar-purple'}" style="width:${dp}%"></div></div>
  <div class="row" style="margin-top:10px"><span class="row-label">Trades</span><span class="row-value">${c.total_trades} (${c.winning_trades}W / ${c.losing_trades}L)</span></div>
  <div class="row"><span class="row-label">Best Day</span><span class="row-value pos">${F(c.best_day_profit)}</span></div>
  </div>`}).join('')}</div>`:`<div class="card"><div class="empty">No active challenges yet.<br><a onclick="navigate('buy')">Purchase your first challenge &rarr;</a></div></div>`}`};

// CHALLENGES
window.render_challenges=async function(){const d=await api('/api/challenges');$('page-challenges').innerHTML=`
<div class="page-head"><h1>My Challenges</h1><p>All evaluation accounts</p></div>
<div class="card"><table class="tbl"><thead><tr><th>Size</th><th>Type</th><th>Status</th><th>Balance</th><th>Profit</th><th>Trades</th><th>Login</th></tr></thead>
<tbody>${d.map(c=>{const p=c.current_balance-c.starting_balance;return`<tr><td class="fw">${F(c.account_size)}</td><td>${c.challenge_type==='two_step'?'2-Step':'1-Step'}</td><td>${B(c.status)}</td><td class="mono">${F(c.current_balance)}</td><td class="${p>=0?'pos':'neg'}">${F(p)}</td><td>${c.total_trades}</td><td class="mono">${c.ctrader_login||'\u2014'}</td></tr>`}).join('')}</tbody></table>
${!d.length?'<div class="empty">No challenges yet. <a onclick="navigate(\'buy\')">Purchase one &rarr;</a></div>':''}</div>`};

// FUNDED
window.render_funded=async function(){const d=await api('/api/funded');$('page-funded').innerHTML=`
<div class="page-head"><h1>Funded Accounts</h1><p>Your funded trading accounts</p></div>
${d.map(a=>`<div class="detail"><div class="detail-head"><div class="detail-title">${F(a.account_size)} Funded</div>${B(a.status)}</div>
<div class="row"><span class="row-label">Balance</span><span class="row-value">${F(a.current_balance)}</span></div>
<div class="row"><span class="row-label">Total Profit</span><span class="row-value pos">${F(a.total_profit)}</span></div>
<div class="row"><span class="row-label">Profit Split</span><span class="row-value">${a.profit_split_pct}%</span></div>
<div class="row"><span class="row-label">Total Payouts</span><span class="row-value" style="color:var(--gr)">${F(a.total_payouts)}</span></div>
<div class="row"><span class="row-label">Scaling Level</span><span class="row-value">Level ${a.scaling_level}</span></div>
<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="requestPayout('${a.id}')">Request Payout</button></div>`).join('')||'<div class="card"><div class="empty">No funded accounts yet. Pass an evaluation to get funded.</div></div>'}`};

// BUY
window.render_buy=async function(){$('page-buy').innerHTML=`
<div class="page-head"><h1>Buy Challenge</h1><p>Choose your evaluation type and account size</p></div>
<div class="eval-tabs">
  <button class="eval-tab active" onclick="switchBuyEval('one_step',this)">1-Step Evaluation</button>
  <button class="eval-tab" onclick="switchBuyEval('two_step',this)">2-Step Evaluation</button>
</div>
<div class="buy-grid" id="buyGrid"></div>
<div class="card" style="margin-top:16px"><div class="card-title">Included With Every Plan</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;color:var(--t2);font-size:.85rem">
<div>&#10003; No time limit</div><div>&#10003; No minimum trading days</div><div>&#10003; Static drawdown</div><div>&#10003; EAs and copy trading</div><div>&#10003; Hedging permitted</div><div>&#10003; cTrader &amp; MetaTrader 5</div><div>&#10003; Crypto &amp; bank payouts</div><div>&#10003; Scale up to $2M</div><div>&#10003; 24/7 support</div></div></div>`;
  renderPricing(PLANS.one_step,$('buyGrid'),'purchase')};

window.switchBuyEval=function(type,btn){
  document.querySelectorAll('#page-buy .eval-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  renderPricing(PLANS[type],$('buyGrid'),'purchase');
};

async function purchase(s){if(!confirm('Purchase '+F(s)+' challenge? (Demo \u2014 no real payment)'))return;try{const d=await api('/api/challenges/purchase',{method:'POST',body:JSON.stringify({account_size:s})});toast('Challenge purchased! Login: '+d.ctrader.login,'success');navigate('challenges')}catch(x){toast(x.message,'error')}}

// PAYOUTS
window.render_payouts=async function(){const d=await api('/api/payouts');const paid=d.filter(p=>p.status==='paid').reduce((s,p)=>s+p.trader_amount,0);const pending=d.filter(p=>['requested','approved','processing'].includes(p.status)).reduce((s,p)=>s+p.trader_amount,0);$('page-payouts').innerHTML=`
<div class="page-head"><h1>Payouts</h1><p>Withdrawal history</p></div>
<div class="stats"><div class="stat s-green"><div class="stat-label">Total Paid</div><div class="stat-value">${F(paid)}</div></div><div class="stat s-purple"><div class="stat-label">Pending</div><div class="stat-value">${F(pending)}</div></div></div>
<div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Gross</th><th>Split</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
<tbody>${d.map(p=>`<tr><td>${new Date(p.requested_at).toLocaleDateString()}</td><td>${F(p.gross_profit)}</td><td>${p.split_pct}%</td><td class="pos">${F(p.trader_amount)}</td><td>${(p.payout_method||'').replace(/_/g,' ').toUpperCase()}</td><td>${B(p.status)}</td></tr>`).join('')}</tbody></table>
${!d.length?'<div class="empty">No payouts yet</div>':''}</div>`};
async function requestPayout(id){const m=prompt('Method: crypto_usdt, crypto_usdc, bank_transfer','crypto_usdt');if(!m)return;try{const d=await api('/api/payouts/request',{method:'POST',body:JSON.stringify({funded_account_id:id,payout_method:m})});toast('Payout requested: '+F(d.trader_amount),'success');navigate('payouts')}catch(x){toast(x.message,'error')}}

// TRADES
window.render_trades=async function(){const d=await api('/api/trades');$('page-trades').innerHTML=`
<div class="page-head"><h1>Trade History</h1><p>Closed positions</p></div>
<div class="card"><table class="tbl"><thead><tr><th>Symbol</th><th>Dir</th><th>Volume</th><th>Open</th><th>Close</th><th>P&L</th><th>Time</th></tr></thead>
<tbody>${d.map(t=>`<tr><td class="fw">${t.symbol}</td><td><span class="badge ${t.direction==='BUY'?'b-active':'b-failed'}">${t.direction}</span></td><td>${t.volume}</td><td class="mono">${t.open_price?.toFixed(2)||'\u2014'}</td><td class="mono">${t.close_price?.toFixed(2)||'\u2014'}</td><td class="${t.profit>=0?'pos':'neg'}">${F(t.profit)}</td><td class="muted" style="font-size:.76rem">${t.close_time?new Date(t.close_time).toLocaleString():'\u2014'}</td></tr>`).join('')}</tbody></table>
${!d.length?'<div class="empty">No trades recorded yet</div>':''}</div>`};

// PROFILE
window.render_profile=async function(){const u=await api('/api/users/profile');$('page-profile').innerHTML=`
<div class="page-head"><h1>Profile</h1><p>Account settings</p></div>
<div class="card" style="max-width:540px"><form onsubmit="saveProfile(event)">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div class="field"><label>First Name</label><input id="pF" value="${u.first_name||''}"></div><div class="field"><label>Last Name</label><input id="pL" value="${u.last_name||''}"></div></div>
<div class="field" style="margin-top:14px"><label>Email</label><input value="${u.email}" disabled></div>
<div class="field" style="margin-top:14px"><label>Phone</label><input id="pPh" value="${u.phone||''}"></div>
<div class="field" style="margin-top:14px"><label>Country</label><input id="pCo" value="${u.country||''}"></div>
<div class="field" style="margin-top:14px"><label>KYC Status</label><input value="${u.kyc_status}" disabled></div>
<div class="field" style="margin-top:14px"><label>Referral Code</label><input value="${u.affiliate_code||''}" disabled></div>
<button type="submit" class="btn btn-primary" style="margin-top:20px">Save Changes</button></form></div>`};
async function saveProfile(e){e.preventDefault();try{await api('/api/users/profile',{method:'PUT',body:JSON.stringify({first_name:$('pF').value,last_name:$('pL').value,phone:$('pPh').value,country:$('pCo').value})});toast('Profile updated','success')}catch(x){toast(x.message,'error')}}

// ADMIN
window.render_admin=async function(){try{const o=await api('/api/admin/overview');const u=await api('/api/admin/users');const p=await api('/api/admin/payouts');$('page-admin').innerHTML=`
<div class="page-head"><h1>Admin Panel</h1><p>Platform management</p></div>
<div class="stats">
  <div class="stat s-purple"><div class="stat-label">Revenue</div><div class="stat-value">${F(o.total_revenue)}</div></div>
  <div class="stat s-green"><div class="stat-label">Payouts</div><div class="stat-value">${F(o.total_payouts)}</div></div>
  <div class="stat s-blue"><div class="stat-label">Net Revenue</div><div class="stat-value">${F(o.net_revenue)}</div></div>
  <div class="stat s-cyan"><div class="stat-label">Reserve</div><div class="stat-value">${o.reserve_health}%</div></div>
  <div class="stat s-amber"><div class="stat-label">Users</div><div class="stat-value">${o.total_users}</div></div>
  <div class="stat s-green"><div class="stat-label">Active Challenges</div><div class="stat-value">${o.active_challenges}</div></div>
  <div class="stat s-blue"><div class="stat-label">Funded</div><div class="stat-value">${o.total_funded}</div></div>
  <div class="stat s-red"><div class="stat-label">Pending Payouts</div><div class="stat-value">${o.pending_payouts}</div></div>
</div>
<div class="card"><div class="card-title">Payout Queue</div><table class="tbl"><thead><tr><th>Trader</th><th>Amount</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead>
<tbody>${p.map(x=>`<tr><td>${x.first_name} ${x.last_name}<br><span class="muted" style="font-size:.7rem">${x.email}</span></td><td class="pos">${F(x.trader_amount)}</td><td>${(x.payout_method||'').replace(/_/g,' ').toUpperCase()}</td><td>${B(x.status)}</td><td>${x.status==='requested'?`<button class="btn btn-primary btn-sm" onclick="admPay('${x.id}','approve')">Approve</button> <button class="btn btn-danger btn-sm" onclick="admPay('${x.id}','reject')">Reject</button>`:x.status==='approved'?`<button class="btn btn-primary btn-sm" onclick="admPay('${x.id}','pay')">Mark Paid</button>`:'\u2014'}</td></tr>`).join('')}</tbody></table></div>
<div class="card"><div class="card-title">Users (${u.length})</div><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Country</th><th>KYC</th><th>Role</th></tr></thead>
<tbody>${u.map(x=>`<tr><td class="fw">${x.first_name} ${x.last_name}</td><td>${x.email}</td><td>${x.country||'\u2014'}</td><td>${B(x.kyc_status)}</td><td>${x.role}</td></tr>`).join('')}</tbody></table></div>`}catch(x){$('page-admin').innerHTML='<p style="color:var(--rd);padding:40px">Admin access required</p>'}};
async function admPay(id,a){try{await api('/api/admin/payouts/'+id+'/'+a,{method:'POST'});toast('Payout '+a+'d','success');window.render_admin()}catch(x){toast(x.message,'error')}}

// LANDING PRICING
function loadPricing(){renderPricing(PLANS.one_step,$('landingPricing'),"showAuth")}

window.addEventListener('scroll',()=>{const n=$('topNav');if(n)n.classList.toggle('scrolled',scrollY>40)});
document.addEventListener('DOMContentLoaded',()=>{loadPricing();if(token)enterDashboard()});
