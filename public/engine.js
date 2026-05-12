// ===== CARD & DECK ENGINE =====
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUIT_COLORS = {'♠':'black','♣':'black','♥':'red','♦':'red'};

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit, color: SUIT_COLORS[suit] });
  return deck;
}

function createShoe(numDecks) {
  let shoe = [];
  for (let i = 0; i < numDecks; i++) shoe = shoe.concat(createDeck());
  return shuffle(shoe);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardValue(card) {
  if (['J','Q','K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isSoft(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return aces > 0 && total <= 21;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function canSplit(hand) {
  return hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && hand.splitCount < 3;
}

// ===== SIDE BET EVALUATION =====
function evalPerfectPairs(cards) {
  if (cards.length < 2) return { result: 'none', payout: 0 };
  const [a, b] = cards;
  if (cardValue(a) !== cardValue(b) && a.rank !== b.rank) return { result: 'none', payout: 0 };
  if (a.rank === b.rank) {
    if (a.suit === b.suit) return { result: 'Perfect Pair', payout: 25 };
    if (a.color === b.color) return { result: 'Colored Pair', payout: 12 };
    return { result: 'Mixed Pair', payout: 6 };
  }
  return { result: 'none', payout: 0 };
}

function eval21Plus3(playerCards, dealerUpCard) {
  if (playerCards.length < 2) return { result: 'none', payout: 0 };
  const three = [playerCards[0], playerCards[1], dealerUpCard];
  const ranks = three.map(c => RANKS.indexOf(c.rank));
  const suits = three.map(c => c.suit);
  const vals = three.map(c => c.rank);
  
  const allSameSuit = suits[0] === suits[1] && suits[1] === suits[2];
  const allSameRank = vals[0] === vals[1] && vals[1] === vals[2];
  const sorted = [...ranks].sort((a,b) => a - b);
  const isSeq = (sorted[2] - sorted[1] === 1 && sorted[1] - sorted[0] === 1) ||
                (sorted[0] === 0 && sorted[1] === 11 && sorted[2] === 12) ||
                (sorted[0] === 0 && sorted[1] === 1 && sorted[2] === 12);
  
  if (allSameRank && allSameSuit) return { result: 'Suited Trips', payout: 100 };
  if (isSeq && allSameSuit) return { result: 'Straight Flush', payout: 40 };
  if (allSameRank) return { result: 'Three of a Kind', payout: 30 };
  if (isSeq) return { result: 'Straight', payout: 10 };
  if (allSameSuit) return { result: 'Flush', payout: 5 };
  return { result: 'none', payout: 0 };
}

// ===== PLAYER & HAND =====
function createHand() {
  return { cards: [], bet: 0, sideBets: { pairs: 0, plus3: 0 }, splitCount: 0,
           doubled: false, surrendered: false, insured: false, insuranceBet: 0,
           stood: false, busted: false, result: null, payout: 0 };
}

function createPlayer(name, id, defaultBet) {
  return { id, name, balance: 10000, defaultBet: defaultBet || 100,
           hands: [createHand()], currentHandIdx: 0,
           profitHistory: [0],
           stats: { wins: 0, losses: 0, pushes: 0, blackjacks: 0, totalWagered: 0, totalWon: 0 } };
}

// Export for use
window.Engine = {
  createShoe, shuffle, cardValue, handValue, isSoft, isBlackjack, canSplit,
  evalPerfectPairs, eval21Plus3, createHand, createPlayer, SUITS, RANKS, SUIT_COLORS
};
