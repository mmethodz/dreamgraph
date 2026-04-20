"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('Slice 5 audit: hover actions are wired for copy, retry, and pin', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /type: 'retryMessage'/);
    strict_1.default.match(source, /type: 'copyMessage'/);
    strict_1.default.match(source, /type: 'pinMessage'/);
    strict_1.default.match(source, /message-mini-btn/);
});
(0, node_test_1.default)('Slice 5 audit: action execution remains allowlisted and explicit-click only', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /ACTION_ALLOWLIST = new Set\(\['tool', 'show_full'\]\)/);
    strict_1.default.match(source, /addEventListener\('click', \(\) => \{/);
    strict_1.default.doesNotMatch(source, /runMessageAction[^\n]*onload/i);
});
(0, node_test_1.default)('Slice 5 audit: resource guards remain in place', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /MAX_RENDERED_MESSAGE_CHARS = 100_000/);
    strict_1.default.match(source, /MAX_ENTITY_LINKS_PER_MESSAGE = 100/);
    strict_1.default.match(source, /MAX_VERIFICATION_BATCH_SIZE = 50/);
    strict_1.default.match(source, /VERIFICATION_TIMEOUT_MS = 5_000/);
});
(0, node_test_1.default)('Slice 5 audit: styles include context footer, action buttons, and implicit entity notice', () => {
    const styles = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
    strict_1.default.match(styles, /\.message-context-footer/);
    strict_1.default.match(styles, /\.message-actions/);
    strict_1.default.match(styles, /\.message-action-btn\.loading/);
    strict_1.default.match(styles, /\.implicit-entity-notice/);
});
//# sourceMappingURL=slice5-audit.test.js.map