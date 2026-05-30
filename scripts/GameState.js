/**
 * GameState.js — Manages the authoritative state of a gambling table.
 *
 * State is stored as flags on a hidden JournalEntry. This means:
 * - It persists through reloads automatically
 * - Foundry's document sync broadcasts changes to all connected clients
 * - We hook into `updateJournalEntry` to re-render the UI on any change
 *
 * Only the GM client writes state. Players read it and send action requests via sockets.
 */

export const MODULE_ID = "the-degenerate-inn";
export const FLAG_KEY = "gameState";
export const TABLES_FLAG = "activeTables";

export const GAME_PHASE = {
  LOBBY:    "lobby",
  BETTING:  "betting",
  DEALING:  "dealing",
  PLAYING:  "playing",
  SHOWDOWN: "showdown",
  RESULTS:  "results",
};

export const PLAYER_STATUS = {
  ACTIVE:   "active",
  FOLDED:   "folded",
  BUST:     "bust",
  STANDING: "standing",
  WON:      "won",
  PUSH:     "push",
};

export const POKER_STREET = {
  PREFLOP: "preflop",
  FLOP:    "flop",
  TURN:    "turn",
  RIVER:   "river",
};

export class GameState {
  constructor(journalId) {
    this._journalId = journalId;
  }

  get _journal() {
    return game.journal.get(this._journalId);
  }

  /** Fetch the current game state object. */
  async get() {
    return foundry.utils.deepClone(
      this._journal?.getFlag(MODULE_ID, FLAG_KEY) ?? {}
    );
  }

  /**
   * Write a new state object. Only call this from the GM client.
   * The flag update automatically propagates to all clients via Foundry.
   */
  async set(state) {
    if (!this._journal) throw new Error(`[DegenerateInn] No journal found for table: ${this._journalId}`);
    await this._journal.setFlag(MODULE_ID, FLAG_KEY, state);
  }

  /** Partially update the state (merge). */
  async update(partial) {
    const current = await this.get();
    const merged = foundry.utils.mergeObject(current, partial, { inplace: false });
    await this.set(merged);
  }

  /** Build a brand-new default state for a fresh table. */
  static buildInitial({ tableId, journalId, gameType, creatorId }) {
    return {
      tableId,
      journalId,
      gameType,       // "highcard" | "blackjack" | "poker"
      phase: GAME_PHASE.LOBBY,
      players: [],    // see addPlayer() below
      dealer: {
        handId: null,
        displayCards: [],
        handValue: 0,
      },
      communityCards: [], // poker: flop/turn/river
      communityPileId: null,
      deckId: null,
      pot: 0,
      currentPlayerIndex: 0,
      gameData: {
        // Blackjack: nothing extra needed
        // Poker: betting state
        street: POKER_STREET.PREFLOP,
        currentBet: 0,
        lastAggressorIndex: -1,
        ante: 5,
      },
      results: [],
      creatorId,
    };
  }

  /** Build a player object for insertion into state.players. */
  static buildPlayer({ userId, userName, actorId, seatIndex, startingChips, handId }) {
    return {
      userId,
      userName,
      actorId:        actorId ?? null,
      seatIndex,
      chips:          startingChips,
      currentBet:     0,
      streetBet:      0,
      hasActedThisRound: false,
      status:         PLAYER_STATUS.ACTIVE,
      handId,
      displayCards:   [],  // [{suit, value, faceDown, rankDisplay, suitSymbol, id}]
    };
  }
}

// ─── Global table registry ────────────────────────────────────────────────────
// Stored on a single "registry" JournalEntry so we can list all active tables.

const REGISTRY_JOURNAL_NAME = "Degenerate Inn — Registry";

export class TableRegistry {
  static async _getOrCreateRegistry() {
    let journal = game.journal.getName(REGISTRY_JOURNAL_NAME);
    if (!journal) {
      // Only GM can create it — players just return null and getAll() returns []
      if (!game.user.isGM) return null;
      journal = await JournalEntry.create({
        name:      REGISTRY_JOURNAL_NAME,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      });
    } else if (game.user.isGM) {
      // Upgrade ownership if it was created as NONE (old versions)
      const defOwn = journal.ownership?.default ?? -1;
      if (defOwn < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
        await journal.update({
          ownership: { ...journal.ownership, default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
      }
    }
    return journal;
  }

  /** Return all active table summaries. */
  static async getAll() {
    const reg = await this._getOrCreateRegistry();
    if (!reg) return [];
    return reg.getFlag(MODULE_ID, TABLES_FLAG) ?? [];
  }

  /** Register a new table. */
  static async register(tableId, journalId, gameType, creatorName) {
    const reg  = await this._getOrCreateRegistry();
    const list = reg.getFlag(MODULE_ID, TABLES_FLAG) ?? [];
    list.push({ tableId, journalId, gameType, creatorName, players: 0 });
    await reg.setFlag(MODULE_ID, TABLES_FLAG, list);
  }

  /** Remove a table from the registry. */
  static async unregister(tableId) {
    const reg  = await this._getO