/**
 * Slice 1 unit tests — Markdown render pipeline.
 *
 * Framework: node:test + node:assert/strict
 * Environment: plain Node — no VS Code host, no DOM, no linkedom
 *
 * Tests validate markdown-it structural output with html:false.
 * DOMPurify sanitization is NOT tested here (requires a DOM).
 * DOMPurify behaviour is verified via manual smoke tests SM-1..SM-7.
 *
 * Run: node --test dist/test/render-markdown.test.js
 * (after tsc builds the dist/ output)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

test('T-1.1: bold, italic, inline code', () => {
  const html = md.render('**bold** *italic* `code`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test('T-1.2: fenced code block with language class', () => {
  const html = md.render('```ts\nconst x = 1;\n```');
  assert.match(html, /<pre><code class="language-ts">/);
});

test('T-1.3: fenced code block without language still produces pre>code', () => {
  const html = md.render('```\nplain block\n```');
  assert.match(html, /<pre><code>/);
});

test('T-1.4: headings h2 and h3', () => {
  const html = md.render('## Heading 2\n### Heading 3');
  assert.match(html, /<h2>Heading 2<\/h2>/);
  assert.match(html, /<h3>Heading 3<\/h3>/);
});

test('T-1.5: tables produce table/th/td', () => {
  const html = md.render('| A | B |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('T-1.6: unordered and ordered lists', () => {
  const html = md.render('- a\n- b\n\n1. c\n2. d');
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>/);
});

test('T-1.7: partial markdown (incomplete bold) does not produce unclosed tag', () => {
  const html = md.render('**bol');
  assert.doesNotMatch(html, /<strong>[^<]*$/);
});

test('T-1.9: external links get rendered as <a href>', () => {
  const html = md.render('[click](https://example.com)');
  assert.match(html, /<a href="https:\/\/example\.com"/);
});

test('T-1.8: raw script tag is escaped, not passed through', () => {
  const html = md.render('<script>alert("xss")</script>');
  assert.doesNotMatch(html, /<script/i);
});

test('T-1.8b: javascript: URI in link is not rendered as active href', () => {
  const html = md.render('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript:/);
});

test('T-1.8c: raw img tag is escaped as text when html:false is used', () => {
  const html = md.render('<img src=x onerror="alert(1)">');
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});

test('T-S3.4: rendered output contains no active <script> tags', () => {
  const inputs = [
    '# heading\n**bold** `code`',
    '```js\nconsole.log("hi")\n```',
    '| col |\n|---|\n| val |',
  ];

  for (const input of inputs) {
    const html = md.render(input);
    assert.doesNotMatch(html, /<script/i, `Script tag found in output for input: ${input.slice(0, 40)}`);
  }
});
