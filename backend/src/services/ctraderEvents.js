// ============================================================
// cTRADER EVENT LISTENER
// ============================================================
// Subscribes to the live Manager API connection and reacts to:
//   - Execution events (trade opens/closes)
//   - Margin change events (equity/drawdown updates)
//
// For each event:
//   1. Look up which challenge/funded account owns the trader
//   2. Update current_balance, current_equity, highest_balance in DB
//   3. Trigger risk engine check → if breach, call ctrader.disableAccount()
//
// This runs alongside the main server, started by server.js on boot.
// ============================================================

const ctraderService = require('./ctrader');
const { queryOne, run } = require('../models/database');

class CTraderEventListener {
  constructor() { this.started = false; }

  start() {
    if (this.started) return;
    const client = ctraderService.raw;
    if (!client) {
      console.log('[EventListener] cTrader client not available — skipping');
      return;
    }

    client.on('authenticated', () => {
      console.log('[EventListener] Subscribed to cTrader events');
    });

    client.on('execution', (event) => this.handleExecution(event).catch(e => console.error('[EventListener] execution error:', e.message)));
    client.on('margin-changed', (event) => this.handleMarginChanged(event).catch(e => console.error('[EventListener] margin error:', e.message)));

    client.on('disconnected', () => console.warn('[EventListener] cTrader disconnected'));

    this.started = true;
    console.log('[EventListener] Started');
  }

  async handleExecution(event) {
    const deal = event.deal;
    if (!deal) return;

    const traderId = deal.traderId?.toString();
    if (!traderId) return;

    // Find the challenge OR funded account this traderId belongs to
    const challenge = await queryOne(`SELECT * FROM challenges WHERE ctrader_account_id=$1 AND status='active'`, [traderId]);
    const funded = await queryOne(`SELECT * FROM funded_accounts WHERE ctrader_account_id=$1 AND status='active'`, [traderId]);
    const account = challenge || funded;
    if (!account) return;

    // Update trade count, last_trade_at
    const isClosing = deal.closePositionDetail?.balance !== undefined;
    const table = challenge ? 'challenges' : 'funded_accounts';
    const profit = isClosing ? Number(deal.closePositionDetail.grossProfit || 0) / 100 : 0;

    // Insert trade record
    if (isClosing) {
      await run(`INSERT INTO trades (id, user_id, ${challenge ? 'challenge_id' : 'funded_account_id'}, symbol, direction, volume, open_price, close_price, profit, open_time, close_time, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed')`,
        [`trade_${deal.dealId}`, account.user_id, account.id,
         deal.symbolName || 'UNKNOWN',
         deal.tradeSide === 1 ? 'BUY' : 'SELL',
         Number(deal.filledVolume || 0) / 100,
         Number(deal.executionPrice || 0),
         Number(deal.closePositionDetail?.closingPrice || 0),
         profit,
         new Date(Number(deal.createTimestamp || Date.now())).toISOString(),
         new Date().toISOString()]);
    }

    // Update balance from deal
    if (isClosing && deal.closePositionDetail?.balance !== undefined) {
      const newBalance = Number(deal.closePositionDetail.balance) / 100;
      await run(`UPDATE ${table} SET 
        current_balance=?, current_equity=?, total_profit=total_profit+?,
        total_trades=total_trades+1,
        winning_trades=winning_trades+?, losing_trades=losing_trades+?,
        highest_balance=GREATEST(COALESCE(highest_balance, 0), ?),
        last_trade_at=NOW()::TEXT
        WHERE id=?`,
        [newBalance, newBalance, profit, profit > 0 ? 1 : 0, profit <= 0 ? 1 : 0, newBalance, account.id]);
    }

    // Trigger risk check
    const riskEngine = require('./riskEngine');
    if (challenge) {
      const result = await riskEngine.checkChallenge(account.id);
      if (result.breached) {
        console.log(`[EventListener] Challenge ${account.id} breached: ${result.reason}`);
        await ctraderService.disableAccount(traderId, 'CLOSE_ONLY');
      }
    } else if (funded) {
      const result = await riskEngine.checkFundedAccount(account.id);
      if (result.breached) {
        console.log(`[EventListener] Funded account ${account.id} breached: ${result.reason}`);
        await ctraderService.disableAccount(traderId, 'CLOSE_ONLY');
      }
    }
  }

  async handleMarginChanged(event) {
    // Margin changes happen frequently during open positions
    // We use these to update equity in near-real-time
    const positionId = event.positionId?.toString();
    if (!positionId) return;
    // For now just log — full implementation would look up position → trader → update equity
    // console.log(`[EventListener] Margin change on position ${positionId}`);
  }
}

module.exports = new CTraderEventListener();
