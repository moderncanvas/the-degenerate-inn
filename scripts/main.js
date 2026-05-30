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

  // Nuclear option: attach a floating launch button directly to document.body.
  // This cannot be wiped by any Foundry re-render because it lives outside
  // the sidebar DOM entirely. Always visible, always clickable.
  _injectFloatingButton();

  // Also try the sidebar injection as a bonus (may or may not work in v13).
  _injectDinnButton();
  setTimeout(_injectDinnButton, 1000);
  setTimeout(_injectDinnButton, 3000);
});

// ─── UI Injection ─────────────────────────────────────────────────────────────

/**
 * Inject a floating launch button directly onto document.body.
 * Fixed-position, always visible, completely immune to Foundry re-renders.
 */
function _injectFloatingButton() {
  if (document.querySelector(".dinn-launch-fab")) return;

  const btn = document.createElement("button");
  btn.className = "dinn-launch-fab";
  btn.type      = "button";
  btn.title     = "The Degenerate Inn";
  btn.innerHTML = `<i class="fas fa-diamond"></i>`;
  btn.addEventListener("click", () => new LobbyApp().render(true));

  document.body.appendChild(btn);
  console.log("The Degenerate Inn | Floating button injected.");
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
  if (!el) el = document.querySelector("#cards");
  if (!el) return;

  // Only inject if the panel is currently visible
  if (el.style.display === "none" || el.hidden) return;

  // Don’t add twice
  if (el.querySelector(".dinn-open-btn")) return;

  const btn = document.createElement("button");
  btn.className     = "dinn-open-btn";
  btn.type          = "button";
  btn.title         = "Open The Degenerate Inn";
  btn.innerHTML     = `<i class="fas fa-diamond"></i> The Degenerate Inn`;
  btn.style.cssText = "width:calc(100% - 8px);margin:4px 4px 0;display:block;";
  btn.addEventListener("click", () => new LobbyApp().render(true));

  // Try every known selector for v12/v13 sidebar header structures
  const header = el.querySelector("header")
    ?? el.querySelector(".directory-header")
    ?? el.querySelector(".application-header");
  const footer = el.querySelector("footer")
    ?? el.querySelector(".direct