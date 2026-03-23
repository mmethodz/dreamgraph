/**
 * DreamGraph MCP Server — Standardized error/success helpers.
 *
 * All tool responses use these wrappers so AI agents receive
 * consistent, structured responses they can reason about.
 */

import type { ToolSuccess, ToolError, ToolResponse } from "../types/index.js";

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
 */
export async function safeExecute<T>(
  fn: () => Promise<ToolResponse<T>>
): Promise<ToolResponse<T>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error("INTERNAL_ERROR", message);
  }
}
