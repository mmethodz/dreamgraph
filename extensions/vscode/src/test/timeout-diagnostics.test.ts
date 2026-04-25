/**
 * Tests for the timeout-diagnostics logging contract.
 *
 * The previous test relied on multi-line regex matches against chat-panel.ts
 * which broke whenever method bodies were refactored. This rewrite asserts:
 *
 *   - the ContextInspector format strings (small, stable, IS the contract)
 *   - that ChatPanel still wires diagnostics through (presence-only checks)
 *
 * ContextInspector is not instantiated directly because its constructor
 * binds to the `vscode` module, which the node:test harness does not load.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const inspectorSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/context-inspector.ts'),
  'utf8',
);

const chatPanelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/chat-panel.ts'),
  'utf8',
);

test('ContextInspector exposes a logTimeoutDiagnostics method with structured fields', () => {
  assert.match(inspectorSource, /logTimeoutDiagnostics\(event:\s*\{/);
  assert.match(inspectorSource, /Timeout diagnostics:/);
  assert.match(inspectorSource, /request mode: \$\{event\.mode\}/);
  assert.match(inspectorSource, /timeout budget: \$\{event\.timeoutMs\} ms/);
  assert.match(inspectorSource, /recovery attempted: \$\{event\.recoveryAttempted \? "yes" : "no"\}/);
  assert.match(inspectorSource, /recovered: \$\{event\.recovered \? "yes" : "no"\}/);
});

test('ContextInspector includes provider, model, tool count, and reduced-context flags', () => {
  assert.match(inspectorSource, /provider: \$\{event\.provider\}/);
  assert.match(inspectorSource, /model: \$\{event\.model \?\? "\(unknown\)"\}/);
  assert.match(inspectorSource, /tool count: \$\{event\.toolCount \?\? 0\}/);
  assert.match(inspectorSource, /reduced context: \$\{event\.usedReducedContext \? "yes" : "no"\}/);
  assert.match(inspectorSource, /error: \$\{event\.errorMessage\}/);
});

test('ChatPanel defines _logTimeoutDiagnostics and forwards to the inspector', () => {
  assert.match(chatPanelSource, /private\s+_logTimeoutDiagnostics\(/);
  assert.match(chatPanelSource, /this\.contextInspector\?\.logTimeoutDiagnostics\(event\)/);
});

test('ChatPanel actually invokes _logTimeoutDiagnostics from the recovery path', () => {
  const occurrences = (chatPanelSource.match(/this\._logTimeoutDiagnostics\(\{/g) ?? []).length;
  assert.ok(occurrences >= 2, `expected >=2 _logTimeoutDiagnostics call sites, found ${occurrences}`);
});
