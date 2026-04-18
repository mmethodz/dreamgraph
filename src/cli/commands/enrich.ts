/**
 * `dg enrich` — High-level graph coverage operation.
 *
 * Calls scan_project (deep mode by default) and enrich_seed_data on a
 * running daemon to expand graph coverage and fill description gaps.
 */

import type { ParsedArgs } from "../dg.js";
import {
  resolveInstanceForCommand,
  readServerMeta,
  isProcessAlive,
} from "../utils/daemon.js";
import { mcpCallTool } from "../utils/mcp-call.js";

export async function cmdEnrich(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg enrich — Expand graph coverage

Usage:
  dg enrich <uuid|name> [options]

Runs a deep scan followed by seed data enrichment on a running daemon.
This is a convenience command that chains scan_project + enrich_seed_data
for comprehensive graph coverage expansion.

Options:
  --depth <shallow|deep>    Scan depth (default: deep)
  --targets <list>          Comma-separated: features,workflows,data_model
  --skip-scan               Skip the scan pass, only run enrichment
  --skip-enrich             Skip enrichment, only run the scan pass
  --json                    Output raw JSON result
  --master-dir <path>       Override master directory
`);
    return;
  }

  const query = positional[0];
  const jsonOutput = flags.json === true;
  const skipScan = flags["skip-scan"] === true;
  const skipEnrich = flags["skip-enrich"] === true;

  // Resolve instance
  const { entry, instanceRoot } = await resolveInstanceForCommand(query, flags);

  // Verify daemon is running
  const meta = await readServerMeta(instanceRoot);
  if (!meta || !isProcessAlive(meta.pid) || meta.port == null) {
    console.error(
      `Instance '${entry.name}' is not running. Start it first: dg start ${entry.name}`,
    );
    process.exit(1);
  }

  const depth = typeof flags.depth === "string" && ["shallow", "deep"].includes(flags.depth)
    ? flags.depth
    : "deep";

  const results: Record<string, unknown> = {};

  // Pass 1: Scan for coverage
  if (!skipScan) {
    if (!jsonOutput) {
      console.log("Graph operation: enrich");
      console.log(`Target: ${entry.name}`);
      console.log(`Pass 1: scanning (${depth} mode)...`);
    }

    const scanArgs: Record<string, unknown> = { depth };
    if (typeof flags.targets === "string") {
      scanArgs.targets = flags.targets.split(",").map((t) => t.trim());
    }

    try {
      const scanResult = await mcpCallTool(meta.port, "scan_project", scanArgs, 600_000);
      const text = scanResult.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text);
      results.scan = parsed?.data ?? parsed;

      if (!jsonOutput) {
        const d = results.scan as Record<string, unknown>;
        console.log("  Scan complete.");
        if (d.repos_scanned) console.log(`  Repos scanned:     ${d.repos_scanned}`);
        if (d.files_discovered) console.log(`  Files discovered:  ${d.files_discovered}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!jsonOutput) {
        console.error(`  Scan failed: ${msg}`);
      }
      results.scan = { error: msg };
    }
  }

  // Pass 2: Enrich seed data (fill gaps, add descriptions)
  if (!skipEnrich) {
    if (!jsonOutput) {
      console.log(`\nPass 2: enriching seed data...`);
    }

    try {
      const enrichResult = await mcpCallTool(meta.port, "enrich_seed_data", {}, 300_000);
      const text = enrichResult.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text);
      results.enrich = parsed?.data ?? parsed;

      if (!jsonOutput) {
        const d = results.enrich as Record<string, unknown>;
        console.log("  Enrichment complete.");
        if (d.entities_enriched != null) console.log(`  Entities enriched: ${d.entities_enriched}`);
        if (d.descriptions_added != null) console.log(`  Descriptions added: ${d.descriptions_added}`);
        if (d.links_created != null) console.log(`  Links created:     ${d.links_created}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!jsonOutput) {
        console.error(`  Enrichment failed: ${msg}`);
      }
      results.enrich = { error: msg };
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ ok: true, mode: "enrich", target: entry.name, ...results }, null, 2));
    return;
  }

  console.log("\nEnrichment pipeline complete.");
  console.log("Tip: run 'dg curate' to identify remaining quality issues, or use DreamGraph Architect for multi-pass guided enrichment.");
}
