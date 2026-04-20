"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_js_1 = require("../autonomy.js");
const autonomy_loop_js_1 = require("../autonomy-loop.js");
(0, node_test_1.default)('inferPassOutcomeSignal detects goal completion and stalled progress markers', () => {
    const done = (0, autonomy_loop_js_1.inferPassOutcomeSignal)('Done and verified. Ready for commit.');
    strict_1.default.equal(done.goalSufficientlyReached, true);
    const stalled = (0, autonomy_loop_js_1.inferPassOutcomeSignal)('Stalled progress. Cannot proceed.');
    strict_1.default.equal(stalled.progressStatus, 'stalled');
});
(0, node_test_1.default)('analyzePass selects continuation prompt when autonomous mode has a strong next step', () => {
    const state = (0, autonomy_js_1.createAutonomyState)('autonomous', 4);
    const result = (0, autonomy_loop_js_1.analyzePass)(state, {
        content: 'Implemented a structural next slice. Recommended next step: add clickable recommended actions.',
        actions: [{ id: 'next', label: 'Add clickable recommended actions', priority: 1, eligible: true, withinScope: true }],
    });
    strict_1.default.equal(result.decision.shouldContinue, true);
    strict_1.default.equal(result.selectedActionId, 'next');
    strict_1.default.match(result.nextPrompt ?? '', /Add clickable recommended actions/);
});
(0, node_test_1.default)('analyzePass stops when goal is sufficiently reached', () => {
    const state = (0, autonomy_js_1.createAutonomyState)('autonomous', 4);
    const result = (0, autonomy_loop_js_1.analyzePass)(state, {
        content: 'Done and verified. Ready for commit.',
    });
    strict_1.default.equal(result.decision.shouldContinue, false);
    strict_1.default.match(result.decision.reason, /goal sufficiently reached/i);
});
(0, node_test_1.default)('advanceAutonomyStateIfContinued decrements visible counters only when continuing', () => {
    const state = (0, autonomy_js_1.createAutonomyState)('autonomous', 4);
    const continued = (0, autonomy_loop_js_1.advanceAutonomyStateIfContinued)(state, { shouldContinue: true, reason: 'continue', selectionMode: 'self' });
    strict_1.default.equal(continued.completedAutoPasses, 1);
    strict_1.default.equal(continued.remainingAutoPasses, 3);
    const paused = (0, autonomy_loop_js_1.advanceAutonomyStateIfContinued)(state, { shouldContinue: false, reason: 'stop', selectionMode: 'none' });
    strict_1.default.equal(paused.completedAutoPasses, 0);
    strict_1.default.equal(paused.remainingAutoPasses, 4);
});
//# sourceMappingURL=autonomy-loop.test.js.map