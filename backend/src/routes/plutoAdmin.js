/* ─────────────────────────────────────────────────────────────────────────────
   PlutoAdmin API — Complete Broker Dashboard Backend
   Handles both challenges and funded accounts uniformly
───────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { queryOne, queryAll, run } = require('../models/database');
const { v4: uuidv4 } = require('uuid');
const marketData  = require('../services/marketData');
const orderEngine = require('../services/orderEngine');

router.use(requireAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMarketOpen() {
  const d = new Date(), day = d.getUTCDay(), h = d.getUTCHours();
  return !(day===6 || (day===0&&h<22) || (day===5&&h>=22));
}

// Detect if ID belongs to a challenge or funded account
async function resolveAccount(id) {
  let ch = await queryOne(`SELECT *,'challenge' as kind FROM challenges WHERE id=$1`, [id]);
  if (ch) return ch;
  let fa = await queryOne(`SELECT *,'funded' as kind FROM funded_accounts WHERE id=$1`, [id]);
  return fa;
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [users, active_ch, failed_ch, passed_ch, funded, payouts_pending, revenue, open_pos, today_trades] = await Promise.all([
      queryOne(`SELECT COUNT(*) as n FROM users WHERE role='trader'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='active'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='failed'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='passed'`),
      queryOne(`SELECT COUNT(*) as n FROM funded_accounts WHERE status='active'`),
      queryOne(`SELECT COUNT(*) as n FROM payouts WHERE status='requested'`),
      queryOne(`SELECT COALESCE(SUM(ABS(amount)),0) as t FROM transactions WHERE type='purchase'`),
      queryOne(`SELECT COUNT(*) as n FROM trades WHERE status='open'`),
      queryOne(`SELECT COUNT(*) as n FROM trades WHERE status='closed'`),
    ]);
    const demoSetting = await queryOne(`SELECT value FROM platform_settings WHERE key='demo_mode'`);
    const riskDefaults = await queryOne(`SELECT value FROM platform_settings WHERE key='risk_defaults'`);
    const DEFAULT_JWT = 'pluto-capital-dev-secret-change-in-production-min-32-chars';
    res.json({
      total_users: users?.n||0, active_challenges: active_ch?.n||0, failed_challenges: failed_ch?.n||0,
      passed_challenges: passed_ch?.n||0, funded_accounts: funded?.n||0, pending_payouts: payouts_pending?.n||0,
      total_revenue: parseFloat(revenue?.t||0).toFixed(2), open_positions: open_pos?.n||0,
      today_trades: today_trades?.n||0,
      market_open: isMarketOpen(),
      demo_mode: demoSetting?.value === 'true',
      risk_engine_running: require('../services/riskEngine').running || false,
      risk_defaults: riskDefaults?.value ? JSON.parse(riskDefaults.value) : null,
      env: {
        jwt_secret:             process.env.JWT_SECRET && process.env.JWT_SECRET !== DEFAULT_JWT ? 'set' : 'DEFAULT_UNSAFE',
        email_api_key:          process.env.EMAIL_API_KEY          ? 'set' : 'missing',
        twelve_data_key:        process.env.TWELVE_DATA_KEY        ? 'set' : 'missing',
        nowpayments_api_key:    process.env.NOWPAYMENTS_API_KEY    ? 'set' : 'missing',
        nowpayments_ipn_secret: process.env.NOWPAYMENTS_IPN_SECRET ? 'set' : 'missing — SECURITY RISK',
      },
    });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── ALL ACCOUNTS (challenges + funded) ────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  const { status, type, search, limit=200, offset=0 } = req.query;
  try {
    // Build challenges query
    let cq = `SELECT c.id, c.user_id, c.account_size, c.challenge_type, c.status, c.phase,
      c.starting_balance, c.current_balance, c.current_equity, c.highest_balance, c.lowest_equity,
      c.day_start_balance, c.profit_target_pct, c.max_daily_loss_pct, c.max_total_loss_pct,
      c.profit_split_pct, c.leverage, c.total_trades, c.winning_trades, c.losing_trades,
      c.total_profit, c.breach_reason, c.created_at, c.activated_at, c.passed_at, c.failed_at,
      c.last_trade_at, c.ctrader_login, c.platform, c.fee_paid,
      u.email, u.first_name, u.last_name, u.country, u.kyc_status,
      'challenge' as account_kind,
      (SELECT COUNT(*) FROM trades t WHERE t.challenge_id=c.id AND t.status='open') as open_positions,
      (SELECT COALESCE(SUM(t.profit),0) FROM trades t WHERE t.challenge_id=c.id AND t.status='open') as floating_pnl
    FROM challenges c JOIN users u ON c.user_id=u.id WHERE 1=1`;
    const cp = [];
    if (status && type !== 'funded') { cq += ` AND c.status=$${cp.length+1}`; cp.push(status); }
    if (search) { cq += ` AND (u.email ILIKE $${cp.length+1} OR u.first_name ILIKE $${cp.length+1} OR u.last_name ILIKE $${cp.length+1} OR c.id ILIKE $${cp.length+1})`; cp.push('%'+search+'%'); }

    // Build funded accounts query
    let fq = `SELECT f.id, f.user_id, f.account_size, 'funded' as challenge_type, f.status, 1 as phase,
      f.starting_balance, f.current_balance, f.current_equity, f.highest_balance, f.lowest_equity,
      f.day_start_balance, 0 as profit_target_pct, f.max_daily_loss_pct, f.max_total_loss_pct,
      f.profit_split_pct, '1:30' as leverage, f.total_trades, f.winning_trades, f.losing_trades,
      COALESCE(f.total_profit,0) as total_profit, f.breach_reason, f.created_at, f.created_at as activated_at,
      NULL as passed_at, NULL as failed_at, f.last_trade_at, f.ctrader_login, 'plutotrade' as platform, 0 as fee_paid,
      u.email, u.first_name, u.last_name, u.country, u.kyc_status,
      'funded' as account_kind,
      (SELECT COUNT(*) FROM trades t WHERE t.funded_account_id=f.id AND t.status='open') as open_positions,
      (SELECT COALESCE(SUM(t.profit),0) FROM trades t WHERE t.funded_account_id=f.id AND t.status='open') as floating_pnl
    FROM funded_accounts f JOIN users u ON f.user_id=u.id WHERE 1=1`;
    const fp = [];
    if (status && type !== 'challenge') { fq += ` AND f.status=$${fp.length+1}`; fp.push(status); }
    if (search) { fq += ` AND (u.email ILIKE $${fp.length+1} OR u.first_name ILIKE $${fp.length+1} OR f.id ILIKE $${fp.length+1})`; fp.push('%'+search+'%'); }

    let accounts = [];
    if (type === 'funded') {
      accounts = await queryAll(fq + ` ORDER BY f.created_at DESC`, fp);
    } else if (type === 'challenge') {
      accounts = await queryAll(cq + ` ORDER BY c.created_at DESC`, cp);
    } else {
      const [chs, fas] = await Promise.all([
        queryAll(cq + ` ORDER BY c.created_at DESC`, cp),
        queryAll(fq + ` ORDER BY f.created_at DESC`, fp),
      ]);
      accounts = [...chs, ...fas].sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
    }
    res.json(accounts.slice(parseInt(offset), parseInt(offset)+parseInt(limit)));
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── SINGLE ACCOUNT DETAIL ─────────────────────────────────────────────────────
router.get('/accounts/:id', async (req, res) => {
  try {
    const account = await resolveAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const user = await queryOne(`SELECT email, first_name, last_name, country, kyc_status FROM users WHERE id=$1`, [account.user_id]);
    const table = account.kind === 'funded' ? 'funded_account_id' : 'challenge_id';
    const [positions, history, pendingOrders] = await Promise.all([
      queryAll(`SELECT * FROM trades WHERE ${table}=$1 AND status='open' ORDER BY open_time DESC`, [req.params.id]),
      queryAll(`SELECT * FROM trades WHERE ${table}=$1 AND status='closed' ORDER BY close_time DESC LIMIT 50`, [req.params.id]),
      queryAll(`SELECT * FROM pending_orders WHERE ${table}=$1 AND status='pending' ORDER BY created_at DESC`, [req.params.id]).catch(()=>[]),
    ]);
    const floatPnL = positions.reduce((s,t)=>s+(t.profit||0),0);
    const bal = account.current_balance || account.starting_balance || 0;
    const dd = account.starting_balance ? ((account.starting_balance - (bal+floatPnL)) / account.starting_balance * 100) : 0;
    const dailyPnL = account.day_start_balance ? (bal - account.day_start_balance + floatPnL) : 0;
    res.json({
      ...account, ...user, equity: bal+floatPnL, floating_pnl: floatPnL,
      drawdown_pct: +dd.toFixed(2), daily_pnl: +dailyPnL.toFixed(2),
      positions, history, pending_orders: pendingOrders,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ALL LIVE POSITIONS ─────────────────────────────────────────────────────────
router.get('/positions', async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT t.*, u.email, u.first_name, u.last_name,
        COALESCE(c.account_size, f.account_size) as account_size,
        COALESCE(c.max_total_loss_pct, f.max_total_loss_pct) as max_total_loss_pct,
        CASE WHEN t.challenge_id IS NOT NULL THEN 'challenge' ELSE 'funded' END as account_kind,
        COALESCE(t.challenge_id, t.funded_account_id) as account_id
      FROM trades t
      JOIN users u ON t.user_id=u.id
      LEFT JOIN challenges c ON t.challenge_id=c.id
      LEFT JOIN funded_accounts f ON t.funded_account_id=f.id
      WHERE t.status='open' ORDER BY t.open_time DESC
    `);
    const enriched = rows.map(p => {
      const price = marketData.getPrice(p.symbol);
      const inst  = marketData.getInstrument(p.symbol);
      const mem   = orderEngine.positions[p.id];
      const livePnl = mem?.profit ?? p.profit ?? 0;
      const curPx = price ? (p.direction==='buy' ? price.bid : price.ask) : p.open_price;
      const pipSize = inst?.pip || (p.symbol.includes('JPY') ? 0.01 : 0.0001);
      const pips = ((p.direction==='buy' ? curPx-p.open_price : p.open_price-curPx) / pipSize);
      const dur = p.open_time ? Math.round((Date.now()-new Date(p.open_time))/60000) : 0;
      return { ...p, profit: +livePnl.toFixed(2), current_price: curPx, pips: +pips.toFixed(1), duration_min: dur };
    });
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RISK ALERTS ───────────────────────────────────────────────────────────────
router.get('/risk-alerts', async (req, res) => {
  try {
    const accounts = await queryAll(`
      SELECT c.id, c.user_id, c.account_size, c.status, c.starting_balance,
        c.current_balance, c.current_equity, c.day_start_balance,
        c.max_total_loss_pct, c.max_daily_loss_pct, c.profit_target_pct,
        c.challenge_type, c.total_trades,
        u.email, u.first_name, u.last_name,
        'challenge' as kind,
        (SELECT COALESCE(SUM(profit),0) FROM trades WHERE challenge_id=c.id AND status='open') as float_pnl
      FROM challenges c JOIN users u ON c.user_id=u.id WHERE c.status='active'
    `);
    const alerts = accounts.map(a => {
      const eq = (a.current_balance||a.starting_balance||0) + (a.float_pnl||0);
      const floor = a.starting_balance * (1 - a.max_total_loss_pct/100);
      const ddPct = ((a.starting_balance - eq) / a.starting_balance * 100);
      const dayStart = a.day_start_balance || a.starting_balance;
      const dailyLoss = Math.max(0, (dayStart - eq) / dayStart * 100);
      const ddThresh = a.max_total_loss_pct * 0.7;
      const dlThresh = a.max_daily_loss_pct * 0.7;
      if (ddPct < ddThresh && dailyLoss < dlThresh) return null;
      return {
        ...a, equity: +eq.toFixed(2), drawdown_pct: +ddPct.toFixed(2),
        daily_loss_pct: +dailyLoss.toFixed(2), floor: +floor.toFixed(2),
        dd_remaining: +(a.max_total_loss_pct - ddPct).toFixed(2),
        risk_level: (ddPct >= a.max_total_loss_pct*0.9 || dailyLoss >= a.max_daily_loss_pct*0.9) ? 'critical' : 'warning',
      };
    }).filter(Boolean).sort((a,b) => b.drawdown_pct - a.drawdown_pct);
    res.json(alerts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FORCE CLOSE ALL POSITIONS ─────────────────────────────────────────────────
router.post('/accounts/:id/force-close', async (req, res) => {
  try {
    const account = await resolveAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const isFunded = account.kind === 'funded';
    await orderEngine.adminForceClose(isFunded ? null : req.params.id, isFunded ? req.params.id : null);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'ADMIN_FORCE_CLOSE',account.kind,req.params.id,'All positions force-closed by admin']);
    res.json({ success: true, message: 'All positions closed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BREACH ACCOUNT ────────────────────────────────────────────────────────────
router.post('/accounts/:id/breach', async (req, res) => {
  const { reason = 'ADMIN_ACTION' } = req.body;
  try {
    const account = await resolveAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const isFunded = account.kind === 'funded';
    const table = isFunded ? 'funded_accounts' : 'challenges';
    await orderEngine.adminForceClose(isFunded?null:req.params.id, isFunded?req.params.id:null);
    await run(`UPDATE ${table} SET status='${isFunded?'breached':'failed'}', breach_reason=?, ${isFunded?'breached_at':'failed_at'}=? WHERE id=?`,
      [reason, new Date().toISOString(), req.params.id]);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'ADMIN_BREACH',account.kind,req.params.id,`Breach by admin: ${reason}`]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BALANCE CREDIT / DEBIT ────────────────────────────────────────────────────
router.post('/accounts/:id/balance', async (req, res) => {
  const { operation, amount, reason } = req.body;
  if (!operation || !amount || isNaN(parseFloat(amount)))
    return res.status(400).json({ error: 'operation and numeric amount required' });
  try {
    const account = await resolveAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const isFunded = account.kind === 'funded';
    const table = isFunded ? 'funded_accounts' : 'challenges';
    const delta = operation === 'credit' ? parseFloat(amount) : -parseFloat(amount);
    const base  = account.current_balance || account.starting_balance || 0;
    const newBal = +(base + delta).toFixed(2);
    await run(`UPDATE ${table} SET current_balance=?, current_equity=? WHERE id=?`, [newBal, newBal, req.params.id]);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(), `ADMIN_${operation.toUpperCase()}`, account.kind, req.params.id,
       `${operation} $${amount}: ${reason||'admin op'}`]);
    res.json({ success: true, new_balance: newBal, delta });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── UPDATE ACCOUNT RISK PARAMS (full control, challenges AND funded) ───────────
router.put('/accounts/:id/settings', async (req, res) => {
  const { max_daily_loss_pct, max_total_loss_pct, profit_target_pct, profit_split_pct,
          leverage, status, note, admin_max_lots, admin_spread_markup, admin_commission,
          min_trading_days } = req.body;
  try {
    const account = await resolveAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const isFunded = account.kind === 'funded';
    const table = isFunded ? 'funded_accounts' : 'challenges';
    const fields = [], vals = [];
    if (max_daily_loss_pct  !== undefined) { fields.push('max_daily_loss_pct=?');  vals.push(parseFloat(max_daily_loss_pct)); }
    if (max_total_loss_pct  !== undefined) { fields.push('max_total_loss_pct=?');  vals.push(parseFloat(max_total_loss_pct)); }
    if (!isFunded && profit_target_pct !== undefined) { fields.push('profit_target_pct=?'); vals.push(parseFloat(profit_target_pct)); }
    if (profit_split_pct    !== undefined) { fields.push('profit_split_pct=?');    vals.push(parseFloat(profit_split_pct)); }
    if (leverage            !== undefined) { fields.push('leverage=?');            vals.push(leverage); }
    if (status              !== undefined) { fields.push('status=?');              vals.push(status); }
    if (!isFunded && min_trading_days !== undefined) { fields.push('min_trading_days=?'); vals.push(parseInt(min_trading_days)); }
    // Admin overrides stored as JSON in admin_notes column
    if (admin_max_lots !== undefined || admin_spread_markup !== undefined || admin_commission !== undefined) {
      const existing = await queryOne(`SELECT admin_notes FROM ${table} WHERE id=$1`, [req.params.id]).catch(()=>null);
      let adminData = {};
      try { adminData = JSON.parse(existing?.admin_notes||'{}'); } catch(_) {}
      if (admin_max_lots      !== undefined) adminData.max_lots_override   = parseFloat(admin_max_lots) || null;
      if (admin_spread_markup !== undefined) adminData.spread_markup        = parseFloat(admin_spread_markup) || 0;
      if (admin_commission    !== undefined) adminData.commission_per_lot   = parseFloat(admin_commission) || null;
      if (note) adminData.last_note = note;
      fields.push('admin_notes=?'); vals.push(JSON.stringify(adminData));
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await run(`UPDATE ${table} SET ${fields.join(',')} WHERE id=?`, vals);
    // Clear risk engine cache so new params take effect within 5s
    const riskEngine = require('../services/riskEngine');
    if (riskEngine.lastCheck) delete riskEngine.lastCheck[req.params.id];
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(), 'ADMIN_UPDATE_SETTINGS', account.kind, req.params.id,
       `Updated: ${fields.map(f=>f.split('=')[0]).join(', ')}${note?' — '+note:''}`]);
    res.json({ success: true, updated: fields.map(f=>f.split('=')[0]) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GLOBAL RISK ENGINE DEFAULTS ───────────────────────────────────────────────
router.get('/risk-engine/defaults', async (req, res) => {
  try {
    const row = await queryOne(`SELECT value FROM platform_settings WHERE key='risk_defaults'`);
    res.json(row ? JSON.parse(row.value) : {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/risk-engine/defaults', async (req, res) => {
  try {
    const current = await queryOne(`SELECT value FROM platform_settings WHERE key='risk_defaults'`);
    const existing = current ? JSON.parse(current.value) : {};
    const updated = { ...existing, ...req.body };
    await run(`UPDATE platform_settings SET value=? WHERE key='risk_defaults'`, [JSON.stringify(updated)]);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'RISK_DEFAULTS_UPDATED','system','all',`Global risk defaults updated`]);
    res.json({ success: true, defaults: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Apply global defaults to ALL active accounts
router.post('/risk-engine/apply-defaults', async (req, res) => {
  try {
    const row = await queryOne(`SELECT value FROM platform_settings WHERE key='risk_defaults'`);
    if (!row) return res.status(400).json({ error: 'No defaults set' });
    const defaults = JSON.parse(row.value);
    const d1 = defaults.one_step || {};
    const d2 = defaults.funded || {};
    let updated = 0;
    // Apply to active one_step challenges
    if (d1.max_daily_loss_pct || d1.max_total_loss_pct) {
      await run(`UPDATE challenges SET
        max_daily_loss_pct=COALESCE(?,max_daily_loss_pct),
        max_total_loss_pct=COALESCE(?,max_total_loss_pct),
        profit_split_pct=COALESCE(?,profit_split_pct)
        WHERE status='active' AND challenge_type='one_step'`,
        [d1.max_daily_loss_pct||null, d1.max_total_loss_pct||null, d1.profit_split_pct||null]);
      updated++;
    }
    // Apply to funded accounts
    if (d2.max_daily_loss_pct || d2.max_total_loss_pct) {
      await run(`UPDATE funded_accounts SET
        max_daily_loss_pct=COALESCE(?,max_daily_loss_pct),
        max_total_loss_pct=COALESCE(?,max_total_loss_pct)
        WHERE status='active'`,
        [d2.max_daily_loss_pct||null, d2.max_total_loss_pct||null]);
      updated++;
    }
    // Clear all cached checks
    const riskEngine = require('../services/riskEngine');
    riskEngine.lastCheck = {};
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'APPLY_GLOBAL_DEFAULTS','system','all','Global risk defaults applied to all active accounts']);
    res.json({ success: true, message: 'Defaults applied to all active accounts' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RISK ENGINE STATUS & CONTROL ──────────────────────────────────────────────
router.get('/risk-engine/status', (req, res) => {
  const re = require('../services/riskEngine');
  res.json({
    running: re.running || false,
    market_open: isMarketOpen(),
    accounts_monitored: Object.keys(re.lastCheck||{}).length,
    recent_breaches: re.recentBreaches ? re.recentBreaches.size : 0,
    check_interval_ms: 5000,
  });
});

router.post('/risk-engine/reset-daily', async (req, res) => {
  try {
    await require('../services/riskEngine').resetDailyBalances();
    res.json({ success: true, message: 'Daily balances reset' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DEMO MODE TOGGLE ──────────────────────────────────────────────────────────
router.post('/settings/demo-mode', async (req, res) => {
  const { enabled } = req.body;
  try {
    await run(`UPDATE platform_settings SET value=? WHERE key='demo_mode'`, [enabled ? 'true' : 'false']);
    res.json({ success: true, demo_mode: enabled });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SYMBOL SETTINGS ───────────────────────────────────────────────────────────
router.get('/symbols', async (req, res) => {
  try {
    const inst = marketData.getInstruments ? marketData.getInstruments() : {};
    const settings = await queryAll(`SELECT * FROM symbol_settings`).catch(()=>[]);
    const map = {}; settings.forEach(s => { map[s.symbol] = s; });
    const symbols = Object.entries(inst).map(([sym, def]) => ({
      symbol: sym, name: def.name, type: def.type, digits: def.digits, pip: def.pip,
      base_spread: def.spread || 0,
      spread_markup: map[sym]?.spread_markup || 0,
      commission_per_lot: map[sym]?.commission_per_lot || 3.5,
      trading_enabled: map[sym]?.trading_enabled ?? 1,
    }));
    res.json(symbols);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BULK SYMBOL OPERATIONS ────────────────────────────────────────────────────
// PUT /api/pluto-admin/symbols/bulk  { symbols: ['EURUSD','GBPUSD'], spread_markup: 1.5 }
router.put('/symbols/bulk', async (req, res) => {
  try {
    const { symbols, spread_markup, commission_per_lot } = req.body;
    if (!symbols?.length) return res.status(400).json({ error: 'symbols array required' });
    const results = [];
    for (const sym of symbols) {
      const settings = {};
      if (spread_markup !== undefined) settings.spread_markup = spread_markup;
      if (commission_per_lot !== undefined) settings.commission_per_lot = commission_per_lot;
      await orderEngine.updateSymbolSettings(sym.toUpperCase(), settings);
      results.push(sym.toUpperCase());
    }
    await require('../models/database').run(
      `INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [require('../utils/helpers').generateId(), 'BULK_SYMBOL_UPDATE', 'symbol', 'bulk',
       `Updated ${results.length} symbols: spread_markup=${spread_markup ?? 'unchanged'}, commission=${commission_per_lot ?? 'unchanged'}`]
    );
    res.json({ success: true, updated: results });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/symbols/:symbol', async (req, res) => {
  try {
    await orderEngine.updateSymbolSettings(req.params.symbol.toUpperCase(), req.body);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── BULK SYMBOL OPERATIONS ────────────────────────────────────────────────────
// PUT /api/pluto-admin/symbols/bulk  { symbols: ['EURUSD','GBPUSD'], spread_markup: 1.5 }
router.put('/symbols/bulk', async (req, res) => {
  try {
    const { symbols, spread_markup, commission_per_lot } = req.body;
    if (!symbols?.length) return res.status(400).json({ error: 'symbols array required' });
    const results = [];
    for (const sym of symbols) {
      const settings = {};
      if (spread_markup !== undefined) settings.spread_markup = spread_markup;
      if (commission_per_lot !== undefined) settings.commission_per_lot = commission_per_lot;
      await orderEngine.updateSymbolSettings(sym.toUpperCase(), settings);
      results.push(sym.toUpperCase());
    }
    await require('../models/database').run(
      `INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [require('../utils/helpers').generateId(), 'BULK_SYMBOL_UPDATE', 'symbol', 'bulk',
       `Updated ${results.length} symbols: spread_markup=${spread_markup ?? 'unchanged'}, commission=${commission_per_lot ?? 'unchanged'}`]
    );
    res.json({ success: true, updated: results });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── ACCOUNT OVERRIDE — force spread/commission on a specific account ──────────
// POST /api/pluto-admin/account-settings  { account_id, account_type, spread_override, max_lots_override }
router.post('/account-settings', async (req, res) => {
  try {
    const { account_id, account_type, spread_override, max_lots_override, daily_loss_override, notes } = req.body;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });
    const { run, queryOne } = require('../models/database');
    const table = account_type === 'funded' ? 'funded_accounts' : 'challenges';
    // Store overrides as JSON in a notes/settings column
    const existing = await queryOne(`SELECT admin_notes FROM ${table} WHERE id=$1`, [account_id]).catch(()=>null);
    let adminData = {};
    try { adminData = JSON.parse(existing?.admin_notes||'{}'); } catch(_) {}
    if (spread_override !== undefined) adminData.spread_override = spread_override;
    if (max_lots_override !== undefined) adminData.max_lots_override = max_lots_override;
    if (daily_loss_override !== undefined) adminData.daily_loss_override = daily_loss_override;
    if (notes) adminData.notes = notes;
    await run(`UPDATE ${table} SET admin_notes=$1 WHERE id=$2`, [JSON.stringify(adminData), account_id]);
    res.json({ success: true, settings: adminData });
  } catch(e) { res.status(400).json({ error: e.message }); }
});



// ── SESSIONS ──────────────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await queryAll(`
      SELECT s.*, u.email, u.first_name, u.last_name
      FROM sessions s JOIN users u ON s.user_id=u.id
      ORDER BY s.last_seen DESC LIMIT 100
    `).catch(()=>[]);
    res.json(sessions);
  } catch(_) { res.json([]); }
});

// ── PAYOUTS ───────────────────────────────────────────────────────────────────
router.get('/payouts', async (req, res) => {
  try {
    const payouts = await queryAll(`
      SELECT p.*, u.email, u.first_name, u.last_name
      FROM payouts p JOIN users u ON p.user_id=u.id
      ORDER BY p.requested_at DESC LIMIT 100
    `);
    res.json(payouts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payouts/:id/approve', async (req, res) => {
  try {
    await run(`UPDATE payouts SET status='approved', reviewed_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payouts/:id/reject', async (req, res) => {
  const { reason } = req.body;
  try {
    await run(`UPDATE payouts SET status='rejected', rejection_reason=?, reviewed_at=? WHERE id=?`,
      [reason||'Rejected by admin', new Date().toISOString(), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payouts/:id/paid', async (req, res) => {
  const { tx_hash } = req.body;
  try {
    await run(`UPDATE payouts SET status='paid', tx_reference=?, paid_at=? WHERE id=?`,
      [tx_hash||'', new Date().toISOString(), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PRE-PAYOUT COMPLIANCE CHECK ───────────────────────────────────────────────
router.get('/payout-check/:funded_id', async (req, res) => {
  try {
    const result = await require('../services/riskEngine').prePayoutCheck(req.params.funded_id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
router.get('/audit-log', async (req, res) => {
  const { limit=100 } = req.query;
  try {
    const logs = await queryAll(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`, [parseInt(limit)]);
    res.json(logs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { search, limit=100 } = req.query;
  try {
    let q = `SELECT id, email, first_name, last_name, country, role, kyc_status, is_active, created_at FROM users WHERE 1=1`;
    const p = [];
    if (search) { q += ` AND (email ILIKE $${p.length+1} OR first_name ILIKE $${p.length+1} OR last_name ILIKE $${p.length+1})`; p.push('%'+search+'%'); }
    q += ` ORDER BY created_at DESC LIMIT ?`;  p.push(parseInt(limit));
    res.json(await queryAll(q, p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
