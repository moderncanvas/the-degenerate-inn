/**
 * PokerGame.js — Texas Hold'em Poker.
 *
 * Flow:
 *   1. All players ante up (auto-deducted from chips)
 *   2. GM deals 2 hole cards face-down to each player
 *   3. Betting round 1 (Pre-Flop): Check / Call / Raise / Fold
 *   4. GM deals 3 community cards (Flop)
 *   5. Betting round 2
 *   6. GM deals 1 community card (Turn)
 *   7. Betting round 3
 *   8. GM deals 1 community card (River)
 *   9. Betting round 4
 *  10. Showdown: best 5-of-7 hand wins the pot
 *
 * The GM controls dealing each street. Players control their betting actions.
 * Both-side hand visibility: hole cards are face-down to non-owners in the UI
 * until the showdown, when all remaining hands are revealed.
 */

import { DeckManager } from "../DeckManager.js";
import { ChipManager } from "../ChipManager.js";
import { GAME_PHASE, PLAYER_STATUS, POKER_STREET } from "../GameState.js";

// ─── Hand Evaluator ────────────────────────────────────────────────────────────

const HAND_RANK = {
  HIGH_CARD:       0,
  ONE_PAIR:        1,
  TWO_PAIR:        2,
  THREE_OF_A_KIND: 3,
  STRAIGHT:        4,
  FLUSH:           5,
  FULL_HOUSE:      6,
  FOUR_OF_A_KIND:  7,
  STRAIGHT_FLUSH:  8,
  ROYAL_FLUSH:     9,
};

const HAND_NAMES = {
  0: "High Card",
  1: "One Pair",
  2: "Two Pair",
  3: "Three of a Kind",
  4: "Straight",
  5: "Flush",
  6: "Full House",
  7: "Four of a Kind",
  8: "Straight Flush",
  9: "Royal Flush",
};

class HandEvaluator {
  /**
   * Evaluate a 5-card hand and return its rank + tiebreaker values.
   * @param {object[]} cards5  - Array of 5 display card objects {value, suit}
   * @returns {{ rank, name, tiebreakers: number[] }}
   */
  static evaluate(cards5) {
    // Ace = 14 for high-card purposes
    const values = cards5.map(c => c.value === 1 ? 14 : c.value).sort((a, b) => b - a);
    const suits  = cards5.map(c => c.suit);

    const isFlush    = suits.every(s => s === suits[0]);
    const isStraight = this._checkStraight(values);

    // Count occurrences of each value
    const counts = {};
    for (const v of values) counts[v] = (counts[v] || 0) + 1;

    // Sort unique values by frequency DESC, then by value DESC (for tiebreakers)
    const sortedByFreq = Object.keys(counts)
      .map(Number)
      .sort((a, b) => counts[b] - counts[a] || b - a);

    const freqs = sortedByFreq.map(v => counts[v]);

    if (isFlush && isStraight) {
      if (values[0] === 14 && values[1] === 13) return { rank: HAND_RANK.ROYAL_FLUSH,   name: HAND_NAMES[9], tiebreakers: values };
      return                                           { rank: HAND_RANK.STRAIGHT_FLUSH, name: HAND_NAMES[8], tiebreakers: values };
    }
    if (freqs[0] === 4) return { rank: HAND_RANK.FOUR_OF_A_KIND,  name: HAND_NAMES[7], tiebreakers: sortedByFreq };
    if (freqs[0] === 3 && freqs[1] === 2) return { rank: HAND_RANK.FULL_HOUSE, name: HAND_NAMES[6], tiebreakers: sortedByFreq };
    if (isFlush)    return { rank: HAND_RANK.FLUSH,           name: HAND_NAMES[5], tiebreakers: values };
    if (isStraight) return { rank: HAND_RANK.STRAIGHT,        name: HAND_NAMES[4], tiebreakers: values };
    if (freqs[0] === 3) return { rank: HAND_RANK.THREE_OF_A_KIND, name: HAND_NAMES[3], tiebreakers: sortedByFreq };
    if (freqs[0] === 2 && freqs[1] === 2) return { rank: HAND_RANK.TWO_PAIR,  name: HAND_NAMES[2], tiebreakers: sortedByFreq };
    if (freqs[0] === 2) return { rank: HAND_RANK.ONE_PAIR,    name: HAND_NAMES[1], tiebreakers: sortedByFreq };
    return                     { rank: HAND_RANK.HIGH_CARD,   name: HAND_NAMES[0], tiebreakers: values };
  }

  /** Check all C(7,5) = 21 combos and return the best 5-card hand. */
  static bestHand(cards7) {
    const combos = this._combinations(cards7, 5);
    let best = null;
    for (const combo of combos) {
      const result = this.evaluate(combo);
      result.cards = combo;
      if (!best || this._compare(result, best) > 0) best = result;
    }
    return best;
  }

