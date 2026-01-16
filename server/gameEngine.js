/**
 * Farkle Game Engine
 * 
 * Functions for game state transitions and dice rolling.
 * Implements logic as specified in docs/turn-lifecycle-walkthrough.md
 */

const crypto = require('crypto');
const { scoreDice, isBust, getBestScore } = require('./scoring');

// ============================================================================
// Dice Rolling Functions
// ============================================================================

/**
 * Roll a single die using crypto.randomInt.
 * 
 * @returns {number} Die value (1-6)
 */
function rollOneDie() {
  return crypto.randomInt(1, 7); // 1-6 inclusive
}

/**
 * Roll multiple dice and return DieState array.
 * 
 * @param {number} count - Number of dice to roll
 * @param {boolean} selectable - Whether dice should be selectable (default true)
 * @returns {DieState[]} Array of rolled dice
 */
function rollDice(count, selectable = true) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    dice.push({
      value: rollOneDie(),
      selectable
    });
  }
  return dice;
}

/**
 * Create an array of blank dice (no value shown) used before the first roll.
 * @param {number} count - Number of blank dice
 * @returns {DieState[]}
 */
function blankDice(count) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    dice.push({ value: null, selectable: false });
  }
  return dice;
}

/**
 * Roll initial dice for a new turn (6 dice, all selectable).
 * 
 * @returns {DieState[]} Six rolled dice
 */
function rollInitialDice() {
  return rollDice(6, true);
}

/**
 * After a selection, lock the selected dice and roll new dice for the remaining slots.
 * Returns a new dice array with selected dice locked (non-selectable) and new rolled dice.
 * 
 * @param {DieState[]} currentDice - Current dice array
 * @param {number[]} selectedIndices - Indices of selected dice to lock
 * @returns {DieState[]} New dice array with locked selected dice removed and new dice rolled
 */
function lockAndRollRemaining(currentDice, selectedIndices) {
  // Calculate how many dice remain (not selected)
  const remainingCount = currentDice.length - selectedIndices.length;
  
  if (remainingCount === 0) {
    // Hot dice condition - all dice were selected
    // Caller should handle this case separately
    return [];
  }

  // Roll new dice for the remaining count
  return rollDice(remainingCount, true);
}

/**
 * Check if hot dice condition occurred (all dice were selected).
 * 
 * @param {number} currentDiceCount - Number of dice before selection
 * @param {number[]} selectedIndices - Indices of selected dice
 * @returns {boolean} True if hot dice occurred
 */
function isHotDiceCondition(currentDiceCount, selectedIndices) {
  return selectedIndices.length === currentDiceCount;
}

/**
 * Handle hot dice reset - return 6 new dice.
 * 
 * @returns {DieState[]} Six new rolled dice
 */
function rollHotDice() {
  return rollDice(6, true);
}

/**
 * Evaluate selected dice and return validation result.
 *
 * @param {DieState[]} dice - Current dice for the turn
 * @param {number[]} selectedIndices - Indices of selected dice
 * @returns {{ isValid: boolean, selectionScore: number }} Selection evaluation
 */
function evaluateSelection(dice, selectedIndices) {
  if (!selectedIndices || selectedIndices.length === 0) {
    return { isValid: false, selectionScore: 0 };
  }

  const selectedValues = selectedIndices.map(index => dice[index].value);
  const result = scoreDice(selectedValues);

  if (!result.isValid) {
    return { isValid: false, selectionScore: 0 };
  }

  return { isValid: true, selectionScore: result.score };
}

function defaultFinalRoundState() {
  return {
    active: false,
    triggeringPlayerId: null,
    remainingPlayerIds: []
  };
}

function getTargetScore(gameState) {
  return gameState && gameState.config && typeof gameState.config.targetScore === 'number'
    ? gameState.config.targetScore
    : 10000;
}

function normalizeFinalRound(gameState) {
  if (gameState && gameState.finalRound) {
    return gameState.finalRound;
  }
  return defaultFinalRoundState();
}

function removeFromRemaining(finalRound, playerId) {
  if (!finalRound.active) {
    return finalRound;
  }
  const remaining = finalRound.remainingPlayerIds.filter(id => id !== playerId);
  return {
    ...finalRound,
    remainingPlayerIds: remaining
  };
}

