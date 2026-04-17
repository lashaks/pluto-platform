/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Simulated Order Engine
   Handles: market orders, limit/stop pending orders, SL/TP auto-close,
   real-time P&L, commission, swap, all risk rules
───────────────────────────────────────────────────────────────────────────── */

const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../models/database');
const marketData = require('./marketData');
const riskEngine = require('./riskEngine');

class OrderEngine {

  constructor() {
    // Active positions in memory for fast P&L updates
    // { positionId: { ...posData } }
    this.positions = {};
    this.initialized = false;
  }

  // ── Startup: load all open positions from DB ──────────────────────────────
  async init() {
    if (this.initialized) return;
    try {
      const openTrades = await queryAll(`SELECT * FROM trades WHERE status='open'`);
      openTrades.forEach(t => { this.positions[t.id] = t; });
      console.log(`[OrderEngine] Loaded ${openTrades.length} open positions`);
    } catch(_) {}

    // Listen to price ticks — update all open positions
    marketData.on('tick', (tick) => {
      this._onTick(tick);
    });

    this.initialized = true;
  }

  // ── Open a market order ────────────────────────────────────────────────────
  async openPosition(params) {
    const {
      userId, challengeId, fundedAccountId,
      symbol, direction, volume,
      stopLoss, takeProfit, comment,
    } = params;

    const inst = marketData.getInstrument(symbol);
    if (!inst) throw new Error(`Unknown instrument: ${symbol}`);

    const price = marketData.getPrice(symbol);
    if (!price) throw new Error('No price available for ' + symbol);

    // Buy = ask, Sell = bid
    const openPrice = direction === 'buy' ? price.ask : price.bid;

    // ── Account validation ─────────────────────────────────────────────────
    const account = await this._getAccount(challengeId, fundedAccountId);
    if (!account) throw new Error('Account not found or inactive');
    if (account.status !== 'active') throw new Error(`Account is ${account.status}`);

    // Lot size validation
    const maxLots = this._getMaxLots(account.account_size);
    const currentLots = await this._getOpenLots(challengeId, fundedAccountId);
    if (currentLots + volume > maxLots) {
      throw new Error(`Max lot exposure exceeded. Limit: ${maxLots} lots, current: ${currentLots.toFixed(2)}`);
    }

    // Commission: $3.5 per lot per side (round turn = $7)
    const commission = -(volume * 3.5);

    // Validate SL/TP
    if (stopLoss) {
      if (direction === 'buy'  && stopLoss >= openPrice) throw new Error('Stop loss must be below entry for buy');
      if (direction === 'sell' && stopLoss <= openPrice) throw new Error('Stop loss must be above entry for sell');
    }
    if (takeProfit) {
      if (direction === 'buy'  && takeProfit <= openPrice) throw new Error('Take profit must be above entry for buy');
      if (direction === 'sell' && takeProfit >= openPrice) throw new Error('Take profit must be below entry for sell');
    }

    // ── Create position ────────────────────────────────────────────────────
    const id = uuidv4();
    const now = new Date().toISOString();

    await run(`
      INSERT INTO trades (
        id, user_id, challenge_id, funded_account_id,
        symbol, direction, volume,
        open_price, stop_loss, take_profit,
        profit, commission, swap,
        open_time, status, comment
      ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,0,?,'open',?)
    `, [id, userId, challengeId || null, fundedAccountId || null,
        symbol, direction, volume,
        openPrice, stopLoss || null, takeProfit || null,
        commission, now, comment || '']);

    // Update account commission immediately
    const newBalance = account.current_balance + commission;
    await this._updateAccountBalance(account, newBalance, newBalance);

    // Add to memory
    this.positions[id] = {
      id, userId, challengeId, fundedAccountId,
      symbol, direction, volume,
      open_price: openPrice, stop_loss: stopLoss, take_profit: takeProfit,
      profit: 0, commission, swap: 0,
      open_time: now, status: 'open',
    };

    console.log(`[OrderEngine] OPEN ${direction.toUpperCase()} ${volume} ${symbol} @ ${openPrice} [${id.slice(0,8)}]`);
    return { id, openPrice, commission, symbol, direction, volume };
  }

