// ===== JWT AUTHENTICATION MIDDLEWARE =====
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'royal-blackjack-super-secret-change-in-prod';

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signAccessToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '15m' });
}

function signRefreshToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { authMiddleware, signAccessToken, signRefreshToken, verifyToken };
