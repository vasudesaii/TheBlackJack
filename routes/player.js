// ===== PLAYER ROUTES =====
// GET  /api/player/balance
// GET  /api/player/stats
// GET  /api/player/history
// GET  /api/player/leaderboard
// POST /api/player/topup        (dev/demo only)

const router = require('express').Router();
const { Queries } = require('../db');
const { authMiddleware } = require('../authMiddleware');

// All player routes require auth
router.use(authMiddleware);

// ── Balance ──
router.get('/balance', (req, res) => {
  const row = Queries.getBalance.get(req.userId);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ balance: row.balance });
});

// ── Stats ──
router.get('/stats', (req, res) => {
  const stats = Queries.getStats.get(req.userId);
  if (!stats) return res.status(404).json({ error: 'Stats not found' });

  const winRate = stats.rounds_played > 0
    ? ((stats.wins / stats.rounds_played) * 100).toFixed(1)
    : '0.0';

  const roi = stats.total_wagered > 0
    ? ((stats.total_profit / stats.total_wagered) * 100).toFixed(2)
    : '0.00';

  res.json({
    stats: {
      ...stats,
      win_rate: parseFloat(winRate),
      roi: parseFloat(roi),
    }
  });
});

// ── Round History ──
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = Queries.getPlayerHistory.all(req.userId, limit);
  res.json({ history: rows, count: rows.length });
});

// ── Leaderboard ──
router.get('/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const sortBy = req.query.sort === 'wins' ? 'wins' : 'profit';

  const rows = sortBy === 'wins'
    ? Queries.getLeaderboardByWins.all(limit)
    : Queries.getLeaderboard.all(limit);

  res.json({ leaderboard: rows, sort: sortBy });
});

// ── Top-up (demo/dev convenience) ──
router.post('/topup', (req, res) => {
  const amount = parseFloat(req.body?.amount) || 10000;
  if (amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Amount must be between 1 and 100,000' });
  }
  Queries.adjustBalance.run(amount, req.userId);
  Queries.addTransaction.run({
    userId: req.userId,
    amount,
    balanceAfter: Queries.getBalance.get(req.userId).balance,
    type: 'topup',
    description: 'Manual top-up',
  });
  const newBal = Queries.getBalance.get(req.userId).balance;
  res.json({ message: 'Balance topped up', balance: newBal });
});

module.exports = router;
