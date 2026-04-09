/**
 * DreamGraph MCP Server — API Surface tools (Operational Layer).
 *
 * Two tools and one resource for extracting and querying method-level
 * API surface from source files:
 *
 *   extract_api_surface — Regex-based extraction + incremental persistence
 *   query_api_surface   — Targeted symbol lookup with inheritance resolution
 *   ops://api-surface   — Full cached surface (read-only resource)
 *
 * Data file: data/api_surface.json
 *
 * Architecture: Operational layer — deterministic extraction tools.
 * The cognitive layer may READ this data for grounding but never WRITES it.
 *
 * See ADR: Regex-Based API Surface Extraction Over AST Parsing.
 * See TDD_OPERATIONAL_KNOWLEDGE.md §1A.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { dataPath } from "../utils/paths.js";
import { invalidateCache, loadJsonData } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { withFileLock } from "../utils/mutex.js";
import type {
  ApiSurface,
  ApiModule,
  ApiClass,
  ApiMethod,
  ApiParam,
  ApiProperty,
  ApiFreeFunction,
  Provenance,
  ExtractApiSurfaceOutput,
  QueryApiSurfaceOutput,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const surfacePath = () => dataPath("api_surface.json");

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py",
  ".cs",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "__pycache__", ".venv", "venv", "target", "coverage",
  ".turbo", ".cache", ".parcel-cache", "obj", "bin",
]);

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

type SupportedLanguage = "typescript" | "javascript" | "python" | "csharp";

function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": return "typescript";
    case ".js": case ".jsx": case ".mjs": case ".cjs": return "javascript";
    case ".py": return "python";
    case ".cs": return "csharp";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Safe path resolution — mirrors code-senses.ts
// ---------------------------------------------------------------------------

function getAllowedRoots(): string[] {
  return Object.values(config.repos).map((p) =>
    path.resolve(p).toLowerCase()
  );
}

function resolveSafePath(requestedPath: string): string {
  const roots = getAllowedRoots();

  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : null;

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

/**
 * Find the repo root that contains `absPath`.
 * Returns [repoName, repoRoot] or null.
 */
