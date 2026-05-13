// ===== PLAYER ROUTES =====
// GET  /api/player/balance
// GET  /api/player/stats
// GET  /api/player/history
// GET  /api/player/leaderboard
// POST /api/player/topup        (dev/demo only)
// POST /api/player/reset        (reset profile)

const router = require('express').Router();
const { Queries } = require('../db');
const { authMiddleware } = require('../authMiddleware');

// All player routes require auth
router.use(authMiddleware);

// ── Balance ──
router.get('/balance', async (req, res) => {
  const row = await Queries.getBalance.get(req.userId);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ balance: row.balance });
});

// ── Stats ──
router.get('/stats', async (req, res) => {
  const stats = await Queries.getStats.get(req.userId);
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
router.get('/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await Queries.getPlayerHistory.all(req.userId, limit);
  res.json({ history: rows, count: rows.length });
});

// ── Leaderboard ──
router.get('/leaderboard', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const sortBy = req.query.sort === 'wins' ? 'wins' : 'profit';

  const rows = sortBy === 'wins'
    ? await Queries.getLeaderboardByWins.all(limit)
    : await Queries.getLeaderboard.all(limit);

  res.json({ leaderboard: rows, sort: sortBy });
});

// ── Top-up (demo/dev convenience) ──
router.post('/topup', async (req, res) => {
  const amount = parseFloat(req.body?.amount) || 10000;
  if (amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Amount must be between 1 and 100,000' });
  }

  await Queries.adjustBalance.run(amount, req.userId);
  const balance = (await Queries.getBalance.get(req.userId)).balance;
  await Queries.addTransaction.run({
    userId: req.userId,
    amount,
    balanceAfter: balance,
    type: 'topup',
    description: 'Manual top-up',
  });

  res.json({ message: 'Balance topped up', balance });
});

// ── Reset Profile ──
router.post('/reset', async (req, res) => {
  const defaultBalance = 10000;
  await Queries.setBalance.run(defaultBalance, req.userId);
  await Queries.resetStats.run(req.userId);
  await Queries.addTransaction.run({
    userId: req.userId,
    amount: 0,
    balanceAfter: defaultBalance,
    type: 'reset',
    description: 'Profile reset',
  });

  res.json({ message: 'Profile reset', balance: defaultBalance });
});

// ── Available Rooms ──
router.get('/rooms', (req, res) => {
  const { listAvailableRooms } = require('../game/roomManager');
  const rooms = listAvailableRooms();
  res.json({ rooms });
});

module.exports = router;
