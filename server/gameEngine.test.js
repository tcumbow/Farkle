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
  toggleDieSelection,
  computeSelectionState,
  clearDiceSelection,
  setDiceSelection,
  startGame,
  advanceToNextTurn,
  initializeTurnState,
  addPlayer,
  finishGame
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

  // === Randomness Test ===
  console.log('\n--- Randomness Tests ---');
  
  const manyRolls = [];
  for (let i = 0; i < 100; i++) {
    manyRolls.push(rollOneDie());
  }
  
  const uniqueValues = new Set(manyRolls);
  assert(uniqueValues.size > 1, 'Dice rolls produce varied results');
  assert(manyRolls.every(v => v >= 1 && v <= 6), 'All 100 rolls are valid');

  // === Dice Selection Tests ===
  console.log('\n--- Dice Selection Tests ---');

  // Create a game with known dice values
  const selectionGame = createNewGame();
  const player = createPlayerState('p1', 'Alice');
  let selResult = addPlayer(selectionGame, player);
  selResult = startGame(selResult.gameState);
  let gameWithTurn = selResult.gameState;

  // Manually set dice to known values for testing
  gameWithTurn = {
    ...gameWithTurn,
    turn: {
      ...gameWithTurn.turn,
      dice: [
        { value: 1, selectable: true },
        { value: 5, selectable: true },
        { value: 2, selectable: true },
        { value: 2, selectable: true },
        { value: 2, selectable: true },
        { value: 6, selectable: true }
      ]
    }
  };

  // Test toggling selection
  const toggle1 = toggleDieSelection(gameWithTurn, 0); // Select die with value 1
  assert(toggle1.success, 'Can toggle die selection');
  assertEquals(toggle1.gameState.turn.selection.selectedIndices.length, 1, 'One die selected');
  assert(toggle1.gameState.turn.selection.selectedIndices.includes(0), 'Correct die selected');
  assertEquals(toggle1.gameState.turn.selection.selectionScore, 100, 'Single 1 scores 100');
  assert(toggle1.gameState.turn.selection.isValid, 'Selection is valid');

  // Toggle another die
  const toggle2 = toggleDieSelection(toggle1.gameState, 1); // Select die with value 5
  assert(toggle2.success, 'Can select second die');
  assertEquals(toggle2.gameState.turn.selection.selectedIndices.length, 2, 'Two dice selected');
  assertEquals(toggle2.gameState.turn.selection.selectionScore, 150, '1+5 scores 150');
  assert(toggle2.gameState.turn.selection.isValid, 'Selection is valid');

  // Toggle off first die
  const toggle3 = toggleDieSelection(toggle2.gameState, 0); // Deselect die with value 1
  assert(toggle3.success, 'Can deselect die');
  assertEquals(toggle3.gameState.turn.selection.selectedIndices.length, 1, 'One die remains selected');
  assertEquals(toggle3.gameState.turn.selection.selectionScore, 50, 'Single 5 scores 50');

  // Select invalid combination
  const toggle4 = toggleDieSelection(gameWithTurn, 2); // Select die with value 2 (invalid alone)
  assert(toggle4.success, 'Toggle succeeds even for invalid selection');
  assert(!toggle4.gameState.turn.selection.isValid, 'Selection is invalid (single 2)');
  assertEquals(toggle4.gameState.turn.selection.selectionScore, 0, 'Invalid selection scores 0');

  // Select three 2s (valid)
  let threeTwo = toggleDieSelection(gameWithTurn, 2);
  threeTwo = toggleDieSelection(threeTwo.gameState, 3);
  threeTwo = toggleDieSelection(threeTwo.gameState, 4);
  assert(threeTwo.gameState.turn.selection.isValid, 'Three 2s is valid');
  assertEquals(threeTwo.gameState.turn.selection.selectionScore, 200, 'Three 2s score 200');

  // Test toggling non-selectable die
  const gameWithLocked = {
    ...gameWithTurn,
    turn: {
      ...gameWithTurn.turn,
      dice: [
        { value: 1, selectable: false }, // Locked
        { value: 5, selectable: true }
      ]
    }
  };
  const toggleLocked = toggleDieSelection(gameWithLocked, 0);
  assert(!toggleLocked.success, 'Cannot select locked die');
  assert(toggleLocked.error.includes('not selectable'), 'Error mentions die not selectable');

  // Test invalid index
  const toggleInvalid = toggleDieSelection(gameWithTurn, 99);
  assert(!toggleInvalid.success, 'Cannot select invalid index');

  // === computeSelectionState Tests ===
  console.log('\n--- computeSelectionState Tests ---');

  const testDice = [
    { value: 1, selectable: true },
    { value: 1, selectable: true },
    { value: 1, selectable: true },
    { value: 5, selectable: true },
    { value: 5, selectable: true },
    { value: 2, selectable: true }
  ];

  const emptySelection = computeSelectionState(testDice, []);
  assertEquals(emptySelection.selectedIndices.length, 0, 'Empty selection has no indices');
  assert(emptySelection.isValid, 'Empty selection is valid');
  assertEquals(emptySelection.selectionScore, 0, 'Empty selection scores 0');

  const threeOnes = computeSelectionState(testDice, [0, 1, 2]);
  assert(threeOnes.isValid, 'Three 1s is valid');
  assertEquals(threeOnes.selectionScore, 1000, 'Three 1s score 1000');

  const mixed = computeSelectionState(testDice, [0, 1, 2, 3, 4]);
  assert(mixed.isValid, 'Three 1s + two 5s is valid');
  assertEquals(mixed.selectionScore, 1100, 'Three 1s + two 5s = 1100');

  const invalidSelection = computeSelectionState(testDice, [5]);
  assert(!invalidSelection.isValid, 'Single 2 is invalid');
  assertEquals(invalidSelection.selectionScore, 0, 'Invalid selection scores 0');

  // === clearDiceSelection Tests ===
  console.log('\n--- clearDiceSelection Tests ---');

  const clearResult = clearDiceSelection(toggle2.gameState);
  assert(clearResult.success, 'Can clear selection');
  assertEquals(clearResult.gameState.turn.selection.selectedIndices.length, 0, 'Selection cleared');
  assertEquals(clearResult.gameState.turn.selection.selectionScore, 0, 'Score reset to 0');
  assert(clearResult.gameState.turn.selection.isValid, 'Cleared selection is valid');

  // === setDiceSelection Tests ===
  console.log('\n--- setDiceSelection Tests ---');

  const setResult = setDiceSelection(gameWithTurn, [0, 1, 2, 3, 4]);
  assert(setResult.success, 'Can set selection programmatically');
  assertEquals(setResult.gameState.turn.selection.selectedIndices.length, 5, 'Five dice selected');
  
  const setInvalid = setDiceSelection(gameWithTurn, [99]);
  assert(!setInvalid.success, 'Cannot set invalid index');

  const setLocked = setDiceSelection(gameWithLocked, [0]);
  assert(!setLocked.success, 'Cannot set selection on locked die');

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
