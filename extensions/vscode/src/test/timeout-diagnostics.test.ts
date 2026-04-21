import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const chatPanelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/chat-panel.ts'),
  'utf8',
);

const contextInspectorSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/context-inspector.ts'),
  'utf8',
);

test('ContextInspector exposes timeout diagnostics logging for DreamGraph Context output', () => {
  assert.match(
    contextInspectorSource,
    /logTimeoutDiagnostics\(event:\s*\{/,
  );
  assert.match(
    contextInspectorSource,
    /\[\$\{ts\}\] Timeout diagnostics:/,
  );
  assert.match(
    contextInspectorSource,
    /request mode: \$\{event\.mode\}/,
  );
  assert.match(
    contextInspectorSource,
    /timeout budget: \$\{event\.timeoutMs\} ms/,
  );
  assert.match(
    contextInspectorSource,
    /recovery attempted: \$\{event\.recoveryAttempted \? "yes" : "no"\}/,
  );
  assert.match(
    contextInspectorSource,
    /recovered: \$\{event\.recovered \? "yes" : "no"\}/,
  );
});

test('ChatPanel forwards timeout diagnostics to the shared ContextInspector', () => {
  assert.match(
    chatPanelSource,
    /private\s+_logTimeoutDiagnostics\(event:\s*\{[\s\S]*?this\.contextInspector\?\.logTimeoutDiagnostics\(event\);[\s\S]*?\}/,
  );
  assert.match(
    chatPanelSource,
    /this\._logTimeoutDiagnostics\(\{[\s\S]*?mode:\s*'stream'[\s\S]*?timeoutMs,[\s\S]*?recoveryAttempted:\s*this\._isTimeoutError\(err\),/,
  );
  assert.match(
    chatPanelSource,
    /this\._logTimeoutDiagnostics\(\{[\s\S]*?recoveryAttempted:\s*true,[\s\S]*?usedReducedContext:\s*true,[\s\S]*?\}\);/,
  );
});
