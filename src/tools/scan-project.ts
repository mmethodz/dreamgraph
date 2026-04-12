/**
 * DreamGraph MCP Server — scan_project tool.
 *
 * Convenience orchestrator that automates the initial project scan
 * and knowledge graph enrichment.  Replaces the manual multi-step
 * prompt: read_source_code → enrich_seed_data(features) →
 * enrich_seed_data(workflows) → enrich_seed_data(data_model) →
 * register_ui_element → schedule_dream.
 *
 * Design principles:
 *   - **Opt-in convenience** — all individual tools remain available.
 *     Users can still manually enrich the graph with richer data.
 *   - **Non-destructive** — always uses merge mode, never replaces
 *     existing enrichment.  Safe to re-run after manual enrichment.
 *   - **LLM-powered** — uses the configured dreamer LLM to generate
 *     rich, semantic entries rather than only heuristic classification.
 *     Falls back to structural-only if LLM is unavailable.
 *   - **Transparent** — returns detailed counts so the user knows
 *     exactly what was created.
 *
 * Usage:  scan_project()                — full scan, all targets
 *         scan_project({ depth: "shallow" }) — top-level only
 *         scan_project({ targets: ["features"] }) — features only
 *         scan_project({ schedule_dreams: true }) — scan + schedule
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { dataPath } from "../utils/paths.js";
import { loadJsonArray, invalidateCache } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { getLlmProvider, getDreamerLlmConfig, isLlmAvailable } from "../cognitive/llm.js";
import type { LlmMessage } from "../cognitive/llm.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  IndexEntry,
  ResourceIndex,
  GraphLink,
  WorkflowStep,
  EntityField,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max files to include in a single LLM prompt batch */
const LLM_BATCH_SIZE = 40;

/** Max bytes to read from a file for content analysis */
const MAX_FILE_BYTES = 3072;

/** File extensions we scan */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".cs",
  ".vue", ".svelte", ".xaml", ".razor",
]);

/** Config / manifest files that reveal project structure */
const MANIFEST_FILES = new Set([
  "package.json", "tsconfig.json", "cargo.toml", "go.mod",
  "pyproject.toml", "requirements.txt", "setup.py",
  "pom.xml", "build.gradle", "build.gradle.kts",
  "*.csproj", "*.sln", "*.fsproj",
  "docker-compose.yml", "dockerfile",
  "makefile", "justfile",
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "__pycache__", ".venv", "venv", "target", "coverage",
  ".turbo", ".cache", ".parcel-cache", "bin", "obj",
  ".vs", ".idea", "packages", "artifacts",
]);

/** UI file extensions / patterns */
const UI_FILE_PATTERNS = [
  /\.xaml$/i, /\.razor$/i, /\.vue$/i, /\.svelte$/i,
  /\.tsx$/i, /\.jsx$/i,
  /Page\.cs$/i, /View\.cs$/i, /Dialog\.cs$/i,
  /Component\.(ts|js)$/i,
];

// ---------------------------------------------------------------------------
// Source file scanning
// ---------------------------------------------------------------------------

interface ScannedFile {
  abs: string;
  rel: string;
  name: string;
  ext: string;
  dirParts: string[];
  size: number;
}

interface ProjectScan {
  repoName: string;
  repoRoot: string;
  technology: string;
  files: ScannedFile[];
  manifestContent: Record<string, string>;
  uiFiles: ScannedFile[];
  topLevelDirs: string[];
}

async function detectTechnology(repoRoot: string): Promise<string> {
  const techs: string[] = [];
  try {
    const entries = await fs.readdir(repoRoot);
    const names = new Set(entries.map(e => e.toLowerCase()));

    // .NET / C#
    const hasCsproj = entries.some(e => e.endsWith(".csproj") || e.endsWith(".sln"));
    if (hasCsproj) techs.push("C#/.NET");

    // Node.js ecosystem
    if (names.has("package.json")) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (names.has("tsconfig.json") || deps?.typescript) techs.push("TypeScript");
        else techs.push("JavaScript");
        if (deps?.next) techs.push("Next.js");
        else if (deps?.nuxt) techs.push("Nuxt");
        else if (deps?.react) techs.push("React");
        else if (deps?.vue) techs.push("Vue");
        else if (deps?.svelte) techs.push("Svelte");
        if (deps?.express) techs.push("Express");
        else if (deps?.fastify) techs.push("Fastify");
        techs.push("Node.js");
      } catch { /* ignore */ }
    }

    if (names.has("requirements.txt") || names.has("pyproject.toml")) techs.push("Python");
    if (names.has("cargo.toml")) techs.push("Rust");
    if (names.has("go.mod")) techs.push("Go");
    if (names.has("pom.xml") || names.has("build.gradle")) techs.push("Java");

  } catch { /* ignore */ }
  return techs.length > 0 ? techs.join(", ") : "Unknown";
}

