import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decrementPassBudget,
  shouldContinueAfterPass,
  type AutonomyMode,
  type AutonomyState,
  type PassOutcomeSignal,
} from '../autonomy.js';

// F-18 scenario 2 — rapid mode switches mid-pass.
// The chat panel re-evaluates `shouldContinueAfterPass(state, signal)` each
// pass, and a user can flip `dreamgraph.architect.autonomyMode` between any
// two passes. These tests pin that:
//   - `state.mode` is the only field that changes during a switch; the
//     pass counters survive the transition;
//   - the per-mode gate inside shouldContinueAfterPass is evaluated against
//     the CURRENT mode each call (no stale-mode latching);
//   - decrementPassBudget keeps counting accurately across a switch sequence.

const ambiguousSignal: PassOutcomeSignal = {
  // Clear next step inside scope, but uncertainty is medium and the step is
  // neither near-trivial nor defining — different modes give different verdicts.
  hasClearNextStep: true,
  uncertainty: 'medium',
  hasBlockingFailure: false,
  nextStepWithinScope: true,
  goalSufficientlyReached: false,
  progressStatus: 'advancing',
  nextStepIsNearTrivial: false,
  nextStepIsDefining: false,
};

function withMode(state: AutonomyState, mode: AutonomyMode): AutonomyState {
  // Mirrors the chat-panel pattern: change mode, keep counters as-is.
  return { ...state, mode };
}

test('mode switch preserves completed and remaining pass counters', () => {
  const initial: AutonomyState = {
    mode: 'cautious',
    completedAutoPasses: 2,
    remainingAutoPasses: 3,
    totalAuthorizedPasses: 5,
  };
  const switched = withMode(initial, 'autonomous');
  assert.equal(switched.completedAutoPasses, 2);
  assert.equal(switched.remainingAutoPasses, 3);
  assert.equal(switched.totalAuthorizedPasses, 5);
  assert.equal(switched.mode, 'autonomous');
});

test('shouldContinueAfterPass re-evaluates against the new mode immediately', () => {
  let state: AutonomyState = {
    mode: 'cautious',
    completedAutoPasses: 1,
    remainingAutoPasses: 5,
    totalAuthorizedPasses: 5,
  };

  // Cautious + ambiguous signal → pause for user.
  const cautiousDecision = shouldContinueAfterPass(state, ambiguousSignal);
  assert.equal(cautiousDecision.shouldContinue, false);
  assert.equal(cautiousDecision.selectionMode, 'user');

  // Switch to autonomous mid-run; the very next call must continue automatically
  // (no latency from a stale mode).
  state = withMode(state, 'autonomous');
  const autonomousDecision = shouldContinueAfterPass(state, ambiguousSignal);
  assert.equal(autonomousDecision.shouldContinue, true);
  assert.equal(autonomousDecision.selectionMode, 'self');

  // Switch back to cautious; the answer flips back deterministically.
  state = withMode(state, 'cautious');
  const cautiousAgain = shouldContinueAfterPass(state, ambiguousSignal);
  assert.equal(cautiousAgain.shouldContinue, false);
  assert.equal(cautiousAgain.selectionMode, 'user');
});

test('decrementPassBudget counts correctly across a cautious→eager→autonomous→cautious sequence', () => {
  let state: AutonomyState = {
    mode: 'cautious',
    completedAutoPasses: 0,
    remainingAutoPasses: 4,
    totalAuthorizedPasses: 4,
  };

  state = decrementPassBudget(state);                    // pass 1, cautious
  state = withMode(state, 'eager');
  state = decrementPassBudget(state);                    // pass 2, eager
  state = withMode(state, 'autonomous');
  state = decrementPassBudget(state);                    // pass 3, autonomous
  state = withMode(state, 'cautious');
  state = decrementPassBudget(state);                    // pass 4, cautious

  assert.equal(state.completedAutoPasses, 4);
  assert.equal(state.remainingAutoPasses, 0);
  assert.equal(state.totalAuthorizedPasses, 4);
  assert.equal(state.mode, 'cautious');
});

test('switching modes after exhaustion does not revive the budget', () => {
  const exhausted: AutonomyState = {
    mode: 'cautious',
    completedAutoPasses: 4,
    remainingAutoPasses: 0,
    totalAuthorizedPasses: 4,
  };
  const flipped = withMode(exhausted, 'autonomous');
  const decision = shouldContinueAfterPass(flipped, {
    ...ambiguousSignal,
    uncertainty: 'low',
    nextStepIsNearTrivial: true,
  });
  assert.equal(decision.shouldContinue, false);
  assert.match(decision.reason, /pass budget exhausted/i);
});
