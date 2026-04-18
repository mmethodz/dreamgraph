import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAutonomyStatusHtml } from '../webview/autonomy-status.js';
import { deriveAutonomyStatusView } from '../autonomy.js';

test('renders visible counters when counting active', () => {
  const html = renderAutonomyStatusHtml(deriveAutonomyStatusView({
    mode: 'autonomous',
    completedAutoPasses: 2,
    remainingAutoPasses: 2,
    totalAuthorizedPasses: 4,
  }));
  assert.ok(html.includes('Mode: autonomous'));
  assert.ok(html.includes('Passes: 2/4'));
  assert.ok(html.includes('Remaining: 2'));
});

test('renders inactive state when no counting active', () => {
  const html = renderAutonomyStatusHtml(deriveAutonomyStatusView({
    mode: 'cautious',
    completedAutoPasses: 0,
    remainingAutoPasses: 0,
  }));
  assert.ok(html.includes('Pass counting inactive'));
});
