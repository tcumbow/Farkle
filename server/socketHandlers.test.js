/**
 * Tests for socketHandlers.js event logic
 */

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

function createServerStateWithGame() {
  const serverState = initializeServerState(false);
  serverState.game = createNewGame();
  serverState.game.gameId = 'game-test';
  return serverState;
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
