// ===== UI RENDERER (Stake-style) =====
window.UI = {
  renderCard(card, faceDown = false, animDelay = 0) {
    const slot = document.createElement('div');
    slot.className = 'card-slot card-deal';
    slot.style.animationDelay = animDelay + 's';
    const inner = document.createElement('div');
    inner.className = 'card-inner' + (faceDown ? ' flipped' : '');
    const front = document.createElement('div');
    front.className = 'card-face card-front ' + card.color;
    front.innerHTML = `<span class="card-rank-top">${card.rank}${card.suit}</span>
      <span class="card-suit-center">${card.suit}</span>
      <span class="card-rank-bottom">${card.rank}${card.suit}</span>`;
    const back = document.createElement('div');
    back.className = 'card-face card-back';
    back.innerHTML = '<div class="card-back-pattern">♠</div>';
    inner.appendChild(front);
    inner.appendChild(back);
    slot.appendChild(inner);
    return slot;
  },

  renderHand(container, cards, faceDownIdx = -1) {
    container.innerHTML = '';
    cards.forEach((card, i) => {
      container.appendChild(this.renderCard(card, i === faceDownIdx, i * 0.12));
    });
  },

  renderDealerHand(cards, hideHole = true) {
    const el = document.getElementById('dealer-hand');
    this.renderHand(el, cards, hideHole && cards.length >= 2 ? 1 : -1);
    const s = document.getElementById('dealer-score');
    if (hideHole && cards.length >= 2) {
      s.textContent = Engine.cardValue(cards[0]);
      s.className = 'score-pill';
    } else {
      const val = Engine.handValue(cards);
      s.textContent = val;
      s.className = 'score-pill' + (val > 21 ? ' bust' : '') + (Engine.isBlackjack(cards) ? ' blackjack' : '');
    }
    s.classList.remove('hidden');
  },

  renderPlayerSpots(players) {
    const zone = document.getElementById('players-zone');
    zone.innerHTML = '';
    players.forEach((p, i) => {
      const spot = document.createElement('div');
      spot.className = 'player-spot';
      spot.id = 'player-spot-' + i;
      spot.innerHTML = `
        <div class="player-name">${p.name}</div>
        <div class="player-balance-label" id="balance-${i}">₹${p.balance.toLocaleString('en-IN')}</div>
        <div id="hands-container-${i}"></div>`;
      zone.appendChild(spot);
    });
  },

  renderPlayerTabs(players, activeIdx, onTabClick) {
    const tabs = document.getElementById('player-tabs');
    tabs.innerHTML = '';
    players.forEach((p, i) => {
      const tab = document.createElement('button');
      tab.className = 'player-tab' + (i === activeIdx ? ' active' : '');
      tab.innerHTML = `${p.name}<span class="tab-balance">₹${p.balance.toLocaleString('en-IN')}</span>`;
      tab.addEventListener('click', () => onTabClick(i));
      tabs.appendChild(tab);
    });
  },

  renderPlayerHands(player, playerIdx) {
    const container = document.getElementById('hands-container-' + playerIdx);
    if (!container) return;
    container.innerHTML = '';
    player.hands.forEach((hand, hIdx) => {
      const hw = document.createElement('div');
      hw.className = 'hand-wrapper';
      hw.id = `hand-${playerIdx}-${hIdx}`;
      if (player.hands.length > 1) {
        const label = document.createElement('div');
        label.className = 'split-indicator';
        label.textContent = 'Hand ' + (hIdx + 1);
        hw.appendChild(label);
      }
      const handEl = document.createElement('div');
      handEl.className = 'player-hand';
      this.renderHand(handEl, hand.cards);
      hw.appendChild(handEl);
      if (hand.cards.length > 0) {
        const val = Engine.handValue(hand.cards);
        const sd = document.createElement('div');
        sd.className = 'player-score-label';
        sd.textContent = val + (Engine.isSoft(hand.cards) ? ' (soft)' : '') + (val > 21 ? ' BUST' : '') + (Engine.isBlackjack(hand.cards) ? ' BJ!' : '');
        hw.appendChild(sd);
      }
      if (hand.bet > 0) {
        const bd = document.createElement('div');
        bd.className = 'player-bet-label';
        bd.textContent = '₹' + hand.bet;
        hw.appendChild(bd);
      }
      container.appendChild(hw);
    });
    const bal = document.getElementById('balance-' + playerIdx);
    if (bal) bal.textContent = '₹' + player.balance.toLocaleString('en-IN');
  },

  highlightPlayer(playerIdx) {
    document.querySelectorAll('.player-spot').forEach(s => s.classList.remove('active-turn'));
    const spot = document.getElementById('player-spot-' + playerIdx);
    if (spot) spot.classList.add('active-turn');
  },

  clearHighlights() {
    document.querySelectorAll('.player-spot').forEach(s => s.classList.remove('active-turn', 'spot-done'));
  },

  showResult(playerIdx, handIdx, text, type) {
    const hw = document.getElementById(`hand-${playerIdx}-${handIdx}`);
    if (!hw) return;
    const old = hw.querySelector('.player-result');
    if (old) old.remove();
    const div = document.createElement('div');
    div.className = 'player-result ' + type;
    div.textContent = text;
    hw.style.position = 'relative';
    hw.appendChild(div);
  },

  showMessage(text, duration = 2000) {
    const el = document.getElementById('game-message');
    el.textContent = text;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), duration);
  },

  updateShoe(remaining, total) {
    document.getElementById('cards-remaining').textContent = remaining;
    document.getElementById('shoe-progress').style.width = (remaining / total * 100) + '%';
  },

  enableActions(canHit, canStand, canDbl, canSplt, canSurr, canIns) {
    document.getElementById('hit-btn').disabled = !canHit;
    document.getElementById('stand-btn').disabled = !canStand;
    document.getElementById('double-btn').disabled = !canDbl;
    document.getElementById('split-btn').disabled = !canSplt;
    document.getElementById('surrender-btn').disabled = !canSurr;
    document.getElementById('insurance-btn').disabled = !canIns;
  },

  disableAllActions() {
    ['hit-btn','stand-btn','double-btn','split-btn','surrender-btn','insurance-btn'].forEach(id => {
      document.getElementById(id).disabled = true;
    });
  },

  updateBetPanel(player) {
    document.getElementById('active-player-balance').textContent = '₹' + player.balance.toLocaleString('en-IN');
    document.getElementById('bet-input').value = player.defaultBet;
  },

  showResults(results) {
    const list = document.getElementById('results-list');
    list.innerHTML = '';
    results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const cls = r.payout > 0 ? 'win' : r.payout < 0 ? 'lose' : 'push';
      row.innerHTML = `<span class="result-name">${r.name}${r.handLabel || ''}</span>
        <span class="result-outcome ${cls}">${r.outcome}</span>
        <span class="result-payout">${r.payout >= 0 ? '+' : ''}₹${r.payout.toLocaleString('en-IN')}</span>`;
      list.appendChild(row);
    });
    document.getElementById('results-overlay').classList.remove('hidden');
  },

  hideResults() { document.getElementById('results-overlay').classList.add('hidden'); },

  showStats(players) {
    const c = document.getElementById('stats-content');
    let h = '<table><tr><th>Player</th><th>W</th><th>L</th><th>P</th><th>BJ</th><th>Balance</th></tr>';
    players.forEach(p => {
      h += `<tr><td>${p.name}</td><td>${p.stats.wins}</td><td>${p.stats.losses}</td>
        <td>${p.stats.pushes}</td><td>${p.stats.blackjacks}</td>
        <td>₹${p.balance.toLocaleString('en-IN')}</td></tr>`;
    });
    c.innerHTML = h + '</table>';
    document.getElementById('stats-modal').classList.remove('hidden');
  },

  updateLiveStatsPanel(player) {
    const profit = player.balance - 10000;
    const profitEl = document.getElementById('ls-profit');
    profitEl.textContent = (profit >= 0 ? '+' : '') + '₹' + profit.toLocaleString('en-IN');
    profitEl.className = 'ls-value ' + (profit >= 0 ? 'ls-green' : 'ls-red');
    
    document.getElementById('ls-wins').textContent = player.stats.wins;
    document.getElementById('ls-losses').textContent = player.stats.losses;
    document.getElementById('ls-wagered').textContent = '₹' + player.stats.totalWagered.toLocaleString('en-IN');
    
    this.renderProfitGraph(player.profitHistory);
  },

  renderProfitGraph(history) {
    const canvas = document.getElementById('profit-graph');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    if (history.length < 2) {
      ctx.strokeStyle = '#2f4553';
      ctx.beginPath();
      ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
      ctx.stroke();
      return;
    }

    const min = Math.min(0, ...history);
    const max = Math.max(0, ...history);
    const range = (max - min) || 1000;
    const pad = 20;

    const getY = (val) => h - pad - ((val - min) / range) * (h - 2 * pad);
    const getX = (idx) => (idx / (history.length - 1)) * w;

    const zeroY = getY(0);

    // Draw grid/zero line
    ctx.strokeStyle = 'rgba(47, 69, 83, 0.5)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Draw Area
    ctx.beginPath();
    ctx.moveTo(getX(0), zeroY);
    for (let i = 0; i < history.length; i++) {
      ctx.lineTo(getX(i), getY(history[i]));
    }
    ctx.lineTo(getX(history.length - 1), zeroY);
    ctx.closePath();
    
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 231, 1, 0.2)');
    grad.addColorStop(1, 'rgba(229, 57, 53, 0.2)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw Path
    ctx.lineWidth = 3;
    for (let i = 0; i < history.length - 1; i++) {
      const x1 = getX(i);
      const y1 = getY(history[i]);
      const x2 = getX(i+1);
      const y2 = getY(history[i+1]);
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = history[i+1] >= 0 ? '#00e701' : '#e53935';
      ctx.stroke();
    }
  }
};
