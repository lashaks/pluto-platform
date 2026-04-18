const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll } = require('../models/database');

const router = express.Router();

// GET /api/trades — supports challenge_id and funded_id query params
router.get('/', authenticate, async (req, res) => {
  const { challenge_id, funded_id, funded_account_id, limit = 200 } = req.query;
  try {
    let q, p;
    const fId = funded_id || funded_account_id;
    if (challenge_id) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND challenge_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`;
      p = [req.user.id, challenge_id, parseInt(limit)];
    } else if (fId) {
      q = `SELECT * FROM trades WHERE user_id=$1 AND funded_account_id=$2 AND status='closed' ORDER BY close_time DESC LIMIT $3`;
      p = [req.user.id, fId, parseInt(limit)];
    } else {
      q = `SELECT * FROM trades WHERE user_id=$1 AND status='closed' ORDER BY close_time DESC LIMIT $2`;
      p = [req.user.id, parseInt(limit)];
    }
    res.json(await queryAll(q, p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/trades/stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const trades = await queryAll(`SELECT * FROM trades WHERE user_id=$1 AND status='closed'`, [req.user.id]);
    const wins = trades.filter(t => t.profit > 0).length;
    const losses = trades.filter(t => t.profit <= 0).length;
    const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
    const avgWin = wins ? trades.filter(t=>t.profit>0).reduce((s,t)=>s+t.profit,0)/wins : 0;
    const avgLoss = losses ? Math.abs(trades.filter(t=>t.profit<=0).reduce((s,t)=>s+t.profit,0)/losses) : 0;
    res.json({ total: trades.length, wins, losses, win_rate: trades.length?Math.round(wins/trades.length*100):0, total_profit:+totalProfit.toFixed(2), avg_win:+avgWin.toFixed(2), avg_loss:+avgLoss.toFixed(2) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