  // ── Close a position manually ─────────────────────────────────────────────
  async closePosition(positionId, userId) {
    const pos = await queryOne(`SELECT * FROM trades WHERE id=$1 AND user_id=$2 AND status='open'`, [positionId, userId]);
    if (!pos) throw new Error('Position not found or already closed');

    return this._closePosition(pos, 'manual');
  }

  // ── Modify SL/TP ──────────────────────────────────────────────────────────
  async modifyPosition(positionId, userId, { stopLoss, takeProfit }) {
    const pos = await queryOne(`SELECT * FROM trades WHERE id=$1 AND user_id=$2 AND status='open'`, [positionId, userId]);
    if (!pos) throw new Error('Position not found');

    const price = marketData.getPrice(pos.symbol);
    const currentPrice = pos.direction === 'buy' ? price?.bid : price?.ask;

    if (stopLoss !== undefined && stopLoss !== null) {
      if (pos.direction === 'buy'  && stopLoss >= currentPrice) throw new Error('SL must be below current price for buy');
      if (pos.direction === 'sell' && stopLoss <= currentPrice) throw new Error('SL must be above current price for sell');
    }
    if (takeProfit !== undefined && takeProfit !== null) {
      if (pos.direction === 'buy'  && takeProfit <= currentPrice) throw new Error('TP must be above current price for buy');
      if (pos.direction === 'sell' && takeProfit >= currentPrice) throw new Error('TP must be below current price for sell');
    }

    await run(`UPDATE trades SET stop_loss=?, take_profit=? WHERE id=?`,
      [stopLoss ?? pos.stop_loss, takeProfit ?? pos.take_profit, positionId]);

    if (this.positions[positionId]) {
      this.positions[positionId].stop_loss   = stopLoss   ?? pos.stop_loss;
      this.positions[positionId].take_profit = takeProfit ?? pos.take_profit;
    }
    return { success: true };
  }

  // ── Tick handler — update floating P&L, check SL/TP ─────────────────────
  async _onTick(tick) {
    const { symbol, bid, ask } = tick;
    const inst = marketData.getInstrument(symbol);
    if (!inst) return;

    // Find all open positions for this symbol
    const symPositions = Object.values(this.positions).filter(p => p.symbol === symbol);

    for (const pos of symPositions) {
      const currentPrice = pos.direction === 'buy' ? bid : ask;
      const priceDiff    = pos.direction === 'buy'
        ? bid - pos.open_price
        : pos.open_price - ask;

      // P&L = price diff in pips × pip value × volume × lot size
      const pips   = priceDiff / inst.pip;
      const profit = +(pips * inst.pipValue * pos.volume).toFixed(2);

      this.positions[pos.id].profit = profit;

      // Update DB less frequently (every 5 ticks worth of change)
      await run(`UPDATE trades SET profit=? WHERE id=?`, [profit, pos.id]);

      // Update account equity
      const account = await this._getAccount(pos.challengeId, pos.fundedAccountId);
      if (!account) continue;

      // Equity = balance + all floating P&L for this account
      const totalFloat = await this._getTotalFloatingPnL(pos.challengeId, pos.fundedAccountId);
      const equity = account.current_balance + totalFloat;
      await this._updateAccountBalance(account, account.current_balance, equity);

      // ── SL/TP auto-close ─────────────────────────────────────────────────
      if (pos.stop_loss) {
        const slHit = pos.direction === 'buy'
          ? bid <= pos.stop_loss
          : ask >= pos.stop_loss;
        if (slHit) { this._closePosition(pos, 'stop_loss'); continue; }
      }
      if (pos.take_profit) {
        const tpHit = pos.direction === 'buy'
          ? bid >= pos.take_profit
          : ask <= pos.take_profit;
        if (tpHit) { this._closePosition(pos, 'take_profit'); continue; }
      }

      // ── Risk engine check ─────────────────────────────────────────────────
      if (pos.challengeId) {
        const check = await riskEngine.checkChallenge(pos.challengeId);
        if (check.breached) {
          // Close all positions for this challenge
          await this._closeAllForAccount(pos.challengeId, null);
        } else if (check.targetReached) {
          riskEngine.passChallenge(pos.challengeId).catch(console.error);
        }
      } else if (pos.fundedAccountId) {
        const check = await riskEngine.checkFundedAccount(pos.fundedAccountId);
        if (check.breached) await this._closeAllForAccount(null, pos.fundedAccountId);
      }
    }
  }

