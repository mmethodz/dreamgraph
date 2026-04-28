/**
 * GraphEventBus + SSE handler — Phase 3 / Slice 1 tests.
 *
 * Covers:
 *   - Monotonic seq, ring buffer, replay semantics.
 *   - SSE wire format (id/event/data triplet, blank line terminator).
 *   - Last-Event-ID resume: events emitted before connect are replayed
 *     in order, then live events flow.
 *   - Connection close unsubscribes the handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { graphEventBus } from "../src/graph/events.js";
import { handleEventsStream } from "../src/explorer/events.js";

/* ------------------------------------------------------------------ */
/*  Test doubles for IncomingMessage / ServerResponse                 */
/* ------------------------------------------------------------------ */

interface FakeReq {
  headers: Record<string, string>;
  on: IncomingMessage["on"];
  emit: (event: string, ...args: unknown[]) => boolean;
}

function makeReq(headers: Record<string, string> = {}): FakeReq {
  const stream = new PassThrough();
  // PassThrough already has on/emit, but we want to inject custom headers.
  (stream as unknown as { headers: Record<string, string> }).headers = headers;
  return stream as unknown as FakeReq;
}

interface CapturedRes {
  res: ServerResponse;
  chunks: string[];
  status: number | null;
  headers: Record<string, string | number> | null;
  close: () => void;
}

function makeRes(): CapturedRes {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (c: Buffer | string) => {
    chunks.push(typeof c === "string" ? c : c.toString("utf-8"));
  });
  let status: number | null = null;
  let headers: Record<string, string | number> | null = null;
  const fake = stream as unknown as ServerResponse & {
    writeHead: ServerResponse["writeHead"];
  };
  fake.writeHead = ((code: number, hdrs?: Record<string, string | number>) => {
    status = code;
    headers = hdrs ?? null;
    return fake;
  }) as ServerResponse["writeHead"];
  return {
    res: fake,
    chunks,
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    close: () => stream.end(),
  } as CapturedRes;
}

function body(captured: CapturedRes): string {
  return captured.chunks.join("");
}

/* ------------------------------------------------------------------ */
/*  GraphEventBus                                                     */
/* ------------------------------------------------------------------ */

describe("GraphEventBus", () => {
  beforeEach(() => {
    graphEventBus._resetForTest();
  });

  it("assigns monotonic seq numbers", () => {
    const a = graphEventBus.emit("cache.invalidated");
    const b = graphEventBus.emit("snapshot.changed", { etag: "etag-1" });
    const c = graphEventBus.emit("snapshot.changed", { etag: "etag-2" });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(graphEventBus.currentSeq()).toBe(3);
  });

  it("fans out to subscribers and respects unsubscribe", () => {
    const seen: string[] = [];
    const unsub = graphEventBus.subscribe((e) => seen.push(e.kind));
    graphEventBus.emit("cache.invalidated");
    graphEventBus.emit("snapshot.changed");
    unsub();
    graphEventBus.emit("cache.invalidated");
    expect(seen).toEqual(["cache.invalidated", "snapshot.changed"]);
    expect(graphEventBus.subscriberCount()).toBe(0);
  });

  it("replay returns only events with seq > sinceSeq", () => {
    graphEventBus.emit("cache.invalidated");        // seq 1
    graphEventBus.emit("snapshot.changed");         // seq 2
    graphEventBus.emit("dream.cycle.completed");    // seq 3
    expect(graphEventBus.replay(0).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(graphEventBus.replay(1).map((e) => e.seq)).toEqual([2, 3]);
    expect(graphEventBus.replay(3)).toEqual([]);
  });

  it("isolates subscriber exceptions", () => {
    const seen: number[] = [];
    graphEventBus.subscribe(() => {
      throw new Error("boom");
    });
    graphEventBus.subscribe((e) => seen.push(e.seq));
    graphEventBus.emit("cache.invalidated");
    expect(seen).toEqual([1]);
  });
});

/* ------------------------------------------------------------------ */
/*  SSE handler                                                       */
/* ------------------------------------------------------------------ */

describe("handleEventsStream (SSE)", () => {
  let captured: CapturedRes;

  beforeEach(() => {
    graphEventBus._resetForTest();
    captured = makeRes();
  });

  afterEach(() => {
    captured.close();
  });

  it("writes SSE headers and an open comment immediately", () => {
    const req = makeReq();
    handleEventsStream(req as unknown as IncomingMessage, captured.res);
    expect(captured.status).toBe(200);
    expect(captured.headers).toMatchObject({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    expect(body(captured)).toContain(": open");
  });

  it("streams live events after connect", () => {
    const req = makeReq();
    handleEventsStream(req as unknown as IncomingMessage, captured.res);
    graphEventBus.emit("snapshot.changed", {
      etag: "etag-x",
      affected_ids: ["a", "b"],
    });
    const out = body(captured);
    expect(out).toMatch(/id: 1\nevent: snapshot\.changed\ndata: \{[^]*"etag":"etag-x"[^]*\}\n\n/);
  });

  it("replays events emitted before connect using Last-Event-ID", () => {
    graphEventBus.emit("cache.invalidated");        // seq 1
    graphEventBus.emit("snapshot.changed");         // seq 2
    graphEventBus.emit("dream.cycle.completed");    // seq 3

    const req = makeReq({ "last-event-id": "1" });
    handleEventsStream(req as unknown as IncomingMessage, captured.res);

    const out = body(captured);
    // Replay should include seq 2 and 3 but NOT seq 1.
    expect(out).toMatch(/id: 2\nevent: snapshot\.changed/);
    expect(out).toMatch(/id: 3\nevent: dream\.cycle\.completed/);
    expect(out).not.toMatch(/id: 1\n/);
  });

  it("delivers a full snapshot when no Last-Event-ID is sent", () => {
    graphEventBus.emit("cache.invalidated");
    graphEventBus.emit("snapshot.changed");

    const req = makeReq();
    handleEventsStream(req as unknown as IncomingMessage, captured.res);
    const out = body(captured);
    expect(out).toMatch(/id: 1\n/);
    expect(out).toMatch(/id: 2\n/);
  });

  it("unsubscribes on connection close", () => {
    const req = makeReq();
    handleEventsStream(req as unknown as IncomingMessage, captured.res);
    expect(graphEventBus.subscriberCount()).toBe(1);
    // Simulate the client going away.
    (captured.res as unknown as PassThrough).emit("close");
    expect(graphEventBus.subscriberCount()).toBe(0);
  });

  it("event JSON payload round-trips with all fields", () => {
    const req = makeReq();
    handleEventsStream(req as unknown as IncomingMessage, captured.res);
    graphEventBus.emit("tension.created", {
      etag: "etag-z",
      affected_ids: ["n1", "n2"],
      payload: { description: "test" },
    });
    const out = body(captured);
    const match = out.match(/data: (\{[^\n]+\})\n\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      seq: 1,
      kind: "tension.created",
      affected_ids: ["n1", "n2"],
      etag: "etag-z",
      payload: { description: "test" },
    });
    expect(typeof parsed.ts).toBe("string");
  });
});
