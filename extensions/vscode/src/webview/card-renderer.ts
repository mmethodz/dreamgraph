/**
 * card-renderer.ts — Slice 3 structured card rendering.
 *
 * Exports a script-string generator for the webview. The script exposes
 * window.registerCardFencePlugin(md), which installs a markdown-it fence rule
 * handling these language tags:
 *   - entity
 *   - adr
 *   - tension
 *   - insight
 *
 * Contract from TDD:
 * - cards are driven exclusively by fenced blocks in LLM output
 * - malformed card bodies fall back to regular fenced code blocks
 * - unknown fence types are untouched
 * - no crash, no partial broken DOM
 */

export function getCardRendererScript(): string {
  return `
    (function() {
      function escHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function escAttr(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function parseCardBody(src) {
        const lines = String(src || '').replace(/\\r\\n/g, '\\n').split('\\n');
        const out = { fields: {}, bodyLines: [] };
        let inBody = false;
        for (const line of lines) {
          const match = !inBody ? line.match(/^([A-Za-z][A-Za-z0-9_-]*):\\s*(.*)$/) : null;
          if (match) {
            out.fields[match[1].toLowerCase()] = match[2];
            continue;
          }
          if (line.trim() === '' && Object.keys(out.fields).length > 0 && !inBody) {
            inBody = true;
            continue;
          }
          if (inBody || line.trim() !== '') {
            inBody = true;
            out.bodyLines.push(line);
          }
        }
        out.body = out.bodyLines.join('\\n').trim();
        return out;
      }

      function normalizeCard(type, parsed) {
        const f = parsed.fields || {};
        if (type === 'entity') {
          if (!f.id && !f.name) return null;
          return {
            title: f.name || f.id,
            subtitle: f.id ? 'ID: ' + f.id : '',
            meta: [f.kind, f.status].filter(Boolean),
            body: parsed.body || f.description || '',
          };
        }
        if (type === 'adr') {
          if (!f.id && !f.title) return null;
          return {
            title: (f.id ? f.id + ': ' : '') + (f.title || f.id),
            subtitle: f.status ? 'Status: ' + f.status : '',
            meta: [f.decided_by, f.date].filter(Boolean),
            body: parsed.body || f.chosen || f.summary || '',
          };
        }
        if (type === 'tension') {
          if (!f.id && !f.title && !parsed.body) return null;
          return {
            title: f.title || f.id || 'Tension',
            subtitle: f.id ? 'ID: ' + f.id : '',
            meta: [f.severity, f.status].filter(Boolean),
            body: parsed.body || f.description || '',
          };
        }
        if (type === 'insight') {
          if (!f.title && !parsed.body) return null;
          return {
            title: f.title || 'Insight',
            subtitle: f.confidence ? 'Confidence: ' + f.confidence : '',
            meta: [f.kind, f.source].filter(Boolean),
            body: parsed.body || f.summary || '',
          };
        }
        return null;
      }

      function renderCard(type, normalized) {
        const title = escHtml(normalized.title || '');
        const subtitle = normalized.subtitle ? '<div class="dg-card-subtitle">' + escHtml(normalized.subtitle) + '</div>' : '';
        const meta = Array.isArray(normalized.meta) && normalized.meta.length > 0
          ? '<div class="dg-card-meta">' + normalized.meta.map(function(item) { return '<span class="dg-card-chip">' + escHtml(item) + '</span>'; }).join('') + '</div>'
          : '';
        const body = normalized.body
          ? '<div class="dg-card-body">' + escHtml(normalized.body).replace(/\\n/g, '<br>') + '</div>'
          : '';
        return '<details class="dg-card dg-card-' + escAttr(type) + '" open>' +
          '<summary class="dg-card-summary">' +
            '<span class="dg-card-type">' + escHtml(type.toUpperCase()) + '</span>' +
            '<span class="dg-card-title">' + title + '</span>' +
          '</summary>' +
          '<div class="dg-card-content">' + subtitle + meta + body + '</div>' +
        '</details>';
      }

      function renderEnvelope(env) {
        var html = '<div class="dg-envelope">';
        html += '<div class="dg-envelope-title">SUMMARY</div>';
        html += '<div class="dg-envelope-summary">' + escHtml(env.summary) + '</div>';
        html += '<div class="dg-envelope-meta">';
        if (env.goal_status) {
          html += '<span class="dg-envelope-pill dg-pill-' + escAttr(env.goal_status) + '">' + escHtml(env.goal_status) + '</span>';
        }
        if (env.progress_status) {
          html += '<span class="dg-envelope-pill dg-pill-' + escAttr(env.progress_status) + '">' + escHtml(env.progress_status) + '</span>';
        }
        if (env.uncertainty) {
          html += '<span class="dg-envelope-pill">' + escHtml('uncertainty: ' + env.uncertainty) + '</span>';
        }
        html += '</div>';

        var steps = Array.isArray(env.recommended_next_steps) ? env.recommended_next_steps : [];
        if (steps.length > 0) {
          html += '<div class="dg-envelope-actions">';
          html += '<div class="dg-envelope-actions-label">Suggested Actions</div>';
          for (var i = 0; i < steps.length; i++) {
            var step = steps[i];
            var label = step.label || step.id || ('Step ' + (i + 1));
            var title = step.rationale ? escAttr(step.rationale) : '';
            html += '<button class="action-chip dg-envelope-action" data-action-id="' + escAttr(step.id || '') + '"' +
                    (title ? ' title="' + title + '"' : '') + '>' +
                    escHtml(label) + '</button>';
          }
          if (steps.length > 1) {
            html += '<button class="action-chip action-chip-all dg-envelope-do-all">Do all</button>';
          }
          html += '</div>';
        }
        html += '</div>';
        return html;
      }

      window.renderEnvelope = renderEnvelope;

      // Repair common JSON quirks that providers (esp. Claude w/ extended thinking)
      // emit and that strict JSON.parse rejects.
      function repairJsonish(src) {
        var s = String(src || '');
        // Normalize common problem characters
        s = s.replace(/\\u00A0/g, ' ');             // NBSP -> space
        s = s.replace(/[\\u201C\\u201D\\u201E\\u201F]/g, '"'); // smart double quotes
        s = s.replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'"); // smart single quotes
        s = s.replace(/[\\u2013\\u2014]/g, '-');     // en/em dash -> hyphen (only if inside strings; harmless elsewhere for envelope)
        // Strip // line comments (but not '://' inside strings — naive but safe enough for envelope payloads)
        s = s.replace(/(^|[^:])\\/\\/[^\\n]*/g, '$1');
        // Strip /* */ block comments
        s = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
        // Trailing commas before } or ]
        s = s.replace(/,\\s*([}\\]])/g, '$1');
        return s.trim();
      }

      function isEnvelopeShape(obj) {
        return obj && typeof obj === 'object' && typeof obj.summary === 'string' &&
          ('goal_status' in obj || 'recommended_next_steps' in obj || 'progress_status' in obj);
      }

      function tryParseEnvelope(src) {
        var raw = String(src || '').trim();
        if (!raw) return null;
        try {
          var direct = JSON.parse(raw);
          if (isEnvelopeShape(direct)) return direct;
        } catch (_e) { /* fall through */ }
        try {
          var repaired = JSON.parse(repairJsonish(raw));
          if (isEnvelopeShape(repaired)) return repaired;
        } catch (_e2) { /* give up */ }
        return null;
      }

      // Find a balanced { ... } substring starting at index i. Respects string literals.
      function findBalancedObject(text, startIdx) {
        var depth = 0, inStr = false, esc = false, quote = '';
        for (var i = startIdx; i < text.length; i++) {
          var ch = text[i];
          if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === '\\\\') { esc = true; continue; }
            if (ch === quote) { inStr = false; }
            continue;
          }
          if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
          if (ch === '{') { depth++; continue; }
          if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(startIdx, i + 1);
          }
        }
        return null;
      }

      // Normalize any envelope-shaped JSON in content into a clean ` + '```json' + ` fenced block
      // that markdown-it will reliably tokenize. Handles fenced (any case/indent) and bare trailing JSON.
      window.normalizeEnvelopeFence = function(content) {
        var text = String(content || '');
        if (!text) return text;

        // 1) Fenced ` + '```json' + ` blocks (case-insensitive, allow leading whitespace, optional info string).
        var fenceRe = /^[ \\t]*` + '```' + `[ \\t]*([A-Za-z]+)?[^\\n]*\\n([\\s\\S]*?)\\n[ \\t]*` + '```' + `[ \\t]*$/gm;
        text = text.replace(fenceRe, function(match, lang, body) {
          var langLower = String(lang || '').toLowerCase();
          if (langLower && langLower !== 'json') return match;
          var env = tryParseEnvelope(body);
          if (!env) return match;
          return '\\n\\n' + '` + '```' + `json\\n' + JSON.stringify(env, null, 2) + '\\n' + '` + '```' + `' + '\\n\\n';
        });

        // 2) Bare top-level JSON object containing "summary" — only consider if not already inside a fence.
        // Quick guard: skip if a recognized envelope fence is now present.
        if (/` + '```' + `json\\s*\\n\\s*\\{[\\s\\S]*?"summary"/i.test(text)) {
          return text;
        }
        var summaryIdx = text.search(/"summary"\\s*:/);
        if (summaryIdx >= 0) {
          // Walk backward to find the enclosing '{' at depth 0.
          var braceStart = -1, depth = 0, inStr = false, esc = false, quote = '';
          for (var j = summaryIdx; j >= 0; j--) {
            var ch = text[j];
            if (inStr) {
              if (esc) { esc = false; continue; }
              if (ch === '\\\\') { esc = true; continue; }
              if (ch === quote) { inStr = false; }
              continue;
            }
            if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
            if (ch === '}') depth++;
            else if (ch === '{') {
              if (depth === 0) { braceStart = j; break; }
              depth--;
            }
          }
          if (braceStart >= 0) {
            var candidate = findBalancedObject(text, braceStart);
            if (candidate) {
              var env2 = tryParseEnvelope(candidate);
              if (env2) {
                var before = text.slice(0, braceStart).replace(/[ \\t]+$/, '');
                var after = text.slice(braceStart + candidate.length).replace(/^[ \\t]+/, '');
                text = before + '\\n\\n' + '` + '```' + `json\\n' + JSON.stringify(env2, null, 2) + '\\n' + '` + '```' + `' + '\\n\\n' + after;
              }
            }
          }
        }
        return text;
      };

      window.registerCardFencePlugin = function(md) {
        if (!md || typeof md.renderer !== 'object') return;
        const defaultFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.fence = function(tokens, idx, options, env, self) {
          const token = tokens[idx];
          const info = String(token.info || '').trim();
          const lang = info.split(/\\s+/)[0].toLowerCase();

          // Handle structured JSON envelopes from DreamGraph
          if (lang === 'json') {
            var envParsed = tryParseEnvelope(token.content || '');
            if (envParsed) {
              return renderEnvelope(envParsed);
            }
            return defaultFence(tokens, idx, options, env, self);
          }

          if (!/^(entity|adr|tension|insight)$/.test(lang)) {
            return defaultFence(tokens, idx, options, env, self);
          }

          try {
            const parsed = parseCardBody(token.content || '');
            const fieldCount = Object.keys(parsed.fields || {}).length;
            const onlyId = fieldCount === 1 && Object.prototype.hasOwnProperty.call(parsed.fields, 'id');
            if (onlyId && !parsed.body && !/\\n$/.test(String(token.content || ''))) {
              return defaultFence(tokens, idx, options, env, self);
            }
            const normalized = normalizeCard(lang, parsed);
            if (!normalized) {
              return defaultFence(tokens, idx, options, env, self);
            }
            return renderCard(lang, normalized);
          } catch (_err) {
            return defaultFence(tokens, idx, options, env, self);
          }
        };
      };
    })();
  `;
}
