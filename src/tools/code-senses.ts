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
import { recordFileRead, recordToolCall } from "../utils/metrics.js";
import type { ToolResponse } from "../types/index.js";

// ---------------------------------------------------------------------------
// Entity extraction — find named entities (function, class, etc.) by name
// ---------------------------------------------------------------------------

interface EntityLocation {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const" | "variable";
  startLine: number; // 1-based
  endLine: number;   // 1-based, inclusive
}

/**
 * Find the line boundaries of a named entity within source code.
 * Supports: function, class, interface, type alias, enum, const/let/var
 * Uses regex + brace/bracket counting — no AST dependency.
 */
function findEntity(source: string, entityName: string): EntityLocation | null {
  const lines = source.split("\n");

  // Patterns that start an entity definition
  // We look for the entity name in common declaration patterns
  // Case-insensitive so "ArchitectLLM" matches "ArchitectLlm" etc.
  const escaped = escapeRegex(entityName);
  const patterns: Array<{ regex: RegExp; kind: EntityLocation["kind"] }> = [
    // export [async] function name / function name
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*[<(]`, "i"), kind: "function" },
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*$`, "i"), kind: "function" },
    // export class name / class name
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${escaped}[\\s<{]`, "i"), kind: "class" },
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${escaped}\\s*$`, "i"), kind: "class" },
    // export interface name / interface name
    { regex: new RegExp(`^\\s*(?:export\\s+)?interface\\s+${escaped}[\\s<{]`, "i"), kind: "interface" },
    // export type name / type name
    { regex: new RegExp(`^\\s*(?:export\\s+)?type\\s+${escaped}\\s*[<=]`, "i"), kind: "type" },
    // export enum name / enum name
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:const\\s+)?enum\\s+${escaped}[\\s{]`, "i"), kind: "enum" },
    // const/let/var name = (arrow function, object, etc.)
    { regex: new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*[=:]`, "i"), kind: "const" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, kind } of patterns) {
      if (regex.test(line)) {
        // Find optional leading decorators/JSDoc above the match
        let startIdx = i;
        // Walk backwards to include decorators (@...) and JSDoc (/** ... */)
        let j = i - 1;
        while (j >= 0) {
          const prev = lines[j].trim();
          if (prev.startsWith("@") || prev.startsWith("*") || prev.startsWith("/**") || prev === "*/") {
            startIdx = j;
            j--;
          } else if (prev === "" && j === i - 1) {
            // Skip one blank line between JSDoc and declaration
            j--;
          } else if (prev.startsWith("//")) {
            // Include preceding line comments
            startIdx = j;
            j--;
          } else {
            break;
          }
        }

        // Find the end — count braces/brackets
        const endIdx = findEntityEnd(lines, i, kind);
        return {
          name: entityName,
          kind,
          startLine: startIdx + 1,
          endLine: endIdx + 1,
        };
      }
    }
  }

  return null;
}

/** Escape special regex characters in entity names. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * From the declaration start line, find the closing line by counting
 * braces or brackets. For type aliases, find the semicolon.
 */
