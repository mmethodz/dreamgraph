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
  type: "feature" | "workflow" | "data_model";
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
  type: "feature" | "workflow" | "data_model";
  relationship: string;
  description: string;
  strength: "strong" | "moderate" | "weak";
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
// Features
// ---------------------------------------------------------------------------

export interface Feature extends ResourceEntry {
  status: string;
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
  links: GraphLink[];
  constraints?: string[];
  rls?: string;
  encryption_details?: Record<string, unknown>;
  audit?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Resource Index
// ---------------------------------------------------------------------------

export interface IndexEntry {
  type: "feature" | "workflow" | "data_model";
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
// Re-export cognitive types
// ---------------------------------------------------------------------------

export type {
  CognitiveStateName,
  DreamStrategy,
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
} from "../cognitive/types.js";

