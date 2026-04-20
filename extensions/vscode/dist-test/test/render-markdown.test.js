"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const markdown_it_1 = __importDefault(require("markdown-it"));
const md = new markdown_it_1.default({ html: false, linkify: true, typographer: false });
(0, node_test_1.default)('T-1.1: bold, italic, inline code', () => {
    const html = md.render('**bold** *italic* `code`');
    strict_1.default.match(html, /<strong>bold<\/strong>/);
    strict_1.default.match(html, /<em>italic<\/em>/);
    strict_1.default.match(html, /<code>code<\/code>/);
});
(0, node_test_1.default)('T-1.2: fenced code block with language class', () => {
    const html = md.render('```ts\nconst x = 1;\n```');
    strict_1.default.match(html, /<pre><code class="language-ts">/);
});
(0, node_test_1.default)('T-1.3: fenced code block without language still produces pre>code', () => {
    const html = md.render('```\nplain block\n```');
    strict_1.default.match(html, /<pre><code>/);
});
(0, node_test_1.default)('T-1.4: headings h2 and h3', () => {
    const html = md.render('## Heading 2\n### Heading 3');
    strict_1.default.match(html, /<h2>Heading 2<\/h2>/);
    strict_1.default.match(html, /<h3>Heading 3<\/h3>/);
});
(0, node_test_1.default)('T-1.5: tables produce table/th/td', () => {
    const html = md.render('| A | B |\n|---|---|\n| 1 | 2 |');
    strict_1.default.match(html, /<table>/);
    strict_1.default.match(html, /<th>A<\/th>/);
    strict_1.default.match(html, /<td>1<\/td>/);
});
(0, node_test_1.default)('T-1.6: unordered and ordered lists', () => {
    const html = md.render('- a\n- b\n\n1. c\n2. d');
    strict_1.default.match(html, /<ul>/);
    strict_1.default.match(html, /<ol>/);
    strict_1.default.match(html, /<li>/);
});
(0, node_test_1.default)('T-1.7: partial markdown (incomplete bold) does not produce unclosed tag', () => {
    const html = md.render('**bol');
    strict_1.default.doesNotMatch(html, /<strong>[^<]*$/);
});
(0, node_test_1.default)('T-1.9: external links get rendered as <a href>', () => {
    const html = md.render('[click](https://example.com)');
    strict_1.default.match(html, /<a href="https:\/\/example\.com"/);
});
(0, node_test_1.default)('T-1.8: raw script tag is escaped, not passed through', () => {
    const html = md.render('<script>alert("xss")</script>');
    strict_1.default.doesNotMatch(html, /<script/i);
});
(0, node_test_1.default)('T-1.8b: javascript: URI in link is not rendered as active href', () => {
    const html = md.render('[click](javascript:alert(1))');
    strict_1.default.doesNotMatch(html, /href="javascript:/);
});
(0, node_test_1.default)('T-1.8c: raw img tag is escaped as text when html:false is used', () => {
    const html = md.render('<img src=x onerror="alert(1)">');
    strict_1.default.match(html, /&lt;img/);
    strict_1.default.doesNotMatch(html, /<img/);
});
(0, node_test_1.default)('T-S3.4: rendered output contains no active <script> tags', () => {
    const inputs = [
        '# heading\n**bold** `code`',
        '```js\nconsole.log("hi")\n```',
        '| col |\n|---|\n| val |',
    ];
    for (const input of inputs) {
        const html = md.render(input);
        strict_1.default.doesNotMatch(html, /<script/i, `Script tag found in output for input: ${input.slice(0, 40)}`);
    }
});
//# sourceMappingURL=render-markdown.test.js.map