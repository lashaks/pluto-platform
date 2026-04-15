const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { queryOne, queryAll, run } = require('../models/database');
const { generateId, generateAffiliateCode, sanitize } = require('../utils/helpers');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await queryOne(`SELECT id FROM users WHERE email='${sanitize(email)}'`);
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const id = generateId();
    const hash = bcrypt.hashSync(password, 10);
    const affiliateCode = generateAffiliateCode(id);

    await run(`INSERT INTO users (id, email, password_hash, first_name, last_name, affiliate_code)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, hash, first_name || '', last_name || '', affiliateCode]);

    const token = jwt.sign({ id, email, role: 'trader' }, config.jwtSecret, { expiresIn: config.jwtExpiry });

    await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES (?, ?, 'USER_REGISTERED', ?)`,
      [generateId(), id, `New user: ${email}`]);

    res.status(201).json({
      token,
      user: { id, email, first_name: first_name || '', last_name: last_name || '', role: 'trader', affiliate_code: affiliateCode },
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await queryOne(`SELECT * FROM users WHERE email='${sanitize(email)}'`);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.is_active === 0 || user.is_active === '0' || user.is_active === false) return res.status(401).json({ error: 'Account is suspended' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry }
    );

    await run(`UPDATE users SET last_login=NOW()::TEXT WHERE id=?`, [user.id]);

    delete user.password_hash;
    res.json({ token, user });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
