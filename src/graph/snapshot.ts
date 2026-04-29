/**
 * GraphSnapshotService — build a compact, versioned graph snapshot for
 * the Explorer SPA.
 *
 * Wire envelope (see plans/DREAMGRAPH_EXPLORER.md §4.1):
 *   {
 *     version: 1,
 *     etag, generated_at, instance_uuid,
 *     stats: { node_count, edge_count, build_ms, bytes_uncompressed },
 *     nodes: [{id,type,label,degree,health,confidence}],
 *     edges: [{s,t,kind,conf}]
 *   }
 *
 * Phase 0: read-only, no caching, no SSE invalidation. Recomputed on
 * every request. Future phases add ETag-keyed caching and event-driven
 * invalidation.
 */

import { createHash } from "node:crypto";
import { loadGraphRaw, type GraphRawSnapshot } from "./store.js";
import { recordSnapshotMetrics } from "./metrics.js";
import { graphEventBus } from "./events.js";
import { getActiveScope } from "../instance/index.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  CapabilityEntity,
  Datastore,
  GraphLink,
} from "../types/index.js";

export const SNAPSHOT_VERSION = 1;

export type ExplorerNodeType =
  | "feature"
  | "workflow"
  | "data_model"
  | "capability"
  | "datastore"
  | "dream_node"
  | "tension";

export type ExplorerEdgeKind =
  | "fact"        // from seed `links` arrays
  | "validated"   // from validated_edges.json
  | "candidate"   // from candidate_edges.json (post-normalize, not yet promoted)
  | "dream"       // from dream_graph.json edges
  | "tension";    // implicit edges between tension.entities

export interface ExplorerNode {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  /** 0..1 — derived health score (1.0 = healthy, lower = tensions / low confidence). */
  health: number;
  /** 0..1 — confidence where applicable (dream nodes, validated nodes). 1.0 default. */
  confidence: number;
}

export interface ExplorerEdge {
  s: string;
  t: string;
  kind: ExplorerEdgeKind;
  /** 0..1 confidence. */
  conf: number;
}

export interface SnapshotStats {
  node_count: number;
  edge_count: number;
  build_ms: number;
  bytes_uncompressed: number;
}

