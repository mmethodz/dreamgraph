import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMemory } from '../chat-memory';

class FakeGlobalState {
  private readonly data = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (typeof value === 'undefined') {
      this.data.delete(key);
      return;
    }
    this.data.set(key, value);
  }
}

test('ChatMemory persists messages per instance', async () => {
  const context = { globalState: new FakeGlobalState() } as any;
  const memory = new ChatMemory(context);

  await memory.save('instance-a', [
    { role: 'user', content: 'hello', timestamp: '2026-04-10T00:00:00.000Z' },
  ]);
  await memory.save('instance-b', [
    { role: 'assistant', content: 'world', timestamp: '2026-04-10T00:00:01.000Z' },
  ]);

  assert.deepStrictEqual(await memory.load('instance-a'), [
    { role: 'user', content: 'hello', timestamp: '2026-04-10T00:00:00.000Z' },
  ]);
  assert.deepStrictEqual(await memory.load('instance-b'), [
    { role: 'assistant', content: 'world', timestamp: '2026-04-10T00:00:01.000Z' },
  ]);
});

test('ChatMemory clears a single instance history', async () => {
  const context = { globalState: new FakeGlobalState() } as any;
  const memory = new ChatMemory(context);

  await memory.save('instance-a', [
    { role: 'user', content: 'keep?', timestamp: '2026-04-10T00:00:00.000Z' },
  ]);

  await memory.clear('instance-a');

  assert.deepStrictEqual(await memory.load('instance-a'), []);
});
