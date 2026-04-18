import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonEnvelopeBlocks,
  extractPrimaryJsonEnvelope,
  getStructuredResponseContractBlock,
  hasStructuredEnvelope,
} from '../autonomy-contract.js';

test('contract block includes json requirement', () => {
  const block = getStructuredResponseContractBlock();
  assert.ok(block.includes('```json'));
  assert.ok(block.includes('recommended_next_steps'));
  assert.ok(block.includes('goal_status'));
  assert.ok(block.includes('exactly one fenced'));
});

test('extracts structured json envelope blocks', () => {
  const content = [
    'Summary text',
    '```json',
    JSON.stringify({
      summary: 'Implemented next slice',
      goal_status: 'partial',
      progress_status: 'advancing',
      uncertainty: 'low',
      recommended_next_steps: [
        { label: 'Mount header', priority: 1, eligible: true, within_scope: true }
      ]
    }, null, 2),
    '```'
  ].join('\n');

  const blocks = extractJsonEnvelopeBlocks(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].goal_status, 'partial');
  assert.equal(blocks[0].recommended_next_steps?.[0]?.label, 'Mount header');
});

test('returns primary structured json envelope', () => {
  const content = [
    '```json',
    JSON.stringify({ summary: 'Primary', goal_status: 'partial' }),
    '```',
    '```json',
    JSON.stringify({ summary: 'Secondary', goal_status: 'complete' }),
    '```'
  ].join('\n');

  const block = extractPrimaryJsonEnvelope(content);
  assert.equal(block?.summary, 'Primary');
  assert.equal(hasStructuredEnvelope(content), true);
});

test('ignores malformed json blocks', () => {
  const content = '```json\n{ nope }\n```';
  const blocks = extractJsonEnvelopeBlocks(content);
  assert.equal(blocks.length, 0);
  assert.equal(hasStructuredEnvelope(content), false);
});
