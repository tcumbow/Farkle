/**
 * Unit Tests for Farkle Server State Management
 * 
 * Tests state initialization, reset, and helper functions
 */

const {
  initializeServerState,
  createNewGame,
  createPlayerState,
  createTurnState,
  rollDice,
  createEmptySelection,
  resetServerState,
  clearGame,
  logEvent,
  getActivePlayer,
  findPlayerById,
  canPlayerBank,
  validateStateInvariants
} = require('./state');

// Test helpers
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

function assertEquals(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    console.error(`     Expected: ${expected}, Got: ${actual}`);
    testsFailed++;
  }
}

function assertNotNull(value, message) {
  if (value !== null && value !== undefined) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    console.error(`     Value was null or undefined`);
    testsFailed++;
  }
}

function runTests() {
  console.log('\n=== Farkle State Management Tests ===\n');

  // === initializeServerState Tests ===
  console.log('--- initializeServerState Tests ---');
  const serverState = initializeServerState();
  assertEquals(serverState.game, null, 'Initial game should be null');
  assertEquals(serverState.eventLogEnabled, false, 'Event log disabled by default');
  assert(Array.isArray(serverState.eventLog), 'Event log should be an array');
  assertEquals(serverState.eventLog.length, 0, 'Event log should be empty');

  const serverStateWithLog = initializeServerState(true);
  assertEquals(serverStateWithLog.eventLogEnabled, true, 'Event log can be enabled');

  // === createNewGame Tests ===
  console.log('\n--- createNewGame Tests ---');
  const game = createNewGame();
  assertNotNull(game.gameId, 'Game should have an ID');
  assertEquals(game.phase, 'lobby', 'New game should be in lobby phase');
    assertEquals(game.config.minimumEntryScore, 500, 'Default minimum entry score is 500');
    assertEquals(game.config.targetScore, 10000, 'Default target score is 10000');
  assert(Array.isArray(game.players), 'Players should be an array');
  assertEquals(game.players.length, 0, 'New game has no players');
    const customGameWithTargets = createNewGame(1000, 12000);
    assertEquals(customGameWithTargets.config.minimumEntryScore, 1000, 'Custom minimum entry score');
    assertEquals(customGameWithTargets.config.targetScore, 12000, 'Custom target score');
  assertEquals(game.turnOrder.length, 0, 'TurnOrder starts empty');
  assertEquals(game.activeTurnIndex, 0, 'ActiveTurnIndex starts at 0');
  assertEquals(game.turn, null, 'Turn should be null in lobby');
  assertNotNull(game.createdAt, 'Game should have creation timestamp');
  assertEquals(game.finishedAt, null, 'FinishedAt should be null initially');

  const customGame = createNewGame(1000);
  assertEquals(customGame.config.minimumEntryScore, 1000, 'Custom minimum entry score');

  // === createPlayerState Tests ===
  console.log('\n--- createPlayerState Tests ---');
  const player = createPlayerState('player-1', 'Alice');
  assertEquals(player.playerId, 'player-1', 'Player should have correct ID');
  assertNotNull(player.playerSecret, 'Player should have a secret');
  assert(player.playerSecret.length === 32, 'Player secret should be 32 hex chars');
  assertEquals(player.name, 'Alice', 'Player should have correct name');
  assertEquals(player.totalScore, 0, 'Player starts with 0 score');
  assertEquals(player.hasEnteredGame, false, 'Player has not entered game yet');
  assertEquals(player.connected, true, 'Player starts connected');
  assertNotNull(player.joinedAt, 'Player should have join timestamp');

  // === createTurnState Tests ===
  console.log('\n--- createTurnState Tests ---');
  const turn = createTurnState('player-1');
  assertEquals(turn.playerId, 'player-1', 'Turn belongs to correct player');
  assert(Array.isArray(turn.dice), 'Dice should be an array');
  assertEquals(turn.dice.length, 6, 'Turn starts with 6 dice');
  assertEquals(turn.accumulatedTurnScore, 0, 'Turn score starts at 0');
  assertNotNull(turn.selection, 'Turn should have selection object');
  assertEquals(turn.status, 'awaiting_selection', 'Turn starts awaiting selection');

  const turnWith3Dice = createTurnState('player-2', 3);
  assertEquals(turnWith3Dice.dice.length, 3, 'Can create turn with custom dice count');

  // === rollDice Tests ===
  console.log('\n--- rollDice Tests ---');
  const dice = rollDice(6);
  assertEquals(dice.length, 6, 'Rolls correct number of dice');
  assert(dice.every(d => d.value >= 1 && d.value <= 6), 'All dice values are 1-6');
  assert(dice.every(d => d.selectable === true), 'All dice are selectable by default');

  const unselectableDice = rollDice(3, false);
  assert(unselectableDice.every(d => d.selectable === false), 'Can create non-selectable dice');

  // === createEmptySelection Tests ===
  console.log('\n--- createEmptySelection Tests ---');
  const selection = createEmptySelection();
  assert(Array.isArray(selection.selectedIndices), 'Selection has indices array');
  assertEquals(selection.selectedIndices.length, 0, 'Selection starts empty');
  assertEquals(selection.isValid, true, 'Empty selection is valid');
  assertEquals(selection.selectionScore, 0, 'Empty selection scores 0');

  // === resetServerState Tests ===
  console.log('\n--- resetServerState Tests ---');
  const state1 = initializeServerState();
  state1.game = createNewGame();
  state1.game.players.push(createPlayerState('p1', 'Player 1'));
  state1.eventLog.push({ timestamp: Date.now(), type: 'TEST', payload: {} });

  resetServerState(state1);
  assertNotNull(state1.game, 'Game should exist after reset');
  assertEquals(state1.game.phase, 'lobby', 'New game in lobby phase');
  assertEquals(state1.game.players.length, 0, 'Players cleared after reset');
  assertEquals(state1.eventLog.length, 0, 'Event log cleared after reset');

  const state2 = initializeServerState();
    resetServerState(state2, 750, 15000);
  assertEquals(state2.game.config.minimumEntryScore, 750, 'Can set custom minimum on reset');
    assertEquals(state2.game.config.targetScore, 15000, 'Reset applies new target score');

  // === clearGame Tests ===
  console.log('\n--- clearGame Tests ---');
  const state3 = initializeServerState();
  state3.game = createNewGame();
  clearGame(state3);
  assertEquals(state3.game, null, 'Game cleared to null');
  assertEquals(state3.eventLog.length, 0, 'Event log cleared');

  // === logEvent Tests ===
  console.log('\n--- logEvent Tests ---');
  const stateNoLog = initializeServerState(false);
  logEvent(stateNoLog, 'TEST_EVENT', { data: 'test' });
  assertEquals(stateNoLog.eventLog.length, 0, 'No event logged when disabled');

  const stateWithLog = initializeServerState(true);
  logEvent(stateWithLog, 'DICE_ROLL', { playerId: 'p1', dice: [1, 2, 3] });
  assertEquals(stateWithLog.eventLog.length, 1, 'Event logged when enabled');
  assertEquals(stateWithLog.eventLog[0].type, 'DICE_ROLL', 'Event has correct type');
  assertNotNull(stateWithLog.eventLog[0].timestamp, 'Event has timestamp');
  assertNotNull(stateWithLog.eventLog[0].payload, 'Event has payload');

  // === getActivePlayer Tests ===
  console.log('\n--- getActivePlayer Tests ---');
  const gameInLobby = createNewGame();
  assertEquals(getActivePlayer(gameInLobby), null, 'No active player in lobby');

  const gameInProgress = createNewGame();
  gameInProgress.phase = 'in_progress';
  gameInProgress.players.push(createPlayerState('p1', 'Alice'));
  gameInProgress.players.push(createPlayerState('p2', 'Bob'));
  gameInProgress.turnOrder = ['p1', 'p2'];
  gameInProgress.activeTurnIndex = 0;

  const activePlayer = getActivePlayer(gameInProgress);
  assertNotNull(activePlayer, 'Active player found');
  assertEquals(activePlayer.playerId, 'p1', 'Correct active player (first in turn order)');

  gameInProgress.activeTurnIndex = 1;
  const activePlayer2 = getActivePlayer(gameInProgress);
  assertEquals(activePlayer2.playerId, 'p2', 'Active player updates with index');

  // === findPlayerById Tests ===
  console.log('\n--- findPlayerById Tests ---');
  const gameWithPlayers = createNewGame();
  gameWithPlayers.players.push(createPlayerState('p1', 'Alice'));
  gameWithPlayers.players.push(createPlayerState('p2', 'Bob'));

  const found = findPlayerById(gameWithPlayers, 'p2');
  assertNotNull(found, 'Player found by ID');
  assertEquals(found.name, 'Bob', 'Correct player found');

  const notFound = findPlayerById(gameWithPlayers, 'p999');
  assertEquals(notFound, null, 'Returns null for unknown player');

  assertEquals(findPlayerById(null, 'p1'), null, 'Returns null for null game');

  // === canPlayerBank Tests ===
  console.log('\n--- canPlayerBank Tests ---');
  const bankGame = createNewGame(500);
  const p1 = createPlayerState('p1', 'Alice');
  bankGame.players.push(p1);
  bankGame.turnOrder = ['p1'];
  bankGame.phase = 'in_progress';

  assertEquals(canPlayerBank(bankGame, 'p1'), false, 'Cannot bank without turn');

  bankGame.turn = createTurnState('p1');
  bankGame.turn.selection.isValid = false;
  assertEquals(canPlayerBank(bankGame, 'p1'), false, 'Cannot bank with invalid selection');

  bankGame.turn.selection.isValid = true;
  bankGame.turn.selection.selectionScore = 100;
  bankGame.turn.accumulatedTurnScore = 0;
  assertEquals(canPlayerBank(bankGame, 'p1'), false, 'Cannot bank below minimum in first banking attempt');

  bankGame.turn.accumulatedTurnScore = 400;
  assertEquals(canPlayerBank(bankGame, 'p1'), true, 'Can bank when current turn meets entry threshold (400+100=500)');

  p1.hasEnteredGame = true;
  bankGame.turn.accumulatedTurnScore = 0;
  bankGame.turn.selection.selectionScore = 50;
  assertEquals(canPlayerBank(bankGame, 'p1'), true, 'Can bank any score after entering');

  bankGame.turn.accumulatedTurnScore = 0;
  bankGame.turn.selection.selectionScore = 0;
  assertEquals(canPlayerBank(bankGame, 'p1'), false, 'Cannot bank zero score');

  // === validateStateInvariants Tests ===
  console.log('\n--- validateStateInvariants Tests ---');
  
  const validState = initializeServerState();
  try {
    validateStateInvariants(validState);
    console.log('  ✓ Validates idle state (game is null)');
    testsPassed++;
  } catch (e) {
    console.error(`  ❌ FAILED: Should validate idle state`);
    console.error(`     ${e.message}`);
    testsFailed++;
  }

  const validGame = createNewGame();
  validGame.players.push(createPlayerState('p1', 'Alice'));
  validGame.players.push(createPlayerState('p2', 'Bob'));
  validGame.turnOrder = ['p1', 'p2'];
  validGame.phase = 'lobby';
  validState.game = validGame;

  try {
    validateStateInvariants(validState);
    console.log('  ✓ Validates valid lobby state');
    testsPassed++;
  } catch (e) {
    console.error(`  ❌ FAILED: Should validate lobby state`);
    console.error(`     ${e.message}`);
    testsFailed++;
  }

  validGame.phase = 'in_progress';
  validGame.activeTurnIndex = 0;
  validGame.turn = createTurnState('p1');

  try {
    validateStateInvariants(validState);
    console.log('  ✓ Validates valid in_progress state');
    testsPassed++;
  } catch (e) {
    console.error(`  ❌ FAILED: Should validate in_progress state`);
    console.error(`     ${e.message}`);
    testsFailed++;
  }

  // Test invariant violation: turnOrder length mismatch
  const invalidState1 = initializeServerState();
  const invalidGame1 = createNewGame();
  invalidGame1.players.push(createPlayerState('p1', 'Alice'));
  invalidGame1.turnOrder = ['p1', 'p2']; // Mismatch!
  invalidState1.game = invalidGame1;

  try {
    validateStateInvariants(invalidState1);
    console.error('  ❌ FAILED: Should reject turnOrder length mismatch');
    testsFailed++;
  } catch (e) {
    console.log('  ✓ Rejects turnOrder length mismatch');
    testsPassed++;
  }

  // Test invariant violation: turn not null in lobby
  const invalidState2 = initializeServerState();
  const invalidGame2 = createNewGame();
  invalidGame2.phase = 'lobby';
  invalidGame2.turn = createTurnState('p1'); // Should be null!
  invalidState2.game = invalidGame2;

  try {
    validateStateInvariants(invalidState2);
    console.error('  ❌ FAILED: Should reject turn in lobby phase');
    testsFailed++;
  } catch (e) {
    console.log('  ✓ Rejects turn existing in lobby phase');
    testsPassed++;
  }

  // Test invariant violation: invalid activeTurnIndex
  const invalidState3 = initializeServerState();
  const invalidGame3 = createNewGame();
  invalidGame3.phase = 'in_progress';
  invalidGame3.players.push(createPlayerState('p1', 'Alice'));
  invalidGame3.turnOrder = ['p1'];
  invalidGame3.activeTurnIndex = 5; // Out of bounds!
  invalidGame3.turn = createTurnState('p1');
  invalidState3.game = invalidGame3;

  try {
    validateStateInvariants(invalidState3);
    console.error('  ❌ FAILED: Should reject invalid activeTurnIndex');
    testsFailed++;
  } catch (e) {
    console.log('  ✓ Rejects invalid activeTurnIndex');
    testsPassed++;
  }

  // === Summary ===
  console.log('\n=== Test Summary ===');
  const total = testsPassed + testsFailed;
  console.log(`Passed: ${testsPassed}/${total}`);
  
  if (testsFailed === 0) {
    console.log('✅ All tests passed!\n');
    return true;
  } else {
    console.log(`❌ ${testsFailed} test(s) failed\n`);
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runTests };
