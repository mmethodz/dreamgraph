import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('slice 5 runtime renders action buttons with loading/error styles', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /function renderMessageActions\(/);
  assert.match(source, /message-action-btn/);
  assert.match(source, /messageActionState/);
  assert.match(source, /runMessageAction/);
  assert.match(source, /status === 'loading'/);
});

test('slice 5 runtime renders implicit entity notice separately from message content', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /implicitEntityNotice\?: string/);
  assert.match(source, /renderImplicitEntityNotice/);
  assert.match(source, /message\.implicitEntityNotice/);
});

test('slice 5 runtime keeps explicit click requirement for actions', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /addEventListener\('click', \(\) => \{/);
  assert.doesNotMatch(source, /runMessageAction[^\n]*onload/i);
});
