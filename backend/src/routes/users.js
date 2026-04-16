const express = require('express');
const { authenticate } = require('../middleware/auth');
const { queryOne, run } = require('../models/database');
const { sanitize } = require('../utils/helpers');

const router = express.Router();

// GET /api/users/profile
router.get('/profile', authenticate, async (req, res) => {
  const user = await queryOne(`SELECT id, email, first_name, last_name, phone, country, kyc_status,
    role, affiliate_code, balance_wallet, created_at, last_login
    FROM users WHERE id=$1`, [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/users/profile
router.put('/profile', authenticate, async (req, res) => {
  const { first_name, last_name, phone, country } = req.body;
  run(`UPDATE users SET first_name=?, last_name=?, phone=?, country=?, updated_at=NOW()::TEXT WHERE id=?`,
    [first_name || '', last_name || '', phone || '', country || '', req.user.id]);
  res.json({ success: true, message: 'Profile updated' });
});

// POST /api/users/kyc/start — initiate KYC verification
router.post('/kyc/start', authenticate, async (req, res) => {
  const user = await queryOne(`SELECT kyc_status FROM users WHERE id=$1`, [req.user.id]);
  if (user?.kyc_status === 'approved') return res.json({ status: 'already_approved' });

  
  run(`UPDATE users SET kyc_status='pending' WHERE id=?`, [req.user.id]);
  res.json({
    status: 'pending',
    message: 'KYC verification initiated',
    
    sumsub_token: 'acf_token_' + Date.now(),
  });
});

module.exports = router;
