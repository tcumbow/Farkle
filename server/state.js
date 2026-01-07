/**
 * Farkle Server State Management
 * 
 * Initializes and resets ServerState exactly as defined in docs/server-state-schema.md
 * No gameplay logic - only state initialization and reset functions.
 */

const crypto = require('crypto');

/**
 * Initialize the top-level ServerState.
 * 
 * @param {boolean} eventLogEnabled - Whether to enable debug event logging
 * @returns {ServerState} Initial server state with no active game
 */
function initializeServerState(eventLogEnabled = false) {
  return {
    game: null,
    eventLogEnabled,
    eventLog: []
  };
}

/**
 * Create a new GameState in lobby phase.
 * 
 * @param {number} minimumEntryScore - Minimum score required to enter the game (default 500)
 * @returns {GameState} New game state ready for players to join
 */
function createNewGame(minimumEntryScore = 500, targetScore = 10000) {
  const gameId = crypto.randomBytes(8).toString('hex');
  const now = Date.now();

  return {
    gameId,
    phase: 'lobby',
    
    config: {
      minimumEntryScore,
      targetScore
    },
    
    players: [],
    turnOrder: [],
    activeTurnIndex: 0,
    
    turn: null,
    finalRound: {
      active: false,
      triggeringPlayerId: null,
      remainingPlayerIds: []
    },
    
    createdAt: now,
    finishedAt: null
  };
}

/**
 * Create a new PlayerState for a joining player.
 * 
 * @param {string} playerId - Unique identifier for the player
 * @param {string} name - Player's display name
 * @returns {PlayerState} New player state
 */
function createPlayerState(playerId, name) {
  const playerSecret = crypto.randomBytes(16).toString('hex');
  const now = Date.now();

  return {
    playerId,
    playerSecret,
    name,
    totalScore: 0,
    hasEnteredGame: false,
    connected: true,
    joinedAt: now
  };
}

/**
 * Create a new TurnState for a player.
 * 
 * @param {string} playerId - ID of the player whose turn it is
 * @param {number} diceCount - Number of dice to start with (default 6)
 * @returns {TurnState} New turn state with rolled dice
 */
function createTurnState(playerId, diceCount = 6) {
  return {
    playerId,
    dice: rollDice(diceCount),
    accumulatedTurnScore: 0,
    selection: createEmptySelection(),
    status: 'awaiting_selection'
  };
}

/**
 * Roll dice and create DieState array.
 * 
 * @param {number} count - Number of dice to roll
 * @param {boolean} selectable - Whether dice should be selectable (default true)
 * @returns {DieState[]} Array of dice states
 */
function rollDice(count, selectable = true) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    dice.push({
      value: crypto.randomInt(1, 7), // 1-6 inclusive
      selectable
    });
  }
  return dice;
}

/**
 * Create an empty DiceSelectionState.
 * 
 * @returns {DiceSelectionState} Empty selection with no dice selected
 */
function createEmptySelection() {
  return {
    selectedIndices: [],
    isValid: true, // Empty selection is valid
    selectionScore: 0
  };
}

/**
 * Reset the entire server state (Start New Game).
 * Clears the current game, invalidates all player identities, and clears event log.
 * 
 * @param {ServerState} serverState - Current server state to reset
 * @param {number} minimumEntryScore - Minimum entry score for the new game (default 500)
 * @returns {ServerState} Reset server state with new game in lobby phase
 */
function resetServerState(serverState, minimumEntryScore = 500, targetScore = 10000) {
  serverState.game = createNewGame(minimumEntryScore, targetScore);
  serverState.eventLog = [];
  return serverState;
}

/**
 * Clear the current game completely (return to idle phase).
 * 
 * @param {ServerState} serverState - Current server state
 * @returns {ServerState} Server state with no active game
 */
function clearGame(serverState) {
  serverState.game = null;
  serverState.eventLog = [];
  return serverState;
}

/**
 * Add an event to the debug event log (if enabled).
 * 
 * @param {ServerState} serverState - Current server state
 * @param {string} type - Event type (e.g., 'DICE_ROLL', 'SELECTION_CHANGED')
 * @param {object} payload - Event payload data
 */