async function scanProject(
  repoName: string,
  repoRoot: string,
  maxDepth: number,
): Promise<ProjectScan> {
  const files: ScannedFile[] = [];
  const uiFiles: ScannedFile[] = [];
  const manifestContent: Record<string, string> = {};
  const topLevelDirs: string[] = [];
  const technology = await detectTechnology(repoRoot);

  // Collect top-level directories
  try {
    const topEntries = await fs.readdir(repoRoot, { withFileTypes: true });
    for (const e of topEntries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
        topLevelDirs.push(e.name);
      }
    }
  } catch { /* ignore */ }

  // Read key manifest files
  for (const manifestName of MANIFEST_FILES) {
    if (manifestName.startsWith("*")) continue; // glob patterns handled below
    try {
      const content = await fs.readFile(path.join(repoRoot, manifestName), "utf-8");
      manifestContent[manifestName] = content.slice(0, 4096); // cap size
    } catch { /* doesn't exist */ }
  }

  // Handle *.csproj / *.sln / *.fsproj
  try {
    const rootEntries = await fs.readdir(repoRoot);
    for (const entry of rootEntries) {
      if (/\.(csproj|sln|fsproj)$/i.test(entry)) {
        try {
          const content = await fs.readFile(path.join(repoRoot, entry), "utf-8");
          manifestContent[entry] = content.slice(0, 4096);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // Recursive file scan
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          const abs = path.join(dir, entry.name);
          const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
          let size = 0;
          try { size = (await fs.stat(abs)).size; } catch { /* ignore */ }

          const scanned: ScannedFile = {
            abs,
            rel,
            name: entry.name,
            ext,
            dirParts: path.dirname(rel).split("/").filter(Boolean),
            size,
          };

          files.push(scanned);

          // Check if it's a UI file
          if (UI_FILE_PATTERNS.some(p => p.test(rel))) {
            uiFiles.push(scanned);
          }
        }
      }
    }
  }

  await walk(repoRoot, 0);

  return { repoName, repoRoot, technology, files, manifestContent, uiFiles, topLevelDirs };
}

// ---------------------------------------------------------------------------
// File tree summary for LLM prompt
// ---------------------------------------------------------------------------