function findRepoFor(absPath: string): [string, string] | null {
  const lower = absPath.toLowerCase();
  for (const [name, root] of Object.entries(config.repos)) {
    if (lower.startsWith(path.resolve(root).toLowerCase())) {
      return [name, path.resolve(root)];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function emptySurface(repoRoot: string): ApiSurface {
  return {
    extracted_at: new Date().toISOString(),
    repo_root: repoRoot,
    modules: [],
  };
}

async function loadSurface(): Promise<ApiSurface> {
  try {
    if (!existsSync(surfacePath())) return emptySurface("");
    return await loadJsonData<ApiSurface>("api_surface.json");
  } catch {
    return emptySurface("");
  }
}

async function saveSurface(data: ApiSurface): Promise<void> {
  data.extracted_at = new Date().toISOString();
  await fs.writeFile(surfacePath(), JSON.stringify(data, null, 2), "utf-8");
  invalidateCache("api_surface.json");
  logger.debug("API surface saved to disk");
}

// ---------------------------------------------------------------------------
// Recursive file scanner
// ---------------------------------------------------------------------------

async function walkDirectory(
  dir: string,
  repoRoot: string,
  languageFilter: SupportedLanguage | null,
): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        results.push(...await walkDirectory(path.join(dir, entry.name), repoRoot, languageFilter));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;

      const lang = detectLanguage(entry.name);
      if (languageFilter && lang !== languageFilter) continue;

      results.push(path.join(dir, entry.name));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Language-aware regex extractors
// ---------------------------------------------------------------------------

// --- Python ---

function extractPython(content: string, filePath: string, relPath: string): ApiModule {
  const classes: ApiClass[] = [];
  const functions: ApiFreeFunction[] = [];
  const lines = content.split("\n");

  let currentClass: ApiClass | null = null;
  let classIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Decorator tracking
    // (consumed by the next class/method detection)

    // Class detection
    const classMatch = line.match(/^class\s+(\w+)(?:\((.*?)\))?:\s*$/);
    if (classMatch) {
      if (currentClass) classes.push(currentClass);
      const bases = classMatch[2]
        ? classMatch[2].split(",").map(b => b.trim()).filter(Boolean)
        : [];
      currentClass = {
        name: classMatch[1],
        bases,
        methods: [],
        properties: [],
        decorators: [],
        file_path: relPath,
        line_number: lineNum,
      };
      classIndent = 0;
      // Collect decorators above
      for (let d = i - 1; d >= 0; d--) {
        const decMatch = lines[d].match(/^@(\w+(?:\.\w+)*)/);
        if (decMatch) currentClass.decorators.unshift(decMatch[1]);
        else break;
      }
      continue;
    }

    // Inside a class — detect methods and properties
    if (currentClass) {
      // Detect exit from class (non-empty line with zero/less indent)
      if (line.trim() && !line.match(/^\s/) && !line.match(/^#/) && !line.match(/^@/)) {
        classes.push(currentClass);
        currentClass = null;
      }
    }

    if (currentClass) {
      // Method detection
      const methodMatch = line.match(/^(\s+)(async\s+)?def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?:/);
      if (methodMatch) {
        const indent = methodMatch[1].length;
        if (classIndent === 0) classIndent = indent;
        if (indent === classIndent) {
          const rawParams = methodMatch[4];
          const params = parseParams(rawParams, "python");
          // Remove 'self' and 'cls' from params
          const filtered = params.filter(p => p.name !== "self" && p.name !== "cls");

          const isStatic = checkDecorator(lines, i, "staticmethod");
          const isClassMethod = checkDecorator(lines, i, "classmethod");
          const isProperty = checkDecorator(lines, i, "property");

          if (isProperty) {
            currentClass.properties.push({
              name: methodMatch[3],
              type: methodMatch[5]?.trim(),
              is_readonly: true, // Look for setter later
              line_number: lineNum,
            });
          } else {
            const visibility = methodMatch[3].startsWith("_")
              ? (methodMatch[3].startsWith("__") && !methodMatch[3].endsWith("__")
                ? "private" as const
                : "protected" as const)
              : "public" as const;

            const method: ApiMethod = {
              name: methodMatch[3],
              parameters: filtered,
              return_type: methodMatch[5]?.trim(),
              is_static: isStatic || isClassMethod,
              is_async: !!methodMatch[2],
              visibility,
              line_number: lineNum,
              decorators: collectDecorators(lines, i),
            };
            method.signature_text = buildSignatureText(method);
            currentClass.methods.push(method);
          }
        }
        continue;
      }

      // Property setter (marks a @property as not readonly)
      const setterMatch = line.match(/^\s+@(\w+)\.setter/);
      if (setterMatch) {
        const prop = currentClass.properties.find(p => p.name === setterMatch[1]);
        if (prop) prop.is_readonly = false;
      }
      continue;
    }

    // Module-level function detection
    const fnMatch = line.match(/^(async\s+)?def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?:/);
    if (fnMatch) {
      const params = parseParams(fnMatch[3], "python");
      const fn: ApiFreeFunction = {
        name: fnMatch[2],
        parameters: params,
        return_type: fnMatch[4]?.trim(),
        is_async: !!fnMatch[1],
        is_exported: !fnMatch[2].startsWith("_"),
        line_number: lineNum,
      };
      fn.signature_text = buildFreeFunctionSignature(fn);
      functions.push(fn);
    }
  }

  if (currentClass) classes.push(currentClass);

  return {
    file_path: relPath,
    module_name: relPath.replace(/\.py$/, "").replace(/\//g, ".").replace(/\\/g, "."),
    language: "python",
    classes,
    functions,
    provenance: { kind: "extracted", source_files: [relPath], extracted_at: new Date().toISOString() },
  };
}

// --- TypeScript / JavaScript ---

function extractTypeScript(content: string, filePath: string, relPath: string): ApiModule {
  const classes: ApiClass[] = [];
  const functions: ApiFreeFunction[] = [];
  const lines = content.split("\n");

  let currentClass: ApiClass | null = null;
  let braceDepth = 0;
  let classBraceStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Class detection
    const classMatch = line.match(
      /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+(.+?))?(?:\s*\{)?/
    );
    if (classMatch && !currentClass) {
      const bases: string[] = [];
      if (classMatch[2]) bases.push(classMatch[2]);
      if (classMatch[3]) bases.push(...classMatch[3].split(",").map(b => b.trim()));

      currentClass = {
        name: classMatch[1],
        bases,
        methods: [],
        properties: [],
        decorators: collectDecorators(lines, i),
        file_path: relPath,
        line_number: lineNum,
      };
      braceDepth = 0;
      classBraceStart = countBraces(line);
      braceDepth += classBraceStart;
      continue;
    }

    // Interface detection — treat like a class for API surface
    const ifaceMatch = line.match(
      /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+(.+?))?(?:\s*\{)?/
    );
    if (ifaceMatch && !currentClass) {
      const bases = ifaceMatch[2]
        ? ifaceMatch[2].split(",").map(b => b.trim())
        : [];
      currentClass = {
        name: ifaceMatch[1],
        bases,
        methods: [],
        properties: [],
        decorators: [],
        file_path: relPath,
        line_number: lineNum,
      };
      braceDepth = 0;
      braceDepth += countBraces(line);
      continue;
    }

    // Inside class — track brace depth
    if (currentClass) {
      braceDepth += countBraces(line);

      if (braceDepth <= 0) {
        classes.push(currentClass);
        currentClass = null;
        braceDepth = 0;
        continue;
      }

      // Method detection inside class
      const methodMatch = line.match(
        /^\s+(?:async\s+)?(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(readonly)\s+)?(\w+)\s*(?:<[^>]*>)?\s*\((.*?)\)(?:\s*:\s*(.+?))?(?:\s*\{|;)/
      );
      if (methodMatch) {
        const visibility = (methodMatch[1] as "public" | "protected" | "private") || "public";
        const isStatic = !!methodMatch[2];
        const name = methodMatch[4];
        const params = parseParams(methodMatch[5] ?? "", "typescript");
        const returnType = methodMatch[6]?.trim();

        // Skip constructor internal stuff, getters etc
        if (name === "constructor" || name.startsWith("#")) {
          // Still record constructor with params
          if (name === "constructor") {
            const method: ApiMethod = {
              name,
              parameters: params,
              return_type: undefined,
              is_static: false,
              is_async: false,
              visibility,
              line_number: lineNum,
              decorators: [],
            };
            method.signature_text = buildSignatureText(method);
            currentClass.methods.push(method);
          }
          continue;
        }

        const method: ApiMethod = {
          name,
          parameters: params,
          return_type: returnType,
          is_static: isStatic,
          is_async: line.includes("async"),
          visibility,
          line_number: lineNum,
          decorators: collectDecorators(lines, i),
        };
        method.signature_text = buildSignatureText(method);
        currentClass.methods.push(method);
        continue;
      }

      // Property detection inside class
      const propMatch = line.match(
        /^\s+(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(readonly)\s+)?(\w+)(?:\?)?(?:\s*:\s*(.+?))?(?:\s*[=;])/
      );
      if (propMatch && !line.includes("(")) {
        const name = propMatch[4];
        if (!name.startsWith("#")) {
          currentClass.properties.push({
            name,
            type: propMatch[5]?.trim()?.replace(/;$/, ""),
            is_readonly: !!propMatch[3],
            line_number: lineNum,
          });
        }
      }
      continue;
    }

    // Module-level function detection
    const fnMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\((.*?)\)(?:\s*:\s*(.+?))?/
    );
    if (fnMatch) {
      const params = parseParams(fnMatch[2], "typescript");
      const fn: ApiFreeFunction = {
        name: fnMatch[1],
        parameters: params,
        return_type: fnMatch[3]?.trim()?.replace(/\s*\{$/, ""),
        is_async: line.includes("async"),
        is_exported: line.trimStart().startsWith("export"),
        line_number: lineNum,
      };
      fn.signature_text = buildFreeFunctionSignature(fn);
      functions.push(fn);
      continue;
    }

    // Arrow function export: export const name = (...) => ...
    const arrowMatch = line.match(
      /^export\s+(?:const|let)\s+(\w+)\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?\((.*?)\)(?:\s*:\s*(.+?))?\s*=>/
    );
    if (arrowMatch) {
      const params = parseParams(arrowMatch[2], "typescript");
      const fn: ApiFreeFunction = {
        name: arrowMatch[1],
        parameters: params,
        return_type: arrowMatch[3]?.trim(),
        is_async: line.includes("async"),
        is_exported: true,
        line_number: lineNum,
      };
      fn.signature_text = buildFreeFunctionSignature(fn);
      functions.push(fn);
    }
  }

  if (currentClass) classes.push(currentClass);

  const lang = detectLanguage(filePath) === "javascript" ? "javascript" : "typescript";

  return {
    file_path: relPath,
    module_name: relPath.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "").replace(/\//g, ".").replace(/\\/g, "."),
    language: lang,
    classes,
    functions,
    provenance: { kind: "extracted", source_files: [relPath], extracted_at: new Date().toISOString() },
  };
}

// --- C# ---

function extractCSharp(content: string, filePath: string, relPath: string): ApiModule {
  const classes: ApiClass[] = [];
  const functions: ApiFreeFunction[] = []; // C# doesn't have module-level functions, but keep shape
  const lines = content.split("\n");

  let currentClass: ApiClass | null = null;
  let braceDepth = 0;
  let namespace = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNum = i + 1;

    // Namespace detection (both traditional and file-scoped)
    const nsMatch = line.match(/^\s*namespace\s+([\w.]+)/);
    if (nsMatch) {
      namespace = nsMatch[1];
      continue;
    }

    // --- Multi-line signature joining ---
    // If a line looks like a method/property declaration with '(' but no ')',
    // join subsequent lines until ')' is found (max 8 lines lookahead).
    if (currentClass && line.includes("(") && !line.includes(")")) {
      const maybeSig = line.match(/^\s*(?:public|private|protected|internal)/);
      if (maybeSig) {
        let joined = line;
        let j = i + 1;
        const maxLookahead = Math.min(i + 8, lines.length);
        while (j < maxLookahead && !joined.includes(")")) {
          joined += " " + lines[j].trim();
          j++;
        }
        if (joined.includes(")")) {
          line = joined;
          // Skip the lines we consumed (they're now part of 'line')
          // but keep lineNum pointing at the first line
        }
      }
    }

    // Class/struct/record detection — flexible modifier ordering
    // Handles: public class, public static class, public static partial class,
    //          internal sealed class, public abstract class, etc.
    const classMatch = line.match(
      /^\s*(?:public|internal|private|protected)\s+(?:(?:partial|abstract|sealed|static|unsafe|readonly)\s+)*(?:class|struct|record)\s+(\w+)(?:\s*<[^>]*>)?\s*(?::\s*(.+?))?(?:\s*\{|$)/
    );
    if (classMatch && !currentClass) {
      const bases = classMatch[2]
        ? classMatch[2].split(",").map(b => b.trim().replace(/<.*>/, ""))
        : [];
      const isStaticClass = /\bstatic\b/.test(line);
      currentClass = {
        name: classMatch[1],
        bases,
        methods: [],
        properties: [],
        decorators: collectDecorators(lines, i),
        file_path: relPath,
        line_number: lineNum,
      };
      // Tag static extension classes so query can surface them
      if (isStaticClass) {
        currentClass.decorators.push("__static_class");
      }
      braceDepth = countBraces(line);
      continue;
    }

    // Interface detection — also with flexible modifiers
    const ifaceMatch = line.match(
      /^\s*(?:public|internal)\s+(?:(?:partial|unsafe)\s+)*interface\s+(\w+)(?:\s*<[^>]*>)?\s*(?::\s*(.+?))?(?:\s*\{|$)/
    );
    if (ifaceMatch && !currentClass) {
      const bases = ifaceMatch[2]
        ? ifaceMatch[2].split(",").map(b => b.trim().replace(/<.*>/, ""))
        : [];
      currentClass = {
        name: ifaceMatch[1],
        bases,
        methods: [],
        properties: [],
        decorators: [],
        file_path: relPath,
        line_number: lineNum,
      };
      braceDepth = countBraces(line);
      continue;
    }

    if (currentClass) {
      braceDepth += countBraces(line);

      if (braceDepth <= 0) {
        classes.push(currentClass);
        currentClass = null;
        braceDepth = 0;
        continue;
      }

      // Method detection — C# modifier order: visibility, static, async, virtual/override/abstract
      const methodMatch = line.match(
        /^\s*(?:(public|private|protected|internal)\s+)?(?:(static)\s+)?(?:(async)\s+)?(?:(virtual|override|abstract|new)\s+)?(?:([\w<>\[\]?,\s]+?)\s+)(\w+)\s*(?:<[^>]*>)?\s*\((.*?)\)/
      );
      if (methodMatch && !line.includes(" get ") && !line.includes(" set ") &&
          !line.match(/^\s*(?:get|set|init)\s*[{;]/) && !line.match(/^\s*\/\//)) {
        const visibility = (methodMatch[1] as "public" | "protected" | "private") || "public";
        const isStatic = !!methodMatch[2];
        const isAsync = !!methodMatch[3];
        const returnType = methodMatch[5]?.trim();
        const name = methodMatch[6];
        let rawParams = methodMatch[7] ?? "";

        // Detect extension method — first param starts with 'this'
        const isExtensionMethod = rawParams.trimStart().startsWith("this ");

        const params = parseParams(rawParams, "csharp");

        // Skip property accessors, constructors that look like methods
        if (returnType && name && name !== currentClass.name) {
          const method: ApiMethod = {
            name,
            parameters: params,
            return_type: returnType,
            is_static: isStatic,
            is_async: isAsync,
            visibility: (visibility as string) === "internal" ? "public" as const : visibility,
            line_number: lineNum,
            decorators: [
              ...collectDecorators(lines, i),
              ...(isExtensionMethod ? ["__extension_method"] : []),
            ],
          };
          method.signature_text = buildSignatureText(method);
          currentClass.methods.push(method);
          continue;
        }
      }

      // Property detection
      const propMatch = line.match(
        /^\s*(?:public|private|protected)\s+(?:static\s+)?([\w<>\[\]?]+)\s+(\w+)\s*\{/
      );
      if (propMatch) {
        const hasSet = content.substring(
          content.indexOf(line),
          content.indexOf(line) + 200
        ).includes("set");
        currentClass.properties.push({
          name: propMatch[2],
          type: propMatch[1],
          is_readonly: !hasSet,
          line_number: lineNum,
        });
      }
    }
  }

  if (currentClass) classes.push(currentClass);

  return {
    file_path: relPath,
    module_name: namespace || relPath.replace(/\.cs$/, "").replace(/\//g, ".").replace(/\\/g, "."),
    language: "csharp",
    classes,
    functions,
    provenance: { kind: "extracted", source_files: [relPath], extracted_at: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function countBraces(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

function checkDecorator(lines: string[], methodLineIdx: number, decoratorName: string): boolean {
  for (let d = methodLineIdx - 1; d >= 0; d--) {
    const trimmed = lines[d].trim();
    if (trimmed.startsWith("@")) {
      if (trimmed.includes(decoratorName)) return true;
    } else if (trimmed !== "" && !trimmed.startsWith("#")) {
      break;
    }
  }
  return false;
}

function collectDecorators(lines: string[], lineIdx: number): string[] {
  const decorators: string[] = [];
  for (let d = lineIdx - 1; d >= 0; d--) {
    const match = lines[d].match(/^\s*@(\w+(?:\.\w+)*)/);
    if (match) {
      decorators.unshift(match[1]);
    } else {
      const csAttr = lines[d].match(/^\s*\[(\w+)/);
      if (csAttr) {
        decorators.unshift(csAttr[1]);
      } else if (lines[d].trim() !== "" && !lines[d].trim().startsWith("//")) {
        break;
      }
    }
  }
  return decorators;
}

function parseParams(raw: string, lang: string): ApiParam[] {
  if (!raw.trim()) return [];

  const params: ApiParam[] = [];

  // Split on commas that are not inside angle brackets or parens
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      params.push(parseOneParam(current.trim(), lang));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    params.push(parseOneParam(current.trim(), lang));
  }

  return params;
}

function parseOneParam(param: string, lang: string): ApiParam {
  if (lang === "python") {
    // name: type = default or name = default or just name
    const m = param.match(/^(\*{0,2}\w+)\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/);
    if (m) {
      return {
        name: m[1],
        type: m[2]?.trim(),
        default_value: m[3]?.trim(),
      };
    }
  } else if (lang === "typescript" || lang === "javascript") {
    // name: Type = default or name?: Type
    const m = param.match(/^(\w+)\??\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/);
    if (m) {
      return {
        name: m[1],
        type: m[2]?.trim(),
        default_value: m[3]?.trim(),
      };
    }
  } else if (lang === "csharp") {
    // Strip C# parameter modifiers: this, params, ref, out, in, scoped
    let cleaned = param.replace(/^(?:this|params|ref|out|in|scoped)\s+/, "");
    // Handle chained modifiers: "this ref MyStruct s" → "ref MyStruct s" → "MyStruct s"
    cleaned = cleaned.replace(/^(?:this|params|ref|out|in|scoped)\s+/, "");
    // Type name = default
    const m = cleaned.match(/^([\w<>\[\]?,\s]+?)\s+(\w+)(?:\s*=\s*(.+))?$/);
    if (m) {
      return {
        name: m[2],
        type: m[1].trim(),
        default_value: m[3]?.trim(),
      };
    }
  }

  return { name: param };
}

function buildSignatureText(method: ApiMethod): string {
  const params = method.parameters.map(p => {
    let s = p.name;
    if (p.type) s += `: ${p.type}`;
    if (p.default_value) s += ` = ${p.default_value}`;
    return s;
  }).join(", ");

  const ret = method.return_type ? ` → ${method.return_type}` : "";
  const prefix = method.is_static ? "static " : "";
  const async_ = method.is_async ? "async " : "";
  return `${prefix}${async_}${method.name}(${params})${ret}`;
}

function buildFreeFunctionSignature(fn: ApiFreeFunction): string {
  const params = fn.parameters.map(p => {
    let s = p.name;
    if (p.type) s += `: ${p.type}`;
    if (p.default_value) s += ` = ${p.default_value}`;
    return s;
  }).join(", ");

  const ret = fn.return_type ? ` → ${fn.return_type}` : "";
  const async_ = fn.is_async ? "async " : "";
  return `${async_}${fn.name}(${params})${ret}`;
}

// ---------------------------------------------------------------------------
// Extraction orchestrator
// ---------------------------------------------------------------------------

async function extractFile(
  absPath: string,
  repoRoot: string,
  languageOverride?: SupportedLanguage | null,
): Promise<ApiModule | null> {
  const lang = languageOverride ?? detectLanguage(absPath);
  if (!lang) return null;

  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile() || stat.size > 1_000_000) return null; // skip huge files

    const content = await fs.readFile(absPath, "utf-8");
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, "/");

    switch (lang) {
      case "python": return extractPython(content, absPath, relPath);
      case "typescript":
      case "javascript": return extractTypeScript(content, absPath, relPath);
      case "csharp": return extractCSharp(content, absPath, relPath);
      default: return null;
    }
  } catch (err) {
    logger.warn(`Failed to extract ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inheritance resolution
// ---------------------------------------------------------------------------

interface ResolvedSymbol {
  symbol: ApiClass;
  module: ApiModule;
}

function resolveInheritance(
  cls: ApiClass,
  allModules: ApiModule[],
): ApiMethod[] {
  // Build class lookup
  const classMap = new Map<string, ApiClass>();
  for (const mod of allModules) {
    for (const c of mod.classes) {
      classMap.set(c.name, c);
    }
  }

  // Collect methods from all base classes recursively
  const inherited: ApiMethod[] = [];
  const visited = new Set<string>([cls.name]);

  function walkBases(bases: string[]): void {
    for (const baseName of bases) {
      if (visited.has(baseName)) continue;
      visited.add(baseName);

      const baseClass = classMap.get(baseName);
      if (!baseClass) continue; // Unresolvable external base

      for (const method of baseClass.methods) {
        // Only add if not overridden by child
        const overridden = cls.methods.some(m => m.name === method.name) ||
          inherited.some(m => m.name === method.name);
        if (!overridden) {
          inherited.push({ ...method, defined_in: baseName });
        }
      }

      walkBases(baseClass.bases);
    }
  }

  walkBases(cls.bases);
  return inherited;
}

function resolveInheritedProperties(
  cls: ApiClass,
  allModules: ApiModule[],
): ApiProperty[] {
  const classMap = new Map<string, ApiClass>();
  for (const mod of allModules) {
    for (const c of mod.classes) {
      classMap.set(c.name, c);
    }
  }

  const inherited: ApiProperty[] = [];
  const visited = new Set<string>([cls.name]);

  function walkBases(bases: string[]): void {
    for (const baseName of bases) {
      if (visited.has(baseName)) continue;
      visited.add(baseName);

      const baseClass = classMap.get(baseName);
      if (!baseClass) continue;

      for (const prop of baseClass.properties) {
        const overridden = cls.properties.some(p => p.name === prop.name) ||
          inherited.some(p => p.name === prop.name);
        if (!overridden) {
          inherited.push({ ...prop });
        }
      }

      walkBases(baseClass.bases);
    }
  }

  walkBases(cls.bases);
  return inherited;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerApiSurfaceTools(server: McpServer): void {

  // =========================================================================
  // extract_api_surface — Incremental regex-based extraction
  // =========================================================================

  server.tool(
    "extract_api_surface",
    "Extract programmatic API surface from source files and store it as operational knowledge. " +
      "Use when onboarding a repo, after major code changes, or before validation if no API surface exists yet. " +
      "Regex-based (~90% accuracy). Supports Python, TypeScript, JavaScript, C#.",
    {
      path: z.string().describe("File or directory path relative to repo root."),
      language: z.string()
        .default("auto")
        .describe("Language to extract. Must be one of: auto, python, typescript, javascript, csharp. Auto-detect from file extension."),
      scope: z.enum(["public", "all"])
        .default("public")
        .describe("Whether to extract only public APIs or all detectable members."),
      incremental: z.boolean()
        .default(true)
        .describe("Only re-extract changed files (compares file mtime against last extraction). Set false to force full rescan."),
      platform: z.string().optional()
        .describe("Optional platform tag (e.g., 'python-port', 'web'). Tags all extracted symbols for platform-filtered queries."),
    },
    async ({ path: inputPath, language, scope, incremental, platform }) => {
      const result = await safeExecute<ExtractApiSurfaceOutput>(async (): Promise<ToolResponse<ExtractApiSurfaceOutput>> => {
        // Resolve the target path
        let absPath: string;
        try {
          absPath = resolveSafePath(inputPath);
        } catch (err) {
          return error("ACCESS_DENIED", err instanceof Error ? err.message : String(err));
        }

        const repo = findRepoFor(absPath);
        if (!repo) {
          return error("NO_REPO", `Path '${inputPath}' is not inside any configured repository.`);
        }
        const [repoName, repoRoot] = repo;
        const relPath = path.relative(repoRoot, absPath).replace(/\\/g, "/");
        const langFilter = language === "auto" ? null : language as SupportedLanguage;

        // Discover files to extract
        const stat = await fs.stat(absPath);
        let filePaths: string[];
        if (stat.isDirectory()) {
          filePaths = await walkDirectory(absPath, repoRoot, langFilter);
        } else {
          filePaths = [absPath];
        }

        // Load current surface
        const surface = await withFileLock("api_surface.json", async () => {
          const existing = await loadSurface();
          if (!existing.repo_root) existing.repo_root = repoRoot;

          // Build mtime index for incremental mode
          const existingByPath = new Map<string, ApiModule>();
          for (const mod of existing.modules) {
            existingByPath.set(mod.file_path, mod);
          }

          let filesScanned = 0;
          let filesUpdated = 0;
          let filesSkipped = 0;
          let classesFound = 0;
          let functionsFound = 0;
          let propertiesFound = 0;
          const warnings: string[] = [];

          for (const fp of filePaths) {
            const fRelPath = path.relative(repoRoot, fp).replace(/\\/g, "/");

            // Incremental: skip if file hasn't changed
            if (incremental) {
              const existingMod = existingByPath.get(fRelPath);
              if (existingMod?.provenance.extracted_at) {
                try {
                  const fileStat = await fs.stat(fp);
                  const extractedAt = new Date(existingMod.provenance.extracted_at).getTime();
                  if (fileStat.mtimeMs <= extractedAt) {
                    filesSkipped++;
                    // Preserve counts from existing module
                    classesFound += existingMod.classes.length;
                    functionsFound += existingMod.functions.length;
                    propertiesFound += existingMod.classes.reduce((s, c) => s + c.properties.length, 0);
                    continue;
                  }
                } catch { /* proceed with extraction */ }
              }
            }

            filesScanned++;
            const extracted = await extractFile(fp, repoRoot, langFilter);
            if (!extracted) {
              warnings.push(`Skipped ${fRelPath}: unsupported or unreadable.`);
              continue;
            }

            // Apply platform tag
            if (platform) extracted.platform = platform;

            // Apply scope filter
            if (scope === "public") {
              for (const cls of extracted.classes) {
                cls.methods = cls.methods.filter(m => m.visibility === "public");
                cls.properties = cls.properties.filter(() => true); // keep all props for now
              }
              extracted.functions = extracted.functions.filter(f => f.is_exported);
            }

            // Count
            classesFound += extracted.classes.length;
            functionsFound += extracted.functions.length;
            propertiesFound += extracted.classes.reduce((s, c) => s + c.properties.length, 0);
            filesUpdated++;

            // Merge into surface
            existingByPath.set(fRelPath, extracted);
          }

          // Rebuild modules array
          existing.modules = Array.from(existingByPath.values());
          await saveSurface(existing);

          return success<ExtractApiSurfaceOutput>({
            repo_root: repoRoot,
            path_scanned: relPath || ".",
            files_scanned: filesScanned,
            files_updated: filesUpdated,
            files_skipped_incremental: filesSkipped,
            classes_found: classesFound,
            functions_found: functionsFound,
            properties_found: propertiesFound,
            warnings,
            surface_version: new Date().toISOString(),
          });
        });

        return surface;
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // =========================================================================
  // query_api_surface — Targeted symbol lookup with inheritance resolution
  // =========================================================================

  server.tool(
    "query_api_surface",
    "Return the exact callable/programmatic surface for a class, function, or module. " +
      "Use before writing code that calls methods or accesses properties. " +
      "Supports inheritance resolution with 'defined_in' annotations showing where each method originates.",
    {
      symbol_name: z.string().describe(
        "Class, function, or module symbol to look up (e.g., 'UIStack', 'CognitiveEngine', 'ui.layouts')."
      ),
      symbol_kind: z.string()
        .default("auto")
        .describe("Optional symbol type hint. Must be one of: auto, class, function, module. Auto-detect when omitted."),
      member_name: z.string().optional()
        .describe("Optional: filter to one specific method or property."),
      file_path: z.string().optional()
        .describe("Optional: restrict results to members defined in this file path (substring match). Useful for partial classes that span many files."),
      include_inherited: z.boolean()
        .default(true)
        .describe("Include inherited members when querying classes. Inherited members include a 'defined_in' field showing their origin class."),
      detail_level: z.enum(["summary", "full", "signatures_only"])
        .default("full")
        .describe("summary: name + purpose. signatures_only: method names, params, return types. full: everything."),
      platform: z.string().optional()
        .describe("Optional platform filter (e.g., 'python-port', 'web')."),
      language: z.string()
        .default("any")
        .describe("Optional language filter. Must be one of: any, python, typescript, javascript, csharp."),
    },
    async ({ symbol_name, symbol_kind, member_name, file_path: filePathFilter, include_inherited, detail_level, platform, language }) => {
      const result = await safeExecute<QueryApiSurfaceOutput>(async (): Promise<ToolResponse<QueryApiSurfaceOutput>> => {
        const surface = await loadSurface();
        if (surface.modules.length === 0) {
          return error(
            "NO_SURFACE",
            "No API surface data. Run extract_api_surface first to populate it."
          );
        }

        // Filter modules by platform/language
        let modules = surface.modules;
        if (platform) {
          modules = modules.filter(m => m.platform === platform);
        }
        if (language !== "any") {
          modules = modules.filter(m => m.language === language);
        }

        // Determine what kind of symbol we're looking for
        const kind = symbol_kind === "auto" ? null : symbol_kind;

        // --- CLASS search (with partial class aggregation) ---
        if (!kind || kind === "class") {
          // Collect ALL matching class fragments across all modules (handles C# partial classes)
          const fragments: Array<{ cls: ApiClass; mod: ApiModule }> = [];
          for (const mod of modules) {
            for (const c of mod.classes) {
              if (c.name.toLowerCase() === symbol_name.toLowerCase()) {
                fragments.push({ cls: c, mod });
              }
            }
          }

          if (fragments.length > 0) {
            const isPartial = fragments.length > 1;
            const primaryFragment = fragments[0];

            // Merge all bases from all fragments (deduplicated)
            const allBases = [...new Set(fragments.flatMap(f => f.cls.bases))];

            // Merge methods from all fragments, each annotated with defined_in (file path)
            let methods: Array<ApiMethod & { defined_in: string }> = [];
            for (const { cls: frag, mod: fragMod } of fragments) {
              const source = isPartial ? frag.file_path ?? fragMod.file_path : frag.name;
              for (const m of frag.methods) {
                methods.push({ ...m, defined_in: m.defined_in ?? source });
              }
            }

            // Merge properties from all fragments
            let properties: ApiProperty[] = [];
            for (const { cls: frag } of fragments) {
              properties.push(...frag.properties);
            }

            // Inheritance resolution (use primary fragment for base-walking)
            if (include_inherited) {
              // Build a merged class for inheritance resolution
              const mergedForInheritance: ApiClass = {
                name: primaryFragment.cls.name,
                bases: allBases,
                methods: methods,
                properties: properties,
                decorators: primaryFragment.cls.decorators,
                file_path: primaryFragment.cls.file_path,
                line_number: primaryFragment.cls.line_number,
              };
              const inheritedMethods = resolveInheritance(mergedForInheritance, modules);
              methods = [...methods, ...inheritedMethods.map(m => ({ ...m, defined_in: m.defined_in! }))];
              const inheritedProps = resolveInheritedProperties(mergedForInheritance, modules);
              properties = [...properties, ...inheritedProps];
            }

            // Filter by file_path if provided
            if (filePathFilter) {
              const fpLower = filePathFilter.toLowerCase();
              methods = methods.filter(m => m.defined_in?.toLowerCase().includes(fpLower));
              // Properties don't have defined_in, so we filter by matching fragment file paths
              const matchingFragFiles = new Set(
                fragments
                  .filter(f => (f.cls.file_path ?? f.mod.file_path).toLowerCase().includes(fpLower))
                  .map(f => f.cls.file_path ?? f.mod.file_path)
              );
              if (matchingFragFiles.size > 0) {
                // Rebuild properties from only matching fragments
                properties = [];
                for (const { cls: frag, mod: fragMod } of fragments) {
                  if (matchingFragFiles.has(frag.file_path ?? fragMod.file_path)) {
                    properties.push(...frag.properties);
                  }
                }
              }
            }

            // Filter by member name
            if (member_name) {
              methods = methods.filter(m => m.name.toLowerCase() === member_name.toLowerCase());
              properties = properties.filter(p => p.name.toLowerCase() === member_name.toLowerCase());
            }

            // Apply detail level
            if (detail_level === "signatures_only") {
              methods = methods.map(m => ({
                name: m.name,
                parameters: m.parameters,
                return_type: m.return_type,
                signature_text: m.signature_text,
                is_static: m.is_static,
                is_async: m.is_async,
                visibility: m.visibility,
                line_number: m.line_number,
                decorators: [],
                defined_in: m.defined_in,
              }));
            } else if (detail_level === "summary") {
              methods = methods.map(m => ({
                name: m.name,
                parameters: [],
                return_type: m.return_type,
                signature_text: m.signature_text,
                is_static: m.is_static,
                is_async: m.is_async,
                visibility: m.visibility,
                line_number: 0,
                decorators: [],
                defined_in: m.defined_in,
              }));
            }

            // All file paths this class spans
            const allFilePaths = fragments.map(f => f.cls.file_path ?? f.mod.file_path);

            return success<QueryApiSurfaceOutput>({
              symbol_name: primaryFragment.cls.name,
              symbol_kind: "class",
              language: primaryFragment.mod.language,
              file_path: primaryFragment.mod.file_path,
              ...(isPartial ? { file_paths: allFilePaths, is_partial_aggregate: true } : {}),
              line_number: primaryFragment.cls.line_number,
              bases: allBases,
              methods,
              properties,
            });
          }
        }

        // --- FUNCTION search ---
        if (!kind || kind === "function") {
          for (const mod of modules) {
            const fn = mod.functions.find(f =>
              f.name.toLowerCase() === symbol_name.toLowerCase()
            );
            if (fn) {
              return success<QueryApiSurfaceOutput>({
                symbol_name: fn.name,
                symbol_kind: "function",
                language: mod.language,
                file_path: mod.file_path,
                line_number: fn.line_number,
                parameters: fn.parameters,
                return_type: fn.return_type,
                signature_text: fn.signature_text,
                is_async: fn.is_async,
                is_exported: fn.is_exported,
              });
            }
          }
        }

        // --- MODULE search ---
        if (!kind || kind === "module") {
          const mod = modules.find(m =>
            m.module_name?.toLowerCase() === symbol_name.toLowerCase() ||
            m.file_path.toLowerCase() === symbol_name.toLowerCase() ||
            m.file_path.toLowerCase().replace(/\.(tsx?|jsx?|mjs|cjs|py|cs)$/, "").replace(/\//g, ".") === symbol_name.toLowerCase()
          );
          if (mod) {
            return success<QueryApiSurfaceOutput>({
              symbol_name: mod.module_name ?? mod.file_path,
              symbol_kind: "module",
              language: mod.language,
              file_path: mod.file_path,
              classes: mod.classes,
              functions: mod.functions,
            });
          }
        }

        // Not found — suggest close matches
        const allNames: string[] = [];
        for (const mod of modules) {
          for (const c of mod.classes) allNames.push(c.name);
          for (const f of mod.functions) allNames.push(f.name);
          if (mod.module_name) allNames.push(mod.module_name);
        }

        const lower = symbol_name.toLowerCase();
        const suggestions = allNames
          .filter(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))
          .slice(0, 5);

        const suggestStr = suggestions.length > 0
          ? ` Similar symbols: ${suggestions.join(", ")}`
          : "";

        return error(
          "NOT_FOUND",
          `Symbol '${symbol_name}' not found in API surface.${suggestStr}`
        );
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // =========================================================================
  // ops://api-surface — Full cached surface resource (read-only)
  // =========================================================================

  server.resource(
    "ops-api-surface",
    "ops://api-surface",
    {
      description:
        "Full cached API surface extracted from source files. Contains all classes, " +
        "functions, methods, and properties with signatures. Read-only operational data. " +
        "Use extract_api_surface to populate, query_api_surface for targeted lookups.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const surface = await loadSurface();
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(surface, null, 2),
        }],
      };
    }
  );

  logger.info("Registered API surface tools (2 tools, 1 resource)");
}
