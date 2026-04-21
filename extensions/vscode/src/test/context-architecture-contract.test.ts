import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContextInstrumentation } from '../context-builder.instrumentation';
import {
  buildEnvironmentContextSnapshot,
  renderEnvironmentContextBlockWithMetrics,
  selectEnvironmentContextForFile,
} from '../environment-context';
import type { ContextPlan, EditorContextEnvelope, EvidenceItem, ReasoningPacket } from '../types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf8');
}

async function withTempWorkspace(
  setup: (root: string) => Promise<void> | void,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-contract-'));
  try {
    await setup(root);
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createEnvelope(overrides?: Partial<EditorContextEnvelope>): EditorContextEnvelope {
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
      applicableAdrs: [{ id: 'ADR-001', title: 'Use MCP-first daemon contracts', relevance: 0.95 }],
      uiPatterns: [],
      activeTensions: 0,
      cognitiveState: 'unknown',
      apiSurface: { server: { methods: ['start'] } },
      tensions: [],
      dreamInsights: [],
      causalChains: [],
      temporalPatterns: [],
      dataModelEntities: [],
    },
    intentMode: 'active_file',
    intentConfidence: 0.78,
    ...overrides,
  };
}

function aggregateRelevance(entities: Array<{ relevance?: number }>, fallback: number): number {
  return entities.length > 0
    ? Math.max(...entities.map((e) => e.relevance ?? fallback))
    : fallback;
}

