const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const { initDatabase } = require('./src/models/database');

// Route imports
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const challengeRoutes = require('./src/routes/challenges');
const fundedRoutes = require('./src/routes/funded');
const payoutRoutes = require('./src/routes/payouts');
const tradeRoutes = require('./src/routes/trades');
const adminRoutes = require('./src/routes/admin');

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: [
    'https://pluto-platform.vercel.app',
    'https://plutocapitalfunding.com',
    'https://www.plutocapitalfunding.com',
    'http://localhost:3000',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Patch express to catch async errors (express 4 doesn't catch rejected promises)
const Layer = require('express/lib/router/layer');
const origHandle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function(req, res, next) {
  try {
    const result = origHandle.call(this, req, res, next);
    if (result && typeof result.catch === 'function') {
      result.catch(next);
    }
  } catch (err) { next(err); }
};
process.on('unhandledRejection', (err) => { console.error('[UNHANDLED REJECTION]', err.message || err); });

// Simple rate limiter for auth routes
const rateLimits = {};
function rateLimit(key, maxPerMin) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const k = key + ':' + ip;
    const now = Date.now();
    if (!rateLimits[k]) rateLimits[k] = [];
    rateLimits[k] = rateLimits[k].filter(t => now - t < 60000);
    if (rateLimits[k].length >= maxPerMin) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    rateLimits[k].push(now);
    next();
  };
}
// Clean up every 5 minutes
setInterval(() => { const now = Date.now(); for (const k in rateLimits) { rateLimits[k] = rateLimits[k].filter(t => now - t < 60000); if (!rateLimits[k].length) delete rateLimits[k]; } }, 300000);

// Request logging (dev)
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`  ${req.method} ${req.path}`);
    }
    next();
  });
}

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth', rateLimit('auth', 20), authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/funded', fundedRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/admin', adminRoutes);

// Dashboard stats (authenticated)
const { authenticate } = require('./src/middleware/auth');
const { queryAll, queryOne, run } = require('./src/models/database');

app.get('/api/dashboard/stats', authenticate, async (req, res) => {
  const challenges = await queryAll(`SELECT * FROM challenges WHERE user_id=$1`, [req.user.id]);
  const funded = await queryAll(`SELECT * FROM funded_accounts WHERE user_id=$1`, [req.user.id]);
  const payouts = await queryAll(`SELECT * FROM payouts WHERE user_id=$1`, [req.user.id]);
  const trades = await queryAll(`SELECT * FROM trades WHERE user_id=$1`, [req.user.id]);

  const totalProfit = funded.reduce((s, a) => s + (a.total_profit || 0), 0) + challenges.reduce((s, a) => s + (a.total_profit || 0), 0);
  const totalPayouts = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + p.trader_amount, 0);

  res.json({
    total_profit: +totalProfit.toFixed(2),
    total_payouts: +totalPayouts.toFixed(2),
    active_challenges: challenges.filter(c => c.status === 'active').length,
    passed_challenges: challenges.filter(c => c.status === 'passed').length,
    failed_challenges: challenges.filter(c => c.status === 'failed').length,
    active_funded: funded.filter(f => f.status === 'active').length,
    total_trades: trades.length,
    win_rate: trades.length ? Math.round(trades.filter(t => t.profit > 0).length / trades.length * 100) : 0,
    challenges,
    funded_accounts: funded,
  });
});

// Public pricing endpoint (no auth)
app.get('/api/pricing', (req, res) => {
  const plans = Object.entries(config.challengePricing).map(([size, fee]) => ({
    size: Number(size), fee,
    one_step: { target: 10, daily: 5, dd: 8, split: 80, leverage: '1:30' },
    two_step: { target: '8 / 5', daily: 5, dd: 10, split: 80, leverage: '1:30' },
  }));
  res.json(plans);
});

// NOWPayments webhook — activates challenge after crypto payment
const payments = require('./src/services/payments');
const ctraderService = require('./src/services/ctrader');
const { generateId: genId, generateLogin: genLogin, generatePassword: genPass } = require('./src/utils/helpers');

