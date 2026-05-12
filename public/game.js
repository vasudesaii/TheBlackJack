// ===== GAME CONTROLLER (Stake-style) =====
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

  document.addEventListener('DOMContentLoaded', init);
})();
