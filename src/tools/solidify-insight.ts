/**
 * DreamGraph MCP Server — solidify_cognitive_insight tool.
 *
 * Allows the AI agent to write subjective insights (discovered by
 * reading source code) back into the cognitive memory system.
 *
 * Three insight types:
 *   EDGE    → Speculative relationship between two entities.
 *             Written as a DreamEdge into dream_graph.json with
 *             strategy "reflective". Enters the normal decay →
 *             normalize → promote pipeline.
 *
 *   TENSION → Something the agent noticed is wrong / missing / risky.
 *             Written via engine.recordTension() and feeds back into
 *             tension_directed dreaming on future cycles.
 *
 *   ENTITY  → Hypothetical entity the agent believes should exist.
 *             Written as a DreamNode into dream_graph.json.
 *
 * The tool briefly transitions to REM state (if needed) to satisfy
 * the engine's state guards, then returns to AWAKE.
 *
 * Safety: Only writes to dream / tension data.
 *         The Fact Graph is never modified.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { engine } from "../cognitive/engine.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_DECAY } from "../cognitive/types.js";
import type {
  DreamEdge,
  DreamNode,
  TensionSignal,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

interface SolidifyResult {
  /** What was written */
  insightType: "EDGE" | "TENSION" | "ENTITY";
  /** ID of the created artifact */
  id: string;
  /** Where it was persisted */
  target_file: string;
  /** Current confidence / urgency */
  confidence: number;
  /** Whether it was merged with an existing item */
  merged: boolean;
  /** Brief confirmation message */
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idSeq = 0;
function insightId(prefix: string): string {
  idSeq++;
  return `insight_${prefix}_${Date.now()}_${idSeq}`;
}

/**
 * Ensure the engine is in REM state so we can write to the dream graph.
 * Returns a cleanup function that restores the previous state.
 */
