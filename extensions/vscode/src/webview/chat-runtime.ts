export function getChatRuntimeScript(): string {
  return String.raw`
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  if (!app) {
    return;
  }

  app.innerHTML = [
    '<div class="dg-shell">',
    '  <div id="dg-autonomy-status" class="dg-autonomy-status-host"></div>',
    '  <div id="dg-session-meta" class="dg-session-meta-host"></div>',
    '  <div id="dg-messages" class="dg-messages"></div>',
    '  <div class="dg-composer">',
    '    <textarea id="dg-input" class="dg-input" rows="4" placeholder="Ask DreamGraph Architect..."></textarea>',
    '    <div class="dg-composer-actions">',
    '      <button id="dg-send" class="dg-send">Send</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  const messagesEl = document.getElementById('dg-messages');
  const inputEl = document.getElementById('dg-input');
  const sendEl = document.getElementById('dg-send');
  const autonomyEl = document.getElementById('dg-autonomy-status');
  const sessionMetaEl = document.getElementById('dg-session-meta');
  const state = {
    messages: [],
    actionsByMessageId: new Map(),
    autonomyHtml: '',
    sessionMetaHtml: '',
    streaming: false,
    streamBuffer: '',
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(text) {
    const renderer = globalThis.__DG_RENDER_MARKDOWN__;
    if (typeof renderer === 'function') {
      return renderer(text);
    }
    return '<pre>' + escapeHtml(text) + '</pre>';
  }

  function renderActions(messageId) {
    const actions = state.actionsByMessageId.get(messageId) || [];
    if (!actions.length) {
      return '';
    }
    const buttons = actions.map((action) => {
      const kindClass = action.kind === 'primary' ? 'primary' : 'secondary';
      return '<button class="dg-rec-action ' + kindClass + '" data-message-id="' + escapeHtml(messageId) + '" data-action-id="' + escapeHtml(action.id) + '">' + escapeHtml(action.label) + '</button>';
    }).join('');
    return '<div class="dg-rec-actions"><div class="dg-rec-actions-label">Recommended next steps</div><div class="dg-rec-actions-buttons">' + buttons + '</div></div>';
  }

  function renderMessages() {
    if (!messagesEl) {
      return;
    }
    const html = state.messages.map((message) => {
      const footer = message.contextFooter ? '<div class="dg-message-footer">' + escapeHtml(message.contextFooter) + '</div>' : '';
      return [
        '<article class="dg-message ' + escapeHtml(message.role) + '">',
        '  <div class="dg-message-role">' + escapeHtml(message.role) + '</div>',
        '  <div class="dg-message-body">' + renderMarkdown(message.content || '') + '</div>',
        renderActions(message.id),
        footer,
        '</article>'
      ].join('');
    }).join('');

    const streaming = state.streaming
      ? '<article class="dg-message assistant streaming"><div class="dg-message-role">assistant</div><div class="dg-message-body">' + renderMarkdown(state.streamBuffer) + '</div></article>'
      : '';

    messagesEl.innerHTML = html + streaming;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setAutonomyStatus(html) {
    state.autonomyHtml = html || '';
    if (autonomyEl) {
      autonomyEl.innerHTML = state.autonomyHtml;
    }
  }

  function setSessionMeta(html) {
    state.sessionMetaHtml = html || '';
    if (sessionMetaEl) {
      sessionMetaEl.innerHTML = state.sessionMetaHtml;
    }
  }

  function upsertMessage(message, actions, contextFooter) {
    const next = {
      ...message,
      contextFooter: contextFooter ?? message.contextFooter ?? '',
    };
    state.messages.push(next);
    if (message.id && Array.isArray(actions) && actions.length) {
      state.actionsByMessageId.set(message.id, actions);
    }
    renderMessages();
  }

  sendEl?.addEventListener('click', () => {
    const text = inputEl?.value?.trim() || '';
    if (!text) {
      return;
    }
    vscode.postMessage({ type: 'send', text });
    if (inputEl) {
      inputEl.value = '';
    }
  });

  inputEl?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      sendEl?.click();
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest('button[data-message-id][data-action-id]');
    if (!button) {
      return;
    }
    const messageId = button.getAttribute('data-message-id');
    const actionId = button.getAttribute('data-action-id');
    if (!messageId || !actionId) {
      return;
    }
    vscode.postMessage({ type: 'runMessageAction', messageId, actionId });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message?.type) {
      case 'state':
        state.messages = Array.isArray(message.state?.messages) ? message.state.messages : [];
        renderMessages();
        break;
      case 'addMessage':
        upsertMessage(message.message, message.actions, message.contextFooter);
        break;
      case 'stream-start':
        state.streaming = true;
        state.streamBuffer = '';
        renderMessages();
        break;
      case 'stream-chunk':
        state.streamBuffer += message.chunk || '';
        renderMessages();
        break;
      case 'stream-end':
        state.streaming = false;
        state.streamBuffer = '';
        renderMessages();
        break;
      case 'autonomyStatus':
        setAutonomyStatus(message.html);
        break;
      case 'sessionAutonomyMeta':
        setSessionMeta(message.html);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
}
