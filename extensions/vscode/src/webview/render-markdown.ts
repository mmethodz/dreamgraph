/**
 * render-markdown.ts — Option A script-string generator.
 *
 * This file exports getRenderScript(): string, which returns the JavaScript
 * source text injected into the webview via getHtml(). It is NOT a pure TS
 * rendering utility — the webview has no module system, so the output is a
 * JS string template that runs in the webview's inline script context.
 *
 * markdown-it and DOMPurify are pre-loaded as separate <script> tags before
 * this script runs. Both are available on window.markdownit and window.DOMPurify.
 *
 * Key decisions (from TDD_COGNITIVE_OUTPUT_V2.md):
 *  - html: false — LLM output is untrusted; no raw HTML pass-through
 *  - DOMPurify allowlist is explicit (not a blocklist)
 *  - ALLOW_DATA_ATTR: false — no data-* from LLM content
 *  - Copy buttons added only at stream-end (idempotency: rebuild-then-enhance)
 *  - External links intercepted globally, routed via extension host
 *  - Streaming: debounced ~80ms, no copy buttons during stream
 */

export function getRenderScript(): string {
  return `
    (function() {
      const MERMAID_MAX_CHARS = 12000;
      const md = window.markdownit({
        html: false,
        linkify: true,
        typographer: false,
      });

      if (typeof window.registerCardFencePlugin === 'function') {
        window.registerCardFencePlugin(md);
      }

      const defaultFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };
      md.renderer.rules.fence = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const info = (token.info || '').trim().toLowerCase();
        if (info === 'mermaid') {
          const source = token.content || '';
          const escaped = md.utils.escapeHtml(source);
          return '<div class="mermaid-block pending"><pre class="mermaid-source">' + escaped + '</pre><div class="mermaid-diagram"></div></div>';
        }
        return defaultFence(tokens, idx, options, env, self);
      };

      const defaultLinkOpen = md.renderer.rules.link_open || function(tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };
      md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
        const aIndex = tokens[idx].attrIndex('target');
        if (aIndex < 0) {
          tokens[idx].attrPush(['target', '_blank']);
        } else {
          tokens[idx].attrs[aIndex][1] = '_blank';
        }
        const relIndex = tokens[idx].attrIndex('rel');
        if (relIndex < 0) {
          tokens[idx].attrPush(['rel', 'noopener noreferrer']);
        } else {
          tokens[idx].attrs[relIndex][1] = 'noopener noreferrer';
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
      };

      window.renderMarkdown = function(content) {
        const raw = md.render(content);
        const clean = DOMPurify.sanitize(raw, {
          ALLOWED_TAGS: [
            'h1','h2','h3','h4','h5','h6',
            'p','br','strong','em','code',
            'pre','blockquote',
            'ul','ol','li',
            'table','thead','tbody','tr','th','td',
            'a','img','span','div','hr',
            'svg','g','path','line','rect','circle','ellipse','polygon','polyline','text','tspan','defs','marker','foreignObject','style'
          ],
          ALLOWED_ATTR: [
            'href','src','alt','class','target','rel',
            'viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points',
            'fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray',
            'transform','xmlns','role','aria-roledescription','aria-label','style','id','marker-start','marker-end','dominant-baseline','text-anchor'
          ],
          ALLOW_DATA_ATTR: false,
          ADD_ATTR: ['target'],
        });
        return clean;
      };

      window.renderMermaidDiagrams = async function(container) {
        if (!container || typeof window.mermaid === 'undefined') return;
        const blocks = Array.from(container.querySelectorAll('.mermaid-block'));
        if (blocks.length === 0) return;

        try {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'default',
          });
        } catch {}

        for (const block of blocks) {
          if (!(block instanceof HTMLElement)) continue;
          const sourceEl = block.querySelector('.mermaid-source');
          const diagramEl = block.querySelector('.mermaid-diagram');
          if (!(sourceEl instanceof HTMLElement) || !(diagramEl instanceof HTMLElement)) continue;
          const source = sourceEl.textContent || '';

          if (!source.trim()) {
            block.classList.remove('pending');
            continue;
          }

          if (source.length > MERMAID_MAX_CHARS) {
            block.classList.remove('pending');
            block.classList.add('failed');
            diagramEl.innerHTML = '<div class="mermaid-error">Mermaid diagram omitted: source too large to render safely.</div>';
            sourceEl.hidden = false;
            continue;
          }

          try {
            const renderId = 'mermaid-' + Math.random().toString(36).slice(2);
            const result = await window.mermaid.render(renderId, source);
            diagramEl.innerHTML = result.svg;
            sourceEl.hidden = true;
            block.classList.remove('pending');
            block.classList.remove('failed');
            block.classList.add('rendered');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            block.classList.remove('pending');
            block.classList.add('failed');
            diagramEl.innerHTML = '<div class="mermaid-error">Unable to render Mermaid diagram: ' + md.utils.escapeHtml(message) + '</div>';
            sourceEl.hidden = false;
          }
        }
      };

      window.addCopyButtons = function(container) {
        container.querySelectorAll('pre > code').forEach(function(block) {
          const btn = document.createElement('button');
          btn.className = 'copy-btn';
          btn.textContent = 'Copy';
          btn.addEventListener('click', function() {
            vscode.postMessage({ type: 'copyToClipboard', text: block.textContent || '' });
            btn.textContent = 'Copied';
            setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
          });
          block.parentElement.appendChild(btn);
        });
      };

      window.renderCompletedMessage = async function(el, content) {
        el.innerHTML = window.renderMarkdown(content);
        await window.renderMermaidDiagrams(el);
        window.addCopyButtons(el);
      };

      window.initLinkInterceptor = function() {
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a[href]');
          if (!link) return;
          const href = link.getAttribute('href');
          if (href && (href.startsWith('https://') || href.startsWith('http://'))) {
            e.preventDefault();
            vscode.postMessage({ type: 'openExternalLink', url: href });
          }
        });
      };

    })();
  `;
}
