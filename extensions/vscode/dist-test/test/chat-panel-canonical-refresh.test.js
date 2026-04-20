"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const chat_panel_1 = require("../chat-panel");
const chat_memory_1 = require("../chat-memory");
class FakeGlobalState {
    data = new Map();
    get(key) {
        return this.data.get(key);
    }
    async update(key, value) {
        if (typeof value === 'undefined') {
            this.data.delete(key);
            return;
        }
        this.data.set(key, value);
    }
}
function createEnvelopeWithCanonicalAnchor() {
    return {
        workspaceRoot: 'c:/Users/Mika Jussila/source/repos/dreamgraph',
        instanceId: 'instance-a',
        activeFile: {
            path: 'extensions/vscode/src/context-builder.ts',
            languageId: 'typescript',
            lineCount: 1748,
            cursorLine: 750,
            cursorColumn: 1,
            cursorSummary: 'cursor at _resolveGraphContext',
            cursorAnchor: {
                path: 'extensions/vscode/src/context-builder.ts',
                kind: 'symbol',
                symbolPath: 'ContextBuilder._resolveGraphContext',
                label: 'Graph Relevance Propagation',
                confidence: 0.92,
                canonicalId: 'graph-relevance-propagation',
                canonicalKind: 'entity',
                migrationStatus: 'promoted',
                symbolRange: { startLine: 700, endLine: 890 },
            },
            selection: null,
        },
        visibleFiles: ['extensions/vscode/src/context-builder.ts'],
        changedFiles: [],
        pinnedFiles: [],
        graphContext: {
            relatedFeatures: [],
            relatedWorkflows: [],
            applicableAdrs: [],
            uiPatterns: [],
            activeTensions: 0,
            cognitiveState: 'awake',
            apiSurface: null,
            tensions: [],
            dreamInsights: [],
            causalChains: [],
            temporalPatterns: [],
            dataModelEntities: [],
        },
        intentMode: 'active_file',
        intentConfidence: 0.9,
    };
}
(0, node_test_1.default)('ChatPanel refreshes persisted user anchor with canonical identity before save', async () => {
    const context = { globalState: new FakeGlobalState() };
    const memory = new chat_memory_1.ChatMemory(context);
    const panel = new chat_panel_1.ChatPanel(context);
    panel.setMemory(memory);
    panel.setInstance('instance-a');
    const messages = panel.messages;
    messages.push({
        id: 'msg_user_1',
        role: 'user',
        content: 'Explain this function',
        timestamp: '2026-04-10T00:00:00.000Z',
        instanceId: 'instance-a',
        anchor: {
            path: 'extensions/vscode/src/context-builder.ts',
            kind: 'symbol',
            symbolPath: 'ContextBuilder._resolveGraphContext',
            label: '_resolveGraphContext',
            confidence: 0.41,
            migrationStatus: 'native',
            symbolRange: { startLine: 700, endLine: 890 },
        },
    });
    const envelope = createEnvelopeWithCanonicalAnchor();
    await panel._persistMessagesWithCanonicalAnchorRefresh(envelope);
    const restored = await memory.load('instance-a');
    strict_1.default.equal(restored.length, 1);
    strict_1.default.equal(restored[0]?.anchor?.canonicalId, 'graph-relevance-propagation');
    strict_1.default.equal(restored[0]?.anchor?.canonicalKind, 'entity');
    strict_1.default.equal(restored[0]?.anchor?.migrationStatus, 'promoted');
    strict_1.default.equal(restored[0]?.anchor?.label, 'Graph Relevance Propagation');
    strict_1.default.equal(restored[0]?.anchor?.symbolPath, 'ContextBuilder._resolveGraphContext');
    strict_1.default.equal(restored[0]?.anchor?.confidence, 0.92);
    strict_1.default.deepStrictEqual(restored[0]?.anchor?.symbolRange, { startLine: 700, endLine: 890 });
});
//# sourceMappingURL=chat-panel-canonical-refresh.test.js.map