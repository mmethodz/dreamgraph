import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const chatPanelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/chat-panel.ts'),
  'utf8',
);

const extensionSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/extension.ts'),
  'utf8',
);

test('ChatPanel context logging uses the injected shared ContextInspector', () => {
  assert.match(
    chatPanelSource,
    /private\s+contextInspector\?:\s+import\('\.\/context-inspector\.js'\)\.ContextInspector;/,
  );
  assert.match(
    chatPanelSource,
    /public\s+setContextInspector\(inspector:\s+import\('\.\/context-inspector\.js'\)\.ContextInspector\):\s+void\s*\{\s*this\.contextInspector\s*=\s*inspector;\s*\}/,
  );
  assert.match(
    chatPanelSource,
    /private\s+async\s+_logContextToOutput\([\s\S]*?if\s*\(!envelope\s*\|\|\s*!this\.contextInspector\)\s*return;[\s\S]*?this\.contextInspector\.logContextRequestBoundary\(\{[\s\S]*?\}\);[\s\S]*?this\.contextInspector\.logEnvelope\(envelope\);[\s\S]*?if\s*\(packet\)\s*\{[\s\S]*?this\.contextInspector\.logReasoningPacket\(packet\);[\s\S]*?\}[\s\S]*?\}/,
  );
  assert.doesNotMatch(
    chatPanelSource,
    /new\s+ContextInspector\s*\(/,
  );
  assert.doesNotMatch(
    chatPanelSource,
    /await\s+import\('\.\/context-inspector\.js'\)/,
  );
});

test('extension activate wires the shared ContextInspector into ChatPanel', () => {
  assert.match(
    extensionSource,
    /const\s+contextInspector\s*=\s+new\s+ContextInspector\(\);/,
  );
  assert.match(
    extensionSource,
    /chatPanel\.setContextInspector\(contextInspector\);/,
  );
});
