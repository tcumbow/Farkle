/**
 * Socket.IO Event Registration
 *
 * Implements identity-aware event handling for lobby joins, reconnection, and
 * disconnect flow while wiring remaining events with placeholder handlers.
 */

const crypto = require('crypto');
const { createPlayerState, findPlayerById, createNewGame, logEvent } = require('./state');
const {
  startGame: engineStartGame,
  toggleDieSelection: engineToggleDieSelection,
  rollTurnDice: engineRollTurnDice,
  bankTurnScore: engineBankTurnScore
} = require('./gameEngine');

const INCOMING_EVENTS = {
  RECONNECT_PLAYER: 'reconnect_player',
  JOIN_GAME: 'join_game',
  START_GAME: 'start_game',
  TOGGLE_DIE_SELECTION: 'toggle_die_selection',
  ROLL_DICE: 'roll_dice',
  BANK_SCORE: 'bank_score',
  ACKNOWLEDGE_RESULTS: 'acknowledge_results',
  RESET_GAME: 'reset_game'
};

const SOCKET_LIFECYCLE_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect'
};

const OUTGOING_EVENTS = {
  GAME_STATE: 'game_state',
  ERROR: 'error',
  JOIN_SUCCESS: 'join_success'
};

const DEFAULT_HANDLER = (eventName) => () => {
  // Placeholder to make it obvious when a handler has not been provided yet.
  // eslint-disable-next-line no-console
  console.warn(`[socketHandlers] handler for "${eventName}" not implemented`);
};

const defaultIdGenerator = () => crypto.randomBytes(8).toString('hex');

