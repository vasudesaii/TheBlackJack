// ===== AUTH ROUTES =====
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/refresh
// POST /api/auth/logout
// GET  /api/auth/me

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { Queries, registerUser } = require('../db');
const { signAccessToken, signRefreshToken, verifyToken, authMiddleware } = require('../authMiddleware');

const BCRYPT_ROUNDS = 10;
const REFRESH_TTL_DAYS = 7;

// ── Simple rate limiter (in-memory, per IP) ──
const rateLimitMap = new Map();
function rateLimit(maxReqs, windowMs) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimitMap.set(key, entry);
    if (entry.count > maxReqs) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}

// ── Validation helpers ──
function validateUsername(u) {
  return typeof u === 'string' && u.length >= 3 && u.length <= 20 && /^[a-zA-Z0-9_]+$/.test(u);
}
function validatePassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 100;
}

// ──────────── REGISTER ────────────
router.post('/register', rateLimit(5, 60_000), async (req, res) => {
  const { username, email, password } = req.body || {};

  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars (letters, numbers, underscore)' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be 6-100 characters' });
  }
  if (email && (typeof email !== 'string' || !email.includes('@'))) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Check username taken
  const existing = Queries.getUserByUsername.get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let userId;
  try {
    userId = registerUser({ username, email: email || null, passwordHash });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error during registration' });
  }

  const accessToken = signAccessToken(userId, username);
  const refreshToken = signRefreshToken(userId, username);
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TTL_DAYS * 86400;
  Queries.saveRefreshToken.run({ userId, token: refreshToken, expiresAt });

  res.status(201).json({
    message: 'Registration successful',
    accessToken,
    refreshToken,
    user: { id: userId, username, balance: 10000 },
  });
});

// ──────────── LOGIN ────────────
router.post('/login', rateLimit(10, 60_000), async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = Queries.getUserByUsername.get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  Queries.updateLastLogin.run(user.id);

  const accessToken = signAccessToken(user.id, user.username);
  const refreshToken = signRefreshToken(user.id, user.username);
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TTL_DAYS * 86400;
  Queries.saveRefreshToken.run({ userId: user.id, token: refreshToken, expiresAt });

  res.json({
    message: 'Login successful',
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, balance: user.balance },
  });
});

// ──────────── REFRESH ────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const stored = Queries.getRefreshToken.get(refreshToken);
  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });
  if (stored.expires_at < Math.floor(Date.now() / 1000)) {
    Queries.deleteRefreshToken.run(refreshToken);
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  let payload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    Queries.deleteRefreshToken.run(refreshToken);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Rotate: delete old, issue new
  Queries.deleteRefreshToken.run(refreshToken);
  const newAccess = signAccessToken(payload.userId, payload.username);
  const newRefresh = signRefreshToken(payload.userId, payload.username);
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TTL_DAYS * 86400;
  Queries.saveRefreshToken.run({ userId: payload.userId, token: newRefresh, expiresAt });

  const user = Queries.getUserById.get(payload.userId);

  res.json({ accessToken: newAccess, refreshToken: newRefresh, user });
});

// ──────────── LOGOUT ────────────
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) Queries.deleteRefreshToken.run(refreshToken);
  res.json({ message: 'Logged out' });
});

// ──────────── ME ────────────
router.get('/me', authMiddleware, (req, res) => {
  const user = Queries.getUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
