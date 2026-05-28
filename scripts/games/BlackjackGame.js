/**
 * BlackjackGame.js — Players vs. the dealer.
 *
 * Rules:
 * - Players place bets, then the GM deals 2 cards each (and 2 to dealer)
 * - Dealer's second card is face-down until players finish
 * - Players act in order: Hit, Stand, or Double Down
 * - After all players act, dealer reveals and hits until 17+
 * - Beat the dealer without busting to win (1:1 payout)
 * - Natural Blackjack (A + face card on initial deal) pays 3:2
 * - Bust (over 21) = lose immediately
 * - Push (tie) = bet returned
 */

import { DeckManager } from "../DeckManager.js";
import { ChipManager } from "../ChipManager.js";
import { GAME_PHASE, PLAYER_STATUS } from "../GameState.js";

export class BlackjackGame {
  /**
   * Deal the initial two cards to each player and the dealer.
   * Dealer's second card is face-down.
   */
  static async deal(state) {
    const { deckId, dealer } = state;
    const activePlayers = state.players.filter(p => p.status === PLAYER_STATUS.ACTIVE);

    // Deal two rounds: [player1, player2, ..., dealer] × 2
    for (let round = 0; round < 2; round++) {
      for (const player of activePlayers) {
        const cards = await DeckManager.dealToHand(deckId, player.handId, 1);
        const card  = cards[cards.length - 1];
        player.displayCards.push(DeckManager.serializeCard(card, false));
      }
      // Dealer: first card face-up, second face-down
      const dealerCards = await DeckManager.dealToHand(deckId, dealer.handId, 1);
      const dealerCard  = dealerCards[dealerCards.length - 1];
      const faceDown    = round === 1; // second card is hidden
      dealer.displayCards.push(DeckManager.serializeCard(dealerCard, faceDown));
    }

    // Check for player blackjacks immediately
    for (const player of activePlayers) {
      if (DeckManager.isBlackjack(player.displayCards)) {
        player.status = PLAYER_STATUS.WON; // flagged as natural — payout differs
        player._blackjack = true;
      }
    }

    // First active (non-blackjack) player goes first
    state.currentPlayerIndex = this._nextActiveIndex(state, -1);
    state.phase = GAME_PHASE.PLAYING;

    // If everyone has blackjack, jump straight to showdown
    if (activePlayers.every(p => p._blackjack || p.status !== PLAYER_STATUS.ACTIVE)) {
      return this._runDealerAndResolve(state);
    }

    return state;
  }

  // ─── Player Actions ───────────────────────────────────────────────────────

  /** Player hits: deal one more card. Auto-stands on 21. */
  static async hit(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;

    const cards = await DeckManager.dealToHand(state.deckId, player.handId, 1);
    const card  = cards[cards.length - 1];
    player.displayCards.push(DeckManager.serializeCard(card, false));

    const value = DeckManager.blackjackHandValue(player.displayCards);

    if (value > 21) {
      player.status = PLAYER_STATUS.BUST;
      this._advanceTurn(state);
    } else if (value === 21) {
      player.status = PLAYER_STATUS.STANDING; // auto-stand on 21
      this._advanceTurn(state);
    }
    // otherwise player can act again

    return state;
  }

  /** Player stands: lock in their hand. */
  static stand(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;

    player.status = PLAYER_STATUS.STANDING;
    this._advanceTurn(state);
    return state;
  }