const defaultShuffle = (items) => {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const EVENT_TYPES = {
  STATE_TRANSITION: 'STATE_TRANSITION',
  DICE_ROLL: 'DICE_ROLL',
  SCORING: 'SCORING',
  ILLEGAL_ACTION: 'ILLEGAL_ACTION'
};

/**
 * Register Socket.IO event listeners.
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {ServerState} serverState - Shared in-memory server state
 * @param {Object} [options]
 * @param {Object} [options.overrides] - Optional custom handlers keyed by event name
 * @param {Function} [options.idGenerator] - Optional deterministic player ID generator
 */
function registerSocketHandlers(io, serverState, options = {}) {
  if (!io || typeof io.on !== 'function') {
    throw new Error('Socket.IO server instance with an "on" method is required');
  }

  if (!serverState || typeof serverState !== 'object') {
    throw new Error('Server state reference is required to register handlers');
  }

  const {
    overrides = {},
    idGenerator = defaultIdGenerator,
    shuffleTurnOrder = defaultShuffle
  } = options;

  const playerSocketMap = new Map();

  const recordEvent = (type, payload = {}) => {
    const entryPayload = { ...payload };
    if (entryPayload.gameId === undefined && serverState.game) {
      entryPayload.gameId = serverState.game.gameId;
    }
    logEvent(serverState, type, entryPayload);
  };

  const recordIllegalAction = (socket, code, message, context = {}) => {
    const payload = {
      code,
      message,
      event: context.event || null,
      playerId:
        context.playerId !== undefined
          ? context.playerId
          : (socket && socket.data ? socket.data.playerId : null),
      phase: serverState.game ? serverState.game.phase : null,
      ...context
    };

    recordEvent(EVENT_TYPES.ILLEGAL_ACTION, payload);
  };

  const recordStateTransition = (fromPhase, toPhase, context = {}) => {
    recordEvent(EVENT_TYPES.STATE_TRANSITION, {
      from: fromPhase !== undefined ? fromPhase : null,
      to: toPhase !== undefined ? toPhase : null,
      ...context
    });
  };

  const recordDiceRoll = (context = {}) => {
    recordEvent(EVENT_TYPES.DICE_ROLL, context);
  };

  const recordScoring = (context = {}) => {
    recordEvent(EVENT_TYPES.SCORING, context);
  };

  const getPlayerSocketId = (socket) => {
    if (!socket || !socket.data) {
      return null;
    }
    return typeof socket.data.playerId === 'string' ? socket.data.playerId : null;
  };

  const ensureActivePlayer = (socket, eventName) => {
    const game = serverState.game;
    if (!game) {
      emitError(socket, 'NO_ACTIVE_GAME', 'No active game is in progress.', {
        event: eventName
      });
      return null;
    }

    if (game.phase !== 'in_progress' || !game.turn) {
      emitError(socket, 'INVALID_PHASE', 'Action only allowed during an active turn.', {
        event: eventName,
        phase: game.phase
      });
      return null;
    }

    const playerId = getPlayerSocketId(socket);
    if (!playerId) {
      emitError(socket, 'UNIDENTIFIED_PLAYER', 'Join the game before performing turn actions.', {
        event: eventName
      });
      return null;
    }

    if (socket.data.gameId !== game.gameId) {
      emitError(
        socket,
        'STALE_IDENTITY',
        'Your saved identity is from a previous game. Please rejoin.',
        {
          event: eventName,
          gameId: game.gameId,
          providedGameId: socket.data.gameId
        }
      );
      return null;
    }

    if (game.turn.playerId !== playerId) {
      emitError(socket, 'NOT_YOUR_TURN', 'Only the active player can perform this action.', {
        event: eventName,
        playerId,
        activePlayerId: game.turn.playerId
      });
      return null;
    }

    return { game, playerId };
  };

  const emitGameState = () => {
    if (!serverState.game) {
      return;
    }
    io.emit(OUTGOING_EVENTS.GAME_STATE, serverState.game);
  };

  const emitError = (socket, code, message, context = {}) => {
    recordIllegalAction(socket, code, message, context);
    socket.emit(OUTGOING_EVENTS.ERROR, { code, message });
  };

  const associateSocketWithPlayer = (socket, player) => {
    if (!socket.data) {
      socket.data = {};
    }
    socket.data.playerId = player.playerId;
    socket.data.playerSecret = player.playerSecret;
    socket.data.gameId = serverState.game ? serverState.game.gameId : null;
    playerSocketMap.set(player.playerId, socket);
  };

  const clearSocketAssociation = (socket) => {
    if (!socket || !socket.data) {
      return;
    }
    delete socket.data.playerId;
    delete socket.data.playerSecret;
    delete socket.data.gameId;
  };

  const generateUniquePlayerId = (game) => {
    let attempts = 0;
    let candidate;
    do {
      candidate = idGenerator();
      attempts += 1;
      if (attempts > 25) {
        throw new Error('Unable to generate unique playerId');
      }
    } while (findPlayerById(game, candidate));
    return candidate;
  };

  const handleJoinGame = (socket, payload) => {
    const game = serverState.game;
    if (!game) {
      emitError(socket, 'NO_ACTIVE_GAME', 'No active game is available to join.', {
        event: INCOMING_EVENTS.JOIN_GAME
      });
      return;
    }

    if (game.phase !== 'lobby') {
      emitError(socket, 'INVALID_PHASE', 'Game is not accepting new players.', {
        event: INCOMING_EVENTS.JOIN_GAME,
        phase: game.phase
      });
      return;
    }

    if (!payload || typeof payload.gameId !== 'string' || payload.gameId !== game.gameId) {
      emitError(socket, 'INVALID_GAME', 'Game identifier does not match active game.', {
        event: INCOMING_EVENTS.JOIN_GAME,
        providedGameId: payload ? payload.gameId : null
      });
      return;
    }

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (name.length === 0) {
      emitError(socket, 'INVALID_NAME', 'Player name is required to join.', {
        event: INCOMING_EVENTS.JOIN_GAME
      });
      return;
    }

    const playerId = generateUniquePlayerId(game);
    const playerState = createPlayerState(playerId, name);

    game.players.push(playerState);
    game.turnOrder.push(playerId);

    associateSocketWithPlayer(socket, playerState);

    socket.emit(OUTGOING_EVENTS.JOIN_SUCCESS, {
      playerId,
      playerSecret: playerState.playerSecret
    });

    emitGameState();
  };

  const handleReconnectPlayer = (socket, payload) => {
    const game = serverState.game;
    if (!game) {
      emitError(socket, 'NO_ACTIVE_GAME', 'No active game to reconnect to.', {
        event: INCOMING_EVENTS.RECONNECT_PLAYER
      });
      return;
    }

    if (!payload || typeof payload.gameId !== 'string' || payload.gameId !== game.gameId) {
      emitError(socket, 'INVALID_GAME', 'Game identifier does not match active game.', {
        event: INCOMING_EVENTS.RECONNECT_PLAYER,
        providedGameId: payload ? payload.gameId : null
      });
      return;
    }

    const { playerId, playerSecret } = payload;
    if (typeof playerId !== 'string' || typeof playerSecret !== 'string') {
      emitError(socket, 'INVALID_PAYLOAD', 'playerId and playerSecret are required.', {
        event: INCOMING_EVENTS.RECONNECT_PLAYER
      });
      return;
    }

    const player = findPlayerById(game, playerId);
    if (!player) {
      emitError(socket, 'PLAYER_NOT_FOUND', 'Unable to find player for reconnection.', {
        event: INCOMING_EVENTS.RECONNECT_PLAYER,
        playerId
      });
      return;
    }

    if (player.playerSecret !== playerSecret) {
      emitError(socket, 'INVALID_SECRET', 'Player credentials did not match.', {
        event: INCOMING_EVENTS.RECONNECT_PLAYER,
        playerId
      });
      return;
    }

    player.connected = true;
    associateSocketWithPlayer(socket, player);

    emitGameState();
  };

  const handleDisconnect = (socket, reason) => {
    const playerId = socket && socket.data ? socket.data.playerId : null;
    if (!playerId) {
      return;
    }

    playerSocketMap.delete(playerId);

    const game = serverState.game;
    if (!game) {
      return;
    }

    const player = findPlayerById(game, playerId);
    if (!player) {
      return;
    }

    if (!player.connected) {
      return;
    }

    player.connected = false;
    emitGameState();
  };

  const pruneUnreadyPlayers = (game) => {
    if (!game) {
      return { validPlayers: [], removedIds: [] };
    }
    const validPlayers = [];
    const removedIds = [];
    game.players.forEach((player) => {
      if (
        player &&
        typeof player.playerId === 'string' &&
        player.playerId.length > 0 &&
        player.connected === true &&
        typeof player.playerSecret === 'string' &&
        playerSocketMap.has(player.playerId)
      ) {
        validPlayers.push(player);
      } else {
        removedIds.push(player ? player.playerId : undefined);
      }
    });

    const validIds = new Set(validPlayers.map((p) => p.playerId));
    game.players = validPlayers;
    game.turnOrder = game.turnOrder.filter((id) => validIds.has(id));

    removedIds.forEach((id) => {
      if (id) {
        playerSocketMap.delete(id);
      }
    });

    return { validPlayers, removedIds };
  };

  const handleStartGame = (socket) => {
    const game = serverState.game;
    if (!game) {
      emitError(socket, 'NO_ACTIVE_GAME', 'No active game exists.', {
        event: INCOMING_EVENTS.START_GAME
      });
      return;
    }

    if (game.phase !== 'lobby') {
      emitError(socket, 'INVALID_PHASE', 'Game has already started.', {
        event: INCOMING_EVENTS.START_GAME,
        phase: game.phase
      });
      return;
    }

    const previousPhase = game.phase;

    pruneUnreadyPlayers(game);

    if (game.players.length === 0) {
      emitError(socket, 'NO_PLAYERS', 'Cannot start game without players.', {
        event: INCOMING_EVENTS.START_GAME
      });
      return;
    }

    game.turnOrder = shuffleTurnOrder(game.turnOrder);

    const result = engineStartGame(game);
    if (!result.success || !result.gameState) {
      emitError(socket, 'START_FAILED', result.error || 'Unable to start game.', {
        event: INCOMING_EVENTS.START_GAME
      });
      return;
    }

    serverState.game = result.gameState;
    const newGameState = result.gameState;
    recordStateTransition(previousPhase, newGameState.phase, {
      event: INCOMING_EVENTS.START_GAME,
      playerCount: newGameState.players.length
    });

    if (newGameState.turn) {
      const { turn } = newGameState;
      const diceValues = Array.isArray(turn.dice) ? turn.dice.map((die) => die.value) : [];
      const selectable = Array.isArray(turn.dice) ? turn.dice.map((die) => die.selectable) : [];
      recordDiceRoll({
        event: INCOMING_EVENTS.START_GAME,
        playerId: turn.playerId,
        diceValues,
        selectable,
        accumulatedTurnScore: turn.accumulatedTurnScore,
        stage: 'turn_start'
      });

      const activePlayer = newGameState.players.find((p) => p.playerId === turn.playerId);
      recordScoring({
        event: INCOMING_EVENTS.START_GAME,
        playerId: turn.playerId,
        totalScore: activePlayer ? activePlayer.totalScore : 0,
        accumulatedTurnScore: turn.accumulatedTurnScore,
        selectionScore: turn.selection ? turn.selection.selectionScore : 0,
        stage: 'turn_start'
      });
    }
    emitGameState();
  };

  const handleToggleDieSelection = (socket, payload) => {
    const context = ensureActivePlayer(socket, INCOMING_EVENTS.TOGGLE_DIE_SELECTION);
    if (!context) {
      return;
    }

    const { game, playerId } = context;
    const dieIndex = payload && Number.isInteger(payload.dieIndex)
      ? payload.dieIndex
      : Number.parseInt(payload && payload.dieIndex, 10);

    if (!Number.isInteger(dieIndex)) {
      emitError(socket, 'INVALID_PAYLOAD', 'dieIndex must be an integer.', {
        event: INCOMING_EVENTS.TOGGLE_DIE_SELECTION,
        providedDieIndex: payload ? payload.dieIndex : undefined
      });
      return;
    }

    const result = engineToggleDieSelection(game, dieIndex);
    if (!result.success || !result.gameState) {
      const error = result.error || 'TOGGLE_FAILED';
      let code = 'TOGGLE_FAILED';
      let message = 'Unable to update selection.';

      if (error === 'Game state is null') {
        code = 'NO_ACTIVE_GAME';
        message = 'No active game is in progress.';
      } else if (error.startsWith('Cannot toggle selection in phase')) {
        code = 'INVALID_PHASE';
        message = 'Cannot toggle dice during this phase.';
      } else if (error === 'No active turn to toggle selection') {
        code = 'NO_ACTIVE_TURN';
        message = 'There is no active turn to update.';
      } else if (error === 'Die index out of bounds') {
        code = 'INVALID_DIE_INDEX';
        message = 'Selected die is not available.';
      } else if (error === 'Die is not selectable') {
        code = 'DIE_NOT_SELECTABLE';
        message = 'Selected die is locked and cannot be toggled.';
      }

      emitError(socket, code, message, {
        event: INCOMING_EVENTS.TOGGLE_DIE_SELECTION,
        playerId,
        dieIndex,
        engineError: error
      });
      return;
    }

    serverState.game = result.gameState;

    if (serverState.game.turn) {
      const selection = serverState.game.turn.selection || {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      };

      recordScoring({
        event: INCOMING_EVENTS.TOGGLE_DIE_SELECTION,
        playerId,
        accumulatedTurnScore: serverState.game.turn.accumulatedTurnScore,
        selectionScore: selection.selectionScore,
        selectionValid: selection.isValid,
        selectedIndices: Array.isArray(selection.selectedIndices)
          ? [...selection.selectedIndices]
          : [],
        status: serverState.game.turn.status
      });
    }

    emitGameState();
  };

  const handleRollDice = (socket) => {
    const context = ensureActivePlayer(socket, INCOMING_EVENTS.ROLL_DICE);
    if (!context) {
      return;
    }

    const { game, playerId } = context;
    const previousTurn = game.turn;
    const previousSelection = previousTurn.selection || {
      selectedIndices: [],
      isValid: false,
      selectionScore: 0
    };

    if (!previousSelection.isValid || previousSelection.selectedIndices.length === 0) {
      emitError(socket, 'INVALID_SELECTION', 'Select a valid scoring set before rolling.', {
        event: INCOMING_EVENTS.ROLL_DICE,
        playerId,
        selection: {
          isValid: previousSelection.isValid,
          selectedIndices: previousSelection.selectedIndices
        }
      });
      return;
    }

    const result = engineRollTurnDice(game);
    if (!result.success || !result.gameState) {
      const error = result.error || 'ROLL_FAILED';
      let code = 'ROLL_FAILED';
      let message = 'Unable to roll dice right now.';

      if (error === 'INVALID_PHASE') {
        code = 'INVALID_PHASE';
        message = 'Cannot roll dice in the current phase.';
      } else if (error === 'INVALID_SELECTION') {
        code = 'INVALID_SELECTION';
        message = 'Selection is not valid for rolling.';
      } else if (error === 'SELECTION_OUT_OF_RANGE') {
        code = 'SELECTION_OUT_OF_RANGE';
        message = 'Selection references dice that are not available.';
      } else if (error === 'DIE_NOT_SELECTABLE') {
        code = 'DIE_NOT_SELECTABLE';
        message = 'One or more dice are locked and cannot be rolled.';
      } else if (error === 'ADVANCE_FAILED') {
        code = 'ADVANCE_FAILED';
        message = 'Server failed to advance to the next turn.';
      }

      emitError(socket, code, message, {
        event: INCOMING_EVENTS.ROLL_DICE,
        playerId,
        engineError: error
      });
      return;
    }

    serverState.game = result.gameState;
    const outcome = result.outcome || 'continue';
    const nextTurn = serverState.game.turn;

    recordDiceRoll({
      event: INCOMING_EVENTS.ROLL_DICE,
      playerId,
      outcome,
      previousAccumulated: previousTurn.accumulatedTurnScore,
      selectionScoreCommitted: previousSelection.selectionScore,
      nextPlayerId: nextTurn ? nextTurn.playerId : null,
      diceValues: nextTurn && Array.isArray(nextTurn.dice)
        ? nextTurn.dice.map((die) => die.value)
        : [],
      selectable: nextTurn && Array.isArray(nextTurn.dice)
        ? nextTurn.dice.map((die) => die.selectable)
        : []
    });

    const playerState = findPlayerById(serverState.game, playerId);
    recordScoring({
      event: INCOMING_EVENTS.ROLL_DICE,
      playerId,
      accumulatedTurnScore:
        nextTurn && nextTurn.playerId === playerId
          ? nextTurn.accumulatedTurnScore
          : 0,
      selectionScore: 0,
      totalScore: playerState ? playerState.totalScore : 0,
      stage: outcome
    });

    emitGameState();
  };

  const handleBankScore = (socket) => {
    const context = ensureActivePlayer(socket, INCOMING_EVENTS.BANK_SCORE);
    if (!context) {
      return;
    }

    const { game, playerId } = context;
    const turn = game.turn;
    const selection = turn.selection || {
      selectedIndices: [],
      isValid: false,
      selectionScore: 0
    };

    const selectionInPlay = Array.isArray(selection.selectedIndices)
      ? selection.selectedIndices.length > 0
      : false;

    if (selectionInPlay && !selection.isValid) {
      emitError(socket, 'INVALID_SELECTION', 'Current selection is not valid for banking.', {
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId,
        selection
      });
      return;
    }

    if (!selectionInPlay && turn.accumulatedTurnScore <= 0) {
      emitError(socket, 'BANK_ZERO', 'You need points before banking.', {
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId
      });
      return;
    }

    const selectionScore = selection.isValid ? selection.selectionScore : 0;
    const bankAmount = turn.accumulatedTurnScore + selectionScore;
    const previousPlayer = findPlayerById(game, playerId);

    if (!previousPlayer) {
      emitError(socket, 'PLAYER_NOT_FOUND', 'Player could not be located for banking.', {
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId
      });
      return;
    }

    const minimumEntryScore = game.config ? game.config.minimumEntryScore || 0 : 0;
    if (!previousPlayer.hasEnteredGame && bankAmount < minimumEntryScore) {
      emitError(socket, 'MINIMUM_ENTRY_NOT_MET', 'Reach the minimum entry score before banking.', {
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId,
        minimumEntryScore,
        bankAmount,
        accumulatedTurnScore: turn.accumulatedTurnScore,
        selectionScore
      });
      return;
    }

    const result = engineBankTurnScore(game);
    if (!result.success || !result.gameState) {
      const error = result.error || 'BANK_FAILED';
      let code = 'BANK_FAILED';
      let message = 'Unable to bank score right now.';

      if (error === 'INVALID_PHASE') {
        code = 'INVALID_PHASE';
        message = 'Cannot bank during the current phase.';
      } else if (error === 'PLAYER_NOT_FOUND') {
        code = 'PLAYER_NOT_FOUND';
        message = 'Player could not be located for banking.';
      } else if (error === 'INVALID_SELECTION') {
        code = 'INVALID_SELECTION';
        message = 'Selection is not valid for banking.';
      } else if (error === 'BANK_ZERO') {
        code = 'BANK_ZERO';
        message = 'You must score before banking.';
      } else if (error === 'MINIMUM_ENTRY_NOT_MET') {
        code = 'MINIMUM_ENTRY_NOT_MET';
        message = 'Reach the minimum entry score before banking.';
      } else if (error === 'ADVANCE_FAILED') {
        code = 'ADVANCE_FAILED';
        message = 'Server failed to advance to the next turn.';
      }

      emitError(socket, code, message, {
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId,
        engineError: error
      });
      return;
    }

    serverState.game = result.gameState;

    const updatedPlayer = findPlayerById(serverState.game, playerId);
    const nextTurn = serverState.game.turn;

    recordScoring({
      event: INCOMING_EVENTS.BANK_SCORE,
      playerId,
      bankAmount,
      totalScore: updatedPlayer ? updatedPlayer.totalScore : previousPlayer ? previousPlayer.totalScore : 0,
      hasEnteredGame: updatedPlayer ? updatedPlayer.hasEnteredGame : previousPlayer ? previousPlayer.hasEnteredGame : false,
      stage: 'banked'
    });

    if (nextTurn) {
      recordDiceRoll({
        event: INCOMING_EVENTS.BANK_SCORE,
        playerId: nextTurn.playerId,
        outcome: 'turn_start',
        diceValues: Array.isArray(nextTurn.dice) ? nextTurn.dice.map((die) => die.value) : [],
        selectable: Array.isArray(nextTurn.dice) ? nextTurn.dice.map((die) => die.selectable) : []
      });
    }

    emitGameState();
  };

  const handleResetGame = (socket) => {
    const newGame = createNewGame();
    serverState.game = newGame;
    serverState.eventLog = [];

    playerSocketMap.forEach((playerSocket) => {
      clearSocketAssociation(playerSocket);
    });
    playerSocketMap.clear();

    emitGameState();
  };

  const builtinHandlers = {
    [INCOMING_EVENTS.JOIN_GAME]: handleJoinGame,
    [INCOMING_EVENTS.RECONNECT_PLAYER]: handleReconnectPlayer,
    [INCOMING_EVENTS.START_GAME]: handleStartGame,
    [INCOMING_EVENTS.TOGGLE_DIE_SELECTION]: handleToggleDieSelection,
    [INCOMING_EVENTS.ROLL_DICE]: handleRollDice,
    [INCOMING_EVENTS.BANK_SCORE]: handleBankScore,
    [INCOMING_EVENTS.RESET_GAME]: handleResetGame,
    [SOCKET_LIFECYCLE_EVENTS.DISCONNECT]: handleDisconnect
  };

  const getHandler = (eventName) => {
    if (typeof overrides[eventName] === 'function') {
      return overrides[eventName];
    }
    if (builtinHandlers[eventName]) {
      return builtinHandlers[eventName];
    }
    return DEFAULT_HANDLER(eventName);
  };

  io.on(SOCKET_LIFECYCLE_EVENTS.CONNECTION, (socket) => {
    if (!socket || typeof socket.on !== 'function') {
      return;
    }

    if (!socket.data) {
      socket.data = {};
    }

    if (serverState.game) {
      socket.emit(OUTGOING_EVENTS.GAME_STATE, serverState.game);
    }

    socket.on(INCOMING_EVENTS.RECONNECT_PLAYER, (payload) => {
      getHandler(INCOMING_EVENTS.RECONNECT_PLAYER)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.JOIN_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.JOIN_GAME)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.START_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.START_GAME)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.TOGGLE_DIE_SELECTION, (payload) => {
      getHandler(INCOMING_EVENTS.TOGGLE_DIE_SELECTION)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.ROLL_DICE, (payload) => {
      getHandler(INCOMING_EVENTS.ROLL_DICE)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.BANK_SCORE, (payload) => {
      getHandler(INCOMING_EVENTS.BANK_SCORE)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.ACKNOWLEDGE_RESULTS, (payload) => {
      getHandler(INCOMING_EVENTS.ACKNOWLEDGE_RESULTS)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.RESET_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.RESET_GAME)(socket, payload);
    });

    socket.on(SOCKET_LIFECYCLE_EVENTS.DISCONNECT, (reason) => {
      getHandler(SOCKET_LIFECYCLE_EVENTS.DISCONNECT)(socket, reason);
    });
  });
}

module.exports = {
  registerSocketHandlers,
  INCOMING_EVENTS,
  SOCKET_LIFECYCLE_EVENTS,
  OUTGOING_EVENTS
};
