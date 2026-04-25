export type AutonomyMode = 'cautious' | 'conscientious' | 'eager' | 'autonomous';
export type UncertaintyLevel = 'low' | 'medium' | 'high';
export type ProgressStatus = 'advancing' | 'slowing' | 'stalled';
export type SelectionMode = 'user' | 'self' | 'none';

export interface AutonomyState {
  mode: AutonomyMode;
  remainingAutoPasses: number;
  completedAutoPasses: number;
  totalAuthorizedPasses?: number;
}

export interface PassOutcomeSignal {
  hasClearNextStep: boolean;
  uncertainty: UncertaintyLevel;
  hasBlockingFailure: boolean;
  nextStepWithinScope: boolean;
  goalSufficientlyReached: boolean;
  progressStatus: ProgressStatus;
  nextStepIsNearTrivial?: boolean;
  nextStepIsDefining?: boolean;
}

export interface RecommendedAction {
  id: string;
  label: string;
  rationale?: string;
  priority: number;
  eligible: boolean;
  withinScope: boolean;
  mutuallyExclusiveWith?: string[];
  batchGroup?: string;
}

export interface RecommendedActionSet {
  actions: RecommendedAction[];
  doAllEligible: boolean;
  topActionId?: string;
}

export interface ContinuationDecision {
  shouldContinue: boolean;
  reason: string;
  selectionMode: SelectionMode;
}

export interface AutonomyStatusView {
  mode: AutonomyMode;
  countingActive: boolean;
  completed: number;
  remaining: number;
  totalAuthorized?: number;
  summary: string;
}

export interface AutonomyInstructionState extends AutonomyState {
  enabled?: boolean;
}

export function createAutonomyState(mode: AutonomyMode = 'cautious', totalAuthorizedPasses?: number): AutonomyState {
  const remaining = typeof totalAuthorizedPasses === 'number' && totalAuthorizedPasses > 0 ? totalAuthorizedPasses : 0;
  return {
    mode,
    remainingAutoPasses: remaining,
    completedAutoPasses: 0,
    totalAuthorizedPasses: totalAuthorizedPasses && totalAuthorizedPasses > 0 ? totalAuthorizedPasses : undefined,
  };
}

export function isPassCountingActive(state: AutonomyState | undefined): boolean {
  return !!state && ((state.totalAuthorizedPasses ?? 0) > 0 || state.completedAutoPasses > 0 || state.remainingAutoPasses > 0);
}

export function decrementPassBudget(state: AutonomyState): AutonomyState {
  const hadBudget = typeof state.totalAuthorizedPasses === 'number' && state.totalAuthorizedPasses > 0;
  return {
    ...state,
    completedAutoPasses: state.completedAutoPasses + 1,
    remainingAutoPasses: hadBudget ? Math.max(0, state.remainingAutoPasses - 1) : state.remainingAutoPasses,
  };
}

export function deriveAutonomyStatusView(state: AutonomyState): AutonomyStatusView {
  const countingActive = isPassCountingActive(state);
  const total = state.totalAuthorizedPasses;
  const summary = countingActive
    ? `Mode: ${state.mode} · Passes: ${state.completedAutoPasses}/${total ?? state.completedAutoPasses + state.remainingAutoPasses} · Remaining: ${state.remainingAutoPasses}`
    : `Mode: ${state.mode}`;
  return {
    mode: state.mode,
    countingActive,
    completed: state.completedAutoPasses,
    remaining: state.remainingAutoPasses,
    totalAuthorized: total,
    summary,
  };
}

export function rankRecommendedActions(actions: RecommendedAction[]): RecommendedActionSet {
  const eligible = actions.filter((action) => action.eligible && action.withinScope);
  const sorted = [...eligible].sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  return {
    actions: sorted,
    doAllEligible: computeDoAllEligibility(sorted),
    topActionId: sorted[0]?.id,
  };
}

export function computeDoAllEligibility(actions: RecommendedAction[]): boolean {
  if (actions.length < 2) return false;
  for (const action of actions) {
    if (!action.eligible || !action.withinScope) return false;
    const mutex = new Set(action.mutuallyExclusiveWith ?? []);
    for (const other of actions) {
      if (other.id === action.id) continue;
      if (mutex.has(other.id)) return false;
    }
  }
  return true;
}