  // ── Internal: close a position ────────────────────────────────────────────
  async _closePosition(pos, reason) {
    const price = marketData.getPrice(pos.symbol);
    if (!price) return;

    const inst       = marketData.getInstrument(pos.symbol);
    const closePrice = pos.direction === 'buy' ? price.bid : price.ask;
    const priceDiff  = pos.direction === 'buy'
      ? closePrice - pos.open_price
      : pos.open_price - closePrice;

    const pips    = priceDiff / inst.pip;
    const profit  = +(pips * inst.pipValue * pos.volume).toFixed(2);
    const now     = new Date().toISOString();

    // Calculate swap (0.5% of position value per day for >24h positions)
    const hoursOpen = (Date.now() - new Date(pos.open_time).getTime()) / 3600000;
    const swap = +(hoursOpen >= 24 ? -(pos.volume * pos.open_price * 0.005 / 365) : 0).toFixed(2);

    await run(`
      UPDATE trades SET
        status='closed', close_price=?, close_time=?,
        profit=?, swap=?, close_reason=?
      WHERE id=?
    `, [closePrice, now, profit, swap, reason, pos.id]);

    // Remove from memory
    delete this.positions[pos.id];

    // Update account balance
    const account = await this._getAccount(pos.challengeId, pos.fundedAccountId);
    if (!account) return;

    const realizedPnL = profit + swap; // commission already deducted at open
    const newBalance  = +(account.current_balance + realizedPnL).toFixed(2);
    const totalFloat  = await this._getTotalFloatingPnL(pos.challengeId, pos.fundedAccountId);
    const newEquity   = +(newBalance + totalFloat).toFixed(2);

    await this._updateAccountBalance(account, newBalance, newEquity, profit);

    // Update trade stats on account
    await this._updateTradeStats(pos.challengeId, pos.fundedAccountId, profit);

    console.log(`[OrderEngine] CLOSE ${pos.direction.toUpperCase()} ${pos.volume} ${pos.symbol} @ ${closePrice} P&L:${profit} [${reason}]`);
    return { closePrice, profit, swap, reason };
  }

  async _closeAllForAccount(challengeId, fundedAccountId) {
    const positions = Object.values(this.positions).filter(p =>
      challengeId ? p.challengeId === challengeId : p.fundedAccountId === fundedAccountId
    );
    for (const pos of positions) {
      await this._closePosition(pos, 'force_close');
    }
  }

  // ── Account helpers ───────────────────────────────────────────────────────
  async _getAccount(challengeId, fundedAccountId) {
    if (challengeId) return queryOne(`SELECT * FROM challenges WHERE id=$1`, [challengeId]);
    if (fundedAccountId) return queryOne(`SELECT * FROM funded_accounts WHERE id=$1`, [fundedAccountId]);
    return null;
  }

