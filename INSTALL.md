# The Degenerate Inn — Installation

## Quick Install

1. Copy the entire `the-degenerate-inn` folder to your Foundry modules directory:
   ```
   C:\Users\jwise\AppData\Local\FoundryVTT\Data\modules\the-degenerate-inn\
   ```

2. Launch Foundry → Setup → Add-on Modules → find **The Degenerate Inn** → Enable it in your world.

3. Reload the world. Done.

## Where the Module Lives

Your Foundry `Data/modules/` folder. The final path should look like:
```
FoundryVTT/
  Data/
    modules/
      the-degenerate-inn/
        module.json         ← Foundry reads this
        scripts/
        styles/
        templates/
        assets/
          cards/            ← 57 card images (already included)
        lang/
```

## Opening The Degenerate Inn

Two ways to open it in Foundry:

**Option A:** Click the **Cards** tab in the right sidebar → click the green "The Degenerate Inn" button at the top.

**Option B:** Go to the Scene Controls (left toolbar) → Token layer → find the diamond icon.

**Option C:** Run this macro in Foundry:
```js
game.degenerateInn.openLobby();
```

## How to Play

### GM Side
1. Open The Degenerate Inn → Create New Table → choose a game
2. Set chip amount if needed (gear icon → Module Settings, or use the Chips button in the table)
3. Players join via the lobby
4. Click **Deal** to start a hand
5. You control the pace: Deal Flop / Turn / River for poker, Run Dealer Hand for blackjack

### Player Side
1. Open The Degenerate Inn → Join a table
2. Click **Sit Down**
3. Place your bet when the betting phase opens
4. Take your actions when it's your turn (the table will glow gold)

## Settings

In Foundry → Module Settings → The Degenerate Inn:

| Setting | Options | Default |
|---|---|---|
| Chip Mode | Virtual / Gold Pieces | Virtual |
| Starting Chips | Any number | 100 |
| Card Back Style | 1, 2, 3, or 4 | 1 |

**Virtual mode:** Chips are only tracked at the table. GM distributes them via the Chips button.

**GP mode:** Chips are pulled from and written back to each player's character's Gold Pieces field. Wins and losses update real currency.

## Games

### High Card
Everyone draws one card. Highest wins. Ties split the pot. Simple, fast, good for quick bets.

### Blackjack
Standard rules. Hit, Stand, Double Down. Dealer hits on 16 or below, stands on 17+. Natural blackjack (Ace + face card) pays 3:2.

### Texas Hold'em
Full poker. Players get 2 hole cards (private), 5 community cards come out over 3 GM-triggered streets (Flop, Turn, River). Betting rounds between each street. Best 5-of-7 hand wins the pot. All hand ranks supported: Royal Flush through High Card.

## Troubleshooting

**Cards showing as broken images:** Make sure the `assets/cards/` folder contains all 57 `.png` files. They should have been included automatically.

**Players can't see the lobby:** Have them open the Cards sidebar and click the green button.

**State not syncing:** This is usually a permission issue. Make sure the GM is the active GM user and is connected.

**Module not appearing in the list:** Confirm `module.json` is directly inside the `the-degenerate-inn` folder (not in a subfolder).
