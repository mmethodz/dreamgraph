const fs = require('fs');
const path = require('path');

const file = path.resolve('extensions/vscode/src/chat-panel.ts');
let text = fs.readFileSync(file, 'utf8');

function replaceRegex(regex, replacement, label) {
  if (!regex.test(text)) {
    throw new Error(`Missing block for ${label}`);
  }
  text = text.replace(regex, replacement);
}

replaceRegex(
/    function scheduleVerification\(container\) \{[\s\S]*?    \}\r?\n\r?\n    function applyEntityVerification/,
`    function scheduleVerification(container) {
      if (!container || typeof window.linkifyEntities !== 'function') return;
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => {
        const names = Array.from(container.querySelectorAll('a.entity-link'))
          .map((a) => a.getAttribute('data-entity-name') || a.getAttribute('data-uri') || a.textContent || '')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 100);
        if (names.length === 0) return;
        const requestId = 'verify_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        pendingVerification.set(requestId, container);
        vscode.postMessage({ type: 'verifyEntities', requestId, names });
      }, 80);
    }

    function applyEntityVerification`,
'scheduleVerification'
);

replaceRegex(
/    function applyEntityVerification\(container, results\) \{[\s\S]*?    \}\r?\n\r?\n    function renderAssistantBody/,
`    function applyEntityVerification(container, results) {
      if (!container) return;
      for (const link of container.querySelectorAll('a.entity-link')) {
        const name = (link.getAttribute('data-entity-name') || link.getAttribute('data-uri') || link.textContent || '').trim();
        const status = results?.[name]?.status || 'unverified';
        link.classList.remove('entity-verified', 'entity-latent', 'entity-tension', 'entity-unverified');
        link.classList.add('entity-' + status);
      }
    }

    function schedulePostRenderWork(node, options) {
      if (!node) return;
      const opts = options || {};
      requestAnimationFrame(() => {
        if (typeof window.applyEntityLinks === 'function') {
          window.applyEntityLinks(node);
        }
        if (opts.verify !== false) {
          scheduleVerification(node);
        }
        if (opts.stickToBottom !== false) {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      });
    }

    function renderAssistantBody`,
'applyEntityVerification/schedulePostRenderWork'
);

replaceRegex(
/    function renderAssistantBody\(message\) \{[\s\S]*?    \}\r?\n\r?\n    function createMessageNode/,
`    function renderAssistantBody(message) {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-body';
      const renderMarkdown = window.renderMarkdown || ((s) => escapeHtml(s));
      let html = renderMarkdown(message.content || '');
      if (typeof window.linkifyEntities === 'function') {
        html = window.linkifyEntities(html) || html;
      }
      wrapper.innerHTML = html;
      return wrapper;
    }

    function createMessageNode`,
'renderAssistantBody'
);

replaceRegex(
/    function createMessageNode\(message, actions, roleMeta, contextFooter\) \{[\s\S]*?    function rerenderMessageActions/,
`    function createMessageNode(message, actions, roleMeta, contextFooter, uiState) {
      const bubble = document.createElement('div');
      bubble.className = 'message ' + message.role;
      bubble.dataset.messageId = message.id || '';
      if (roleMeta) bubble.appendChild(createRoleHeader(roleMeta, message.id));

      if (message.role === 'assistant') {
        const state = uiState || {};
        const body = renderAssistantBody(message);
        bubble.appendChild(body);
        const verdict = renderVerdictBanner(state.verdict || null);
        if (verdict) bubble.appendChild(verdict);
        const implicit = renderImplicitEntityNotice(message.implicitEntityNotice);
        if (implicit) bubble.appendChild(implicit);
        const trace = renderToolTrace(state.toolTrace || []);
        if (trace) bubble.appendChild(trace);
        bubble.appendChild(renderProvenance(message, state.toolTrace || []));
        const actionBlock = renderMessageActions(message, actions);
        if (actionBlock) bubble.appendChild(actionBlock);
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
        schedulePostRenderWork(body);
      } else {
        if (roleMeta) {
          const body = document.createElement('div');
          body.className = 'message-text';
          body.textContent = message.content || '';
          bubble.appendChild(body);
        } else {
          bubble.textContent = message.content || '';
        }
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
      }
      return bubble;
    }

    function addMessage(message, actions, roleMeta, contextFooter, uiState) {
      setEmptyStateVisible(false);
      const node = createMessageNode(message, actions, roleMeta, contextFooter, uiState);
      messagesEl.appendChild(node);
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }

    function rerenderMessageActions`,
'create/add message'
);

replaceRegex(
/      streamingBubble\.appendChild\(streamingMarkdownEl\);\r?\n      messagesEl\.appendChild\(streamingBubble\);/,
`      streamingBubble.appendChild(streamingMarkdownEl);
      messagesEl.appendChild(streamingBubble);
      schedulePostRenderWork(streamingMarkdownEl, { verify: false });`,
'startStreaming body'
);

replaceRegex(
/      streamingMarkdownEl\.innerHTML = html;\r?\n      if \(typeof window\.applyEntityLinks === 'function'\) \{\r?\n        window\.applyEntityLinks\(streamingMarkdownEl\);\r?\n      \}\r?\n      messagesEl\.scrollTop = messagesEl\.scrollHeight;/,
`      streamingMarkdownEl.innerHTML = html;
      schedulePostRenderWork(streamingMarkdownEl, { verify: false });`,
'updateStreaming body'
);

replaceRegex(
/          addMessage\(msg\.message, msg\.actions \|\| \[\], msg\.roleMeta, msg\.contextFooter\);/,
`          addMessage(msg.message, msg.actions || [], msg.roleMeta, msg.contextFooter, { toolTrace: [...lastToolTrace], verdict: lastVerdict });`,
'addMessage call'
);

replaceRegex(
/        addMessage\(entry\.message, entry\.actions, entry\.roleMeta, entry\.contextFooter\);/g,
`        addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter, { toolTrace: entry.message.role === 'assistant' ? [...lastToolTrace] : [], verdict: entry.message.role === 'assistant' ? lastVerdict : null });`,
'restoreState call'
);

fs.writeFileSync(file, text, 'utf8');
console.log('patched chat-panel render pipeline');
