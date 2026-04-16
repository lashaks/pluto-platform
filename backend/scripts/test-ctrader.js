// ============================================================
// cTRADER SANDBOX TEST SCRIPT
// ============================================================
// Run this locally to verify Manager API connection before deploying.
//
// Usage:
//   cd backend
//   npm install
//   CTRADER_MANAGER_PASSWORD='your_password' node scripts/test-ctrader.js
//
// If env var not set, falls back to the sandbox default.
// ============================================================

const { CTraderManagerClient, AccessRights } = require('../src/services/ctrader');

const config = {
  host: process.env.CTRADER_HOST || 'uat-demo.p.ctrader.com',
  port: parseInt(process.env.CTRADER_PORT || '5011', 10),
  plantId: process.env.CTRADER_PLANT_ID || 'propsandbox',
  environmentName: process.env.CTRADER_ENV || 'demo',
  login: parseInt(process.env.CTRADER_MANAGER_LOGIN || '30054', 10),
  password: process.env.CTRADER_MANAGER_PASSWORD || 'Wwee3456#',
  groupId: parseInt(process.env.CTRADER_GROUP_ID || '0', 10),
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('\n========================================');
  console.log('  PLUTO CAPITAL — cTrader Sandbox Test');
  console.log('========================================\n');
  console.log('Config:');
  console.log(`  Host: ${config.host}:${config.port}`);
  console.log(`  Plant: ${config.plantId}`);
  console.log(`  Environment: ${config.environmentName}`);
  console.log(`  Manager Login: ${config.login}`);
  console.log(`  Group ID: ${config.groupId || '(not set — pass CTRADER_GROUP_ID env var)'}\n`);

  const client = new CTraderManagerClient(config);

  // Wire up event listeners
  client.on('execution', (e) => console.log('[EVENT] Execution:', e.executionType, e.position?.positionId || ''));
  client.on('margin-changed', (e) => console.log('[EVENT] Margin changed on position', e.positionId));
  client.on('server-error', (e) => console.log('[EVENT] Server error:', e.errorCode, e.description));

  // ============================================================
  // TEST 1: Connect + Authenticate
  // ============================================================
  console.log('TEST 1: Connecting + authenticating...');
  try {
    await client.connect();
    console.log('  ✓ Connected and authenticated successfully\n');
  } catch (err) {
    console.error('  ✗ FAILED:', err.message);
    console.error('\n  Common causes:');
    console.error('    - Wrong password (currently using Wwee3456#)');
    console.error('    - Wrong plantId (should be: propsandbox)');
    console.error('    - Wrong environment (should be: demo)');
    console.error('    - Wrong manager login (currently: ' + config.login + ')');
    process.exit(1);
  }

  // ============================================================
  // TEST 2: List existing traders in the group
  // ============================================================
  if (config.groupId) {
    console.log('TEST 2: Listing traders in group ' + config.groupId + '...');
    try {
      const traders = await client.listTraders();
      console.log(`  ✓ Found ${traders.length} traders in group`);
      if (traders.length) {
        console.log('  First 3 traders:');
        traders.slice(0, 3).forEach(t => {
          console.log(`    - traderId=${t.traderId}, login=${t.login}, balance=$${(Number(t.balance) / 100).toFixed(2)}`);
        });
      }
      console.log('');
    } catch (err) {
      console.error('  ✗ FAILED:', err.message, '\n');
    }
  } else {
    console.log('TEST 2: SKIPPED (no group ID set)\n');
  }

  // ============================================================
  // TEST 3: Create a test trader (only if group ID is set)
  // ============================================================
  let testTraderId = null;
  if (config.groupId) {
    console.log('TEST 3: Creating a test trader account ($10,000 demo)...');
    try {
      const result = await client.createAccount({
        balance: 10000,
        name: 'Pluto Test Trader',
        email: 'test@plutocapitalfunding.com',
        leverageInCents: 3000, // 1:30
        swapFree: true,
      });
      testTraderId = parseInt(result.traderId, 10);
      console.log(`  ✓ Created trader: login=${result.login}, password=${result.password}, traderId=${result.traderId}`);
      console.log('  Save these credentials — you can log into cTrader Web with them.\n');
    } catch (err) {
      console.error('  ✗ FAILED:', err.message);
      console.error('  If error is "CANT_ROUTE_REQUEST" or similar, the group ID is wrong.\n');
    }
  } else {
    console.log('TEST 3: SKIPPED (no group ID set)\n');
  }

  // ============================================================
  // TEST 4: Adjust balance (deposit $500)
  // ============================================================
  if (testTraderId) {
    console.log('TEST 4: Depositing $500 to test trader...');
    try {
      await client.changeBalance(testTraderId, 500, 'Test deposit', 'Test deposit from Pluto platform');
      console.log('  ✓ Deposit successful\n');
      await sleep(500);

      // Verify by re-fetching
      const trader = await client.getTrader(testTraderId);
      if (trader) console.log(`  New balance: $${(Number(trader.balance) / 100).toFixed(2)}\n`);
    } catch (err) {
      console.error('  ✗ FAILED:', err.message);
      console.error('  This is a critical permission — if it fails, the manager login cannot do payouts.\n');
    }
  }

  // ============================================================
  // TEST 5: Disable trading (simulate breach)
  // ============================================================
  if (testTraderId) {
    console.log('TEST 5: Setting trader access to CLOSE_ONLY (simulating breach)...');
    try {
      await client.disableTrading(testTraderId);
      console.log('  ✓ Trading disabled successfully\n');

      await sleep(500);
      console.log('  Re-enabling for cleanup...');
      await client.enableTrading(testTraderId);
      console.log('  ✓ Trading re-enabled\n');
    } catch (err) {
      console.error('  ✗ FAILED:', err.message, '\n');
    }
  }

  // ============================================================
  // TEST 6: Get open positions (should be empty)
  // ============================================================
  if (testTraderId) {
    console.log('TEST 6: Checking open positions for test trader...');
    try {
      const positions = await client.getOpenPositions(testTraderId);
      console.log(`  ✓ Open positions: ${positions.length}\n`);
    } catch (err) {
      console.error('  ✗ FAILED:', err.message, '\n');
    }
  }

  // ============================================================
  // Wait for a moment for any streaming events
  // ============================================================
  console.log('Listening for 5 seconds for streaming events...');
  await sleep(5000);

  // ============================================================
  // Clean up
  // ============================================================
  console.log('\n========================================');
  console.log('  All tests complete. Closing connection.');
  console.log('========================================\n');
  client.close();
  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL]', err.message);
  console.error(err.stack);
  process.exit(1);
});
