/**
 * DeckManager.js — Wrapper around Foundry's native Cards API.
 *
 * Foundry's Cards system handles all the actual card operations:
 * shuffling, dealing, drawing, resetting. We use it for data integrity
 * (the deck is the source of truth — no card can be in two places at once).
 *
 * Our custom UI renders cards using their suit/value metadata as real images.
 * Card images live at: modules/the-degenerate-inn/assets/cards/card-{suit}-{value}.png
 */

import { MODULE_ID } from "./GameState.js";

const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANK_NAMES = {
  1:  "Ace",
  2:  "2",
  3:  "3",
  4:  "4",
  5:  "5",
  6:  "6",
  7:  "7",
  8:  "8",
  9:  "9",
  10: "10",
  11: "Jack",
  12: "Queen",
  13: "King",
};
const RANK_SHORT = {
  1:  "A",
  2:  "2",
  3:  "3",
  4:  "4",
  5:  "5",
  6:  "6",
  7:  "7",
  8:  "8",
  9:  "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
};
const SUIT_SYMBOL = {
  clubs:    "♣",
  diamonds: "♦",
  hearts:   "♥",
  spades:   "♠",
};

const CARD_BACK_COUNT = 4;

export class DeckManager {
  /** Create a shuffled 52-card deck tied to this table. */
  static async createDeck(tableId) {
    const deck = await Cards.create({
      name:         `[DI] Deck — ${tableId}`,
      type:         "deck",
      displayCount: false,
      ownership:    { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });

    const cardData = this._buildDeckData();
    await deck.createEmbeddedDocuments("Card", cardData);
    await deck.shuffle();
    return deck;
  }

  /** Create an empty Hand for a player. */
  static async createHand(tableId, userId, userName) {
    return await Cards.create({
      name:      `[DI] Hand — ${userName} (${tableId})`,
      type:      "hand",
      ownership: {
        [userId]:                               CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        default:                                CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
        [game.users.activeGM?.id ?? ""]:        CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      },
    });
  }

  /** Create an empty Hand for the dealer (GM-only visibility). */
  static async createDealerHand(tableId) {
    return await Cards.create({
      name:      `[DI] Dealer — ${tableId}`,
      type:      "hand",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });
  }

  /** Create a Pile for community cards (poker flop/turn/river). */
  static async createCommunityPile(tableId) {
    return await Cards.create({
      name:      `[DI] Community — ${tableId}`,
      type:      "pile",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    });
  }

  /** Deal `count` cards from the deck to a hand. */
  static async dealToHand(deckId, handId, count = 1) {
    const deck = game.cards.get(deckId);
    const hand = game.cards.get(handId);
    if (!deck || !hand) throw new Error("[DI] dealToHand: invalid deck or hand ID");
    await deck.deal([hand], count, { how: CONST.CARD_DRAW_MODES.TOP });
    return hand.cards.contents;
  }

  /** Shuffle the deck (resets all drawn cards back first). */
  static async resetAndShuffle(deckId) {
    const deck = game.cards.get(deckId);
    await deck.recall(); // sends all drawn cards back
    await deck.shuffle();
  }

  /** Return all cards from all hands/piles to the deck and shuffle. */
  static async fullReset(deckId, handIds, pileIds = []) {
    const deck = game.cards.get(deckId);
    // Reset each hand/pile back to the deck
    for (const id of [...handIds, ...pileIds]) {
      const stack = game.cards.get(id);
      if (stack && stack.cards.size > 0) {
        await stack.recall();
      }
    }
    await deck.shuffle();
  }

  /** Delete all Cards documents for a table (cleanup). */
  static async cleanupTable(tableId) {
    const toDelete = game.cards.filter(c => c.name.includes(`(${tableId})`));
    for (const doc of toDelete) {
      await doc.delete();
    }
  }

  /**
   * Serialize a Card document into a plain display object.
   * This is stored in game state and shown in the UI.
   *
   * @param {Card}    card      - Foundry Card document
   * @param {boolean} faceDown  - Whether to hide suit/value from the client
   */
  static serializeCard(card, faceDown = false) {
    if (faceDown) {
      return {
        id:         card.id,
        faceDown:   true,
        imgSrc:     this.cardBackImg(),
        altText:    "Hidden card",
      };
    }
    return {
      id:          card.id,
      suit:        card.suit,
      value:       card.value,
      faceDown:    false,
      rankDisplay: RANK_SHORT[card.value] ?? String(card.value),
      suitSymbol:  SUIT_SYMBOL[card.suit] ?? "?",
      name:        card.name,
      imgSrc:      this.cardFaceImg(card.suit, card.value),
      altText:     card.name,
    };
  }

  /** Path to a card face image. */
  static cardFaceImg(suit, value) {
    return `modules/${MODULE_ID}/assets/cards/card-${suit}-${value}.png`;
  }

  /** Path to the currently configured card back. */
  static cardBackImg() {
    const backStyle = game.settings.get(MODULE_ID, "cardBack") ?? 1;
    return `modules/${MODULE_ID}/assets/cards/card-back${backStyle}.png`;
  }

  /** Blank card (for empty slots). */
  static cardBlankImg() {
    return `modules/${MODULE_ID}/assets/cards/card-blank.png`;
  }

  // ─── Blackjack value helpers ─────────────────────────────────────────────

  /** Calculate the best blackjack hand value from a list of serialized cards. */
  static blackjackHandValue(cards) {
    let value = 0;
    let aces  = 0;
    for (const card of cards) {
      if (card.faceDown) continue;
      const v = card.value;
      if (v === 1) {
        aces++;
        value += 11;
      } else if (v >= 11) {
        value += 10;
      } else {
        value += v;
      }
    }
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }
    return value;
  }

  static isBlackjack(cards) {
    if (cards.length !== 2 || cards.some(c => c.faceDown)) return false;
    const values = cards.map(c => c.value >= 10 ? 10 : c.value === 1 ? 11 : c.value);
    return values.includes(11) && values.reduce((a, b) => a + b, 0) === 21;
  }

  static isBust(cards) {
    return this.blackjackHandValue(cards) > 21;
  }

  static dealerShouldHit(cards) {
    return this.blackjackHandValue(cards) < 17;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  static _buildDeckData() {
    const cards = [];
    for (const suit of SUITS) {
      for (let value = 1; value <= 13; value++) {
        cards.push({
          name:  `${RANK_NAMES[value]} of ${suit.charAt(0).toUpperCase() + suit.slice(1)}`,
          type:  "base",
          suit:  suit,
          value: value,
          faces: [{
            name: `${RANK_NAMES[value]} of ${suit}`,
            img:  `modules/${MODULE_ID}/assets/cards/card-${suit}-${value}.png`,
          }],
          back: {
            name: "Card Back",
            img:  `modules/${MODULE_ID}/assets/cards/card-back1.png`,
          },
          face: 0,
        });
      }
    }
    return cards;
  }
}