function buildTreeSummary(scan: ProjectScan): string {
  // Group files by top-level directory
  const dirCounts = new Map<string, number>();
  for (const f of scan.files) {
    const topDir = f.dirParts[0] ?? "(root)";
    dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
  }

  const lines: string[] = [
    `Project: ${scan.repoName}`,
    `Technology: ${scan.technology}`,
    `Total source files: ${scan.files.length}`,
    `Top-level directories: ${scan.topLevelDirs.join(", ")}`,
    "",
    "Directory file counts:",
  ];

  for (const [dir, count] of [...dirCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${dir}/  — ${count} files`);
  }

  return lines.join("\n");
}

function buildFileListing(files: ScannedFile[], maxFiles: number): string {
  // Take a representative sample: sort by directory depth and take the most interesting
  const sorted = [...files].sort((a, b) => {
    // Prefer files in diverse directories
    const depthDiff = a.dirParts.length - b.dirParts.length;
    if (depthDiff !== 0) return depthDiff;
    return a.rel.localeCompare(b.rel);
  });

  const sample = sorted.slice(0, maxFiles);
  return sample.map(f => f.rel).join("\n");
}

// ---------------------------------------------------------------------------
// Read key files for LLM context
// ---------------------------------------------------------------------------

async function readKeyFiles(scan: ProjectScan, maxFiles: number): Promise<string> {
  // Prioritize: manifests, main entry points, README, then top-level files
  const keyPatterns = [
    /readme/i, /^src\/(index|main|app)\./i,
    /^(index|main|app)\./i, /^src\/.*\/index\./i,
    /program\.cs$/i, /startup\.cs$/i, /app\.xaml/i,
  ];

  const prioritized: ScannedFile[] = [];
  const rest: ScannedFile[] = [];

  for (const f of scan.files) {
    if (keyPatterns.some(p => p.test(f.rel))) {
      prioritized.push(f);
    } else {
      rest.push(f);
    }
  }

  // Take prioritized files + fill up with representative files from different directories
  const selectedDirs = new Set<string>();
  const selected: ScannedFile[] = [...prioritized.slice(0, Math.ceil(maxFiles / 2))];

  for (const f of rest) {
    if (selected.length >= maxFiles) break;
    const topDir = f.dirParts[0] ?? "(root)";
    if (!selectedDirs.has(topDir)) {
      selected.push(f);
      selectedDirs.add(topDir);
    }
  }

  const fragments: string[] = [];
  for (const f of selected) {
    try {
      const fd = await fs.open(f.abs, "r");
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      const { bytesRead } = await fd.read(buf, 0, MAX_FILE_BYTES, 0);
      await fd.close();
      const content = buf.toString("utf-8", 0, bytesRead);
      fragments.push(`--- ${f.rel} ---\n${content}\n`);
    } catch { /* skip unreadable files */ }
  }

  return fragments.join("\n");
}

// ---------------------------------------------------------------------------
// LLM enrichment prompts
// ---------------------------------------------------------------------------

function buildEnrichmentPrompt(
  treeSummary: string,
  fileListing: string,
  keyFileContents: string,
  manifestSummary: string,
  target: "features" | "workflows" | "data_model",
  repoName: string,
): LlmMessage[] {
  const targetInstructions: Record<string, string> = {
    features: `Identify ALL major features and modules in this project.
Each feature should have:
- id: snake_case unique identifier
- name: Human-readable feature name
- description: 2-3 sentences explaining what it does, its purpose, and key behaviors
- source_repo: "${repoName}" 
- source_files: array of key source file paths (relative to repo root)
- status: "active"
- category: logical category (e.g., "core", "ui", "plugin", "cli", "infrastructure")
- tags: array of relevant tags
- domain: domain grouping (e.g., "ui", "plugin-system", "data-processing", "infrastructure", "cli")
- keywords: array of keywords that describe this feature

Be thorough. Include individual tools/components (not just top-level modules).
For a UI app include each major screen/tool as its own feature.
For a plugin system include the plugin API, loader, registry as separate features.
Aim for at least 20-40 features for a medium-to-large project.`,

    workflows: `Identify ALL key processes and workflows in this project.
Each workflow should have:
- id: snake_case unique identifier
- name: Human-readable workflow name (usually ends with "Flow" or "Process")
- description: 2-3 sentences explaining the process
- trigger: What initiates this workflow
- source_repo: "${repoName}"
- source_files: array of source file paths involved
- domain: domain grouping
- keywords: array of keywords
- status: "active"
- steps: array of { order: number, name: string, description: string }

Include: startup/initialization, data loading, user interactions, build/deploy, 
plugin discovery, settings persistence, navigation, error handling flows.
Aim for 10-20 workflows.`,

    data_model: `Identify ALL core data structures and models in this project.
Each entity should have:
- id: snake_case unique identifier
- name: Human-readable entity name
- description: 2-3 sentences explaining what data it holds and how it's used
- table_name: identifier (can match id)
- storage: storage mechanism (e.g., "json", "sqlite", "memory", "file-system", "registry")
- source_repo: "${repoName}"
- source_files: array of source file paths where this is defined
- domain: domain grouping
- keywords: array of keywords
- status: "active"
- key_fields: array of { name: string, type: string, description: string }
- relationships: array of { type: string, target: string, via: string }

Include: configuration objects, plugin manifests, settings schemas, 
data transfer objects, API contracts, state models.
Aim for 10-25 data model entities.`,
  };

  return [
    {
      role: "system" as const,
      content:
        `You are a software architecture analyst. Analyze the given project and extract structured data.\n` +
        `Respond with a JSON array of objects. No markdown, no explanation.\n` +
        `If you must wrap it in an object, use a key matching the target type (e.g. {"features": [...]}).\n` +
        `${targetInstructions[target]}`,
    },
    {
      role: "user" as const,
      content:
        `## Project Structure\n${treeSummary}\n\n` +
        `## File Listing\n${fileListing}\n\n` +
        `## Manifest Files\n${manifestSummary}\n\n` +
        `## Key Source Files\n${keyFileContents}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Seed data persistence (reused from enrich-seed-data patterns)
// ---------------------------------------------------------------------------

function stripTemplateStubs<T>(arr: T[]): T[] {
  return arr.filter((e) => {
    const obj = e as Record<string, unknown>;
    return !("_schema" in obj) && !("_fields" in obj) && !("_note" in obj);
  });
}

function mergeById<T>(existing: T[], incoming: T[]): { merged: T[]; inserted: number; updated: number } {
  const map = new Map<string, T>();
  for (const e of existing) map.set((e as Record<string, unknown>).id as string, e);
  let inserted = 0;
  let updated = 0;
  for (const entry of incoming) {
    const id = (entry as Record<string, unknown>).id as string;
    if (map.has(id)) updated++;
    else inserted++;
    map.set(id, entry);
  }
  return { merged: [...map.values()], inserted, updated };
}

async function rebuildIndex(): Promise<number> {
  const features = await loadJsonArray<Feature>("features.json");
  const workflows = await loadJsonArray<Workflow>("workflows.json");
  const dataModel = await loadJsonArray<DataModelEntity>("data_model.json");

  const entities: Record<string, IndexEntry> = {};
  for (const f of stripTemplateStubs(features)) {
    entities[f.id] = { type: "feature", uri: `dreamgraph://resource/feature/${f.id}`, name: f.name, source_repo: f.source_repo };
  }
  for (const w of stripTemplateStubs(workflows)) {
    entities[w.id] = { type: "workflow", uri: `dreamgraph://resource/workflow/${w.id}`, name: w.name, source_repo: w.source_repo };
  }
  for (const d of stripTemplateStubs(dataModel)) {
    entities[d.id] = { type: "data_model", uri: `dreamgraph://resource/data_model/${d.id}`, name: d.name, source_repo: d.source_repo };
  }

  const index: ResourceIndex = { entities };
  await fs.writeFile(dataPath("index.json"), JSON.stringify(index, null, 2), "utf-8");
  invalidateCache("index.json");
  return Object.keys(entities).length;
}

async function writeSeed(filename: string, data: unknown): Promise<void> {
  await fs.writeFile(dataPath(filename), JSON.stringify(data, null, 2), "utf-8");
  invalidateCache(filename);
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

function extractJsonArray(text: string): unknown[] {
  // Strip markdown code fences if present (```json ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;

    // OpenAI json_object mode wraps arrays in an object like { "features": [...] }
    // Walk every top-level value and return the first array we find.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const val of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(val) && val.length > 0) return val;
      }
    }
    return [];
  } catch { /* try extraction */ }

  // Extract the largest JSON array from mixed text (greedy outer brackets)
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // The greedy match may have grabbed too much — try the first balanced array
      try {
        const start = cleaned.indexOf("[");
        if (start !== -1) {
          let depth = 0;
          for (let i = start; i < cleaned.length; i++) {
            if (cleaned[i] === "[") depth++;
            else if (cleaned[i] === "]") depth--;
            if (depth === 0) {
              const candidate = cleaned.slice(start, i + 1);
              const arr = JSON.parse(candidate);
              if (Array.isArray(arr)) return arr;
              break;
            }
          }
        }
      } catch { /* give up */ }
    }
  }

  return [];
}

function ensureStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter(v => typeof v === "string");
  return [];
}

function sanitizeEntry(raw: Record<string, unknown>, repoName: string): Record<string, unknown> {
  // Ensure required fields exist and have sane values
  if (!raw.id || typeof raw.id !== "string") return raw;
  if (!raw.name || typeof raw.name !== "string") raw.name = String(raw.id).replace(/_/g, " ");
  if (!raw.description) raw.description = "";
  if (!raw.source_repo) raw.source_repo = repoName;
  if (!raw.status) raw.status = "active";
  if (!raw.domain) raw.domain = "core";
  raw.tags = ensureStringArray(raw.tags);
  raw.keywords = ensureStringArray(raw.keywords);
  raw.source_files = ensureStringArray(raw.source_files);
  if (!raw.links) raw.links = [];
  return raw;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface ScanProjectResult {
  repos_scanned: number;
  files_discovered: number;
  ui_files_detected: number;
  technology: string;
  llm_used: boolean;
  features: { inserted: number; updated: number; total: number };
  workflows: { inserted: number; updated: number; total: number };
  data_model: { inserted: number; updated: number; total: number };
  index_entries: number;
  llm_tokens_used: number;
  errors: string[];
  message: string;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerScanProjectTool(server: McpServer): void {
  server.tool(
    "scan_project",
    "Scan the project and populate the knowledge graph with features, workflows, and data model entities. " +
    "This is a convenience tool that automates the manual enrichment workflow: " +
    "it reads the project structure, uses the LLM to extract rich semantic data, " +
    "and populates all seed data files in merge mode (non-destructive). " +
    "Use this for quick initial enrichment — you can always refine with " +
    "enrich_seed_data and register_ui_element afterward. " +
    "Falls back to structural-only analysis if no LLM is configured.",
    {
      depth: z
        .enum(["shallow", "deep"])
        .default("deep")
        .describe(
          "shallow: scan top 3 directory levels only (faster, may miss nested modules). " +
          "deep: scan up to 10 levels (thorough, recommended for first scan).",
        ),
      targets: z
        .array(z.string())
        .optional()
        .describe(
          "Which seed data targets to populate. Default: all three. " +
          "Each must be one of: features, workflows, data_model. " +
          "Use to selectively re-scan only features, workflows, or data_model.",
        ),
      repos: z
        .array(z.string())
        .optional()
        .describe(
          "Specific repo names to scan. Default: all configured repos.",
        ),
    },
    async ({ depth, targets, repos }, extra) => {
      const VALID_TARGETS = ["features", "workflows", "data_model"];
      const targetList = targets ?? [...VALID_TARGETS];

      // ---- Progress helper ----
      // Sends MCP progress notifications AND logging messages so the client
      // can display live status.  The logging message acts as a reliable
      // fallback because progress tokens may not always be routed.
      let _step = 0;
      const _totalSteps = 2 + targetList.length + 1; // scan + (per-target LLM) + index
      async function progress(message: string): Promise<void> {
        _step++;
        logger.info(`scan_project: ${message}`);
        // Try progress notification (token-routed)
        try {
          await extra.sendNotification({
            method: "notifications/progress" as const,
            params: {
              progressToken: (extra._meta as Record<string, unknown>)?.progressToken as string | number ?? "scan",
              progress: _step,
              total: _totalSteps,
              message,
            },
          });
        } catch { /* client may not support progress — ignore */ }
        // Also send a logging message (always delivered)
        try {
          await extra.sendNotification({
            method: "notifications/message" as const,
            params: {
              level: "info",
              logger: "scan_project",
              data: `[${_step}/${_totalSteps}] ${message}`,
            },
          });
        } catch { /* best effort */ }
      }

      // Validate targets
      const invalidTargets = targetList.filter(t => !VALID_TARGETS.includes(t));
      if (invalidTargets.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `Invalid target(s): ${invalidTargets.join(", ")}. Must be one of: ${VALID_TARGETS.join(", ")}`,
            }),
          }],
        };
      }

      logger.info(`scan_project: starting (depth=${depth}, targets=${targetList.join(",")}, repos=${repos?.join(",") ?? "all"})`);

      const result = await safeExecute<ScanProjectResult>(async (): Promise<ToolResponse<ScanProjectResult>> => {
        // Validate repos
        const availableRepos = Object.keys(config.repos);
        if (availableRepos.length === 0) {
          return error("NO_REPOS", "No repositories configured. Set project root or DREAMGRAPH_REPOS.");
        }
        const targetRepos = repos ?? availableRepos;
        const unknown = targetRepos.filter(r => !config.repos[r]);
        if (unknown.length > 0) {
          return error("UNKNOWN_REPOS", `Unknown repos: ${unknown.join(", ")}. Available: ${availableRepos.join(", ")}`);
        }

        const maxDepth = depth === "shallow" ? 3 : 10;
        const errors: string[] = [];
        let totalTokens = 0;

        // Phase 1: Mechanical scan
        await progress("Phase 1 — scanning file system…");
        const scans: ProjectScan[] = [];
        for (const repoName of targetRepos) {
          const repoRoot = path.resolve(config.repos[repoName]);
          const scan = await scanProject(repoName, repoRoot, maxDepth);
          scans.push(scan);
          logger.info(
            `scan_project: ${repoName} — ${scan.files.length} files, ${scan.uiFiles.length} UI files, ` +
            `tech: ${scan.technology}, dirs: ${scan.topLevelDirs.join(", ")}`,
          );
          await progress(`Scanned ${repoName}: ${scan.files.length} files, tech: ${scan.technology}`);
        }

        const totalFiles = scans.reduce((s, sc) => s + sc.files.length, 0);
        const totalUiFiles = scans.reduce((s, sc) => s + sc.uiFiles.length, 0);
        const techSummary = scans.map(s => s.technology).join("; ");

        // Phase 2: LLM enrichment (or structural fallback)
        const llmAvailable = await isLlmAvailable();
        const dreamerConfig = getDreamerLlmConfig();

        const featureResult = { inserted: 0, updated: 0, total: 0 };
        const workflowResult = { inserted: 0, updated: 0, total: 0 };
        const dataModelResult = { inserted: 0, updated: 0, total: 0 };

        if (llmAvailable) {
          logger.info(`scan_project: Phase 2 — LLM enrichment (model: ${dreamerConfig.model})`);
          await progress(`Phase 2 — LLM enrichment (model: ${dreamerConfig.model})…`);
          const llm = getLlmProvider();

          for (const scan of scans) {
            const treeSummary = buildTreeSummary(scan);
            const fileListing = buildFileListing(scan.files, LLM_BATCH_SIZE * 2);
            const keyFileContents = await readKeyFiles(scan, 15);
            const manifestSummary = Object.entries(scan.manifestContent)
              .map(([name, content]) => `--- ${name} ---\n${content}`)
              .join("\n\n");

            for (const target of targetList) {
              try {
                const messages = buildEnrichmentPrompt(
                  treeSummary, fileListing, keyFileContents, manifestSummary, target as "features" | "workflows" | "data_model", scan.repoName,
                );

                logger.info(`scan_project: LLM call for ${target} (${scan.repoName})`);
                await progress(`LLM extracting ${target} from ${scan.repoName}…`);
                const response = await llm.complete(messages, {
                  model: dreamerConfig.model,
                  temperature: 0.3, // Low temp for factual extraction
                  maxTokens: dreamerConfig.maxTokens,
                  jsonMode: true,
                });

                totalTokens += response.tokensUsed ?? 0;

                const rawEntries = extractJsonArray(response.text);
                if (rawEntries.length === 0) {
                  const preview = response.text.slice(0, 500).replace(/\n/g, "\\n");
                  errors.push(`LLM returned no parseable ${target} entries for ${scan.repoName}`);
                  logger.warn(`scan_project: LLM returned no entries for ${target} (${scan.repoName}). Response preview: ${preview}`);
                  continue;
                }

                // Sanitize entries
                const sanitized = rawEntries
                  .filter(e => typeof e === "object" && e !== null)
                  .map(e => sanitizeEntry(e as Record<string, unknown>, scan.repoName))
                  .filter(e => e.id && typeof e.id === "string");

                logger.info(`scan_project: LLM produced ${sanitized.length} ${target} entries (${rawEntries.length} raw)`);

                // Merge into existing seed data
                const filename = target === "features" ? "features.json"
                  : target === "workflows" ? "workflows.json"
                  : "data_model.json";

                const existing = stripTemplateStubs(await loadJsonArray<Record<string, unknown>>(filename));
                const merged = mergeById(existing, sanitized);

                await writeSeed(filename, merged.merged);
                logger.info(`scan_project: ${target} — ${merged.inserted} inserted, ${merged.updated} updated, ${merged.merged.length} total`);
                await progress(`${target}: ${merged.inserted} new, ${merged.updated} updated, ${merged.merged.length} total`);

                const resultRef = target === "features" ? featureResult
                  : target === "workflows" ? workflowResult
                  : dataModelResult;

                resultRef.inserted += merged.inserted;
                resultRef.updated += merged.updated;
                resultRef.total = merged.merged.length;

              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`LLM enrichment failed for ${target} (${scan.repoName}): ${msg}`);
                logger.warn(`scan_project: LLM error for ${target}: ${msg}`);
              }
            }
          }
        } else {
          logger.info("scan_project: Phase 2 — LLM unavailable, structural-only mode");
          await progress("Phase 2 — LLM unavailable, using structural analysis…");
          errors.push("LLM not available — generated structural entries only. Consider running enrich_seed_data manually for richer data.");

          // Fallback: generate basic entries from directory structure
          for (const scan of scans) {
            if (targetList.includes("features")) {
              const featureEntries = generateStructuralFeatures(scan);
              const existing = stripTemplateStubs(await loadJsonArray<Record<string, unknown>>("features.json"));
              const merged = mergeById(existing, featureEntries);
              await writeSeed("features.json", merged.merged);
              featureResult.inserted += merged.inserted;
              featureResult.updated += merged.updated;
              featureResult.total = merged.merged.length;
            }

            if (targetList.includes("workflows")) {
              const workflowEntries = generateStructuralWorkflows(scan);
              const existing = stripTemplateStubs(await loadJsonArray<Record<string, unknown>>("workflows.json"));
              const merged = mergeById(existing, workflowEntries);
              await writeSeed("workflows.json", merged.merged);
              workflowResult.inserted += merged.inserted;
              workflowResult.updated += merged.updated;
              workflowResult.total = merged.merged.length;
            }

            if (targetList.includes("data_model")) {
              const dmEntries = generateStructuralDataModel(scan);
              const existing = stripTemplateStubs(await loadJsonArray<Record<string, unknown>>("data_model.json"));
              const merged = mergeById(existing, dmEntries);
              await writeSeed("data_model.json", merged.merged);
              dataModelResult.inserted += merged.inserted;
              dataModelResult.updated += merged.updated;
              dataModelResult.total = merged.merged.length;
            }
          }
        }

        // Rebuild resource index
        await progress("Rebuilding resource index…");
        const indexEntries = await rebuildIndex();
        logger.info(`scan_project: index rebuilt with ${indexEntries} entries`);

        const summary =
          `Scan complete: ${scans.length} repo(s), ${totalFiles} files. ` +
          `${llmAvailable ? `LLM enrichment (${dreamerConfig.model}, ${totalTokens} tokens)` : "Structural-only (no LLM)"}. ` +
          `Features: ${featureResult.inserted} new / ${featureResult.total} total. ` +
          `Workflows: ${workflowResult.inserted} new / ${workflowResult.total} total. ` +
          `Data model: ${dataModelResult.inserted} new / ${dataModelResult.total} total. ` +
          `Index: ${indexEntries} entries.` +
          (errors.length > 0 ? ` ${errors.length} warning(s).` : "");

        logger.info(`scan_project: ${summary}`);

        return success<ScanProjectResult>({
          repos_scanned: scans.length,
          files_discovered: totalFiles,
          ui_files_detected: totalUiFiles,
          technology: techSummary,
          llm_used: llmAvailable,
          features: featureResult,
          workflows: workflowResult,
          data_model: dataModelResult,
          index_entries: indexEntries,
          llm_tokens_used: totalTokens,
          errors,
          message: summary,
        });
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Structural fallback generators (no LLM)
// ---------------------------------------------------------------------------

function toSnakeCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function inferDomain(dirParts: string[]): string {
  const hints: Record<string, string> = {
    auth: "authentication", login: "authentication",
    api: "api", server: "api", routes: "api", controller: "api",
    ui: "ui", component: "ui", view: "ui", page: "ui",
    model: "data", schema: "data", database: "data", migration: "data",
    util: "infrastructure", config: "infrastructure", lib: "infrastructure",
    tool: "tooling", tools: "tooling",
    plugin: "plugin-system", extension: "plugin-system",
    cli: "cli", command: "cli",
    test: "testing", spec: "testing",
  };
  for (const part of dirParts) {
    const lower = part.toLowerCase();
    for (const [hint, domain] of Object.entries(hints)) {
      if (lower.includes(hint)) return domain;
    }
  }
  return "core";
}

function generateStructuralFeatures(scan: ProjectScan): Record<string, unknown>[] {
  // Group files by top-level + second-level directory
  const groups = new Map<string, ScannedFile[]>();
  for (const f of scan.files) {
    const key = f.dirParts.slice(0, 2).join("/") || f.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const entries: Record<string, unknown>[] = [];
  for (const [groupPath, files] of groups) {
    const id = toSnakeCase(`${scan.repoName}_${groupPath}`);
    const name = toTitleCase(groupPath.split("/").pop() ?? groupPath);
    entries.push({
      id,
      name,
      description: `${name} — ${files.length} source file(s) in ${groupPath}/`,
      source_repo: scan.repoName,
      source_files: files.slice(0, 10).map(f => f.rel),
      status: "active",
      category: inferDomain(files[0]?.dirParts ?? []),
      tags: [scan.technology.split(",")[0]?.trim().toLowerCase() ?? "unknown"],
      domain: inferDomain(files[0]?.dirParts ?? []),
      keywords: [...new Set(files.slice(0, 5).map(f => path.basename(f.name, f.ext).toLowerCase()))],
      links: [],
    });
  }
  return entries;
}

function generateStructuralWorkflows(scan: ProjectScan): Record<string, unknown>[] {
  // Basic workflow detection from directory patterns
  const workflowPatterns = [/route/i, /handler/i, /middleware/i, /hook/i, /pipeline/i, /flow/i, /controller/i, /command/i];
  const entries: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const f of scan.files) {
    const dir = f.dirParts.join("/");
    if (seen.has(dir)) continue;
    if (workflowPatterns.some(p => p.test(dir) || p.test(f.name))) {
      seen.add(dir);
      const id = toSnakeCase(`${scan.repoName}_${dir}_flow`);
      entries.push({
        id,
        name: `${toTitleCase(f.dirParts[f.dirParts.length - 1] ?? f.name)} Flow`,
        description: `Workflow detected in ${dir}/`,
        trigger: `Source: ${f.rel}`,
        source_repo: scan.repoName,
        source_files: scan.files.filter(sf => sf.dirParts.join("/") === dir).slice(0, 10).map(sf => sf.rel),
        domain: inferDomain(f.dirParts),
        keywords: f.dirParts.map(d => d.toLowerCase()),
        status: "active",
        steps: [],
        links: [],
      });
    }
  }
  return entries;
}

function generateStructuralDataModel(scan: ProjectScan): Record<string, unknown>[] {
  const modelPatterns = [/model/i, /schema/i, /entity/i, /types?$/i, /interface/i, /contract/i, /dto/i];
  const entries: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const f of scan.files) {
    const dir = f.dirParts.join("/");
    const nameNoExt = path.basename(f.name, f.ext);
    if (seen.has(dir + nameNoExt)) continue;
    if (modelPatterns.some(p => p.test(dir) || p.test(nameNoExt))) {
      seen.add(dir + nameNoExt);
      const id = toSnakeCase(`${scan.repoName}_${dir}_${nameNoExt}`);
      entries.push({
        id,
        name: toTitleCase(nameNoExt),
        description: `Data model detected at ${f.rel}`,
        table_name: id,
        storage: "unknown",
        source_repo: scan.repoName,
        source_files: [f.rel],
        domain: inferDomain(f.dirParts),
        keywords: [nameNoExt.toLowerCase(), ...f.dirParts.map(d => d.toLowerCase())],
        status: "active",
        key_fields: [],
        relationships: [],
        links: [],
      });
    }
  }
  return entries;
}
