# Farkle Turn Lifecycle Walkthrough

This document describes the **end-to-end lifecycle of a single turn** in the game, including all normal and edge-case paths. It is intended to guide server-side state transitions and client UI behavior.

This walkthrough assumes compliance with:
- Server State Schema
- WebSocket Event Schema
- Dice Scoring Rules

---

## 1. Turn Initialization

**Trigger:**
- Game transitions from `lobby` → `in_progress`, or
- Previous player banks or busts

**Server actions:**

```text
- activeTurnIndex incremented (or set to 0 at game start)
- active player determined via turnOrder
- TurnState created
```

**Initial TurnState:**

```js
{
  playerId: <activePlayerId>,
  dice: rollSixDice(),
  accumulatedTurnScore: 0,
  selection: {
    selectedIndices: [],
    isValid: false,
    selectionScore: 0
  },
  status: 'awaiting_selection'
}
```

**Client behavior:**
- TV displays active player and dice
- Phone client enables dice toggling

**Server auto-selection:**
- Immediately after initializing dice, the server computes the largest valid scoring selection (if any) and applies it.
- If a valid selection exists, `selection` is populated and `status` transitions to `awaiting_roll`.
- If no valid selection exists, `selection` remains empty and `status` stays `awaiting_selection`.
- Roll/Bank disabled

---

## 2. Dice Selection Phase

**Trigger:**
- Active player toggles dice selection

**Event:**
- `toggle_die_selection`

**Server actions:**

```text
- Toggle selected die index
- Recompute selection validity and score
- Update TurnState.selection
- Broadcast game_state
```

**Possible outcomes:**

| Condition | UI Result |
|--------|----------|
| No dice selected | Roll/Bank disabled |
| Invalid selection | Roll/Bank disabled |
| Valid selection | Roll and/or Bank enabled |

---

## 3. Roll Dice Path (Happy Path)

**Trigger:**
- Active player clicks Roll

**Event:**
- `roll_dice`

**Server preconditions:**
- Selection is valid
- Player is active

**Server actions:**

```text
1. Add selectionScore to accumulatedTurnScore
2. Lock selected dice
3. Roll remaining dice
4. Clear selection
5. Evaluate new roll and apply auto-selection default
```

### 3.1 Bust Check

**Condition:**
- New roll produces no scoring combinations

**Result (Bust):**

```text
- accumulatedTurnScore reset to 0
- TurnState discarded
- Turn ends immediately
- Next player's turn begins
```

**Client behavior:**
- TV shows bust indication
- No player input accepted during transition

---

### 3.2 Continue Turn (No Bust)

**Condition:**
- At least one scoring combination exists

**Server actions:**

```text
- Update TurnState.dice
- Compute and apply auto-selection for the new roll
- If a valid selection exists, status = 'awaiting_roll'; otherwise 'awaiting_selection'
- Broadcast game_state
```

**Client behavior:**
- Dice toggling enabled again

---

## 4. Hot Dice Path

**Trigger:**
- After a roll, all dice are consumed in scoring

**Server actions:**

```text
- accumulatedTurnScore preserved
- Dice pool reset to 6 new dice
- All dice selectable
- selection cleared
```

**TurnState after hot dice:**

```js
{
  dice: rollSixDice(),
  accumulatedTurnScore: <preserved>,
  selection: empty,
  status: 'awaiting_selection' (then auto-selection applied; may transition to 'awaiting_roll')
}
```

**Client behavior:**
- TV announces hot dice
- Player may roll again or bank

---

## 5. Bank Score Path

**Trigger:**
- Active player clicks Bank

**Event:**
- `bank_score`

**Server preconditions:**
- Selection is valid OR accumulatedTurnScore > 0
- If the player has not yet entered, the current bank amount must meet or exceed the minimum entry score

**Server actions:**

```text
1. Add accumulatedTurnScore (+ selectionScore if applicable) to player's totalScore
2. If banked amount >= minimumEntryScore (and player not yet entered), set hasEnteredGame = true
3. Discard TurnState
4. Advance activeTurnIndex
5. Begin next player's turn
```

**Client behavior:**
- TV updates scoreboard
- Active player indicator moves

---

## 6. Minimum Entry Score Edge Case

**Scenario:**
- Player attempts to bank below the minimum entry score before entering the game

**Result:**

```text
- Bank action rejected
- Error event emitted
- Turn continues
```

Client UI should normally prevent this action.

Once the player has completed a qualifying bank, subsequent banks of any positive value succeed.

---

## 7. Player Disconnect Mid-Turn

**Trigger:**
- Active player's socket disconnects

**Server actions:**

```text
- Mark player as disconnected
- Preserve TurnState
- Pause turn indefinitely
```

**Client behavior:**
- TV indicates disconnected player
- No automatic progression

Turn resumes immediately upon successful reconnection.

---

## 8. Game End Detection

**Trigger:**
- A player reaches or exceeds the win condition (e.g., first to 10,000)

**Server actions:**

```text
- Complete current turn
- Set phase = 'finished'
- finishedAt timestamp set
- Reject further gameplay actions
```

**Client behavior:**
- Final scores displayed
- Only Start New Game allowed

---

## 9. Illegal Action Handling

At any point, if an illegal action is received:

```text
- Reject action
- Log ILLEGAL_ACTION event
- Emit error to offending client
- Do not modify state
```

---

## 10. Turn Lifecycle Summary Diagram (Textual)

```text
START TURN
  ↓
ROLL (initial)
  ↓
SELECT DICE
AUTO-SELECTION (if any) → SELECT DICE
  ↓
ROLL ──► BUST ──► NEXT PLAYER
  ↓
HOT DICE?
  ├─ Yes → RESET DICE → SELECT DICE
  └─ No
  ↓
BANK → NEXT PLAYER
```

---

## 11. Authoritative Reference

This document is authoritative for:
- Turn sequencing logic
- UI enable/disable behavior
- Handling disconnects and edge cases

All turn-related logic must conform to this walkthrough.
