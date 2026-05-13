// ===== SOCKET.IO EVENT HANDLER =====
// Handles all real-time WebSocket events for game rooms.

const { verifyToken } = require('../authMiddleware');
const { Queries } = require('../db');
const {
  createRoom, getRoom, joinRoom, leaveRoom,
  placeBet, playerAction, takeInsurance,
  sanitizeRoom, MIN_BET, MAX_BET,
} = require('./roomManager');

// Map socketId → roomId for quick cleanup
const socketRoomMap = new Map();

module.exports = function setupSockets(io) {

  // ── JWT auth on connection ──
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyToken(token);
      socket.userId   = payload.userId;
      socket.username = payload.username;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.username} (${socket.id})`);

    // ──────────── CREATE ROOM ────────────
    socket.on('room:create', async ({ numDecks = 6, maxPlayers = 5, tableName = '' } = {}, ack) => {
      try {
        if (numDecks && ![2, 4, 6, 8].includes(numDecks)) {
          return ack?.({ error: 'numDecks must be 2, 4, 6, or 8' });
        }
        if (maxPlayers < 1 || maxPlayers > 5) {
          return ack?.({ error: 'maxPlayers must be 1–5' });
        }

        const room = await createRoom({ numDecks, maxPlayers, tableName });
        room.io = io;

        const balanceRow = await Queries.getBalance.get(socket.userId);
        const balance = balanceRow?.balance ?? 0;
        const joinResult = joinRoom(room, socket, {
          userId: socket.userId,
          username: socket.username,
          balance,
        });

        if (joinResult.error) return ack?.({ error: joinResult.error });

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        console.log(`🎰 Room created: ${room.id} by ${socket.username}`);
        ack?.({ ok: true, roomId: room.id, state: sanitizeRoom(room) });

      } catch (err) {
        console.error('room:create error:', err);
        ack?.({ error: 'Failed to create room' });
      }
    });

    // ──────────── JOIN ROOM ────────────
    socket.on('room:join', async ({ roomId } = {}, ack) => {
      try {
        if (!roomId) return ack?.({ error: 'roomId required' });

        const room = getRoom(roomId.toUpperCase());
        if (!room) return ack?.({ error: 'Room not found' });

        const balanceRow = await Queries.getBalance.get(socket.userId);
        const balance = balanceRow?.balance ?? 0;
        const result = joinRoom(room, socket, {
          userId: socket.userId,
          username: socket.username,
          balance,
        });

        if (result.error) return ack?.({ error: result.error });

        room.io = io;
        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        socket.to(room.id).emit('player:joined', {
          username: socket.username,
          playersCount: room.players.size,
        });

        console.log(`👤 ${socket.username} joined room ${room.id}`);
        ack?.({ ok: true, roomId: room.id, state: sanitizeRoom(room) });

      } catch (err) {
        console.error('room:join error:', err);
        ack?.({ error: 'Failed to join room' });
      }
    });

    // ──────────── LEAVE ROOM ────────────
    socket.on('room:leave', (_, ack) => {
      handleLeave(socket);
      ack?.({ ok: true });
    });

    // ──────────── LIST ROOMS ────────────
    socket.on('room:list', (_, ack) => {
      const { rooms } = require('./roomManager');
      const list = [...rooms.values()]
        .filter(r => r.phase === 'waiting' || r.phase === 'betting')
        .map(r => ({
          id: r.id,
          phase: r.phase,
          numDecks: r.numDecks,
          maxPlayers: r.maxPlayers,
          currentPlayers: r.players.size,
          roundNumber: r.roundNumber,
        }));
      ack?.({ rooms: list });
    });

    // ──────────── PLACE BET ────────────
    socket.on('game:bet', ({ amount } = {}, ack) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return ack?.({ error: 'Not in a room' });

        const room = getRoom(roomId);
        if (!room) return ack?.({ error: 'Room not found' });

        const parsed = parseFloat(amount);
        if (isNaN(parsed) || parsed < MIN_BET || parsed > MAX_BET) {
          return ack?.({ error: `Bet must be ₹${MIN_BET}–₹${MAX_BET}` });
        }

        const result = placeBet(room, socket.id, parsed);
        ack?.(result);

      } catch (err) {
        console.error('game:bet error:', err);
        ack?.({ error: 'Failed to place bet' });
      }
    });

    // ──────────── PLAYER ACTION ────────────
    socket.on('game:action', ({ action, handIdx = 0 } = {}, ack) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return ack?.({ error: 'Not in a room' });

        const room = getRoom(roomId);
        if (!room) return ack?.({ error: 'Room not found' });

        const validActions = ['hit', 'stand', 'double', 'split', 'surrender'];
        if (!validActions.includes(action)) {
          return ack?.({ error: 'Invalid action' });
        }

        const result = playerAction(room, socket.id, action, handIdx);
        ack?.(result);

      } catch (err) {
        console.error('game:action error:', err);
        ack?.({ error: 'Failed to process action' });
      }
    });

    // ──────────── INSURANCE ────────────
    socket.on('game:insurance', (_, ack) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return ack?.({ error: 'Not in a room' });

        const room = getRoom(roomId);
        if (!room) return ack?.({ error: 'Room not found' });

        const result = takeInsurance(room, socket.id);
        ack?.(result);

      } catch (err) {
        console.error('game:insurance error:', err);
        ack?.({ error: 'Failed to take insurance' });
      }
    });

    // ──────────── CHAT ────────────
    socket.on('chat:message', ({ message } = {}) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId || !message) return;

      const sanitized = String(message).slice(0, 200).trim();
      if (!sanitized) return;

      io.to(roomId).emit('chat:message', {
        username: socket.username,
        message: sanitized,
        timestamp: Date.now(),
      });
    });

    // ──────────── PING / HEARTBEAT ────────────
    socket.on('ping', (_, ack) => ack?.({ pong: true, ts: Date.now() }));

    // ──────────── DISCONNECT ────────────
    socket.on('disconnect', (reason) => {
      console.log(`❌ Disconnected: ${socket.username} — ${reason}`);
      handleLeave(socket);
    });

    // ──────────── HELPER ────────────
    function handleLeave(socket) {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = getRoom(roomId);
      if (room) {
        leaveRoom(room, socket.id);
        socket.to(roomId).emit('player:left', {
          username: socket.username,
          playersCount: room.players.size,
        });
      }

      socket.leave(roomId);
      socketRoomMap.delete(socket.id);
    }
  });
};
