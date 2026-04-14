const express = require('express');
const cors = require('cors');
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/funded', fundedRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/admin', adminRoutes);

// Dashboard stats (authenticated)
const { authenticate } = require('./src/middleware/auth');
const { queryAll, queryOne } = require('./src/models/database');

app.get('/api/dashboard/stats', authenticate, (req, res) => {
  const challenges = queryAll(`SELECT * FROM challenges WHERE user_id='${req.user.id}'`);
  const funded = queryAll(`SELECT * FROM funded_accounts WHERE user_id='${req.user.id}'`);
  const payouts = queryAll(`SELECT * FROM payouts WHERE user_id='${req.user.id}'`);
  const trades = queryAll(`SELECT * FROM trades WHERE user_id='${req.user.id}'`);

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
    size: Number(size),
    fee,
    profit_target: config.defaultRules.profit_target_pct,
    daily_loss: config.defaultRules.max_daily_loss_pct,
    max_drawdown: config.defaultRules.max_total_loss_pct,
    split: config.defaultRules.profit_split_pct,
    leverage: Number(size) >= 50000 ? '1:20' : '1:30',
  }));
  res.json(plans);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ============================================================
// STATIC FILES (serves frontend in dev)
// ============================================================
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: config.nodeEnv === 'development' ? err.message : undefined });
});

// ============================================================
// START
// ============================================================
async function start() {
  await initDatabase();

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
