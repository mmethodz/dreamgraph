/**
 * DreamGraph Dream Narratives — System Autobiography
 *
 * Generates a coherent narrative of the system's evolving understanding
 * from dream_history, tension_log, and validated_edges.
 *
 * Not a log — a STORY of how understanding developed:
 *   "I started by thinking catalog and cart were unrelated. After 8 cycles,
 *    I discovered they share an implicit session model. This led me to find
 *    that order management has no awareness of session expiry, which became
 *    my highest-urgency tension..."
 *
 * Three depth levels:
 *   executive  — 1-page summary for stakeholders
 *   technical  — detailed findings with entity references
 *   full       — complete cycle-by-cycle narrative
 *
 * READ-ONLY: synthesizes existing data, writes nothing.
 */

import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type {
  NarrativeDepth,
  NarrativeChapter,
  SystemNarrative,
  DreamHistoryEntry,
  TensionSignal,
  ResolvedTension,
  ValidatedEdge,
} from "./types.js";

// ---------------------------------------------------------------------------
// Chapter Construction
// ---------------------------------------------------------------------------

interface EpochData {
  sessions: DreamHistoryEntry[];
  activeTensions: TensionSignal[];
  resolvedTensions: ResolvedTension[];
  promotedEdges: ValidatedEdge[];
  cycleRange: [number, number];
}

/**
 * Divide history into narrative epochs (chapters).
 * Each epoch covers a natural "phase" of understanding.
 */
function divideIntoEpochs(
  sessions: DreamHistoryEntry[],
  allTensions: TensionSignal[],
  resolvedTensions: ResolvedTension[],
  validatedEdges: ValidatedEdge[],
  depth: NarrativeDepth
): EpochData[] {
  if (sessions.length === 0) return [];

  // Determine epoch size based on depth
  const epochSize = depth === "executive" ? Math.max(Math.ceil(sessions.length / 3), 1)
    : depth === "technical" ? Math.max(Math.ceil(sessions.length / 6), 1)
    : Math.max(Math.ceil(sessions.length / 10), 1);

  const epochs: EpochData[] = [];

  for (let i = 0; i < sessions.length; i += epochSize) {
    const chunk = sessions.slice(i, i + epochSize);
    if (chunk.length === 0) continue;

    const minCycle = chunk[0].cycle_number;
    const maxCycle = chunk[chunk.length - 1].cycle_number;

    // Find tensions active during this epoch
    const active = allTensions.filter((t) => {
      // Approximate: tension is active if its TTL places it in this range
      return true; // Include all for context
    });

    // Find resolutions during this epoch
    const resolved = resolvedTensions.filter((r) => {
      const resolvedDate = new Date(r.resolved_at).getTime();
      const epochStart = new Date(chunk[0].timestamp).getTime();
      const epochEnd = new Date(chunk[chunk.length - 1].timestamp).getTime();
      return resolvedDate >= epochStart && resolvedDate <= epochEnd;
    });

    // Find edges promoted during this epoch
    const promoted = validatedEdges.filter((e) => {
      return e.dream_cycle >= minCycle && e.dream_cycle <= maxCycle;
    });

    epochs.push({
      sessions: chunk,
      activeTensions: active,
      resolvedTensions: resolved,
      promotedEdges: promoted,
      cycleRange: [minCycle, maxCycle],
    });
  }

  return epochs;
}

/**
 * Generate narrative text for a single epoch.
 */
