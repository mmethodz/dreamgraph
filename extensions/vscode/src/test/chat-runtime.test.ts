import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatRuntimeScript } from '../webview/chat-runtime.js';

test('chat runtime includes persistent autonomy status host and action dispatch', () => {
  const script = getChatRuntimeScript();
  assert.match(script, /id="dg-autonomy-status"/);
  assert.match(script, /id="dg-session-meta"/);
  assert.match(script, /type: 'autonomyStatus'/);
  assert.match(script, /type: 'sessionAutonomyMeta'/);
  assert.match(script, /type: 'runMessageAction'/);
});
