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
    openLobby: () => new LobbyApp().render({ force: true }),
  };

  // Register chat message listener for broadcast chat
  game.degenerateInn.socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async ({ content }) => {
    // Non-GM clients just see the message (GM already created it locally)
    if (!game.user.isGM) {
      await ChatMessage.create({
        content: `<div class="degenerate-inn-chat"><i class="fas fa-gem"></i> ${content}</div>`,
        speaker: { alias: "The Degenerate Inn" },
      });
    }
  });

  console.log("The Degenerate Inn | Ready. Cards are on the table.");

  // Visual confirmation that the module loaded (shows briefly in the UI)
  ui.notifications?.info("🎰 The Degenerate Inn is open for business.");

  // ── Inject UI entry points ──────────────────────────────────────────────────
  // Strategy 1: Floating button on document.body (always visible, CSS-immune)
  _injectFloatingButton();

  // Strategy 2: Button inside the chat panel (always rendered, default tab)
  _injectChatButton();
  setTimeout(_injectChatButton, 500);

  // Strategy 3: Create/update a Macro so there's always a reliable launcher
  if (game.user.isGM) _ensureLaunchMacro();
});

// ─── Scene Control Button (v13) ───────────────────────────────────────────────
// In Foundry v13, getSceneControlButtons passes a Record<string, SceneControl>
// (an object keyed by control name), NOT an array.
// Tools are added as properties on controls.tokens.tools, using onChange (not onClick).
Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls?.tokens?.tools) return;
  controls.tokens.tools.degenerateInn = {
    name:    "degenerateInn",
    title:   "The Degenerate Inn",
    icon:    "fa-solid fa-gem",
    order:   Object.keys(controls.tokens.tools).length,
    button:  true,
    visible: true,
    onChange: () => game.degenerateInn?.openLobby(),
  };
});

// Re-inject chat button when the chat panel re-renders
Hooks.on("renderChatLog",       () => _injectChatButton());
Hooks.on("renderChatDirectory", () => _injectChatButton());
Hooks.on("changeSidebarTab",    () => _injectChatButton());

// ─── UI Injection ─────────────────────────────────────────────────────────────

/**
 * Inject a floating launch button directly onto document.body.
 * Uses inline styles so it works even if the CSS file fails to load.
 * Fixed-position, always visible, completely immune to Foundry re-renders.
 */
function _injectFloatingButton() {
  if (document.querySelector(".dinn-launch-fab")) return;

  const btn = document.createElement("button");
  btn.className = "dinn-launch-fab";
  btn.type      = "button";
  btn.title     = "The Degenerate Inn";
  btn.innerHTML = `<i class="fa-solid fa-gem"></i> Degenerate Inn`;

  // Inline styles as a hard f