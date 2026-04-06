/**
 * DreamGraph Cognitive Engine — State machine and persistence.
 *
 * The engine manages the four cognitive states (AWAKE, REM, NORMALIZING, NIGHTMARE)
 * and enforces strict boundaries between them. It handles state transitions,
 * interruption protocol, dream graph I/O, and state introspection.
 *
 * State machine transitions:
 *   AWAKE → REM → NORMALIZING → AWAKE  (normal dream cycle)
 *   AWAKE → NIGHTMARE → AWAKE           (adversarial scan)
 *
 * Enhanced with:
 * - Dream decay: edges/nodes lose confidence and TTL each cycle
 * - Tension tracking: records what the system struggles with
 * - Dream history: audit trail of every cycle
 * - Strict promotion gate reporting
 *
 * Safety guarantees:
 * - FACT GRAPH is never modified by the cognitive system
 * - REM output is isolated to dream_graph.json
 * - Only normalization can promote edges to validated_edges.json
 * - Interrupted REM cycles quarantine in-progress data
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as appConfig } from "../config/config.js";
import { logger } from "../utils/logger.js";
import { dataPath } from "../utils/paths.js";
import { getActiveCognitiveTuning } from "../instance/index.js";
import type {
  CognitiveStateName,
  CognitiveState,
  DreamGraphFile,
  CandidateEdgesFile,
  ValidatedEdgesFile,
  DreamNode,
  DreamEdge,
  ValidationResult,
  ValidatedEdge,
  DecayConfig,
  TensionSignal,
  TensionFile,
  TensionDomain,
  TensionResolutionType,
  TensionResolutionAuthority,
  ResolvedTension,
  TensionConfig,
  DreamHistoryEntry,
  DreamHistoryFile,
} from "./types.js";
import { DEFAULT_DECAY, DEFAULT_PROMOTION, DEFAULT_TENSION_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution (lazy — resolved at call time for instance mode support)
// ---------------------------------------------------------------------------

const dreamGraphPath     = () => dataPath("dream_graph.json");
const candidateEdgesPath = () => dataPath("candidate_edges.json");
const validatedEdgesPath = () => dataPath("validated_edges.json");
const tensionPath        = () => dataPath("tension_log.json");
const historyPath        = () => dataPath("dream_history.json");

// ---------------------------------------------------------------------------
// Cognitive Engine (Singleton)
// ---------------------------------------------------------------------------

/**
 * Reinforcement memory entry — survives edge expiry so re-generated
 * duplicates inherit accumulated evidence instead of starting at zero.
 */
interface ReinforcementMemory {
  /** Canonical edge key (sorted from|to + base relation) */
  key: string;
  /** Accumulated reinforcement count from all prior incarnations */
  reinforcement_count: number;
  /** Best confidence ever recorded for this edge */
  peak_confidence: number;
  /** Cycle when this memory was last updated */
  last_cycle: number;
}

class CognitiveEngine {
  private state: CognitiveStateName = "awake";
  private lastStateChange: string = new Date().toISOString();
  private totalDreamCycles = 0;
  private totalNormalizationCycles = 0;
  private lastDreamCycle: string | null = null;
  private lastNormalization: string | null = null;
  private decayConfig: DecayConfig = { ...DEFAULT_DECAY };
  private tensionConfig: TensionConfig = { ...DEFAULT_TENSION_CONFIG };

  /**
   * Reinforcement memory — edge fingerprints survive expiry.
   * When an edge decays away, its reinforcement count and peak confidence
   * are stored here. When the same edge is re-generated, it inherits this
   * history so evidence actually accumulates across incarnations.
   * Memory entries expire after 30 cycles of inactivity.
   */
  private reinforcementMemory = new Map<string, ReinforcementMemory>();
  private static readonly MEMORY_TTL_CYCLES = 30;

  // -------------------------------------------------------------------------
  // State Machine
  // -------------------------------------------------------------------------

  /** Get current cognitive state name */
  getState(): CognitiveStateName {
    return this.state;
  }

  /** Assert that the engine is in a specific state */
  assertState(expected: CognitiveStateName, operation: string): void {
    if (this.state !== expected) {
      throw new Error(
        `COGNITIVE VIOLATION: "${operation}" requires state "${expected}" but current state is "${this.state}". ` +
          `State boundaries must be respected.`
      );
    }
  }

  /** Transition: AWAKE → REM */
  enterRem(): void {
    this.assertState("awake", "enterRem");
    this.state = "rem";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: AWAKE → REM (dreaming begins)");
  }

  /**
   * Apply cognitive tuning from the active policy profile.
   * Must be called after state transitions to sync decay/promotion config.
   * Safe to call multiple times — idempotent.
   */
  async applyCognitiveTuning(): Promise<void> {
    const tuning = await getActiveCognitiveTuning();
    this.decayConfig = {
      ttl: tuning.decay_ttl,
      decay_rate: tuning.decay_rate,
    };
    logger.debug(
      `Cognitive tuning applied: ttl=${tuning.decay_ttl}, decay_rate=${tuning.decay_rate}, ` +
      `promotion_confidence=${tuning.promotion_confidence}, evidence_count=${tuning.promotion_evidence_count}`
    );
  }

