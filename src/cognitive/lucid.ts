/**
 * DreamGraph v5.2 — Lucid Dreaming (Interactive Exploration)
 *
 * A new cognitive state where human intuition meets machine pattern-matching.
 * The human proposes a hypothesis, DreamGraph explores it, and they co-create
 * validated understanding.
 *
 * State flow:
 *   AWAKE → LUCID (enterLucid) → AWAKE (wakeFromLucid)
 *
 * Safety:
 *   - LUCID cannot modify the fact graph (same isolation as REM)
 *   - Only dream_graph edges are created during exploration
 *   - Human "accept" creates validated edges with authority "human+system"
 *   - Session auto-wakes after 10 minutes of inactivity
 *   - All sessions are fully logged to data/lucid_log.json
 */

import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadJsonArray } from "../utils/cache.js";
import { dataPath } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";
import type {
  DreamEdge,
  ValidatedEdge,
  ValidatedEdgesFile,
  TensionSignal,
  TensionFile,
  LucidHypothesis,
  LucidSignal,
  LucidFindings,
  LucidAction,
  LucidResult,
  LucidLogFile,
} from "./types.js";

// ---------------------------------------------------------------------------
// Session Timeout (10 minutes default)
// ---------------------------------------------------------------------------

const LUCID_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types for internal state
// ---------------------------------------------------------------------------

interface LucidSession {
  hypothesis: LucidHypothesis;
  findings: LucidFindings;
  actions: LucidAction[];
  acceptedEdges: ValidatedEdge[];
  dismissedContradictions: Array<{ signal: LucidSignal; human_reason: string }>;
  startedAt: number;
  lastActivity: number;
}

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let currentSession: LucidSession | null = null;

// ---------------------------------------------------------------------------
// Hypothesis Parsing
// ---------------------------------------------------------------------------

/**
 * Extract entity IDs referenced in a hypothesis string.
 * Matches both explicit entity IDs (feat_xxx, wf_xxx, dm_xxx) and
 * name mentions from the knowledge graph.
 */
async function parseHypothesis(rawText: string): Promise<{
  entities: string[];
  relationship: string;
}> {
  const [features, workflows, dataModels] = await Promise.all([
    loadJsonArray<Feature>("features.json"),
    loadJsonArray<Workflow>("workflows.json"),
    loadJsonArray<DataModelEntity>("data_model.json"),
  ]);

  const allEntities = [
    ...features.map((f) => ({ id: f.id, name: f.name })),
    ...workflows.map((w) => ({ id: w.id, name: w.name })),
    ...dataModels.map((d) => ({ id: d.id, name: d.name })),
  ];

  const foundEntities: string[] = [];
  const textLower = rawText.toLowerCase();

  // 1) Exact ID match (e.g., "feat_payment_processing")
  const idRegex = /\b(feat_\w+|wf_\w+|dm_\w+)\b/gi;
  const idMatches = rawText.matchAll(idRegex);
  for (const m of idMatches) {
    const id = m[1];
    if (allEntities.some((e) => e.id === id) && !foundEntities.includes(id)) {
      foundEntities.push(id);
    }
  }

  // 2) Name matching (fuzzy case-insensitive)
  for (const entity of allEntities) {
    if (
      textLower.includes(entity.name.toLowerCase()) &&
      !foundEntities.includes(entity.id)
    ) {
      foundEntities.push(entity.id);
    }
  }

  // 3) Infer relationship type from hypothesis text
  const relationshipKeywords: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /depend|relies|requires|needs|uses/i, type: "depends_on" },
    { pattern: /connect|link|bridge|through|via/i, type: "connects_to" },
    { pattern: /cause|trigger|initiate|invoke/i, type: "causes" },
    { pattern: /similar|like|analogous|same/i, type: "similar_to" },
    { pattern: /conflict|contradict|incompatible/i, type: "conflicts_with" },
    { pattern: /replac|obsolete|deprecat|supersed/i, type: "replaces" },
    { pattern: /extend|inherit|implement/i, type: "extends" },
  ];

  let relationship = "related_to";
  for (const { pattern, type } of relationshipKeywords) {
    if (pattern.test(rawText)) {
      relationship = type;
      break;
    }
  }

  return { entities: foundEntities, relationship };
}

