/**
 * DreamGraph VS Code Extension — Shared types.
 *
 * All interfaces here mirror or extend the TDD specification (§2.2–§3.6).
 */

/* ------------------------------------------------------------------ */
/*  Instance types (§2.2)                                             */
/* ------------------------------------------------------------------ */

/** Instance operating mode — matches daemon InstanceScope */
export type InstanceMode = "development" | "staging" | "production" | "archive";

/** Instance lifecycle status — matches daemon InstanceScope */
export type InstanceStatus = "active" | "paused" | "error" | "initializing";

/** How the instance was discovered */
export type InstanceSource = "workspace_setting" | "project_match" | "env_var" | "manual";

/** Result of the §2.2 discovery chain */
export interface ResolvedInstance {
  uuid: string;
  name: string;
  project_root: string | null;
  mode: InstanceMode;
  status: InstanceStatus;
  daemon: {
    running: boolean;
    pid: number | null;
    port: number | null;
    transport: "http" | "stdio";
    version: string | null;
  };
  source: InstanceSource;
}

/** Entry in the master registry (~/.dreamgraph/instances.json) */
export interface RegistryEntry {
  uuid: string;
  name: string;
  project_root: string | null;
  mode: InstanceMode;
  status: InstanceStatus;
  created_at: string;
  last_active_at: string;
}

/**
 * Shape returned by `dg status --instance <uuid> --json`.
 * This is the authoritative source for daemon port, pid, running state.
 */
