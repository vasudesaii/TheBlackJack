// ===== ROYAL BLACKJACK — BACKEND CLIENT =====
// Drop this file into your games_casino/ folder.
// Add to index.html:  <script src="https://cdn.socket.io/4.6.1/socket.io.min.js"></script>
//                     <script src="backendClient.js"></script>

(function () {
  'use strict';

  const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3001'
    : window.location.origin;
  const STORAGE_KEY_ACCESS  = 'rbjack_access';
  const STORAGE_KEY_REFRESH = 'rbjack_refresh';
  const STORAGE_KEY_USER    = 'rbjack_user';

  // ──────────────── TOKEN STORE ────────────────
  const TokenStore = {
    save(access, refresh, user) {
      localStorage.setItem(STORAGE_KEY_ACCESS,  access);
      localStorage.setItem(STORAGE_KEY_REFRESH, refresh);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    },
    getAccess()  { return localStorage.getItem(STORAGE_KEY_ACCESS); },
    getRefresh() { return localStorage.getItem(STORAGE_KEY_REFRESH); },
    getUser()    {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY_USER)); } catch { return null; }
    },
    clear() {
      localStorage.removeItem(STORAGE_KEY_ACCESS);
      localStorage.removeItem(STORAGE_KEY_REFRESH);
      localStorage.removeItem(STORAGE_KEY_USER);
    },
  };

  // ──────────────── HTTP HELPERS ────────────────
  async function apiFetch(path, options = {}) {
    const token = TokenStore.getAccess();
    const res = await fetch(BACKEND_URL + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    // Auto-refresh if 401
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return apiFetch(path, options); // retry
      } else {
        TokenStore.clear();
        window.dispatchEvent(new Event('auth:expired'));
        throw new Error('Session expired');
      }
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function refreshAccessToken() {
    const refreshToken = TokenStore.getRefresh();
    if (!refreshToken) return false;
    try {
      const data = await fetch(BACKEND_URL + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).then(r => r.json());

      if (data.accessToken) {
        TokenStore.save(data.accessToken, data.refreshToken, data.user);
        if (window.BackendClient?.socket) {
          window.BackendClient.socket.auth.token = data.accessToken;
          window.BackendClient.socket.disconnect().connect();
        }
        return true;
      }
    } catch {}
    return false;
  }

  // ──────────────── AUTH API ────────────────
  const Auth = {
    async register(username, password, email = '') {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, email }),
      });
      TokenStore.save(data.accessToken, data.refreshToken, data.user);
      return data.user;
    },

    async login(username, password) {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      TokenStore.save(data.accessToken, data.refreshToken, data.user);
      return data.user;
    },

    async logout() {
      try {
        await apiFetch('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: TokenStore.getRefresh() }),
        });
      } catch {}
      TokenStore.clear();
    },

    async me() {
      return (await apiFetch('/api/auth/me')).user;
    },

    isLoggedIn() { return !!TokenStore.getAccess(); },
    getUser()    { return TokenStore.getUser(); },
  };

  // ──────────────── PLAYER API ────────────────
  const Player = {
    async getBalance()    { return (await apiFetch('/api/player/balance')).balance; },
    async getStats()      { return (await apiFetch('/api/player/stats')).stats; },
    async getHistory(limit = 50) { return (await apiFetch(`/api/player/history?limit=${limit}`)).history; },
    async getLeaderboard(sort = 'profit', limit = 10) {
      return (await apiFetch(`/api/player/leaderboard?sort=${sort}&limit=${limit}`)).leaderboard;
    },
    async topup(amount = 10000) {
      return apiFetch('/api/player/topup', { method: 'POST', body: JSON.stringify({ amount }) });
    },
  };

  // ──────────────── SOCKET ────────────────
  let socket = null;
  const handlers = {};

  function on(event, fn) {
    handlers[event] = fn;
    if (socket) socket.on(event, fn);
  }

  function connectSocket() {
    const token = TokenStore.getAccess();
    if (!token) throw new Error('Not logged in');

    socket = io(BACKEND_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      console.log('🟢 Socket connected:', socket.id);
      window.dispatchEvent(new CustomEvent('socket:connected'));
    });
    socket.on('disconnect', (reason) => {
      console.log('🔴 Socket disconnected:', reason);
      window.dispatchEvent(new CustomEvent('socket:disconnected', { detail: reason }));
    });
    socket.on('connect_error', (err) => {
      console.error('Socket error:', err.message);
    });

    // Register all buffered handlers
    for (const [event, fn] of Object.entries(handlers)) {
      socket.on(event, fn);
    }

    return socket;
  }

  // ──────────────── ROOM ACTIONS ────────────────
  const Room = {
    create(numDecks = 6, maxPlayers = 5) {
      return new Promise((res, rej) => {
        socket.emit('room:create', { numDecks, maxPlayers }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    join(roomId) {
      return new Promise((res, rej) => {
        socket.emit('room:join', { roomId }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    leave() {
      return new Promise((res) => {
        socket.emit('room:leave', {}, (resp) => res(resp));
      });
    },
    list() {
      return new Promise((res, rej) => {
        socket.emit('room:list', {}, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp.rooms);
        });
      });
    },
  };

  // ──────────────── GAME ACTIONS ────────────────
  const Game = {
    bet(amount) {
      return new Promise((res, rej) => {
        socket.emit('game:bet', { amount }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    hit(handIdx = 0) {
      return new Promise((res, rej) => {
        socket.emit('game:action', { action: 'hit', handIdx }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    stand(handIdx = 0) {
      return new Promise((res, rej) => {
        socket.emit('game:action', { action: 'stand', handIdx }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    double(handIdx = 0) {
      return new Promise((res, rej) => {
        socket.emit('game:action', { action: 'double', handIdx }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    split(handIdx = 0) {
      return new Promise((res, rej) => {
        socket.emit('game:action', { action: 'split', handIdx }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    surrender(handIdx = 0) {
      return new Promise((res, rej) => {
        socket.emit('game:action', { action: 'surrender', handIdx }, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
    insurance() {
      return new Promise((res, rej) => {
        socket.emit('game:insurance', {}, (resp) => {
          resp?.error ? rej(new Error(resp.error)) : res(resp);
        });
      });
    },
  };

  // ──────────────── CHAT ────────────────
  const Chat = {
    send(message) {
      socket?.emit('chat:message', { message });
    },
    onMessage(fn) {
      on('chat:message', fn);
    },
  };

  // ──────────────── PUBLIC API ────────────────
  window.BackendClient = {
    Auth,
    Player,
    Room,
    Game,
    Chat,
    on,
    connectSocket,
    get socket() { return socket; },
    TokenStore,
    isLoggedIn: Auth.isLoggedIn,

    // Quick init helper
    async init() {
      if (!Auth.isLoggedIn()) return null;
      try {
        const user = await Auth.me();
        connectSocket();
        return user;
      } catch {
        TokenStore.clear();
        return null;
      }
    },
  };

  console.log('🃏 BackendClient loaded. Use window.BackendClient to interact.');
})();
