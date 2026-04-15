/**
 * DreamGraph MCP Server — Logger utility.
 *
 * CRITICAL: Because STDIO is used for MCP transport (JSON-RPC),
 * ALL logging MUST go to stderr. Using console.log() would corrupt
 * the MCP message stream.
 *
 * This module provides a simple logger that strictly uses stderr.
 */

import { config } from "../config/config.js";

const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|pwd|api[-_]?key|authorization|cookie|session|bearer)/i;

function timestamp(): string {
  return new Date().toISOString();
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitizeLogValue(nested);
  }
  return sanitized;
}

function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.map(sanitizeLogValue);
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [INFO]  ${message}`, ...sanitizeLogArgs(args));
  },

  warn(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [WARN]  ${message}`, ...sanitizeLogArgs(args));
  },

  error(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [ERROR] ${message}`, ...sanitizeLogArgs(args));
  },

  debug(message: string, ...args: unknown[]): void {
    if (config.env.debug) {
      console.error(`[${timestamp()}] [DEBUG] ${message}`, ...sanitizeLogArgs(args));
    }
  },
};
