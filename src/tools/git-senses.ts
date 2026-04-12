/**
 * DreamGraph MCP Server - Git Senses tools.
 *
 * Gives the AI agent the ability to inspect git history:
 *   - git_log:   commit history for a file or directory
 *   - git_blame: per-line authorship for a file
 *
 * These tools resolve the agent's key blind-spot: "I see WHAT is in
 * the code, but not WHY." Commit messages and blame data let the
 * cognitive engine close tensions that source code alone cannot.
 *
 * Security: All paths are resolved against config.repos roots.
 * Only read-only git commands are executed (log, blame).
 * No write flags are ever passed.
 *
 * READ-ONLY: These tools only read from git history.
 * They do NOT modify any files or repositories.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolResponse } from "../types/index.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Max output from git commands (512 KB) */
const MAX_OUTPUT_BYTES = 512 * 1024;

/** Timeout for git commands (10 s) */
const GIT_TIMEOUT_MS = 10_000;

/**
 * Resolve a repo name to its root path, or return an error response.
 */
function resolveRepo(repo: string): { root: string } | { err: ReturnType<typeof error> } {
  const root = config.repos[repo];
  if (!root) {
    const available = Object.keys(config.repos).join(", ");
    return { err: error("INVALID_REPO", "Repo '" + repo + "' not found. Available: " + available) };
  }
  return { root };
}

/**
 * Validate that a relative path doesn't escape the repo root.
 */
function safePath(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  if (!abs.toLowerCase().startsWith(root.toLowerCase())) {
    throw new Error("Access denied: path '" + relPath + "' escapes repo root.");
  }
  return relPath; // git commands use relative paths from cwd
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface GitBlameLine {
  hash: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Git output parsers
// ---------------------------------------------------------------------------

/**
 * Parse `git log` output with a custom format.
 * Format: COMMIT_SEP\nhash\nauthor\ndate\nmessage (may be multiline)
 */
const COMMIT_SEP = "---COMMIT---";
const LOG_FORMAT = COMMIT_SEP + "%n%H%n%an%n%aI%n%B";

function parseGitLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const blocks = raw.split(COMMIT_SEP).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 4) continue;

    commits.push({
      hash: lines[0].trim(),
      author: lines[1].trim(),
      date: lines[2].trim(),
      message: lines.slice(3).join("\n").trim(),
    });
  }

  return commits;
}

/**
 * Parse `git blame --porcelain` output into structured lines.
 */
