# Farkle Server State Schema

This document defines the **authoritative in-memory state shape** used by the Node.js server. All gameplay logic operates exclusively on this state. Clients are views/controllers only.

This schema is written in JavaScript-like notation but is intended as a **conceptual contract**, not a literal TypeScript definition.

---

## 1. Top-Level Server State

```js
ServerState = {
  game: GameState | null,
  eventLogEnabled: boolean,
  eventLog: EventLogEntry[]
}
```

- `game === null` indicates no active game (idle phase)
- Only one game may exist at a time

---

## 2. GameState

```js
GameState = {
  gameId: string,
  phase: 'lobby' | 'in_progress' | 'finished',

  config: GameConfig,

  players: PlayerState[],
  turnOrder: string[],      // array of playerIds
  activeTurnIndex: number,  // index into turnOrder

  turn: TurnState | null,

  createdAt: number,        // timestamp
  finishedAt: number | null
}
```

---

## 3. GameConfig

```js
GameConfig = {
  minimumEntryScore: number // default 500
}
```

Configured during lobby phase only.

---

## 4. PlayerState

```js
PlayerState = {
  playerId: string,
  playerSecret: string,

  name: string,

  totalScore: number,
  hasEnteredGame: boolean, // true once minimum entry score reached

  connected: boolean,

  joinedAt: number
}
```

Notes:
- `hasEnteredGame` prevents banking scores below minimum
- Duplicate player names are undefined behavior

---

## 5. TurnState

```js
TurnState = {
  playerId: string,

  dice: DieState[],
  accumulatedTurnScore: number,

  selection: DiceSelectionState,

  status: 'awaiting_selection' | 'awaiting_roll' | 'awaiting_bank'
}
```

Only one `TurnState` exists at a time.

---

## 6. DieState

```js
DieState = {
  value: 1 | 2 | 3 | 4 | 5 | 6,
  selectable: boolean // false if already locked from previous rolls
}
```

- Dice are regenerated on hot dice
- Non-selectable dice cannot be toggled

---

## 7. DiceSelectionState

```js
DiceSelectionState = {
  selectedIndices: number[], // indexes into dice array

  isValid: boolean,
  selectionScore: number
}
```

- Updated on every toggle
- `isValid === false` disables roll/bank
- `selectionScore` is computed live

---

## 8. EventLogEntry (Debug Only)

```js
EventLogEntry = {
  timestamp: number,
  type: string,
  payload: object
}
```

Examples:
- `DICE_ROLL`
- `SELECTION_CHANGED`
- `TURN_ENDED`
- `ILLEGAL_ACTION`

Event log is in-memory only and optional.

---

## 9. State Invariants

The server must enforce the following invariants at all times:

- Exactly one active player during `in_progress`
- Only active player may modify `TurnState`
- `turn === null` unless `phase === 'in_progress'`
- No player actions accepted unless `phase === 'in_progress'`
- `turnOrder.length === players.length`
- `activeTurnIndex` always valid

---

## 10. State Reset

Invoking **Start New Game**:

- Clears entire `ServerState.game`
- Invalidates all player identities
- Clears `eventLog`
- Creates a new `GameState` in `lobby` phase

---

## 11. Derived / Computed Data (Not Stored)

The following should be computed on demand, not stored:

- Current active player object
- Whether a player may bank
- Whether hot dice occurred
- Whether game end condition is met

---

## 12. Extension Points (Optional)

These fields are intentionally omitted but may be added later:

- Turn timer
- Max score / win condition variants
- Multiple rounds

---

## 13. Serialization

- Entire `GameState` must be serializable to JSON
- Used for:
  - TV client rehydration
  - Phone client reconnection

---

## 14. Authoritative Source

This schema is the authoritative reference for:
- Game engine logic
- WebSocket message payloads
- Client rendering logic

Any deviation requires updating this document.