export interface GraphSnapshot {
  version: typeof SNAPSHOT_VERSION;
  etag: string;
  generated_at: string;
  instance_uuid: string;
  stats: SnapshotStats;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

/* ------------------------------------------------------------------ */
/*  Builder                                                           */
/* ------------------------------------------------------------------ */

interface NodeAccum {
  type: ExplorerNodeType;
  label: string;
  degree: number;
  confidence: number;
  /** Number of tensions touching this node — feeds health. */
  tension_hits: number;
}

function pushSeedNode(
  out: Map<string, NodeAccum>,
  id: string,
  type: ExplorerNodeType,
  label: string,
): void {
  if (out.has(id)) return;
  out.set(id, { type, label, degree: 0, confidence: 1, tension_hits: 0 });
}

function pushEdge(
  edges: ExplorerEdge[],
  nodes: Map<string, NodeAccum>,
  s: string,
  t: string,
  kind: ExplorerEdgeKind,
  conf: number,
): void {
  // Skip edges whose endpoints we never registered as nodes — Phase 0
  // doesn't synthesize ghost nodes; future phases may.
  const sn = nodes.get(s);
  const tn = nodes.get(t);
  if (!sn || !tn) return;
  edges.push({ s, t, kind, conf });
  sn.degree++;
  tn.degree++;
}

function ingestLinks(
  edges: ExplorerEdge[],
  nodes: Map<string, NodeAccum>,
  source: { id: string; links?: GraphLink[] },
): void {
  if (!source.links) return;
  for (const link of source.links) {
    if (!link?.target) continue;
    pushEdge(edges, nodes, source.id, link.target, "fact", 1);
  }
}

function buildSnapshot(raw: GraphRawSnapshot): GraphSnapshot {
  const t0 = performance.now();
  const nodes = new Map<string, NodeAccum>();
  const edges: ExplorerEdge[] = [];

  // ---- Seed entities (fact graph nodes) ----
  for (const f of raw.features as Feature[]) {
    if (f?.id) pushSeedNode(nodes, f.id, "feature", f.name ?? f.id);
  }
  for (const w of raw.workflows as Workflow[]) {
    if (w?.id) pushSeedNode(nodes, w.id, "workflow", w.name ?? w.id);
  }
  for (const d of raw.dataModel as DataModelEntity[]) {
    if (d?.id) pushSeedNode(nodes, d.id, "data_model", d.name ?? d.id);
  }
  for (const c of raw.capabilities as CapabilityEntity[]) {
    if (c?.id) pushSeedNode(nodes, c.id, "capability", c.name ?? c.id);
  }
  for (const ds of (raw.datastores ?? []) as Datastore[]) {
    if (ds?.id) pushSeedNode(nodes, ds.id, "datastore", ds.name ?? ds.id);
  }

  // ---- Dream nodes (speculative; lower default health) ----
  for (const dn of raw.dreamGraph.nodes ?? []) {
    if (!dn?.id) continue;
    if (!nodes.has(dn.id)) {
      nodes.set(dn.id, {
        type: "dream_node",
        label: dn.name ?? dn.id,
        degree: 0,
        confidence: typeof dn.confidence === "number" ? dn.confidence : 0.5,
        tension_hits: 0,
      });
    }
  }

  // ---- Tension nodes (one per signal) and implicit edges ----
  for (const sig of raw.tensions.signals ?? []) {
    if (!sig?.id) continue;
    if (!nodes.has(sig.id)) {
      nodes.set(sig.id, {
        type: "tension",
        label: sig.description?.slice(0, 80) ?? sig.id,
        degree: 0,
        confidence: 1,
        tension_hits: 0,
      });
    }
    for (const ent of sig.entities ?? []) {
      const n = nodes.get(ent);
      if (n) n.tension_hits++;
      pushEdge(edges, nodes, sig.id, ent, "tension", sig.urgency ?? 0.5);
    }
  }

  // ---- Fact edges from seed `links` ----
  for (const f of raw.features as Feature[]) ingestLinks(edges, nodes, f);
  for (const w of raw.workflows as Workflow[]) ingestLinks(edges, nodes, w);
  for (const d of raw.dataModel as DataModelEntity[]) ingestLinks(edges, nodes, d);
  for (const c of raw.capabilities as CapabilityEntity[]) ingestLinks(edges, nodes, c);

  // ---- Implicit `stored_in` hub edges (per plans/DATASTORE_AS_HUB.md) ----
  // Every data_model that doesn't already link to a datastore gets one
  // synthetic edge to the resolved hub. Resolution order:
  //   1. exact id match against `storage`,
  //   2. case-insensitive substring match against id/name/kind,
  //   3. fall back to the first datastore (Decision #1: single primary).
  if ((raw.datastores ?? []).length > 0) {
    const stores = (raw.datastores ?? []) as Datastore[];
    const storeById = new Map(stores.map((d) => [d.id, d]));
    const resolveStore = (storage: string): Datastore | undefined => {
      if (!storage) return stores[0];
      const exact = storeById.get(storage);
      if (exact) return exact;
      const needle = storage.toLowerCase();
      const fuzzy = stores.find((d) => {
        const hay = `${d.id} ${d.name} ${d.kind}`.toLowerCase();
        return hay.includes(needle) || needle.includes(d.kind);
      });
      return fuzzy ?? stores[0];
    };
    for (const dm of raw.dataModel as DataModelEntity[]) {
      if (!dm?.id) continue;
      const alreadyLinked = (dm.links ?? []).some(
        (l) => l.relationship === "stored_in" || storeById.has(l.target),
      );
      if (alreadyLinked) continue;
      const target = resolveStore(dm.storage ?? "");
      if (!target) continue;
      pushEdge(edges, nodes, dm.id, target.id, "fact", 1);
    }
  }

  // ---- Validated edges (promoted dreams) ----
  for (const e of raw.validated.edges ?? []) {
    if (!e?.from || !e?.to) continue;
    pushEdge(edges, nodes, e.from, e.to, "validated", e.confidence ?? 1);
  }

  // ---- Dream edges (still speculative) ----
  for (const e of raw.dreamGraph.edges ?? []) {
    if (!e?.from || !e?.to) continue;
    pushEdge(edges, nodes, e.from, e.to, "dream", e.confidence ?? 0.5);
  }

  // ---- Candidate edges (normalization "latent" results: dream edges that
  //      didn't pass the validation threshold yet but aren't rejected). We
  //      look up the underlying dream edge by id to recover its endpoints.
  const dreamEdgeById = new Map(
    (raw.dreamGraph.edges ?? []).map((e) => [e.id, e] as const),
  );
  for (const r of raw.candidates.results ?? []) {
    if (r?.status !== "latent" || r.dream_type !== "edge") continue;
    const de = dreamEdgeById.get(r.dream_id);
    if (!de?.from || !de?.to) continue;
    pushEdge(edges, nodes, de.from, de.to, "candidate", r.confidence ?? 0.5);
  }

  // ---- Materialize nodes with derived health ----
  const outNodes: ExplorerNode[] = [];
  for (const [id, acc] of nodes) {
    // Health: 1.0 minus a soft tension penalty, floored at 0.1.
    const health = Math.max(0.1, 1 - 0.2 * acc.tension_hits);
    outNodes.push({
      id,
      type: acc.type,
      label: acc.label,
      degree: acc.degree,
      health,
      confidence: acc.confidence,
    });
  }

  const build_ms = Math.round(performance.now() - t0);

  // Serialize once to compute bytes + ETag (cheap; we send this same body)
  const scope = getActiveScope();
  const body = {
    version: SNAPSHOT_VERSION,
    nodes: outNodes,
    edges,
  };
  const serialized = JSON.stringify(body);
  const etag = `sha256:${createHash("sha256")
    .update(serialized)
    .digest("hex")
    .slice(0, 32)}`;

  const snapshot: GraphSnapshot = {
    version: SNAPSHOT_VERSION,
    etag,
    generated_at: new Date().toISOString(),
    instance_uuid: scope?.uuid ?? "legacy",
    stats: {
      node_count: outNodes.length,
      edge_count: edges.length,
      build_ms,
      bytes_uncompressed: Buffer.byteLength(serialized, "utf8"),
    },
    nodes: outNodes,
    edges,
  };

  recordSnapshotMetrics(snapshot.stats);
  return snapshot;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/** Last etag we surfaced — used to detect drift and emit snapshot.changed. */
let lastEmittedEtag: string | null = null;

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  const raw = await loadGraphRaw();
  const snapshot = buildSnapshot(raw);
  if (lastEmittedEtag !== snapshot.etag) {
    const previous = lastEmittedEtag;
    lastEmittedEtag = snapshot.etag;
    // Suppress the very first emit on cold start — it's not a "change",
    // just the initial snapshot. Clients fetch it via the snapshot route.
    if (previous !== null) {
      graphEventBus.emit("snapshot.changed", {
        etag: snapshot.etag,
        payload: {
          previous_etag: previous,
          node_count: snapshot.stats.node_count,
          edge_count: snapshot.stats.edge_count,
        },
      });
    }
  }
  return snapshot;
}

/** Test seam — clear etag drift tracking so unit tests start clean. */
export function _resetSnapshotEmitterForTest(): void {
  lastEmittedEtag = null;
}

/** Exposed for unit tests so they can drive the builder with fixtures. */
export function buildSnapshotForTest(raw: GraphRawSnapshot): GraphSnapshot {
  return buildSnapshot(raw);
}
