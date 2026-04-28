/**
 * GraphEventBus — in-process event bus for Explorer live updates.
 *
 * Wire envelope (see plans/DREAMGRAPH_EXPLORER.md §4.3, §5):
 *   { seq, kind, affected_ids, etag, ts, payload? }
 *
 * Phase 3 / Slice 1 producers:
 *   - "snapshot.changed"     — emitted when the snapshot etag drifts
 *   - "cache.invalidated"    — emitted when an upstream caller wipes caches
 *
 * Future cognitive producers (Slice 2):
 *   - "dream.cycle.completed"
 *   - "tension.created" / "tension.resolved"
 *   - "candidate.added" / "candidate.promoted"
 *
 * Properties:
 *   - Monotonic `seq` counter (resets only on process restart).
 *   - Ring buffer of the last `RING_SIZE` events for `Last-Event-ID` resume.
 *   - Synchronous fan-out: subscribers run inline; throw-safe.
 */

import { logger } from "../utils/logger.js";

export type GraphEventKind =
  | "snapshot.changed"
  | "cache.invalidated"
  | "dream.cycle.completed"
  | "tension.created"
  | "tension.resolved"
  | "candidate.added"
  | "candidate.promoted"
  | "candidate.rejected"
  | "audit.appended";

export interface GraphEvent {
  /** Monotonic per-process sequence number, starting at 1. */
  seq: number;
  kind: GraphEventKind;
  /** Node ids the event affects (may be empty for global events). */
  affected_ids: string[];
  /** Snapshot etag at the time of emission; null if unknown. */
  etag: string | null;
  /** ISO timestamp. */
  ts: string;
  /** Optional kind-specific payload. */
  payload?: Record<string, unknown>;
}

export type GraphEventHandler = (event: GraphEvent) => void;

const RING_SIZE = 500;

class GraphEventBus {
  private seqCounter = 0;
  private readonly subscribers = new Set<GraphEventHandler>();
  private readonly ring: GraphEvent[] = [];

  /**
   * Subscribe to all events. Returns an `unsubscribe` function.
   * Handlers are invoked synchronously in registration order.
   */
  subscribe(handler: GraphEventHandler): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  /**
   * Emit a new event. Assigns the next monotonic `seq`, appends to the
   * ring buffer, and fans out to subscribers.
   */
  emit(
    kind: GraphEventKind,
    options: {
      affected_ids?: string[];
      etag?: string | null;
      payload?: Record<string, unknown>;
    } = {},
  ): GraphEvent {
    this.seqCounter += 1;
    const event: GraphEvent = {
      seq: this.seqCounter,
      kind,
      affected_ids: options.affected_ids ?? [],
      etag: options.etag ?? null,
      ts: new Date().toISOString(),
      ...(options.payload !== undefined ? { payload: options.payload } : {}),
    };
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) {
      this.ring.splice(0, this.ring.length - RING_SIZE);
    }
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch (err) {
        logger.error(
          `GraphEventBus subscriber threw on ${kind}: ${(err as Error).message}`,
        );
      }
    }
    return event;
  }

  /**
   * Return all buffered events with `seq > sinceSeq`, in order.
   * Used by the SSE handler for `Last-Event-ID` resume.
   */
  replay(sinceSeq: number): GraphEvent[] {
    if (!Number.isFinite(sinceSeq) || sinceSeq <= 0) return [...this.ring];
    return this.ring.filter((e) => e.seq > sinceSeq);
  }

  /** Current head of the seq counter (0 before any emit). */
  currentSeq(): number {
    return this.seqCounter;
  }

  /** Number of active subscribers. Test seam. */
  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Test seam — wipe state between unit tests. */
  _resetForTest(): void {
    this.seqCounter = 0;
    this.subscribers.clear();
    this.ring.length = 0;
  }
}

export const graphEventBus = new GraphEventBus();
export { GraphEventBus };
