const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ============================================================
// SCHEMA
// ============================================================
const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    country TEXT DEFAULT '',
    kyc_status TEXT DEFAULT 'none',
    kyc_applicant_id TEXT,
    role TEXT DEFAULT 'trader',
    affiliate_code TEXT UNIQUE,
    referred_by TEXT,
    balance_wallet REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    terms_accepted_at TEXT,
    terms_version TEXT DEFAULT 'v1',
    last_login TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT),
    updated_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_size REAL NOT NULL,
    challenge_type TEXT DEFAULT 'one_step',
    status TEXT DEFAULT 'active',
    profit_target_pct REAL DEFAULT 10.0,
    max_daily_loss_pct REAL DEFAULT 5.0,
    max_total_loss_pct REAL DEFAULT 8.0,
    profit_split_pct REAL DEFAULT 80.0,
    leverage TEXT DEFAULT '1:30',
    starting_balance REAL NOT NULL,
    current_balance REAL,
    current_equity REAL,
    highest_balance REAL,
    lowest_equity REAL,
    day_start_balance REAL,
    fee_paid REAL,
    ctrader_login TEXT,
    ctrader_account_id TEXT,
    ctrader_server TEXT DEFAULT 'PlutoCapital-Demo',
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    best_day_profit REAL DEFAULT 0,
    worst_day_loss REAL DEFAULT 0,
    total_profit REAL DEFAULT 0,
    avg_win REAL DEFAULT 0,
    avg_loss REAL DEFAULT 0,
    profit_factor REAL DEFAULT 0,
    activated_at TEXT,
    passed_at TEXT,
    failed_at TEXT,
    breach_reason TEXT,
    last_trade_at TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS funded_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    challenge_id TEXT REFERENCES challenges(id),
    account_size REAL NOT NULL,
    status TEXT DEFAULT 'active',
    starting_balance REAL,
    current_balance REAL,
    current_equity REAL,
    highest_balance REAL,
    lowest_equity REAL,
    day_start_balance REAL,
    profit_split_pct REAL DEFAULT 80.0,
    total_payouts REAL DEFAULT 0,
    payout_count INTEGER DEFAULT 0,
    scaling_level INTEGER DEFAULT 0,
    ctrader_login TEXT,
    ctrader_account_id TEXT,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_profit REAL DEFAULT 0,
    max_daily_loss_pct REAL DEFAULT 5.0,
    max_total_loss_pct REAL DEFAULT 8.0,
    breach_reason TEXT,
    breached_at TEXT,
    last_trade_at TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    funded_account_id TEXT REFERENCES funded_accounts(id),
    gross_profit REAL NOT NULL,
    split_pct REAL NOT NULL,
    trader_amount REAL NOT NULL,
    firm_amount REAL NOT NULL,
    status TEXT DEFAULT 'requested',
    payout_method TEXT DEFAULT 'crypto_usdt',
    wallet_address TEXT,
    bank_details TEXT,
    tx_reference TEXT,
    requested_at TEXT DEFAULT (NOW()::TEXT),
    reviewed_by TEXT,
    approved_at TEXT,
    paid_at TEXT,
    rejected_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    challenge_id TEXT,
    funded_account_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    volume REAL NOT NULL,
    open_price REAL,
    close_price REAL,
    stop_loss REAL,
    take_profit REAL,
    profit REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    swap REAL DEFAULT 0,
    open_time TEXT DEFAULT (NOW()::TEXT),
    close_time TEXT,
    status TEXT DEFAULT 'open'
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    reference_id TEXT,
    payment_method TEXT,
    payment_intent_id TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL,
    challenge_id TEXT,
    commission_rate REAL NOT NULL,
    commission_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    paid_at TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS discount_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount_pct REAL NOT NULL,
    max_uses INTEGER DEFAULT 0,
    current_uses INTEGER DEFAULT 0,
    valid_from TEXT,
    valid_until TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (NOW()::TEXT)
  )`
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status)',
  'CREATE INDEX IF NOT EXISTS idx_funded_user ON funded_accounts(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_trades_challenge ON trades(challenge_id)',
  'CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)'
];

// ============================================================
// SEED
// ============================================================
async function seedDatabase(client) {
  const check = await client.query("SELECT COUNT(*) FROM users");
  if (parseInt(check.rows[0].count) > 0) {
    console.log('  ✓ Database already has data, skipping seed');
    return;
  }

  const adminId = uuidv4();
  await client.query(
    `INSERT INTO users (id,email,password_hash,first_name,last_name,role,affiliate_code,kyc_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [adminId, 'admin@plutocapitalfunding.com', bcrypt.hashSync('admin123', 10), 'Pluto', 'Admin', 'admin', 'PCF-ADMIN', 'approved']
  );

  const traderId = uuidv4();
  await client.query(
    `INSERT INTO users (id,email,password_hash,first_name,last_name,role,affiliate_code,kyc_status,country,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [traderId, 'trader@demo.com', bcrypt.hashSync('demo123', 10), 'Florent', 'Demo', 'trader', 'PCF-' + traderId.slice(0, 6).toUpperCase(), 'approved', 'XK', '+383 44 123 456']
  );

  const ch1Id = uuidv4();
  await client.query(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,fee_paid,total_trades,winning_trades,losing_trades,best_day_profit,worst_day_loss,total_profit,avg_win,avg_loss,profit_factor,ctrader_login,status,activated_at) VALUES ($1,$2,100000,100000,106842.50,107100,107200,96200,105400,499,47,31,16,2840,-1890,6842.50,420.50,-310.20,2.14,'8847201','active',NOW()-INTERVAL '21 days')`,
    [ch1Id, traderId]
  );

  const ch2Id = uuidv4();
  await client.query(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,fee_paid,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,status,activated_at,passed_at) VALUES ($1,$2,50000,50000,55200,55200,55200,47800,299,62,41,21,5200,'8841003','passed',NOW()-INTERVAL '60 days',NOW()-INTERVAL '30 days')`,
    [ch2Id, traderId]
  );

  const ch3Id = uuidv4();
  await client.query(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,fee_paid,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,status,activated_at,failed_at,breach_reason) VALUES ($1,$2,25000,25000,23100,23100,26200,23100,179,28,12,16,-1900,'8839502','failed',NOW()-INTERVAL '90 days',NOW()-INTERVAL '75 days','MAX_TOTAL_DRAWDOWN')`,
    [ch3Id, traderId]
  );

  const fundId = uuidv4();
  await client.query(
    `INSERT INTO funded_accounts (id,user_id,challenge_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,profit_split_pct,total_payouts,payout_count,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,scaling_level) VALUES ($1,$2,$3,50000,50000,53400,53650,54800,48200,52900,80,4200,1,38,26,12,7600,'8841003-F',0)`,
    [fundId, traderId, ch2Id]
  );

  await client.query(
    `INSERT INTO payouts (id,user_id,funded_account_id,gross_profit,split_pct,trader_amount,firm_amount,status,payout_method,wallet_address,tx_reference,approved_at,paid_at) VALUES ($1,$2,$3,5250,80,4200,1050,'paid','crypto_usdt','TRX7a8b_redacted','tx_abc123def456',NOW()-INTERVAL '12 days',NOW()-INTERVAL '10 days')`,
    [uuidv4(), traderId, fundId]
  );

  await client.query(
    `INSERT INTO payouts (id,user_id,funded_account_id,gross_profit,split_pct,trader_amount,firm_amount,status,payout_method,wallet_address) VALUES ($1,$2,$3,2350,80,1880,470,'requested','crypto_usdc','USDC_wallet_placeholder')`,
    [uuidv4(), traderId, fundId]
  );

  const symbols = ['XAUUSD','EURUSD','GBPJPY','USDJPY','NAS100','EURJPY','CADJPY','GBPUSD','US30'];
  for (let i = 0; i < 30; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const dir = Math.random() > 0.4 ? 'BUY' : 'SELL';
    const isWin = Math.random() > 0.35;
    const profit = isWin ? +(Math.random() * 2500 + 100).toFixed(2) : -(Math.random() * 1500 + 50).toFixed(2);
    const vol = +(Math.random() * 2 + 0.1).toFixed(2);
    const basePrice = sym === 'XAUUSD' ? 2340 + Math.random() * 60 : sym === 'NAS100' ? 18200 + Math.random() * 400 : sym === 'US30' ? 39800 + Math.random() * 600 : 1.05 + Math.random() * 0.8;
    const hoursAgo = Math.floor(Math.random() * 500);

    await client.query(
      `INSERT INTO trades (id,challenge_id,user_id,symbol,direction,volume,open_price,close_price,profit,commission,swap,status,open_time,close_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'closed',NOW()-INTERVAL '${hoursAgo + 2} hours',NOW()-INTERVAL '${hoursAgo} hours')`,
      [uuidv4(), ch1Id, traderId, sym, dir, vol, +basePrice.toFixed(2), +(basePrice + (isWin ? 0.5 : -0.3) * (dir === 'BUY' ? 1 : -1)).toFixed(2), profit, -(Math.random() * 8 + 1).toFixed(2), -(Math.random() * 3).toFixed(2)]
    );
  }

  await client.query(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES ($1,$2,'purchase',-499,'$100K Challenge Purchase','card')`, [uuidv4(), traderId]);
  await client.query(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES ($1,$2,'purchase',-299,'$50K Challenge Purchase','card')`, [uuidv4(), traderId]);
  await client.query(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES ($1,$2,'purchase',-179,'$25K Challenge Purchase','crypto')`, [uuidv4(), traderId]);
  await client.query(`INSERT INTO transactions (id,user_id,type,amount,description) VALUES ($1,$2,'payout',4200,'Profit Payout')`, [uuidv4(), traderId]);

  await client.query(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'CHALLENGE_CREATED','challenge',$3,'User purchased $100K challenge')`, [uuidv4(), traderId, ch1Id]);
  await client.query(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'CHALLENGE_PASSED','challenge',$3,'Profit target reached')`, [uuidv4(), traderId, ch2Id]);
  await client.query(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'CHALLENGE_BREACHED','challenge',$3,'Max total drawdown exceeded')`, [uuidv4(), traderId, ch3Id]);

  console.log('  ✓ Database seeded with demo data');
}