function logEvent(serverState, type, payload) {
  if (!serverState.eventLogEnabled) {
    return;
  }

  serverState.eventLog.push({
    timestamp: Date.now(),
    type,
    payload
  });
}

/**
 * Get the currently active player from the game state.
 * 
 * @param {GameState} gameState - Current game state
 * @returns {PlayerState | null} Active player or null if game not in progress
 */
function getActivePlayer(gameState) {
  if (!gameState || gameState.phase !== 'in_progress') {
    return null;
  }

  if (gameState.turnOrder.length === 0) {
    return null;
  }

  const activePlayerId = gameState.turnOrder[gameState.activeTurnIndex];
  return gameState.players.find(p => p.playerId === activePlayerId) || null;
}

/**
 * Find a player by their ID.
 * 
 * @param {GameState} gameState - Current game state
 * @param {string} playerId - Player ID to search for
 * @returns {PlayerState | null} Player state or null if not found
 */
function findPlayerById(gameState, playerId) {
  if (!gameState) {
    return null;
  }
  return gameState.players.find(p => p.playerId === playerId) || null;
}

/**
 * Check if a player can bank their current turn score.
 * 
 * @param {GameState} gameState - Current game state
 * @param {string} playerId - Player ID attempting to bank
 * @returns {boolean} True if player can bank
 */
function canPlayerBank(gameState, playerId) {
  if (!gameState || !gameState.turn) {
    return false;
  }

  if (gameState.turn.playerId !== playerId) {
    return false;
  }

  const turn = gameState.turn;

  // Must have a valid selection if dice are selected
  if (!turn.selection.isValid) {
    return false;
  }

  const player = findPlayerById(gameState, playerId);
  if (!player) {
    return false;
  }

  const selectionScore = turn.selection.selectionScore;
  const minimumEntryScore = gameState.config ? gameState.config.minimumEntryScore || 0 : 0;
  const bankableScore = turn.accumulatedTurnScore + selectionScore;

  if (!player.hasEnteredGame) {
    return bankableScore >= minimumEntryScore;
  }

  return bankableScore > 0;
}

/**
 * Validate state invariants (for debugging).
 * Throws an error if any invariant is violated.
 * 
 * @param {ServerState} serverState - Server state to validate
 * @throws {Error} If any invariant is violated
 */
function validateStateInvariants(serverState) {
  if (!serverState.game) {
    return; // idle phase, no invariants to check
  }

  const game = serverState.game;

  // turnOrder.length === players.length
  if (game.turnOrder.length !== game.players.length) {
    throw new Error(`Invariant violation: turnOrder.length (${game.turnOrder.length}) !== players.length (${game.players.length})`);
  }

  // activeTurnIndex must be valid
  if (game.phase === 'in_progress' && (game.activeTurnIndex < 0 || game.activeTurnIndex >= game.turnOrder.length)) {
    throw new Error(`Invariant violation: activeTurnIndex (${game.activeTurnIndex}) out of bounds for turnOrder.length (${game.turnOrder.length})`);
  }

  // turn === null unless phase === 'in_progress'
  if (game.phase !== 'in_progress' && game.turn !== null) {
    throw new Error(`Invariant violation: turn is not null but phase is ${game.phase}`);
  }

  // Exactly one active player during in_progress
  if (game.phase === 'in_progress' && !game.turn) {
    throw new Error('Invariant violation: phase is in_progress but turn is null');
  }

  // All playerIds in turnOrder must exist in players
  game.turnOrder.forEach(playerId => {
    if (!game.players.find(p => p.playerId === playerId)) {
      throw new Error(`Invariant violation: playerId ${playerId} in turnOrder not found in players`);
    }
  });
}

module.exports = {
  // Initialization functions
  initializeServerState,
  createNewGame,
  createPlayerState,
  createTurnState,
  
  // Dice and selection helpers
  rollDice,
  createEmptySelection,
  
  // State reset functions
  resetServerState,
  clearGame,
  
  // Event logging
  logEvent,
  
  // Query helpers (derived/computed data)
  getActivePlayer,
  findPlayerById,
  canPlayerBank,
  
  // Validation
  validateStateInvariants
};
