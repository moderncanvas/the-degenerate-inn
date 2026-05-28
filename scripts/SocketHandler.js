/**
 * SocketHandler.js — Real-time multiplayer sync.
 *
 * Only the GM client executes state changes. Players send requests via socket.
 * The GM processes the request, updates JournalEntry flags, and Foundry's own
 * document sync broadcasts the result to all clients automatically.
 *
 * Socket event format: { type: "ACTION_NAME", payload: { ...data } }
 */

import { MODULE_ID } from "./GameState.js";

export const SOCKET_EVENTS = {
  // Player → GM
  REQUEST_JOIN:       "REQUEST_JOIN",
  REQUEST_LEAVE:      "REQUEST_LEAVE",
  REQUEST_PLACE_BET:  "REQUEST_PLACE_BET",
  REQUEST_ACTION:     "REQUEST_ACTION",   // hit/stand/fold/call/check/raise

  // GM → All (broadcast confirmations / notifications)
  TABLE_UPDATED:      "TABLE_UPDATED",    // generic: UI should re-render
  CHAT_MESSAGE:       "CHAT_MESSAGE",     // log to chat
};

export const PLAYER_ACTIONS = {
  HIT:    "hit",
  STAND:  "stand",
  DOUBLE: "double",
  FOLD:   "fold",
  CHECK:  "check",
  CALL:   "call",
  RAISE:  "raise",
};

export class SocketHandler {
  constructor() {
    this._eventName = `module.${MODULE_ID}`;
    this._handlers  = {}; // Registered action handlers (set up by TableApp)
    this._init();
  }

  _init() {
    game.socket.on(this._eventName, ({ type, payload }) => {
      console.log(`[DI] Socket received: ${type}`, payload);
      this._dispatch(type, payload);
    });
  }

  /** Emit an event to all OTHER connected clients. */
  emit(type, payload = {}) {
    game.socket.emit(this._eventName, { type, payload });
  }

  /** Emit AND handle locally (so the emitting client also runs the handler). */
  emitAndHandle(type, payload = {}) {
    this.emit(type, payload);
    this._dispatch(type, payload);
  }

  /** Register a handler for an event type. */
  on(type, handler) {
    this._handlers[type] = handler;
  }

  /** Unregister a handler. */
  off(type) {
    delete this._handlers[type];
  }

  _dispatch(type, payload) {
    const handler = this._handlers[type];
    if (handler) {
      handler(payload).catch(err => console.error(`[DI] Socket handler error (${type}):`, err));
    }
  }

  // ─── Convenience senders ─────────────────────────────────────────────────

  /** Player requests to join a table. */
  requestJoin({ tableId, userId, actorId }) {
    this.emit(SOCKET_EVENTS.REQUEST_JOIN, { tableId, userId, actorId });
  }

  /** Player requests to leave a table. */
  requestLeave({ tableId, userId }) {
    this.emit(SOCKET_EVENTS.REQUEST_LEAVE, { tableId, userId });
  }

  /** Player submits their bet. */
  requestPlaceBet({ tableId, userId, amount }) {
    this.emit(SOCKET_EVENTS.REQUEST_PLACE_BET, { tableId, userId, amount });
  }

  /** Player takes an in-game action. */
  requestAction({ tableId, userId, action, amount }) {
    this.emit(SOCKET_EVENTS.REQUEST_ACTION, { tableId, userId, action, amount });
  }

  /** GM broadcasts that a table updated (clients re-render). */
  broadcastTableUpdate(tableId) {
    this.emit(SOCKET_EVENTS.TABLE_UPDATED, { tableId });
  }

  /** GM broadcasts a chat message to all clients. */
  broadcastChatMessage(content) {
    this.emitAndHandle(SOCKET_EVENTS.CHAT_MESSAGE, { content });
  }
}
