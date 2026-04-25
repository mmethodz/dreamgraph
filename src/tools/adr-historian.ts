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
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataPath } from "../utils/paths.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { withFileLock } from "../utils/mutex.js";
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

const adrPath = () => dataPath("adr_log.json");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function loadADRLog(): Promise<ADRLogFile> {
  try {
    if (!existsSync(adrPath())) return emptyADRLog();
    const raw = await readFile(adrPath(), "utf-8");
    const parsed = JSON.parse(raw);

    // Defensive: guarantee expected shape regardless of what is on disk.
    const empty = emptyADRLog();
    return {
      metadata: {
        ...empty.metadata,
        ...(parsed.metadata && typeof parsed.metadata === "object"
          ? parsed.metadata
          : {}),
      },
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    };
  } catch {
    return emptyADRLog();
  }
}

async function saveADRLog(data: ADRLogFile): Promise<void> {
  data.metadata.total_decisions = data.decisions.length;
  data.metadata.last_updated = new Date().toISOString();
  await atomicWriteFile(adrPath(), JSON.stringify(data, null, 2));
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
// Programmatic API — callable from bootstrap and other modules
// ---------------------------------------------------------------------------

/** Input shape for programmatic ADR recording */
export interface RecordADRParams {
  title: string;
  decided_by: "human" | "system" | "collaborative";
  problem: string;
  constraints: string[];
  affected_entities: string[];
  related_tensions?: string[];
  chosen: string;
  alternatives?: Array<{ option: string; rejected_because: string }>;
  expected_consequences: string[];
  risks: string[];
  guard_rails: string[];
  tags?: string[];
}

/**
 * Record an ADR programmatically (no MCP server required).
 * Returns the created ADR record on success, or null on failure.
 */
export async function recordADR(params: RecordADRParams): Promise<ArchitectureDecisionRecord | null> {
  try {
    return await withFileLock("adr_log.json", async () => {
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
      logger.info(`recordADR: recorded ${id} — "${params.title}"`);
      return adr;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`recordADR: failed — ${msg}`);
    return null;
  }
}

/**
 * Get the current count of ADRs (for bootstrap reporting).
 */
export async function getADRCount(): Promise<number> {
  const log = await loadADRLog();
  return log.decisions.length;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerADRTools(server: McpServer): void {
  const SYNONYM_MAP: Record<string, string[]> = {
    happens: ["occurs", "occur", "happening"],
    occurs: ["happens", "occur", "occurring"],
    logging: ["logs", "log", "logged"],
    boundaries: ["boundary"],
    boundary: ["boundaries"],
    exceptions: ["exception", "errors", "error"],
    exception: ["exceptions", "error", "errors"],
    errors: ["error", "exceptions", "exception"],
    error: ["errors", "exception", "exceptions"],
    contextrich: ["contextaware", "contextual"],
    contextaware: ["contextrich", "contextual"],
  };

  function normalizeSearchText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeToken(value: string): string {
    return value.replace(/[^a-z0-9]/g, "");
  }

  function tokenizeSearchText(value: string): string[] {
    return normalizeSearchText(value)
      .split(" ")
      .map(normalizeToken)
      .filter((token) => token.length > 1);
  }

  function expandTokenVariants(token: string): string[] {
    const variants = new Set<string>([token]);

    if (token.endsWith("ing") && token.length > 4) {
      variants.add(token.slice(0, -3));
    }
    if (token.endsWith("ed") && token.length > 3) {
      variants.add(token.slice(0, -2));
    }
    if (token.endsWith("es") && token.length > 3) {
      variants.add(token.slice(0, -2));
    }
    if (token.endsWith("s") && token.length > 2) {
      variants.add(token.slice(0, -1));
    }

    for (const variant of [...variants]) {
      for (const synonym of SYNONYM_MAP[variant] ?? []) {
        variants.add(synonym);
      }
    }

    return [...variants].filter((variant) => variant.length > 1);
  }

  function adrSearchCorpus(d: ArchitectureDecisionRecord): string {
    const alternatives = (d.decision.alternatives ?? []).flatMap((alt) => [
      alt.option,
      alt.rejected_because,
    ]);

    return [
      d.id,
      d.title,
      d.context.problem,
      ...(d.context.constraints ?? []),
      ...(d.context.affected_entities ?? []),
      ...(d.context.related_tensions ?? []),
      d.decision.chosen,
      ...alternatives,
      ...(d.consequences.expected ?? []),
      ...(d.consequences.risks ?? []),
      ...(d.guard_rails ?? []),
      ...(d.tags ?? []),
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
  }

  function scoreADRSearch(d: ArchitectureDecisionRecord, query: string): number {
    const normalizedQuery = normalizeSearchText(query);
    const queryTokens = tokenizeSearchText(query);
    const corpus = adrSearchCorpus(d);
    const normalizedCorpus = normalizeSearchText(corpus);
    const corpusTokens = new Set(tokenizeSearchText(corpus));

    if (!normalizedQuery) {
      return 0;
    }

    let score = 0;

    if (normalizeSearchText(d.id) === normalizedQuery) {
      score += 200;
    } else if (normalizeSearchText(d.id).includes(normalizedQuery)) {
      score += 120;
    }

    if (normalizeSearchText(d.title) === normalizedQuery) {
      score += 180;
    } else if (normalizeSearchText(d.title).includes(normalizedQuery)) {
      score += 100;
    }

    if (normalizedCorpus.includes(normalizedQuery)) {
      score += 80;
    }

    const matchedVariants = new Set<string>();
    let exactTokenMatches = 0;
    let synonymTokenMatches = 0;

    for (const token of queryTokens) {
      const variants = expandTokenVariants(token);
      const exactMatch = corpusTokens.has(token);
      const matchedVariant = variants.find((variant) => corpusTokens.has(variant));

      if (exactMatch) {
        exactTokenMatches += 1;
        score += 18;
        matchedVariants.add(token);
        continue;
      }

      if (matchedVariant) {
        synonymTokenMatches += 1;
        score += 12;
        matchedVariants.add(matchedVariant);
      }
    }

    if (queryTokens.length > 0) {
      const coverage = (exactTokenMatches + synonymTokenMatches) / queryTokens.length;
      score += Math.round(coverage * 40);

      if (coverage === 1) {
        score += 25;
      } else if (coverage >= 0.8) {
        score += 15;
      } else if (coverage >= 0.6) {
        score += 8;
      }
    }

    const queryBigrams = new Set<string>();
    for (let i = 0; i < queryTokens.length - 1; i += 1) {
      queryBigrams.add(`${queryTokens[i]} ${queryTokens[i + 1]}`);
    }

    for (const bigram of queryBigrams) {
      if (normalizedCorpus.includes(bigram)) {
        score += 14;
      }
    }

    return score;
  }

  function matchesADRSearch(d: ArchitectureDecisionRecord, query: string): boolean {
    const queryTokens = tokenizeSearchText(query);

    if (queryTokens.length === 0) {
      return normalizeSearchText(adrSearchCorpus(d)).includes(normalizeSearchText(query));
    }

    const score = scoreADRSearch(d, query);
    const minimumScore = queryTokens.length <= 2
      ? 30
      : queryTokens.length <= 4
        ? 45
        : 55;

    return score >= minimumScore;
  }

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
        async (): Promise<ToolResponse<RecordADROutput>> =>
          withFileLock("adr_log.json", async () => {
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
          })
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

          // Free text search with relevance ranking
          if (params.search) {
            filtered = filtered
              .map((d) => ({ decision: d, score: scoreADRSearch(d, params.search!) }))
              .filter(({ decision, score }) => matchesADRSearch(decision, params.search!) && score > 0)
              .sort((a, b) => {
                if (b.score !== a.score) {
                  return b.score - a.score;
                }
                return a.decision.id.localeCompare(b.decision.id);
              })
              .map(({ decision }) => decision);
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
      adr_id: z.string().describe("The ADR ID to deprecate, e.g. 'ADR-001'"),
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
        async (): Promise<ToolResponse<DeprecateADROutput>> =>
          withFileLock("adr_log.json", async () => {
            const log = await loadADRLog();
            const idx = log.decisions.findIndex((d) => d.id === params.adr_id);

            if (idx === -1) {
              return error("NOT_FOUND", `ADR not found: ${params.adr_id}`);
            }

            if (
              params.new_status === "superseded" &&
              !params.superseded_by
            ) {
              return error(
                "VALIDATION_ERROR",
                "superseded_by is required when new_status is 'superseded'"
              );
            }

            const existing = log.decisions[idx];
            const newStatus: DeprecateADROutput["new_status"] = params.new_status;
            const updated: ArchitectureDecisionRecord = {
              ...existing,
              status: newStatus,
              superseded_by:
                newStatus === "superseded"
                  ? params.superseded_by
                  : undefined,
              deprecation_reason: params.reason,
            };

            log.decisions[idx] = updated;
            await saveADRLog(log);

            return success({
              adr_id: updated.id,
              new_status: newStatus,
              superseded_by: updated.superseded_by,
              reason: params.reason,
              message: `ADR ${updated.id} marked as ${newStatus}.`,
            });
          })
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