async function ensureRem(): Promise<() => Promise<void>> {
  const prev = engine.getState();
  if (prev === "rem") {
    // Already in REM — nothing to restore
    return async () => {};
  }

  // Force to AWAKE first if in an intermediate state
  if (prev !== "awake") {
    await engine.interrupt();
  }

  engine.enterRem();

  return async () => {
    // Return to AWAKE via interrupt (safe from any state)
    if (engine.getState() !== "awake") {
      await engine.interrupt();
    }
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSolidifyInsightTool(server: McpServer): void {
  server.tool(
    "solidify_cognitive_insight",
    "Tallentaa AI:n subjektiivisen oivalluksen koodista kognitiiviseen muistiin. " +
      "Käytä tätä, kun olet lukenut koodia (read_source_code) ja löytänyt uusia " +
      "yhteyksiä, puuttuvia linkkejä tai jännitteitä. Oivallus kulkee normaalin " +
      "unisyklin läpi (decay → normalize → promote). " +
      "EDGE: spekulatiivinen yhteys kahden entiteetin välillä. " +
      "TENSION: riski, puute tai ristiriita koodissa. " +
      "ENTITY: hypoteettinen entiteetti, joka puuttuu tietomallista.",
    {
      insightType: z
        .enum(["EDGE", "TENSION", "ENTITY"])
        .describe(
          "Oivalluksen tyyppi: EDGE (yhteys), TENSION (jännite/riski), ENTITY (puuttuva entiteetti)."
        ),
      sourceNodeId: z
        .string()
        .describe(
          "Lähdesolmun ID faktaverkosta tai unigraafista (esim. 'feature_resend_email', 'data_model_invoice')."
        ),
      targetNodeId: z
        .string()
        .optional()
        .describe(
          "Kohdesolmun ID. Pakollinen EDGE-tyypille, valinnainen muille."
        ),
      relation: z
        .string()
        .optional()
        .describe(
          "Suhteen nimi EDGE-tyypille (esim. 'should_track_delivery_status'). " +
            "Jos ei annettu, generoidaan automaattisesti."
        ),
      rationale: z
        .string()
        .describe(
          "Subjektiivinen perustelu: miksi ja miten koet tämän yhteyden tai jännitteen olevan olemassa? " +
            "Kerro omin sanoin, mitä huomasit koodissa."
        ),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Luottamustaso (0.0–1.0). Kuinka varma olet oivalluksesta? " +
            "0.3 = spekulatiivinen, 0.6 = todennäköinen, 0.9 = lähes varma."
        ),
      codeReferences: z
        .array(z.string())
        .optional()
        .describe(
          "Polut kooditiedostoihin tai tiettyihin riveihin, joihin oivallus perustuu " +
            "(esim. ['src/server/email/resend_handler.ts:45', 'src/types/delivery.ts'])."
        ),
      tensionLevel: z
        .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        .optional()
        .describe(
          "Jännitteen vakavuus (vain TENSION-tyypille). HIGH = async-tila epätasapainossa, " +
            "CRITICAL = datahäviön riski."
        ),
      entityName: z
        .string()
        .optional()
        .describe(
          "Hypoteettisen entiteetin nimi (vain ENTITY-tyypille, esim. 'Unified Delivery Status Tracker')."
        ),
      entityDescription: z
        .string()
        .optional()
        .describe(
          "Kuvaus hypoteettisesta entiteetistä (vain ENTITY-tyypille)."
        ),
    },
    async (args) => {
      const {
        insightType,
        sourceNodeId,
        targetNodeId,
        relation,
        rationale,
        confidence,
        codeReferences,
        tensionLevel,
        entityName,
        entityDescription,
      } = args;

      logger.info(
        `solidify_cognitive_insight called: type=${insightType}, ` +
          `source=${sourceNodeId}, target=${targetNodeId ?? "(none)"}, ` +
          `confidence=${confidence}`
      );

      const result = await safeExecute<SolidifyResult>(
        async (): Promise<ToolResponse<SolidifyResult>> => {
          const now = new Date().toISOString();
          const cycle = engine.getCurrentDreamCycle();

          // ---------------------------------------------------------------
          // EDGE — Write a DreamEdge to dream_graph.json
          // ---------------------------------------------------------------
          if (insightType === "EDGE") {
            if (!targetNodeId) {
              return error(
                "MISSING_TARGET",
                "EDGE-tyyppi vaatii targetNodeId-parametrin."
              );
            }

            const edgeRelation =
              relation ??
              `reflective_${sourceNodeId.replace(/\W+/g, "_")}_${targetNodeId.replace(/\W+/g, "_")}`;

            const edge: DreamEdge = {
              id: insightId("edge"),
              from: sourceNodeId,
              to: targetNodeId,
              type: "hypothetical",
              relation: edgeRelation,
              reason: rationale,
              confidence,
              origin: "rem",
              created_at: now,
              dream_cycle: cycle,
              strategy: "reflective",
              meta: {
                insight_type: "REFLECTIVE_ASSUMPTION",
                code_refs: codeReferences ?? [],
                agent_rationale: rationale,
                ...(tensionLevel
                  ? {
                      triggers_tension: {
                        level: tensionLevel,
                        description: rationale,
                      },
                    }
                  : {}),
              },
              ttl: DEFAULT_DECAY.ttl + 4, // Reflective insights get +4 bonus TTL
              decay_rate: DEFAULT_DECAY.decay_rate,
              reinforcement_count: 0,
              last_reinforced_cycle: cycle,
              status: "candidate",
              activation_score: Math.min(confidence * 0.8, 1.0),
              plausibility: 0,
              evidence_score: 0,
              contradiction_score: 0,
            };

            // Enter REM, write, leave
            const restore = await ensureRem();
            try {
              const { appended, merged } =
                await engine.deduplicateAndAppendEdges([edge]);
              await restore();

              const wasNew = appended.length > 0;
              return success<SolidifyResult>({
                insightType: "EDGE",
                id: wasNew ? edge.id : `(merged into existing)`,
                target_file: "dream_graph.json",
                confidence,
                merged: merged > 0,
                message: wasNew
                  ? `Uusi spekulatiivinen yhteys ${sourceNodeId} → ${targetNodeId} tallennettu unigraafiin. ` +
                    `Se kulkee seuraavan normalisointisyklin läpi.`
                  : `Yhteys ${sourceNodeId} → ${targetNodeId} yhdistetty olemassa olevaan — vahvistus #${merged}.`,
              });
            } catch (err) {
              await restore();
              throw err;
            }
          }

          // ---------------------------------------------------------------
          // TENSION — Write via engine.recordTension()
          // ---------------------------------------------------------------
          if (insightType === "TENSION") {
            const urgencyMap: Record<string, number> = {
              LOW: 0.3,
              MEDIUM: 0.5,
              HIGH: 0.75,
              CRITICAL: 0.95,
            };
            const urgency = urgencyMap[tensionLevel ?? "MEDIUM"] ?? 0.5;

            const entities = targetNodeId
              ? [sourceNodeId, targetNodeId]
              : [sourceNodeId];

            const codeRefStr =
              codeReferences && codeReferences.length > 0
                ? ` (refs: ${codeReferences.join(", ")})`
                : "";

            const tension = await engine.recordTension({
              type: "code_insight",
              entities,
              description: `${rationale}${codeRefStr}`,
              urgency,
            });

            return success<SolidifyResult>({
              insightType: "TENSION",
              id: tension.id,
              target_file: "tension_log.json",
              confidence: urgency,
              merged: tension.occurrences > 1,
              message:
                tension.occurrences > 1
                  ? `Jännite päivitetty: "${tension.id}" (havainto #${tension.occurrences}, urgency ${tension.urgency}).`
                  : `Uusi jännite tallennettu: "${tension.id}" — urgency ${urgency}. ` +
                    `Tension-directed-strategia käsittelee tämän seuraavalla unisyklillä.`,
            });
          }

          // ---------------------------------------------------------------
          // ENTITY — Write a DreamNode to dream_graph.json
          // ---------------------------------------------------------------
          if (insightType === "ENTITY") {
            if (!entityName) {
              return error(
                "MISSING_NAME",
                "ENTITY-tyyppi vaatii entityName-parametrin."
              );
            }

            const node: DreamNode = {
              id: insightId("entity"),
              type: "hypothetical_feature",
              name: entityName,
              description:
                entityDescription ?? rationale,
              inspiration: targetNodeId
                ? [sourceNodeId, targetNodeId]
                : [sourceNodeId],
              confidence,
              origin: "rem",
              created_at: now,
              dream_cycle: cycle,
              ttl: DEFAULT_DECAY.ttl + 4,
              decay_rate: DEFAULT_DECAY.decay_rate,
              reinforcement_count: 0,
              last_reinforced_cycle: cycle,
              status: "candidate",
              activation_score: Math.min(confidence * 0.8, 1.0),
            };

            const restore = await ensureRem();
            try {
              const { appended, merged } =
                await engine.deduplicateAndAppendNodes([node]);
              await restore();

              const wasNew = appended.length > 0;
              return success<SolidifyResult>({
                insightType: "ENTITY",
                id: wasNew ? node.id : `(merged into existing)`,
                target_file: "dream_graph.json",
                confidence,
                merged: merged > 0,
                message: wasNew
                  ? `Hypoteettinen entiteetti "${entityName}" tallennettu unigraafiin.`
                  : `Entiteetti "${entityName}" yhdistetty olemassa olevaan — vahvistus.`,
              });
            } catch (err) {
              await restore();
              throw err;
            }
          }

          return error("INVALID_TYPE", `Tuntematon insightType: ${insightType}`);
        }
      );

      // Safety: always return to AWAKE
      if (engine.getState() !== "awake") {
        await engine.interrupt();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 1 solidify tool (solidify_cognitive_insight)");
}
