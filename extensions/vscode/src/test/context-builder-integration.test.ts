import test from 'node:test';
import assert from 'node:assert/strict';

import type { EditorContextEnvelope } from '../types';
import { renderEnvironmentContextBlock } from '../environment-context';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function collectEvidenceItemsShim(
  envelope: EditorContextEnvelope,
  fileContent: string | null,
  additionalSections: Map<string, string>,
  plan: {
    intentMode: string;
    taskSummary: string;
    primaryAnchor?: { label?: string };
    requiredEvidence: string[];
    budgetPolicy: { maxTokens: number };
    codeReadPlan: Array<{ required?: boolean }>;
  },
) {
  const items: Array<{
    kind: string;
    title: string;
    content: string;
    relevance: number;
    confidence?: number;
    anchor?: string;
    tokenCost: number;
    required: boolean;
  }> = [];

  const aggregateRelevance = (
    entities: Array<{ relevance?: number }>,
    fallback: number,
  ): number =>
    entities.length > 0
      ? Math.max(...entities.map((e) => e.relevance ?? fallback))
      : fallback;

  const taskContent = `## Task Framing\nIntent mode: ${plan.intentMode}\nTask: ${plan.taskSummary}\nPrimary anchor: ${plan.primaryAnchor?.label ?? 'none'}`;
  items.push({
    kind: 'task',
    title: 'Task Framing',
    content: taskContent,
    relevance: 1,
    confidence: envelope.intentConfidence,
    anchor: plan.primaryAnchor?.label,
    tokenCost: estimateTokens(taskContent),
    required: true,
  });

  if (envelope.environmentContext) {
    const environmentContent = renderEnvironmentContextBlock(
      envelope.environmentContext,
      envelope.activeFile?.path,
    );
    if (environmentContent) {
      items.push({
        kind: 'environment',
        title: 'Environment Context',
        content: environmentContent,
        relevance: 0.93,
        tokenCost: estimateTokens(environmentContent),
        required: plan.requiredEvidence.includes('environment'),
      });
    }
  }

  if (fileContent && envelope.activeFile) {
    const excerpt = `## Focused Code Excerpt\nAnchor: ${
      envelope.activeFile.cursorAnchor?.label ?? envelope.activeFile.cursorSummary
    }\n\`\`\`${envelope.activeFile.languageId}\n${fileContent}\n\`\`\``;
    items.push({
      kind: 'code',
      title: 'Focused Code Excerpt',
      content: excerpt,
      relevance: 0.85,
      anchor: envelope.activeFile.cursorAnchor?.label ?? envelope.activeFile.cursorSummary,
      tokenCost: estimateTokens(excerpt),
      required: plan.codeReadPlan.some((p) => p.required),
    });
  }

  if (
    envelope.graphContext?.relatedFeatures.length ||
    envelope.graphContext?.relatedWorkflows.length
  ) {
    const features = envelope.graphContext.relatedFeatures ?? [];
    const workflows = envelope.graphContext.relatedWorkflows ?? [];
    const content = `## Related Graph Contracts\n${[
      ...features.map((f) => `- feature ${f.id}: ${f.name}`),
      ...workflows.map((w) => `- workflow ${w.id}: ${w.name}`),
    ].join('\n')}`;
    items.push({
      kind: 'feature',
      title: 'Related Graph Contracts',
      content,
      relevance: aggregateRelevance([...features, ...workflows], 0.82),
      tokenCost: estimateTokens(content),
      required:
        plan.requiredEvidence.includes('feature') ||
        plan.requiredEvidence.includes('workflow'),
    });
  }

  for (const [name, content] of additionalSections.entries()) {
    items.push({
      kind: 'note',
      title: name,
      content,
      relevance: 0.4,
      tokenCost: estimateTokens(content),
      required: false,
    });
  }

  return items.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

function createEnvelope(): EditorContextEnvelope {
  return {
    workspaceRoot: 'c:/workspace/dreamgraph',
    instanceId: 'instance-1',
    activeFile: {
      path: 'src/server/server.ts',
      languageId: 'typescript',
      lineCount: 164,
      cursorLine: 42,
      cursorColumn: 3,
      cursorSummary: 'createServer',
      cursorAnchor: {
        kind: 'symbol',
        label: 'createServer',
        path: 'src/server/server.ts',
        symbolPath: 'createServer',
        source: 'heuristic',
      },
      selection: null,
    },
    visibleFiles: ['src/server/server.ts'],
    changedFiles: [],
    pinnedFiles: [],
    environmentContext: {
      workspaceRuntime: 'Monorepo with daemon/backend root and VS Code extension subpackage',
      workspacePackageManager: 'npm@10.0.0',
      entries: [
        {
          scope: 'src/server/',
          runtime: 'Core daemon server / Node.js',
          moduleSystem: 'TypeScript + ESM',
          role: 'DreamGraph daemon bootstrap, MCP server registration, scheduler orchestration',
          framework: 'MCP server + HTTP daemon',
          boundaries: [
            'Registers resources/tools and server instructions',
            'Server/runtime startup belongs here, not in extension host',
          ],
          keyDependencies: ['@modelcontextprotocol/sdk', 'express', 'pino'],
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
    graphContext: {
      relatedFeatures: [{ id: 'daemon-server', name: 'Daemon Server', relevance: 0.88 }],
      relatedWorkflows: [{ id: 'daemon-startup', name: 'Daemon Startup', relevance: 0.84 }],
      applicableAdrs: [],
      uiPatterns: [],
      activeTensions: 0,
      cognitiveState: 'unknown',
      apiSurface: null,
      tensions: [],
      dreamInsights: [],
      causalChains: [],
      temporalPatterns: [],
      dataModelEntities: [],
    },
    intentMode: 'active_file',
    intentConfidence: 0.78,
  };
}

test('shimmed ContextBuilder evidence collection includes environment evidence with stable ordering and compact size', () => {
  const envelope = createEnvelope();
  const plan = {
    intentMode: 'active_file',
    taskSummary: 'Explain src/server/server.ts',
    primaryAnchor: { label: 'createServer' },
    requiredEvidence: ['feature'],
    budgetPolicy: { maxTokens: 1600 },
    codeReadPlan: [{ required: true }],
  };

  const items = collectEvidenceItemsShim(
    envelope,
    'export function createServer() { return true; }',
    new Map([['Additional Note', 'low priority note']]),
    plan,
  );

  const environmentItem = items.find((item) => item.kind === 'environment');
  const featureItem = items.find((item) => item.kind === 'feature');
  const noteItem = items.find((item) => item.kind === 'note');

  assert.ok(environmentItem, 'expected environment evidence');
  assert.ok(featureItem, 'expected feature evidence');
  assert.ok(noteItem, 'expected note evidence');

  assert.match(environmentItem.content, /## Environment Context/);
  assert.match(environmentItem.content, /Scope `src\/server\/`/);
  assert.match(environmentItem.content, /Framework: MCP server \+ HTTP daemon/);
  assert.match(environmentItem.content, /Key dependencies: @modelcontextprotocol\/sdk, express, pino/);

  const environmentIndex = items.findIndex((item) => item.kind === 'environment');
  const noteIndex = items.findIndex((item) => item.kind === 'note');
  assert.ok(environmentIndex >= 0 && noteIndex >= 0 && environmentIndex < noteIndex);

  assert.ok(environmentItem.tokenCost < 220, `expected compact environment evidence, got ${environmentItem.tokenCost}`);
});
