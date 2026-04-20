"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('Slice 5 source includes show_full storage and action state messaging', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /fullContent\?: string/);
    strict_1.default.match(source, /type: 'messageActionState'/);
    strict_1.default.match(source, /status: 'loading' \| 'completed' \| 'failed'/);
});
(0, node_test_1.default)('Slice 5 source routes message actions through real execution helpers', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /_executeMessageActionTool/);
    strict_1.default.match(source, /this\.mcpClient\.callTool\(toolName, input, ChatPanel\._toolTimeoutMs\(toolName\)\)/);
    strict_1.default.match(source, /executeLocalTool\(toolName, input\)/);
    strict_1.default.match(source, /Action result \(\$\{action\.label\}\)/);
});
(0, node_test_1.default)('Slice 5 source logs action provenance with outcome and detail', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /detail\?: string/);
    strict_1.default.match(source, /sourceMessageId: messageId/);
    strict_1.default.match(source, /outcome: 'completed'/);
    strict_1.default.match(source, /outcome: 'failed'/);
    strict_1.default.match(source, /outcome: 'cancelled'/);
});
//# sourceMappingURL=slice5-actions.test.js.map