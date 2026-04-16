import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Slice 5 TDD references action safety and limits', () => {
  const plan = readFileSync(join(process.cwd(), '..', '..', 'plans', 'TDD_COGNITIVE_OUTPUT_V2.md'), 'utf8');
  assert.match(plan, /No action auto-executes\./);
  assert.match(plan, /Max message render size \| 100 KB/);
});

test('chat panel contains Slice 5 action and render limit scaffolding', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /runMessageAction/);
  assert.match(source, /MAX_RENDERED_MESSAGE_CHARS = 100_000/);
  assert.match(source, /ACTION_ALLOWLIST/);
  assert.match(source, /\[Response truncated\]/);
});

test('styles include role header, hover actions, and action block styles', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
  assert.match(css, /message-header/);
  assert.match(css, /message-actions-hover/);
  assert.match(css, /message-action-btn/);
  assert.match(css, /message-context-footer/);
});
