# 🃏 Royal Blackjack — Backend

A production-grade Node.js backend for the Royal Blackjack casino game.  
**100% free stack** — no paid services, no cloud dependencies.

---

## Stack

| Layer | Tech | Why |
|---|---|---|
| HTTP server | **Express** | Battle-tested, minimal |
| Real-time | **Socket.IO** | Bidirectional, auto-reconnect |
| Database | **SQLite** (better-sqlite3) | Zero setup, blazing fast, file-based |
| Auth | **JWT** (access + refresh tokens) | Stateless, secure |
| Passwords | **bcryptjs** | Safe hashing |
| IDs | **uuid** | Room IDs |

---

## Quick Start

```bash
cd casino_backend
npm install

# Copy env config
cp .env.example .env

# Start the server
npm start

# Or with hot reload (dev)
npm run dev
```

Server runs on **http://localhost:3001**

---

## Project Structure

```
casino_backend/
├── server.js              # Entry point — Express + Socket.IO setup
├── db.js                  # SQLite schema, all prepared statements, transaction helpers
├── authMiddleware.js       # JWT sign/verify/middleware
├── backendClient.js        # ← Drop into your frontend folder
├── .env.example
├── routes/
│   ├── auth.js            # Register, login, refresh, logout, /me
│   └── player.js          # Balance, stats, history, leaderboard, topup
└── game/
    ├── engine.js           # Server-side card logic (authoritative)
    ├── roomManager.js      # Room state machine — all game phases
    └── socketHandler.js    # Socket.IO event wiring
```

---

## REST API

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, password, email?}` | Create account |
| POST | `/api/auth/login` | `{username, password}` | Login |
| POST | `/api/auth/refresh` | `{refreshToken}` | Refresh access token |
| POST | `/api/auth/logout` | `{refreshToken}` | Logout |
| GET  | `/api/auth/me` | — | Get current user |

### Player (all require `Authorization: Bearer <token>`)

| Method | Path | Description |
|---|---|---|
| GET  | `/api/player/balance` | Current balance |
| GET  | `/api/player/stats` | Full stats (wins, losses, ROI, etc.) |
| GET  | `/api/player/history?limit=50` | Round history |
| GET  | `/api/player/leaderboard?sort=profit&limit=10` | Leaderboard |
| POST | `/api/player/topup` | Add balance (demo use) |

### Health

```
GET /api/health → { status: "ok", uptime: 123.4, ts: 1715600000000 }
```

---

## WebSocket Events (Socket.IO)

### Connection
Connect with JWT in handshake auth:
```js
const socket = io('http://localhost:3001', {
  auth: { token: accessToken }
});
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:create` | `{numDecks, maxPlayers}` | Create a new room |
| `room:join` | `{roomId}` | Join existing room |
| `room:leave` | — | Leave current room |
| `room:list` | — | List open rooms |
| `game:bet` | `{amount}` | Place bet (betting phase) |
| `game:action` | `{action, handIdx}` | hit/stand/double/split/surrender |
| `game:insurance` | — | Take insurance |
| `chat:message` | `{message}` | Send chat message |
| `ping` | — | Heartbeat |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `phase:betting` | `{timeout}` | Betting phase started |
| `phase:dealing` | full room state | Cards dealt |
| `turn:player` | `{socketId, username, handIdx, handValue, availableActions, timeout}` | Your turn |
| `dealer:reveal` | `{dealerCards}` | Hole card revealed |
| `dealer:play` | `{dealerCards, drawnCards}` | Dealer draws |
| `dealer:blackjack` | `{dealerCards}` | Dealer has blackjack |
| `phase:results` | `{results[], dealerCards, dealerValue, dealerBJ}` | Round over |
| `player:joined` | `{username, playersCount}` | Someone joined |
| `player:left` | `{username, playersCount}` | Someone left |
| `player:bet` | `{username, bet}` | Player placed bet |
| `player:action` | `{username, action, hand, handIdx, handValue}` | Player acted |
| `player:blackjacks` | `{players[]}` | Natural blackjacks |
| `shoe:reshuffled` | — | Shoe reshuffled |
| `chat:message` | `{username, message, timestamp}` | Chat message |
| `error` | `{socketId, message}` | Action error |

---

## Frontend Integration

1. Copy `backendClient.js` into your `games_casino/` folder
2. Add to `index.html` **before** your other scripts:
```html
<script src="https://cdn.socket.io/4.6.1/socket.io.min.js"></script>
<script src="backendClient.js"></script>
```
3. Use the global `BackendClient`:
```js
// Register or login
const user = await BackendClient.Auth.login('alice', 'password123');

// Connect socket
BackendClient.connectSocket();

// Create / join a room
const { roomId } = await BackendClient.Room.create(6, 5);

// Place a bet
await BackendClient.Game.bet(500);

// Listen for your turn
BackendClient.on('turn:player', ({ availableActions }) => {
  // update UI, then:
  await BackendClient.Game.hit();
});

// Listen for results
BackendClient.on('phase:results', ({ results }) => {
  // show outcomes
});

// Get stats
const stats = await BackendClient.Player.getStats();
```

---

## Database Schema

```
users              — accounts, balance
refresh_tokens     — rotating refresh tokens
player_stats       — wins, losses, ROI, etc.
game_sessions      — rooms + settings
round_results      — every hand outcome, persistent
transactions       — balance history
```

---

## Game Rules (enforced server-side)

- **Blackjack pays 3:2**
- **Dealer stands on all 17s** (including soft 17)
- **Split up to 3 times** (4 hands max)
- **Split Aces get one card each**
- **Surrender returns 50% of bet**
- **Insurance is half the original bet, pays 2:1**
- **Double down on first 2 cards only**
- **Auto-stand if action timer expires (20s)**

---

## Security

- Passwords hashed with **bcrypt** (10 rounds)
- Access tokens expire in **15 minutes**
- Refresh tokens expire in **7 days** and are **rotated** on use
- All bets and balance changes validated server-side
- In-memory rate limiting on auth routes
- JWT auth required on all WebSocket events
- All inputs validated and sanitized

---

## Deployment (free options)

| Platform | Notes |
|---|---|
| **Railway** | Free tier, push to deploy, auto-SQLite volume |
| **Render** | Free web service + disk for SQLite |
| **Fly.io** | Free tier, great for SQLite with persistent volumes |
| **Cyclic** | Free Node.js hosting |
| **Your own VPS** | Any $5/mo VPS (DigitalOcean, Hetzner) |

For all platforms: set `JWT_SECRET` and `CLIENT_URL` env vars.
