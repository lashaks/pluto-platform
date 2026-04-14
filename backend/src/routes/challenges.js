const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne, run } = require('../models/database');
const { generateId, generateLogin, generatePassword, sanitize } = require('../utils/helpers');
const ctrader = require('../services/ctrader');
const config = require('../../config');

const router = express.Router();

// GET /api/challenges — list all user's challenges
router.get('/', authenticate, (req, res) => {
  const challenges = queryAll(`SELECT * FROM challenges WHERE user_id='${req.user.id}' ORDER BY created_at DESC`);
  res.json(challenges);
});

// GET /api/challenges/:id — single challenge detail
router.get('/:id', authenticate, (req, res) => {
  const ch = queryOne(`SELECT * FROM challenges WHERE id='${sanitize(req.params.id)}' AND user_id='${req.user.id}'`);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });
  res.json(ch);
});

// POST /api/challenges/purchase — buy a new challenge
router.post('/purchase', authenticate, async (req, res) => {
  try {
    const { account_size, profit_split, payment_method } = req.body;
    const fee = config.challengePricing[account_size];
    if (!fee) return res.status(400).json({ error: 'Invalid account size', valid_sizes: Object.keys(config.challengePricing).map(Number) });

    const split = profit_split === 90 ? 90 : config.defaultRules.profit_split_pct;
    const totalFee = split === 90 ? Math.round(fee * 1.3) : fee;

    // Create cTrader demo account
    const ctraderResult = await ctrader.createAccount({
      balance: account_size,
      leverage: config.defaultRules.leverage,
      group: 'demo_prop_evaluation',
    });

    const id = generateId();
    run(`INSERT INTO challenges (id, user_id, account_size, starting_balance, current_balance, current_equity,
         highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
         profit_target_pct, max_daily_loss_pct, max_total_loss_pct,
         ctrader_login, ctrader_account_id, ctrader_server, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`,
      [id, req.user.id, account_size, account_size, account_size, account_size,
       account_size, account_size, account_size, totalFee, split, config.defaultRules.leverage,
       account_size >= 500000 ? 8 : config.defaultRules.profit_target_pct,
       config.defaultRules.max_daily_loss_pct, config.defaultRules.max_total_loss_pct,
       ctraderResult.login, ctraderResult.accountId, ctraderResult.server]);

    // Record transaction
    run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id, payment_method)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`,
      [generateId(), req.user.id, -totalFee, `$${(account_size/1000)}K Challenge Purchase`, id, payment_method || 'card']);

    // Audit log
    run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_CREATED', 'challenge', ?, ?)`,
      [generateId(), req.user.id, id, `$${(account_size/1000)}K challenge purchased for $${totalFee}`]);

    res.status(201).json({
      challenge_id: id,
      account_size,
      fee_paid: totalFee,
      profit_split: split,
      ctrader: {
        login: ctraderResult.login,
        password: ctraderResult.password,
        server: ctraderResult.server,
      },
      rules: {
        profit_target: account_size >= 500000 ? 8 : config.defaultRules.profit_target_pct,
        max_daily_loss: config.defaultRules.max_daily_loss_pct,
        max_total_drawdown: config.defaultRules.max_total_loss_pct,
      },
      message: 'Challenge activated! Log into cTrader with your credentials to start trading.',
    });
  } catch (e) {
    console.error('Purchase error:', e);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
});

// GET /api/challenges/:id/risk-check — manual risk check (dev/admin)
router.get('/:id/risk-check', authenticate, async (req, res) => {
  const riskEngine = require('../services/riskEngine');
  const result = await riskEngine.checkChallenge(req.params.id);
  res.json(result);
});

// GET /api/challenges/pricing — public pricing info
router.get('/info/pricing', (req, res) => {
  const plans = Object.entries(config.challengePricing).map(([size, fee]) => ({
    size: Number(size),
    fee,
    profit_target: Number(size) >= 500000 ? 8 : config.defaultRules.profit_target_pct,
    daily_loss: config.defaultRules.max_daily_loss_pct,
    max_drawdown: config.defaultRules.max_total_loss_pct,
    split: config.defaultRules.profit_split_pct,
    leverage: Number(size) >= 200000 ? '1:20' : Number(size) >= 50000 ? '1:20' : '1:30',
  }));
  res.json(plans);
});

module.exports = router;
