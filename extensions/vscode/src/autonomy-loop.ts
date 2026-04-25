import {
  decrementPassBudget,
  rankRecommendedActions,
  shouldContinueAfterPass,
  type AutonomyState,
  type ContinuationDecision,
  type PassOutcomeSignal,
  type RecommendedAction,
  type RecommendedActionSet,
} from './autonomy.js';
import type { StructuredPassEnvelope } from './autonomy-structured.js';

export interface PassAnalysisInput {
  content: string;
  actions?: RecommendedAction[];
  /** Structured envelope parsed from the LLM response. When present its fields
   * are authoritative over prose-regex-derived equivalents. */
  envelope?: StructuredPassEnvelope;
}

export interface PassAnalysisResult {
  signal: PassOutcomeSignal;
  actionSet: RecommendedActionSet;
  selectedActionId?: string;
  decision: ContinuationDecision;
  nextPrompt?: string;
}

export function inferPassOutcomeSignal(content: string): PassOutcomeSignal {
  const lower = content.toLowerCase();
  const goalSufficientlyReached = /ready for commit|done and verified|goal sufficiently reached|completed successfully/.test(lower);
  // Intentionally narrow — broad terms like "error:" and standalone "failed" fire
  // on too much normal prose ("error: none", "what failed was"). Only trigger on
  // phrases that unambiguously indicate an unrecoverable stop condition.
  const hasBlockingFailure = /blocking failure|build failed|unrecoverable error|fatal error/.test(lower)
    || (/\bfailed\b/.test(lower) && /cannot proceed|cannot continue|still failing|remains broken/.test(lower));
  const stalled = /stalled progress|no further progress|cannot proceed|stuck/.test(lower);
  const uncertainty: PassOutcomeSignal['uncertainty'] =
    /uncertain|not sure|insufficient data|confidence: low/.test(lower) ? 'high'
      : /partial|likely|appears|confidence: medium/.test(lower) ? 'medium'
        : 'low';
  const hasClearNextStep = /recommended next step|next step|i can continue|continue into the next slice|proceed next/.test(lower) || goalSufficientlyReached;
  const nextStepWithinScope = !/outside current scope|out of scope/.test(lower);
  const nextStepIsNearTrivial = /minor follow-up|small cleanup|trivial next step|quick verification/.test(lower);
  const nextStepIsDefining = /defining next step|significant|structural next slice|host-controlled continuation loop|clickable recommended/.test(lower);
  const progressStatus: PassOutcomeSignal['progressStatus'] = stalled ? 'stalled' : /partial progress|slowing|some progress/.test(lower) ? 'slowing' : 'advancing';
  return {
    hasClearNextStep,
    uncertainty,
    hasBlockingFailure,
    nextStepWithinScope,
    goalSufficientlyReached,
    progressStatus,
    nextStepIsNearTrivial,
    nextStepIsDefining,
  };
}

export function buildContinuationPrompt(actionLabel?: string): string {
  return actionLabel
    ? `Continue with the recommended next step: ${actionLabel}. Keep the visible autonomy counters up to date and stop if the original goal is sufficiently reached or progress stalls.`
    : 'Continue with your strongest in-scope recommended next step. Keep the visible autonomy counters up to date and stop if the original goal is sufficiently reached or progress stalls.';
}

export function analyzePass(state: AutonomyState, input: PassAnalysisInput): PassAnalysisResult {
  const proseSignal = inferPassOutcomeSignal(input.content);
  const hasActions = (input.actions?.length ?? 0) > 0;
  const env = input.envelope;

  // Structured envelope fields are authoritative over prose-regex equivalents.
  // Prose is the fallback when no structured block was emitted.
  const signal: PassOutcomeSignal = {
    ...proseSignal,
    // Action presence is definitive evidence of a clear next step.
    hasClearNextStep: hasActions || proseSignal.hasClearNextStep,
    // Structured overrides when present.
    goalSufficientlyReached: (env?.goalStatus === 'complete') || proseSignal.goalSufficientlyReached,
    progressStatus: env?.progressStatus ?? proseSignal.progressStatus,
    uncertainty: env?.uncertainty ?? proseSignal.uncertainty,
    // When structured data is present, blocking failure is ONLY signalled by
    // goal_status:"blocked" — not by the noisy prose regex.
    hasBlockingFailure: env ? (env.goalStatus === 'blocked') : proseSignal.hasBlockingFailure,
  };

  const actionSet = rankRecommendedActions(input.actions ?? []);
  const decision = shouldContinueAfterPass(state, signal, actionSet);
  const selectedActionId = decision.selectionMode === 'self' ? actionSet.topActionId : undefined;
  const selectedAction = actionSet.actions.find((a) => a.id === selectedActionId);
  return {
    signal,
    actionSet,
    selectedActionId,
    decision,
    nextPrompt: decision.shouldContinue ? buildContinuationPrompt(selectedAction?.label) : undefined,
  };
}

export function advanceAutonomyStateIfContinued(state: AutonomyState, decision: ContinuationDecision): AutonomyState {
  return decision.shouldContinue ? decrementPassBudget(state) : state;
}
