/**
 * DreamGraph Tool Group Whitelisting (Layer 1 → Layer 2 plumbing).
 *
 * Selects a small intent-appropriate subset of MCP+local tools to send with each
 * LLM request, instead of dumping all 69+ tool schemas (≈82 KB / ≈20k tokens) on
 * every call. Sending fewer tool schemas is the single largest input-token saving
 * available — schemas are sent on every pass of the agentic loop, multiplying the
 * cost across long conversations.
 *
 * Strategy: small default toolsets keyed by inferred ArchitectTask + a heuristic
 * keyword scan of the user prompt. Unknown tools (3rd-party MCP servers etc.) are
 * passed through untouched so we never silently break a user's setup.
 *
 * @see plans/cost-explosion-2026-04-25 for the diagnosis that motivated this.
 */

import type { ArchitectTask } from './prompts/index.js';

/* ------------------------------------------------------------------ */
/*  Group definitions — keep names exact; matched against tool.name   */
/* ------------------------------------------------------------------ */

export const TOOL_GROUPS = {
  /** Reads — always available. Cheap, safe. */
  core_read: [
    'query_resource',
    'graph_rag_retrieve',
    'query_api_surface',
    'read_source_code',
    'list_directory',
    'read_local_file',
  ],

  /** File writes — only when intent is clearly mutating. */
  core_write: [
    'edit_file',
    'create_file',
    'rename_file',
    'delete_file',
    'write_file',
    'modify_entity',
    'run_command',
  ],

  /** Graph mutations — knowledge-graph editing. */
  graph_write: [
    'enrich_seed_data',
    'solidify_cognitive_insight',
    'register_ui_element',
    'modify_api_surface',
    'edit_entity',
  ],

  /** ADR lifecycle. */
  adr: [
    'record_architecture_decision',
    'query_architecture_decisions',
    'deprecate_architecture_decision',
  ],

  /** Cognitive read-only inspection. */
  cognitive_read: [
    'cognitive_status',
    'get_dream_insights',
    'query_dreams',
    'get_causal_insights',
    'get_temporal_insights',
    'get_system_narrative',
    'get_system_story',
    'get_cognitive_preamble',
    'get_remediation_plan',
    'query_self_metrics',
  ],

  /** Cognitive run / mutate. */
  cognitive_run: [
    'dream_cycle',
    'normalize_dreams',
    'nightmare_cycle',
    'lucid_dream',
    'lucid_action',
    'wake_from_lucid',
  ],

  /** Scheduling. */
  scheduler: [
    'schedule_dream',
    'list_schedules',
    'update_schedule',
    'run_schedule_now',
    'delete_schedule',
    'get_schedule_history',
  ],

  /** Project bootstrap / scanning — heavy operations. */
  project_scan: [
    'init_graph',
    'scan_project',
    'extract_api_surface',
  ],

  /** Documentation + visualization output. */
  docs_visuals: [
    'generate_visual_flow',
    'export_living_docs',
    'generate_ui_migration_plan',
    'export_dream_archetypes',
  ],

  /** Ops / debug introspection. */
  ops_debug: [
    'query_self_metrics',
    'query_runtime_metrics',
    'query_db_schema',
    'git_log',
    'git_blame',
    'fetch_web_page',
  ],

  /** Disciplined-execution session. */
  discipline: [
    'discipline_start_session',
    'discipline_transition',
    'discipline_check_tool',
    'discipline_get_session',
    'discipline_record_delta',
    'discipline_submit_plan',
    'discipline_approve_plan',
    'discipline_verify',
    'discipline_complete_session',
  ],

  /** Dangerous maintenance — never default. */
  maintenance_dangerous: [
    'clear_dreams',
    'import_dream_archetypes',
    'dispatch_cognitive_event',
    'metacognitive_analysis',
    'init_graph',
  ],
} as const;

export type ToolGroupKey = keyof typeof TOOL_GROUPS;

/* ------------------------------------------------------------------ */
/*  Hard caps                                                         */
/* ------------------------------------------------------------------ */

export const MAX_TOOLS_DEFAULT = 8;
export const MAX_TOOLS_MUTATION = 14;
export const MAX_TOOLS_AUTONOMY = 20;

/* ------------------------------------------------------------------ */
/*  Intent → group selection                                          */
/* ------------------------------------------------------------------ */

const PATCH_KEYWORDS = [
  'fix', 'patch', 'edit', 'change', 'modify', 'update', 'refactor',
  'implement', 'rewrite', 'rename', 'remove', 'replace', 'delete',
  'make it compile', 'make build pass', 'build pass', 'compile',
  'add support', 'create a', 'add a', 'insert', 'merge', 'repair',
  'write file', 'file write', 'edit file', 'modify file', 'update file',
  'add file', 'create file', 'rewrite file', 'replace file', 'delete file',
  'rename file', 'change file', 'update path', 'change path', 'path',
];

