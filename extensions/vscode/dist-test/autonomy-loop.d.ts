import { type AutonomyState, type ContinuationDecision, type PassOutcomeSignal, type RecommendedAction, type RecommendedActionSet } from './autonomy.js';
export interface PassAnalysisInput {
    content: string;
    actions?: RecommendedAction[];
}
export interface PassAnalysisResult {
    signal: PassOutcomeSignal;
    actionSet: RecommendedActionSet;
    selectedActionId?: string;
    decision: ContinuationDecision;
    nextPrompt?: string;
}
export declare function inferPassOutcomeSignal(content: string): PassOutcomeSignal;
export declare function buildContinuationPrompt(actionLabel?: string): string;
export declare function analyzePass(state: AutonomyState, input: PassAnalysisInput): PassAnalysisResult;
export declare function advanceAutonomyStateIfContinued(state: AutonomyState, decision: ContinuationDecision): AutonomyState;
//# sourceMappingURL=autonomy-loop.d.ts.map