const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne } = require('../models/database');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/trades
router.get('/', authenticate, async (req, res) => {
  const { challenge_id } = req.query;
  if (challenge_id) {
    const trades = await queryAll(`SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 ORDER BY close_time DESC`, [req.user.id, challenge_id]);
    return res.json(trades);
  }
  const trades = await queryAll(`SELECT * FROM trades WHERE user_id=$1 ORDER BY close_time DESC LIMIT 200`, [req.user.id]);
  res.json(trades);
});

// GET /api/trades/stats
router.get('/stats', authenticate, async (req, res) => {
  const trades = await queryAll(`SELECT * FROM trades WHERE user_id=$1 AND status='closed'`, [req.user.id]);
  const total = trades.length;
  const wins = trades.filter(t => t.profit > 0).length;
  const losses = trades.filter(t => t.profit <= 0).length;
  const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
  const avgWin = wins ? trades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0) / wins : 0;
  const avgLoss = losses ? trades.filter(t => t.profit <= 0).reduce((s, t) => s + t.profit, 0) / losses : 0;
  res.json({ total, wins, losses, win_rate: total ? Math.round(wins / total * 100) : 0, total_profit: +totalProfit.toFixed(2), avg_win: +avgWin.toFixed(2), avg_loss: +avgLoss.toFixed(2) });
});

module.exports = router;