function narrateEpoch(epoch: EpochData, epochIndex: number, depth: NarrativeDepth): NarrativeChapter {
  const totalEdges = epoch.sessions.reduce((sum, s) => sum + s.generated_edges, 0);
  const totalNodes = epoch.sessions.reduce((sum, s) => sum + s.generated_nodes, 0);
  const totalDecayed = epoch.sessions.reduce((sum, s) => sum + s.decayed_edges + s.decayed_nodes, 0);
  const totalMerged = epoch.sessions.reduce((sum, s) => sum + s.duplicates_merged, 0);
  const totalValidated = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.validated ?? 0), 0);
  const totalRejected = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.rejected ?? 0), 0);
  const totalPromoted = epoch.sessions.reduce((sum, s) => sum + (s.normalization?.promoted ?? 0), 0);

  // Key discoveries
  const discoveries: string[] = [];
  if (totalPromoted > 0) {
    discoveries.push(`${totalPromoted} connections were validated and promoted to the knowledge graph`);
  }
  if (epoch.resolvedTensions.length > 0) {
    const byType = new Map<string, number>();
    for (const r of epoch.resolvedTensions) {
      byType.set(r.resolution_type, (byType.get(r.resolution_type) ?? 0) + 1);
    }
    for (const [type, count] of byType) {
      discoveries.push(`${count} tension(s) resolved as ${type.replace(/_/g, " ")}`);
    }
  }
  if (totalMerged > 0) {
    discoveries.push(`${totalMerged} ideas were rediscovered, strengthening existing hypotheses`);
  }
  if (totalDecayed > 0) {
    discoveries.push(`${totalDecayed} stale items decayed — the system is forgetting what doesn't matter`);
  }

  // Tensions addressed
  const tensionsAddressed = epoch.resolvedTensions.map(
    (r) => `"${r.tension_id}" (${r.resolution_type})`
  );

  // Build narrative text based on depth
  const parts: string[] = [];

  if (epochIndex === 0) {
    parts.push(`The system began its exploration with ${epoch.sessions.length} dream cycles.`);
  } else {
    parts.push(`In this phase (cycles ${epoch.cycleRange[0]}–${epoch.cycleRange[1]}), the system continued its analysis.`);
  }

  parts.push(
    `It generated ${totalEdges} speculative edges and ${totalNodes} hypothetical nodes, ` +
    `of which ${totalValidated} were validated as genuine connections and ${totalRejected} were rejected as noise.`
  );

  if (totalPromoted > 0) {
    parts.push(
      `${totalPromoted} edge(s) were strong enough to be promoted into the knowledge graph, representing confirmed discoveries about the system's architecture.`
    );
  }

  if (epoch.promotedEdges.length > 0 && depth !== "executive") {
    const edgeDescs = epoch.promotedEdges.slice(0, 3).map(
      (e) => `"${e.from}" → "${e.to}" (${e.relation})`
    );
    parts.push(`Key promoted connections: ${edgeDescs.join("; ")}.`);
  }

  if (epoch.resolvedTensions.length > 0) {
    const fixes = epoch.resolvedTensions.filter(
      (r) => r.resolution_type === "confirmed_fixed"
    );
    const fps = epoch.resolvedTensions.filter(
      (r) => r.resolution_type === "false_positive"
    );

    if (fixes.length > 0) {
      parts.push(
        `${fixes.length} tension(s) were confirmed fixed — issues the system identified and verified as resolved.`
      );
    }
    if (fps.length > 0) {
      parts.push(
        `${fps.length} tension(s) turned out to be false positives — the Truth Filter correctly identified that these were not real problems.`
      );
    }
  }

  if (totalDecayed > totalEdges * 0.3) {
    parts.push(
      "A significant portion of speculative ideas decayed during this phase, indicating the system is tightening its focus on what matters."
    );
  }

  // Title generation
  let title: string;
  if (epochIndex === 0) {
    title = "The Awakening";
  } else if (totalPromoted > 3) {
    title = "A Phase of Discovery";
  } else if (epoch.resolvedTensions.length > 2) {
    title = "Resolving Contradictions";
  } else if (totalDecayed > totalEdges * 0.5) {
    title = "Selective Forgetting";
  } else if (totalMerged > totalEdges * 0.3) {
    title = "Reinforcing Beliefs";
  } else {
    title = `Cycle ${epoch.cycleRange[0]}–${epoch.cycleRange[1]}`;
  }

  return {
    title,
    cycle_range: epoch.cycleRange,
    key_discoveries: discoveries,
    tensions_addressed: tensionsAddressed,
    narrative_text: parts.join(" "),
  };
}

/**
 * Generate the epilogue — overall assessment of the system's state.
 */
