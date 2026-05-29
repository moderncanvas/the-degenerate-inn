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

  // Inject the sidebar button on load, then again after a short delay
  // in case the Cards sidebar renders after the ready hook fires
  _injectDinnButton();
  setTimeout(_injectDinnButton, 1000);
  setTimeout(_injectDinnButton, 3000);
});

// ─── UI Injection ─────────────────────────────────────────────────────────────

function _injectDinnButton() {
  // Try ui.cards first (works in v12 + v13), fall back to direct DOM query
  let el = null;
  if (ui.cards) {
    el = ui.cards.element instanceof HTMLElement
      ? ui.cards.element
      : (ui.cards.element?.[0] ?? null);
  }
  if (!el) el = document.querySelector("#cards");
  if (!el) return;

  // Don't add twice
  if (el.querySelector(".dinn-open-btn")) return;

  const btn = document.createElement("button");
  btn.className     = "dinn-open-btn";
  btn.type          = "button";
  btn.title         = "Open The Degenerate Inn";
  btn.innerHTML     = `<i class="fas fa-diamond"></i> The Degenerate Inn`;
  btn.style.cssText = "width:100%;margin-top:4px;";
  btn.addEventListener("click", () => new LobbyApp().render(true));

  // Try every known selector across v12 / v13 sidebar HTML structures
  const footer = el.querySelector(".directory-footer") ?? el.querySelector("footer");
  const header = el.querySelector(".directory-header") ?? el.querySelector("header");

  if (footer)      footer.before(btn);
  else if (header) header.after(btn);
  else             el.appendChild(btn);

  console.log("The Deg