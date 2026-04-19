const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { queryOne, queryAll, run } = require('../models/database');
const { generateId, generateAffiliateCode, sanitize } = require('../utils/helpers');
const email = require('../services/email');

const router = express.Router();

// Verification codes stored in DB (survives server restarts)
// Reset codes stored in DB (not memory — survives server restarts)

// Brute-force protection — lockout after 5 failed login attempts
const loginAttempts = {}; // { email: { count, lockedUntil } }
function checkLoginBrute(email) {
  const now = Date.now();
  const a = loginAttempts[email];
  if (a && a.lockedUntil && now < a.lockedUntil) {
    const mins = Math.ceil((a.lockedUntil - now) / 60000);
    throw Object.assign(new Error(`Too many failed attempts. Try again in ${mins} minute(s).`), { status: 429 });
  }
}
function recordLoginFail(email) {
  const now = Date.now();
  if (!loginAttempts[email]) loginAttempts[email] = { count: 0, lockedUntil: null };
  loginAttempts[email].count++;
  if (loginAttempts[email].count >= 5) {
    loginAttempts[email].lockedUntil = now + 15 * 60 * 1000; // 15 min lockout
    loginAttempts[email].count = 0;
  }
}
function clearLoginAttempts(email) { delete loginAttempts[email]; }

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email: userEmail, password, first_name, last_name, terms_accepted } = req.body;
    if (!userEmail || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!terms_accepted) return res.status(400).json({ error: 'You must accept the Terms of Service, Privacy Policy, and Risk Disclosure' });

    const existing = await queryOne(`SELECT id FROM users WHERE email=$1`, [userEmail]);
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const id = generateId();
    const hash = bcrypt.hashSync(password, 10);
    const affiliateCode = generateAffiliateCode(id);

    await run(`INSERT INTO users (id, email, password_hash, first_name, last_name, affiliate_code, is_active, terms_accepted_at, terms_version)
         VALUES (?, ?, ?, ?, ?, ?, 1, NOW()::TEXT, 'v1')`,
      [id, userEmail, hash, first_name || '', last_name || '', affiliateCode]);

    const token = jwt.sign({ id, email: userEmail, role: 'trader' }, config.jwtSecret, { expiresIn: config.jwtExpiry });

    await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES (?, ?, 'USER_REGISTERED', ?)`,
      [generateId(), id, `New user: ${userEmail}`]);

    // Send verification code
    const code = generateCode();
    await run(`DELETE FROM platform_settings WHERE key=$1`, ["vcode_"+userEmail]);
    await run(`INSERT INTO platform_settings (key, value) VALUES ($1, $2)`, ["vcode_"+userEmail, JSON.stringify({code, expires: Date.now()+15*60*1000, userId: id})]);
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

    const storedRow = await queryOne(`SELECT value FROM platform_settings WHERE key=$1`, ["vcode_"+userEmail]);
    const stored = storedRow ? JSON.parse(storedRow.value) : null;
    if (!stored) return res.status(400).json({ error: 'No verification pending for this email. Request a new code.' });
    if (Date.now() > stored.expires) {
      await run(`DELETE FROM platform_settings WHERE key=$1`, ["vcode_"+userEmail]);
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if (stored.code !== code) return res.status(400).json({ error: 'Invalid code' });

    // Mark email as verified
    await run(`UPDATE users SET kyc_status='none', updated_at=NOW()::TEXT WHERE id=?`, [stored.userId]);
    await run(`DELETE FROM platform_settings WHERE key=$1`, ["vcode_"+userEmail]);

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

    const user = await queryOne(`SELECT id, first_name FROM users WHERE email=$1`, [userEmail]);
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

    checkLoginBrute(userEmail); // throws if locked out

    const user = await queryOne(`SELECT * FROM users WHERE email=$1`, [userEmail]);
    if (!user) { recordLoginFail(userEmail); return res.status(401).json({ error: 'Invalid email or password' }); }
    if (user.is_active === 0 || user.is_active === '0' || user.is_active === false) return res.status(401).json({ error: 'Account is suspended' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      recordLoginFail(userEmail);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    clearLoginAttempts(userEmail);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry }
    );

    await run(`UPDATE users SET last_login=NOW()::TEXT WHERE id=?`, [user.id]);

    // --- LOGIN ALERT EMAIL ---
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'Unknown';
    const ua = req.headers['user-agent'] || 'Unknown';
    const now = new Date().toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
    // Simple device label from user-agent
    let device = 'Unknown';
    if (/iPhone|iPad/i.test(ua)) device = 'iPhone / iPad';
    else if (/Android/i.test(ua)) device = 'Android Device';
    else if (/Macintosh/i.test(ua)) device = 'Mac — ' + (/Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Browser');
    else if (/Windows/i.test(ua)) device = 'Windows — ' + (/Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Edge/i.test(ua) ? 'Edge' : 'Browser');
    else if (/Linux/i.test(ua)) device = 'Linux — Browser';

    // Geo lookup via ip-api.com (free, no key needed)
    let location = 'Unknown';
    if (ip && ip !== 'Unknown' && ip !== '127.0.0.1' && !ip.startsWith('::')) {
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country`);
        const gd = await geo.json();
        if (gd.status === 'success') {
          location = [gd.city, gd.regionName, gd.country].filter(Boolean).join(', ');
        }
      } catch (_) { /* geo lookup is best-effort */ }
    }

    email.sendLoginAlert(userEmail, user.first_name || 'Trader', { ip, location, device, time: now })
      .catch(e => console.error('[Auth] Login alert email error:', e.message));
    // --- END LOGIN ALERT ---

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

    const user = await queryOne(`SELECT id, first_name FROM users WHERE email=$1`, [userEmail]);
    if (!user) {
      return res.json({ success: true, message: 'If this email is registered, you will receive a reset code.' });
    }

    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Store in DB — upsert by user_id
    await run(`DELETE FROM password_reset_codes WHERE user_id=?`, [user.id]);
    await run(`INSERT INTO password_reset_codes (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)`,
      [generateId(), user.id, code, expires]);

    email.sendPasswordReset(userEmail, user.first_name || 'Trader', code)
      .catch(e => console.error('[Auth] Reset email error:', e.message));

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

    const user = await queryOne(`SELECT id FROM users WHERE email=$1`, [userEmail]);
    if (!user) return res.status(400).json({ error: 'Invalid request' });

    const stored = await queryOne(`SELECT * FROM password_reset_codes WHERE user_id=$1 AND code=$2`, [user.id, code]);
    if (!stored) return res.status(400).json({ error: 'Invalid or expired code. Request a new one.' });
    if (new Date(stored.expires_at) < new Date()) {
      await run(`DELETE FROM password_reset_codes WHERE user_id=?`, [user.id]);
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    await run(`UPDATE users SET password_hash=?, updated_at=NOW()::TEXT WHERE id=?`, [hash, user.id]);
    await run(`DELETE FROM password_reset_codes WHERE user_id=?`, [user.id]);

    await run(`INSERT INTO audit_log (id, user_id, action, details) VALUES (?, ?, 'PASSWORD_RESET', 'Password reset via email')`,
      [generateId(), user.id]);

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
