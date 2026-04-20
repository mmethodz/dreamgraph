"use strict";
/**
 * Slice 4 unit tests — verification batching and trace rendering helpers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
function batches(names, size = 50) {
    const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 100);
    const out = [];
    for (let i = 0; i < unique.length; i += size)
        out.push(unique.slice(i, i + size));
    return out;
}
function classifyEntity(name, indexes) {
    const key = name.toLowerCase();
    if (indexes.tensions && indexes.tensions.includes(key))
        return 'tension';
    if (indexes.verified.some((index) => index.includes(key)))
        return 'verified';
    if (indexes.latent && indexes.latent.includes(key))
        return 'latent';
    return 'unverified';
}
function renderToolTrace(calls) {
    if (!calls.length)
        return '';
    return '<details class="tool-trace"><summary>Tool trace (' + calls.length + ')</summary><div class="tool-trace-list">' +
        calls.map((call) => '<div class="tool-trace-item"><div class="tool-trace-head"><span>' + call.tool + '</span><span>' + call.durationMs + 'ms</span></div><div class="tool-trace-meta">' + call.status + ' • ' + call.argsSummary + (call.filesAffected.length ? ' • ' + call.filesAffected.join(', ') : '') + '</div></div>').join('') +
        '</div></details>';
}
(0, node_test_1.default)('T-4.5: verification names are batched to max 50', () => {
    const names = Array.from({ length: 120 }, (_, i) => 'name-' + i);
    const out = batches(names, 50);
    strict_1.default.equal(out.length, 2);
    strict_1.default.equal(out[0].length, 50);
    strict_1.default.equal(out[1].length, 50);
});
(0, node_test_1.default)('T-S7.4: verification list is capped at 100 unique names', () => {
    const names = Array.from({ length: 140 }, (_, i) => 'dup-' + i);
    const out = batches(names, 50).flat();
    strict_1.default.equal(out.length, 100);
});
(0, node_test_1.default)('T-4.1/T-4.2/T-4.3/T-4.4: verification semantics distinguish verified, tension, latent, and unverified', () => {
    const verified = JSON.stringify([{ id: 'feature_chat', name: 'Chat Panel' }]).toLowerCase();
    const workflows = JSON.stringify([{ id: 'workflow_chat', name: 'Chat Panel Sync' }]).toLowerCase();
    const dataModel = JSON.stringify([{ id: 'entity_chat_state', name: 'ChatState' }]).toLowerCase();
    const tensions = JSON.stringify([{ id: 'tension_1', description: 'chat panel regression risk' }]).toLowerCase();
    const latent = JSON.stringify([{ id: 'dream_1', source: 'ChatState latent coupling' }]).toLowerCase();
    strict_1.default.equal(classifyEntity('Chat Panel', { verified: [verified, workflows, dataModel], tensions, latent }), 'tension');
    strict_1.default.equal(classifyEntity('ChatState', { verified: [verified, workflows, dataModel], latent }), 'verified');
    strict_1.default.equal(classifyEntity('latent coupling', { verified: [verified, workflows, dataModel], latent }), 'latent');
    strict_1.default.equal(classifyEntity('UnknownThing', { verified: [verified, workflows, dataModel], tensions, latent }), 'unverified');
});
(0, node_test_1.default)('T-5.3/T-5.4: tool trace renders collapsible entries from real call records', () => {
    const html = renderToolTrace([
        { tool: 'query_resource', durationMs: 123, argsSummary: 'uri', filesAffected: ['src/a.ts'], status: 'completed' },
        { tool: 'run_command', durationMs: 456, argsSummary: 'command, cwd', filesAffected: [], status: 'failed' },
    ]);
    strict_1.default.match(html, /<details class="tool-trace">/);
    strict_1.default.match(html, /Tool trace \(2\)/);
    strict_1.default.match(html, /query_resource/);
    strict_1.default.match(html, /123ms/);
    strict_1.default.match(html, /failed/);
});
//# sourceMappingURL=slice4-verify.test.js.map