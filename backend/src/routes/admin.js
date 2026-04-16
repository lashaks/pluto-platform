const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { queryAll, queryOne, run } = require('../models/database');
const { generateId, sanitize } = require('../utils/helpers');
const email = require('../services/email');

const router = express.Router();

// GET /api/admin/overview — dashboard stats
router.get('/overview', requireAdmin, async (req, res) => {
  const totalUsers = ((await queryOne(`SELECT COUNT(*) as c FROM users WHERE role='trader'`)) || {}).c || 0;
  const totalChallenges = ((await queryOne(`SELECT COUNT(*) as c FROM challenges`)) || {}).c || 0;
  const activeChallenges = ((await queryOne(`SELECT COUNT(*) as c FROM challenges WHERE status='active'`)) || {}).c || 0;
  const passedChallenges = ((await queryOne(`SELECT COUNT(*) as c FROM challenges WHERE status='passed'`)) || {}).c || 0;
  const failedChallenges = ((await queryOne(`SELECT COUNT(*) as c FROM challenges WHERE status='failed'`)) || {}).c || 0;
  const totalFunded = ((await queryOne(`SELECT COUNT(*) as c FROM funded_accounts WHERE status='active'`)) || {}).c || 0;
  const totalRevenue = ((await queryOne(`SELECT COALESCE(SUM(fee_paid),0) as s FROM challenges`)) || {}).s || 0;
  const totalPayouts = ((await queryOne(`SELECT COALESCE(SUM(trader_amount),0) as s FROM payouts WHERE status='paid'`)) || {}).s || 0;
  const pendingPayouts = ((await queryOne(`SELECT COUNT(*) as c FROM payouts WHERE status IN ('requested','approved')`)) || {}).c || 0;
  const pendingPayoutsAmount = ((await queryOne(`SELECT COALESCE(SUM(trader_amount),0) as s FROM payouts WHERE status IN ('requested','approved')`)) || {}).s || 0;
  const passRate = totalChallenges > 0 ? Math.round(passedChallenges / totalChallenges * 100) : 0;

  res.json({
    total_users: totalUsers,
    total_challenges: totalChallenges,
    active_challenges: activeChallenges,
    passed_challenges: passedChallenges,
    failed_challenges: failedChallenges,
    pass_rate: passRate,
    total_funded: totalFunded,
    total_revenue: +totalRevenue.toFixed(2),
    total_payouts: +totalPayouts.toFixed(2),
    net_revenue: +(totalRevenue - totalPayouts).toFixed(2),
    pending_payouts: pendingPayouts,
    pending_payouts_amount: +pendingPayoutsAmount.toFixed(2),
    reserve_health: totalRevenue > 0 ? +((totalRevenue - totalPayouts) / totalRevenue * 100).toFixed(1) : 100,
  });
});

// GET /api/admin/users
router.get('/users', requireAdmin, async (req, res) => {
  const users = await queryAll(`SELECT id, email, first_name, last_name, country, kyc_status, role, is_active, terms_accepted_at, created_at, last_login FROM users ORDER BY created_at DESC`);
  res.json(users);
});

// GET /api/admin/challenges
router.get('/challenges', requireAdmin, async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT c.*, u.email, u.first_name, u.last_name FROM challenges c JOIN users u ON c.user_id = u.id`;
  const params = [];
  if (status) { sql += ` WHERE c.status=$1`; params.push(status); }
  sql += ` ORDER BY c.created_at DESC`;
  res.json(await queryAll(sql, params));
});

// GET /api/admin/funded
router.get('/funded', requireAdmin, async (req, res) => {
  const accounts = await queryAll(`SELECT f.*, u.email, u.first_name, u.last_name FROM funded_accounts f JOIN users u ON f.user_id = u.id ORDER BY f.created_at DESC`);
  res.json(accounts);
});

// GET /api/admin/payouts
router.get('/payouts', requireAdmin, async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT p.*, u.email, u.first_name, u.last_name FROM payouts p JOIN users u ON p.user_id = u.id`;
  const params = [];
  if (status) { sql += ` WHERE p.status=$1`; params.push(status); }
  sql += ` ORDER BY p.requested_at DESC`;
  res.json(await queryAll(sql, params));
});

