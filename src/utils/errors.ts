/**
 * DreamGraph MCP Server — Standardized error/success helpers.
 *
 * All tool responses use these wrappers so AI agents receive
 * consistent, structured responses they can reason about.
 */

import type { ToolSuccess, ToolError, ToolResponse } from "../types/index.js";
import { logger } from "./logger.js";

export function success<T>(data: T): ToolSuccess<T> {
  return { success: true, data };
}

export function error(code: string, message: string): ToolError {
  return {
    success: false,
    error: { code, message },
  };
}

/**
 * Convenience: wrap a handler so unhandled exceptions become structured errors.
 *
 * F-20: optionally pass a `context` label so the failure leaves a structured
 * trail in the logs. Without a context, we still emit a debug entry — silent
 * swallowing was a long-standing observability gap.
 */
export async function safeExecute<T>(
  fn: () => Promise<ToolResponse<T>>,
  context?: string,
): Promise<ToolResponse<T>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split("\n")[1]?.trim() : undefined;
    if (context) {
      logger.warn(`safeExecute(${context}) failed: ${message}${stack ? ` @ ${stack}` : ""}`);
    } else {
      logger.debug(`safeExecute failed: ${message}${stack ? ` @ ${stack}` : ""}`);
    }
    return error("INTERNAL_ERROR", message);
  }
}
