const fs = require('fs');

// Broad search for all CodeQL-flagged patterns across all source files
const src = fs.readFileSync('src/tools/api-surface.ts', 'utf-8').split('\n');
src.forEach((line, i) => {
  const t = line.trim();
  // incomplete sanitization: replace on multi-char sequences involving < or >
  if (t.includes('.replace(') && (t.includes('<') || t.includes('>'))) {
    process.stdout.write('api-surface.ts:' + (i + 1) + ': ' + t + '\n');
  }
  // bad tag filter: regex containing script or html tags
  if (t.includes('RegExp') || (t.includes('/') && t.toLowerCase().includes('script'))) {
    process.stdout.write('api-surface.ts:' + (i + 1) + ': ' + t + '\n');
  }
});
