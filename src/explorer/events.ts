/**
 * DreamGraph Explorer — Server-Sent Events stream.
 *
 * Surface (per plans/DREAMGRAPH_EXPLORER.md §4.3, §10):
 *   GET /explorer/events
 *
 * Wire format (one record per event):
 *   id: <seq>
 *   event: <kind>
 *   data: <json>
 *   <blank line>
 *
 * Resume semantics:
 *   - Honours `Last-Event-ID` request header. On reconnect the client sends
 *     the last seq it processed; we replay all buffered events with
 *     `seq > lastEventId` before subscribing to live ones.
 *   - Replay is best-effort and bounded by the bus ring buffer (~500). If
 *     the gap is larger than the buffer the client should refetch the
 *     snapshot and reset its state — surfaced as the "stream.gap" event.
 *
 * Heartbeat:
 *   - SSE comment frame (`: ping\n\n`) every HEARTBEAT_MS to keep the
 *     connection alive through proxies / NAT timeouts.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { graphEventBus, type GraphEvent } from "../graph/events.js";
import { logger } from "../utils/logger.js";

const HEARTBEAT_MS = 15_000;
const RING_SIZE_HINT = 500;

function writeEvent(res: ServerResponse, event: GraphEvent): void {
  // Each field on its own line, terminated by a blank line. EventSource
  // will surface `data` as a string — clients JSON.parse it.
  res.write(`id: ${event.seq}\n`);
  res.write(`event: ${event.kind}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeComment(res: ServerResponse, text: string): void {
  res.write(`: ${text}\n\n`);
}

function parseLastEventId(req: IncomingMessage): number {
  const header = req.headers["last-event-id"];
  if (typeof header !== "string") return 0;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function handleEventsStream(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering (nginx and friends honour this).
    "X-Accel-Buffering": "no",
  });

  // Initial comment so EventSource's `open` event fires immediately even
  // when no real events are pending.
  writeComment(res, "open");

  // ---- Replay phase ----
  const lastEventId = parseLastEventId(req);
  const replay = graphEventBus.replay(lastEventId);
  // If the client lagged further than the ring buffer, warn it so it can
  // reset its view by refetching the snapshot.
  if (lastEventId > 0 && replay.length === RING_SIZE_HINT) {
    writeComment(res, `gap: replay capped at ${RING_SIZE_HINT}`);
  }
  for (const event of replay) {
    writeEvent(res, event);
  }

  // ---- Live phase ----
  const unsubscribe = graphEventBus.subscribe((event) => {
    try {
      writeEvent(res, event);
    } catch (err) {
      logger.warn(
        `SSE write failed (${event.kind}): ${(err as Error).message}`,
      );
    }
  });

  const heartbeat = setInterval(() => {
    try {
      writeComment(res, "ping");
    } catch {
      // Socket gone — the close handler will do cleanup.
    }
  }, HEARTBEAT_MS);
  // Don't keep the event loop alive just for heartbeats.
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}
