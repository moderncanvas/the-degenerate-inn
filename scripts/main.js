/**
 * main.js — The Degenerate Inn
 *
 * Entry point for the module. Registers settings, initializes the socket handler,
 * and injects the "Open Table" button into Foundry's UI.
 *
 * Import chain: main.js → SocketHandler, LobbyApp, TableApp (etc.)
 * Foundry loads this as an ES module (declared in module.json's "esmodules").
 */

import { SocketHandler, SOCKET_EVENTS } from "./SocketHandler.js";
import { LobbyApp } from "./ui/LobbyApp.js";
import { MODULE_ID } from "./GameState.js";
import { registerHandlebarsHelpers } from "./helpers.js";

// ─── Settings ─────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  console.log("The Degenerate Inn | Initializing — pull up a stool.");
  registerHandlebarsHelpers();

  game.settings.register(MODULE_ID, "chipMode", {
    name:    "DINN.Settings.ChipMode",
    hint:    "DINN.Settings.ChipModeHint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      virtual: "DINN.Settings.ChipModeVirtual",
      gp:      "DINN.Settings.ChipModeGP",
    },
    default: "virtual",
  });

  game.settings.register(MODULE_ID, "startingChips", {
    name:    "DINN.Settings.StartingChips",
    hint:    "DINN.Settings.StartingChipsHint",
    scope:   "world",
    config:  true,
    type:    Number,
    default: 100,
    range:   { min: 10, max: 10000, step: 10 },
  });

  game.settings.register(MODULE_ID, "cardBack", {
    name:    "DINN.Settings.CardBack",
    hint:    "DINN.Settings.CardBackHint",
    scope:   "world",
    config:  true,
    type:    Number,
    choices: { 1: "Back 1", 2: "Back 2", 3: "Back 3", 4: "Back 4" },
    default: 1,
  });

  // Pre-load card templates so they render fast
  loadTemplates([
    `modules/${MODULE_ID}/templates/lobby.hbs`,
    `modules/${MODULE_ID}/templates/table.hbs`,
  ]);
});

// ─── Ready ────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  // Expose the module API globally
  game.degenerateInn = {
    socket:    new SocketHandler(),
    openLobby: () => new LobbyApp().render(true),
  };

  // Register chat message listener for broadcast chat
  game.degenerateInn.socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async ({ content }) => {
    // Non-GM clients just see the message (GM already created it locally)
    if (!game.user.isGM) {
      await ChatMessage.create({
        content: `<div class="degenerate-inn-chat"><i class="fas fa-diamond"></i> ${content}</div>`,
        speaker: { alias: "The Degenerate Inn" },
      });
    }
  });

  console.log("The Degenerate Inn | Ready. Cards are on the table.");

  // Floating button on document.body — immune to Foundry re-renders.
  // Positioned in the lower-left canvas area, clear of sidebar and hotbar.
  _injectFloatingButton();

  // Button in the chat panel — always visible since chat is the default tab.
  _injectChatButton();
  setTimeout(_injectChatButton, 500);

  // Bonus: try sidebar injection too.
  _injectDinnButton();
  setTimeout(_injectDinnButton, 1000);
  setTimeout(_injectDinnButton, 3000);
});

// ─── UI Injection ─────────────────────────────────────────────────────────────

/**
 * Inject a floating launch button directly onto document.body.
 * Positioned in the lower-left canvas area, well clear of sidebar and hotbar.
 * Fixed-position, always visible, completely immune to Foundry re-renders.
 */
function _injectFloatingButton() {
  if (document.querySelector(".dinn-launch-fab")) return;

  const btn = document.createElement("button");
  btn.className = "dinn-launch-fab";
  btn.type      = "button";
  btn.title     = "The Degenerate Inn";
  btn.innerHTML = `<i class="fas fa-gem"></i> Degenerate Inn`;
  btn.addEventListener("click", () => new LobbyApp().render(true));

  document.body.appendChild(btn);
  console.log("The Degenerate Inn | Floating button injected.");
}

/**
 * Inject a button at the top of the chat panel — the default active tab.
 * Chat is always visible when Foundry loads, so this covers the common case.
 */
function _injectChatButton() {
  const chatPanel = document.querySelector("#chat") ?? document.querySelector("section[id='chat']");
  if (!chatPanel) return;
  if (chatPanel.querySelector(".dinn-chat-btn")) return;

  const btn = document.createElement("button");
  btn.className = "dinn-chat-btn";
  btn.type      = "button";
  btn.innerHTML = `<i class="fas fa-gem"></i> Open The Degenerate Inn`;
  btn.addEventListener("click", () => new LobbyApp().render(true));

  // Put it right at the top of the chat panel, before anything else
  chatPanel.prepend(btn);
  console.log("The Degenerate Inn | Chat panel button injected.");
}

/** Inject a button inside the Cards sidebar panel content area (bonus attempt). */
function _injectDinnButton() {
  // Locate the Cards panel element across v12/v13 structures
  let el = null;
  if (ui.cards) {
    el = ui.cards.element instanceof HTMLElement
      ? ui.cards.element
      : (ui.cards.element?.[0] ?? null);
  }
  if (!el