const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryAll, queryOne } = require('../models/database');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/funded
router.get('/', authenticate, async (req, res) => {
  const accounts = await queryAll(`SELECT * FROM funded_accounts WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json(accounts);
});

// GET /api/funded/:id
router.get('/:id', authenticate, async (req, res) => {
  const acct = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  res.json(acct);
});

module.exports = router;
