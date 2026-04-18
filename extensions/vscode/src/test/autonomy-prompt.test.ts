/**
 * Tests for autonomy prompt injection logic.
 *
 * NOTE: assemblePrompt (prompts/index.ts) transitively imports 'vscode' via
 * reporting.ts, so it cannot be loaded outside the VS Code extension host.
 * These tests validate the autonomy instruction block and structured response
 * contract block independently — both are pure functions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutonomyInstructionBlock } from '../autonomy.js';
import { getStructuredResponseContractBlock } from '../autonomy-contract.js';

test('getAutonomyInstructionBlock returns instruction when enabled', () => {
  const block = getAutonomyInstructionBlock({
    enabled: true,
    mode: 'autonomous',
    completedAutoPasses: 1,
    remainingAutoPasses: 3,
    totalAuthorizedPasses: 4,
  });
  assert.ok(block);
  assert.match(block, /Autonomy mode/i);
  assert.match(block, /autonomous/i);
  assert.match(block, /completed 1, remaining 3, total authorized 4/i);
});

test('getAutonomyInstructionBlock returns empty string when disabled', () => {
  const block = getAutonomyInstructionBlock({
    enabled: false,
    mode: 'cautious',
    completedAutoPasses: 0,
    remainingAutoPasses: 0,
  });
  assert.equal(block, '');
});

test('getAutonomyInstructionBlock returns empty when undefined', () => {
  const block = getAutonomyInstructionBlock(undefined);
  assert.equal(block, '');
});

test('getStructuredResponseContractBlock includes json envelope requirement', () => {
  const block = getStructuredResponseContractBlock();
  assert.ok(block.length > 0);
  assert.match(block, /structured_action_envelope|json/i);
});
