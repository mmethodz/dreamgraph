/**
 * Unit tests for the timeout / recovery helpers extracted from chat-panel.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  REQUEST_TIMEOUT_MS,
  getLlmTimeoutMs,
  isTimeoutError,
  buildTimeoutRecoveryPrompt,
  createTimeoutAbortSignal,
} from '../chat-panel/timeout.js';

test('getLlmTimeoutMs returns Anthropic stream/tool budgets by default', () => {
  assert.equal(getLlmTimeoutMs({ mode: 'stream' }), 90_000);
  assert.equal(getLlmTimeoutMs({ mode: 'tool' }), 120_000);
});

test('getLlmTimeoutMs uses provider-specific budgets', () => {
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'openai' }), 150_000);
  assert.equal(getLlmTimeoutMs({ mode: 'tool', provider: 'openai' }), 210_000);
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'ollama' }), 180_000);
});

test('getLlmTimeoutMs falls back to REQUEST_TIMEOUT_MS for unknown providers', () => {
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'unknown' }), REQUEST_TIMEOUT_MS);
  assert.equal(getLlmTimeoutMs({ mode: 'tool', provider: 'unknown' }), REQUEST_TIMEOUT_MS);
});

test('getLlmTimeoutMs adds 30s when toolCount > 12', () => {
  const base = getLlmTimeoutMs({ mode: 'tool', provider: 'anthropic' });
  assert.equal(getLlmTimeoutMs({ mode: 'tool', provider: 'anthropic', toolCount: 13 }), base + 30_000);
  assert.equal(getLlmTimeoutMs({ mode: 'tool', provider: 'anthropic', toolCount: 12 }), base);
});

test('getLlmTimeoutMs reduces budget by 30s when reducedContext=true (floor 60s)', () => {
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'anthropic', reducedContext: true }), 60_000);
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'openai', reducedContext: true }), 120_000);
  assert.equal(getLlmTimeoutMs({ mode: 'stream', provider: 'unknown', reducedContext: true }), 60_000);
});

test('isTimeoutError matches the canonical timeout error shapes', () => {
  assert.equal(isTimeoutError(new Error('LLM request timed out after 90s')), true);
  assert.equal(isTimeoutError(new Error('Request timed out')), true);
  assert.equal(isTimeoutError('LLM request timed out after 120s'), true);
});

test('isTimeoutError ignores unrelated errors', () => {
  assert.equal(isTimeoutError(new Error('429 rate limited')), false);
  assert.equal(isTimeoutError(new Error('network error')), false);
  assert.equal(isTimeoutError(null), false);
  assert.equal(isTimeoutError(undefined), false);
});

test('buildTimeoutRecoveryPrompt prepends the original text and recovery instructions', () => {
  const prompt = buildTimeoutRecoveryPrompt('summarize the data model');
  assert.match(prompt, /^summarize the data model\n/);
  assert.match(prompt, /Continue using an alternative method because the previous LLM request timed out\./);
  assert.match(prompt, /1\. Prefer the knowledge graph over long source reads\./);
  assert.match(prompt, /2\. Use at most 8 recent messages of history\./);
  assert.match(prompt, /3\. Avoid broad tool use unless strictly necessary\./);
  assert.match(prompt, /4\. Produce a concise useful result first/);
});

test('createTimeoutAbortSignal aborts when the timer fires', async () => {
  const parent = new AbortController();
  const handle = createTimeoutAbortSignal(parent, 30);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(handle.signal.aborted, true);
  const reason = handle.signal.reason;
  assert.ok(reason instanceof Error);
  assert.match((reason as Error).message, /timed out after 0\.03s/);
  handle.dispose();
});

test('createTimeoutAbortSignal aborts when the parent signal aborts', () => {
  const parent = new AbortController();
  const handle = createTimeoutAbortSignal(parent, 60_000);
  assert.equal(handle.signal.aborted, false);
  parent.abort('User stopped generation');
  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.signal.reason, 'User stopped generation');
  handle.dispose();
});

test('createTimeoutAbortSignal aborts immediately if parent already aborted', () => {
  const parent = new AbortController();
  parent.abort('already gone');
  const handle = createTimeoutAbortSignal(parent, 60_000);
  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.signal.reason, 'already gone');
  handle.dispose();
});

test('createTimeoutAbortSignal works without a parent controller', async () => {
  const handle = createTimeoutAbortSignal(null, 20);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(handle.signal.aborted, true);
  handle.dispose();
});

test('createTimeoutAbortSignal dispose() clears the timer (no late aborts)', async () => {
  const parent = new AbortController();
  const handle = createTimeoutAbortSignal(parent, 20);
  handle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(handle.signal.aborted, false);
});

const chatPanelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/chat-panel.ts'),
  'utf8',
);

test('chat-panel.ts imports from chat-panel/timeout.ts', () => {
  assert.match(chatPanelSource, /from\s+'\.\/chat-panel\/timeout\.js'/);
});

test('chat-panel.ts still calls _getLlmTimeoutMs and _createRequestSignal at the streaming + tool sites', () => {
  assert.match(chatPanelSource, /this\._createRequestSignal\(this\._getLlmTimeoutMs\(\{\s*mode:\s*'stream'\s*\}\)\)/);
  assert.match(chatPanelSource, /this\._getLlmTimeoutMs\(\{\s*mode:\s*'tool',\s*toolCount:\s*tools\.length\s*\}\)/);
});

test('chat-panel.ts still invokes the recovery flow on stream timeouts', () => {
  assert.match(chatPanelSource, /this\._recoverFromLlmTimeout\(/);
});
