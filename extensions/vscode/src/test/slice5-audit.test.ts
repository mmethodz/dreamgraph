import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Slice 5 audit: hover actions are wired for copy, retry, and pin', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /type: 'retryMessage'/);
  assert.match(source, /type: 'copyMessage'/);
  assert.match(source, /type: 'pinMessage'/);
  assert.match(source, /message-mini-btn/);
});

test('Slice 5 audit: action execution remains allowlisted and explicit-click only', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /ACTION_ALLOWLIST = new Set\(\['tool', 'show_full'\]\)/);
  assert.match(source, /addEventListener\('click', \(\) => \{/);
  assert.doesNotMatch(source, /runMessageAction[^\n]*onload/i);
});

test('Slice 5 audit: resource guards remain in place', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /MAX_RENDERED_MESSAGE_CHARS = 100_000/);
  assert.match(source, /MAX_ENTITY_LINKS_PER_MESSAGE = 100/);
  assert.match(source, /MAX_VERIFICATION_BATCH_SIZE = 50/);
  assert.match(source, /VERIFICATION_TIMEOUT_MS = 5_000/);
});

test('Slice 5 audit: styles include context footer, action buttons, and implicit entity notice', () => {
  const styles = readFileSync(join(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
  assert.match(styles, /\.message-context-footer/);
  assert.match(styles, /\.message-actions/);
  assert.match(styles, /\.message-action-btn\.loading/);
  assert.match(styles, /\.implicit-entity-notice/);
});
