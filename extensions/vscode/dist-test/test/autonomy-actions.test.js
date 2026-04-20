"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_js_1 = require("../autonomy.js");
(0, node_test_1.default)('do all eligible only for compatible actions', () => {
    const ranked = (0, autonomy_js_1.rankRecommendedActions)([
        { id: 'a1', label: 'One', priority: 1, eligible: true, withinScope: true },
        { id: 'a2', label: 'Two', priority: 2, eligible: true, withinScope: true },
    ]);
    strict_1.default.equal(ranked.doAllEligible, true);
});
(0, node_test_1.default)('eager selects strongest action under medium uncertainty when defining', () => {
    const ranked = (0, autonomy_js_1.rankRecommendedActions)([
        { id: 'a1', label: 'Add clickable actions', priority: 1, eligible: true, withinScope: true },
    ]);
    const selected = (0, autonomy_js_1.chooseActionForMode)('eager', ranked, {
        hasClearNextStep: true,
        uncertainty: 'medium',
        hasBlockingFailure: false,
        nextStepWithinScope: true,
        goalSufficientlyReached: false,
        progressStatus: 'advancing',
        nextStepIsDefining: true,
    });
    strict_1.default.equal(selected, 'a1');
});
//# sourceMappingURL=autonomy-actions.test.js.map