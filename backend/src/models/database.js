const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// DUAL-MODE DATABASE
// LOCAL  (no DATABASE_URL) → sql.js (pure JS SQLite, zero compile)
// REMOTE (DATABASE_URL set) → PostgreSQL via pg
// ============================================================
const USE_SQLITE = !process.env.DATABASE_URL;
let pool = null;
let sqliteDb = null;

if (!USE_SQLITE) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('  [DB] PostgreSQL mode');
}

async function initSqlJs() {
  const path = require('path');
  const fs   = require('fs');
  const initSQL = require('sql.js');
  const dbPath  = path.join(__dirname, '..', '..', '..', 'pluto-local.db');
  const SQL = await initSQL();
  if (fs.existsSync(dbPath)) {
    sqliteDb = new SQL.Database(fs.readFileSync(dbPath));
    console.log('  [DB] sql.js → loaded ' + dbPath);
  } else {
    sqliteDb = new SQL.Database();
    console.log('  [DB] sql.js → created ' + dbPath);
  }
  const save = () => { try { fs.writeFileSync(dbPath, Buffer.from(sqliteDb.export())); } catch(_){} };
  const origRun = sqliteDb.run.bind(sqliteDb);
  sqliteDb.run = (...a) => { const r = origRun(...a); save(); return r; };
  sqliteDb._save = save;
}

function toSqlite(sql) {
  return sql
    .replace(/NOW\(\)::TEXT/gi, "datetime('now')")
    .replace(/NOW\(\)\s*-\s*INTERVAL\s*'[^']+'/gi, "datetime('now')")
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/\$\d+/g, '?')
    .replace(/ON CONFLICT \([^)]+\) DO NOTHING/gi, 'OR IGNORE')
    .replace(/INSERT INTO(?! OR)/gi, 'INSERT OR IGNORE INTO')
    .replace(/::TEXT|::INTEGER/gi, '')
    .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS/gi, 'ALTER TABLE $1 ADD COLUMN');
}

function pgSql(sql) { let i=0; return sql.replace(/\?/g,()=>`$${++i}`); }

function execSqlite(sql, params=[]) {
  try {
    const r = sqliteDb.exec(toSqlite(sql), params);
    if (!r.length) return [];
    return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; });
  } catch(e) {
    if (!e.message.includes('duplicate column') && !e.message.includes('already exists') && !e.message.includes('no such column')) {
      console.error('[SQLite]', e.message, '|', sql.slice(0,80));
    }
    return [];
  }
}

function queryAll(sql, params=[]) {
  if (USE_SQLITE) return Promise.resolve(execSqlite(sql, params));
  return pool.query(pgSql(sql), params).then(r=>r.rows).catch(e=>{console.error('[PG]',e.message);return[];});
}

function queryOne(sql, params=[]) {
  if (USE_SQLITE) { const r=execSqlite(sql,params); return Promise.resolve(r[0]||null); }
  return pool.query(pgSql(sql), params).then(r=>r.rows[0]||null).catch(e=>{console.error('[PG]',e.message);return null;});
}

function run(sql, params=[]) {
  if (USE_SQLITE) {
    try { sqliteDb.run(toSqlite(sql), params); } catch(e) {
      if (!e.message.includes('duplicate column') && !e.message.includes('already exists') && !e.message.includes('UNIQUE constraint')) {
        console.error('[SQLite run]', e.message, '|', sql.slice(0,80));
      }
    }
    return Promise.resolve(null);
  }
  return pool.query(pgSql(sql), params).catch(e=>{ console.error('[PG run]',e.message); });
}

