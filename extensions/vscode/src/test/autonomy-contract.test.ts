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

test('extracts envelope from a fenced block with no language hint', () => {
  const content = [
    'Some prose first.',
    '```',
    JSON.stringify({
      summary: 'Lang-less fence',
      goal_status: 'partial',
      recommended_next_steps: [{ label: 'next', priority: 1 }],
    }, null, 2),
    '```',
  ].join('\n');

  const block = extractPrimaryJsonEnvelope(content);
  assert.ok(block, 'expected envelope from lang-less fence');
  assert.equal(block?.summary, 'Lang-less fence');
  assert.equal(block?.recommended_next_steps?.[0]?.label, 'next');
});

test('extracts bare top-level JSON envelope (no fence at all)', () => {
  const content = [
    'Done. Here is the envelope:',
    '',
    JSON.stringify({
      summary: 'Bare envelope',
      goal_status: 'complete',
      recommended_next_steps: [],
    }, null, 2),
    '',
    'Trailing prose after envelope.',
  ].join('\n');

  const block = extractPrimaryJsonEnvelope(content);
  assert.ok(block, 'expected bare JSON envelope to be extracted');
  assert.equal(block?.summary, 'Bare envelope');
  assert.equal(block?.goal_status, 'complete');
});

test('repairs envelopes containing smart quotes and trailing commas', () => {
  const quirky = [
    '```json',
    '{',
    '  \u201Csummary\u201D: \u201CExtended thinking quirks\u201D,',
    '  \u201Cgoal_status\u201D: \u201Cpartial\u201D,',
    '  \u201Crecommended_next_steps\u201D: [',
    '    { \u201Clabel\u201D: \u201CKeep going\u201D, \u201Cpriority\u201D: 1, },',
    '  ],',
    '}',
    '```',
  ].join('\n');

  const block = extractPrimaryJsonEnvelope(quirky);
  assert.ok(block, 'lenient repair should rescue smart-quoted envelope');
  assert.equal(block?.summary, 'Extended thinking quirks');
  assert.equal(block?.recommended_next_steps?.length, 1);
  assert.equal(block?.recommended_next_steps?.[0]?.label, 'Keep going');
});

test('preserves // and , ] sequences inside string values during repair', () => {
  const tricky = [
    '```json',
    JSON.stringify({
      summary: 'Run //test, ] check',
      goal_status: 'partial',
      recommended_next_steps: [{ label: 'a, b ] c', priority: 1 }],
    }, null, 2),
    '```',
  ].join('\n');

  const block = extractPrimaryJsonEnvelope(tricky);
  assert.ok(block, 'expected envelope with tricky string content');
  assert.equal(block?.summary, 'Run //test, ] check');
  assert.equal(block?.recommended_next_steps?.[0]?.label, 'a, b ] c');
});

test('does not falsely match a non-envelope JSON object that happens to have summary', () => {
  const content = [
    'Tool input echo:',
    '```json',
    JSON.stringify({ summary: 'just a tool arg, no envelope keys' }, null, 2),
    '```',
  ].join('\n');

  const blocks = extractJsonEnvelopeBlocks(content);
  assert.equal(blocks.length, 0);
});

