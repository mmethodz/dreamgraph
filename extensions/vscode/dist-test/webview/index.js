"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const render_markdown_js_1 = require("./render-markdown.js");
const entity_links_js_1 = require("./entity-links.js");
const card_renderer_js_1 = require("./card-renderer.js");
// Bundled webview bootstrap for Slice 3 Option C migration.
// Exposes the same globals expected by chat-panel.ts webview runtime.
(function bootstrapWebview() {
    const scripts = [
        (0, card_renderer_js_1.getCardRendererScript)(),
        (0, render_markdown_js_1.getRenderScript)(),
        (0, entity_links_js_1.getEntityLinksScript)(),
    ];
    for (const source of scripts) {
        // Execute in the webview global scope.
        // eslint-disable-next-line no-new-func
        const fn = new Function(source);
        fn();
    }
})();
//# sourceMappingURL=index.js.map