function handleImmediateBust(gameState) {
  if (!gameState || gameState.phase !== 'in_progress' || !gameState.turn) {
    return { bust: false, gameState };
  }

  const selectableValues = (gameState.turn.dice || [])
    .filter(d => d.selectable)
    .map(d => d.value);

  if (selectableValues.length === 0) {
    return { bust: false, gameState };
  }

  if (!isBust(selectableValues)) {
    return { bust: false, gameState };
  }

  const finalRound = normalizeFinalRound(gameState);
  const updatedFinalRound = removeFromRemaining(finalRound, gameState.turn.playerId);

  const clearedGame = {
    ...gameState,
    turn: null,
    players: clonePlayers(gameState.players),
    finalRound: updatedFinalRound
  };

  if (updatedFinalRound.active && updatedFinalRound.remainingPlayerIds.length === 0) {
    const finished = finishGame(clearedGame);
    if (!finished.success) {
      return { bust: true, gameState: gameState, error: finished.error || 'FINISH_FAILED' };
    }
    return { bust: true, gameState: finished.gameState };
  }

  const advanceResult = advanceToNextTurn(clearedGame);
  if (!advanceResult.success) {
    return { bust: true, gameState, error: advanceResult.error || 'ADVANCE_FAILED' };
  }

  return { bust: true, gameState: advanceResult.gameState };
}

function computeDefaultSelection(dice) {
  if (!Array.isArray(dice) || dice.length === 0) {
    return { indices: [], evaluation: { isValid: false, selectionScore: 0 } };
  }

  const selectableEntries = dice
    .map((die, index) => (die.selectable ? { index, value: die.value } : null))
    .filter(entry => entry !== null);

  if (selectableEntries.length === 0) {
    return { indices: [], evaluation: { isValid: false, selectionScore: 0 } };
  }

  const values = selectableEntries.map(entry => entry.value);
  const best = getBestScore(values);

  if (!best.selection || best.selection.length === 0) {
    return { indices: [], evaluation: { isValid: false, selectionScore: 0 } };
  }

  const valueToIndices = new Map();
  selectableEntries.forEach(entry => {
    if (!valueToIndices.has(entry.value)) {
      valueToIndices.set(entry.value, []);
    }
    valueToIndices.get(entry.value).push(entry.index);
  });

  const selectedIndices = [];
  for (const value of best.selection) {
    const indexList = valueToIndices.get(value);
    if (!indexList || indexList.length === 0) {
      return { indices: [], evaluation: { isValid: false, selectionScore: 0 } };
    }
    selectedIndices.push(indexList.shift());
  }

  selectedIndices.sort((a, b) => a - b);

  const evaluation = evaluateSelection(dice, selectedIndices);
  if (!evaluation.isValid) {
    return { indices: [], evaluation };
  }

  return { indices: selectedIndices, evaluation };
}

function applyDefaultSelectionToTurn(turn) {
  if (!turn || !Array.isArray(turn.dice)) {
    return turn;
  }

  const { indices, evaluation } = computeDefaultSelection(turn.dice);

  // Calculate best possible score from all selectable dice (used for banking)
  const selectableValues = turn.dice
    .filter(die => die.selectable)
    .map(die => die.value);
  const bestResult = selectableValues.length > 0 ? getBestScore(selectableValues) : { score: 0 };
  const bestSelectableScore = bestResult.score;

  if (!evaluation.isValid || indices.length === 0) {
    return {
      ...turn,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      bestSelectableScore,
      status: 'awaiting_selection'
    };
  }

  return {
    ...turn,
    selection: {
      selectedIndices: indices,
      isValid: true,
      selectionScore: evaluation.selectionScore
    },
    bestSelectableScore,
    status: 'awaiting_roll'
  };
}

function cloneDiceArray(dice) {
  return dice.map(die => ({ ...die }));
}

function clonePlayers(players) {
  return players.map(player => ({ ...player }));
}

// ============================================================================
// Game Flow Functions
// ============================================================================

