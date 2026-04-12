/**
 * DreamGraph v7.0 — Web Dashboard.
 *
 * Self-contained HTTP route handlers that render status, config,
 * and live documentation pages as HTML.  Zero external dependencies —
 * all CSS is inlined, all data is pulled from the running server's
 * in-memory state + persisted data stores.
 *
 * Routes:
 *   GET  /           — Dashboard index (links to all pages)
 *   GET  /status     — Cognitive state, dream stats, tensions
 *   GET  /schedules  — Schedule management (view, pause/resume, run now, delete)
 *   POST /schedules  — Schedule actions (toggle, run, delete)
 *   GET  /config     — Active configuration with inline edit forms
 *   POST /config     — Apply configuration changes at runtime
 *   GET  /docs       — Native markdown viewer for docs/ folder
 *   GET  /docs/:slug — Render a specific docs/*.md file
 *   GET  /health     — HTML health page (JSON available via Accept header)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { config, updateDatabaseConnectionString } from "../config/config.js";
import { engine } from "../cognitive/engine.js";
import { getActiveScope, isInstanceMode, getToolCallCount } from "../instance/lifecycle.js";
import {
  getSchedules, getScheduleHistory, getSchedulerConfig, updateSchedulerConfig,
  createSchedule, updateSchedule, deleteSchedule, runScheduleNow,
} from "../cognitive/scheduler.js";
import {
  getLlmConfig, initLlmProvider,
  getDreamerLlmConfig, getNormalizerLlmConfig,
  updateDreamerLlmConfig, updateNormalizerLlmConfig,
} from "../cognitive/llm.js";
import type { LlmConfig } from "../cognitive/llm.js";
import type { DreamSchedule, ScheduleExecution, ScheduleAction, ScheduleTriggerType } from "../types/index.js";
import { updateConfig as updateEventConfig, getConfig as getEventConfig } from "../cognitive/event-router.js";
import { updateNarrativeConfig, getNarrativeConfig } from "../cognitive/narrator.js";
import { testDbConnection, resetDbPool } from "../tools/db-senses.js";
import { loadJsonData, loadJsonArray } from "../utils/cache.js";
import { writeEngineEnv } from "../utils/engine-env.js";
import { logger } from "../utils/logger.js";

/* ------------------------------------------------------------------ */
/*  Dashboard context — set by index.ts at HTTP startup               */
/* ------------------------------------------------------------------ */

interface DashboardContext {
  getSessionCount: () => number;
  port: number;
}

let _ctx: DashboardContext = { getSessionCount: () => 0, port: 8100 };

/**
 * Persist the current LLM configuration (base + dreamer + normalizer)
 * to the instance's engine.env so it survives daemon restarts.
 */
function persistLlmEngineEnv(): void {
  const scope = getActiveScope();
  if (!scope) {
    logger.warn("persistLlmEngineEnv: no active scope — config not persisted");
    return;
  }

  const base = getLlmConfig();
  const dreamer = getDreamerLlmConfig();
  const normalizer = getNormalizerLlmConfig();

  // For API key: check both in-memory config and process.env (engine.env loader).
  // This prevents the key from being lost when the provider changes (e.g. ollama→openai).
  const effectiveApiKey = base.apiKey || process.env.DREAMGRAPH_LLM_API_KEY || "";

  const vars: Record<string, string> = {
    // Base provider
    DREAMGRAPH_LLM_PROVIDER: base.provider,
    DREAMGRAPH_LLM_MODEL: base.model,
    DREAMGRAPH_LLM_URL: base.baseUrl,
    DREAMGRAPH_LLM_API_KEY: effectiveApiKey,
    DREAMGRAPH_LLM_TEMPERATURE: String(base.temperature),
    DREAMGRAPH_LLM_MAX_TOKENS: String(base.maxTokens),
    // Dreamer overrides
    DREAMGRAPH_LLM_DREAMER_MODEL: dreamer.model,
    DREAMGRAPH_LLM_DREAMER_TEMPERATURE: String(dreamer.temperature),
    DREAMGRAPH_LLM_DREAMER_MAX_TOKENS: String(dreamer.maxTokens),
    // Normalizer overrides
    DREAMGRAPH_LLM_NORMALIZER_MODEL: normalizer.model,
    DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE: String(normalizer.temperature),
    DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS: String(normalizer.maxTokens),
  };

  writeEngineEnv(scope.engineEnvPath, vars);
}

/**
 * Provide runtime context that only index.ts knows (sessions, port).
 * Call once from startHTTP().
 */
export function setDashboardContext(ctx: DashboardContext): void {
  _ctx = ctx;
}

/* ------------------------------------------------------------------ */
/*  Shared HTML chrome                                                */
/* ------------------------------------------------------------------ */

const BRAND = "DreamGraph";
const VERSION = config.server.version;

