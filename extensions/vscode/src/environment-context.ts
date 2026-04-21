/**
 * Stable Environment Context — compact, cache-friendly runtime/package facts
 * derived from workspace structure and package manifests.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface EnvironmentContextEntry {
  scope: string;
  runtime: string;
  moduleSystem: string;
  role: string;
  framework?: string;
  boundaries: string[];
  keyDependencies: string[];
}

export interface EnvironmentContextSnapshot {
  workspaceRuntime?: string;
  workspacePackageManager?: string;
  entries: EnvironmentContextEntry[];
}

export interface EnvironmentContextRenderMetrics {
  matchedScopes: string[];
  renderedScopeCount: number;
  tokenEstimate: number;
  bytes: number;
  hash: string;
  stablePrefixHash: string;
  stablePrefixBytes: number;
  stablePrefixTokenEstimate: number;
  stableReuseRatio?: number;
  volatilityKey: string;
}

export interface EnvironmentContextRenderResult {
  text: string | null;
  metrics: EnvironmentContextRenderMetrics;
}

interface PackageFacts {
  type?: string;
  packageManager?: string;
  dependencies: Set<string>;
}

const STABLE_SCOPE_ORDER = [
  "extensions/vscode/src/",
  "src/api/",
  "src/server/",
  "src/cognitive/",
  "src/tools/",
  "src/cli/",
  "src/resources/",
  "src/",
] as const;

const ENVIRONMENT_SCOPE_LIMIT = 2;
const EMPTY_ENVIRONMENT_HASH = "env:none";

export async function buildEnvironmentContextSnapshot(
  workspaceRoot: string,
): Promise<EnvironmentContextSnapshot | null> {
  if (!workspaceRoot) return null;

  const rootPkg = await readPackageFacts(path.join(workspaceRoot, "package.json"));
  const extPkg = await readPackageFacts(
    path.join(workspaceRoot, "extensions", "vscode", "package.json"),
  );

  const entries: EnvironmentContextEntry[] = [];

  const pushIfRelevant = async (
    scope: string,
    entry: Omit<EnvironmentContextEntry, "scope">,
  ): Promise<void> => {
    const abs = path.join(workspaceRoot, scope);
    if (!(await exists(abs))) return;
    entries.push({ scope, ...entry });
  };

  await pushIfRelevant("extensions/vscode/src/", {
    runtime: "VS Code extension host / Node.js",
    moduleSystem: extPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript + CommonJS/unspecified",
    role: "Extension host orchestration, chat panel, prompt/context assembly, local tools",
    framework: "VS Code Extension API",
    boundaries: [
      "UI/webview and extension-host logic stay here",
      "Uses MCP/HTTP clients to reach daemon instead of embedding daemon runtime",
      "Local support tools execute in extension host",
    ],
    keyDependencies: pickDependencies(extPkg, [
      "@modelcontextprotocol/sdk",
      "markdown-it",
      "dompurify",
      "mermaid",
    ]),
  });

  await pushIfRelevant("src/api/", {
    runtime: "Daemon backend / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "HTTP/API surface and backend integration layer",
    boundaries: [
      "Backend-facing contracts and API handlers live here",
      "Should not contain VS Code extension-host UI logic",
    ],
    keyDependencies: pickDependencies(rootPkg, ["express", "zod", "@modelcontextprotocol/sdk"]),
  });

  await pushIfRelevant("src/server/", {
    runtime: "Core daemon server / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "DreamGraph daemon bootstrap, MCP server registration, scheduler orchestration",
    framework: "MCP server + HTTP daemon",
    boundaries: [
      "Registers resources/tools and server instructions",
      "Server/runtime startup belongs here, not in extension host",
    ],
    keyDependencies: pickDependencies(rootPkg, ["@modelcontextprotocol/sdk", "express", "pino"]),
  });

  await pushIfRelevant("src/cognitive/", {
    runtime: "Cognitive engine / daemon runtime",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "Dream cycles, scheduler, graph reasoning, candidate/validated edge processing",
    boundaries: [
      "Cognitive state and scheduler logic live here",
      "Should remain separate from extension UI concerns",
    ],
    keyDependencies: pickDependencies(rootPkg, ["sqlite3", "zod", "p-limit"]),
  });

  await pushIfRelevant("src/tools/", {
    runtime: "Daemon tool runtime / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "MCP tool implementations and external capability adapters",
    boundaries: [
      "Tool handlers execute inside daemon runtime",
      "May depend on web/database/CLI libraries but not VS Code host APIs",
    ],
    keyDependencies: pickDependencies(rootPkg, [
      "@modelcontextprotocol/sdk",
      "cheerio",
      "turndown",
      "jsdom",
      "marked",
    ]),
  });

  await pushIfRelevant("src/cli/", {
    runtime: "CLI runtime / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "dg CLI commands, instance lifecycle commands, daemon control",
    boundaries: [
      "CLI packaging/startup concerns live here",
      "CLI is separate from daemon request handlers and extension UI",
    ],
    keyDependencies: pickDependencies(rootPkg, ["commander", "chalk", "@modelcontextprotocol/sdk"]),
  });

  await pushIfRelevant("src/resources/", {
    runtime: "Daemon resource runtime / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "Knowledge/resource exposure layer for system and graph reads",
    boundaries: [
      "Read-oriented MCP resources belong here",
      "Separate from tool mutation/orchestration handlers",
    ],
    keyDependencies: pickDependencies(rootPkg, ["@modelcontextprotocol/sdk", "zod"]),
  });

  await pushIfRelevant("src/", {
    runtime: "DreamGraph monorepo core / Node.js",
    moduleSystem: rootPkg?.type === "module" ? "TypeScript + ESM" : "TypeScript",
    role: "Core daemon/runtime codebase",
    boundaries: [
      "Root src/* is backend/daemon-oriented unless a narrower scope says otherwise",
      "Use folder role before assuming generic library semantics",
    ],
    keyDependencies: pickDependencies(rootPkg, [
      "@modelcontextprotocol/sdk",
      "express",
      "sqlite3",
      "zod",
    ]),
  });

  return {
    workspaceRuntime: "Monorepo with daemon/backend root and VS Code extension subpackage",
    workspacePackageManager: rootPkg?.packageManager ?? extPkg?.packageManager,
    entries: entries.sort(
      (a, b) =>
        STABLE_SCOPE_ORDER.indexOf(a.scope as typeof STABLE_SCOPE_ORDER[number]) -
        STABLE_SCOPE_ORDER.indexOf(b.scope as typeof STABLE_SCOPE_ORDER[number]),
    ),
  };
}

export function selectEnvironmentContextForFile(
  snapshot: EnvironmentContextSnapshot | null,
  relativeFilePath?: string | null,
): EnvironmentContextEntry[] {
  if (!snapshot) return [];
  if (!relativeFilePath) return snapshot.entries.slice(0, ENVIRONMENT_SCOPE_LIMIT);

  const direct = snapshot.entries.filter((entry) => relativeFilePath.startsWith(entry.scope));
  if (direct.length > 0) {
    return direct.slice(0, ENVIRONMENT_SCOPE_LIMIT);
  }

  return snapshot.entries
    .filter(
      (entry) => entry.scope === "src/" || entry.scope === "extensions/vscode/src/",
    )
    .slice(0, ENVIRONMENT_SCOPE_LIMIT);
}

export function renderEnvironmentContextBlock(
  snapshot: EnvironmentContextSnapshot | null,
  relativeFilePath?: string | null,
): string | null {
  return renderEnvironmentContextBlockWithMetrics(snapshot, relativeFilePath).text;
}

export function renderEnvironmentContextBlockWithMetrics(
  snapshot: EnvironmentContextSnapshot | null,
  relativeFilePath?: string | null,
  previousMetrics?: Pick<EnvironmentContextRenderMetrics, "hash" | "stablePrefixHash"> | null,
): EnvironmentContextRenderResult {
  if (!snapshot) {
    return {
      text: null,
      metrics: {
        matchedScopes: [],
        renderedScopeCount: 0,
        tokenEstimate: 0,
        bytes: 0,
        hash: EMPTY_ENVIRONMENT_HASH,
        stablePrefixHash: EMPTY_ENVIRONMENT_HASH,
        stablePrefixBytes: 0,
        stablePrefixTokenEstimate: 0,
        stableReuseRatio: previousMetrics ? 1 : undefined,
        volatilityKey: "env:none",
      },
    };
  }

  const entries = selectEnvironmentContextForFile(snapshot, relativeFilePath);
  if (entries.length === 0) {
    return {
      text: null,
      metrics: {
        matchedScopes: [],
        renderedScopeCount: 0,
        tokenEstimate: 0,
        bytes: 0,
        hash: EMPTY_ENVIRONMENT_HASH,
        stablePrefixHash: EMPTY_ENVIRONMENT_HASH,
        stablePrefixBytes: 0,
        stablePrefixTokenEstimate: 0,
        stableReuseRatio: previousMetrics ? 1 : undefined,
        volatilityKey: buildVolatilityKey(relativeFilePath, []),
      },
    };
  }

  const lines: string[] = ["## Environment Context"];
  if (snapshot.workspaceRuntime) {
    lines.push(`Workspace runtime: ${snapshot.workspaceRuntime}`);
  }
  if (snapshot.workspacePackageManager) {
    lines.push(`Package manager: ${snapshot.workspacePackageManager}`);
  }

  for (const entry of entries) {
    lines.push(`- Scope \`${entry.scope}\``);
    lines.push(`  - Runtime: ${entry.runtime}`);
    lines.push(`  - Module system: ${entry.moduleSystem}`);
    lines.push(`  - Role: ${entry.role}`);
    if (entry.framework) {
      lines.push(`  - Framework: ${entry.framework}`);
    }
    const renderedBoundaries = entry.boundaries.slice(0, 2);
    if (renderedBoundaries.length > 0) {
      lines.push(`  - Boundaries: ${renderedBoundaries.join("; ")}`);
    }
    if (entry.keyDependencies.length > 0) {
      lines.push(`  - Key dependencies: ${entry.keyDependencies.join(", ")}`);
    }
  }

  let text = lines.join("\n");
  if (estimateTokens(text) > 450) {
    const compactLines: string[] = ["## Environment Context"];
    if (snapshot.workspaceRuntime) {
      compactLines.push(`Workspace runtime: ${snapshot.workspaceRuntime}`);
    }
    for (const entry of entries) {
      compactLines.push(
        `- \`${entry.scope}\`: ${entry.runtime}; ${entry.moduleSystem}; ${entry.role}`,
      );
      if (entry.framework) {
        compactLines.push(`  - Framework: ${entry.framework}`);
      }
      if (entry.boundaries[0]) {
        compactLines.push(`  - Boundary: ${entry.boundaries[0]}`);
      }
      if (entry.keyDependencies.length > 0) {
        compactLines.push(`  - Dependencies: ${entry.keyDependencies.slice(0, 3).join(", ")}`);
      }
    }
    text = compactLines.join("\n");
  }

  const hash = stableHash(text);
  const stablePrefix = `environment:v2\n${text}`;
  const stablePrefixHash = stableHash(stablePrefix);
  const stablePrefixBytes = Buffer.byteLength(stablePrefix, "utf8");
  const stablePrefixTokenEstimate = estimateTokens(stablePrefix);
  const reuseRatio = previousMetrics
    ? computeStableReuseRatio(stablePrefixHash, previousMetrics.stablePrefixHash)
    : undefined;

  return {
    text,
    metrics: {
      matchedScopes: entries.map((entry) => entry.scope),
      renderedScopeCount: entries.length,
      tokenEstimate: estimateTokens(text),
      bytes: Buffer.byteLength(text, "utf8"),
      hash,
      stablePrefixHash,
      stablePrefixBytes,
      stablePrefixTokenEstimate,
      stableReuseRatio: reuseRatio,
      volatilityKey: buildVolatilityKey(relativeFilePath, entries),
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function readPackageFacts(packageJsonPath: string): Promise<PackageFacts | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      type?: string;
      packageManager?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      type: parsed.type,
      packageManager: parsed.packageManager,
      dependencies: new Set([
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ]),
    };
  } catch {
    return null;
  }
}

function pickDependencies(
  facts: PackageFacts | null,
  candidates: string[],
): string[] {
  if (!facts) return [];
  return candidates.filter((name) => facts.dependencies.has(name)).slice(0, 5);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function computeStableReuseRatio(currentHash: string, previousHash: string): number {
  return currentHash === previousHash ? 1 : 0;
}

function buildVolatilityKey(
  relativeFilePath: string | null | undefined,
  entries: EnvironmentContextEntry[],
): string {
  const pathKey = relativeFilePath ?? "<no-file>";
  const scopeKey = entries.length > 0
    ? entries.map((entry) => entry.scope).join("|")
    : "<no-scope>";
  return `${pathKey}::${scopeKey}`;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
