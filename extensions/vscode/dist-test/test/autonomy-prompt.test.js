"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for autonomy prompt injection logic.
 *
 * NOTE: assemblePrompt (prompts/index.ts) transitively imports 'vscode' via
 * reporting.ts, so it cannot be loaded outside the VS Code extension host.
 * These tests validate the autonomy instruction block and structured response
 * contract block independently — both are pure functions.
 */
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_js_1 = require("../autonomy.js");
const autonomy_contract_js_1 = require("../autonomy-contract.js");
(0, node_test_1.default)('getAutonomyInstructionBlock returns instruction when enabled', () => {
    const block = (0, autonomy_js_1.getAutonomyInstructionBlock)({
        enabled: true,
        mode: 'autonomous',
        completedAutoPasses: 1,
        remainingAutoPasses: 3,
        totalAuthorizedPasses: 4,
    });
    strict_1.default.ok(block);
    strict_1.default.match(block, /Autonomy mode/i);
    strict_1.default.match(block, /autonomous/i);
    strict_1.default.match(block, /completed 1, remaining 3, total authorized 4/i);
});
(0, node_test_1.default)('getAutonomyInstructionBlock returns empty string when disabled', () => {
    const block = (0, autonomy_js_1.getAutonomyInstructionBlock)({
        enabled: false,
        mode: 'cautious',
        completedAutoPasses: 0,
        remainingAutoPasses: 0,
    });
    strict_1.default.equal(block, '');
});
(0, node_test_1.default)('getAutonomyInstructionBlock returns empty when undefined', () => {
    const block = (0, autonomy_js_1.getAutonomyInstructionBlock)(undefined);
    strict_1.default.equal(block, '');
});
(0, node_test_1.default)('getStructuredResponseContractBlock includes json envelope requirement', () => {
    const block = (0, autonomy_contract_js_1.getStructuredResponseContractBlock)();
    strict_1.default.ok(block.length > 0);
    strict_1.default.match(block, /structured_action_envelope|json/i);
});
//# sourceMappingURL=autonomy-prompt.test.js.map