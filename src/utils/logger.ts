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
const SENSITIVE_VALUE_PATTERN = /(bearer\s+[a-z0-9._~+\/-]+=*|gh[pousr]_[a-z0-9_]+|sk-[a-z0-9_-]+|api[-_]?key\s*[:=]\s*\S+|authorization\s*[:=]\s*\S+)/i;

function timestamp(): string {
  return new Date().toISOString();
}

function redactSensitiveString(value: string): string {
  return SENSITIVE_VALUE_PATTERN.test(value) ? "[REDACTED]" : value;
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveString(value.message),
    };
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

function sanitizeLogMessage(message: string): string {
  return redactSensitiveString(message);
}

function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.map(sanitizeLogValue);
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [INFO]  ${sanitizeLogMessage(message)}`, ...sanitizeLogArgs(args));
  },

  warn(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [WARN]  ${sanitizeLogMessage(message)}`, ...sanitizeLogArgs(args));
  },

  error(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [ERROR] ${sanitizeLogMessage(message)}`, ...sanitizeLogArgs(args));
  },

  debug(message: string, ...args: unknown[]): void {
    if (config.env.debug) {
      console.error(`[${timestamp()}] [DEBUG] ${sanitizeLogMessage(message)}`, ...sanitizeLogArgs(args));
    }
  },
};
