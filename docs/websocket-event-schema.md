# Farkle WebSocket Event Schema

This document defines all **Socket.IO WebSocket events** used by the system. It specifies direction, payload shape, and server-side validation rules.

This schema is authoritative and must align with the **Server State Schema** document.

---

## 1. General Principles

- All events are **named** Socket.IO events (no generic message bus)
- Server is authoritative
- Server validates **phase**, **player identity**, and **turn ownership** for every event
- Illegal events are rejected and logged
- All server-to-client state updates send the **full GameState snapshot**

---

## 2. Connection & Reconnection Events

### 2.1 `connect`

**Direction:** Client → Server (implicit)

Handled automatically by Socket.IO.

---

### 2.2 `reconnect_player`

**Direction:** Client → Server (phone only)

```js
{
  gameId: string,
  playerId: string,
  playerSecret: string
}
```

**Server behavior:**
- Validate identity
- Mark player as connected
- Re-associate socket with playerId
- Emit `game_state`

---

### 2.3 `disconnect`

**Direction:** Client → Server (implicit)

**Server behavior:**
- Mark player as disconnected
- If active player, pause turn indefinitely
- Broadcast updated `game_state`

---

## 3. Server → Client Broadcast Events

### 3.1 `game_state`

**Direction:** Server → All Clients

```js
GameState
```

Sent when:
- Client connects or reconnects
- Any meaningful state change occurs
- TV client reloads

Notes:
- Includes `TurnState.selection` reflecting server-applied auto-selection (if any).

This is the *only* event clients use to render state.

---

### 3.2 `error`

**Direction:** Server → Client (targeted)

```js
{
  code: string,
  message: string
}
```

Used for:
- Illegal actions
- Invalid reconnection attempts
- Phase violations

Errors are primarily diagnostic.

---

## 4. Lobby Phase Events

### 4.1 `join_game`

**Direction:** Client → Server (phone only)

```js
{
  gameId: string,
  name: string
}
```

**Preconditions:**
- `phase === 'lobby'`

**Server behavior:**
- Create PlayerState
- Assign `playerId` and `playerSecret`
- Emit `join_success` (targeted)
- Broadcast updated `game_state`

---

### 4.2 `join_success`

**Direction:** Server → Client (targeted)

```js
{
  playerId: string,
  playerSecret: string
}
```

---

### 4.3 `start_game`

**Direction:** Client → Server (TV only)

```js
{}
```

**Preconditions:**
- `phase === 'lobby'`
- At least one player joined

**Server behavior:**
- Randomize turn order
- Initialize TurnState
- Transition phase to `in_progress`
- Broadcast `game_state`

---

## 5. In-Progress Phase Events (Gameplay)

### 5.1 `toggle_die_selection`

**Direction:** Client → Server (active phone only)

```js
{
  dieIndex: number
}
```

**Preconditions:**
- `phase === 'in_progress'`
- Sender is active player
- Die is selectable

**Server behavior:**
- Toggle selection
- Recompute DiceSelectionState
- Broadcast `game_state`

---

### 5.2 `roll_dice`

**Direction:** Client → Server (active phone only)

```js
{}
```

**Preconditions:**
- Valid dice selection
- Sender is active player

**Server behavior:**
- Commit selection score
- Roll remaining dice
- Detect hot dice
- Update TurnState
- Broadcast `game_state`

---

### 5.3 `bank_score`

**Direction:** Client → Server (active phone only)

```js
{}
```

**Preconditions:**
- Valid dice selection OR accumulatedTurnScore > 0
- If the player has not yet entered, the current banked amount must meet or exceed the minimum entry score

**Server behavior:**
- Add accumulatedTurnScore (+ selectionScore if applicable) to player total
- Mark player as entered once they bank at least the minimum entry score in a single turn
- Advance turn
- Reset TurnState
- Broadcast `game_state`

---

## 6. Finished Phase Events

### 6.1 `acknowledge_results`

**Direction:** Client → Server (optional, phone)

```js
{}
```

Optional and informational only.

---

## 7. Administrative Events

### 7.1 `reset_game`

**Direction:** Client → Server (TV only)

```js
{}
```

**Server behavior:**
- Clear entire ServerState.game
- Clear event log
- Create new GameState in `lobby`
- Broadcast `game_state`

---

## 8. Illegal Event Handling

For any invalid event:

- Server rejects event
- Logs `ILLEGAL_ACTION` to event log
- Emits `error` to offending client
- Does not mutate state

---

## 9. Ordering Guarantees

- Events are processed sequentially by Node.js
- State mutations are atomic per event
- Clients must not assume optimistic success

---

## 10. Client Rendering Contract

Clients must:

- Treat `game_state` as the single source of truth
- Never infer state transitions
- Disable UI actions based on state fields

---

## 11. Extension Hooks (Non-Implemented)

Reserved event names:

- `spectator_join`
- `pause_game`
- `resume_game`

Not implemented in current scope.

---

## 12. Authoritative Reference

This event schema is authoritative for:
- Server event handlers
- Client emit logic
- Debug logging

Any gameplay change requires updating this document first.