  /** Transition: REM → NORMALIZING */
  enterNormalizing(): void {
    this.assertState("rem", "enterNormalizing");
    this.state = "normalizing";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: REM → NORMALIZING (validation begins)");
  }

  /** Transition: NORMALIZING → AWAKE (natural wake) */
  wake(): void {
    this.assertState("normalizing", "wake");
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: NORMALIZING → AWAKE (natural wake cycle complete)");
  }

  /** Transition: AWAKE → NIGHTMARE (adversarial dreaming) */
  enterNightmare(): void {
    this.assertState("awake", "enterNightmare");
    this.state = "nightmare";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: AWAKE → NIGHTMARE (adversarial scan begins)");
  }

  /** Transition: NIGHTMARE → AWAKE (adversarial scan complete) */
  wakeFromNightmare(): void {
    this.assertState("nightmare", "wakeFromNightmare");
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info("Cognitive state: NIGHTMARE → AWAKE (adversarial scan complete)");
  }

  /**
   * INTERRUPTION HANDLER
   *
   * If external input arrives during REM:
   * 1. Immediately stop REM processing
   * 2. Quarantine in-progress dream data
   * 3. Fast-normalize: mark unfinished items as interrupted
   * 4. Reset to AWAKE
   */
  async interrupt(): Promise<void> {
    if (this.state === "awake") return; // Already awake, nothing to do

    const previousState = this.state;
    logger.warn(`INTERRUPTION: Forcing wake from "${previousState}" state`);

    // Quarantine any in-progress dream data
    if (previousState === "rem" || previousState === "nightmare") {
      await this.quarantineDreams();
    }

    // Force to awake
    this.state = "awake";
    this.lastStateChange = new Date().toISOString();
    logger.info(`Cognitive state: ${previousState} → AWAKE (interrupted)`);
  }

  /** Mark all non-completed dream items as interrupted */
  private async quarantineDreams(): Promise<void> {
    try {
      const dreamGraph = await this.loadDreamGraph();
      let quarantined = 0;

      for (const edge of dreamGraph.edges) {
        if (edge.dream_cycle === this.totalDreamCycles && !edge.interrupted) {
          edge.interrupted = true;
          quarantined++;
        }
      }

      for (const node of dreamGraph.nodes) {
        if (node.dream_cycle === this.totalDreamCycles && !node.interrupted) {
          node.interrupted = true;
          quarantined++;
        }
      }

      if (quarantined > 0) {
        await this.saveDreamGraph(dreamGraph);
        logger.warn(`Quarantined ${quarantined} in-progress dream items`);
      }
    } catch {
      logger.error("Failed to quarantine dreams during interruption");
    }
  }

  // -------------------------------------------------------------------------
  // Cycle Tracking
  // -------------------------------------------------------------------------

  /** Increment dream cycle counter and return the new cycle number */
  nextDreamCycle(): number {
    this.totalDreamCycles++;
    this.lastDreamCycle = new Date().toISOString();
    return this.totalDreamCycles;
  }

  /** Increment normalization cycle counter */
  nextNormalizationCycle(): number {
    this.totalNormalizationCycles++;
    this.lastNormalization = new Date().toISOString();
    return this.totalNormalizationCycles;
  }

  /** Get current dream cycle number (without incrementing) */
  getCurrentDreamCycle(): number {
    return this.totalDreamCycles;
  }

  /** Get current normalization cycle number */
  getCurrentNormalizationCycle(): number {
    return this.totalNormalizationCycles;
  }

  /** Get current decay config */
  getDecayConfig(): DecayConfig {
    return { ...this.decayConfig };
  }

  /** Get current tension config */
  getTensionConfig(): TensionConfig {
    return { ...this.tensionConfig };
  }

  // -------------------------------------------------------------------------
  // File I/O — Dream Graph
  // -------------------------------------------------------------------------

  async loadDreamGraph(): Promise<DreamGraphFile> {
    try {
      if (!existsSync(dreamGraphPath())) return this.emptyDreamGraphFile();
      const raw = await readFile(dreamGraphPath(), "utf-8");
      const p = JSON.parse(raw);
      const e = this.emptyDreamGraphFile();
      return {
        metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
        nodes: Array.isArray(p.nodes) ? p.nodes : [],
        edges: Array.isArray(p.edges) ? p.edges : [],
      };
    } catch {
      return this.emptyDreamGraphFile();
    }
  }

  private emptyDreamGraphFile(): DreamGraphFile {
    return {
      metadata: {
        description: "Dream Graph — REM-generated speculative nodes and edges. UNTRUSTED.",
        schema_version: "1.0.0",
        last_dream_cycle: null,
        total_cycles: this.totalDreamCycles,
        created_at: new Date().toISOString(),
      },
      nodes: [],
      edges: [],
    };
  }

  async saveDreamGraph(data: DreamGraphFile): Promise<void> {
    await writeFile(dreamGraphPath(), JSON.stringify(data, null, 2), "utf-8");
    logger.debug("Dream graph saved to disk");
  }

