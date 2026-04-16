"use strict";
/**
 * CSS string constants for the DreamGraph chat webview.
 * Extracted from chat-panel.ts getHtml() so CSS changes don't require
 * touching the panel controller.
 *
 * Add Slice N styles in the clearly labelled sections below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStyles = getStyles;
function getStyles() {
    return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header / model selector ── */
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      flex-shrink: 0;
    }
    .header select {
      appearance: none;
      -webkit-appearance: none;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      padding: 3px 22px 3px 8px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      cursor: pointer;
      outline: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
      background-size: 10px 6px;
      min-width: 0;
      max-width: 50%;
      text-overflow: ellipsis;
    }
    .header select:hover { border-color: var(--vscode-focusBorder); }
    .header select:focus { border-color: var(--vscode-focusBorder); }

    /* ── Messages area ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      word-break: break-word;
      line-height: 1.45;
      font-size: var(--vscode-font-size);
      max-width: 100%;
    }
    /* User bubbles stay plain text — no markdown rendering */
    .message.user {
      white-space: pre-wrap;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
    }
    .message.assistant {
      background: var(--vscode-editorWidget-background);
      border-left: 3px solid var(--vscode-charts-green, #89d185);
    }
    .message.system, .message.error-msg {
      white-space: pre-wrap;
      background: var(--vscode-inputValidation-warningBackground, var(--vscode-inputValidation-errorBackground));
      border-left: 3px solid var(--vscode-errorForeground);
      font-size: 12px;
      opacity: 0.9;
    }

    /* ── Thinking indicator ── */
    #thinking-indicator {
      padding: 8px 14px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-style: italic;
      animation: thinking-pulse 1.5s ease-in-out infinite;
    }
    @keyframes thinking-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* ── Attachments bar ── */
    #attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 10px;
      flex-shrink: 0;
    }
    #attachments:empty { display: none; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 1.4;
    }
    .attachment-chip .chip-icon { font-size: 13px; opacity: 0.7; }
    .attachment-remove {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0 0 0 2px;
      font-size: 14px;
      line-height: 1;
      opacity: 0.6;
    }
    .attachment-remove:hover { opacity: 1; }

    /* ── Composer ── */
    #composer {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      flex-shrink: 0;
    }
    #prompt {
      flex: 1;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 7px 10px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
      resize: none;
      overflow-y: auto;
      min-height: 34px;
      max-height: 200px;
      line-height: 1.4;
    }
    #prompt:focus { border-color: var(--vscode-focusBorder); }
    #prompt::placeholder { color: var(--vscode-input-placeholderForeground); }

    /* ── Buttons (shared) ── */
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.1s;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31)); }
    .icon-btn:active { background: var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.45)); }
    .icon-btn:disabled { opacity: 0.35; cursor: default; pointer-events: none; }
    .icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .icon-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .icon-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .icon-btn.danger { color: var(--vscode-errorForeground); }
    .icon-btn.danger:hover { background: rgba(255,85,85,0.15); }

    /* ── Paste preview ── */
    .paste-preview {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin: 0 10px 4px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .paste-preview img {
      max-height: 48px;
      max-width: 80px;
      border-radius: 4px;
      object-fit: cover;
    }

    /* ── Slice 1: Markdown body ── */
    .markdown-body {
      line-height: 1.6;
    }
    .markdown-body p {
      margin: 0 0 0.6em 0;
    }
    .markdown-body p:last-child {
      margin-bottom: 0;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3,
    .markdown-body h4, .markdown-body h5, .markdown-body h6 {
      font-weight: 600;
      margin: 0.8em 0 0.4em 0;
      line-height: 1.3;
    }
    .markdown-body h1 { font-size: 1.3em; }
    .markdown-body h2 { font-size: 1.15em; }
    .markdown-body h3 { font-size: 1.05em; }
    .markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 1em; }
    .markdown-body strong { font-weight: 600; }
    .markdown-body em { font-style: italic; }
    .markdown-body code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      padding: 1px 5px;
      border-radius: 3px;
    }
    .markdown-body pre {
      position: relative;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      border-radius: 6px;
      padding: 12px 12px 12px 12px;
      margin: 0.6em 0;
      overflow-x: auto;
    }
    .markdown-body pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 0.88em;
      display: block;
      white-space: pre;
    }
    .markdown-body ul, .markdown-body ol {
      padding-left: 1.4em;
      margin: 0.4em 0 0.6em 0;
    }
    .markdown-body li {
      margin: 0.15em 0;
    }
    .markdown-body blockquote {
      border-left: 3px solid var(--vscode-textBlockQuote-border, #888);
      margin: 0.5em 0;
      padding: 0.3em 0.8em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textBlockQuote-background);
    }
    .markdown-body hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 0.8em 0;
    }
    .markdown-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.6em 0;
      font-size: 0.9em;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--vscode-panel-border);
      padding: 5px 10px;
      text-align: left;
    }
    .markdown-body th {
      background: var(--vscode-textCodeBlock-background);
      font-weight: 600;
    }
    .markdown-body a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .markdown-body a:hover {
      text-decoration: underline;
    }
    .markdown-body img {
      max-width: 100%;
    }

    /* ── Slice 1: Copy button ── */
    .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--vscode-button-secondaryBackground, rgba(90,93,94,0.4));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: none;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .markdown-body pre:hover .copy-btn { opacity: 1; }
    .copy-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(90,93,94,0.6));
    }
  `;
}
//# sourceMappingURL=styles.js.map