// ---------------------------------------------------------------------------
// Scoped Exploration
// ---------------------------------------------------------------------------

/**
 * Run a focused analysis around the hypothesized entities.
 * This searches the dream graph, validated edges, and tension log
 * for supporting and contradicting signals.
 */
async function scopedExploration(
  hypothesis: LucidHypothesis,
  depth: number = 2
): Promise<{
  supporting: LucidSignal[];
  contradictions: LucidSignal[];
  relatedTensions: TensionSignal[];
  suggestedConnections: DreamEdge[];
}> {
  const entityIds = new Set(hypothesis.parsed_entities);
  const supporting: LucidSignal[] = [];
  const contradictions: LucidSignal[] = [];

  // 1) Search validated edges for supporting evidence
  let validatedEdges: ValidatedEdge[] = [];
  try {
    const vPath = dataPath("validated_edges.json");
    if (existsSync(vPath)) {
      const raw = await readFile(vPath, "utf-8");
      const file = JSON.parse(raw) as ValidatedEdgesFile;
      validatedEdges = file.edges ?? [];
    }
  } catch { /* empty */ }

  for (const edge of validatedEdges) {
    const touchesHypothesis =
      entityIds.has(edge.from) || entityIds.has(edge.to);
    if (!touchesHypothesis) continue;

    // Check if this edge supports or contradicts
    const relationType = hypothesis.parsed_relationship.toLowerCase();
    const edgeRelation = edge.relation.toLowerCase();

    if (edgeRelation.includes(relationType) || relationType.includes("related")) {
      supporting.push({
        id: `ls_${randomUUID().slice(0, 8)}`,
        type: "supporting",
        source: "fact_graph",
        description: `Validated edge "${edge.relation}" between ${edge.from} and ${edge.to} supports this hypothesis.`,
        confidence: edge.confidence,
        entities: [edge.from, edge.to],
        evidence: `${edge.evidence_summary} (validated in cycle ${edge.normalization_cycle})`,
      });
    }
  }

  // 2) Search dream graph for speculative connections
  const dreamGraph = await engine.loadDreamGraph();
  const relevantDreamEdges: DreamEdge[] = [];

  for (const edge of dreamGraph.edges) {
    if (edge.interrupted) continue;
    const touchesHypothesis =
      entityIds.has(edge.from) || entityIds.has(edge.to);
    if (!touchesHypothesis) continue;

    relevantDreamEdges.push(edge);

    if (edge.confidence >= 0.5) {
      supporting.push({
        id: `ls_${randomUUID().slice(0, 8)}`,
        type: "supporting",
        source: "dream_graph",
        description: `Dream edge "${edge.relation}" between ${edge.from} and ${edge.to} (confidence: ${edge.confidence}).`,
        confidence: edge.confidence,
        entities: [edge.from, edge.to],
        evidence: edge.reason,
      });
    } else if (edge.contradiction_score > 0.3) {
      contradictions.push({
        id: `ls_${randomUUID().slice(0, 8)}`,
        type: "contradicting",
        source: "dream_graph",
        description: `Dream edge "${edge.relation}" has high contradiction score (${edge.contradiction_score}).`,
        confidence: edge.contradiction_score,
        entities: [edge.from, edge.to],
        evidence: `Contradiction detected during normalization: ${edge.reason}`,
      });
    }
  }

  // 3) Check tension log
  let relatedTensions: TensionSignal[] = [];
  try {
    const tPath = dataPath("tension_log.json");
    if (existsSync(tPath)) {
      const raw = await readFile(tPath, "utf-8");
      const tensionFile = JSON.parse(raw) as TensionFile;
      relatedTensions = (tensionFile.signals ?? []).filter(
        (t) => !t.resolved && t.entities.some((eid) => entityIds.has(eid))
      );

      // Tensions can also contradict (if they suggest missing links between the entities)
      for (const tension of relatedTensions) {
        if (tension.type === "missing_link") {
          supporting.push({
            id: `ls_${randomUUID().slice(0, 8)}`,
            type: "supporting",
            source: "tension_log",
            description: `Active tension "${tension.description}" suggests a missing link exists.`,
            confidence: tension.urgency,
            entities: tension.entities,
            evidence: `Tension observed ${tension.occurrences} times since ${tension.first_seen}`,
          });
        }
      }
    }
  } catch { /* empty */ }

  // 4) BFS expansion — dream edges reachable from hypothesis entities
  const suggestedConnections: DreamEdge[] = [];
  const visited = new Set(entityIds);
  let frontier = new Set(entityIds);

  for (let hop = 0; hop < depth; hop++) {
    const nextFrontier = new Set<string>();
    for (const edge of dreamGraph.edges) {
      if (edge.interrupted || edge.confidence < 0.3) continue;
      if (frontier.has(edge.from) && !visited.has(edge.to)) {
        nextFrontier.add(edge.to);
        if (!suggestedConnections.some((e) => e.id === edge.id)) {
          suggestedConnections.push(edge);
        }
      } else if (frontier.has(edge.to) && !visited.has(edge.from)) {
        nextFrontier.add(edge.from);
        if (!suggestedConnections.some((e) => e.id === edge.id)) {
          suggestedConnections.push(edge);
        }
      }
    }
    for (const id of nextFrontier) visited.add(id);
    frontier = nextFrontier;
    if (nextFrontier.size === 0) break;
  }

  return {
    supporting,
    contradictions,
    relatedTensions,
    suggestedConnections: suggestedConnections.slice(0, 10), // Cap at 10
  };
}