// POST /api/admin/payouts/:id/approve
router.post('/payouts/:id/approve', requireAdmin, async (req, res) => {
  await run(`UPDATE payouts SET status='approved', reviewed_by=?, approved_at=NOW()::TEXT WHERE id=?`, [req.user.id, req.params.id]);
  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'PAYOUT_APPROVED', 'payout', ?, 'Admin approved payout')`,
    [generateId(), req.user.id, req.params.id]);
  res.json({ success: true });
});

// POST /api/admin/payouts/:id/pay
router.post('/payouts/:id/pay', requireAdmin, async (req, res) => {
  const payout = await queryOne(`SELECT * FROM payouts WHERE id=$1`, [req.params.id]);
  if (!payout) return res.status(404).json({ error: 'Payout not found' });

  const { tx_reference } = req.body;

  await run(`UPDATE payouts SET status='paid', paid_at=NOW()::TEXT, tx_reference=? WHERE id=?`, [tx_reference || '', req.params.id]);

  // Update funded account totals AND reset balance to starting_balance (standard prop firm logic)
  if (payout.funded_account_id) {
    await run(`UPDATE funded_accounts SET 
      total_payouts = total_payouts + ?, 
      payout_count = payout_count + 1,
      current_balance = starting_balance,
      current_equity = starting_balance,
      highest_balance = starting_balance,
      lowest_equity = starting_balance,
      day_start_balance = starting_balance,
      total_profit = 0
      WHERE id=?`,
      [payout.trader_amount, payout.funded_account_id]);
  }

  // Record transaction
  await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id) VALUES (?, ?, 'payout', ?, ?, ?)`,
    [generateId(), payout.user_id, payout.trader_amount, `Profit payout: $${payout.trader_amount}`, payout.id]);

  // Fee refund on first payout (if not already refunded)
  if (payout.funded_account_id) {
    const funded = await queryOne(`SELECT challenge_id FROM funded_accounts WHERE id=$1`, [payout.funded_account_id]);
    if (funded?.challenge_id) {
      const ch = await queryOne(`SELECT fee_paid, fee_refunded FROM challenges WHERE id=$1`, [funded.challenge_id]);
      if (ch && !ch.fee_refunded) {
        await run(`UPDATE challenges SET fee_refunded=1 WHERE id=?`, [funded.challenge_id]);
        await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id) VALUES (?, ?, 'fee_refund', ?, ?, ?)`,
          [generateId(), payout.user_id, ch.fee_paid, `Challenge fee refund: $${ch.fee_paid}`, funded.challenge_id]);
        await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'FEE_REFUNDED', 'challenge', ?, ?)`,
          [generateId(), payout.user_id, funded.challenge_id, `Fee $${ch.fee_paid} refunded with first payout`]);
      }
    }
  }

  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'PAYOUT_PAID', 'payout', ?, ?)`,
    [generateId(), req.user.id, req.params.id, `Paid $${payout.trader_amount} via ${payout.payout_method}`]);

  // Send payout email to trader
  const usr = await queryOne(`SELECT first_name, email FROM users WHERE id='${payout.user_id}'`);
  if (usr) {
    email.sendPayoutProcessed(usr.email, usr.first_name || 'Trader', {
      gross: '$' + Number(payout.gross_profit).toLocaleString(),
      split: payout.split_pct,
      amount: '$' + Number(payout.trader_amount).toLocaleString(),
      method: (payout.payout_method || '').replace(/_/g, ' ').toUpperCase(),
      tx_ref: payout.tx_reference || '',
    }).catch(e => console.error('[Admin] Payout email error:', e.message));
  }

  res.json({ success: true });
});

// POST /api/admin/payouts/:id/reject
router.post('/payouts/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  await run(`UPDATE payouts SET status='rejected', rejected_reason=? WHERE id=?`, [reason || 'Rejected by admin', req.params.id]);
  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'PAYOUT_REJECTED', 'payout', ?, ?)`,
    [generateId(), req.user.id, req.params.id, `Rejected: ${reason || 'No reason given'}`]);
  res.json({ success: true });
});

// POST /api/admin/users/:id/suspend
router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  await run(`UPDATE users SET is_active=0 WHERE id=?`, [req.params.id]);
  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'USER_SUSPENDED', 'user', ?, 'Admin suspended user')`,
    [generateId(), req.user.id, req.params.id]);
  res.json({ success: true });
});

// POST /api/admin/users/:id/activate
router.post('/users/:id/activate', requireAdmin, async (req, res) => {
  await run(`UPDATE users SET is_active=1 WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

