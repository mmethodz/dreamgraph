"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_js_1 = require("../autonomy.js");
const lowSignal = {
    hasClearNextStep: true,
    uncertainty: 'low',
    hasBlockingFailure: false,
    nextStepWithinScope: true,
    goalSufficientlyReached: false,
    progressStatus: 'advancing',
    nextStepIsNearTrivial: true,
    nextStepIsDefining: false,
};
const actions = [
    { id: 'b', label: 'Build cross-repo links', priority: 2, eligible: true, withinScope: true },
    { id: 'a', label: 'Enrich workflows', priority: 1, eligible: true, withinScope: true },
];
(0, node_test_1.default)('decrementPassBudget increments completed and decrements remaining when budgeted', () => {
    const next = (0, autonomy_js_1.decrementPassBudget)((0, autonomy_js_1.createAutonomyState)('autonomous', 4));
    strict_1.default.equal(next.completedAutoPasses, 1);
    strict_1.default.equal(next.remainingAutoPasses, 3);
    strict_1.default.equal(next.totalAuthorizedPasses, 4);
});
(0, node_test_1.default)('deriveAutonomyStatusView exposes visible counters when counting is active', () => {
    const status = (0, autonomy_js_1.deriveAutonomyStatusView)({ mode: 'eager', completedAutoPasses: 2, remainingAutoPasses: 2, totalAuthorizedPasses: 4 });
    strict_1.default.equal(status.countingActive, true);
    strict_1.default.match(status.summary, /Passes: 2\/4/);
    strict_1.default.match(status.summary, /Remaining: 2/);
});
(0, node_test_1.default)('rankRecommendedActions picks the top ranked action and enables Do all for compatible actions', () => {
    const ranked = (0, autonomy_js_1.rankRecommendedActions)(actions);
    strict_1.default.equal(ranked.topActionId, 'a');
    strict_1.default.equal(ranked.doAllEligible, true);
    strict_1.default.deepEqual(ranked.actions.map((a) => a.id), ['a', 'b']);
});
(0, node_test_1.default)('computeDoAllEligibility rejects mutually exclusive actions', () => {
    const eligible = (0, autonomy_js_1.computeDoAllEligibility)([
        { id: 'a', label: 'A', priority: 1, eligible: true, withinScope: true, mutuallyExclusiveWith: ['b'] },
        { id: 'b', label: 'B', priority: 2, eligible: true, withinScope: true },
    ]);
    strict_1.default.equal(eligible, false);
});
(0, node_test_1.default)('chooseActionForMode keeps cautious mode user-driven unless near-trivial', () => {
    const ranked = (0, autonomy_js_1.rankRecommendedActions)(actions);
    const choice = (0, autonomy_js_1.chooseActionForMode)('cautious', ranked, { ...lowSignal, nextStepIsNearTrivial: false });
    strict_1.default.equal(choice, undefined);
});
(0, node_test_1.default)('shouldContinueAfterPass stops on goal completion regardless of mode', () => {
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)((0, autonomy_js_1.createAutonomyState)('autonomous', 4), { ...lowSignal, goalSufficientlyReached: true });
    strict_1.default.equal(decision.shouldContinue, false);
    strict_1.default.match(decision.reason, /goal sufficiently reached/i);
});
(0, node_test_1.default)('shouldContinueAfterPass stops on stalled progress regardless of mode', () => {
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)((0, autonomy_js_1.createAutonomyState)('autonomous', 4), { ...lowSignal, progressStatus: 'stalled' });
    strict_1.default.equal(decision.shouldContinue, false);
    strict_1.default.match(decision.reason, /progress has stalled/i);
});
(0, node_test_1.default)('shouldContinueAfterPass keeps cautious mode asking often', () => {
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)((0, autonomy_js_1.createAutonomyState)('cautious', 4), { ...lowSignal, nextStepIsNearTrivial: false });
    strict_1.default.equal(decision.shouldContinue, false);
    strict_1.default.equal(decision.selectionMode, 'user');
});
(0, node_test_1.default)('shouldContinueAfterPass allows eager mode to continue on defining next steps', () => {
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)((0, autonomy_js_1.createAutonomyState)('eager', 4), { ...lowSignal, uncertainty: 'medium', nextStepIsDefining: true });
    strict_1.default.equal(decision.shouldContinue, true);
    strict_1.default.equal(decision.selectionMode, 'self');
});
(0, node_test_1.default)('shouldContinueAfterPass makes autonomous mode self-directed within budget', () => {
    const decision = (0, autonomy_js_1.shouldContinueAfterPass)((0, autonomy_js_1.createAutonomyState)('autonomous', 4), lowSignal);
    strict_1.default.equal(decision.shouldContinue, true);
    strict_1.default.equal(decision.selectionMode, 'self');
});
(0, node_test_1.default)('getAutonomyInstructionBlock includes visible counters and reporting contract', () => {
    const block = (0, autonomy_js_1.getAutonomyInstructionBlock)({ enabled: true, mode: 'autonomous', completedAutoPasses: 2, remainingAutoPasses: 2, totalAuthorizedPasses: 4 });
    strict_1.default.match(block, /Autonomy mode:.*autonomous/i);
    strict_1.default.match(block, /completed 2, remaining 2, total authorized 4/i);
    strict_1.default.match(block, /output into chat after each pass/i);
    strict_1.default.match(block, /counters must remain visible/i);
});
//# sourceMappingURL=autonomy.test.js.map