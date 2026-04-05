/**
 * DreamGraph MCP Server — Discipline State Machine.
 *
 * Implements the five-phase disciplinary execution model with typed
 * transition guards and phase-order enforcement.
 *
 * Phases: INGEST → AUDIT → PLAN → EXECUTE → VERIFY
 *
 * Loopback from VERIFY to PLAN or EXECUTE is allowed with justification.
 * All other transitions must follow strict sequential order.
 *
 * See ADR-003: Five-Phase Disciplinary State Machine.
 */

import { logger } from "../utils/logger.js";
import type { DisciplinePhase, PhaseTransitionRule } from "./types.js";
import { PHASE_ORDER } from "./types.js";

// ---------------------------------------------------------------------------
// Transition Rules
// ---------------------------------------------------------------------------

export const TRANSITION_RULES: PhaseTransitionRule[] = [
  {
    from: "start",
    to: "ingest",
    requires: "Session must be initialized with a task description",
  },
  {
    from: "ingest",
    to: "audit",
    requires:
      "At least one MCP truth tool must have been called and returned data",
  },
  {
    from: "audit",
    to: "plan",
    requires:
      "Delta table must be complete with no unresolved 'not_yet_verified' entries",
  },
  {
    from: "plan",
    to: "execute",
    requires:
      "Structured JSON implementation plan must exist and be approved",
  },
  {
    from: "execute",
    to: "verify",
    requires:
      "Execution must have completed (files written or explicitly no-op)",
  },
  // Loopbacks from Verify
  {
    from: "verify",
    to: "plan",
    requires:
      "Verification failed — explicit justification for re-planning required",
  },
  {
    from: "verify",
    to: "execute",
    requires:
      "Gaps have existing plan entries — re-execute without re-planning",
  },
];

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export interface PhaseTransitionResult {
  allowed: boolean;
  reason: string;
}

/**
 * Check whether a transition from `current` to `target` is valid.
 *
 * Forward transitions must follow strict sequential order.
 * Only VERIFY may loop back to PLAN or EXECUTE.
 */
export function canTransition(
  current: DisciplinePhase | "start",
  target: DisciplinePhase
): PhaseTransitionResult {
  // Check if a rule exists for this transition
  const rule = TRANSITION_RULES.find(
    (r) => r.from === current && r.to === target
  );

  if (!rule) {
    return {
      allowed: false,
      reason: `No transition rule exists from '${current}' to '${target}'. Allowed transitions from '${current}': ${getAllowedTargets(current).join(", ") || "none"}`,
    };
  }

  // Forward transitions: check sequential order (except loopbacks)
  if (current !== "start" && current !== "verify") {
    const currentIdx = PHASE_ORDER.indexOf(current);
    const targetIdx = PHASE_ORDER.indexOf(target);
    if (targetIdx !== currentIdx + 1) {
      return {
        allowed: false,
        reason: `Phase '${target}' is not the next sequential phase after '${current}'. Expected '${PHASE_ORDER[currentIdx + 1]}'.`,
      };
    }
  }

  return {
    allowed: true,
    reason: rule.requires,
  };
}

/**
 * Get all valid target phases from the current phase.
 */
export function getAllowedTargets(
  current: DisciplinePhase | "start"
): DisciplinePhase[] {
  return TRANSITION_RULES
    .filter((r) => r.from === current)
    .map((r) => r.to);
}

/**
 * Get the next sequential phase (forward only, no loopbacks).
 * Returns null if current is "verify" (terminal phase).
 */
export function getNextPhase(
  current: DisciplinePhase
): DisciplinePhase | null {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

/**
 * Check if a tool class is permitted in the given phase.
 */
export function isToolPermitted(
  phase: DisciplinePhase,
  toolClass: string,
  allowedPhases: DisciplinePhase[]
): boolean {
  return allowedPhases.includes(phase);
}

/**
 * Log a phase transition event.
 */
export function logTransition(
  from: DisciplinePhase | "start",
  to: DisciplinePhase,
  result: PhaseTransitionResult
): void {
  if (result.allowed) {
    logger.info(
      `Discipline: phase transition ${from} → ${to} (${result.reason})`
    );
  } else {
    logger.warn(
      `Discipline: blocked transition ${from} → ${to}: ${result.reason}`
    );
  }
}
