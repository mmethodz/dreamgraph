/**
 * DreamGraph MCP Server — Discipline Registration.
 *
 * Registers the discipline://manifest MCP resource and exports
 * all discipline primitives for use by the server and wrappers.
 *
 * The manifest resource provides machine-readable discipline rules:
 * - Tool classifications (43 tools → truth/analysis/write/cognitive/file_operation)
 * - Phase permissions (5 phases with allowed tool classes)
 * - Data protection rules (19 files → forbidden/tool_mediated/seed_data)
 * - State machine transition rules (7 transitions)
 * - Mandatory tool invocation rules (3 rules)
 *
 * See ADR-001: Hybrid Wrapper Architecture.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import { buildManifest, getManifestSummary } from "./manifest.js";

// ---------------------------------------------------------------------------
// Resource Registration
// ---------------------------------------------------------------------------

export function registerDisciplineResource(server: McpServer): void {
  // -----------------------------------------------------------------------
  // discipline://manifest — Machine-readable discipline rules
  // -----------------------------------------------------------------------
  server.resource(
    "discipline-manifest",
    "discipline://manifest",
    {
      description:
        "Machine-readable discipline rules for the five-phase execution model. " +
        "Contains tool classifications, phase permissions, data protection rules, " +
        "state machine transitions, and mandatory tool requirements. " +
        "Wrappers consume this resource to enforce disciplinary execution.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const manifest = buildManifest();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(manifest, null, 2),
          },
        ],
      };
    }
  );

  const summary = getManifestSummary();
  logger.info(
    `Registered discipline://manifest — ` +
    `${summary.total_tools} tools classified, ` +
    `${summary.data_protection_rules} data files protected`
  );
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { buildManifest, getManifestSummary, getToolClassification, getToolsForPhase, getToolsByClass } from "./manifest.js";
export { canTransition, getAllowedTargets, getNextPhase, logTransition, TRANSITION_RULES } from "./state-machine.js";
export { canWriteFile, getProtectionTier, getFilesByTier, logWriteCheck, DATA_PROTECTION_RULES } from "./protection.js";
export { PHASE_ORDER } from "./types.js";
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
} from "./types.js";
