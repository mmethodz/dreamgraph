"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.default)('Slice 5 next pass adds instance scoping to chat messages', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /instanceId\?: string/);
    strict_1.default.match(source, /instanceId: this\.currentInstanceId/);
    strict_1.default.match(source, /message\.instanceId === this\.currentInstanceId/);
});
(0, node_test_1.default)('Slice 5 next pass restoreMessages filters messages to the active instance', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /restoreMessages\(\)[\s\S]*filter\(\(message\) => !message\.instanceId \|\| message\.instanceId === this\.currentInstanceId\)/);
});
(0, node_test_1.default)('Slice 5 next pass adds context footer metadata', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /contextFooter\?: string/);
    strict_1.default.match(source, /private _contextFooterFor\(message: ChatMessage\): string/);
    strict_1.default.match(source, /Trace reflects real tool execution/);
});
(0, node_test_1.default)('Slice 5 next pass adds implicit entity detection and capping', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /MAX_ENTITY_LINKS_PER_MESSAGE = 100/);
    strict_1.default.match(source, /private _detectImplicitEntities\(content: string\): ImplicitEntityDetectionResult/);
    strict_1.default.match(source, /Implicit entity references detected:/);
    strict_1.default.match(source, /Entity link cap reached/);
});
(0, node_test_1.default)('Slice 5 next pass adds implicit entity notice styling', () => {
    const styles = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src', 'webview', 'styles.ts'), 'utf8');
    strict_1.default.match(styles, /\.implicit-entity-notice/);
});
//# sourceMappingURL=slice5-next-pass.test.js.map