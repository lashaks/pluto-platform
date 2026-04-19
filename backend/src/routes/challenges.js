const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne, run } = require('../models/database');
const { generateId, generateLogin, generatePassword, sanitize } = require('../utils/helpers');
const payments = require('../services/payments');
const config = require('../../config');
const email = require('../services/email');

const router = express.Router();

// GET /api/challenges — list user's challenges

// ── PUBLIC: Get all challenge types for buy page ──────────────────────────────
router.get('/types', async (req, res) => {
  try {
    const { queryAll } = require('../models/database');
    const config = require('../../config');
    
    // Get all types from DB (admin-editable)
    const dbTypes = await queryAll('SELECT * FROM challenge_types WHERE is_active=1 ORDER BY display_order ASC');
    
    // If DB has types, use those exclusively
    if (dbTypes.length > 0) {
      const types = dbTypes.map(t => {
        const pricing = JSON.parse(t.pricing_json || '{}');
        const rules = JSON.parse(t.rules_json || '{}');
        return {
          slug: t.slug,
          name: t.name,
          description: t.description || '',
          plans: Object.entries(pricing).map(([size, fee]) => ({
            size: parseInt(size),
            fee,
            target: rules.profit_target_pct || 10,
            daily: rules.max_daily_loss_pct || 5,
            dd: rules.max_total_loss_pct || 8,
            split: rules.profit_split_pct || 80,
            lev: rules.leverage || '1:30',
            consistency: rules.consistency_rule_pct,
            min_days: rules.min_trading_days || 0,
            phases: rules.phases || 1,
            phase2_target: rules.phase2_target_pct || 5,
          })).sort((a,b) => a.size - b.size),
        };
      });
      return res.json(types);
    }
    
    // Fallback: return config-based types
    const mkPlans = (pricing, rules, phases) => Object.entries(pricing).map(([s,f]) => ({
      size:parseInt(s), fee:f, target:rules.profit_target_pct||rules.phase1_target_pct||10,
      daily:rules.max_daily_loss_pct||5, dd:rules.max_total_loss_pct||8,
      split:rules.profit_split_pct||80, lev:rules.leverage||'1:30',
      consistency:rules.consistency_rule_pct, phases:phases||1
    })).sort((a,b)=>a.size-b.size);
    
    res.json([
      { slug:'one_step', name:'Pluto Classic', description:'1-Step evaluation', plans: mkPlans(config.challengePricing, config.oneStepRules, 1) },
      { slug:'two_step', name:'Pluto Dual', description:'2-Step evaluation', plans: mkPlans(config.challengePricing, config.twoStepRules, 2) },
      { slug:'rapid', name:'PlutoRapid', description:'Fast track, no consistency', plans: mkPlans(config.rapidPricing, config.rapidRules, 1) },
    ]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
    // Block unverified users
    const buyer = await queryOne('SELECT email_verified FROM users WHERE id=$1', [req.user.id]);
    if (!buyer?.email_verified) return res.status(403).json({ error: 'Please verify your email before purchasing a challenge' });

    const { account_size, profit_split, challenge_type, payment_method, discount_code, platform } = req.body;
    // Max 5 active accounts per user
    const activeCount = await queryOne('SELECT COUNT(*) as c FROM challenges WHERE user_id=$1 AND status IN (\'active\',\'pending_payment\')', [req.user.id]);
    if (parseInt(activeCount?.c || 0) >= 5) return res.status(400).json({ error: 'Maximum 5 active challenges. Close or complete existing ones first.' });

    const type = ['two_step','rapid'].includes(challenge_type) ? challenge_type : 'one_step';
    const selectedPlatform = 'plutotrade';

    // Dynamic pricing: check DB first, fall back to config
    let pricingTable = type === 'rapid' ? config.rapidPricing : config.challengePricing;
    try {
      const dbType = await queryOne(`SELECT pricing_json FROM challenge_types WHERE slug=$1 AND is_active=1`, [type]);
      if (dbType?.pricing_json) pricingTable = JSON.parse(dbType.pricing_json);
    } catch(_) {}
    const fee = pricingTable[account_size];
    if (!fee) return res.status(400).json({ error: 'Invalid account size', valid_sizes: Object.keys(pricingTable).map(Number) });
    // Read rules: DB first (admin-created types), config fallback
    let rules = type === 'two_step' ? config.twoStepRules
                : type === 'rapid'    ? config.rapidRules
                :                       config.oneStepRules;
    try {
      const dbRules = await queryOne(`SELECT rules_json FROM challenge_types WHERE slug=$1 AND is_active=1`, [type]);
      if (dbRules?.rules_json) rules = { ...rules, ...JSON.parse(dbRules.rules_json) };
    } catch(_) {}
    const split = profit_split === 90 ? 90 : rules.profit_split_pct;
    let totalFee = split === 90 ? Math.round(fee * 1.3) : fee;

    // 2-step is 20% cheaper
    if (type === 'two_step') totalFee = Math.round(totalFee * 0.8);
    // rapid uses its own pricing table already

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
          totalFee = Math.max(1, totalFee - discount); // Floor at $1 — no free/negative challenges
          discountApplied = { code: dc.code, pct: dc.discount_pct, saved: discount };
          await run(`UPDATE discount_codes SET current_uses = current_uses + 1 WHERE id=$1`, [dc.id]);
        }
      }
    }

    // Profit targets from rules
    const profitTarget = type === 'two_step' ? rules.phase1_target_pct
                       : rules.profit_target_pct;
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

    // Create PlutoTrader account — same email as prop firm login
    const creatorUser = await queryOne(`SELECT first_name, last_name, email FROM users WHERE id=$1`, [req.user.id]);
    const traderLogin = creatorUser?.email || req.user.email;
    const traderPassword = generateId().slice(0, 12); // random 12-char password
    const terminalUrl = process.env.PLUTOTRADE_URL || '/terminal.html';

    await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, starting_balance, current_balance, current_equity,
         highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
         profit_target_pct, max_daily_loss_pct, max_total_loss_pct, platform,
         ctrader_login, ctrader_account_id, ctrader_server, ctrader_password, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW()::TEXT)`,
      [id, req.user.id, account_size, type, account_size, account_size, account_size,
       account_size, account_size, account_size, totalFee, split, rules.leverage,
       profitTarget, maxDaily, maxDrawdown, 'plutotrade',
       traderLogin, id, 'PlutoTrader', traderPassword]);

    await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id, payment_method)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`,
      [generateId(), req.user.id, -totalFee, `$${(account_size/1000)}K ${type === 'two_step' ? '2-Step' : '1-Step'} Challenge`, id, payment_method || 'demo']);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_CREATED', 'challenge', ?, ?)`,
      [generateId(), req.user.id, id, `$${(account_size/1000)}K ${type} challenge purchased for $${totalFee}`]);

    // Send purchase confirmation email with PlutoTrader credentials
    if (creatorUser) {
      email.sendChallengePurchased(creatorUser.email, creatorUser.first_name || 'Trader', {
        account_size, challenge_type: type, profit_target: profitTarget,
        daily_loss: maxDaily, max_drawdown: maxDrawdown, profit_split: split,
        fee: totalFee,
        login: traderLogin, password: traderPassword, server: 'PlutoTrader Terminal',
        terminal_url: terminalUrl,
      }).catch(e => console.error('[Challenge] Email error:', e.message));
    }

    res.status(201).json({
      challenge_id: id,
      account_size,
      fee_paid: totalFee,
      profit_split: split,
      challenge_type: type,
      terminal: { login: traderLogin, password: traderPassword, url: terminalUrl },
      rules: { profit_target: profitTarget, max_daily_loss: maxDaily, max_total_drawdown: maxDrawdown },
      message: 'Challenge activated! Open PlutoTrader to start trading.',
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

// POST /api/challenges/:id/reset — reset a failed challenge with 10% discount
router.post('/:id/reset', authenticate, async (req, res) => {
  try {
    const old = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!old) return res.status(404).json({ error: 'Challenge not found' });
    if (old.status !== 'failed') return res.status(400).json({ error: 'Only failed challenges can be reset' });

    const baseFee = config.challengePricing[old.account_size];
    if (!baseFee) return res.status(400).json({ error: 'Invalid account size' });
    const resetFee = Math.round(baseFee * 0.9); // 10% discount

    // Check demo mode
    const demoSetting = await queryOne(`SELECT value FROM platform_settings WHERE key='demo_mode'`);
    const isDemoMode = demoSetting?.value === 'true';

    const type = old.challenge_type;
    const rules = type === 'two_step' ? config.twoStepRules : config.oneStepRules;
    const profitTarget = type === 'two_step' ? rules.phase1_target_pct
                       : rules.profit_target_pct;
    const id = generateId();

    if (!isDemoMode) {
      // In live mode, create pending challenge (would need payment)
      return res.status(400).json({ error: 'Account reset requires payment. Use the Buy Challenge page with promo code RESET10.' });
    }

    // Demo mode — activate immediately
    const creatorUser = await queryOne(`SELECT first_name, last_name, email FROM users WHERE id=$1`, [req.user.id]);
    const traderLogin = creatorUser?.email || req.user.email;
    const traderPassword = generateId().slice(0, 12);
    const terminalUrl = process.env.PLUTOTRADE_URL || '/terminal.html';

    await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, starting_balance, current_balance, current_equity,
         highest_balance, lowest_equity, day_start_balance, fee_paid, profit_split_pct, leverage,
         profit_target_pct, max_daily_loss_pct, max_total_loss_pct, platform,
         ctrader_login, ctrader_account_id, ctrader_server, ctrader_password, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW()::TEXT)`,
      [id, req.user.id, old.account_size, type, old.account_size, old.account_size, old.account_size,
       old.account_size, old.account_size, old.account_size, resetFee, old.profit_split_pct, rules.leverage,
       profitTarget, rules.max_daily_loss_pct, rules.max_total_loss_pct, 'plutotrade',
       traderLogin, id, 'PlutoTrader', traderPassword]);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CHALLENGE_RESET', 'challenge', ?, ?)`,
      [generateId(), req.user.id, id, `Reset from ${old.id.slice(0,8)} — $${resetFee} (10% off $${baseFee})`]);

    res.status(201).json({ challenge_id: id, fee_paid: resetFee, original_fee: baseFee, discount: '10%', terminal: { login: traderLogin, url: terminalUrl } });
  } catch (e) {
    console.error('Reset error:', e);
    res.status(500).json({ error: 'Failed to reset challenge' });
  }
});

