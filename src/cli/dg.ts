#!/usr/bin/env node

/**
 * DreamGraph CLI — `dg` command.
 *
 * Instance lifecycle management from the terminal.
 *
 * Usage:
 *   dg init [--name <name>] [--policy <strict|balanced|creative>] [--project <path>]
 *   dg attach <project-root> [--instance <uuid>]
 *   dg detach [--instance <uuid>]
 *   dg instances [list] [--status <active|archived>]
 *   dg instances switch <uuid|name>
 *   dg status [--instance <uuid>]
 *   dg archive <uuid|name>
 *   dg destroy <uuid|name> [--confirm]
 *   dg export <uuid|name> --format <snapshot|docs|archetypes>
 *   dg fork <source-uuid|name> [--name <name>]
 *   dg migrate [--source <dataDir>] [--name <name>]
 */

import { cmdInit } from "./commands/init.js";
import { cmdAttach, cmdDetach } from "./commands/attach.js";
import { cmdInstancesList, cmdInstancesSwitch } from "./commands/instances.js";
import { cmdStatus } from "./commands/status.js";
import { cmdArchive, cmdDestroy } from "./commands/lifecycle-ops.js";
import { cmdExport } from "./commands/export.js";
import { cmdFork } from "./commands/fork.js";
import { cmdMigrate } from "./commands/migrate.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function printUsage(): void {
  console.log(`
DreamGraph CLI — Instance Management (v6.0 La Catedral)

Usage:
  dg <command> [options]

Commands:
  init                        Create a new DreamGraph instance
  attach <project-root>       Bind an instance to a project directory
  detach                      Unbind an instance from its project
  instances [list]            List all known instances
  instances switch <query>    Set the active instance for the current shell
  status                      Show instance cognitive state
  archive <query>             Mark an instance as archived
  destroy <query> [--confirm] Permanently delete an instance
  export <query> --format <f> Export instance data (snapshot|docs|archetypes)
  fork <query> [--name <n>]   Fork an instance (copy all data)
  migrate                     Migrate legacy flat data/ to a UUID instance

Options:
  --help, -h                  Show this help message
  --version, -v               Show version

Run 'dg <command> --help' for command-specific options.
`);
}

function printVersion(): void {
  console.log("DreamGraph CLI v6.0.0 (La Catedral)");
}

/* ------------------------------------------------------------------ */
/*  Argument tokenizer                                                */
/* ------------------------------------------------------------------ */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/* ------------------------------------------------------------------ */
/*  Router                                                            */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { positional, flags } = parseCliArgs(args);

  if (flags.version || flags.v) {
    printVersion();
    process.exit(0);
  }

  const command = positional[0];

  if (!command || ((flags.help || flags.h) && !command)) {
    printUsage();
    process.exit(0);
  }

  try {
    switch (command) {
      case "help":
        printUsage();
        break;

      case "init":
        await cmdInit(positional.slice(1), flags);
        break;

      case "attach":
        await cmdAttach(positional.slice(1), flags);
        break;

      case "detach":
        await cmdDetach(positional.slice(1), flags);
        break;

      case "instances": {
        const sub = positional[1];
        if (sub === "switch") {
          await cmdInstancesSwitch(positional.slice(2), flags);
        } else {
          // default: list
          await cmdInstancesList(positional.slice(1), flags);
        }
        break;
      }

      case "status":
        await cmdStatus(positional.slice(1), flags);
        break;

      case "archive":
        await cmdArchive(positional.slice(1), flags);
        break;

      case "destroy":
        await cmdDestroy(positional.slice(1), flags);
        break;

      case "export":
        await cmdExport(positional.slice(1), flags);
        break;

      case "fork":
        await cmdFork(positional.slice(1), flags);
        break;

      case "migrate":
        await cmdMigrate(positional.slice(1), flags);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error(`Run 'dg --help' for available commands.`);
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

main();
