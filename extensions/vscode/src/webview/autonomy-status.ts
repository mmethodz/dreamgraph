import type { AutonomyStatusView } from '../autonomy.js';

export function renderAutonomyStatusHtml(status: AutonomyStatusView): string {
  const counter = status.countingActive
    ? `<span class="dg-autonomy-counter">Passes: ${status.completed}/${status.totalAuthorized ?? status.completed + status.remaining} · Remaining: ${status.remaining}</span>`
    : '<span class="dg-autonomy-counter">Pass counting inactive</span>';
  return `<div class="dg-autonomy-status" data-mode="${escapeHtml(status.mode)}"><span class="dg-autonomy-mode">Mode: ${escapeHtml(status.mode)}</span>${counter}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
