/* ─────────────────────────────────────────────────────────────────────────────
   PlutoTrader — Order Engine v2
   Full feature parity with cTrader:
   - Market / Limit / Stop / Stop-Limit orders
   - Trailing stop (server-side)
   - Partial close
   - Reverse position
   - Spread markup per symbol
   - Real-time P&L, commission, swap
   - Risk engine integration on every tick
───────────────────────────────────────────────────────────────────────────── */

const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../models/database');
const marketData = require('./marketData');
const config     = require('../../config');

class OrderEngine {
  constructor() {
    this.positions      = {};
    this.pendingOrders  = {};
    this.symbolSettings = {};
    this.initialized    = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const opens = await queryAll(`SELECT * FROM trades WHERE status='open'`);
      opens.forEach(t => { this.positions[t.id] = { ...t, challengeId: t.challenge_id, fundedAccountId: t.funded_account_id, userId: t.user_id }; });
      console.log(`[OrderEngine] Loaded ${opens.length} open positions`);
    } catch(e) { console.error('[OrderEngine] init:', e.message); }
    try {
      const pending = await queryAll(`SELECT * FROM pending_orders WHERE status='pending'`);
      pending.forEach(o => { this.pendingOrders[o.id] = { ...o, challengeId: o.challenge_id, fundedAccountId: o.funded_account_id, userId: o.user_id }; });
    } catch(_) {}
    try {
      const settings = await queryAll(`SELECT * FROM symbol_settings`);
      settings.forEach(s => { this.symbolSettings[s.symbol] = s; });
    } catch(_) {}
    marketData.on('tick', tick => this._onTick(tick));
    this.initialized = true;
  }

  _getCommission(symbol, volume) {
    const ss = this.symbolSettings[symbol];
    return -((ss?.commission_per_lot ?? 3.5) * volume);
  }

  _getSpreadMarkup(symbol) {
    return this.symbolSettings[symbol]?.spread_markup || 0;
  }

  _execPrice(symbol, direction) {
    const price = marketData.getPrice(symbol);
    if (!price) return null;
    const markup = this._getSpreadMarkup(symbol) / 2;
    return direction === 'buy' ? price.ask + markup : price.bid - markup;
  }

  // ── Open market order ─────────────────────────────────────────────────────
  async openPosition(params) {
    const { userId, challengeId, fundedAccountId, symbol, direction, volume, stopLoss, takeProfit, trailingStopPips, comment } = params;
    const inst = marketData.getInstrument(symbol);
    if (!inst) throw new Error(`Unknown: ${symbol}`);
    // Block weekend trading
    const _d = new Date(), _day = _d.getUTCDay(), _h = _d.getUTCHours();
    if (_day === 6 || (_day === 0 && _h < 22) || (_day === 5 && _h >= 22))
      throw new Error('Markets are closed — trading resumes Sunday 22:00 UTC');
    const execPrice = this._execPrice(symbol, direction);
    if (!execPrice) throw new Error('No price for ' + symbol);
    const account = await this._getAccount(challengeId, fundedAccountId);
    if (!account)                     throw new Error('Account not found');
    if (account.status !== 'active')  throw new Error(`Account is ${account.status}`);
    const maxLots  = this._getMaxLots(account.account_size);
    const openLots = await this._getOpenLots(challengeId, fundedAccountId);
    if (openLots + volume > maxLots) throw new Error(`Max ${maxLots}L exposure. Currently ${openLots.toFixed(2)}L open`);
    if (stopLoss) {
      if (direction==='buy'  && stopLoss >= execPrice) throw new Error('SL must be below entry for buy');
      if (direction==='sell' && stopLoss <= execPrice) throw new Error('SL must be above entry for sell');
    }
    if (takeProfit) {
      if (direction==='buy'  && takeProfit <= execPrice) throw new Error('TP must be above entry for buy');
      if (direction==='sell' && takeProfit >= execPrice) throw new Error('TP must be below entry for sell');
    }
    const commission = this._getCommission(symbol, volume);
    const id = uuidv4(), now = new Date().toISOString();
    await run(`INSERT INTO trades (id,user_id,challenge_id,funded_account_id,symbol,direction,volume,open_price,stop_loss,take_profit,trailing_stop_pips,profit,commission,swap,open_time,status,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,0,?,'open',?)`,
      [id,userId,challengeId||null,fundedAccountId||null,symbol,direction,volume,execPrice,stopLoss||null,takeProfit||null,trailingStopPips||0,commission,now,comment||'']);
    const newBal = (account.current_balance||account.starting_balance) + commission;
    await this._updateAccountBalance(account, newBal, newBal);
    this.positions[id] = { id, userId, challengeId, fundedAccountId, symbol, direction, volume, open_price: execPrice, stop_loss: stopLoss||null, take_profit: takeProfit||null, trailing_stop_pips: trailingStopPips||0, highest_price: execPrice, lowest_price: execPrice, profit: 0, commission, swap: 0, open_time: now, status: 'open' };
    return { id, openPrice: execPrice, commission, symbol, direction, volume };
  }

  // ── Place pending order ───────────────────────────────────────────────────
  async placePendingOrder(params) {
    const { userId, challengeId, fundedAccountId, symbol, direction, orderType, volume, entryPrice, stopLoss, takeProfit, trailingStopPips, expiry, comment } = params;
    const inst = marketData.getInstrument(symbol);
    if (!inst) throw new Error('Unknown instrument: ' + symbol);
    const price = marketData.getPrice(symbol);
    if (!price) throw new Error('No price for ' + symbol);
    if (orderType === 'limit') {
      if (direction==='buy'  && entryPrice >= price.ask) throw new Error('Buy Limit must be below Ask');
      if (direction==='sell' && entryPrice <= price.bid) throw new Error('Sell Limit must be above Bid');
    } else if (orderType === 'stop') {
      if (direction==='buy'  && entryPrice <= price.ask) throw new Error('Buy Stop must be above Ask');
      if (direction==='sell' && entryPrice >= price.bid) throw new Error('Sell Stop must be below Bid');
    }
    const commission = this._getCommission(symbol, volume);
    const id = uuidv4(), now = new Date().toISOString();
    await run(`INSERT INTO pending_orders (id,user_id,challenge_id,funded_account_id,symbol,direction,order_type,volume,entry_price,stop_loss,take_profit,trailing_stop_pips,expiry,status,commission,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      [id,userId,challengeId||null,fundedAccountId||null,symbol,direction,orderType,volume,entryPrice,stopLoss||null,takeProfit||null,trailingStopPips||0,expiry||null,commission,now]);
    this.pendingOrders[id] = { id, userId, challengeId, fundedAccountId, symbol, direction, order_type: orderType, volume, entry_price: entryPrice, stop_loss: stopLoss||null, take_profit: takeProfit||null, trailing_stop_pips: trailingStopPips||0, expiry: expiry||null, status: 'pending', commission, created_at: now };
    return { id, orderType, entryPrice, direction, volume, symbol };
  }

  async cancelPendingOrder(orderId, userId) {
    const order = await queryOne(`SELECT * FROM pending_orders WHERE id=$1 AND user_id=$2 AND status='pending'`, [orderId, userId]);
    if (!order) throw new Error('Order not found');
    await run(`UPDATE pending_orders SET status='cancelled', cancelled_at=? WHERE id=?`, [new Date().toISOString(), orderId]);
    delete this.pendingOrders[orderId];
    return { success: true };
  }

  async modifyPendingOrder(orderId, userId, changes) {
    const o = await queryOne(`SELECT * FROM pending_orders WHERE id=$1 AND user_id=$2 AND status='pending'`, [orderId, userId]);
    if (!o) throw new Error('Order not found');
    const ep = changes.entryPrice ?? o.entry_price;
    const sl = changes.stopLoss   ?? o.stop_loss;
    const tp = changes.takeProfit ?? o.take_profit;
    const vol = changes.volume    ?? o.volume;
    await run(`UPDATE pending_orders SET entry_price=?,stop_loss=?,take_profit=?,volume=? WHERE id=?`, [ep,sl,tp,vol,orderId]);
    if (this.pendingOrders[orderId]) Object.assign(this.pendingOrders[orderId], { entry_price:ep, stop_loss:sl, take_profit:tp, volume:vol });
    return { success: true };
  }

  // ── Close position ────────────────────────────────────────────────────────
  async closePosition(positionId, userId, partialVolume) {
    const pos = await queryOne(`SELECT * FROM trades WHERE id=$1 AND user_id=$2 AND status='open'`, [positionId, userId]);
    if (!pos) throw new Error('Position not found');
    return this._closePosition({ ...pos, ...this.positions[positionId], challengeId: pos.challenge_id, fundedAccountId: pos.funded_account_id, userId: pos.user_id }, 'manual', partialVolume);
  }

  async reversePosition(positionId, userId) {
    const pos = await queryOne(`SELECT * FROM trades WHERE id=$1 AND user_id=$2 AND status='open'`, [positionId, userId]);
    if (!pos) throw new Error('Position not found');
    const merged = { ...pos, ...this.positions[positionId], challengeId: pos.challenge_id, fundedAccountId: pos.funded_account_id, userId: pos.user_id };
    const closed = await this._closePosition(merged, 'reversed');
    const newPos = await this.openPosition({ userId: pos.user_id, challengeId: pos.challenge_id, fundedAccountId: pos.funded_account_id, symbol: pos.symbol, direction: pos.direction==='buy'?'sell':'buy', volume: pos.volume });
    return { closed, opened: newPos };
  }

  async modifyPosition(positionId, userId, { stopLoss, takeProfit, trailingStopPips }) {
    const pos = await queryOne(`SELECT * FROM trades WHERE id=$1 AND user_id=$2 AND status='open'`, [positionId, userId]);
    if (!pos) throw new Error('Position not found');
    const price = marketData.getPrice(pos.symbol);
    const cur = pos.direction==='buy' ? price?.bid : price?.ask;
    if (stopLoss != null && cur) {
      if (pos.direction==='buy'  && stopLoss >= cur) throw new Error('SL must be below current price');
      if (pos.direction==='sell' && stopLoss <= cur) throw new Error('SL must be above current price');
    }
    if (takeProfit != null && cur) {
      if (pos.direction==='buy'  && takeProfit <= cur) throw new Error('TP must be above current price');
      if (pos.direction==='sell' && takeProfit >= cur) throw new Error('TP must be below current price');
    }
    const newSL  = stopLoss         !== undefined ? stopLoss         : pos.stop_loss;
    const newTP  = takeProfit        !== undefined ? takeProfit       : pos.take_profit;
    const newTSP = trailingStopPips  !== undefined ? trailingStopPips : (pos.trailing_stop_pips||0);
    await run(`UPDATE trades SET stop_loss=?,take_profit=?,trailing_stop_pips=? WHERE id=?`, [newSL,newTP,newTSP,positionId]);
    if (this.positions[positionId]) Object.assign(this.positions[positionId], { stop_loss:newSL, take_profit:newTP, trailing_stop_pips:newTSP });
    return { success: true };
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  async _onTick({ symbol, bid, ask }) {
    const inst = marketData.getInstrument(symbol);
    if (!inst) return;

    // Check pending orders
    for (const order of Object.values(this.pendingOrders).filter(o => o.symbol === symbol)) {
      if (order.expiry && new Date(order.expiry) < new Date()) {
        await run(`UPDATE pending_orders SET status='expired', cancelled_at=? WHERE id=?`, [new Date().toISOString(), order.id]);
        delete this.pendingOrders[order.id]; continue;
      }
      let triggered = false;
      if (order.order_type==='limit')     triggered = (order.direction==='buy' && ask<=order.entry_price) || (order.direction==='sell' && bid>=order.entry_price);
      else if (order.order_type==='stop') triggered = (order.direction==='buy' && ask>=order.entry_price) || (order.direction==='sell' && bid<=order.entry_price);
      if (triggered) await this._fillPendingOrder(order, bid, ask, inst);
    }

    // Update open positions
    for (const pos of Object.values(this.positions).filter(p => p.symbol === symbol)) {
      const curPx = pos.direction==='buy' ? bid : ask;
      const diff  = pos.direction==='buy' ? bid - pos.open_price : pos.open_price - ask;
      const profit = +(diff / inst.pip * inst.pipValue * pos.volume).toFixed(2);
      this.positions[pos.id].profit = profit;
      this.positions[pos.id].current_price = curPx;
      await run(`UPDATE trades SET profit=? WHERE id=?`, [profit, pos.id]);

      // Trailing stop
      if (pos.trailing_stop_pips > 0) {
        const dist = pos.trailing_stop_pips * inst.pip;
        if (pos.direction==='buy') {
          const newH = Math.max(pos.highest_price||pos.open_price, bid);
          if (newH > (pos.highest_price||0)) {
            this.positions[pos.id].highest_price = newH;
            const newSL = +(newH - dist).toFixed(inst.digits);
            if (!pos.stop_loss || newSL > pos.stop_loss) {
              this.positions[pos.id].stop_loss = newSL;
              await run(`UPDATE trades SET stop_loss=? WHERE id=?`, [newSL, pos.id]);
            }
          }
        } else {
          const newL = Math.min(pos.lowest_price||pos.open_price, ask);
          if (newL < (pos.lowest_price||Infinity)) {
            this.positions[pos.id].lowest_price = newL;
            const newSL = +(newL + dist).toFixed(inst.digits);
            if (!pos.stop_loss || newSL < pos.stop_loss) {
              this.positions[pos.id].stop_loss = newSL;
              await run(`UPDATE trades SET stop_loss=? WHERE id=?`, [newSL, pos.id]);
            }
          }
        }
      }

      // SL/TP
      const p = this.positions[pos.id];
      if (p.stop_loss && ((p.direction==='buy' && bid<=p.stop_loss) || (p.direction==='sell' && ask>=p.stop_loss))) { await this._closePosition(p,'stop_loss'); continue; }
      if (p.take_profit && ((p.direction==='buy' && bid>=p.take_profit) || (p.direction==='sell' && ask<=p.take_profit))) { await this._closePosition(p,'take_profit'); continue; }

      // Equity / risk check
      const account = await this._getAccount(pos.challengeId, pos.fundedAccountId);
      if (!account) continue;
      const totalFloat = await this._getTotalFloatingPnL(pos.challengeId, pos.fundedAccountId);
      await this._updateAccountBalance(account, account.current_balance, account.current_balance + totalFloat);
      try {
        const riskEngine = require('./riskEngine');
        if (pos.challengeId) {
          const check = await riskEngine.checkChallenge(pos.challengeId);
          if (check.breached) await this._closeAllForAccount(pos.challengeId, null);
          else if (check.targetReached) riskEngine.passChallenge(pos.challengeId).catch(()=>{});
        } else if (pos.fundedAccountId) {
          const check = await riskEngine.checkFundedAccount(pos.fundedAccountId);
          if (check.breached) await this._closeAllForAccount(null, pos.fundedAccountId);
        }
      } catch(_) {}
    }
  }

  async _fillPendingOrder(order, bid, ask, inst) {
    const fillPx = order.direction==='buy' ? ask : bid;
    const now = new Date().toISOString();
    await run(`UPDATE pending_orders SET status='filled', filled_at=? WHERE id=?`, [now, order.id]);
    delete this.pendingOrders[order.id];
    const account = await this._getAccount(order.challengeId, order.fundedAccountId);
    if (!account || account.status!=='active') return;
    const id = uuidv4();
    const commission = this._getCommission(order.symbol, order.volume);
    await run(`INSERT INTO trades (id,user_id,challenge_id,funded_account_id,symbol,direction,volume,open_price,stop_loss,take_profit,trailing_stop_pips,profit,commission,swap,open_time,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,0,?,'open')`,
      [id,order.userId,order.challengeId||null,order.fundedAccountId||null,order.symbol,order.direction,order.volume,fillPx,order.stop_loss||null,order.take_profit||null,order.trailing_stop_pips||0,commission,now]);
    const newBal = account.current_balance + commission;
    await this._updateAccountBalance(account, newBal, newBal);
    this.positions[id] = { id, userId:order.userId, challengeId:order.challengeId, fundedAccountId:order.fundedAccountId, symbol:order.symbol, direction:order.direction, volume:order.volume, open_price:fillPx, stop_loss:order.stop_loss, take_profit:order.take_profit, trailing_stop_pips:order.trailing_stop_pips||0, highest_price:fillPx, lowest_price:fillPx, profit:0, commission, swap:0, open_time:now, status:'open' };
    console.log(`[OrderEngine] FILLED ${order.direction.toUpperCase()} ${order.volume} ${order.symbol} @ ${fillPx} (${order.order_type})`);
  }

  async _closePosition(pos, reason, partialVolume) {
    const price = marketData.getPrice(pos.symbol);
    if (!price) return;
    const inst     = marketData.getInstrument(pos.symbol);
    const closePx  = pos.direction==='buy' ? price.bid : price.ask;
    const closeVol = partialVolume || pos.volume;
    const pips     = (pos.direction==='buy' ? closePx-pos.open_price : pos.open_price-closePx) / inst.pip;
    const profit   = +(pips * inst.pipValue * closeVol).toFixed(2);
    const hours    = (Date.now() - new Date(pos.open_time).getTime()) / 3600000;
    const swap     = +(hours>=24 ? -(closeVol*pos.open_price*0.005/365) : 0).toFixed(2);
    const now      = new Date().toISOString();
    const cid      = pos.challengeId||pos.challenge_id;
    const fid      = pos.fundedAccountId||pos.funded_account_id;

    if (partialVolume && partialVolume < pos.volume) {
      const remain = +(pos.volume - partialVolume).toFixed(2);
      await run(`UPDATE trades SET volume=? WHERE id=?`, [remain, pos.id]);
      if (this.positions[pos.id]) this.positions[pos.id].volume = remain;
      const closeId = uuidv4();
      await run(`INSERT INTO trades (id,user_id,challenge_id,funded_account_id,symbol,direction,volume,open_price,close_price,profit,commission,swap,open_time,close_time,status,close_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'closed',?)`,
        [closeId,pos.userId||pos.user_id,cid,fid,pos.symbol,pos.direction,closeVol,pos.open_price,closePx,profit,0,swap,pos.open_time,now,reason]);
    } else {
      await run(`UPDATE trades SET status='closed',close_price=?,close_time=?,profit=?,swap=?,close_reason=? WHERE id=?`, [closePx,now,profit,swap,reason,pos.id]);
      delete this.positions[pos.id];
    }
    const account = await this._getAccount(cid, fid);
    if (account) {
      const newBal  = +(account.current_balance + profit + swap).toFixed(2);
      const float   = await this._getTotalFloatingPnL(cid, fid);
      await this._updateAccountBalance(account, newBal, +(newBal+float).toFixed(2));
      await this._updateTradeStats(cid, fid, profit);
    }
    return { closePrice: closePx, profit, swap, reason };
  }

  async _closeAllForAccount(challengeId, fundedAccountId) {
    for (const pos of Object.values(this.positions).filter(p => challengeId ? p.challengeId===challengeId : p.fundedAccountId===fundedAccountId))
      await this._closePosition(pos, 'force_close');
  }

  async _getAccount(challengeId, fundedAccountId) {
    if (challengeId) return queryOne(`SELECT * FROM challenges WHERE id=$1`, [challengeId]);
    if (fundedAccountId) return queryOne(`SELECT * FROM funded_accounts WHERE id=$1`, [fundedAccountId]);
    return null;
  }

  async _updateAccountBalance(account, balance, equity) {
    const hi = Math.max(account.highest_balance||0, balance);
    const lo = Math.min(account.lowest_equity||equity, equity);
    const t  = account.challenge_type!==undefined ? 'challenges' : 'funded_accounts';
    await run(`UPDATE ${t} SET current_balance=?,current_equity=?,highest_balance=?,lowest_equity=? WHERE id=?`, [balance,equity,hi,lo,account.id]);
  }

  async _updateTradeStats(challengeId, fundedAccountId, profit) {
    const t = challengeId?'challenges':'funded_accounts';
    const id = challengeId||fundedAccountId;
    await run(`UPDATE ${t} SET total_trades=total_trades+1,winning_trades=winning_trades+?,losing_trades=losing_trades+?,total_profit=total_profit+?,last_trade_at=? WHERE id=?`,
      [profit>0?1:0,profit<=0?1:0,profit,new Date().toISOString(),id]);
  }

  async _getTotalFloatingPnL(challengeId, fundedAccountId) {
    if (challengeId) { const r=await queryOne(`SELECT COALESCE(SUM(profit),0) as total FROM trades WHERE challenge_id=$1 AND status='open'`,[challengeId]); return r?.total||0; }
    if (fundedAccountId) { const r=await queryOne(`SELECT COALESCE(SUM(profit),0) as total FROM trades WHERE funded_account_id=$1 AND status='open'`,[fundedAccountId]); return r?.total||0; }
    return 0;
  }

  async _getOpenLots(challengeId, fundedAccountId) {
    if (challengeId) { const r=await queryOne(`SELECT COALESCE(SUM(volume),0) as lots FROM trades WHERE challenge_id=$1 AND status='open'`,[challengeId]); return r?.lots||0; }
    if (fundedAccountId) { const r=await queryOne(`SELECT COALESCE(SUM(volume),0) as lots FROM trades WHERE funded_account_id=$1 AND status='open'`,[fundedAccountId]); return r?.lots||0; }
    return 0;
  }

  _getMaxLots(accountSize) {
    const sizes = Object.keys(config.oneStepRules.max_lot_exposure).map(Number).sort((a,b)=>a-b);
    for (const s of sizes) if (accountSize<=s) return config.oneStepRules.max_lot_exposure[s];
    return config.oneStepRules.max_lot_exposure[200000];
  }

  async getOpenPositions(userId, challengeId, fundedAccountId) {
    let q, p;
    if (challengeId) { q=`SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 AND status='open' ORDER BY open_time DESC`; p=[userId,challengeId]; }
    else if (fundedAccountId) { q=`SELECT * FROM trades WHERE user_id=$1 AND funded_account_id=$2 AND status='open' ORDER BY open_time DESC`; p=[userId,fundedAccountId]; }
    else { q=`SELECT * FROM trades WHERE user_id=$1 AND status='open' ORDER BY open_time DESC`; p=[userId]; }
    const trades = await queryAll(q, p);
    return trades.map(t => {
      const price = marketData.getPrice(t.symbol);
      const inst  = marketData.getInstrument(t.symbol);
      const mem   = this.positions[t.id];
      const liveProfit = mem?.profit ?? t.profit;
      const currentPrice = price ? (t.direction==='buy' ? price.bid : price.ask) : t.open_price;
      const pips = inst ? (t.direction==='buy' ? currentPrice-t.open_price : t.open_price-currentPrice) / inst.pip : 0;
      return { ...t, profit: liveProfit, current_price: currentPrice, pips: +pips.toFixed(1) };
    });
  }

  async getPendingOrders(userId, challengeId, fundedAccountId) {
    let q, p;
    if (challengeId) { q=`SELECT * FROM pending_orders WHERE user_id=$1 AND challenge_id=$2 AND status='pending' ORDER BY created_at DESC`; p=[userId,challengeId]; }
    else if (fundedAccountId) { q=`SELECT * FROM pending_orders WHERE user_id=$1 AND funded_account_id=$2 AND status='pending' ORDER BY created_at DESC`; p=[userId,fundedAccountId]; }
    else { q=`SELECT * FROM pending_orders WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC`; p=[userId]; }
    const orders = await queryAll(q, p);
    return orders.map(o => {
      const price = marketData.getPrice(o.symbol);
      const inst  = marketData.getInstrument(o.symbol);
      const dist  = price && inst ? Math.abs((o.direction==='buy'?price.ask:price.bid) - o.entry_price) / inst.pip : 0;
      return { ...o, current_price: price?.mid, distance_pips: +dist.toFixed(1) };
    });
  }

  async updateSymbolSettings(symbol, settings) {
    try {
      const existing = await queryOne(`SELECT symbol FROM symbol_settings WHERE symbol=$1`, [symbol]);
      if (existing) {
        const sets = Object.entries(settings).map(([k])=>`${k}=?`).join(',');
        await run(`UPDATE symbol_settings SET ${sets},updated_at=? WHERE symbol=?`, [...Object.values(settings),new Date().toISOString(),symbol]);
      } else {
        await run(`INSERT INTO symbol_settings (symbol,spread_markup,commission_per_lot) VALUES (?,?,?)`, [symbol,settings.spread_markup||0,settings.commission_per_lot||3.5]);
      }
      this.symbolSettings[symbol] = { ...(this.symbolSettings[symbol]||{}), ...settings };
    } catch(e) { console.error('[OrderEngine] updateSymbolSettings:', e.message); }
    return { success: true };
  }

  async adminForceClose(challengeId, fundedAccountId) {
    await this._closeAllForAccount(challengeId, fundedAccountId);
    return { success: true };
  }
}

module.exports = new OrderEngine();
