#!/usr/bin/env node
// ============================================================
// PLUTO CAPITAL — cTrader Sandbox Quick Test
// ============================================================
// This script does EVERYTHING:
//   1. Connects to the sandbox (TLS)
//   2. Authenticates with your manager login
//   3. Auto-discovers the "Pluto Capital" group ID (no cBroker needed)
//   4. Creates a test trader account
//   5. Deposits $500 (tests balance permission)
//   6. Disables trading (tests breach enforcement)
//   7. Re-enables trading
//   8. Checks open positions
//
// Usage:
//   cd backend
//   npm install
//   node scripts/test-sandbox.js
//
// That's it. No env vars needed. No cBroker needed.
// ============================================================

const tls = require('tls');
const crypto = require('crypto');
const path = require('path');
const protobuf = require('protobufjs');

// Sandbox credentials (from Lev's email)
const HOST = 'uat-demo.p.ctrader.com';
const PORT = 5011;
const PLANT = 'propsandbox';
const ENV = 'demo';
const LOGIN = 30054;
const PASSWORD = 'Wwee3456#';

// Payload types
const PT = {
  HEARTBEAT: 51, ERROR: 50,
  AUTH_REQ: 301, AUTH_RES: 302,
  GROUP_LIST_REQ: 473, GROUP_LIST_RES: 474,
  TRADER_LIST_REQ: 403, TRADER_LIST_RES: 404,
  CRUD_TRADER_REQ: 501, CRUD_TRADER_RES: 502,
  CHANGE_BALANCE_REQ: 519, CHANGE_BALANCE_RES: 520,
  POSITION_LIST_REQ: 407, POSITION_LIST_RES: 408,
  HELLO: 990,
};

let root, socket, buffer = Buffer.alloc(0), msgId = 0;
const pending = new Map();

// === PROTOBUF HELPERS ===
function send(payloadType, typeName, obj, clientMsgId) {
  const MsgType = root.lookupType(typeName);
  const err = MsgType.verify(obj);
  if (err) throw new Error(`Verify failed: ${err}`);
  const payload = MsgType.encode(MsgType.create(obj)).finish();
  const ProtoMessage = root.lookupType('ProtoMessage');
  const wrapper = { payloadType, payload };
  if (clientMsgId) wrapper.clientMsgId = clientMsgId;
  const wrapped = ProtoMessage.encode(ProtoMessage.create(wrapper)).finish();
  const len = Buffer.alloc(4);
  len.writeUInt32BE(wrapped.length, 0);
  socket.write(Buffer.concat([len, wrapped]));
}

function request(payloadType, typeName, obj, expectedPT, responseName, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const id = `m${++msgId}_${Date.now()}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout waiting for ${responseName}`)); }, timeout);
    pending.set(id, { resolve, reject, timer, expectedPT, responseName });
    send(payloadType, typeName, obj, id);
  });
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32BE(0);
    if (buffer.length < 4 + len) break;
    const frame = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);
    onMessage(frame);
  }
}

