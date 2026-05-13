// ============================================
// FRONTEND AUTHENTICATION & PROFILE CONTROLLER
// Handles: Auth, Profile, Mode Selection
// ============================================

// BackendClient is now provided by backendClient.js
const BackendClient = window.BackendClient;


// ============================================
// SCREEN MANAGEMENT
// ============================================

const ScreenManager = {
  currentScreen: null,

  show(screenId) {
    if (this.currentScreen) {
      document.getElementById(this.currentScreen).classList.remove('active');
    }
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add('active');
      this.currentScreen = screenId;
    }
  },
};

// ============================================
// AUTH SCREEN
// ============================================

function initAuthScreen() {
  const guestNameInput = document.getElementById('guest-name');
  const playBtn = document.getElementById('play-now-btn');
  const errorMsg = document.getElementById('error-msg');

  if (playBtn) {
    playBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const name = guestNameInput.value.trim();
      if (!name || name.length < 2) {
        errorMsg.textContent = 'Please enter a name (at least 2 characters)';
        return;
      }

      errorMsg.textContent = 'Connecting...';
      playBtn.disabled = true;

      try {
        // We use a fixed internal password for guests to simplify the experience
        const guestPassword = 'blackjack_guest_secure_pass_2024';
        
        try {
          // Try to login first (in case they used this name before)
          await BackendClient.Auth.login(name, guestPassword);
        } catch (err) {
          // If login fails, try to register
          await BackendClient.Auth.register(name, guestPassword, '');
        }

        guestNameInput.value = '';
        showProfileScreen(); // Takes them to the lobby/dashboard
      } catch (err) {
        console.error('Auth error:', err);
        errorMsg.textContent = 'Connection failed. Please try a different name.';
        playBtn.disabled = false;
      }
    });
  }
}

// ============================================
// PROFILE SCREEN
// ============================================

async function showProfileScreen() {
  ScreenManager.show('profile-screen');
  await loadProfileData();
}

async function loadProfileData() {
  try {
    const stats = await BackendClient.Player.getStats();
    const user = BackendClient.TokenStore.getUser();

    const usernameEl = document.getElementById('profile-username');
    const balanceEl = document.getElementById('profile-balance');
    const profitEl = document.getElementById('profile-profit');
    const roundsEl = document.getElementById('profile-rounds');
    const winrateEl = document.getElementById('profile-winrate');

    if (usernameEl) usernameEl.textContent = user.username || 'Player';
    if (balanceEl) balanceEl.textContent = `₹${(stats.balance || 0).toLocaleString('en-IN')}`;
    if (profitEl) profitEl.textContent = `₹${((stats.balance || 0) - 10000).toLocaleString('en-IN')}`;
    if (roundsEl) roundsEl.textContent = (stats.rounds_played || 0).toString();
    if (winrateEl) winrateEl.textContent = `${(stats.win_rate || 0).toFixed(1)}%`;
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

function initProfileScreen() {
  const resetBtn = document.getElementById('reset-profile-btn');
  const practiceBtn = document.getElementById('practice-mode-btn');
  const onlineBtn = document.getElementById('online-mode-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (confirm('Reset profile? This will reset your balance to ₹10,000 and clear all stats.')) {
        try {
          await BackendClient.Player.reset();
          await loadProfileData();
          alert('Profile reset successful!');
        } catch (err) {
          alert(err.message);
        }
      }
    });
  }

  if (practiceBtn) {
    practiceBtn.addEventListener('click', () => {
      ScreenManager.show('practice-setup-screen');
    });
  }

  if (onlineBtn) {
    onlineBtn.addEventListener('click', () => {
      ScreenManager.show('online-mode-screen');
      loadAvailableRooms();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await BackendClient.Auth.logout();
      ScreenManager.show('auth-screen');
    });
  }
}

// ============================================
// PRACTICE MODE SCREEN
// ============================================

