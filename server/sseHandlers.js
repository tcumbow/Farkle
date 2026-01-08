/**
 * SSE (Server-Sent Events) + REST API Handlers
 * 
 * Replaces WebSocket-based communication for better mobile browser compatibility.
 * - SSE: Server → Client (game_state, reaction, error events)
 * - REST: Client → Server (join, reconnect, roll, bank, toggle, etc.)
 */

const crypto = require('crypto');
const {
  startGame,
  advanceToNextTurn,
  rollTurnDice,
  bankTurnScore,
  addPlayer,
  toggleDieSelection,
  updatePlayerConnection,
  isActivePlayer,
  finishGame
} = require('./gameEngine');
const { createNewGame, createPlayerState } = require('./state');

// ============================================================================
// SSE Client Management
// ============================================================================

/**
 * Map of SSE clients. Key is a unique connection ID.
 * Value: { res, playerId (optional), ip }
 */
const sseClients = new Map();

function generateConnectionId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Register an SSE client and set up the connection.
 */
function registerSSEClient(res, req, serverState) {
  const connectionId = generateConnectionId();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const playerId = req.query.playerId || null;

  console.log(`[sse] Client connected: ${connectionId} from ${ip}${playerId ? ` (player: ${playerId})` : ''}`);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Store client
  sseClients.set(connectionId, { res, playerId, ip });

  // Send initial game state
  const gameState = buildClientGameState(serverState);
  sendSSEEvent(res, 'game_state', gameState);
  console.log(`[sse] Sent initial game_state to ${connectionId}`);

  // Send keepalive every 30 seconds to prevent connection timeout
  const keepaliveInterval = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (err) {
      clearInterval(keepaliveInterval);
    }
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[sse] Client disconnected: ${connectionId}`);
    clearInterval(keepaliveInterval);
    sseClients.delete(connectionId);
  });

  return connectionId;
}

/**
 * Send an SSE event to a specific response object.
 */
function sendSSEEvent(res, eventType, data) {
  try {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (err) {
    console.warn('[sse] Failed to send event:', err.message);
  }
}

/**
 * Broadcast an event to all connected SSE clients.
 */
function broadcast(eventType, data) {
  for (const [connectionId, client] of sseClients) {
    try {
      sendSSEEvent(client.res, eventType, data);
    } catch (err) {
      console.warn(`[sse] Failed to broadcast to ${connectionId}:`, err.message);
    }
  }
}

/**
 * Broadcast game state to all connected clients.
 */
function broadcastGameState(serverState) {
  const gameState = buildClientGameState(serverState);
  broadcast('game_state', gameState);
}

/**
 * Send a reaction event (e.g., bust animation) to all clients.
 */
function broadcastReaction(type, playerId, mediaUrl) {
  broadcast('reaction', { type, playerId, mediaUrl });
}

/**
 * Send an error event to a specific client response.
 */
function sendError(res, code, message) {
  sendSSEEvent(res, 'error', { code, message });
}

// ============================================================================
// Game State Building
// ============================================================================

function buildClientGameState(serverState) {
  const game = serverState.game;
  if (!game) {
    return {
      gameId: null,
      phase: 'lobby',
      players: [],
      turnOrder: [],
      activeTurnIndex: 0,
      turn: null,
      finalRound: null,
      config: { targetScore: 10000 }
    };
  }

  // Build player list without secrets
  const players = (game.players || []).map(p => ({
    playerId: p.playerId,
    name: p.name,
    connected: p.connected !== false,
    totalScore: p.totalScore || 0,
    hasEnteredGame: p.hasEnteredGame || false
  }));

  return {
    gameId: game.gameId,
    phase: game.phase || 'lobby',
    players,
    turnOrder: game.turnOrder || [],
    activeTurnIndex: game.activeTurnIndex || 0,
    turn: game.turn || null,
    finalRound: game.finalRound || null,
    config: game.config || { targetScore: 10000 },
    rankings: game.rankings || null
  };
}

// ============================================================================
// REST API Handlers
// ============================================================================

function handleJoinGame(req, res, serverState) {
  const { gameId, name } = req.body || {};

  console.log(`[api] join_game: name=${name}, gameId=${gameId}`);

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'INVALID_NAME', message: 'Name is required.' });
  }

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  if (game.phase !== 'lobby') {
    return res.status(400).json({ error: 'GAME_STARTED', message: 'Cannot join after game has started.' });
  }

  // Check for duplicate name
  const trimmedName = name.trim();
  const existingPlayer = game.players.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
  if (existingPlayer) {
    return res.status(400).json({ error: 'DUPLICATE_NAME', message: 'That name is already taken.' });
  }

  // Create player state with generated ID
  const playerId = crypto.randomBytes(8).toString('hex');
  const player = createPlayerState(playerId, trimmedName);

  // Add player
  const result = addPlayer(game, player);
  if (!result.success) {
    return res.status(400).json({ error: 'JOIN_FAILED', message: result.error || 'Failed to join.' });
  }

  serverState.game = result.gameState;

  // Log event
  logEvent(serverState, {
    type: 'player_joined',
    playerId: player.playerId,
    name: trimmedName,
    timestamp: Date.now()
  });

  // Send success response with credentials
  res.json({
    success: true,
    playerId: player.playerId,
    playerSecret: player.playerSecret
  });

  // Broadcast updated game state to all clients
  broadcastGameState(serverState);
}

function handleReconnectPlayer(req, res, serverState) {
  const { playerId, playerSecret } = req.body || {};

  console.log(`[api] reconnect_player: playerId=${playerId}`);

  if (!playerId || !playerSecret) {
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Missing credentials.' });
  }

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  const player = game.players.find(p => p.playerId === playerId);
  if (!player) {
    return res.status(400).json({ error: 'UNKNOWN_PLAYER', message: 'Player not found.' });
  }

  if (player.playerSecret !== playerSecret) {
    return res.status(403).json({ error: 'INVALID_SECRET', message: 'Invalid credentials.' });
  }

  // Mark player as connected
  const result = updatePlayerConnection(game, playerId, true);
  if (result.success) {
    serverState.game = result.gameState;
  }

  res.json({ success: true, playerId });

  // Broadcast updated game state
  broadcastGameState(serverState);
}

function handleToggleDie(req, res, serverState) {
  const { playerId, playerSecret, dieIndex } = req.body || {};

  if (!playerId || !playerSecret) {
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Missing credentials.' });
  }

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  if (game.phase !== 'in_progress') {
    return res.status(400).json({ error: 'INVALID_PHASE', message: 'Game not in progress.' });
  }

  // Verify player
  const player = game.players.find(p => p.playerId === playerId);
  if (!player || player.playerSecret !== playerSecret) {
    return res.status(403).json({ error: 'INVALID_SECRET', message: 'Invalid credentials.' });
  }

  // Check if it's this player's turn
  if (!isActivePlayer(game, playerId)) {
    return res.status(400).json({ error: 'NOT_YOUR_TURN', message: 'Not your turn.' });
  }

  if (typeof dieIndex !== 'number' || dieIndex < 0) {
    return res.status(400).json({ error: 'INVALID_INDEX', message: 'Invalid die index.' });
  }

  const result = toggleDieSelection(game, dieIndex);
  if (!result.success) {
    return res.status(400).json({ error: 'TOGGLE_FAILED', message: result.error || 'Toggle failed.' });
  }

  serverState.game = result.gameState;

  res.json({ success: true });

  // Broadcast updated game state
  broadcastGameState(serverState);
}

function handleRollDice(req, res, serverState, bustGifs) {
  const { playerId, playerSecret } = req.body || {};

  console.log(`[api] roll_dice: playerId=${playerId}`);

  if (!playerId || !playerSecret) {
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Missing credentials.' });
  }

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  if (game.phase !== 'in_progress') {
    return res.status(400).json({ error: 'INVALID_PHASE', message: 'Game not in progress.' });
  }

  // Verify player
  const player = game.players.find(p => p.playerId === playerId);
  if (!player || player.playerSecret !== playerSecret) {
    return res.status(403).json({ error: 'INVALID_SECRET', message: 'Invalid credentials.' });
  }

  if (!isActivePlayer(game, playerId)) {
    return res.status(400).json({ error: 'NOT_YOUR_TURN', message: 'Not your turn.' });
  }

  const result = rollTurnDice(game);
  if (!result.success) {
    return res.status(400).json({ error: 'ROLL_FAILED', message: result.error || 'Roll failed.' });
  }

  serverState.game = result.gameState;

  logEvent(serverState, {
    type: 'roll',
    playerId,
    outcome: result.outcome || 'continue',
    timestamp: Date.now()
  });

  res.json({ success: true, outcome: result.outcome || 'continue' });

  // Broadcast updated game state
  broadcastGameState(serverState);

  // If bust, send reaction
  if (result.outcome === 'bust') {
    const bustGif = bustGifs && bustGifs.length > 0
      ? bustGifs[Math.floor(Math.random() * bustGifs.length)]
      : null;
    if (bustGif) {
      broadcastReaction('bust', playerId, bustGif);
    }
  }
}

function handleBankScore(req, res, serverState) {
  const { playerId, playerSecret } = req.body || {};

  console.log(`[api] bank_score: playerId=${playerId}`);

  if (!playerId || !playerSecret) {
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Missing credentials.' });
  }

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  if (game.phase !== 'in_progress') {
    return res.status(400).json({ error: 'INVALID_PHASE', message: 'Game not in progress.' });
  }

  // Verify player
  const player = game.players.find(p => p.playerId === playerId);
  if (!player || player.playerSecret !== playerSecret) {
    return res.status(403).json({ error: 'INVALID_SECRET', message: 'Invalid credentials.' });
  }

  if (!isActivePlayer(game, playerId)) {
    return res.status(400).json({ error: 'NOT_YOUR_TURN', message: 'Not your turn.' });
  }

  const result = bankTurnScore(game);
  if (!result.success) {
    return res.status(400).json({ error: 'BANK_FAILED', message: result.error || 'Bank failed.' });
  }

  serverState.game = result.gameState;

  logEvent(serverState, {
    type: 'bank',
    playerId,
    outcome: result.outcome || 'continue',
    timestamp: Date.now()
  });

  res.json({ success: true, outcome: result.outcome || 'continue' });

  // Broadcast updated game state
  broadcastGameState(serverState);
}

function handleStartGame(req, res, serverState) {
  console.log('[api] start_game');

  const game = serverState.game;
  if (!game) {
    return res.status(400).json({ error: 'NO_GAME', message: 'No game exists.' });
  }

  if (game.phase !== 'lobby') {
    return res.status(400).json({ error: 'INVALID_PHASE', message: 'Game already started.' });
  }

  if (game.players.length === 0) {
    return res.status(400).json({ error: 'NO_PLAYERS', message: 'Need at least one player.' });
  }

  const result = startGame(game);
  if (!result.success) {
    return res.status(400).json({ error: 'START_FAILED', message: result.error || 'Start failed.' });
  }

  serverState.game = result.gameState;

  logEvent(serverState, {
    type: 'game_started',
    timestamp: Date.now()
  });

  res.json({ success: true });

  // Broadcast updated game state
  broadcastGameState(serverState);
}

function handleResetGame(req, res, serverState) {
  console.log('[api] reset_game');

  serverState.game = createNewGame();
  serverState.eventLog = [];

  logEvent(serverState, {
    type: 'game_reset',
    timestamp: Date.now()
  });

  res.json({ success: true });

  // Broadcast updated game state
  broadcastGameState(serverState);
}

// ============================================================================
// Utility Functions
// ============================================================================

function logEvent(serverState, event) {
  if (serverState.eventLogEnabled && serverState.eventLog) {
    serverState.eventLog.push(event);
  }
}

function loadBustGifs(mediaPath) {
  const fs = require('fs');
  const path = require('path');
  const bustDir = path.join(mediaPath, 'bust');

  try {
    if (!fs.existsSync(bustDir)) {
      console.log('[sse] No bust media directory found');
      return [];
    }

    const files = fs.readdirSync(bustDir);
    const gifs = files
      .filter(f => /\.(gif|mp4|webm)$/i.test(f))
      .map(f => `/media/bust/${f}`);

    console.log(`[sse] Loaded ${gifs.length} bust media files`);
    return gifs;
  } catch (err) {
    console.warn('[sse] Failed to load bust gifs:', err.message);
    return [];
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  registerSSEClient,
  broadcast,
  broadcastGameState,
  broadcastReaction,
  sendError,
  sendSSEEvent,
  handleJoinGame,
  handleReconnectPlayer,
  handleToggleDie,
  handleRollDice,
  handleBankScore,
  handleStartGame,
  handleResetGame,
  loadBustGifs,
  sseClients
};