const EXECUTION_KEYWORDS = [
  'run command', 'run a command', 'shell command', 'shell-capable session',
  'terminal', 'powershell', 'bash', 'cmd', 'ripgrep', 'grep', 'rg ',
  'repo-wide search', 'search the repo', 'find callers', 'run npm',
  'npm run', 'pnpm', 'yarn', 'build', 'test', 'lint', 'commandline', 'execute',
];

const GRAPH_WRITE_KEYWORDS = [
  'update dreamgraph', 'update the dreamgraph', 'update knowledge graph',
  'enrich', 'enrich seed', 'register entity', 'add entity', 'edit entity',
  'modify entity', 'seed data', 'capture decision', 'record adr',
  'document decision', 'add adr', 'log adr', 'graph node',
  'register ui', 'scan ui', 'ui element', 'ui_registry', 'ui registry',
  'graph update', 'graph mutation', 'update the graph', 'sync the graph',
  'feature status', 'workflow status', 'transitional status', 'in-progress',
  'in progress', 'under construction', 'completion status', '4/6',
  'modify api surface', 'modify_api_surface', 'register api', 'add api',
  'solidify insight', 'solidify_cognitive_insight',
];

const COGNITIVE_RUN_KEYWORDS = [
  // High-level commands.
  'dream cycle', 'dream_cycle', 'run a dream', 'run dream', 'trigger dream',
  'start dream', 'kick off a dream', 'kick off dream', 'retry dream',
  'normalize dreams', 'normalize_dreams', 'nightmare', 'nightmare_cycle',
  'lucid', 'lucid_dream', 'lucid_action', 'wake_from_lucid', 'wake from lucid',
  // Generic cognitive vocabulary.
  'cognitive', 'cognition', 'rem ', 'rem-only', 'rem state', 'awake state',
  'wake state', 'cognitive state', 'cognitive cycle', 'cognitive violation',
  'state machine', 'state violation',
  // Strategy names — every dream strategy currently in the graph.
  'llm_dream', 'llm dream', 'gap_detection', 'gap detection',
  'weak_reinforcement', 'weak reinforcement', 'cross_domain', 'cross domain',
  'missing_abstraction', 'missing abstraction', 'symmetry_completion',
  'symmetry completion', 'tension_directed', 'tension directed',
  'causal_replay', 'causal replay', 'reflective', 'pgo_wave', 'pgo wave',
  'orphan_bridging', 'orphan bridging', 'schema_grounding', 'schema grounding',
  // Scheduling vocabulary.
  'schedule', 'unschedule', 'scheduled dream', 'cron',
];

const DOCS_KEYWORDS = [
  'export docs', 'living doc', 'living docs', 'export_living_docs',
  'mermaid', 'diagram', 'visualize', 'visualise', 'visual flow',
  'generate visual', 'generate_visual_flow', 'render diagram', 'archetype',
  'dream archetype', 'export archetype', 'export_dream_archetypes',
  'autodocs', 'auto docs', 'ui migration', 'migration plan',
  'generate_ui_migration_plan',
];

const DISCIPLINE_KEYWORDS = [
  'discipline session', 'discipline_start_session', 'disciplined execution',
  'tdd session', 'plan-do-verify', 'plan do verify', 'plan and verify',
  'discipline transition', 'discipline_transition', 'submit plan',
  'approve plan', 'discipline_check_tool', 'discipline_verify',
];

const PROJECT_SCAN_KEYWORDS = [
  'scan', 'rescan', 're-scan', 'scan project', 'scan_project',
  'init graph', 'init_graph', 'rebuild graph', 'refresh graph',
  'reindex', 're-index', 'bootstrap graph', 'bootstrap the graph',
  'extract api surface', 'extract_api_surface', 'api surface',
  'scan datastore', 'datastore scan', 'datastores/scan',
];

