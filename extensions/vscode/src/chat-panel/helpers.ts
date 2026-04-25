/**
 * Pure helper functions extracted from chat-panel.ts.
 *
 * These are stateless utilities — no `this`, no I/O, no side effects beyond
 * what their inputs declare. Kept here so chat-panel.ts can stay focused on
 * webview lifecycle, streaming orchestration, and message persistence, and so
 * the helpers can be unit-tested directly without instantiating ChatPanel.
 *
 * Part of F-06 sub-batch 3b/3 (chat-panel.ts split). See
 * plans/SYSTEM_FINDINGS.md for the rationale and scope.
 */

import type { SemanticAnchor } from '../types.js';

// ---------- Constants ----------

export const MAX_RENDERED_MESSAGE_CHARS = 100_000;
export const MAX_ENTITY_LINKS_PER_MESSAGE = 100;

/** Patterns used to redact secrets from any model-visible text or chunk. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi,
  /(?:sk-|pk-|ghp_|gho_|github_pat_)\S+/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];

// ---------- Shared types (moved from chat-panel.ts) ----------

export interface ImplicitEntityDetectionResult {
  names: string[];
  truncated: boolean;
}

export interface VerdictBanner {
  level: 'verified' | 'partial' | 'speculative';
  summary: string;
}

export interface ToolTraceEntry {
  tool: string;
  argsSummary: string;
  filesAffected: string[];
  durationMs: number;
  status: 'completed' | 'failed';
}

// ---------- Pure helpers ----------

export function summarizeToolArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return 'no args';
  const keys = Object.keys(input as Record<string, unknown>).slice(0, 4);
  return keys.length > 0 ? keys.join(', ') : 'no args';
}

export function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function truncateToolResult(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, limit)}\n\n[Tool result truncated to ${limit} chars]`;
}

export function deriveVerdict(content: string, trace: ToolTraceEntry[]): VerdictBanner {
  const normalized = content.toLowerCase();
  const failedCount = trace.filter((t) => t.status === 'failed').length;
  if (normalized.includes('verified:') || normalized.includes('confirmed:') || (trace.length > 0 && failedCount === 0)) {
    return {
      level: 'verified',
      summary: failedCount === 0 && trace.length > 0
        ? `Verified with ${trace.length} executed tool call${trace.length === 1 ? '' : 's'}.`
        : 'Verified based on explicit evidence in the response.',
    };
  }
  if (failedCount > 0 || normalized.includes('likely') || normalized.includes('partial')) {
    return {
      level: 'partial',
      summary: failedCount > 0
        ? `Partial confidence: ${failedCount} tool call${failedCount === 1 ? '' : 's'} failed during evidence gathering.`
        : 'Partial confidence: the response includes uncertainty or incomplete evidence.',
    };
  }
  return {
    level: 'speculative',
    summary: 'Speculative synthesis: no strong verification signals were detected.',
  };
}

/**
 * Extract file paths referenced by tool inputs (or, if none, results).
 *
 * Two-arity signature kept compatible with the previous private method:
 * `extractFilesAffected(input, result?)` or
 * `extractFilesAffected(toolName, input, result?)` (toolName is ignored).
 */
export function extractFilesAffected(
  toolNameOrInput: unknown,
  inputOrResult?: unknown,
  maybeResult?: string,
): string[] {
  const input = typeof toolNameOrInput === 'string' ? inputOrResult : toolNameOrInput;
  const result = typeof toolNameOrInput === 'string'
    ? (maybeResult ?? '')
    : (typeof inputOrResult === 'string' ? inputOrResult : '');
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^[A-Za-z]:\\|^\.|^src\/|^extensions\//.test(value) || /\.(ts|tsx|js|jsx|json|md|css|html)$/i.test(value)) {
        found.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(input);
  if (found.size === 0) visit(result);
  return Array.from(found).slice(0, 5);
}

export function detectImplicitEntities(
  content: string,
  maxLinks: number = MAX_ENTITY_LINKS_PER_MESSAGE,
): ImplicitEntityDetectionResult {
  const explicitUris = new Set(
    Array.from(content.matchAll(/\b[a-z-]+:\/\/([A-Za-z0-9._/-]+)/g)).map((match) => match[1]),
  );
  const candidates = Array.from(
    content.matchAll(/\b(?:feature|workflow|ADR|tension|entity|data model)\s+([A-Z][A-Za-z0-9._-]{1,80})\b/g),
  )
    .map((match) => match[1])
    .filter((name) => !explicitUris.has(name));
  const deduped = Array.from(new Set(candidates));
  return {
    names: deduped.slice(0, maxLinks),
    truncated: deduped.length > maxLinks,
  };
}

