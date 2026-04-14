module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'pluto-capital-dev-secret-change-in-production-min-32-chars',
  jwtExpiry: '7d',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Pricing table — account_size: fee
  challengePricing: {
    10000: 79,
    25000: 179,
    50000: 299,
    100000: 499,
    200000: 949,
  },

  // Default challenge rules
  defaultRules: {
    profit_target_pct: 10,
    max_daily_loss_pct: 5,
    max_total_loss_pct: 8,
    profit_split_pct: 80,
    leverage: '1:20',
    min_payout: 50,
  },

  // Scaling plan
  scalingLevels: [
    { level: 0, name: 'Base',    multiplier: 1, split: 80, required_payouts: 0,  required_profit_pct: 0 },
    { level: 1, name: 'Scale 1', multiplier: 2, split: 82, required_payouts: 3,  required_profit_pct: 10 },
    { level: 2, name: 'Scale 2', multiplier: 4, split: 85, required_payouts: 3,  required_profit_pct: 10 },
    { level: 3, name: 'Scale 3', multiplier: 8, split: 88, required_payouts: 3,  required_profit_pct: 10 },
    { level: 4, name: 'Max',     multiplier: 20, split: 90, required_payouts: 5, required_profit_pct: 10 },
  ],

  // Integration keys — configure for production
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
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
};
