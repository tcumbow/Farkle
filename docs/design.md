# Multiplayer Farkle – Initial Design Specification

## 1. Project Overview

A local-network, single-game, multiplayer digital version of **Farkle**.

- One authoritative Node.js server
- One TV client (read-only after game start)
- Multiple phone clients (one per player)
- All players are physically co-located on the same WiFi network
- No persistence to disk; all state lives in memory
- Only one game can exist at a time

This is a personal project optimized for simplicity, debuggability, and fidelity to the analog Farkle experience.

---

## 2. Core Constraints & Assumptions

- Server has a static IP address and known port
- No hostile clients or attackers are assumed
- Server restart wipes all state
- Phone clients may disconnect/reconnect arbitrarily
- TV client may be refreshed and must rehydrate state
- No concurrent games

---

## 3. Technology Stack

### Server
- Node.js
- Express for HTTP/static hosting
- SSE (Server-Sent Events) for server→client real-time updates
- REST API for client→server actions
- `crypto.randomInt()` for dice rolls

### Server Bootstrap

- `server/index.js` creates the HTTP server
- `server/sseHandlers.js` manages SSE connections and REST endpoints
- Serves TV client from `/` and phone client from `/join`
- Health check exposed at `/healthz`
- Optional event log available at `/api/event-log` when `EVENT_LOG_ENABLED=true`
 - Server listens on `0.0.0.0` to accept LAN connections
 - TV client fetches LAN join info from `/api/server-info` and renders QR code using `http://<host>:<port>/join?gameId=...`
 - `SERVER_HOST` env var overrides auto-detected LAN IP if needed

### Clients
- TV client: full-screen HTML/CSS/JS (Edge Chromium)
- Phone client: mobile-friendly HTML/CSS/JS

---

## 4. Client Roles

### TV Client

- Displays:
  - Lobby state (joined players)
  - Game state (scores, turns, dice, selections)
  - Final results
- Displays QR code for joining during lobby
 - Uses server-reported LAN IP/port for join URL; falls back to window origin if unavailable
- Contains the **Start New Game** button
- After game start, performs no gameplay actions
- Shows private player state (dice selections) in real time
 - Animates dice when new rolls arrive to signal change

#### Bank Reaction Overlay

- The TV client prefers structured `bank` reactions from the server (SSE `reaction` event with `type: 'bank'`).
- When received, the TV displays a text-first overlay with a label like "[Name] banked points:", the banked amount (e.g., "+150"), and the previous total. The overlay animates the transfer of points into the player's total (brief pause → transfer animation → final total), then hides.
- Bank overlays are high-priority and interrupt media-based reactions (e.g., bust `.webm`) to ensure the banking event is clearly visible.

### Phone Client

- One phone == one player
- Responsibilities:
  - Join game
  - Choose player name (stored in localStorage)
  - Toggle dice selection
  - Choose roll or bank when allowed
- Must tolerate refresh, app-switching, and reconnection

---

## 5. Game Rules (Classic Farkle)

- 6 dice
- Standard scoring rules
- Minimum entry score:
  - Default: 500
  - Adjustable on TV client before game start
  - Applies once per player: their first successful bank in a game must meet or exceed this threshold in a single turn; afterwards they may bank any positive score
- Target score / end condition:
  - Default target score: 10,000
  - When a player reaches or exceeds the target, a **final round** begins: every other player gets one last turn to beat that score
  - After all remaining players complete that final turn, the game ends and the highest total wins
- Hot dice:
  - Dice pool resets to 6
  - Accumulated turn score preserved
  - Player may choose to roll again or bank

---

## 6. Game Phases

```text
idle → lobby → in_progress → finished
```

### idle
- No active game
- TV client displays last completed game (if any)
- **Start New Game** available

### lobby
- QR code displayed
- Players may join
- TV client can start game

### in_progress
- Turn-based play
- Only active player may act
- Server enforces all legality rules

### finished
- Final scores displayed
- No further player actions accepted
- Only **Start New Game** allowed

---

## 7. Identity & Reconnection

### Player Identity

