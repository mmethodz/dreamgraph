/**
 * Phase 4 / Slices 1+2 — Explorer mutation pipeline tests.
 *
 * Covers the full contract:
 *   - auth (X-DreamGraph-Instance)
 *   - mandatory reason + If-Match
 *   - audit row schema (mutation_id, hashes, dry_run, …)
 *   - audit.appended bus emission
 *   - the three real intents: tension.resolve, candidate.promote,
 *     candidate.reject
 *   - dry-run rehearsal does not mutate state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setDataDirOverride, dataPath } from "../src/utils/paths.js";
import { graphMutationService } from "../src/explorer/mutations.js";
import { graphEventBus, type GraphEvent } from "../src/graph/events.js";
import { getGraphSnapshot, _resetSnapshotEmitterForTest } from "../src/graph/snapshot.js";
import * as lifecycle from "../src/instance/lifecycle.js";

let tempDir: string;
let captured: { status?: number; headers?: Record<string, string>; body?: string };

const FAKE_UUID = "11111111-2222-3333-4444-555555555555";

interface MockReqOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function mockReq(opts: MockReqOptions = {}): IncomingMessage {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req = {
    method: opts.method ?? "POST",
    headers,
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return this;
    },
  } as unknown as IncomingMessage;

  queueMicrotask(() => {
    const dataHandlers = handlers.get("data") ?? [];
    const endHandlers = handlers.get("end") ?? [];
    if (opts.body !== undefined) {
      const buf = Buffer.from(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
      for (const h of dataHandlers) h(buf);
    }
    for (const h of endHandlers) h();
  });

  return req;
}

function mockRes(): ServerResponse {
  captured = {};
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(body?: string) {
      captured.body = body;
      return this;
    },
  } as unknown as ServerResponse;
  return res;
}

async function run(intent: string, opts: MockReqOptions = {}): Promise<void> {
  const req = mockReq(opts);
  const res = mockRes();
  await graphMutationService.execute(req, res, intent);
  // Flush the microtask queue once more so the audit.appended emit lands
  // before the test inspects captured events.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function readAudit(): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await readFile(dataPath("explorer_audit.jsonl"), "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function seedTension(id: string, entities: string[]): Promise<void> {
  const tensions = {
    metadata: { description: "test", schema_version: "1.0.0", created_at: new Date().toISOString() },
    signals: [
      {
        id,
        type: "missing_link",
        entities,
        description: "seed tension",
        urgency: 0.7,
        ttl: 5,
        created_at: new Date().toISOString(),
        resolved: false,
      },
    ],
    resolved_tensions: [],
  };
  await mkdir(dataPath(""), { recursive: true });
  await writeFile(dataPath("tension_log.json"), JSON.stringify(tensions, null, 2));
}

async function seedCandidate(dreamId: string, from: string, to: string): Promise<void> {
  const candidates = {
    metadata: {
      description: "test",
      schema_version: "1.0.0",
      last_normalization: new Date().toISOString(),
      total_cycles: 1,
      created_at: new Date().toISOString(),
    },
    results: [
      {
        dream_id: dreamId,
        dream_type: "edge",
        status: "latent",
        confidence: 0.55,
        plausibility: 0.6,
        evidence_score: 0.5,
        contradiction_score: 0.0,
        evidence: { shared_features: [], shared_workflows: [], domain_overlap: [], keyword_overlap: [], source_repo_match: false },
        evidence_count: 1,
        reason_code: "structural_plausible",
        reason: "test seed",
        validated_at: new Date().toISOString(),
        normalization_cycle: 1,
      },
    ],
  };
  const dreamGraph = {
    metadata: {
      description: "test",
      schema_version: "1.0.0",
      last_dream_cycle: new Date().toISOString(),
      total_cycles: 1,
      last_normalization: null,
      total_normalization_cycles: 0,
      created_at: new Date().toISOString(),
    },
    nodes: [],
    edges: [
      {
        id: dreamId,
        from,
        to,
        type: "feature",
        relation: "potential_link",
        reason: "test seed dream",
        confidence: 0.55,
        origin: "rem",
        created_at: new Date().toISOString(),
        dream_cycle: 1,
        strategy: "intent_bridge",
        ttl: 5,
        decay_rate: 0.05,
        reinforcement_count: 0,
        last_reinforced_cycle: 1,
        status: "active",
        activation_score: 0.5,
        plausibility: 0.6,
        evidence_score: 0.5,
        contradiction_score: 0,
      },
    ],
  };
  await mkdir(dataPath(""), { recursive: true });
  await writeFile(dataPath("candidate_edges.json"), JSON.stringify(candidates, null, 2));
  await writeFile(dataPath("dream_graph.json"), JSON.stringify(dreamGraph, null, 2));
}

async function captureEvents(fn: () => Promise<void>): Promise<GraphEvent[]> {
  const events: GraphEvent[] = [];
  const unsub = graphEventBus.subscribe((ev) => events.push(ev));
  try {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    unsub();
  }
  return events;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dg-mutations-"));
  setDataDirOverride(tempDir);
  graphEventBus._resetForTest();
  _resetSnapshotEmitterForTest();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("Mutation auth", () => {
  it("rejects when X-DreamGraph-Instance is missing in instance mode", async () => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: FAKE_UUID } as never);
    await run("tension.resolve", { body: { tension_id: "t", reason: "r" } });
    expect(captured.status).toBe(401);
  });

  it("rejects when X-DreamGraph-Instance is wrong", async () => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue({ uuid: FAKE_UUID } as never);
    await run("tension.resolve", {
      body: { tension_id: "t", reason: "r" },
      headers: { "X-DreamGraph-Instance": "deadbeef-0000-0000-0000-000000000000" },
    });
    expect(captured.status).toBe(403);
  });

  it("returns 404 for unknown intent", async () => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
    await run("not_a_real_intent");
    expect(captured.status).toBe(404);
  });
});

describe("Mutation preconditions", () => {
  beforeEach(() => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
  });

  it("rejects when reason is missing", async () => {
    const snap = await getGraphSnapshot();
    await run("tension.resolve", {
      body: { tension_id: "t" },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(400);
    expect(JSON.parse(captured.body ?? "{}").error).toBe("missing_reason");
  });

  it("rejects when If-Match is missing", async () => {
    await run("tension.resolve", { body: { tension_id: "t", reason: "r" } });
    expect(captured.status).toBe(400);
    expect(JSON.parse(captured.body ?? "{}").error).toBe("missing_if_match");
  });

  it("rejects with 412 when If-Match is stale", async () => {
    await seedTension("ten_1", ["a", "b"]);
    await run("tension.resolve", {
      body: { tension_id: "ten_1", reason: "r" },
      headers: { "If-Match": "sha256:does-not-match" },
    });
    expect(captured.status).toBe(412);
    const audit = await readAudit();
    expect(audit.at(-1)?.error).toBe("etag_mismatch");
  });
});

describe("Audit row contract", () => {
  beforeEach(() => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
  });

  it("writes the full contract on a successful tension.resolve", async () => {
    await seedTension("ten_42", ["e1", "e2"]);
    const snap = await getGraphSnapshot();

    const events = await captureEvents(async () => {
      await run("tension.resolve", {
        body: { tension_id: "ten_42", reason: "operator confirmed fixed" },
        headers: { "If-Match": snap.etag },
      });
    });

    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.ok).toBe(true);
    expect(body.mutation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.affected_ids).toEqual(expect.arrayContaining(["ten_42", "e1", "e2"]));

    const audit = await readAudit();
    const last = audit.at(-1)!;
    for (const k of [
      "mutation_id",
      "timestamp",
      "actor",
      "intent",
      "affected_ids",
      "reason",
      "before_hash",
      "after_hash",
      "etag",
      "dry_run",
      "ok",
    ]) {
      expect(last).toHaveProperty(k);
    }
    expect(last.intent).toBe("tension.resolve");
    expect(last.dry_run).toBe(false);
    expect(last.ok).toBe(true);
    expect(last.before_hash).toBeTruthy();
    expect(last.before_hash).not.toBe(last.after_hash); // tension was archived
    expect(last.reason).toBe("operator confirmed fixed");

    const auditEvents = events.filter((e) => e.kind === "audit.appended");
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].payload?.intent).toBe("tension.resolve");
    expect(auditEvents[0].payload?.mutation_id).toBe(body.mutation_id);
  });
});

describe("tension.resolve", () => {
  beforeEach(() => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
  });

  it("removes the tension from active signals", async () => {
    await seedTension("ten_x", ["a"]);
    const snap = await getGraphSnapshot();
    await run("tension.resolve", {
      body: { tension_id: "ten_x", reason: "fixed by hand" },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(200);
    const file = JSON.parse(await readFile(dataPath("tension_log.json"), "utf-8"));
    expect(file.signals.find((s: { id: string }) => s.id === "ten_x")).toBeUndefined();
    expect(file.resolved_tensions.find((r: { tension_id: string }) => r.tension_id === "ten_x")).toBeTruthy();
  });

  it("dry-run does NOT mutate state but still writes an audit row", async () => {
    await seedTension("ten_y", ["a"]);
    const snap = await getGraphSnapshot();
    await run("tension.resolve", {
      body: { tension_id: "ten_y", reason: "rehearse", dry_run: true },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(200);
    const file = JSON.parse(await readFile(dataPath("tension_log.json"), "utf-8"));
    // Still active because dry-run skipped the real handler.
    expect(file.signals.find((s: { id: string }) => s.id === "ten_y")).toBeTruthy();
    const audit = await readAudit();
    expect(audit.at(-1)?.dry_run).toBe(true);
    expect(audit.at(-1)?.ok).toBe(true);
  });

  it("returns 404 when the tension does not exist", async () => {
    await seedTension("real_one", ["a"]);
    const snap = await getGraphSnapshot();
    await run("tension.resolve", {
      body: { tension_id: "ghost_id", reason: "test" },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(404);
    const audit = await readAudit();
    expect(audit.at(-1)?.ok).toBe(false);
    expect(audit.at(-1)?.error).toBe("not_found");
  });
});

describe("candidate.promote", () => {
  beforeEach(() => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
  });

  it("appends a validated edge and removes the candidate", async () => {
    await seedCandidate("dream_1", "feat_a", "feat_b");
    const snap = await getGraphSnapshot();
    await run("candidate.promote", {
      body: { dream_id: "dream_1", reason: "endorsed" },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(200);
    const validated = JSON.parse(await readFile(dataPath("validated_edges.json"), "utf-8"));
    expect(validated.edges.length).toBe(1);
    expect(validated.edges[0].from).toBe("feat_a");
    const candidates = JSON.parse(await readFile(dataPath("candidate_edges.json"), "utf-8"));
    expect(candidates.results.length).toBe(0);
  });
});

describe("candidate.reject", () => {
  beforeEach(() => {
    vi.spyOn(lifecycle, "getActiveScope").mockReturnValue(null);
  });

  it("flips status to rejected without adding a validated edge", async () => {
    await seedCandidate("dream_2", "feat_c", "feat_d");
    const snap = await getGraphSnapshot();
    await run("candidate.reject", {
      body: { dream_id: "dream_2", reason: "noise" },
      headers: { "If-Match": snap.etag },
    });
    expect(captured.status).toBe(200);
    const candidates = JSON.parse(await readFile(dataPath("candidate_edges.json"), "utf-8"));
    expect(candidates.results[0].status).toBe("rejected");
    // No validated_edges file should be created with content.
    try {
      const validated = JSON.parse(await readFile(dataPath("validated_edges.json"), "utf-8"));
      expect(validated.edges.length).toBe(0);
    } catch {
      // File doesn't exist — also acceptable.
    }
  });
});
