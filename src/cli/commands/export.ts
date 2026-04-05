/**
 * `dg export` — Export instance data in various formats.
 *
 * Usage:
 *   dg export <uuid|name> --format <snapshot|docs|archetypes>
 */

import { resolve } from "node:path";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadRegistry,
  findInstance,
  resolveMasterDir,
} from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

type ExportFormat = "snapshot" | "docs" | "archetypes";
const VALID_FORMATS: ExportFormat[] = ["snapshot", "docs", "archetypes"];

export async function cmdExport(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg export — Export instance data

Usage:
  dg export <uuid|name> --format <format>

Formats:
  snapshot      Full JSON snapshot of all data files
  docs          Living documentation export
  archetypes    Dream archetype patterns export

Options:
  --output <path>       Output file path (default: ./export-<format>-<timestamp>.json)
  --master-dir <path>   Override master directory
`);
    return;
  }

  const query = positional[0];
  if (!query) {
    console.error("Missing required argument: <uuid|name>");
    console.error("Usage: dg export <uuid|name> --format <snapshot|docs|archetypes>");
    process.exit(1);
  }

  const format = typeof flags.format === "string" ? flags.format : undefined;
  if (!format || !VALID_FORMATS.includes(format as ExportFormat)) {
    console.error(
      `Missing or invalid --format. Must be one of: ${VALID_FORMATS.join(", ")}`,
    );
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const entry = findInstance(registry, query);
  if (!entry) {
    console.error(`Instance not found: ${query}`);
    process.exit(1);
  }

  const dir = masterDir ?? resolveMasterDir();
  const instanceRoot = resolve(dir, entry.uuid);
  const dataDir = resolve(instanceRoot, "data");
  const exportsDir = resolve(instanceRoot, "exports");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOutput = resolve(
    exportsDir,
    `${format}-${timestamp}.json`,
  );
  const outputPath =
    typeof flags.output === "string" ? resolve(flags.output) : defaultOutput;

  // Ensure exports dir exists
  if (!existsSync(exportsDir)) {
    await mkdir(exportsDir, { recursive: true });
  }

  switch (format as ExportFormat) {
    case "snapshot":
      await exportSnapshot(dataDir, instanceRoot, entry.uuid, outputPath);
      break;
    case "docs":
      await exportDocs(dataDir, entry.uuid, outputPath);
      break;
    case "archetypes":
      await exportArchetypes(dataDir, entry.uuid, outputPath);
      break;
  }
}

/* ------------------------------------------------------------------ */
/*  Export implementations                                            */
/* ------------------------------------------------------------------ */

async function exportSnapshot(
  dataDir: string,
  instanceRoot: string,
  uuid: string,
  outputPath: string,
): Promise<void> {
  const snapshot: Record<string, unknown> = {
    export_type: "snapshot",
    instance_uuid: uuid,
    exported_at: new Date().toISOString(),
    data: {},
  };

  if (existsSync(dataDir)) {
    const files = await readdir(dataDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const raw = await readFile(resolve(dataDir, file), "utf-8");
          (snapshot.data as Record<string, unknown>)[file] = JSON.parse(raw);
        } catch {
          (snapshot.data as Record<string, unknown>)[file] = "[parse error]";
        }
      }
    }
  }

  // Also include instance.json
  try {
    const raw = await readFile(resolve(instanceRoot, "instance.json"), "utf-8");
    snapshot.instance = JSON.parse(raw);
  } catch {
    // skip
  }

  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`✓ Snapshot exported to ${outputPath}`);
}

async function exportDocs(
  dataDir: string,
  uuid: string,
  outputPath: string,
): Promise<void> {
  const docs: Record<string, unknown> = {
    export_type: "docs",
    instance_uuid: uuid,
    exported_at: new Date().toISOString(),
    documentation: {},
  };

  // Extract documentation-relevant data
  const docFiles = [
    "system_overview.json",
    "features.json",
    "workflows.json",
    "data_model.json",
    "capabilities.json",
    "adr_log.json",
    "system_story.json",
  ];

  for (const file of docFiles) {
    const p = resolve(dataDir, file);
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, "utf-8");
        (docs.documentation as Record<string, unknown>)[file] = JSON.parse(raw);
      } catch {
        // skip
      }
    }
  }

  await writeFile(outputPath, JSON.stringify(docs, null, 2), "utf-8");
  console.log(`✓ Living docs exported to ${outputPath}`);
}

async function exportArchetypes(
  dataDir: string,
  uuid: string,
  outputPath: string,
): Promise<void> {
  const result: Record<string, unknown> = {
    export_type: "archetypes",
    instance_uuid: uuid,
    exported_at: new Date().toISOString(),
    archetypes: [],
    dream_history: null,
  };

  const archetypesPath = resolve(dataDir, "dream_archetypes.json");
  if (existsSync(archetypesPath)) {
    try {
      const raw = await readFile(archetypesPath, "utf-8");
      result.archetypes = JSON.parse(raw);
    } catch {
      // skip
    }
  }

  const historyPath = resolve(dataDir, "dream_history.json");
  if (existsSync(historyPath)) {
    try {
      const raw = await readFile(historyPath, "utf-8");
      result.dream_history = JSON.parse(raw);
    } catch {
      // skip
    }
  }

  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`✓ Dream archetypes exported to ${outputPath}`);
}
