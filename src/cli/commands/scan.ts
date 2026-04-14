/**
 * `dg scan` — Trigger a project scan on a running instance.
 *
 * Calls the `scan_project` MCP tool on the daemon via Streamable HTTP.
 * The daemon must be running (`dg start <instance>`).
 *
 * Usage:
 *   dg scan <uuid|name> [--depth shallow|deep] [--targets features,workflows,data_model]
 */

import { resolve } from "node:path";
import type { ParsedArgs } from "../dg.js";
import {
  resolveInstanceForCommand,
  readServerMeta,
  isProcessAlive,
} from "../utils/daemon.js";
import { mcpCallTool } from "../utils/mcp-call.js";

export async function cmdScan(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg scan — Trigger a project scan on a running instance

Usage:
  dg scan <uuid|name> [options]

Calls the scan_project MCP tool on the running daemon.  The instance
must be started first with 'dg start <instance>'.

Options:
  --depth <shallow|deep>    Scan depth (default: deep)
  --targets <list>          Comma-separated: features,workflows,data_model
  --json                    Output raw JSON result
  --master-dir <path>       Override master directory
`);
    return;
  }

  const query = positional[0];
  const jsonOutput = flags.json === true;

  // 1. Resolve instance
  const { entry, instanceRoot } = await resolveInstanceForCommand(query, flags);

  // 2. Verify daemon is running
  const meta = await readServerMeta(instanceRoot);
  if (!meta || !isProcessAlive(meta.pid) || meta.port == null) {
    console.error(
      `Instance '${entry.name}' is not running. Start it first: dg start ${entry.name}`,
    );
    process.exit(1);
  }

  // 3. Build tool arguments
  const args: Record<string, unknown> = {};

  if (typeof flags.depth === "string") {
    if (!["shallow", "deep"].includes(flags.depth)) {
      console.error(`Invalid depth: '${flags.depth}'. Use 'shallow' or 'deep'.`);
      process.exit(1);
    }
    args.depth = flags.depth;
  } else {
    args.depth = "deep";
  }

  if (typeof flags.targets === "string") {
    args.targets = flags.targets.split(",").map((t) => t.trim());
  }

  // 4. Call the scan_project tool
  if (!jsonOutput) {
    console.log(`Scanning instance '${entry.name}' (${args.depth} mode)...`);
    console.log("This may take a while if LLM enrichment is enabled.\n");
  }

  try {
    const result = await mcpCallTool(meta.port, "scan_project", args, 600_000);

    if (jsonOutput) {
      // Raw JSON output
      const text = result.content?.[0]?.text ?? "{}";
      console.log(text);
    } else {
      // Human-readable output
      const text = result.content?.[0]?.text ?? "";
      try {
        const parsed = JSON.parse(text);
        if (parsed.ok === false) {
          console.error(`Scan failed: ${parsed.error?.message ?? "unknown error"}`);
          process.exit(1);
        }

        const d = parsed.data ?? parsed;
        console.log("Scan complete!");
        console.log(`  Repos scanned:     ${d.repos_scanned ?? "?"}`);
        console.log(`  Files discovered:  ${d.files_discovered ?? "?"}`);
        console.log(`  LLM used:          ${d.llm_used ?? false}`);
        if (d.features) console.log(`  Features:          ${d.features.total ?? 0} (${d.features.inserted ?? 0} new, ${d.features.updated ?? 0} updated)`);
        if (d.workflows) console.log(`  Workflows:         ${d.workflows.total ?? 0} (${d.workflows.inserted ?? 0} new, ${d.workflows.updated ?? 0} updated)`);
        if (d.data_model) console.log(`  Data Model:        ${d.data_model.total ?? 0} (${d.data_model.inserted ?? 0} new, ${d.data_model.updated ?? 0} updated)`);
        console.log(`  Index entries:     ${d.index_entries ?? "?"}`);
        if (d.dream_cycle) {
          console.log(`  Dream edges:       ${d.dream_cycle.edges_created ?? 0} created, ${d.dream_cycle.edges_validated ?? 0} validated`);
        }
        if (d.llm_tokens_used) console.log(`  LLM tokens used:   ${d.llm_tokens_used}`);
        if (d.errors?.length > 0) {
          console.log(`\n  Warnings/Errors:`);
          for (const e of d.errors) console.log(`    - ${e}`);
        }
        console.log(`\n  ${d.message ?? ""}`);
      } catch {
        // Fallback: raw text
        console.log(text);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Scan failed: ${msg}`);
    process.exit(1);
  }
}