function shell(title: string, body: string, activeTab: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — ${BRAND} v${VERSION}</title>
  <style>${CSS}</style>
</head>
<body>
  <nav class="topbar">
    <a class="brand" href="/">${BRAND} <span class="version">v${VERSION}</span></a>
    <div class="nav-links">
      <a href="/status"    class="${activeTab === "status"    ? "active" : ""}">Status</a>
      <a href="/schedules" class="${activeTab === "schedules" ? "active" : ""}">Schedules</a>
      <a href="/config"    class="${activeTab === "config"    ? "active" : ""}">Config</a>
      <a href="/docs"      class="${activeTab === "docs"      ? "active" : ""}">Docs</a>
      <a href="/health"    class="${activeTab === "health"    ? "active" : ""}">Health</a>
    </div>
  </nav>
  <main>${body}</main>
  <footer>
    <span>${BRAND} v${VERSION} "El Alarife"</span>
    <span>Instance: ${isInstanceMode() ? getActiveScope()!.uuid : "legacy"}</span>
    <span>Generated: ${new Date().toISOString()}</span>
  </footer>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  CSS                                                               */
/* ------------------------------------------------------------------ */

const CSS = `
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px; background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { font-size: 18px; font-weight: 700; color: var(--text); }
  .brand:hover { text-decoration: none; }
  .brand .version { font-weight: 400; color: var(--text-dim); font-size: 13px; }
  .nav-links { display: flex; gap: 16px; }
  .nav-links a { color: var(--text-dim); font-weight: 500; padding: 4px 8px; border-radius: 6px; transition: all .15s; }
  .nav-links a:hover { color: var(--text); background: var(--border); text-decoration: none; }
  .nav-links a.active { color: var(--accent); background: rgba(88,166,255,.1); }

  main { max-width: 1100px; margin: 24px auto; padding: 0 24px; }
  footer {
    display: flex; justify-content: center; gap: 24px; padding: 16px;
    color: var(--text-dim); font-size: 12px; border-top: 1px solid var(--border); margin-top: 48px;
  }

  h1 { font-size: 24px; margin-bottom: 16px; }
  h2 { font-size: 18px; margin: 32px 0 12px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 20px 0 8px; color: var(--text-dim); }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 16px 0; }

  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px;
  }
  .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 8px; }
  .card-value { font-size: 28px; font-weight: 700; font-family: var(--mono); }
  .card-sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }

  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em;
  }
  .badge-green  { background: rgba(63,185,80,.15); color: var(--green); }
  .badge-yellow { background: rgba(210,153,34,.15); color: var(--yellow); }
  .badge-red    { background: rgba(248,81,73,.15); color: var(--red); }
  .badge-purple { background: rgba(188,140,255,.15); color: var(--purple); }
  .badge-blue   { background: rgba(88,166,255,.15); color: var(--accent); }

  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); padding: 6px 10px; border-bottom: 1px solid var(--border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  code, .mono { font-family: var(--mono); font-size: 12px; }
  .kv { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .kv:last-child { border-bottom: none; }
  .kv-key { color: var(--text-dim); }
  .kv-val { font-family: var(--mono); }
  pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12px; margin: 8px 0; }
  .empty { color: var(--text-dim); font-style: italic; padding: 16px 0; }

  .state-awake       { color: var(--green); }
  .state-rem         { color: var(--purple); }
  .state-normalizing { color: var(--yellow); }
  .state-nightmare   { color: var(--red); }

  .index-hero { text-align: center; padding: 48px 0 32px; }
  .index-hero h1 { font-size: 32px; }
  .index-hero p { color: var(--text-dim); font-size: 16px; margin-top: 8px; }
  .index-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 32px; }
  .index-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; transition: border-color .15s; }
  .index-card:hover { border-color: var(--accent); text-decoration: none; }
  .index-card h3 { color: var(--text); margin: 0 0 8px; font-size: 18px; }
  .index-card p { color: var(--text-dim); font-size: 13px; margin: 0; }

  /* Form styles for editable config */
  .config-form { margin-top: 12px; }
  .config-form .form-row { display: flex; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); gap: 12px; }
  .config-form .form-row:last-of-type { border-bottom: none; }
  .config-form label { color: var(--text-dim); min-width: 180px; font-size: 13px; }
  .config-form input, .config-form select {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    font-family: var(--mono); font-size: 12px; padding: 4px 8px; border-radius: 4px;
    flex: 1; max-width: 320px;
  }
  .config-form input:focus, .config-form select:focus { border-color: var(--accent); outline: none; }
  .config-form .form-actions { padding-top: 12px; display: flex; gap: 8px; }
  .config-form .unit { color: var(--text-dim); font-size: 11px; min-width: 30px; }
  .api-key-wrap { display: flex; align-items: center; flex: 1; max-width: 320px; gap: 6px; }
  .api-key-wrap input { flex: 1; max-width: none; }
  .api-key-toggle { background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .api-key-toggle:hover { border-color: var(--accent); color: var(--text); }
  .api-key-mask { font-family: var(--mono); font-size: 11px; color: var(--text-dim); margin-left: 4px; }
  .btn {
    padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
    font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
  }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: #4090e0; }
  .toast {
    background: rgba(63,185,80,.15); color: var(--green); border: 1px solid var(--green);
    border-radius: 6px; padding: 8px 16px; margin-bottom: 16px; font-size: 13px;
  }
  .toast-error {
    background: rgba(248,81,73,.15); color: var(--red); border: 1px solid var(--red);
    border-radius: 6px; padding: 8px 16px; margin-bottom: 16px; font-size: 13px;
  }

  /* Subsection grouping (e.g. LLM > Provider / Dreamer / Normalizer) */
  .section-group { border: 1px solid var(--border); border-radius: 8px; margin: 12px 0 24px; overflow: hidden; }
  .section-group > .sub-section { border-bottom: 1px solid var(--border); padding: 16px; }
  .section-group > .sub-section:last-child { border-bottom: none; }
  .sub-section h3 { margin: 0 0 8px; font-size: 14px; color: var(--text); }
  .sub-section p.sub-desc { color: var(--text-dim); font-size: 12px; margin: 0 0 10px; }

  /* DB test result */
  .db-test-result { margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-family: var(--mono); display: none; }
  .db-test-result.ok { display: block; background: rgba(63,185,80,.15); color: var(--green); border: 1px solid var(--green); }
  .db-test-result.fail { display: block; background: rgba(248,81,73,.15); color: var(--red); border: 1px solid var(--red); }
  .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--text); }
  .btn-secondary:hover { background: var(--border); }
  .btn:disabled { opacity: .5; cursor: wait; }

  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
    main { padding: 0 12px; }
    .config-form .form-row { flex-direction: column; align-items: flex-start; }
    .config-form label { min-width: auto; }
    .config-form input, .config-form select { max-width: 100%; }
  }
`;

/* ------------------------------------------------------------------ */
/*  Route: GET /                                                      */
/* ------------------------------------------------------------------ */

async function renderIndex(): Promise<string> {
  const scope = getActiveScope();
  const projectName = scope?.projectRoot?.split(/[\\/]/).pop() ?? "—";

  let body = `
    <div class="index-hero">
      <h1>🧠 ${BRAND}</h1>
      <p>Autonomous Cognitive Layer for Software Systems</p>
      <p style="margin-top: 4px">${isInstanceMode()
        ? `Instance <code style="user-select:all">${scope!.uuid}</code> · Project: <strong>${esc(projectName)}</strong>`
        : "Running in legacy mode (no instance isolation)"
      }</p>
    </div>
    <div class="index-cards">
      <a class="index-card" href="/status">
        <h3>📊 Status</h3>
        <p>Cognitive state, dream cycles, graph stats, tensions, active schedules, LLM provider health.</p>
      </a>
      <a class="index-card" href="/schedules">
        <h3>📅 Schedules</h3>
        <p>Dream schedules — view, pause/resume, run now, create, delete. Real-time execution history.</p>
      </a>
      <a class="index-card" href="/config">
        <h3>⚙️ Config</h3>
        <p>Active configuration with live editing — LLM (dreamer + normalizer), scheduler, events, narrative.</p>
      </a>
      <a class="index-card" href="/docs">
        <h3>📖 Docs</h3>
        <p>Project documentation — architecture, cognitive engine, tools reference, data model, workflows.</p>
      </a>
      <a class="index-card" href="/health">
        <h3>💚 Health</h3>
        <p>Liveness and readiness status for monitoring and load balancers.</p>
      </a>
    </div>`;

  return shell("Dashboard", body, "");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /status                                                */
/* ------------------------------------------------------------------ */

async function renderStatus(): Promise<string> {
  const status = await engine.getStatus();
  const scope = getActiveScope();

  const stateClass = `state-${status.current_state}`;

  // ---- Hero cards ----
  let body = `<h1>Server Status</h1>
  <div class="grid">
    <div class="card">
      <div class="card-title">Cognitive State</div>
      <div class="card-value ${stateClass}">${status.current_state.toUpperCase()}</div>
      <div class="card-sub">Since ${fmtTime(status.last_state_change)}</div>
    </div>
    <div class="card">
      <div class="card-title">Dream Cycles</div>
      <div class="card-value">${status.total_dream_cycles}</div>
      <div class="card-sub">Last: ${fmtTime(status.last_dream_cycle)}</div>
    </div>
    <div class="card">
      <div class="card-title">Normalization Cycles</div>
      <div class="card-value">${status.total_normalization_cycles}</div>
      <div class="card-sub">Last: ${fmtTime(status.last_normalization)}</div>
    </div>
    <div class="card">
      <div class="card-title">Tool Calls</div>
      <div class="card-value">${getToolCallCount()}</div>
      <div class="card-sub" style="user-select:all;font-size:11px">${isInstanceMode() ? scope!.uuid : "Legacy mode"}</div>
    </div>
  </div>`;

  // ---- Dream Graph Stats ----
  const gs = status.dream_graph_stats;
  body += `<h2>Dream Graph</h2>
  <div class="grid">
    <div class="card">
      <div class="card-title">Nodes / Edges</div>
      <div class="card-value">${gs.total_nodes} / ${gs.total_edges}</div>
      <div class="card-sub">Latent: ${gs.latent_nodes} nodes, ${gs.latent_edges} edges</div>
    </div>
    <div class="card">
      <div class="card-title">Avg Confidence</div>
      <div class="card-value">${gs.avg_confidence}</div>
      <div class="card-sub">Reinforcement: ${gs.avg_reinforcement} · Activation: ${gs.avg_activation}</div>
    </div>
    <div class="card">
      <div class="card-title">Expiring Next Cycle</div>
      <div class="card-value">${gs.expiring_next_cycle}</div>
      <div class="card-sub">Edges + nodes with TTL ≤ 1</div>
    </div>
  </div>`;

  // ---- Validation Stats ----
  const vs = status.validated_stats;
  const ts = status.tension_stats;

  // Pie chart data: validated, tensions, rejected
  const pieValidated = vs.validated ?? 0;
  const pieTensions  = ts.unresolved ?? 0;
  const pieRejected  = vs.rejected ?? 0;
  const pieTotal     = pieValidated + pieTensions + pieRejected;

  // Build conic-gradient stops (percentages)
  let pieChart = "";
  if (pieTotal > 0) {
    const pctV = (pieValidated / pieTotal) * 100;
    const pctT = (pieTensions  / pieTotal) * 100;
    // pctR is the remainder
    const stopV = pctV;
    const stopT = stopV + pctT;
    pieChart = `
    <div style="display:flex;align-items:center;gap:32px;margin:16px 0 8px">
      <div style="
        width:140px;height:140px;border-radius:50%;flex-shrink:0;
        background:conic-gradient(
          var(--green) 0% ${stopV.toFixed(1)}%,
          var(--yellow) ${stopV.toFixed(1)}% ${stopT.toFixed(1)}%,
          var(--red) ${stopT.toFixed(1)}% 100%
        );
        -webkit-mask:radial-gradient(circle,transparent 45%,#000 46%);
        mask:radial-gradient(circle,transparent 45%,#000 46%);
      "></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--green);display:inline-block"></span>
          <span>Validated <strong>${pieValidated}</strong> <span style="color:var(--text-dim)">(${pctV.toFixed(0)}%)</span></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--yellow);display:inline-block"></span>
          <span>Tensions <strong>${pieTensions}</strong> <span style="color:var(--text-dim)">(${pctT.toFixed(0)}%)</span></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:2px;background:var(--red);display:inline-block"></span>
          <span>Rejected <strong>${pieRejected}</strong> <span style="color:var(--text-dim)">(${(100 - pctV - pctT).toFixed(0)}%)</span></span>
        </div>
      </div>
    </div>`;
  }

  body += `<h2>Validation Pipeline</h2>`;
  body += pieChart;
  body += `
  <div class="grid">
    <div class="card"><div class="card-title">Validated</div><div class="card-value" style="color:var(--green)">${vs.validated}</div></div>
    <div class="card"><div class="card-title">Latent</div><div class="card-value" style="color:var(--yellow)">${vs.latent}</div></div>
    <div class="card"><div class="card-title">Rejected</div><div class="card-value" style="color:var(--red)">${vs.rejected}</div></div>
  </div>`;

  // ---- Tensions ----
  body += `<h2>Tensions</h2>`;
  if (ts.total === 0) {
    body += `<p class="empty">No tensions recorded yet.</p>`;
  } else {
    body += `<div class="grid">
      <div class="card"><div class="card-title">Total</div><div class="card-value">${ts.total}</div></div>
      <div class="card"><div class="card-title">Unresolved</div><div class="card-value" style="color:var(--yellow)">${ts.unresolved}</div></div>
    </div>`;
    if (ts.top_urgency) {
      const t = ts.top_urgency;
      body += `<h3>Top Urgency Tension</h3>
      <div class="card">
        <div class="kv"><span class="kv-key">Type</span><span class="kv-val">${esc(t.type)}</span></div>
        <div class="kv"><span class="kv-key">Domain</span><span class="kv-val">${esc(t.domain)}</span></div>
        <div class="kv"><span class="kv-key">Urgency</span><span class="kv-val">${t.urgency}</span></div>
        <div class="kv"><span class="kv-key">Occurrences</span><span class="kv-val">${t.occurrences}</span></div>
        <div class="kv"><span class="kv-key">Description</span><span class="kv-val">${esc(t.description)}</span></div>
        <div class="kv"><span class="kv-key">Entities</span><span class="kv-val">${t.entities.map(esc).join(", ")}</span></div>
      </div>`;
    }
  }

  // ---- LLM ----
  const llm = status.llm;
  body += `<h2>LLM Provider</h2>
  <div class="card">
    <div class="kv"><span class="kv-key">Provider</span><span class="kv-val">${esc(llm?.provider ?? "none")}</span></div>
    <div class="kv"><span class="kv-key">Model</span><span class="kv-val">${esc(llm?.model ?? "—")}</span></div>
    <div class="kv"><span class="kv-key">Available</span><span class="kv-val">${llm?.available
      ? '<span class="badge badge-green">online</span>'
      : '<span class="badge badge-red">offline</span>'
    }</span></div>
  </div>`;

  // ---- Promotion / Decay ----
  body += `<h2>Promotion &amp; Decay</h2>
  <div class="grid">
    <div class="card">
      <div class="card-title">Promotion Config</div>
      ${Object.entries(status.promotion_config).map(([k, v]) =>
        `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${v}</span></div>`
      ).join("")}
    </div>
    <div class="card">
      <div class="card-title">Decay Config</div>
      ${Object.entries(status.decay_config).map(([k, v]) =>
        `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${v}</span></div>`
      ).join("")}
    </div>
  </div>`;

  // ---- Schedules (link to dedicated page) ----
  body += `<h2>Schedules</h2>
  <p><a href="/schedules">View and manage schedules →</a></p>`;

  return shell("Status", body, "status");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /health                                                */
/* ------------------------------------------------------------------ */

async function renderHealth(): Promise<string> {
  const status = await engine.getStatus();
  const llmCfg = getLlmConfig();
  const sessions = _ctx.getSessionCount();

  const checks = [
    { name: "Cognitive Engine", ok: true, detail: status.current_state.toUpperCase() },
    { name: "HTTP Sessions", ok: true, detail: `${sessions} active` },
    { name: "LLM Provider", ok: status.llm?.available ?? false, detail: `${llmCfg.provider} / ${llmCfg.model || "—"}` },
    { name: "Instance", ok: isInstanceMode(), detail: isInstanceMode() ? getActiveScope()!.uuid : "legacy" },
  ];

  const allOk = checks.every(c => c.ok);

  let body = `<h1>Health Check</h1>
  <div class="card" style="margin-bottom:24px">
    <div class="card-value" style="color:var(--${allOk ? "green" : "yellow"})">
      ${allOk ? "✓ HEALTHY" : "⚠ DEGRADED"}
    </div>
    <div class="card-sub">Transport: streamable-http · Sessions: ${sessions}</div>
  </div>
  <table>
    <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
    ${checks.map(c => `<tr>
      <td>${esc(c.name)}</td>
      <td>${c.ok
        ? '<span class="badge badge-green">pass</span>'
        : '<span class="badge badge-yellow">warn</span>'
      }</td>
      <td class="mono">${esc(c.detail)}</td>
    </tr>`).join("")}
  </table>
  <h2>JSON Endpoint</h2>
  <p style="color:var(--text-dim);margin-bottom:8px">
    For programmatic health checks, request with <code>Accept: application/json</code>:
  </p>
  <pre><code>curl -H "Accept: application/json" http://localhost:${_ctx.port}/health</code></pre>`;

  return shell("Health", body, "health");
}

/* ------------------------------------------------------------------ */
/*  Route: GET /schedules                                             */
/* ------------------------------------------------------------------ */

const SCHEDULE_ACTIONS: ScheduleAction[] = [
  "dream_cycle", "nightmare_cycle", "metacognitive_analysis",
  "dispatch_cognitive_event", "narrative_chapter", "federation_export",
  "graph_maintenance",
];

const TRIGGER_TYPES: ScheduleTriggerType[] = [
  "interval", "cron_like", "after_cycles", "on_idle",
];

/** Selectable dream strategies (used for dream_cycle & nightmare has its own enum) */
const DREAM_STRATEGIES: string[] = [
  "all",
  "gap_detection",
  "weak_reinforcement",
  "cross_domain",
  "missing_abstraction",
  "symmetry_completion",
  "tension_directed",
  "reflective",
  "causal_replay",
  "pgo_wave",
  "llm_dream",
];

async function renderSchedules(toast?: string): Promise<string> {
  const schedules = await safeAsync(() => getSchedules(), []);
  const recentExecs = await safeAsync(() => getScheduleHistory(undefined, 20), []);
  const schedCfg = getSchedulerConfig();

  let body = `<h1>Schedules</h1>`;

  // Toast message
  if (toast) {
    body += `<div class="toast">✓ ${esc(toast)}</div>`;
  }

  // Scheduler status card
  const activeCount = schedules.filter(s => s.enabled && s.status === "active").length;
  const errorCount = schedules.filter(s => s.status === "error").length;
  body += `<div class="grid">
    <div class="card">
      <div class="card-title">Total Schedules</div>
      <div class="card-value">${schedules.length}</div>
      <div class="card-sub">${activeCount} active, ${errorCount} in error</div>
    </div>
    <div class="card">
      <div class="card-title">Scheduler</div>
      <div class="card-value" style="color:var(--${schedCfg.enabled ? "green" : "red"})">${schedCfg.enabled ? "RUNNING" : "STOPPED"}</div>
      <div class="card-sub">Tick: ${fmtMs(schedCfg.tick_interval_ms)} · Max ${schedCfg.max_runs_per_hour}/hr</div>
    </div>
    <div class="card">
      <div class="card-title">Recent Executions</div>
      <div class="card-value">${recentExecs.length}</div>
      <div class="card-sub">${recentExecs.filter(e => !e.success).length} failures in last 20</div>
    </div>
  </div>`;

  // ---- Active Schedules Table ----
  body += `<h2>Active Schedules</h2>`;
  if (schedules.length === 0) {
    body += `<p class="empty">No schedules configured. Create one below.</p>`;
  } else {
    body += `<table>
      <tr>
        <th>Name</th><th>Action</th><th>Trigger</th><th>Status</th>
        <th>Runs</th><th>Next Run</th><th>Last Run</th><th>Actions</th>
      </tr>
      ${schedules.map(s => {
        const statusColor = s.status === "active" ? "green" :
          s.status === "paused" ? "yellow" :
          s.status === "error" ? "red" : "blue";
        const triggerDesc = s.trigger_type === "interval" && s.interval_ms
          ? `every ${fmtMs(s.interval_ms)}`
          : s.trigger_type === "after_cycles" && s.cycle_interval
          ? `every ${s.cycle_interval} cycles`
          : s.trigger_type === "on_idle" && s.idle_ms
          ? `after ${fmtMs(s.idle_ms)} idle`
          : s.trigger_type === "cron_like" && s.cron
          ? `cron: ${esc(s.cron)}`
          : esc(s.trigger_type);
        return `<tr>
          <td><strong>${esc(s.name)}</strong></td>
          <td><code>${esc(s.action)}</code></td>
          <td class="mono">${triggerDesc}</td>
          <td><span class="badge badge-${statusColor}">${esc(s.status)}</span></td>
          <td>${s.run_count}${s.max_runs !== null ? ` / ${s.max_runs}` : ""}</td>
          <td>${fmtTime(s.next_run_at)}</td>
          <td>${fmtTime(s.last_run_at)}</td>
          <td style="white-space:nowrap">
            <form method="POST" action="/schedules" style="display:inline">
              <input type="hidden" name="_action" value="toggle">
              <input type="hidden" name="id" value="${escAttr(s.id)}">
              <button type="submit" class="btn" style="padding:2px 8px;font-size:11px">${s.enabled ? "⏸ Pause" : "▶ Resume"}</button>
            </form>
            <form method="POST" action="/schedules" style="display:inline">
              <input type="hidden" name="_action" value="run_now">
              <input type="hidden" name="id" value="${escAttr(s.id)}">
              <button type="submit" class="btn" style="padding:2px 8px;font-size:11px">⚡ Run</button>
            </form>
            <form method="POST" action="/schedules" style="display:inline" onsubmit="return confirm('Delete schedule ${escAttr(s.name)}?')">
              <input type="hidden" name="_action" value="delete">
              <input type="hidden" name="id" value="${escAttr(s.id)}">
              <button type="submit" class="btn" style="padding:2px 8px;font-size:11px;color:var(--red)">✕</button>
            </form>
          </td>
        </tr>
        ${s.last_error ? `<tr><td colspan="8" style="color:var(--red);font-size:12px;padding:2px 10px 8px">⚠ ${esc(s.last_error)} (errors: ${s.error_count})</td></tr>` : ""}`;
      }).join("")}
    </table>`;
  }

  // ---- Create New Schedule ----
  body += `<h2>Create Schedule</h2>
  <div class="card">
    <form method="POST" action="/schedules" class="config-form">
      <input type="hidden" name="_action" value="create">
      <div class="form-row">
        <label>Name</label>
        <input name="name" required placeholder="e.g. Hourly Dream Cycle">
      </div>
      <div class="form-row">
        <label>Action</label>
        <select name="action">
          ${SCHEDULE_ACTIONS.map(a =>
            `<option value="${a}">${a}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-row">
        <label>Trigger Type</label>
        <select name="trigger_type" id="trigger_type" onchange="
          document.getElementById('interval_row').style.display = this.value === 'interval' ? 'flex' : 'none';
          document.getElementById('cron_row').style.display = this.value === 'cron_like' ? 'flex' : 'none';
          document.getElementById('cycles_row').style.display = this.value === 'after_cycles' ? 'flex' : 'none';
          document.getElementById('idle_row').style.display = this.value === 'on_idle' ? 'flex' : 'none';
        ">
          ${TRIGGER_TYPES.map(t =>
            `<option value="${t}">${t === "cron_like" ? "cron-like" : t.replace("_", " ")}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-row" id="interval_row">
        <label>Interval</label>
        <input name="interval_ms" type="number" min="5000" value="3600000" placeholder="ms">
        <span class="unit">ms</span>
      </div>
      <div class="form-row" id="cron_row" style="display:none">
        <label>Cron Expression (UTC)</label>
        <input name="cron" placeholder="0 6 * * *">
      </div>
      <div class="form-row" id="cycles_row" style="display:none">
        <label>Every N Cycles</label>
        <input name="cycle_interval" type="number" min="1" value="10">
      </div>
      <div class="form-row" id="idle_row" style="display:none">
        <label>Idle Timeout</label>
        <input name="idle_ms" type="number" min="10000" value="120000" placeholder="ms">
        <span class="unit">ms</span>
      </div>
      <div class="form-row">
        <label>Strategy</label>
        <select name="strategy">
          ${DREAM_STRATEGIES.map(s =>
            `<option value="${s}" ${s === "all" ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-row">
        <label>Max Runs</label>
        <input name="max_runs" type="number" min="0" value="0" placeholder="0 = unlimited">
        <span class="unit">0 = ∞</span>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Create Schedule</button>
      </div>
    </form>
  </div>`;

  // ---- Recent Execution History ----
  body += `<h2>Recent Executions</h2>`;
  if (recentExecs.length === 0) {
    body += `<p class="empty">No executions recorded yet.</p>`;
  } else {
    // Build a schedule-id → strategy lookup for the executions table
    const strategyMap = new Map<string, string>();
    for (const s of schedules) {
      strategyMap.set(s.id, (s.parameters?.strategy as string) ?? "all");
    }

    body += `<table>
      <tr><th>Schedule</th><th>Action</th><th>Strategy</th><th>Triggered</th><th>Duration</th><th>Result</th><th>Summary</th></tr>
      ${recentExecs.slice().reverse().map(e => {
        const strat = strategyMap.get(e.schedule_id) ?? "—";
        return `<tr>
        <td>${esc(e.schedule_name)}</td>
        <td><code>${esc(e.action)}</code></td>
        <td><code>${esc(strat)}</code></td>
        <td>${fmtTime(e.triggered_at)}</td>
        <td class="mono">${fmtMs(e.duration_ms)}</td>
        <td>${e.success
          ? '<span class="badge badge-green">ok</span>'
          : '<span class="badge badge-red">fail</span>'
        }</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(e.result_summary)}">${esc(truncate(e.result_summary, 80))}</td>
      </tr>`;
      }).join("")}
    </table>`;
  }

  return shell("Schedules", body, "schedules");
}

/* ------------------------------------------------------------------ */
/*  Route: POST /schedules                                            */
/* ------------------------------------------------------------------ */

async function handleSchedulePost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await parseFormBody(req);
  const action = body._action;
  let toast = "";

  try {
    switch (action) {
      case "toggle": {
        const id = body.id;
        const schedules = await getSchedules();
        const sched = schedules.find(s => s.id === id);
        if (sched) {
          await updateSchedule(id, { enabled: !sched.enabled });
          toast = `${sched.name} ${sched.enabled ? "paused" : "resumed"}`;
        }
        break;
      }
      case "run_now": {
        const id = body.id;
        const exec = await runScheduleNow(id);
        toast = `${exec.schedule_name} executed (${exec.success ? "success" : "failed"}, ${fmtMs(exec.duration_ms)})`;
        break;
      }
      case "delete": {
        const id = body.id;
        const schedules = await getSchedules();
        const sched = schedules.find(s => s.id === id);
        const deleted = await deleteSchedule(id);
        toast = deleted ? `Schedule "${sched?.name ?? id}" deleted` : `Schedule not found`;
        break;
      }
      case "create": {
        const triggerType = (body.trigger_type ?? "interval") as ScheduleTriggerType;
        const maxRuns = parseInt(body.max_runs ?? "0", 10);
        const strategy = body.strategy ?? "all";
        const created = await createSchedule({
          name: body.name ?? "Untitled",
          action: (body.action ?? "dream_cycle") as ScheduleAction,
          parameters: { strategy },
          trigger_type: triggerType,
          interval_ms: triggerType === "interval" ? parseInt(body.interval_ms ?? "3600000", 10) : undefined,
          cron: triggerType === "cron_like" ? body.cron : undefined,
          cycle_interval: triggerType === "after_cycles" ? parseInt(body.cycle_interval ?? "10", 10) : undefined,
          idle_ms: triggerType === "on_idle" ? parseInt(body.idle_ms ?? "120000", 10) : undefined,
          max_runs: maxRuns > 0 ? maxRuns : null,
          enabled: true,
        });
        toast = `Schedule "${created.name}" created`;
        break;
      }
      default:
        logger.warn(`Dashboard: Unknown schedule action "${action}"`);
    }
  } catch (err) {
    logger.error(`Dashboard: Schedule action "${action}" failed:`, err);
    toast = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  res.writeHead(303, {
    Location: `/schedules${toast ? `?toast=${encodeURIComponent(toast)}` : ""}`,
  });
  res.end();
}

/* ------------------------------------------------------------------ */
/*  Route: GET /config                                                */
/* ------------------------------------------------------------------ */

async function renderConfig(savedSection?: string): Promise<string> {
  const scope = getActiveScope();
  const llmCfg = getLlmConfig();
  const dreamerCfg = getDreamerLlmConfig();
  const normalizerCfg = getNormalizerLlmConfig();
  const schedCfg = getSchedulerConfig();
  const eventCfg = getEventConfig();
  const narrCfg = getNarrativeConfig();

  let body = `<h1>Configuration</h1>`;

  // Success toast after POST
  if (savedSection) {
    body += `<div class="toast">✓ ${esc(savedSection)} configuration saved successfully.</div>`;
  }

  // Restart server banner
  body += `<div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <div>
      <strong>Server Control</strong>
      <p style="color:var(--text-dim);margin:4px 0 0 0;font-size:0.85rem">
        All configuration changes are applied immediately (hot-reload). Use restart only if needed.
      </p>
    </div>
    <button type="button" class="btn btn-secondary" id="btn-restart" style="white-space:nowrap">Restart Server</button>
  </div>
  <script>
    document.getElementById('btn-restart').addEventListener('click', async function() {
      if (!confirm('Restart the DreamGraph server? The daemon manager will bring it back up automatically.')) return;
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Restarting…';
      try {
        await fetch('/restart', { method: 'POST' });
      } catch(e) { /* connection will drop */ }
      // Poll until the server comes back
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/health');
          if (r.ok) { clearInterval(poll); location.reload(); }
        } catch(e) { /* still restarting */ }
        if (attempts > 30) { clearInterval(poll); btn.textContent = 'Restart sent — refresh manually'; }
      }, 1000);
    });
  </script>`;

  // ---- Instance (read-only) ----
  body += `<h2>Instance</h2>
  <div class="card">
    <div class="kv"><span class="kv-key">Mode</span><span class="kv-val">${isInstanceMode() ? "UUID-scoped" : "Legacy (flat)"}</span></div>
    ${scope ? `
    <div class="kv"><span class="kv-key">UUID</span><span class="kv-val mono">${scope.uuid}</span></div>
    <div class="kv"><span class="kv-key">Project Root</span><span class="kv-val mono">${esc(scope.projectRoot ?? "—")}</span></div>
    <div class="kv"><span class="kv-key">Data Dir</span><span class="kv-val mono">${esc(scope.dataDir)}</span></div>
    <div class="kv"><span class="kv-key">Config Dir</span><span class="kv-val mono">${esc(scope.configDir)}</span></div>
    <div class="kv"><span class="kv-key">Logs Dir</span><span class="kv-val mono">${esc(scope.logsDir)}</span></div>
    ` : `
    <div class="kv"><span class="kv-key">Data Dir</span><span class="kv-val mono">${esc(config.dataDir)}</span></div>
    `}
  </div>`;

  // ---- Server (read-only) ----
  body += `<h2>Server</h2>
  <div class="card">
    <div class="kv"><span class="kv-key">Name</span><span class="kv-val">${config.server.name}</span></div>
    <div class="kv"><span class="kv-key">Version</span><span class="kv-val">${config.server.version}</span></div>
    <div class="kv"><span class="kv-key">Debug</span><span class="kv-val">${config.env.debug ? "true" : "false"}</span></div>
  </div>`;

  // ---- Repos (read-only) ----
  const repos = scope?.repos ?? config.repos;
  body += `<h2>Repos</h2>`;
  if (Object.keys(repos).length === 0) {
    body += `<p class="empty">No repositories configured.</p>`;
  } else {
    body += `<table>
      <tr><th>Alias</th><th>Path</th></tr>
      ${Object.entries(repos).map(([k, v]) =>
        `<tr><td><code>${esc(k)}</code></td><td class="mono">${esc(String(v))}</td></tr>`
      ).join("")}
    </table>`;
  }

  // ---- LLM (combined — Provider / Dreamer / Normalizer) ----

  // Pre-compute API key HTML — avoids nested template literal issues
  const effectiveApiKey = llmCfg.apiKey || process.env.DREAMGRAPH_LLM_API_KEY || "";
  const hasApiKey = effectiveApiKey.length > 0;
  const maskedApiKey = hasApiKey
    ? effectiveApiKey.length > 8
      ? effectiveApiKey.slice(0, 5) + "\u2022\u2022\u2022" + effectiveApiKey.slice(-4)
      : "\u2022\u2022\u2022\u2022" + effectiveApiKey.slice(-4)
    : "";
  const apiKeyBadge = hasApiKey
    ? '<span class="badge badge-green" style="margin-left:8px">set</span>'
      + '<span class="api-key-mask">' + esc(maskedApiKey) + '</span>'
    : '<span class="badge badge-red" style="margin-left:8px">not set</span>';
  const apiKeyPlaceholder = hasApiKey ? "(set \u2014 leave blank to keep)" : "sk-... or API key";

  body += `<h2>LLM</h2>
  <div class="section-group">

    <!-- Provider -->
    <div class="sub-section">
      <h3>Provider</h3>
      <form method="POST" action="/config" class="config-form">
        <input type="hidden" name="_section" value="llm">
        <div class="form-row">
          <label>Provider</label>
          <select name="provider">
            ${(["ollama", "openai", "anthropic", "sampling", "none"] as const).map(p =>
              `<option value="${p}" ${llmCfg.provider === p ? "selected" : ""}>${p}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-row">
          <label>Base URL</label>
          <input name="baseUrl" value="${escAttr(llmCfg.baseUrl)}" placeholder="e.g. http://localhost:11434">
        </div>
        <div class="form-row">
          <label>API Key</label>
          <div class="api-key-wrap">
            <input id="apiKeyInput" name="apiKey" type="password" value="" placeholder="${escAttr(apiKeyPlaceholder)}">
            <button type="button" class="api-key-toggle" onclick="var i=document.getElementById('apiKeyInput');if(i.type==='password'){i.type='text';this.textContent='Hide'}else{i.type='password';this.textContent='Show'}">Show</button>
          </div>
          ${apiKeyBadge}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save Provider</button>
        </div>
      </form>
    </div>

    <!-- Dreamer -->
    <div class="sub-section">
      <h3>Dreamer</h3>
      <p class="sub-desc">Creative settings for dream cycle generation.</p>
      <form method="POST" action="/config" class="config-form">
        <input type="hidden" name="_section" value="dreamer">
        <div class="form-row">
          <label>Model</label>
          <div style="display:flex;gap:8px;flex:1;align-items:center">
            <select id="dreamer-preset" style="flex:0 0 auto;min-width:140px" onchange="if(this.value){document.getElementById('dreamer-model').value=this.value}">
              <option value="">— preset —</option>
            </select>
            <input id="dreamer-model" name="model" value="${escAttr(dreamerCfg.model)}" placeholder="select or type model" style="flex:1">
          </div>
        </div>
        <div class="form-row">
          <label>Temperature</label>
          <input name="temperature" type="number" step="0.1" min="0" max="2" value="${dreamerCfg.temperature}">
        </div>
        <div class="form-row">
          <label>Max Tokens</label>
          <input name="maxTokens" type="number" min="256" max="65536" value="${dreamerCfg.maxTokens}">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save Dreamer</button>
        </div>
      </form>
    </div>

    <!-- Normalizer -->
    <div class="sub-section">
      <h3>Normalizer</h3>
      <p class="sub-desc">Precise settings for validation / truth-filter pass.</p>
      <form method="POST" action="/config" class="config-form">
        <input type="hidden" name="_section" value="normalizer">
        <div class="form-row">
          <label>Model</label>
          <div style="display:flex;gap:8px;flex:1;align-items:center">
            <select id="normalizer-preset" style="flex:0 0 auto;min-width:140px" onchange="if(this.value){document.getElementById('normalizer-model').value=this.value}">
              <option value="">— preset —</option>
            </select>
            <input id="normalizer-model" name="model" value="${escAttr(normalizerCfg.model)}" placeholder="select or type model" style="flex:1">
          </div>
        </div>
        <div class="form-row">
          <label>Temperature</label>
          <input name="temperature" type="number" step="0.1" min="0" max="2" value="${normalizerCfg.temperature}">
        </div>
        <div class="form-row">
          <label>Max Tokens</label>
          <input name="maxTokens" type="number" min="256" max="65536" value="${normalizerCfg.maxTokens}">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save Normalizer</button>
        </div>
      </form>
    </div>

    <!-- Model preset JS -->
    <script>
    (function() {
      const MODEL_PRESETS = {
        openai: [
          'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
          'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini',
        ],
        anthropic: [
          'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
          'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307',
        ],
        ollama: [
          'qwen3:8b', 'qwen3:4b', 'qwen3:1.7b', 'qwen3:32b',
          'llama3.1:8b', 'llama3.3:70b', 'mistral:7b',
          'deepseek-r1:8b', 'deepseek-r1:32b', 'gemma3:12b',
          'phi4:14b', 'codellama:13b',
        ],
        sampling: [],
        none: [],
      };
      const provider = '${llmCfg.provider}';
      const models = MODEL_PRESETS[provider] || [];
      ['dreamer-preset', 'normalizer-preset'].forEach(function(id) {
        const sel = document.getElementById(id);
        if (!sel) return;
        models.forEach(function(m) {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          sel.appendChild(opt);
        });
        // Pre-select if current value matches a preset
        const inputId = id.replace('-preset', '-model');
        const input = document.getElementById(inputId);
        if (input && models.includes(input.value)) {
          sel.value = input.value;
        }
      });
    })();
    </script>

  </div>`;

  // ---- Database (editable — connection string + test) ----
  const dbConnMasked = config.database.connectionString
    ? config.database.connectionString.replace(/\/\/([^:]+):([^@]+)@/, "//****:****@")
    : "";
  body += `<h2>Database</h2>
  <div class="card">
    <form method="POST" action="/config" class="config-form" id="db-form">
      <input type="hidden" name="_section" value="database">
      <div class="form-row">
        <label>Connection String</label>
        <input name="connectionString" value="${escAttr(config.database.connectionString)}" placeholder="postgresql://user:pass@host:5432/dbname" style="max-width:480px">
      </div>
      <div class="kv" style="padding:6px 0"><span class="kv-key">Masked</span><span class="kv-val">${dbConnMasked ? esc(dbConnMasked) : '<span class="badge badge-yellow">not set</span>'}</span></div>
      <div class="kv" style="padding:6px 0"><span class="kv-key">Max Connections</span><span class="kv-val">${config.database.maxConnections}</span></div>
      <div class="kv" style="padding:6px 0"><span class="kv-key">Statement Timeout</span><span class="kv-val">${fmtMs(config.database.statementTimeoutMs)}</span></div>
      <div class="kv" style="padding:6px 0;border-bottom:none"><span class="kv-key">Operation Timeout</span><span class="kv-val">${fmtMs(config.database.operationTimeoutMs)}</span></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-secondary" id="btn-test-db">Test Connection</button>
      </div>
    </form>
    <div id="db-test-result" class="db-test-result"></div>
  </div>
  <script>
    document.getElementById('btn-test-db').addEventListener('click', async function() {
      const btn = this;
      const res_el = document.getElementById('db-test-result');
      const connInput = document.querySelector('#db-form input[name="connectionString"]');
      btn.disabled = true;
      btn.textContent = 'Testing…';
      res_el.className = 'db-test-result';
      res_el.style.display = 'none';
      try {
        const r = await fetch('/config/test-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionString: connInput.value })
        });
        const j = await r.json();
        res_el.textContent = j.ok
          ? '✓ ' + j.message + ' (' + j.latencyMs + 'ms)'
          : '✗ ' + j.message + (j.latencyMs ? ' (' + j.latencyMs + 'ms)' : '');
        res_el.className = 'db-test-result ' + (j.ok ? 'ok' : 'fail');
      } catch(e) {
        res_el.textContent = '✗ Request failed: ' + e.message;
        res_el.className = 'db-test-result fail';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
      }
    });
  </script>`;

  // ---- Scheduler (editable) ----
  body += `<h2>Scheduler</h2>
  <div class="card">
    <form method="POST" action="/config" class="config-form">
      <input type="hidden" name="_section" value="scheduler">
      <div class="form-row">
        <label>Enabled</label>
        <select name="enabled">
          <option value="true" ${schedCfg.enabled ? "selected" : ""}>true</option>
          <option value="false" ${!schedCfg.enabled ? "selected" : ""}>false</option>
        </select>
      </div>
      <div class="form-row">
        <label>Tick Interval</label>
        <input name="tick_interval_ms" type="number" min="1000" value="${schedCfg.tick_interval_ms}">
        <span class="unit">ms</span>
      </div>
      <div class="form-row">
        <label>Max Runs / Hour</label>
        <input name="max_runs_per_hour" type="number" min="1" max="1000" value="${schedCfg.max_runs_per_hour}">
      </div>
      <div class="form-row">
        <label>Global Cooldown</label>
        <input name="global_cooldown_ms" type="number" min="0" value="${schedCfg.global_cooldown_ms}">
        <span class="unit">ms</span>
      </div>
      <div class="form-row">
        <label>Nightmare Cooldown</label>
        <input name="nightmare_cooldown_ms" type="number" min="0" value="${schedCfg.nightmare_cooldown_ms}">
        <span class="unit">ms</span>
      </div>
      <div class="form-row">
        <label>Max Error Streak</label>
        <input name="max_error_streak" type="number" min="1" max="100" value="${schedCfg.max_error_streak}">
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save Scheduler</button>
      </div>
    </form>
  </div>`;

  // ---- Events (editable) ----
  body += `<h2>Event Router</h2>
  <div class="card">
    <form method="POST" action="/config" class="config-form">
      <input type="hidden" name="_section" value="events">
      <div class="form-row">
        <label>Tension Threshold</label>
        <input name="tension_threshold" type="number" step="0.05" min="0" max="1" value="${eventCfg.tension_threshold}">
      </div>
      <div class="form-row">
        <label>Runtime Error Threshold</label>
        <input name="runtime_error_threshold" type="number" step="0.01" min="0" max="1" value="${eventCfg.runtime_error_threshold}">
      </div>
      <div class="form-row">
        <label>Cooldown</label>
        <input name="cooldown_ms" type="number" min="0" value="${eventCfg.cooldown_ms}">
        <span class="unit">ms</span>
      </div>
      <div class="form-row">
        <label>Max Auto Cycles / Hour</label>
        <input name="max_auto_cycles_per_hour" type="number" min="1" max="100" value="${eventCfg.max_auto_cycles_per_hour}">
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save Events</button>
      </div>
    </form>
  </div>`;

  // ---- Narrative (editable) ----
  body += `<h2>Narrative</h2>
  <div class="card">
    <form method="POST" action="/config" class="config-form">
      <input type="hidden" name="_section" value="narrative">
      <div class="form-row">
        <label>Auto Narrate</label>
        <select name="auto_narrate">
          <option value="true" ${narrCfg.auto_narrate ? "selected" : ""}>true</option>
          <option value="false" ${!narrCfg.auto_narrate ? "selected" : ""}>false</option>
        </select>
      </div>
      <div class="form-row">
        <label>Narrative Interval</label>
        <input name="narrative_interval" type="number" min="1" value="${narrCfg.narrative_interval}">
        <span class="unit">cycles</span>
      </div>
      <div class="form-row">
        <label>Digest Interval</label>
        <input name="digest_interval" type="number" min="1" value="${narrCfg.digest_interval}">
        <span class="unit">cycles</span>
      </div>
      <div class="form-row">
        <label>Max Chapters</label>
        <input name="max_chapters" type="number" min="10" value="${narrCfg.max_chapters}">
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save Narrative</button>
      </div>
    </form>
  </div>`;

  return shell("Config", body, "config");
}

/* ------------------------------------------------------------------ */
/*  Route: POST /config                                               */
/* ------------------------------------------------------------------ */

async function handleConfigPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await parseFormBody(req);
  const section = body._section;

  try {
    switch (section) {
      case "llm": {
        // Resolve API key: if user sent a real value use it, otherwise preserve existing.
        // Check BOTH in-memory config and process.env — the latter survives provider switches
        // (ollama→openai) where the in-memory LlmConfig.apiKey was "" for ollama.
        const sentKey = body.apiKey ?? "";
        const isPlaceholder = sentKey === "" || sentKey === "••••••••";
        const resolvedKey = isPlaceholder
          ? (getLlmConfig().apiKey || process.env.DREAMGRAPH_LLM_API_KEY || "")
          : sentKey;

        // Persist to process.env so the key survives in-memory config switches
        if (resolvedKey) {
          process.env.DREAMGRAPH_LLM_API_KEY = resolvedKey;
        }

        const newCfg: LlmConfig = {
          provider: (body.provider ?? "none") as LlmConfig["provider"],
          model: getLlmConfig().model, // preserve — edited via dreamer/normalizer sections
          baseUrl: body.baseUrl ?? getLlmConfig().baseUrl,
          apiKey: resolvedKey,
          temperature: getLlmConfig().temperature,
          maxTokens: getLlmConfig().maxTokens,
        };
        initLlmProvider(newCfg);
        logger.info(`Dashboard: LLM provider config updated via web UI (provider=${newCfg.provider}, apiKey=${resolvedKey ? "set" : "NOT SET"})`);
        persistLlmEngineEnv();
        break;
      }
      case "dreamer": {
        updateDreamerLlmConfig({
          model: body.model ?? getDreamerLlmConfig().model,
          temperature: parseFloat(body.temperature ?? "0.9"),
          maxTokens: parseInt(body.maxTokens ?? "4096", 10),
        });
        logger.info("Dashboard: Dreamer LLM config updated via web UI");
        persistLlmEngineEnv();
        break;
      }
      case "normalizer": {
        updateNormalizerLlmConfig({
          model: body.model ?? getNormalizerLlmConfig().model,
          temperature: parseFloat(body.temperature ?? "0.1"),
          maxTokens: parseInt(body.maxTokens ?? "1024", 10),
        });
        logger.info("Dashboard: Normalizer LLM config updated via web UI");
        persistLlmEngineEnv();
        break;
      }
      case "scheduler": {
        updateSchedulerConfig({
          enabled: body.enabled === "true",
          tick_interval_ms: parseInt(body.tick_interval_ms ?? "30000", 10),
          max_runs_per_hour: parseInt(body.max_runs_per_hour ?? "30", 10),
          global_cooldown_ms: parseInt(body.global_cooldown_ms ?? "10000", 10),
          nightmare_cooldown_ms: parseInt(body.nightmare_cooldown_ms ?? "300000", 10),
          max_error_streak: parseInt(body.max_error_streak ?? "3", 10),
        });
        logger.info("Dashboard: Scheduler config updated via web UI");
        break;
      }
      case "events": {
        updateEventConfig({
          tension_threshold: parseFloat(body.tension_threshold ?? "0.8"),
          runtime_error_threshold: parseFloat(body.runtime_error_threshold ?? "0.05"),
          cooldown_ms: parseInt(body.cooldown_ms ?? "60000", 10),
          max_auto_cycles_per_hour: parseInt(body.max_auto_cycles_per_hour ?? "10", 10),
        });
        logger.info("Dashboard: Event router config updated via web UI");
        break;
      }
      case "narrative": {
        updateNarrativeConfig({
          auto_narrate: body.auto_narrate === "true",
          narrative_interval: parseInt(body.narrative_interval ?? "10", 10),
          digest_interval: parseInt(body.digest_interval ?? "50", 10),
          max_chapters: parseInt(body.max_chapters ?? "100", 10),
        });
        logger.info("Dashboard: Narrative config updated via web UI");
        break;
      }
      case "database": {
        const connStr = body.connectionString ?? "";
        updateDatabaseConnectionString(connStr);
        // Reset pool so next DB query uses the new connection string
        await resetDbPool();
        logger.info("Dashboard: Database connection string updated via web UI");
        break;
      }
      default:
        logger.warn(`Dashboard: Unknown config section "${section}"`);
    }
  } catch (err) {
    logger.error(`Dashboard: Config update failed for section "${section}":`, err);
  }

  // PRG — redirect back to config with a success indicator
  res.writeHead(303, {
    Location: `/config?saved=${encodeURIComponent(section ?? "")}`,
  });
  res.end();
}

/* ------------------------------------------------------------------ */
/*  Route: POST /config/test-db                                       */
/* ------------------------------------------------------------------ */

async function handleTestDbPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Read JSON body
  let connStr = "";
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
    const parsed = JSON.parse(raw);
    connStr = parsed.connectionString ?? "";
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Invalid request body.", latencyMs: 0 }));
    return;
  }

  const result = await testDbConnection(connStr || undefined);

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(result));
}

/* ------------------------------------------------------------------ */
/*  Route: POST /restart                                              */
/* ------------------------------------------------------------------ */

async function handleRestartPost(res: ServerResponse): Promise<void> {
  // Acknowledge before shutdown so the browser gets a response
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, message: "Server restarting…" }));

  logger.info("Dashboard: Restart requested via web UI — exiting process");

  // Small delay to ensure the response is flushed
  setTimeout(() => {
    process.exit(0);
  }, 200);
}