// ---------------------------------------------------------------------------
// Confidence Assessment
// ---------------------------------------------------------------------------

function assessConfidence(
  supporting: LucidSignal[],
  contradictions: LucidSignal[]
): string {
  const supportScore = supporting.reduce((sum, s) => sum + s.confidence, 0);
  const contraScore = contradictions.reduce((sum, c) => sum + c.confidence, 0);
  const total = supporting.length + contradictions.length;

  if (total === 0) {
    return "Insufficient data: No supporting or contradicting signals found. The hypothesis is neither confirmed nor denied by the current knowledge graph.";
  }

  const ratio = supportScore / (supportScore + contraScore + 0.001);

  if (ratio > 0.8 && supporting.length >= 3) {
    return `Strong support: ${supporting.length} supporting signals (combined confidence: ${supportScore.toFixed(2)}) vs ${contradictions.length} contradictions. The hypothesis appears well-grounded in the knowledge graph.`;
  }

  if (ratio > 0.6) {
    return `Moderate support: ${supporting.length} supporting signals vs ${contradictions.length} contradictions. The hypothesis has some grounding but needs more evidence.`;
  }

  if (ratio > 0.4) {
    return `Mixed signals: ${supporting.length} supporting vs ${contradictions.length} contradicting. The hypothesis is contested — interactive exploration recommended.`;
  }

  return `Weak support: ${contradictions.length} contradicting signals outweigh ${supporting.length} supporting ones. Consider refining the hypothesis.`;
}

// ---------------------------------------------------------------------------
// Lucid Log I/O
// ---------------------------------------------------------------------------

const LUCID_LOG = "lucid_log.json";

async function loadLucidLog(): Promise<LucidLogFile> {
  try {
    const p = dataPath(LUCID_LOG);
    if (!existsSync(p)) return emptyLucidLog();
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as LucidLogFile;
  } catch {
    return emptyLucidLog();
  }
}

