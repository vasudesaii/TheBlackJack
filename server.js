require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const { initDb } = require('./db');

const PORT       = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

async function start() {
  // DB must be ready before routes touch it
  await initDb();

  const app = express();

  app.use(cors({
    origin: [CLIENT_URL, 'http://localhost:5500', 'http://127.0.0.1:5500'],
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
    credentials: true,
  }));
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const authRoutes   = require('./routes/auth');
  const playerRoutes = require('./routes/player');
  const setupSockets = require('./game/socketHandler');

  app.use('/api/auth',   authRoutes);
  app.use('/api/player', playerRoutes);

  app.get('/api/health', (req, res) =>
    res.json({ status:'ok', uptime: process.uptime(), ts: Date.now() }));

  app.use('/api/*', (req, res) => res.status(404).json({ error:'Not found' }));

  app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error:'Internal server error' });
  });

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: [CLIENT_URL, 'http://localhost:5500', 'http://127.0.0.1:5500'],
      methods: ['GET','POST'],
      credentials: true,
    },
    pingTimeout: 30_000,
    pingInterval: 10_000,
    maxHttpBufferSize: 1e5,
  });

  setupSockets(io);

  httpServer.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   🃏  Royal Blackjack Backend        ║
  ║   http://localhost:${PORT}              ║
  ║   DB : casino.db (SQLite/sql.js)     ║
  ╚══════════════════════════════════════╝`);
  });

  process.on('SIGTERM', () => httpServer.close(() => process.exit(0)));
  process.on('SIGINT',  () => httpServer.close(() => process.exit(0)));
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
