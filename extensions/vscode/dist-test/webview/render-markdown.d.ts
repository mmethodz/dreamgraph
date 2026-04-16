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
export declare function getRenderScript(): string;
//# sourceMappingURL=render-markdown.d.ts.map