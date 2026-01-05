/**
 * Farkle Dice Scoring Engine
 * 
 * Implements classic Farkle scoring rules as defined in docs/dice-scoring-rules.md
 * All scoring logic is authoritative and must be performed server-side only.
 */

/**
 * Score a selection of dice according to classic Farkle rules.
 * 
 * @param {number[]} dice - Array of selected dice values (1-6)
 * @returns {{score: number, isValid: boolean, usedDice: number[]}} 
 *   - score: Total points earned
 *   - isValid: Whether the selection contains only scoring dice
 *   - usedDice: Array tracking which dice were used in scoring
 */
function scoreDice(dice) {
  if (!dice || dice.length === 0) {
    return { score: 0, isValid: true, usedDice: [] };
  }

  // Validate input
  if (!Array.isArray(dice) || dice.some(d => d < 1 || d > 6)) {
    return { score: 0, isValid: false, usedDice: [] };
  }

  // Count occurrences of each die value
  const counts = [0, 0, 0, 0, 0, 0, 0]; // index 0 unused, 1-6 for die values
  dice.forEach(die => counts[die]++);

  let totalScore = 0;
  const usedDice = [];

  // Check for straight (1-6)
  if (dice.length === 6 && counts.every((count, idx) => idx === 0 || count === 1)) {
    return { score: 1500, isValid: true, usedDice: dice.slice() };
  }

  // Check for three pairs
  const pairs = counts.filter((count, idx) => idx > 0 && count === 2).length;
  if (dice.length === 6 && pairs === 3) {
    return { score: 1500, isValid: true, usedDice: dice.slice() };
  }

  // Check for two triplets
  const triplets = counts.filter((count, idx) => idx > 0 && count === 3).length;
  if (dice.length === 6 && triplets === 2) {
    return { score: 2500, isValid: true, usedDice: dice.slice() };
  }

  // Score n-of-a-kind (3, 4, 5, 6)
  for (let value = 1; value <= 6; value++) {
    const count = counts[value];
    
    if (count >= 3) {
      // Base score for three of a kind
      const baseScore = value === 1 ? 1000 : value * 100;
      
      if (count === 3) {
        totalScore += baseScore;
        for (let i = 0; i < 3; i++) usedDice.push(value);
      } else if (count === 4) {
        totalScore += baseScore * 2;
        for (let i = 0; i < 4; i++) usedDice.push(value);
      } else if (count === 5) {
        totalScore += baseScore * 3;
        for (let i = 0; i < 5; i++) usedDice.push(value);
      } else if (count === 6) {
        totalScore += baseScore * 4;
        for (let i = 0; i < 6; i++) usedDice.push(value);
      }
      
      counts[value] = 0; // Mark as consumed
    }
  }

  // Score remaining single 1s (not part of n-of-a-kind)
  if (counts[1] > 0) {
    totalScore += counts[1] * 100;
    for (let i = 0; i < counts[1]; i++) usedDice.push(1);
    counts[1] = 0;
  }

  // Score remaining single 5s (not part of n-of-a-kind)
  if (counts[5] > 0) {
    totalScore += counts[5] * 50;
    for (let i = 0; i < counts[5]; i++) usedDice.push(5);
    counts[5] = 0;
  }

  // Check if all selected dice were used in scoring
  const allDiceUsed = usedDice.length === dice.length;
  const isValid = allDiceUsed && counts.every((count, idx) => idx === 0 || count === 0);

  return {
    score: isValid ? totalScore : 0,
    isValid,
    usedDice: isValid ? usedDice : []
  };
}

/**
 * Check if a roll resulted in a bust (no scoring combinations available).
 * 
 * @param {number[]} dice - Array of rolled dice values (1-6)
 * @returns {boolean} True if the roll is a bust (Farkle)
 */
function isBust(dice) {
  if (!dice || dice.length === 0) {
    return true;
  }

  // A roll is not a bust if it contains any 1s or 5s
  if (dice.includes(1) || dice.includes(5)) {
    return false;
  }

  // Check for three-of-a-kind or better
  const counts = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach(die => counts[die]++);
  
  if (counts.some((count, idx) => idx > 0 && count >= 3)) {
    return false;
  }

  // Check for straight (only valid with 6 dice, all different)
  if (dice.length === 6 && counts.every((count, idx) => idx === 0 || count === 1)) {
    return false;
  }

  // Check for three pairs (only valid with exactly 6 dice and exactly 3 pairs)
  const pairs = counts.filter((count, idx) => idx > 0 && count === 2).length;
  if (dice.length === 6 && pairs === 3 && counts.filter((count, idx) => idx > 0 && count > 0).length === 3) {
    return false;
  }

  return true;
}

/**
 * Check if all dice in the current roll have been used for scoring (hot dice).
 * 
 * @param {number[]} selectedDice - Dice selected for scoring this turn
 * @param {number} remainingDiceCount - Number of dice left in the pool
 * @returns {boolean} True if hot dice condition is met
 */
function isHotDice(selectedDice, remainingDiceCount) {
  // Hot dice occurs when all dice from the current roll are selected and scored
  return remainingDiceCount === 0 && selectedDice.length > 0;
}

/**
 * Get the best possible score from a roll (helper for AI or hints).
 * 
 * @param {number[]} dice - Array of dice values
 * @returns {{score: number, selection: number[]}} Best score and the dice to select
 */
function getBestScore(dice) {
  if (!dice || dice.length === 0) {
    return { score: 0, selection: [] };
  }

  // For now, just try selecting all dice
  // A more sophisticated implementation could try all valid subsets
  const allDiceResult = scoreDice(dice);
  
  if (allDiceResult.isValid) {
    return { score: allDiceResult.score, selection: dice.slice() };
  }

  // If all dice don't work, try to find scoring dice
  // Simple greedy approach: select all 1s and 5s
  const scoringDice = [];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  
  dice.forEach(die => counts[die]++);

  // Check for special combinations first
  if (dice.length === 6) {
    const straight = counts.every((count, idx) => idx === 0 || count === 1);
    if (straight) {
      return { score: 1500, selection: dice.slice() };
    }

    const pairs = counts.filter((count, idx) => idx > 0 && count === 2).length;
    if (pairs === 3) {
      return { score: 1500, selection: dice.slice() };
    }

    const triplets = counts.filter((count, idx) => idx > 0 && count === 3).length;
    if (triplets === 2) {
      return { score: 2500, selection: dice.slice() };
    }
  }

  // Add n-of-a-kind
  for (let value = 1; value <= 6; value++) {
    if (counts[value] >= 3) {
      for (let i = 0; i < counts[value]; i++) {
        scoringDice.push(value);
      }
      counts[value] = 0;
    }
  }

  // Add remaining 1s and 5s
  for (let i = 0; i < counts[1]; i++) scoringDice.push(1);
  for (let i = 0; i < counts[5]; i++) scoringDice.push(5);

  const result = scoreDice(scoringDice);
  return { score: result.score, selection: scoringDice };
}

module.exports = {
  scoreDice,
  isBust,
  isHotDice,
  getBestScore
};
