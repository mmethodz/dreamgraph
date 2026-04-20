"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for parseAutonomyRequest — the pure text-parsing function from reporting.ts.
 *
 * NOTE: reporting.ts imports 'vscode' at module level for configuration access,
 * which means the full module cannot be loaded outside the VS Code extension host.
 * These tests inline the parsing logic extracted from parseAutonomyRequest to
 * validate the algorithm without requiring a vscode mock.
 */
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_js_1 = require("../autonomy.js");
// Inline copy of the pure parseAutonomyRequest logic for unit-testability
function parseAutonomyRequest(text, current) {
    const lower = text.toLowerCase();
    const mode = lower.includes('autonomous') ? 'autonomous'
        : lower.includes('eager') ? 'eager'
            : lower.includes('conscientious') ? 'conscientious'
                : lower.includes('cautious') ? 'cautious'
                    : current.mode;
    const budgetMatch = lower.match(/next\s+(\d+)\s+passes|for\s+the\s+next\s+(\d+)\s+passes|for\s+(\d+)\s+passes/);
    const parsedBudget = budgetMatch ? Number(budgetMatch[1] ?? budgetMatch[2] ?? budgetMatch[3]) : current.totalAuthorizedPasses;
    return {
        mode,
        remainingAutoPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.remainingAutoPasses,
        completedAutoPasses: 0,
        totalAuthorizedPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.totalAuthorizedPasses,
    };
}
(0, node_test_1.default)('parseAutonomyRequest extracts autonomous mode from text', () => {
    const current = (0, autonomy_js_1.createAutonomyState)('cautious');
    const result = parseAutonomyRequest('Switch to autonomous mode for the next 5 passes', current);
    strict_1.default.equal(result.mode, 'autonomous');
    strict_1.default.equal(result.remainingAutoPasses, 5);
    strict_1.default.equal(result.totalAuthorizedPasses, 5);
    strict_1.default.equal(result.completedAutoPasses, 0);
});
(0, node_test_1.default)('parseAutonomyRequest extracts eager mode', () => {
    const current = (0, autonomy_js_1.createAutonomyState)('cautious');
    const result = parseAutonomyRequest('Run in eager mode', current);
    strict_1.default.equal(result.mode, 'eager');
});
(0, node_test_1.default)('parseAutonomyRequest extracts conscientious mode', () => {
    const current = (0, autonomy_js_1.createAutonomyState)('cautious');
    const result = parseAutonomyRequest('Be conscientious about this', current);
    strict_1.default.equal(result.mode, 'conscientious');
});
(0, node_test_1.default)('parseAutonomyRequest keeps current mode when no keyword found', () => {
    const current = (0, autonomy_js_1.createAutonomyState)('eager', 3);
    const result = parseAutonomyRequest('Just keep going', current);
    strict_1.default.equal(result.mode, 'eager');
});
(0, node_test_1.default)('parseAutonomyRequest extracts budget from "for N passes" pattern', () => {
    const current = (0, autonomy_js_1.createAutonomyState)('autonomous');
    const result = parseAutonomyRequest('for 10 passes', current);
    strict_1.default.equal(result.remainingAutoPasses, 10);
    strict_1.default.equal(result.totalAuthorizedPasses, 10);
});
//# sourceMappingURL=autonomy-reporting.test.js.map