/* ------------------------------------------------------------------ */
/*  Route: GET /docs — Native Markdown Viewer                         */
/* ------------------------------------------------------------------ */

/** Resolve the project-root docs/ directory from the active instance */
function docsDir(): string {
  const scope = getActiveScope();
  if (scope?.projectRoot) {
    return resolve(scope.projectRoot, "docs");
  }
  // Legacy / fallback: dataDir is typically <project>/data, so go up one level
  return resolve(config.dataDir, "..", "docs");
}

/**
 * Zero-dependency Markdown → HTML converter.
 * Handles: headings, paragraphs, fenced code blocks, inline code,
 * bold, italic, links, images, unordered/ordered lists, tables,
 * blockquotes, horizontal rules, and line breaks.
 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;

  function closeList(): void {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  }

  function inline(text: string): string {
    return text
      // Images (must come before links)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Bold+italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Line break (two trailing spaces)
      .replace(/  $/, "<br>");
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      closeList();
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const langAttr = lang ? ` data-lang="${esc(lang)}"` : "";
      const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : "";
      out.push(`<div class="code-block">${langLabel}<pre${langAttr}><code>${esc(codeLines.join("\n"))}</code></pre></div>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\s+#+\s*$/, ""); // strip trailing #
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Table (detect header row + separator)
    if (i + 1 < lines.length && /^\|(.+)\|$/.test(line.trim()) && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const parseRow = (row: string): string[] =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const headers = parseRow(line);
      i += 2; // skip header + separator
      out.push("<table><thead><tr>");
      for (const h of headers) out.push(`<th>${inline(h)}</th>`);
      out.push("</tr></thead><tbody>");
      while (i < lines.length && /^\|(.+)\|$/.test(lines[i].trim())) {
        const cells = parseRow(lines[i]);
        out.push("<tr>");
        for (let c = 0; c < headers.length; c++) {
          out.push(`<td>${inline(cells[c] ?? "")}</td>`);
        }
        out.push("</tr>");
        i++;
      }
      out.push("</tbody></table>");
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      closeList();
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${markdownToHtml(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; }
      out.push(`<li>${inline(line.replace(/^[-*+]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(line)) {
      if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; }
      out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    closeList();
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith("> ") && !/^[-*+]\s+/.test(lines[i]) && !/^\d+[.)]\s+/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) && !/^\|(.+)\|$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.map(l => inline(l)).join("\n")}</p>`);
    }
  }

  closeList();
  return out.join("\n");
}

/** Additional CSS for the markdown viewer */
const MD_CSS = `
  .docs-layout { display: grid; grid-template-columns: 220px 1fr; gap: 32px; }
  .docs-sidebar { position: sticky; top: 80px; align-self: start; }
  .docs-sidebar a {
    display: block; padding: 6px 12px; border-radius: 6px;
    color: var(--text-dim); font-size: 13px; transition: all .15s;
  }
  .docs-sidebar a:hover { color: var(--text); background: var(--border); text-decoration: none; }
  .docs-sidebar a.active { color: var(--accent); background: rgba(88,166,255,.1); font-weight: 600; }
  .docs-content { min-width: 0; }
  .docs-content h1 { font-size: 28px; margin-bottom: 8px; }
  .docs-content h2 { font-size: 20px; margin: 28px 0 10px; }
  .docs-content h3 { font-size: 16px; margin: 20px 0 8px; color: var(--text); }
  .docs-content h4 { font-size: 14px; margin: 16px 0 6px; color: var(--text-dim); }
  .docs-content p { margin: 8px 0; line-height: 1.65; }
  .docs-content ul, .docs-content ol { margin: 8px 0 8px 24px; }
  .docs-content li { margin: 4px 0; line-height: 1.6; }
  .docs-content blockquote {
    border-left: 3px solid var(--accent); margin: 12px 0; padding: 8px 16px;
    background: rgba(88,166,255,.05); color: var(--text-dim);
  }
  .docs-content hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
  .docs-content table { margin: 12px 0; }
  .docs-content img { border-radius: 6px; margin: 8px 0; }
  .code-block { position: relative; margin: 12px 0; }
  .code-block pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px; overflow-x: auto; font-size: 12px; }
  .code-lang {
    position: absolute; top: 4px; right: 8px; font-size: 10px;
    color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em;
  }
  @media (max-width: 720px) {
    .docs-layout { grid-template-columns: 1fr; }
    .docs-sidebar { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  }
`;

