const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { queryOne, queryAll, run } = require('../models/database');
const { generateId, generateAffiliateCode, sanitize } = require('../utils/helpers');
const email = require('../services/email');

const router = express.Router();

// In-memory verification codes (move to Redis/DB in production at scale)
const verificationCodes = {};
const resetCodes = {};

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email: userEmail, password, first_name, last_name } = req.body;
    if (!userEmail || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await queryOne(`SELECT id FROM users WHERE email='${sanitize(userEmail)}'`);
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const id = generateId();
    const hash = bcrypt.hashSync(password, 10);
    const affiliateCode = generateAffiliateCode(id);

    await run(`INSERT INTO users (id, email, password_hash, first_name, last_name, affiliate_code, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, userEmail, hash, first_name || '', last_name || '', affiliateCode]);

    const token = jwt.sign({ id, email: userEmail, role: 'trader' }, config.jwtSecret, { expiresIn: config.jwtExpiry });

    await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES (?, ?, 'USER_REGISTERED', ?)`,
      [generateId(), id, `New user: ${userEmail}`]);

    // Send verification code
    const code = generateCode();
    verificationCodes[userEmail] = { code, expires: Date.now() + 15 * 60 * 1000, userId: id };
    email.sendVerification(userEmail, first_name || 'Trader', code).catch(e => console.error('[Auth] Verification email error:', e.message));

    res.status(201).json({
      token,
      user: { id, email: userEmail, first_name: first_name || '', last_name: last_name || '', role: 'trader', affiliate_code: affiliateCode, email_verified: false },
      message: 'Account created. Check your email for a verification code.',
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const { email: userEmail, code } = req.body;
    if (!userEmail || !code) return res.status(400).json({ error: 'Email and code are required' });

    const stored = verificationCodes[userEmail];
    if (!stored) return res.status(400).json({ error: 'No verification pending for this email. Request a new code.' });
    if (Date.now() > stored.expires) {
      delete verificationCodes[userEmail];
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if (stored.code !== code) return res.status(400).json({ error: 'Invalid code' });

    // Mark email as verified
    await run(`UPDATE users SET kyc_status='none', updated_at=NOW()::TEXT WHERE id=?`, [stored.userId]);
    delete verificationCodes[userEmail];

    // Send welcome email
    const user = await queryOne(`SELECT first_name FROM users WHERE id='${stored.userId}'`);
    email.sendWelcome(userEmail, user?.first_name || 'Trader').catch(e => console.error('[Auth] Welcome email error:', e.message));

    res.json({ success: true, message: 'Email verified! Welcome to Pluto Capital.' });
  } catch (e) {
    console.error('Verify error:', e);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/resend-code
router.post('/resend-code', async (req, res) => {
  try {
    const { email: userEmail } = req.body;
    if (!userEmail) return res.status(400).json({ error: 'Email is required' });

    const user = await queryOne(`SELECT id, first_name FROM users WHERE email='${sanitize(userEmail)}'`);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const code = generateCode();
    verificationCodes[userEmail] = { code, expires: Date.now() + 15 * 60 * 1000, userId: user.id };
    email.sendVerification(userEmail, user.first_name || 'Trader', code).catch(e => console.error('[Auth] Resend code error:', e.message));

    res.json({ success: true, message: 'New verification code sent.' });
  } catch (e) {
    console.error('Resend code error:', e);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email: userEmail, password } = req.body;
    if (!userEmail || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await queryOne(`SELECT * FROM users WHERE email='${sanitize(userEmail)}'`);
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email: userEmail } = req.body;
    if (!userEmail) return res.status(400).json({ error: 'Email is required' });

    const user = await queryOne(`SELECT id, first_name FROM users WHERE email='${sanitize(userEmail)}'`);
    if (!user) {
      // Don't reveal if email exists
      return res.json({ success: true, message: 'If this email is registered, you will receive a reset code.' });
    }

    const code = generateCode();
    resetCodes[userEmail] = { code, expires: Date.now() + 15 * 60 * 1000, userId: user.id };
    email.sendPasswordReset(userEmail, user.first_name || 'Trader', code).catch(e => console.error('[Auth] Reset email error:', e.message));

    res.json({ success: true, message: 'If this email is registered, you will receive a reset code.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email: userEmail, code, new_password } = req.body;
    if (!userEmail || !code || !new_password) return res.status(400).json({ error: 'Email, code, and new password are required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const stored = resetCodes[userEmail];
    if (!stored) return res.status(400).json({ error: 'No reset request found. Request a new code.' });
    if (Date.now() > stored.expires) {
      delete resetCodes[userEmail];
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if (stored.code !== code) return res.status(400).json({ error: 'Invalid code' });

    const hash = bcrypt.hashSync(new_password, 10);
    await run(`UPDATE users SET password_hash=?, updated_at=NOW()::TEXT WHERE id=?`, [hash, stored.userId]);
    delete resetCodes[userEmail];

    await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES (?, ?, 'PASSWORD_RESET', 'Password reset via email')`,
      [generateId(), stored.userId]);

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
