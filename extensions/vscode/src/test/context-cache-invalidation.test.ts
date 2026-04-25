import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextCache } from '../context-cache.js';

// F-18 scenario 3 — cache invalidation behaviour.
// Pins the contract that:
//   - every name in COGNITIVE_MUTATING_TOOLS triggers deep-insights eviction
//     via maybeInvalidateForTool;
//   - read-only tool names do NOT trigger eviction;
//   - invalidateDeepInsights drops the slot;
//   - clearAll drops both env-snapshot and deep-insights slots;
//   - getDeepInsightsSlot returns the same instance within its TTL window.

test('every COGNITIVE_MUTATING_TOOL triggers deep-insights invalidation', () => {
  for (const tool of ContextCache.COGNITIVE_MUTATING_TOOLS) {
    const cache = new ContextCache();
    // Prime the slot so we have something to invalidate.
    cache.getDeepInsightsSlot();
    const invalidated = cache.maybeInvalidateForTool(tool);
    assert.equal(invalidated, true, `tool "${tool}" must invalidate the cache`);
  }
});

test('read-only tools do NOT trigger invalidation', () => {
  const readOnlyTools = [
    'cognitive_status',
    'query_dreams',
    'query_runtime_metrics',
    'query_architecture_decisions',
    'unknown_tool_xyz',
  ];
  for (const tool of readOnlyTools) {
    const cache = new ContextCache();
    cache.getDeepInsightsSlot();
    const invalidated = cache.maybeInvalidateForTool(tool);
    assert.equal(invalidated, false, `tool "${tool}" must NOT invalidate the cache`);
  }
});

test('invalidateDeepInsights drops the slot so the next get rebuilds it', () => {
  const cache = new ContextCache();
  const first = cache.getDeepInsightsSlot();
  // Mutate slot so we can detect a rebuild.
  (first as { sentinel?: string }).sentinel = 'before';
  const repeat = cache.getDeepInsightsSlot();
  assert.equal(repeat, first, 'within TTL the same slot is returned');

  cache.invalidateDeepInsights('test-eviction');
  const rebuilt = cache.getDeepInsightsSlot();
  assert.notEqual(rebuilt, first, 'after invalidation a fresh slot is built');
  assert.equal((rebuilt as { sentinel?: string }).sentinel, undefined, 'fresh slot has no carry-over');
});

test('clearAll drops both env-snapshot and deep-insights slots', () => {
  const cache = new ContextCache();
  // Seed a snapshot slot. The snapshot value can be null — we only care that
  // the entry is cached (returns null instead of undefined on hit).
  cache.setEnvSnapshot('/repo', null);
  assert.equal(cache.getEnvSnapshot('/repo'), null, 'env snapshot is cached as null');
  cache.getDeepInsightsSlot();

  cache.clearAll();

  assert.equal(cache.getEnvSnapshot('/repo'), undefined, 'env snapshot dropped');
  // Re-fetching the deep slot must produce a fresh instance (no carry-over).
  const fresh = cache.getDeepInsightsSlot();
  assert.equal((fresh as { sentinel?: string }).sentinel, undefined);
});

test('getDeepInsightsSlot returns the same instance within the TTL window', () => {
  const cache = new ContextCache();
  const a = cache.getDeepInsightsSlot();
  const b = cache.getDeepInsightsSlot();
  assert.equal(a, b, 'same slot returned within TTL');
  assert.ok(a.expiresAt > Date.now(), 'expiresAt is in the future');
  assert.ok(
    a.expiresAt <= Date.now() + ContextCache.DEEP_INSIGHTS_TTL_MS + 100,
    'expiresAt does not exceed TTL window',
  );
});

test('maybeInvalidateForTool only fires for the published mutating-tool set', () => {
  // Spot-check the boundary: tools that mutate fact graph or cognitive state
  // are in; tools that only read are out. Catches accidental drift in the
  // COGNITIVE_MUTATING_TOOLS constant.
  const mustInvalidate = ['dream_cycle', 'normalize_dreams', 'record_architecture_decision'];
  const mustNotInvalidate = ['cognitive_status', 'query_dreams'];

  for (const tool of mustInvalidate) {
    const cache = new ContextCache();
    cache.getDeepInsightsSlot();
    assert.equal(cache.maybeInvalidateForTool(tool), true, `${tool} must invalidate`);
  }
  for (const tool of mustNotInvalidate) {
    const cache = new ContextCache();
    cache.getDeepInsightsSlot();
    assert.equal(cache.maybeInvalidateForTool(tool), false, `${tool} must NOT invalidate`);
  }
});