function findEntityEnd(lines: string[], startIdx: number, kind: EntityLocation["kind"]): number {
  if (kind === "type") {
    // Type aliases end at the first semicolon at the same or deeper nesting
    let depth = 0;
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{" || ch === "(" || ch === "<") depth++;
        if (ch === "}" || ch === ")" || ch === ">") depth--;
        if (ch === ";" && depth <= 0) return i;
      }
    }
    return Math.min(startIdx + 30, lines.length - 1);
  }

  // For function, class, interface, enum, const — count braces
  let braceDepth = 0;
  let foundFirstBrace = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        braceDepth++;
        foundFirstBrace = true;
      }
      if (ch === "}") {
        braceDepth--;
      }
    }
    // End when we close the opening brace
    if (foundFirstBrace && braceDepth <= 0) {
      return i;
    }
    // For const arrow functions that might end with a semicolon (no braces)
    if (kind === "const" && !foundFirstBrace && i > startIdx) {
      const trimmed = lines[i].trimEnd();
      if (trimmed.endsWith(";")) return i;
    }
  }

  // Fallback: return a reasonable range
  return Math.min(startIdx + 80, lines.length - 1);
}

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
    "Read source code from a file. Supports three modes:\n" +
      "1. **Entity mode** (preferred): pass `entity` to read a specific function, class, interface, type, or enum by name.\n" +
      "2. **Line range mode**: pass `startLine`/`endLine` to read a specific line range.\n" +
      "3. **Full file mode** (fallback): omit both to read the entire file.\n\n" +
      "**Always prefer entity mode** when you know the name of what you need — it returns only the relevant code, " +
      "keeping context compact. Use full file mode only for small config/data files.",
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
      entity: z
        .string()
        .optional()
        .describe(
          "Name of a code entity to extract (function, class, interface, type, enum, or const). " +
            "When provided, returns only the source code of that entity including its JSDoc/decorators. " +
            "Examples: 'registerCodeSensesTools', 'ChatPanel', 'EditorContextEnvelope'. " +
            "Overrides startLine/endLine when provided."
        ),
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
    async ({ filePath, repo, entity, startLine, endLine }) => {
      const repoLabel = repo ?? "(auto)";
      const entityTag = entity ? `, entity="${entity}"` : "";
      const lineTag = startLine ? `, lines=${startLine}-${endLine ?? "EOF"}` : "";
      logger.debug(
        "read_source_code called: filePath=\"" + filePath + "\", repo=\"" + repoLabel + "\"" + entityTag + lineTag
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
            const fullContent = await fs.readFile(safePath, "utf-8");
            let content: string;
            let lineInfo = "";

            // Entity mode — find the named entity and return only its source
            if (entity) {
              const loc = findEntity(fullContent, entity);
              if (!loc) {
                return error(
                  "ENTITY_NOT_FOUND",
                  `Entity "${entity}" not found in ${filePath}. ` +
                    "Check the name spelling or use list_directory + full file read to explore."
                );
              }
              const lines = fullContent.split("\n");
              content = lines.slice(loc.startLine - 1, loc.endLine).join("\n");
              lineInfo = ` (${loc.kind} "${entity}", lines ${loc.startLine}–${loc.endLine})`;
            }
            // Line range mode
            else if (startLine !== undefined) {
              const lines = fullContent.split("\n");
              const start = startLine - 1; // 0-indexed
              const end = endLine !== undefined ? endLine : lines.length;
              content = lines.slice(start, end).join("\n");
              lineInfo = ` (lines ${startLine}–${endLine ?? "EOF"})`;
            }
            // Full file mode
            else {
              content = fullContent;
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

            const formatted = `\`\`\`${lang}\n// ${filePath}${lineInfo}\n${content}\n\`\`\``;
            recordFileRead(filePath);
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

  // =========================================================================
  // edit_file — Find-and-replace inside an existing file
  // =========================================================================
  server.tool(
    "edit_file",
    "Edit an existing file by replacing one occurrence of `old_text` with `new_text`. " +
      "Use this for targeted, precise edits. Include enough surrounding context in " +
      "old_text (3-5 lines before and after) to uniquely identify the location. " +
      "If old_text matches zero or multiple locations, the tool fails safely. " +
      "Path must be within a configured repository.",
    {
      filePath: z
        .string()
        .describe(
          "File path relative to the repository root " +
            "(e.g. 'src/utils/helpers.ts') or an absolute path."
        ),
      old_text: z
        .string()
        .describe(
          "The exact text to find (must match exactly one location). " +
            "Include 3-5 lines of context to ensure uniqueness."
        ),
      new_text: z
        .string()
        .describe(
          "The replacement text. Use empty string to delete the matched text."
        ),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ filePath: reqPath, old_text, new_text, repo }) => {
      logger.debug(
        `edit_file called: filePath="${reqPath}", repo="${repo ?? "(auto)"}"`
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
            if (!abs.toLowerCase().startsWith(repoRoot.toLowerCase())) {
              return error("ACCESS_DENIED", `Path '${reqPath}' escapes repo "${repo}" root.`);
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(reqPath);
            } catch (err) {
              return error("ACCESS_DENIED", err instanceof Error ? err.message : String(err));
            }
          }

          // Read current content
          let content: string;
          try {
            content = await fs.readFile(safePath, "utf-8");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return error("READ_ERROR", `Cannot read file: ${msg}`);
          }

          // Count occurrences
          const occurrences = content.split(old_text).length - 1;
          if (occurrences === 0) {
            return error(
              "NOT_FOUND",
              "old_text not found in file. Make sure you're matching the exact text including whitespace and indentation."
            );
          }
          if (occurrences > 1) {
            return error(
              "AMBIGUOUS",
              `old_text matches ${occurrences} locations. Include more surrounding context to uniquely identify one location.`
            );
          }

          // Apply the replacement
          const newContent = content.replace(old_text, new_text);
          try {
            await fs.writeFile(safePath, newContent, "utf-8");
            const linesChanged = old_text.split("\n").length;
            return success(
              `Edited ${safePath}: replaced ${linesChanged} line(s). ` +
              `File size: ${content.length} → ${newContent.length} bytes.`
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return error("WRITE_ERROR", `Error writing file: ${msg}`);
          }
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // =========================================================================
  // delete_file — Remove a file from the workspace
  // =========================================================================
  server.tool(
    "delete_file",
    "Delete a file inside a configured repository. The file must exist. " +
      "This is a destructive operation — the file is permanently removed.",
    {
      filePath: z
        .string()
        .describe(
          "File path relative to the repository root " +
            "(e.g. 'src/utils/old-helper.ts') or an absolute path."
        ),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ filePath: reqPath, repo }) => {
      logger.debug(`delete_file called: filePath="${reqPath}", repo="${repo ?? "(auto)"}"`);

      const result = await safeExecute<string>(
        async (): Promise<ToolResponse<string>> => {
          let safePath: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error("INVALID_REPO", `Repo "${repo}" not found. Available repos: ${available}`);
            }
            const repoRoot = path.resolve(repoRootRaw);
            const abs = path.resolve(repoRoot, reqPath);
            if (!abs.toLowerCase().startsWith(repoRoot.toLowerCase())) {
              return error("ACCESS_DENIED", `Path '${reqPath}' escapes repo "${repo}" root.`);
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(reqPath);
            } catch (err) {
              return error("ACCESS_DENIED", err instanceof Error ? err.message : String(err));
            }
          }

          try {
            const stat = await fs.stat(safePath);
            if (!stat.isFile()) {
              return error("INVALID_TARGET", `Path '${reqPath}' is not a file (use rmdir for directories).`);
            }
            await fs.unlink(safePath);
            return success(`Deleted: ${safePath}`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("ENOENT")) {
              return error("NOT_FOUND", `File not found: ${reqPath}`);
            }
            return error("DELETE_ERROR", `Error deleting file: ${msg}`);
          }
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // =========================================================================
  // rename_file — Move or rename a file within the workspace
  // =========================================================================
  server.tool(
    "rename_file",
    "Move or rename a file within a configured repository. Both the source " +
      "and destination must be inside configured repo roots. Creates missing " +
      "parent directories automatically.",
    {
      oldPath: z
        .string()
        .describe("Current file path (relative to repo root or absolute)."),
      newPath: z
        .string()
        .describe("New file path (relative to repo root or absolute)."),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ oldPath, newPath, repo }) => {
      logger.debug(
        `rename_file called: "${oldPath}" → "${newPath}", repo="${repo ?? "(auto)"}"`
      );

      const result = await safeExecute<string>(
        async (): Promise<ToolResponse<string>> => {
          let safeOld: string;
          let safeNew: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error("INVALID_REPO", `Repo "${repo}" not found. Available repos: ${available}`);
            }
            const repoRoot = path.resolve(repoRootRaw);
            safeOld = path.resolve(repoRoot, oldPath);
            safeNew = path.resolve(repoRoot, newPath);
            if (!safeOld.toLowerCase().startsWith(repoRoot.toLowerCase())) {
              return error("ACCESS_DENIED", `Source path '${oldPath}' escapes repo root.`);
            }
            if (!safeNew.toLowerCase().startsWith(repoRoot.toLowerCase())) {
              return error("ACCESS_DENIED", `Destination path '${newPath}' escapes repo root.`);
            }
          } else {
            try {
              safeOld = resolveSafePath(oldPath);
              safeNew = resolveSafePath(newPath);
            } catch (err) {
              return error("ACCESS_DENIED", err instanceof Error ? err.message : String(err));
            }
          }

          try {
            // Verify source exists
            const stat = await fs.stat(safeOld);
            if (!stat.isFile()) {
              return error("INVALID_TARGET", `Source '${oldPath}' is not a file.`);
            }

            // Ensure destination parent exists
            await fs.mkdir(path.dirname(safeNew), { recursive: true });

            // Move the file
            await fs.rename(safeOld, safeNew);
            return success(`Renamed: ${safeOld} → ${safeNew}`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("ENOENT")) {
              return error("NOT_FOUND", `Source file not found: ${oldPath}`);
            }
            return error("RENAME_ERROR", `Error renaming file: ${msg}`);
          }
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  logger.info("Registered 6 code-senses tools (list_directory, read_source_code, create_file, edit_file, delete_file, rename_file)");

  // =========================================================================
  // edit_entity — Replace a named entity's implementation in a source file
  // =========================================================================
  server.tool(
    "edit_entity",
    "Replace the entire source code of a named entity (function, class, interface, type, enum, or const) " +
      "in a source file. The tool finds the entity by name, determines its boundaries " +
      "(including JSDoc/decorators), and replaces it with the provided new source code.\n\n" +
      "**Workflow:** First use `read_source_code(entity=...)` to see the current implementation, " +
      "then use `edit_entity` to replace it. This is safer and more token-efficient than " +
      "`edit_file` with large old_text/new_text blocks.",
    {
      filePath: z
        .string()
        .describe(
          "File path relative to the repository root " +
            "(e.g. 'src/tools/code-senses.ts') or an absolute path."
        ),
      entity: z
        .string()
        .describe(
          "Name of the entity to replace (function, class, interface, type, enum, or const). " +
            "Examples: 'registerCodeSensesTools', 'ChatPanel', 'EditorContextEnvelope'."
        ),
      new_source: z
        .string()
        .describe(
          "The complete new source code for the entity, including its declaration, " +
            "JSDoc comments, decorators, and body. This replaces the entire entity — " +
            "make sure the new source is complete and syntactically correct."
        ),
      repo: z
        .string()
        .optional()
        .describe(repoDesc),
    },
    async ({ filePath: reqPath, entity: entityName, new_source, repo }) => {
      logger.debug(
        `edit_entity called: filePath="${reqPath}", entity="${entityName}", repo="${repo ?? "(auto)"}"`
      );

      const result = await safeExecute<string>(
        async (): Promise<ToolResponse<string>> => {
          let safePath: string;

          if (repo) {
            const repoRootRaw = config.repos[repo];
            if (!repoRootRaw) {
              const available = Object.keys(config.repos).join(", ");
              return error("INVALID_REPO", `Repo "${repo}" not found. Available repos: ${available}`);
            }
            const repoRoot = path.resolve(repoRootRaw);
            const abs = path.resolve(repoRoot, reqPath);
            if (!abs.toLowerCase().startsWith(repoRoot.toLowerCase())) {
              return error("ACCESS_DENIED", `Path '${reqPath}' escapes repo "${repo}" root.`);
            }
            safePath = abs;
          } else {
            try {
              safePath = resolveSafePath(reqPath);
            } catch (err) {
              return error("ACCESS_DENIED", err instanceof Error ? err.message : String(err));
            }
          }

          // Read current content
          let content: string;
          try {
            content = await fs.readFile(safePath, "utf-8");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return error("READ_ERROR", `Cannot read file: ${msg}`);
          }

          // Find the entity
          const loc = findEntity(content, entityName);
          if (!loc) {
            return error(
              "ENTITY_NOT_FOUND",
              `Entity "${entityName}" not found in ${reqPath}. ` +
                "Verify the name or use read_source_code to inspect the file."
            );
          }

          // Replace the entity's lines with new source
          const lines = content.split("\n");
          const before = lines.slice(0, loc.startLine - 1);
          const after = lines.slice(loc.endLine);
          const newContent = [...before, new_source, ...after].join("\n");

          try {
            await fs.writeFile(safePath, newContent, "utf-8");
            const oldLineCount = loc.endLine - loc.startLine + 1;
            const newLineCount = new_source.split("\n").length;
            return success(
              `Replaced ${loc.kind} "${entityName}" in ${reqPath} ` +
              `(was lines ${loc.startLine}–${loc.endLine}, ${oldLineCount} lines → ${newLineCount} lines). ` +
              `File size: ${content.length} → ${newContent.length} bytes.`
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return error("WRITE_ERROR", `Error writing file: ${msg}`);
          }
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  logger.info("Registered 7 code-senses tools (list_directory, read_source_code, create_file, edit_file, delete_file, rename_file, edit_entity)");
}