/**
 * Start a game from lobby phase.
 * Transitions to in_progress and initializes the first player's turn.
 * 
 * @param {GameState} gameState - Current game state (must be in lobby phase)
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function startGame(gameState) {
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

  // Roll initial dice for first player
  // Start with blank dice so the player must press Roll for their first roll
  const initialDice = blankDice(6);

  // Create a new game state (pure - don't mutate)
  const newGameState = {
    ...gameState,
    phase: 'in_progress',
    activeTurnIndex: 0,
    finalRound: normalizeFinalRound(gameState),
    turn: {
      playerId: gameState.turnOrder[0],
      dice: initialDice,
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      bestSelectableScore: 0,
      status: 'awaiting_first_roll'
    }
  };

  const bustCheck = handleImmediateBust(newGameState);
  if (bustCheck.bust) {
    if (bustCheck.error) {
      return { success: false, error: bustCheck.error };
    }
    return { success: true, gameState: bustCheck.gameState, outcome: 'bust' };
  }

  return { success: true, gameState: newGameState };
}

/**
 * Advance to the next player's turn.
 * Used after a player banks or busts.
 * 
 * @param {GameState} gameState - Current game state
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function advanceToNextTurn(gameState) {
  // Validation
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'in_progress') {
    return { success: false, error: `Cannot advance turn in phase: ${gameState.phase}` };
  }

  // Calculate next turn index (wrap around)
  const nextIndex = (gameState.activeTurnIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[nextIndex];

  // Roll initial dice for next player
  // Start next player's turn with blank dice awaiting their first roll
  const nextPlayerDice = blankDice(6);

  // Create new game state
  const newGameState = {
    ...gameState,
    activeTurnIndex: nextIndex,
    finalRound: normalizeFinalRound(gameState),
    turn: {
      playerId: nextPlayerId,
      dice: nextPlayerDice,
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      bestSelectableScore: 0,
      status: 'awaiting_first_roll'
    }
  };

  const bustCheck = handleImmediateBust(newGameState);
  if (bustCheck.bust) {
    if (bustCheck.error) {
      return { success: false, error: bustCheck.error };
    }
    return { success: true, gameState: bustCheck.gameState, outcome: 'bust' };
  }

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

  const copiedDice = dice.map(d => ({ ...d }));

  // If dice are blank (value === null for all), the turn should await the player's first roll
  const allBlank = copiedDice.every(d => d.value === null);
  if (allBlank) {
    return {
      playerId,
      dice: copiedDice,
      accumulatedTurnScore,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      bestSelectableScore: 0,
      status: 'awaiting_first_roll'
    };
  }

  return applyDefaultSelectionToTurn({
    playerId,
    dice: copiedDice, // Copy dice
    accumulatedTurnScore,
    selection: {
      selectedIndices: [],
      isValid: false,
      selectionScore: 0
    },
    status: 'awaiting_selection'
  });
}

/**
 * Roll dice for the active player's current selection.
 *
 * @param {GameState} gameState - Current game state
 * @returns {{success: boolean, gameState?: GameState, error?: string, outcome?: 'bust' | 'hot_dice'}}
 */
