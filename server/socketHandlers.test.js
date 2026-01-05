/**
 * Tests for socketHandlers.js registration wiring
 */

const { registerSocketHandlers, INCOMING_EVENTS, SOCKET_LIFECYCLE_EVENTS } = require('./socketHandlers');

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

function runTests() {
  console.log('\n=== Socket Handler Registration Tests ===\n');

  // Test: throws when io invalid
  try {
    registerSocketHandlers(null);
    console.error('  ❌ FAILED: Expected error for invalid io instance');
    testsFailed++;
  } catch (e) {
    assert(e.message.includes('Socket.IO'), 'Throws error when io is invalid');
  }

  // Setup fake io and socket
  const io = {
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
    }
  };

  const capturedEvents = [];
  const socket = {
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
      capturedEvents.push(event);
    }
  };

  const callbackTracker = {};
  Object.values(INCOMING_EVENTS).forEach((eventName) => {
    callbackTracker[eventName] = { called: false, payload: null };
  });
  callbackTracker[SOCKET_LIFECYCLE_EVENTS.DISCONNECT] = { called: false, payload: null };

  const handlers = {};
  Object.keys(callbackTracker).forEach((eventName) => {
    handlers[eventName] = (sock, payload) => {
      callbackTracker[eventName].called = true;
      callbackTracker[eventName].payload = { sock, payload };
    };
  });

  registerSocketHandlers(io, handlers);
  assert(typeof io.handlers[SOCKET_LIFECYCLE_EVENTS.CONNECTION] === 'function', 'Registers connection handler on io');

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
    assert(eventName in socket.handlers, `Socket listener registered for ${eventName}`);
  });

  // Trigger each event and ensure associated handler invoked
  expectedEvents.forEach((eventName) => {
    const handler = socket.handlers[eventName];
    handler({ input: eventName });
    assert(callbackTracker[eventName].called, `External handler invoked for ${eventName}`);
    assert(callbackTracker[eventName].payload !== null, `Payload captured for ${eventName}`);
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
