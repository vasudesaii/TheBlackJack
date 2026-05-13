// ===== ROOM MANAGER =====
// Manages all live game rooms in memory.
// Each room is a state machine with phases: waiting → betting → dealing → playerTurn → dealerTurn → results → betting ...

const { v4: uuidv4 } = require('uuid');
const {
  createShoe, handValue, isSoft, isBlackjack, isBust,
  canSplit, canDouble, canSurrender, dealerPlay, resolveHand,
} = require('./engine');
const { Queries, persistRoundResults } = require('../db');

// ──────────────── CONSTANTS ────────────────
const PHASE = {
  WAITING:     'waiting',
  BETTING:     'betting',
  DEALING:     'dealing',
  PLAYER_TURN: 'playerTurn',
  DEALER_TURN: 'dealerTurn',
  RESULTS:     'results',
};

const BETTING_TIMEOUT_MS  = 30_000; // 30s to place bets
const ACTION_TIMEOUT_MS   = 20_000; // 20s per player action
const RESULTS_DISPLAY_MS  = 8_000;  // 8s to show results before next round

const MIN_BET = 10;
const MAX_BET = 50_000;
const RESHUFFLE_THRESHOLD = 0.25; // reshuffle when 25% cards remain

// ──────────────── DATA SHAPE ────────────────
//
// Room {
//   id, phase, numDecks, maxPlayers, shoe[],
//   roundNumber,
//   players: Map<socketId, Player>,
//   dealer: { cards[], holeCard(hidden) },
//   currentPlayerIdx, currentHandIdx,
//   betTimer, actionTimer, resultsTimer,
//   sessionId (db row id)
// }
//
// Player {
//   socketId, userId, username, balance,
//   ready, bet,
//   hands: [ Hand ],
//   currentHandIdx,
//   insurance, insuranceBet,
//   result: [{ outcome, payout }]
// }
//
// Hand {
//   cards[], bet, doubled, surrendered, stood, fromSplit, splitCount
// }

const rooms = new Map(); // roomId → Room

// ──────────────── HELPERS ────────────────

function makeHand(bet, fromSplit = false, splitCount = 0) {
  return { cards: [], bet, doubled: false, surrendered: false, stood: false, fromSplit, splitCount };
}

function dealCard(shoe) {
  const card = shoe.pop();
  if (!card) throw new Error('Shoe exhausted');
  return card;
}

function needsReshuffle(shoe, numDecks) {
  const total = numDecks * 52;
  return shoe.length / total < RESHUFFLE_THRESHOLD;
}

function sanitizeRoom(room) {
  // Return a serializable snapshot for clients — hides hole card
  const players = [];
  for (const [sid, p] of room.players) {
    players.push({
      socketId: sid,
      userId: p.userId,
      username: p.username,
      balance: p.balance,
      ready: p.ready,
      bet: p.bet,
      hands: p.hands,
      currentHandIdx: p.currentHandIdx,
      insurance: p.insurance,
    });
  }

  // During player/dealer turn, hide dealer's hole card
  let dealerCards = room.dealer.cards;
  if (room.phase === PHASE.PLAYER_TURN || room.phase === PHASE.DEALING) {
    dealerCards = room.dealer.cards.map((c, i) => i === 1 ? { rank: '?', suit: '?', hidden: true } : c);
  }

  return {
    id: room.id,
    phase: room.phase,
    numDecks: room.numDecks,
    cardsRemaining: room.shoe.length,
    roundNumber: room.roundNumber,
    players,
    dealer: { cards: dealerCards },
    currentPlayerIdx: room.currentPlayerIdx,
    currentHandIdx: room.currentHandIdx,
  };
}

// ──────────────── ROOM LIFECYCLE ────────────────

