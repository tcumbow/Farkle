/**
 * Tests for socketHandlers.js event logic
 */

const crypto = require('crypto');

const {
  registerSocketHandlers,
  INCOMING_EVENTS,
  SOCKET_LIFECYCLE_EVENTS,
  OUTGOING_EVENTS
} = require('./socketHandlers');
const { initializeServerState, createNewGame, createPlayerState } = require('./state');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    testsFailed++;
  }
}

function createMockIo() {
  return {
    handlers: {},
    emitted: [],
    on(event, handler) {
      this.handlers[event] = handler;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    }
  };
}

function createMockSocket() {
  return {
    handlers: {},
    emitted: [],
    data: {},
    on(event, handler) {
      this.handlers[event] = handler;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    }
  };
}

function createServerStateWithGame(eventLogEnabled = false) {
  const serverState = initializeServerState(eventLogEnabled);
  serverState.game = createNewGame();
  serverState.game.gameId = 'game-test';
  return serverState;
}

function withDeterministicRandomInt(callback) {
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = (minOrMax, maybeMax) => {
    if (typeof maybeMax === 'number') {
      return minOrMax;
    }
    return 0;
  };
  try {
    return callback();
  } finally {
    crypto.randomInt = originalRandomInt;
  }
}

function runTests() {
  console.log('\n=== Socket Handler Tests ===\n');

  // Invalid io instance
  try {
    const serverState = createServerStateWithGame();
    registerSocketHandlers(null, serverState);
    console.error('  ❌ FAILED: Expected error for invalid io instance');
    testsFailed++;
  } catch (e) {
    assert(e.message.includes('Socket.IO'), 'Throws error when io is invalid');
  }

  // Missing server state
  try {
    const io = createMockIo();
    registerSocketHandlers(io, null);
    console.error('  ❌ FAILED: Expected error for missing server state');
    testsFailed++;
  } catch (e) {
    assert(e.message.includes('Server state'), 'Throws error when server state missing');
  }

  // Join game success
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    const idSequence = ['player-join'];
    registerSocketHandlers(io, serverState, { idGenerator: () => idSequence.shift() });
    assert(typeof io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION] === 'function', 'Connection handler registered');

    const socket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](socket);

    const initialState = socket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE);
    assert(!!initialState, 'New connection receives current game state');

    const expectedEvents = [
      INCOMING_EVENTS.RECONNECT_PLAYER,
      INCOMING_EVENTS.JOIN_GAME,
      INCOMING_EVENTS.START_GAME,
      INCOMING_EVENTS.TOGGLE_DIE_SELECTION,
      INCOMING_EVENTS.ROLL_DICE,
      INCOMING_EVENTS.BANK_SCORE,
      INCOMING_EVENTS.ACKNOWLEDGE_RESULTS,
      INCOMING_EVENTS.RESET_GAME,
      SOCKET_LIFECYCLE_EVENTS.DISCONNECT
    ];
    expectedEvents.forEach((eventName) => {
      assert(eventName in socket.handlers, `Registers listener for ${eventName}`);
    });

    socket.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: ' Alice ' });

    assert(serverState.game.players.length === 1, 'Player added to game');
    assert(serverState.game.turnOrder[0] === 'player-join', 'Turn order updated');
    const joinEvent = socket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.JOIN_SUCCESS);
    assert(!!joinEvent, 'join_success emitted to joining socket');
    assert(joinEvent.payload.playerId === 'player-join', 'join_success payload includes playerId');
    assert(typeof joinEvent.payload.playerSecret === 'string', 'join_success payload includes playerSecret');
    assert(serverState.game.players[0].name === 'Alice', 'Player name trimmed');
    assert(io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Broadcasts game_state after join');
  }

  // Join game invalid payload (empty name)
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    registerSocketHandlers(io, serverState, { idGenerator: () => 'player-x' });
    const socket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](socket);

    socket.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: '   ' });

    assert(serverState.game.players.length === 0, 'Rejects join with empty name');
    const errorEvent = socket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.ERROR);
    assert(!!errorEvent, 'Emits error when join fails');
    assert(!io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Does not broadcast state on failed join');
  }

  // Reconnect success
  {
    const serverState = createServerStateWithGame();
    const player = createPlayerState('player-reconnect', 'Rita');
    player.connected = false;
    serverState.game.players.push(player);
    serverState.game.turnOrder.push(player.playerId);

    const io = createMockIo();
    registerSocketHandlers(io, serverState);
    const socket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](socket);

    socket.handlers[INCOMING_EVENTS.RECONNECT_PLAYER]({
      gameId: 'game-test',
      playerId: player.playerId,
      playerSecret: player.playerSecret
    });

    assert(player.connected === true, 'Marks player connected on reconnect');
    assert(socket.data.playerId === player.playerId, 'Associates socket with player');
    assert(io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length === 1, 'Broadcasts game_state on reconnect');
  }

  // Reconnect failure due to invalid secret
  {
    const serverState = createServerStateWithGame();
    const player = createPlayerState('player-reject', 'Nina');
    player.connected = false;
    serverState.game.players.push(player);
    serverState.game.turnOrder.push(player.playerId);

    const io = createMockIo();
    registerSocketHandlers(io, serverState);
    const socket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](socket);

    socket.handlers[INCOMING_EVENTS.RECONNECT_PLAYER]({
      gameId: 'game-test',
      playerId: player.playerId,
      playerSecret: 'bad-secret'
    });

    assert(player.connected === false, 'Player remains disconnected when credentials invalid');
    const errorEvent = socket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.ERROR);
    assert(!!errorEvent, 'Emits error on invalid reconnect');
    assert(!io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Does not broadcast state on failed reconnect');
  }

  // Disconnect handling
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    const idSequence = ['player-disc'];
    registerSocketHandlers(io, serverState, { idGenerator: () => idSequence.shift() });
    const socket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](socket);

    socket.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Donna' });
    const player = serverState.game.players[0];
    assert(player.connected === true, 'Player connected after join');

    socket.handlers[SOCKET_LIFECYCLE_EVENTS.DISCONNECT]('transport close');
    assert(player.connected === false, 'Player marked disconnected on socket disconnect');
    assert(io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length === 2, 'Broadcasts game_state on disconnect');
  }

  // Start game success (drops ghost players and randomizes order)
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    const idSequence = ['player-one', 'player-two'];
    const shuffleTurnOrder = (order) => order.slice().reverse();
    registerSocketHandlers(io, serverState, {
      idGenerator: () => idSequence.shift(),
      shuffleTurnOrder
    });

    const phoneSocketA = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocketA);
    phoneSocketA.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Alice' });

    const phoneSocketB = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocketB);
    phoneSocketB.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Bob' });

    serverState.game.players.push({
      playerId: 'ghost-player',
      playerSecret: 'ghost-secret',
      name: 'Ghost',
      totalScore: 0,
      hasEnteredGame: false,
      connected: true,
      joinedAt: Date.now()
    });
    serverState.game.turnOrder.push('ghost-player');

    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);

    const broadcastCountBeforeStart = io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length;

    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});

    assert(serverState.game.phase === 'in_progress', 'Game transitions to in_progress on start');
    assert(serverState.game.players.length === 2, 'Ghost players removed before start');
    assert(!serverState.game.players.some((p) => p.playerId === 'ghost-player'), 'Ghost player pruned from roster');
    assert(serverState.game.turnOrder.length === 2, 'Turn order contains only real players');
    assert(serverState.game.turn.playerId === serverState.game.turnOrder[0], 'Turn assigned to first shuffled player');
    assert(serverState.game.turn.dice.length === 6, 'Turn initializes with 6 dice');

    const expectedOrder = ['player-two', 'player-one'];
    assert(JSON.stringify(serverState.game.turnOrder) === JSON.stringify(expectedOrder), 'Turn order randomized using provided shuffle');

    const broadcastCountAfterStart = io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length;
    assert(broadcastCountAfterStart === broadcastCountBeforeStart + 1, 'Broadcast game_state after successful start');
    assert(!tvSocket.emitted.some((evt) => evt.event === OUTGOING_EVENTS.ERROR), 'No error emitted during successful start');
    assert(serverState.eventLog.length === 0, 'No event log entries recorded when logging disabled');
  }

  // Event logging when enabled
  {
    const serverState = createServerStateWithGame(true);
    const io = createMockIo();
    const idSequence = ['player-log'];
    registerSocketHandlers(io, serverState, {
      idGenerator: () => idSequence.shift(),
      shuffleTurnOrder: (order) => order.slice()
    });

    const phoneSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocket);
    phoneSocket.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Loggy' });

    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);

    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});

    const stateEvent = serverState.eventLog.find((entry) => entry.type === 'STATE_TRANSITION');
    assert(!!stateEvent, 'Logs state transition on start_game when enabled');
    assert(stateEvent.payload.to === 'in_progress', 'State transition payload captures target phase');

    const diceEvent = serverState.eventLog.find((entry) => entry.type === 'DICE_ROLL');
    assert(!!diceEvent, 'Logs dice roll event for new turn');
    assert(Array.isArray(diceEvent.payload.diceValues), 'Dice roll payload includes values array');

    const scoringEvent = serverState.eventLog.find((entry) => entry.type === 'SCORING');
    assert(!!scoringEvent, 'Logs scoring snapshot for active player');
    assert(scoringEvent.payload.playerId === serverState.game.turn.playerId, 'Scoring event references active player');
  }

  // Start game failure scenarios
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    registerSocketHandlers(io, serverState);
    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);

    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});
    const errorEvent = tvSocket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.ERROR);
    assert(!!errorEvent, 'start_game emits error when no players present');
    assert(errorEvent.payload.code === 'NO_PLAYERS', 'start_game error code identifies missing players');
    assert(io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length === 0, 'No broadcast when start fails');

    serverState.game.phase = 'in_progress';
    tvSocket.emitted = [];
    io.emitted = [];
    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});
    const phaseError = tvSocket.emitted.find((evt) => evt.event === OUTGOING_EVENTS.ERROR);
    assert(!!phaseError, 'start_game emits error when phase invalid');
    assert(phaseError.payload.code === 'INVALID_PHASE', 'start_game invalid phase error code reported');
    assert(io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length === 0, 'No broadcast when phase invalid');
  }

  // Illegal action logging when enabled
  {
    const serverState = createServerStateWithGame(true);
    const io = createMockIo();
    registerSocketHandlers(io, serverState);
    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);

    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});

    const illegalEvent = serverState.eventLog.find((entry) => entry.type === 'ILLEGAL_ACTION');
    assert(!!illegalEvent, 'Records illegal action when start_game invalid');
    assert(illegalEvent.payload.code === 'NO_PLAYERS', 'Illegal action payload captures error code');
  }

  // Reset game
  {
    const serverState = createServerStateWithGame();
    const io = createMockIo();
    const idSequence = ['player-reset'];
    registerSocketHandlers(io, serverState, { idGenerator: () => idSequence.shift() });

    const phoneSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocket);
    phoneSocket.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Riley' });

    serverState.eventLog.push({ timestamp: Date.now(), type: 'TEST', payload: {} });

    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);

    io.emitted = [];

    tvSocket.handlers[INCOMING_EVENTS.RESET_GAME]({});

    assert(serverState.game.phase === 'lobby', 'Reset returns game to lobby phase');
    assert(serverState.game.players.length === 0, 'Reset clears all players');
    assert(serverState.eventLog.length === 0, 'Reset clears event log');
    assert(phoneSocket.data.playerId === undefined, 'Player socket disassociated after reset (playerId removed)');
    assert(phoneSocket.data.playerSecret === undefined, 'Player socket disassociated after reset (playerSecret removed)');
    assert(io.emitted.filter((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).length === 1, 'Reset broadcasts new game_state');
    const finalState = io.emitted.find((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE).payload;
    assert(finalState.players.length === 0, 'Broadcasted state reflects empty roster');
  }

  // Gameplay handlers (toggle, roll, bank)
  withDeterministicRandomInt(() => {
    const serverState = createServerStateWithGame(true);
    const io = createMockIo();
    const idSequence = ['player-active', 'player-b'];
    registerSocketHandlers(io, serverState, {
      idGenerator: () => idSequence.shift(),
      shuffleTurnOrder: (order) => order.slice()
    });

    const phoneSocketA = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocketA);
    phoneSocketA.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Active' });

    const phoneSocketB = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](phoneSocketB);
    phoneSocketB.handlers[INCOMING_EVENTS.JOIN_GAME]({ gameId: 'game-test', name: 'Backup' });

    const tvSocket = createMockSocket();
    io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION](tvSocket);
    io.emitted = [];
    tvSocket.handlers[INCOMING_EVENTS.START_GAME]({});

    assert(io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Broadcast state after deterministic start');

    const activePlayerId = phoneSocketA.data.playerId;
    const backupPlayerId = phoneSocketB.data.playerId;
    assert(serverState.game.turn.playerId === activePlayerId, 'First player is active after start');

    serverState.game.config.minimumEntryScore = 100;

    io.emitted = [];
    phoneSocketA.handlers[INCOMING_EVENTS.TOGGLE_DIE_SELECTION]({ dieIndex: 0 });
    assert(serverState.game.turn.selection.isValid === true, 'Toggle yields valid selection');
    assert(serverState.game.turn.selection.selectionScore > 0, 'Toggle produces positive selection score');
    assert(io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Toggle emits updated game state');

    io.emitted = [];
    phoneSocketA.handlers[INCOMING_EVENTS.ROLL_DICE]({});
    assert(serverState.game.turn.playerId === activePlayerId, 'Roll retains active player on non-bust outcome');
    assert(serverState.game.turn.accumulatedTurnScore > 0, 'Roll accumulates score');
    assert(serverState.game.turn.selection.selectedIndices.length === 0, 'Roll clears selection');
    assert(serverState.game.turn.status === 'awaiting_selection', 'Roll resets status to awaiting selection');
    assert(io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Roll emits updated game state');
    const rollLog = serverState.eventLog.find(
      (entry) => entry.type === 'DICE_ROLL' && entry.payload.event === INCOMING_EVENTS.ROLL_DICE
    );
    assert(!!rollLog, 'Roll handler logs dice roll event with context');

    io.emitted = [];
    phoneSocketA.handlers[INCOMING_EVENTS.BANK_SCORE]({});
    const activePlayer = serverState.game.players.find((p) => p.playerId === activePlayerId);
    assert(activePlayer.totalScore >= 100, 'Bank adds accumulated points to player total');
    assert(activePlayer.hasEnteredGame === true, 'Bank marks player as entered');
    assert(serverState.game.turn.playerId === backupPlayerId, 'Bank advances turn to next player');
    assert(io.emitted.some((evt) => evt.event === OUTGOING_EVENTS.GAME_STATE), 'Bank emits updated game state');
    const bankLog = serverState.eventLog.find(
      (entry) => entry.type === 'SCORING' && entry.payload.event === INCOMING_EVENTS.BANK_SCORE
    );
    assert(!!bankLog, 'Bank handler logs scoring snapshot');
    const bankRollLog = serverState.eventLog.find(
      (entry) => entry.type === 'DICE_ROLL' && entry.payload.event === INCOMING_EVENTS.BANK_SCORE
    );
    assert(!!bankRollLog, 'Bank handler logs new turn dice roll');

    io.emitted = [];
    phoneSocketA.emitted = [];
    phoneSocketA.handlers[INCOMING_EVENTS.ROLL_DICE]({});
    const notTurnError = phoneSocketA.emitted.find((evt) => evt.event === OUTGOING_EVENTS.ERROR);
    assert(!!notTurnError, 'Non-active player receives error when attempting roll');
    assert(notTurnError.payload.code === 'NOT_YOUR_TURN', 'Error code indicates turn ownership violation');
    assert(io.emitted.length === 0, 'No broadcast occurs on rejected roll');
  });

  // Summary
  console.log('\n=== Test Summary ===');
  const total = testsPassed + testsFailed;
  console.log(`Passed: ${testsPassed}/${total}`);

  if (testsFailed === 0) {
    console.log('✅ All tests passed!\n');
    return true;
  }

  console.log(`❌ ${testsFailed} test(s) failed\n`);
  return false;
}

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runTests };
