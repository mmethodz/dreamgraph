import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutonomyState,
  decrementPassBudget,
  shouldContinueAfterPass,
  type AutonomyMode,
  type PassOutcomeSignal,
} from '../autonomy.js';

// F-18 scenario 1 — autonomy budget exhaustion.
// Pins the contract that:
//   - shouldContinueAfterPass stops cleanly when remainingAutoPasses hits 0
//     while a totalAuthorizedPasses budget is in effect, regardless of mode;
//   - decrementPassBudget bottoms out at 0 and never goes negative;
//   - decrementPassBudget is a no-op on remainingAutoPasses when no budget
//     was ever authorized (pass counting inactive).

const eligibleSignal: PassOutcomeSignal = {
  hasClearNextStep: true,
  uncertainty: 'low',
  hasBlockingFailure: false,
  nextStepWithinScope: true,
  goalSufficientlyReached: false,
  progressStatus: 'advancing',
  nextStepIsNearTrivial: true,
  nextStepIsDefining: true,
};

test('shouldContinueAfterPass stops with "pass budget exhausted" when remaining hits 0', () => {
  const exhausted = {
    mode: 'autonomous' as AutonomyMode,
    completedAutoPasses: 4,
    remainingAutoPasses: 0,
    totalAuthorizedPasses: 4,
  };
  const decision = shouldContinueAfterPass(exhausted, eligibleSignal);
  assert.equal(decision.shouldContinue, false);
  assert.match(decision.reason, /pass budget exhausted/i);
  assert.equal(decision.selectionMode, 'none');
});

test('budget exhaustion stops every mode, even with otherwise-eligible signal', () => {
  for (const mode of ['cautious', 'conscientious', 'eager', 'autonomous'] as const) {
    const state = {
      mode,
      completedAutoPasses: 3,
      remainingAutoPasses: 0,
      totalAuthorizedPasses: 3,
    };
    const decision = shouldContinueAfterPass(state, eligibleSignal);
    assert.equal(decision.shouldContinue, false, `mode=${mode} should stop on exhausted budget`);
    assert.match(decision.reason, /pass budget exhausted/i, `mode=${mode} should report budget exhaustion`);
  }
});

test('decrementPassBudget bottoms out at 0 — never goes negative', () => {
  let state = createAutonomyState('autonomous', 2);
  state = decrementPassBudget(state);
  state = decrementPassBudget(state);
  assert.equal(state.remainingAutoPasses, 0);
  assert.equal(state.completedAutoPasses, 2);

  // One more decrement past the floor.
  state = decrementPassBudget(state);
  assert.equal(state.remainingAutoPasses, 0, 'remaining must clamp at 0');
  assert.equal(state.completedAutoPasses, 3, 'completed continues to count');
});

test('decrementPassBudget leaves remaining untouched when pass counting is inactive', () => {
  // No totalAuthorizedPasses → pass counting inactive → remaining stays at 0.
  const state = createAutonomyState('eager');
  const next = decrementPassBudget(state);
  assert.equal(next.totalAuthorizedPasses, undefined);
  assert.equal(next.remainingAutoPasses, 0);
  assert.equal(next.completedAutoPasses, 1, 'completed still increments for telemetry');
});

test('exhausted-budget stop fires before the cautious/eager mode-specific gates', () => {
  // A cautious-mode state with a high-uncertainty signal would normally pause for
  // user confirmation. With remaining=0 it must instead report budget exhaustion
  // — the budget gate is checked BEFORE the per-mode gates.
  const state = {
    mode: 'cautious' as AutonomyMode,
    completedAutoPasses: 1,
    remainingAutoPasses: 0,
    totalAuthorizedPasses: 1,
  };
  const decision = shouldContinueAfterPass(state, {
    ...eligibleSignal,
    uncertainty: 'medium',
    nextStepIsNearTrivial: false,
  });
  assert.equal(decision.shouldContinue, false);
  assert.match(decision.reason, /pass budget exhausted/i);
});