function _hasAny(prompt: string, keywords: string[]): boolean {
  const lower = prompt.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

export interface ToolSelectionDecision {
  /** Names of selected tools (in priority order). */
  selected: string[];
  /** Group keys that contributed. */
  groups: ToolGroupKey[];
  /** Whether write tools were included. */
  mutating: boolean;
  /** Whether autonomy is engaged (raises cap). */
  autonomy: boolean;
  /** Human-readable rationale for the inspector channel. */
  rationale: string;
}

/**
 * Select an intent-appropriate subset of tool names.
 *
 * Returns *names*; the caller filters its full ToolDefinition[] against this set.
 * Tools that exist but don't match any group are kept as a small "passthrough"
 * tail (up to the cap) so 3rd-party MCP tools still work — but never crowd out
 * the curated selection.
 */
export function selectToolGroups(args: {
  task: ArchitectTask;
  intentMode?: string;
  prompt: string;
  autonomy: boolean;
  availableToolNames: string[];
}): ToolSelectionDecision {
  const { task, prompt, autonomy, availableToolNames } = args;
  const groups: ToolGroupKey[] = [];
  let mutating = false;
  const reasons: string[] = [];

  // Always include core_read.
  groups.push('core_read');

  const isPatchKeyword = _hasAny(prompt, PATCH_KEYWORDS);

  switch (task) {
    case 'patch':
      groups.push('core_write');
      mutating = true;
      reasons.push("task=patch → core_write");
      break;
    case 'validate':
      // Read-only validation — no writes.
      groups.push('cognitive_read');
      reasons.push('task=validate → cognitive_read');
      break;
    case 'suggest':
    case 'explain':
      reasons.push(`task=${task} → core_read only`);
      break;
    case 'chat':
    default:
      reasons.push(`task=${task} → core_read baseline`);
      break;
  }

  // Keyword overlays (additive).
  if (isPatchKeyword && !mutating) {
    groups.push('core_write');
    mutating = true;
    reasons.push('keyword[patch] → core_write');
  }
  if (_hasAny(prompt, EXECUTION_KEYWORDS) && !mutating) {
    groups.push('core_write');
    mutating = true;
    reasons.push('keyword[execution] → core_write');
  }
  if (_hasAny(prompt, GRAPH_WRITE_KEYWORDS)) {
    groups.push('graph_write', 'adr');
    mutating = true;
    reasons.push('keyword[graph_write] → graph_write+adr');
  }
  if (_hasAny(prompt, COGNITIVE_RUN_KEYWORDS)) {
    groups.push('cognitive_read', 'cognitive_run', 'scheduler');
    reasons.push('keyword[cognitive] → cognitive_read+cognitive_run+scheduler');
  }
  if (_hasAny(prompt, DOCS_KEYWORDS)) {
    groups.push('docs_visuals');
    reasons.push('keyword[docs] → docs_visuals');
  }
  if (_hasAny(prompt, DISCIPLINE_KEYWORDS)) {
    groups.push('discipline');
    reasons.push('keyword[discipline] → discipline');
  }
  if (_hasAny(prompt, PROJECT_SCAN_KEYWORDS)) {
    groups.push('project_scan', 'graph_write', 'cognitive_read');
    mutating = true;
    reasons.push('keyword[project_scan] → project_scan+graph_write+cognitive_read');
  }

  // Autonomy mode: include ops_debug + adr for richer reasoning.
  if (autonomy) {
    groups.push('ops_debug', 'adr');
    reasons.push('autonomy=on → ops_debug+adr');
  }

  // Compute candidate names from the (de-duplicated) selected groups.
  const uniqueGroups = Array.from(new Set(groups));
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const g of uniqueGroups) {
    for (const name of TOOL_GROUPS[g]) {
      if (!seen.has(name)) {
        seen.add(name);
        candidates.push(name);
      }
    }
  }

  // Filter to what's actually available (case-insensitive guard against minor naming drift).
  const availableSet = new Set(availableToolNames);
  let selected = candidates.filter((n) => availableSet.has(n));

  // Direct tool-name mention overlay — if the user explicitly named a tool in the
  // prompt (e.g. "run scan_project", "call enrich_seed_data"), force it in even
  // if no keyword group matched. Prevents the whitelist from silently hiding
  // tools the user is asking for by name.
  const lowerPrompt = prompt.toLowerCase();
  for (const toolName of availableToolNames) {
    if (lowerPrompt.includes(toolName.toLowerCase()) && !selected.includes(toolName)) {
      selected.unshift(toolName);
      reasons.push(`name-mention[${toolName}]`);
    }
  }

  // Apply cap.
  const cap = autonomy ? MAX_TOOLS_AUTONOMY : mutating ? MAX_TOOLS_MUTATION : MAX_TOOLS_DEFAULT;
  if (selected.length > cap) {
    reasons.push(`cap=${cap} (truncated from ${selected.length})`);
    selected = selected.slice(0, cap);
  }

  // Passthrough for unrecognized tools (e.g. 3rd-party MCP) — only if room left.
  const knownAll = new Set<string>();
  for (const list of Object.values(TOOL_GROUPS)) {
    for (const name of list) knownAll.add(name);
  }
  const unknown = availableToolNames.filter((n) => !knownAll.has(n) && !selected.includes(n));
  const room = cap - selected.length;
  if (room > 0 && unknown.length > 0) {
    const passthrough = unknown.slice(0, room);
    selected.push(...passthrough);
    reasons.push(`+${passthrough.length} unrecognized tool(s) passthrough`);
  }

  return {
    selected,
    groups: uniqueGroups,
    mutating,
    autonomy,
    rationale: reasons.join('; '),
  };
}
