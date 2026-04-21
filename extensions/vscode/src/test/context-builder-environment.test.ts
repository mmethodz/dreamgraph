import test from 'node:test';
import assert from 'node:assert/strict';

import type { ContextPlan, EditorContextEnvelope, EvidenceItem } from '../types';
import { renderEnvironmentContextBlock } from '../environment-context';

function createEnvelope(): EditorContextEnvelope {
  return {
    workspaceRoot: 'c:/workspace/dreamgraph',
    instanceId: null,
    activeFile: {
      path: 'src/tools/web-senses.ts',
      languageId: 'typescript',
      lineCount: 200,
      cursorLine: 12,
      cursorColumn: 4,
      cursorSummary: 'registerWebSensesTools',
      cursorAnchor: {
        kind: 'symbol',
        label: 'registerWebSensesTools',
        path: 'src/tools/web-senses.ts',
        symbolPath: 'registerWebSensesTools',
        source: 'heuristic',
      },
      selection: null,
    },
    visibleFiles: ['src/tools/web-senses.ts'],
    changedFiles: [],
    pinnedFiles: [],
    environmentContext: {
      workspaceRuntime: 'Monorepo with daemon/backend root and VS Code extension subpackage',
      workspacePackageManager: 'npm@10.0.0',
      entries: [
        {
          scope: 'src/tools/',
          runtime: 'Daemon tool runtime / Node.js',
          moduleSystem: 'TypeScript + ESM',
          role: 'MCP tool implementations and external capability adapters',
          boundaries: [
            'Tool handlers execute inside daemon runtime',
            'May depend on web/database/CLI libraries but not VS Code host APIs',
          ],
          keyDependencies: ['@modelcontextprotocol/sdk', 'cheerio', 'turndown'],
        },
        {
          scope: 'src/',
          runtime: 'DreamGraph monorepo core / Node.js',
          moduleSystem: 'TypeScript + ESM',
          role: 'Core daemon/runtime codebase',
          boundaries: ['Root src/* is backend/daemon-oriented unless a narrower scope says otherwise'],
          keyDependencies: ['@modelcontextprotocol/sdk', 'express', 'zod'],
        },
      ],
    },
    graphContext: null,
    intentMode: 'active_file',
    intentConfidence: 0.8,
  };
}

function createFallbackPlan(): ContextPlan {
  return {
    intentMode: 'active_file',
    taskSummary: 'src/tools/web-senses.ts',
    primaryAnchor: {
      kind: 'symbol',
      label: 'registerWebSensesTools',
      path: 'src/tools/web-senses.ts',
      symbolPath: 'registerWebSensesTools',
      source: 'heuristic',
    },
    secondaryAnchors: [],
    requiredEvidence: [],
    optionalEvidence: ['environment', 'feature', 'workflow', 'adr', 'api', 'ui', 'tension'],
    codeReadPlan: [],
    budgetPolicy: {
      maxTokens: 1200,
      reserveTokens: 240,
      allowFullActiveFile: false,
      includeOptionalEvidence: true,
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sortEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

test('fallback planning contract keeps environment evidence in optional evidence', () => {
  const plan = createFallbackPlan();
  assert.ok(plan.optionalEvidence.includes('environment'));
});

test('environment evidence ranks ahead of low-priority notes and stays within a compact token budget', () => {
  const envelope = createEnvelope();
  const plan = createFallbackPlan();
  const environmentContent = renderEnvironmentContextBlock(
    envelope.environmentContext,
    envelope.activeFile?.path,
  );

  assert.ok(environmentContent);

  const taskItem: EvidenceItem = {
    kind: 'task',
    title: 'Task Framing',
    content: '## Task Framing\nIntent mode: active_file\nTask: src/tools/web-senses.ts\nPrimary anchor: registerWebSensesTools',
    relevance: 1,
    confidence: envelope.intentConfidence,
    anchor: plan.primaryAnchor?.label,
    tokenCost: 30,
    required: true,
  };

  const environmentItem: EvidenceItem = {
    kind: 'environment',
    title: 'Environment Context',
    content: environmentContent ?? '',
    relevance: 0.93,
    tokenCost: estimateTokens(environmentContent ?? ''),
    required: false,
  };

  const noteItem: EvidenceItem = {
    kind: 'note',
    title: 'Additional Note',
    content: 'This is a low-priority note.',
    relevance: 0.4,
    tokenCost: estimateTokens('This is a low-priority note.'),
    required: false,
  };

  const sorted = sortEvidence([noteItem, environmentItem, taskItem]);

  assert.equal(sorted[0]?.kind, 'task');
  assert.equal(sorted[1]?.kind, 'environment');
  assert.equal(sorted[2]?.kind, 'note');
  assert.match(environmentItem.content, /## Environment Context/);
  assert.match(environmentItem.content, /Scope `src\/tools\/`/);
  assert.match(environmentItem.content, /Key dependencies: @modelcontextprotocol\/sdk, cheerio, turndown/);
  assert.ok(environmentItem.tokenCost < 220, `expected compact token cost, got ${environmentItem.tokenCost}`);
});