  async appendDreamNodes(nodes: DreamNode[]): Promise<void> {
    this.assertState("rem", "appendDreamNodes");
    const graph = await this.loadDreamGraph();
    graph.nodes.push(...nodes);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);
  }

  async appendDreamEdges(edges: DreamEdge[]): Promise<void> {
    this.assertState("rem", "appendDreamEdges");
    const graph = await this.loadDreamGraph();
    graph.edges.push(...edges);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);
  }

  // -------------------------------------------------------------------------
  // Dream Decay — edges/nodes lose confidence each cycle
  // -------------------------------------------------------------------------

  /**
   * Apply decay to all dream edges and nodes.
   * - Confidence reduced by decay_rate
   * - TTL decremented by 1
   * - Items with TTL <= 0 OR confidence <= 0 are removed (expired)
   * - **Expired edges are saved to reinforcement memory** so their
   *   evidence survives for future re-generation.
   *
   * Returns { decayedEdges, decayedNodes } = count of removed items.
   * Must be called during REM, before new dreams are appended.
   */
  async applyDecay(): Promise<{ decayedEdges: number; decayedNodes: number }> {
    this.assertState("rem", "applyDecay");
    const graph = await this.loadDreamGraph();
    const currentCycle = this.totalDreamCycles;

    let decayedEdges = 0;
    let decayedNodes = 0;

    // Decay edges
    const survivingEdges: DreamEdge[] = [];
    for (const edge of graph.edges) {
      // Skip edges reinforced this cycle (they just got refreshed)
      if (edge.last_reinforced_cycle === currentCycle) {
        survivingEdges.push(edge);
        continue;
      }

      // Apply decay
      const newTtl = (edge.ttl ?? this.decayConfig.ttl) - 1;
      const newConfidence = edge.confidence - (edge.decay_rate ?? this.decayConfig.decay_rate);

      if (newTtl <= 0 || newConfidence <= 0) {
        // SAVE TO REINFORCEMENT MEMORY before expiring
        const key = normalizeEdgeKey(edge);
        const existing = this.reinforcementMemory.get(key);
        const prevCount = existing?.reinforcement_count ?? 0;
        const prevPeak = existing?.peak_confidence ?? 0;
        this.reinforcementMemory.set(key, {
          key,
          reinforcement_count: prevCount + (edge.reinforcement_count ?? 0) + 1,
          peak_confidence: Math.max(prevPeak, edge.confidence + (edge.decay_rate ?? this.decayConfig.decay_rate)),
          last_cycle: currentCycle,
        });

        decayedEdges++;
        logger.debug(`Dream edge expired: ${edge.id} (ttl=${newTtl}, conf=${newConfidence.toFixed(2)}) — saved to reinforcement memory (count=${prevCount + (edge.reinforcement_count ?? 0) + 1})`);
        continue;
      }

      edge.ttl = newTtl;
      edge.confidence = Math.round(newConfidence * 100) / 100;
      survivingEdges.push(edge);
    }

    // Decay nodes
    const survivingNodes: DreamNode[] = [];
    for (const node of graph.nodes) {
      if (node.last_reinforced_cycle === currentCycle) {
        survivingNodes.push(node);
        continue;
      }

      const newTtl = (node.ttl ?? this.decayConfig.ttl) - 1;
      const newConfidence = node.confidence - (node.decay_rate ?? this.decayConfig.decay_rate);

      if (newTtl <= 0 || newConfidence <= 0) {
        decayedNodes++;
        logger.debug(`Dream node expired: ${node.id} (ttl=${newTtl}, conf=${newConfidence.toFixed(2)})`);
        continue;
      }

      node.ttl = newTtl;
      node.confidence = Math.round(newConfidence * 100) / 100;
      survivingNodes.push(node);
    }

    graph.edges = survivingEdges;
    graph.nodes = survivingNodes;
    await this.saveDreamGraph(graph);

    // Evict stale reinforcement memory entries (older than MEMORY_TTL_CYCLES)
    for (const [key, mem] of this.reinforcementMemory) {
      if (currentCycle - mem.last_cycle > CognitiveEngine.MEMORY_TTL_CYCLES) {
        this.reinforcementMemory.delete(key);
      }
    }

    if (decayedEdges > 0 || decayedNodes > 0) {
      logger.info(
        `Decay pass: removed ${decayedEdges} edges, ${decayedNodes} nodes ` +
        `(reinforcement memory: ${this.reinforcementMemory.size} entries)`
      );
    }

    return { decayedEdges, decayedNodes };
  }

  // -------------------------------------------------------------------------
  // Duplicate Suppression — merge similar edges by reinforcing existing
  // -------------------------------------------------------------------------

  /**
   * Check for a similar existing edge and reinforce it instead of appending.
   * Similarity: same from/to (either direction) AND same relation prefix.
   *
   * **Enhanced**: New edges that match a reinforcement memory entry
   * inherit the accumulated reinforcement count and get a confidence
   * boost — evidence finally survives across edge incarnations.
   *
   * Returns the list of truly new edges (not duplicates).
   * Duplicates get their existing counterpart reinforced.
   */
  async deduplicateAndAppendEdges(newEdges: DreamEdge[]): Promise<{ appended: DreamEdge[]; merged: number }> {
    this.assertState("rem", "deduplicateAndAppendEdges");
    const graph = await this.loadDreamGraph();
    const currentCycle = this.totalDreamCycles;

    // Build lookup of existing edges by normalized key
    const existingByKey = new Map<string, DreamEdge>();
    for (const edge of graph.edges) {
      const key = normalizeEdgeKey(edge);
      existingByKey.set(key, edge);
    }

    const trulyNew: DreamEdge[] = [];
    let mergeCount = 0;
    let memoryInherited = 0;

    for (const candidate of newEdges) {
      const key = normalizeEdgeKey(candidate);
      const existing = existingByKey.get(key);

      if (existing) {
        // REINFORCE: increase confidence, reset TTL, bump count
        existing.confidence = Math.min(
          Math.round((existing.confidence + candidate.confidence * 0.3) * 100) / 100,
          1.0
        );
        existing.ttl = this.decayConfig.ttl; // Reset TTL
        existing.reinforcement_count = (existing.reinforcement_count ?? 0) + 1;
        existing.last_reinforced_cycle = currentCycle;
        mergeCount++;
        logger.debug(
          `Duplicate suppressed: "${candidate.id}" merged into "${existing.id}" ` +
            `(reinforcement #${existing.reinforcement_count}, conf=${existing.confidence})`
        );
      } else {
        // CHECK REINFORCEMENT MEMORY — inherit evidence from expired incarnations
        const memory = this.reinforcementMemory.get(key);
        if (memory) {
          candidate.reinforcement_count = memory.reinforcement_count;
          candidate.last_reinforced_cycle = currentCycle;
          // Confidence boost: base + 5% per remembered reinforcement (capped at +0.20)
          const memoryBoost = Math.min(memory.reinforcement_count * 0.05, 0.20);
          candidate.confidence = Math.min(
            Math.round((candidate.confidence + memoryBoost) * 100) / 100,
            1.0
          );
          // Give it extended TTL since it has proven persistent
          candidate.ttl = this.decayConfig.ttl + Math.min(memory.reinforcement_count, 4);
          memoryInherited++;
          logger.debug(
            `Memory inherited: "${candidate.id}" carries ${memory.reinforcement_count} prior reinforcements ` +
              `(conf boosted to ${candidate.confidence}, ttl=${candidate.ttl})`
          );
          // Clear the memory entry — it has been consumed
          this.reinforcementMemory.delete(key);
        }

        trulyNew.push(candidate);
        existingByKey.set(key, candidate); // Prevent duplicates within the same batch
      }
    }

    // Save reinforced existing edges + append truly new ones
    graph.edges = [...graph.edges.filter(e => !existingByKey.has(normalizeEdgeKey(e)) || graph.edges.includes(e))];
    // Actually simpler: we mutated the existing edges in-place, just append new ones
    graph.edges.push(...trulyNew);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);

    if (mergeCount > 0 || memoryInherited > 0) {
      logger.info(
        `Duplicate suppression: ${mergeCount} merged, ${trulyNew.length} truly new` +
        (memoryInherited > 0 ? `, ${memoryInherited} inherited from reinforcement memory` : "")
      );
    }

    return { appended: trulyNew, merged: mergeCount };
  }

  /**
   * Same for nodes — deduplicate by name similarity.
   */
  async deduplicateAndAppendNodes(newNodes: DreamNode[]): Promise<{ appended: DreamNode[]; merged: number }> {
    this.assertState("rem", "deduplicateAndAppendNodes");
    const graph = await this.loadDreamGraph();
    const currentCycle = this.totalDreamCycles;

    const existingByName = new Map<string, DreamNode>();
    for (const node of graph.nodes) {
      existingByName.set(node.name.toLowerCase(), node);
    }

    const trulyNew: DreamNode[] = [];
    let mergeCount = 0;

    for (const candidate of newNodes) {
      const key = candidate.name.toLowerCase();
      const existing = existingByName.get(key);

      if (existing) {
        existing.confidence = Math.min(
          Math.round((existing.confidence + candidate.confidence * 0.3) * 100) / 100,
          1.0
        );
        existing.ttl = this.decayConfig.ttl;
        existing.reinforcement_count = (existing.reinforcement_count ?? 0) + 1;
        existing.last_reinforced_cycle = currentCycle;
        mergeCount++;
      } else {
        trulyNew.push(candidate);
        existingByName.set(key, candidate);
      }
    }

    graph.nodes.push(...trulyNew);
    graph.metadata.last_dream_cycle = new Date().toISOString();
    graph.metadata.total_cycles = this.totalDreamCycles;
    await this.saveDreamGraph(graph);

    return { appended: trulyNew, merged: mergeCount };
  }

  // -------------------------------------------------------------------------
  // File I/O — Candidate Edges (normalization results)
  // -------------------------------------------------------------------------

  async loadCandidateEdges(): Promise<CandidateEdgesFile> {
    try {
      if (!existsSync(candidateEdgesPath())) return this.emptyCandidateEdgesFile();
      const raw = await readFile(candidateEdgesPath(), "utf-8");
      const p = JSON.parse(raw);
      const e = this.emptyCandidateEdgesFile();
      return {
        metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
        results: Array.isArray(p.results) ? p.results : [],
      };
    } catch {
      return this.emptyCandidateEdgesFile();
    }
  }

  private emptyCandidateEdgesFile(): CandidateEdgesFile {
    return {
      metadata: {
        description: "Normalization results — validation judgments on dream artifacts.",
        schema_version: "1.0.0",
        last_normalization: null,
        total_cycles: this.totalNormalizationCycles,
        created_at: new Date().toISOString(),
      },
      results: [],
    };
  }

  async saveCandidateEdges(data: CandidateEdgesFile): Promise<void> {
    await writeFile(
      candidateEdgesPath(),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    logger.debug("Candidate edges saved to disk");
  }

  async appendValidationResults(results: ValidationResult[]): Promise<void> {
    this.assertState("normalizing", "appendValidationResults");
    const candidates = await this.loadCandidateEdges();
    candidates.results.push(...results);
    candidates.metadata.last_normalization = new Date().toISOString();
    candidates.metadata.total_cycles = this.totalNormalizationCycles;
    await this.saveCandidateEdges(candidates);
  }

  // -------------------------------------------------------------------------
  // File I/O — Validated Edges (promoted dreams)
  // -------------------------------------------------------------------------

  async loadValidatedEdges(): Promise<ValidatedEdgesFile> {
    try {
      if (!existsSync(validatedEdgesPath())) return this.emptyValidatedEdgesFile();
      const raw = await readFile(validatedEdgesPath(), "utf-8");
      const p = JSON.parse(raw);
      const e = this.emptyValidatedEdgesFile();
      return {
        metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
        edges: Array.isArray(p.edges) ? p.edges : [],
      };
    } catch {
      return this.emptyValidatedEdgesFile();
    }
  }

  private emptyValidatedEdgesFile(): ValidatedEdgesFile {
    return {
      metadata: {
        description: "Validated edges — dream-originated connections that passed normalization.",
        schema_version: "1.0.0",
        last_validation: null,
        total_validated: 0,
        created_at: new Date().toISOString(),
      },
      edges: [],
    };
  }

  async saveValidatedEdges(data: ValidatedEdgesFile): Promise<void> {
    await writeFile(
      validatedEdgesPath(),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    logger.debug("Validated edges saved to disk");
  }

  async promoteEdges(edges: ValidatedEdge[]): Promise<void> {
    this.assertState("normalizing", "promoteEdges");
    const validated = await this.loadValidatedEdges();
    validated.edges.push(...edges);
    validated.metadata.last_validation = new Date().toISOString();
    validated.metadata.total_validated = validated.edges.length;
    await this.saveValidatedEdges(validated);
    logger.info(`Promoted ${edges.length} dream edges to validated status`);
  }

  // -------------------------------------------------------------------------
  // File I/O — Tension Log
  // -------------------------------------------------------------------------

  async loadTensions(): Promise<TensionFile> {
    try {
      if (!existsSync(tensionPath())) {
        return this.emptyTensionFile();
      }
      const raw = await readFile(tensionPath(), "utf-8");
      const p = JSON.parse(raw);
      const e = this.emptyTensionFile();
      return {
        metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
        signals: Array.isArray(p.signals) ? p.signals : [],
        resolved_tensions: Array.isArray(p.resolved_tensions) ? p.resolved_tensions : [],
      };
    } catch {
      return this.emptyTensionFile();
    }
  }

  async saveTensions(data: TensionFile): Promise<void> {
    data.metadata.total_signals = data.signals.length;
    data.metadata.total_resolved = data.resolved_tensions?.length ?? 0;
    data.metadata.last_updated = new Date().toISOString();
    await writeFile(tensionPath(), JSON.stringify(data, null, 2), "utf-8");
    logger.debug("Tension log saved to disk");
  }

  /**
   * Record a tension signal. If a similar tension already exists,
   * increment its occurrence count and urgency.
   * New: assigns domain group and TTL for decay.
   */
  async recordTension(signal: Omit<TensionSignal, "id" | "occurrences" | "first_seen" | "last_seen" | "attempted" | "resolved" | "ttl" | "domain"> & { domain?: TensionDomain }): Promise<TensionSignal> {
    const tensions = await this.loadTensions();
    const now = new Date().toISOString();

    // Check for existing similar tension (same type + overlapping entities)
    const existing = tensions.signals.find(
      (s) =>
        s.type === signal.type &&
        !s.resolved &&
        signal.entities.some((e) => s.entities.includes(e))
    );

    if (existing) {
      existing.occurrences++;
      existing.last_seen = now;
      existing.urgency = Math.min(
        Math.round((existing.urgency + 0.1) * 100) / 100,
        1.0
      );
      // Reset TTL on re-observation (tension is still alive)
      existing.ttl = this.tensionConfig.default_tension_ttl;
      // Merge entity lists
      for (const e of signal.entities) {
        if (!existing.entities.includes(e)) {
          existing.entities.push(e);
        }
      }
      await this.saveTensions(tensions);
      return existing;
    }

    // Infer domain from entity IDs if not provided
    const domain = signal.domain ?? this.inferTensionDomain(signal.entities, signal.description);

    const newSignal: TensionSignal = {
      id: `tension_${Date.now()}_${tensions.signals.length + 1}`,
      type: signal.type,
      domain,
      entities: signal.entities,
      description: signal.description,
      occurrences: 1,
      urgency: signal.urgency,
      first_seen: now,
      last_seen: now,
      attempted: false,
      resolved: false,
      ttl: this.tensionConfig.default_tension_ttl,
    };

    tensions.signals.push(newSignal);
    await this.saveTensions(tensions);
    return newSignal;
  }

  /**
   * Resolve a tension with full authority and reason tracking.
   * Moves the tension to resolved_tensions archive instead of deleting.
   * Sets urgency to 0 and marks resolved so it stops driving dreams.
   */
  async resolveTension(
    tensionId: string,
    resolvedBy: TensionResolutionAuthority = "system",
    resolutionType: TensionResolutionType = "confirmed_fixed",
    evidence?: string,
    recheckTtl?: number
  ): Promise<ResolvedTension | null> {
    const tensions = await this.loadTensions();
    const idx = tensions.signals.findIndex((s) => s.id === tensionId);
    if (idx === -1) return null;

    const signal = tensions.signals[idx];
    const now = new Date().toISOString();

    // Create archive entry
    const resolved: ResolvedTension = {
      tension_id: tensionId,
      resolved_at: now,
      resolved_by: resolvedBy,
      resolution_type: resolutionType,
      evidence,
      recheck_ttl: recheckTtl,
      original: { ...signal },
    };

    // Mark as resolved (urgency drops to 0)
    signal.resolved = true;
    signal.urgency = 0;

    // Move to resolved archive
    if (!tensions.resolved_tensions) {
      tensions.resolved_tensions = [];
    }
    tensions.resolved_tensions.push(resolved);

    // Remove from active signals
    tensions.signals.splice(idx, 1);

    await this.saveTensions(tensions);
    logger.info(
      `Tension resolved: "${tensionId}" by ${resolvedBy} as ${resolutionType}` +
      (evidence ? ` (evidence: ${evidence})` : "")
    );
    return resolved;
  }

  /**
   * Apply decay to all active tensions.
   * - Urgency reduced by tension_urgency_decay per cycle
   * - TTL decremented by 1
   * - Tensions with TTL <= 0 or urgency below threshold are auto-expired
   * - Auto-expired tensions are moved to resolved_tensions as "false_positive"
   *
   * Returns count of expired tensions.
   */
  async applyTensionDecay(): Promise<{ expired: number; decayed: number }> {
    const tensions = await this.loadTensions();
    const surviving: TensionSignal[] = [];
    let expired = 0;
    let decayed = 0;

    if (!tensions.resolved_tensions) {
      tensions.resolved_tensions = [];
    }

    for (const signal of tensions.signals) {
      if (signal.resolved) continue; // Already resolved, skip

      // Decay
      signal.ttl = (signal.ttl ?? this.tensionConfig.default_tension_ttl) - 1;
      signal.urgency = Math.round(
        Math.max(signal.urgency - this.tensionConfig.tension_urgency_decay, 0) * 100
      ) / 100;

      // Check expiry conditions
      if (
        signal.ttl <= 0 ||
        signal.urgency < this.tensionConfig.min_urgency_threshold
      ) {
        // Auto-expire: move to resolved as false_positive (noise that faded)
        tensions.resolved_tensions.push({
          tension_id: signal.id,
          resolved_at: new Date().toISOString(),
          resolved_by: "system",
          resolution_type: "false_positive",
          evidence: signal.ttl <= 0
            ? "TTL expired without re-observation"
            : "Urgency decayed below threshold (" + signal.urgency + ")",
          original: { ...signal },
        });
        expired++;
        logger.debug(
          `Tension expired: "${signal.id}" (ttl=${signal.ttl}, urgency=${signal.urgency})`
        );
        continue;
      }

      decayed++;
      surviving.push(signal);
    }

    tensions.signals = surviving;
    await this.saveTensions(tensions);

    if (expired > 0) {
      logger.info(
        `Tension decay: ${expired} expired, ${surviving.length} surviving`
      );
    }

    return { expired, decayed };
  }

  /**
   * Check resolved tensions for recheck_ttl expiry.
   * If a resolved tension's recheck window has passed,
   * and there's new contradictory evidence (TODO: hook),
   * it could be reactivated. For now just decrements recheck_ttl.
   */
  async processRecheckWindows(): Promise<number> {
    const tensions = await this.loadTensions();
    if (!tensions.resolved_tensions) return 0;

    let reactivated = 0;
    const stillResolved: ResolvedTension[] = [];

    for (const resolved of tensions.resolved_tensions) {
      if (resolved.recheck_ttl !== undefined && resolved.recheck_ttl > 0) {
        resolved.recheck_ttl--;
        // When recheck_ttl hits 0, the window closes. For now just keep it.
        // Future: hook to check if new evidence contradicts the resolution.
      }
      stillResolved.push(resolved);
    }

    tensions.resolved_tensions = stillResolved;
    if (reactivated > 0) {
      await this.saveTensions(tensions);
    }
    return reactivated;
  }

  /** Get unresolved tensions sorted by urgency, capped at max_active_tensions */
  async getUnresolvedTensions(): Promise<TensionSignal[]> {
    const tensions = await this.loadTensions();
    return tensions.signals
      .filter((s) => !s.resolved)
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, this.tensionConfig.max_active_tensions);
  }

  /** Get resolved tensions archive */
  async getResolvedTensions(): Promise<ResolvedTension[]> {
    const tensions = await this.loadTensions();
    return tensions.resolved_tensions ?? [];
  }

  /** Get tension stats grouped by domain */
  async getTensionsByDomain(): Promise<Record<string, { count: number; avg_urgency: number }>> {
    const tensions = await this.loadTensions();
    const groups: Record<string, { count: number; total_urgency: number }> = {};

    for (const s of tensions.signals) {
      if (s.resolved) continue;
      const d = s.domain ?? "general";
      if (!groups[d]) groups[d] = { count: 0, total_urgency: 0 };
      groups[d].count++;
      groups[d].total_urgency += s.urgency;
    }

    const result: Record<string, { count: number; avg_urgency: number }> = {};
    for (const [domain, stats] of Object.entries(groups)) {
      result[domain] = {
        count: stats.count,
        avg_urgency: Math.round((stats.total_urgency / stats.count) * 100) / 100,
      };
    }
    return result;
  }

  /**
   * Infer the domain of a tension from the entity IDs and description.
   * Simple keyword-based heuristic.
   */
  private inferTensionDomain(entities: string[], description: string): TensionDomain {
    const text = [...entities, description].join(" ").toLowerCase();

    if (text.match(/rls|auth|login|jwt|password|session/)) return "security";
    if (text.match(/invoice|finvoice|billing|maventa|stamp_credit/)) return "invoicing";
    if (text.match(/sync|cloud_sync|bidirectional|realtime/)) return "sync";
    if (text.match(/stripe|resend|netvisor|openai|firebase|fcm|maventa|open_meteo/)) return "integration";
    if (text.match(/payroll|salary|worker_payroll|netvisor.*payroll/)) return "payroll";
    if (text.match(/report|pdf|export_pdf|export_history/)) return "reporting";
    if (text.match(/api_key|api_usage|pdf_as_a_service/)) return "api";
    if (text.match(/mobile|onboarding|dictation|gps|photo/)) return "mobile";
    if (text.match(/table|column|constraint|schema|migration|data_model/)) return "data_model";
    if (text.match(/signup|user_signup|account_deletion/)) return "auth";

    return "general";
  }

  private emptyTensionFile(): TensionFile {
    return {
      metadata: {
        description: "Tension Log -- signals that direct goal-oriented dreaming, with resolution archive.",
        schema_version: "2.0.0",
        total_signals: 0,
        total_resolved: 0,
        last_updated: null,
      },
      signals: [],
      resolved_tensions: [],
    };
  }

  // -------------------------------------------------------------------------
  // File I/O — Dream History
  // -------------------------------------------------------------------------

  async loadDreamHistory(): Promise<DreamHistoryFile> {
    try {
      if (!existsSync(historyPath())) {
        return this.emptyHistoryFile();
      }
      const raw = await readFile(historyPath(), "utf-8");
      const p = JSON.parse(raw);
      const e = this.emptyHistoryFile();
      return {
        metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
        sessions: Array.isArray(p.sessions) ? p.sessions : [],
      };
    } catch {
      return this.emptyHistoryFile();
    }
  }

  async appendHistoryEntry(entry: DreamHistoryEntry): Promise<void> {
    const history = await this.loadDreamHistory();
    history.sessions.push(entry);
    history.metadata.total_sessions = history.sessions.length;
    await writeFile(historyPath(), JSON.stringify(history, null, 2), "utf-8");
    logger.debug(`Dream history entry recorded: session ${entry.session_id}`);
  }

  private emptyHistoryFile(): DreamHistoryFile {
    return {
      metadata: {
        description: "Dream History — audit trail of every cognitive cycle.",
        schema_version: "1.0.0",
        total_sessions: 0,
        created_at: new Date().toISOString(),
      },
      sessions: [],
    };
  }

  // -------------------------------------------------------------------------
  // Clear / Reset
  // -------------------------------------------------------------------------

  async clearDreamGraph(): Promise<void> {
    await this.saveDreamGraph(this.emptyDreamGraphFile());
    logger.info("Dream graph cleared");
  }

  async clearCandidateEdges(): Promise<void> {
    await this.saveCandidateEdges(this.emptyCandidateEdgesFile());
    logger.info("Candidate edges cleared");
  }

  async clearValidatedEdges(): Promise<void> {
    await this.saveValidatedEdges(this.emptyValidatedEdgesFile());
    logger.info("Validated edges cleared");
  }

  async clearTensions(): Promise<void> {
    await this.saveTensions(this.emptyTensionFile());
    logger.info("Tension log cleared");
  }

  async clearHistory(): Promise<void> {
    await writeFile(
      historyPath(),
      JSON.stringify(this.emptyHistoryFile(), null, 2),
      "utf-8"
    );
    logger.info("Dream history cleared");
  }

  // -------------------------------------------------------------------------
  // Introspection (enhanced)
  // -------------------------------------------------------------------------

  async getStatus(): Promise<CognitiveState> {
    let dreamStats: CognitiveState["dream_graph_stats"] = {
      total_nodes: 0,
      total_edges: 0,
      latent_edges: 0,
      latent_nodes: 0,
      expiring_next_cycle: 0,
      avg_confidence: 0,
      avg_reinforcement: 0,
      avg_activation: 0,
    };
    let validatedStats = { validated: 0, latent: 0, rejected: 0 };
    let tensionStats: CognitiveState["tension_stats"] = {
      total: 0,
      unresolved: 0,
      top_urgency: null,
    };

    try {
      const dreamGraph = await this.loadDreamGraph();
      const edges = dreamGraph.edges;
      const nodes = dreamGraph.nodes;
      const allItems = [...edges, ...nodes];

      const expiringEdges = edges.filter((e) => (e.ttl ?? 3) <= 1).length;
      const expiringNodes = nodes.filter((n) => (n.ttl ?? 3) <= 1).length;

      const avgConf =
        allItems.length > 0
          ? allItems.reduce((sum, item) => sum + item.confidence, 0) / allItems.length
          : 0;

      const avgReinf =
        allItems.length > 0
          ? allItems.reduce((sum, item) => sum + (item.reinforcement_count ?? 0), 0) / allItems.length
          : 0;

      const latentEdges = edges.filter((e) => e.status === "latent").length;
      const latentNodes = nodes.filter((n) => n.status === "latent").length;

      const activationItems = allItems.filter((i) => (i.activation_score ?? 0) > 0);
      const avgActivation =
        activationItems.length > 0
          ? activationItems.reduce((sum, i) => sum + (i.activation_score ?? 0), 0) / activationItems.length
          : 0;

      dreamStats = {
        total_nodes: nodes.length,
        total_edges: edges.length,
        latent_edges: latentEdges,
        latent_nodes: latentNodes,
        expiring_next_cycle: expiringEdges + expiringNodes,
        avg_confidence: Math.round(avgConf * 100) / 100,
        avg_reinforcement: Math.round(avgReinf * 100) / 100,
        avg_activation: Math.round(avgActivation * 100) / 100,
      };
    } catch {
      // Files might not exist yet
    }

    try {
      const candidates = await this.loadCandidateEdges();
      for (const r of candidates.results) {
        if (r.status === "validated") validatedStats.validated++;
        else if (r.status === "latent") validatedStats.latent++;
        else validatedStats.rejected++;
      }
    } catch {
      // Files might not exist yet
    }

    try {
      const tensions = await this.loadTensions();
      const unresolved = tensions.signals.filter((s) => !s.resolved);
      tensionStats = {
        total: tensions.signals.length,
        unresolved: unresolved.length,
        top_urgency:
          unresolved.length > 0
            ? unresolved.sort((a, b) => b.urgency - a.urgency)[0]
            : null,
      };
    } catch {
      // OK
    }

    return {
      current_state: this.state,
      last_state_change: this.lastStateChange,
      total_dream_cycles: this.totalDreamCycles,
      total_normalization_cycles: this.totalNormalizationCycles,
      dream_graph_stats: dreamStats,
      validated_stats: validatedStats,
      tension_stats: tensionStats,
      last_dream_cycle: this.lastDreamCycle,
      last_normalization: this.lastNormalization,
      promotion_config: await (async () => {
        try {
          const tuning = await getActiveCognitiveTuning();
          return {
            promotion_confidence: tuning.promotion_confidence,
            promotion_plausibility: tuning.promotion_plausibility,
            promotion_evidence: tuning.promotion_evidence,
            promotion_evidence_count: tuning.promotion_evidence_count,
            retention_plausibility: tuning.retention_plausibility,
            max_contradiction: tuning.max_contradiction,
          };
        } catch {
          return DEFAULT_PROMOTION;
        }
      })(),
      decay_config: this.decayConfig,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize an edge into a canonical key for deduplication.
 *  Key = sorted(from, to) + relation base (strip "strengthened_", "reverse_of_", etc.)
 */
function normalizeEdgeKey(edge: DreamEdge): string {
  const pair = [edge.from, edge.to].sort().join("|");
  // Strip common prefixes that indicate the same underlying relationship
  const baseRelation = edge.relation
    .replace(/^strengthened_/, "")
    .replace(/^reverse_of_/, "")
    .replace(/^potential_/, "")
    .replace(/^cross_domain_bridge_\w+_\w+$/, "cross_domain_bridge");
  return `${pair}:${baseRelation}`;
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const engine = new CognitiveEngine();
