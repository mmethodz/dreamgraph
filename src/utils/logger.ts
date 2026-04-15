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

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [INFO]  ${message}`, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    console.error(`[${timestamp()}] [WARN]  ${message}`, ...args);
  },

  error(message: string, ...args: unknown[]): void { // lgtm[js/clear-text-logging]
    console.error(`[${timestamp()}] [ERROR] ${message}`, ...args); // lgtm[js/clear-text-logging]
  },

  debug(message: string, ...args: unknown[]): void {
    if (config.env.debug) {
      console.error(`[${timestamp()}] [DEBUG] ${message}`, ...args);
    }
  },
};