function collectEvidenceItemsContractShim(
  envelope: EditorContextEnvelope,
  fileContent: string | null,
  additionalSections: Map<string, string>,
  plan: ContextPlan,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const priorityRank = (item: EvidenceItem): number => {
    switch (item.kind) {
      case 'task':
        return 0;
      case 'code':
        return 1;
      case 'adr':
      case 'api':
        return 2;
      case 'environment':
        return 3;
      case 'feature':
      case 'workflow':
      case 'ui':
        return 4;
      case 'tension':
      case 'causal':
      case 'temporal':
      case 'data_model':
      case 'cognitive_status':
        return 5;
      case 'note':
        return 6;
      default:
        return 7;
    }
  };

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

  if (fileContent && envelope.activeFile) {
    const content = `## Focused Code Excerpt\nAnchor: ${envelope.activeFile.cursorAnchor?.label ?? envelope.activeFile.cursorSummary}\n\`\`\`${envelope.activeFile.languageId}\n${fileContent}\n\`\`\``;
    items.push({
      kind: 'code',
      title: 'Focused Code Excerpt',
      content,
      relevance: 0.85,
      anchor: envelope.activeFile.cursorAnchor?.label ?? envelope.activeFile.cursorSummary,
      tokenCost: estimateTokens(content),
      required: plan.codeReadPlan.some((p) => p.required),
    });
  }

  if (envelope.graphContext?.applicableAdrs.length) {
    const entities = envelope.graphContext.applicableAdrs;
    const content = `## Relevant ADRs\n${entities.map((a) => `- ${a.id}: ${a.title}`).join('\n')}`;
    items.push({
      kind: 'adr',
      title: 'Relevant ADRs',
      content,
      relevance: aggregateRelevance(entities, 0.95),
      tokenCost: estimateTokens(content),
      required: plan.requiredEvidence.includes('adr'),
    });
  }

  if (envelope.graphContext?.apiSurface) {
    const content = `## Relevant API Surface\n${JSON.stringify(envelope.graphContext.apiSurface, null, 2)}`;
    items.push({
      kind: 'api',
      title: 'Relevant API Surface',
      content,
      relevance: 0.9,
      tokenCost: estimateTokens(content),
      required: plan.requiredEvidence.includes('api'),
    });
  }

  if (envelope.environmentContext?.entries?.length) {
    const entries = envelope.environmentContext.entries.slice(0, plan.environmentPolicy?.scopeLimit ?? 2);
    const lines: string[] = ['## Environment Context'];
    if (envelope.environmentContext.workspaceRuntime) {
      lines.push(`Workspace runtime: ${envelope.environmentContext.workspaceRuntime}`);
    }
    if (envelope.environmentContext.workspacePackageManager) {
      lines.push(`Package manager: ${envelope.environmentContext.workspacePackageManager}`);
    }
    for (const entry of entries) {
      lines.push(`- \`${entry.scope}\`: ${entry.runtime}; ${entry.moduleSystem}; ${entry.role}`);
      if (entry.framework) lines.push(`  - Framework: ${entry.framework}`);
      if (entry.boundaries[0]) lines.push(`  - Boundary: ${entry.boundaries[0]}`);
      if (entry.keyDependencies.length > 0) {
        lines.push(`  - Dependencies: ${entry.keyDependencies.slice(0, 3).join(', ')}`);
      }
    }
    const content = lines.join('\n');
    items.push({
      kind: 'environment',
      title: 'Environment Context',
      content,
      relevance: 0.86,
      tokenCost: estimateTokens(content),
      required: plan.environmentPolicy?.forceInclude ?? false,
    });
  }

  if (envelope.graphContext?.relatedFeatures.length || envelope.graphContext?.relatedWorkflows.length) {
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
      required: plan.requiredEvidence.includes('feature') || plan.requiredEvidence.includes('workflow'),
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
    const rankDelta = priorityRank(a) - priorityRank(b);
    if (rankDelta !== 0) return rankDelta;
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

function applyBudgetContractShim(
  evidence: EvidenceItem[],
  usableBudget: number,
): {
  included: EvidenceItem[];
  omitted: Array<{ title: string; reason: string; required: boolean; kind?: EvidenceItem['kind'] }>;
} {
  const included: EvidenceItem[] = [];
  const omitted: Array<{ title: string; reason: string; required: boolean; kind?: EvidenceItem['kind'] }> = [];
  let used = 0;

  for (const item of evidence) {
    if (used + item.tokenCost <= usableBudget) {
      included.push(item);
      used += item.tokenCost;
    } else {
      omitted.push({
        title: item.title,
        reason: item.required
          ? 'required evidence exceeded the current usable budget and needs a narrower retrieval plan'
          : 'omitted to preserve minimum sufficient context within budget',
        required: item.required,
        kind: item.kind,
      });
    }
  }

  return { included, omitted };
}

test('selection tests: file-aware routing selects the correct environment scopes', async () => {
  await withTempWorkspace(
    (root) => {
      writeJson(path.join(root, 'package.json'), {
        type: 'module',
        packageManager: 'npm@10.0.0',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          express: '^5.1.0',
          zod: '^4.1.5',
          pino: '^9.9.5',
        },
      });
      writeJson(path.join(root, 'extensions', 'vscode', 'package.json'), {
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          'markdown-it': '^14.1.1',
          dompurify: '^3.4.0',
        },
      });
      fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
      fs.mkdirSync(path.join(root, 'extensions', 'vscode', 'src'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    },
    async (root) => {
      const snapshot = await buildEnvironmentContextSnapshot(root);
      assert.ok(snapshot);

      const serverEntries = selectEnvironmentContextForFile(snapshot, 'src/server/server.ts');
      assert.deepStrictEqual(serverEntries.map((entry) => entry.scope), ['src/server/', 'src/']);

      const extensionEntries = selectEnvironmentContextForFile(snapshot, 'extensions/vscode/src/chat-panel.ts');
      assert.deepStrictEqual(extensionEntries.map((entry) => entry.scope), ['extensions/vscode/src/']);
    },
  );
});

test('rendering stability and token-discipline: unchanged Layer 2 rendering remains identical, compact, and noise-controlled', async () => {
  await withTempWorkspace(
    (root) => {
      writeJson(path.join(root, 'package.json'), {
        type: 'module',
        packageManager: 'pnpm@9.0.0',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          express: '^5.1.0',
          sqlite3: '^5.1.7',
          zod: '^4.1.5',
          pino: '^9.9.5',
          leftpad: '^1.0.0',
          lodash: '^4.17.21',
        },
      });
      fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    },
    async (root) => {
      const snapshot = await buildEnvironmentContextSnapshot(root);
      assert.ok(snapshot);

      const first = renderEnvironmentContextBlockWithMetrics(snapshot, 'src/server/server.ts');
      const second = renderEnvironmentContextBlockWithMetrics(snapshot, 'src/server/server.ts', {
        hash: first.metrics.hash,
        stablePrefixHash: first.metrics.stablePrefixHash,
      });

      assert.equal(first.text, second.text);
      assert.equal(first.metrics.hash, second.metrics.hash);
      assert.equal(first.metrics.stablePrefixHash, second.metrics.stablePrefixHash);
      assert.equal(second.metrics.stableReuseRatio, 1);
      assert.ok((first.text ?? '').startsWith('## Environment Context'));
      assert.ok(first.metrics.tokenEstimate <= 450);
      assert.doesNotMatch(first.text ?? '', /leftpad/);
      assert.doesNotMatch(first.text ?? '', /lodash/);
    },
  );
});

test('evidence-order and omission contract: environment ranks below hard constraints and above notes, and optional evidence can be omitted under budget pressure', () => {
  const envelope = createEnvelope();
  const plan: ContextPlan = {
    intentMode: 'active_file',
    taskSummary: 'Explain createServer and enforce contracts',
    primaryAnchor: envelope.activeFile?.cursorAnchor,
    secondaryAnchors: [],
    requiredEvidence: ['adr', 'api', 'code'],
    optionalEvidence: ['environment', 'feature', 'note'],
    codeReadPlan: [{ scope: 'focused_excerpt', reason: 'focused', required: true }],
    budgetPolicy: {
      maxTokens: 1600,
      reserveTokens: 320,
      allowFullActiveFile: false,
      includeOptionalEvidence: true,
    },
    environmentPolicy: {
      forceInclude: false,
      softTokenCeiling: 220,
      hardTokenCeiling: 320,
      scopeLimit: 2,
    },
  };

  const items = collectEvidenceItemsContractShim(
    envelope,
    'export function createServer() { return true; }',
    new Map([['Additional Note', 'low priority note']]),
    plan,
  );

  const adrIndex = items.findIndex((item) => item.kind === 'adr');
  const apiIndex = items.findIndex((item) => item.kind === 'api');
  const envIndex = items.findIndex((item) => item.kind === 'environment');
  const noteIndex = items.findIndex((item) => item.kind === 'note');

  assert.ok(envIndex > adrIndex, 'environment should rank below ADR constraints');
  assert.ok(envIndex > apiIndex, 'environment should rank below API constraints');
  assert.ok(envIndex < noteIndex, 'environment should rank above notes');

  const budgetResult = applyBudgetContractShim(items, 35);
  assert.ok(budgetResult.included.some((item) => item.kind === 'task'));
  assert.ok(budgetResult.omitted.some((entry) => entry.kind === 'code'));
  assert.ok(budgetResult.omitted.some((entry) => entry.kind === 'adr'));
  assert.ok(budgetResult.omitted.some((entry) => entry.kind === 'api'));
  assert.ok(budgetResult.omitted.some((entry) => entry.kind === 'environment'));
});

test('cache-churn and packet instrumentation: logically unchanged stable inputs produce stable prefix reuse and omission telemetry by kind', () => {
  const included: EvidenceItem[] = [
    {
      kind: 'task',
      title: 'Task Framing',
      content: '## Task Framing\nTask: explain createServer',
      relevance: 1,
      tokenCost: 12,
      required: true,
    },
    {
      kind: 'environment',
      title: 'Environment Context',
      content: '## Environment Context\n- `src/server/`: daemon bootstrap',
      relevance: 0.86,
      tokenCost: 18,
      required: true,
    },
    {
      kind: 'code',
      title: 'Focused Code Excerpt',
      content: '## Focused Code Excerpt\n```ts\nexport function createServer() {}\n```',
      relevance: 0.85,
      tokenCost: 20,
      required: true,
    },
  ];

  const environmentMetrics = {
    matchedScopes: ['src/server/', 'src/'],
    renderedScopeCount: 2,
    tokenEstimate: 18,
    bytes: 72,
    hash: 'env-hash-1',
    stablePrefixHash: 'env-stable-1',
    stablePrefixBytes: 80,
    stablePrefixTokenEstimate: 20,
    stableReuseRatio: 1,
    volatilityKey: 'src/server/server.ts::src/server/|src/',
  };

  const first = buildContextInstrumentation(
    included,
    [{ title: 'Additional Note', reason: 'budget', required: false, kind: 'note' }],
    environmentMetrics,
    null,
  );
  const second = buildContextInstrumentation(
    included,
    [{ title: 'Environment Context', reason: 'budget', required: false, kind: 'environment' }],
    environmentMetrics,
    first.stablePrefixHash,
  );

  assert.equal(second.stablePrefixHash, first.stablePrefixHash);
  assert.equal(second.instrumentation.cacheChurn?.stableReuseRatio, 1);
  assert.equal(second.instrumentation.cacheChurn?.churned, false);
  assert.equal(second.instrumentation.evidenceCounts.omittedByKind.environment, 1);
  assert.equal(first.instrumentation.layerTokenEstimates.environment, 18);
});

test('evaluation fixture plan: representative task packets preserve sufficiency cues for runtime, scope role, module boundary, and graph identity', () => {
  const packet: ReasoningPacket = {
    task: {
      intentMode: 'active_file',
      summary: 'Explain createServer in src/server/server.ts',
    },
    primaryAnchor: {
      kind: 'symbol',
      label: 'createServer',
      path: 'src/server/server.ts',
      symbolPath: 'createServer',
      source: 'heuristic',
    },
    secondaryAnchors: [],
    evidence: [
      {
        kind: 'environment',
        title: 'Environment Context',
        content: [
          '## Environment Context',
          'Workspace runtime: Monorepo with daemon/backend root and VS Code extension subpackage',
          'Package manager: npm@10.0.0',
          '- `src/server/`: Core daemon server / Node.js; TypeScript + ESM; DreamGraph daemon bootstrap, MCP server registration, scheduler orchestration',
          '  - Framework: MCP server + HTTP daemon',
          '  - Boundary: Server/runtime startup belongs here, not in extension host',
        ].join('\n'),
        relevance: 0.86,
        tokenCost: 48,
        required: true,
      },
      {
        kind: 'feature',
        title: 'Related Graph Contracts',
        content: '## Related Graph Contracts\n- feature daemon-server: Daemon Server\n- workflow daemon-startup: Daemon Startup',
        relevance: 0.88,
        tokenCost: 28,
        required: true,
      },
    ],
    omitted: [],
    confidence: 0.8,
    tokenUsage: { used: 76, budget: 1600, reserved: 320 },
  };

  const environmentText = packet.evidence.find((item) => item.kind === 'environment')?.content ?? '';
  const graphText = packet.evidence.find((item) => item.kind === 'feature')?.content ?? '';

  assert.match(environmentText, /Core daemon server \/ Node\.js/);
  assert.match(environmentText, /DreamGraph daemon bootstrap/);
  assert.match(environmentText, /TypeScript \+ ESM/);
  assert.match(environmentText, /not in extension host/);
  assert.match(graphText, /feature daemon-server: Daemon Server/);
  assert.match(graphText, /workflow daemon-startup: Daemon Startup/);
  assert.ok(estimateTokens(environmentText) < 180);
});