function emptyLucidLog(): LucidLogFile {
  return {
    metadata: {
      description:
        "Lucid Dreaming session archive — human+system collaborative exploration.",
      schema_version: "1.0.0",
      total_sessions: 0,
      last_session: null,
    },
    sessions: [],
  };
}

async function appendSession(result: LucidResult): Promise<void> {
  const log = await loadLucidLog();
  log.sessions.push(result);
  log.metadata.total_sessions = log.sessions.length;
  log.metadata.last_session = result.timestamp;
  const p = dataPath(LUCID_LOG);
  await atomicWriteFile(p, JSON.stringify(log, null, 2));
  logger.info(`Lucid session logged (total: ${log.metadata.total_sessions})`);
}

// ---------------------------------------------------------------------------
// Validated Edge Persistence
// ---------------------------------------------------------------------------

async function persistAcceptedEdges(edges: ValidatedEdge[]): Promise<void> {
  if (edges.length === 0) return;

  let file: ValidatedEdgesFile;
  try {
    const vPath = dataPath("validated_edges.json");
    if (existsSync(vPath)) {
      const raw = await readFile(vPath, "utf-8");
      file = JSON.parse(raw) as ValidatedEdgesFile;
    } else {
      file = {
        metadata: {
          description: "Validated Edges — promoted from dream graph after normalization.",
          schema_version: "1.0.0",
          last_validation: null,
          total_validated: 0,
          created_at: new Date().toISOString(),
        },
        edges: [],
      };
    }
  } catch {
    file = {
      metadata: {
        description: "Validated Edges — promoted from dream graph after normalization.",
        schema_version: "1.0.0",
        last_validation: null,
        total_validated: 0,
        created_at: new Date().toISOString(),
      },
      edges: [],
    };
  }

  file.edges.push(...edges);
  file.metadata.total_validated = file.edges.length;
  file.metadata.last_validation = new Date().toISOString();
  const vPath = dataPath("validated_edges.json");
  await atomicWriteFile(vPath, JSON.stringify(file, null, 2));
  logger.info(`${edges.length} lucid-accepted edges persisted to validated_edges.json`);
}

// ---------------------------------------------------------------------------
// Session Timeout Check
// ---------------------------------------------------------------------------

function isSessionTimedOut(): boolean {
  if (!currentSession) return true;
  return Date.now() - currentSession.lastActivity > LUCID_TIMEOUT_MS;
}

