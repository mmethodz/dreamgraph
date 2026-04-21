#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const architecturePath = path.join(workspaceRoot, 'docs', 'architecture.md');
const roots = ['src', 'extensions/vscode/src', 'scripts'];
const startMarker = '```text';
const endMarker = '```';

function listFiles(root) {
  const absRoot = path.join(workspaceRoot, root);
  if (!fs.existsSync(absRoot)) return [];

  const result = [`${root}/`];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        result.push(`  ${relPath}`);
      }
    }
  }

  walk(absRoot);
  return result;
}

function buildTreeBlock() {
  return roots.flatMap(listFiles).join('\n');
}

function updateArchitectureDoc() {
  const content = fs.readFileSync(architecturePath, 'utf8');
  const sourceLayoutHeader = '## Source Layout';
  const sourceLayoutIndex = content.indexOf(sourceLayoutHeader);
  if (sourceLayoutIndex === -1) {
    throw new Error('Could not find "## Source Layout" section in docs/architecture.md');
  }

  const blockStart = content.indexOf(startMarker, sourceLayoutIndex);
  if (blockStart === -1) {
    throw new Error('Could not find opening code fence for source layout block');
  }

  const blockEnd = content.indexOf(endMarker, blockStart + startMarker.length);
  if (blockEnd === -1) {
    throw new Error('Could not find closing code fence for source layout block');
  }

  const replacement = `${startMarker}\n${buildTreeBlock()}\n${endMarker}`;
  const updated = `${content.slice(0, blockStart)}${replacement}${content.slice(blockEnd + endMarker.length)}`;
  fs.writeFileSync(architecturePath, updated, 'utf8');
}

updateArchitectureDoc();
console.log('Updated docs/architecture.md source tree section.');
