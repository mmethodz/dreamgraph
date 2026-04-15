const fs = require('fs');

const targets = [
  { file: 'src/tools/api-surface.ts', patterns: [/replace\s*\(.*script/i, /<\\\/script/i, /<script/i, /sanitize/i] },
  { file: 'src/cli/commands/attach.ts', patterns: [/process\.env/, /console\.\w+.*query/, /console\.\w+.*env/i] },
  { file: 'src/cli/commands/status.ts', patterns: [/process\.env/, /console\.\w+.*query/, /console\.\w+.*env/i] },
  { file: 'src/utils/logger.ts', patterns: [/process\.env/, /console\.\w+.*env/i] },
];

for (const { file, patterns } of targets) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    if (patterns.some(p => p.test(line))) {
      process.stdout.write(`${file}:${i + 1}: ${line.trimEnd()}\n`);
    }
  });
}