Each player is assigned:
- `playerId` (opaque, server-generated)
- `playerSecret` (for reconnection)

Stored in phone client `localStorage`.

### Reconnection Flow

- Client establishes SSE connection to `/api/events`
- Client sends `POST /api/reconnect` with `{ gameId, playerId, playerSecret }`
- Server validates and marks player as connected
- Active turn waits indefinitely for reconnection

---

## 8. Server Authority & Validation

- Server is fully authoritative
- Clients attempt to prevent illegal actions
- Server rejects illegal actions and logs warnings
- Illegal actions indicate developer bugs, not malicious behavior

Examples of illegal actions:
- Non-active player sending roll/bank
- Rolling with invalid dice selection
- Actions sent in wrong game phase

---

## 9. Dice Selection Model

- Dice may be freely toggled by the active player
- Selection updates are broadcast in real time
- Server continuously re-validates selection
- Roll/Bank buttons are disabled unless selection is valid
- Selection is only committed when Roll or Bank is invoked

Auto-selection default:
- On turn start and after each roll, the server computes and applies the largest valid scoring selection by default.
- If a valid selection exists, `status` becomes `awaiting_roll` and clients highlight the auto-selected dice.
- If no valid selection exists, `status` remains `awaiting_selection` and no dice are selected.

Invalid selections:
- Allowed visually
- Prevent roll/bank
- Score computed live and shown

---

## 10. Turn Model

Each turn tracks:
- Active player ID
- Current dice values
- Dice selection state
- Accumulated turn score

Hot dice automatically reset dice pool.

---

## 11. Join Flow

1. TV client requests new game
2. Server creates `gameId`
3. TV displays QR code:
   ```
   http://SERVER_IP/join?gameId=XYZ
   ```
4. Phone client loads join page
5. Player enters name
6. Server assigns `playerId` and `playerSecret`
7. Phone stores identity in localStorage

If game starts mid-join, half-joined players are dropped.

---

## 12. Player Ordering

- Player order is randomized at game start
- Join order is not preserved

---

## 13. End of Game

- Final scores displayed on TV
- Server rejects all phone actions
- Phone clients may be disconnected
- Trigger: A player banks to reach or exceed the target score (default 10,000)
- Final round: Every other player receives one final turn
- Completion: After all remaining players finish their final turn, the game ends and highest score wins
- Final scores displayed on TV
- Server rejects all phone actions
- Only **Start New Game** is available
- Only **Start New Game** is available

New game always starts from scratch; all players must rejoin.

---

## 14. Reset / Start New Game

- "Reset" and "Start New Game" are the same concept
- Triggered only from TV client
- Clears all server state
- Generates new `gameId`
- Invalidates all existing player identities

---

## 15. Timeouts & Lifetime

- No idle timeouts
- Server runs indefinitely
- State is cleared only via **Start New Game** or server restart

---

## 16. SSE + REST Architecture

### REST (Client → Server)
- `POST /api/join` - Join game with name
- `POST /api/reconnect` - Reconnect with saved identity
- `POST /api/toggle` - Toggle die selection
- `POST /api/roll` - Roll dice
- `POST /api/bank` - Bank score
- `POST /api/start` - Start game (TV only)
- `POST /api/reset` - Reset game (TV only)

### SSE (Server → Client)
- `GET /api/events` - EventSource stream
- Events: `game_state`, `reaction`, `error`
- Automatic reconnection via native EventSource

See `docs/sse-rest-api-schema.md` for full API documentation.

---

## 17. Debugging & Instrumentation

- Optional in-memory event log behind a feature flag
- Logs:
  - Dice rolls
  - State transitions
  - Scoring events
  - Illegal action attempts

Used for debugging and rule verification.

---

## 18. Non-Goals

- Persistence across server restarts
- Multiple concurrent games
- Spectators or read-only phone clients
- Authentication or security beyond local trust

---

## 19. Implementation Priority Order

1. Server state model & game engine
2. Dice scoring logic + tests
3. SSE + REST API schema
4. TV client (lobby + display)
5. Phone client (join + actions)
6. Reconnection logic
7. Debug logging
