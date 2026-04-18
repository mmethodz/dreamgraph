/**
 * `dg enrich` — High-level graph coverage operation.
 *
 * Current implementation is a product-facing alias over `dg scan`
 * with guidance oriented toward coverage expansion.
 */

import type { ParsedArgs } from "../dg.js";
import { cmdScan } from "./scan.js";

export async function cmdEnrich(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg enrich — Expand graph coverage

Usage:
  dg enrich <uuid|name> [options]

This is the high-level graph coverage command. It currently delegates to
'dg scan' while framing the operation as enrichment.

Recommended use:
- use DreamGraph Architect for guided graph creation and multi-pass enrichment
- use 'dg enrich' when you want to expand graph coverage from the CLI

Options:
  --depth <shallow|deep>    Scan depth (default: deep)
  --targets <list>          Comma-separated: features,workflows,data_model
  --json                    Output raw JSON result
  --master-dir <path>       Override master directory
`);
    return;
  }

  if (flags.json !== true) {
    console.log("Graph operation: enrich");
    console.log("Goal: expand graph coverage.");
    console.log("Tip: for comprehensive multi-pass graph creation, use DreamGraph Architect.\n");
  }

  await cmdScan(positional, flags);
}
