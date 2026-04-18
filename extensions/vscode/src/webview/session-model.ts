export interface SessionActionState {
  selectedActionId?: string;
  selectedActionIds?: string[];
  sourceMessageId?: string;
  mode: 'idle' | 'selected' | 'running' | 'stopped';
  note?: string;
}

export interface SessionAutonomyModel {
  statusHtml: string;
  lastUpdatedAt?: string;
  actionState: SessionActionState;
}

export function createSessionAutonomyModel(): SessionAutonomyModel {
  return {
    statusHtml: '',
    actionState: {
      mode: 'idle',
    },
  };
}

export function withAutonomyStatus(model: SessionAutonomyModel, statusHtml: string): SessionAutonomyModel {
  return {
    ...model,
    statusHtml,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function withSelectedAction(
  model: SessionAutonomyModel,
  sourceMessageId: string,
  selectedActionIds: string[],
  note?: string,
): SessionAutonomyModel {
  return {
    ...model,
    actionState: {
      mode: 'selected',
      sourceMessageId,
      selectedActionId: selectedActionIds[0],
      selectedActionIds,
      note,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function withRunningAction(model: SessionAutonomyModel, note?: string): SessionAutonomyModel {
  return {
    ...model,
    actionState: {
      ...model.actionState,
      mode: 'running',
      note,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function withStoppedAction(model: SessionAutonomyModel, note?: string): SessionAutonomyModel {
  return {
    ...model,
    actionState: {
      ...model.actionState,
      mode: 'stopped',
      note,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function renderSessionAutonomyMeta(model: SessionAutonomyModel): string {
  const state = model.actionState;
  if (state.mode === 'idle') {
    return '';
  }
  const note = state.note ? `<span class="dg-session-note">${escapeHtml(state.note)}</span>` : '';
  if (state.mode === 'selected') {
    return `<div class="dg-session-meta"><span class="dg-session-badge">Action selected</span>${note}</div>`;
  }
  if (state.mode === 'running') {
    return `<div class="dg-session-meta"><span class="dg-session-badge">Autonomy running</span>${note}</div>`;
  }
  return `<div class="dg-session-meta"><span class="dg-session-badge">Autonomy stopped</span>${note}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
