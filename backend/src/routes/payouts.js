const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne, run } = require('../models/database');
const { generateId, sanitize } = require('../utils/helpers');
const config = require('../../config');

const router = express.Router();

// GET /api/payouts
router.get('/', authenticate, async (req, res) => {
  const payouts = await queryAll(`SELECT * FROM payouts WHERE user_id='${req.user.id}' ORDER BY requested_at DESC`);
  res.json(payouts);
});

// POST /api/payouts/request
router.post('/request', authenticate, async (req, res) => {
  try {
    const { funded_account_id, payout_method, wallet_address } = req.body;
    if (!funded_account_id) return res.status(400).json({ error: 'funded_account_id is required' });

    const acct = await queryOne(`SELECT * FROM funded_accounts WHERE id='${sanitize(funded_account_id)}' AND user_id='${req.user.id}'`);
    if (!acct) return res.status(404).json({ error: 'Funded account not found' });
    if (acct.status !== 'active') return res.status(400).json({ error: 'Account is not active' });

    // Check KYC
    const user = await queryOne(`SELECT kyc_status FROM users WHERE id='${req.user.id}'`);
    if (user?.kyc_status !== 'approved') {
      return res.status(400).json({ error: 'KYC verification required before requesting a payout', code: 'KYC_REQUIRED' });
    }

    // Check pending payouts
    const pending = await queryOne(`SELECT COUNT(*) as c FROM payouts WHERE funded_account_id='${funded_account_id}' AND status IN ('requested','under_review','approved','processing')`);
    if (pending?.c > 0) return res.status(400).json({ error: 'You already have a pending payout for this account' });

    // Calculate profit
    const profit = acct.current_balance - acct.starting_balance;
    if (profit < config.defaultRules.min_payout) {
      return res.status(400).json({ error: `Minimum profit for payout is $${config.defaultRules.min_payout}` });
    }

    const traderAmount = +(profit * acct.profit_split_pct / 100).toFixed(2);
    const firmAmount = +(profit - traderAmount).toFixed(2);

    const id = generateId();
    await run(`INSERT INTO payouts (id, user_id, funded_account_id, gross_profit, split_pct, trader_amount, firm_amount, payout_method, wallet_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, funded_account_id, profit, acct.profit_split_pct, traderAmount, firmAmount,
       payout_method || 'crypto_usdt', wallet_address || '']);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'PAYOUT_REQUESTED', 'payout', ?, ?)`,
      [generateId(), req.user.id, id, `Payout of $${traderAmount} requested via ${payout_method || 'crypto_usdt'}`]);

    res.status(201).json({
      payout_id: id,
      gross_profit: profit,
      split_pct: acct.profit_split_pct,
      trader_amount: traderAmount,
      firm_amount: firmAmount,
      status: 'requested',
      message: 'Payout request submitted. Processing within 24 hours.',
    });
  } catch (e) {
    console.error('Payout request error:', e);
    res.status(500).json({ error: 'Failed to submit payout request' });
  }
});

module.exports = router;
