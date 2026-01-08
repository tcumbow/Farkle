# Farkle SSE + REST API Schema

This document defines the **Server-Sent Events (SSE)** and **REST API** endpoints used by the system. It replaces the previous WebSocket-based communication for improved mobile browser reliability.

This schema is authoritative and must align with the **Server State Schema** document.

---

## 1. General Principles

- **Server → Client**: SSE (EventSource) for real-time event streaming
- **Client → Server**: REST API (HTTP POST) for actions
- Server is authoritative
- Server validates **phase**, **player identity**, and **turn ownership** for every request
- Illegal requests return HTTP error responses (4xx)
- All server-to-client state updates send the **full GameState snapshot** via SSE

---

## 2. Why SSE + REST?

SSE offers several advantages over WebSocket for this use case:

1. **Native browser reconnection**: EventSource automatically reconnects when the connection drops
2. **Simpler lifecycle**: No complex connection handshake or ping/pong management
3. **Better mobile support**: Mobile browsers handle SSE more reliably than WebSocket
4. **Stateless requests**: REST actions don't depend on connection state
5. **HTTP/2 compatible**: SSE works well with modern HTTP infrastructure

---

## 3. SSE Event Stream

### 3.1 Endpoint

```
GET /api/events?playerId={playerId}
```

**Query Parameters:**
- `playerId` (optional): Player ID for connection tracking

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 3.2 Event Format

SSE events follow the standard format:

```
event: {eventType}
data: {jsonPayload}

```

### 3.3 Event Types

#### `game_state`

Sent when:
- Client connects
- Any meaningful state change occurs (player joins, dice rolled, turn ends, etc.)

```
event: game_state
data: {"phase":"lobby","players":[...],"turnOrder":[...],...}
```

The `data` field contains a full `GameState` JSON object:

```typescript
interface GameState {
  phase: "lobby" | "in_progress" | "finished";
  players: Player[];
  turnOrder: string[];
  activeTurnIndex: number;
  turn: TurnState | null;
  finalRound: FinalRoundState | null;
  config: GameConfig;
  rankings?: Ranking[];
}
```

#### `reaction`

Sent when a reaction animation should be displayed (e.g., bust).

```
event: reaction
data: {"type":"bust","playerId":"abc123","mediaUrl":"/media/bust/random.gif"}
```

#### `error`

Sent for server-side errors that need client notification.

```
event: error
data: {"code":"INVALID_ACTION","message":"Not your turn."}
```

#### Keepalive

The server sends keepalive comments every 30 seconds to prevent connection timeout:

```
:keepalive

```

---

## 4. REST API Endpoints

All endpoints accept JSON request bodies and return JSON responses.

### 4.1 Join Game

**Endpoint:** `POST /api/join`

**Request:**
```json
{
  "gameId": "abc123",
  "name": "Player Name"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "playerId": "player123",
  "playerSecret": "secret456"
}
```

**Error Responses:**
- `400 INVALID_NAME`: Name is required
- `400 NO_GAME`: No game exists
- `400 GAME_STARTED`: Cannot join after game has started
- `400 DUPLICATE_NAME`: That name is already taken

**Side Effect:** Broadcasts `game_state` to all SSE clients

---

### 4.2 Reconnect Player

**Endpoint:** `POST /api/reconnect`

**Request:**
```json
{
  "gameId": "abc123",
  "playerId": "player123",
  "playerSecret": "secret456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "playerId": "player123"
}
```

**Error Responses:**
- `400 INVALID_CREDENTIALS`: Missing credentials
- `400 NO_GAME`: No game exists
- `400 UNKNOWN_PLAYER`: Player not found
- `403 INVALID_SECRET`: Invalid credentials

**Side Effect:** Broadcasts `game_state` to all SSE clients

---

### 4.3 Toggle Die Selection

**Endpoint:** `POST /api/toggle`

**Request:**
```json
{
  "playerId": "player123",
  "playerSecret": "secret456",
  "dieIndex": 0
}
```