export function formatImplicitEntityNotice(result: ImplicitEntityDetectionResult): string {
  if (result.names.length === 0) {
    return '';
  }
  const prefix = 'Implicit entity references detected: ';
  const body = result.names.join(', ');
  const suffix = result.truncated ? ' … [Entity link cap reached]' : '';
  return `${prefix}${body}${suffix}`;
}

export function redactSecrets(content: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) =>
    text.replace(pattern, (match) => {
      const sepMatch = match.match(/[:=]\s*/);
      if (sepMatch && typeof sepMatch.index === 'number') {
        return match.slice(0, sepMatch.index + sepMatch[0].length) + '****';
      }
      return match.slice(0, 8) + '****';
    }),
    content,
  );
}

/**
 * Strip the structured autonomy envelope (a ```json``` fenced block containing
 * `goal_status`) so it never renders in chat. The envelope is consumed by the
 * autonomy loop instead.
 */
export function stripStructuredEnvelope(content: string): string {
  return content
    .replace(/```json[\r\n][\s\S]*?"goal_status"[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Format a stop-context block for injection into the next turn's system
 * prompt, so that "resume" re-enters from a known task position rather than
 * starting fresh.
 */
export function formatStopContextBlock(ctx: {
  summary?: string;
  nextSteps: Array<{ label: string; rationale?: string }>;
}): string {
  const lines: string[] = ['## Task Continuation Context'];
  lines.push('The previous autonomy pass stopped. The following context describes where the task left off.');
  if (ctx.summary) {
    lines.push(`\n**Last progress summary:** ${ctx.summary}`);
  }
  if (ctx.nextSteps.length > 0) {
    lines.push('\n**Recommended next steps when resuming:**');
    for (const step of ctx.nextSteps) {
      lines.push(`- ${step.label}${step.rationale ? ` — ${step.rationale}` : ''}`);
    }
  }
  lines.push('\nIf the user says "resume", "continue", or similar, re-enter the task from the above context rather than starting fresh.');
  return lines.join('\n');
}

export function formatAnchorFooterStatus(anchor: SemanticAnchor): string {
  const status = anchor.migrationStatus ?? 'native';
  const label = anchor.canonicalId
    ? `${anchor.canonicalKind ?? 'entity'}:${anchor.canonicalId}`
    : anchor.symbolPath ?? anchor.label;

  // Embed a sentinel token that renderContextFooter() in the webview will
  // parse into a styled badge. Format: [anchor-status:STATE:LABEL].
  const sentinel = `[anchor-status:${status}:${label ?? ''}]`;

  switch (status) {
    case 'promoted':
      return `Anchor: promoted to ${label} ${sentinel}`;
    case 'rebound':
      return `Anchor: rebound to ${label} ${sentinel}`;
    case 'drifted':
      return `Anchor: drifted near ${label} ${sentinel}`;
    case 'archived':
      return `Anchor: archived (${label}) ${sentinel}`;
    case 'native':
    default:
      return anchor.canonicalId
        ? `Anchor: canonical ${label} ${sentinel}`
        : `Anchor: native ${label} ${sentinel}`;
  }
}

// ---------- Render-output utilities ----------

export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function applyRenderLimits(
  content: string,
  maxChars: number = MAX_RENDERED_MESSAGE_CHARS,
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  const clipped = content.slice(0, maxChars);
  return {
    content: `${clipped}\n\n[Response truncated]`,
    truncated: true,
  };
}

// ---------- Per-tool limit/timeout tables ----------

/** Per-tool result truncation limits (chars). Tools not listed use _default. */
export const TOOL_RESULT_LIMITS: Record<string, number> = {
  read_source_code: 12_000,
  read_local_file: 12_000,
  query_api_surface: 10_000,
  run_command: 8_000,
  edit_entity: 6_000,
  edit_file: 6_000,
  modify_entity: 6_000,
  write_file: 4_000,
  _default: 4_000,
};

/** Per-tool MCP-call timeouts (ms). Tools not listed use _default. */
export const TOOL_TIMEOUT_MS: Record<string, number> = {
  dream_cycle: 120_000,
  nightmare_cycle: 120_000,
  metacognitive_analysis: 120_000,
  run_command: 60_000,
  write_file: 30_000,
  edit_file: 30_000,
  read_source_code: 30_000,
  read_local_file: 30_000,
  _default: 60_000,
};

export function toolResultLimit(toolName: string): number {
  return TOOL_RESULT_LIMITS[toolName] ?? TOOL_RESULT_LIMITS._default;
}

export function toolTimeoutMs(toolName: string): number {
  return TOOL_TIMEOUT_MS[toolName] ?? TOOL_TIMEOUT_MS._default;
}