function getDb() { return USE_SQLITE ? sqliteDb : pool; }

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
    trailing_stop_pips REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    swap REAL DEFAULT 0,
    open_time TEXT DEFAULT (NOW()::TEXT),
    close_time TEXT,
    status TEXT DEFAULT 'open'
  )`,
  `CREATE TABLE IF NOT EXISTS pending_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    challenge_id TEXT,
    funded_account_id TEXT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_type TEXT NOT NULL,
    volume REAL NOT NULL,
    entry_price REAL NOT NULL,
    stop_loss REAL,
    take_profit REAL,
    trailing_stop_pips REAL DEFAULT 0,
    expiry TEXT,
    status TEXT DEFAULT 'pending',
    commission REAL DEFAULT 0,
    created_at TEXT DEFAULT (NOW()::TEXT),
    filled_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_settings (
    symbol TEXT PRIMARY KEY,
    spread_markup REAL DEFAULT 0,
    min_volume REAL DEFAULT 0.01,
    max_volume REAL DEFAULT 100,
    step_volume REAL DEFAULT 0.01,
    commission_per_lot REAL DEFAULT 3.5,
    swap_long REAL DEFAULT 0,
    swap_short REAL DEFAULT 0,
    trading_enabled INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (NOW()::TEXT)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    platform TEXT DEFAULT 'web',
    login_at TEXT DEFAULT (NOW()::TEXT),
    last_seen TEXT DEFAULT (NOW()::TEXT),
    is_active INTEGER DEFAULT 1
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
  
    `CREATE TABLE IF NOT EXISTS challenge_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      pricing_json TEXT NOT NULL DEFAULT '{}',
      rules_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
  // Support both SQLite (client=null) and PostgreSQL
  const q = async (sql, params=[]) => {
    if (!client) return queryAll(sql, params);
    let i=0; const pg=sql.replace(/\?/g,()=>`$${++i}`);
    const r = await client.query(pg, params);
    return r.rows;
  };
  const countRes = await q("SELECT COUNT(*) as count FROM users");
  const count = parseInt(countRes[0]?.count || countRes[0]?.COUNT || 0);
  if (count > 0) {
    console.log('  ✓ Database already has data, skipping seed');
    return;
  }

  const adminId = uuidv4();
  await q(
    `INSERT INTO users (id,email,password_hash,first_name,last_name,role,affiliate_code,kyc_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [adminId, 'admin@plutocapitalfunding.com', bcrypt.hashSync('admin123', 10), 'Pluto', 'Admin', 'admin', 'PCF-ADMIN', 'approved']
  );

  const traderId = uuidv4();
  await q(
    `INSERT INTO users (id,email,password_hash,first_name,last_name,role,affiliate_code,kyc_status,country,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [traderId, 'trader@demo.com', bcrypt.hashSync('demo123', 10), 'Florent', 'Demo', 'trader', 'PCF-' + traderId.slice(0, 6).toUpperCase(), 'approved', 'XK', '+383 44 123 456']
  );

  const ch1Id = uuidv4();
  await q(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,fee_paid,total_trades,winning_trades,losing_trades,best_day_profit,worst_day_loss,total_profit,avg_win,avg_loss,profit_factor,ctrader_login,status,activated_at) VALUES ($1,$2,100000,100000,106842.50,107100,107200,96200,105400,499,47,31,16,2840,-1890,6842.50,420.50,-310.20,2.14,'8847201','active',NOW()-INTERVAL '21 days')`,
    [ch1Id, traderId]
  );

  const ch2Id = uuidv4();
  await q(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,fee_paid,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,status,activated_at,passed_at) VALUES ($1,$2,50000,50000,55200,55200,55200,47800,299,62,41,21,5200,'8841003','passed',NOW()-INTERVAL '60 days',NOW()-INTERVAL '30 days')`,
    [ch2Id, traderId]
  );

  const ch3Id = uuidv4();
  await q(
    `INSERT INTO challenges (id,user_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,fee_paid,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,status,activated_at,failed_at,breach_reason) VALUES ($1,$2,25000,25000,23100,23100,26200,23100,179,28,12,16,-1900,'8839502','failed',NOW()-INTERVAL '90 days',NOW()-INTERVAL '75 days','MAX_TOTAL_DRAWDOWN')`,
    [ch3Id, traderId]
  );

  const fundId = uuidv4();
  await q(
    `INSERT INTO funded_accounts (id,user_id,challenge_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,profit_split_pct,total_payouts,payout_count,total_trades,winning_trades,losing_trades,total_profit,ctrader_login,scaling_level) VALUES ($1,$2,$3,50000,50000,53400,53650,54800,48200,52900,80,4200,1,38,26,12,7600,'8841003-F',0)`,
    [fundId, traderId, ch2Id]
  );

  await q(
    `INSERT INTO payouts (id,user_id,funded_account_id,gross_profit,split_pct,trader_amount,firm_amount,status,payout_method,wallet_address,tx_reference,approved_at,paid_at) VALUES ($1,$2,$3,5250,80,4200,1050,'paid','crypto_usdt','TRX7a8b_redacted','tx_abc123def456',NOW()-INTERVAL '12 days',NOW()-INTERVAL '10 days')`,
    [uuidv4(), traderId, fundId]
  );

  await q(
    `INSERT INTO payouts (id,user_id,funded_account_id,gross_profit,split_pct,trader_amount,firm_amount,status,payout_method,wallet_address) VALUES ($1,$2,$3,2350,80,1880,470,'requested','crypto_usdc','USDC_wallet_placeholder')`,
    [uuidv4(), traderId, fundId]
  );

  // ── Rich mock trade history (closed) ─────────────────────────────────────
  const instruments = {
    'EURUSD': {pip:0.0001, base:1.0855, pipVal:10},
    'GBPUSD': {pip:0.0001, base:1.2715, pipVal:10},
    'USDJPY': {pip:0.01,   base:149.42, pipVal:9.2},
    'XAUUSD': {pip:0.01,   base:2338.5, pipVal:1},
    'NAS100': {pip:0.01,   base:18240,  pipVal:1},
    'US500':  {pip:0.01,   base:5198,   pipVal:1},
    'GBPJPY': {pip:0.01,   base:190.15, pipVal:9.2},
    'EURJPY': {pip:0.01,   base:162.08, pipVal:9.2},
    'USOIL':  {pip:0.01,   base:78.45,  pipVal:10},
    'US30':   {pip:0.01,   base:38520,  pipVal:1},
  };
  const symList = Object.keys(instruments);

  // 60 closed trades with realistic P&L
  for (let i = 0; i < 60; i++) {
    const sym  = symList[Math.floor(Math.random() * symList.length)];
    const inst = instruments[sym];
    const dir  = Math.random() > 0.45 ? 'buy' : 'sell';
    const isWin = Math.random() > 0.38;
    const vol  = +([0.1,0.2,0.25,0.3,0.5,1,1.5][Math.floor(Math.random()*7)]).toFixed(2);
    const pips = isWin ? Math.floor(Math.random()*80+8) : -Math.floor(Math.random()*45+5);
    const profit = +(pips * inst.pipVal * vol).toFixed(2);
    const open  = +(inst.base + (Math.random()-0.5)*inst.base*0.003).toFixed(inst.pip<0.001?1:5);
    const close = +(dir==='buy' ? open + pips*inst.pip : open - pips*inst.pip).toFixed(inst.pip<0.001?1:5);
    const comm  = +(vol * 3.5).toFixed(2);
    const hoursAgo = Math.floor(Math.random()*480+1);
    const durMins  = Math.floor(Math.random()*180+5);
    const sl = dir==='buy' ? +(open - Math.random()*20*inst.pip).toFixed(5) : +(open + Math.random()*20*inst.pip).toFixed(5);
    const tp = dir==='buy' ? +(open + Math.random()*50*inst.pip).toFixed(5) : +(open - Math.random()*50*inst.pip).toFixed(5);
    const reason = isWin ? (Math.random()>0.5?'take_profit':'manual') : (Math.random()>0.4?'stop_loss':'manual');

    await q(
      `INSERT INTO trades (id,challenge_id,user_id,symbol,direction,volume,open_price,close_price,stop_loss,take_profit,profit,commission,swap,status,open_time,close_time,close_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,'closed',datetime('now','-${hoursAgo+durMins} minutes'),datetime('now','-${hoursAgo} minutes'),?)`,
      [uuidv4(), ch1Id, traderId, sym, dir, vol, open, close, sl, tp, profit, -comm, reason]
    );
  }

  // ── 3 open positions for the terminal demo ────────────────────────────────
  const openTrades = [
    { sym:'EURUSD', dir:'buy',  vol:0.5,  open:1.08420, sl:1.08220, tp:1.08820, comm:1.75 },
    { sym:'XAUUSD', dir:'sell', vol:0.1,  open:2341.50, sl:2355.00, tp:2318.00, comm:0.35 },
    { sym:'NAS100', dir:'buy',  vol:0.25, open:18195.0, sl:18050.0, tp:18450.0, comm:0.88 },
  ];
  for (const t of openTrades) {
    const inst = instruments[t.sym];
    const floatPips = (Math.random()*12-4);
    const floatProfit = +(floatPips * inst.pipVal * t.vol).toFixed(2);
    await q(
      `INSERT INTO trades (id,challenge_id,user_id,symbol,direction,volume,open_price,stop_loss,take_profit,profit,commission,swap,status,open_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'open',datetime('now','-${Math.floor(Math.random()*90+5)} minutes'))`,
      [uuidv4(), ch1Id, traderId, t.sym, t.dir, t.vol, t.open, t.sl, t.tp, floatProfit, -t.comm]
    );
  }

  await q(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES (?,?,'purchase',-499,'$100K Challenge Purchase','card')`, [uuidv4(), traderId]);
  await q(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES (?,?,'purchase',-299,'$50K Challenge Purchase','card')`, [uuidv4(), traderId]);
  await q(`INSERT INTO transactions (id,user_id,type,amount,description,payment_method) VALUES (?,?,'purchase',-179,'$25K Challenge Purchase','crypto')`, [uuidv4(), traderId]);
  await q(`INSERT INTO transactions (id,user_id,type,amount,description) VALUES (?,?,'payout',4200,'Profit Payout')`, [uuidv4(), traderId]);

  await q(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES (?,?,'CHALLENGE_CREATED','challenge',?,'User purchased $100K challenge')`, [uuidv4(), traderId, ch1Id]);
  await q(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES (?,?,'CHALLENGE_PASSED','challenge',?,'Profit target reached')`, [uuidv4(), traderId, ch2Id]);
  await q(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES (?,?,'CHALLENGE_BREACHED','challenge',?,'Max total drawdown exceeded')`, [uuidv4(), traderId, ch3Id]);

  console.log('  ✓ Database seeded with demo data');
}

