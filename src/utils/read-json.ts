/**
 * BOM-tolerant JSON file reader.
 *
 * On Windows, instance.json / instances.json / mcp.json may end up with
 * a UTF-8 BOM (EF BB BF) if they were ever touched by a tool that emits
 * one (Notepad, PowerShell 5.1's `Set-Content -Encoding UTF8`, etc.).
 * `JSON.parse` will then throw `Unexpected token 'ï»¿'`, which silently
 * pushes the daemon into legacy mode and breaks `dg status`, the
 * dashboard, and the explorer.
 *
 * These helpers strip the BOM defensively before parsing.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** Strip a leading UTF-8 BOM (U+FEFF) if present. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Read a file as UTF-8 and strip any BOM. */
export async function readTextNoBom(path: string): Promise<string> {
  const raw = await readFile(path, "utf-8");
  return stripBom(raw);
}

/** Read + parse a JSON file, tolerating a leading UTF-8 BOM. */
export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const text = await readTextNoBom(path);
  return JSON.parse(text) as T;
}

/** Synchronous variant for the rare callers that need it. */
export function readJsonFileSync<T = unknown>(path: string): T {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(stripBom(raw)) as T;
}
