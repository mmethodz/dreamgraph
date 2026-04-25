/**
 * DreamGraph — Heuristic structural-fallback generators.
 *
 * Used by `scan_project` when the LLM is unavailable (or as a baseline
 * before LLM enrichment). Each generator inspects a `ProjectScan` and
 * produces a list of plain entity records.
 *
 * No I/O — pure transformation of the scan result.
 */

import path from "node:path";
import type { ProjectScan, ScannedFile } from "./scan-types.js";

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function toSnakeCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

export function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function inferDomain(dirParts: string[]): string {
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

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export function generateStructuralFeatures(scan: ProjectScan): Record<string, unknown>[] {
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
      source_files: files.slice(0, 10).map((f) => f.rel),
      status: "active",
      category: inferDomain(files[0]?.dirParts ?? []),
      tags: [scan.technology.split(",")[0]?.trim().toLowerCase() ?? "unknown"],
      domain: inferDomain(files[0]?.dirParts ?? []),
      keywords: [
        ...new Set(
          files.slice(0, 5).map((f) => path.basename(f.name, f.ext).toLowerCase()),
        ),
      ],
      links: [],
    });
  }
  return entries;
}

export function generateStructuralWorkflows(scan: ProjectScan): Record<string, unknown>[] {
  const workflowPatterns = [
    /route/i, /handler/i, /middleware/i, /hook/i, /pipeline/i, /flow/i,
    /controller/i, /command/i,
  ];
  const entries: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const f of scan.files) {
    const dir = f.dirParts.join("/");
    if (seen.has(dir)) continue;
    if (workflowPatterns.some((p) => p.test(dir) || p.test(f.name))) {
      seen.add(dir);
      const id = toSnakeCase(`${scan.repoName}_${dir}_flow`);
      entries.push({
        id,
        name: `${toTitleCase(f.dirParts[f.dirParts.length - 1] ?? f.name)} Flow`,
        description: `Workflow detected in ${dir}/`,
        trigger: `Source: ${f.rel}`,
        source_repo: scan.repoName,
        source_files: scan.files
          .filter((sf) => sf.dirParts.join("/") === dir)
          .slice(0, 10)
          .map((sf) => sf.rel),
        domain: inferDomain(f.dirParts),
        keywords: f.dirParts.map((d) => d.toLowerCase()),
        status: "active",
        steps: [],
        links: [],
      });
    }
  }
  return entries;
}

export function generateStructuralDataModel(scan: ProjectScan): Record<string, unknown>[] {
  const modelPatterns = [
    /model/i, /schema/i, /entity/i, /types?$/i, /interface/i, /contract/i, /dto/i,
  ];
  const entries: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const f of scan.files) {
    const dir = f.dirParts.join("/");
    const nameNoExt = path.basename(f.name, f.ext);
    if (seen.has(dir + nameNoExt)) continue;
    if (modelPatterns.some((p) => p.test(dir) || p.test(nameNoExt))) {
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
        keywords: [nameNoExt.toLowerCase(), ...f.dirParts.map((d) => d.toLowerCase())],
        status: "active",
        key_fields: [],
        relationships: [],
        links: [],
      });
    }
  }
  return entries;
}
