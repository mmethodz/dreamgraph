/**
 * GraphStore — read-only access to all DreamGraph data files.
 *
 * Phase 0: thin facade over `loadJsonData` / `loadJsonArray` with typed
 * empty defaults so a missing file never crashes the snapshot builder.
 *
 * No file I/O bypasses this module.
 */

import { loadJsonArray, loadJsonData } from "../utils/cache.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  CapabilityEntity,
  Datastore,
  DreamGraphFile,
  ValidatedEdgesFile,
  CandidateEdgesFile,
  TensionFile,
} from "../types/index.js";

const EMPTY_DREAM_GRAPH: DreamGraphFile = {
  metadata: {
    description: "",
    schema_version: "",
    last_dream_cycle: null,
    total_cycles: 0,
    last_normalization: null,
    total_normalization_cycles: 0,
    created_at: "",
  },
  nodes: [],
  edges: [],
};

const EMPTY_VALIDATED: ValidatedEdgesFile = {
  metadata: {
    description: "",
    schema_version: "",
    last_validation: null,
    total_validated: 0,
    created_at: "",
  },
  edges: [],
};

const EMPTY_CANDIDATES: CandidateEdgesFile = {
  metadata: {
    description: "",
    schema_version: "",
    last_normalization: null,
    total_cycles: 0,
    created_at: "",
  },
  results: [],
};

const EMPTY_TENSIONS: TensionFile = {
  metadata: {
    description: "",
    schema_version: "",
    total_signals: 0,
    total_resolved: 0,
    last_updated: null,
  },
  signals: [],
  resolved_tensions: [],
};

async function safe<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

export interface GraphRawSnapshot {
  features: Feature[];
  workflows: Workflow[];
  dataModel: DataModelEntity[];
  capabilities: CapabilityEntity[];
  datastores: Datastore[];
  dreamGraph: DreamGraphFile;
  validated: ValidatedEdgesFile;
  candidates: CandidateEdgesFile;
  tensions: TensionFile;
}

/**
 * Load every store needed for an Explorer snapshot, in parallel.
 * Missing files yield typed empty defaults — never throws.
 */
export async function loadGraphRaw(): Promise<GraphRawSnapshot> {
  const [
    features,
    workflows,
    dataModel,
    capabilities,
    datastoresRaw,
    dreamGraph,
    validated,
    candidates,
    tensions,
  ] = await Promise.all([
    safe(() => loadJsonArray<Feature>("features.json"), []),
    safe(() => loadJsonArray<Workflow>("workflows.json"), []),
    safe(() => loadJsonArray<DataModelEntity>("data_model.json"), []),
    safe(() => loadJsonArray<CapabilityEntity>("capabilities.json"), []),
    safe(() => loadJsonArray<unknown>("datastores.json"), []),
    safe(() => loadJsonData<DreamGraphFile>("dream_graph.json"), EMPTY_DREAM_GRAPH),
    safe(
      () => loadJsonData<ValidatedEdgesFile>("validated_edges.json"),
      EMPTY_VALIDATED,
    ),
    safe(
      () => loadJsonData<CandidateEdgesFile>("candidate_edges.json"),
      EMPTY_CANDIDATES,
    ),
    safe(() => loadJsonData<TensionFile>("tension_log.json"), EMPTY_TENSIONS),
  ]);

  // Strip template-stub entries (entries with `_schema` / `_note` markers).
  const datastores: Datastore[] = (datastoresRaw as Array<Record<string, unknown>>)
    .filter((d) => d._schema === undefined && d._note === undefined)
    .map((d) => d as unknown as Datastore);

  return {
    features,
    workflows,
    dataModel,
    capabilities,
    datastores,
    dreamGraph,
    validated,
    candidates,
    tensions,
  };
}
