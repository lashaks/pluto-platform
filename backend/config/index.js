module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'pluto-capital-dev-secret-change-in-production-min-32-chars',
  jwtExpiry: '7d',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Pricing — 10% below Funding Pips
  challengePricing: {
    2500:   19,
    5000:   32,
    10000:  59,
    25000:  144,
    50000:  225,
    100000: 449,  // Premium — max account
  },
  // PlutoRapid pricing (no consistency rule, higher target, lower fee)
  rapidPricing: {
    2500:   15,
    5000:   25,
    10000:  45,
    25000:  109,
    50000:  179,
    100000: 349,
  },

  // 1-Step rules
  oneStepRules: {
    profit_target_pct: 10,
    max_daily_loss_pct: 5,
    max_total_loss_pct: 8,
    profit_split_pct: 80,
    leverage: '1:30',
    min_payout: 50,
    consistency_rule_pct: 20,
    max_lot_exposure: { 2500: 1, 5000: 2, 10000: 4, 25000: 10, 50000: 20, 100000: 40 },
  },

  // 2-Step rules (matching Funding Pips)
  twoStepRules: {
    phase1_target_pct: 8,
    phase2_target_pct: 5,
    max_daily_loss_pct: 5,
    max_total_loss_pct: 10,
    profit_split_pct: 80,
    leverage: '1:30',
    min_payout: 50,
    consistency_rule_pct: 20,
    max_lot_exposure: { 2500: 1, 5000: 2, 10000: 4, 25000: 10, 50000: 20, 100000: 40 },
  },

  // PlutoRapid rules — faster, no consistency, higher target
  rapidRules: {
    profit_target_pct: 12,
    max_daily_loss_pct: 6,
    max_total_loss_pct: 8,
    profit_split_pct: 80,
    leverage: '1:30',
    min_payout: 50,
    consistency_rule_pct: null, // NO consistency rule
    min_trading_days: 3,        // Faster — only 3 days
    inactivity_days: 30,
  },

  // Default rules (backward compat)
  defaultRules: {
    profit_target_pct: 10,
    max_daily_loss_pct: 5,
    max_total_loss_pct: 8,
    profit_split_pct: 80,
    leverage: '1:30',
    min_payout: 50,
  },

  // Integration keys
  nowpayments: {
    apiKey: process.env.NOWPAYMENTS_API_KEY || '',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
  },
  sumsub: {
    appToken: process.env.SUMSUB_APP_TOKEN || '',
    secretKey: process.env.SUMSUB_SECRET_KEY || '',
  },
  rise: {
    apiKey: process.env.RISE_API_KEY || '',
  },
  ctrader: {
    host: process.env.CTRADER_HOST || '',
    port: process.env.CTRADER_PORT || 5011,
    password: process.env.CTRADER_PASSWORD || '',
  },
  email: {
    apiKey: process.env.EMAIL_API_KEY || '',
    from: 'support@plutocapitalfunding.com',
    fromName: 'Pluto Capital Funding',
  },
};
