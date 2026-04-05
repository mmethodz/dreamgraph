/**
 * DreamGraph MCP Server — generate_visual_flow tool.
 *
 * Generates Mermaid.js diagrams from the knowledge graph on the fly.
 * Supports workflow flowcharts, feature dependency graphs, data flow
 * diagrams, tension maps, domain overviews, and UI composition trees.
 *
 * READ-ONLY: Reads fact graph, dream graph, tension log, and UI registry.
 * Never modifies any data files.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonData } from "../utils/cache.js";
import { engine } from "../cognitive/engine.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  GenerateVisualFlowOutput,
  ToolResponse,
  SemanticElement,
  UIRegistryFile,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 40;
const DEFAULT_DIRECTION = "TB";

// ---------------------------------------------------------------------------
// Mermaid Helpers
// ---------------------------------------------------------------------------

/** Escape special chars for Mermaid labels */
function esc(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()<>]/g, "");
}

/** Build a safe Mermaid node ID from any string */
function nodeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Node shape by entity type */
function nodeShape(type: string, label: string): string {
  const id = nodeId(label);
  const safe = esc(label);
  switch (type) {
    case "workflow":
      return `${id}{{"${safe}"}}`;
    case "data_model":
      return `${id}[("${safe}")]`;
    default:
      return `${id}["${safe}"]`;
  }
}

/** Edge style based on strength */
function edgeStyle(strength: string, isDream: boolean): string {
  if (isDream) return "-.->";
  switch (strength) {
    case "strong":
      return "==>";
    case "moderate":
      return "-->";
    default:
      return "-.->";
  }
}

// ---------------------------------------------------------------------------
// Diagram Generators
// ---------------------------------------------------------------------------

async function generateWorkflowDiagram(
  targetIds: string[],
  direction: string
): Promise<GenerateVisualFlowOutput> {
  const workflows = await loadJsonData<Workflow[]>("workflows.json");
  const wf = workflows.find(
    (w) => targetIds.some((t) => w.id.toLowerCase() === t.toLowerCase())
  );
  if (!wf) {
    return {
      mermaid: "",
      diagram_type: "workflow",
      node_count: 0,
      edge_count: 0,
      simplified: false,
      title: "Workflow not found",
    };
  }

  const sorted = [...wf.steps].sort((a, b) => a.order - b.order);
  const lines: string[] = [`graph ${direction}`];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const id = `S${s.order}`;
    const label = `${s.order}. ${esc(s.name)}`;
    if (i === 0) {
      lines.push(`    ${id}["${label}"]`);
    }
    if (i > 0) {
      const prev = `S${sorted[i - 1].order}`;
      lines.push(`    ${prev} --> ${id}["${label}"]`);
    }
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "workflow",
    node_count: sorted.length,
    edge_count: Math.max(0, sorted.length - 1),
    simplified: false,
    title: `Workflow: ${wf.name}`,
  };
}