function initPracticeScreen() {
  const startBtn = document.getElementById('start-practice-btn');
  const backBtn = document.getElementById('back-to-profile-btn');
  const aiCountBtns = document.querySelectorAll('#ai-count-selector .toggle-btn');
  const deckBtns = document.querySelectorAll('#deck-count-selector .toggle-btn');

  let selectedAiCount = 0;
  let selectedDecks = 6;

  // Track AI opponent selection
  aiCountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      aiCountBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedAiCount = parseInt(btn.dataset.count);
    });
  });

  // Track deck selection
  deckBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      deckBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDecks = parseInt(btn.dataset.decks);
    });
  });

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startPracticeGame(selectedAiCount, selectedDecks);
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      ScreenManager.show('profile-screen');
    });
  }
}

async function startPracticeGame(numBots, numDecks) {
  console.log(`Starting practice mode: ${numBots} bots, ${numDecks} decks`);
  ScreenManager.show('game-screen');
}

// ============================================
// ONLINE MODE SCREEN
// ============================================

async function loadAvailableRooms() {
  try {
    const rooms = await BackendClient.Player.getAvailableRooms();
    displayRoomList(rooms);
  } catch (err) {
    console.error('Failed to load rooms:', err);
    const listEl = document.getElementById('available-tables');
    if (listEl) listEl.innerHTML = '<p>Failed to load tables</p>';
  }
}

function displayRoomList(rooms) {
  const listEl = document.getElementById('available-tables');
  if (!listEl) return;

  if (rooms.length === 0) {
    listEl.innerHTML = '<p>No tables available. Create one to get started!</p>';
    return;
  }

  listEl.innerHTML = rooms.map(room => `
    <div class="table-item" data-room-id="${room.id}">
      <div class="table-item-name">${room.tableName}</div>
      <div class="table-item-info">
        <span>${room.playersCount}/${room.maxPlayers} players</span>
        <span>${room.numDecks} decks</span>
      </div>
      <button class="btn btn-small" onclick="joinRoom('${room.id}')">Join</button>
    </div>
  `).join('');
}