app.post('/api/webhooks/nowpayments', async (req, res) => {
  try {
    const sig = req.headers['x-nowpayments-sig'];
    if (!payments.verifyIpnSignature(req.body, sig)) {
      console.log('[Webhook] Invalid IPN signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { order_id, payment_status, actually_paid, pay_amount, pay_currency } = req.body;
    console.log(`[Webhook] NOWPayments: order=${order_id} status=${payment_status} paid=${actually_paid}`);

    if (payments.isPaymentComplete(payment_status)) {
      // Find the pending challenge
      const challenge = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND status='pending_payment'`, [order_id]);
      if (!challenge) {
        console.log('[Webhook] Challenge not found or already activated:', order_id);
        return res.json({ success: true });
      }

      // Create cTrader account
      const creatorUsr = await queryOne(`SELECT first_name, last_name, email FROM users WHERE id=$1`, [challenge.user_id]);
      const ctraderResult = await ctraderService.createAccount({
        balance: challenge.account_size,
        leverage: challenge.leverage || '1:30',
        group: 'demo_prop_evaluation',
        name: creatorUsr ? `${creatorUsr.first_name || ''} ${creatorUsr.last_name || ''}`.trim() : '',
        email: creatorUsr?.email || '',
      });

      // Activate the challenge
      await run(`UPDATE challenges SET status='active', activated_at=NOW()::TEXT,
        ctrader_login=?, ctrader_account_id=?, ctrader_server=? WHERE id=?`,
        [ctraderResult.login, ctraderResult.accountId, ctraderResult.server, order_id]);

      // Record transaction
      await run(`INSERT INTO transactions (id, user_id, type, amount, description, reference_id, payment_method, payment_intent_id)
        VALUES (?, ?, 'purchase', ?, ?, ?, 'crypto', ?)`,
        [genId(), challenge.user_id, -challenge.fee_paid,
         `$${(challenge.account_size/1000)}K Challenge Purchase`, order_id, String(req.body.payment_id)]);

      // Audit log
      await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, 'CHALLENGE_ACTIVATED', 'challenge', ?, ?)`,
        [genId(), challenge.user_id, order_id,
         `Crypto payment confirmed: ${actually_paid} ${pay_currency}. Challenge activated.`]);

      console.log(`[Webhook] Challenge ${order_id} activated!`);

      // Send purchase confirmation email
      const emailService = require('./src/services/email');
      const usr = await queryOne(`SELECT first_name, email FROM users WHERE id=$1`, [challenge.user_id]);
      if (usr) {
        emailService.sendChallengePurchased(usr.email, usr.first_name || 'Trader', {
          account_size: challenge.account_size,
          challenge_type: challenge.challenge_type || 'one_step',
          profit_target: challenge.profit_target_pct,
          daily_loss: challenge.max_daily_loss_pct,
          max_drawdown: challenge.max_total_loss_pct,
          profit_split: challenge.profit_split_pct,
          fee: challenge.fee_paid,
          login: ctraderResult.login,
          password: ctraderResult.password,
          server: ctraderResult.server,
        }).catch(e => console.error('[Webhook] Email error:', e.message));
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[Webhook] Error:', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    version: '1.0.0',
    nowpayments_configured: !!process.env.NOWPAYMENTS_API_KEY,
    database_configured: !!process.env.DATABASE_URL
  });
});

// ============================================================
// STATIC FILES (only when frontend folder exists — dev mode)
// ============================================================
const fs = require('fs');
const frontendPath = path.join(__dirname, '..', 'frontend', 'public');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ status: 'Pluto Capital Funding API', version: '1.0.0', docs: '/api/health' });
  });
}

// ============================================================
// 404 — Unknown API routes
// ============================================================
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err.message || err);
  res.status(err.status || 500).json({ error: 'Internal server error', message: config.nodeEnv === 'development' ? err.message : undefined });
});

// ============================================================
// START
// ============================================================
async function start() {
  await initDatabase();

  // Start cTrader event listener (will no-op if CTRADER_ENABLED=false)
  try {
    const ctraderEvents = require('./src/services/ctraderEvents');
    // Delay start slightly to let cTrader client authenticate
    setTimeout(() => ctraderEvents.start(), 3000);
  } catch (e) {
    console.error('[Boot] cTrader event listener init failed:', e.message);
  }

  app.listen(config.port, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║                                               ║');
    console.log('  ║   △ PLUTO CAPITAL FUNDING — Server Live        ║');
    console.log('  ║                                               ║');
    console.log('  ║   Local:   http://localhost:' + config.port + '              ║');
    console.log('  ║   API:     http://localhost:' + config.port + '/api          ║');
    console.log('  ║   Health:  http://localhost:' + config.port + '/api/health   ║');
    console.log('  ║                                               ║');
    console.log('  ║   Demo Accounts:                              ║');
    console.log('  ║     Trader: trader@demo.com / demo123         ║');
    console.log('  ║     Admin:  admin@plutocapitalfunding.com / admin123  ║');
    console.log('  ║                                               ║');
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