  static _checkStraight(sortedValues) {
    const unique = [...new Set(sortedValues)];
    if (unique.length < 5) return false;
    // Normal straight
    if (unique[0] - unique[4] === 4) return true;
    // Wheel: A-2-3-4-5 (Ace plays low)
    if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) return true;
    return false;
  }

  static _compare(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    for (let i = 0; i < Math.min(a.tiebreakers.length, b.tiebreakers.length); i++) {
      if (a.tiebreakers[i] !== b.tiebreakers[i]) return a.tiebreakers[i] - b.tiebreakers[i];
    }
    return 0;
  }

  static _combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    const withFirst    = this._combinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = this._combinations(rest, k);
    return [...withFirst, ...withoutFirst];
  }
}

// ─── Main Game Class ───────────────────────────────────────────────────────────

export class PokerGame {
  /** Collect antes from all players and deal 2 hole cards each. */
  static async deal(state) {
    const ante = state.gameData.ante ?? 5;
    const activePlayers = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);

    // Collect antes
    for (const player of activePlayers) {
      const actualAnte  = Math.min(ante, player.chips);
      player.chips     -= actualAnte;
      player.currentBet = actualAnte;
      player.streetBet  = actualAnte;
      state.pot        += actualAnte;
    }

    // Deal 2 hole cards to each player (face-down to others, face-up to owner)
    for (const player of activePlayers) {
      const cards = await DeckManager.dealToHand(state.deckId, player.handId, 2);
      // Store actual card data — UI will hide from non-owners
      player.displayCards = [
        DeckManager.serializeCard(cards[cards.length - 2], false),
        DeckManager.serializeCard(cards[cards.length - 1], false),
      ];
    }

    // Init betting round
    state.gameData.currentBet        = ante;
    state.gameData.lastAggressorIndex = -1;
    state.gameData.street            = POKER_STREET.PREFLOP;
    this._initBettingRound(state, ante); // everyone already put in the ante

    state.phase              = GAME_PHASE.PLAYING;
    state.currentPlayerIndex = 0;