function generateEpilogue(
  totalCycles: number,
  activeTensions: TensionSignal[],
  resolvedTensions: ResolvedTension[],
  validatedEdges: ValidatedEdge[]
): string {
  const parts: string[] = [];

  parts.push(`After ${totalCycles} dream cycle(s), the system has developed a structured understanding.`);

  if (validatedEdges.length > 0) {
    parts.push(`${validatedEdges.length} connection(s) have been validated and promoted to the knowledge graph.`);
  }

  if (resolvedTensions.length > 0) {
    const fixed = resolvedTensions.filter((r) => r.resolution_type === "confirmed_fixed").length;
    const fps = resolvedTensions.filter((r) => r.resolution_type === "false_positive").length;
    parts.push(
      `${resolvedTensions.length} tension(s) have been resolved: ${fixed} confirmed fixed, ${fps} false positives.`
    );
  }

  const unresolvedCount = activeTensions.filter((t) => !t.resolved).length;
  if (unresolvedCount === 0) {
    parts.push(
      "No unresolved tensions remain. The system has reached a healthy, stable state."
    );
  } else if (unresolvedCount <= 5) {
    parts.push(
      `${unresolvedCount} low-priority tension(s) remain. These will likely decay naturally or be resolved in future cycles.`
    );
  } else {
    const topUrgency = Math.max(...activeTensions.filter((t) => !t.resolved).map((t) => t.urgency));
    parts.push(
      `${unresolvedCount} tension(s) remain active, with top urgency ${topUrgency.toFixed(2)}. Continued dream cycles are recommended.`
    );
  }

  return parts.join(" ");
}

/**
 * Assess overall health based on the narrative data.
 */
function assessHealth(
  activeTensions: TensionSignal[],
  validatedEdges: ValidatedEdge[]
): string {
  const unresolved = activeTensions.filter((t) => !t.resolved);
  const maxUrgency = unresolved.length > 0
    ? Math.max(...unresolved.map((t) => t.urgency))
    : 0;

  if (unresolved.length === 0) return "healthy — no open tensions";
  if (maxUrgency > 0.8) return "critical — high-urgency tensions require attention";
  if (maxUrgency > 0.5) return "attention needed — moderate tensions remain";
  if (unresolved.length > 20) return "overloaded — too many open tensions";
  return "stable — only low-priority tensions remain";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a system narrative from all available history.
 *
 * @param depth "executive" (short), "technical" (detailed), "full" (cycle-by-cycle)
 */
export async function generateNarrative(
  depth: NarrativeDepth = "technical"
): Promise<SystemNarrative> {
  logger.info(`Generating system narrative (depth: ${depth})`);

  const [history, tensionFile, validatedFile] = await Promise.all([
    engine.loadDreamHistory(),
    engine.loadTensions(),
    engine.loadValidatedEdges(),
  ]);

  const sessions = history.sessions;
  const activeTensions = tensionFile.signals;
  const resolvedTensions = tensionFile.resolved_tensions ?? [];
  const validatedEdges = validatedFile.edges;

  // Divide into epochs
  const epochs = divideIntoEpochs(
    sessions,
    activeTensions,
    resolvedTensions,
    validatedEdges,
    depth
  );

  // Generate chapter narratives
  const chapters = epochs.map((epoch, i) => narrateEpoch(epoch, i, depth));

  // Generate epilogue
  const epilogue = generateEpilogue(
    sessions.length,
    activeTensions,
    resolvedTensions,
    validatedEdges
  );

  const overall_health = assessHealth(activeTensions, validatedEdges);

  const narrative: SystemNarrative = {
    title: sessions.length === 0
      ? "A System Awaiting Its First Dream"
      : `The Story of Understanding — ${sessions.length} Dream Cycles`,
    depth,
    generated_at: new Date().toISOString(),
    total_cycles_covered: sessions.length,
    chapters,
    epilogue,
    overall_health,
  };

  logger.info(
    `Narrative generated: ${chapters.length} chapters, ${sessions.length} cycles covered`
  );

  return narrative;
}
