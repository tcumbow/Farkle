/**
 * Tests for gameEngine.js dice rolling and game flow
 */

const {
  rollOneDie,
  rollDice,
  rollInitialDice,
  lockAndRollRemaining,
  isHotDiceCondition,
  rollHotDice,
  startGame,
  advanceToNextTurn,
  initializeTurnState,
  addPlayer,
  finishGame,
  toggleDieSelection,
  evaluateSelection
} = require('./gameEngine');

const { createNewGame, createPlayerState } = require('./state');

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

function runTests() {
  console.log('\n=== Game Engine Tests ===\n');

  // === Dice Rolling Tests ===
  console.log('--- Dice Rolling Tests ---');
  
  const die = rollOneDie();
  assert(die >= 1 && die <= 6, 'rollOneDie returns value 1-6');

  const threeDice = rollDice(3);
  assertEquals(threeDice.length, 3, 'rollDice rolls correct count');
  assert(threeDice.every(d => d.value >= 1 && d.value <= 6), 'All dice values valid');
  assert(threeDice.every(d => d.selectable === true), 'Dice are selectable by default');

  const unselectableDice = rollDice(2, false);
  assert(unselectableDice.every(d => d.selectable === false), 'Can create non-selectable dice');

  const initialDice = rollInitialDice();
  assertEquals(initialDice.length, 6, 'rollInitialDice returns 6 dice');
  assert(initialDice.every(d => d.selectable === true), 'Initial dice are selectable');

  const hotDice = rollHotDice();
  assertEquals(hotDice.length, 6, 'rollHotDice returns 6 dice');
  assert(hotDice.every(d => d.selectable === true), 'Hot dice are selectable');

  // === lockAndRollRemaining Tests ===
  console.log('\n--- Lock and Roll Remaining Tests ---');
  
  const currentDice = rollDice(6);
  const selectedIndices = [0, 2, 4]; // Select 3 dice
  const remaining = lockAndRollRemaining(currentDice, selectedIndices);
  assertEquals(remaining.length, 3, 'Remaining dice count correct (6 - 3 = 3)');

  const allSelected = lockAndRollRemaining(currentDice, [0, 1, 2, 3, 4, 5]);
  assertEquals(allSelected.length, 0, 'Returns empty array when all dice selected (hot dice)');

  // === Hot Dice Detection Tests ===
  console.log('\n--- Hot Dice Detection Tests ---');
  
  assert(isHotDiceCondition(6, [0, 1, 2, 3, 4, 5]), 'Detects hot dice with all 6 selected');
  assert(isHotDiceCondition(3, [0, 1, 2]), 'Detects hot dice with all 3 selected');
  assert(!isHotDiceCondition(6, [0, 2, 4]), 'Not hot dice with partial selection');
  assert(!isHotDiceCondition(6, []), 'Not hot dice with no selection');

  // === startGame Tests ===
  console.log('\n--- startGame Tests ---');
  
  const game = createNewGame();
  const p1 = createPlayerState('p1', 'Alice');
  const p2 = createPlayerState('p2', 'Bob');
  
  let result = addPlayer(game, p1);
  result = addPlayer(result.gameState, p2);
  const gameWithPlayers = result.gameState;

  const startResult = startGame(gameWithPlayers);
  assert(startResult.success, 'Successfully starts game');
  assertEquals(startResult.gameState.phase, 'in_progress', 'Game phase is in_progress');
  assert(startResult.gameState.turn !== null, 'Turn state exists');
  assertEquals(startResult.gameState.turn.playerId, 'p1', 'First player is active');
  assertEquals(startResult.gameState.turn.dice.length, 6, 'Turn has 6 dice');
  assertEquals(startResult.gameState.turn.accumulatedTurnScore, 0, 'Turn score starts at 0');
  assertEquals(startResult.gameState.turn.status, 'awaiting_selection', 'Status is awaiting_selection');

  // Test error cases
  const noPlayersResult = startGame(createNewGame());
  assert(!noPlayersResult.success, 'Cannot start game with no players');
  assert(noPlayersResult.error.includes('no players'), 'Error message mentions no players');

  const alreadyStartedResult = startGame(startResult.gameState);
  assert(!alreadyStartedResult.success, 'Cannot start game that is already started');

  // === advanceToNextTurn Tests ===
  console.log('\n--- advanceToNextTurn Tests ---');
  
  const gameInProgress = startResult.gameState;
  const nextResult = advanceToNextTurn(gameInProgress);
  
  assert(nextResult.success, 'Successfully advances turn');
  assertEquals(nextResult.gameState.activeTurnIndex, 1, 'Turn index advanced to 1');
  assertEquals(nextResult.gameState.turn.playerId, 'p2', 'Second player is active');
  assertEquals(nextResult.gameState.turn.dice.length, 6, 'Next turn has 6 dice');
  assertEquals(nextResult.gameState.turn.accumulatedTurnScore, 0, 'Next turn score starts at 0');

  // Advance again to wrap around
  const wrapResult = advanceToNextTurn(nextResult.gameState);
  assertEquals(wrapResult.gameState.activeTurnIndex, 0, 'Turn index wraps to 0');
  assertEquals(wrapResult.gameState.turn.playerId, 'p1', 'First player is active again');

  // Test error case
  const lobbyAdvanceResult = advanceToNextTurn(createNewGame());
  assert(!lobbyAdvanceResult.success, 'Cannot advance turn in lobby phase');

  // === initializeTurnState Tests ===
  console.log('\n--- initializeTurnState Tests ---');
  
  const dice = rollDice(4);
  const turnState = initializeTurnState('p1', dice, 250);
  
  assertEquals(turnState.playerId, 'p1', 'Turn has correct player ID');
  assertEquals(turnState.dice.length, 4, 'Turn has correct dice count');
  assertEquals(turnState.accumulatedTurnScore, 250, 'Turn has accumulated score');
  assertEquals(turnState.status, 'awaiting_selection', 'Turn status is awaiting_selection');
  assertEquals(turnState.selection.selectedIndices.length, 0, 'Selection starts empty');

  try {
    initializeTurnState('p1', [], 0);
    console.error('  ❌ FAILED: Should throw error for empty dice');
    testsFailed++;
  } catch (e) {
    console.log('  ✓ Throws error for empty dice');
    testsPassed++;
  }

  // === finishGame Tests ===
  console.log('\n--- finishGame Tests ---');
  
  const finishResult = finishGame(gameInProgress);
  assert(finishResult.success, 'Successfully finishes game');
  assertEquals(finishResult.gameState.phase, 'finished', 'Game phase is finished');
  assertEquals(finishResult.gameState.turn, null, 'Turn is cleared');
  assert(finishResult.gameState.finishedAt !== null, 'FinishedAt timestamp set');

  const alreadyFinishedResult = finishGame(finishResult.gameState);
  assert(!alreadyFinishedResult.success, 'Cannot finish already finished game');

  // === Selection Handling Tests ===
  console.log('\n--- Selection Handling Tests ---');

  const selectionDice = [
    { value: 1, selectable: true },
    { value: 5, selectable: true },
    { value: 2, selectable: true },
    { value: 3, selectable: true },
    { value: 4, selectable: false },
    { value: 5, selectable: true }
  ];

  const evalValid = evaluateSelection(selectionDice, [0, 1]);
  assert(evalValid.isValid, 'Evaluate selection detects valid scoring combo');
  assertEquals(evalValid.selectionScore, 150, 'Valid selection has correct score');

  const evalInvalid = evaluateSelection(selectionDice, [2]);
  assert(!evalInvalid.isValid, 'Evaluate selection detects invalid combo');
  assertEquals(evalInvalid.selectionScore, 0, 'Invalid selection scores zero');

  const evalEmpty = evaluateSelection(selectionDice, []);
  assert(!evalEmpty.isValid, 'Empty selection is invalid');

  const selectionGameStateBase = {
    ...startResult.gameState,
    turn: {
      playerId: 'p1',
      dice: selectionDice,
      accumulatedTurnScore: 0,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      },
      status: 'awaiting_selection'
    }
  };

  const toggleResultValid = toggleDieSelection(selectionGameStateBase, 0);
  assert(toggleResultValid.success, 'Toggle succeeds on selectable die');
  assertEquals(toggleResultValid.gameState.turn.selection.selectedIndices.length, 1, 'Selection includes toggled index');
  assert(toggleResultValid.gameState.turn.selection.isValid, 'Selection is valid after selecting scoring die');
  assertEquals(toggleResultValid.gameState.turn.selection.selectionScore, 100, 'Single 1 scores 100');
  assertEquals(toggleResultValid.gameState.turn.status, 'awaiting_roll', 'Status set to awaiting_roll when selection valid');

  const toggleResultDeselected = toggleDieSelection(toggleResultValid.gameState, 0);
  assert(toggleResultDeselected.success, 'Toggle succeeds when deselecting die');
  assertEquals(toggleResultDeselected.gameState.turn.selection.selectedIndices.length, 0, 'Selection cleared after deselect');
  assert(!toggleResultDeselected.gameState.turn.selection.isValid, 'Selection invalid when empty');
  assertEquals(toggleResultDeselected.gameState.turn.status, 'awaiting_selection', 'Status returns to awaiting_selection when invalid');

  const invalidComboState = {
    ...selectionGameStateBase,
    turn: {
      ...selectionGameStateBase.turn,
      selection: {
        selectedIndices: [],
        isValid: false,
        selectionScore: 0
      }
    }
  };
  const toggleInvalidCombo = toggleDieSelection(invalidComboState, 2);
  assert(toggleInvalidCombo.success, 'Toggle succeeds on selectable die even if invalid combo');
  assert(!toggleInvalidCombo.gameState.turn.selection.isValid, 'Selection remains invalid for non-scoring die');
  assertEquals(toggleInvalidCombo.gameState.turn.selection.selectionScore, 0, 'Invalid combo has zero score');

  const nonSelectableState = {
    ...selectionGameStateBase
  };
  const nonSelectableResult = toggleDieSelection(nonSelectableState, 4);
  assert(!nonSelectableResult.success, 'Toggle fails on non-selectable die');

  const outOfBoundsResult = toggleDieSelection(selectionGameStateBase, 10);
  assert(!outOfBoundsResult.success, 'Toggle fails on out-of-bounds index');

  // === Randomness Test ===
  console.log('\n--- Randomness Tests ---');
  
  const manyRolls = [];
  for (let i = 0; i < 100; i++) {
    manyRolls.push(rollOneDie());
  }
  
  const uniqueValues = new Set(manyRolls);
  assert(uniqueValues.size > 1, 'Dice rolls produce varied results');
  assert(manyRolls.every(v => v >= 1 && v <= 6), 'All 100 rolls are valid');

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

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runTests };
