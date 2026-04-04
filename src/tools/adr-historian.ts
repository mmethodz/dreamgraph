/**
 * DreamGraph MCP Server — ADR (Architecture Decision Record) tools.
 *
 * Three tools for managing architecture decisions:
 *   record_architecture_decision — Record a new ADR
 *   query_architecture_decisions — Search and guard-rail check
 *   deprecate_architecture_decision — Retire an ADR
 *
 * ADRs are append-only. Content of accepted decisions is never modified.
 * Guard rails are advisory warnings, not blocking gates.
 *
 * Data file: data/adr_log.json
 */

import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  ADRLogFile,
  ArchitectureDecisionRecord,
  RecordADROutput,
  QueryADROutput,
  GuardRailWarning,
  DeprecateADROutput,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const ADR_PATH = resolve(config.dataDir, "adr_log.json");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function loadADRLog(): Promise<ADRLogFile> {
  try {
    if (!existsSync(ADR_PATH)) return emptyADRLog();
    const raw = await readFile(ADR_PATH, "utf-8");
    return JSON.parse(raw) as ADRLogFile;
  } catch {
    return emptyADRLog();
  }
}

async function saveADRLog(data: ADRLogFile): Promise<void> {
  data.metadata.total_decisions = data.decisions.length;
  data.metadata.last_updated = new Date().toISOString();
  await writeFile(ADR_PATH, JSON.stringify(data, null, 2), "utf-8");
  logger.debug("ADR log saved to disk");
}

function emptyADRLog(): ADRLogFile {
  return {
    metadata: {
      description: "Architecture Decision Records — why things were built this way.",
      schema_version: "1.0.0",
      total_decisions: 0,
      last_updated: null,
    },
    decisions: [],
  };
}