export function chooseActionForMode(
  mode: AutonomyMode,
  actionSet: RecommendedActionSet,
  signal: PassOutcomeSignal,
): string | undefined {
  if (!actionSet.topActionId) return undefined;
  if (mode === 'cautious') return signal.nextStepIsNearTrivial ? actionSet.topActionId : undefined;
  if (mode === 'conscientious') return signal.uncertainty === 'low' ? actionSet.topActionId : undefined;
  if (mode === 'eager') return signal.uncertainty === 'high' ? undefined : actionSet.topActionId;
  return signal.uncertainty === 'high' ? undefined : actionSet.topActionId;
}

export function shouldContinueAfterPass(
  state: AutonomyState,
  signal: PassOutcomeSignal,
  actionSet?: RecommendedActionSet,
): ContinuationDecision {
  if (signal.goalSufficientlyReached) {
    return { shouldContinue: false, reason: 'Stopped: original goal sufficiently reached.', selectionMode: 'none' };
  }
  if (signal.progressStatus === 'stalled') {
    return { shouldContinue: false, reason: 'Stopped: progress has stalled.', selectionMode: 'none' };
  }
  if (signal.hasBlockingFailure) {
    return { shouldContinue: false, reason: 'Stopped: blocking failure encountered.', selectionMode: 'none' };
  }
  if (!signal.hasClearNextStep) {
    // Pause for user selection rather than hard-stopping. The webview will show
    // any action chips that were broadcast; the user can select one or type "resume".
    return { shouldContinue: false, reason: 'Paused: no clear next step identified — select an action or type "resume" to continue.', selectionMode: 'user' };
  }
  if (!signal.nextStepWithinScope) {
    return { shouldContinue: false, reason: 'Stopped: next step is outside current scope.', selectionMode: 'none' };
  }
  if (state.totalAuthorizedPasses && state.remainingAutoPasses <= 0) {
    return { shouldContinue: false, reason: 'Stopped: pass budget exhausted.', selectionMode: 'none' };
  }
  if (signal.uncertainty === 'high') {
    return { shouldContinue: false, reason: 'Stopped: uncertainty too high for safe continuation.', selectionMode: 'none' };
  }

  if (state.mode === 'cautious') {
    if (signal.uncertainty !== 'low' || !signal.nextStepIsNearTrivial) {
      return { shouldContinue: false, reason: 'Paused: cautious mode prefers user confirmation.', selectionMode: 'user' };
    }
    return { shouldContinue: true, reason: 'Continuing automatically: near-trivial next step with low uncertainty.', selectionMode: 'self' };
  }

  if (state.mode === 'conscientious') {
    if (signal.uncertainty === 'low') {
      const selected = chooseActionForMode(state.mode, actionSet ?? { actions: [], doAllEligible: false }, signal);
      return { shouldContinue: true, reason: 'Continuing automatically: clear bounded next step.', selectionMode: selected ? 'self' : 'user' };
    }
    return { shouldContinue: false, reason: 'Paused: conscientious mode requires clearer bounds.', selectionMode: 'user' };
  }

  if (state.mode === 'eager') {
    if (signal.uncertainty === 'medium' && !signal.nextStepIsDefining) {
      return { shouldContinue: false, reason: 'Paused: eager mode needs a defining or lower-risk next step.', selectionMode: 'user' };
    }
    return { shouldContinue: true, reason: 'Continuing automatically: strong aligned next step available.', selectionMode: 'self' };
  }

  return { shouldContinue: true, reason: 'Continuing automatically: autonomous mode with bounded in-scope next step.', selectionMode: 'self' };
}

export function getAutonomyInstructionBlock(state?: AutonomyInstructionState): string {
  if (!state?.enabled) return '';
  const status = deriveAutonomyStatusView(state);
  return [
    '## Autonomy Contract',
    `- **Autonomy mode:** ${state.mode}`,
    status.countingActive ? `- **Pass counters:** completed ${status.completed}, remaining ${status.remaining}, total authorized ${status.totalAuthorized ?? status.completed + status.remaining}` : '- **Pass counters:** inactive',
    '- In all modes, DreamGraph must output into chat after each pass.',
    '- Continue automatically only when host policy allows and the next step is clear, in scope, and safe for the current mode.',
    '- Stop when the original goal has sufficiently been reached.',
    '- Stop when progress has stalled.',
    '- When pass counting is active, counters must remain visible.',
    '- Emit recommended next steps in a structured/selectable form when available.',
    '- In higher-autonomy modes, self-select the strongest eligible next action when policy allows; otherwise pause for user selection.',
  ].join('\n');
}
