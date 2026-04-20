/**
 * CSS string constants for the DreamGraph chat webview.
 * Extracted from chat-panel.ts getHtml() so CSS changes don't require
 * touching the panel controller.
 *
 * Add Slice N styles in the clearly labelled sections below.
 */

export function getStyles(): string {
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
      flex: 1 1 0;
      min-width: 0;
      text-overflow: ellipsis;
    }
    .header select:hover { border-color: var(--vscode-focusBorder); }
    .header select:focus { border-color: var(--vscode-focusBorder); }
    .header #set-api-key-btn { margin-left: auto; }

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
    .message-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .message-role-title {
      font-size: 0.82em;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .message-role-subtitle {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      opacity: 0.85;
    }
    .message-actions-hover {
      display: inline-flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    .message:hover .message-actions-hover { opacity: 1; }
    .message-mini-btn {
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.75em;
      cursor: pointer;
    }
    .message-mini-btn:hover {
      color: var(--vscode-foreground);
      border-color: var(--vscode-focusBorder);
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

    /* ── Slice 2: Entity links ── */
    a.entity-link {
      color: var(--vscode-textLink-foreground, #4daafc);
      text-decoration: none;
      border-bottom: 1px dotted var(--vscode-textLink-foreground, #4daafc);
      cursor: pointer;
      font-size: 0.92em;
      white-space: nowrap;
    }
    a.entity-link:hover {
      color: var(--vscode-textLink-activeForeground, #60b0ff);
      border-bottom-style: solid;
      text-decoration: none;
    }
    a.entity-link.file-link {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.88em;
    }

    /* ── Slice 2: Empty state ── */
    #empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex: 1;
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    #empty-state .empty-logo {
      font-size: 2.4em;
      line-height: 1;
      opacity: 0.7;
    }
    #empty-state h2 {
      font-size: 0.95em;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin: 0;
    }
    #empty-state p {
      font-size: 0.82em;
      margin: 0;
      max-width: 220px;
      line-height: 1.5;
    }
    .example-prompts {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      max-width: 260px;
    }
    .example-prompt-btn {
      background: var(--vscode-button-secondaryBackground, rgba(90,93,94,0.2));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.82em;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      text-align: left;
      line-height: 1.4;
      transition: background 0.12s;
    }
    .example-prompt-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(90,93,94,0.35));
    }

    /* ── Slice 2: Thinking indicator overhaul ── */
    #thinking-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      font-style: italic;
    }
    .thinking-dots {
      display: inline-flex;
      gap: 3px;
      align-items: center;
    }
    .thinking-dots span {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      animation: thinking-pulse 1.2s ease-in-out infinite;
      opacity: 0.3;
    }
    .thinking-dots span:nth-child(1) { animation-delay: 0s; }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes thinking-pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(1); }
      40% { opacity: 1; transform: scale(1.2); }
    }
    /* Tool progress rows inside thinking indicator */
    #thinking-indicator .tool-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-style: normal;
      font-size: 0.9em;
      color: var(--vscode-foreground);
      opacity: 0.8;
    }
    #thinking-indicator .tool-name {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.88em;
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
    }

    /* ── Slice 3: Structured cards ── */
    .dg-card {
      margin: 0.7em 0;
      border: 1px solid var(--vscode-panel-border);
      border-left-width: 4px;
      border-radius: 8px;
      background: var(--vscode-editorWidget-background);
      overflow: hidden;
    }
    .dg-card-entity { border-left-color: var(--vscode-charts-blue, #3794ff); }
    .dg-card-adr { border-left-color: var(--vscode-charts-orange, #d18616); }
    .dg-card-tension { border-left-color: var(--vscode-errorForeground, #f14c4c); }
    .dg-card-insight { border-left-color: var(--vscode-charts-purple, #b180d7); }
    .dg-card-summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      font-weight: 600;
    }
    .dg-card-summary::-webkit-details-marker { display: none; }
    .dg-card-type {
      font-size: 0.72em;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 999px;
      padding: 2px 7px;
      flex-shrink: 0;
    }
    .dg-card-title {
      min-width: 0;
      line-height: 1.35;
    }
    .dg-card-content {
      padding: 0 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .dg-card-subtitle {
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
    }
    .dg-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dg-card-chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 0.8em;
      background: var(--vscode-button-secondaryBackground, rgba(90,93,94,0.2));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }
    .dg-card-body {
      white-space: normal;
      line-height: 1.5;
    }

    /* ── Structured JSON envelope card ── */
    .dg-envelope {
      margin: 10px 0;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 82%, var(--vscode-foreground, #ccc));
    }
    .dg-envelope-title {
      font-size: 0.68em;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 6px;
    }
    .dg-envelope-summary {
      font-size: 0.95em;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    .dg-envelope-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .dg-envelope-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 22%, transparent);
      background: color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent);
      font-size: 0.78em;
      color: var(--vscode-foreground, #ccc);
    }
    .dg-pill-complete  { border-color: color-mix(in srgb, #4ec9b0 40%, transparent); background: color-mix(in srgb, #4ec9b0 14%, transparent); color: #4ec9b0; }
    .dg-pill-advancing { border-color: color-mix(in srgb, #3794ff 40%, transparent); background: color-mix(in srgb, #3794ff 14%, transparent); color: #3794ff; }
    .dg-pill-stalled   { border-color: color-mix(in srgb, #d18616 40%, transparent); background: color-mix(in srgb, #d18616 14%, transparent); color: #d18616; }
    .dg-pill-blocked   { border-color: color-mix(in srgb, #f14c4c 40%, transparent); background: color-mix(in srgb, #f14c4c 14%, transparent); color: #f14c4c; }
    .dg-pill-low       { border-color: color-mix(in srgb, #4ec9b0 40%, transparent); background: color-mix(in srgb, #4ec9b0 14%, transparent); color: #4ec9b0; }
    .dg-pill-medium    { border-color: color-mix(in srgb, #d18616 40%, transparent); background: color-mix(in srgb, #d18616 14%, transparent); color: #d18616; }
    .dg-pill-high      { border-color: color-mix(in srgb, #f14c4c 40%, transparent); background: color-mix(in srgb, #f14c4c 14%, transparent); color: #f14c4c; }
    .dg-envelope-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    }
    .dg-envelope-actions-label {
      width: 100%;
      font-size: 0.72em;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 2px;
    }
    .dg-envelope-action {
      background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 25%, transparent) !important;
      border-color: color-mix(in srgb, var(--vscode-button-background, #0e639c) 55%, transparent) !important;
      color: var(--vscode-button-foreground, #fff) !important;
      font-weight: 500;
      padding: 4px 14px;
      border-radius: 14px;
    }
    .dg-envelope-action:hover {
      background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 45%, transparent) !important;
    }

    /* ── Slice 4: verification + trace ── */
    .verdict-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 0.88em;
      line-height: 1.4;
    }
    .verdict-label {
      font-size: 0.72em;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
      flex-shrink: 0;
    }
    .verdict-verified {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #89d185) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed, #89d185) 40%, transparent);
    }
    .verdict-partial {
      background: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-orange, #d18616) 40%, transparent);
    }
    .verdict-speculative {
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 28%, transparent);
    }
    .message-provenance {
      margin-top: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.8em;
      line-height: 1.4;
    }
    .entity-link.entity-verified::after,
    .entity-link.entity-latent::after,
    .entity-link.entity-tension::after,
    .entity-link.entity-unverified::after {
      margin-left: 4px;
      font-size: 0.9em;
      vertical-align: baseline;
    }
    .entity-link.entity-verified::after { content: '✓'; color: var(--vscode-testing-iconPassed, #89d185); }
    .entity-link.entity-latent::after { content: '◌'; color: var(--vscode-descriptionForeground); }
    .entity-link.entity-tension::after { content: '⚠'; color: var(--vscode-errorForeground, #f14c4c); }
    .entity-link.entity-unverified::after { content: '?'; color: var(--vscode-descriptionForeground); }

    .tool-trace {
      margin-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 8px;
      font-size: 0.88em;
    }
    .tool-trace summary {
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
    }
    .tool-trace-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }
    .tool-trace-item {
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.18));
    }
    .tool-trace-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.95em;
    }
    .tool-trace-meta {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.92em;
      line-height: 1.4;
    }

    /* ── Slice 5: actions + polish ── */
    .message-context-footer {
      margin-top: 8px;
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      border-top: 1px dashed var(--vscode-panel-border);
      padding-top: 6px;
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 5px;
    }

    /* ── Anchor migration state badges ── */
    .anchor-state-badge {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 0.9em;
      font-weight: 500;
      border: 1px solid transparent;
      white-space: nowrap;
      vertical-align: baseline;
    }
    /* promoted — graph identity confirmed, success tint */
    .anchor-state-promoted {
      color: #4ec9b0;
      background: color-mix(in srgb, #4ec9b0 12%, transparent);
      border-color: color-mix(in srgb, #4ec9b0 35%, transparent);
    }
    /* rebound — symbol moved, still trackable, neutral/info */
    .anchor-state-rebound {
      color: #3794ff;
      background: color-mix(in srgb, #3794ff 12%, transparent);
      border-color: color-mix(in srgb, #3794ff 35%, transparent);
    }
    /* drifted — approximate match, warn */
    .anchor-state-drifted {
      color: #d18616;
      background: color-mix(in srgb, #d18616 12%, transparent);
      border-color: color-mix(in srgb, #d18616 35%, transparent);
    }
    /* archived — no match found, muted */
    .anchor-state-archived {
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, transparent);
      border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 25%, transparent);
      text-decoration: line-through;
      opacity: 0.75;
    }
    /* native / canonical — normal in-session anchor, subtle */
    .anchor-state-native,
    .anchor-state-canonical {
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 18%, transparent);
      opacity: 0.85;
    }
    .implicit-entity-notice {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground, #4daafc) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #4daafc) 28%, transparent);
      font-size: 0.82em;
      line-height: 1.45;
      color: var(--vscode-descriptionForeground);
    }
    .message-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .message-action-btn {
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground, rgba(90,93,94,0.2));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      padding: 5px 10px;
      font-size: 0.82em;
      cursor: pointer;
    }
    .message-action-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }
    .message-action-btn[disabled] {
      opacity: 0.6;
      cursor: progress;
    }
    .message-action-btn.loading {
      position: relative;
      padding-right: 28px;
    }
    .message-action-btn.loading::after {
      content: '…';
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0.75;
    }
    .message-action-error {
      margin-top: 6px;
      font-size: 0.78em;
      color: var(--vscode-errorForeground, #f14c4c);
    }

    /* ── Autonomy status bar ── */
    #autonomy-bar {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      font-size: 0.82em;
    }
    .autonomy-mode {
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .autonomy-mode-cautious { color: var(--vscode-charts-blue, #4fc1ff); }
    .autonomy-mode-conscientious { color: var(--vscode-charts-green, #89d185); }
    .autonomy-mode-eager { color: var(--vscode-charts-yellow, #cca700); }
    .autonomy-mode-autonomous { color: var(--vscode-charts-orange, #d18616); }
    #autonomy-counter {
      opacity: 0.8;
      font-variant-numeric: tabular-nums;
    }
    #autonomy-reset-btn {
      margin-left: auto;
      font-size: 0.85em;
    }

    /* ── Recommended actions ── */
    .recommended-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .action-chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
      border-radius: 12px;
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      font-size: 0.82em;
      cursor: pointer;
      transition: background 0.15s;
    }
    .action-chip:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
    }
    .action-chip-all {
      font-weight: 600;
      border-color: var(--vscode-button-border, var(--vscode-focusBorder));
    }
  `;
}
