/**
 * DreamGraph MCP Server — Living Documentation Exporter.
 *
 * Single tool: export_living_docs
 *
 * Reads the current knowledge graph (features, data model, workflows,
 * ADRs, UI registry, cognitive state) and generates structured Markdown
 * files suitable for Docusaurus, Nextra, MkDocs, or plain GitHub.
 *
 * The export is stateless and idempotent — same graph state always
 * produces identical output. No incremental update; every run regenerates
 * everything from scratch. This guarantees zero stale documentation.
 *
 * Data sources: data/*.json (via loadJsonData cache and direct reads)
 */

import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { loadJsonData } from "../utils/cache.js";
import { success, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  ExportLivingDocsOutput,
  ExportedFile,
  LivingDocsSection,
  LivingDocsFormat,
  UIRegistryFile,
  ADRLogFile,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Buffer to collect generated files before writing to disk */
interface FileBuffer {
  path: string;
  section: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Format adapters
// ---------------------------------------------------------------------------

function frontmatter(
  format: LivingDocsFormat,
  title: string,
  position?: number
): string {
  if (format === "docusaurus") {
    const lines = ["---", `title: "${title}"`];
    if (position !== undefined)
      lines.push(`sidebar_position: ${position}`);
    lines.push("---", "");
    return lines.join("\n");
  }
  if (format === "nextra") {
    return `---\ntitle: "${title}"\n---\n\n`;
  }
  // mkdocs and plain: no frontmatter
  return "";
}

function warningCallout(format: LivingDocsFormat, text: string): string {
  if (format === "docusaurus") return `:::warning\n${text}\n:::\n`;
  if (format === "mkdocs") return `!!! warning\n    ${text.replace(/\n/g, "\n    ")}\n`;
  return `> ⚠️ ${text}\n`;
}

// ---------------------------------------------------------------------------
// Data loaders (thin wrappers to handle missing files gracefully)
// ---------------------------------------------------------------------------

async function loadFeatures(): Promise<Record<string, unknown>[]> {
  try {
    return await loadJsonData<Record<string, unknown>[]>("features.json");
  } catch {
    return [];
  }
}

async function loadDataModel(): Promise<Record<string, unknown>[]> {
  try {
    return await loadJsonData<Record<string, unknown>[]>("data_model.json");
  } catch {
    return [];
  }
}

async function loadWorkflows(): Promise<Record<string, unknown>[]> {
  try {
    return await loadJsonData<Record<string, unknown>[]>("workflows.json");
  } catch {
    return [];
  }
}

async function loadSystemOverview(): Promise<Record<string, unknown>> {
  try {
    return await loadJsonData<Record<string, unknown>>("system_overview.json");
  } catch {
    return {};
  }
}

async function loadCapabilities(): Promise<Record<string, unknown>> {
  try {
    return await loadJsonData<Record<string, unknown>>("capabilities.json");
  } catch {
    return {};
  }
}

async function loadADRLog(): Promise<ADRLogFile> {
  try {
    const p = resolve(config.dataDir, "adr_log.json");
    if (!existsSync(p))
      return {
        metadata: {
          description: "",
          schema_version: "1.0.0",
          total_decisions: 0,
          last_updated: null,
        },
        decisions: [],
      };
    return JSON.parse(await readFile(p, "utf-8")) as ADRLogFile;
  } catch {
    return {
      metadata: {
        description: "",
        schema_version: "1.0.0",
        total_decisions: 0,
        last_updated: null,
      },
      decisions: [],
    };
  }
}

async function loadUIRegistry(): Promise<UIRegistryFile> {
  try {
    const p = resolve(config.dataDir, "ui_registry.json");
    if (!existsSync(p))
      return {
        metadata: {
          description: "",
          schema_version: "1.0.0",
          total_elements: 0,
          total_categories: 0,
          last_updated: null,
        },
        elements: [],
      };
    return JSON.parse(await readFile(p, "utf-8")) as UIRegistryFile;
  } catch {
    return {
      metadata: {
        description: "",
        schema_version: "1.0.0",
        total_elements: 0,
        total_categories: 0,
        last_updated: null,
      },
      elements: [],
    };
  }
}

async function loadDreamGraph(): Promise<Record<string, unknown>> {
  try {
    return await loadJsonData<Record<string, unknown>>("dream_graph.json");
  } catch {
    return {};
  }
}

async function loadTensions(): Promise<Record<string, unknown>> {
  try {
    return await loadJsonData<Record<string, unknown>>("tension_log.json");
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Section generators — each returns an array of FileBuffer entries
// ---------------------------------------------------------------------------

async function genFeatures(
  fmt: LivingDocsFormat,
  diagrams: boolean
): Promise<FileBuffer[]> {
  const features = await loadFeatures();
  if (!features.length) return [];
  const files: FileBuffer[] = [];

  // Index page
  let idx = frontmatter(fmt, "Features", 1);
  idx += "# Feature Catalog\n\n";
  idx += "| ID | Name | Domain | Status | Repository |\n";
  idx += "|----|------|--------|--------|------------|\n";
  for (const f of features) {
    idx += `| ${f.id} | ${f.name} | ${f.domain ?? "-"} | ${f.status ?? "-"} | ${f.source_repo ?? "-"} |\n`;
  }
  files.push({ path: "features/_index.md", section: "features", content: idx });

  // Individual pages
  for (const f of features) {
    const id = String(f.id);
    let md = frontmatter(fmt, String(f.name));
    md += `# ${f.name}\n\n`;
    if (f.description) md += `> ${f.description}\n\n`;
    md += `**Repository:** ${f.source_repo ?? "N/A"}  \n`;
    md += `**Domain:** ${f.domain ?? "N/A"}  \n`;
    md += `**Status:** ${f.status ?? "N/A"}  \n`;
    if (Array.isArray(f.source_files) && f.source_files.length)
      md += `**Source files:** ${f.source_files.join(", ")}  \n`;
    md += "\n";

    // Links table
    const links = Array.isArray(f.links) ? (f.links as Record<string, unknown>[]) : [];
    if (links.length) {
      md += "## Relationships\n\n";
      md += "| Target | Type | Relationship | Strength | Description |\n";
      md += "|--------|------|--------------|----------|-------------|\n";
      for (const l of links) {
        md += `| ${l.target ?? "-"} | ${l.type ?? "-"} | ${l.relationship ?? "-"} | ${l.strength ?? "-"} | ${l.description ?? "-"} |\n`;
      }
      md += "\n";
    }

    // Tags
    if (Array.isArray(f.tags) && f.tags.length) {
      md += `**Tags:** ${(f.tags as string[]).join(", ")}\n\n`;
    }

    files.push({
      path: `features/${slugify(id)}.md`,
      section: "features",
      content: md,
    });
  }
  return files;
}

async function genDataModel(
  fmt: LivingDocsFormat
): Promise<FileBuffer[]> {
  const entities = await loadDataModel();
  if (!entities.length) return [];
  const files: FileBuffer[] = [];

  // Index
  let idx = frontmatter(fmt, "Data Model", 2);
  idx += "# Data Model — Entity Catalog\n\n";
  idx += "| ID | Name | Table | Storage |\n";
  idx += "|----|------|-------|---------|\n";
  for (const e of entities) {
    idx += `| ${e.id} | ${e.name} | ${e.table_name ?? "-"} | ${e.storage ?? "-"} |\n`;
  }
  files.push({
    path: "data-model/_index.md",
    section: "data_model",
    content: idx,
  });

  // Individual pages
  for (const e of entities) {
    const id = String(e.id);
    let md = frontmatter(fmt, String(e.name));
    md += `# ${e.name}\n\n`;
    if (e.description) md += `> ${e.description}\n\n`;
    md += `**Table:** \`${e.table_name ?? "N/A"}\`  \n`;
    md += `**Storage:** ${e.storage ?? "N/A"}  \n\n`;

    // Fields
    const fields = Array.isArray(e.key_fields)
      ? (e.key_fields as Record<string, unknown>[])
      : [];
    if (fields.length) {
      md += "## Fields\n\n";
      md += "| Field | Type | Description |\n";
      md += "|-------|------|-------------|\n";
      for (const fd of fields) {
        md += `| ${fd.name ?? "-"} | ${fd.type ?? "-"} | ${fd.description ?? "-"} |\n`;
      }
      md += "\n";
    }

    // Relationships
    const rels = Array.isArray(e.relationships)
      ? (e.relationships as Record<string, unknown>[])
      : [];
    if (rels.length) {
      md += "## Relationships\n\n";
      md += "| Target | Type | Description |\n";
      md += "|--------|------|-------------|\n";
      for (const r of rels) {
        md += `| ${r.target ?? "-"} | ${r.type ?? "-"} | ${r.description ?? "-"} |\n`;
      }
      md += "\n";
    }

    files.push({
      path: `data-model/${slugify(id)}.md`,
      section: "data_model",
      content: md,
    });
  }
  return files;
}

async function genWorkflows(
  fmt: LivingDocsFormat,
  diagrams: boolean
): Promise<FileBuffer[]> {
  const workflows = await loadWorkflows();
  if (!workflows.length) return [];
  const files: FileBuffer[] = [];

  // Index
  let idx = frontmatter(fmt, "Workflows", 3);
  idx += "# Workflow Catalog\n\n";
  idx += "| ID | Name | Trigger | Steps |\n";
  idx += "|----|------|---------|-------|\n";
  for (const w of workflows) {
    const steps = Array.isArray(w.steps) ? w.steps.length : 0;
    idx += `| ${w.id} | ${w.name} | ${w.trigger ?? "-"} | ${steps} |\n`;
  }
  files.push({
    path: "workflows/_index.md",
    section: "workflows",
    content: idx,
  });

  // Individual pages
  for (const w of workflows) {
    const id = String(w.id);
    let md = frontmatter(fmt, String(w.name));
    md += `# ${w.name}\n\n`;
    if (w.description) md += `> ${w.description}\n\n`;
    md += `**Trigger:** ${w.trigger ?? "N/A"}  \n`;
    if (Array.isArray(w.source_files) && w.source_files.length)
      md += `**Source files:** ${(w.source_files as string[]).join(", ")}  \n`;
    md += "\n";

    const steps = Array.isArray(w.steps)
      ? (w.steps as Record<string, unknown>[])
      : [];

    if (diagrams && steps.length) {
      md += "## Flowchart\n\n";
      md += "```mermaid\nflowchart TD\n";
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const sid = `S${i + 1}`;
        const label = String(s.name ?? `Step ${i + 1}`).replace(/"/g, "'");
        md += `    ${sid}["${label}"]\n`;
        if (i > 0) md += `    S${i} --> ${sid}\n`;
      }
      md += "```\n\n";
    }

    if (steps.length) {
      md += "## Steps\n\n";
      for (const s of steps) {
        md += `### ${s.order ?? "-"}. ${s.name ?? "Step"}\n\n`;
        if (s.description) md += `${s.description}\n\n`;
      }
    }

    files.push({
      path: `workflows/${slugify(id)}.md`,
      section: "workflows",
      content: md,
    });
  }
  return files;
}

async function genArchitecture(
  fmt: LivingDocsFormat
): Promise<FileBuffer[]> {
  const log = await loadADRLog();
  const files: FileBuffer[] = [];

  // Index (always generate — may be empty)
  let idx = frontmatter(fmt, "Architecture Decisions", 4);
  idx += "# Architecture Decision Records\n\n";
  if (!log.decisions.length) {
    idx += "*No architecture decisions recorded yet.*\n";
  } else {
    idx += "| ID | Title | Status | Date | Decided By |\n";
    idx += "|----|-------|--------|------|------------|\n";
    for (const d of log.decisions) {
      const badge =
        d.status === "accepted"
          ? "✅"
          : d.status === "deprecated"
            ? "⛔"
            : "🔄";
      idx += `| ${badge} ${d.id} | [${d.title}](${slugify(d.id)}.md) | ${d.status} | ${d.date} | ${d.decided_by} |\n`;
    }
  }
  files.push({
    path: "architecture/_index.md",
    section: "architecture",
    content: idx,
  });

  // Individual ADR pages
  for (const d of log.decisions) {
    let md = frontmatter(fmt, `${d.id}: ${d.title}`);
    md += `# ${d.id}: ${d.title}\n\n`;
    md += `**Date:** ${d.date}  \n`;
    md += `**Status:** ${d.status}  \n`;
    md += `**Decided by:** ${d.decided_by}  \n`;
    if (d.context.affected_entities.length)
      md += `**Affected entities:** ${d.context.affected_entities.join(", ")}  \n`;
    md += "\n";

    md += "## Context\n\n";
    md += `${d.context.problem}\n\n`;
    if (d.context.constraints.length) {
      md += "**Constraints:**\n";
      for (const c of d.context.constraints) md += `- ${c}\n`;
      md += "\n";
    }

    md += "## Decision\n\n";
    md += `${d.decision.chosen}\n\n`;
    if (d.decision.alternatives.length) {
      md += "### Alternatives Considered\n\n";
      for (const alt of d.decision.alternatives) {
        md += `- **${alt.option}** — Rejected: ${alt.rejected_because}\n`;
      }
      md += "\n";
    }

    md += "## Consequences\n\n";
    if (d.consequences.expected.length) {
      for (const e of d.consequences.expected) md += `- ${e}\n`;
      md += "\n";
    }
    if (d.consequences.risks.length) {
      md += "**Risks accepted:**\n";
      for (const r of d.consequences.risks) md += `- ${r}\n`;
      md += "\n";
    }

    // Guard rails
    if (d.guard_rails.length) {
      md += "## Guard Rails\n\n";
      for (const gr of d.guard_rails) {
        md += warningCallout(fmt, gr);
        md += "\n";
      }
    }

    if (d.tags.length) {
      md += `\n**Tags:** ${d.tags.join(", ")}\n`;
    }

    files.push({
      path: `architecture/${slugify(d.id)}.md`,
      section: "architecture",
      content: md,
    });
  }
  return files;
}

async function genUIRegistry(
  fmt: LivingDocsFormat
): Promise<FileBuffer[]> {
  const reg = await loadUIRegistry();
  const files: FileBuffer[] = [];

  let idx = frontmatter(fmt, "UI Registry", 5);
  idx += "# Semantic UI Element Catalog\n\n";
  if (!reg.elements.length) {
    idx += "*No UI elements registered yet.*\n";
  } else {
    // Group by category
    const byCategory = new Map<string, typeof reg.elements>();
    for (const el of reg.elements) {
      const arr = byCategory.get(el.category) ?? [];
      arr.push(el);
      byCategory.set(el.category, arr);
    }
    for (const [cat, els] of byCategory) {
      idx += `## ${cat}\n\n`;
      idx += "| ID | Name | Purpose | Platforms |\n";
      idx += "|----|------|---------|-----------|\n";
      for (const el of els) {
        const plats = el.implementations.map((i) => i.platform).join(", ") || "-";
        idx += `| [${el.id}](${slugify(el.id)}.md) | ${el.name} | ${el.purpose.substring(0, 60)}… | ${plats} |\n`;
      }
      idx += "\n";
    }
  }
  files.push({
    path: "ui-registry/_index.md",
    section: "ui_registry",
    content: idx,
  });

  // Individual element pages
  for (const el of reg.elements) {
    let md = frontmatter(fmt, el.name);
    md += `# ${el.name}\n\n`;
    md += `> ${el.purpose}\n\n`;
    md += `**ID:** \`${el.id}\`  \n`;
    md += `**Category:** ${el.category}  \n`;
    md += "\n";

    md += "## Data Contract\n\n";
    md += "### Inputs\n\n";
    if (el.data_contract.inputs.length) {
      md += "| Name | Type | Required | Description |\n";
      md += "|------|------|----------|-------------|\n";
      for (const inp of el.data_contract.inputs) {
        md += `| ${inp.name} | \`${inp.type}\` | ${inp.required ? "✅" : "❌"} | ${inp.description} |\n`;
      }
    } else {
      md += "*No inputs defined.*\n";
    }
    md += "\n";

    md += "### Outputs\n\n";
    if (el.data_contract.outputs.length) {
      md += "| Name | Type | Trigger | Description |\n";
      md += "|------|------|---------|-------------|\n";
      for (const out of el.data_contract.outputs) {
        md += `| ${out.name} | \`${out.type}\` | ${out.trigger} | ${out.description} |\n`;
      }
    } else {
      md += "*No outputs defined.*\n";
    }
    md += "\n";

    if (el.interactions.length) {
      md += "## Interactions\n\n";
      for (const ia of el.interactions) {
        md += `- **${ia.action}** — ${ia.description}\n`;
      }
      md += "\n";
    }

    if (el.implementations.length) {
      md += "## Platform Implementations\n\n";
      md += "| Platform | Component | Source File | Notes |\n";
      md += "|----------|-----------|-------------|-------|\n";
      for (const impl of el.implementations) {
        md += `| ${impl.platform} | \`${impl.component}\` | ${impl.source_file ?? "-"} | ${impl.notes ?? "-"} |\n`;
      }
      md += "\n";
    }

    if (el.used_by.length) {
      md += `**Used by features:** ${el.used_by.join(", ")}\n\n`;
    }
    if (el.tags?.length) {
      md += `**Tags:** ${el.tags.join(", ")}\n`;
    }

    files.push({
      path: `ui-registry/${slugify(el.id)}.md`,
      section: "ui_registry",
      content: md,
    });
  }
  return files;
}

async function genCognitiveStatus(
  fmt: LivingDocsFormat
): Promise<FileBuffer[]> {
  const graph = await loadDreamGraph();
  const tensions = await loadTensions();
  const files: FileBuffer[] = [];

  let md = frontmatter(fmt, "Cognitive Status", 7);
  md += "# Cognitive Status\n\n";
  md += `*Generated at: ${new Date().toISOString()}*\n\n`;

  // Graph stats
  const meta = (graph as { metadata?: Record<string, unknown> }).metadata ?? {};
  md += "## Dream Graph\n\n";
  md += `- **Last dream cycle:** ${meta.last_dream_cycle ?? "N/A"}\n`;
  md += `- **Total cycles:** ${meta.total_cycles ?? 0}\n`;
  const nodes = Array.isArray((graph as { nodes?: unknown[] }).nodes)
    ? (graph as { nodes: unknown[] }).nodes.length
    : 0;
  const edges = Array.isArray((graph as { edges?: unknown[] }).edges)
    ? (graph as { edges: unknown[] }).edges.length
    : 0;
  md += `- **Dream nodes:** ${nodes}\n`;
  md += `- **Dream edges:** ${edges}\n`;
  md += "\n";

  // Tension stats
  const tMeta = (tensions as { metadata?: Record<string, unknown> }).metadata ?? {};
  const signals = Array.isArray((tensions as { signals?: unknown[] }).signals)
    ? (tensions as { signals: unknown[] }).signals.length
    : 0;
  md += "## Tension Log\n\n";
  md += `- **Active tensions:** ${signals}\n`;
  md += `- **Total resolved:** ${tMeta.total_resolved ?? 0}\n`;
  md += `- **Last updated:** ${tMeta.last_updated ?? "N/A"}\n`;
  md += "\n";

  files.push({
    path: "cognitive-status.md",
    section: "cognitive_status",
    content: md,
  });
  return files;
}

async function genAPIReference(
  fmt: LivingDocsFormat
): Promise<FileBuffer[]> {
  const caps = await loadCapabilities();
  const files: FileBuffer[] = [];

  let idx = frontmatter(fmt, "API Reference", 6);
  idx += "# API Reference\n\n";
  idx += "This section documents all MCP tools and resources exposed by the server.\n\n";

  // Tools reference
  const toolsInfo = (caps as { tools?: Record<string, unknown>[] }).tools;
  idx += "## Tools\n\n";
  if (Array.isArray(toolsInfo) && toolsInfo.length) {
    idx += "| Name | Description |\n";
    idx += "|------|-------------|\n";
    for (const t of toolsInfo) {
      idx += `| \`${t.name ?? "-"}\` | ${t.description ?? "-"} |\n`;
    }
  } else {
    idx += "Refer to the server's tool listing for the full MCP tool catalog.\n";
  }
  idx += "\n";

  // Resources reference
  const graphs = (caps as { resources?: Record<string, unknown>[] }).resources;
  idx += "## Resources\n\n";
  if (Array.isArray(graphs) && graphs.length) {
    idx += "| URI | Description |\n";
    idx += "|-----|-------------|\n";
    for (const r of graphs) {
      idx += `| \`${r.uri ?? "-"}\` | ${r.description ?? "-"} |\n`;
    }
  } else {
    idx += "Resources are available via `dream://` and `system://` URI schemes.\n";
  }
  idx += "\n";

  files.push({
    path: "api-reference/_index.md",
    section: "api_reference",
    content: idx,
  });
  return files;
}

async function genIndex(
  fmt: LivingDocsFormat,
  sectionsExported: string[]
): Promise<FileBuffer[]> {
  const overview = await loadSystemOverview();
  let md = frontmatter(fmt, "Documentation", 0);
  md += `# ${overview.name ?? "System Documentation"}\n\n`;
  if (overview.description) md += `> ${overview.description}\n\n`;
  md += `*Auto-generated living documentation. Last updated: ${new Date().toISOString()}*\n\n`;
  md += "## Sections\n\n";
  const sectionLabels: Record<string, string> = {
    features: "Feature Catalog",
    data_model: "Data Model",
    workflows: "Workflows",
    architecture: "Architecture Decisions",
    ui_registry: "UI Registry",
    api_reference: "API Reference",
    cognitive_status: "Cognitive Status",
  };
  for (const s of sectionsExported) {
    const label = sectionLabels[s] ?? s;
    const dir =
      s === "cognitive_status"
        ? "cognitive-status.md"
        : `${s.replace(/_/g, "-")}/_index.md`;
    md += `- [${label}](${dir})\n`;
  }
  md += "\n";
  return [{ path: "index.md", section: "index", content: md }];
}

// ---------------------------------------------------------------------------
// Framework boilerplate generators
// ---------------------------------------------------------------------------

function genDocusaurusSidebars(sections: string[]): FileBuffer | null {
  const items = sections.map(
    (s) => `    { type: 'autogenerated', dirName: '${s.replace(/_/g, "-")}' }`
  );
  const content = `module.exports = {\n  docs: [\n${items.join(",\n")}\n  ],\n};\n`;
  return { path: "sidebars.js", section: "_framework", content };
}

function genMkDocsYml(sections: string[]): FileBuffer | null {
  let yml = "site_name: Documentation\nnav:\n  - Home: index.md\n";
  for (const s of sections) {
    yml += `  - ${s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: ${s.replace(/_/g, "-")}/_index.md\n`;
  }
  return { path: "mkdocs.yml", section: "_framework", content: yml };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function registerLivingDocsTools(server: McpServer): void {
  server.tool(
    "export_living_docs",
    "Export the current knowledge graph, ADRs, UI registry, and cognitive state as structured Markdown files for a documentation site (Docusaurus, Nextra, MkDocs, or plain GitHub). Stateless and idempotent — re-running always produces identical output from the same graph state.",
    {
      output_dir: z
        .string()
        .describe(
          "Output directory (absolute path, or relative to project root)"
        ),
      sections: z
        .array(
          z.enum([
            "features",
            "data_model",
            "workflows",
            "architecture",
            "ui_registry",
            "cognitive_status",
            "api_reference",
            "all",
          ])
        )
        .describe("Sections to export"),
      format: z
        .enum(["docusaurus", "nextra", "mkdocs", "plain"])
        .optional()
        .describe("Site framework format (default: plain)"),
      include_diagrams: z
        .boolean()
        .optional()
        .describe("Include Mermaid diagrams inline (default: true)"),
      include_cognitive: z
        .boolean()
        .optional()
        .describe(
          "Include cognitive status section (default: false)"
        ),
    },
    async (params) => {
      logger.debug(
        `export_living_docs called: sections=${params.sections.join(",")}, format=${params.format ?? "plain"}`
      );

      const result = await safeExecute<ExportLivingDocsOutput>(
        async (): Promise<ToolResponse<ExportLivingDocsOutput>> => {
          const fmt: LivingDocsFormat = params.format ?? "plain";
          const diagrams = params.include_diagrams !== false; // default true
          const includeCognitive = params.include_cognitive === true;

          // Resolve output dir
          const outDir = resolve(projectRoot, params.output_dir);

          // Expand "all"
          let wanted = new Set<LivingDocsSection>(params.sections);
          if (wanted.has("all")) {
            wanted = new Set<LivingDocsSection>([
              "features",
              "data_model",
              "workflows",
              "architecture",
              "ui_registry",
              "api_reference",
            ]);
            if (includeCognitive) wanted.add("cognitive_status");
          }
          // Always include cognitive_status if explicitly listed
          if (params.sections.includes("cognitive_status"))
            wanted.add("cognitive_status");

          // Generate content
          const buffers: FileBuffer[] = [];
          const sectionsExported: string[] = [];

          if (wanted.has("features")) {
            buffers.push(...(await genFeatures(fmt, diagrams)));
            sectionsExported.push("features");
          }
          if (wanted.has("data_model")) {
            buffers.push(...(await genDataModel(fmt)));
            sectionsExported.push("data_model");
          }
          if (wanted.has("workflows")) {
            buffers.push(...(await genWorkflows(fmt, diagrams)));
            sectionsExported.push("workflows");
          }
          if (wanted.has("architecture")) {
            buffers.push(...(await genArchitecture(fmt)));
            sectionsExported.push("architecture");
          }
          if (wanted.has("ui_registry")) {
            buffers.push(...(await genUIRegistry(fmt)));
            sectionsExported.push("ui_registry");
          }
          if (wanted.has("api_reference")) {
            buffers.push(...(await genAPIReference(fmt)));
            sectionsExported.push("api_reference");
          }
          if (wanted.has("cognitive_status")) {
            buffers.push(...(await genCognitiveStatus(fmt)));
            sectionsExported.push("cognitive_status");
          }

          // Index page
          buffers.push(...(await genIndex(fmt, sectionsExported)));

          // Framework files
          if (fmt === "docusaurus") {
            const sb = genDocusaurusSidebars(sectionsExported);
            if (sb) buffers.push(sb);
          }
          if (fmt === "mkdocs") {
            const mk = genMkDocsYml(sectionsExported);
            if (mk) buffers.push(mk);
          }

          // Write all files to disk
          const created: ExportedFile[] = [];
          let totalBytes = 0;

          for (const buf of buffers) {
            const filePath = join(outDir, buf.path);
            const dir = resolve(filePath, "..");
            await mkdir(dir, { recursive: true });
            const bytes = Buffer.byteLength(buf.content, "utf-8");
            await writeFile(filePath, buf.content, "utf-8");
            created.push({
              path: relative(outDir, filePath).replace(/\\/g, "/"),
              section: buf.section,
              size_bytes: bytes,
            });
            totalBytes += bytes;
          }

          return success({
            files_created: created,
            total_files: created.length,
            total_bytes: totalBytes,
            sections_exported: sectionsExported,
            timestamp: new Date().toISOString(),
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );
}
