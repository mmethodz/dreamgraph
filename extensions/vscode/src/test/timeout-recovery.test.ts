import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const chatPanelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/chat-panel.ts'),
  'utf8',
);

test('ChatPanel uses provider-aware timeout budgets for stream and tool turns', () => {
  assert.match(
    chatPanelSource,
    /private\s+_getLlmTimeoutMs\(options:\s*\{\s*mode:\s*'stream'\s*\|\s*'tool';\s*toolCount\?:\s*number;\s*reducedContext\?:\s*boolean\s*\}\):\s*number/,
  );
  assert.match(
    chatPanelSource,
    /openai:\s*\{\s*stream:\s*150_000,\s*tool:\s*210_000\s*\}/,
  );
  assert.match(
    chatPanelSource,
    /const\s+timeoutMs\s*=\s*this\._getLlmTimeoutMs\(\{\s*mode:\s*'stream'\s*\}\);[\s\S]*?const\s+req\s*=\s*this\._createRequestSignal\(timeoutMs\);/,
  );
  assert.match(
    chatPanelSource,
    /const\s+req\s*=\s*this\._createRequestSignal\(this\._getLlmTimeoutMs\(\{\s*mode:\s*'tool',\s*toolCount:\s*tools\.length\s*\}\)\);/,
  );
});

test('ChatPanel includes graceful timeout recovery with reduced context retry', () => {
  assert.match(
    chatPanelSource,
    /private\s+async\s+_recoverFromLlmTimeout\(/,
  );
  assert.match(
    chatPanelSource,
    /Continue using an alternative method because the previous LLM request timed out\./,
  );
  assert.match(
    chatPanelSource,
    /this\.messages\.slice\(-8\)/,
  );
  assert.match(
    chatPanelSource,
    /const\s+recoveryTimeoutMs\s*=\s*this\._getLlmTimeoutMs\(\{\s*mode:\s*'stream',\s*reducedContext:\s*true\s*\}\);[\s\S]*?const\s+req\s*=\s*this\._createRequestSignal\(recoveryTimeoutMs\);/,
  );
  assert.match(
    chatPanelSource,
    /const\s+recovered\s*=\s*await\s*this\._recoverFromLlmTimeout\(err,\s*text,\s*envelope\);/,
  );
});
