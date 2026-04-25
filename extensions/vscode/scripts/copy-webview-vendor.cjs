#!/usr/bin/env node
/**
 * Copies third-party browser builds required by the chat-panel webview
 * (markdown-it, DOMPurify) into dist/vendor/ so they ship inside the VSIX.
 *
 * Required because the VSIX excludes node_modules/** to stay slim, but the
 * chat panel reads these files at runtime to inject them as inline scripts
 * (CSP forbids loading them from a CDN).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

const assets = [
  { from: 'node_modules/markdown-it/dist/markdown-it.min.js', to: 'markdown-it.min.js' },
  { from: 'node_modules/dompurify/dist/purify.min.js', to: 'purify.min.js' },
];

for (const a of assets) {
  const src = path.join(root, a.from);
  const dst = path.join(outDir, a.to);
  if (!fs.existsSync(src)) {
    console.error(`[copy-webview-vendor] missing ${a.from} — run npm install first`);
    process.exit(1);
  }
  fs.copyFileSync(src, dst);
  const bytes = fs.statSync(dst).size;
  console.log(`[copy-webview-vendor] ${a.to} (${bytes} bytes)`);
}
