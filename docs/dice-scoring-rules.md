# Farkle Dice Scoring Rules (Authoritative)

This document defines the **authoritative dice scoring logic** for the game engine. All scoring decisions must follow these rules exactly. Clients must never compute scores independently.

Rules are based on **standard/classic Farkle**.

---

## 1. General Principles

- Scoring is evaluated **only on selected dice**
- Dice may only be scored once per roll
- Multiple scoring combinations may apply in a single selection
- Non-scoring dice invalidate a selection

---

## 2. Single Dice

| Die Value | Score | Notes |
|----------|-------|------|
| 1 | 100 | May combine with other scoring dice |
| 5 | 50 | May combine with other scoring dice |
| 2,3,4,6 | 0 | Never score alone |

---

## 3. Three-of-a-Kind

| Dice | Score |
|------|-------|
| Three 1s | 1000 |
| Three 2s | 200 |
| Three 3s | 300 |
| Three 4s | 400 |
| Three 5s | 500 |
| Three 6s | 600 |

---

## 4. Four, Five, and Six of a Kind

| Dice | Score | Rule |
|------|-------|------|
| Four of a kind | Base × 2 | Based on three-of-a-kind value |
| Five of a kind | Base × 3 | |
| Six of a kind | Base × 4 | |

Example:
- Four 3s = 600
- Five 5s = 1500
- Six 2s = 800

---

## 5. Straight

| Dice | Score | Notes |
|------|-------|------|
| 1–6 straight | 1500 | Must include all six values |

Straight consumes all dice.

---

## 6. Three Pairs

| Dice | Score |
|------|-------|
| Three distinct pairs | 1500 |

Example:
- 1-1, 3-3, 5-5

---

## 7. Two Triplets

| Dice | Score |
|------|-------|
| Two different three-of-a-kind | 2500 |

Example:
- 2-2-2 and 5-5-5

---

## 8. Full House

> **Not scored** in classic Farkle.

Example:
- 3-3-3 and 2-2 = scored as three-of-a-kind only

---

## 9. Mixed Scoring Example

Example dice:
```
1, 1, 1, 5, 5, 2
```

Scoring:
- Three 1s = 1000
- Two 5s = 100
- Total = 1100

---

## 10. Invalid Selections

A dice selection is **invalid** if:

- It contains any die that does not participate in a scoring combination
- Example:
  - Selecting `1, 5, 2` is invalid because `2` scores 0

Invalid selections:
- Display score = 0
- `isValid = false`
- Roll and Bank actions disabled

---

## 11. Hot Dice Condition

Hot dice occurs when:

- All dice in the current roll are used in scoring combinations

Effect:
- Dice pool resets to 6
- Accumulated turn score preserved
- Player may roll again or bank

---

## 12. Minimum Entry Score

- Default minimum entry score: **500**
- Player may not bank until accumulated turn score ≥ minimum
- Once entered, player may bank any positive score

---

## 13. Bust (Farkle)

A bust occurs when:

- A roll produces **no scoring dice combinations**

Effect:
- Accumulated turn score is lost
- Turn ends immediately
- Next player begins

---

## 14. Scoring Precedence

When multiple scoring interpretations are possible:

1. Prefer highest total score
2. Prefer combinations that consume more dice
3. Straight and special combinations override singles

---

## 15. Implementation Notes

Recommended scoring algorithm:

1. Count dice values
2. Detect special cases first:
   - Straight
   - Three pairs
   - Two triplets
3. Apply kind-based scoring
4. Apply remaining single 1s and 5s
5. Validate all selected dice were consumed

---

## 16. Authoritative Reference

This document is the authoritative source for:
- Server-side scoring logic
- Selection validation
- Hot dice detection

Any rule changes must be reflected here first.

