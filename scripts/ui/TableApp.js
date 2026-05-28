/**
 * TableApp.js — The main game window.
 *
 * This is what every player sees when they're seated at a table.
 * It shows the felt, cards, chips, and action buttons.
 *
 * Architecture:
 * - State is fetched from the JournalEntry flags on every render
 * - Foundry's `updateJournalEntry` hook triggers re-renders automatically
 * - Player actions → socket → GM processes → JournalEntry update → re-render
 */

import { MODULE_ID, GameState, TableRegistry, GAME_PHASE, PLAYER_STATUS, POKER_STREET } from "../GameState.js";
import { DeckManager } from "../DeckManager.js";
import { ChipManager } from "../ChipManager.js";
import { HighCardGame } from "../games/HighCardGame.js";
import { BlackjackGame } from "../games/BlackjackGame.js";
import { PokerGame } from "../games/PokerGame.js";
import { SOCKET_EVENTS, PLAYER_ACTIONS } from "../SocketHandler.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TableApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(tableId, journalId, gameType, options = {}) {
    super(options);
    this._tableId   = tableId;
    this._journalId = journalId;
    this._gameType  = gameType;
    this._gameState = new GameState(journalId);
    this._hookId    = null;
  }

  static DEFAULT_OPTIONS = {
    id:       "degenerate-inn-table",
    title:    "The Degenerate Inn",
    classes:  ["degenerate-inn", "table-app"],
    position: { width: 860, height: 640 },
    window: {
      icon:      "fas fa-diamond",
      resizable: true,
      controls: [
        { icon: "fas fa-coins",    label: "Distribute Chips", action: "distributeChips" },
        { icon: "fas fa-sign-out", label: "Leave Table",      action: "leaveTable" },
      ],
    },
    actions: {
      sitDown:           TableApp._onSitDown,
      leaveTable:        TableApp._onLeaveTable,
      placeBet:          TableApp._onPlaceBet,
      deal:              TableApp._onDeal,
      hit:               TableApp._onHit,
      stand:             TableApp._onStand,
      double:            TableApp._onDouble,
      fold:              TableApp._onFold,
      check:             TableApp._onCheck,
      call:              TableApp._onCall,
      raise:             TableApp._onRaise,
      dealFlop:          TableApp._onDealFlop,
      dealTurn:          TableApp._onDealTurn,
      dealRiver:         TableApp._onDealRiver,
      showdown:          TableApp._onShowdown,
      runDealer:         TableApp._onRunDealer,
      newHand:           TableApp._onNewHand,
      distributeChips:   TableApp._onDistributeChips,
    },
  };

  static PARTS = {
    table: {
      template: `modules/${MODULE_ID}/templates/table.hbs`,
    },
  };

  /** Static factory: creates the underlying journal, game state, and opens the app. */
  static async createAndOpen({ gameType, ante = 5 }) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can create a table.");
      return;
    }

    const tableId = foundry.utils.randomID(8);

    // Create a hidden journal to hold state
    const journal = await JournalEntry.create({
      name:      `[DI] Table — ${tableId}`,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });

    // Create the deck
    const deck          = await DeckManager.createDeck(tableId);
    const dealerHand    = await DeckManager.createDealerHand(tableId);
    const communityPile = gameType === "poker" ? await DeckManager.createCommunityPile(tableId) : null;

    // Build initial state
    const state = GameState.buildInitial({
      tableId, journalId: journal.id, gameType, creatorId: game.user.id,
    });
    state.deckId           = deck.id;
    state.dealer.handId    = dealerHand.id;
    state.communityPileId  = communityPile?.id ?? null;
    state.gameData.ante    = ante;

    const gs = new GameState(journal.id);
    await gs.set(state);

    // Register in the lobby
    await TableRegistry.register(tableId, journal.id, gameType, game.user.name);

    // Open the app
    const app = new TableApp(tableId, journal.id, gameType);
    await app.render(true);

    return app;
  }

  /** Open an existing table by ID (for players joining). */
  static async openForTable(tableId, journalId, gameType) {
    const app = new TableApp(tableId, journalId, gameType);
    await app.render(true);
    return app;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this._registerHooks();
    this._registerSocketHandlers();
  }

  _onClose(options) {
    this._unregisterHooks();
    return super._onClose?.(options);
  }

  _registerHooks() {
    // Re-render whenever the game state journal changes
    this._hookId = Hooks.on("updateJournalEntry", (doc, change) => {
      if (doc.id !== this._journalId) return;
      if (!foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) return;
      this.render();
    });
  }

  _unregisterHooks() {
    if (this._hookId !== null) {
      Hooks.off("updateJournalEntry", this._hookId);
      this._hookId = null;
    }
  }

  _registerSocketHandlers() {
    const socket = game.degenerateInn?.socket;
    if (!socket) return;

    // Players send actions → GM processes them
    if (game.user.isGM) {
      socket.on(SOCKET_EVENTS.REQUEST_JOIN,      (p) => this._gmHandleJoin(p));
      socket.on(SOCKET_EVENTS.REQUEST_LEAVE,     (p) => this._gmHandleLeave(p));
      socket.on(SOCKET_EVENTS.REQUEST_PLACE_BET, (p) => this._gmHandlePlaceBet(p));
      socket.on(SOCKET_EVENTS.REQUEST_ACTION,    (p) => this._gmHandleAction(p));
    }
  }

  // ─── Context Preparation ───────────────────────────────────────────────────

  async _prepareContext(options) {
    const state = await this._gameState.get();
    if (!state || !state.tableId) {
      return { empty: true };
    }

    const myUserId = game.userId;
    const isGM     = game.user.isGM;

    // Determine which player seat belongs to the current user
    const myPlayer = state.players.find(p => p.userId === myUserId);
    const myIndex  = myPlayer ? state.players.indexOf(myPlayer) : -1;
    const isSeated = myIndex >= 0;
    const isMyTurn = isSeated && state.currentPlayerIndex === myIndex;

    // Build player display data with proper card visibility
    const players = state.players.map((p, idx) => {
      const canSeeCards = isGM || p.userId === myUserId;
      const displayCards = (p.displayCards ?? []).map(card => {
        if (!canSeeCards && !card.faceDown) {
          // Hide other players' cards
          return { ...card, faceDown: true, imgSrc: DeckManager.cardBackImg() };
        }
        return card;
      });

      return {
        ...p,
        displayCards,
        isMe:      p.userId === myUserId,
        isActive:  idx === state.currentPlayerIndex && state.phase === GAME_PHASE.PLAYING,
        handValue: this._handValueLabel(p.displayCards, state.gameType),
      };
    });

    // Empty seat slots (up to 4)
    const seats       = [];
    const occupiedIdx = new Set(state.players.map(p => p.seatIndex));
    for (let i = 0; i < 4; i++) {
      seats.push({ index: i, occupied: occupiedIdx.has(i) });
    }

    // Dealer cards — hide face-down ones from players
    const dealerCards = (state.dealer?.displayCards ?? []).map(card => {
      if (!isGM && card.faceDown) {
        return { ...card, imgSrc: DeckManager.cardBackImg() };
      }
      return card;
    });

    // Build action bar context
    const actions = this._buildActions(state, myPlayer, isGM, isMyTurn);

    // Poker-specific
    const canCall   = myPlayer && state.gameType === "poker" ? PokerGame.callAmount(state, myUserId) : 0;
    const minRaise  = myPlayer && state.gameType === "poker" ? PokerGame.minRaise(state, myUserId) : 0;
    const canCheck  = myPlayer && state.gameType === "poker" ? PokerGame.canCheck(state, myUserId) : false;

    return {
      state,
      players,
      seats,
      dealerCards,
      communityCards: state.communityCards ?? [],
      myPlayer,
      isGM,
      isSeated,
      isMyTurn,
      actions,
      canCall,
      minRaise,
      canCheck,
      gameType:    state.gameType,
      phase:       state.phase,
      pot:         state.pot,
      gameLabel:   { highcard: "High Card", blackjack: "Blackjack", poker: "Texas Hold'em" }[state.gameType] ?? state.gameType,
      phaseLabel:  this._phaseLabel(state),
      street:      state.gameData?.street,
      cardBackImg: DeckManager.cardBackImg(),
      blankImg:    DeckManager.cardBlankImg(),
      PHASE:       GAME_PHASE,
      STREET:      POKER_STREET,
      STATUS:      PLAYER_STATUS,
    };
  }

  _handValueLabel(cards, gameType) {
    if (!cards || cards.length === 0) return "";
    if (gameType === "blackjack") {
      const val = DeckManager.blackjackHandValue(cards.filter(c => !c.faceDown));
      return val > 0 ? String(val) : "";
    }
    return "";
  }

  _phaseLabel(state) {
    const labels = {
      [GAME_PHASE.LOBBY]:    "Waiting for players...",
      [GAME_PHASE.BETTING]:  "Place your bets",
      [GAME_PHASE.DEALING]:  "Dealing...",
      [GAME_PHASE.PLAYING]:  "In Play",
      [GAME_PHASE.SHOWDOWN]: "Showdown",
      [GAME_PHASE.RESULTS]:  "Round Over",
    };
    if (state.phase === GAME_PHASE.PLAYING && state.gameType === "poker" && state.gameData?.street) {
      const streetNames = { preflop: "Pre-Flop", flop: "Flop", turn: "Turn", river: "River" };
      return streetNames[state.gameData.street] ?? "In Play";
    }
    return labels[state.phase] ?? state.phase;
  }

  _buildActions(state, myPlayer, isGM, isMyTurn) {
    const phase = state.phase;
    const type  = state.gameType;

    return {
      // GM controls
      showDeal:       isGM && phase === GAME_PHASE.BETTING && state.players.length > 0,
      showNewHand:    isGM && phase === GAME_PHASE.RESULTS,
      showRunDealer:  isGM && type === "blackjack" && phase === GAME_PHASE.SHOWDOWN,
      showDealFlop:   isGM && type === "poker" && phase === GAME_PHASE.SHOWDOWN && state.gameData?.street === POKER_STREET.PREFLOP,
      showDealTurn:   isGM && type === "poker" && phase === GAME_PHASE.SHOWDOWN && state.gameData?.street === POKER_STREET.FLOP,
      showDealRiver:  isGM && type === "poker" && phase === GAME_PHASE.SHOWDOWN && state.gameData?.street === POKER_STREET.TURN,
      showShowdown:   isGM && type === "poker" && phase === GAME_PHASE.SHOWDOWN && state.gameData?.street === POKER_STREET.RIVER,
      showDistribute: isGM,

      // Player controls (only shown when it's their turn)
      showHit:   isMyTurn && type === "blackjack" && phase === GAME_PHASE.PLAYING,
      showStand: isMyTurn && type === "blackjack" && phase === GAME_PHASE.PLAYING,
      showDouble: isMyTurn && type === "blackjack" && phase === GAME_PHASE.PLAYING && myPlayer?.displayCards?.length === 2,
      showFold:  isMyTurn && type === "poker" && phase === GAME_PHASE.PLAYING,
      showCheck: isMyTurn && type === "poker" && phase === GAME_PHASE.PLAYING && PokerGame.canCheck(state, game.userId),
      showCall:  isMyTurn && type === "poker" && phase === GAME_PHASE.PLAYING && !PokerGame.canCheck(state, game.userId),
      showRaise: isMyTurn && type === "poker" && phase === GAME_PHASE.PLAYING,

      // Bet control (shown during betting phase for all unseated + seated players)
      showBet:   myPlayer && phase === GAME_PHASE.BETTING && (myPlayer.currentBet === 0),

      // Sit down button
      showSit:   !myPlayer && phase !== GAME_PHASE.RESULTS && state.players.length < 4,
    };
  }

  // ─── GM Action Handlers ────────────────────────────────────────────────────

  async _gmHandleJoin({ tableId, userId, actorId }) {
    if (tableId !== this._tableId) return;
    const state = await this._gameState.get();

    // Already seated?
    if (state.players.some(p => p.userId === userId)) return;
    if (state.players.length >= 4) {
      ui.notifications.warn(`${game.users.get(userId)?.name} tried to join but the table is full.`);
      return;
    }

    const user      = game.users.get(userId);
    const seatIndex = state.players.length;
    const hand      = await DeckManager.createHand(tableId, userId, user?.name ?? userId);

    const player = GameState.buildPlayer({
      userId,
      userName:      user?.name ?? userId,
      actorId,
      seatIndex,
      startingChips: ChipManager.startingChipCount(actorId),
      handId:        hand.id,
    });

    state.players.push(player);
    await this._gameState.set(state);
    await TableRegistry.updatePlayerCount(tableId, state.players.length);
  }

  async _gmHandleLeave({ tableId, userId }) {
    if (tableId !== this._tableId) return;
    const state = await this._gameState.get();
    state.players = state.players.filter(p => p.userId !== userId);
    await this._gameState.set(state);
    await TableRegistry.updatePlayerCount(tableId, state.players.length);
  }

  async _gmHandlePlaceBet({ tableId, userId, amount }) {
    if (tableId !== this._tableId) return;
    const state  = await this._gameState.get();
    const player = state.players.find(p => p.userId === userId);
    if (!player) return;

    const bet = Math.min(amount, player.chips);
    player.chips     -= bet;
    player.currentBet = bet;
    state.pot        += bet;

    // Check if all players have bet → ready to deal
    const allBet = state.players.every(p => p.currentBet > 0);
    if (allBet) state.phase = GAME_PHASE.BETTING; // stays betting; GM manually deals

    await this._gameState.set(state);
  }

  async _gmHandleAction({ tableId, userId, action, amount }) {
    if (tableId !== this._tableId) return;
    if (!game.user.isGM) return;

    let state = await this._gameState.get();

    // Validate it's actually this player's turn
    const playerIdx = state.players.findIndex(p => p.userId === userId);
    if (playerIdx !== state.currentPlayerIndex) return;

    switch (action) {
      case PLAYER_ACTIONS.HIT:
        state = await BlackjackGame.hit(state, userId);
        if (BlackjackGame.allPlayersDone(state)) {
          state = await this._runDealerPhase(state);
        }
        break;
      case PLAYER_ACTIONS.STAND:
        state = BlackjackGame.stand(state, userId);
        if (BlackjackGame.allPlayersDone(state)) {
          state = await this._runDealerPhase(state);
        }
        break;
      case PLAYER_ACTIONS.DOUBLE:
        state = await BlackjackGame.double(state, userId);
        if (BlackjackGame.allPlayersDone(state)) {
          state = await this._runDealerPhase(state);
        }
        break;
      case PLAYER_ACTIONS.FOLD:
        state = PokerGame.fold(state, userId);
        break;
      case PLAYER_ACTIONS.CHECK:
        state = PokerGame.check(state, userId);
        break;
      case PLAYER_ACTIONS.CALL:
        state = PokerGame.call(state, userId);
        break;
      case PLAYER_ACTIONS.RAISE:
        state = PokerGame.raise(state, userId, amount);
        break;
    }

    await this._gameState.set(state);
    this._postChatUpdates(state);
  }

  async _runDealerPhase(state) {
    const result = await BlackjackGame.runDealerAndResolve(state);
    for (const line of result.chatLines) this._sendChatMessage(line);
    return result.state;
  }

  // ─── UI Action Handlers (static, bound to instance via `this`) ─────────────

  static async _onSitDown(event, target) {
    const userId  = game.userId;
    const actorId = game.user.character?.id ?? null;

    if (game.user.isGM) {
      // GM joins locally (no socket needed)
      await this._gmHandleJoin({ tableId: this._tableId, userId, actorId });
    } else {
      game.degenerateInn.socket.requestJoin({ tableId: this._tableId, userId, actorId });
    }
  }

  static async _onLeaveTable(event, target) {
    const userId = game.userId;
    if (game.user.isGM) {
      await this._gmHandleLeave({ tableId: this._tableId, userId });
    } else {
      game.degenerateInn.socket.requestLeave({ tableId: this._tableId, userId });
    }
    this.close();
  }

  static async _onPlaceBet(event, target) {
    const betInput = this.element.querySelector(".bet-input");
    const amount   = parseInt(betInput?.value) || 0;
    if (amount <= 0) {
      ui.notifications.warn("Enter a valid bet amount.");
      return;
    }

    if (game.user.isGM) {
      await this._gmHandlePlaceBet({ tableId: this._tableId, userId: game.userId, amount });
    } else {
      game.degenerateInn.socket.requestPlaceBet({ tableId: this._tableId, userId: game.userId, amount });
    }
  }

  static async _onDeal(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();

    // Reset hands for a clean deal
    const handIds = state.players.map(p => p.handId).filter(Boolean);
    await DeckManager.fullReset(state.deckId, handIds, [state.communityPileId].filter(Boolean));

    // Clear display cards
    for (const player of state.players) {
      player.displayCards = [];
      player.status = PLAYER_STATUS.ACTIVE;
    }
    state.dealer.displayCards = [];
    state.communityCards = [];

    // Delegate to the appropriate game
    if (state.gameType === "highcard") {
      state = await HighCardGame.deal(state);
      const { state: resolved, chatLines } = await HighCardGame.resolve(state);
      state = resolved;
      for (const line of chatLines) this._sendChatMessage(line);
    } else if (state.gameType === "blackjack") {
      state = await BlackjackGame.deal(state);
    } else if (state.gameType === "poker") {
      state = await PokerGame.deal(state);
    }

    await this._gameState.set(state);
  }

  static _onHit(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.HIT);
  }

  static _onStand(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.STAND);
  }

  static _onDouble(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.DOUBLE);
  }

  static _onFold(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.FOLD);
  }

  static _onCheck(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.CHECK);
  }

  static _onCall(event, target) {
    this._sendPlayerAction(PLAYER_ACTIONS.CALL);
  }

  static async _onRaise(event, target) {
    const state   = await this._gameState.get();
    const minRaise = PokerGame.minRaise(state, game.userId);

    const amount = await new Promise(resolve => {
      new Dialog({
        title:   "Raise",
        content: `
          <div style="padding:8px;">
            <p>Raise to (total chips in this round):</p>
            <input type="number" id="raise-amount" value="${minRaise}" min="${minRaise}">
          </div>
        `,
        buttons: {
          raise:  { label: "Raise",  callback: html => resolve(parseInt(html.find("#raise-amount").val()) || minRaise) },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        default: "raise",
      }).render(true);
    });

    if (amount === null) return;
    this._sendPlayerAction(PLAYER_ACTIONS.RAISE, amount);
  }

  static async _onDealFlop(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();
    state = await PokerGame.dealFlop(state);
    await this._gameState.set(state);
    this._sendChatMessage("🃏 The Flop has been dealt.");
  }

  static async _onDealTurn(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();
    state = await PokerGame.dealTurn(state);
    await this._gameState.set(state);
    this._sendChatMessage("🃏 The Turn card has been dealt.");
  }

  static async _onDealRiver(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();
    state = await PokerGame.dealRiver(state);
    await this._gameState.set(state);
    this._sendChatMessage("🃏 The River card has been dealt.");
  }

  static async _onShowdown(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();
    const { state: resolved, chatLines } = await PokerGame.showdown(state);
    for (const line of chatLines) this._sendChatMessage(line);
    await this._gameState.set(resolved);
  }

  static async _onRunDealer(event, target) {
    if (!game.user.isGM) return;
    let state  = await this._gameState.get();
    const { state: resolved, chatLines } = await BlackjackGame.runDealerAndResolve(state);
    for (const line of chatLines) this._sendChatMessage(line);
    await this._gameState.set(resolved);
  }

  static async _onNewHand(event, target) {
    if (!game.user.isGM) return;
    let state = await this._gameState.get();

    const handIds = state.players.map(p => p.handId).filter(Boolean);
    await DeckManager.fullReset(state.deckId, handIds, [state.communityPileId].filter(Boolean));

    if (state.gameType === "highcard")  state = HighCardGame.prepareNewHand(state);
    if (state.gameType === "blackjack") state = BlackjackGame.prepareNewHand(state);
    if (state.gameType === "poker")     state = PokerGame.prepareNewHand(state);

    await this._gameState.set(state);
    this._sendChatMessage("🃏 A new hand has begun at The Degenerate Inn.");
  }

  static async _onDistributeChips(event, target) {
    if (!game.user.isGM) return;
    const state  = await this._gameState.get();
    const amount = await ChipManager.showDistributeDialog(state);
    if (!amount) return;

    for (const player of state.players) {
      player.chips = amount;
    }
    await this._gameState.set(state);
    ui.notifications.info(`Distributed ${amount} chips to all players.`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Send a player action — to GM via socket if player, or handle locally if GM. */
  _sendPlayerAction(action, amount = 0) {
    const payload = { tableId: this._tableId, userId: game.userId, action, amount };
    if (game.user.isGM) {
      this._gmHandleAction(payload);
    } else {
      game.degenerateInn.socket.requestAction(payload);
    }
  }

  _sendChatMessage(content) {
    ChatMessage.create({
      content: `<div class="degenerate-inn-chat"><i class="fas fa-diamond"></i> ${content}</div>`,
      speaker: { alias: "The Degenerate Inn" },
    });
  }

  _postChatUpdates(state) {
    // Post any pending chat messages derived from state changes
    // (called after action processing)
  }
}
