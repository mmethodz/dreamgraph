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
 * Six + one dream strategies:
 * 1. Gap Detection — entity pairs with no direct edge but shared context
 * 2. Weak Reinforcement — strengthen edges rated "weak"
 * 3. Cross-Domain Bridging — connect different domains via shared keywords
 * 4. Missing Abstraction — propose hypothetical unifying features
 * 5. Symmetry Completion — propose reverse edges where only one direction exists
 * 6. Tension Directed — explore areas where the system is struggling
 * 7. Causal Replay — mine dream history for cause→effect chains
 */

import { loadJsonData } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import { causalReplayDream } from "./causal.js";
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
  domain: string;
  keywords: string[];
  source_repo: string;
  links: Array<{
    target: string;
    type: string;
    relationship: string;
    strength: string;
  }>;
}

interface FactSnapshot {
  entities: Map<string, FactEntity>;
  /** Set of "from|to" strings for fast edge existence checks */
  edgeSet: Set<string>;
  /** All domain values */
  domains: Set<string>;
}

/** Build a unified snapshot of the entire fact graph */
async function buildFactSnapshot(): Promise<FactSnapshot> {
  const [features, workflows, dataModel] = await Promise.all([
    loadJsonData<Feature[]>("features.json"),
    loadJsonData<Workflow[]>("workflows.json"),
    loadJsonData<DataModelEntity[]>("data_model.json"),
  ]);

  const entities = new Map<string, FactEntity>();
  const edgeSet = new Set<string>();
  const domains = new Set<string>();

  for (const f of features) {
    entities.set(f.id, {
      id: f.id,
      type: "feature",
      name: f.name,
      domain: f.domain ?? "",
      keywords: f.keywords ?? [],
      source_repo: f.source_repo,
      links: (f.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
    if (f.domain) domains.add(f.domain);
    for (const link of f.links ?? []) {
      edgeSet.add(`${f.id}|${link.target}`);
    }
  }

  for (const w of workflows) {
    entities.set(w.id, {
      id: w.id,
      type: "workflow",
      name: w.name,
      domain: w.domain ?? "",
      keywords: w.keywords ?? [],
      source_repo: w.source_repo,
      links: (w.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
    if (w.domain) domains.add(w.domain);
    for (const link of w.links ?? []) {
      edgeSet.add(`${w.id}|${link.target}`);
    }
  }

  for (const e of dataModel) {
    entities.set(e.id, {
      id: e.id,
      type: "data_model",
      name: e.name,
      domain: e.domain ?? "",
      keywords: e.keywords ?? [],
      source_repo: e.source_repo,
      links: (e.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
    if (e.domain) domains.add(e.domain);
    for (const link of e.links ?? []) {
      edgeSet.add(`${e.id}|${link.target}`);
    }
  }

  return { entities, edgeSet, domains };
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
  maxDreams: number = 20
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
  const allStrategies: DreamStrategy[] = [
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
          if (shouldRunStrategy(s, cycle)) return true;
          skippedStrategies.push(s);
          return false;
        })
      : [strategy];

  // Redistribute budget from skipped strategies to active ones
  const activeCount = strategiesToRun.length;
  const perStrategy = activeCount > 0 ? Math.ceil(maxDreams / activeCount) : maxDreams;

  if (skippedStrategies.length > 0) {
    logger.info(
      `Adaptive selection: running ${activeCount} strategies, skipped [${skippedStrategies.join(", ")}] — budget per strategy: ${perStrategy}`
    );
  }

  // Run selected strategies
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
