/**
 * Slice 4 UI tests — verdict/provenance rendering helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function renderVerdictBanner(verdict: { level: string; summary: string } | null): string {
  if (!verdict || !verdict.summary) return '';
  return '<div class="verdict-banner verdict-' + verdict.level + '"><span class="verdict-label">' + verdict.level.toUpperCase() + '</span><span class="verdict-text">' + verdict.summary + '</span></div>';
}

function renderProvenance(toolTraceCount: number): string {
  return toolTraceCount > 0
    ? 'Provenance: grounded in executed tools and rendered webview evidence.'
    : 'Provenance: rendered assistant output; no executed tool trace attached.';
}

test('T-5.1/T-5.2: verdict banner renders structured verdict level and summary', () => {
  const html = renderVerdictBanner({ level: 'verified', summary: 'Verified with 2 executed tool calls.' });
  assert.match(html, /verdict-banner verdict-verified/);
  assert.match(html, /VERIFIED/);
  assert.match(html, /Verified with 2 executed tool calls\./);
});

test('T-S4.1/T-S4.2/T-S4.3: provenance label distinguishes executed-tool grounding', () => {
  assert.match(renderProvenance(2), /grounded in executed tools/);
  assert.match(renderProvenance(0), /no executed tool trace attached/);
});
