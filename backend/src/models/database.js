const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

let db;

// ============================================================
// SCHEMA
// ============================================================
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    country TEXT DEFAULT '',
    kyc_status TEXT DEFAULT 'none' CHECK(kyc_status IN ('none','pending','approved','rejected')),
    kyc_applicant_id TEXT,
    role TEXT DEFAULT 'trader' CHECK(role IN ('trader','admin','support')),
    affiliate_code TEXT UNIQUE,
    referred_by TEXT,
    balance_wallet REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    account_size REAL NOT NULL,
    challenge_type TEXT DEFAULT 'one_step' CHECK(challenge_type IN ('one_step','two_step','instant')),
    status TEXT DEFAULT 'active' CHECK(status IN ('pending_payment','active','passed','failed','expired')),
    
    -- Rules
    profit_target_pct REAL DEFAULT 10.0,
    max_daily_loss_pct REAL DEFAULT 5.0,
    max_total_loss_pct REAL DEFAULT 8.0,
    profit_split_pct REAL DEFAULT 80.0,
    leverage TEXT DEFAULT '1:20',
    
    -- Balances
    starting_balance REAL NOT NULL,
    current_balance REAL,
    current_equity REAL,
    highest_balance REAL,
    lowest_equity REAL,
    day_start_balance REAL,
    
    -- Fees
    fee_paid REAL,
    
    -- cTrader
    ctrader_login TEXT,
    ctrader_account_id TEXT,
    ctrader_server TEXT DEFAULT 'PlutoCapital-Demo',
    
    -- Stats
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    best_day_profit REAL DEFAULT 0,
    worst_day_loss REAL DEFAULT 0,
    total_profit REAL DEFAULT 0,
    avg_win REAL DEFAULT 0,
    avg_loss REAL DEFAULT 0,
    profit_factor REAL DEFAULT 0,
    
    -- Timestamps
    activated_at TEXT,
    passed_at TEXT,
    failed_at TEXT,
    breach_reason TEXT,
    last_trade_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS funded_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    challenge_id TEXT,
    account_size REAL NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','breached','suspended','scaled')),
    
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
    created_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (challenge_id) REFERENCES challenges(id)
  );

  CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    funded_account_id TEXT,
    
    gross_profit REAL NOT NULL,
    split_pct REAL NOT NULL,
    trader_amount REAL NOT NULL,
    firm_amount REAL NOT NULL,
    
    status TEXT DEFAULT 'requested' CHECK(status IN ('requested','under_review','approved','processing','paid','rejected')),
    
    payout_method TEXT DEFAULT 'crypto_usdt',
    wallet_address TEXT,
    bank_details TEXT,
    tx_reference TEXT,
    
    requested_at TEXT DEFAULT (datetime('now')),
    reviewed_by TEXT,
    approved_at TEXT,
    paid_at TEXT,
    rejected_reason TEXT,
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (funded_account_id) REFERENCES funded_accounts(id)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    challenge_id TEXT,
    funded_account_id TEXT,
    user_id TEXT NOT NULL,
    
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('BUY','SELL')),
    volume REAL NOT NULL,
    open_price REAL,
    close_price REAL,
    stop_loss REAL,
    take_profit REAL,
    
    profit REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    swap REAL DEFAULT 0,
    
    open_time TEXT DEFAULT (datetime('now')),
    close_time TEXT,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
    
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('purchase','refund','payout','commission','adjustment')),
    amount REAL NOT NULL,
    description TEXT,
    reference_id TEXT,
    payment_method TEXT,
    payment_intent_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL,
    challenge_id TEXT,
    commission_rate REAL NOT NULL,
    commission_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid')),
    paid_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(user_id);
  CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
  CREATE INDEX IF NOT EXISTS idx_funded_user ON funded_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
  CREATE INDEX IF NOT EXISTS idx_trades_challenge ON trades(challenge_id);
  CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
  CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
