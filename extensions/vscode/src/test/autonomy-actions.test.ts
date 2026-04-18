import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendedActions, chooseActionForMode } from '../autonomy.js';

test('do all eligible only for compatible actions', () => {
  const ranked = rankRecommendedActions([
    { id: 'a1', label: 'One', priority: 1, eligible: true, withinScope: true },
    { id: 'a2', label: 'Two', priority: 2, eligible: true, withinScope: true },
  ]);
  assert.equal(ranked.doAllEligible, true);
});

test('eager selects strongest action under medium uncertainty when defining', () => {
  const ranked = rankRecommendedActions([
    { id: 'a1', label: 'Add clickable actions', priority: 1, eligible: true, withinScope: true },
  ]);
  const selected = chooseActionForMode('eager', ranked, {
    hasClearNextStep: true,
    uncertainty: 'medium',
    hasBlockingFailure: false,
    nextStepWithinScope: true,
    goalSufficientlyReached: false,
    progressStatus: 'advancing',
    nextStepIsDefining: true,
  });
  assert.equal(selected, 'a1');
});