let helloResolve;
function onMessage(frame) {
  const msg = root.lookupType('ProtoMessage').decode(frame);
  const { payloadType, payload, clientMsgId } = msg;

  if (payloadType === PT.HELLO) { if (helloResolve) helloResolve(); return; }
  if (payloadType === PT.HEARTBEAT) return;

  if (payloadType === PT.ERROR) {
    const err = root.lookupType('ProtoErrorRes').decode(payload);
    console.error(`  [ERROR] ${err.errorCode}: ${err.description || ''}`);
    if (clientMsgId && pending.has(clientMsgId)) {
      const p = pending.get(clientMsgId); clearTimeout(p.timer); pending.delete(clientMsgId);
      p.reject(new Error(`${err.errorCode}: ${err.description || ''}`));
    }
    return;
  }

  if (clientMsgId && pending.has(clientMsgId)) {
    const p = pending.get(clientMsgId); clearTimeout(p.timer); pending.delete(clientMsgId);
    try { p.resolve(root.lookupType(p.responseName).decode(payload)); }
    catch (e) { p.reject(e); }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const info = msg => console.log(`  \x1b[36mℹ\x1b[0m ${msg}`);

async function run() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   PLUTO CAPITAL — cTrader Sandbox Test        ║');
  console.log('  ║   No cBroker needed. Just run this script.    ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Host:     ${HOST}:${PORT}`);
  console.log(`  Plant:    ${PLANT}`);
  console.log(`  Manager:  ${LOGIN}`);
  console.log('');

  // Load protos
  root = await protobuf.load([
    path.join(__dirname, '../proto/CommonModelMessages_External.proto'),
    path.join(__dirname, '../proto/CommonMessages_External.proto'),
    path.join(__dirname, '../proto/CSModelMessages_External.proto'),
    path.join(__dirname, '../proto/CSMessages_External.proto'),
  ]);

  // ── TEST 1: CONNECT ──────────────────────────────
  console.log('TEST 1: TLS Connect + Authentication');
  try {
    await new Promise((resolve, reject) => {
      helloResolve = resolve;
      socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true }, () => {
        ok('TLS connected');
      });
      socket.on('data', onData);
      socket.on('error', e => reject(e));
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    ok('Received ProtoHelloEvent');

    const passwordHash = crypto.createHash('md5').update(PASSWORD).digest('hex');
    await request(PT.AUTH_REQ, 'ProtoManagerAuthReq', {
      plantId: PLANT, environmentName: ENV, login: LOGIN, passwordHash,
    }, PT.AUTH_RES, 'ProtoManagerAuthRes');

    ok(`Authenticated as manager ${LOGIN}`);
  } catch (e) {
    fail(`CONNECT FAILED: ${e.message}`);
    console.log('');
    console.log('  Possible causes:');
    console.log('  - Network/firewall blocking port 5011');
    console.log('  - Wrong password (still default Wwee3456# ?)');
    console.log('  - Sandbox may be down (contact Lev)');
    process.exit(1);
  }

  // Start heartbeat
  const hb = setInterval(() => { try { send(PT.HEARTBEAT, 'ProtoHeartbeatEvent', {}, null); } catch(e){} }, 25000);

  // ── TEST 2: DISCOVER GROUP ID ─────────────────────
  console.log('');
  console.log('TEST 2: Auto-discover Pluto Capital group ID');
  let groupId = null;
  try {
    const res = await request(PT.GROUP_LIST_REQ, 'ProtoLightGroupListReq', {}, PT.GROUP_LIST_RES, 'ProtoLightGroupListRes');
    const groups = res.lightGroup || [];
    ok(`Found ${groups.length} group(s) on this server:`);
    groups.forEach(g => {
      const marker = g.name && g.name.toLowerCase().includes('pluto') ? ' ◀── THIS ONE' : '';
      console.log(`      ID: ${g.groupId}  Name: "${g.name || '(unnamed)'}"  Enabled: ${g.enabled}${marker}`);
      if (g.name && g.name.toLowerCase().includes('pluto')) groupId = Number(g.groupId);
    });

    if (!groupId && groups.length > 0) {
      // If no "Pluto" group found, use the first enabled group
      const first = groups.find(g => g.enabled) || groups[0];
      groupId = Number(first.groupId);
      info(`No "Pluto Capital" group found — using first available: "${first.name}" (ID: ${groupId})`);
    }

    if (groupId) {
      ok(`Group ID: ${groupId}`);
      console.log('');
      console.log(`  ┌─────────────────────────────────────────────┐`);
      console.log(`  │  CTRADER_GROUP_ID = ${String(groupId).padEnd(25)}│`);
      console.log(`  │  Save this number for Railway env vars!     │`);
      console.log(`  └─────────────────────────────────────────────┘`);
    } else {
      fail('No groups found. Contact Lev to create the "Pluto Capital" group.');
      clearInterval(hb); socket.end(); process.exit(1);
    }
  } catch (e) {
    fail(`Group discovery failed: ${e.message}`);
    clearInterval(hb); socket.end(); process.exit(1);
  }

  // ── TEST 3: CREATE TEST TRADER ─────────────────────
  console.log('');
  console.log('TEST 3: Create $10,000 test trader');
  let traderId = null;
  let traderPassword = null;
  try {
    traderPassword = 'TestPluto' + Math.floor(Math.random() * 9000 + 1000);
    const passwordHash = crypto.createHash('md5').update(traderPassword).digest('hex');
    const res = await request(PT.CRUD_TRADER_REQ, 'ProtoCrudTraderReq', {
      operation: 1, // CREATE
      trader: {
        traderId: 0, login: 0, groupId,
        balance: 1000000, // $10,000 in cents (newWay=true, digits=2)
        accountType: 0, // HEDGED
        accessRights: 0, // FULL_ACCESS
        name: 'Pluto Test Trader',
        email: 'test@plutocapitalfunding.com',
        passwordHash,
        swapFree: true,
        leverageInCents: 3000, // 1:30
      },
    }, PT.CRUD_TRADER_RES, 'ProtoCrudTraderRes');

    traderId = Number(res.traderId);
    ok(`Created trader — ID: ${traderId}`);

    // Fetch to get the assigned login
    await sleep(500);
    const list = await request(PT.TRADER_LIST_REQ, 'ProtoTraderListReq', {
      fromTimestamp: 0, toTimestamp: Date.now(), groupId,
    }, PT.TRADER_LIST_RES, 'ProtoTraderListRes');
    const trader = (list.trader || []).find(t => Number(t.traderId) === traderId);
    const login = trader ? trader.login : traderId;
    ok(`Login: ${login}  |  Password: ${traderPassword}`);
    info('You can log into cTrader Web with these credentials');
  } catch (e) {
    fail(`Create failed: ${e.message}`);
    if (e.message.includes('CANT_ROUTE')) {
      info('This usually means the group ID is wrong or manager lacks permissions.');
    }
  }

  // ── TEST 4: DEPOSIT $500 (CRITICAL) ────────────────
  console.log('');
  console.log('TEST 4: Deposit $500 (tests ProtoChangeBalanceReq permission)');
  if (traderId) {
    try {
      await request(PT.CHANGE_BALANCE_REQ, 'ProtoChangeBalanceReq', {
        traderId, amount: 50000, type: 0, // DEPOSIT, $500 in cents
        comment: 'Sandbox test deposit',
        externalNote: 'Test from Pluto platform',
        newWay: true,
      }, PT.CHANGE_BALANCE_RES, 'ProtoChangeBalanceRes');

      ok('Deposit successful — balance permission CONFIRMED');
      info('This means payouts (balance resets) will work');
    } catch (e) {
      fail(`DEPOSIT FAILED: ${e.message}`);
      console.log('');
      console.log('  ⚠️  THIS IS A BLOCKER');
      console.log('  Your manager login cannot change balances.');
      console.log('  Email Lev: "Does manager 30054 have ProtoChangeBalanceReq permission?"');
      console.log('  Without this, the payout reset flow will not work.');
    }
  } else {
    info('Skipped — no trader to deposit to');
  }

  // ── TEST 5: DISABLE + RE-ENABLE TRADING ────────────
  console.log('');
  console.log('TEST 5: Disable trading (breach simulation)');
  if (traderId) {
    try {
      // Fetch current trader for UPDATE
      const list = await request(PT.TRADER_LIST_REQ, 'ProtoTraderListReq', {
        fromTimestamp: 0, toTimestamp: Date.now(), groupId,
      }, PT.TRADER_LIST_RES, 'ProtoTraderListRes');
      const trader = (list.trader || []).find(t => Number(t.traderId) === traderId);
      if (!trader) throw new Error('Trader not found for update');

      // Set CLOSE_ONLY
      trader.accessRights = 1; // CLOSE_ONLY
      delete trader.balance; // don't touch balance during access update
      await request(PT.CRUD_TRADER_REQ, 'ProtoCrudTraderReq', {
        operation: 3, trader, // UPDATE
      }, PT.CRUD_TRADER_RES, 'ProtoCrudTraderRes');

      ok('Set to CLOSE_ONLY — breach enforcement works');

      await sleep(300);

      // Re-enable
      trader.accessRights = 0; // FULL_ACCESS
      await request(PT.CRUD_TRADER_REQ, 'ProtoCrudTraderReq', {
        operation: 3, trader,
      }, PT.CRUD_TRADER_RES, 'ProtoCrudTraderRes');

      ok('Re-enabled to FULL_ACCESS');
    } catch (e) {
      fail(`Access control failed: ${e.message}`);
    }
  }

  // ── TEST 6: CHECK POSITIONS ────────────────────────
  console.log('');
  console.log('TEST 6: Get open positions');
  if (traderId) {
    try {
      const res = await request(PT.POSITION_LIST_REQ, 'ProtoPositionListReq', {
        traderId, fromTimestamp: 0, toTimestamp: Date.now(),
      }, PT.POSITION_LIST_RES, 'ProtoPositionListRes');
      ok(`Open positions: ${(res.position || []).length} (expected: 0)`);
    } catch (e) {
      fail(`Position query failed: ${e.message}`);
    }
  }

  // ── RESULTS ────────────────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   ALL TESTS COMPLETE                          ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  if (groupId) {
    console.log('  Next step — set these Railway environment variables:');
    console.log('');
    console.log('    CTRADER_ENABLED=true');
    console.log(`    CTRADER_HOST=${HOST}`);
    console.log(`    CTRADER_PORT=${PORT}`);
    console.log(`    CTRADER_PLANT_ID=${PLANT}`);
    console.log(`    CTRADER_ENV=${ENV}`);
    console.log(`    CTRADER_MANAGER_LOGIN=${LOGIN}`);
    console.log(`    CTRADER_MANAGER_PASSWORD=${PASSWORD}`);
    console.log(`    CTRADER_GROUP_ID=${groupId}`);
    console.log('');
    console.log('  Then redeploy Railway. Open admin panel → cTrader tab.');
    console.log('  All three status cards should turn green.');
  }
  console.log('');

  clearInterval(hb);
  socket.end();
  process.exit(0);
}

run().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
