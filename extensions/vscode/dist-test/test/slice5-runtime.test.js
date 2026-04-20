"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('slice 5 runtime renders action buttons with loading/error styles', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /function renderMessageActions\(/);
    strict_1.default.match(source, /message-action-btn/);
    strict_1.default.match(source, /messageActionState/);
    strict_1.default.match(source, /runMessageAction/);
    strict_1.default.match(source, /status === 'loading'/);
});
(0, node_test_1.default)('slice 5 runtime renders implicit entity notice separately from message content', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /implicitEntityNotice\?: string/);
    strict_1.default.match(source, /renderImplicitEntityNotice/);
    strict_1.default.match(source, /message\.implicitEntityNotice/);
});
(0, node_test_1.default)('slice 5 runtime keeps explicit click requirement for actions', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /addEventListener\('click', \(\) => \{/);
    strict_1.default.doesNotMatch(source, /runMessageAction[^\n]*onload/i);
});
//# sourceMappingURL=slice5-runtime.test.js.map