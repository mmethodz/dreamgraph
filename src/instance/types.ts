/**
 * DreamGraph v6.0 "La Catedral" — Instance Architecture Types.
 *
 * Defines the identity model, master registry schema, policy profiles,
 * and project binding types for UUID-isolated DreamGraph instances.
 */

/* ------------------------------------------------------------------ */
/*  Instance Identity                                                 */
/* ------------------------------------------------------------------ */

/** Operating modes that affect tool availability and logging verbosity. */
export type InstanceMode = "development" | "production" | "audit" | "readonly";

/** Discipline policy profile names. */
export type PolicyProfile = "strict" | "balanced" | "creative";

/** Transport configured for an instance. */
export interface InstanceTransport {
  type: "stdio" | "http";
  port?: number;
  host?: string;
}

/**
 * Full identity record for a single DreamGraph instance.
 * Stored at `<masterDir>/<uuid>/instance.json`.
 */
export interface DreamGraphInstance {
  /** UUID v4 — canonical identity, never changes. */
  uuid: string;

  /** Human-readable name (mutable). */
  name: string;

  /** Absolute path to the project this instance observes. */
  project_root: string | null;

  /** Operating mode. */
  mode: InstanceMode;

  /** Discipline policy profile. */
  policy_profile: PolicyProfile;

  /** DreamGraph version that created this instance. */
  version: string;

  /** Transport configuration. */
  transport: InstanceTransport;

  /** Instance lifecycle timestamps and counters. */
  created_at: string;
  last_active_at: string;
  total_dream_cycles: number;
  total_tool_calls: number;

  /** Parent instance UUID (for forked instances). */
  forked_from?: string;
}

/* ------------------------------------------------------------------ */
/*  Master Registry                                                   */
/* ------------------------------------------------------------------ */

/** Lifecycle status for an instance in the master registry. */
export type InstanceStatus = "active" | "archived" | "corrupted";

/** Summary record kept in the master registry for discovery. */
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
 * Master registry file — the single index of all known instances.
 * Stored at `<masterDir>/instances.json`.
 */
export interface MasterRegistry {
  schema_version: "1.0.0";
  instances: RegistryEntry[];
}

/* ------------------------------------------------------------------ */
/*  Project Binding                                                   */
/* ------------------------------------------------------------------ */

/**
 * Describes the relationship between an instance and its observed project.
 *
 * Key invariant: project files are the *target* of observation, NOT
 * a component of DreamGraph.  DreamGraph reads them; DreamGraph does
 * not own them.
 */
export interface ProjectBinding {
  /** Absolute path to the project root. */
  project_root: string;

  /** Repository name → absolute path (for code-senses / git-senses). */
  repos: Record<string, string>;

  /** When the project was first ingested. */
  discovered_at?: string;

  /** DreamGraph reads/analyses project files but never confuses them with its own state. */
  relationship: "observes";
}

/* ------------------------------------------------------------------ */
/*  Policy Profiles                                                   */
/* ------------------------------------------------------------------ */

/** A single policy profile definition. */
export interface PolicyProfileDef {
  description: string;
  require_tool_evidence: boolean;
  require_plan_approval: boolean;
  block_unbacked_claims: boolean;
  allow_phase_skip: boolean;
  max_verify_loops: number;
  allow_creative_mode: boolean;
  mandatory_ingest_tools: string[];
  mandatory_verify_tools: string[];
  protected_file_tiers: string[];
  /** Optional cognitive engine tuning — promotion/decay thresholds. */
  cognitive_tuning?: CognitiveTuning;
}

/**
 * Per-profile cognitive tuning overrides.
 * All fields are optional — missing fields fall back to cognitive DEFAULT_PROMOTION / DEFAULT_DECAY.
 */
export interface CognitiveTuning {
  /** Minimum combined confidence for promotion to validated (default: 0.62) */
  promotion_confidence?: number;
  /** Minimum plausibility for promotion (default: 0.45) */
  promotion_plausibility?: number;
  /** Minimum evidence score for promotion (default: 0.4) */
  promotion_evidence?: number;
  /** Minimum distinct evidence signals for promotion (default: 2) */
  promotion_evidence_count?: number;
  /** Minimum plausibility for retention as latent (default: 0.35) */
  retention_plausibility?: number;
  /** Maximum contradiction score before rejection (default: 0.3) */
  max_contradiction?: number;
  /** Time-to-live in dream cycles (default: 8) */
  decay_ttl?: number;
  /** Confidence reduction per cycle (default: 0.05) */
  decay_rate?: number;
}

