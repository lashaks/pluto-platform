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
  const users = await queryAll(`SELECT id, email, first_name, last_name, country, kyc_status, role, is_active, created_at, last_login FROM users ORDER BY created_at DESC`);
  res.json(users);
});

// GET /api/admin/challenges
router.get('/challenges', requireAdmin, async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT c.*, u.email, u.first_name, u.last_name FROM challenges c JOIN users u ON c.user_id = u.id`;
  if (status) sql += ` WHERE c.status='${sanitize(status)}'`;
  sql += ` ORDER BY c.created_at DESC`;
  res.json(await queryAll(sql));
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
  if (status) sql += ` WHERE p.status='${sanitize(status)}'`;
  sql += ` ORDER BY p.requested_at DESC`;
  res.json(await queryAll(sql));
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
  const payout = await queryOne(`SELECT * FROM payouts WHERE id='${sanitize(req.params.id)}'`);
  if (!payout) return res.status(404).json({ error: 'Payout not found' });

  await run(`UPDATE payouts SET status='paid', paid_at=NOW()::TEXT WHERE id=?`, [req.params.id]);

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

module.exports = router;