// ============================================================
// INIT
// ============================================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    for (const sql of TABLES) {
      await client.query(sql);
    }
    for (const sql of INDEXES) {
      try { await client.query(sql); } catch (e) { /* already exists */ }
    }
    console.log('  ✓ Database schema created');

    // Migrations — add columns that may not exist yet
    const migrations = [
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS phase INTEGER DEFAULT 1`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS parent_challenge_id TEXT`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS consistency_best_day_pct REAL DEFAULT 0`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE funded_accounts ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT DEFAULT 'v1'`,
      `INSERT INTO platform_settings (key, value) VALUES ('demo_mode', 'false') ON CONFLICT (key) DO NOTHING`,
    ];
    for (const sql of migrations) {
      try { await client.query(sql); } catch (e) { /* column already exists */ }
    }
    console.log('  ✓ Migrations applied');

    await seedDatabase(client);
  } finally {
    client.release();
  }
}

// ============================================================
// QUERY HELPERS (compatible with existing route code)
// ============================================================
function queryAll(sql, params = []) {
  return pool.query(sql, params).then(r => r.rows).catch(e => { console.error('Query error:', e.message); return []; });
}

function queryOne(sql, params = []) {
  return pool.query(sql, params).then(r => r.rows[0] || null).catch(e => { console.error('Query error:', e.message); return null; });
}

function run(sql, params = []) {
  // Convert SQLite ? placeholders to PostgreSQL $1,$2,$3
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return pool.query(pgSql, params).catch(e => { console.error('Run error:', e.message); });
}

function getDb() { return pool; }

module.exports = { initDatabase, queryAll, queryOne, run, getDb };
