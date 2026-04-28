/**
 * DreamGraph Explorer — Phase 4 Slice 1: instance auth helper.
 *
 * Mutations must prove they're talking to the right brain. Every
 * `POST /explorer/mutations/*` endpoint (and the `/api/*` write paths
 * once Slice 2 lands) calls `requireInstanceAuth(req, res)`:
 *
 *   1. Reads the `X-DreamGraph-Instance` request header.
 *   2. Compares it (case-insensitive) against the active instance UUID.
 *   3. Returns `null` after writing a 401/403 response if the check fails.
 *
 * In **legacy mode** (no UUID scope active) the helper allows the call
 * through but returns the literal string `"legacy"` so audit rows still
 * record an actor. This matches the daemon's broader policy: legacy
 * mode is an explicit opt-out from isolation, not a security boundary.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getActiveScope } from "../instance/lifecycle.js";

export interface AuthSuccess {
  /** UUID of the active instance, or "legacy" when no scope is active. */
  actor_uuid: string;
  /** True when running without UUID isolation. */
  legacy: boolean;
}

function send(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: code, message }));
}

/**
 * Validate the `X-DreamGraph-Instance` header against the active scope.
 *
 * - Returns the resolved actor on success.
 * - Returns `null` after sending a JSON error response on failure.
 *
 * The response is written here so callers can short-circuit with
 * `if (!auth) return;` and stay readable.
 */
export function requireInstanceAuth(
  req: IncomingMessage,
  res: ServerResponse,
): AuthSuccess | null {
  const scope = getActiveScope();
  const header = req.headers["x-dreamgraph-instance"];
  const presented = Array.isArray(header) ? header[0] : header;

  if (scope === null) {
    // Legacy mode: accept anything (including missing header) but tag the
    // audit row clearly. There is no isolation to enforce.
    return { actor_uuid: presented?.trim().length ? presented.trim() : "legacy", legacy: true };
  }

  if (!presented || typeof presented !== "string" || presented.trim().length === 0) {
    send(res, 401, "missing_instance_header", "X-DreamGraph-Instance header is required for mutation endpoints.");
    return null;
  }

  const expected = scope.uuid.toLowerCase();
  const actual = presented.trim().toLowerCase();

  if (expected !== actual) {
    send(res, 403, "wrong_instance", `Header instance ${actual} does not match active instance ${expected}.`);
    return null;
  }

  return { actor_uuid: scope.uuid, legacy: false };
}
