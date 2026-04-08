/**
 * DreamGraph — Shared Senses Utilities
 *
 * Lightweight, programmatically callable versions of the senses tools
 * (code-senses, git-senses) for use by internal cognitive modules
 * (dreamer, normalizer, etc.).
 *
 * Security: All paths are resolved against config.repos roots.
 * These helpers mirror the safety checks in code-senses.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/config.js";
import { logger } from "./logger.js";
import { loadJsonData } from "./cache.js";
import type { ApiSurface, ApiModule, ApiClass } from "../types/index.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Path safety — mirrors code-senses.ts resolveSafePath
// ---------------------------------------------------------------------------

function getAllowedRoots(): string[] {
  return Object.values(config.repos).map((p) =>
    path.resolve(p).toLowerCase()
  );
}

function resolveSafePath(requestedPath: string): string {
  const roots = getAllowedRoots();

  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : null;

  for (const root of roots) {
    const abs = candidate ?? path.resolve(
      Object.values(config.repos).find(
        (r) => r.toLowerCase() === root
      )!,
      requestedPath
    );
    if (abs.toLowerCase().startsWith(root)) {
      return abs;
    }
  }

  if (!candidate) {
    for (const repoPath of Object.values(config.repos)) {
      const abs = path.resolve(repoPath, requestedPath);
      if (abs.toLowerCase().startsWith(repoPath.toLowerCase())) {
        return abs;
      }
    }
  }

  throw new Error(
    `Access denied: Path '${requestedPath}' is outside all configured workspaces.`
  );
}

// ---------------------------------------------------------------------------
// Source code reading
// ---------------------------------------------------------------------------

/**
 * Read source code from a file within a configured repo.
 * Returns the first `maxLines` lines, or null if file can't be read.
 */
export async function readSourceFile(
  filePath: string,
  maxLines: number = 60,
): Promise<string | null> {
  try {
    const resolved = resolveSafePath(filePath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 500_000) return null; // skip huge files

    const content = await fs.readFile(resolved, "utf-8");
    const lines = content.split("\n").slice(0, maxLines);
    return lines.join("\n");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * List a directory within a configured repo.
 * Returns entries or null if the directory can't be read.
 */
export async function listDirectory(
  dirPath: string,
): Promise<DirEntry[] | null> {
  try {
    const resolved = resolveSafePath(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Git log (recent changes)
// ---------------------------------------------------------------------------

export interface GitCommitSummary {
  hash: string;
  date: string;
  message: string;
}

/**
 * Get recent git commits for a file or directory within a repo.
 * Returns up to `maxCount` commits, or null on error.
 */
export async function gitRecentChanges(
  filePath: string,
  maxCount: number = 5,
): Promise<GitCommitSummary[] | null> {
  try {
    const resolved = resolveSafePath(filePath);
    // Find the repo root for this file
    const repoRoot = Object.values(config.repos).find((r) =>
      resolved.toLowerCase().startsWith(path.resolve(r).toLowerCase())
    );
    if (!repoRoot) return null;

    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--max-count=${maxCount}`,
        "--format=%H|%aI|%s",
        "--",
        resolved,
      ],
      { cwd: repoRoot, timeout: 5000, windowsHide: true },
    );

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split("|");
        return { hash, date, message: rest.join("|") };
      });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch grounding — read source for multiple entities
// ---------------------------------------------------------------------------

export interface GroundingResult {
  entityId: string;
  file: string;
  snippet: string;
  recentChanges?: GitCommitSummary[];
}

/**
 * Given a list of entities with their source files, read snippets from
 * the most important files. Returns grounding data for the LLM prompt.
 *
 * Budget: reads at most `maxFiles` files total to keep latency bounded.
 *
 * When API surface data is available (ops://api-surface), structured
 * class/function summaries are appended to snippets for richer grounding.
 */
export async function groundEntities(
  entities: Array<{ id: string; sourceFiles: string[] }>,
  maxFiles: number = 8,
  maxLinesPerFile: number = 40,
): Promise<GroundingResult[]> {
  const results: GroundingResult[] = [];
  let filesRead = 0;

  // Preload API surface data (best-effort)
  const surfaceModules = await loadApiSurfaceModules();

  for (const entity of entities) {
    if (filesRead >= maxFiles) break;

    // Read the first available source file for this entity
    for (const file of entity.sourceFiles.slice(0, 2)) {
      if (filesRead >= maxFiles) break;

      const snippet = await readSourceFile(file, maxLinesPerFile);
      if (snippet) {
        const changes = await gitRecentChanges(file, 3);

        // Enrich with API surface summary if available
        const apiSummary = summarizeApiForFile(surfaceModules, file);
        const enrichedSnippet = apiSummary
          ? `${snippet}\n\n/* === API Surface (extracted) ===\n${apiSummary}\n*/`
          : snippet;

        results.push({
          entityId: entity.id,
          file,
          snippet: enrichedSnippet,
          recentChanges: changes ?? undefined,
        });
        filesRead++;
        break; // one file per entity is enough
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// API surface grounding helpers
// ---------------------------------------------------------------------------

/**
 * Load all API surface modules from data/api_surface.json.
 * Returns empty array if the file doesn't exist or is unparseable.
 */
async function loadApiSurfaceModules(): Promise<ApiModule[]> {
  try {
    const surface = await loadJsonData<ApiSurface>("api_surface.json");
    return surface?.modules ?? [];
  } catch {
    return [];
  }
}

/**
 * Build a compact structured summary for a given file path from API surface data.
 * Returns null if no data exists for the file.
 *
 * Example output:
 *   class UIStack extends Widget: horizontal(), with_children(children), vertical()
 *   function buildLayout(root: Widget): LayoutResult
 */
function summarizeApiForFile(modules: ApiModule[], filePath: string): string | null {
  if (modules.length === 0) return null;

  // Normalize the file path for matching (strip leading ./ and normalize separators)
  const normPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");

  const mod = modules.find(m => {
    const modNorm = m.file_path.replace(/\\/g, "/").replace(/^\.\//, "");
    return modNorm === normPath || normPath.endsWith(modNorm) || modNorm.endsWith(normPath);
  });

  if (!mod) return null;

  const lines: string[] = [];

  for (const cls of mod.classes) {
    const bases = cls.bases.length > 0 ? ` extends ${cls.bases.join(", ")}` : "";
    const methods = cls.methods
      .filter(m => m.visibility === "public")
      .map(m => m.signature_text ?? m.name)
      .slice(0, 10); // cap at 10 methods for brevity
    const propNames = cls.properties
      .slice(0, 5)
      .map(p => p.name + (p.type ? `: ${p.type}` : ""));

    let line = `class ${cls.name}${bases}`;
    if (methods.length > 0) line += `: ${methods.join(", ")}`;
    if (propNames.length > 0) line += ` | props: ${propNames.join(", ")}`;
    lines.push(line);
  }

  for (const fn of mod.functions) {
    if (fn.is_exported) {
      lines.push(fn.signature_text ?? `function ${fn.name}()`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