async function generateFeatureDepsDiagram(
  targetIds: string[],
  depth: number,
  direction: string,
  includeDreams: boolean,
  includeTensions: boolean,
  maxNodes: number
): Promise<GenerateVisualFlowOutput> {
  const features = await loadJsonData<Feature[]>("features.json");
  const dataModels = await loadJsonData<DataModelEntity[]>("data_model.json");
  const workflows = await loadJsonData<Workflow[]>("workflows.json");

  // Build entity lookup
  const allEntities = new Map<string, { name: string; type: string }>();
  for (const f of features) allEntities.set(f.id, { name: f.name, type: "feature" });
  for (const d of dataModels) allEntities.set(d.id, { name: d.name, type: "data_model" });
  for (const w of workflows) allEntities.set(w.id, { name: w.name, type: "workflow" });

  // Collect edges via BFS
  const visited = new Set<string>();
  const edges: Array<{ from: string; to: string; rel: string; strength: string; type: string }> = [];
  let frontier = [...targetIds.map((id) => id.toLowerCase())];
  let currentDepth = 0;

  // Build link map from all entities
  const linkMap = new Map<string, Array<{ target: string; relationship: string; strength: string; type: string }>>();
  for (const f of features) {
    linkMap.set(f.id, (f.links ?? []).map((l) => ({
      target: l.target,
      relationship: l.relationship,
      strength: l.strength,
      type: l.type,
    })));
  }
  for (const d of dataModels) {
    linkMap.set(d.id, (d.links ?? []).map((l) => ({
      target: l.target,
      relationship: l.relationship,
      strength: l.strength,
      type: l.type,
    })));
  }
  for (const w of workflows) {
    linkMap.set(w.id, (w.links ?? []).map((l) => ({
      target: l.target,
      relationship: l.relationship,
      strength: l.strength,
      type: l.type,
    })));
  }

  while (frontier.length > 0 && currentDepth < depth) {
    const nextFrontier: string[] = [];
    for (const entityId of frontier) {
      if (visited.has(entityId)) continue;
      visited.add(entityId);

      const links = linkMap.get(entityId) ?? [];
      for (const link of links) {
        edges.push({
          from: entityId,
          to: link.target,
          rel: link.relationship,
          strength: link.strength,
          type: link.type,
        });
        if (!visited.has(link.target)) {
          nextFrontier.push(link.target);
        }
      }
    }
    frontier = nextFrontier;
    currentDepth++;
  }

  // Optionally include dream edges
  if (includeDreams) {
    try {
      const dreamGraph = await engine.loadDreamGraph();
      for (const de of dreamGraph.edges) {
        if (visited.has(de.from) || visited.has(de.to)) {
          edges.push({
            from: de.from,
            to: de.to,
            rel: de.relation,
            strength: "weak",
            type: "dream",
          });
          visited.add(de.from);
          visited.add(de.to);
        }
      }
    } catch {
      // Dream graph not available, skip
    }
  }

  // Tension marking
  const tensionEntities = new Set<string>();
  if (includeTensions) {
    try {
      const tensions = await engine.loadTensions();
      for (const t of tensions.signals) {
        for (const e of t.entities) tensionEntities.add(e);
      }
    } catch {
      // Tension log not available, skip
    }
  }

  // Auto-simplify
  const nodeSet = new Set<string>();
  for (const e of edges) {
    nodeSet.add(e.from);
    nodeSet.add(e.to);
  }
  const simplified = nodeSet.size > maxNodes;

  // Build Mermaid
  const lines: string[] = [`graph ${direction}`];
  const addedNodes = new Set<string>();

  for (const e of edges) {
    // Add from node
    if (!addedNodes.has(e.from)) {
      const info = allEntities.get(e.from);
      lines.push(`    ${nodeShape(info?.type ?? "feature", info?.name ?? e.from)}`);
      addedNodes.add(e.from);
    }
    // Add to node
    if (!addedNodes.has(e.to)) {
      const info = allEntities.get(e.to);
      lines.push(`    ${nodeShape(info?.type ?? "feature", info?.name ?? e.to)}`);
      addedNodes.add(e.to);
    }
    // Edge
    const isDream = e.type === "dream";
    const arrow = edgeStyle(e.strength, isDream);
    lines.push(`    ${nodeId(allEntities.get(e.from)?.name ?? e.from)} ${arrow}|${esc(e.rel)}| ${nodeId(allEntities.get(e.to)?.name ?? e.to)}`);
  }

  // Style tension-affected nodes
  if (includeTensions) {
    for (const entityId of tensionEntities) {
      const info = allEntities.get(entityId);
      if (info && addedNodes.has(entityId)) {
        lines.push(`    style ${nodeId(info.name)} fill:#8b0000,color:#fff`);
      }
    }
  }

  // Style target roots
  for (const tid of targetIds) {
    const info = allEntities.get(tid.toLowerCase()) ?? allEntities.get(tid);
    if (info) {
      lines.push(`    style ${nodeId(info.name)} fill:#2d5a27,color:#fff`);
    }
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "feature_deps",
    node_count: addedNodes.size,
    edge_count: edges.length,
    simplified,
    title: `Feature Dependencies: ${targetIds.join(", ")}`,
  };
}

async function generateDataFlowDiagram(
  targetIds: string[],
  direction: string,
  maxNodes: number
): Promise<GenerateVisualFlowOutput> {
  const features = await loadJsonData<Feature[]>("features.json");
  const dataModels = await loadJsonData<DataModelEntity[]>("data_model.json");

  const allEntities = new Map<string, { name: string; type: string }>();
  for (const f of features) allEntities.set(f.id, { name: f.name, type: "feature" });
  for (const d of dataModels) allEntities.set(d.id, { name: d.name, type: "data_model" });

  const dataVerbs = ["writes", "reads", "syncs", "claims", "updates", "enriches", "stores", "queries"];
  const edges: Array<{ from: string; to: string; rel: string; strength: string }> = [];

  for (const f of features) {
    for (const link of f.links ?? []) {
      if (dataVerbs.some((v) => link.relationship.toLowerCase().includes(v))) {
        edges.push({ from: f.id, to: link.target, rel: link.relationship, strength: link.strength });
      }
    }
  }
  for (const d of dataModels) {
    for (const link of d.links ?? []) {
      if (dataVerbs.some((v) => link.relationship.toLowerCase().includes(v))) {
        edges.push({ from: d.id, to: link.target, rel: link.relationship, strength: link.strength });
      }
    }
  }

  // Filter to targets if provided
  const targetSet = new Set(targetIds.map((t) => t.toLowerCase()));
  const filtered = targetSet.size > 0
    ? edges.filter((e) => targetSet.has(e.from) || targetSet.has(e.to))
    : edges;

  const lines: string[] = [`graph ${direction}`];
  const addedNodes = new Set<string>();

  for (const e of filtered) {
    if (!addedNodes.has(e.from)) {
      const info = allEntities.get(e.from);
      lines.push(`    ${nodeShape(info?.type ?? "feature", info?.name ?? e.from)}`);
      addedNodes.add(e.from);
    }
    if (!addedNodes.has(e.to)) {
      const info = allEntities.get(e.to);
      lines.push(`    ${nodeShape(info?.type ?? "data_model", info?.name ?? e.to)}`);
      addedNodes.add(e.to);
    }
    const arrow = edgeStyle(e.strength, false);
    lines.push(`    ${nodeId(allEntities.get(e.from)?.name ?? e.from)} ${arrow}|${esc(e.rel)}| ${nodeId(allEntities.get(e.to)?.name ?? e.to)}`);
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "data_flow",
    node_count: addedNodes.size,
    edge_count: filtered.length,
    simplified: addedNodes.size > maxNodes,
    title: targetIds.length > 0 ? `Data Flow: ${targetIds.join(", ")}` : "System Data Flow",
  };
}

