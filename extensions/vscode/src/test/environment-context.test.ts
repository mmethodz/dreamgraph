import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildEnvironmentContextSnapshot,
  renderEnvironmentContextBlock,
  selectEnvironmentContextForFile,
} from '../environment-context';

async function withTempWorkspace(
  setup: (root: string) => Promise<void> | void,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-envctx-'));
  try {
    await setup(root);
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf8');
}

test('environment context selects the most specific matching scope for a file', async () => {
  await withTempWorkspace(
    (root) => {
      writeJson(path.join(root, 'package.json'), {
        type: 'module',
        packageManager: 'npm@10.0.0',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          express: '^5.1.0',
          zod: '^4.1.5',
          sqlite3: '^5.1.7',
          cheerio: '^1.2.0',
          turndown: '^7.2.4',
        },
      });
      writeJson(path.join(root, 'extensions', 'vscode', 'package.json'), {
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          'markdown-it': '^14.1.1',
          dompurify: '^3.4.0',
        },
      });
      fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src', 'cognitive'), { recursive: true });
      fs.mkdirSync(path.join(root, 'extensions', 'vscode', 'src'), { recursive: true });
    },
    async (root) => {
      const snapshot = await buildEnvironmentContextSnapshot(root);
      assert.ok(snapshot);

      const serverEntries = selectEnvironmentContextForFile(snapshot, 'src/server/server.ts');
      assert.equal(serverEntries.length, 2);
      assert.equal(serverEntries[0]?.scope, 'src/server/');
      assert.equal(serverEntries[1]?.scope, 'src/');
      assert.match(serverEntries[0]?.role ?? '', /daemon bootstrap/i);
      assert.deepStrictEqual(serverEntries[0]?.keyDependencies, ['@modelcontextprotocol/sdk', 'express']);

      const extensionEntries = selectEnvironmentContextForFile(snapshot, 'extensions/vscode/src/chat-panel.ts');
      assert.equal(extensionEntries.length, 1);
      assert.equal(extensionEntries[0]?.scope, 'extensions/vscode/src/');
      assert.match(extensionEntries[0]?.framework ?? '', /VS Code Extension API/);
    },
  );
});

test('environment context rendering is stable and bounded for a given file', async () => {
  await withTempWorkspace(
    (root) => {
      writeJson(path.join(root, 'package.json'), {
        type: 'module',
        packageManager: 'pnpm@9.0.0',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          express: '^5.1.0',
          sqlite3: '^5.1.7',
          zod: '^4.1.5',
          pino: '^9.9.5',
          commander: '^14.0.1',
          chalk: '^5.6.2',
          cheerio: '^1.2.0',
          turndown: '^7.2.4',
          jsdom: '^27.0.0',
          marked: '^16.3.0',
        },
      });
      fs.mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    },
    async (root) => {
      const snapshot = await buildEnvironmentContextSnapshot(root);
      assert.ok(snapshot);

      const first = renderEnvironmentContextBlock(snapshot, 'src/tools/web-senses.ts');
      const second = renderEnvironmentContextBlock(snapshot, 'src/tools/web-senses.ts');

      assert.ok(first);
      assert.equal(first, second);
      assert.match(first ?? '', /^## Environment Context/m);
      assert.match(first ?? '', /Package manager: pnpm@9\.0\.0/);
      assert.match(first ?? '', /Scope `src\/tools\/`/);
      assert.match(first ?? '', /Scope `src\/`/);
      assert.doesNotMatch(first ?? '', /Scope `src\/cli\/`/);
      assert.ok((first ?? '').length < 1200, `expected compact environment block, got ${(first ?? '').length} chars`);
      assert.ok(Math.ceil((first ?? '').length / 4) < 320, 'expected environment block to stay under ~320 tokens');
    },
  );
});

test('environment context excludes non-curated dependency noise', async () => {
  await withTempWorkspace(
    (root) => {
      writeJson(path.join(root, 'package.json'), {
        type: 'module',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.27.1',
          cheerio: '^1.2.0',
          turndown: '^7.2.4',
          leftpad: '^1.0.0',
          lodash: '^4.17.21',
          axios: '^1.12.2',
          express: '^5.1.0',
        },
      });
      fs.mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    },
    async (root) => {
      const snapshot = await buildEnvironmentContextSnapshot(root);
      assert.ok(snapshot);

      const block = renderEnvironmentContextBlock(snapshot, 'src/tools/web-senses.ts');
      assert.ok(block);
      assert.match(block ?? '', /Key dependencies: @modelcontextprotocol\/sdk, cheerio, turndown/);
      assert.doesNotMatch(block ?? '', /leftpad/);
      assert.doesNotMatch(block ?? '', /lodash/);
      assert.doesNotMatch(block ?? '', /axios/);
    },
  );
});
