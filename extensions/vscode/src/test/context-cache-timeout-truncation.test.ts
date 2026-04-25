import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextCache } from '../context-cache.js';

// F-18 scenario 4 — context-builder timeout truncation.
// Pins the F-14 observability surface in ContextCache:
//   - recordTimeout increments per-tool counters monotonically;
//   - getTimeoutStats returns a snapshot with the right keys/values;
//   - isTimeout heuristic matches /timeout|timed out|aborted/i and
//     rejects unrelated errors.
//
// The timeout counter is process-wide (static field). Each test uses a
// freshly-coined tool name so it does not collide with other tests in the
// same process and is not order-dependent.

let counter = 0;
function uniqueTool(prefix: string): string {
  counter += 1;
  return `${prefix}_${process.pid}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

test('recordTimeout increments per-tool counters', () => {
  const tool = uniqueTool('f18_record');
  ContextCache.recordTimeout(tool);
  ContextCache.recordTimeout(tool);
  ContextCache.recordTimeout(tool);

  const stats = ContextCache.getTimeoutStats();
  assert.equal(stats[tool], 3, 'three recorded timeouts must produce a count of 3');
});

test('getTimeoutStats returns an independent snapshot — mutating it does not affect the cache', () => {
  const tool = uniqueTool('f18_snapshot');
  ContextCache.recordTimeout(tool);

  const snap = ContextCache.getTimeoutStats();
  assert.equal(snap[tool], 1);

  // Mutate the snapshot; subsequent reads must not reflect the mutation.
  snap[tool] = 999;
  const fresh = ContextCache.getTimeoutStats();
  assert.equal(fresh[tool], 1, 'cache state must not be aliased through getTimeoutStats');
});

test('per-tool counters are independent', () => {
  const a = uniqueTool('f18_a');
  const b = uniqueTool('f18_b');
  ContextCache.recordTimeout(a);
  ContextCache.recordTimeout(a);
  ContextCache.recordTimeout(b);

  const stats = ContextCache.getTimeoutStats();
  assert.equal(stats[a], 2);
  assert.equal(stats[b], 1);
});

test('isTimeout matches the documented timeout/aborted error vocabulary', () => {
  const matches = [
    new Error('Operation timed out after 6000ms'),
    new Error('Request timeout'),
    new Error('AbortError: The operation was aborted'),
    'fetch aborted',
    'TIMEOUT',
  ];
  for (const err of matches) {
    assert.equal(ContextCache.isTimeout(err), true, `should classify as timeout: ${String(err)}`);
  }
});

test('isTimeout rejects unrelated errors and falsy values', () => {
  const nonMatches = [
    new Error('ECONNREFUSED'),
    new Error('Invalid response shape'),
    new Error('404 Not Found'),
    'permission denied',
    null,
    undefined,
    '',
    0,
  ];
  for (const err of nonMatches) {
    assert.equal(
      ContextCache.isTimeout(err),
      false,
      `should NOT classify as timeout: ${err === null ? 'null' : err === undefined ? 'undefined' : String(err)}`,
    );
  }
});

test('MCP_CONTEXT_FETCH_TIMEOUT_MS is a positive finite number', () => {
  // F-07 baseline ceiling — the value comes from env or defaults to 6_000.
  // We don't pin the exact value (it's overridable), only that it's sane.
  assert.ok(Number.isFinite(ContextCache.MCP_CONTEXT_FETCH_TIMEOUT_MS));
  assert.ok(ContextCache.MCP_CONTEXT_FETCH_TIMEOUT_MS > 0);
});