/** Friendly display name from filename */
function docTitle(filename: string): string {
  const name = basename(filename, extname(filename));
  if (name === "README") return "Overview";
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Sort order for doc files — README first, then alphabetical */
function docOrder(a: string, b: string): number {
  if (a === "README.md") return -1;
  if (b === "README.md") return 1;
  return a.localeCompare(b);
}

async function getDocFiles(): Promise<string[]> {
  try {
    const entries = await readdir(docsDir());
    return entries
      .filter(f => f.endsWith(".md"))
      .sort(docOrder);
  } catch {
    return [];
  }
}

async function renderDocs(): Promise<string> {
  const files = await getDocFiles();
  if (files.length === 0) {
    return shell("Docs", `<h1>Documentation</h1><p class="empty">No markdown files found in docs/ directory.</p>`, "docs");
  }
  // Default to README.md
  return renderDocFile(files[0], files);
}

async function renderDocFile(filename: string, files?: string[]): Promise<string> {
  if (!files) files = await getDocFiles();

  // Security: only allow .md files from the docs dir
  const safeName = basename(filename);
  if (!safeName.endsWith(".md") || safeName.includes("..")) {
    return shell("Not Found", `<h1>Not Found</h1><p><a href="/docs">Back to Docs</a></p>`, "docs");
  }

  let content: string;
  try {
    content = await readFile(resolve(docsDir(), safeName), "utf-8");
  } catch {
    return shell("Not Found", `<h1>File not found</h1><p><code>${esc(safeName)}</code> does not exist.</p><p><a href="/docs">Back to Docs</a></p>`, "docs");
  }

  const sidebar = files.map(f => {
    const active = f === safeName ? " active" : "";
    return `<a href="/docs/${encodeURIComponent(basename(f, ".md"))}\" class="${active}">${docTitle(f)}</a>`;
  }).join("\n");

  const rendered = markdownToHtml(content);
  const title = docTitle(safeName);

  const body = `
    <style>${MD_CSS}</style>
    <div class="docs-layout">
      <nav class="docs-sidebar">${sidebar}</nav>
      <article class="docs-content">${rendered}</article>
    </div>`;

  return shell(`Docs: ${title}`, body, "docs");
}

/* ------------------------------------------------------------------ */
/*  Route dispatcher                                                  */
/* ------------------------------------------------------------------ */

/**
 * Try to handle a dashboard route.
 * Returns true if the route was handled, false if it should fall through.
 */
export async function handleDashboardRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // POST handlers — apply changes, then redirect
  if (req.method === "POST" && pathname === "/config") {
    await handleConfigPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/config/test-db") {
    await handleTestDbPost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/schedules") {
    await handleSchedulePost(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/restart") {
    await handleRestartPost(res);
    return true;
  }

  // Only GET for all other dashboard pages
  if (req.method !== "GET") return false;

  let html: string;
  try {
    switch (pathname) {
      case "/":
        html = await renderIndex();
        break;
      case "/status":
        html = await renderStatus();
        break;
      case "/schedules": {
        const url = new URL(req.url ?? "/", "http://localhost");
        const toast = url.searchParams.get("toast") ?? undefined;
        html = await renderSchedules(toast);
        break;
      }
      case "/config": {
        const url = new URL(req.url ?? "/", "http://localhost");
        const savedSection = url.searchParams.get("saved") ?? undefined;
        html = await renderConfig(savedSection);
        break;
      }
      case "/docs":
        html = await renderDocs();
        break;
      case "/health":
        html = await renderHealth();
        break;
      default:
        // /docs/:slug — render a specific markdown file
        if (pathname.startsWith("/docs/")) {
          const slug = decodeURIComponent(pathname.slice(6));
          if (slug && !slug.includes("/") && !slug.includes("..")) {
            html = await renderDocFile(`${slug}.md`);
            break;
          }
        }
        return false;
    }
  } catch (err) {
    logger.error("Dashboard render error:", err);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(shell("Error", `<h1>Internal Error</h1><pre>${esc(String(err))}</pre>`, ""));
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(html);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** HTML-escape for element content. Null-safe — coerces any input to string. */
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML-escape for attribute values (double-quoted). Null-safe. */
function escAttr(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
  } catch {
    return iso;
  }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "complete" || s === "implemented") return `<span class="badge badge-green">${esc(status)}</span>`;
  if (s === "planned" || s === "pending" || s === "in_progress") return `<span class="badge badge-yellow">${esc(status)}</span>`;
  if (s === "deprecated" || s === "removed") return `<span class="badge badge-red">${esc(status)}</span>`;
  return `<span class="badge badge-blue">${esc(status)}</span>`;
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Parse a URL-encoded form body from an HTTP request. */
function parseFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try {
        const params = new URLSearchParams(data);
        const result: Record<string, string> = {};
        for (const [k, v] of params) result[k] = v;
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
