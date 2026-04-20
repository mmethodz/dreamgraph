"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferPassOutcomeSignal = inferPassOutcomeSignal;
exports.buildContinuationPrompt = buildContinuationPrompt;
exports.analyzePass = analyzePass;
exports.advanceAutonomyStateIfContinued = advanceAutonomyStateIfContinued;
const autonomy_js_1 = require("./autonomy.js");
function inferPassOutcomeSignal(content) {
    const lower = content.toLowerCase();
    const goalSufficientlyReached = /ready for commit|done and verified|goal sufficiently reached|completed successfully/.test(lower);
    const hasBlockingFailure = /blocking failure|build failed|error:|failed\b/.test(lower);
    const stalled = /stalled progress|no further progress|cannot proceed|stuck/.test(lower);
    const uncertainty = /uncertain|not sure|insufficient data|confidence: low/.test(lower) ? 'high'
        : /partial|likely|appears|confidence: medium/.test(lower) ? 'medium'
            : 'low';
    const hasClearNextStep = /recommended next step|next step|i can continue|continue into the next slice|proceed next/.test(lower) || goalSufficientlyReached;
    const nextStepWithinScope = !/outside current scope|out of scope/.test(lower);
    const nextStepIsNearTrivial = /minor follow-up|small cleanup|trivial next step|quick verification/.test(lower);
    const nextStepIsDefining = /defining next step|significant|structural next slice|host-controlled continuation loop|clickable recommended/.test(lower);
    const progressStatus = stalled ? 'stalled' : /partial progress|slowing|some progress/.test(lower) ? 'slowing' : 'advancing';
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
function buildContinuationPrompt(actionLabel) {
    return actionLabel
        ? `Continue with the recommended next step: ${actionLabel}. Keep the visible autonomy counters up to date and stop if the original goal is sufficiently reached or progress stalls.`
        : 'Continue with your strongest in-scope recommended next step. Keep the visible autonomy counters up to date and stop if the original goal is sufficiently reached or progress stalls.';
}
function analyzePass(state, input) {
    const signal = inferPassOutcomeSignal(input.content);
    const actionSet = (0, autonomy_js_1.rankRecommendedActions)(input.actions ?? []);
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)(state, signal, actionSet);
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
function advanceAutonomyStateIfContinued(state, decision) {
    return decision.shouldContinue ? (0, autonomy_js_1.decrementPassBudget)(state) : state;
}
//# sourceMappingURL=autonomy-loop.js.map