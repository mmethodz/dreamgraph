/**
 * DreamGraph Cognitive Dreamer — REM dream generation.
 *
 * The dreamer analyzes the Fact Graph and generates speculative nodes
 * and edges by detecting gaps, weak links, cross-domain bridges,
 * missing abstractions, asymmetric relationships, and tension-directed
 * exploration.
 *
 * ALL output goes to dream_graph.json via the cognitive engine.
 * The dreamer NEVER modifies the Fact Graph.
 * The dreamer NEVER produces user-facing output.
 *
 * Enhanced with:
 * - Decay fields on all generated items (ttl, decay_rate, reinforcement_count)
 * - Duplicate suppression via engine.deduplicateAndAppend*()
 * - Tension-directed dreaming (strategy #6)
 *
 * Nine + one dream strategies:
 * 1. Gap Detection — entity pairs with no direct edge but shared context
 * 2. Weak Reinforcement — strengthen edges rated "weak"
 * 3. Cross-Domain Bridging — connect different domains via shared keywords
 * 4. Missing Abstraction — propose hypothetical unifying features
 * 5. Symmetry Completion — propose reverse edges where only one direction exists
 * 6. Tension Directed — explore areas where the system is struggling
 * 7. Causal Replay — mine dream history for cause→effect chains
 * 8. Reflective — agent-directed insights from code reading
 * 9. PGO Wave — stochastic divergence via Lévy flights and stochastic resonance
 * 10. LLM Dream — LLM-powered creative dreaming with structured context
 */

import { loadJsonArray } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import { causalReplayDream } from "./causal.js";
import { getLlmProvider, isLlmAvailable, getDreamerLlmConfig } from "./llm.js";
import type { LlmMessage } from "./llm.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";
import type {
  DreamNode,
  DreamEdge,
  DreamStrategy,
  TensionSignal,
} from "./types.js";
import { DEFAULT_DECAY } from "./types.js";

// ---------------------------------------------------------------------------
// Fact Graph Snapshot — in-memory read-only copy for dream analysis
// ---------------------------------------------------------------------------

interface FactEntity {
  id: string;
  type: "feature" | "workflow" | "data_model";
  name: string;
  description: string;
  domain: string;
  keywords: string[];
  source_repo: string;
  source_files: string[];
  tags: string[];
  category: string;
  links: Array<{
    target: string;
    type: string;
    relationship: string;
    description: string;
    strength: string;
    meta?: {
      direction?: string;
      api_route?: string;
      table?: string;
      see_also?: Array<{ target: string; type: string; hint: string }>;
    };
  }>;
  /** Workflow steps (ordered names) — only for workflow entities */
  steps: string[];
  /** Data model key field names — only for data_model entities */
  key_fields: string[];
  /** Data model relationship targets — only for data_model entities */
  relationships: Array<{ type: string; target: string; via: string }>;
  /** Words extracted from description for semantic matching */
  descriptionTokens: Set<string>;
}

interface FactSnapshot {
  entities: Map<string, FactEntity>;
  /** Set of "from|to" strings for fast edge existence checks */
  edgeSet: Set<string>;
  /** All domain values */
  domains: Set<string>;
  /** Shared source files → entity IDs that reference them */
  sourceFileIndex: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "shall", "should", "may", "might", "can", "could", "this", "that",
  "these", "those", "it", "its", "not", "no", "all", "each", "every",
  "as", "if", "when", "than", "also", "into", "such", "which", "their",
]);

