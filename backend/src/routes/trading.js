const express     = require('express');
const router      = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { queryOne, queryAll, run } = require('../models/database');
const marketData  = require('../services/marketData');
const orderEngine = require('../services/orderEngine');

router.get('/instruments', (req, res) => {
  const inst = marketData.getInstruments();
  const prices = marketData.getAllPrices();
  res.json(Object.entries(inst).map(([sym, def]) => ({ symbol: sym, ...def, ...prices[sym] })));
});

router.get('/prices', (req, res) => res.json(marketData.getAllPrices()));

router.get('/price/:symbol', (req, res) => {
  const p = marketData.getPrice(req.params.symbol.toUpperCase());
  if (!p) return res.status(404).json({ error: 'Symbol not found' });
  res.json(p);
});

router.get('/candles/:symbol', async (req, res) => {
  const { timeframe='5min', count=300 } = req.query;
  try { res.json(await marketData.getCandles(req.params.symbol.toUpperCase(), timeframe, parseInt(count))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/account', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.query;
  try {
    let account;
    if (challenge_id) account = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [challenge_id, req.user.id]);
    else if (funded_id) account = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1 AND user_id=$2`, [funded_id, req.user.id]);
    else {
      account = await queryOne(`SELECT * FROM challenges WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
      if (!account) account = await queryOne(`SELECT * FROM funded_accounts WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
    }
    if (!account) return res.status(404).json({ error: 'No active trading account found' });
    const openTrades = await queryAll(`SELECT profit FROM trades WHERE ${account.challenge_type!==undefined?'challenge_id':'funded_account_id'}=$1 AND status='open'`, [account.id]);
    const floatingPnL = openTrades.reduce((s,t)=>s+(t.profit||0),0);
    const bal = account.current_balance||account.starting_balance||0;
    res.json({ ...account, equity: +(bal+floatingPnL).toFixed(2), floating_pnl: +floatingPnL.toFixed(2) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/accounts', authenticate, async (req, res) => {
  try {
    const challenges = await queryAll(
      `SELECT *,'challenge' as account_kind FROM challenges WHERE user_id=$1 AND status='active' ORDER BY created_at DESC`,
      [req.user.id]
    );
    const funded = await queryAll(
      `SELECT *,'funded' as account_kind FROM funded_accounts WHERE user_id=$1 AND status='active' ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json([...funded, ...challenges]); // funded first (more important)
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/open', authenticate, async (req, res) => {
  const { symbol, direction, volume, stop_loss, take_profit, trailing_stop_pips, challenge_id, funded_id, comment } = req.body;
  if (!symbol||!direction||!volume) return res.status(400).json({ error: 'symbol, direction, volume required' });
  if (!['buy','sell'].includes(direction)) return res.status(400).json({ error: 'direction must be buy or sell' });
  try {
    res.json(await orderEngine.openPosition({
      userId: req.user.id, challengeId: challenge_id||null, fundedAccountId: funded_id||null,
      symbol: symbol.toUpperCase(), direction, volume: parseFloat(volume),
      stopLoss: stop_loss?parseFloat(stop_loss):null,
      takeProfit: take_profit?parseFloat(take_profit):null,
      trailingStopPips: trailing_stop_pips?parseFloat(trailing_stop_pips):0,
      comment,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/pending', authenticate, async (req, res) => {
  const { symbol, direction, order_type, volume, entry_price, stop_loss, take_profit, trailing_stop_pips, expiry, challenge_id, funded_id, comment } = req.body;
  if (!symbol||!direction||!order_type||!volume||!entry_price) return res.status(400).json({ error: 'symbol, direction, order_type, volume, entry_price required' });
  if (!['limit','stop','stoplimit'].includes(order_type)) return res.status(400).json({ error: 'order_type: limit, stop, stoplimit' });
  try {
    res.json(await orderEngine.placePendingOrder({
      userId: req.user.id, challengeId: challenge_id||null, fundedAccountId: funded_id||null,
      symbol: symbol.toUpperCase(), direction, orderType: order_type,
      volume: parseFloat(volume), entryPrice: parseFloat(entry_price),
      stopLoss: stop_loss?parseFloat(stop_loss):null,
      takeProfit: take_profit?parseFloat(take_profit):null,
      trailingStopPips: trailing_stop_pips?parseFloat(trailing_stop_pips):0,
      expiry: expiry||null, comment,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.delete('/pending/:id', authenticate, async (req, res) => {
  try { res.json(await orderEngine.cancelPendingOrder(req.params.id, req.user.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/pending/:id', authenticate, async (req, res) => {
  try {
    res.json(await orderEngine.modifyPendingOrder(req.params.id, req.user.id, {
      entryPrice: req.body.entry_price?parseFloat(req.body.entry_price):undefined,
      stopLoss:   req.body.stop_loss  ?parseFloat(req.body.stop_loss)  :undefined,
      takeProfit: req.body.take_profit?parseFloat(req.body.take_profit):undefined,
      volume:     req.body.volume     ?parseFloat(req.body.volume)     :undefined,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.get('/pending', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.query;
  try { res.json(await orderEngine.getPendingOrders(req.user.id, challenge_id, funded_id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/positions', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.query;
  try { res.json(await orderEngine.getOpenPositions(req.user.id, challenge_id, funded_id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/close/:id', authenticate, async (req, res) => {
  const partialVol = req.body.partial_volume ? parseFloat(req.body.partial_volume) : null;
  try { res.json(await orderEngine.closePosition(req.params.id, req.user.id, partialVol)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/reverse/:id', authenticate, async (req, res) => {
  try { res.json(await orderEngine.reversePosition(req.params.id, req.user.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/modify/:id', authenticate, async (req, res) => {
  try {
    res.json(await orderEngine.modifyPosition(req.params.id, req.user.id, {
      stopLoss:         req.body.stop_loss         !==undefined ? (req.body.stop_loss        ?parseFloat(req.body.stop_loss)        :null) : undefined,
      takeProfit:       req.body.take_profit       !==undefined ? (req.body.take_profit      ?parseFloat(req.body.take_profit)      :null) : undefined,
      trailingStopPips: req.body.trailing_stop_pips!==undefined ? parseFloat(req.body.trailing_stop_pips||0) : undefined,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/close-all', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.body;
  try {
    const positions = await orderEngine.getOpenPositions(req.user.id, challenge_id, funded_id);
    const results = [];
    for (const pos of positions) {
      try { results.push({ id: pos.id, ...await orderEngine.closePosition(pos.id, req.user.id) }); }
      catch(e) { results.push({ id: pos.id, error: e.message }); }
    }
    res.json({ closed: results.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', authenticate, async (req, res) => {
  const { challenge_id, funded_id, limit=50 } = req.query;
  try {
    let q, p;
    if (challenge_id) { q=`SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`; p=[req.user.id,challenge_id,limit]; }
    else if (funded_id) { q=`SELECT * FROM trades WHERE user_id=$1 AND funded_account_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`; p=[req.user.id,funded_id,limit]; }
    else { q=`SELECT * FROM trades WHERE user_id=$1 AND status='closed' ORDER BY close_time DESC LIMIT $2`; p=[req.user.id,limit]; }
    res.json(await queryAll(q, p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/symbol-settings', (req, res) => res.json(orderEngine.symbolSettings||{}));

router.post('/symbol-settings/:symbol', requireAdmin, async (req, res) => {
  try { res.json(await orderEngine.updateSymbolSettings(req.params.symbol.toUpperCase(), req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ── ALIASES — terminal uses these names ──────────────────────────────────────

// POST /api/trading/order  →  alias for /open
router.post('/order', authenticate, async (req, res) => {
  const { symbol, direction, volume, stop_loss, take_profit, trailing_stop_pips,
          challenge_id, funded_account_id, funded_id, comment } = req.body;
  if (!symbol||!direction||!volume) return res.status(400).json({ error: 'symbol, direction, volume required' });
  try {
    res.json(await orderEngine.openPosition({
      userId: req.user.id,
      challengeId: challenge_id||null,
      fundedAccountId: funded_account_id||funded_id||null,
      symbol: symbol.toUpperCase(), direction, volume: parseFloat(volume),
      stopLoss:         stop_loss          ? parseFloat(stop_loss)          : null,
      takeProfit:       take_profit        ? parseFloat(take_profit)        : null,
      trailingStopPips: trailing_stop_pips ? parseFloat(trailing_stop_pips) : 0,
      comment,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// POST /api/trading/pending-order  →  alias for /pending
router.post('/pending-order', authenticate, async (req, res) => {
  const { symbol, direction, order_type, volume, entry_price, stop_loss, take_profit,
          trailing_stop_pips, expiry, challenge_id, funded_account_id, funded_id, comment } = req.body;
  if (!symbol||!direction||!order_type||!volume||!entry_price)
    return res.status(400).json({ error: 'symbol, direction, order_type, volume, entry_price required' });
  try {
    res.json(await orderEngine.placePendingOrder({
      userId: req.user.id, challengeId: challenge_id||null,
      fundedAccountId: funded_account_id||funded_id||null,
      symbol: symbol.toUpperCase(), direction, orderType: order_type,
      volume: parseFloat(volume), entryPrice: parseFloat(entry_price),
      stopLoss:         stop_loss          ? parseFloat(stop_loss)          : null,
      takeProfit:       take_profit        ? parseFloat(take_profit)        : null,
      trailingStopPips: trailing_stop_pips ? parseFloat(trailing_stop_pips) : 0,
      expiry: expiry||null, comment,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/trading/pending-order/:id  →  alias for DELETE /pending/:id
router.delete('/pending-order/:id', authenticate, async (req, res) => {
  try { res.json(await orderEngine.cancelPendingOrder(req.params.id, req.user.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// POST /api/trading/close  body:{position_id}  →  alias for /close/:id
router.post('/close', authenticate, async (req, res) => {
  const id = req.body.position_id || req.body.id;
  if (!id) return res.status(400).json({ error: 'position_id required' });
  const partialVol = req.body.partial_volume ? parseFloat(req.body.partial_volume) : null;
  try { res.json(await orderEngine.closePosition(id, req.user.id, partialVol)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// POST /api/trading/partial-close  body:{position_id, volume}
router.post('/partial-close', authenticate, async (req, res) => {
  const { position_id, volume } = req.body;
  if (!position_id || !volume) return res.status(400).json({ error: 'position_id and volume required' });
  try { res.json(await orderEngine.closePosition(position_id, req.user.id, parseFloat(volume))); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/trading/modify  body:{position_id, stop_loss, take_profit, trailing_stop_pips}
router.put('/modify', authenticate, async (req, res) => {
  const id = req.body.position_id || req.body.id;
  if (!id) return res.status(400).json({ error: 'position_id required' });
  try {
    res.json(await orderEngine.modifyPosition(id, req.user.id, {
      stopLoss:         req.body.stop_loss         !==undefined ? (req.body.stop_loss         ? parseFloat(req.body.stop_loss)         : null) : undefined,
      takeProfit:       req.body.take_profit       !==undefined ? (req.body.take_profit       ? parseFloat(req.body.take_profit)       : null) : undefined,
      trailingStopPips: req.body.trailing_stop_pips!==undefined ? parseFloat(req.body.trailing_stop_pips||0) : undefined,
    }));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// POST /api/trading/reverse  body:{position_id}  →  alias for /reverse/:id
router.post('/reverse', authenticate, async (req, res) => {
  const id = req.body.position_id || req.body.id;
  if (!id) return res.status(400).json({ error: 'position_id required' });
  try { res.json(await orderEngine.reversePosition(id, req.user.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// GET /api/trading/candles?symbol=X&timeframe=Y  →  accepts both param and query
router.get('/candles', async (req, res) => {
  const { symbol, timeframe='5min', count=300 } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try { res.json(await marketData.getCandles(symbol.toUpperCase(), timeframe, parseInt(count))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

