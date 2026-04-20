"use strict";
/**
 * Slice 4 UI tests — verdict/provenance rendering helpers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
function renderVerdictBanner(verdict) {
    if (!verdict || !verdict.summary)
        return '';
    return '<div class="verdict-banner verdict-' + verdict.level + '"><span class="verdict-label">' + verdict.level.toUpperCase() + '</span><span class="verdict-text">' + verdict.summary + '</span></div>';
}
function renderProvenance(toolTraceCount) {
    return toolTraceCount > 0
        ? 'Provenance: grounded in executed tools and rendered webview evidence.'
        : 'Provenance: rendered assistant output; no executed tool trace attached.';
}
(0, node_test_1.default)('T-5.1/T-5.2: verdict banner renders structured verdict level and summary', () => {
    const html = renderVerdictBanner({ level: 'verified', summary: 'Verified with 2 executed tool calls.' });
    strict_1.default.match(html, /verdict-banner verdict-verified/);
    strict_1.default.match(html, /VERIFIED/);
    strict_1.default.match(html, /Verified with 2 executed tool calls\./);
});
(0, node_test_1.default)('T-S4.1/T-S4.2/T-S4.3: provenance label distinguishes executed-tool grounding', () => {
    strict_1.default.match(renderProvenance(2), /grounded in executed tools/);
    strict_1.default.match(renderProvenance(0), /no executed tool trace attached/);
});
//# sourceMappingURL=slice4-ui.test.js.map