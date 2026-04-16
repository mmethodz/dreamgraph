import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Slice 5 source includes show_full storage and action state messaging', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /fullContent\?: string/);
  assert.match(source, /type: 'messageActionState'/);
  assert.match(source, /status: 'loading' \| 'completed' \| 'failed'/);
});

test('Slice 5 source routes message actions through real execution helpers', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /_executeMessageActionTool/);
  assert.match(source, /this\.mcpClient\.callTool\(toolName, input, ChatPanel\._toolTimeoutMs\(toolName\)\)/);
  assert.match(source, /executeLocalTool\(toolName, input\)/);
  assert.match(source, /Action result \(\$\{action\.label\}\)/);
});

test('Slice 5 source logs action provenance with outcome and detail', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /detail\?: string/);
  assert.match(source, /sourceMessageId: messageId/);
  assert.match(source, /outcome: 'completed'/);
  assert.match(source, /outcome: 'failed'/);
  assert.match(source, /outcome: 'cancelled'/);
});