function initOnlineScreen() {
  const createBtn = document.getElementById('create-table-btn');
  const backBtn = document.getElementById('back-to-profile-btn2');
  const searchInput = document.getElementById('search-tables');

  if (createBtn) {
    createBtn.addEventListener('click', () => {
      const tableName = prompt('Enter table name:');
      if (tableName) {
        createTable(tableName);
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      ScreenManager.show('profile-screen');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterRooms(e.target.value);
    });
  }
}

async function createTable(tableName) {
  console.log(`Creating table: ${tableName}`);
}

function joinRoom(roomId) {
  console.log(`Joining room: ${roomId}`);
}

function filterRooms(searchTerm) {
  const items = document.querySelectorAll('.table-item');
  items.forEach(item => {
    const name = item.querySelector('.table-item-name').textContent.toLowerCase();
    item.style.display = name.includes(searchTerm.toLowerCase()) ? 'block' : 'none';
  });
}

// ============================================
// LEGACY GAME ENGINE (keeping for now)
// ============================================
(function() {
  let S = {
    phase: 'welcome', shoe: [], shoeSize: 0, numDecks: 6,
    players: [], numPlayers: 2, dealer: { cards: [] },
    currentPlayerIdx: 0, currentHandIdx: 0
  };

  // ===== WELCOME =====
  function init() {
    document.querySelectorAll('#player-count-selector .toggle-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#player-count-selector .toggle-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); S.numPlayers = parseInt(b.dataset.count); renderSetup();
      });
    });
    document.querySelectorAll('#deck-count-selector .toggle-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#deck-count-selector .toggle-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); S.numDecks = parseInt(b.dataset.decks);
      });
    });
    renderSetup();
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    setupEvents();
  }

  function renderSetup() {
    const sec = document.getElementById('player-names-section');
    sec.innerHTML = '';
    for (let i = 0; i < S.numPlayers; i++) {
      const row = document.createElement('div');
      row.className = 'setup-name-row';
      row.innerHTML = `<input class="setup-input" id="pname-${i}" placeholder="Player ${i+1}" value="Player ${i+1}">
        <input class="setup-input setup-input-bet" id="pbet-${i}" type="number" placeholder="Bet" value="100" min="10">`;
      sec.appendChild(row);
    }
  }

  function startGame() {
    S.players = [];
    for (let i = 0; i < S.numPlayers; i++) {
      const name = document.getElementById('pname-'+i)?.value.trim() || 'Player '+(i+1);
      const bet = Math.max(10, parseInt(document.getElementById('pbet-'+i)?.value) || 100);
      S.players.push(Engine.createPlayer(name, i, bet));
    }
    S.shoe = Engine.createShoe(S.numDecks);
    S.shoeSize = S.shoe.length;
    document.getElementById('welcome-screen').classList.remove('active');
    const gs = document.getElementById('game-screen');
    gs.classList.add('active'); gs.style.display = 'flex';
    UI.renderPlayerSpots(S.players);
    UI.updateShoe(S.shoe.length, S.shoeSize);
    UI.renderPlayerTabs(S.players, 0, onTabClick);
    UI.updateBetPanel(S.players[0]);
    startRound();
  }

  function onTabClick(idx) {
    if (S.phase !== 'ready') return;
    UI.updateBetPanel(S.players[idx]);
    document.getElementById('bet-input').value = S.players[idx].defaultBet;
    UI.renderPlayerTabs(S.players, idx, onTabClick);
    S._viewingPlayer = idx;
  }

  // ===== ROUND =====
  function startRound() {
    S.phase = 'ready'; S._viewingPlayer = 0;
    S.players.forEach(p => { p.hands = [Engine.createHand()]; p.currentHandIdx = 0; });
    S.dealer = { cards: [] };
    UI.clearHighlights();
    document.getElementById('dealer-hand').innerHTML = '';
    document.getElementById('dealer-score').classList.add('hidden');
    document.querySelectorAll('.player-result').forEach(e => e.remove());
    S.players.forEach((p,i) => UI.renderPlayerHands(p, i));
    UI.disableAllActions();
    UI.renderPlayerTabs(S.players, 0, onTabClick);
    UI.updateBetPanel(S.players[0]);
    document.getElementById('deal-btn').disabled = false;
    document.getElementById('deal-btn').textContent = 'Bet';
    // Reshuffle check
    const need = (S.players.filter(p => p.balance >= 10).length + 1) * 4 + 20;
    if (S.shoe.length < need) {
      S.shoe = Engine.createShoe(S.numDecks); S.shoeSize = S.shoe.length;
      UI.showMessage('Reshuffling...', 1000);
    }
    UI.updateShoe(S.shoe.length, S.shoeSize);
  }

  function doBetAndDeal() {
    // Read bet from input and apply to viewing player, or auto-bet all
    const betVal = Math.max(10, parseInt(document.getElementById('bet-input').value) || 100);
    // Update all players' defaultBet from their current setting
    if (S._viewingPlayer !== undefined) {
      S.players[S._viewingPlayer].defaultBet = betVal;
    }
    let anyBet = false;
    S.players.forEach((p, i) => {
      if (p.balance < 10) return;
      const bet = Math.min(p.defaultBet, p.balance);
      if (bet < 10) return;
      p.balance -= bet; p.hands[0].bet = bet; anyBet = true;
      UI.renderPlayerHands(p, i);
    });
    if (!anyBet) { UI.showMessage('All players are out!', 3000); return; }
    document.getElementById('deal-btn').disabled = true;
    document.getElementById('deal-btn').textContent = 'Playing...';
    dealCards();
  }

  // ===== DEALING =====
  function dealCards() {
    S.phase = 'dealing';
    let delay = 0; const di = 250;
    for (const p of S.players) {
      if (p.hands[0].bet > 0) {
        setTimeout(() => { p.hands[0].cards.push(S.shoe.pop()); UI.renderPlayerHands(p, p.id); UI.updateShoe(S.shoe.length, S.shoeSize); }, delay);
        delay += di;
      }
    }
    setTimeout(() => { S.dealer.cards.push(S.shoe.pop()); UI.renderDealerHand(S.dealer.cards, true); UI.updateShoe(S.shoe.length, S.shoeSize); }, delay);
    delay += di;
    for (const p of S.players) {
      if (p.hands[0].bet > 0) {
        setTimeout(() => { p.hands[0].cards.push(S.shoe.pop()); UI.renderPlayerHands(p, p.id); }, delay);
        delay += di;
      }
    }
    setTimeout(() => { S.dealer.cards.push(S.shoe.pop()); UI.renderDealerHand(S.dealer.cards, true); }, delay);
    delay += di;
    setTimeout(() => {
      if (Engine.isBlackjack(S.dealer.cards)) {
        UI.renderDealerHand(S.dealer.cards, false);
        UI.showMessage('Dealer Blackjack!', 2000);
        setTimeout(resolveRound, 2500);
      } else { startPlayerTurns(); }
    }, delay + 200);
  }

  // ===== PLAYER TURNS =====
  function startPlayerTurns() {
    S.phase = 'playerTurn'; S.currentPlayerIdx = 0; S.currentHandIdx = 0; advanceToNext();
  }

  function advanceToNext() {
    while (S.currentPlayerIdx < S.players.length) {
      const p = S.players[S.currentPlayerIdx];
      if (p.hands[0].bet > 0) {
        S.currentHandIdx = 0;
        while (S.currentHandIdx < p.hands.length) {
          const h = p.hands[S.currentHandIdx];
          if (!h.stood && !h.busted && !h.surrendered && !Engine.isBlackjack(h.cards)) {
            promptAction(); return;
          }
          S.currentHandIdx++;
        }
      }
      S.currentPlayerIdx++;
    }
    startDealerTurn();
  }

  function promptAction() {
    const p = S.players[S.currentPlayerIdx];
    const h = p.hands[S.currentHandIdx];
    UI.highlightPlayer(S.currentPlayerIdx);
    UI.updateBetPanel(p);
    UI.renderPlayerTabs(S.players, S.currentPlayerIdx, ()=>{});
    UI.enableActions(true, true,
      h.cards.length === 2 && p.balance >= h.bet,
      Engine.canSplit(h) && p.balance >= h.bet,
      h.cards.length === 2 && p.hands.length === 1,
      S.dealer.cards[0].rank === 'A' && h.cards.length === 2 && !h.insured
    );
  }

  function doHit() {
    const p = S.players[S.currentPlayerIdx], h = p.hands[S.currentHandIdx];
    h.cards.push(S.shoe.pop()); UI.updateShoe(S.shoe.length, S.shoeSize); UI.renderPlayerHands(p, p.id);
    const v = Engine.handValue(h.cards);
    if (v > 21) { h.busted = true; UI.showResult(S.currentPlayerIdx, S.currentHandIdx, 'BUST', 'lose'); setTimeout(nextHand, 700); }
    else if (v === 21) { h.stood = true; setTimeout(nextHand, 400); }
    else promptAction();
  }

  function doStand() { S.players[S.currentPlayerIdx].hands[S.currentHandIdx].stood = true; nextHand(); }

  function doDouble() {
    const p = S.players[S.currentPlayerIdx], h = p.hands[S.currentHandIdx];
    p.balance -= h.bet; h.bet *= 2; h.doubled = true;
    h.cards.push(S.shoe.pop()); UI.updateShoe(S.shoe.length, S.shoeSize); UI.renderPlayerHands(p, p.id);
    if (Engine.handValue(h.cards) > 21) { h.busted = true; UI.showResult(S.currentPlayerIdx, S.currentHandIdx, 'BUST', 'lose'); }
    h.stood = true; setTimeout(nextHand, 700);
  }

  function doSplit() {
    const p = S.players[S.currentPlayerIdx], h = p.hands[S.currentHandIdx];
    const nh = Engine.createHand(); nh.bet = h.bet; nh.splitCount = h.splitCount + 1; h.splitCount++;
    p.balance -= h.bet; nh.cards.push(h.cards.pop());
    h.cards.push(S.shoe.pop()); nh.cards.push(S.shoe.pop());
    UI.updateShoe(S.shoe.length, S.shoeSize);
    p.hands.splice(S.currentHandIdx + 1, 0, nh);
    if (h.cards[0].rank === 'A') { h.stood = true; nh.stood = true; }
    UI.renderPlayerHands(p, p.id);
    h.stood ? nextHand() : promptAction();
  }

  function doSurrender() {
    const p = S.players[S.currentPlayerIdx], h = p.hands[S.currentHandIdx];
    h.surrendered = true; p.balance += Math.floor(h.bet / 2);
    UI.renderPlayerHands(p, p.id); UI.showResult(S.currentPlayerIdx, S.currentHandIdx, 'SURRENDER', 'lose');
    setTimeout(nextHand, 700);
  }

  function doInsurance() {
    const p = S.players[S.currentPlayerIdx], h = p.hands[S.currentHandIdx];
    const ins = Math.floor(h.bet / 2); if (p.balance < ins) return;
    p.balance -= ins; h.insured = true; h.insuranceBet = ins;
    UI.renderPlayerHands(p, p.id); promptAction();
  }

  function nextHand() {
    UI.disableAllActions(); S.currentHandIdx++;
    const p = S.players[S.currentPlayerIdx];
    while (S.currentHandIdx < p.hands.length) {
      const h = p.hands[S.currentHandIdx];
      if (!h.stood && !h.busted && !h.surrendered && !Engine.isBlackjack(h.cards)) { promptAction(); return; }
      S.currentHandIdx++;
    }
    S.currentPlayerIdx++; S.currentHandIdx = 0; advanceToNext();
  }

  // ===== DEALER =====
  function startDealerTurn() {
    S.phase = 'dealerTurn'; UI.disableAllActions(); UI.clearHighlights();
    UI.renderDealerHand(S.dealer.cards, false);
    const allDone = S.players.every(p => p.hands[0].bet <= 0 || p.hands.every(h => h.busted || h.surrendered));
    if (allDone) { setTimeout(resolveRound, 800); return; }
    setTimeout(dealerDraw, 600);
  }

  function dealerDraw() {
    const v = Engine.handValue(S.dealer.cards);
    if (v < 17) {
      S.dealer.cards.push(S.shoe.pop()); UI.renderDealerHand(S.dealer.cards, false);
      UI.updateShoe(S.shoe.length, S.shoeSize); setTimeout(dealerDraw, 500);
    } else {
      if (v > 21) UI.showMessage('Dealer Busts!', 1500);
      setTimeout(resolveRound, v > 21 ? 1600 : 600);
    }
  }

  // ===== RESOLVE =====
  function resolveRound() {
    S.phase = 'results';
    const dv = Engine.handValue(S.dealer.cards), dBJ = Engine.isBlackjack(S.dealer.cards), dBust = dv > 21;
    const results = [];
    S.players.forEach((p, pi) => {
      p.hands.forEach((h, hi) => {
        if (h.bet <= 0) return;
        if (h.surrendered) { p.stats.losses++; results.push({name:p.name,handLabel:p.hands.length>1?' H'+(hi+1):'',outcome:'Surrender',payout:-Math.floor(h.bet/2)}); return; }
        if (h.insured && dBJ) p.balance += h.insuranceBet * 3;
        const pv = Engine.handValue(h.cards), pBJ = Engine.isBlackjack(h.cards) && p.hands.length === 1;
        let pay=0,out='',type='';
        if (h.busted){out='Bust';type='lose';pay=-h.bet;p.stats.losses++;}
        else if(pBJ&&dBJ){out='Push';type='push';p.balance+=h.bet;p.stats.pushes++;}
        else if(pBJ){out='Blackjack!';type='blackjack-win';pay=Math.floor(h.bet*1.5);p.balance+=h.bet+pay;p.stats.blackjacks++;p.stats.wins++;}
        else if(dBJ){out='Dealer BJ';type='lose';pay=-h.bet;p.stats.losses++;}
        else if(dBust){out='Win!';type='win';pay=h.bet;p.balance+=h.bet*2;p.stats.wins++;}
        else if(pv>dv){out='Win!';type='win';pay=h.bet;p.balance+=h.bet*2;p.stats.wins++;}
        else if(pv<dv){out='Lose';type='lose';pay=-h.bet;p.stats.losses++;}
        else{out='Push';type='push';p.balance+=h.bet;p.stats.pushes++;}
        p.stats.totalWagered+=h.bet; if(pay>0)p.stats.totalWon+=pay;
        UI.showResult(pi,hi,out,type);
        results.push({name:p.name,handLabel:p.hands.length>1?' H'+(hi+1):'',outcome:out,payout:pay});
      });
      UI.renderPlayerHands(p, pi);
    });
    
    // Update profit history
    S.players.forEach(p => {
      p.profitHistory.push(p.balance - 10000);
    });

    setTimeout(() => UI.showResults(results), 1200);
  }

  // ===== EVENTS =====
  function setupEvents() {
    document.getElementById('deal-btn').addEventListener('click', () => { if (S.phase === 'ready') doBetAndDeal(); });
    document.getElementById('hit-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doHit(); });
    document.getElementById('stand-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doStand(); });
    document.getElementById('double-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doDouble(); });
    document.getElementById('split-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doSplit(); });
    document.getElementById('surrender-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doSurrender(); });
    document.getElementById('insurance-btn').addEventListener('click', () => { if (S.phase === 'playerTurn') doInsurance(); });
    
    document.getElementById('bet-half').addEventListener('click', () => {
      const inp = document.getElementById('bet-input');
      inp.value = Math.max(10, Math.floor(parseInt(inp.value) / 2));
    });
    document.getElementById('bet-double').addEventListener('click', () => {
      const inp = document.getElementById('bet-input');
      inp.value = parseInt(inp.value) * 2;
    });

    document.getElementById('next-round-btn').addEventListener('click', () => {
      UI.hideResults();
      if (S.players.every(p => p.balance < 10)) {
        UI.showMessage('Game Over!', 3000);
        setTimeout(() => { document.getElementById('game-screen').style.display='none'; document.getElementById('welcome-screen').classList.add('active'); }, 3500);
        return;
      }
      startRound();
    });

    document.getElementById('rules-btn').addEventListener('click', () => document.getElementById('rules-modal').classList.remove('hidden'));
    document.getElementById('close-rules').addEventListener('click', () => document.getElementById('rules-modal').classList.add('hidden'));
    document.getElementById('stats-btn').addEventListener('click', () => UI.showStats(S.players));
    document.getElementById('close-stats').addEventListener('click', () => document.getElementById('stats-modal').classList.add('hidden'));

    // Live Stats Events
    document.getElementById('graph-btn').addEventListener('click', () => {
      console.log('Graph button clicked');
      if (!S.players || S.players.length === 0) {
        console.warn('No players found');
        return;
      }
      const idx = S._viewingPlayer || 0;
      console.log('Viewing player index:', idx);
      const sel = document.getElementById('livestats-player-select');
      sel.innerHTML = S.players.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
      sel.value = idx;
      UI.updateLiveStatsPanel(S.players[idx]);
      document.getElementById('livestats-modal').classList.remove('hidden');
    });

    document.getElementById('close-livestats').addEventListener('click', () => document.getElementById('livestats-modal').classList.add('hidden'));
    
    document.getElementById('livestats-player-select').addEventListener('change', (e) => {
      UI.updateLiveStatsPanel(S.players[parseInt(e.target.value)]);
    });

    document.getElementById('livestats-refresh').addEventListener('click', () => {
      const idx = parseInt(document.getElementById('livestats-player-select').value);
      UI.updateLiveStatsPanel(S.players[idx]);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Initialize auth and profile screens first
    if (BackendClient.TokenStore.isLoggedIn()) {
      showProfileScreen();
    } else {
      initAuthScreen();
      ScreenManager.show('auth-screen');
    }
    initProfileScreen();
    initPracticeScreen();
    initOnlineScreen();

    // Initialize legacy game engine
    init();
  });
})();
