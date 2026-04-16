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

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inline the linkifyEntities algorithm so tests are self-contained ──────────
// This mirrors the logic in webview/entity-links.ts exactly.

const ENTITY_SCHEMES = ['feature', 'workflow', 'data-model', 'entity', 'adr', 'tension', 'edge', 'file'];
const ENTITY_URI_RE = /\b(feature|workflow|data-model|entity|adr|tension|edge|file):\/\/[\w.\\/@→#%~_-]+/g;

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatEntityLabel(scheme: string, name: string): string {
  const icons: Record<string, string> = {
    feature: '◆', workflow: '⟳', 'data-model': '⬢', entity: '⬡', adr: '⚖',
    tension: '⚡', edge: '→', file: '📄',
  };
  const icon = icons[scheme] || '⬡';
  let displayName = name.replace(/[_-]/g, ' ');
  try { displayName = decodeURIComponent(displayName); } catch { /* ignore */ }
  return icon + '\u00a0' + displayName;
}

function replaceEntityUris(text: string): string {
  // Split on HTML tags to isolate text nodes — mirrors webview security fix
  const tagParts = text.split(/(<[^>]*>)/);
  for (let t = 0; t < tagParts.length; t++) {
    if (t % 2 !== 0) continue; // odd = HTML tag, skip
    const node = tagParts[t];
    if (!node) continue;
    tagParts[t] = node.replace(ENTITY_URI_RE, (match, scheme) => {
      const name = match.slice(scheme.length + 3);
      const label = formatEntityLabel(scheme, name);
      return `<a class="entity-link" data-type="${escAttr(scheme)}" data-uri="${escAttr(match)}" href="#" title="${escAttr(match)}">${escHtml(label)}</a>`;
    });
  }
  return tagParts.join('');
}

function linkifyOutsidePre(segment: string): string {
  const codeParts = segment.split(/(<code[\s\S]*?<\/code>)/i);
  for (let j = 0; j < codeParts.length; j += 2) {
    if (j % 2 === 0) codeParts[j] = replaceEntityUris(codeParts[j]);
  }
  return codeParts.join('');
}

function linkifyEntities(html: string): string {
  if (!html || typeof html !== 'string') return html;
  const preParts = html.split(/(<pre[\s\S]*?<\/pre>)/i);
  for (let i = 0; i < preParts.length; i += 2) {
    if (i % 2 === 0) preParts[i] = linkifyOutsidePre(preParts[i]);
  }
  return preParts.join('');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('T-2.1: feature:// URIs are linkified', () => {
  const html = '<p>See feature://my_feature for details.</p>';
  const result = linkifyEntities(html);
  assert.match(result, /class="entity-link"/);
  assert.match(result, /data-type="feature"/);
  assert.match(result, /data-uri="feature:\/\/my_feature"/);
});

test('T-2.2: all recognised schemes are linkified', () => {
  const schemes = ['feature', 'workflow', 'data-model', 'entity', 'adr', 'tension', 'edge', 'file'];
  for (const scheme of schemes) {
    const html = `<p>Link: ${scheme}://some-name here.</p>`;
    const result = linkifyEntities(html);
    assert.match(result, new RegExp(`data-type="${scheme}"`), `scheme ${scheme} should be linkified`);
  }
});

test('T-2.3: generated anchor has correct data-type and data-uri', () => {
  const html = '<p>workflow://dream_cycle</p>';
  const result = linkifyEntities(html);
  assert.match(result, /data-type="workflow"/);
  assert.match(result, /data-uri="workflow:\/\/dream_cycle"/);
  assert.match(result, /href="#"/);
  assert.match(result, /class="entity-link"/);
});

test('T-2.4: URIs inside <pre>…</pre> are NOT linkified', () => {
  const html = '<pre><code>feature://do_not_link</code></pre>';
  const result = linkifyEntities(html);
  assert.doesNotMatch(result, /class="entity-link"/);
  assert.match(result, /feature:\/\/do_not_link/); // original text preserved
});

test('T-2.4b: URIs inside inline <code>…</code> are NOT linkified', () => {
  const html = '<p>Use <code>feature://my_feature</code> in prose.</p>';
  const result = linkifyEntities(html);
  assert.doesNotMatch(result, /class="entity-link"/);
  assert.match(result, /feature:\/\/my_feature/);
});

test('T-2.5: URIs inside existing href="" are NOT double-linkified', () => {
  const html = '<a href="feature://existing">label</a>';
  const result = linkifyEntities(html);
  // Should NOT wrap the href value in another anchor
  const anchorCount = (result.match(/class="entity-link"/g) || []).length;
  assert.equal(anchorCount, 0, 'href content should not be linkified');
});

test('T-S1.4: javascript: scheme is NOT linkified', () => {
  const html = '<p>javascript://alert(1)</p>';
  const result = linkifyEntities(html);
  assert.doesNotMatch(result, /class="entity-link"/);
});

test('T-S1.4b: data: scheme is NOT linkified', () => {
  const html = '<p>data://something</p>';
  const result = linkifyEntities(html);
  assert.doesNotMatch(result, /class="entity-link"/);
});

test('T-S1.4c: vscode: scheme is NOT linkified', () => {
  const html = '<p>vscode://extension/something</p>';
  const result = linkifyEntities(html);
  assert.doesNotMatch(result, /class="entity-link"/);
});

test('T-S3.1: data-uri only contains the allowlisted URI, not injected content', () => {
  // Attempt attribute injection via a crafted URI.
  // The URI regex stops at the quote character (not a word char), so "name" is
  // the full URI match. The trailing '" onmouseover="alert(1)' is plain text
  // outside the anchor — it must NOT appear inside any attribute value.
  const html = '<p>feature://name" onmouseover="alert(1)</p>';
  const result = linkifyEntities(html);
  // data-uri must only contain the safe URI
  assert.match(result, /data-uri="feature:\/\/name"/);
  // onmouseover must not appear as an attribute on any tag
  // (it may appear as escaped text content, but NOT as a live attribute)
  const tagMatches = result.match(/<[^>]+>/g) || [];
  for (const tag of tagMatches) {
    assert.doesNotMatch(tag, /onmouseover/, `onmouseover must not appear in tag: ${tag}`);
  }
});

test('T-2: multiple entity links in one paragraph', () => {
  const html = '<p>See feature://feat_a and adr://ADR-007 for context.</p>';
  const result = linkifyEntities(html);
  const count = (result.match(/class="entity-link"/g) || []).length;
  assert.equal(count, 2);
  assert.match(result, /data-type="feature"/);
  assert.match(result, /data-type="adr"/);
});

test('T-2: plain text outside tags is linkified', () => {
  // Even bare text not wrapped in HTML tags should be linkified
  const html = 'tension://some-tension is unresolved.';
  const result = linkifyEntities(html);
  assert.match(result, /class="entity-link"/);
  assert.match(result, /data-type="tension"/);
});
