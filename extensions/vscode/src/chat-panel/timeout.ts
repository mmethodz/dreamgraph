/**
 * Pure timeout / recovery helpers extracted from chat-panel.ts.
 *
 * These are stateless utilities — no `this`, no I/O, no dependencies on the
 * VS Code extension host. They cover:
 *   - per-provider request budgets ({@link getLlmTimeoutMs})
 *   - timeout-error sniffing ({@link isTimeoutError})
 *   - recovery prompt construction ({@link buildTimeoutRecoveryPrompt})
 *   - the AbortSignal helper that wires a request-level timeout into a
 *     parent abort controller ({@link createTimeoutAbortSignal})
 *
 * The high-level orchestration (streaming the recovery turn, persisting the
 * recovered message) stays in chat-panel.ts because it touches webview state.
 *
 * Part of F-06 sub-batch 3b/3 (chat-panel.ts split).
 */

/** Hard timeout per LLM provider request (ms). Prevents infinite hangs. */
export const REQUEST_TIMEOUT_MS = 90_000;

export type LlmTimeoutMode = 'stream' | 'tool';

export interface LlmTimeoutOptions {
  mode: LlmTimeoutMode;
  /** Optional provider key. Defaults to 'anthropic' when omitted. */
  provider?: string;
  /** When set and > 12, an extra 30s is added. */
  toolCount?: number;
  /** When true, the budget is reduced (used for the recovery retry). */
  reducedContext?: boolean;
}

const PROVIDER_BUDGETS: Record<string, { stream: number; tool: number }> = {
  anthropic: { stream: 90_000, tool: 120_000 },
  openai: { stream: 150_000, tool: 210_000 },
  ollama: { stream: 180_000, tool: 180_000 },
};

/**
 * Compute the per-request LLM timeout budget for the given mode + provider.
 *
 * Identical math to the previous `ChatPanel._getLlmTimeoutMs` but pure: the
 * provider is passed in instead of being read from `this.architectLlm`.
 */
export function getLlmTimeoutMs(options: LlmTimeoutOptions): number {
  const provider = options.provider ?? 'anthropic';
  const selected = PROVIDER_BUDGETS[provider] ?? { stream: REQUEST_TIMEOUT_MS, tool: REQUEST_TIMEOUT_MS };
  let timeoutMs = options.mode === 'tool' ? selected.tool : selected.stream;
  if (options.toolCount && options.toolCount > 12) {
    timeoutMs += 30_000;
  }
  if (options.reducedContext) {
    timeoutMs = Math.max(60_000, timeoutMs - 30_000);
  }
  return timeoutMs;
}

/** True when the error message looks like an LLM request timeout. */
export function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timed out after \d+s/i.test(message) || /request timed out/i.test(message);
}

/**
 * Build the recovery prompt that the agent retries with after a timeout.
 *
 * The string format is part of the contract — do not change without updating
 * the matching test in `extensions/vscode/src/test/timeout-recovery.test.ts`.
 */
export function buildTimeoutRecoveryPrompt(originalText: string): string {
  return [
    originalText,
    '',
    'Continue using an alternative method because the previous LLM request timed out.',
    'Use a faster recovery strategy:',
    '1. Prefer the knowledge graph over long source reads.',
    '2. Use at most 8 recent messages of history.',
    '3. Avoid broad tool use unless strictly necessary.',
    '4. Produce a concise useful result first, then suggest a follow-up if needed.',
  ].join('\n');
}

export interface TimeoutAbortHandle {
  signal: AbortSignal;
  /** MUST be called when the request completes — clears the timer + listener. */
  dispose: () => void;
}

/**
 * Create a child AbortSignal that aborts on EITHER:
 *   - the parent signal aborting (user clicked Stop), OR
 *   - the timeout firing.
 *
 * The returned `dispose()` clears the timer and detaches the parent listener
 * so the controller can be GC'd promptly. Always call it in a `finally` block.
 *
 * Pure with respect to chat-panel state: the parent abort controller is
 * passed in instead of read from `this.abortController`.
 */
export function createTimeoutAbortSignal(
  parent: AbortController | null | undefined,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): TimeoutAbortHandle {
  const child = new AbortController();
  const timer = setTimeout(
    () => child.abort(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)),
    timeoutMs,
  );

  const onParentAbort = () => {
    clearTimeout(timer);
    child.abort(parent?.signal.reason ?? 'User stopped generation');
  };

  if (parent?.signal.aborted) {
    clearTimeout(timer);
    child.abort(parent.signal.reason);
  } else {
    parent?.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  return {
    signal: child.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.signal.removeEventListener('abort', onParentAbort);
    },
  };
}
