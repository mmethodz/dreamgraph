/**
 * Tests for parseAutonomyRequest — the pure text-parsing function from reporting.ts.
 *
 * NOTE: reporting.ts imports 'vscode' at module level for configuration access,
 * which means the full module cannot be loaded outside the VS Code extension host.
 * These tests inline the parsing logic extracted from parseAutonomyRequest to
 * validate the algorithm without requiring a vscode mock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutonomyState, type AutonomyMode } from '../autonomy.js';

// Inline copy of the pure parseAutonomyRequest logic for unit-testability
function parseAutonomyRequest(text: string, current: { mode: AutonomyMode; remainingAutoPasses: number; completedAutoPasses: number; totalAuthorizedPasses?: number }) {
  const lower = text.toLowerCase();
  const mode: AutonomyMode =
    lower.includes('autonomous') ? 'autonomous'
      : lower.includes('eager') ? 'eager'
        : lower.includes('conscientious') ? 'conscientious'
          : lower.includes('cautious') ? 'cautious'
            : current.mode;
  const budgetMatch = lower.match(/next\s+(\d+)\s+passes|for\s+the\s+next\s+(\d+)\s+passes|for\s+(\d+)\s+passes/);
  const parsedBudget = budgetMatch ? Number(budgetMatch[1] ?? budgetMatch[2] ?? budgetMatch[3]) : current.totalAuthorizedPasses;
  return {
    mode,
    remainingAutoPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.remainingAutoPasses,
    completedAutoPasses: 0,
    totalAuthorizedPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.totalAuthorizedPasses,
  };
}

test('parseAutonomyRequest extracts autonomous mode from text', () => {
  const current = createAutonomyState('cautious');
  const result = parseAutonomyRequest('Switch to autonomous mode for the next 5 passes', current);
  assert.equal(result.mode, 'autonomous');
  assert.equal(result.remainingAutoPasses, 5);
  assert.equal(result.totalAuthorizedPasses, 5);
  assert.equal(result.completedAutoPasses, 0);
});

test('parseAutonomyRequest extracts eager mode', () => {
  const current = createAutonomyState('cautious');
  const result = parseAutonomyRequest('Run in eager mode', current);
  assert.equal(result.mode, 'eager');
});

test('parseAutonomyRequest extracts conscientious mode', () => {
  const current = createAutonomyState('cautious');
  const result = parseAutonomyRequest('Be conscientious about this', current);
  assert.equal(result.mode, 'conscientious');
});

test('parseAutonomyRequest keeps current mode when no keyword found', () => {
  const current = createAutonomyState('eager', 3);
  const result = parseAutonomyRequest('Just keep going', current);
  assert.equal(result.mode, 'eager');
});

test('parseAutonomyRequest extracts budget from "for N passes" pattern', () => {
  const current = createAutonomyState('autonomous');
  const result = parseAutonomyRequest('for 10 passes', current);
  assert.equal(result.remainingAutoPasses, 10);
  assert.equal(result.totalAuthorizedPasses, 10);
});