async function generateTensionMapDiagram(
  direction: string
): Promise<GenerateVisualFlowOutput> {
  const tensions = await engine.loadTensions();
  const active = tensions.signals.filter((s) => !s.resolved);

  if (active.length === 0) {
    return {
      mermaid: `graph ${direction}\n    none["No active tensions"]`,
      diagram_type: "tension_map",
      node_count: 1,
      edge_count: 0,
      simplified: false,
      title: "Tension Map (empty)",
    };
  }

  // Group by domain
  const byDomain = new Map<string, typeof active>();
  for (const t of active) {
    const domain = t.domain ?? "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(t);
  }

  const lines: string[] = [`graph ${direction}`];
  let nodeCount = 0;
  let edgeCount = 0;
  const sortedDomains = [...byDomain.keys()].sort();

  for (const domain of sortedDomains) {
    const signals = byDomain.get(domain)!;
    lines.push(`    subgraph ${nodeId(domain)}["${esc(domain)}"]`);

    for (const t of signals) {
      const tid = nodeId(t.id);
      const urgencyColor = t.urgency > 0.7 ? "#8b0000" : t.urgency > 0.4 ? "#cc6600" : "#cccc00";
      lines.push(`        ${tid}["${esc(t.description.substring(0, 60))}"]`);
      lines.push(`        style ${tid} fill:${urgencyColor},color:#fff`);
      nodeCount++;

      for (const entity of t.entities) {
        const eid = nodeId(entity);
        lines.push(`        ${tid} --> ${eid}["${esc(entity)}"]`);
        edgeCount++;
        nodeCount++;
      }
    }
    lines.push("    end");
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "tension_map",
    node_count: nodeCount,
    edge_count: edgeCount,
    simplified: false,
    title: `Tension Map — ${active.length} active tensions`,
  };
}

async function generateDomainOverviewDiagram(
  direction: string,
  maxNodes: number
): Promise<GenerateVisualFlowOutput> {
  const features = await loadJsonData<Feature[]>("features.json");

  // Group by domain
  const byDomain = new Map<string, Feature[]>();
  for (const f of features) {
    const domain = f.domain ?? "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(f);
  }

  const lines: string[] = [`graph ${direction}`];
  let nodeCount = 0;
  let edgeCount = 0;
  const sortedDomains = [...byDomain.keys()].sort();

  for (const domain of sortedDomains) {
    const domainFeatures = byDomain.get(domain)!;
    lines.push(`    subgraph ${nodeId(domain)}["${esc(domain)}"]`);
    for (const f of domainFeatures) {
      lines.push(`        ${nodeId(f.name)}["${esc(f.name)}"]`);
      nodeCount++;
    }
    lines.push("    end");
  }

  // Cross-domain edges
  for (const f of features) {
    for (const link of f.links ?? []) {
      const target = features.find((o) => o.id === link.target);
      if (target && target.domain !== f.domain) {
        lines.push(`    ${nodeId(f.name)} ${edgeStyle(link.strength, false)}|${esc(link.relationship)}| ${nodeId(target.name)}`);
        edgeCount++;
      }
    }
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "domain_overview",
    node_count: nodeCount,
    edge_count: edgeCount,
    simplified: nodeCount > maxNodes,
    title: `Domain Overview — ${sortedDomains.length} domains, ${nodeCount} features`,
  };
}