// ============================================================
// INIT
// ============================================================
async function initDatabase() {
  if (USE_SQLITE) {
    await initSqlJs();
    // SQLite — run all tables synchronously
    for (const sql of TABLES) {
      try { sqliteDb.prepare(toSqlite(sql)).run(); } catch(e) { console.error('[SQLite table]', e.message); }
    }
    for (const sql of INDEXES) {
      try { sqliteDb.prepare(toSqlite(sql)).run(); } catch(_) {}
    }
    console.log('  ✓ SQLite schema created');

    // Migrations for SQLite — ALTER TABLE ADD COLUMN (ignore if exists)
    const migrations = [
      `ALTER TABLE challenges ADD COLUMN phase INTEGER DEFAULT 1`,
      `ALTER TABLE challenges ADD COLUMN parent_challenge_id TEXT`,
      `ALTER TABLE challenges ADD COLUMN consistency_best_day_pct REAL DEFAULT 0`,
      `ALTER TABLE challenges ADD COLUMN platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE funded_accounts ADD COLUMN platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE users ADD COLUMN terms_accepted_at TEXT`,
      `ALTER TABLE users ADD COLUMN terms_version TEXT DEFAULT 'v1'`,
      `ALTER TABLE challenges ADD COLUMN ctrader_password TEXT`,
      `ALTER TABLE challenges ADD COLUMN fee_refunded INTEGER DEFAULT 0`,
      `ALTER TABLE challenges ADD COLUMN trading_days INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN referral_code TEXT`,
      `ALTER TABLE users ADD COLUMN referred_by TEXT`,
      `ALTER TABLE users ADD COLUMN affiliate_earnings REAL DEFAULT 0`,
      `ALTER TABLE trades ADD COLUMN close_reason TEXT`,
      `ALTER TABLE trades ADD COLUMN comment TEXT`,
      `ALTER TABLE trades ADD COLUMN current_price REAL`,
      `ALTER TABLE trades ADD COLUMN pips REAL DEFAULT 0`,
      `ALTER TABLE trades ADD COLUMN trailing_stop_pips REAL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS pending_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge_id TEXT, funded_account_id TEXT, symbol TEXT NOT NULL, direction TEXT NOT NULL, order_type TEXT NOT NULL, volume REAL NOT NULL, entry_price REAL NOT NULL, stop_loss REAL, take_profit REAL, trailing_stop_pips REAL DEFAULT 0, expiry TEXT, status TEXT DEFAULT 'pending', commission REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), filled_at TEXT, cancelled_at TEXT, cancel_reason TEXT)`,
      `CREATE TABLE IF NOT EXISTS symbol_settings (symbol TEXT PRIMARY KEY, spread_markup REAL DEFAULT 0, min_volume REAL DEFAULT 0.01, max_volume REAL DEFAULT 100, step_volume REAL DEFAULT 0.01, commission_per_lot REAL DEFAULT 3.5, swap_long REAL DEFAULT 0, swap_short REAL DEFAULT 0, trading_enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ip_address TEXT, user_agent TEXT, country TEXT, platform TEXT DEFAULT 'web', login_at TEXT DEFAULT (datetime('now')), last_seen TEXT DEFAULT (datetime('now')), is_active INTEGER DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS password_reset_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
    ];
    for (const sql of migrations) {
      try { sqliteDb.prepare(sql).run(); } catch(_) { /* column already exists */ }
    }

    // Seed demo_mode setting
    try {
      sqliteDb.prepare(`INSERT OR IGNORE INTO platform_settings (key,value) VALUES ('demo_mode','false')`).run();
    } catch(_) {}

    console.log('  ✓ SQLite migrations applied');
    await seedDatabase(null);
    return;
  }

  // PostgreSQL path
  const client = await pool.connect();
  try {
    for (const sql of TABLES) {
      await client.query(sql);
    }
    for (const sql of INDEXES) {
      try { await client.query(sql); } catch(_) {}
    }
    console.log('  ✓ Database schema created');

    const migrations = [
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS phase INTEGER DEFAULT 1`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS parent_challenge_id TEXT`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS consistency_best_day_pct REAL DEFAULT 0`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE funded_accounts ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ctrader'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT DEFAULT 'v1'`,
      `INSERT INTO platform_settings (key, value) VALUES ('demo_mode', 'false') ON CONFLICT (key) DO NOTHING`,
      `INSERT INTO platform_settings (key, value) VALUES ('risk_defaults', '{"one_step":{"profit_target_pct":10,"max_daily_loss_pct":5,"max_total_loss_pct":8,"leverage":"1:30","profit_split_pct":80,"min_trading_days":3,"consistency_rule_pct":20,"inactivity_days":30},"two_step_p1":{"profit_target_pct":8,"max_daily_loss_pct":5,"max_total_loss_pct":10,"leverage":"1:30","profit_split_pct":80},"two_step_p2":{"profit_target_pct":5,"max_daily_loss_pct":5,"max_total_loss_pct":10,"leverage":"1:30","profit_split_pct":80},"funded":{"max_daily_loss_pct":5,"max_total_loss_pct":8,"leverage":"1:30","profit_split_pct":80}}') ON CONFLICT (key) DO NOTHING`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS ctrader_password TEXT`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS fee_refunded INTEGER DEFAULT 0`,
      `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS trading_days INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_earnings REAL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS password_reset_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (NOW()::TEXT))`,
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS close_reason TEXT`,
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS comment TEXT`,
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS current_price REAL`,
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS pips REAL DEFAULT 0`,
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS trailing_stop_pips REAL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS pending_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge_id TEXT, funded_account_id TEXT, symbol TEXT NOT NULL, direction TEXT NOT NULL, order_type TEXT NOT NULL, volume REAL NOT NULL, entry_price REAL NOT NULL, stop_loss REAL, take_profit REAL, trailing_stop_pips REAL DEFAULT 0, expiry TEXT, status TEXT DEFAULT 'pending', commission REAL DEFAULT 0, created_at TEXT DEFAULT (NOW()::TEXT), filled_at TEXT, cancelled_at TEXT, cancel_reason TEXT)`,
      `CREATE TABLE IF NOT EXISTS symbol_settings (symbol TEXT PRIMARY KEY, spread_markup REAL DEFAULT 0, min_volume REAL DEFAULT 0.01, max_volume REAL DEFAULT 100, step_volume REAL DEFAULT 0.01, commission_per_lot REAL DEFAULT 3.5, swap_long REAL DEFAULT 0, swap_short REAL DEFAULT 0, trading_enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (NOW()::TEXT))`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ip_address TEXT, user_agent TEXT, country TEXT, platform TEXT DEFAULT 'web', login_at TEXT DEFAULT (NOW()::TEXT), last_seen TEXT DEFAULT (NOW()::TEXT), is_active INTEGER DEFAULT 1)`,
    ];
    for (const sql of migrations) {
      try { await client.query(sql); } catch(_) {}
    }
    console.log('  ✓ Migrations applied');
    await seedDatabase(client);
  } finally {
    client.release();
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = { initDatabase, queryAll, queryOne, run, getDb };
