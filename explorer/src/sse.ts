/**
 * Phase 3 / Slice 2 — Server-Sent Events client hook.
 *
 * Subscribes to GET /explorer/events using the native EventSource API.
 * The browser handles automatic reconnection and sends Last-Event-ID
 * (read by our `parseLastEventId` on the daemon side) so missed events
 * are replayed from the ring buffer.
 *
 * The hook surfaces:
 *   - the most recent N events (newest-first) for the event dock
 *   - per-event-id "pulses" with monotonically increasing tokens so
 *     the halo overlay can re-trigger animations on repeated events
 */

import { useEffect, useRef, useState } from "react";

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
  seq: number;
  kind: GraphEventKind;
  affected_ids: string[];
  etag?: string | null;
  ts: string;
  payload?: Record<string, unknown>;
}

export interface PulseToken {
  /** Node/entity id being pulsed. */
  id: string;
  /** Monotonically increasing counter — restart animation when it changes. */
  token: number;
  /** Event kind so the overlay can pick a color. */
  kind: GraphEventKind;
  /** Wall-clock ms when the pulse was queued (for fade-out). */
  startedAt: number;
}

const KINDS_THAT_PULSE: GraphEventKind[] = [
  "tension.created",
  "tension.resolved",
  "candidate.added",
  "candidate.promoted",
  "candidate.rejected",
];

export interface UseEventStreamResult {
  events: GraphEvent[];
  pulses: PulseToken[];
  connected: boolean;
}

const RING_LIMIT = 50;
const PULSE_TTL_MS = 1200;

/**
 * Subscribe to /explorer/events for the lifetime of the component.
 *
 * Uses the native EventSource. Automatic reconnect with Last-Event-ID
 * is built into the browser per the SSE spec — no manual retry.
 */
export function useEventStream(url: string = "/explorer/events"): UseEventStreamResult {
  const [events, setEvents] = useState<GraphEvent[]>([]);
  const [pulses, setPulses] = useState<PulseToken[]>([]);
  const [connected, setConnected] = useState(false);
  const tokenCounterRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(url);

    const handleEvent = (kind: GraphEventKind) => (msg: MessageEvent<string>) => {
      let parsed: GraphEvent;
      try {
        const data = JSON.parse(msg.data) as Omit<GraphEvent, "kind"> & { kind?: GraphEventKind };
        parsed = { ...data, kind: data.kind ?? kind } as GraphEvent;
      } catch {
        return;
      }

      setEvents((prev) => {
        const next = [parsed, ...prev];
        return next.length > RING_LIMIT ? next.slice(0, RING_LIMIT) : next;
      });

      if (KINDS_THAT_PULSE.includes(parsed.kind) && parsed.affected_ids.length > 0) {
        setPulses((prev) => {
          const now = Date.now();
          // Drop expired pulses to keep the list short.
          const fresh = prev.filter((p) => now - p.startedAt < PULSE_TTL_MS);
          const additions: PulseToken[] = parsed.affected_ids.map((id) => ({
            id,
            token: ++tokenCounterRef.current,
            kind: parsed.kind,
            startedAt: now,
          }));
          return [...fresh, ...additions];
        });
      }
    };

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    // Listen for each named event kind (server emits `event: KIND`).
    const kinds: GraphEventKind[] = [
      "snapshot.changed",
      "cache.invalidated",
      "dream.cycle.completed",
      "tension.created",
      "tension.resolved",
      "candidate.added",
      "candidate.promoted",
      "candidate.rejected",
      "audit.appended",
    ];
    const handlers = kinds.map((k) => {
      const h = handleEvent(k);
      es.addEventListener(k, h as EventListener);
      return [k, h] as const;
    });

    return () => {
      for (const [k, h] of handlers) es.removeEventListener(k, h as EventListener);
      es.close();
    };
  }, [url]);

  // Periodic prune so stale pulses fall off even when no new events arrive.
  useEffect(() => {
    const t = window.setInterval(() => {
      setPulses((prev) => {
        const now = Date.now();
        const fresh = prev.filter((p) => now - p.startedAt < PULSE_TTL_MS);
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 400);
    return () => window.clearInterval(t);
  }, []);

  return { events, pulses, connected };
}
