/**
 * envelope-utils.ts — Shared lenient extractor for the structured continuation envelope.
 *
 * Why it exists:
 * - The autonomy loop (host) and the chat webview both need to recognize the
 *   same JSON envelope emitted by the LLM. Historically the host used a strict
 *   regex + JSON.parse while the webview ran a separate, slightly more
 *   forgiving parser. When the two diverge, the user sees raw JSON in the
 *   bubble AND autonomy stops continuing — both at once. This module gives
 *   the host the same lenient behaviour the webview already aspires to, so
 *   either side fails or succeeds in lockstep.
 *
 * The webview cannot import this file directly (it ships as a template-string
 * inline script). The webview-side equivalent in `webview/card-renderer.ts`
 * mirrors this logic and must be kept in sync. See the SYNC marker comments
 * in both files.
 */

import type { StructuredActionEnvelope } from './autonomy-contract.js';

/**
 * Validate that an arbitrary parsed value looks like a structured continuation
 * envelope. Mirrors `isEnvelopeShape` in card-renderer.ts.
 */
export function isEnvelopeShape(value: unknown): value is StructuredActionEnvelope {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.summary !== 'string') return false;
  return 'goal_status' in obj || 'recommended_next_steps' in obj || 'progress_status' in obj;
}

/**
 * Light, string-aware JSON repair targeted at the small set of quirks LLMs
 * (especially Claude with extended thinking) emit:
 *   - NBSP between tokens
 *   - smart quotes used as the JSON quote character
 *   - trailing commas before } or ]
 *   - // line comments and block comments
 *
 * The trailing-comma and comment passes are string-aware so a label like
 * "Run //test" or "Hello, ]bracket" is preserved. Smart-quote substitution is
 * a blanket character replacement; if a smart quote appears inside an
 * already-quoted string body we lose that character's exact glyph but JSON
 * parsing succeeds — an acceptable trade for resilience.
 */
export function repairJsonish(src: string): string {
  let s = String(src ?? '');
  if (!s) return s;
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  s = stripCommentsOutsideStrings(s);
  s = stripTrailingCommasOutsideStrings(s);
  return s.trim();
}

function stripCommentsOutsideStrings(input: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let quote = '';
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) { escape = false; i++; continue; }
      if (ch === '\\') { escape = true; i++; continue; }
      if (ch === quote) { inString = false; quote = ''; }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripTrailingCommasOutsideStrings(input: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let quote = '';
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) { escape = false; i++; continue; }
      if (ch === '\\') { escape = true; i++; continue; }
      if (ch === quote) { inString = false; quote = ''; }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; i++; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') { i++; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * String-aware balanced-brace finder. Returns the substring of `text` starting
 * at `startIdx` (which must point at '{') up to and including its matching
 * '}'. Returns null if no balance is found. Mirrors the webview helper of the
 * same name.
 */
export function findBalancedObject(text: string, startIdx: number): string | null {
  if (text[startIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let quote = '';
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * Try strict JSON.parse, then a single lenient pass via repairJsonish.
 * Returns a typed envelope only if the parsed object looks like a continuation
 * envelope. This intentionally rejects unrelated JSON objects so we don't
 * confuse e.g. tool argument blobs with envelopes.
 */
export function tryParseEnvelope(raw: string): StructuredActionEnvelope | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const direct = JSON.parse(trimmed);
    if (isEnvelopeShape(direct)) return direct;
  } catch { /* fall through */ }
  try {
    const repaired = JSON.parse(repairJsonish(trimmed));
    if (isEnvelopeShape(repaired)) return repaired;
  } catch { /* give up */ }
  return null;
}

/**
 * Find the start index of the top-level '{' that encloses position `at`.
 * Implemented as a forward scan with proper string tracking — backward scans
 * cannot tell whether a quote opens or closes a string without re-scanning
 * the entire prefix anyway, and forward scanning lets us track the brace
 * stack reliably.
 */
function findEnclosingBraceStart(text: string, at: number): number {
  const stack: number[] = [];
  let inStr = false;
  let quote = '';
  let escape = false;
  for (let i = 0; i <= at && i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) { inStr = false; quote = ''; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') stack.push(i);
    else if (ch === '}') stack.pop();
  }
  return stack.length > 0 ? stack[0] : -1;
}

/**
 * Walk a free-form LLM response and return every embedded continuation
 * envelope, in document order. Handles three emission styles:
 *   1) ```json fenced blocks
 *   2) ``` fenced blocks with no language hint
 *   3) Bare top-level JSON objects containing a "summary" key
 * Each candidate body is run through `tryParseEnvelope` so quirks like smart
 * quotes and trailing commas are tolerated.
 */
export function extractEnvelopes(content: string): StructuredActionEnvelope[] {
  const text = String(content ?? '');
  if (!text) return [];

  const found: StructuredActionEnvelope[] = [];
  const consumed: Array<[number, number]> = [];

  // 1) Fenced blocks (```json, ```jsonc, or no language).
  const fenceRe = /(^|\n)([ \t]*)```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(text)) !== null) {
    const lang = (fenceMatch[3] || '').toLowerCase();
    if (lang && lang !== 'json' && lang !== 'jsonc') continue;
    const body = fenceMatch[4] ?? '';
    const env = tryParseEnvelope(body);
    if (env) {
      found.push(env);
      const start = fenceMatch.index + (fenceMatch[1] ? fenceMatch[1].length : 0);
      consumed.push([start, fenceMatch.index + fenceMatch[0].length]);
    }
  }

  // 2) Bare JSON objects containing "summary":. Skip ranges already consumed.
  const summaryRe = /"summary"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = summaryRe.exec(text)) !== null) {
    const at = m.index;
    if (consumed.some(([a, b]) => at >= a && at <= b)) continue;
    const braceStart = findEnclosingBraceStart(text, at);
    if (braceStart < 0) continue;
    const candidate = findBalancedObject(text, braceStart);
    if (!candidate) continue;
    const env = tryParseEnvelope(candidate);
    if (env) {
      found.push(env);
      consumed.push([braceStart, braceStart + candidate.length]);
      summaryRe.lastIndex = braceStart + candidate.length;
    }
  }

  return found;
}

/**
 * Convenience: first envelope or undefined.
 */
export function extractPrimaryEnvelope(content: string): StructuredActionEnvelope | undefined {
  return extractEnvelopes(content)[0];
}