`;

// ============================================================
// SEED DATA
// ============================================================
function seedDatabase() {
  // Admin user
  const adminId = uuidv4();
  db.run(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, affiliate_code, kyc_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminId, 'admin@plutocapitalfunding.com', bcrypt.hashSync('admin123', 10), 'Pluto', 'Admin', 'admin', 'PCF-ADMIN', 'approved']
  );

  // Demo trader
  const traderId = uuidv4();
  db.run(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, affiliate_code, kyc_status, country, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [traderId, 'trader@demo.com', bcrypt.hashSync('demo123', 10), 'Florent', 'Demo', 'trader', 'PCF-' + traderId.slice(0, 6).toUpperCase(), 'approved', 'XK', '+383 44 123 456']
  );

  // Active challenge — $100K
  const ch1Id = uuidv4();
  db.run(
    `INSERT INTO challenges (id, user_id, account_size, starting_balance, current_balance, current_equity,
     highest_balance, lowest_equity, day_start_balance, fee_paid, total_trades, winning_trades, losing_trades,
     best_day_profit, worst_day_loss, total_profit, avg_win, avg_loss, profit_factor, ctrader_login, status, activated_at)
     VALUES (?, ?, 100000, 100000, 106842.50, 107100.00, 107200, 96200, 105400, 499,
     47, 31, 16, 2840, -1890, 6842.50, 420.50, -310.20, 2.14, '8847201', 'active', datetime('now', '-21 days'))`,
    [ch1Id, traderId]
  );

  // Passed challenge — $50K (now funded)
  const ch2Id = uuidv4();
  db.run(
    `INSERT INTO challenges (id, user_id, account_size, starting_balance, current_balance, current_equity,
     highest_balance, lowest_equity, fee_paid, total_trades, winning_trades, losing_trades,
     total_profit, ctrader_login, status, activated_at, passed_at)
     VALUES (?, ?, 50000, 50000, 55200, 55200, 55200, 47800, 299,
     62, 41, 21, 5200, '8841003', 'passed', datetime('now', '-60 days'), datetime('now', '-30 days'))`,
    [ch2Id, traderId]
  );

  // Failed challenge — $25K
  const ch3Id = uuidv4();
  db.run(
    `INSERT INTO challenges (id, user_id, account_size, starting_balance, current_balance, current_equity,
     highest_balance, lowest_equity, fee_paid, total_trades, winning_trades, losing_trades,
     total_profit, ctrader_login, status, activated_at, failed_at, breach_reason)
     VALUES (?, ?, 25000, 25000, 23100, 23100, 26200, 23100, 179,
     28, 12, 16, -1900, '8839502', 'failed', datetime('now', '-90 days'), datetime('now', '-75 days'), 'MAX_TOTAL_DRAWDOWN')`,
    [ch3Id, traderId]
  );

  // Funded account from passed challenge
  const fundId = uuidv4();
  db.run(
    `INSERT INTO funded_accounts (id, user_id, challenge_id, account_size, starting_balance, current_balance,
     current_equity, highest_balance, lowest_equity, day_start_balance, profit_split_pct, total_payouts,
     payout_count, total_trades, winning_trades, losing_trades, total_profit, ctrader_login, scaling_level)
     VALUES (?, ?, ?, 50000, 50000, 53400, 53650, 54800, 48200, 52900, 80, 4200, 1, 38, 26, 12, 7600, '8841003-F', 0)`,
    [fundId, traderId, ch2Id]
  );

  // Paid payout
  db.run(
    `INSERT INTO payouts (id, user_id, funded_account_id, gross_profit, split_pct, trader_amount, firm_amount,
     status, payout_method, wallet_address, tx_reference, approved_at, paid_at)
     VALUES (?, ?, ?, 5250, 80, 4200, 1050, 'paid', 'crypto_usdt',
     'TRX7a8b...redacted', 'tx_abc123def456', datetime('now', '-12 days'), datetime('now', '-10 days'))`,
    [uuidv4(), traderId, fundId]
  );

  // Pending payout
  db.run(
    `INSERT INTO payouts (id, user_id, funded_account_id, gross_profit, split_pct, trader_amount, firm_amount,
     status, payout_method, wallet_address)
     VALUES (?, ?, ?, 2350, 80, 1880, 470, 'requested', 'crypto_usdc', 'USDC_wallet_placeholder')`,
    [uuidv4(), traderId, fundId]
  );

  // Seed trades for the active challenge
  const symbols = ['XAUUSD', 'EURUSD', 'GBPJPY', 'USDJPY', 'NAS100', 'EURJPY', 'CADJPY', 'GBPUSD', 'US30'];
  for (let i = 0; i < 30; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const dir = Math.random() > 0.4 ? 'BUY' : 'SELL';
    const isWin = Math.random() > 0.35;
    const profit = isWin ? +(Math.random() * 2500 + 100).toFixed(2) : -(Math.random() * 1500 + 50).toFixed(2);
    const vol = +(Math.random() * 2 + 0.1).toFixed(2);
    const basePrice = sym === 'XAUUSD' ? 2340 + Math.random() * 60 :
                      sym === 'NAS100' ? 18200 + Math.random() * 400 :
                      sym === 'US30' ? 39800 + Math.random() * 600 :
                      1.05 + Math.random() * 0.8;
    const hoursAgo = Math.floor(Math.random() * 500);

    db.run(
      `INSERT INTO trades (id, challenge_id, user_id, symbol, direction, volume, open_price, close_price,
       profit, commission, swap, status, open_time, close_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed',
       datetime('now', '-' || ? || ' hours'), datetime('now', '-' || ? || ' hours'))`,
      [uuidv4(), ch1Id, traderId, sym, dir, vol,
       +basePrice.toFixed(2), +(basePrice + (isWin ? 0.5 : -0.3) * (dir === 'BUY' ? 1 : -1)).toFixed(2),
       +profit, -(Math.random() * 8 + 1).toFixed(2), -(Math.random() * 3).toFixed(2),
       hoursAgo + 2, hoursAgo]
    );
  }

  // Transactions
  db.run(`INSERT INTO transactions (id, user_id, type, amount, description, payment_method) VALUES (?, ?, 'purchase', -499, '$100K Challenge Purchase', 'card')`, [uuidv4(), traderId]);
  db.run(`INSERT INTO transactions (id, user_id, type, amount, description, payment_method) VALUES (?, ?, 'purchase', -299, '$50K Challenge Purchase', 'card')`, [uuidv4(), traderId]);
  db.run(`INSERT INTO transactions (id, user_id, type, amount, description, payment_method) VALUES (?, ?, 'purchase', -179, '$25K Challenge Purchase', 'crypto')`, [uuidv4(), traderId]);
  db.run(`INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'payout', 4200, 'Profit Payout — $50K Funded Account')`, [uuidv4(), traderId]);

  // Audit log entries
  db.run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CHALLENGE_CREATED', 'challenge', ?, 'User purchased $100K challenge')`, [uuidv4(), traderId, ch1Id]);
  db.run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CHALLENGE_PASSED', 'challenge', ?, 'Profit target reached — account funded')`, [uuidv4(), traderId, ch2Id]);
  db.run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CHALLENGE_BREACHED', 'challenge', ?, 'Max total drawdown exceeded')`, [uuidv4(), traderId, ch3Id]);
  db.run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'PAYOUT_PAID', 'payout', ?, 'Payout of $4,200 processed via USDT')`, [uuidv4(), traderId, fundId]);

  console.log('  ✓ Database seeded with demo data');
}

// ============================================================
// INIT
// ============================================================
async function initDatabase() {
  const SQL = await initSqlJs();
  db = new SQL.Database();

  // Run schema
  const statements = SCHEMA.split(';').filter(s => s.trim());
  statements.forEach(s => {
    try { db.run(s); } catch (e) { /* index already exists etc */ }
  });
  console.log('  ✓ Database schema created');

  // Seed
  try { seedDatabase(); } catch (e) { console.log('  ⚠ Seed note:', e.message); }

  return db;
}

// ============================================================
// QUERY HELPERS
// ============================================================
function queryAll(sql, params = []) {
  try {
    const result = db.exec(sql);
    if (!result.length) return [];
    return result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
  } catch (e) {
    console.error('Query error:', e.message, sql);
    return [];
  }
}

function queryOne(sql) {
  const results = queryAll(sql);
  return results.length ? results[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
}

function getDb() { return db; }

module.exports = { initDatabase, queryAll, queryOne, run, getDb };
