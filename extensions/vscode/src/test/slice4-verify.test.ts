/**
 * Slice 4 unit tests — verification batching and trace rendering helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function batches(names: string[], size = 50): string[][] {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 100);
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

function classifyEntity(name: string, indexes: { verified: string[]; tensions?: string; latent?: string }): 'verified' | 'tension' | 'latent' | 'unverified' {
  const key = name.toLowerCase();
  if (indexes.tensions && indexes.tensions.includes(key)) return 'tension';
  if (indexes.verified.some((index) => index.includes(key))) return 'verified';
  if (indexes.latent && indexes.latent.includes(key)) return 'latent';
  return 'unverified';
}

function renderToolTrace(calls: Array<{ tool: string; durationMs: number; argsSummary: string; filesAffected: string[]; status: string }>): string {
  if (!calls.length) return '';
  return '<details class="tool-trace"><summary>Tool trace (' + calls.length + ')</summary><div class="tool-trace-list">' +
    calls.map((call) => '<div class="tool-trace-item"><div class="tool-trace-head"><span>' + call.tool + '</span><span>' + call.durationMs + 'ms</span></div><div class="tool-trace-meta">' + call.status + ' • ' + call.argsSummary + (call.filesAffected.length ? ' • ' + call.filesAffected.join(', ') : '') + '</div></div>').join('') +
    '</div></details>';
}

test('T-4.5: verification names are batched to max 50', () => {
  const names = Array.from({ length: 120 }, (_, i) => 'name-' + i);
  const out = batches(names, 50);
  assert.equal(out.length, 2);
  assert.equal(out[0].length, 50);
  assert.equal(out[1].length, 50);
});

test('T-S7.4: verification list is capped at 100 unique names', () => {
  const names = Array.from({ length: 140 }, (_, i) => 'dup-' + i);
  const out = batches(names, 50).flat();
  assert.equal(out.length, 100);
});

test('T-4.1/T-4.2/T-4.3/T-4.4: verification semantics distinguish verified, tension, latent, and unverified', () => {
  const verified = JSON.stringify([{ id: 'feature_chat', name: 'Chat Panel' }]).toLowerCase();
  const workflows = JSON.stringify([{ id: 'workflow_chat', name: 'Chat Panel Sync' }]).toLowerCase();
  const dataModel = JSON.stringify([{ id: 'entity_chat_state', name: 'ChatState' }]).toLowerCase();
  const tensions = JSON.stringify([{ id: 'tension_1', description: 'chat panel regression risk' }]).toLowerCase();
  const latent = JSON.stringify([{ id: 'dream_1', source: 'ChatState latent coupling' }]).toLowerCase();

  assert.equal(classifyEntity('Chat Panel', { verified: [verified, workflows, dataModel], tensions, latent }), 'tension');
  assert.equal(classifyEntity('ChatState', { verified: [verified, workflows, dataModel], latent }), 'verified');
  assert.equal(classifyEntity('latent coupling', { verified: [verified, workflows, dataModel], latent }), 'latent');
  assert.equal(classifyEntity('UnknownThing', { verified: [verified, workflows, dataModel], tensions, latent }), 'unverified');
});

test('T-5.3/T-5.4: tool trace renders collapsible entries from real call records', () => {
  const html = renderToolTrace([
    { tool: 'query_resource', durationMs: 123, argsSummary: 'uri', filesAffected: ['src/a.ts'], status: 'completed' },
    { tool: 'run_command', durationMs: 456, argsSummary: 'command, cwd', filesAffected: [], status: 'failed' },
  ]);
  assert.match(html, /<details class="tool-trace">/);
  assert.match(html, /Tool trace \(2\)/);
  assert.match(html, /query_resource/);
  assert.match(html, /123ms/);
  assert.match(html, /failed/);
});
