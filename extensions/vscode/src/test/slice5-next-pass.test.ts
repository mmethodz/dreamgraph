import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Slice 5 next pass adds instance scoping to chat messages', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /instanceId\?: string/);
  assert.match(source, /instanceId: this\.currentInstanceId/);
  assert.match(source, /message\.instanceId === this\.currentInstanceId/);
});

test('Slice 5 next pass restoreMessages filters messages to the active instance', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /restoreMessages\(\)[\s\S]*filter\(\(message\) => !message\.instanceId \|\| message\.instanceId === this\.currentInstanceId\)/);
});

test('Slice 5 next pass adds context footer metadata', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /contextFooter\?: string/);
  assert.match(source, /private _contextFooterFor\(message: ChatMessage\): string/);
  assert.match(source, /Trace reflects real tool execution/);
});

test('Slice 5 next pass adds implicit entity detection and capping', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /MAX_ENTITY_LINKS_PER_MESSAGE = 100/);
  assert.match(source, /private _detectImplicitEntities\(content: string\): ImplicitEntityDetectionResult/);
  assert.match(source, /Implicit entity references detected:/);
  assert.match(source, /Entity link cap reached/);
});

test('Slice 5 next pass adds implicit entity notice styling', () => {
  const styles = readFileSync(join(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
  assert.match(styles, /\.implicit-entity-notice/);
});
