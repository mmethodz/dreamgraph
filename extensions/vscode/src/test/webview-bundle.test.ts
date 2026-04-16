import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Slice 3 build migration: bundled webview runtime is emitted', () => {
  const bundlePath = path.join(process.cwd(), 'dist', 'webview.js');
  assert.equal(fs.existsSync(bundlePath), true);
  const content = fs.readFileSync(bundlePath, 'utf8');
  assert.match(content, /registerCardFencePlugin/);
  assert.match(content, /renderMarkdown/);
  assert.match(content, /linkifyEntities/);
});

test('Slice 3 build migration: chat panel loads bundled runtime via script src', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /asWebviewUri\(/);
  assert.match(source, /private _webviewBundleUri: string \| null = null;/);
  assert.match(source, /_webviewBundleUri/);
  assert.doesNotMatch(source, /\$\{this\._webviewBundleSource\}/);
});
