/**
 * entity-links.ts — Script-string generator for Slice 2 entity URI linkification.
 *
 * Exports getEntityLinksScript(): string, injected into the webview via getHtml().
 * Runs after renderMarkdown() to post-process rendered HTML.
 *
 * Recognised URI schemes: feature://, workflow://, data-model://, entity://,
 * adr://, tension://, edge://, file://
 *
 * Safety rules (T-S1.4, T-S3.1):
 *  - URIs inside <pre> and <code> are NEVER linkified (code-block safety)
 *  - Only the allowlisted schemes are matched — no javascript:, data:, etc.
 *  - data-uri stored on the anchor is validated to match the allowlist before use
 *  - navigateEntity message is only posted for validated URIs
 *
 * Processing model:
 *  - linkifyEntities(html: string): string — called with the DOMPurify-sanitized
 *    HTML string BEFORE innerHTML assignment. Works on the string directly using
 *    a split-on-tags approach so that matches inside <pre>…</pre> and <code>…</code>
 *    are skipped without a DOM dependency.
 *  - At stream-end, window.applyEntityLinks(container) is called to attach click
 *    listeners to .entity-link anchors already in the DOM.
 *
 * Deferred (Slice 5+): implicit entity detection from prose, graph verification markers.
 */
export declare function getEntityLinksScript(): string;
//# sourceMappingURL=entity-links.d.ts.map