/** Generate next sequential ADR ID */
function nextADRId(existing: ArchitectureDecisionRecord[]): string {
  if (existing.length === 0) return "ADR-001";
  const maxNum = Math.max(
    ...existing.map((d) => {
      const m = d.id.match(/ADR-(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    })
  );
  return `ADR-${String(maxNum + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerADRTools(server: McpServer): void {
  // =========================================================================
  // record_architecture_decision
  // =========================================================================

  server.tool(
    "record_architecture_decision",
    "Record an Architecture Decision Record. Captures the problem, constraints, alternatives considered, the chosen decision, expected consequences, risks, and guard rails. ADR is permanently stored and guards future changes via advisory warnings.",
    {
      title: z.string().describe("Human-readable title for the decision"),
      decided_by: z
        .enum(["human", "system", "collaborative"])
        .describe("Who made the decision"),
      problem: z.string().describe("Why this decision was needed"),
      constraints: z
        .array(z.string())
        .describe("What constraints shaped the decision"),
      affected_entities: z
        .array(z.string())
        .describe("Entity IDs in the fact graph this decision touches"),
      related_tensions: z
        .array(z.string())
        .optional()
        .describe("Tension IDs that motivated this decision"),
      chosen: z.string().describe("What was chosen"),
      alternatives: z
        .array(
          z.object({
            option: z.string(),
            rejected_because: z.string(),
          })
        )
        .optional()
        .describe("Alternatives that were considered and rejected"),
      expected_consequences: z
        .array(z.string())
        .describe("What we expect to happen as a result"),
      risks: z.array(z.string()).describe("Risks accepted with this decision"),
      guard_rails: z
        .array(z.string())
        .describe(
          'What MUST NOT change without revisiting this ADR, e.g. "Do NOT change VAT rounding logic without reviewing ADR-042"'
        ),
      tags: z.array(z.string()).optional().describe("Tags for searchability"),
    },
    async (params) => {
      logger.debug(`record_architecture_decision called: "${params.title}"`);

      const result = await safeExecute<RecordADROutput>(
        async (): Promise<ToolResponse<RecordADROutput>> => {
          const log = await loadADRLog();
          const id = nextADRId(log.decisions);
          const now = new Date().toISOString();

          const adr: ArchitectureDecisionRecord = {
            id,
            title: params.title,
            date: now,
            decided_by: params.decided_by,
            status: "accepted",
            context: {
              problem: params.problem,
              constraints: params.constraints,
              affected_entities: params.affected_entities,
              related_tensions: params.related_tensions,
            },
            decision: {
              chosen: params.chosen,
              alternatives: params.alternatives ?? [],
            },
            consequences: {
              expected: params.expected_consequences,
              risks: params.risks,
            },
            guard_rails: params.guard_rails,
            tags: params.tags ?? [],
          };

          log.decisions.push(adr);
          await saveADRLog(log);

          return success({
            adr_id: id,
            title: params.title,
            status: "accepted" as const,
            affected_entities: params.affected_entities,
            guard_rails: params.guard_rails,
            message: `Architecture decision ${id} recorded: "${params.title}". ${params.guard_rails.length} guard rail(s) active.`,
          });
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // =========================================================================
  // query_architecture_decisions
  // =========================================================================

  server.tool(
    "query_architecture_decisions",
    "Search Architecture Decision Records by entity, tag, status, or free text. Also performs guard rail checks: given an entity and a proposed change, returns warnings from any ADR whose guard rails would be violated.",
    {
      entity_id: z
        .string()
        .optional()
        .describe("Filter by affected entity ID"),
      tag: z.string().optional().describe("Filter by tag"),
      status: z
        .enum(["accepted", "deprecated", "superseded"])
        .optional()
        .describe("Filter by ADR status"),
      search: z
        .string()
        .optional()
        .describe("Free text search across title, problem, and decision"),
      guard_check_entity_id: z
        .string()
        .optional()
        .describe("Entity ID to check guard rails against"),
      guard_check_proposed_change: z
        .string()
        .optional()
        .describe("Description of the proposed change to check against guard rails"),
    },
    async (params) => {
      logger.debug("query_architecture_decisions called");

      const result = await safeExecute<QueryADROutput>(
        async (): Promise<ToolResponse<QueryADROutput>> => {
          const log = await loadADRLog();
          let filtered = [...log.decisions];

          // Filter by entity
          if (params.entity_id) {
            const eid = params.entity_id.toLowerCase();
            filtered = filtered.filter((d) =>
              d.context.affected_entities.some(
                (e) => e.toLowerCase() === eid
              )
            );
          }

          // Filter by tag
          if (params.tag) {
            const tag = params.tag.toLowerCase();
            filtered = filtered.filter((d) =>
              d.tags.some((t) => t.toLowerCase() === tag)
            );
          }

          // Filter by status
          if (params.status) {
            filtered = filtered.filter((d) => d.status === params.status);
          }

          // Free text search
          if (params.search) {
            const q = params.search.toLowerCase();
            filtered = filtered.filter(
              (d) =>
                d.title.toLowerCase().includes(q) ||
                d.context.problem.toLowerCase().includes(q) ||
                d.decision.chosen.toLowerCase().includes(q)
            );
          }

          // Guard rail check
          const warnings: GuardRailWarning[] = [];
          if (params.guard_check_entity_id) {
            const checkEntity = params.guard_check_entity_id.toLowerCase();
            const proposedChange = params.guard_check_proposed_change ?? "unspecified change";

            for (const d of log.decisions) {
              if (d.status !== "accepted") continue;
              const affects = d.context.affected_entities.some(
                (e) => e.toLowerCase() === checkEntity
              );
              if (!affects) continue;

              for (const rail of d.guard_rails) {
                warnings.push({
                  adr_id: d.id,
                  title: d.title,
                  guard_rail: rail,
                  message: `⚠️ Guard rail from ${d.id}: "${rail}" — proposed change: "${proposedChange}". Review this ADR before proceeding.`,
                });
              }
            }
          }

          return success({
            decisions: filtered,
            guard_rail_warnings: warnings,
            total: filtered.length,
          });
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // =========================================================================
  // deprecate_architecture_decision
  // =========================================================================

  server.tool(
    "deprecate_architecture_decision",
    "Mark an Architecture Decision Record as deprecated or superseded. Required when an ADR's guard rails no longer apply. The original content is preserved; only the status changes.",
    {
      adr_id: z.string().describe('The ADR ID to deprecate, e.g. "ADR-001"'),
      new_status: z
        .enum(["deprecated", "superseded"])
        .describe("New status for the ADR"),
      superseded_by: z
        .string()
        .optional()
        .describe("ADR ID of the replacement (required if superseded)"),
      reason: z.string().describe("Why this ADR is being retired"),
    },
    async (params) => {
      logger.debug(`deprecate_architecture_decision called: ${params.adr_id}`);

      const result = await safeExecute<DeprecateADROutput>(
        async (): Promise<ToolResponse<DeprecateADROutput>> => {
          const log = await loadADRLog();
          const adr = log.decisions.find((d) => d.id === params.adr_id);

          if (!adr) {
            return error(
              "NOT_FOUND",
              `ADR "${params.adr_id}" not found. Available: ${log.decisions.map((d) => d.id).join(", ") || "none"}`
            );
          }

          if (adr.status !== "accepted") {
            return error(
              "INVALID_STATE",
              `ADR "${params.adr_id}" is already ${adr.status}. Only accepted ADRs can be deprecated.`
            );
          }

          if (params.new_status === "superseded" && !params.superseded_by) {
            return error(
              "MISSING_FIELD",
              'When superseding an ADR, "superseded_by" must specify the replacement ADR ID.'
            );
          }

          adr.status = params.new_status;
          if (params.superseded_by) adr.superseded_by = params.superseded_by;

          await saveADRLog(log);

          return success({
            adr_id: params.adr_id,
            new_status: params.new_status,
            message: `ADR ${params.adr_id} is now ${params.new_status}. Guard rails from this ADR are no longer active. Reason: ${params.reason}`,
          });
        }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