/** Update session activity timestamp */
function touch(): void {
  if (currentSession) {
    currentSession.lastActivity = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Public API: startLucidDream
// ---------------------------------------------------------------------------

/**
 * Enter LUCID state and explore a hypothesis.
 * Parses the hypothesis, runs scoped exploration, and returns interactive findings.
 *
 * Requires: engine state = AWAKE
 * Transitions: AWAKE → LUCID
 */
export async function startLucidDream(hypothesisText: string): Promise<LucidFindings> {
  // State transition handled by engine
  engine.enterLucid();

  const now = new Date().toISOString();
  logger.info(`Lucid dream started: "${hypothesisText.slice(0, 80)}..."`);

  // Parse hypothesis
  const { entities, relationship } = await parseHypothesis(hypothesisText);

  const hypothesis: LucidHypothesis = {
    id: `lh_${randomUUID().slice(0, 8)}`,
    raw_text: hypothesisText,
    parsed_entities: entities,
    parsed_relationship: relationship,
    created_at: now,
  };

  // Run scoped exploration
  const exploration = await scopedExploration(hypothesis);
  const confidenceAssessment = assessConfidence(
    exploration.supporting,
    exploration.contradictions
  );

  const findings: LucidFindings = {
    hypothesis,
    supporting_signals: exploration.supporting,
    contradictions: exploration.contradictions,
    related_tensions: exploration.relatedTensions,
    suggested_connections: exploration.suggestedConnections,
    confidence_assessment: confidenceAssessment,
    exploration_depth: 2,
  };

  // Initialize session
  currentSession = {
    hypothesis,
    findings,
    actions: [],
    acceptedEdges: [],
    dismissedContradictions: [],
    startedAt: Date.now(),
    lastActivity: Date.now(),
  };

  logger.info(
    `Lucid findings: ${exploration.supporting.length} supporting, ` +
      `${exploration.contradictions.length} contradictions, ` +
      `${exploration.relatedTensions.length} tensions, ` +
      `${exploration.suggestedConnections.length} suggestions`
  );

  return findings;
}

// ---------------------------------------------------------------------------
// Public API: handleLucidAction
// ---------------------------------------------------------------------------

/**
 * Process an interactive action from the human during a LUCID session.
 *
 * Actions:
 * - dig_deeper: Re-explore around a specific signal entity
 * - dismiss: Mark a contradiction as dismissed with human reasoning
 * - accept: Accept a suggested connection → creates a validated edge
 * - refine: Update the hypothesis text and re-explore
 *
 * Returns updated LucidFindings after the action.
 */
export async function handleLucidAction(action: LucidAction): Promise<LucidFindings> {
  engine.assertState("lucid", "lucidAction");

  if (!currentSession) {
    throw new Error("No active lucid session. Start one with lucid_dream first.");
  }

  if (isSessionTimedOut()) {
    logger.warn("Lucid session timed out — auto-waking");
    const result = await wakeFromLucid();
    throw new Error(
      `Lucid session timed out after ${LUCID_TIMEOUT_MS / 60000} minutes of inactivity. ` +
        `Session has been auto-closed. Results: ${result.edges_accepted.length} edges accepted.`
    );
  }

  touch();
  currentSession.actions.push(action);

  logger.info(`Lucid action: ${action.type} on ${action.target_id}`);

  switch (action.type) {
    case "dig_deeper": {
      // Find the target signal and re-explore around its entities
      const targetSignal =
        currentSession.findings.supporting_signals.find((s) => s.id === action.target_id) ??
        currentSession.findings.contradictions.find((s) => s.id === action.target_id);

      if (!targetSignal) {
        // Maybe it's a suggested connection
        const targetEdge = currentSession.findings.suggested_connections.find(
          (e) => e.id === action.target_id
        );
        if (targetEdge) {
          // Explore around the edge's entities
          const deepHypothesis: LucidHypothesis = {
            ...currentSession.hypothesis,
            parsed_entities: [
              ...new Set([
                ...currentSession.hypothesis.parsed_entities,
                targetEdge.from,
                targetEdge.to,
              ]),
            ],
          };
          const exploration = await scopedExploration(deepHypothesis, 3);
          mergeFindings(currentSession.findings, exploration);
          currentSession.findings.exploration_depth = 3;
        }
      } else {
        // Explore deeper around the signal's entities
        const deepHypothesis: LucidHypothesis = {
          ...currentSession.hypothesis,
          parsed_entities: [
            ...new Set([
              ...currentSession.hypothesis.parsed_entities,
              ...targetSignal.entities,
            ]),
          ],
        };
        const exploration = await scopedExploration(deepHypothesis, 3);
        mergeFindings(currentSession.findings, exploration);
        currentSession.findings.exploration_depth = 3;
      }
      break;
    }

    case "dismiss": {
      // Find and remove the contradiction, log the human reasoning
      const idx = currentSession.findings.contradictions.findIndex(
        (c) => c.id === action.target_id
      );
      if (idx >= 0) {
        const dismissed = currentSession.findings.contradictions.splice(idx, 1)[0];
        currentSession.dismissedContradictions.push({
          signal: dismissed,
          human_reason: action.reason ?? "No reason provided",
        });
        logger.info(`Dismissed contradiction: ${dismissed.description}`);
      }
      break;
    }

    case "accept": {
      // Accept a suggested connection → create a validated edge
      const edgeIdx = currentSession.findings.suggested_connections.findIndex(
        (e) => e.id === action.target_id
      );
      if (edgeIdx >= 0) {
        const dreamEdge = currentSession.findings.suggested_connections.splice(edgeIdx, 1)[0];
        const validatedEdge = dreamEdgeToValidated(dreamEdge);
        currentSession.acceptedEdges.push(validatedEdge);
        logger.info(
          `Accepted edge: ${validatedEdge.from} → ${validatedEdge.to}: ${validatedEdge.relation}`
        );
      } else {
        // Maybe it's a signal — check supporting signals
        const signal = currentSession.findings.supporting_signals.find(
          (s) => s.id === action.target_id
        );
        if (signal && signal.entities.length >= 2) {
          const validatedEdge = signalToValidated(signal, currentSession.hypothesis);
          currentSession.acceptedEdges.push(validatedEdge);
          logger.info(
            `Accepted signal as edge: ${validatedEdge.from} → ${validatedEdge.to}: ${validatedEdge.relation}`
          );
        }
      }
      break;
    }

    case "refine": {
      if (!action.refinement) {
        throw new Error("Refine action requires a 'refinement' field with the new hypothesis text.");
      }
      // Re-parse and re-explore with refined hypothesis
      const { entities, relationship } = await parseHypothesis(action.refinement);
      currentSession.hypothesis = {
        ...currentSession.hypothesis,
        raw_text: action.refinement,
        parsed_entities: entities,
        parsed_relationship: relationship,
      };

      const exploration = await scopedExploration(currentSession.hypothesis);
      const assessment = assessConfidence(
        exploration.supporting,
        exploration.contradictions
      );

      currentSession.findings = {
        hypothesis: currentSession.hypothesis,
        supporting_signals: exploration.supporting,
        contradictions: exploration.contradictions,
        related_tensions: exploration.relatedTensions,
        suggested_connections: exploration.suggestedConnections,
        confidence_assessment: assessment,
        exploration_depth: 2,
      };

      logger.info(`Hypothesis refined: "${action.refinement.slice(0, 80)}..."`);
      break;
    }
  }

  // Re-assess confidence after any action
  currentSession.findings.confidence_assessment = assessConfidence(
    currentSession.findings.supporting_signals,
    currentSession.findings.contradictions
  );

  return currentSession.findings;
}

// ---------------------------------------------------------------------------
// Public API: wakeFromLucid
// ---------------------------------------------------------------------------

/**
 * End the LUCID session, persist accepted edges, log the session.
 *
 * Transitions: LUCID → AWAKE
 * Returns the complete session result.
 */
export async function wakeFromLucid(): Promise<LucidResult> {
  // Allow wake even if timed out
  if (engine.getState() === "lucid") {
    engine.wakeFromLucid();
  }

  if (!currentSession) {
    throw new Error("No active lucid session to finalize.");
  }

  const session = currentSession;
  currentSession = null;

  const result: LucidResult = {
    hypothesis: session.hypothesis,
    findings: session.findings,
    actions_taken: session.actions,
    edges_accepted: session.acceptedEdges,
    contradictions_dismissed: session.dismissedContradictions,
    session_duration_ms: Date.now() - session.startedAt,
    timestamp: new Date().toISOString(),
  };

  // Persist accepted edges to validated_edges.json
  await persistAcceptedEdges(result.edges_accepted);

  // Log the full session
  await appendSession(result);

  logger.info(
    `Lucid session complete: ${result.edges_accepted.length} edges accepted, ` +
      `${result.contradictions_dismissed.length} contradictions dismissed, ` +
      `${result.session_duration_ms}ms`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Public API: getLucidLog (for resource)
// ---------------------------------------------------------------------------

/**
 * Read the lucid session archive for resource exposure.
 */
export async function getLucidLog(): Promise<LucidLogFile> {
  return loadLucidLog();
}

/**
 * Check if there's an active lucid session.
 */
export function hasActiveSession(): boolean {
  return currentSession !== null && !isSessionTimedOut();
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Merge new exploration results into existing findings (for dig_deeper) */
function mergeFindings(
  existing: LucidFindings,
  newData: {
    supporting: LucidSignal[];
    contradictions: LucidSignal[];
    relatedTensions: TensionSignal[];
    suggestedConnections: DreamEdge[];
  }
): void {
  // Merge supporting signals (deduplicate by ID)
  const existingSupportIds = new Set(existing.supporting_signals.map((s) => s.id));
  for (const s of newData.supporting) {
    if (!existingSupportIds.has(s.id)) {
      existing.supporting_signals.push(s);
    }
  }

  // Merge contradictions
  const existingContraIds = new Set(existing.contradictions.map((c) => c.id));
  for (const c of newData.contradictions) {
    if (!existingContraIds.has(c.id)) {
      existing.contradictions.push(c);
    }
  }

  // Merge tensions
  const existingTensionIds = new Set(existing.related_tensions.map((t) => t.id));
  for (const t of newData.relatedTensions) {
    if (!existingTensionIds.has(t.id)) {
      existing.related_tensions.push(t);
    }
  }

  // Merge suggested connections
  const existingEdgeIds = new Set(existing.suggested_connections.map((e) => e.id));
  for (const e of newData.suggestedConnections) {
    if (!existingEdgeIds.has(e.id)) {
      existing.suggested_connections.push(e);
    }
  }
}

/** Convert a dream edge to a validated edge (authority: human+system) */
function dreamEdgeToValidated(dreamEdge: DreamEdge): ValidatedEdge {
  return {
    id: `ve_lucid_${randomUUID().slice(0, 8)}`,
    from: dreamEdge.from,
    to: dreamEdge.to,
    type: dreamEdge.type === "data_model" ? "data_model" : dreamEdge.type === "workflow" ? "workflow" : "feature",
    relation: dreamEdge.relation,
    description: `${dreamEdge.reason} (accepted via lucid dreaming)`,
    confidence: Math.max(dreamEdge.confidence, 0.75), // Minimum 0.75 for human-accepted
    plausibility: dreamEdge.plausibility,
    evidence_score: dreamEdge.evidence_score,
    origin: "rem",
    status: "validated",
    evidence_summary: `Human-accepted during lucid session. Original dream confidence: ${dreamEdge.confidence}. Authority: human+system.`,
    evidence_count: dreamEdge.reinforcement_count + 1, // Human acceptance counts as evidence
    reinforcement_count: dreamEdge.reinforcement_count,
    dream_cycle: dreamEdge.dream_cycle,
    normalization_cycle: 0, // Bypassed normalization — direct human acceptance
    validated_at: new Date().toISOString(),
  };
}

/** Convert a supporting signal to a validated edge */
function signalToValidated(signal: LucidSignal, hypothesis: LucidHypothesis): ValidatedEdge {
  const [from, to] = signal.entities.length >= 2
    ? [signal.entities[0], signal.entities[1]]
    : [signal.entities[0] ?? "unknown", hypothesis.parsed_entities[0] ?? "unknown"];

  return {
    id: `ve_lucid_${randomUUID().slice(0, 8)}`,
    from,
    to,
    type: "feature",
    relation: hypothesis.parsed_relationship,
    description: `${signal.description} (accepted via lucid dreaming)`,
    confidence: Math.max(signal.confidence, 0.75),
    plausibility: 0.8, // Human validation counts as plausible
    evidence_score: signal.confidence,
    origin: "rem",
    status: "validated",
    evidence_summary: `Human-accepted signal: ${signal.evidence}. Authority: human+system.`,
    evidence_count: 1,
    reinforcement_count: 0,
    dream_cycle: 0,
    normalization_cycle: 0,
    validated_at: new Date().toISOString(),
  };
}
