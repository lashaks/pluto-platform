/* ─────────────────────────────────────────────────────────────────────────────
   PlutoAdmin API Routes — broker-side dashboard (cBroker equivalent)
───────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { queryOne, queryAll, run } = require('../models/database');
const { v4: uuidv4 } = require('uuid');
const marketData  = require('../services/marketData');
const orderEngine = require('../services/orderEngine');

// All routes require admin
router.use(requireAdmin);

// ── GET /api/pluto-admin/overview ─────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [
      totalUsers, activeChals, failedChals, passedChals,
      fundedAccts, pendingPayouts, totalRevenue,
      openPositions, todayTrades,
    ] = await Promise.all([
      queryOne(`SELECT COUNT(*) as n FROM users WHERE role='trader'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='active'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='failed'`),
      queryOne(`SELECT COUNT(*) as n FROM challenges WHERE status='passed'`),
      queryOne(`SELECT COUNT(*) as n FROM funded_accounts WHERE status='active'`),
      queryOne(`SELECT COUNT(*) as n FROM payouts WHERE status='requested'`),
      queryOne(`SELECT COALESCE(SUM(ABS(amount)),0) as total FROM transactions WHERE type='purchase'`),
      queryOne(`SELECT COUNT(*) as n FROM trades WHERE status='open'`),
      queryOne(`SELECT COUNT(*) as n FROM trades WHERE status='closed' AND close_time > NOW()::TEXT::DATE::TEXT`),
    ]);
    res.json({
      total_users:      totalUsers?.n||0,
      active_challenges: activeChals?.n||0,
      failed_challenges: failedChals?.n||0,
      passed_challenges: passedChals?.n||0,
      funded_accounts:  fundedAccts?.n||0,
      pending_payouts:  pendingPayouts?.n||0,
      total_revenue:    totalRevenue?.total||0,
      open_positions:   openPositions?.n||0,
      today_trades:     todayTrades?.n||0,
      market_status:    _isMarketOpen() ? 'open' : 'closed',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/accounts — all trading accounts ─────────────────────
router.get('/accounts', async (req, res) => {
  const { status, limit=200, offset=0, search } = req.query;
  try {
    let q = `
      SELECT c.*, u.email, u.first_name, u.last_name, u.country,
        (SELECT COUNT(*) FROM trades t WHERE t.challenge_id=c.id AND t.status='open') as open_positions,
        (SELECT COALESCE(SUM(t.profit),0) FROM trades t WHERE t.challenge_id=c.id AND t.status='open') as floating_pnl
      FROM challenges c
      JOIN users u ON c.user_id=u.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { q += ` AND c.status=$${params.length+1}`; params.push(status); }
    if (search) { q += ` AND (u.email ILIKE $${params.length+1} OR u.first_name ILIKE $${params.length+1} OR c.id ILIKE $${params.length+1})`; params.push('%'+search+'%'); }
    q += ` ORDER BY c.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);
    const accounts = await queryAll(q, params);
    res.json(accounts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/accounts/:id — single account detail ─────────────────
router.get('/accounts/:id', async (req, res) => {
  try {
    const account = await queryOne(`
      SELECT c.*, u.email, u.first_name, u.last_name, u.country, u.kyc_status
      FROM challenges c JOIN users u ON c.user_id=u.id WHERE c.id=$1
    `, [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const positions = await queryAll(`SELECT * FROM trades WHERE challenge_id=$1 AND status='open'`, [req.params.id]);
    const history   = await queryAll(`SELECT * FROM trades WHERE challenge_id=$1 AND status='closed' ORDER BY close_time DESC LIMIT 50`, [req.params.id]);
    const floatPnL  = positions.reduce((s,t)=>s+(t.profit||0),0);
    res.json({ ...account, equity: (account.current_balance||0)+floatPnL, floating_pnl: floatPnL, positions, history });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/positions/all — ALL live positions ───────────────────
router.get('/positions/all', async (req, res) => {
  try {
    const positions = await queryAll(`
      SELECT t.*, u.email, u.first_name, u.last_name,
        c.account_size, c.max_daily_loss_pct, c.max_total_loss_pct
      FROM trades t
      JOIN users u ON t.user_id=u.id
      LEFT JOIN challenges c ON t.challenge_id=c.id
      WHERE t.status='open'
      ORDER BY t.open_time DESC
    `);
    // Enrich with live prices
    const enriched = positions.map(p => {
      const price = marketData.getPrice(p.symbol);
      const inst  = marketData.getInstrument(p.symbol);
      const mem   = orderEngine.positions[p.id];
      const livePnl = mem?.profit ?? p.profit;
      const curPx = price ? (p.direction==='buy' ? price.bid : price.ask) : p.open_price;
      const pips = inst ? (p.direction==='buy' ? curPx-p.open_price : p.open_price-curPx)/inst.pip : 0;
      return { ...p, profit: livePnl, current_price: curPx, pips: +pips.toFixed(1) };
    });
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/pluto-admin/accounts/:id/force-close ───────────────────────────
router.post('/accounts/:id/force-close', async (req, res) => {
  try {
    const account = await queryOne(`SELECT * FROM challenges WHERE id=$1`, [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await orderEngine.adminForceClose(req.params.id, null);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'ADMIN_FORCE_CLOSE','challenge',req.params.id,`Force closed by admin`]);
    res.json({ success: true, message: 'All positions closed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/pluto-admin/accounts/:id/breach ─────────────────────────────────
router.post('/accounts/:id/breach', async (req, res) => {
  const { reason = 'ADMIN_BREACH' } = req.body;
  try {
    await orderEngine.adminForceClose(req.params.id, null);
    await run(`UPDATE challenges SET status='failed', failed_at=?, breach_reason=? WHERE id=?`,
      [new Date().toISOString(), reason, req.params.id]);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'ADMIN_BREACH','challenge',req.params.id,`Breached by admin: ${reason}`]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/pluto-admin/accounts/:id/balance ───────────────────────────────
router.post('/accounts/:id/balance', async (req, res) => {
  const { operation, amount, reason } = req.body; // operation: 'credit' | 'debit'
  if (!operation||!amount) return res.status(400).json({ error: 'operation and amount required' });
  try {
    const account = await queryOne(`SELECT * FROM challenges WHERE id=$1`, [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const delta = operation==='credit' ? parseFloat(amount) : -parseFloat(amount);
    const newBal = +((account.current_balance||account.starting_balance)+delta).toFixed(2);
    await run(`UPDATE challenges SET current_balance=?,current_equity=? WHERE id=?`, [newBal,newBal,req.params.id]);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),`ADMIN_${operation.toUpperCase()}`,'challenge',req.params.id,`${operation} $${amount}: ${reason||'admin operation'}`]);
    res.json({ success: true, new_balance: newBal });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/pluto-admin/accounts/:id/settings ───────────────────────────────
router.put('/accounts/:id/settings', async (req, res) => {
  const { leverage, max_daily_loss_pct, max_total_loss_pct, profit_target_pct, profit_split_pct, status } = req.body;
  try {
    const fields = [], vals = [];
    if (leverage           !== undefined) { fields.push('leverage=?');            vals.push(leverage); }
    if (max_daily_loss_pct !== undefined) { fields.push('max_daily_loss_pct=?');   vals.push(max_daily_loss_pct); }
    if (max_total_loss_pct !== undefined) { fields.push('max_total_loss_pct=?');   vals.push(max_total_loss_pct); }
    if (profit_target_pct  !== undefined) { fields.push('profit_target_pct=?');    vals.push(profit_target_pct); }
    if (profit_split_pct   !== undefined) { fields.push('profit_split_pct=?');     vals.push(profit_split_pct); }
    if (status             !== undefined) { fields.push('status=?');               vals.push(status); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await run(`UPDATE challenges SET ${fields.join(',')} WHERE id=?`, vals);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'ADMIN_UPDATE_SETTINGS','challenge',req.params.id,`Updated: ${fields.join(', ')}`]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/sessions — active/recent sessions ───────────────────
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await queryAll(`
      SELECT s.*, u.email, u.first_name, u.last_name
      FROM sessions s JOIN users u ON s.user_id=u.id
      WHERE s.is_active=1 OR s.login_at > NOW()::TEXT::DATE::TEXT
      ORDER BY s.last_seen DESC LIMIT 100
    `);
    res.json(sessions);
  } catch(_) { res.json([]); } // sessions table may not exist yet
});

// ── GET /api/pluto-admin/symbols — symbol spread settings ────────────────────
router.get('/symbols', async (req, res) => {
  try {
    const inst = marketData.getInstruments();
    const settings = await queryAll(`SELECT * FROM symbol_settings`);
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.symbol] = s; });
    const symbols = Object.entries(inst).map(([sym, def]) => ({
      symbol: sym,
      name: def.name,
      type: def.type,
      base_spread: def.spread,
      pip: def.pip,
      digits: def.digits,
      ...settingsMap[sym],
      spread_markup: settingsMap[sym]?.spread_markup || 0,
      commission_per_lot: settingsMap[sym]?.commission_per_lot || 3.5,
      trading_enabled: settingsMap[sym]?.trading_enabled ?? 1,
    }));
    res.json(symbols);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/pluto-admin/symbols/:symbol ─────────────────────────────────────
router.put('/symbols/:symbol', async (req, res) => {
  try {
    await orderEngine.updateSymbolSettings(req.params.symbol.toUpperCase(), req.body);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/risk-alerts — accounts near breach ──────────────────
router.get('/risk-alerts', async (req, res) => {
  try {
    const accounts = await queryAll(`
      SELECT c.*, u.email,
        CASE WHEN c.current_equity IS NOT NULL THEN
          ((c.starting_balance - c.current_equity) / c.starting_balance * 100)
        ELSE 0 END as drawdown_pct,
        CASE WHEN c.day_start_balance IS NOT NULL AND c.current_equity IS NOT NULL THEN
          ((c.day_start_balance - c.current_equity) / c.day_start_balance * 100)
        ELSE 0 END as daily_loss_pct
      FROM challenges c
      JOIN users u ON c.user_id=u.id
      WHERE c.status='active'
    `);
    const alerts = accounts
      .filter(a => a.drawdown_pct > (a.max_total_loss_pct * 0.7) || a.daily_loss_pct > (a.max_daily_loss_pct * 0.7))
      .map(a => ({
        ...a,
        drawdown_warning: a.drawdown_pct > (a.max_total_loss_pct * 0.7),
        daily_warning:    a.daily_loss_pct > (a.max_daily_loss_pct * 0.7),
        risk_level: a.drawdown_pct > (a.max_total_loss_pct * 0.9) || a.daily_loss_pct > (a.max_daily_loss_pct * 0.9) ? 'critical' : 'warning',
      }));
    res.json(alerts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/payout-check/:funded_id — pre-payout compliance ──────
router.get('/payout-check/:funded_id', async (req, res) => {
  try {
    const riskEngine = require('../services/riskEngine');
    const result = await riskEngine.prePayoutCheck(req.params.funded_id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/pluto-admin/accounts/:id/risk-params — live risk param update ────
router.put('/accounts/:id/risk-params', async (req, res) => {
  try {
    const riskEngine = require('../services/riskEngine');
    await riskEngine.updateAccountRiskParams(req.params.id, req.body);
    res.json({ success: true, message: 'Risk parameters updated — takes effect on next tick check' });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── GET /api/pluto-admin/risk-engine/status ───────────────────────────────────
router.get('/risk-engine/status', (req, res) => {
  const riskEngine = require('../services/riskEngine');
  const now = new Date();
  const day = now.getUTCDay(), h = now.getUTCHours();
  const marketOpen = !(day===6||(day===0&&h<22)||(day===5&&h>=22));
  res.json({
    running: riskEngine.running,
    market_open: marketOpen,
    last_check_count: Object.keys(riskEngine.lastCheck).length,
    recent_breaches: riskEngine.recentBreaches.size,
    check_interval_ms: 5000,
  });
});

// ── POST /api/pluto-admin/risk-engine/reset-daily ─────────────────────────────
router.post('/risk-engine/reset-daily', async (req, res) => {
  try {
    const riskEngine = require('../services/riskEngine');
    await riskEngine.resetDailyBalances();
    res.json({ success: true, message: 'Daily balances reset' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function _isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay(), h = now.getUTCHours();
  return !(day===6 || (day===0 && h<22) || (day===5 && h>=22));
}

module.exports = router;