function parseGitBlame(raw: string): GitBlameLine[] {
  const result: GitBlameLine[] = [];
  const lines = raw.split("\n");

  let currentHash = "";
  let currentAuthor = "";
  let currentDate = "";
  let currentLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A porcelain block starts with a 40-char hash followed by line numbers
    const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
    if (headerMatch) {
      currentHash = headerMatch[1];
      currentLineNum = parseInt(headerMatch[3], 10);
      continue;
    }

    if (line.startsWith("author ")) {
      currentAuthor = line.slice(7);
      continue;
    }

    if (line.startsWith("author-time ")) {
      const ts = parseInt(line.slice(12), 10);
      currentDate = new Date(ts * 1000).toISOString();
      continue;
    }

    // Content line starts with a tab
    if (line.startsWith("\t")) {
      result.push({
        hash: currentHash.slice(0, 8), // short hash for readability
        author: currentAuthor,
        date: currentDate,
        lineNumber: currentLineNum,
        content: line.slice(1), // remove leading tab
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGitSensesTools(server: McpServer): void {
  const repoNames = Object.keys(config.repos);
  const repoDesc = repoNames.length > 0
    ? `Repository name. Available: ${repoNames.map(r => `"${r}"`).join(", ")}.`
    : "Repository name (none currently configured — set DREAMGRAPH_REPOS or attach a project).";

  // =========================================================================
  // git_log - Commit history
  // =========================================================================
  server.tool(
    "git_log",
    "Show git commit history for a file or directory. " +
      "Returns structured commit objects with hash, author, date, and message. " +
      "Use this to understand WHY code was written - not just what it does. " +
      "Supports --follow to track file renames.",
    {
      repo: z
        .string()
        .describe(repoDesc),
      path: z
        .string()
        .optional()
        .describe(
          "File or directory path relative to repo root " +
            "(e.g. 'src/server/webhooks/maventa.ts'). " +
            "If omitted, shows history for entire repo."
        ),
      maxCount: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Maximum number of commits to return (default: 20, max: 100)."
        ),
      follow: z
        .boolean()
        .optional()
        .describe(
          "Track file renames (default: true). Only works with single file paths."
        ),
    },
    async ({ repo, path: filePath, maxCount, follow }) => {
      const limit = maxCount ?? 20;
      const doFollow = follow ?? true;

      logger.info(
        "git_log called: repo=" + repo +
        ", path=" + (filePath ?? "(all)") +
        ", maxCount=" + limit
      );

      const result = await safeExecute<{ commits: GitCommit[] }>(
        async (): Promise<ToolResponse<{ commits: GitCommit[] }>> => {
          const resolved = resolveRepo(repo);
          if ("err" in resolved) return resolved.err;
          const { root } = resolved;

          // Build git args
          // Note: --no-pager is a global git flag, not a log subcommand flag.
          // Since we use execFile (no TTY), git won't paginate anyway.
          const args = [
            "log",
            "--format=" + LOG_FORMAT,
            "-n",
            String(limit),
          ];

          if (filePath) {
            try {
              safePath(root, filePath);
            } catch (err) {
              return error(
                "ACCESS_DENIED",
                err instanceof Error ? err.message : String(err)
              );
            }

            if (doFollow) {
              args.push("--follow");
            }
            args.push("--", filePath);
          }

          try {
            const { stdout } = await execFileAsync("git", args, {
              cwd: root,
              timeout: GIT_TIMEOUT_MS,
              maxBuffer: MAX_OUTPUT_BYTES,
              windowsHide: true,
            });

            const commits = parseGitLog(stdout);
            return success({ commits });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return error("GIT_ERROR", "git log failed: " + msg);
          }
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // git_blame - Per-line authorship
  // =========================================================================
  server.tool(
    "git_blame",
    "Show per-line authorship (git blame) for a file. " +
      "Returns structured entries with commit hash, author, date, line number, " +
      "and content. Use this to determine WHO wrote specific code and WHEN - " +
      "essential for understanding whether something was intentional or accidental.",
    {
      repo: z
        .string()
        .describe(repoDesc),
      filePath: z
        .string()
        .describe(
          "File path relative to repo root " +
            "(e.g. 'src/server/webhooks/maventa.ts')."
        ),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Start line (1-based). If given, only blames this range."),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("End line (1-based, inclusive). Used with startLine."),
    },
    async ({ repo, filePath, startLine, endLine }) => {
      logger.info(
        "git_blame called: repo=" + repo +
        ", filePath=" + filePath +
        (startLine ? ", L" + startLine + "-" + (endLine ?? "EOF") : "")
      );

      const result = await safeExecute<{ lines: GitBlameLine[] }>(
        async (): Promise<ToolResponse<{ lines: GitBlameLine[] }>> => {
          const resolved = resolveRepo(repo);
          if ("err" in resolved) return resolved.err;
          const { root } = resolved;

          try {
            safePath(root, filePath);
          } catch (err) {
            return error(
              "ACCESS_DENIED",
              err instanceof Error ? err.message : String(err)
            );
          }

          // Build git blame args
          const args = ["blame", "--porcelain"];

          if (startLine !== undefined) {
            const end = endLine ?? startLine;
            args.push("-L", startLine + "," + end);
          }

          args.push("--", filePath);

          try {
            const { stdout } = await execFileAsync("git", args, {
              cwd: root,
              timeout: GIT_TIMEOUT_MS,
              maxBuffer: MAX_OUTPUT_BYTES,
              windowsHide: true,
            });

            const blameLines = parseGitBlame(stdout);
            return success({ lines: blameLines });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("no such path")) {
              return error("NOT_FOUND", "File not found in git: " + filePath);
            }
            return error("GIT_ERROR", "git blame failed: " + msg);
          }
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 2 git-senses tools (git_log, git_blame)");
}
