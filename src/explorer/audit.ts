/**
 * DreamGraph Explorer — mutation audit log.
 *
 * Append-only JSONL at `<dataDir>/explorer_audit.jsonl`. One row per
 * mutation attempt — successful, failed, or dry-run rehearsal. Rows
 * follow the contract:
 *
 *   {
 *     mutation_id, timestamp, actor, intent, affected_ids,
 *     reason, before_hash, after_hash, etag, dry_run, ok,
 *     error?, message?
 *   }
 *
 * After a successful append the bus emits `audit.appended` so the
 * Explorer EventDock surfaces every mutation in real time. There is no
 * "silent" graph write.
 */

import { appendFile } from "node:fs/promises";
import { dataPath } from "../utils/paths.js";
import { withFileLock } from "../utils/mutex.js";
import { logger } from "../utils/logger.js";
import { graphEventBus } from "../graph/events.js";

export interface AuditRow {
  /** UUID generated per request. Returned to client and surfaced on the bus. */
  mutation_id: string;
  /** ISO-8601 wall clock when the row was written. */
  timestamp: string;
  /** Active instance UUID, or "legacy" when isolation is off. */
  actor: string;
  /** Stable wire name (e.g. "tension.resolve"). */
  intent: string;
  /** Entity / edge / tension ids the mutation touched. */
  affected_ids: string[];
  /** Required free-text justification. May be `"(dry-run)"` for rehearsals. */
  reason: string;
  /** SHA-256 of the relevant subject before the mutation, or null. */
  before_hash: string | null;
  /** SHA-256 of the same subject after the mutation, or null. */
  after_hash: string | null;
  /** Snapshot etag observed after the mutation completed. */
  etag: string | null;
  /** True when the request was a no-op rehearsal. */
  dry_run: boolean;
  /** Whether the mutation succeeded end-to-end. */
  ok: boolean;
  /** Error code when `ok === false`. */
  error?: string;
  /** Human-readable message when `ok === false`. */
  message?: string;
}

const auditPath = (): string => dataPath("explorer_audit.jsonl");

/**
 * Append a single audit row and emit `audit.appended` on the graph bus.
 * Never throws — failures are logged and dropped because audit writes
 * must not break the user-visible response.
 */
export async function appendAuditRow(row: AuditRow): Promise<void> {
  const line = JSON.stringify(row) + "\n";
  try {
    await withFileLock("explorer_audit.jsonl", async () => {
      await appendFile(auditPath(), line, { encoding: "utf-8" });
    });
    // Surface the row on the live event bus so EventDock shows every
    // mutation. Affected ids carry through so SSE consumers can pulse
    // the same nodes if they wish.
    graphEventBus.emit("audit.appended", {
      affected_ids: row.affected_ids,
      payload: {
        mutation_id: row.mutation_id,
        intent: row.intent,
        actor: row.actor,
        ok: row.ok,
        dry_run: row.dry_run,
        reason: row.reason,
        before_hash: row.before_hash,
        after_hash: row.after_hash,
        etag: row.etag,
      },
    });
  } catch (err) {
    logger.warn(
      `appendAuditRow: failed to write explorer_audit.jsonl — ${err instanceof Error ? err.message : err}`,
    );
  }
}