// GET /api/challenges/:id/balance-history — equity curve data
router.get('/:id/balance-history', authenticate, async (req, res) => {
  try {
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!ch) return res.status(404).json({ error: 'Not found' });

    // Get closed trades ordered by close time
    const trades = await queryAll(
      `SELECT close_time, profit, swap FROM trades WHERE challenge_id=$1 AND status='closed' ORDER BY close_time ASC LIMIT 500`,
      [req.params.id]
    );

    // Build running balance series
    let running = ch.starting_balance;
    const series = [{ t: ch.activated_at || ch.created_at, v: running, label: 'Start' }];
    trades.forEach(t => {
      running += (t.profit || 0) + (t.swap || 0);
      series.push({ t: t.close_time, v: +running.toFixed(2) });
    });
    // Add current balance as last point
    if (trades.length > 0) {
      series.push({ t: new Date().toISOString(), v: ch.current_balance, label: 'Now' });
    }

    res.json({
      series,
      starting_balance: ch.starting_balance,
      current_balance: ch.current_balance,
      highest_balance: ch.highest_balance,
      lowest_equity: ch.lowest_equity,
      target: ch.starting_balance * (1 + ch.profit_target_pct / 100),
      floor: ch.starting_balance * (1 - ch.max_total_loss_pct / 100),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/challenges/:id/daily-pnl — daily P&L calendar data
router.get('/:id/daily-pnl', authenticate, async (req, res) => {
  try {
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!ch) return res.status(404).json({ error: 'Not found' });

    const trades = await queryAll(
      `SELECT close_time, profit, swap FROM trades WHERE challenge_id=$1 AND status='closed' ORDER BY close_time ASC`,
      [req.params.id]
    );

    const days = {};
    trades.forEach(t => {
      if (!t.close_time) return;
      const day = t.close_time.split('T')[0];
      days[day] = (days[day] || 0) + (t.profit || 0) + (t.swap || 0);
    });

    res.json({ days, total_trading_days: Object.keys(days).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
