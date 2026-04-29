/**
 * DreamGraph MCP Server — TypeScript type definitions.
 *
 * Types are derived from Zod schemas where possible.
 * These interfaces describe the internal data structures, tool requests, and tool responses.
 */

// ---------------------------------------------------------------------------
// Normalized resource entry — every JSON resource entity shares this base
// ---------------------------------------------------------------------------

export interface ResourceEntry {
  id: string;
  name: string;
  description: string;
  source_repo: string;
  source_files: string[];
}

// ---------------------------------------------------------------------------
// Rich cross-link types — every link is a graph edge with metadata
// ---------------------------------------------------------------------------

/** Second-hop reference embedded inside a link's metadata */
export interface LinkRef {
  target: string;
  type: "feature" | "workflow" | "data_model" | "capability";
  hint: string;
}

/** Extensible metadata bag attached to a graph link */
export interface LinkMeta {
  direction?: "upstream" | "downstream" | "bidirectional";
  api_route?: string;
  table?: string;
  see_also?: LinkRef[];
  [key: string]: unknown;
}

/** A rich cross-link (graph edge) between any two entities */
export interface GraphLink {
  target: string;
  type: "feature" | "workflow" | "data_model" | "capability" | "datastore";
  relationship: string;
  description: string;
  strength: string;
  meta?: LinkMeta;
}

// ---------------------------------------------------------------------------
// System Overview
// ---------------------------------------------------------------------------

export interface Repository {
  id: string;
  name: string;
  description: string;
  technology: string;
  local_path: string;
  source_repo: string;
  source_files: string[];
}

export interface SystemOverview extends ResourceEntry {
  repositories: Repository[];
}

// ---------------------------------------------------------------------------
// Entity lifecycle (per ADR-010, ADR-013)
//
// Non-destructive identity-consolidation: legacy/duplicate entities can be
// marked transitional/deprecated/retired and point at a canonical replacement
// via `superseded_by`. The literal set is advisory — `status` remains a free
// string for back-compat with historical values (e.g. "experimental").
// ---------------------------------------------------------------------------

export type EntityLifecycleStatus =
  | "active"
  | "transitional"
  | "deprecated"
  | "retired";

export const ENTITY_LIFECYCLE_STATUSES: readonly EntityLifecycleStatus[] = [
  "active",
  "transitional",
  "deprecated",
  "retired",
];

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface Feature extends ResourceEntry {
  status: string;
  /** Canonical entity ID this entry has been superseded by (per ADR-010). */
  superseded_by?: string;
  category: string;
  tags: string[];
  domain: string;
  keywords: string[];
  links: GraphLink[];
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  order: number;
  name: string;
  description: string;
}

export interface Workflow extends ResourceEntry {
  trigger: string;
  steps: WorkflowStep[];
  domain: string;
  keywords: string[];
  status: string;
  /** Canonical entity ID this entry has been superseded by (per ADR-010). */
  superseded_by?: string;
  links: GraphLink[];
}

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

export interface EntityField {
  name: string;
  type: string;
  description: string;
}

export interface EntityRelationship {
  type: string;
  target: string;
  via: string;
}