function rollTurnDice(gameState) {
  if (!gameState || gameState.phase !== 'in_progress' || !gameState.turn) {
    return { success: false, error: 'INVALID_PHASE' };
  }

  const turn = gameState.turn;
  const dice = turn.dice || [];

  // Special-case: if this is the player's first roll on their turn, allow rolling
  // when status is 'awaiting_first_roll'. In that case no selection is required.
  if (turn.status === 'awaiting_first_roll') {
    // Perform initial roll for all dice
    const newDice = rollInitialDice();

    // If the rolled selectable values are an immediate bust, handle it
    const rolledValues = newDice.map(d => d.value);
    const busted = rolledValues.length > 0 && isBust(rolledValues);
    if (busted) {
      const finalRound = normalizeFinalRound(gameState);
      const updatedFinalRound = removeFromRemaining(finalRound, turn.playerId);

      const clearedGame = {
        ...gameState,
        players: clonePlayers(gameState.players),
        turn: null,
        finalRound: updatedFinalRound
      };

      if (updatedFinalRound.active && updatedFinalRound.remainingPlayerIds.length === 0) {
        const finished = finishGame(clearedGame);
        return finished.success ? { success: true, gameState: finished.gameState, outcome: 'bust' } : { success: false, error: finished.error || 'FINISH_FAILED' };
      }

      const advanceResult = advanceToNextTurn(clearedGame);
      if (!advanceResult.success) {
        return { success: false, error: advanceResult.error || 'ADVANCE_FAILED' };
      }
      return { success: true, gameState: advanceResult.gameState, outcome: 'bust' };
    }

    // Build new turn state: replace blank dice with rolled dice and apply default selection
    const newTurn = {
      ...turn,
      dice: newDice,
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      status: 'awaiting_selection'
    };

    const turnWithDefaultSelection = applyDefaultSelectionToTurn(newTurn);

    const newGameState = {
      ...gameState,
      players: clonePlayers(gameState.players),
      turn: turnWithDefaultSelection
    };

    return { success: true, gameState: newGameState };
  }

  if (!turn.selection || !turn.selection.isValid || turn.selection.selectedIndices.length === 0) {
    return { success: false, error: 'INVALID_SELECTION' };
  }

  const selectedIndices = [...turn.selection.selectedIndices];
  const diceCount = dice.length;
  const selectedIndexSet = new Set(selectedIndices);

  for (const index of selectedIndexSet) {
    if (index < 0 || index >= diceCount) {
      return { success: false, error: 'SELECTION_OUT_OF_RANGE' };
    }
    if (!dice[index].selectable) {
      return { success: false, error: 'DIE_NOT_SELECTABLE' };
    }
  }

  const selectableIndices = [];
  dice.forEach((die, index) => {
    if (die.selectable) {
      selectableIndices.push(index);
    }
  });

  const allSelectableChosen = selectedIndexSet.size === selectableIndices.length;

  const updatedDice = cloneDiceArray(dice);
  let rolledValues = [];
  let outcome;

  if (allSelectableChosen && selectableIndices.length > 0) {
    const newDice = rollInitialDice();
    rolledValues = newDice.map(d => d.value);
    updatedDice.splice(0, updatedDice.length, ...newDice);
    outcome = 'hot_dice';
  } else {
    rolledValues = [];
    for (let index = 0; index < updatedDice.length; index += 1) {
      const die = updatedDice[index];
      if (!die.selectable) {
        continue;
      }

      if (selectedIndexSet.has(index)) {
        updatedDice[index] = {
          value: die.value,
          selectable: false
        };
      } else {
        updatedDice[index] = {
          value: rollOneDie(),
          selectable: true
        };
        rolledValues.push(updatedDice[index].value);
      }
    }
  }

  if (rolledValues.length === 0) {
    rolledValues = updatedDice.filter(d => d.selectable).map(d => d.value);
  }

  const busted = rolledValues.length > 0 && isBust(rolledValues);
  if (busted) {
    const finalRound = normalizeFinalRound(gameState);
    const updatedFinalRound = removeFromRemaining(finalRound, turn.playerId);

    const clearedGame = {
      ...gameState,
      players: clonePlayers(gameState.players),
      turn: null,
      finalRound: updatedFinalRound
    };

    if (updatedFinalRound.active && updatedFinalRound.remainingPlayerIds.length === 0) {
      const finished = finishGame(clearedGame);
      return finished.success ? { success: true, gameState: finished.gameState, outcome: 'bust' } : { success: false, error: finished.error || 'FINISH_FAILED' };
    }

    const advanceResult = advanceToNextTurn(clearedGame);
    if (!advanceResult.success) {
      return { success: false, error: advanceResult.error || 'ADVANCE_FAILED' };
    }
    return { success: true, gameState: advanceResult.gameState, outcome: 'bust' };
  }

  const newTurn = {
    ...turn,
    dice: updatedDice,
    accumulatedTurnScore: turn.accumulatedTurnScore + turn.selection.selectionScore,
    selection: {
      selectedIndices: [],
      isValid: false,
      selectionScore: 0
    },
    status: 'awaiting_selection'
  };

  const turnWithDefaultSelection = applyDefaultSelectionToTurn(newTurn);

  const newGameState = {
    ...gameState,
    players: clonePlayers(gameState.players),
    turn: turnWithDefaultSelection
  };

  return { success: true, gameState: newGameState, outcome };
}

