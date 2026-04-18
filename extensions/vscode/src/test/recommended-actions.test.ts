import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecommendedActionsHtml } from '../webview/recommended-actions.js';

test('renders action buttons and do all when eligible', () => {
  const html = renderRecommendedActionsHtml({
    messageId: 'm1',
    doAllEligible: true,
    actions: [
      { id: 'a1', label: 'Continue with host loop', kind: 'primary' },
      { id: 'a2', label: 'Add clickable controls', kind: 'secondary' },
    ],
  });

  assert.match(html, /Recommended next steps/);
  assert.match(html, /data-action-id="a1"/);
  assert.match(html, /data-action-id="a2"/);
  assert.match(html, /data-action-id="__do_all__"/);
});

test('renders nothing when there are no actions', () => {
  const html = renderRecommendedActionsHtml({ messageId: 'm1', doAllEligible: false, actions: [] });
  assert.equal(html, '');
});
