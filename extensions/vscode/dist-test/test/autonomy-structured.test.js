"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const autonomy_structured_js_1 = require("../autonomy-structured.js");
(0, node_test_1.default)('extracts actions from recommended next steps section', () => {
    const content = [
        '## Recommended next steps',
        '- Add persistent header',
        '- Wire action dispatch',
    ].join('\n');
    const envelope = (0, autonomy_structured_js_1.extractStructuredPassEnvelope)(content);
    strict_1.default.equal(envelope.nextSteps.length, 2);
    strict_1.default.equal(envelope.nextSteps[0].label, 'Add persistent header');
});
(0, node_test_1.default)('prefers structured json envelope when present', () => {
    const content = [
        'Human explanation here',
        '```json',
        JSON.stringify({
            summary: 'Did the thing',
            goal_status: 'partial',
            progress_status: 'advancing',
            uncertainty: 'low',
            recommended_next_steps: [
                { id: 'ship-it', label: 'Ship it', priority: 1, eligible: true, within_scope: true, batch_group: 'release' }
            ]
        }, null, 2),
        '```',
        '## Recommended next steps',
        '- Fallback action that should not win'
    ].join('\n');
    const envelope = (0, autonomy_structured_js_1.extractStructuredPassEnvelope)(content);
    strict_1.default.equal(envelope.summary, 'Did the thing');
    strict_1.default.equal(envelope.nextSteps.length, 1);
    strict_1.default.equal(envelope.nextSteps[0].id, 'ship-it');
    strict_1.default.equal(envelope.nextSteps[0].batchGroup, 'release');
});
(0, node_test_1.default)('ranks actions from assistant output', () => {
    const content = [
        '## Recommended next steps',
        '1. Mount persistent header',
        '2. Add clickable chips',
    ].join('\n');
    const set = (0, autonomy_structured_js_1.buildRecommendedActionSetFromContent)(content);
    strict_1.default.equal(set.actions.length, 2);
    strict_1.default.equal(set.topActionId, set.actions[0].id);
});
//# sourceMappingURL=autonomy-structured.test.js.map