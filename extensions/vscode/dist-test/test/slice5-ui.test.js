"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('Slice 5 TDD references action safety and limits', () => {
    const plan = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), '..', '..', 'plans', 'TDD_COGNITIVE_OUTPUT_V2.md'), 'utf8');
    strict_1.default.match(plan, /No action auto-executes\./);
    strict_1.default.match(plan, /Max message render size \| 100 KB/);
});
(0, node_test_1.default)('chat panel contains Slice 5 action and render limit scaffolding', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /runMessageAction/);
    strict_1.default.match(source, /MAX_RENDERED_MESSAGE_CHARS = 100_000/);
    strict_1.default.match(source, /ACTION_ALLOWLIST/);
    strict_1.default.match(source, /\[Response truncated\]/);
});
(0, node_test_1.default)('styles include role header, hover actions, and action block styles', () => {
    const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
    strict_1.default.match(css, /message-header/);
    strict_1.default.match(css, /message-actions-hover/);
    strict_1.default.match(css, /message-action-btn/);
    strict_1.default.match(css, /message-context-footer/);
});
//# sourceMappingURL=slice5-ui.test.js.map