"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
(0, node_test_1.default)('Slice 3 build migration: bundled webview runtime is emitted', () => {
    const bundlePath = node_path_1.default.join(process.cwd(), 'dist', 'webview.js');
    strict_1.default.equal(node_fs_1.default.existsSync(bundlePath), true);
    const content = node_fs_1.default.readFileSync(bundlePath, 'utf8');
    strict_1.default.match(content, /registerCardFencePlugin/);
    strict_1.default.match(content, /renderMarkdown/);
    strict_1.default.match(content, /linkifyEntities/);
});
(0, node_test_1.default)('Slice 3 build migration: chat panel loads bundled runtime via script src', () => {
    const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
    strict_1.default.match(source, /asWebviewUri\(/);
    strict_1.default.match(source, /private _webviewBundleUri: string \| null = null;/);
    strict_1.default.match(source, /_webviewBundleUri/);
    strict_1.default.doesNotMatch(source, /\$\{this\._webviewBundleSource\}/);
});
//# sourceMappingURL=webview-bundle.test.js.map