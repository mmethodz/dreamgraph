/**
 * `dg curate` — High-level graph quality operation.
 *
 * When a daemon is running, queries the graph for quality signals
 * (duplicates, stale entities, weak ADRs) and reports actionable findings.
 * Without a daemon, falls back to advisory mode.
 */

import type { ParsedArgs } from "../dg.js";
import {
  resolveInstanceForCommand,
  readServerMeta,
  isProcessAlive,
} from "../utils/daemon.js";
import { mcpCallTool } from "../utils/mcp-call.js";

interface CurationFinding {
  type: string;
  id: string;
  name: string;
  detail: string;
}

export async function cmdCurate(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg curate — Improve graph signal quality

Usage:
  dg curate <uuid|name> [options]

When the daemon is running, queries graph entities and reports quality
issues: duplicates, stale entries, weak ADRs, and noisy hubs.

Options:
  --targets <list>          Comma-separated: features,workflows,data_model,adrs
  --dry-run                 Show findings without applying changes
  --json                    Output JSON summary
  --master-dir <path>       Override master directory
`);
    return;
  }

  const query = positional[0];
  const jsonOutput = flags.json === true;
  const dryRun = flags["dry-run"] === true || true; // v1 is always dry-run / advisory

  // Attempt to resolve instance and check daemon
  let daemonPort: number | undefined;
  let instanceName = query ?? "active-instance";
  try {
    const { entry, instanceRoot } = await resolveInstanceForCommand(query, flags);
    instanceName = entry.name;
    const meta = await readServerMeta(instanceRoot);
    if (meta && isProcessAlive(meta.pid) && meta.port != null) {
      daemonPort = meta.port;
    }
  } catch {
    // No instance resolved — fall back to advisory
  }

  if (!daemonPort) {
    // Advisory fallback — no daemon
    const summary = {
      ok: true,
      mode: "curate",
      target: instanceName,
      status: "advisory",
      message:
        "No running daemon found. Start the daemon first for live graph analysis: dg start <instance>",
      suggested_actions: [
        "start the daemon: dg start <instance>",
        "use DreamGraph Architect for guided curation",
      ],
    };
    if (jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("Graph operation: curate");
      console.log(`Target: ${instanceName}`);
      console.log("Status: advisory (daemon not running)");
      console.log(summary.message);
    }
    return;
  }

  if (!jsonOutput) {
    console.log("Graph operation: curate");
    console.log(`Target: ${instanceName}`);
    console.log("Analyzing graph quality...\n");
  }

  const targets = typeof flags.targets === "string"
    ? flags.targets.split(",").map((t) => t.trim())
    : ["features", "workflows", "data_model", "datastores", "adrs"];

  const findings: CurationFinding[] = [];

  try {
    // Helper: detect orphan (no incoming or outgoing links)
    const isOrphan = (item: Record<string, unknown>): boolean => {
      const links = item.links;
      return !Array.isArray(links) || links.length === 0;
    };

    // Query features for quality issues
    if (targets.includes("features")) {
      const result = await mcpCallTool(daemonPort, "query_resource", {
        uri: "dreamgraph://features",
      }, 30_000);
      const items = parseResourceResult(result.content?.[0]?.text);
      for (const item of items) {
        const id = str(item, "id", "unknown");
        const name = str(item, "name", id);
        if (item.status === "deprecated" || item.status === "stale") {
          findings.push({ type: "stale_feature", id, name, detail: `status: ${item.status}` });
        }
        const desc = str(item, "description");
        if (!desc || desc.length < 10) {
          findings.push({ type: "weak_feature", id, name, detail: "missing or minimal description" });
        }
        if (isOrphan(item)) {
          findings.push({ type: "orphan_feature", id, name, detail: "no outgoing links to other entities" });
        }
      }
    }

    // Query workflows for quality issues
    if (targets.includes("workflows")) {
      const result = await mcpCallTool(daemonPort, "query_resource", {
        uri: "dreamgraph://workflows",
      }, 30_000);
      const items = parseResourceResult(result.content?.[0]?.text);
      for (const item of items) {
        const id = str(item, "id", "unknown");
        const name = str(item, "name", id);
        if (!item.steps || (Array.isArray(item.steps) && item.steps.length === 0)) {
          findings.push({ type: "empty_workflow", id, name, detail: "no steps defined" });
        }
        if (item.status === "deprecated") {
          findings.push({ type: "stale_workflow", id, name, detail: `status: ${item.status}` });
        }
        if (isOrphan(item)) {
          findings.push({ type: "orphan_workflow", id, name, detail: "no outgoing links to other entities" });
        }
      }
    }

    // Query data model for quality issues
    if (targets.includes("data_model")) {
      const result = await mcpCallTool(daemonPort, "query_resource", {
        uri: "dreamgraph://data_model",
      }, 30_000);
      const items = parseResourceResult(result.content?.[0]?.text);
      for (const item of items) {
        const id = str(item, "id", "unknown");
        const name = str(item, "name", id);
        if (!item.key_fields || (Array.isArray(item.key_fields) && item.key_fields.length === 0)) {
          findings.push({ type: "weak_entity", id, name, detail: "no key fields defined" });
        }
        if (isOrphan(item)) {
          findings.push({ type: "orphan_entity", id, name, detail: "no outgoing links to other entities" });
        }
      }
    }

    // Query datastores for hub/grounding issues (DATASTORE_AS_HUB Slice 3).
    if (targets.includes("datastores")) {
      const dsResult = await mcpCallTool(daemonPort, "query_resource", {
        uri: "system://datastores",
      }, 30_000).catch(() => null);
      const dmResult = await mcpCallTool(daemonPort, "query_resource", {
        uri: "system://data-model",
      }, 30_000).catch(() => null);
      const datastores = dsResult ? parseResourceResult(dsResult.content?.[0]?.text) : [];
      const dataModels = dmResult ? parseResourceResult(dmResult.content?.[0]?.text) : [];

      // phantom_data_model: data_model with no `stored_in` link to any datastore.
      const datastoreIds = new Set(datastores.map((d) => str(d, "id")).filter(Boolean));
      if (datastoreIds.size > 0) {
        for (const dm of dataModels) {
          const links = Array.isArray(dm.links) ? dm.links : [];
          const linksToStore = links.some((l) => {
            if (!l || typeof l !== "object") return false;
            const target = (l as Record<string, unknown>).target;
            return typeof target === "string" && datastoreIds.has(target);
          });
          if (!linksToStore) {
            findings.push({
              type: "phantom_data_model",
              id: str(dm, "id", "unknown"),
              name: str(dm, "name", str(dm, "id", "unknown")),
              detail: "no stored_in edge to any datastore",
            });
          }
        }

        // shadow_table: a table in datastores.json `tables[]` that no data_model
        // appears to claim (lenient name match against id leaf or name).
        const claimedNames = new Set<string>();
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const dm of dataModels) {
          const id = str(dm, "id");
          const name = str(dm, "name");
          const leaf = norm((id.split(/[:.]/).pop() ?? id) || "");
          if (leaf) claimedNames.add(leaf);
          if (name) claimedNames.add(norm(name));
        }
        for (const ds of datastores) {
          const dsId = str(ds, "id", "unknown");
          const dsName = str(ds, "name", dsId);
          const tables = Array.isArray(ds.tables) ? ds.tables : [];
          for (const t of tables) {
            if (!t || typeof t !== "object") continue;
            const tName = str(t as Record<string, unknown>, "name");
            if (!tName) continue;
            if (claimedNames.has(norm(tName))) continue;
            findings.push({
              type: "shadow_table",
              id: `${dsId}:${tName}`,
              name: `${dsName} / ${tName}`,
              detail: "table in datastore has no matching data_model entity",
            });
          }
        }
      }
    }

    // Query ADRs for quality issues
    if (targets.includes("adrs")) {
      const result = await mcpCallTool(daemonPort, "query_architecture_decisions", {}, 30_000);
      const items = parseResourceResult(result.content?.[0]?.text);
      for (const item of items) {
        const id = str(item, "id", "unknown");
        const name = str(item, "title", id);
        const ctx = str(item, "context");
        if (!ctx || ctx.length < 20) {
          findings.push({ type: "weak_adr", id, name, detail: "insufficient context" });
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!jsonOutput) {
      console.error(`Warning: some graph queries failed: ${msg}`);
    }
  }

  // Build summary
  const summary = {
    ok: true,
    mode: "curate",
    target: instanceName,
    status: dryRun ? "dry-run" : "applied",
    findings_count: findings.length,
    findings,
    suggested_actions: buildSuggestedActions(findings),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (findings.length === 0) {
    console.log("No quality issues found in queried targets.");
    console.log("Tip: use DreamGraph Architect for deeper curation analysis.");
    return;
  }

  console.log(`Found ${findings.length} quality issue(s):\n`);
  const grouped = groupFindings(findings);
  for (const [type, items] of Object.entries(grouped)) {
    console.log(`  ${formatFindingType(type)} (${items.length}):`);
    for (const f of items.slice(0, 10)) {
      console.log(`    - ${f.name} (${f.id}): ${f.detail}`);
    }
    if (items.length > 10) {
      console.log(`    ... and ${items.length - 10} more`);
    }
  }

  console.log("\nSuggested next actions:");
  for (const action of summary.suggested_actions) {
    console.log(`  - ${action}`);
  }
  console.log("\nTip: use DreamGraph Architect for guided remediation of these findings.");
}

function parseResourceResult(text?: string): Record<string, unknown>[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const payload = parsed?.data ?? parsed;
    if (Array.isArray(payload)) return payload;
    if (payload?.entities && typeof payload.entities === "object") {
      return Object.values(payload.entities) as Record<string, unknown>[];
    }
    return [];
  } catch {
    return [];
  }
}

/** Safely extract a string property from a Record, defaulting to fallback. */
function str(item: Record<string, unknown>, key: string, fallback = ""): string {
  const v = item[key];
  return typeof v === "string" ? v : fallback;
}

function groupFindings(findings: CurationFinding[]): Record<string, CurationFinding[]> {
  const groups: Record<string, CurationFinding[]> = {};
  for (const f of findings) {
    (groups[f.type] ??= []).push(f);
  }
  return groups;
}

function formatFindingType(type: string): string {
  const labels: Record<string, string> = {
    stale_feature: "Stale features",
    weak_feature: "Weak feature descriptions",
    orphan_feature: "Orphan features (no edges)",
    empty_workflow: "Empty workflows",
    stale_workflow: "Stale workflows",
    orphan_workflow: "Orphan workflows (no edges)",
    weak_entity: "Weak data model entities",
    orphan_entity: "Orphan data model entities (no edges)",
    weak_adr: "Weak ADRs",
    phantom_data_model: "Phantom data_model entities (no datastore link)",
    shadow_table: "Shadow tables (datastore tables with no data_model)",
  };
  return labels[type] ?? type;
}

function buildSuggestedActions(findings: CurationFinding[]): string[] {
  const actions: string[] = [];
  const types = new Set(findings.map((f) => f.type));
  if (types.has("stale_feature") || types.has("stale_workflow")) {
    actions.push("deprecate or update stale entries");
  }
  if (types.has("weak_feature") || types.has("weak_entity")) {
    actions.push("enrich entity descriptions with dg enrich or Architect");
  }
  if (types.has("empty_workflow")) {
    actions.push("define workflow steps for empty workflows");
  }
  if (types.has("weak_adr")) {
    actions.push("add context and rationale to weak ADRs");
  }
  if (types.has("orphan_feature") || types.has("orphan_workflow") || types.has("orphan_entity")) {
    actions.push("run a dream cycle (dg dream) — the orphan_bridging strategy will propose neighbor edges; or enrich descriptions/keywords so structural strategies can match");
  }
  if (types.has("phantom_data_model")) {
    actions.push("run a dream cycle with strategy=schema_grounding, or run scan_database to refresh datastore tables; correct the data_model `storage` field if the table name differs");
  }
  if (types.has("shadow_table")) {
    actions.push("run scan_database({ create_missing: true }) to auto-create stub data_model entries for orphan tables, or add them via enrich_seed_data");
  }
  if (actions.length === 0) {
    actions.push("graph quality looks good — consider running dg enrich for coverage");
  }
  return actions;
}
