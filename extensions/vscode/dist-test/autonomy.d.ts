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
export declare function createAutonomyState(mode?: AutonomyMode, totalAuthorizedPasses?: number): AutonomyState;
export declare function isPassCountingActive(state: AutonomyState | undefined): boolean;
export declare function decrementPassBudget(state: AutonomyState): AutonomyState;
export declare function deriveAutonomyStatusView(state: AutonomyState): AutonomyStatusView;
export declare function rankRecommendedActions(actions: RecommendedAction[]): RecommendedActionSet;
export declare function computeDoAllEligibility(actions: RecommendedAction[]): boolean;
export declare function chooseActionForMode(mode: AutonomyMode, actionSet: RecommendedActionSet, signal: PassOutcomeSignal): string | undefined;
export declare function shouldContinueAfterPass(state: AutonomyState, signal: PassOutcomeSignal, actionSet?: RecommendedActionSet): ContinuationDecision;
export declare function getAutonomyInstructionBlock(state?: AutonomyInstructionState): string;
//# sourceMappingURL=autonomy.d.ts.map