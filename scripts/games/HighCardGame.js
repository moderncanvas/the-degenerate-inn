/**
 * HighCardGame.js — Each player draws one card. Highest card wins the pot.
 *
 * Rules:
 * - All players ante up (place a bet before the draw)
 * - Each player draws 1 card from the deck
 * - Highest card value wins (Ace high = 14, King = 13, ...)
 * - Ties split the pot evenly
 *
 * This is the simplest game and tests the full pipeline end-to-end.
 */

import { DeckManager } from "../DeckManager.js";
import { ChipManager } from "../ChipManager.js";
import { GAME_PHASE, PLAYER_STATUS } from "../GameState.js";

export class HighCardGame {
  /**
   * Deal one card to each active player.
   * @param {object} state   - Full game state
   * @returns {object}       - Updated state
   */
  static async deal(state) {
    const { deckId } = state;
    const activePlayers = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);

    for (const player of activePlayers) {
      // Deal 1 card to the player's Foundry hand
      const cards = await DeckManager.dealToHand(deckId, player.handId, 1);
      const card  = cards[cards.length - 1]; // The newly dealt card

      // Serialize for display — face UP for everyone in High Card
      player.displayCards = [DeckManager.serializeCard(card, false)];
    }

    // Move to results immediately (no player choices in High Card)
    state.phase = GAME_PHASE.RESULTS;
    return state;
  }

  /**
   * Resolve the round: find the winner, distribute the pot.
   * @param {object} state  - Full game state (cards already dealt + displayed)
   * @returns {{ state, payouts, chatLines }}
   */
  static async resolve(state) {
    const activePlayers = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);
    const payouts       = [];
    const chatLines     = [];

    // Find highest card value (Ace = 14)
    let bestValue = -1;
    for (const player of activePlayers) {
      const card = player.displayCards[0];
      if (!card || card.faceDown) continue;
      const val = card.value === 1 ? 14 : card.value; // Ace high
      if (val > bestValue) bestValue = val;
    }

    // Find all players who share the top value (tie = split pot)
    const winners = activePlayers.filter(p => {
      const card = p.displayCards[0];
      if (!card || card.faceDown) return false;
      return (card.value === 1 ? 14 : card.value) === bestValue;
    });

    const pot        = state.pot;
    const shareEach  = Math.floor(pot / winners.length);
    const remainder  = pot - shareEach * winners.length; // leftover chips (house keeps)

    for (const player of state.players) {
      const isWinner = winners.some(w => w.userId === player.userId);
      if (isWinner) {
        player.status = PLAYER_STATUS.WON;
        payouts.push({ userId: player.userId, delta: shareEach }); // win share
        chatLines.push(`🏆 ${player.userName} wins ${shareEach} chips!`);
      } else if (player.status === PLAYER_STATUS.ACTIVE) {
        player.status = PLAYER_STATUS.BUST;
        // Bet was already deducted when placed — no further delta needed
        payouts.push({ userId: player.userId, delta: 0 });
        chatLines.push(`${player.userName} loses their bet.`);
      }
    }

    // Apply chip changes
    await ChipManager.applyPayouts(state.players, payouts);

    state.pot    = remainder; // any uneven remainder stays at table
    state.results = winners.map(w => ({ userId: w.userId, outcome: "won" }));

    return { state, payouts, chatLines };
  }

  /** Reset state for a new hand (keep players + chips, clear cards). */
  static prepareNewHand(state) {
    state.phase = GAME_PHASE.BETTING;
    state.pot   = 0;
    for (const player of state.players) {
      player.status          = PLAYER_STATUS.ACTIVE;
      player.currentBet      = 0;
      player.displayCards    = [];
      player.hasActedThisRound = false;
    }
    state.results = [];
    return state;
  }
}
