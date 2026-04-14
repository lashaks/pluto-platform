const jwt = require('jsonwebtoken');
const config = require('../../config');

/**
 * Verify JWT token from Authorization header
 * Attaches decoded user to req.user
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    }
    next();
  });
}

/**
 * Require support or admin role
 */
function requireSupport(req, res, next) {
  authenticate(req, res, () => {
    if (!['admin', 'support'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Staff access required', code: 'FORBIDDEN' });
    }
    next();
  });
}

module.exports = { authenticate, requireAdmin, requireSupport };
