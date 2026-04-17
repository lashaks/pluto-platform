/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Trading Routes
   All endpoints for the trading terminal
───────────────────────────────────────────────────────────────────────────── */

const express    = require('express');
const router     = express.Router();
const { authenticate } = require('../middleware/auth');
const { queryOne, queryAll, run } = require('../models/database');
const marketData = require('../services/marketData');
const orderEngine = require('../services/orderEngine');

// ── GET /api/trading/instruments ─────────────────────────────────────────────
router.get('/instruments', (req, res) => {
  const inst = marketData.getInstruments();
  const prices = marketData.getAllPrices();
  const result = Object.entries(inst).map(([sym, def]) => ({
    symbol: sym,
    ...def,
    ...prices[sym],
  }));
  res.json(result);
});

// ── GET /api/trading/prices ───────────────────────────────────────────────────
router.get('/prices', (req, res) => {
  res.json(marketData.getAllPrices());
});

// ── GET /api/trading/price/:symbol ───────────────────────────────────────────
router.get('/price/:symbol', (req, res) => {
  const p = marketData.getPrice(req.params.symbol.toUpperCase());
  if (!p) return res.status(404).json({ error: 'Symbol not found' });
  res.json(p);
});

// ── GET /api/trading/candles/:symbol ─────────────────────────────────────────
router.get('/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { timeframe = '1min', count = 200 } = req.query;
  try {
    const candles = await marketData.getCandles(symbol.toUpperCase(), timeframe, parseInt(count));
    res.json(candles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/trading/account ─────────────────────────────────────────────────
// Returns the active trading account for the current context
router.get('/account', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.query;
  try {
    let account;
    if (challenge_id) {
      account = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND user_id=$2`, [challenge_id, req.user.id]);
    } else if (funded_id) {
      account = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1 AND user_id=$2`, [funded_id, req.user.id]);
    } else {
      // Return first active challenge or funded account
      account = await queryOne(`SELECT * FROM challenges WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
      if (!account) account = await queryOne(`SELECT * FROM funded_accounts WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
    }
    if (!account) return res.status(404).json({ error: 'No active trading account found' });

    // Add floating P&L
    const openTrades = await queryAll(
      challenge_id ? `SELECT profit FROM trades WHERE challenge_id=$1 AND status='open'`
                   : `SELECT profit FROM trades WHERE funded_account_id=$1 AND status='open'`,
      [account.id]
    );
    const floatingPnL = openTrades.reduce((s, t) => s + (t.profit || 0), 0);
    const equity = (account.current_balance || account.starting_balance) + floatingPnL;

    res.json({ ...account, equity, floating_pnl: +floatingPnL.toFixed(2) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/trading/open ────────────────────────────────────────────────────
router.post('/open', authenticate, async (req, res) => {
  const { symbol, direction, volume, stop_loss, take_profit, challenge_id, funded_id, comment } = req.body;

  if (!symbol || !direction || !volume) {
    return res.status(400).json({ error: 'symbol, direction, volume required' });
  }
  if (!['buy','sell'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be buy or sell' });
  }
  if (volume <= 0 || volume > 100) {
    return res.status(400).json({ error: 'volume must be between 0.01 and 100' });
  }

  try {
    const result = await orderEngine.openPosition({
      userId:          req.user.id,
      challengeId:     challenge_id || null,
      fundedAccountId: funded_id    || null,
      symbol: symbol.toUpperCase(),
      direction,
      volume: parseFloat(volume),
      stopLoss:    stop_loss   ? parseFloat(stop_loss)   : null,
      takeProfit:  take_profit ? parseFloat(take_profit) : null,
      comment,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/trading/close/:id ───────────────────────────────────────────────
router.post('/close/:id', authenticate, async (req, res) => {
  try {
    const result = await orderEngine.closePosition(req.params.id, req.user.id);
    if (!result) return res.status(400).json({ error: 'Could not close position' });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/trading/modify/:id ──────────────────────────────────────────────
router.post('/modify/:id', authenticate, async (req, res) => {
  try {
    const result = await orderEngine.modifyPosition(
      req.params.id, req.user.id,
      { stopLoss: req.body.stop_loss, takeProfit: req.body.take_profit }
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/trading/close-all ───────────────────────────────────────────────
router.post('/close-all', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.body;
  try {
    const positions = await orderEngine.getOpenPositions(req.user.id, challenge_id, funded_id);
    const results = [];
    for (const pos of positions) {
      try {
        const r = await orderEngine.closePosition(pos.id, req.user.id);
        results.push({ id: pos.id, ...r });
      } catch(e) {
        results.push({ id: pos.id, error: e.message });
      }
    }
    res.json({ closed: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/trading/positions ────────────────────────────────────────────────
router.get('/positions', authenticate, async (req, res) => {
  const { challenge_id, funded_id } = req.query;
  try {
    const positions = await orderEngine.getOpenPositions(req.user.id, challenge_id, funded_id);
    res.json(positions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/trading/history ──────────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  const { challenge_id, funded_id, limit = 50 } = req.query;
  try {
    let q, params;
    if (challenge_id) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`;
      params = [req.user.id, challenge_id, limit];
    } else if (funded_id) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND funded_account_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`;
      params = [req.user.id, funded_id, limit];
    } else {
      q = `SELECT * FROM trades WHERE user_id=$1 AND status='closed' ORDER BY close_time DESC LIMIT $2`;
      params = [req.user.id, limit];
    }
    const history = await queryAll(q, params);
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
