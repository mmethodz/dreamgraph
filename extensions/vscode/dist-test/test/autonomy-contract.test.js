"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_contract_js_1 = require("../autonomy-contract.js");
(0, node_test_1.default)('contract block includes json requirement', () => {
    const block = (0, autonomy_contract_js_1.getStructuredResponseContractBlock)();
    strict_1.default.ok(block.includes('```json'));
    strict_1.default.ok(block.includes('recommended_next_steps'));
    strict_1.default.ok(block.includes('goal_status'));
    strict_1.default.ok(block.includes('exactly one fenced'));
});
(0, node_test_1.default)('extracts structured json envelope blocks', () => {
    const content = [
        'Summary text',
        '```json',
        JSON.stringify({
            summary: 'Implemented next slice',
            goal_status: 'partial',
            progress_status: 'advancing',
            uncertainty: 'low',
            recommended_next_steps: [
                { label: 'Mount header', priority: 1, eligible: true, within_scope: true }
            ]
        }, null, 2),
        '```'
    ].join('\n');
    const blocks = (0, autonomy_contract_js_1.extractJsonEnvelopeBlocks)(content);
    strict_1.default.equal(blocks.length, 1);
    strict_1.default.equal(blocks[0].goal_status, 'partial');
    strict_1.default.equal(blocks[0].recommended_next_steps?.[0]?.label, 'Mount header');
});
(0, node_test_1.default)('returns primary structured json envelope', () => {
    const content = [
        '```json',
        JSON.stringify({ summary: 'Primary', goal_status: 'partial' }),
        '```',
        '```json',
        JSON.stringify({ summary: 'Secondary', goal_status: 'complete' }),
        '```'
    ].join('\n');
    const block = (0, autonomy_contract_js_1.extractPrimaryJsonEnvelope)(content);
    strict_1.default.equal(block?.summary, 'Primary');
    strict_1.default.equal((0, autonomy_contract_js_1.hasStructuredEnvelope)(content), true);
});
(0, node_test_1.default)('ignores malformed json blocks', () => {
    const content = '```json\n{ nope }\n```';
    const blocks = (0, autonomy_contract_js_1.extractJsonEnvelopeBlocks)(content);
    strict_1.default.equal(blocks.length, 0);
    strict_1.default.equal((0, autonomy_contract_js_1.hasStructuredEnvelope)(content), false);
});
//# sourceMappingURL=autonomy-contract.test.js.map