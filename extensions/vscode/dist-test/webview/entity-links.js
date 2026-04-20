"use strict";
/**
 * entity-links.ts — Script-string generator for Slice 2 entity URI linkification.
 *
 * Exports getEntityLinksScript(): string, injected into the webview via getHtml().
 * Runs after renderMarkdown() to post-process rendered HTML.
 *
 * Recognised URI schemes: feature://, workflow://, data-model://, entity://,
 * adr://, tension://, edge://, file://
 *
 * Safety rules (T-S1.4, T-S3.1):
 *  - URIs inside <pre> and <code> are NEVER linkified (code-block safety)
 *  - Only the allowlisted schemes are matched — no javascript:, data:, etc.
 *  - data-uri stored on the anchor is validated to match the allowlist before use
 *  - navigateEntity message is only posted for validated URIs
 *
 * Processing model:
 *  - linkifyEntities(html: string): string — called with the DOMPurify-sanitized
 *    HTML string BEFORE innerHTML assignment. Works on the string directly using
 *    a split-on-tags approach so that matches inside <pre>…</pre> and <code>…</code>
 *    are skipped without a DOM dependency.
 *  - At stream-end, window.applyEntityLinks(container) is called to attach click
 *    listeners to .entity-link anchors already in the DOM.
 *
 * Deferred (Slice 5+): implicit entity detection from prose, graph verification markers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEntityLinksScript = getEntityLinksScript;
function getEntityLinksScript() {
    return `
    (function() {
      // Allowlisted URI schemes for entity links
      var ENTITY_SCHEMES = ['feature', 'workflow', 'data-model', 'entity', 'adr', 'tension', 'edge', 'file'];
      var ENTITY_URI_RE = /\\b(feature|workflow|data-model|entity|adr|tension|edge|file):\\/\\/[\\w.\\/@→#%~_-]+/g;

      // Bare file path pattern — matches paths like src/foo/bar.ts, ./components/App.tsx,
      // or simple filenames like README.md, SplashPage.xaml.cs.
      // Group 1 captures leading whitespace/punctuation (preserved), group 2 captures the path.
      var FILE_EXT_LIST = 'ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|xml|yaml|yml|py|cs|csproj|xaml|sln|java|kt|swift|go|rs|rb|sh|ps1|sql|vue|svelte';
      var FILE_PATH_RE = new RegExp('(^|[\\\\s(\\\\[,])(\\\\.{0,2}/?(?:[\\\\w._-]+/)*[\\\\w._-]+\\\\.(?:' + FILE_EXT_LIST + ')(?:\\\\.(?:' + FILE_EXT_LIST + '))?)(?=[\\\\s)\\\\],.:;!?]|$)', 'gm');

      /**
       * Linkify entity URIs in an HTML string, skipping content inside
       * <pre>…</pre> and <code>…</code> blocks.
       *
       * Strategy: split the HTML on block-level code fences first, then on
       * inline <code> tags, so we never touch text inside those elements.
       *
       * Returns the transformed HTML string.
       */
      window.linkifyEntities = function(html) {
        if (!html || typeof html !== 'string') return html;

        // Split on <pre …>…</pre> blocks (case-insensitive, multiline)
        // Keep the separator so we can reassemble
        var preParts = html.split(/(<pre[\\s\\S]*?<\\/pre>)/i);
        for (var i = 0; i < preParts.length; i += 2) {
          // Even indices are outside <pre> — process them
          // Odd indices are <pre> blocks — leave untouched
          if (i % 2 === 0) {
            preParts[i] = _linkifyOutsidePre(preParts[i]);
          }
        }
        return preParts.join('');
      };

      /**
       * Linkify entity URIs in a segment that has already been established to
       * be outside any <pre> block. Still skips inline <code> content.
       */
      function _linkifyOutsidePre(segment) {
        // Split on <code>…</code>
        var codeParts = segment.split(/(<code[\\s\\S]*?<\\/code>)/i);
        for (var j = 0; j < codeParts.length; j += 2) {
          // Even indices are outside <code>
          if (j % 2 === 0) {
            codeParts[j] = _replaceEntityUris(codeParts[j]);
          }
        }
        return codeParts.join('');
      }

      /**
       * Replace entity URI matches in plain text/HTML attribute context.
       * Only replaces text nodes — not inside existing href="…" attributes.
       *
       * Security: splits the segment on ALL HTML tags first. Only bare text
       * nodes (between tags) are processed for entity URIs. This prevents
       * attribute injection payloads from surviving in the output even when
       * the URI regex stops mid-payload.
       */
      function _replaceEntityUris(text) {
        // Split on HTML tags to isolate text nodes from markup
        var tagParts = text.split(/(<[^>]*>)/);
        for (var t = 0; t < tagParts.length; t++) {
          // Odd indices are HTML tags — skip
          if (t % 2 !== 0) continue;
          // Even indices are text nodes — may be empty
          var node = tagParts[t];
          if (!node) continue;
          // Replace entity URIs first
          node = node.replace(ENTITY_URI_RE, function(match, scheme) {
            var name = match.slice(scheme.length + 3); // strip "scheme://"
            var label = _formatEntityLabel(scheme, name);
            return '<a class="entity-link" data-type="' + _escAttr(scheme) +
                   '" data-uri="' + _escAttr(match) + '" href="#" title="' +
                   _escAttr(match) + '">' + _escHtml(label) + '</a>';
          });
          // Then linkify bare file paths (e.g. src/foo/bar.ts, ./components/App.tsx)
          node = node.replace(FILE_PATH_RE, function(match, prefix, filePath) {
            return prefix + '<a class="entity-link file-link" data-type="file" data-uri="file://' +
                   _escAttr(filePath) + '" href="#" title="Open ' +
                   _escAttr(filePath) + '">📄\\u00a0' + _escHtml(filePath) + '</a>';
          });
          tagParts[t] = node;
        }
        return tagParts.join('');
      }

      /** Format a human-readable label for the entity link. */
      function _formatEntityLabel(scheme, name) {
        var icon = {
          feature: '◆',
          workflow: '⟳',
          'data-model': '⬢',
          entity: '⬡',
          adr: '⚖',
          tension: '⚡',
          edge: '→',
          file: '📄',
        }[scheme] || '⬡';
        // Decode URI component for display, replace underscores/hyphens with spaces
        var displayName = name.replace(/[_-]/g, ' ');
        try { displayName = decodeURIComponent(displayName); } catch(e) {}
        return icon + '\\u00a0' + displayName;
      }

      function _escAttr(s) {
        return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      function _escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      /**
       * Attach click listeners to all .entity-link anchors inside a container.
       * Called once at stream-end and once for each completed addMessage bubble.
       * Safe to call multiple times — listeners are attached via a guard attribute.
       */
      window.applyEntityLinks = function(container) {
        if (!container) return;
        var links = container.querySelectorAll('a.entity-link:not([data-linked])');
        links.forEach(function(link) {
          link.setAttribute('data-linked', '1');
          link.addEventListener('click', function(e) {
            e.preventDefault();
            var uri = link.getAttribute('data-uri') || '';
            // Validate scheme before posting
            var schemeMatch = uri.match(/^([a-z]+):\\/\\//);
            if (!schemeMatch) return;
            var scheme = schemeMatch[1];
            if (ENTITY_SCHEMES.indexOf(scheme) === -1) return;
            vscode.postMessage({ type: 'navigateEntity', uri: uri });
          });
        });
      };

    })();
  `;
}
//# sourceMappingURL=entity-links.js.map