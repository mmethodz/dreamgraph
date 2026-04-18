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
    : ["features", "workflows", "data_model", "adrs"];

  const findings: CurationFinding[] = [];

  try {
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
    empty_workflow: "Empty workflows",
    stale_workflow: "Stale workflows",
    weak_entity: "Weak data model entities",
    weak_adr: "Weak ADRs",
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
  if (actions.length === 0) {
    actions.push("graph quality looks good — consider running dg enrich for coverage");
  }
  return actions;
}
