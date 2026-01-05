/**
 * Farkle Game Engine
 * 
 * Pure functions for game state transitions.
 * Implements logic as specified in docs/turn-lifecycle-walkthrough.md
 * 
 * Note: These functions are pure - they do NOT:
 * - Roll dice (caller provides dice)
 * - Score selections (caller provides scores)
 * - Mutate state (they return new state)
 */

/**
 * Start a game from lobby phase.
 * Transitions to in_progress and initializes the first player's turn.
 * 
 * @param {GameState} gameState - Current game state (must be in lobby phase)
 * @param {DieState[]} initialDice - Six dice for the first turn (provided by caller)
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function startGame(gameState, initialDice) {
  // Validation
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'lobby') {
    return { success: false, error: `Cannot start game from phase: ${gameState.phase}` };
  }

  if (gameState.players.length === 0) {
    return { success: false, error: 'Cannot start game with no players' };
  }

  if (!initialDice || initialDice.length !== 6) {
    return { success: false, error: 'Must provide exactly 6 initial dice' };
  }

  // Create a new game state (pure - don't mutate)
  const newGameState = {
    ...gameState,
    phase: 'in_progress',
    activeTurnIndex: 0,
    turn: {
      playerId: gameState.turnOrder[0],
      dice: initialDice.map(d => ({ ...d })), // Copy dice
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      status: 'awaiting_selection'
    }
  };

  return { success: true, gameState: newGameState };
}

/**
 * Advance to the next player's turn.
 * Used after a player banks or busts.
 * 
 * @param {GameState} gameState - Current game state
 * @param {DieState[]} nextPlayerDice - Six dice for the next turn (provided by caller)
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function advanceToNextTurn(gameState, nextPlayerDice) {
  // Validation
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'in_progress') {
    return { success: false, error: `Cannot advance turn in phase: ${gameState.phase}` };
  }

  if (!nextPlayerDice || nextPlayerDice.length !== 6) {
    return { success: false, error: 'Must provide exactly 6 dice for next turn' };
  }

  // Calculate next turn index (wrap around)
  const nextIndex = (gameState.activeTurnIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[nextIndex];

  // Create new game state
  const newGameState = {
    ...gameState,
    activeTurnIndex: nextIndex,
    turn: {
      playerId: nextPlayerId,
      dice: nextPlayerDice.map(d => ({ ...d })), // Copy dice
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      status: 'awaiting_selection'
    }
  };

  return { success: true, gameState: newGameState };
}

/**
 * Initialize a new TurnState for a specific player.
 * Helper function - typically called by advanceToNextTurn or startGame.
 * 
 * @param {string} playerId - ID of the player whose turn it is
 * @param {DieState[]} dice - Initial dice for this turn
 * @param {number} accumulatedTurnScore - Accumulated score (usually 0, but may be non-zero for hot dice)
 * @returns {TurnState}
 */
function initializeTurnState(playerId, dice, accumulatedTurnScore = 0) {
  if (!dice || dice.length === 0) {
    throw new Error('Cannot initialize turn with no dice');
  }

  return {
    playerId,
    dice: dice.map(d => ({ ...d })), // Copy dice
    accumulatedTurnScore,
    selection: {
      selectedIndices: [],
      isValid: false,
      selectionScore: 0
    },
    status: 'awaiting_selection'
  };
}

/**
 * End the current game and transition to finished phase.
 * 
 * @param {GameState} gameState - Current game state
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function finishGame(gameState) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase === 'finished') {
    return { success: false, error: 'Game is already finished' };
  }

  const newGameState = {
    ...gameState,
    phase: 'finished',
    turn: null, // Clear current turn
    finishedAt: Date.now()
  };

  return { success: true, gameState: newGameState };
}

/**
 * Add a player to the game during lobby phase.
 * 
 * @param {GameState} gameState - Current game state (must be in lobby)
 * @param {PlayerState} player - Player to add
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function addPlayer(gameState, player) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'lobby') {
    return { success: false, error: `Cannot add players in phase: ${gameState.phase}` };
  }

  if (!player || !player.playerId) {
    return { success: false, error: 'Invalid player' };
  }

  // Check for duplicate player ID
  if (gameState.players.some(p => p.playerId === player.playerId)) {
    return { success: false, error: 'Player ID already exists' };
  }

  const newGameState = {
    ...gameState,
    players: [...gameState.players, { ...player }],
    turnOrder: [...gameState.turnOrder, player.playerId]
  };

  return { success: true, gameState: newGameState };
}

/**
 * Remove a player from the game during lobby phase.
 * 
 * @param {GameState} gameState - Current game state (must be in lobby)
 * @param {string} playerId - ID of player to remove
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function removePlayer(gameState, playerId) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'lobby') {
    return { success: false, error: `Cannot remove players in phase: ${gameState.phase}` };
  }

  if (!gameState.players.some(p => p.playerId === playerId)) {
    return { success: false, error: 'Player not found' };
  }

  const newGameState = {
    ...gameState,
    players: gameState.players.filter(p => p.playerId !== playerId),
    turnOrder: gameState.turnOrder.filter(id => id !== playerId)
  };

  return { success: true, gameState: newGameState };
}

/**
 * Update a player's connection status.
 * 
 * @param {GameState} gameState - Current game state
 * @param {string} playerId - Player ID
 * @param {boolean} connected - New connection status
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function updatePlayerConnection(gameState, playerId, connected) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  const playerIndex = gameState.players.findIndex(p => p.playerId === playerId);
  if (playerIndex === -1) {
    return { success: false, error: 'Player not found' };
  }

  const newPlayers = [...gameState.players];
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    connected
  };

  const newGameState = {
    ...gameState,
    players: newPlayers
  };

  return { success: true, gameState: newGameState };
}

/**
 * Update game configuration during lobby phase.
 * 
 * @param {GameState} gameState - Current game state (must be in lobby)
 * @param {Partial<GameConfig>} configUpdates - Configuration updates
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function updateGameConfig(gameState, configUpdates) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'lobby') {
    return { success: false, error: `Cannot update config in phase: ${gameState.phase}` };
  }

  const newGameState = {
    ...gameState,
    config: {
      ...gameState.config,
      ...configUpdates
    }
  };

  return { success: true, gameState: newGameState };
}

/**
 * Check if a player is currently the active player.
 * 
 * @param {GameState} gameState - Current game state
 * @param {string} playerId - Player ID to check
 * @returns {boolean} True if player is active
 */
function isActivePlayer(gameState, playerId) {
  if (!gameState || gameState.phase !== 'in_progress' || !gameState.turn) {
    return false;
  }

  return gameState.turn.playerId === playerId;
}

/**
 * Get the current active player ID.
 * 
 * @param {GameState} gameState - Current game state
 * @returns {string | null} Active player ID or null
 */
function getActivePlayerId(gameState) {
  if (!gameState || gameState.phase !== 'in_progress') {
    return null;
  }

  if (gameState.turnOrder.length === 0) {
    return null;
  }

  return gameState.turnOrder[gameState.activeTurnIndex];
}

module.exports = {
  // Core game flow functions
  startGame,
  advanceToNextTurn,
  initializeTurnState,
  finishGame,
  
  // Lobby management
  addPlayer,
  removePlayer,
  updateGameConfig,
  
  // Player management
  updatePlayerConnection,
  
  // Query helpers
  isActivePlayer,
  getActivePlayerId
};
