/**
 * Unit Tests for Farkle Dice Scoring Engine
 * 
 * Tests all scoring rules defined in docs/dice-scoring-rules.md
 */

const { scoreDice, isBust, isHotDice, getBestScore } = require('./scoring');

// Test helpers
function testScore(description, dice, expectedScore, expectedValid = true) {
  const result = scoreDice(dice);
  const passed = result.score === expectedScore && result.isValid === expectedValid;
  
  if (!passed) {
    console.error(`❌ FAILED: ${description}`);
    console.error(`   Input: [${dice.join(', ')}]`);
    console.error(`   Expected: score=${expectedScore}, isValid=${expectedValid}`);
    console.error(`   Got: score=${result.score}, isValid=${result.isValid}`);
    return false;
  }
  
  console.log(`✓ ${description}`);
  return true;
}

function testBust(description, dice, expectedBust) {
  const result = isBust(dice);
  const passed = result === expectedBust;
  
  if (!passed) {
    console.error(`❌ FAILED: ${description}`);
    console.error(`   Input: [${dice.join(', ')}]`);
    console.error(`   Expected bust: ${expectedBust}`);
    console.error(`   Got: ${result}`);
    return false;
  }
  
  console.log(`✓ ${description}`);
  return true;
}

function runTests() {
  console.log('\n=== Farkle Scoring Tests ===\n');
  
  let totalTests = 0;
  let passedTests = 0;

  // Test runner helper
  function test(description, dice, expectedScore, expectedValid = true) {
    totalTests++;
    if (testScore(description, dice, expectedScore, expectedValid)) {
      passedTests++;
    }
  }

  function testIsBust(description, dice, expectedBust) {
    totalTests++;
    if (testBust(description, dice, expectedBust)) {
      passedTests++;
    }
  }

  // === Section 2: Single Dice ===
  console.log('\n--- Single Dice Tests ---');
  test('Single 1 scores 100', [1], 100);
  test('Single 5 scores 50', [5], 50);
  test('Two 1s score 200', [1, 1], 200);
  test('Two 5s score 100', [5, 5], 100);
  test('One 1 and one 5 score 150', [1, 5], 150);
  test('Single 2 is invalid', [2], 0, false);
  test('Single 3 is invalid', [3], 0, false);
  test('Single 4 is invalid', [4], 0, false);
  test('Single 6 is invalid', [6], 0, false);

  // === Section 3: Three-of-a-Kind ===
  console.log('\n--- Three-of-a-Kind Tests ---');
  test('Three 1s score 1000', [1, 1, 1], 1000);
  test('Three 2s score 200', [2, 2, 2], 200);
  test('Three 3s score 300', [3, 3, 3], 300);
  test('Three 4s score 400', [4, 4, 4], 400);
  test('Three 5s score 500', [5, 5, 5], 500);
  test('Three 6s score 600', [6, 6, 6], 600);

  // === Section 4: Four, Five, and Six of a Kind ===
  console.log('\n--- N-of-a-Kind Tests ---');
  // Under the updated rules: 4/5/6 of a kind are fixed values regardless of face
  test('Four 1s score 1000', [1, 1, 1, 1], 1000);
  test('Four 2s score 1000', [2, 2, 2, 2], 1000);
  test('Four 3s score 1000', [3, 3, 3, 3], 1000);
  test('Four 4s score 1000', [4, 4, 4, 4], 1000);
  test('Four 5s score 1000', [5, 5, 5, 5], 1000);
  test('Four 6s score 1000', [6, 6, 6, 6], 1000);

  test('Five 1s score 2000', [1, 1, 1, 1, 1], 2000);
  test('Five 2s score 2000', [2, 2, 2, 2, 2], 2000);
  test('Five 3s score 2000', [3, 3, 3, 3, 3], 2000);
  test('Five 5s score 2000', [5, 5, 5, 5, 5], 2000);

  test('Six 1s score 3000', [1, 1, 1, 1, 1, 1], 3000);
  test('Six 2s score 3000', [2, 2, 2, 2, 2, 2], 3000);
  test('Six 3s score 3000', [3, 3, 3, 3, 3, 3], 3000);
  test('Six 6s score 3000', [6, 6, 6, 6, 6, 6], 3000);

  // === Section 5: Straight ===
  console.log('\n--- Straight Tests ---');
  test('Straight 1-6 scores 1500', [1, 2, 3, 4, 5, 6], 1500);
  test('Straight in different order', [6, 1, 3, 2, 5, 4], 1500);

  // === Section 6: Three Pairs ===
  console.log('\n--- Three Pairs Tests ---');
  test('Three pairs (1-1, 3-3, 5-5) score 1500', [1, 1, 3, 3, 5, 5], 1500);
  test('Three pairs (2-2, 4-4, 6-6) score 1500', [2, 2, 4, 4, 6, 6], 1500);
  test('Three pairs mixed order', [3, 5, 3, 5, 1, 1], 1500);
  // Four-of-a-kind plus a pair should be treated as three pairs and score 1500
  test('Four of a kind + pair treated as three pairs', [4, 4, 4, 4, 2, 2], 1500);

  // === Section 7: Two Triplets ===
  console.log('\n--- Two Triplets Tests ---');
  test('Two triplets (2-2-2, 5-5-5) score 2500', [2, 2, 2, 5, 5, 5], 2500);
  test('Two triplets (1-1-1, 4-4-4) score 2500', [1, 1, 1, 4, 4, 4], 2500);
  test('Two triplets mixed order', [3, 6, 3, 6, 3, 6], 2500);

  // === Section 9: Mixed Scoring ===
  console.log('\n--- Mixed Scoring Tests ---');
  test('Three 1s + two 5s = 1100', [1, 1, 1, 5, 5], 1100);
  test('Three 1s + one 5 + one 2 is invalid', [1, 1, 1, 5, 2], 0, false);
  test('Three 2s + one 1 + one 5 = 350', [2, 2, 2, 1, 5], 350);
  test('Three 3s + two 1s = 500', [3, 3, 3, 1, 1], 500);
  test('Four 4s + one 1 + one 5 = 1150', [4, 4, 4, 4, 1, 5], 1150);

  // === Section 10: Invalid Selections ===
  console.log('\n--- Invalid Selection Tests ---');
  test('1, 5, 2 is invalid (2 does not score)', [1, 5, 2], 0, false);
  test('3, 4, 6 is invalid (none score)', [3, 4, 6], 0, false);
  test('Two 2s is invalid (need three)', [2, 2], 0, false);
  test('5, 6 is invalid (6 does not score)', [5, 6], 0, false);

  // === Edge Cases ===
  console.log('\n--- Edge Case Tests ---');
  test('Empty array scores 0', [], 0);
  test('Six 5s score 3000', [5, 5, 5, 5, 5, 5], 3000);
  test('Three 1s + three 2s (two triplets) = 2500', [1, 1, 1, 2, 2, 2], 2500);

  // === Bust Detection Tests ===
  console.log('\n--- Bust Detection Tests ---');
  testIsBust('Roll with 1 is not a bust', [2, 3, 1, 4, 6, 2], false);
  testIsBust('Roll with 5 is not a bust', [2, 3, 5, 4, 6, 2], false);
  testIsBust('Roll with three of a kind is not a bust', [2, 2, 2, 3, 4, 6], false);
  testIsBust('Roll with no scoring combinations is a bust', [2, 3, 4, 6, 2, 3], true);
  testIsBust('Roll [2, 2, 4, 4, 6, 6] is not a bust (three pairs)', [2, 2, 4, 4, 6, 6], false);
  testIsBust('Roll [2, 2, 4, 4] is a bust (only two pairs)', [2, 2, 4, 4], true);
  testIsBust('Straight is not a bust', [1, 2, 3, 4, 5, 6], false);
  testIsBust('Three pairs is not a bust', [2, 2, 4, 4, 3, 3], false);

  // === Hot Dice Tests ===
  console.log('\n--- Hot Dice Tests ---');
  totalTests++;
  if (isHotDice([1, 2, 3, 4, 5, 6], 0)) {
    console.log('✓ Hot dice when all 6 dice used');
    passedTests++;
  } else {
    console.error('❌ FAILED: Hot dice when all 6 dice used');
  }

  totalTests++;
  if (!isHotDice([1, 5], 4)) {
    console.log('✓ Not hot dice when dice remain');
    passedTests++;
  } else {
    console.error('❌ FAILED: Not hot dice when dice remain');
  }

  totalTests++;
  if (!isHotDice([], 6)) {
    console.log('✓ Not hot dice when no dice selected');
    passedTests++;
  } else {
    console.error('❌ FAILED: Not hot dice when no dice selected');
  }

  // === Get Best Score Tests ===
  console.log('\n--- Get Best Score Tests ---');
  totalTests++;
  let bestResult = getBestScore([1, 2, 3, 4, 5, 6]);
  if (bestResult.score === 1500 && bestResult.selection.length === 6) {
    console.log('✓ Best score for straight');
    passedTests++;
  } else {
    console.error('❌ FAILED: Best score for straight');
    console.error(`   Expected: 1500, Got: ${bestResult.score}`);
  }

  totalTests++;
  bestResult = getBestScore([1, 1, 1, 5, 5, 2]);
  if (bestResult.score === 1100) {
    console.log('✓ Best score selects all scoring dice');
    passedTests++;
  } else {
    console.error('❌ FAILED: Best score selects all scoring dice');
    console.error(`   Expected: 1100, Got: ${bestResult.score}`);
  }

  // === Summary ===
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passedTests}/${totalTests}`);
  
  if (passedTests === totalTests) {
    console.log('✅ All tests passed!\n');
    return true;
  } else {
    console.log(`❌ ${totalTests - passedTests} test(s) failed\n`);
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runTests };
