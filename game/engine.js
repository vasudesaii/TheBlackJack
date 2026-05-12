// ===== SERVER-SIDE BLACKJACK ENGINE =====
// Mirrors the frontend engine.js but runs on the server for authoritative game state.
// The server is the single source of truth for cards, shuffles, and payouts.

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

function createShoe(numDecks = 6) {
  const shoe = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, value: cardValue(rank) });
      }
    }
  }
  // Fisher-Yates shuffle
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += c.value;
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isSoft(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += c.value;
    if (c.rank === 'A') aces++;
  }
  // Soft if we can count one ace as 11 without busting
  return aces > 0 && total <= 21 && (total - 10) <= 11;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function isBust(cards) {
  return handValue(cards) > 21;
}

function canSplit(hand) {
  return (
    hand.cards.length === 2 &&
    hand.cards[0].rank === hand.cards[1].rank &&
    (hand.splitCount || 0) < 3
  );
}

function canDouble(hand) {
  return hand.cards.length === 2 && !hand.fromSplit;
}

function canSurrender(hand) {
  return hand.cards.length === 2 && !hand.fromSplit;
}

// ─── Dealer play (deterministic) ───
function dealerPlay(dealerCards, shoe) {
  const drawn = [];
  while (true) {
    const val = handValue(dealerCards);
    const soft = isSoft(dealerCards);
    // Dealer stands on hard 17+, also stands on soft 17 (standard rule)
    if (val > 17 || (val === 17 && !soft)) break;
    if (val === 17 && soft) break; // change to `continue` for H17 variant
    const card = shoe.pop();
    if (!card) break;
    dealerCards.push(card);
    drawn.push(card);
  }
  return { dealerCards, drawn };
}

// ─── Outcome resolution for a single hand vs dealer ───
function resolveHand(hand, dealerCards, dealerBJ) {
  const { cards, bet, doubled, surrendered } = hand;

  if (surrendered) {
    return { outcome: 'surrender', payout: -Math.floor(bet / 2) };
  }

  const playerVal = handValue(cards);
  const dealerVal = handValue(dealerCards);
  const playerBJ = isBlackjack(cards) && !hand.fromSplit; // split BJ counts as 21 not BJ
  const playerBust = playerVal > 21;

  if (playerBust) {
    return { outcome: 'bust', payout: -bet };
  }
  if (dealerBJ && playerBJ) {
    return { outcome: 'push', payout: 0 };
  }
  if (dealerBJ) {
    return { outcome: 'lose', payout: -bet };
  }
  if (playerBJ) {
    return { outcome: 'blackjack', payout: Math.floor(bet * 1.5) }; // 3:2
  }
  if (dealerVal > 21) {
    return { outcome: 'win', payout: bet };
  }
  if (playerVal > dealerVal) {
    return { outcome: 'win', payout: bet };
  }
  if (playerVal < dealerVal) {
    return { outcome: 'lose', payout: -bet };
  }
  return { outcome: 'push', payout: 0 };
}

module.exports = {
  createShoe,
  handValue,
  isSoft,
  isBlackjack,
  isBust,
  canSplit,
  canDouble,
  canSurrender,
  dealerPlay,
  resolveHand,
};
