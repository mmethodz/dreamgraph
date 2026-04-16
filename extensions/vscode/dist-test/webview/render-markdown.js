"use strict";
/**
 * render-markdown.ts — Option A script-string generator.
 *
 * This file exports getRenderScript(): string, which returns the JavaScript
 * source text injected into the webview via getHtml(). It is NOT a pure TS
 * rendering utility — the webview has no module system, so the output is a
 * JS string template that runs in the webview's inline script context.
 *
 * markdown-it and DOMPurify are pre-loaded as separate <script> tags before
 * this script runs. Both are available on window.markdownit and window.DOMPurify.
 *
 * Key decisions (from TDD_COGNITIVE_OUTPUT_V2.md):
 *  - html: false — LLM output is untrusted; no raw HTML pass-through
 *  - DOMPurify allowlist is explicit (not a blocklist)
 *  - ALLOW_DATA_ATTR: false — no data-* from LLM content
 *  - Copy buttons added only at stream-end (idempotency: rebuild-then-enhance)
 *  - External links intercepted globally, routed via extension host
 *  - Streaming: debounced ~80ms, no copy buttons during stream
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRenderScript = getRenderScript;
function getRenderScript() {
    return `
    (function() {
      // markdown-it instance — shared, configured once
      const md = window.markdownit({
        html: false,
        linkify: true,
        typographer: false,
      });

      // Override link_open to add target="_blank" and rel="noopener noreferrer"
      const defaultLinkOpen = md.renderer.rules.link_open || function(tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };
      md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
        const aIndex = tokens[idx].attrIndex('target');
        if (aIndex < 0) {
          tokens[idx].attrPush(['target', '_blank']);
        } else {
          tokens[idx].attrs[aIndex][1] = '_blank';
        }
        const relIndex = tokens[idx].attrIndex('rel');
        if (relIndex < 0) {
          tokens[idx].attrPush(['rel', 'noopener noreferrer']);
        } else {
          tokens[idx].attrs[relIndex][1] = 'noopener noreferrer';
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
      };

      /**
       * Render markdown content to sanitized HTML.
       * Stage 1: markdown-it (html:false) → HTML string
       * Stage 2: DOMPurify explicit allowlist → safe HTML
       */
      window.renderMarkdown = function(content) {
        const raw = md.render(content);
        const clean = DOMPurify.sanitize(raw, {
          ALLOWED_TAGS: [
            'h1','h2','h3','h4','h5','h6',
            'p','br','strong','em','code',
            'pre','blockquote',
            'ul','ol','li',
            'table','thead','tbody','tr','th','td',
            'a','img','span','div','hr',
          ],
          ALLOWED_ATTR: ['href','src','alt','class','target','rel'],
          ALLOW_DATA_ATTR: false,
          ADD_ATTR: ['target'],
        });
        return clean;
      };

      /**
       * Apply copy buttons to all <pre><code> blocks inside a container.
       * Idempotency: always called after a full innerHTML rebuild, so no
       * stale buttons survive. Never called during streaming.
       */
      window.addCopyButtons = function(container) {
        container.querySelectorAll('pre > code').forEach(function(block) {
          const btn = document.createElement('button');
          btn.className = 'copy-btn';
          btn.textContent = 'Copy';
          btn.addEventListener('click', function() {
            vscode.postMessage({ type: 'copyToClipboard', text: block.textContent || '' });
            btn.textContent = 'Copied';
            setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
          });
          block.parentElement.appendChild(btn);
        });
      };

      /**
       * Render a completed (non-streaming) assistant message bubble.
       * Adds copy buttons immediately since this is the final render.
       */
      window.renderCompletedMessage = function(el, content) {
        el.innerHTML = window.renderMarkdown(content);
        window.addCopyButtons(el);
      };

      /**
       * Global link interceptor. Catches all <a href="http..."> clicks and
       * routes them through the extension host (vscode.env.openExternal).
       * Must be attached once at webview init, not per-bubble.
       */
      window.initLinkInterceptor = function() {
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a[href]');
          if (!link) return;
          const href = link.getAttribute('href');
          if (href && (href.startsWith('https://') || href.startsWith('http://'))) {
            e.preventDefault();
            vscode.postMessage({ type: 'openExternalLink', url: href });
          }
        });
      };

    })();
  `;
}
//# sourceMappingURL=render-markdown.js.map