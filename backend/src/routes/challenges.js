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
  const challenges = await queryAll(`SELECT * FROM challenges WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json(challenges);
});

// GET /api/challenges/validate-code?code=XXX — MUST be before /:id
router.get('/validate-code', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.json({ valid: false });
  const dc = await queryOne(`SELECT code, discount_pct, max_uses, current_uses, valid_until FROM discount_codes WHERE code=$1 AND is_active=1`, [code.toUpperCase().trim()]);
  if (!dc) return res.json({ valid: false, error: 'Invalid code' });
  const now = new Date().toISOString();
  if (dc.valid_until && dc.valid_until < now) return res.json({ valid: false, error: 'Code expired' });
  if (dc.max_uses > 0 && dc.current_uses >= dc.max_uses) return res.json({ valid: false, error: 'Code fully redeemed' });
  res.json({ valid: true, code: dc.code, discount_pct: dc.discount_pct });
});

// GET /api/challenges/:id — single challenge (must be AFTER named routes)
router.get('/:id', authenticate, async (req, res) => {
  const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });
  res.json(ch);
});

// POST /api/challenges/purchase — buy a new challenge
router.post('/purchase', authenticate, async (req, res) => {
  try {
    const { account_size, profit_split, challenge_type, payment_method, discount_code, platform } = req.body;
    const fee = config.challengePricing[account_size];
    if (!fee) return res.status(400).json({ error: 'Invalid account size', valid_sizes: Object.keys(config.challengePricing).map(Number) });

    // Platform selection — only cTrader live at launch; MT5 and Match-Trader coming soon
    const validPlatforms = ['ctrader']; // add 'mt5', 'matchtrader' when integrated
    const selectedPlatform = validPlatforms.includes(platform) ? platform : 'ctrader';

    const type = challenge_type === 'two_step' ? 'two_step' : 'one_step';
    const rules = type === 'two_step' ? config.twoStepRules : config.oneStepRules;
    const split = profit_split === 90 ? 90 : rules.profit_split_pct;
    let totalFee = split === 90 ? Math.round(fee * 1.3) : fee;

    // 2-step is 20% cheaper
    if (type === 'two_step') totalFee = Math.round(totalFee * 0.8);

    // Apply discount code
    let discountApplied = null;
    if (discount_code) {
      const dc = await queryOne(`SELECT * FROM discount_codes WHERE code=$1 AND is_active=1`, [discount_code.toUpperCase().trim()]);
      if (dc) {
        const now = new Date().toISOString();
        const expired = dc.valid_until && dc.valid_until < now;
        const maxedOut = dc.max_uses > 0 && dc.current_uses >= dc.max_uses;
        if (!expired && !maxedOut) {
          const discount = Math.round(totalFee * dc.discount_pct / 100);
          totalFee = totalFee - discount;
          discountApplied = { code: dc.code, pct: dc.discount_pct, saved: discount };
          await run(`UPDATE discount_codes SET current_uses = current_uses + 1 WHERE id=$1`, [dc.id]);
        }
      }
    }

    // Profit targets from rules
    const profitTarget = type === 'two_step' ? rules.phase1_target_pct : rules.profit_target_pct;
    const maxDaily = rules.max_daily_loss_pct;
    const maxDrawdown = rules.max_total_loss_pct;

    const id = generateId();

    // Check if demo mode is enabled (admin toggle)
    const demoSetting = await queryOne(`SELECT value FROM platform_settings WHERE key='demo_mode'`);
    const isDemoMode = demoSetting?.value === 'true';

    // If crypto payment AND not demo mode — create invoice and return URL
    if ((payment_method === 'crypto' || !payment_method) && !isDemoMode) {
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
             profit_target_pct, max_daily_loss_pct, max_total_loss_pct, platform, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
          [id, req.user.id, account_size, type, account_size, account_size, account_size,
           account_size, account_size, account_size, totalFee, split, rules.leverage,
           profitTarget, maxDaily, maxDrawdown, selectedPlatform]);

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

    // Fetch user for name/email on the cTrader account
    const creatorUser = await queryOne(`SELECT first_name, last_name, email FROM users WHERE id=$1`, [req.user.id]);

    // Demo/fallback mode — activate immediately (for testing or when payment processor is down)
    const ctraderResult = await ctrader.createAccount({
      balance: account_size,
      leverage: rules.leverage,
      group: 'demo_prop_evaluation',
      name: creatorUser ? `${creatorUser.first_name || ''} ${creatorUser.last_name || ''}`.trim() : '',
      email: creatorUser?.email || '',
    });

    await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, starting_balance, current_balance, current_equity,
         highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
         profit_target_pct, max_daily_loss_pct, max_total_loss_pct, platform,
         ctrader_login, ctrader_account_id, ctrader_server, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW()::TEXT)`,
      [id, req.user.id, account_size, type, account_size, account_size, account_size,
       account_size, account_size, account_size, totalFee, split, rules.leverage,
       profitTarget, maxDaily, maxDrawdown, selectedPlatform,
       ctraderResult.login, ctraderResult.accountId, ctraderResult.server]);

    await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id, payment_method)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`,
      [generateId(), req.user.id, -totalFee, `$${(account_size/1000)}K ${type === 'two_step' ? '2-Step' : '1-Step'} Challenge`, id, payment_method || 'demo']);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_CREATED', 'challenge', ?, ?)`,
      [generateId(), req.user.id, id, `$${(account_size/1000)}K ${type} challenge purchased for $${totalFee}`]);

    // Send purchase confirmation email
    const usr = await queryOne(`SELECT first_name, email FROM users WHERE id=$1`, [req.user.id]);
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
    one_step: { target: 10, daily: 5, dd: 8, split: 80, leverage: '1:30' },
    two_step: { target: '8 / 5', daily: 5, dd: 10, split: 80, leverage: '1:30' },
  }));
  res.json(plans);
});

module.exports = router;
