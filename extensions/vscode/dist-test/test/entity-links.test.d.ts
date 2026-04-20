/**
 * Slice 2 unit tests — entity URI linkification.
 *
 * Tests run in plain Node (node:test). No DOM, no VS Code host.
 *
 * Strategy: We re-implement the linkifyEntities logic in Node-compatible form
 * (identical algorithm to the webview script-string) and test it directly.
 * This keeps the test suite fast and dependency-free.
 *
 * Tests covered:
 *  T-2.1  feature:// URIs are linkified
 *  T-2.2  All recognised schemes are linkified (including data-model://)
 *  T-2.3  Resulting anchors have correct data-type and data-uri attributes
 *  T-2.4  URIs inside <pre>…</pre> and <code>…</code> are NOT linkified
 *  T-2.5  URIs already inside href="…" are NOT double-linkified
 *  T-S1.4 Only allowlisted schemes are linkified (javascript: etc. are NOT)
 *  T-S3.1 data-uri on generated anchor only contains the allowlisted URI
 */
export {};
//# sourceMappingURL=entity-links.test.d.ts.map