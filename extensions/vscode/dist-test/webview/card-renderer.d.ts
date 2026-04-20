/**
 * card-renderer.ts — Slice 3 structured card rendering.
 *
 * Exports a script-string generator for the webview. The script exposes
 * window.registerCardFencePlugin(md), which installs a markdown-it fence rule
 * handling these language tags:
 *   - entity
 *   - adr
 *   - tension
 *   - insight
 *
 * Contract from TDD:
 * - cards are driven exclusively by fenced blocks in LLM output
 * - malformed card bodies fall back to regular fenced code blocks
 * - unknown fence types are untouched
 * - no crash, no partial broken DOM
 */
export declare function getCardRendererScript(): string;
//# sourceMappingURL=card-renderer.d.ts.map