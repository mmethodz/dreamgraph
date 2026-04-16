/**
 * Slice 3 unit tests — structured card rendering.
 *
 * Strategy: run markdown-it in Node and install a Node-side equivalent of the
 * webview card fence plugin. This validates the fence contract without a DOM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';

function registerCardFencePlugin(md: MarkdownIt): void {
  function escHtml(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function parseCardBody(src: string): { fields: Record<string, string>; body: string } {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const fields: Record<string, string> = {};
    const bodyLines: string[] = [];
    let inBody = false;
    for (const line of lines) {
      const match = !inBody ? line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/) : null;
      if (match) {
        fields[match[1].toLowerCase()] = match[2];
        continue;
      }
      if (line.trim() === '' && Object.keys(fields).length > 0 && !inBody) {
        inBody = true;
        continue;
      }
      if (inBody || line.trim() !== '') {
        inBody = true;
        bodyLines.push(line);
      }
    }
    return { fields, body: bodyLines.join('\n').trim() };
  }

  function normalizeCard(type: string, parsed: { fields: Record<string, string>; body: string }) {
    const f = parsed.fields;
    if (type === 'entity') {
      if (!f.id && !f.name) return null;
      return { title: f.name || f.id, subtitle: f.id ? `ID: ${f.id}` : '', meta: [f.kind, f.status].filter(Boolean), body: parsed.body || f.description || '' };
    }
    if (type === 'adr') {
      if (!f.id && !f.title) return null;
      return { title: `${f.id ? `${f.id}: ` : ''}${f.title || f.id}`, subtitle: f.status ? `Status: ${f.status}` : '', meta: [f.decided_by, f.date].filter(Boolean), body: parsed.body || f.chosen || f.summary || '' };
    }
    if (type === 'tension') {
      if (!f.id && !f.title && !parsed.body) return null;
      return { title: f.title || f.id || 'Tension', subtitle: f.id ? `ID: ${f.id}` : '', meta: [f.severity, f.status].filter(Boolean), body: parsed.body || f.description || '' };
    }
    if (type === 'insight') {
      if (!f.title && !parsed.body) return null;
      return { title: f.title || 'Insight', subtitle: f.confidence ? `Confidence: ${f.confidence}` : '', meta: [f.kind, f.source].filter(Boolean), body: parsed.body || f.summary || '' };
    }
    return null;
  }

  function renderCard(type: string, normalized: { title: string; subtitle?: string; meta?: string[]; body?: string }): string {
    const subtitle = normalized.subtitle ? `<div class="dg-card-subtitle">${escHtml(normalized.subtitle)}</div>` : '';
    const meta = normalized.meta && normalized.meta.length
      ? `<div class="dg-card-meta">${normalized.meta.map((m) => `<span class="dg-card-chip">${escHtml(m)}</span>`).join('')}</div>`
      : '';
    const body = normalized.body ? `<div class="dg-card-body">${escHtml(normalized.body).replace(/\n/g, '<br>')}</div>` : '';
    return `<details class="dg-card dg-card-${type}" open><summary class="dg-card-summary"><span class="dg-card-type">${type.toUpperCase()}</span><span class="dg-card-title">${escHtml(normalized.title)}</span></summary><div class="dg-card-content">${subtitle}${meta}${body}</div></details>`;
  }

  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules) ?? ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = String(token.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (!/^(entity|adr|tension|insight)$/.test(lang)) {
      return defaultFence(tokens, idx, options, env, self);
    }
    try {
      const parsed = parseCardBody(token.content || '');
      const fieldCount = Object.keys(parsed.fields || {}).length;
      const onlyId = fieldCount === 1 && Object.prototype.hasOwnProperty.call(parsed.fields, 'id');
      if (onlyId && !parsed.body && !/\n$/.test(String(token.content || ''))) {
        return defaultFence(tokens, idx, options, env, self);
      }
      const normalized = normalizeCard(lang, parsed);
      if (!normalized) return defaultFence(tokens, idx, options, env, self);
      return renderCard(lang, normalized);
    } catch {
      return defaultFence(tokens, idx, options, env, self);
    }
  };
}

function createMd(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  registerCardFencePlugin(md);
  return md;
}

test('T-3.1: entity fence renders an entity card', () => {
  const html = createMd().render('```entity\nid: feature_x\nname: Feature X\nkind: feature\nstatus: active\n\nExplains the feature.\n```');
  assert.match(html, /class="dg-card dg-card-entity"/);
  assert.match(html, /Feature X/);
  assert.match(html, /ID: feature_x/);
  assert.match(html, /Explains the feature\./);
});

test('T-3.2: adr fence renders an adr card', () => {
  const html = createMd().render('```adr\nid: ADR-007\ntitle: Preserve loop\nstatus: accepted\n\nKeep real tool execution.\n```');
  assert.match(html, /class="dg-card dg-card-adr"/);
  assert.match(html, /ADR-007: Preserve loop/);
  assert.match(html, /Status: accepted/);
});

test('T-3.3: tension fence renders a tension card', () => {
  const html = createMd().render('```tension\nid: tension_1\ntitle: Timeout mismatch\nseverity: high\n\nNeeds follow-up.\n```');
  assert.match(html, /class="dg-card dg-card-tension"/);
  assert.match(html, /Timeout mismatch/);
  assert.match(html, /high/);
});

test('T-3.4: insight fence renders an insight card', () => {
  const html = createMd().render('```insight\ntitle: Latent dependency\nconfidence: 0.74\nkind: edge\n\nObserved after scan.\n```');
  assert.match(html, /class="dg-card dg-card-insight"/);
  assert.match(html, /Latent dependency/);
  assert.match(html, /Confidence: 0\.74/);
});

test('T-3.5: unknown fence type falls back to regular code block', () => {
  const html = createMd().render('```unknown\na: b\n```');
  assert.match(html, /<pre><code class="language-unknown">/);
  assert.doesNotMatch(html, /dg-card/);
});

test('T-3.6: rendered cards are collapsible details blocks', () => {
  const html = createMd().render('```entity\nid: feature_x\n```');
  assert.match(html, /<details class="dg-card dg-card-entity" open>/);
  assert.match(html, /<summary class="dg-card-summary">/);
});

test('T-3.7: incomplete streaming-style fence remains a code block until complete', () => {
  const html = createMd().render('```entity\nid: partial_card');
  assert.match(html, /<pre><code class="language-entity">/);
  assert.doesNotMatch(html, /dg-card/);
});

test('Review #8: malformed card body falls back to code block, no crash', () => {
  const html = createMd().render('```adr\n: totally malformed\n: still bad\n```');
  assert.match(html, /<pre><code class="language-adr">/);
  assert.doesNotMatch(html, /dg-card/);
});
