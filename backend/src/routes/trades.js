const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll } = require('../models/database');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/trades
router.get('/', authenticate, (req, res) => {
  const { challenge_id, funded_account_id, symbol, limit } = req.query;
  let sql = `SELECT * FROM trades WHERE user_id='${req.user.id}'`;
  if (challenge_id) sql += ` AND challenge_id='${sanitize(challenge_id)}'`;
  if (funded_account_id) sql += ` AND funded_account_id='${sanitize(funded_account_id)}'`;
  if (symbol) sql += ` AND symbol='${sanitize(symbol)}'`;
  sql += ` ORDER BY close_time DESC LIMIT ${Math.min(parseInt(limit) || 100, 500)}`;
  res.json(queryAll(sql));
});

// GET /api/trades/stats — aggregate trading stats
router.get('/stats', authenticate, (req, res) => {
  const trades = queryAll(`SELECT * FROM trades WHERE user_id='${req.user.id}' AND status='closed'`);
  if (!trades.length) return res.json({ total: 0 });

  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit < 0);
  const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
  const grossWins = wins.reduce((s, t) => s + t.profit, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.profit, 0));

  // Symbol breakdown
  const symbols = {};
  trades.forEach(t => {
    if (!symbols[t.symbol]) symbols[t.symbol] = { trades: 0, profit: 0 };
    symbols[t.symbol].trades++;
    symbols[t.symbol].profit += t.profit;
  });

  res.json({
    total_trades: trades.length,
    winning_trades: wins.length,
    losing_trades: losses.length,
    win_rate: Math.round(wins.length / trades.length * 100),
    total_profit: +totalProfit.toFixed(2),
    avg_win: wins.length ? +(grossWins / wins.length).toFixed(2) : 0,
    avg_loss: losses.length ? +(grossLosses / losses.length).toFixed(2) : 0,
    profit_factor: grossLosses > 0 ? +(grossWins / grossLosses).toFixed(2) : 0,
    best_trade: Math.max(...trades.map(t => t.profit)),
    worst_trade: Math.min(...trades.map(t => t.profit)),
    symbols,
  });
});

module.exports = router;
