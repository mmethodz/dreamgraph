import { getRenderScript } from './render-markdown.js';
import { getEntityLinksScript } from './entity-links.js';
import { getCardRendererScript } from './card-renderer.js';

// Bundled webview bootstrap for Slice 3 Option C migration.
// Exposes the same globals expected by chat-panel.ts webview runtime.
(function bootstrapWebview() {
  const scripts = [
    getCardRendererScript(),
    getRenderScript(),
    getEntityLinksScript(),
  ];

  for (const source of scripts) {
    // Execute in the webview global scope.
    // eslint-disable-next-line no-new-func
    const fn = new Function(source);
    fn();
  }
})();