/**
 * `policies.json` schema — per-instance discipline configuration.
 * Stored at `<masterDir>/<uuid>/config/policies.json`.
 */
export interface PoliciesFile {
  schema_version: "1.0.0";
  profile: PolicyProfile;
  profiles: Record<PolicyProfile, PolicyProfileDef>;
}

/* ------------------------------------------------------------------ */
/*  MCP Configuration Per Instance                                    */
/* ------------------------------------------------------------------ */

/**
 * Per-instance MCP server configuration.
 * Stored at `<masterDir>/<uuid>/config/mcp.json`.
 */
export interface InstanceMcpConfig {
  instance_uuid: string;
  server: { name: string; version: string };
  transport: InstanceTransport;
  tools: {
    enabled: string[];
    disabled: string[];
    overrides: Record<string, unknown>;
  };
  discipline: {
    enabled: boolean;
    policy_profile: PolicyProfile;
    requires_ground_truth: boolean;
  };
  data_dir: string;
  repos: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Canonical schema version for all instance config files. */
export const INSTANCE_SCHEMA_VERSION = "1.0.0" as const;

/** Subdirectory names within an instance root. */
export const INSTANCE_DIRS = [
  "config",
  "data",
  "runtime",
  "runtime/locks",
  "runtime/cache",
  "runtime/temp",
  "logs",
  "exports",
  "exports/docs",
  "exports/snapshots",
] as const;

/**
 * Data filenames that should be created as empty stubs for a new instance.
 * Cognitive files start empty; seed files start with `[]`.
 */
export const DATA_STUBS: Record<string, unknown> = {
  "dream_graph.json":       { nodes: [], edges: [] },
  "candidate_edges.json":   [],
  "validated_edges.json":   [],
  "tension_log.json":       { tensions: [] },
  "dream_history.json":     { cycles: [] },
  "adr_log.json":           {
    _schema: "ADR Log — Architecture Decision Records",
    _fields: { id: "ADR-NNN", title: "string", status: "accepted|deprecated|superseded", context: "string", decision: "string", consequences: "string", date: "ISO 8601" },
    decisions: [],
  },
  "ui_registry.json":       { elements: [] },
  "event_log.json":         { events: [] },
  "meta_log.json":          { analyses: [] },
  "system_story.json":      { chapters: [], weekly_digests: [], trends: {} },
  "schedules.json":         { schedules: [], execution_history: [] },
  "threat_log.json":        [],
  "dream_archetypes.json":  [],
  "capabilities.json":      [],

  /* Seed files — schema-documented stubs, populated by init_graph */
  "system_overview.json":   {
    _schema: "SystemOverview — project description with repository inventory",
    id: "system_overview", name: "", description: "", source_repo: "", source_files: [],
    repositories: [],
  },
  "features.json":          [{
    _schema: "Feature — discoverable capability of the target project",
    _fields: { id: "snake_case", name: "string", description: "string", source_repo: "string", source_files: ["paths"], status: "active|planned|deprecated", category: "string", tags: ["strings"], domain: "string", keywords: ["strings"], links: [{ target: "id", type: "feature|workflow|data_model", relationship: "verb", description: "string", strength: "strong|moderate|weak" }] },
    _note: "DELETE after init_graph populates",
  }],
  "workflows.json":         [{
    _schema: "Workflow — process flow in the target project",
    _fields: { id: "snake_case", name: "string", description: "string", trigger: "string", source_repo: "string", source_files: ["paths"], domain: "string", keywords: ["strings"], status: "active|planned|deprecated", steps: [{ order: 1, name: "string", description: "string" }], links: [{ target: "id", type: "feature|workflow|data_model", relationship: "verb", description: "string", strength: "strong|moderate|weak" }] },
    _note: "DELETE after init_graph populates",
  }],
  "data_model.json":        [{
    _schema: "DataModelEntity — data store or persistent structure",
    _fields: { id: "snake_case", name: "string", description: "string", table_name: "string", storage: "postgresql|json_file|sqlite|redis", source_repo: "string", source_files: ["paths"], domain: "string", keywords: ["strings"], status: "active|planned|deprecated", key_fields: [{ name: "string", type: "string", description: "string" }], relationships: [{ type: "has_many|belongs_to", target: "id", via: "fk" }], links: [] },
    _note: "DELETE after init_graph populates",
  }],
  "index.json":             {
    _schema: "ResourceIndex — fast lookup map of all entities",
    _fields: { "<entity_id>": { type: "feature|workflow|data_model", uri: "dreamgraph://resource/<type>/<id>", name: "string", source_repo: "string" } },
    entities: {},
  },
};
