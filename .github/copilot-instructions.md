# Farkle Codebase Instructions

## Architecture Overview

This is a local-network multiplayer Farkle dice game with **server-authoritative** design:
- **Server** (`server/`): Node.js + Express, all game logic lives here
- **TV Client** (`tv-client/`): Display-only after game start, shows QR code for joining
- **Phone Client** (`phone-client/`): One per player, handles dice selection and actions
- **Communication**: SSE (server→client) + REST API (client→server), NOT WebSocket

Key constraint: Only one game exists at a time, all state is in-memory (no persistence).

## Documentation Authority

The `docs/` folder contains **authoritative specifications**—always consult before implementing:
- [design.md](docs/design.md) — Overall architecture and game rules
- [server-state-schema.md](docs/server-state-schema.md) — Exact state shape (`GameState`, `TurnState`, etc.)
- [sse-rest-api-schema.md](docs/sse-rest-api-schema.md) — All SSE events and REST endpoints
- [dice-scoring-rules.md](docs/dice-scoring-rules.md) — Scoring combinations and authoritative values (see doc for n-of-a-kind fixed scores)
- [turn-lifecycle-walkthrough.md](docs/turn-lifecycle-walkthrough.md) — Turn flow and state transitions

**Never invent behavior**—resolve ambiguity by referencing these docs.

## Server Module Responsibilities

| File | Purpose |
|------|---------|
| `state.js` | State initialization only (`createNewGame`, `createPlayerState`). No game logic. |
| `scoring.js` | Pure scoring functions (`scoreDice`, `isBust`, `getBestScore`). Must match `dice-scoring-rules.md`. |
| `gameEngine.js` | State transitions (`rollTurnDice`, `bankTurnScore`, `advanceToNextTurn`). Uses `scoring.js`. |
| `sseHandlers.js` | SSE connection management + REST endpoint handlers. Validates phase/player/turn ownership. |
| `index.js` | HTTP server setup, routes TV client at `/`, phone client at `/join`. |

## Key Patterns

### State Updates
Always broadcast full `GameState` snapshot after any change:
```javascript
const gameState = buildClientGameState(serverState);
broadcast('game_state', gameState);
```

### Player Validation
Every action validates player identity and turn ownership:
```javascript
if (!isActivePlayer(serverState.game, playerId, playerSecret)) {
  return res.status(403).json({ error: 'Not your turn' });
}
```

### Dice Rolling
Uses `crypto.randomInt(1, 7)` for secure randomness—never use `Math.random()`.

### Auto-Selection
After each roll, server computes and applies the best valid selection automatically via `getBestScore()`.

### Banking Logic
Banking uses `turn.bestSelectableScore` (the best possible score from all selectable dice) rather than the current selection. This ensures players cannot short-change themselves by deselecting dice before banking.

## Testing

Tests use a custom framework with assertion helpers. Run with:
```powershell
node server/scoring.test.js
node server/gameEngine.test.js
node server/state.test.js
```

To mock dice rolls in tests, use `withMockedRandomInts()`:
```javascript
withMockedRandomInts([1, 1, 1, 2, 3, 4], () => {
  const dice = rollInitialDice();
  // dice values are now deterministic
});
```

## Running Locally

```powershell
npm install
node server/index.js          # Starts on port 3000
$env:PORT = 4000; node server/index.js  # Custom port
```

TV client: `http://localhost:3000/`  
Phone client: `http://localhost:3000/join?gameId=<id>`

## Client Implementation Notes

- Clients are **views only**—never compute scores client-side
- Both clients share identical `ReactionOverlay` class for bust/bank animations
- Bank reactions use structured payloads (`type: 'bank'`, `bankAmount`, `previousTotal`, `playerName`)
- Bank overlays are high-priority and interrupt media-based reactions (e.g., bust videos)
- SSE reconnection is handled automatically by `EventSource`
- Player credentials stored in `localStorage` for reconnection
