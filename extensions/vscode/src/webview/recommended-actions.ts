export interface RecommendedActionViewModel {
  id: string;
  label: string;
  rationale?: string;
  kind?: 'primary' | 'secondary';
}

export interface RecommendedActionsEnvelope {
  messageId: string;
  actions: RecommendedActionViewModel[];
  doAllEligible: boolean;
}

export function renderRecommendedActionsHtml(envelope: RecommendedActionsEnvelope): string {
  if (!envelope.actions.length) return '';
  const buttons = envelope.actions.map((action) =>
    `<button class="dg-rec-action ${action.kind === 'primary' ? 'primary' : 'secondary'}" data-message-id="${escapeHtml(envelope.messageId)}" data-action-id="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
  ).join('');
  const doAll = envelope.doAllEligible
    ? `<button class="dg-rec-action secondary" data-message-id="${escapeHtml(envelope.messageId)}" data-action-id="__do_all__">Do all</button>`
    : '';
  return `<div class="dg-rec-actions"><div class="dg-rec-actions-label">Recommended next steps</div><div class="dg-rec-actions-buttons">${buttons}${doAll}</div></div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