**Success Response (200):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400 INVALID_CREDENTIALS`: Missing credentials
- `400 NO_GAME`: No game exists
- `400 INVALID_PHASE`: Game not in progress
- `400 NOT_YOUR_TURN`: Not your turn
- `400 INVALID_INDEX`: Invalid die index
- `403 INVALID_SECRET`: Invalid credentials

**Side Effect:** Broadcasts `game_state` to all SSE clients

---

### 4.4 Roll Dice

**Endpoint:** `POST /api/roll`

**Request:**
```json
{
  "playerId": "player123",
  "playerSecret": "secret456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "outcome": "continue"
}
```

Possible `outcome` values:
- `"continue"`: Rolled successfully, turn continues
- `"bust"`: Rolled and busted, turn ends
- `"hot_dice"`: All dice scored, rolling fresh 6

**Error Responses:**
- `400 INVALID_CREDENTIALS`: Missing credentials
- `400 NO_GAME`: No game exists
- `400 INVALID_PHASE`: Game not in progress
- `400 NOT_YOUR_TURN`: Not your turn
- `400 ROLL_FAILED`: Roll failed (selection invalid, etc.)
- `403 INVALID_SECRET`: Invalid credentials

**Side Effect:** 
- Broadcasts `game_state` to all SSE clients
- If bust, broadcasts `reaction` event

---

### 4.5 Bank Score

**Endpoint:** `POST /api/bank`

**Request:**
```json
{
  "playerId": "player123",
  "playerSecret": "secret456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "outcome": "continue"
}
```

Possible `outcome` values:
- `"continue"`: Banked successfully, next player's turn
- `"game_finished"`: Banked and game has ended

**Error Responses:**
- `400 INVALID_CREDENTIALS`: Missing credentials
- `400 NO_GAME`: No game exists
- `400 INVALID_PHASE`: Game not in progress
- `400 NOT_YOUR_TURN`: Not your turn
- `400 BANK_FAILED`: Bank failed (nothing to bank, etc.)
- `403 INVALID_SECRET`: Invalid credentials

**Side Effect:** Broadcasts `game_state` to all SSE clients

---

### 4.6 Start Game (TV Only)

**Endpoint:** `POST /api/start`

**Request:**
```json
{}
```

**Success Response (200):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400 NO_GAME`: No game exists
- `400 INVALID_PHASE`: Game already started
- `400 NO_PLAYERS`: Need at least one player

**Side Effect:** Broadcasts `game_state` to all SSE clients

---

### 4.7 Reset Game (TV Only)

**Endpoint:** `POST /api/reset`

**Request:**
```json
{}
```

**Success Response (200):**
```json
{
  "success": true
}
```

**Side Effect:** 
- Clears all game state, creates new game
- Broadcasts `game_state` to all SSE clients

---

## 5. Client Implementation

### 5.1 Phone Client

```javascript
// SSE connection
const eventSource = new EventSource('/api/events?playerId=' + playerId);

eventSource.addEventListener('game_state', (event) => {
  const gameState = JSON.parse(event.data);
  renderGameState(gameState);
});

eventSource.addEventListener('reaction', (event) => {
  const { type, playerId, mediaUrl } = JSON.parse(event.data);
  if (type === 'bust') showBustAnimation(mediaUrl);
});

// REST actions
async function joinGame(name) {
  const response = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, name })
  });
  return response.json();
}

async function rollDice() {
  const response = await fetch('/api/roll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret })
  });
  return response.json();
}
```

### 5.2 TV Client

```javascript
// SSE connection (no playerId needed)
const eventSource = new EventSource('/api/events');

eventSource.addEventListener('game_state', (event) => {
  const gameState = JSON.parse(event.data);
  renderGameState(gameState);
});

// REST actions
async function startGame() {
  await fetch('/api/start', { method: 'POST' });
}

async function resetGame() {
  await fetch('/api/reset', { method: 'POST' });
}
```

---

## 6. Error Handling

### 6.1 REST Errors

All REST errors return a JSON response with `error` and `message` fields:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error description"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad request (invalid parameters, wrong phase, etc.)
- `403`: Forbidden (invalid credentials)
- `500`: Internal server error

### 6.2 SSE Reconnection

EventSource automatically reconnects when the connection drops. No manual reconnection logic is needed in most cases.

If the `EventSource.readyState` is `EventSource.CLOSED`, create a new EventSource:

```javascript
if (eventSource.readyState === EventSource.CLOSED) {
  eventSource = new EventSource('/api/events');
}
```

---

## 7. Migration from WebSocket

The SSE+REST architecture replaces the previous WebSocket implementation:

| WebSocket | SSE+REST |
|-----------|----------|
| `ws.send('join_game', {...})` | `POST /api/join` |
| `ws.send('reconnect_player', {...})` | `POST /api/reconnect` |
| `ws.send('toggle_die_selection', {...})` | `POST /api/toggle` |
| `ws.send('roll_dice', {})` | `POST /api/roll` |
| `ws.send('bank_score', {})` | `POST /api/bank` |
| `ws.send('start_game', {})` | `POST /api/start` |
| `ws.send('reset_game', {})` | `POST /api/reset` |
| `ws.on('game_state', ...)` | `eventSource.addEventListener('game_state', ...)` |
| `ws.on('reaction', ...)` | `eventSource.addEventListener('reaction', ...)` |
