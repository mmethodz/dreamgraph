/**
 * DreamGraph MCP Server — Code Senses tools.
 *
 * Gives the AI the ability to read source code and browse directory
 * structures across the configured repository workspaces.
 *
 * Security: All paths are resolved against known workspace roots
 * (config.repos). Traversal outside these boundaries is rejected.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolResponse } from "../types/index.js";

// ---------------------------------------------------------------------------
// Allowed workspace roots — derived from config.repos
// ---------------------------------------------------------------------------

/**
 * Build the list of allowed roots. Each root is normalised to a
 * forward-slash, lower-cased absolute path for safe prefix comparison.
 */
function getAllowedRoots(): string[] {
  return Object.values(config.repos).map((p) =>
    path.resolve(p).toLowerCase()
  );
}

/**
 * Resolve a user-supplied path and ensure it falls inside one of the
 * configured repo roots. Throws on path-traversal attempts.
 */
function resolveSafePath(requestedPath: string): string {
  const roots = getAllowedRoots();

  // If the requested path is already absolute, use it directly
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : null;

  // Check against every allowed root
  for (const root of roots) {
    const abs = candidate ?? path.resolve(
      Object.values(config.repos).find(
        (r) => r.toLowerCase() === root
      )!,
      requestedPath
    );

    if (abs.toLowerCase().startsWith(root)) {
      return abs;
    }
  }

  // Also try resolving relative to each root (user might omit repo prefix)
  if (!candidate) {
    for (const repoPath of Object.values(config.repos)) {
      const abs = path.resolve(repoPath, requestedPath);
      if (abs.toLowerCase().startsWith(repoPath.toLowerCase())) {
        return abs;
      }
    }
  }

  throw new Error(
    `Access denied: Path '${requestedPath}' is outside all configured workspaces.`
  );
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCodeSensesTools(server: McpServer): void {
  const repoNames = Object.keys(config.repos);
  const repoDesc = repoNames.length > 0
    ? `Repository name. Available: ${repoNames.map(r => `"${r}"`).join(", ")}. Path is resolved relative to this repo root.`
    : "Repository name (none currently configured). Path is resolved relative to repo root.";

  // =========================================================================
  // list_directory — Browse workspace directories
  // =========================================================================
  server.tool(
    "list_directory",
    "List files and directories at the given path. Use this to discover the right source files. " +
      "Path can be relative to any configured repo, or absolute. " +
      "Returns the name and type (file/directory) for each entry.",
    {
      dirPath: z
        .string()
        .describe(
          "Directory path relative to the project root (e.g. 'src/server') " +
            "or an absolute path. Empty string lists the repo root."
        ),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ dirPath, repo }) => {
      logger.debug(
        `list_directory called: dirPath="${dirPath}", repo="${repo ?? "(auto)"}"`
      );

      const result = await safeExecute<DirectoryEntry[]>(
        async (): Promise<ToolResponse<DirectoryEntry[]>> => {
          let safePath: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error(
                "INVALID_REPO",
                `Repo "${repo}" not found. Available repos: ${available}`
              );
            }
            const repoRoot = path.resolve(repoRootRaw);
            const abs = path.resolve(repoRoot, dirPath || ".");
            if (
              !abs
                .toLowerCase()
                .startsWith(repoRoot.toLowerCase())
            ) {
              return error(
                "ACCESS_DENIED",
                `Path '${dirPath}' escapes repo "${repo}" root.`
              );
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(dirPath || ".");
            } catch (err) {
              return error(
                "ACCESS_DENIED",
                err instanceof Error ? err.message : String(err)
              );
            }
          }

          try {
            const entries = await fs.readdir(safePath, {
              withFileTypes: true,
            });
            const items: DirectoryEntry[] = entries.map((e) => ({
              name: e.name,
              isDirectory: e.isDirectory(),
            }));
            return success(items);
          } catch (err: unknown) {
            const msg =
              err instanceof Error ? err.message : String(err);
            return error("READ_ERROR", `Error reading directory: ${msg}`);
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
  // read_source_code — Read a source file
  // =========================================================================
  server.tool(
    "read_source_code",
    "Read and return the contents of a source code file. Use this to validate " +
      "how things are actually implemented. File contents are returned in a markdown code block.",
    {
      filePath: z
        .string()
        .describe(
          "File path relative to the project root " +
            "(e.g. 'src/server/webhooks/maventa.ts') or an absolute path."
        ),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Start line (1-based). If provided, returns only a portion of the file."
        ),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "End line (1-based, inclusive). If provided together with startLine, returns only that range."
        ),
    },
    async ({ filePath, repo, startLine, endLine }) => {
      logger.debug(
        `read_source_code called: filePath="${filePath}", repo="${repo ?? "(auto)"}"`
      );

      const result = await safeExecute<string>(
        async (): Promise<ToolResponse<string>> => {
          let safePath: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error(
                "INVALID_REPO",
                `Repo "${repo}" not found. Available repos: ${available}`
              );
            }
            const repoRoot = path.resolve(repoRootRaw);
            const abs = path.resolve(repoRoot, filePath);
            if (
              !abs
                .toLowerCase()
                .startsWith(repoRoot.toLowerCase())
            ) {
              return error(
                "ACCESS_DENIED",
                `Path '${filePath}' escapes repo "${repo}" root.`
              );
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(filePath);
            } catch (err) {
              return error(
                "ACCESS_DENIED",
                err instanceof Error ? err.message : String(err)
              );
            }
          }

          try {
            let content = await fs.readFile(safePath, "utf-8");

            // Optional line-range slicing
            if (startLine !== undefined) {
              const lines = content.split("\n");
              const start = startLine - 1; // 0-indexed
              const end = endLine !== undefined ? endLine : lines.length;
              content = lines.slice(start, end).join("\n");
            }

            // Detect language from extension for syntax highlighting
            const ext = path.extname(filePath).replace(".", "");
            const langMap: Record<string, string> = {
              ts: "typescript",
              tsx: "tsx",
              js: "javascript",
              jsx: "jsx",
              json: "json",
              css: "css",
              scss: "scss",
              html: "html",
              md: "markdown",
              sql: "sql",
              sh: "bash",
              yml: "yaml",
              yaml: "yaml",
              env: "dotenv",
            };
            const lang = langMap[ext] ?? ext;

            const lineInfo =
              startLine !== undefined
                ? ` (lines ${startLine}–${endLine ?? "EOF"})`
                : "";

            const formatted = `\`\`\`${lang}\n// ${filePath}${lineInfo}\n${content}\n\`\`\``;
            return success(formatted);
          } catch (err: unknown) {
            const msg =
              err instanceof Error ? err.message : String(err);
            return error("READ_ERROR", `Error reading file: ${msg}`);
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
  // create_file — Create or overwrite a file inside a workspace
  // =========================================================================
  server.tool(
    "create_file",
    "Create a new file or overwrite an existing file inside a configured repository. " +
      "Creates missing parent directories automatically. Path must be within a " +
      "configured repo (security boundary).",
    {
      filePath: z
        .string()
        .describe(
          "File path relative to the repository root " +
            "(e.g. 'src/utils/helpers.ts') or an absolute path."
        ),
      content: z
        .string()
        .describe("File content to write."),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ filePath: reqPath, content, repo }) => {
      logger.debug(
        `create_file called: filePath="${reqPath}", repo="${repo ?? "(auto)"}", bytes=${content.length}`
      );

      const result = await safeExecute<string>(
        async (): Promise<ToolResponse<string>> => {
          let safePath: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error(
                "INVALID_REPO",
                `Repo "${repo}" not found. Available repos: ${available}`
              );
            }
            const repoRoot = path.resolve(repoRootRaw);
            const abs = path.resolve(repoRoot, reqPath);
            if (
              !abs
                .toLowerCase()
                .startsWith(repoRoot.toLowerCase())
            ) {
              return error(
                "ACCESS_DENIED",
                `Path '${reqPath}' escapes repo "${repo}" root.`
              );
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(reqPath);
            } catch (err) {
              return error(
                "ACCESS_DENIED",
                err instanceof Error ? err.message : String(err)
              );
            }
          }

          try {
            // Ensure parent directory exists
            const dir = path.dirname(safePath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(safePath, content, "utf-8");
            return success(`File created: ${safePath} (${content.length} bytes)`);
          } catch (err: unknown) {
            const msg =
              err instanceof Error ? err.message : String(err);
            return error("WRITE_ERROR", `Error creating file: ${msg}`);
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

  logger.info("Registered 3 code-senses tools (list_directory, read_source_code, create_file)");
}
