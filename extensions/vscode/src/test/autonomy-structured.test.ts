import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendedActionSetFromContent, extractStructuredPassEnvelope } from '../autonomy-structured.js';

test('extracts actions from recommended next steps section', () => {
  const content = [
    '## Recommended next steps',
    '- Add persistent header',
    '- Wire action dispatch',
  ].join('\n');

  const envelope = extractStructuredPassEnvelope(content);
  assert.equal(envelope.nextSteps.length, 2);
  assert.equal(envelope.nextSteps[0].label, 'Add persistent header');
});

test('prefers structured json envelope when present', () => {
  const content = [
    'Human explanation here',
    '```json',
    JSON.stringify({
      summary: 'Did the thing',
      goal_status: 'partial',
      progress_status: 'advancing',
      uncertainty: 'low',
      recommended_next_steps: [
        { id: 'ship-it', label: 'Ship it', priority: 1, eligible: true, within_scope: true, batch_group: 'release' }
      ]
    }, null, 2),
    '```',
    '## Recommended next steps',
    '- Fallback action that should not win'
  ].join('\n');

  const envelope = extractStructuredPassEnvelope(content);
  assert.equal(envelope.summary, 'Did the thing');
  assert.equal(envelope.nextSteps.length, 1);
  assert.equal(envelope.nextSteps[0].id, 'ship-it');
  assert.equal(envelope.nextSteps[0].batchGroup, 'release');
});

test('ranks actions from assistant output', () => {
  const content = [
    '## Recommended next steps',
    '1. Mount persistent header',
    '2. Add clickable chips',
  ].join('\n');

  const set = buildRecommendedActionSetFromContent(content);
  assert.equal(set.actions.length, 2);
  assert.equal(set.topActionId, set.actions[0].id);
});