function createRoom({ numDecks = 6, maxPlayers = 5, tableName = '' } = {}) {
  const id = uuidv4().slice(0, 8).toUpperCase();
  const dbSession = Queries.createSession.run({ roomId: id, numDecks, maxPlayers });

  const room = {
    id,
    phase: PHASE.WAITING,
    numDecks,
    maxPlayers,
    tableName: tableName || `Table ${id}`,
    shoe: createShoe(numDecks),
    roundNumber: 0,
    players: new Map(),
    dealer: { cards: [] },
    currentPlayerIdx: 0,
    currentHandIdx: 0,
    betTimer: null,
    actionTimer: null,
    resultsTimer: null,
    sessionDbId: dbSession.lastInsertRowid,
    io: null,
  };

  rooms.set(id, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function joinRoom(room, socket, { userId, username, balance }) {
  if (room.players.size >= room.maxPlayers) return { error: 'Room is full' };
  if (room.phase !== PHASE.WAITING && room.phase !== PHASE.BETTING) {
    return { error: 'Round in progress — join after this round' };
  }

  room.players.set(socket.id, {
    socketId: socket.id,
    userId,
    username,
    balance,
    ready: false,
    bet: 0,
    hands: [],
    currentHandIdx: 0,
    insurance: false,
    insuranceBet: 0,
  });

  // If first player, move to betting phase
  if (room.players.size === 1 && room.phase === PHASE.WAITING) {
    startBettingPhase(room);
  }

  return { ok: true };
}

function leaveRoom(room, socketId) {
  room.players.delete(socketId);
  if (room.players.size === 0) {
    clearTimers(room);
    Queries.closeSession.run(room.roundNumber, room.id);
    rooms.delete(room.id);
  }
}

function clearTimers(room) {
  clearTimeout(room.betTimer);
  clearTimeout(room.actionTimer);
  clearTimeout(room.resultsTimer);
}

// ──────────────── PHASE TRANSITIONS ────────────────

function startBettingPhase(room) {
  room.phase = PHASE.BETTING;
  // Reset readiness & bets
  for (const p of room.players.values()) {
    p.ready = false;
    p.bet = 0;
    p.hands = [];
    p.insurance = false;
    p.insuranceBet = 0;
  }
  emit(room, 'phase:betting', { timeout: BETTING_TIMEOUT_MS / 1000 });

  // Auto-advance when timeout expires: force-stand players who haven't bet
  room.betTimer = setTimeout(() => {
    // Remove players who didn't bet
    for (const [sid, p] of room.players) {
      if (!p.bet || p.bet < MIN_BET) room.players.delete(sid);
    }
    if (room.players.size === 0) return;
    startDealingPhase(room);
  }, BETTING_TIMEOUT_MS);
}

function placeBet(room, socketId, amount) {
  if (room.phase !== PHASE.BETTING) return { error: 'Not in betting phase' };
  const player = room.players.get(socketId);
  if (!player) return { error: 'Not in room' };
  if (amount < MIN_BET || amount > MAX_BET) return { error: `Bet must be ₹${MIN_BET}–₹${MAX_BET}` };
  if (amount > player.balance) return { error: 'Insufficient balance' };

  player.bet = amount;
  player.ready = true;

  emit(room, 'player:bet', { username: player.username, bet: amount });

  // Auto-deal if all players have bet
  const allReady = [...room.players.values()].every(p => p.ready);
  if (allReady) {
    clearTimeout(room.betTimer);
    startDealingPhase(room);
  }

  return { ok: true, bet: amount };
}

function startDealingPhase(room) {
  room.phase = PHASE.DEALING;
  room.roundNumber++;

  if (needsReshuffle(room.shoe, room.numDecks)) {
    room.shoe = createShoe(room.numDecks);
    emit(room, 'shoe:reshuffled', {});
  }

  // Deduct bets from balances
  for (const p of room.players.values()) {
    p.balance -= p.bet;
    Queries.setBalance.run(p.balance, p.userId);
    // Init one hand per player
    p.hands = [makeHand(p.bet)];
    p.currentHandIdx = 0;
  }

  // Deal: 2 cards each, round-robin style
  const playerArr = [...room.players.values()];
  const dealOrder = []; // [playerIdx, cardIdx]
  for (let round = 0; round < 2; round++) {
    for (let pi = 0; pi < playerArr.length; pi++) {
      dealOrder.push([pi, round]);
    }
    dealOrder.push(['dealer', round]);
  }

  room.dealer.cards = [];

  for (const [who, slot] of dealOrder) {
    const card = dealCard(room.shoe);
    if (who === 'dealer') {
      room.dealer.cards.push(card);
    } else {
      playerArr[who].hands[0].cards.push(card);
    }
  }

  emit(room, 'phase:dealing', sanitizeRoom(room));

  // Check for dealer blackjack
  const dealerBJ = isBlackjack(room.dealer.cards);

  if (dealerBJ) {
    // Offer insurance settlement, then resolve immediately
    emit(room, 'dealer:blackjack', { dealerCards: room.dealer.cards });
    setTimeout(() => startResultsPhase(room, true), 2000);
    return;
  }

  // Check for any player blackjacks
  const bjPlayers = playerArr.filter(p => isBlackjack(p.hands[0].cards));
  if (bjPlayers.length) {
    emit(room, 'player:blackjacks', { players: bjPlayers.map(p => p.username) });
  }

  setTimeout(() => startPlayerTurns(room), 1500);
}

function startPlayerTurns(room) {
  room.phase = PHASE.PLAYER_TURN;
  room.currentPlayerIdx = 0;
  room.currentHandIdx = 0;
  advanceToNextPlayer(room);
}

function advanceToNextPlayer(room) {
  const playerArr = [...room.players.values()];

  // Find next player/hand that still needs action
  while (room.currentPlayerIdx < playerArr.length) {
    const player = playerArr[room.currentPlayerIdx];
    const hand = player.hands[room.currentHandIdx];

    if (!hand) {
      room.currentPlayerIdx++;
      room.currentHandIdx = 0;
      continue;
    }

    const val = handValue(hand.cards);
    // Skip if bust, surrendered, stood, or blackjack
    if (hand.surrendered || hand.stood || val >= 21 || isBlackjack(hand.cards)) {
      room.currentHandIdx++;
      if (room.currentHandIdx >= player.hands.length) {
        room.currentPlayerIdx++;
        room.currentHandIdx = 0;
      }
      continue;
    }

    // This player/hand needs action
    const available = getAvailableActions(player, hand);
    emit(room, 'turn:player', {
      socketId: player.socketId,
      username: player.username,
      handIdx: room.currentHandIdx,
      handValue: val,
      availableActions: available,
      timeout: ACTION_TIMEOUT_MS / 1000,
    });

    // Auto-stand on timeout
    clearTimeout(room.actionTimer);
    room.actionTimer = setTimeout(() => {
      hand.stood = true;
      advanceToNextPlayer(room);
    }, ACTION_TIMEOUT_MS);
    return;
  }

  // All players done
  clearTimeout(room.actionTimer);
  startDealerTurnPhase(room);
}

function getAvailableActions(player, hand) {
  const actions = ['hit', 'stand'];
  if (canDouble(hand) && player.balance >= hand.bet) actions.push('double');
  if (canSplit(hand) && player.balance >= hand.bet && player.hands.length < 4) actions.push('split');
  if (canSurrender(hand)) actions.push('surrender');
  return actions;
}

// ──────────────── PLAYER ACTIONS ────────────────

function playerAction(room, socketId, action, handIdx) {
  if (room.phase !== PHASE.PLAYER_TURN) return { error: 'Not player turn phase' };

  const playerArr = [...room.players.values()];
  const player = room.players.get(socketId);
  if (!player) return { error: 'Not in room' };

  const currentPlayer = playerArr[room.currentPlayerIdx];
  if (currentPlayer.socketId !== socketId) return { error: 'Not your turn' };

  const hIdx = handIdx ?? room.currentHandIdx;
  if (hIdx !== room.currentHandIdx) return { error: 'Wrong hand index' };

  const hand = player.hands[hIdx];
  if (!hand) return { error: 'Hand not found' };

  clearTimeout(room.actionTimer);

  switch (action) {
    case 'hit':      doHit(room, player, hand);        break;
    case 'stand':    doStand(room, player, hand);      break;
    case 'double':   doDouble(room, player, hand);     break;
    case 'split':    doSplit(room, player, hand, hIdx); break;
    case 'surrender': doSurrender(room, player, hand); break;
    default: return { error: 'Unknown action' };
  }

  emit(room, 'player:action', {
    username: player.username,
    action,
    hand: player.hands[hIdx],
    handIdx: hIdx,
    handValue: handValue(player.hands[hIdx]?.cards || []),
  });

  return { ok: true };
}

function doHit(room, player, hand) {
  hand.cards.push(dealCard(room.shoe));
  const val = handValue(hand.cards);
  if (val >= 21) {
    hand.stood = true;
    advanceToNextPlayer(room);
  } else {
    // Re-prompt same player
    const available = getAvailableActions(player, hand);
    emit(room, 'turn:player', {
      socketId: player.socketId,
      username: player.username,
      handIdx: room.currentHandIdx,
      handValue: val,
      availableActions: available,
      timeout: ACTION_TIMEOUT_MS / 1000,
    });
    room.actionTimer = setTimeout(() => {
      hand.stood = true;
      advanceToNextPlayer(room);
    }, ACTION_TIMEOUT_MS);
  }
}

function doStand(room, player, hand) {
  hand.stood = true;
  room.currentHandIdx++;
  if (room.currentHandIdx >= player.hands.length) {
    room.currentPlayerIdx++;
    room.currentHandIdx = 0;
  }
  advanceToNextPlayer(room);
}

function doDouble(room, player, hand) {
  if (player.balance < hand.bet) {
    emit(room, 'error', { socketId: player.socketId, message: 'Insufficient balance to double' });
    return;
  }
  player.balance -= hand.bet;
  Queries.setBalance.run(player.balance, player.userId);
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(dealCard(room.shoe));
  hand.stood = true;
  room.currentHandIdx++;
  if (room.currentHandIdx >= player.hands.length) {
    room.currentPlayerIdx++;
    room.currentHandIdx = 0;
  }
  advanceToNextPlayer(room);
}

function doSplit(room, player, hand, hIdx) {
  if (player.balance < hand.bet) {
    emit(room, 'error', { socketId: player.socketId, message: 'Insufficient balance to split' });
    return;
  }
  player.balance -= hand.bet;
  Queries.setBalance.run(player.balance, player.userId);

  const splitCount = (hand.splitCount || 0) + 1;
  const card2 = hand.cards.pop(); // take second card out

  // Give each hand a new card
  hand.splitCount = splitCount;
  hand.fromSplit = true;
  hand.cards.push(dealCard(room.shoe));

  const newHand = makeHand(hand.bet, true, splitCount);
  newHand.cards = [card2, dealCard(room.shoe)];

  // Insert new hand right after current
  player.hands.splice(hIdx + 1, 0, newHand);

  // Aces get only one card each after split — auto-stand
  if (hand.cards[0].rank === 'A') {
    hand.stood = true;
    newHand.stood = true;
    room.currentHandIdx++;
    if (room.currentHandIdx >= player.hands.length) {
      room.currentPlayerIdx++;
      room.currentHandIdx = 0;
    }
    advanceToNextPlayer(room);
  } else {
    // Re-prompt same hand
    const available = getAvailableActions(player, hand);
    emit(room, 'turn:player', {
      socketId: player.socketId,
      username: player.username,
      handIdx: room.currentHandIdx,
      handValue: handValue(hand.cards),
      availableActions: available,
      timeout: ACTION_TIMEOUT_MS / 1000,
    });
    room.actionTimer = setTimeout(() => {
      hand.stood = true;
      advanceToNextPlayer(room);
    }, ACTION_TIMEOUT_MS);
  }
}

function doSurrender(room, player, hand) {
  hand.surrendered = true;
  // Refund half the bet immediately
  const refund = Math.floor(hand.bet / 2);
  player.balance += refund;
  Queries.setBalance.run(player.balance, player.userId);
  hand.stood = true;
  room.currentHandIdx++;
  if (room.currentHandIdx >= player.hands.length) {
    room.currentPlayerIdx++;
    room.currentHandIdx = 0;
  }
  advanceToNextPlayer(room);
}

// ──────────────── DEALER TURN ────────────────

function startDealerTurnPhase(room) {
  room.phase = PHASE.DEALER_TURN;

  // Reveal hole card
  emit(room, 'dealer:reveal', { dealerCards: room.dealer.cards });

  const allBust = [...room.players.values()].every(p =>
    p.hands.every(h => h.surrendered || isBust(h.cards))
  );

  let drawn = [];
  if (!allBust) {
    const result = dealerPlay(room.dealer.cards, room.shoe);
    room.dealer.cards = result.dealerCards;
    drawn = result.drawn;
  }

  emit(room, 'dealer:play', { dealerCards: room.dealer.cards, drawnCards: drawn });

  setTimeout(() => startResultsPhase(room, false), 1500);
}

// ──────────────── RESULTS ────────────────

function startResultsPhase(room, dealerBJ) {
  room.phase = PHASE.RESULTS;
  const dealerVal = handValue(room.dealer.cards);
  const results = [];
  const dbResults = [];

  for (const player of room.players.values()) {
    const playerResults = [];
    let totalPayout = 0;

    for (const hand of player.hands) {
      const { outcome, payout } = resolveHand(hand, room.dealer.cards, dealerBJ);

      // Insurance payout
      let insurancePayout = 0;
      if (player.insurance && dealerBJ) {
        insurancePayout = player.insuranceBet * 2; // 2:1 insurance payout
      } else if (player.insurance && !dealerBJ) {
        insurancePayout = -player.insuranceBet; // lose insurance bet
      }

      const totalHandPayout = payout + insurancePayout;
      totalPayout += totalHandPayout;

      playerResults.push({
        hand,
        outcome,
        payout: totalHandPayout,
        playerValue: handValue(hand.cards),
        dealerValue: dealerVal,
        hadBlackjack: isBlackjack(hand.cards),
      });

      dbResults.push({
        userId: player.userId,
        bet: hand.bet,
        outcome,
        payout: totalHandPayout,
        playerValue: handValue(hand.cards),
        hadBlackjack: isBlackjack(hand.cards) && !hand.fromSplit,
        balance: 0, // filled below
      });
    }

    // Update balance
    player.balance += totalPayout;
    // Floor to prevent floating point debt
    player.balance = Math.max(0, Math.round(player.balance * 100) / 100);
    Queries.setBalance.run(player.balance, player.userId);

    // Fill balance into dbResults
    for (const r of dbResults.filter(r => r.userId === player.userId)) {
      r.balance = player.balance;
    }

    results.push({
      socketId: player.socketId,
      username: player.username,
      balance: player.balance,
      hands: playerResults,
      totalPayout,
    });
  }

  // Persist to DB (non-blocking)
  persistRoundResults(room.id, room.roundNumber, dbResults, dealerVal);

  emit(room, 'phase:results', {
    dealerCards: room.dealer.cards,
    dealerValue: dealerVal,
    dealerBJ,
    results,
  });

  // Auto-start next round
  room.resultsTimer = setTimeout(() => startBettingPhase(room), RESULTS_DISPLAY_MS);
}

// ──────────────── INSURANCE ────────────────

function takeInsurance(room, socketId) {
  if (room.phase !== PHASE.PLAYER_TURN) return { error: 'Wrong phase' };
  const player = room.players.get(socketId);
  if (!player) return { error: 'Not in room' };
  if (player.insurance) return { error: 'Already took insurance' };

  // Insurance is half the original bet
  const insuranceBet = Math.floor(player.bet / 2);
  if (player.balance < insuranceBet) return { error: 'Insufficient balance for insurance' };

  player.insurance = true;
  player.insuranceBet = insuranceBet;
  player.balance -= insuranceBet;
  Queries.setBalance.run(player.balance, player.userId);

  return { ok: true, insuranceBet };
}

// ──────────────── EMIT HELPER ────────────────

function emit(room, event, data) {
  if (room.io) {
    room.io.to(room.id).emit(event, data);
  }
}

function listAvailableRooms() {
  return Array.from(rooms.values())
    .filter(room => room.phase === PHASE.WAITING && room.players.size < room.maxPlayers)
    .map(room => ({
      id: room.id,
      tableName: room.tableName,
      numDecks: room.numDecks,
      maxPlayers: room.maxPlayers,
      playersCount: room.players.size,
    }));
}

module.exports = {
  PHASE, MIN_BET, MAX_BET,
  createRoom, getRoom, joinRoom, leaveRoom,
  placeBet, playerAction, takeInsurance,
  sanitizeRoom, rooms, listAvailableRooms,
};