async function generateUICompositionDiagram(
  targetIds: string[],
  direction: string
): Promise<GenerateVisualFlowOutput> {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { config } = await import("../config/config.js");

  const registryPath = resolve(config.dataDir, "ui_registry.json");

  let registry: UIRegistryFile;
  try {
    const raw = await readFile(registryPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Defensive: guarantee expected shape regardless of what is on disk.
    registry = {
      metadata: {
        description: "Semantic UI Registry",
        schema_version: "1.0.0",
        total_elements: 0,
        total_categories: 0,
        last_updated: null,
        ...(parsed.metadata && typeof parsed.metadata === "object"
          ? parsed.metadata
          : {}),
      },
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    };
  } catch {
    return {
      mermaid: `graph ${direction}\n    none["UI Registry is empty"]`,
      diagram_type: "ui_composition",
      node_count: 1,
      edge_count: 0,
      simplified: false,
      title: "UI Composition (empty registry)",
    };
  }

  const elements = registry.elements;
  const targetSet = new Set(targetIds.map((t) => t.toLowerCase()));
  const filtered = targetSet.size > 0
    ? elements.filter((e) => targetSet.has(e.id.toLowerCase()))
    : elements;

  const lines: string[] = [`graph ${direction}`];
  let nodeCount = 0;
  let edgeCount = 0;

  // Group by category
  const byCategory = new Map<string, SemanticElement[]>();
  for (const el of filtered) {
    if (!byCategory.has(el.category)) byCategory.set(el.category, []);
    byCategory.get(el.category)!.push(el);
  }

  for (const [category, els] of [...byCategory.entries()].sort()) {
    lines.push(`    subgraph ${nodeId(category)}["${esc(category)}"]`);
    for (const el of els) {
      const platformCount = el.implementations.length;
      lines.push(`        ${nodeId(el.id)}["${esc(el.name)}\\n${platformCount} platforms"]`);
      nodeCount++;
    }
    lines.push("    end");
  }

  // Parent → child edges
  for (const el of filtered) {
    for (const childId of el.children ?? []) {
      const child = elements.find((e) => e.id === childId);
      if (child) {
        lines.push(`    ${nodeId(el.id)} --> ${nodeId(child.id)}`);
        edgeCount++;
      }
    }
  }

  return {
    mermaid: lines.join("\n"),
    diagram_type: "ui_composition",
    node_count: nodeCount,
    edge_count: edgeCount,
    simplified: false,
    title: `UI Composition — ${nodeCount} elements`,
  };
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerVisualArchitectTools(server: McpServer): void {
  server.tool(
    "generate_visual_flow",
    "Generate a Mermaid.js diagram from the knowledge graph. Supports workflow flowcharts, feature dependency graphs, data flow diagrams, tension maps, domain overviews, and UI composition trees. Returns raw Mermaid source code for client-side rendering.",
    {
      target_type: z
        .enum(["workflow", "feature_deps", "data_flow", "tension_map", "domain_overview", "ui_composition"])
        .describe("What to visualize"),
      target_ids: z
        .array(z.string())
        .describe("Entity ID(s) to center the diagram on"),
      depth: z
        .number()
        .optional()
        .describe("How many hops outward from the center (default: 2)"),
      direction: z
        .enum(["TB", "LR", "BT", "RL"])
        .optional()
        .describe("Mermaid diagram direction (default: TB)"),
      include_dreams: z
        .boolean()
        .optional()
        .describe("Include speculative dream edges (dashed lines)"),
      include_tensions: z
        .boolean()
        .optional()
        .describe("Highlight entities with active tensions"),
      max_nodes: z
        .number()
        .optional()
        .describe("Maximum nodes before auto-simplification (default: 40)"),
    },
    async (params) => {
      logger.debug(`generate_visual_flow called: type=${params.target_type}`);

      const result = await safeExecute<GenerateVisualFlowOutput>(async (): Promise<ToolResponse<GenerateVisualFlowOutput>> => {
        const dir = params.direction ?? DEFAULT_DIRECTION;
        const depth = params.depth ?? DEFAULT_DEPTH;
        const maxNodes = params.max_nodes ?? DEFAULT_MAX_NODES;
        const includeDreams = params.include_dreams ?? false;
        const includeTensions = params.include_tensions ?? false;

        let output: GenerateVisualFlowOutput;

        switch (params.target_type) {
          case "workflow":
            output = await generateWorkflowDiagram(params.target_ids, dir);
            break;
          case "feature_deps":
            output = await generateFeatureDepsDiagram(
              params.target_ids, depth, dir, includeDreams, includeTensions, maxNodes
            );
            break;
          case "data_flow":
            output = await generateDataFlowDiagram(params.target_ids, dir, maxNodes);
            break;
          case "tension_map":
            output = await generateTensionMapDiagram(dir);
            break;
          case "domain_overview":
            output = await generateDomainOverviewDiagram(dir, maxNodes);
            break;
          case "ui_composition":
            output = await generateUICompositionDiagram(params.target_ids, dir);
            break;
          default:
            return error("INVALID_TYPE", `Unknown target_type: ${params.target_type}`);
        }

        return success(output);
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