  /**
   * Player doubles down: one final card, doubles the bet.
   * Can only be done on the first two cards.
   */
  static async double(state, userId) {
    const player = state.players.find(p => p.userId === userId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return state;
    if (player.displayCards.length !== 2) return state; // must be first action
    if (player.chips < player.currentBet) return state; // can't afford

    // Double the bet
    const extraBet = player.currentBet;
    player.chips      -= extraBet;
    player.currentBet += extraBet;
    state.pot         += extraBet;

    // Deal exactly one card, then stand
    const cards = await DeckManager.dealToHand(state.deckId, player.handId, 1);
    const card  = cards[cards.length - 1];
    player.displayCards.push(DeckManager.serializeCard(card, false));

    const value = DeckManager.blackjackHandValue(player.displayCards);
    player.status = value > 21 ? PLAYER_STATUS.BUST : PLAYER_STATUS.STANDING;
    this._advanceTurn(state);
    return state;
  }

  // ─── Dealer Phase ─────────────────────────────────────────────────────────

  /**
   * Run the dealer's hand and resolve all bets.
   * Called after all players have stood/busted.
   */
  static async runDealerAndResolve(state) {
    return this._runDealerAndResolve(state);
  }

  static async _runDealerAndResolve(state) {
    const { dealer, deckId } = state;

    // Flip the dealer's hidden card face-up
    dealer.displayCards = dealer.displayCards.map(c => {
      if (!c.faceDown) return c;
      // Re-fetch the actual card data from Foundry to un-hide it
      const dealerHand = game.cards.get(dealer.handId);
      const foundryCard = dealerHand?.cards.contents.find(fc => fc.id === c.id);
      return foundryCard ? DeckManager.serializeCard(foundryCard, false) : { ...c, faceDown: false };
    });

    // Dealer draws until 17+
    while (DeckManager.dealerShouldHit(dealer.displayCards)) {
      const cards = await DeckManager.dealToHand(deckId, dealer.handId, 1);
      const card  = cards[cards.length - 1];
      dealer.displayCards.push(DeckManager.serializeCard(card, false));
    }

    dealer.handValue = DeckManager.blackjackHandValue(dealer.displayCards);
    const dealerBust = dealer.handValue > 21;

    // Resolve each player
    const payouts    = [];
    const chatLines  = [];

    for (const player of state.players) {
      if (player.status === PLAYER_STATUS.BUST) {
        payouts.push({ userId: player.userId, delta: 0 }); // already lost
        chatLines.push(`💥 ${player.userName} busted (${DeckManager.blackjackHandValue(player.displayCards)}).`);
        continue;
      }

      if (player._blackjack) {
        // Natural blackjack: 3:2 payout
        const winAmount = Math.floor(player.currentBet * 1.5) + player.currentBet;
        payouts.push({ userId: player.userId, delta: winAmount });
        player.chips  += winAmount;
        player.status  = PLAYER_STATUS.WON;
        chatLines.push(`🂡 BLACKJACK! ${player.userName} wins ${winAmount} chips!`);
        continue;
      }

      if (player.status === PLAYER_STATUS.STANDING || player.status === PLAYER_STATUS.ACTIVE) {
        const playerValue = DeckManager.blackjackHandValue(player.displayCards);

        if (dealerBust || playerValue > dealer.handValue) {
          // Player wins: return bet + winnings
          const winAmount = player.currentBet * 2;
          payouts.push({ userId: player.userId, delta: winAmount });
          player.chips  += winAmount;
          player.status  = PLAYER_STATUS.WON;
          chatLines.push(`✅ ${player.userName} wins ${player.currentBet} chips! (${playerValue} vs dealer ${dealer.handValue})`);
        } else if (playerValue === dealer.handValue) {
          // Push: return the bet
          payouts.push({ userId: player.userId, delta: player.currentBet });
          player.chips  += player.currentBet;
          player.status  = PLAYER_STATUS.PUSH;
          chatLines.push(`🤝 Push — ${player.userName} gets their bet back.`);
        } else {
          // Player loses: bet is already in the pot
          payouts.push({ userId: player.userId, delta: 0 });
          player.status = PLAYER_STATUS.BUST; // "lost" state
          chatLines.push(`❌ ${player.userName} loses. (${playerValue} vs dealer ${dealer.handValue})`);
        }
      }
    }

    await ChipManager.applyPayouts(state.players, payouts);
    state.phase   = GAME_PHASE.RESULTS;
    state.pot     = 0;
    state.results = payouts;
    return { state, payouts, chatLines };
  }

  /** Reset for a new hand. */
  static prepareNewHand(state) {
    state.phase = GAME_PHASE.BETTING;
    state.pot   = 0;
    state.dealer.displayCards = [];
    state.dealer.handValue    = 0;
    for (const player of state.players) {
      player.status          = PLAYER_STATUS.ACTIVE;
      player.currentBet      = 0;
      player.displayCards    = [];
      player._blackjack      = false;
      player.hasActedThisRound = false;
    }
    state.currentPlayerIndex = 0;
    state.results = [];
    return state;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  static _nextActiveIndex(state, fromIndex) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIndex + i) % n;
      if (state.players[idx].status === PLAYER_STATUS.ACTIVE) return idx;
    }
    return -1; // no active players
  }

  /** Move to the next player's turn. If none left, trigger dealer phase. */
  static _advanceTurn(state) {
    const nextIdx = this._nextActiveIndex(state, state.currentPlayerIndex);
    if (nextIdx === -1) {
      // All players done — dealer goes next (GM triggers via UI)
      state.phase              = GAME_PHASE.SHOWDOWN;
      state.currentPlayerIndex = -1;
    } else {
      state.currentPlayerIndex = nextIdx;
    }
  }

  /** Check if all active players have finished acting. */
  static allPlayersDone(state) {
    return state.players.every(p =>
      p.status !== PLAYER_STATUS.ACTIVE
    );
  }
}