  async _updateAccountBalance(account, balance, equity, lastProfit) {
    const highest = Math.max(account.highest_balance || 0, balance);
    const lowest  = Math.min(account.lowest_equity  || equity, equity);

    if (account.challenge_type !== undefined) {
      await run(`
        UPDATE challenges SET
          current_balance=?, current_equity=?,
          highest_balance=?, lowest_equity=?
        WHERE id=?
      `, [balance, equity, highest, lowest, account.id]);
    } else {
      await run(`
        UPDATE funded_accounts SET
          current_balance=?, current_equity=?,
          highest_balance=?, lowest_equity=?
        WHERE id=?
      `, [balance, equity, highest, lowest, account.id]);
    }
  }

  async _updateTradeStats(challengeId, fundedAccountId, profit) {
    const table = challengeId ? 'challenges' : 'funded_accounts';
    const id    = challengeId || fundedAccountId;
    const won   = profit > 0 ? 1 : 0;
    const lost  = profit <= 0 ? 1 : 0;
    await run(`
      UPDATE ${table} SET
        total_trades = total_trades + 1,
        winning_trades = winning_trades + ?,
        losing_trades = losing_trades + ?,
        total_profit = total_profit + ?,
        last_trade_at = ?
      WHERE id=?
    `, [won, lost, profit, new Date().toISOString(), id]);
  }

  async _getTotalFloatingPnL(challengeId, fundedAccountId) {
    if (challengeId) {
      const r = await queryOne(`SELECT COALESCE(SUM(profit),0) as total FROM trades WHERE challenge_id=$1 AND status='open'`, [challengeId]);
      return r?.total || 0;
    }
    if (fundedAccountId) {
      const r = await queryOne(`SELECT COALESCE(SUM(profit),0) as total FROM trades WHERE funded_account_id=$1 AND status='open'`, [fundedAccountId]);
      return r?.total || 0;
    }
    return 0;
  }

  async _getOpenLots(challengeId, fundedAccountId) {
    if (challengeId) {
      const r = await queryOne(`SELECT COALESCE(SUM(volume),0) as lots FROM trades WHERE challenge_id=$1 AND status='open'`, [challengeId]);
      return r?.lots || 0;
    }
    if (fundedAccountId) {
      const r = await queryOne(`SELECT COALESCE(SUM(volume),0) as lots FROM trades WHERE funded_account_id=$1 AND status='open'`, [fundedAccountId]);
      return r?.lots || 0;
    }
    return 0;
  }

  _getMaxLots(accountSize) {
    const config = require('../../config');
    const sizes = Object.keys(config.oneStepRules.max_lot_exposure).map(Number).sort((a,b)=>a-b);
    for (const s of sizes) { if (accountSize <= s) return config.oneStepRules.max_lot_exposure[s]; }
    return config.oneStepRules.max_lot_exposure[200000];
  }

  // ── Get open positions for a user/account ─────────────────────────────────
  async getOpenPositions(userId, challengeId, fundedAccountId) {
    let q, params;
    if (challengeId) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 AND status='open' ORDER BY open_time DESC`;
      params = [userId, challengeId];
    } else if (fundedAccountId) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND funded_account_id=$2 AND status='open' ORDER BY open_time DESC`;
      params = [userId, fundedAccountId];
    } else {
      q = `SELECT * FROM trades WHERE user_id=$1 AND status='open' ORDER BY open_time DESC`;
      params = [userId];
    }
    const trades = await queryAll(q, params);

    // Enrich with current price and live P&L
    return trades.map(t => {
      const price = marketData.getPrice(t.symbol);
      const inst  = marketData.getInstrument(t.symbol);
      const mem   = this.positions[t.id];
      const liveProfit = mem?.profit ?? t.profit;
      const currentPrice = price ? (t.direction === 'buy' ? price.bid : price.ask) : t.open_price;
      const pips = inst ? (t.direction === 'buy'
        ? (currentPrice - t.open_price) / inst.pip
        : (t.open_price - currentPrice) / inst.pip) : 0;

      return { ...t, profit: liveProfit, current_price: currentPrice, pips: +pips.toFixed(1) };
    });
  }
}

module.exports = new OrderEngine();