    return state;
  }

  // ─── Betting Actions ───────────────────────────────────────────────────────

  /** Player checks (only when currentBet === their streetBet). */
  static check(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;
    player.hasActedThisRound = true;
    this._advanceTurn(state);
    return state;
  }

  /** Player calls the current bet. */
  static call(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;

    const toCall   = state.gameData.currentBet - (player.streetBet ?? 0);
    const actual   = Math.min(toCall, player.chips);
    player.chips  -= actual;
    player.streetBet = (player.streetBet ?? 0) + actual;
    state.pot     += actual;

    player.hasActedThisRound = true;
    this._advanceTurn(state);
    return state;
  }

  /** Player raises to a new total bet amount. */
  static raise(state, userId, totalAmount) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;

    // totalAmount is the NEW total they want in for this street
    const diff    = totalAmount - (player.streetBet ?? 0);
    const actual  = Math.min(diff, player.chips);
    player.chips -= actual;
    player.streetBet   = (player.streetBet ?? 0) + actual;
    state.pot         += actual;

    // Update the current bet level
    if (player.streetBet > state.gameData.currentBet) {
      state.gameData.currentBet = player.streetBet;
      state.gameData.lastAggressorIndex = state.players.indexOf(player);
      // Everyone else needs to act again
      for (const p of state.players) {
        if (p.userId !== userId && p.status === PLAYER_STATUS.ACTIVE) {
          p.hasActedThisRound = false;
        }
      }
    }

    player.hasActedThisRound = true;
    this._advanceTurn(state);
    return state;
  }

  /** Player folds. */
  static fold(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player) return state;
    player.status = PLAYER_STATUS.FOLDED;
    this._advanceTurn(state);
    return state;
  }

  // ─── Street Dealing ────────────────────────────────────────────────────────

  /** Deal the Flop (3 community cards). */
  static async dealFlop(state) {
    return this._dealCommunityCards(state, 3, POKER_STREET.FLOP);
  }

  /** Deal the Turn (1 community card). */
  static async dealTurn(state) {
    return this._dealCommunityCards(state, 1, POKER_STREET.TURN);
  }

  /** Deal the River (1 community card). */
  static async dealRiver(state) {
    return this._dealCommunityCards(state, 1, POKER_STREET.RIVER);
  }

  static async _dealCommunityCards(state, count, street) {
    const pile = game.cards.get(state.communityPileId);
    const deck = game.cards.get(state.deckId);

    await deck.deal([pile], count, { how: CONST.CARD_DRAW_MODES.TOP });

    const newCards = pile.cards.contents.slice(-count);
    for (const card of newCards) {
      state.communityCards.push(DeckManager.serializeCard(card, false));
    }

    state.gameData.street = street;
    this._startNewBettingRound(state);

    return state;
  }

  // ─── Showdown ──────────────────────────────────────────────────────────────

  /** Reveal all hands, evaluate, distribute pot. */
  static async showdown(state) {
    const communityCards = state.communityCards.filter(c => !c.faceDown);
    const activePlayers  = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);

    if (activePlayers.length === 0) {
      state.phase = GAME_PHASE.RESULTS;
      return { state, payouts: [], chatLines: ["No active players for showdown."] };
    }

    // Reveal all active players' hole cards
    for (const player of activePlayers) {
      const hand = game.cards.get(player.handId);
      if (hand) {
        const cards = hand.cards.contents;
        player.displayCards = cards.map(c => DeckManager.serializeCard(c, false));
      }
    }

    // If only one player left (everyone else folded), they win immediately
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const winAmount = state.pot;
      winner.chips     += winAmount;
      winner.status     = PLAYER_STATUS.WON;
      const payouts     = [{ userId: winner.userId, delta: winAmount }];
      await ChipManager.applyPayouts(state.players, payouts);
      state.pot   = 0;
      state.phase = GAME_PHASE.RESULTS;
      return { state, payouts, chatLines: [`🏆 ${winner.userName} wins ${winAmount} chips! (everyone else folded)`] };
    }

    // Evaluate best 5-of-7 hand for each remaining player
    const evaluations = activePlayers.map(player => {
      const holeCards = player.displayCards.filter(c => !c.faceDown);
      const allCards  = [...holeCards, ...communityCards];
      const best      = allCards.length >= 5 ? HandEvaluator.bestHand(allCards) : { rank: -1, name: "No Hand", tiebreakers: [] };
      return { player, best };
    });

    // Sort by hand strength descending
    evaluations.sort((a, b) => HandEvaluator._compare(b.best, a.best));

    // Find winners (can be ties)
    const topResult = evaluations[0].best;
    const winners   = evaluations.filter(e => HandEvaluator._compare(e.best, topResult) === 0);

    const shareEach = Math.floor(state.pot / winners.length);
    const payouts   = [];
    const chatLines = [];

    for (const { player, best } of evaluations) {
      const isWinner = winners.some(w => w.player.userId === player.userId);
      if (isWinner) {
        player.chips  += shareEach;
        player.status  = PLAYER_STATUS.WON;
        payouts.push({ userId: player.userId, delta: shareEach });
        chatLines.push(`🏆 ${player.userName} wins ${shareEach} chips with ${best.name}!`);
      } else {
        player.status = PLAYER_STATUS.BUST;
        payouts.push({ userId: player.userId, delta: 0 });
        chatLines.push(`${player.userName}: ${best.name}`);
      }
    }

    await ChipManager.applyPayouts(state.players, payouts);
    state.pot     = 0;
    state.phase   = GAME_PHASE.RESULTS;
    state.results = payouts;

    return { state, payouts, chatLines };
  }

  /** Reset for a new hand. */
  static prepareNewHand(state) {
    state.phase          = GAME_PHASE.BETTING;
    state.pot            = 0;
    state.communityCards = [];
    state.dealer.displayCards = [];
    state.gameData.street    = POKER_STREET.PREFLOP;
    state.gameData.currentBet = 0;
    state.gameData.lastAggressorIndex = -1;

    for (const player of state.players) {
      if (player.chips > 0) {
        player.status          = PLAYER_STATUS.ACTIVE;
      }
      // Players with 0 chips are still seated but can't play
      player.currentBet        = 0;
      player.streetBet         = 0;
      player.displayCards      = [];
      player.hasActedThisRound = false;
    }
    state.currentPlayerIndex = 0;
    state.results = [];
    return state;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  static _initBettingRound(state, initialBet = 0) {
    for (const player of state.players) {
      if (player.status === PLAYER_STATUS.ACTIVE) {
        player.hasActedThisRound = (player.streetBet ?? 0) >= initialBet;
      }
    }
  }

  static _startNewBettingRound(state) {
    state.gameData.currentBet        = 0;
    state.gameData.lastAggressorIndex = -1;
    state.currentPlayerIndex          = 0;
    for (const player of state.players) {
      if (player.status === PLAYER_STATUS.ACTIVE) {
        player.streetBet         = 0;
        player.hasActedThisRound = false;
      }
    }
  }

  static _advanceTurn(state) {
    const n = state.players.length;
    // Find next active player who hasn't acted
    let found = false;
    for (let i = 1; i <= n; i++) {
      const idx    = (state.currentPlayerIndex + i) % n;
      const player = state.players[idx];
      if (player.status === PLAYER_STATUS.ACTIVE && !player.hasActedThisRound) {
        state.currentPlayerIndex = idx;
        found = true;
        break;
      }
    }
    if (!found) {
      // Betting round over — GM will trigger next street
      state.phase = GAME_PHASE.SHOWDOWN;
    }
  }

  /** Whether a player can check (they haven't been bet into). */
  static canCheck(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player) return false;
    return (player.streetBet ?? 0) >= state.gameData.currentBet;
  }

  /** Amount a player must call. */
  static callAmount(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player) return 0;
    return Math.max(0, state.gameData.currentBet - (player.streetBet ?? 0));
  }

  /** Minimum raise amount (current bet + 1). */
  static minRaise(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player) return 0;
    return state.gameData.currentBet + 1;
  }

  /** Check whether the current betting round is over. */
  static isBettingRoundOver(state) {
    const active = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);
    return active.every(p =>
      p.hasActedThisRound && (p.streetBet ?? 0) >= state.gameData.currentBet
    );
  }
}

// Re-export evaluator for use in UI if needed
export { HandEvaluator };
