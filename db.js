// ===== DATABASE LAYER =====
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'casino.db');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const USE_PG = Boolean(DATABASE_URL);

let pool;
let sqliteDb;
let _saveTimer;

function normalizeParams(sql, params = {}) {
  if (Array.isArray(params)) return { sql, values: params };
  const values = [];
  const indexMap = {};
  const normalized = sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
    if (!(name in indexMap)) {
      indexMap[name] = values.length + 1;
      values.push(params[`$${name}`] ?? params[name]);
    }
    return `$${indexMap[name]}`;
  });
  return { sql: normalized, values };
}

async function pgQuery(sql, params = {}) {
  const { sql: text, values } = normalizeParams(sql, params);
  return pool.query(text, values);
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToDisk, 500);
}

function saveToDisk() {
  if (!sqliteDb) return;
  try {
    const data = sqliteDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Save error:', err.message);
  }
}

function sqliteRun(sql, params = {}) {
  sqliteDb.run(sql, params);
  scheduleSave();
  const res = sqliteDb.exec('SELECT last_insert_rowid()');
  return { lastInsertRowid: res[0]?.values?.[0]?.[0] ?? null };
}

function sqliteGet(sql, params = []) {
  const stmt = sqliteDb.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function sqliteAll(sql, params = []) {
  const stmt = sqliteDb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function run(sql, params = {}) {
  if (USE_PG) {
    const result = await pgQuery(sql, params);
    return { lastInsertRowid: result.rows?.[0]?.id ?? null, rowCount: result.rowCount };
  }
  return sqliteRun(sql, params);
}

async function get(sql, params = {}) {
  if (USE_PG) {
    const result = await pgQuery(sql, params);
    return result.rows[0] || null;
  }
  return sqliteGet(sql, params);
}

async function all(sql, params = {}) {
  if (USE_PG) {
    const result = await pgQuery(sql, params);
    return result.rows;
  }
  return sqliteAll(sql, params);
}

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    email         TEXT    UNIQUE,
    password_hash TEXT    NOT NULL,
    balance       REAL    NOT NULL DEFAULT 10000,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_login    INTEGER
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token      TEXT    UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS player_stats (
    user_id       INTEGER PRIMARY KEY,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    pushes        INTEGER NOT NULL DEFAULT 0,
    blackjacks    INTEGER NOT NULL DEFAULT 0,
    surrenders    INTEGER NOT NULL DEFAULT 0,
    total_wagered REAL    NOT NULL DEFAULT 0,
    total_profit  REAL    NOT NULL DEFAULT 0,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    highest_win   REAL    NOT NULL DEFAULT 0,
    highest_bal   REAL    NOT NULL DEFAULT 10000
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     TEXT    UNIQUE NOT NULL,
    num_decks   INTEGER NOT NULL DEFAULT 6,
    max_players INTEGER NOT NULL DEFAULT 5,
    status      TEXT    NOT NULL DEFAULT 'waiting',
    rounds_done INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    ended_at    INTEGER
  );
  CREATE TABLE IF NOT EXISTS round_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL,
    user_id       INTEGER NOT NULL,
    round_number  INTEGER NOT NULL,
    bet           REAL    NOT NULL,
    outcome       TEXT    NOT NULL,
    payout        REAL    NOT NULL,
    player_value  INTEGER,
    dealer_value  INTEGER,
    had_blackjack INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    amount        REAL    NOT NULL,
    balance_after REAL    NOT NULL,
    type          TEXT    NOT NULL,
    description   TEXT,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`;

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT    UNIQUE NOT NULL,
    email         TEXT    UNIQUE,
    password_hash TEXT    NOT NULL,
    balance       NUMERIC NOT NULL DEFAULT 10000,
    created_at    BIGINT NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM now())),
    last_login    BIGINT
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    UNIQUE NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM now()))
  );
  CREATE TABLE IF NOT EXISTS player_stats (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    pushes        INTEGER NOT NULL DEFAULT 0,
    blackjacks    INTEGER NOT NULL DEFAULT 0,
    surrenders    INTEGER NOT NULL DEFAULT 0,
    total_wagered NUMERIC NOT NULL DEFAULT 0,
    total_profit  NUMERIC NOT NULL DEFAULT 0,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    highest_win   NUMERIC NOT NULL DEFAULT 0,
    highest_bal   NUMERIC NOT NULL DEFAULT 10000
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    id          SERIAL PRIMARY KEY,
    room_id     TEXT UNIQUE NOT NULL,
    num_decks   INTEGER NOT NULL DEFAULT 6,
    max_players INTEGER NOT NULL DEFAULT 5,
    status      TEXT NOT NULL DEFAULT 'waiting',
    rounds_done INTEGER NOT NULL DEFAULT 0,
    created_at  BIGINT NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM now())),
    ended_at    BIGINT
  );
  CREATE TABLE IF NOT EXISTS round_results (
    id            SERIAL PRIMARY KEY,
    session_id    INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_number  INTEGER NOT NULL,
    bet           NUMERIC NOT NULL,
    outcome       TEXT NOT NULL,
    payout        NUMERIC NOT NULL,
    player_value  INTEGER,
    dealer_value  INTEGER,
    had_blackjack BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    BIGINT NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM now()))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount        NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    type          TEXT NOT NULL,
    description   TEXT,
    created_at    BIGINT NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM now()))
  );
`;

const Queries = {
  createUser: {
    run: ({ username, email, password_hash }) =>
      run('INSERT INTO users (username, email, password_hash) VALUES ($u,$e,$p)' + (USE_PG ? ' RETURNING id' : ''),
        { $u: username, $e: email ?? null, $p: password_hash }),
  },
  createStats: { run: (id) => run('INSERT INTO player_stats (user_id) VALUES ($id)' + (USE_PG ? '' : ''), { $id: id }) },
  getUserByUsername: {
    get: (u) => USE_PG
      ? get('SELECT * FROM users WHERE LOWER(username) = LOWER($u)', { $u: u })
      : get('SELECT * FROM users WHERE username = $u COLLATE NOCASE', { $u: u }),
  },
  getUserById: { get: (id) => get('SELECT id,username,email,balance,created_at,last_login FROM users WHERE id=$id', { $id: id }) },
  updateLastLogin: { run: (id) => run(`UPDATE users SET last_login=${USE_PG ? 'FLOOR(EXTRACT(EPOCH FROM now()))' : "strftime('%s','now')"} WHERE id=$id`, { $id: id }) },

  saveRefreshToken: {
    run: ({ userId, token, expiresAt }) =>
      run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($u,$t,$e)', { $u: userId, $t: token, $e: expiresAt }),
  },
  getRefreshToken: { get: (t) => get('SELECT * FROM refresh_tokens WHERE token=$t', { $t: t }) },
  deleteRefreshToken: { run: (t) => run('DELETE FROM refresh_tokens WHERE token=$t', { $t: t }) },
  deleteUserTokens: { run: (u) => run('DELETE FROM refresh_tokens WHERE user_id=$u', { $u: u }) },
  cleanExpiredTokens: { run: () => run(USE_PG ? 'DELETE FROM refresh_tokens WHERE expires_at < FLOOR(EXTRACT(EPOCH FROM now()))' : "DELETE FROM refresh_tokens WHERE expires_at < strftime('%s','now')") },

  getBalance: { get: (id) => get('SELECT balance FROM users WHERE id=$id', { $id: id }) },
  setBalance: { run: (bal, id) => run('UPDATE users SET balance=$b WHERE id=$id', { $b: bal, $id: id }) },
  adjustBalance: { run: (amt, id) => run('UPDATE users SET balance=balance+$a WHERE id=$id', { $a: amt, $id: id }) },

  getStats: { get: (id) => get('SELECT * FROM player_stats WHERE user_id=$id', { $id: id }) },
  updateStats: {
    run: async ({ user_id, wins, losses, pushes, blackjacks, surrenders,
            total_wagered, total_profit, rounds_played, highest_win, highest_bal }) => {
      const cur = await get('SELECT highest_win,highest_bal FROM player_stats WHERE user_id=$id', { $id: user_id });
      const hw = Math.max(cur?.highest_win ?? 0, highest_win);
      const hb = Math.max(cur?.highest_bal ?? 0, highest_bal);
      return run(`UPDATE player_stats SET
        wins=wins+$w, losses=losses+$l, pushes=pushes+$p,
        blackjacks=blackjacks+$bj, surrenders=surrenders+$s,
        total_wagered=total_wagered+$tw, total_profit=total_profit+$tp,
        rounds_played=rounds_played+$rp, highest_win=$hw, highest_bal=$hb
        WHERE user_id=$uid`,
        { $w:wins,$l:losses,$p:pushes,$bj:blackjacks,$s:surrenders,
          $tw:total_wagered,$tp:total_profit,$rp:rounds_played,$hw:hw,$hb:hb,$uid:user_id });
    },
  },
  resetStats: {
    run: (userId) => run(`UPDATE player_stats SET
      wins=0, losses=0, pushes=0, blackjacks=0, surrenders=0,
      total_wagered=0, total_profit=0, rounds_played=0,
      highest_win=0, highest_bal=10000
      WHERE user_id=$id`, { $id: userId }),
  },

  createSession: {
    run: ({ roomId, numDecks, maxPlayers }) =>
      run('INSERT INTO game_sessions (room_id,num_decks,max_players) VALUES ($r,$d,$m)' + (USE_PG ? ' RETURNING id' : ''),
        { $r: roomId, $d: numDecks, $m: maxPlayers }),
  },
  getSession: { get: (r) => get('SELECT * FROM game_sessions WHERE room_id=$r', { $r: r }) },
  closeSession: {
    run: (rounds, roomId) =>
      run(`UPDATE game_sessions SET status='finished',ended_at=${USE_PG ? 'FLOOR(EXTRACT(EPOCH FROM now()))' : "strftime('%s','now')"},rounds_done=$r WHERE room_id=$id`,
        { $r: rounds, $id: roomId }),
  },
  incrementRounds: { run: (r) => run('UPDATE game_sessions SET rounds_done=rounds_done+1 WHERE room_id=$r', { $r: r }) },

  saveRoundResult: {
    run: ({ session_id, user_id, round_number, bet, outcome, payout, player_value, dealer_value, had_blackjack }) =>
      run('INSERT INTO round_results (session_id,user_id,round_number,bet,outcome,payout,player_value,dealer_value,had_blackjack) VALUES ($si,$ui,$rn,$b,$o,$py,$pv,$dv,$bj)',
        { $si:session_id,$ui:user_id,$rn:round_number,$b:bet,$o:outcome,$py:payout,$pv:player_value,$dv:dealer_value,$bj:had_blackjack }),
  },

  getPlayerHistory: {
    all: (userId, limit) => all(`
      SELECT rr.*, gs.room_id, gs.num_decks
      FROM round_results rr JOIN game_sessions gs ON gs.id=rr.session_id
      WHERE rr.user_id=$uid ORDER BY rr.created_at DESC LIMIT $lim`,
      { $uid: userId, $lim: limit }),
  },

  addTransaction: {
    run: ({ userId, amount, balanceAfter, type, description }) =>
      run('INSERT INTO transactions (user_id,amount,balance_after,type,description) VALUES ($u,$a,$b,$t,$d)',
        { $u:userId,$a:amount,$b:balanceAfter,$t:type,$d:description ?? null }),
  },

  getLeaderboard: {
    all: (lim) => all(`SELECT u.username,ps.wins,ps.losses,ps.blackjacks,
      ps.total_wagered,ps.total_profit,ps.rounds_played,ps.highest_win,u.balance
      FROM player_stats ps JOIN users u ON u.id=ps.user_id
      ORDER BY ps.total_profit DESC LIMIT $lim`, { $lim: lim }),
  },
  getLeaderboardByWins: {
    all: (lim) => all(`SELECT u.username,ps.wins,ps.losses,ps.blackjacks,
      ps.total_wagered,ps.total_profit,ps.rounds_played,ps.highest_win,u.balance
      FROM player_stats ps JOIN users u ON u.id=ps.user_id
      ORDER BY ps.wins DESC LIMIT $lim`, { $lim: lim }),
  },
};

async function registerUser({ username, email, passwordHash }) {
  const info = await Queries.createUser.run({ username, email: email ?? null, password_hash: passwordHash });
  const userId = info.lastInsertRowid;
  if (userId) await Queries.createStats.run(userId);
  return userId;
}

async function persistRoundResults(roomId, roundNumber, playerResults, dealerValue) {
  const session = await Queries.getSession.get(roomId);
  if (!session) return;
  await Queries.incrementRounds.run(roomId);
  for (const pr of playerResults) {
    const { userId, bet, outcome, payout, playerValue, hadBlackjack, balance } = pr;
    await Queries.setBalance.run(balance, userId);
    await Queries.addTransaction.run({ userId, amount: payout, balanceAfter: balance,
      type: payout >= 0 ? 'win' : 'loss', description: `Round ${roundNumber}: ${outcome}` });
    await Queries.saveRoundResult.run({ session_id: session.id, user_id: userId,
      round_number: roundNumber, bet, outcome, payout, player_value: playerValue,
      dealer_value: dealerValue, had_blackjack: hadBlackjack ? 1 : 0 });
    await Queries.updateStats.run({ user_id: userId,
      wins: outcome === 'win' || outcome === 'blackjack' ? 1 : 0,
      losses: outcome === 'lose' || outcome === 'bust' ? 1 : 0,
      pushes: outcome === 'push' ? 1 : 0,
      blackjacks: outcome === 'blackjack' ? 1 : 0,
      surrenders: outcome === 'surrender' ? 1 : 0,
      total_wagered: bet, total_profit: payout, rounds_played: 1,
      highest_win: payout > 0 ? payout : 0, highest_bal: balance });
  }
  if (!USE_PG) saveToDisk();
}

async function initDb() {
  if (USE_PG) {
    const pgOptions = { connectionString: DATABASE_URL };
    if (process.env.PGSSLMODE !== 'disable') {
      pgOptions.ssl = { rejectUnauthorized: false };
    }
    pool = new Pool(pgOptions);
    await pool.query(PG_SCHEMA);
    console.log('[DB] Connected to PostgreSQL');
    return pool;
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });
  if (fs.existsSync(DB_PATH)) {
    sqliteDb = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded casino.db from disk');
  } else {
    sqliteDb = new SQL.Database();
    console.log('[DB] Created new casino.db');
  }
  sqliteDb.run('PRAGMA foreign_keys = ON');
  sqliteDb.exec(SQLITE_SCHEMA);
  saveToDisk();
  setInterval(() => { Queries.cleanExpiredTokens.run(); saveToDisk(); }, 3600_000);
  process.on('SIGTERM', saveToDisk);
  process.on('SIGINT', saveToDisk);
  return sqliteDb;
}

module.exports = { initDb, Queries, registerUser, persistRoundResults, USE_PG };