export interface CliStatusResponse {
  identity: {
    uuid: string;
    name: string;
    version: string;
    status: string;
    mode: string;
    policy: string;
    created_at: string;
    last_active_at: string;
  };
  project: {
    root: string | null;
    forked_from: string | null;
  };
  daemon: {
    running: boolean;
    pid: number | null;
    transport: string;
    port: number | null;
    uptime_ms: number | null;
    version: string | null;
    bin_path: string | null;
    log_file: string | null;
    log_bytes: number | null;
    crashed: boolean;
    crashed_pid: number | null;
  };
  cognitive: {
    dream_cycles: number;
    tool_calls: number;
    graph_nodes: number;
    graph_edges: number;
    candidate_edges: number;
    validated_edges: number;
    tensions: number;
    adr_decisions: number;
    ui_elements: number;
  };
  paths: {
    instance_root: string;
    data_dir: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Health types (§2.4)                                               */
/* ------------------------------------------------------------------ */

/** Extension-side connection and health state */
export type ConnectionStatus = "connected" | "degraded" | "disconnected" | "connecting";

export interface HealthState {
  status: ConnectionStatus;
  lastCheck: Date;
  latencyMs: number;
  cognitiveState: string;
  sessions: number;
  llmAvailable: boolean;
  instanceUuid: string;
}

/* ------------------------------------------------------------------ */
/*  Daemon REST response shapes                                       */
/* ------------------------------------------------------------------ */

/** GET /health (Accept: application/json) */
export interface DaemonHealthResponse {
  status: string;
  transport: string;
  sessions: number;
}

/** GET /api/instance — full instance details */
export interface DaemonInstanceResponse {
  uuid: string;
  name: string;
  project_root: string | null;
  mode: string;
  policy_profile: string;
  version: string;
  transport: { type: string; port: number | undefined };
  daemon: {
    pid: number;
    uptime_seconds: number;
    total_dream_cycles: number;
    total_tool_calls: number;
  };
  cognitive: {
    state: string;
    active_tensions: number;
    validated_edges: number;
    last_dream_cycle: string | null;
  };
  models: {
    dreamer: { provider: string; model: string } | null;
    normalizer: { provider: string; model: string } | null;
  };
}

/* ------------------------------------------------------------------ */
/*  Context types (§3.2, §3.6)                                        */
/* ------------------------------------------------------------------ */

export type IntentMode =
  | "selection_only"
  | "active_file"
  | "ask_dreamgraph"
  | "manual";

export interface EditorContextEnvelope {
  workspaceRoot: string;
  instanceId: string | null;

  activeFile: {
    path: string;
    languageId: string;
    lineCount: number;
    cursorLine: number;
    cursorColumn: number;
    cursorSummary: string;
    cursorAnchor?: SemanticAnchor;
    selection: {
      startLine: number;
      endLine: number;
      text: string;
      summary: string;
      anchor?: SemanticAnchor;
    } | null;
  } | null;

  visibleFiles: string[];
  changedFiles: string[];
  pinnedFiles: string[];

  environmentContext: {
    workspaceRuntime?: string;
    workspacePackageManager?: string;
    entries: Array<{
      scope: string;
      runtime: string;
      moduleSystem: string;
      role: string;
      framework?: string;
      boundaries: string[];
      keyDependencies: string[];
    }>;
  } | null;

  graphContext: {
    relatedFeatures: Array<{ id: string; name: string; relevance?: number }>;
    relatedWorkflows: Array<{ id: string; name: string; relevance?: number }>;
    applicableAdrs: Array<{ id: string; title: string; relevance?: number }>;
    uiPatterns: Array<{ id?: string; name: string; relevance?: number }>;
    activeTensions: number;
    cognitiveState: string;
    apiSurface: object | null;

    tensions: Array<{
      id: string;
      description: string;
      severity: string;
      domain?: string;
      relevance?: number;
    }>;
    dreamInsights: Array<{
      type: string;
      insight: string;
      confidence: number;
      source?: string;
      relevance?: number;
    }>;
    causalChains: Array<{
      from: string;
      to: string;
      relationship: string;
      confidence: number;
      relevance?: number;
    }>;
    temporalPatterns: Array<{
      pattern: string;
      frequency: string;
      last_seen?: string;
      relevance?: number;
    }>;
    dataModelEntities: Array<{
      id: string;
      name: string;
      storage: string;
      relevance?: number;
    }>;
  } | null;

  intentMode: IntentMode;
  intentConfidence: number;
}

export type ContextEvidenceKind =
  | "task"
  | "environment"
  | "code"
  | "adr"
  | "tension"
  | "api"
  | "workflow"
  | "feature"
  | "ui"
  | "causal"
  | "temporal"
  | "data_model"
  | "cognitive_status"
  | "import_contract"
  | "type_contract"
  | "local_convention"
  | "note";

export interface SemanticAnchor {
  kind: "selection" | "symbol" | "file" | "workflow" | "feature" | "adr" | "ui";
  label: string;
  path?: string;
  symbolPath?: string;
  excerpt?: string;
  approximate?: boolean;
  source?: "symbol_provider" | "heuristic" | "graph";
  canonicalId?: string;
  canonicalKind?: "entity" | "workflow" | "adr" | "ui" | "relationship" | "symbol" | "file";
  migrationStatus?: "native" | "promoted" | "rebound" | "drifted" | "archived";
  confidence?: number;
  historical?: boolean;
  /**
   * Zero-based line range of the containing symbol as reported by the language
   * server (vscode.DocumentSymbol.range). Present only when source is
   * "symbol_provider". Used by _trimActiveFile to bound the focused excerpt to
   * the actual symbol body rather than a fixed ±20-line window.
   */
  symbolRange?: { startLine: number; endLine: number };
}

export interface CodeReadPlan {
  scope: "selection" | "focused_excerpt" | "active_file";
  reason: string;
  anchorLabel?: string;
  required: boolean;
}

export interface BudgetPolicy {
  maxTokens: number;
  reserveTokens: number;
  allowFullActiveFile: boolean;
  includeOptionalEvidence: boolean;
}

export interface ContextPlan {
  intentMode: IntentMode;
  taskSummary: string;
  primaryAnchor?: SemanticAnchor;
  secondaryAnchors: SemanticAnchor[];
  requiredEvidence: ContextEvidenceKind[];
  optionalEvidence: ContextEvidenceKind[];
  codeReadPlan: CodeReadPlan[];
  budgetPolicy: BudgetPolicy;
  environmentPolicy?: {
    forceInclude: boolean;
    softTokenCeiling: number;
    hardTokenCeiling: number;
    scopeLimit: number;
  };
}

export interface EvidenceItem {
  kind: ContextEvidenceKind;
  title: string;
  content: string;
  relevance: number;
  confidence?: number;
  anchor?: string;
  tokenCost: number;
  required: boolean;
}

export interface ReasoningPacket {
  task: {
    intentMode: IntentMode;
    summary: string;
    commandSource?: string;
  };
  primaryAnchor?: SemanticAnchor;
  secondaryAnchors: SemanticAnchor[];
  evidence: EvidenceItem[];
  omitted: Array<{
    title: string;
    reason: string;
    required: boolean;
    kind?: ContextEvidenceKind;
  }>;
  confidence: number;
  tokenUsage: {
    used: number;
    budget: number;
    reserved: number;
  };
  contextText: string;
  safetyWarnings: string[];
  instrumentation?: ContextInstrumentation;
}

export interface ContextEnvironmentMetrics {
  matchedScopes: string[];
  renderedScopeCount: number;
  tokenEstimate: number;
  bytes: number;
  hash: string;
  stablePrefixHash: string;
  stablePrefixBytes: number;
  stablePrefixTokenEstimate: number;
  stableReuseRatio?: number;
  volatilityKey: string;
}

export interface ContextInstrumentation {
  layerTokenEstimates: {
    environment: number;
    task: number;
    code: number;
    graph: number;
    notes: number;
    totalEvidence: number;
  };
  evidenceCounts: {
    includedByKind: Partial<Record<ContextEvidenceKind, number>>;
    omittedByKind: Partial<Record<ContextEvidenceKind, number>>;
  };
  environment?: ContextEnvironmentMetrics;
  cacheChurn?: {
    stablePrefixHash: string;
    stablePrefixBytes: number;
    stablePrefixTokenEstimate: number;
    stableReuseRatio?: number;
    churned: boolean;
    layerHashes: {
      task: string;
      environment: string;
      graph: string;
      code: string;
      notes: string;
    };
    packetVolatilityKey: string;
  };
}


/* ------------------------------------------------------------------ */
/*  Events                                                            */
/* ------------------------------------------------------------------ */

/** Emitted when health state transitions */
export interface HealthTransitionEvent {
  from: ConnectionStatus;
  to: ConnectionStatus;
  timestamp: Date;
  reason?: string;
}

/** Emitted when the resolved instance changes */
export interface InstanceChangedEvent {
  previous: ResolvedInstance | null;
  current: ResolvedInstance | null;
}
