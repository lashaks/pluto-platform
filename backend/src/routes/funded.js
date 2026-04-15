const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne } = require('../models/database');
const riskEngine = require('../services/riskEngine');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/funded — list user's funded accounts
router.get('/', authenticate, async (req, res) => {
  const accounts = await queryAll(`SELECT * FROM funded_accounts WHERE user_id='${req.user.id}' ORDER BY created_at DESC`);
  res.json(accounts);
});

// GET /api/funded/:id
router.get('/:id', authenticate, async (req, res) => {
  const acct = await queryOne(`SELECT * FROM funded_accounts WHERE id='${sanitize(req.params.id)}' AND user_id='${req.user.id}'`);
  if (!acct) return res.status(404).json({ error: 'Funded account not found' });
  res.json(acct);
});

module.exports = router;
