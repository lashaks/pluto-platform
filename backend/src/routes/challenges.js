const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne, run } = require('../models/database');
const { generateId, generateLogin, generatePassword, sanitize } = require('../utils/helpers');
const ctrader = require('../services/ctrader');
const payments = require('../services/payments');
const config = require('../../config');
const email = require('../services/email');

const router = express.Router();

// GET /api/challenges — list user's challenges
router.get('/', authenticate, async (req, res) => {
  const challenges = await queryAll(`SELECT * FROM challenges WHERE user_id='${req.user.id}' ORDER BY created_at DESC`);
  res.json(challenges);
});

// GET /api/challenges/:id — single challenge
router.get('/:id', authenticate, async (req, res) => {
  const ch = await queryOne(`SELECT * FROM challenges WHERE id='${sanitize(req.params.id)}' AND user_id='${req.user.id}'`);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });
  res.json(ch);
});

// POST /api/challenges/purchase — buy a new challenge
router.post('/purchase', authenticate, async (req, res) => {
  try {
    const { account_size, profit_split, challenge_type, payment_method } = req.body;
    const fee = config.challengePricing[account_size];
    if (!fee) return res.status(400).json({ error: 'Invalid account size', valid_sizes: Object.keys(config.challengePricing).map(Number) });

    const type = challenge_type === 'two_step' ? 'two_step' : 'one_step';
    const rules = type === 'two_step' ? config.twoStepRules : config.oneStepRules;
    const split = profit_split === 90 ? 90 : rules.profit_split_pct;
    let totalFee = split === 90 ? Math.round(fee * 1.3) : fee;

    // 2-step is 20% cheaper
    if (type === 'two_step') totalFee = Math.round(totalFee * 0.8);

    // Profit targets from rules
    const profitTarget = type === 'two_step' ? rules.phase1_target_pct : rules.profit_target_pct;
    const maxDaily = rules.max_daily_loss_pct;
    const maxDrawdown = rules.max_total_loss_pct;

    const id = generateId();

    // If crypto payment — create invoice and return URL
    if (payment_method === 'crypto' || !payment_method) {
      try {
        const invoice = await payments.createCryptoInvoice({
          amount: totalFee,
          orderId: id,
          description: `$${(account_size/1000)}K ${type === 'two_step' ? '2-Step' : '1-Step'} Challenge`,
          successUrl: 'https://pluto-platform.vercel.app?purchased=true',
          cancelUrl: 'https://pluto-platform.vercel.app',
        });

        // Create challenge in pending_payment status
        await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, starting_balance, current_balance, current_equity,
             highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
             profit_target_pct, max_daily_loss_pct, max_total_loss_pct, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
          [id, req.user.id, account_size, type, account_size, account_size, account_size,
           account_size, account_size, account_size, totalFee, split, rules.leverage,
           profitTarget, maxDaily, maxDrawdown]);

        await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'PAYMENT_INITIATED', 'challenge', ?, ?)`,
          [generateId(), req.user.id, id, `Crypto payment initiated: $${totalFee} for $${(account_size/1000)}K ${type}`]);

        return res.status(201).json({
          challenge_id: id,
          payment_url: invoice.invoiceUrl,
          invoice_id: invoice.invoiceId,
          fee: totalFee,
          message: 'Complete your crypto payment to activate the challenge.',
        });
      } catch (payErr) {
        console.error('[Purchase] Crypto payment error:', payErr.message);
        // Fall through to demo mode if NOWPayments fails
      }
    }

    // Demo/fallback mode — activate immediately (for testing or when payment processor is down)
    const ctraderResult = await ctrader.createAccount({
      balance: account_size,
      leverage: rules.leverage,
      group: 'demo_prop_evaluation',
    });

    await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, starting_balance, current_balance, current_equity,
         highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
         profit_target_pct, max_daily_loss_pct, max_total_loss_pct,
         ctrader_login, ctrader_account_id, ctrader_server, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW()::TEXT)`,
      [id, req.user.id, account_size, type, account_size, account_size, account_size,
       account_size, account_size, account_size, totalFee, split, rules.leverage,
       profitTarget, maxDaily, maxDrawdown,
       ctraderResult.login, ctraderResult.accountId, ctraderResult.server]);

    await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id, payment_method)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`,
      [generateId(), req.user.id, -totalFee, `$${(account_size/1000)}K ${type === 'two_step' ? '2-Step' : '1-Step'} Challenge`, id, payment_method || 'demo']);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_CREATED', 'challenge', ?, ?)`,
      [generateId(), req.user.id, id, `$${(account_size/1000)}K ${type} challenge purchased for $${totalFee}`]);

    // Send purchase confirmation email
    const usr = await queryOne(`SELECT first_name, email FROM users WHERE id='${req.user.id}'`);
    if (usr) {
      email.sendChallengePurchased(usr.email, usr.first_name || 'Trader', {
        account_size, challenge_type: type, profit_target: profitTarget,
        daily_loss: maxDaily, max_drawdown: maxDrawdown, profit_split: split,
        fee: totalFee, login: ctraderResult.login, server: ctraderResult.server,
      }).catch(e => console.error('[Challenge] Email error:', e.message));
    }

    res.status(201).json({
      challenge_id: id,
      account_size,
      fee_paid: totalFee,
      profit_split: split,
      challenge_type: type,
      ctrader: { login: ctraderResult.login, password: ctraderResult.password, server: ctraderResult.server },
      rules: { profit_target: profitTarget, max_daily_loss: maxDaily, max_total_drawdown: maxDrawdown },
      message: 'Challenge activated! Log into cTrader with your credentials to start trading.',
    });
  } catch (e) {
    console.error('Purchase error:', e);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
});

// GET /api/challenges/:id/risk-check
router.get('/:id/risk-check', authenticate, async (req, res) => {
  const riskEngine = require('../services/riskEngine');
  const result = await riskEngine.checkChallenge(req.params.id);
  res.json(result);
});

// GET /api/challenges/info/pricing
router.get('/info/pricing', async (req, res) => {
  const plans = Object.entries(config.challengePricing).map(([size, fee]) => ({
    size: Number(size), fee,
    profit_target: 10,
    daily_loss: maxDaily,
    max_drawdown: maxDrawdown,
    split: 80,
    leverage: Number(size) >= 50000 ? '1:20' : '1:30',
  }));
  res.json(plans);
});

module.exports = router;
