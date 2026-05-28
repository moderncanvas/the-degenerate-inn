/**
 * ChipManager.js — Handles chips in two modes:
 *
 * "virtual" mode: chips exist only at the table. GM distributes them at session start.
 * "gp"      mode: chips are read from and written back to the actor's GP field.
 *
 * The GM controls which mode is active via module settings.
 */

import { MODULE_ID } from "./GameState.js";

export class ChipManager {
  static get mode() {
    return game.settings.get(MODULE_ID, "chipMode") ?? "virtual";
  }

  static get startingChips() {
    return game.settings.get(MODULE_ID, "startingChips") ?? 100;
  }

  /**
   * Get a player's current chip count.
   * In GP mode, reads from the actor. Otherwise returns the stored value.
   */
  static getChips(player) {
    if (this.mode === "gp" && player.actorId) {
      const actor = game.actors.get(player.actorId);
      return actor?.system?.currency?.gp ?? player.chips;
    }
    return player.chips;
  }

  /**
   * Apply a chip delta to a player in GP mode (subtract bets, add winnings).
   * In virtual mode this is a no-op since state.chips handles it.
   *
   * @param {object} player   - Player object from game state
   * @param {number} delta    - Positive = gain, negative = loss
   */
  static async applyGPDelta(player, delta) {
    if (this.mode !== "gp" || !player.actorId) return;
    const actor = game.actors.get(player.actorId);
    if (!actor) return;
    const current = actor.system.currency.gp ?? 0;
    const newGP   = Math.max(0, current + delta);
    await actor.update({ "system.currency.gp": newGP });
  }

  /**
   * Build a starting chip count for a player joining a table.
   * In GP mode, mirrors their current gold. In virtual mode, uses the setting.
   */
  static startingChipCount(actorId) {
    if (this.mode === "gp" && actorId) {
      const actor = game.actors.get(actorId);
      return actor?.system?.currency?.gp ?? this.startingChips;
    }
    return this.startingChips;
  }

  /**
   * Transfer chips after a round resolves. Updates both in-memory state
   * and (if GP mode) the actor's currency.
   *
   * @param {object[]} players   - Full players array from game state
   * @param {object[]} payouts   - [{userId, delta}] — delta = chips gained/lost this round
   * @returns {object[]}         - Updated players array
   */
  static async applyPayouts(players, payouts) {
    for (const payout of payouts) {
      const player = players.find(p => p.userId === payout.userId);
      if (!player) continue;
      player.chips = Math.max(0, (player.chips ?? 0) + payout.delta);
      await this.applyGPDelta(player, payout.delta);
    }
    return players;
  }

  /**
   * Show a dialog for the GM to distribute chips to all seated players.
   * Only available in virtual mode.
   */
  static async showDistributeDialog(state) {
    if (this.mode === "gp") {
      ui.notifications.info("GP mode: chips are pulled directly from character gold.");
      return null;
    }

    return new Promise(resolve => {
      const currentAmount = state.players[0]?.chips ?? this.startingChips;
      new Dialog({
        title: "Distribute Chips",
        content: `
          <div style="padding:8px;">
            <p>Set chip count for all seated players.</p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label>Chips each:</label>
              <input type="number" id="chip-amount" value="${currentAmount}" min="1" style="width:80px;">
            </div>
          </div>
        `,
        buttons: {
          distribute: {
            icon:  '<i class="fas fa-coins"></i>',
            label: "Distribute",
            callback: html => resolve(parseInt(html.find("#chip-amount").val()) || currentAmount),
          },
          cancel: {
            icon:  '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null),
          },
        },
        default: "distribute",
      }).render(true);
    });
  }
}
