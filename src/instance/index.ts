/**
 * DreamGraph v6.0 "La Catedral" — Instance module barrel.
 *
 * Re-exports all instance architecture primitives.
 */

// Types
export type {
  CognitiveTuning,
  DreamGraphInstance,
  InstanceMode,
  PolicyProfile,
  InstanceTransport,
  RegistryEntry,
  InstanceStatus,
  MasterRegistry,
  ProjectBinding,
  PolicyProfileDef,
  PoliciesFile,
  InstanceMcpConfig,
} from "./types.js";

export {
  INSTANCE_SCHEMA_VERSION,
  INSTANCE_DIRS,
  DATA_STUBS,
} from "./types.js";

// Scope
export { InstanceScope, ScopeViolationError } from "./scope.js";

// Registry
export {
  resolveMasterDir,
  loadRegistry,
  saveRegistry,
  registerInstance,
  deregisterInstance,
  updateInstanceEntry,
  findInstance,
  listInstances,
} from "./registry.js";

// Lifecycle
export {
  getActiveScope,
  isInstanceMode,
  getEffectiveDataDir,
  getEffectiveMutexKey,
  createInstance,
  loadInstance,
  resolveInstanceAtStartup,
  migrateFromLegacy,
} from "./lifecycle.js";

export type { CreateInstanceOptions } from "./lifecycle.js";

// Policies
export {
  DEFAULT_POLICIES,
  validatePolicies,
  loadPolicies,
  savePolicies,
  getActivePolicy,
  getActiveProfileName,
  getProfileDef,
  switchProfile,
  reloadPolicies,
  isPolicyRequired,
  getActiveCognitiveTuning,
} from "./policies.js";

export type { PolicyValidationResult } from "./policies.js";
