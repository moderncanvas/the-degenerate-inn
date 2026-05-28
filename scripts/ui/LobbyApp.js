/**
 * LobbyApp.js — The table browser.
 *
 * Players see active tables and can join. The GM can create new tables.
 * This is the entry point — it opens when you click the card icon in Foundry.
 */

import { MODULE_ID } from "../GameState.js";
import { TableRegistry } from "../GameState.js";
import { TableApp } from "./TableApp.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LobbyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "degenerate-inn-lobby",
    title:    "The Degenerate Inn",
    classes:  ["degenerate-inn", "lobby"],
    position: { width: 480, height: "auto" },
    window: {
      icon:       "fas fa-diamond",
      resizable:  false,
    },
    actions: {
      createTable:  LobbyApp._onCreateTable,
      joinTable:    LobbyApp._onJoinTable,
      deleteTable:  LobbyApp._onDeleteTable,
    },
  };

  static PARTS = {
    lobby: {
      template: `modules/${MODULE_ID}/templates/lobby.hbs`,
    },
  };

  async _prepareContext(options) {
    const tables   = await TableRegistry.getAll();
    const isGM     = game.user.isGM;
    const gameTypes = {
      highcard:  "High Card",
      blackjack: "Blackjack",
      poker:     "Texas Hold'em",
    };

    return {
      tables: tables.map(t => ({
        ...t,
        gameLabel:  gameTypes[t.gameType] ?? t.gameType,
        canDelete:  isGM,
        playerText: `${t.players}/4 players`,
      })),
      isGM,
      hasTables: tables.length > 0,
      gameTypes,
    };
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  static async _onCreateTable(event, target) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("DINN.Error.NotGM"));
      return;
    }

    // Pick game type via dialog
    const gameType = await LobbyApp._pickGameType();
    if (!gameType) return;

    // Set ante for poker
    let ante = 5;
    if (gameType === "poker") {
      ante = await LobbyApp._pickAnte() ?? 5;
    }

    await TableApp.createAndOpen({ gameType, ante });
    this.render(); // refresh lobby
  }

  static async _onJoinTable(event, target) {
    const tableId = target.closest("[data-table-id]")?.dataset.tableId;
    if (!tableId) return;

    const tables = await TableRegistry.getAll();
    const entry  = tables.find(t => t.tableId === tableId);
    if (!entry) {
      ui.notifications.warn("That table no longer exists.");
      this.render();
      return;
    }

    await TableApp.openForTable(tableId, entry.journalId, entry.gameType);
  }

  static async _onDeleteTable(event, target) {
    if (!game.user.isGM) return;
    const tableId   = target.closest("[data-table-id]")?.dataset.tableId;
    const journalId = target.closest("[data-table-id]")?.dataset.journalId;
    if (!tableId) return;

    const confirm = await Dialog.confirm({
      title:   "Close Table",
      content: "Close this table and remove it from the lobby? Players at the table will be disconnected.",
    });
    if (!confirm) return;

    await TableRegistry.unregister(tableId);
    // Delete the journal entry
    const journal = game.journal.get(journalId);
    if (journal) await journal.delete();

    this.render();
  }

  // ─── Dialogs ───────────────────────────────────────────────────────────────

  static _pickGameType() {
    return new Promise(resolve => {
      new Dialog({
        title:   "Choose Game",
        content: `
          <div style="padding:8px;">
            <p>What game will you play?</p>
          </div>
        `,
        buttons: {
          highcard:  { label: "🃏 High Card",       callback: () => resolve("highcard") },
          blackjack: { label: "♠ Blackjack",        callback: () => resolve("blackjack") },
          poker:     { label: "🂡 Texas Hold'em",   callback: () => resolve("poker") },
          cancel:    { label: "Cancel",              callback: () => resolve(null) },
        },
        default: "blackjack",
      }).render(true);
    });
  }

  static _pickAnte() {
    return new Promise(resolve => {
      new Dialog({
        title:   "Set Ante",
        content: `
          <div style="padding:8px;">
            <p>Ante amount per hand:</p>
            <input type="number" id="ante-amount" value="5" min="1" style="width:80px;">
          </div>
        `,
        buttons: {
          ok:     { label: "Set",    callback: html => resolve(parseInt(html.find("#ante-amount").val()) || 5) },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        default: "ok",
      }).render(true);
    });
  }
}