export interface DataModelEntity extends ResourceEntry {
  table_name: string;
  mobile_table?: string;
  storage: string;
  key_fields: EntityField[];
  relationships: EntityRelationship[];
  domain: string;
  keywords: string[];
  status: string;
  /** Canonical entity ID this entry has been superseded by (per ADR-010). */
  superseded_by?: string;
  links: GraphLink[];
  constraints?: string[];
  rls?: string;
  encryption_details?: Record<string, unknown>;
  audit?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Capability Entity
// ---------------------------------------------------------------------------

export interface CapabilityEntity extends ResourceEntry {
  category: string;
  status: string;
  /** Canonical entity ID this entry has been superseded by (per ADR-010). */
  superseded_by?: string;
  tags: string[];
  domain: string;
  keywords: string[];
  links: GraphLink[];
}

// ---------------------------------------------------------------------------
// Datastores (per plans/DATASTORE_AS_HUB.md, Slice 1)
//
// A `datastore` is a first-class entity representing a shared backend store
// (typically the project's primary database). It anchors `data_model`
// entities via implicit `stored_in` edges so multi-repo SaaS projects show
// a visible hub in the graph.
//
// `kind` is open-ended for future backends (mysql, sqlite, mongo, redis,
// blob_storage, event_bus, …). Slice 1 only ships the `postgres` path.
// ---------------------------------------------------------------------------

export interface DatastoreTable {
  schema: string;
  name: string;
  columns?: number;
  fk_count?: number;
  rows_estimate?: number | null;
}

export interface Datastore extends ResourceEntry {
  kind: "postgres" | "mysql" | "sqlite" | "mongo" | "redis" | "blob_storage" | "event_bus" | "other";
  /** Sanitized connection-string preview (no password). */
  url_hint?: string;
  /** Repo names that share this datastore. */
  repos?: string[];
  /** Tables/collections/topics introspected from the backend (Slice 2). */
  tables?: DatastoreTable[];
  /** ISO timestamp of the last successful schema scan. */
  last_scanned_at?: string;
  /** Free-form tags (e.g. "shared", "saas", "primary"). */
  tags?: string[];
  /** Lifecycle status — same vocabulary as other entities. */
  status?: string;
}

// ---------------------------------------------------------------------------
// Resource Index
// ---------------------------------------------------------------------------

export interface IndexEntry {
  type: "feature" | "workflow" | "data_model" | "capability" | "datastore";
  uri: string;
  name: string;
  source_repo: string;
}

export interface ResourceIndex {
  entities: Record<string, IndexEntry>;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface CapabilityResource {
  uri: string;
  name: string;
  description: string;
}

export interface CapabilityTool {
  name: string;
  description: string;
  input: Record<string, string>;
}

export interface Capabilities {
  server: {
    name: string;
    version: string;
    description: string;
  };
  resources: CapabilityResource[];
  tools: CapabilityTool[];
}

// ---------------------------------------------------------------------------
// Tool response wrappers
// ---------------------------------------------------------------------------

export interface ToolSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ToolError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ToolResponse<T = unknown> = ToolSuccess<T> | ToolError;

// ---------------------------------------------------------------------------
// Operational Layer — API Surface (v7.0)
// ---------------------------------------------------------------------------

/** How an operational artifact was produced */
export interface Provenance {
  kind: "extracted" | "pattern_inference" | "manual";
  source_files: string[];
  extracted_at?: string;
  inferred_at?: string;
}

export interface ApiParam {
  name: string;
  type?: string;
  default_value?: string;
}

export interface ApiProperty {
  name: string;
  type?: string;
  is_readonly: boolean;
  line_number: number;
}

export interface ApiMethod {
  name: string;
  parameters: ApiParam[];
  return_type?: string;
  signature_text?: string;
  is_static: boolean;
  is_async: boolean;
  visibility: "public" | "protected" | "private";
  line_number: number;
  decorators: string[];
  defined_in?: string;
  /** Actual source code snippet, populated when query_api_surface is called with include_source=true. */
  source_code?: string;
}

export interface ApiClass {
  name: string;
  bases: string[];
  methods: ApiMethod[];
  properties: ApiProperty[];
  decorators: string[];
  file_path: string;
  line_number: number;
}

export interface ApiFreeFunction {
  name: string;
  parameters: ApiParam[];
  return_type?: string;
  signature_text?: string;
  is_async: boolean;
  is_exported: boolean;
  line_number: number;
  /** Actual source code snippet, populated when query_api_surface is called with include_source=true. */
  source_code?: string;
}

export interface ApiModule {
  file_path: string;
  module_name?: string;
  language: string;
  platform?: string;
  classes: ApiClass[];
  functions: ApiFreeFunction[];
  provenance: Provenance;
}

export interface ApiSurface {
  extracted_at: string;
  repo_root: string;
  modules: ApiModule[];
}

export interface ExtractApiSurfaceOutput {
  repo_root: string;
  path_scanned: string;
  files_scanned: number;
  files_updated: number;
  files_skipped_incremental: number;
  classes_found: number;
  functions_found: number;
  properties_found: number;
  warnings: string[];
  surface_version: string;
}

export interface QueryApiSurfaceOutput {
  symbol_name: string;
  symbol_kind: "class" | "function" | "module";
  language: string;
  file_path: string;
  /** All contributing file paths when a partial class spans multiple files. */
  file_paths?: string[];
  line_number?: number;
  bases?: string[];
  /** True when the result was assembled from multiple partial class fragments. */
  is_partial_aggregate?: boolean;
  methods?: ApiMethod[];
  properties?: ApiProperty[];
  parameters?: ApiParam[];
  return_type?: string;
  signature_text?: string;
  is_async?: boolean;
  is_exported?: boolean;
  functions?: ApiFreeFunction[];
  classes?: ApiClass[];
  /** Actual source code snippet for a single function result, populated with include_source=true. */
  source_code?: string;
}

// ---------------------------------------------------------------------------
// Re-export cognitive types
// ---------------------------------------------------------------------------

export type {
  CognitiveStateName,
  DreamStrategy,
  AdversarialStrategy,
  NormalizationOutcome,
  TensionDomain,
  TensionResolutionType,
  TensionResolutionAuthority,
  ResolvedTension,
  TensionConfig,
  DreamEdgeStatus,
  NormalizationReasonCode,
  DreamEntityType,
  DreamEdgeType,
  DecayConfig,
  PromotionConfig,
  DreamNode,
  DreamEdge,
  DreamGraphMetadata,
  DreamGraphFile,
  ValidationEvidence,
  ValidationResult,
  CandidateEdgesMetadata,
  CandidateEdgesFile,
  ValidatedEdge,
  ValidatedEdgesMetadata,
  ValidatedEdgesFile,
  TensionSignal,
  TensionFile,
  DreamHistoryEntry,
  DreamHistoryFile,
  DreamGraphStats,
  ValidationStats,
  TensionStats,
  CognitiveState,
  DreamCluster,
  DreamInsights,
  DreamCycleInput,
  DreamCycleOutput,
  NormalizeDreamsInput,
  NormalizeDreamsOutput,
  QueryDreamsInput,
  QueryDreamsOutput,
  ClearDreamsInput,
  ClearDreamsOutput,
  ArchitectureDecisionRecord,
  ADRLogFile,
  SemanticElementCategory,
  SemanticElement,
  UIRegistryFile,
  GenerateVisualFlowInput,
  GenerateVisualFlowOutput,
  RecordADRInput,
  RecordADROutput,
  QueryADRInput,
  QueryADROutput,
  GuardRailWarning,
  DeprecateADRInput,
  DeprecateADROutput,
  RegisterUIElementInput,
  RegisterUIElementOutput,
  QueryUIElementsInput,
  QueryUIElementsOutput,
  GenerateUIMigrationInput,
  GenerateUIMigrationOutput,
  MigrationPortedElement,
  MigrationGapElement,
  LivingDocsSection,
  LivingDocsFormat,
  ExportLivingDocsInput,
  ExportLivingDocsOutput,
  ExportedFile,
  // Causal Reasoning
  CausalLink,
  CausalChain,
  CausalInsights,
  // Multi-System Dreaming (Federation)
  DreamArchetype,
  FederationConfig,
  FederatedExchangeFile,
  ExportArchetypesOutput,
  ImportArchetypesOutput,
  // Temporal Dreaming
  TensionTrajectory,
  TemporalPrediction,
  SeasonalPattern,
  TemporalInsights,
  // Adversarial Dreaming (NIGHTMARE)
  ThreatSeverity,
  ThreatEdge,
  NightmareResult,
  ThreatLogFile,
  // Embodied Senses (Runtime)
  RuntimeMetricConfig,
  RuntimeObservation,
  BehavioralCorrelation,
  RuntimeInsightsOutput,
  // Dream Narratives
  NarrativeDepth,
  NarrativeChapter,
  SystemNarrative,
  // Intervention Engine
  FileChange,
  RemediationStep,
  RemediationPlan,
  RemediationPlanOutput,
  // v5.1 — Metacognitive Self-Tuning
  StrategyMetrics,
  CalibrationBucket,
  ThresholdRecommendation,
  DomainDecayProfile,
  MetaLogEntry,
  MetaLogFile,
  // v5.1 — Event-Driven Dreaming
  EventSource,
  EventSeverity,
  CognitiveEvent,
  EntityScope,
  EventLogEntry,
  EventLogFile,
  EventRouterConfig,
  // v5.1 — Continuous Narrative Intelligence
  StoryMetadata,
  StoryChapter,
  WeeklyDigest,
  SystemStoryFile,
  NarrativeConfig,
  // v5.2 — Dream Scheduling
  ScheduleAction,
  ScheduleTriggerType,
  ScheduleStatus,
  DreamSchedule,
  ScheduleExecution,
  ScheduleFile,
  SchedulerConfig,
  // v5.2 — Graph RAG Bridge (Knowledge Backbone)
  EntitySimilarity,
  TfIdfDocument,
  GraphRAGMode,
  GraphRAGQuery,
  GraphRAGContext,
  CognitivePreamble,
  // v5.2 — Lucid Dreaming (Interactive Exploration)
  LucidHypothesis,
  LucidSignal,
  LucidFindings,
  LucidAction,
  LucidResult,
  LucidLogFile,
} from "../cognitive/types.js";

export {
  DEFAULT_FEDERATION_CONFIG,
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_EVENT_ROUTER_CONFIG,
  DEFAULT_NARRATIVE_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
} from "../cognitive/types.js";

// ---------------------------------------------------------------------------
// v7.0 — Discipline Execution System  (ADR-001 through ADR-005)
// ---------------------------------------------------------------------------

export type {
  DisciplinePhase,
  ToolClass,
  ProtectionLevel,
  ToolClassification,
  PhasePermissions,
  DataProtectionTier,
  DataProtectionRule,
  DisciplineManifest,
  PhaseTransitionRule,
  MandatoryToolRule,
} from "../discipline/types.js";

export { PHASE_ORDER } from "../discipline/types.js";

