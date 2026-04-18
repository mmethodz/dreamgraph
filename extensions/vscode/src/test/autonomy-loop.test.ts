import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutonomyState } from '../autonomy.js';
import { advanceAutonomyStateIfContinued, analyzePass, inferPassOutcomeSignal } from '../autonomy-loop.js';

test('inferPassOutcomeSignal detects goal completion and stalled progress markers', () => {
  const done = inferPassOutcomeSignal('Done and verified. Ready for commit.');
  assert.equal(done.goalSufficientlyReached, true);
  const stalled = inferPassOutcomeSignal('Stalled progress. Cannot proceed.');
  assert.equal(stalled.progressStatus, 'stalled');
});

test('analyzePass selects continuation prompt when autonomous mode has a strong next step', () => {
  const state = createAutonomyState('autonomous', 4);
  const result = analyzePass(state, {
    content: 'Implemented a structural next slice. Recommended next step: add clickable recommended actions.',
    actions: [{ id: 'next', label: 'Add clickable recommended actions', priority: 1, eligible: true, withinScope: true }],
  });
  assert.equal(result.decision.shouldContinue, true);
  assert.equal(result.selectedActionId, 'next');
  assert.match(result.nextPrompt ?? '', /Add clickable recommended actions/);
});

test('analyzePass stops when goal is sufficiently reached', () => {
  const state = createAutonomyState('autonomous', 4);
  const result = analyzePass(state, {
    content: 'Done and verified. Ready for commit.',
  });
  assert.equal(result.decision.shouldContinue, false);
  assert.match(result.decision.reason, /goal sufficiently reached/i);
});

test('advanceAutonomyStateIfContinued decrements visible counters only when continuing', () => {
  const state = createAutonomyState('autonomous', 4);
  const continued = advanceAutonomyStateIfContinued(state, { shouldContinue: true, reason: 'continue', selectionMode: 'self' });
  assert.equal(continued.completedAutoPasses, 1);
  assert.equal(continued.remainingAutoPasses, 3);
  const paused = advanceAutonomyStateIfContinued(state, { shouldContinue: false, reason: 'stop', selectionMode: 'none' });
  assert.equal(paused.completedAutoPasses, 0);
  assert.equal(paused.remainingAutoPasses, 4);
});
