/**
 * Phase 3 / Slice 2 — Cognitive producer regression tests.
 *
 * Asserts:
 *   1. Each producer (recordTension, resolveTension, appendValidationResults,
 *      promoteEdges, appendHistoryEntry) emits the expected GraphEvent.
 *   2. MCP-facing return values are unchanged whether or not the bus has
 *      subscribers — the bus is purely a notification channel.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirOverride } from "../src/utils/paths.js";
import { graphEventBus, type GraphEvent } from "../src/graph/events.js";
import { engine } from "../src/cognitive/engine.js";
import type { ValidationResult, ValidatedEdge, DreamHistoryEntry } from "../src/cognitive/types.js";

let tempDir: string;

async function captureWhile<T>(fn: () => Promise<T>): Promise<{ result: T; events: GraphEvent[] }> {
  const events: GraphEvent[] = [];
  const unsub = graphEventBus.subscribe((ev) => events.push(ev));
  try {
    const result = await fn();
    return { result, events };
  } finally {
    unsub();
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dg-producers-"));
  setDataDirOverride(tempDir);
  graphEventBus._resetForTest();
  // Ensure engine starts AWAKE for each test.
  // Engine is a singleton — best-effort reset via state inspection.
  // (No public reset; tests below stay tolerant of leftover state.)
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("cognitive producers — bus emissions", () => {
  it("recordTension emits tension.created for new signals only", async () => {
    const { result: signal, events } = await captureWhile(() =>
      engine.recordTension({
        type: "missing_link",
        entities: ["feature_a", "feature_b"],
        description: "test tension",
        urgency: 0.5,
      }),
    );

    expect(signal.id).not.toBe("capped");
    const created = events.filter((e) => e.kind === "tension.created");
    expect(created).toHaveLength(1);
    expect(created[0].affected_ids).toContain(signal.id);
    expect(created[0].affected_ids).toContain("feature_a");
    expect(created[0].payload).toMatchObject({
      tension_id: signal.id,
      type: "missing_link",
      urgency: 0.5,
    });
  });

  it("recordTension does NOT emit when merging into an existing signal", async () => {
    // First call creates the tension.
    const first = await engine.recordTension({
      type: "missing_link",
      entities: ["x", "y"],
      description: "dup",
      urgency: 0.4,
    });
    expect(first.id).not.toBe("capped");

    // Second identical call should merge (occurrences++) and emit nothing.
    const { events } = await captureWhile(() =>
      engine.recordTension({
        type: "missing_link",
        entities: ["x", "y"],
        description: "dup",
        urgency: 0.4,
      }),
    );

    expect(events.filter((e) => e.kind === "tension.created")).toHaveLength(0);
  });

  it("resolveTension emits tension.resolved with entity affected_ids", async () => {
    const signal = await engine.recordTension({
      type: "weak_evidence",
      entities: ["node_p", "node_q"],
      description: "resolve me",
      urgency: 0.3,
    });

    const { result, events } = await captureWhile(() =>
      engine.resolveTension(signal.id, "system", "confirmed_fixed"),
    );

    expect(result).not.toBeNull();
    const resolved = events.filter((e) => e.kind === "tension.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].affected_ids).toContain(signal.id);
    expect(resolved[0].affected_ids).toContain("node_p");
    expect(resolved[0].payload).toMatchObject({
      tension_id: signal.id,
      resolved_by: "system",
    });
  });

  it("resolveTension returns null and emits nothing for unknown id", async () => {
    const { result, events } = await captureWhile(() =>
      engine.resolveTension("does_not_exist", "system", "confirmed_fixed"),
    );
    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("appendValidationResults emits candidate.added per latent result", async () => {
    // Drive the state machine into NORMALIZING for assertState.
    engine.enterRem();
    engine.enterNormalizing();

    const results: ValidationResult[] = [
      { dream_id: "dream_1", dream_type: "edge", status: "latent", confidence: 0.6, reason: "below threshold", validated_at: new Date().toISOString() },
      { dream_id: "dream_2", dream_type: "edge", status: "rejected", confidence: 0.1, reason: "low evidence", validated_at: new Date().toISOString() },
      { dream_id: "dream_3", dream_type: "node", status: "latent", confidence: 0.7, reason: "needs more obs", validated_at: new Date().toISOString() },
    ];

    const { events } = await captureWhile(() => engine.appendValidationResults(results));

    const added = events.filter((e) => e.kind === "candidate.added");
    expect(added).toHaveLength(2);
    expect(added.map((e) => e.affected_ids[0]).sort()).toEqual(["dream_1", "dream_3"]);

    // Wake to leave engine in awake state for next test.
    engine.wake();
  });

  it("promoteEdges emits candidate.promoted per edge with from/to as affected_ids", async () => {
    engine.enterRem();
    engine.enterNormalizing();

    const edges: ValidatedEdge[] = [
      { id: "ve_1", from: "n_a", to: "n_b", relation: "depends_on", confidence: 0.9, evidence_count: 3, promoted_at: new Date().toISOString(), origin_dream_id: "d_1" } as ValidatedEdge,
      { id: "ve_2", from: "n_c", to: "n_d", relation: "uses", confidence: 0.85, evidence_count: 2, promoted_at: new Date().toISOString(), origin_dream_id: "d_2" } as ValidatedEdge,
    ];

    const { events } = await captureWhile(() => engine.promoteEdges(edges));

    const promoted = events.filter((e) => e.kind === "candidate.promoted");
    expect(promoted).toHaveLength(2);
    expect(promoted[0].affected_ids).toEqual(["n_a", "n_b"]);
    expect(promoted[1].affected_ids).toEqual(["n_c", "n_d"]);

    engine.wake();
  });

  it("appendHistoryEntry emits dream.cycle.completed", async () => {
    const entry: DreamHistoryEntry = {
      session_id: "session_test_123",
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      strategy: "diversity",
      cycle_number: 1,
      dreams_generated: 0,
      duration_ms: 10,
    } as DreamHistoryEntry;

    const { events } = await captureWhile(() => engine.appendHistoryEntry(entry));

    const completed = events.filter((e) => e.kind === "dream.cycle.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].payload).toMatchObject({ session_id: "session_test_123" });
  });
});

describe("cognitive producers — MCP behavior unchanged", () => {
  it("recordTension result is identical with vs without subscribers", async () => {
    const args = {
      type: "missing_link" as const,
      entities: ["mcp_a", "mcp_b"],
      description: "mcp test",
      urgency: 0.5,
    };

    // Without subscribers
    const noSub = await engine.recordTension(args);

    // Reset state by resolving the first one so the next call creates a new tension
    await engine.resolveTension(noSub.id, "system", "confirmed_fixed");

    // With subscribers
    const captured: GraphEvent[] = [];
    const unsub = graphEventBus.subscribe((e) => captured.push(e));
    const withSub = await engine.recordTension({
      ...args,
      entities: ["mcp_a2", "mcp_b2"],
    });
    unsub();

    // Same shape, same fields, different ids (timestamps differ)
    expect(Object.keys(noSub).sort()).toEqual(Object.keys(withSub).sort());
    expect(withSub.type).toBe(noSub.type);
    expect(withSub.urgency).toBe(noSub.urgency);
    expect(withSub.resolved).toBe(false);
    // Bus did receive events
    expect(captured.some((e) => e.kind === "tension.created")).toBe(true);
  });
});