/** Extract meaningful tokens from a text for semantic matching */
function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/** Build a unified snapshot of the entire fact graph */
async function buildFactSnapshot(): Promise<FactSnapshot> {
  const [features, workflows, dataModel] = await Promise.all([
    loadJsonArray<Feature>("features.json"),
    loadJsonArray<Workflow>("workflows.json"),
    loadJsonArray<DataModelEntity>("data_model.json"),
  ]);

  const entities = new Map<string, FactEntity>();
  const edgeSet = new Set<string>();
  const domains = new Set<string>();
  const sourceFileIndex = new Map<string, string[]>();

  /** Register source files for an entity */
  const indexSourceFiles = (entityId: string, files: string[]) => {
    for (const f of files) {
      const list = sourceFileIndex.get(f) ?? [];
      list.push(entityId);
      sourceFileIndex.set(f, list);
    }
  };

  /** Build rich link array from GraphLink[] */
  const mapLinks = (links: Feature["links"]) =>
    (links ?? []).map(l => ({
      target: l.target,
      type: l.type,
      relationship: l.relationship,
      description: l.description ?? "",
      strength: l.strength,
      meta: l.meta ? {
        direction: l.meta.direction,
        api_route: l.meta.api_route,
        table: l.meta.table,
        see_also: l.meta.see_also?.map(sa => ({
          target: sa.target,
          type: sa.type,
          hint: sa.hint,
        })),
      } : undefined,
    }));

  for (const f of features) {
    const desc = f.description ?? "";
    entities.set(f.id, {
      id: f.id,
      type: "feature",
      name: f.name,
      description: desc,
      domain: f.domain ?? "",
      keywords: f.keywords ?? [],
      source_repo: f.source_repo,
      source_files: f.source_files ?? [],
      tags: f.tags ?? [],
      category: f.category ?? "",
      links: mapLinks(f.links),
      steps: [],
      key_fields: [],
      relationships: [],
      descriptionTokens: tokenize(desc),
    });
    if (f.domain) domains.add(f.domain);
    indexSourceFiles(f.id, f.source_files ?? []);
    for (const link of f.links ?? []) {
      edgeSet.add(`${f.id}|${link.target}`);
    }
  }

  for (const w of workflows) {
    const desc = w.description ?? "";
    entities.set(w.id, {
      id: w.id,
      type: "workflow",
      name: w.name,
      description: desc,
      domain: w.domain ?? "",
      keywords: w.keywords ?? [],
      source_repo: w.source_repo,
      source_files: w.source_files ?? [],
      tags: [],
      category: "",
      links: mapLinks(w.links),
      steps: (w.steps ?? []).map(s => typeof s === "string" ? s : s.name),
      key_fields: [],
      relationships: [],
      descriptionTokens: tokenize(desc),
    });
    if (w.domain) domains.add(w.domain);
    indexSourceFiles(w.id, w.source_files ?? []);
    for (const link of w.links ?? []) {
      edgeSet.add(`${w.id}|${link.target}`);
    }
  }

  for (const e of dataModel) {
    const desc = e.description ?? "";
    entities.set(e.id, {
      id: e.id,
      type: "data_model",
      name: e.name,
      description: desc,
      domain: e.domain ?? "",
      keywords: e.keywords ?? [],
      source_repo: e.source_repo,
      source_files: e.source_files ?? [],
      tags: [],
      category: "",
      links: mapLinks(e.links),
      steps: [],
      key_fields: (e.key_fields ?? []).map(kf => typeof kf === "string" ? kf : kf.name),
      relationships: (e.relationships ?? []).map(r => ({
        type: r.type,
        target: r.target,
        via: r.via,
      })),
      descriptionTokens: tokenize(desc),
    });
    if (e.domain) domains.add(e.domain);
    indexSourceFiles(e.id, e.source_files ?? []);
    for (const link of e.links ?? []) {
      edgeSet.add(`${e.id}|${link.target}`);
    }
  }

  return { entities, edgeSet, domains, sourceFileIndex };
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idCounter = 0;

function dreamId(prefix: string): string {
  idCounter++;
  return `dream_${prefix}_${Date.now()}_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Strategy 1: Gap Detection
// ---------------------------------------------------------------------------

/**
 * Find entity pairs that share domain or keywords but have no direct edge.
 * These are "nearby but unconnected" — potential hidden relationships.
 */
function gapDetection(
  snapshot: FactSnapshot,
  cycle: number,
  max: number
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const entityList = Array.from(snapshot.entities.values());
  const now = new Date().toISOString();

  for (let i = 0; i < entityList.length && edges.length < max; i++) {
    for (let j = i + 1; j < entityList.length && edges.length < max; j++) {
      const a = entityList[i];
      const b = entityList[j];

      // Skip if edge already exists in either direction
      if (
        snapshot.edgeSet.has(`${a.id}|${b.id}`) ||
        snapshot.edgeSet.has(`${b.id}|${a.id}`)
      ) {
        continue;
      }

      // Calculate affinity
      const sameDomain = a.domain && b.domain && a.domain === b.domain;
      const sharedKeywords = a.keywords.filter((k) => b.keywords.includes(k));
      const sameRepo = a.source_repo === b.source_repo;

      // Must have at least domain match + keyword overlap to be interesting
      if (!sameDomain && sharedKeywords.length < 2) continue;
      if (!sameDomain && !sameRepo) continue;

      const confidence =
        (sameDomain ? 0.3 : 0) +
        Math.min(sharedKeywords.length * 0.1, 0.4) +
        (sameRepo ? 0.15 : 0);

      edges.push({
        id: dreamId("gap"),
        from: a.id,
        to: b.id,
        type: a.type === b.type ? a.type : "hypothetical",
        relation: `potential_${a.type}_${b.type}_connection`,
        reason: `Both entities share ${sameDomain ? `domain "${a.domain}"` : ""}${sameDomain && sharedKeywords.length > 0 ? " and " : ""}${sharedKeywords.length > 0 ? `keywords [${sharedKeywords.join(", ")}]` : ""} but have no direct edge`,
        confidence: Math.round(confidence * 100) / 100,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "gap_detection",
        ttl: DEFAULT_DECAY.ttl,
        decay_rate: DEFAULT_DECAY.decay_rate,
        reinforcement_count: 0,
        last_reinforced_cycle: cycle,
        status: "candidate",
        activation_score: 0,
        plausibility: 0,
        evidence_score: 0,
        contradiction_score: 0,
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Strategy 2: Weak Link Reinforcement
// ---------------------------------------------------------------------------

/**
 * Find existing edges with strength "weak" and propose why they
 * might actually be stronger based on broader context.
 */
function weakReinforcement(
  snapshot: FactSnapshot,
  cycle: number,
  max: number
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of snapshot.entities.values()) {
    if (edges.length >= max) break;

    for (const link of entity.links) {
      if (edges.length >= max) break;
      if (link.strength !== "weak") continue;

      const target = snapshot.entities.get(link.target);
      if (!target) continue;

      // Look for indirect support: do they share connections to a third entity?
      const entityTargets = new Set(entity.links.map((l) => l.target));
      const targetTargets = new Set(target.links.map((l) => l.target));
      const sharedConnections = [...entityTargets].filter((t) =>
        targetTargets.has(t)
      );

      if (sharedConnections.length === 0) continue;

      const confidence =
        0.3 + Math.min(sharedConnections.length * 0.15, 0.5);

      edges.push({
        id: dreamId("weak"),
        from: entity.id,
        to: target.id,
        type: entity.type,
        relation: `strengthened_${link.relationship}`,
        reason: `Existing weak edge "${link.relationship}" may be stronger: ${entity.id} and ${target.id} share ${sharedConnections.length} common connections [${sharedConnections.slice(0, 3).join(", ")}${sharedConnections.length > 3 ? "..." : ""}]`,
        confidence: Math.round(confidence * 100) / 100,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "weak_reinforcement",
        meta: {
          original_strength: "weak",
          shared_connections: sharedConnections,
        },
        ttl: DEFAULT_DECAY.ttl,
        decay_rate: DEFAULT_DECAY.decay_rate,
        reinforcement_count: 0,
        last_reinforced_cycle: cycle,
        status: "candidate",
        activation_score: 0,
        plausibility: 0,
        evidence_score: 0,
        contradiction_score: 0,
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Strategy 3: Cross-Domain Bridging
// ---------------------------------------------------------------------------

/**
 * Connect entities from different domains that share keywords.
 * These are potential integration points or feature synergies.
 */
function crossDomainBridging(
  snapshot: FactSnapshot,
  cycle: number,
  max: number
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  // Group entities by domain
  const byDomain = new Map<string, FactEntity[]>();
  for (const entity of snapshot.entities.values()) {
    if (!entity.domain) continue;
    const list = byDomain.get(entity.domain) ?? [];
    list.push(entity);
    byDomain.set(entity.domain, list);
  }

  const domainPairs = Array.from(byDomain.keys());

  for (let i = 0; i < domainPairs.length && edges.length < max; i++) {
    for (
      let j = i + 1;
      j < domainPairs.length && edges.length < max;
      j++
    ) {
      const domainA = domainPairs[i];
      const domainB = domainPairs[j];
      const entitiesA = byDomain.get(domainA) ?? [];
      const entitiesB = byDomain.get(domainB) ?? [];

      for (const a of entitiesA) {
        if (edges.length >= max) break;
        for (const b of entitiesB) {
          if (edges.length >= max) break;

          // Skip existing edges
          if (
            snapshot.edgeSet.has(`${a.id}|${b.id}`) ||
            snapshot.edgeSet.has(`${b.id}|${a.id}`)
          ) {
            continue;
          }

          const sharedKeywords = a.keywords.filter((k) =>
            b.keywords.includes(k)
          );
          if (sharedKeywords.length < 2) continue;

          const confidence =
            0.2 + Math.min(sharedKeywords.length * 0.12, 0.5);

          edges.push({
            id: dreamId("bridge"),
            from: a.id,
            to: b.id,
            type: "hypothetical",
            relation: `cross_domain_bridge_${domainA}_${domainB}`,
            reason: `Cross-domain connection: "${a.name}" (${domainA}) and "${b.name}" (${domainB}) share keywords [${sharedKeywords.join(", ")}]`,
            confidence: Math.round(confidence * 100) / 100,
            origin: "rem",
            created_at: now,
            dream_cycle: cycle,
            strategy: "cross_domain",
            meta: {
              domain_a: domainA,
              domain_b: domainB,
              shared_keywords: sharedKeywords,
            },
            ttl: DEFAULT_DECAY.ttl,
            decay_rate: DEFAULT_DECAY.decay_rate,
            reinforcement_count: 0,
            last_reinforced_cycle: cycle,
            status: "candidate",
            activation_score: 0,
            plausibility: 0,
            evidence_score: 0,
            contradiction_score: 0,
          });
        }
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Strategy 4: Missing Abstraction
// ---------------------------------------------------------------------------

/**
 * Identify clusters of tightly connected entities and propose
 * hypothetical features or workflows that would unify them.
 */
function missingAbstraction(
  snapshot: FactSnapshot,
  cycle: number,
  max: number
): { nodes: DreamNode[]; edges: DreamEdge[] } {
  const nodes: DreamNode[] = [];
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  // Find entities with 3+ outgoing edges to the same type
  for (const entity of snapshot.entities.values()) {
    if (nodes.length >= max) break;

    // Group outgoing links by type
    const byType = new Map<string, string[]>();
    for (const link of entity.links) {
      const list = byType.get(link.type) ?? [];
      list.push(link.target);
      byType.set(link.type, list);
    }

    for (const [linkType, targets] of byType) {
      if (nodes.length >= max) break;
      if (targets.length < 3) continue;

      // Check if those targets also connect to each other
      let interconnections = 0;
      for (const t1 of targets) {
        for (const t2 of targets) {
          if (t1 !== t2 && snapshot.edgeSet.has(`${t1}|${t2}`)) {
            interconnections++;
          }
        }
      }

      // If less than 30% are interconnected, there's a missing hub
      const maxPossible = targets.length * (targets.length - 1);
      const density = maxPossible > 0 ? interconnections / maxPossible : 0;

      if (density > 0.3) continue; // Already well-connected, no gap

      const targetNames = targets
        .map((t) => snapshot.entities.get(t)?.name ?? t)
        .slice(0, 4);

      const abstractionNode: DreamNode = {
        id: dreamId("abstraction"),
        type: "hypothetical_feature",
        name: `Unified ${entity.name} ${linkType} Hub`,
        description: `Hypothetical feature that would unify ${targets.length} ${linkType} entities connected to ${entity.name}: ${targetNames.join(", ")}${targets.length > 4 ? "..." : ""}. Currently these have low interconnection density (${Math.round(density * 100)}%).`,
        inspiration: [entity.id, ...targets.slice(0, 5)],
        confidence: 0.25 + (1 - density) * 0.3,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        ttl: DEFAULT_DECAY.ttl,
        decay_rate: DEFAULT_DECAY.decay_rate,
        reinforcement_count: 0,
        last_reinforced_cycle: cycle,
        status: "candidate",
        activation_score: 0,
      };

      nodes.push(abstractionNode);

      // Create edges from the abstraction to each target
      for (const target of targets.slice(0, 5)) {
        edges.push({
          id: dreamId("abs_edge"),
          from: abstractionNode.id,
          to: target,
          type: "hypothetical",
          relation: "would_unify",
          reason: `Hypothetical hub connecting currently sparse ${linkType} cluster around ${entity.name}`,
          confidence: abstractionNode.confidence * 0.8,
          origin: "rem",
          created_at: now,
          dream_cycle: cycle,
          strategy: "missing_abstraction",
          ttl: DEFAULT_DECAY.ttl,
          decay_rate: DEFAULT_DECAY.decay_rate,
          reinforcement_count: 0,
          last_reinforced_cycle: cycle,
          status: "candidate",
          activation_score: 0,
          plausibility: 0,
          evidence_score: 0,
          contradiction_score: 0,
        });
      }
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Strategy 5: Symmetry Completion
// ---------------------------------------------------------------------------

/**
 * Find edges where A→B exists but B→A doesn't.
 * Propose the reverse edge with relationship context.
 */
function symmetryCompletion(
  snapshot: FactSnapshot,
  cycle: number,
  max: number
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of snapshot.entities.values()) {
    if (edges.length >= max) break;

    for (const link of entity.links) {
      if (edges.length >= max) break;

      // Check if reverse edge exists
      if (snapshot.edgeSet.has(`${link.target}|${entity.id}`)) continue;

      const target = snapshot.entities.get(link.target);
      if (!target) continue;

      // Infer reverse relationship
      const reverseRelation = inferReverseRelation(link.relationship);

      edges.push({
        id: dreamId("sym"),
        from: link.target,
        to: entity.id,
        type: target.type,
        relation: reverseRelation,
        reason: `Symmetry: ${entity.id} → ${link.target} exists ("${link.relationship}") but reverse does not. Proposing "${reverseRelation}".`,
        confidence: 0.4,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "symmetry_completion",
        meta: {
          original_edge: `${entity.id} → ${link.target}`,
          original_relation: link.relationship,
        },
        ttl: DEFAULT_DECAY.ttl,
        decay_rate: DEFAULT_DECAY.decay_rate,
        reinforcement_count: 0,
        last_reinforced_cycle: cycle,
        status: "candidate",
        activation_score: 0,
        plausibility: 0,
        evidence_score: 0,
        contradiction_score: 0,
      });
    }
  }

  return edges;
}

/** Infer a reverse relationship name from a forward relationship */
function inferReverseRelation(relation: string): string {
  const reverseMap: Record<string, string> = {
    implements: "implemented_by",
    implemented_by: "implements",
    reads: "read_by",
    read_by: "reads",
    writes: "written_by",
    written_by: "writes",
    depends_on: "depended_on_by",
    depended_on_by: "depends_on",
    triggers: "triggered_by",
    triggered_by: "triggers",
    produces: "produced_by",
    produced_by: "produces",
    consumes: "consumed_by",
    consumed_by: "consumes",
    syncs: "synced_by",
    synced_by: "syncs",
    extends: "extended_by",
    extended_by: "extends",
    stores: "stored_in",
    stored_in: "stores",
    validates: "validated_by",
    validated_by: "validates",
    exports: "exported_by",
    exported_by: "exports",
    manages: "managed_by",
    managed_by: "manages",
  };

  return reverseMap[relation] ?? `reverse_of_${relation}`;
}

// ---------------------------------------------------------------------------
// Strategy 6: Tension-Directed Dreaming
// ---------------------------------------------------------------------------

/**
 * Use unresolved tension signals to focus dreaming on areas
 * the system is struggling with. This is goal-directed dreaming.
 */
function tensionDirected(
  snapshot: FactSnapshot,
  tensions: TensionSignal[],
  cycle: number,
  max: number
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  // Sort tensions by urgency (highest first)
  const sorted = [...tensions].sort((a, b) => b.urgency - a.urgency);

  for (const tension of sorted) {
    if (edges.length >= max) break;

    // For each tension, try to dream edges involving the troubled entities
    for (let i = 0; i < tension.entities.length && edges.length < max; i++) {
      const entityId = tension.entities[i];
      const entity = snapshot.entities.get(entityId);
      if (!entity) continue;

      // Find entities related by domain/keywords that could resolve the tension
      for (const candidate of snapshot.entities.values()) {
        if (edges.length >= max) break;
        if (candidate.id === entityId) continue;
        if (
          snapshot.edgeSet.has(`${entityId}|${candidate.id}`) ||
          snapshot.edgeSet.has(`${candidate.id}|${entityId}`)
        ) {
          continue;
        }

        // Calculate relevance to this tension
        const sameDomain = entity.domain && candidate.domain && entity.domain === candidate.domain;
        const sharedKw = entity.keywords.filter((k) => candidate.keywords.includes(k));

        if (!sameDomain && sharedKw.length < 1) continue;

        const confidence =
          0.3 +
          (sameDomain ? 0.15 : 0) +
          Math.min(sharedKw.length * 0.1, 0.3) +
          tension.urgency * 0.15;

        edges.push({
          id: dreamId("tension"),
          from: entityId,
          to: candidate.id,
          type: entity.type === candidate.type ? entity.type : "hypothetical",
          relation: `tension_resolution_${tension.type}`,
          reason: `Tension-directed: resolving ${tension.type} for "${entity.name}" — "${candidate.name}" shares ${sameDomain ? `domain "${entity.domain}"` : ""}${sharedKw.length > 0 ? ` keywords [${sharedKw.join(", ")}]` : ""}. Tension urgency: ${tension.urgency}`,
          confidence: Math.round(Math.min(confidence, 1.0) * 100) / 100,
          origin: "rem",
          created_at: now,
          dream_cycle: cycle,
          strategy: "tension_directed",
          meta: {
            tension_id: tension.id,
            tension_type: tension.type,
            tension_urgency: tension.urgency,
          },
          ttl: DEFAULT_DECAY.ttl,
          decay_rate: DEFAULT_DECAY.decay_rate,
          reinforcement_count: 0,
          last_reinforced_cycle: cycle,
          status: "candidate",
          activation_score: 0,
          plausibility: 0,
          evidence_score: 0,
          contradiction_score: 0,
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Strategy 8: LLM Dream — the creative engine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// OpenAI Structured Outputs schema for dream responses.
// When `strict: true`, OpenAI guarantees every response matches this schema
// exactly — no malformed JSON, no missing fields, no matter how creative the
// string values get (temperature 0.9+).
//
// For Ollama this falls back to basic `format: "json"`.
// ---------------------------------------------------------------------------

const DREAM_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from:       { type: "string", description: "Source entity ID" },
          to:         { type: "string", description: "Target entity ID" },
          relation:   { type: "string", description: "Relationship verb" },
          reason:     { type: "string", description: "Why this connection exists (1-2 sentences)" },
          confidence: { type: "number", description: "0.0-1.0 confidence estimate" },
          type:       { type: "string", description: "Edge type (default: hypothetical)" },
        },
        required: ["from", "to", "relation", "reason", "confidence", "type"],
        additionalProperties: false,
      },
    },
    new_nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:          { type: "string", description: "Unique ID (e.g. dream_llm_<name>)" },
          name:        { type: "string", description: "Human-readable name" },
          description: { type: "string", description: "What this concept represents" },
          intent:      { type: "string", description: "Speculative intent — WHY this entity should exist and what role it plays (becomes factual after normalization)" },
          type:        { type: "string", description: "Node type (default: hypothetical_feature)" },
          domain:      { type: "string", description: "Domain tag (e.g. inference, core, ui, networking)" },
          keywords:    { type: "array", items: { type: "string" }, description: "Semantic keywords for grounding" },
          category:    { type: "string", enum: ["feature", "workflow", "data_model"], description: "Target seed category if promoted" },
        },
        required: ["id", "name", "description", "intent", "type", "domain", "keywords", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["edges", "new_nodes"],
  additionalProperties: false,
};

/**
 * The heart of DreamGraph. Uses an LLM to creatively analyze the
 * knowledge graph and propose connections that no structural algorithm
 * would find. This is ACTUAL dreaming — speculative, creative, insightful.
 *
 * The LLM sees:
 * - Entity summaries (names, descriptions, domains, keywords, source_files)
 * - Existing edges (the known graph)
 * - Recent tensions (where the system struggles)
 * - Recent validated edges (what's working)
 *
 * It produces structured JSON edges that the normalizer will evaluate.
 * The normalizer is the reality check — it keeps the LLM honest.
 */
async function llmDream(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): Promise<{ edges: DreamEdge[]; nodes: DreamNode[] }> {
  const edges: DreamEdge[] = [];
  const nodes: DreamNode[] = [];
  const now = new Date().toISOString();

  // Check LLM availability
  const available = await isLlmAvailable();
  if (!available) {
    logger.debug("LLM dream: provider not available, skipping");
    return { edges, nodes };
  }

  const llm = getLlmProvider();

  // Build context for the LLM — summarize the knowledge graph
  const entitySummaries: string[] = [];
  const edgeSummaries: string[] = [];
  const entityIds = Array.from(snapshot.entities.keys());

  // -----------------------------------------------------------------------
  // Tension-weighted entity selection: instead of taking the first 80
  // entities sequentially, score each entity by relevance and select the
  // top 80.  Entities involved in active tensions get a strong boost so
  // the LLM focuses on areas the system actually struggles with.
  // -----------------------------------------------------------------------
  let tensionsForSelection: TensionSignal[] = [];
  try {
    tensionsForSelection = await engine.getUnresolvedTensions();
  } catch { /* ignore */ }

  const tensionEntityIds = new Set<string>();
  const tensionDomains = new Map<string, number>();
  for (const t of tensionsForSelection) {
    for (const eid of t.entities) tensionEntityIds.add(eid);
    const d = t.domain ?? "general";
    tensionDomains.set(d, (tensionDomains.get(d) ?? 0) + t.urgency);
  }

  const allEntities = Array.from(snapshot.entities.values());
  const scored = allEntities.map(e => {
    let score = 0;
    // Direct tension involvement — strongest signal
    if (tensionEntityIds.has(e.id)) score += 5.0;
    // Domain matches active tensions — amplify neighborhood
    if (e.domain && tensionDomains.has(e.domain)) {
      score += (tensionDomains.get(e.domain) ?? 0) * 1.5;
    }
    // Data models and workflows are structurally important (user request)
    if (e.type === "data_model") score += 1.0;
    if (e.type === "workflow") score += 0.8;
    // Entities with many links are high-connectivity hubs
    score += Math.min(e.links.length * 0.15, 1.5);
    // Entities with rich descriptions provide better LLM context
    if (e.description && e.description.length > 50) score += 0.3;
    // Baseline so untouched entities still have a chance (exploration)
    score += Math.random() * 0.5;
    return { entity: e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const entitiesToSummarize = scored.slice(0, 80).map(s => s.entity);

  for (const e of entitiesToSummarize) {
    const parts = [`[${e.id}] ${e.name} (${e.type}, domain: ${e.domain || "none"})`];
    if (e.description) parts.push(`  desc: ${e.description.slice(0, 200)}`);
    if (e.keywords.length > 0) parts.push(`  keywords: ${e.keywords.join(", ")}`);
    if (e.tags.length > 0) parts.push(`  tags: ${e.tags.join(", ")}`);
    if (e.source_files.length > 0) parts.push(`  files: ${e.source_files.slice(0, 5).join(", ")}`);
    if (e.steps.length > 0) parts.push(`  steps: ${e.steps.join(" → ")}`);
    if (e.key_fields.length > 0) parts.push(`  fields: ${e.key_fields.join(", ")}`);
    if (e.relationships.length > 0) {
      parts.push(`  relations: ${e.relationships.map(r => `${r.type}→${r.target} via ${r.via}`).join(", ")}`);
    }
    entitySummaries.push(parts.join("\n"));
  }

  // Summarize existing edges (cap at 60)
  let edgeCount = 0;
  for (const e of snapshot.entities.values()) {
    if (edgeCount >= 60) break;
    for (const link of e.links) {
      if (edgeCount >= 60) break;
      edgeSummaries.push(
        `${e.id} --[${link.relationship}${link.strength ? ` (${link.strength})` : ""}]--> ${link.target}`
      );
      edgeCount++;
    }
  }

  // Get recent tensions for context
  let tensionContext = "";
  try {
    const tensions = await engine.getUnresolvedTensions();
    if (tensions.length > 0) {
      tensionContext = "\n## Active Tensions (areas the system struggles with)\n" +
        tensions.slice(0, 10).map(t =>
          `- [${t.type}] ${t.description} (urgency: ${t.urgency}, entities: ${t.entities.join(", ")})`
        ).join("\n");
    }
  } catch { /* ignore */ }

  // Get recently validated edges for context on what's working
  let validatedContext = "";
  try {
    const validated = await engine.getRecentValidatedEdges(10);
    if (validated.length > 0) {
      validatedContext = "\n## Recently Validated Insights (high-confidence discoveries)\n" +
        validated.map(v =>
          `- ${v.from} --[${v.relation}]--> ${v.to} (confidence: ${v.confidence})`
        ).join("\n");
    }
  } catch { /* ignore */ }

  // Build the dream prompt
  const systemPrompt = `You are the cognitive dream engine of DreamGraph — a knowledge graph system that analyzes software projects. Your role is to DREAM: to make creative, speculative connections between entities that structural analysis alone would miss.

You analyze a knowledge graph of features, workflows, and data models and propose NOVEL relationships, hidden patterns, architectural insights, and potential risks.

Rules:
- Output ONLY valid JSON — an array of edge objects
- Each edge needs: from (entity ID), to (entity ID), relation (verb), reason (1-2 sentences WHY), confidence (0.0-1.0), and optionally type ("hypothetical" for dream nodes)
- Use EXISTING entity IDs from the graph (listed below). Do NOT invent entity IDs.
- Be creative but grounded — propose connections that COULD be real based on the evidence
- Focus on: hidden dependencies, architectural patterns, data flow insights, integration opportunities, potential risks, emergent behaviors
- Confidence guide: 0.3-0.5 = speculative hunch, 0.5-0.7 = reasonable hypothesis, 0.7-0.9 = strong inference
- Aim for ${Math.min(max, 15)} edges (quality over quantity)
- If you see potential for a NEW concept (something not in the graph), include it as a "new_node" object with: id (dream_llm_<name>), name, description, type ("hypothetical_feature" or "hypothetical_workflow" or "hypothetical_entity"), domain (e.g. "inference", "core"), keywords (array of semantic tags), and category ("feature", "workflow", or "data_model"). Nodes with strong evidence will be promoted into the fact graph after normalization.`;

  const userPrompt = `# Knowledge Graph — Dream Cycle #${cycle}

## Entities (${snapshot.entities.size} total)
${entitySummaries.join("\n\n")}

## Known Edges (${snapshot.edgeSet.size} total, showing ${edgeSummaries.length})
${edgeSummaries.join("\n")}

## Domains
${Array.from(snapshot.domains).join(", ")}

## Source File Overlaps (entities sharing implementation files)
${Array.from(snapshot.sourceFileIndex.entries())
  .filter(([, ids]) => ids.length > 1)
  .slice(0, 20)
  .map(([file, ids]) => `${file}: ${ids.join(", ")}`)
  .join("\n") || "(none detected)"}
${tensionContext}
${validatedContext}

Analyze this knowledge graph. Propose ${Math.min(max, 15)} creative edge hypotheses that structural analysis would miss. Output a JSON object with:
{
  "edges": [
    { "from": "entity_id", "to": "entity_id", "relation": "verb", "reason": "why this connection", "confidence": 0.5 }
  ],
  "new_nodes": [
    { "id": "dream_llm_name", "name": "Descriptive Name", "description": "What this concept represents", "intent": "WHY this entity should exist and what role it plays in the system", "type": "hypothetical_feature", "domain": "core", "keywords": ["tag1", "tag2"], "category": "feature" }
  ]
}`;

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    logger.debug(`LLM dream: sending prompt (${entitySummaries.length} entities, ${edgeSummaries.length} edges)`);

    const response = await llm.complete(messages, {
      temperature: getDreamerLlmConfig().temperature,
      maxTokens: getDreamerLlmConfig().maxTokens,
      model: getDreamerLlmConfig().model,
      jsonSchema: {
        name: "dream_response",
        schema: DREAM_RESPONSE_SCHEMA,
      },
    });

    logger.debug(`LLM dream: received ${response.text.length} chars from ${response.model}`);

    // Parse the LLM response
    const parsed = parseLlmDreamResponse(response.text, snapshot, cycle, now, entityIds);
    edges.push(...parsed.edges.slice(0, max));
    nodes.push(...parsed.nodes.slice(0, Math.ceil(max / 3)));

    logger.info(
      `LLM dream: ${edges.length} edges, ${nodes.length} nodes from ${response.model} ` +
      `(${response.tokensUsed ?? "?"} tokens)`
    );
  } catch (err) {
    logger.warn(
      `LLM dream failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return { edges, nodes };
}

/**
 * Parse LLM response JSON into DreamEdge[] and DreamNode[].
 * Tolerant parser — handles partial/malformed output gracefully.
 */
function parseLlmDreamResponse(
  text: string,
  snapshot: FactSnapshot,
  cycle: number,
  now: string,
  knownIds: string[],
): { edges: DreamEdge[]; nodes: DreamNode[] } {
  const edges: DreamEdge[] = [];
  const nodes: DreamNode[] = [];

  let data: {
    edges?: Array<{
      from?: string;
      to?: string;
      relation?: string;
      reason?: string;
      confidence?: number;
      type?: string;
    }>;
    new_nodes?: Array<{
      id?: string;
      name?: string;
      description?: string;
      intent?: string;
      type?: string;
      domain?: string;
      keywords?: string[];
      category?: string;
    }>;
  };

  try {
    // Try extracting JSON from the text (handle markdown code fences)
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

    // Also try to find a JSON object if LLM outputted extra text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];

    data = JSON.parse(jsonStr);
  } catch {
    logger.debug("LLM dream: failed to parse JSON response");
    return { edges, nodes };
  }

  // Create a Set for fast lookup
  const idSet = new Set(knownIds);

  // Process new nodes first (so their IDs are available for edges)
  const newNodeIds = new Set<string>();
  for (const n of data.new_nodes ?? []) {
    if (!n.id || !n.name) continue;

    const nodeId = n.id.startsWith("dream_") ? n.id : `dream_llm_${n.id}`;
    newNodeIds.add(nodeId);

    // Resolve category from type hint if not explicit
    let category: DreamNode["category"];
    if (n.category === "feature" || n.category === "workflow" || n.category === "data_model") {
      category = n.category;
    } else if (n.type?.includes("workflow")) {
      category = "workflow";
    } else if (n.type?.includes("entity") || n.type?.includes("data_model")) {
      category = "data_model";
    } else {
      category = "feature"; // default
    }

    nodes.push({
      id: nodeId,
      type: (n.type as DreamNode["type"]) ?? "hypothetical_feature",
      name: n.name,
      description: n.description ?? "",
      intent: n.intent ?? "",
      inspiration: [],
      confidence: 0.4,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      ttl: DEFAULT_DECAY.ttl,
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      domain: n.domain ?? "",
      keywords: Array.isArray(n.keywords) ? n.keywords : [],
      category,
    });
  }

  // Process edges
  for (const e of data.edges ?? []) {
    if (!e.from || !e.to || !e.relation) continue;

    // Validate that entity IDs exist (in fact graph or in new dream nodes)
    const fromValid = idSet.has(e.from) || newNodeIds.has(e.from);
    const toValid = idSet.has(e.to) || newNodeIds.has(e.to);
    if (!fromValid || !toValid) {
      logger.debug(`LLM dream: skipping edge with unknown ID: ${e.from} → ${e.to}`);
      continue;
    }

    // Skip if edge already exists
    if (snapshot.edgeSet.has(`${e.from}|${e.to}`)) continue;

    const confidence = typeof e.confidence === "number"
      ? Math.max(0, Math.min(e.confidence, 1))
      : 0.5;

    edges.push({
      id: dreamId("llm"),
      from: e.from,
      to: e.to,
      type: (e.type as DreamEdge["type"]) ?? "hypothetical",
      relation: e.relation,
      reason: e.reason ?? `LLM-generated: ${e.from} → ${e.to}`,
      confidence: Math.round(confidence * 100) / 100,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "llm_dream",
      meta: { llm_generated: true },
      ttl: DEFAULT_DECAY.ttl + 2, // LLM dreams get slightly longer TTL
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
  }

  return { edges, nodes };
}

// ---------------------------------------------------------------------------
// Strategy 8: PGO Wave — Stochastic Divergence
// ---------------------------------------------------------------------------

/**
 * Ponto-Geniculo-Occipital wave simulation — random bursts of neural
 * activation that force the dreamer to make creative leaps.
 *
 * Without controlled randomness, the graph crystallizes into a rigid
 * reflection of existing code structure. PGO waves inject the "little
 * random" that real brains use during REM sleep to synthesize meaning
 * from noise.
 *
 * Mathematical basis:
 *
 *   1. **Lévy Flight pairing** — Entity pairs are selected using a
 *      power-law step distribution: lots of small (same-domain) steps
 *      with occasional giant leaps across distant domains. Step
 *      probability ∝ distance^(-α) where α ∈ (1, 3) controls the
 *      heaviness of the tail. Low α → more wild jumps.
 *
 *   2. **Stochastic Resonance confidence** — Edge confidence is set in
 *      the resonance band [0.25, 0.50] — strong enough to occasionally
 *      cross the normalizer's promotion threshold (with a semantic
 *      boost), but not so strong as to pollute the graph with noise.
 *      This matches the double-well model where moderate noise maximizes
 *      signal detection: A = ε⟨x²⟩₀/D · 2r±/(r±² + ω²/4).
 *
 *   3. **Burst amplitude** — PGO waves come in bursts, not steady
 *      streams. The number of edges per cycle follows a geometric
 *      distribution so most cycles produce a few edges, but
 *      occasionally a large burst occurs — mimicking the phasic nature
 *      of real PGO waves.
 */
function pgoWaveDream(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();
  const entityList = Array.from(snapshot.entities.values());

  if (entityList.length < 4) return edges;

  // --- Burst amplitude (geometric distribution) ---
  // Mean ~40% of budget, but occasionally the full burst fires.
  // burstSize = min(max, geometric(p=0.3) clipped to [2, max])
  // Geometric: P(X=k) = (1-p)^(k-1) * p → mean = 1/p ≈ 3.3 iterations
  const burstP = 0.3;
  let burstSize = 1;
  while (Math.random() > burstP && burstSize < max) burstSize++;
  burstSize = Math.max(2, Math.min(burstSize, max));

  logger.debug(`PGO wave: burst amplitude ${burstSize} (budget: ${max})`);

  // --- Domain distance matrix (for Lévy flight) ---
  // Assign each domain a unique index, then compute "distance" as
  // 1 + |domainIndex_a - domainIndex_b| for entities in different domains
  // Entities in the same domain have distance 1 (small step)
  const domainList = Array.from(snapshot.domains);
  const domainIndex = new Map<string, number>();
  // Shuffle domains so the ordering isn't deterministic across cycles
  for (let i = domainList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [domainList[i], domainList[j]] = [domainList[j], domainList[i]];
  }
  domainList.forEach((d, i) => domainIndex.set(d, i));

  /**
   * Lévy flight step: pick a random entity "distance" away from source.
   * Step length ∝ Pareto(α) where α = 1.5 (heavy tail: ~40% of steps
   * land in a different domain).
   *
   * Pareto(α): U ~ Uniform(0,1), X = 1 / U^(1/α)
   * This gives P(X > x) = x^(-α) for x ≥ 1.
   */
  function levyTarget(source: FactEntity): FactEntity | null {
    const alpha = 1.5; // Lévy exponent — lower = more wild jumps
    const u = Math.random();
    // Avoid division by zero; clamp u away from 0
    const step = Math.floor(1.0 / Math.pow(Math.max(u, 0.001), 1.0 / alpha));

    // Sort entities by distance from source, then pick at position ≈ step
    const sourceDomIdx = domainIndex.get(source.domain) ?? 0;
    const candidates = entityList.filter(e => e.id !== source.id);
    if (candidates.length === 0) return null;

    // Compute distance for each candidate
    const withDist = candidates.map(e => {
      const eDomIdx = domainIndex.get(e.domain) ?? 0;
      const domainDist = Math.abs(eDomIdx - sourceDomIdx);
      // Keyword overlap reduces effective distance (semantic proximity)
      const sharedKw = source.keywords.filter(k => e.keywords.includes(k)).length;
      const kwPenalty = Math.max(0, sharedKw * 0.3);
      return { entity: e, distance: Math.max(1, domainDist + 1 - kwPenalty) };
    });

    // Sort by distance, then pick at the Lévy step position
    withDist.sort((a, b) => a.distance - b.distance);
    const idx = Math.min(step, withDist.length - 1);
    return withDist[idx].entity;
  }

  // --- PGO wave relation types (novel, speculative) ---
  const pgoRelations = [
    "emergent_pattern",       // Patterns that emerge from structural noise
    "hidden_dependency",      // Dependencies not visible in direct code flow
    "conceptual_bridge",      // Abstract connection between distant concepts
    "phantom_coupling",       // Coupling that exists in system behavior, not code
    "resonance_link",         // Entities that vibrate at the same "frequency"
    "convergent_evolution",   // Independent subsystems that evolved similar solutions
    "shadow_interaction",     // Interaction visible only under specific conditions
    "latent_composition",     // Composability not yet realized in architecture
  ];

  // --- Generate PGO wave edges ---
  const usedPairs = new Set<string>();

  for (let i = 0; i < burstSize && edges.length < max; i++) {
    // Pick random source entity (uniform — the Lévy flight is in the target selection)
    const source = entityList[Math.floor(Math.random() * entityList.length)];
    const target = levyTarget(source);
    if (!target) continue;

    // Deduplicate within this burst
    const pairKey = `${source.id}|${target.id}`;
    const reversePairKey = `${target.id}|${source.id}`;
    if (usedPairs.has(pairKey) || usedPairs.has(reversePairKey)) continue;
    usedPairs.add(pairKey);

    // Skip if edge already exists in the fact graph
    if (snapshot.edgeSet.has(pairKey) || snapshot.edgeSet.has(reversePairKey)) continue;

    // --- Stochastic resonance confidence band ---
    // Confidence sits in the resonance band [0.25, 0.50] — the "sweet spot"
    // where the normalizer's nonlinear scoring can occasionally amplify
    // a weak signal into a validated edge (especially with semantic boost).
    //
    // Higher domain distance → slightly higher confidence (the further the
    // leap, the more "surprising" → if it survives normalization, it's gold)
    const sourceDomIdx = domainIndex.get(source.domain) ?? 0;
    const targetDomIdx = domainIndex.get(target.domain) ?? 0;
    const domainDist = Math.abs(sourceDomIdx - targetDomIdx);
    const maxDomainDist = Math.max(1, domainList.length - 1);
    const distFactor = domainDist / maxDomainDist; // 0..1

    // Resonance band: base 0.25, + up to 0.25 scaled by distance + small random
    const confidence = Math.min(
      0.50,
      0.25 + distFactor * 0.15 + Math.random() * 0.10,
    );

    // Pick a creative relation type
    const relation = pgoRelations[Math.floor(Math.random() * pgoRelations.length)];

    // Build a reason that captures the stochastic nature
    const sharedKw = source.keywords.filter(k => target.keywords.includes(k));
    const reasonParts = [
      `PGO wave: Lévy flight (step=${Math.round(domainDist)}) from "${source.name}" (${source.domain}) to "${target.name}" (${target.domain}).`,
    ];
    if (sharedKw.length > 0) {
      reasonParts.push(`Resonance via shared keywords [${sharedKw.join(", ")}].`);
    }
    if (distFactor > 0.5) {
      reasonParts.push("Cross-domain divergence — creative leap.");
    }

    edges.push({
      id: dreamId("pgo"),
      from: source.id,
      to: target.id,
      type: "hypothetical",
      relation,
      reason: reasonParts.join(" "),
      confidence: Math.round(confidence * 100) / 100,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "pgo_wave",
      meta: {
        pgo_burst_size: burstSize,
        levy_domain_distance: domainDist,
        stochastic_resonance_band: [0.25, 0.50],
        relation_type: relation,
      },
      ttl: DEFAULT_DECAY.ttl, // Standard TTL — normalizer decides fate
      decay_rate: DEFAULT_DECAY.decay_rate * 1.2, // Slightly faster decay — noise fades
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
  }

  if (edges.length > 0) {
    const crossDomain = edges.filter(e => {
      const fromDom = snapshot.entities.get(e.from)?.domain;
      const toDom = snapshot.entities.get(e.to)?.domain;
      return fromDom !== toDom;
    }).length;
    logger.info(
      `PGO wave: ${edges.length} stochastic edges (${crossDomain} cross-domain, burst=${burstSize})`
    );
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Public API — Dream Cycle
// ---------------------------------------------------------------------------

export interface DreamResult {
  nodes: DreamNode[];
  edges: DreamEdge[];
  duplicates_merged: number;
  /** Per-strategy yield for this cycle (adaptive selection tracking) */
  strategy_yields: Record<string, number>;
  /** Strategies that were skipped this cycle due to adaptive selection */
  skipped_strategies: string[];
}

// ---------------------------------------------------------------------------
// Adaptive Strategy Selection — skip unproductive strategies
// ---------------------------------------------------------------------------

/** Per-strategy history: how many new edges it produced in recent cycles */
const strategyHistory = new Map<DreamStrategy, number[]>();

/** Number of consecutive 0-yield cycles before a strategy gets skipped */
const SKIP_AFTER_BARREN_CYCLES = 3;

/**
 * Record strategy yield and return whether the strategy should run.
 * Has a cooldown: after SKIP_AFTER_BARREN_CYCLES consecutive zeros,
 * the strategy is benched. Every 6th cycle it gets a "probe" run
 * to check if conditions have changed.
 */
function shouldRunStrategy(strategy: DreamStrategy, currentCycle: number): boolean {
  const history = strategyHistory.get(strategy) ?? [];

  // Always run if not enough history
  if (history.length < SKIP_AFTER_BARREN_CYCLES) return true;

  // Check last N entries
  const recentRuns = history.slice(-SKIP_AFTER_BARREN_CYCLES);
  const allBarren = recentRuns.every((y) => y === 0);

  if (!allBarren) return true;

  // Benched! But allow a probe every 6 cycles to re-check
  const probeInterval = 6;
  if (currentCycle % probeInterval === 0) {
    logger.debug(`Adaptive probe: re-enabling "${strategy}" for probe cycle ${currentCycle}`);
    return true;
  }

  logger.debug(`Adaptive skip: "${strategy}" benched (${SKIP_AFTER_BARREN_CYCLES} consecutive 0-yield cycles)`);
  return false;
}

function recordStrategyYield(strategy: DreamStrategy, newEdges: number): void {
  const history = strategyHistory.get(strategy) ?? [];
  history.push(newEdges);
  // Keep last 12 entries
  if (history.length > 12) history.splice(0, history.length - 12);
  strategyHistory.set(strategy, history);
}

/**
 * Execute a dream cycle using the specified strategy.
 *
 * PRECONDITION: Engine must be in REM state.
 * The caller (cognitive register) handles state transitions.
 *
 * Enhanced with:
 * - Deduplication (duplicate suppression) instead of raw append
 * - Adaptive strategy selection: skip strategies that have produced
 *   0 new edges for 3+ consecutive cycles, redistributing their
 *   budget to productive strategies.
 */
export async function dream(
  strategy: DreamStrategy = "all",
  maxDreams: number = 100
): Promise<DreamResult> {
  engine.assertState("rem", "dream");

  const cycle = engine.nextDreamCycle();
  logger.info(
    `REM dream cycle #${cycle} starting (strategy: ${strategy}, max: ${maxDreams})`
  );

  const snapshot = await buildFactSnapshot();
  logger.debug(
    `Fact snapshot: ${snapshot.entities.size} entities, ${snapshot.edgeSet.size} edges, ${snapshot.domains.size} domains`
  );

  let allNodes: DreamNode[] = [];
  let allEdges: DreamEdge[] = [];
  const strategyYields: Record<string, number> = {};
  const skippedStrategies: string[] = [];

  // Determine which strategies to run
  // LLM dream is always included when running "all" — it's the creative core
  // PGO wave is also always included — stochastic divergence must never be benched
  const allStrategies: DreamStrategy[] = [
    "llm_dream",
    "pgo_wave",
    "gap_detection",
    "weak_reinforcement",
    "cross_domain",
    "missing_abstraction",
    "symmetry_completion",
    "tension_directed",
    "causal_replay",
  ];

  const strategiesToRun: DreamStrategy[] =
    strategy === "all"
      ? allStrategies.filter((s) => {
          // LLM dream and PGO wave are never skipped by adaptive selection
          if (s === "llm_dream" || s === "pgo_wave") return true;
          if (shouldRunStrategy(s, cycle)) return true;
          skippedStrategies.push(s);
          return false;
        })
      : [strategy];

  // Budget allocation: LLM gets 35%, PGO wave gets 15%, rest is split evenly
  const hasLlm = strategiesToRun.includes("llm_dream");
  const hasPgo = strategiesToRun.includes("pgo_wave");
  const structuralCount = strategiesToRun.length - (hasLlm ? 1 : 0) - (hasPgo ? 1 : 0);
  const llmBudget = hasLlm ? Math.ceil(maxDreams * 0.35) : 0;
  const pgoBudget = hasPgo ? Math.ceil(maxDreams * 0.15) : 0;
  const structuralBudget = maxDreams - llmBudget - pgoBudget;
  const perStrategy = structuralCount > 0 ? Math.ceil(structuralBudget / structuralCount) : maxDreams;

  if (skippedStrategies.length > 0) {
    logger.info(
      `Adaptive selection: running ${strategiesToRun.length} strategies, skipped [${skippedStrategies.join(", ")}] — LLM: ${llmBudget}, PGO: ${pgoBudget}, structural: ${perStrategy}/each`
    );
  }

  // --------------- LLM Dream — the creative core -------------------
  // Run FIRST so it can inform/be informed by structural strategies
  if (strategiesToRun.includes("llm_dream")) {
    try {
      const llmResult = await llmDream(snapshot, cycle, llmBudget || perStrategy);
      allNodes.push(...llmResult.nodes);
      allEdges.push(...llmResult.edges);
      strategyYields["llm_dream"] = llmResult.edges.length + llmResult.nodes.length;
      logger.debug(`LLM dream: ${llmResult.edges.length} edges, ${llmResult.nodes.length} nodes`);
    } catch (err) {
      strategyYields["llm_dream"] = 0;
      logger.warn(`LLM dream: failed (${err instanceof Error ? err.message : "error"})`);
    }
  }

  // --------------- Structural strategies ---------------------------
  if (strategiesToRun.includes("gap_detection")) {
    const gaps = gapDetection(snapshot, cycle, perStrategy);
    allEdges.push(...gaps);
    strategyYields["gap_detection"] = gaps.length;
    logger.debug(`Gap detection: ${gaps.length} dream edges`);
  }

  if (strategiesToRun.includes("weak_reinforcement")) {
    const weak = weakReinforcement(snapshot, cycle, perStrategy);
    allEdges.push(...weak);
    strategyYields["weak_reinforcement"] = weak.length;
    logger.debug(`Weak reinforcement: ${weak.length} dream edges`);
  }

  if (strategiesToRun.includes("cross_domain")) {
    const bridges = crossDomainBridging(snapshot, cycle, perStrategy);
    allEdges.push(...bridges);
    strategyYields["cross_domain"] = bridges.length;
    logger.debug(`Cross-domain bridging: ${bridges.length} dream edges`);
  }

  if (strategiesToRun.includes("missing_abstraction")) {
    const abstractions = missingAbstraction(snapshot, cycle, perStrategy);
    allNodes.push(...abstractions.nodes);
    allEdges.push(...abstractions.edges);
    strategyYields["missing_abstraction"] = abstractions.nodes.length + abstractions.edges.length;
    logger.debug(
      `Missing abstraction: ${abstractions.nodes.length} nodes, ${abstractions.edges.length} edges`
    );
  }

  if (strategiesToRun.includes("symmetry_completion")) {
    const symmetry = symmetryCompletion(snapshot, cycle, perStrategy);
    allEdges.push(...symmetry);
    strategyYields["symmetry_completion"] = symmetry.length;
    logger.debug(`Symmetry completion: ${symmetry.length} dream edges`);
  }

  // Tension-directed dreaming — uses unresolved tensions from the engine
  if (strategiesToRun.includes("tension_directed")) {
    const tensions = await engine.getUnresolvedTensions();
    if (tensions.length > 0) {
      const tensionEdges = tensionDirected(snapshot, tensions, cycle, perStrategy);
      allEdges.push(...tensionEdges);
      strategyYields["tension_directed"] = tensionEdges.length;
      logger.debug(`Tension-directed: ${tensionEdges.length} dream edges from ${tensions.length} tensions`);

      // Mark tensions as attempted
      for (const t of tensions) {
        t.attempted = true;
      }
    } else {
      strategyYields["tension_directed"] = 0;
      logger.debug("Tension-directed: no unresolved tensions");
    }
  }

  // Causal replay dreaming — mines history for cause-effect patterns
  if (strategiesToRun.includes("causal_replay")) {
    try {
      const causalEdges = await causalReplayDream(cycle, perStrategy);
      allEdges.push(...causalEdges);
      strategyYields["causal_replay"] = causalEdges.length;
      logger.debug(`Causal replay: ${causalEdges.length} dream edges`);
    } catch (err) {
      strategyYields["causal_replay"] = 0;
      logger.debug(`Causal replay: skipped (${err instanceof Error ? err.message : "error"})`);
    }
  }

  // PGO wave — stochastic divergence (Lévy flight + stochastic resonance)
  if (strategiesToRun.includes("pgo_wave")) {
    const pgoEdges = pgoWaveDream(snapshot, cycle, pgoBudget || perStrategy);
    allEdges.push(...pgoEdges);
    strategyYields["pgo_wave"] = pgoEdges.length;
  }

  // Record yields for adaptive selection (only when running "all")
  if (strategy === "all") {
    for (const s of allStrategies) {
      recordStrategyYield(s, strategyYields[s] ?? 0);
    }
  }

  // Cap total output
  allNodes = allNodes.slice(0, maxDreams);
  allEdges = allEdges.slice(0, maxDreams);

  // Persist to dream graph with DEDUPLICATION
  let totalMerged = 0;

  if (allNodes.length > 0) {
    const nodeResult = await engine.deduplicateAndAppendNodes(allNodes);
    allNodes = nodeResult.appended;
    totalMerged += nodeResult.merged;
  }
  if (allEdges.length > 0) {
    const edgeResult = await engine.deduplicateAndAppendEdges(allEdges);
    allEdges = edgeResult.appended;
    totalMerged += edgeResult.merged;
  }

  logger.info(
    `REM dream cycle #${cycle} complete: ${allNodes.length} nodes, ${allEdges.length} edges ` +
      `(${totalMerged} duplicates merged — ideas become beliefs)` +
      (skippedStrategies.length > 0 ? ` [skipped: ${skippedStrategies.join(", ")}]` : "")
  );

  return {
    nodes: allNodes,
    edges: allEdges,
    duplicates_merged: totalMerged,
    strategy_yields: strategyYields,
    skipped_strategies: skippedStrategies,
  };
}