// POST /api/admin/users/:id/kyc-approve — manual KYC override
router.post('/users/:id/kyc-approve', requireAdmin, async (req, res) => {
  await run(`UPDATE users SET kyc_status='approved' WHERE id=?`, [req.params.id]);
  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'KYC_MANUAL_APPROVE', 'user', ?, 'Admin manually approved KYC')`,
    [generateId(), req.user.id, req.params.id]);
  res.json({ success: true });
});

// GET /api/admin/audit-log
router.get('/audit-log', requireAdmin, async (req, res) => {
  const logs = await queryAll(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200`);
  res.json(logs);
});

// GET /api/admin/transactions
router.get('/transactions', requireAdmin, async (req, res) => {
  const txns = await queryAll(`SELECT t.*, u.email, u.first_name, u.last_name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 200`);
  res.json(txns);
});

// === DISCOUNT CODES ===
router.get('/discount-codes', requireAdmin, async (req, res) => {
  const codes = await queryAll(`SELECT * FROM discount_codes ORDER BY created_at DESC`);
  res.json(codes);
});

router.post('/discount-codes', requireAdmin, async (req, res) => {
  const { code, discount_pct, max_uses, valid_until } = req.body;
  if (!code || !discount_pct) return res.status(400).json({ error: 'Code and discount_pct required' });
  if (discount_pct < 1 || discount_pct > 100) return res.status(400).json({ error: 'Discount must be 1-100%' });
  const id = generateId();
  await run(`INSERT INTO discount_codes (id, code, discount_pct, max_uses, valid_until, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, code.toUpperCase().trim(), discount_pct, max_uses || 0, valid_until || '', req.user.id]);
  res.status(201).json({ id, code: code.toUpperCase().trim(), discount_pct, max_uses: max_uses || 0 });
});

router.delete('/discount-codes/:id', requireAdmin, async (req, res) => {
  await run(`UPDATE discount_codes SET is_active=0 WHERE id=$1`, [req.params.id]);
  res.json({ success: true });
});

// === CTRADER HEALTH + SYNC ===
router.get('/ctrader/status', requireAdmin, async (req, res) => {
  const ctrader = require('../services/ctrader');
  const raw = ctrader.raw;
  res.json({
    enabled: ctrader.enabled,
    connected: !!(raw && raw.connected),
    authenticated: !!(raw && raw.authenticated),
    host: raw?.host,
    managerId: raw?.login,
    groupId: raw?.groupId,
  });
});

router.post('/ctrader/sync-trader/:traderId', requireAdmin, async (req, res) => {
  const ctrader = require('../services/ctrader');
  try {
    const info = await ctrader.getAccountInfo(req.params.traderId);
    res.json({ success: true, info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/challenges/:id/risk-check', requireAdmin, async (req, res) => {
  const riskEngine = require('../services/riskEngine');
  try {
    const result = await riskEngine.checkChallenge(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === PLATFORM SETTINGS ===
router.get('/settings', requireAdmin, async (req, res) => {
  const settings = await queryAll(`SELECT key, value FROM platform_settings`);
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

router.post('/settings/demo-mode', requireAdmin, async (req, res) => {
  const { enabled } = req.body;
  const val = enabled ? 'true' : 'false';
  await run(`UPDATE platform_settings SET value=$1, updated_at=NOW()::TEXT WHERE key='demo_mode'`, [val]);
  await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES ($1, $2, 'DEMO_MODE_TOGGLED', $3)`,
    [generateId(), req.user.id, `Demo mode ${enabled ? 'ENABLED' : 'DISABLED'}`]);
  res.json({ demo_mode: enabled });
});

// === ADMIN USER MANAGEMENT ===
router.post('/users/:id/promote', requireAdmin, async (req, res) => {
  const { role } = req.body; // 'admin', 'support_admin', 'finance_admin'
  const validRoles = ['admin', 'support_admin', 'finance_admin', 'trader'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  await run(`UPDATE users SET role=$1, updated_at=NOW()::TEXT WHERE id=$2`, [role, req.params.id]);
  await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES ($1, $2, 'USER_ROLE_CHANGED', 'user', $3, $4)`,
    [generateId(), req.user.id, req.params.id, `Role changed to ${role}`]);
  res.json({ success: true, role });
});

module.exports = router;
