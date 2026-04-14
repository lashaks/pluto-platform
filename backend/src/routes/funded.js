const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne } = require('../models/database');
const riskEngine = require('../services/riskEngine');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/funded — list user's funded accounts
router.get('/', authenticate, (req, res) => {
  const accounts = queryAll(`SELECT * FROM funded_accounts WHERE user_id='${req.user.id}' ORDER BY created_at DESC`);
  res.json(accounts);
});

// GET /api/funded/:id
router.get('/:id', authenticate, (req, res) => {
  const acct = queryOne(`SELECT * FROM funded_accounts WHERE id='${sanitize(req.params.id)}' AND user_id='${req.user.id}'`);
  if (!acct) return res.status(404).json({ error: 'Funded account not found' });
  res.json(acct);
});

// GET /api/funded/:id/scaling — check scaling eligibility
router.get('/:id/scaling', authenticate, async (req, res) => {
  const result = await riskEngine.checkScaling(req.params.id);
  if (!result) return res.status(404).json({ error: 'Account not found' });
  res.json(result);
});

module.exports = router;
