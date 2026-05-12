// ===== DATABASE LAYER — sql.js (pure JS SQLite, no native bindings) =====
const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'casino.db');

let db;
let _saveTimer;

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToDisk, 500);
}

function saveToDisk() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Save error:', err.message);
  }
}

function run(sql, params = {}) {
  db.run(sql, params);
  scheduleSave();
  const res = db.exec('SELECT last_insert_rowid()');
  return { lastInsertRowid: res[0]?.values[0][0] ?? null };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

const SCHEMA = `
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

const Queries = {
  createUser: {
    run: ({ username, email, password_hash }) =>
      run('INSERT INTO users (username, email, password_hash) VALUES ($u,$e,$p)',
        { $u: username, $e: email ?? null, $p: password_hash }),
  },
  createStats: { run: (id) => run('INSERT OR IGNORE INTO player_stats (user_id) VALUES ($id)', { $id: id }) },
  getUserByUsername: { get: (u) => get('SELECT * FROM users WHERE username = $u COLLATE NOCASE', { $u: u }) },
  getUserById: { get: (id) => get('SELECT id,username,email,balance,created_at,last_login FROM users WHERE id=$id', { $id: id }) },
  updateLastLogin: { run: (id) => run("UPDATE users SET last_login=strftime('%s','now') WHERE id=$id", { $id: id }) },

  saveRefreshToken: {
    run: ({ userId, token, expiresAt }) =>
      run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($u,$t,$e)', { $u: userId, $t: token, $e: expiresAt }),
  },
  getRefreshToken: { get: (t) => get('SELECT * FROM refresh_tokens WHERE token=$t', { $t: t }) },
  deleteRefreshToken: { run: (t) => run('DELETE FROM refresh_tokens WHERE token=$t', { $t: t }) },
  deleteUserTokens: { run: (u) => run('DELETE FROM refresh_tokens WHERE user_id=$u', { $u: u }) },
  cleanExpiredTokens: { run: () => run("DELETE FROM refresh_tokens WHERE expires_at < strftime('%s','now')") },

  getBalance: { get: (id) => get('SELECT balance FROM users WHERE id=$id', { $id: id }) },
  setBalance: { run: (bal, id) => run('UPDATE users SET balance=$b WHERE id=$id', { $b: bal, $id: id }) },
  adjustBalance: { run: (amt, id) => run('UPDATE users SET balance=balance+$a WHERE id=$id', { $a: amt, $id: id }) },

  getStats: { get: (id) => get('SELECT * FROM player_stats WHERE user_id=$id', { $id: id }) },
  updateStats: {
    run: ({ user_id, wins, losses, pushes, blackjacks, surrenders,
            total_wagered, total_profit, rounds_played, highest_win, highest_bal }) => {
      const cur = get('SELECT highest_win,highest_bal FROM player_stats WHERE user_id=$id', { $id: user_id });
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

  createSession: {
    run: ({ roomId, numDecks, maxPlayers }) =>
      run('INSERT INTO game_sessions (room_id,num_decks,max_players) VALUES ($r,$d,$m)',
        { $r: roomId, $d: numDecks, $m: maxPlayers }),
  },
  getSession: { get: (r) => get('SELECT * FROM game_sessions WHERE room_id=$r', { $r: r }) },
  closeSession: {
    run: (rounds, roomId) =>
      run("UPDATE game_sessions SET status='finished',ended_at=strftime('%s','now'),rounds_done=$r WHERE room_id=$id",
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
        { $u:userId,$a:amount,$b:balanceAfter,$t:type,$d:description??null }),
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

function registerUser({ username, email, passwordHash }) {
  const info = Queries.createUser.run({ username, email, password_hash: passwordHash });
  Queries.createStats.run(info.lastInsertRowid);
  return info.lastInsertRowid;
}

function persistRoundResults(roomId, roundNumber, playerResults, dealerValue) {
  const session = Queries.getSession.get(roomId);
  if (!session) return;
  Queries.incrementRounds.run(roomId);
  for (const pr of playerResults) {
    const { userId, bet, outcome, payout, playerValue, hadBlackjack, balance } = pr;
    Queries.setBalance.run(balance, userId);
    Queries.addTransaction.run({ userId, amount:payout, balanceAfter:balance,
      type: payout >= 0 ? 'win' : 'loss', description:`Round ${roundNumber}: ${outcome}` });
    Queries.saveRoundResult.run({ session_id:session.id, user_id:userId,
      round_number:roundNumber, bet, outcome, payout, player_value:playerValue,
      dealer_value:dealerValue, had_blackjack:hadBlackjack?1:0 });
    Queries.updateStats.run({ user_id:userId,
      wins: outcome==='win'||outcome==='blackjack'?1:0,
      losses: outcome==='lose'||outcome==='bust'?1:0,
      pushes: outcome==='push'?1:0,
      blackjacks: outcome==='blackjack'?1:0,
      surrenders: outcome==='surrender'?1:0,
      total_wagered:bet, total_profit:payout, rounds_played:1,
      highest_win: payout>0?payout:0, highest_bal:balance });
  }
  saveToDisk();
}

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded casino.db from disk');
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new casino.db');
  }
  db.run('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  saveToDisk();
  setInterval(() => { Queries.cleanExpiredTokens.run(); saveToDisk(); }, 3600_000);
  process.on('SIGTERM', saveToDisk);
  process.on('SIGINT',  saveToDisk);
  return db;
}

module.exports = { initDb, Queries, registerUser, persistRoundResults };