/**
 * Bank the active player's accumulated turn score.
 *
 * @param {GameState} gameState - Current game state
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function bankTurnScore(gameState) {
  if (!gameState || gameState.phase !== 'in_progress' || !gameState.turn) {
    return { success: false, error: 'INVALID_PHASE' };
  }

  const turn = gameState.turn;
  const playerId = turn.playerId;
  const playersCopy = clonePlayers(gameState.players);
  const playerIndex = playersCopy.findIndex(p => p.playerId === playerId);

  if (playerIndex === -1) {
    return { success: false, error: 'PLAYER_NOT_FOUND' };
  }

  // Use bestSelectableScore (best possible score from all selectable dice) for banking
  // This ensures deselecting dice doesn't reduce the bank amount
  const bestScore = turn.bestSelectableScore || 0;
  const bankTotal = turn.accumulatedTurnScore + bestScore;

  const targetScore = getTargetScore(gameState);
  let finalRound = normalizeFinalRound(gameState);

  if (finalRound.active) {
    finalRound = removeFromRemaining(finalRound, playerId);
  }

  if (bankTotal <= 0) {
    return { success: false, error: 'BANK_ZERO' };
  }

  const player = playersCopy[playerIndex];
  const newTotal = player.totalScore + bankTotal;
  const minimumEntry = gameState.config ? gameState.config.minimumEntryScore || 0 : 0;

  if (!player.hasEnteredGame && bankTotal < minimumEntry) {
    return { success: false, error: 'MINIMUM_ENTRY_NOT_MET' };
  }

  playersCopy[playerIndex] = {
    ...player,
    _previousTotal: player.totalScore,
    totalScore: newTotal,
    hasEnteredGame: player.hasEnteredGame || bankTotal >= minimumEntry
  };

  if (!finalRound.active && newTotal >= targetScore) {
    const remaining = gameState.turnOrder.filter(id => id !== playerId);
    if (remaining.length === 0) {
      const finished = finishGame({
        ...gameState,
        players: playersCopy,
        turn: null,
        finalRound: {
          active: true,
          triggeringPlayerId: playerId,
          remainingPlayerIds: []
        }
      });
      return finished.success ? { success: true, gameState: finished.gameState } : { success: false, error: finished.error || 'FINISH_FAILED' };
    }

    finalRound = {
      active: true,
      triggeringPlayerId: playerId,
      remainingPlayerIds: remaining
    };
  }

  const interimGameState = {
    ...gameState,
    players: playersCopy,
    turn: null,
    finalRound
  };

  if (finalRound.active && finalRound.remainingPlayerIds.length === 0) {
    const finished = finishGame(interimGameState);
    return finished.success ? { success: true, gameState: finished.gameState } : { success: false, error: finished.error || 'FINISH_FAILED' };
  }

  const advanceResult = advanceToNextTurn(interimGameState);
  if (!advanceResult.success) {
    return { success: false, error: advanceResult.error || 'ADVANCE_FAILED' };
  }

  return { success: true, gameState: advanceResult.gameState };
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

/**
 * Toggle a die selection for the active player's turn.
 *
 * @param {GameState} gameState - Current game state
 * @param {number} dieIndex - Index of the die to toggle
 * @returns {{success: boolean, gameState?: GameState, error?: string}}
 */
function toggleDieSelection(gameState, dieIndex) {
  if (!gameState) {
    return { success: false, error: 'Game state is null' };
  }

  if (gameState.phase !== 'in_progress') {
    return { success: false, error: `Cannot toggle selection in phase: ${gameState.phase}` };
  }

  if (!gameState.turn) {
    return { success: false, error: 'No active turn to toggle selection' };
  }

  const { turn } = gameState;

  if (dieIndex < 0 || dieIndex >= turn.dice.length) {
    return { success: false, error: 'Die index out of bounds' };
  }

  const die = turn.dice[dieIndex];
  if (!die.selectable) {
    return { success: false, error: 'Die is not selectable' };
  }

  const currentlySelected = new Set(turn.selection.selectedIndices);
  if (currentlySelected.has(dieIndex)) {
    currentlySelected.delete(dieIndex);
  } else {
    currentlySelected.add(dieIndex);
  }

  const updatedIndices = Array.from(currentlySelected).sort((a, b) => a - b);
  const evaluation = evaluateSelection(turn.dice, updatedIndices);
  const newStatus = evaluation.isValid ? 'awaiting_roll' : 'awaiting_selection';

  const newGameState = {
    ...gameState,
    turn: {
      ...turn,
      selection: {
        selectedIndices: updatedIndices,
        isValid: evaluation.isValid,
        selectionScore: evaluation.selectionScore
      },
      status: newStatus
    }
  };

  return { success: true, gameState: newGameState };
}

module.exports = {
  // Dice rolling functions
  rollOneDie,
  rollDice,
  rollInitialDice,
  lockAndRollRemaining,
  isHotDiceCondition,
  rollHotDice,
  evaluateSelection,
  
  // Core game flow functions
  startGame,
  advanceToNextTurn,
  initializeTurnState,
  rollTurnDice,
  bankTurnScore,
  finishGame,
  
  // Lobby management
  addPlayer,
  removePlayer,
  updateGameConfig,
  
  // Player management
  updatePlayerConnection,
  
  // Query helpers
  isActivePlayer,
  getActivePlayerId,

  // Selection handling
  toggleDieSelection
};
