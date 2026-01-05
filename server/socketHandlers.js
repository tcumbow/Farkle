/**
 * Socket.IO Event Registration
 *
 * Implements identity-aware event handling for lobby joins, reconnection, and
 * disconnect flow while wiring remaining events with placeholder handlers.
 */

const crypto = require('crypto');
const { createPlayerState, findPlayerById, createNewGame, logEvent } = require('./state');
const { startGame: engineStartGame } = require('./gameEngine');

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
