import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseActionForMode,
  computeDoAllEligibility,
  createAutonomyState,
  decrementPassBudget,
  deriveAutonomyStatusView,
  getAutonomyInstructionBlock,
  rankRecommendedActions,
  shouldContinueAfterPass,
  type PassOutcomeSignal,
  type RecommendedAction,
} from '../autonomy.js';

const lowSignal: PassOutcomeSignal = {
  hasClearNextStep: true,
  uncertainty: 'low',
  hasBlockingFailure: false,
  nextStepWithinScope: true,
  goalSufficientlyReached: false,
  progressStatus: 'advancing',
  nextStepIsNearTrivial: true,
  nextStepIsDefining: false,
};

const actions: RecommendedAction[] = [
  { id: 'b', label: 'Build cross-repo links', priority: 2, eligible: true, withinScope: true },
  { id: 'a', label: 'Enrich workflows', priority: 1, eligible: true, withinScope: true },
];

test('decrementPassBudget increments completed and decrements remaining when budgeted', () => {
  const next = decrementPassBudget(createAutonomyState('autonomous', 4));
  assert.equal(next.completedAutoPasses, 1);
  assert.equal(next.remainingAutoPasses, 3);
  assert.equal(next.totalAuthorizedPasses, 4);
});

test('deriveAutonomyStatusView exposes visible counters when counting is active', () => {
  const status = deriveAutonomyStatusView({ mode: 'eager', completedAutoPasses: 2, remainingAutoPasses: 2, totalAuthorizedPasses: 4 });
  assert.equal(status.countingActive, true);
  assert.match(status.summary, /Passes: 2\/4/);
  assert.match(status.summary, /Remaining: 2/);
});

test('rankRecommendedActions picks the top ranked action and enables Do all for compatible actions', () => {
  const ranked = rankRecommendedActions(actions);
  assert.equal(ranked.topActionId, 'a');
  assert.equal(ranked.doAllEligible, true);
  assert.deepEqual(ranked.actions.map((a) => a.id), ['a', 'b']);
});

test('computeDoAllEligibility rejects mutually exclusive actions', () => {
  const eligible = computeDoAllEligibility([
    { id: 'a', label: 'A', priority: 1, eligible: true, withinScope: true, mutuallyExclusiveWith: ['b'] },
    { id: 'b', label: 'B', priority: 2, eligible: true, withinScope: true },
  ]);
  assert.equal(eligible, false);
});

test('chooseActionForMode keeps cautious mode user-driven unless near-trivial', () => {
  const ranked = rankRecommendedActions(actions);
  const choice = chooseActionForMode('cautious', ranked, { ...lowSignal, nextStepIsNearTrivial: false });
  assert.equal(choice, undefined);
});

test('shouldContinueAfterPass stops on goal completion regardless of mode', () => {
  const decision = shouldContinueAfterPass(createAutonomyState('autonomous', 4), { ...lowSignal, goalSufficientlyReached: true });
  assert.equal(decision.shouldContinue, false);
  assert.match(decision.reason, /goal sufficiently reached/i);
});

test('shouldContinueAfterPass stops on stalled progress regardless of mode', () => {
  const decision = shouldContinueAfterPass(createAutonomyState('autonomous', 4), { ...lowSignal, progressStatus: 'stalled' });
  assert.equal(decision.shouldContinue, false);
  assert.match(decision.reason, /progress has stalled/i);
});

test('shouldContinueAfterPass keeps cautious mode asking often', () => {
  const decision = shouldContinueAfterPass(createAutonomyState('cautious', 4), { ...lowSignal, nextStepIsNearTrivial: false });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.selectionMode, 'user');
});

test('shouldContinueAfterPass allows eager mode to continue on defining next steps', () => {
  const decision = shouldContinueAfterPass(createAutonomyState('eager', 4), { ...lowSignal, uncertainty: 'medium', nextStepIsDefining: true });
  assert.equal(decision.shouldContinue, true);
  assert.equal(decision.selectionMode, 'self');
});

test('shouldContinueAfterPass makes autonomous mode self-directed within budget', () => {
  const decision = shouldContinueAfterPass(createAutonomyState('autonomous', 4), lowSignal);
  assert.equal(decision.shouldContinue, true);
  assert.equal(decision.selectionMode, 'self');
});

test('getAutonomyInstructionBlock includes visible counters and reporting contract', () => {
  const block = getAutonomyInstructionBlock({ enabled: true, mode: 'autonomous', completedAutoPasses: 2, remainingAutoPasses: 2, totalAuthorizedPasses: 4 });
  assert.match(block, /Autonomy mode:.*autonomous/i);
  assert.match(block, /completed 2, remaining 2, total authorized 4/i);
  assert.match(block, /output into chat after each pass/i);
  assert.match(block, /counters must remain visible/i);
});
