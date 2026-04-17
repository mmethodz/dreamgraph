/**
 * DreamGraph MCP Server — Semantic UI Registry tools.
 *
 * Tools for managing platform-independent UI element definitions:
 *   register_ui_element — Register or update a semantic element
 *   query_ui_elements — Search by category, platform, purpose, or feature
 *   generate_ui_migration_plan — Gap analysis between source and target platforms
 *
 * The registry describes WHAT elements are (purpose, data contract,
 * interaction model, abstract visual/layout intent), not HOW they look.
 *
 * Data file: data/ui_registry.json
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
  UIRegistryFile,
  SemanticElement,
  SemanticElementCategory,
  RegisterUIElementOutput,
  QueryUIElementsOutput,
  GenerateUIMigrationOutput,
  MigrationPortedElement,
  MigrationGapElement,
  ToolResponse,
} from "../types/index.js";

const registryPath = () => dataPath("ui_registry.json");

type ElementStatus = "active" | "transitional" | "deprecated";

async function loadRegistry(): Promise<UIRegistryFile> {
  try {
    if (!existsSync(registryPath())) return emptyRegistry();
    const raw = await readFile(registryPath(), "utf-8");
    const parsed = JSON.parse(raw);

    const empty = emptyRegistry();
    const rawElements = Array.isArray(parsed.elements) ? parsed.elements : [];
    const elements = rawElements.map(normalizeElement);

    return {
      metadata: {
        ...empty.metadata,
        ...(parsed.metadata && typeof parsed.metadata === "object"
          ? parsed.metadata
          : {}),
        schema_version: "1.2.0",
      },
      elements,
      ...(parsed._schema_notes &&
        typeof parsed._schema_notes === "object" && {
          _schema_notes: parsed._schema_notes,
        }),
    };
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(data: UIRegistryFile): Promise<void> {
  data.metadata.total_elements = data.elements.length;
  const categories = new Set(data.elements.map((e) => e.category));
  data.metadata.total_categories = categories.size;
  data.metadata.last_updated = new Date().toISOString();
  data.metadata.schema_version = "1.2.0";
  data._schema_notes = {
    ...(data._schema_notes ?? {}),
    visual_semantics:
      "Abstract visual language: role, emphasis, density, chrome, and state-driven treatments. Never store CSS classes, Tailwind tokens, or pixel values here.",
    layout_semantics:
      "Abstract layout contract: pattern, alignment, sizing, responsive behavior, and hierarchy. Keep framework-agnostic and implementation-independent.",
    lifecycle_fields:
      "status, superseded_by, and deprecation_reason support non-destructive registry retirement. Omitted status means active for backward compatibility.",
  };
  await atomicWriteFile(registryPath(), JSON.stringify(data, null, 2));
  logger.debug("UI registry saved to disk");
}

function emptyRegistry(): UIRegistryFile {
  return {
    metadata: {
      description:
        "Semantic UI Registry — platform-independent element definitions with purpose, data contract, interaction model, abstract visual/layout semantics, and backward-compatible lifecycle governance.",
      schema_version: "1.2.0",
      total_elements: 0,
      total_categories: 0,
      last_updated: null,
    },
    elements: [],
    _schema_notes: {
      visual_semantics:
        "Abstract visual language only. Use semantic roles and hierarchy, not raw styling implementation details.",
      layout_semantics:
        "Abstract layout/composition only. Use patterns and responsive intent, not exact grid props or pixel spacing.",
      lifecycle_fields:
        "Use status/superseded_by/deprecation_reason to mark transitional or deprecated entries without deleting history.",
    },
  };
}

function normalizeElement(raw: any): SemanticElement {
  const normalized: SemanticElement = {
    ...raw,
    implementations: Array.isArray(raw?.implementations) ? raw.implementations : [],
    used_by: Array.isArray(raw?.used_by) ? raw.used_by : [],
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    interactions: Array.isArray(raw?.interactions) ? raw.interactions : [],
    data_contract: {
      inputs: Array.isArray(raw?.data_contract?.inputs) ? raw.data_contract.inputs : [],
      outputs: Array.isArray(raw?.data_contract?.outputs) ? raw.data_contract.outputs : [],
    },
  };

  if (
    raw?.status === "active" ||
    raw?.status === "transitional" ||
    raw?.status === "deprecated"
  ) {
    normalized.status = raw.status;
  }
  if (typeof raw?.superseded_by === "string") normalized.superseded_by = raw.superseded_by;
  if (typeof raw?.deprecation_reason === "string") normalized.deprecation_reason = raw.deprecation_reason;

  return normalized;
}

function effectiveStatus(el: SemanticElement): ElementStatus {
  return el.status ?? "active";
}

function estimateComplexity(
  el: SemanticElement
): "trivial" | "moderate" | "complex" {
  const inputCount = el.data_contract.inputs.length;
  const outputCount = el.data_contract.outputs.length;
  const hasChildren = (el.children?.length ?? 0) > 0;

  if (el.category === "composite") return "complex";
  if (inputCount + outputCount >= 5) return "complex";
  if (inputCount + outputCount >= 2 || hasChildren) return "moderate";
  return "trivial";
}

const VALID_CATEGORIES = [
  "data_display",
  "data_input",
  "navigation",
  "feedback",
  "layout",
  "action",
  "composite",
] as const;

const categorySchema = z.string().describe(
  "Category of UI element. Must be one of: " + VALID_CATEGORIES.join(", ") + "."
);

const lifecycleStatusSchema = z
  .enum(["active", "transitional", "deprecated"])
  .optional()
  .describe("Lifecycle status. Omit for active to preserve backward compatibility.");

const visualSemanticsSchema = z
  .object({
    visual_role: z.string().optional().describe("Semantic visual role, e.g. shell, card, inspector, banner"),
    emphasis: z
      .enum(["primary", "secondary", "muted", "warning", "danger", "success", "info"])
      .optional()
      .describe("Abstract emphasis level"),
    density: z
      .enum(["compact", "comfortable", "spacious"])
      .optional()
      .describe("Abstract information density"),
    chrome: z
      .enum(["minimal", "embedded", "panel", "full_shell"])
      .optional()
      .describe("Abstract chrome/container level"),
    state_styling: z
      .array(
        z.object({
          state: z.string().describe("Named UI state"),
          treatment: z.string().describe("Abstract visual treatment for that state"),
        })
      )
      .optional()
      .describe("State-driven styling semantics without raw CSS/framework details"),
  })
  .optional();

const layoutSemanticsSchema = z
  .object({
    pattern: z
      .enum(["stack", "split_view", "grid", "table", "toolbar", "flow", "inspector", "shell", "dialog"])
      .optional()
      .describe("Abstract layout pattern"),
    alignment: z
      .enum(["leading", "centered", "distributed"])
      .optional()
      .describe("Primary alignment model"),
    sizing_behavior: z
      .enum(["fixed", "fluid", "content_sized", "fill_parent"])
      .optional()
      .describe("Sizing behavior abstraction"),
    responsive_behavior: z
      .array(z.enum(["wrap", "collapse", "scroll", "paginate", "promote_to_dialog"]))
      .optional()
      .describe("Responsive adaptation behaviors"),
    hierarchy: z
      .array(
        z.object({
          region: z.string().describe("Named visual/layout region"),
          role: z.enum(["primary", "secondary", "auxiliary"]).describe("Region hierarchy role"),
        })
      )
      .optional()
      .describe("Named layout hierarchy regions"),
  })
  .optional();

export function registerUIRegistryTools(server: McpServer): void {
  server.tool(
    "register_ui_element",
    "Register a semantic UI element with its purpose, data contract, interaction model, optional abstract visual/layout semantics, and optional lifecycle status for backward-compatible retirement. Platform-independent: describes what the element IS, not how it looks in CSS/framework props. If the element already exists, implementations are merged and other fields are updated.",
    {
      id: z
        .string()
        .describe(
          'Unique identifier, e.g. "data_table", "filter_bar", "entity_profile"'
        ),
      name: z.string().describe("Human-readable name"),
      purpose: z
        .string()
        .describe("The deep intent — what this element exists to do"),
      category: categorySchema,
      inputs: z
        .array(
          z.object({
            name: z.string(),
            type: z.string().describe('"array<T>", "object", "string", etc.'),
            description: z.string(),
            required: z.boolean(),
          })
        )
        .describe("What data this element consumes"),
      outputs: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            description: z.string(),
            trigger: z
              .string()
              .describe('"on_click", "on_change", "on_submit", etc.'),
          })
        )
        .describe("What data this element emits"),
      interactions: z
        .array(
          z.object({
            action: z
              .string()
              .describe('"sort", "filter", "select", "edit_inline", etc.'),
            description: z.string(),
          })
        )
        .describe("What the user can do with this element"),
      children: z
        .array(z.string())
        .optional()
        .describe("SemanticElement IDs of child elements"),
      implementations: z
        .array(
          z.object({
            platform: z
              .string()
              .describe('"react", "maui", "swiftui", "html", "flutter"'),
            component: z
              .string()
              .describe('"DataGrid", "UITableView", "<table>", etc.'),
            source_file: z.string().optional(),
            notes: z.string().optional(),
          })
        )
        .optional()
        .describe("Known platform implementations"),
      used_by: z
        .array(z.string())
        .optional()
        .describe("Feature IDs that use this element"),
      tags: z.array(z.string()).optional().describe("Tags for searchability"),
      status: lifecycleStatusSchema,
      superseded_by: z
        .string()
        .optional()
        .describe("Canonical replacement ID when this entry is transitional or deprecated"),
      deprecation_reason: z
        .string()
        .optional()
        .describe("Reason this entry is transitional/deprecated"),
      state: z
        .record(z.string(), z.enum(["boolean", "string", "number"]))
        .optional()
        .describe(
          'Observable state flags, e.g. { "is_generating": "boolean", "has_image": "boolean" }'
        ),
      flows: z
        .array(z.string())
        .optional()
        .describe(
          'Ordered workflow flows, e.g. ["prompt → generate → display → edit → save"]'
        ),
      error_states: z
        .array(
          z.object({
            condition: z.string().describe("When this error occurs"),
            behavior: z.string().describe("How the element responds"),
            severity: z
              .enum(["info", "warning", "error", "fatal"])
              .optional()
              .describe("Severity level"),
          })
        )
        .optional()
        .describe("Known error/edge-case states"),
      rendering_capabilities: z
        .array(z.string())
        .optional()
        .describe(
          'Capability-based abstraction, e.g. ["touch", "mouse", "keyboard", "voice"]'
        ),
      visual_semantics: visualSemanticsSchema.describe(
        "Abstract visual semantics: role, emphasis, density, chrome, and state styling semantics"
      ),
      layout_semantics: layoutSemanticsSchema.describe(
        "Abstract layout semantics: pattern, alignment, sizing, responsive behavior, and hierarchy"
      ),
      is_async: z
        .boolean()
        .optional()
        .describe("Whether the element involves async operations"),
      default_action: z
        .string()
        .optional()
        .describe("Default/primary action when invoked without specifics"),
      visibility_conditions: z
        .array(z.string())
        .optional()
        .describe(
          'Conditions controlling visibility, e.g. ["has_api_key", "has_image"]'
        ),
    },
    async (params) => {
      logger.debug(`register_ui_element called: "${params.id}"`);

      const result = await safeExecute<RegisterUIElementOutput>(
        async (): Promise<ToolResponse<RegisterUIElementOutput>> =>
          withFileLock("ui_registry.json", async () => {
            const registry = await loadRegistry();
            const existing = registry.elements.find((e) => e.id === params.id);
            let merged = false;

            if (existing) {
              existing.name = params.name;
              existing.purpose = params.purpose;
              existing.category = params.category as SemanticElementCategory;
              existing.data_contract = {
                inputs: params.inputs,
                outputs: params.outputs,
              };
              existing.interactions = params.interactions;
              if (params.children !== undefined) existing.children = params.children;
              existing.tags = params.tags ?? existing.tags;

              if (params.status !== undefined) existing.status = params.status;
              if (params.superseded_by !== undefined) existing.superseded_by = params.superseded_by;
              if (params.deprecation_reason !== undefined) existing.deprecation_reason = params.deprecation_reason;

              if (params.state !== undefined) existing.state = params.state;
              if (params.flows !== undefined) existing.flows = params.flows;
              if (params.error_states !== undefined)
                existing.error_states = params.error_states;
              if (params.rendering_capabilities !== undefined)
                existing.rendering_capabilities = params.rendering_capabilities;
              if (params.visual_semantics !== undefined)
                existing.visual_semantics = params.visual_semantics;
              if (params.layout_semantics !== undefined)
                existing.layout_semantics = params.layout_semantics;

              if (params.is_async !== undefined) existing.is_async = params.is_async;
              if (params.default_action !== undefined)
                existing.default_action = params.default_action;
              if (params.visibility_conditions !== undefined)
                existing.visibility_conditions = params.visibility_conditions;

              const newImpls = params.implementations ?? [];
              for (const impl of newImpls) {
                const idx = existing.implementations.findIndex(
                  (i) => i.platform === impl.platform
                );
                if (idx >= 0) {
                  existing.implementations[idx] = impl;
                } else {
                  existing.implementations.push(impl);
                }
              }

              const usedBySet = new Set([
                ...existing.used_by,
                ...(params.used_by ?? []),
              ]);
              existing.used_by = [...usedBySet];

              merged = true;
            } else {
              const element: SemanticElement = {
                id: params.id,
                name: params.name,
                purpose: params.purpose,
                category: params.category as SemanticElementCategory,
                data_contract: {
                  inputs: params.inputs,
                  outputs: params.outputs,
                },
                interactions: params.interactions,
                children: params.children,
                implementations: params.implementations ?? [],
                used_by: params.used_by ?? [],
                tags: params.tags ?? [],
                ...(params.status !== undefined && { status: params.status }),
                ...(params.superseded_by !== undefined && {
                  superseded_by: params.superseded_by,
                }),
                ...(params.deprecation_reason !== undefined && {
                  deprecation_reason: params.deprecation_reason,
                }),
                ...(params.state !== undefined && { state: params.state }),
                ...(params.flows !== undefined && { flows: params.flows }),
                ...(params.error_states !== undefined && {
                  error_states: params.error_states,
                }),
                ...(params.rendering_capabilities !== undefined && {
                  rendering_capabilities: params.rendering_capabilities,
                }),
                ...(params.visual_semantics !== undefined && {
                  visual_semantics: params.visual_semantics,
                }),
                ...(params.layout_semantics !== undefined && {
                  layout_semantics: params.layout_semantics,
                }),
                ...(params.is_async !== undefined && { is_async: params.is_async }),
                ...(params.default_action !== undefined && {
                  default_action: params.default_action,
                }),
                ...(params.visibility_conditions !== undefined && {
                  visibility_conditions: params.visibility_conditions,
                }),
              };
              registry.elements.push(element);
            }

            await saveRegistry(registry);

            return success({
              element_id: params.id,
              name: params.name,
              category: params.category,
              inputs_count: params.inputs.length,
              outputs_count: params.outputs.length,
              merged,
              message: merged
                ? `Updated existing semantic element "${params.id}". Implementations merged.`
                : `Registered new semantic element "${params.id}" (${params.category}).`,
            });
          })
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "query_ui_elements",
    "Search the semantic UI registry by category, purpose, platform, or feature. Returns elements with their full data contracts. Use missing_platform to find elements that need porting to a target platform.",
    {
      category: categorySchema
        .optional()
        .describe("Filter by element category. Must be one of: " + VALID_CATEGORIES.join(", ") + "."),
      purpose_search: z
        .string()
        .optional()
        .describe("Search purpose text"),
      platform: z
        .string()
        .optional()
        .describe("Return elements implemented for this platform"),
      feature_id: z
        .string()
        .optional()
        .describe("Return elements used by this feature"),
      missing_platform: z
        .string()
        .optional()
        .describe(
          "Return elements that do NOT have an implementation for this platform — instant migration checklist"
        ),
      status: z
        .enum(["active", "transitional", "deprecated"])
        .optional()
        .describe("Filter by lifecycle status. Omitted means all statuses."),
      exclude_deprecated: z
        .boolean()
        .optional()
        .describe("When true, hide deprecated entries from results."),
    },
    async (params) => {
      logger.debug("query_ui_elements called");

      const result = await safeExecute<QueryUIElementsOutput>(
        async (): Promise<ToolResponse<QueryUIElementsOutput>> => {
          const registry = await loadRegistry();
          let filtered = [...registry.elements];

          if (params.category) {
            filtered = filtered.filter((e) => e.category === params.category);
          }

          if (params.purpose_search) {
            const q = params.purpose_search.toLowerCase();
            filtered = filtered.filter((e) =>
              e.purpose.toLowerCase().includes(q)
            );
          }

          if (params.platform) {
            const p = params.platform.toLowerCase();
            filtered = filtered.filter((e) =>
              e.implementations.some((i) => i.platform.toLowerCase() === p)
            );
          }

          if (params.feature_id) {
            const fid = params.feature_id.toLowerCase();
            filtered = filtered.filter((e) =>
              e.used_by.some((u) => u.toLowerCase() === fid)
            );
          }

          if (params.missing_platform) {
            const mp = params.missing_platform.toLowerCase();
            filtered = filtered.filter(
              (e) =>
                !e.implementations.some(
                  (i) => i.platform.toLowerCase() === mp
                )
            );
          }

          if (params.status) {
            filtered = filtered.filter((e) => effectiveStatus(e) === params.status);
          }

          if (params.exclude_deprecated === true) {
            filtered = filtered.filter((e) => effectiveStatus(e) !== "deprecated");
          }

          const categories: Record<string, number> = {};
          const platforms: Record<string, number> = {};
          for (const el of filtered) {
            categories[el.category] = (categories[el.category] ?? 0) + 1;
            for (const impl of el.implementations) {
              platforms[impl.platform] =
                (platforms[impl.platform] ?? 0) + 1;
            }
          }

          return success({
            elements: filtered,
            total: filtered.length,
            categories,
            platforms,
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "generate_ui_migration_plan",
    "Generate a platform migration plan. Lists all semantic elements from the source platform, checks which already exist on the target platform, and produces a gap analysis with data contract summaries and complexity estimates. Deprecated entries are excluded by default.",
    {
      source_platform: z
        .string()
        .describe('Source platform, e.g. "react"'),
      target_platform: z
        .string()
        .describe('Target platform, e.g. "swiftui"'),
      scope: z
        .array(z.string())
        .optional()
        .describe("Optional: limit to these feature IDs"),
    },
    async (params) => {
      logger.debug(
        `generate_ui_migration_plan: ${params.source_platform} → ${params.target_platform}`
      );

      const result = await safeExecute<GenerateUIMigrationOutput>(
        async (): Promise<ToolResponse<GenerateUIMigrationOutput>> => {
          const registry = await loadRegistry();
          const src = params.source_platform.toLowerCase();
          const tgt = params.target_platform.toLowerCase();

          let sourceElements = registry.elements.filter(
            (e) =>
              effectiveStatus(e) !== "deprecated" &&
              e.implementations.some((i) => i.platform.toLowerCase() === src)
          );

          if (params.scope && params.scope.length > 0) {
            const scopeSet = new Set(
              params.scope.map((s) => s.toLowerCase())
            );
            sourceElements = sourceElements.filter((e) =>
              e.used_by.some((u) => scopeSet.has(u.toLowerCase()))
            );
          }

          const ported: MigrationPortedElement[] = [];
          const gaps: MigrationGapElement[] = [];

          for (const el of sourceElements) {
            const srcImpl = el.implementations.find(
              (i) => i.platform.toLowerCase() === src
            );
            const tgtImpl = el.implementations.find(
              (i) => i.platform.toLowerCase() === tgt
            );

            if (srcImpl && tgtImpl) {
              ported.push({
                element_id: el.id,
                name: el.name,
                source_component: srcImpl.component,
                target_component: tgtImpl.component,
              });
            } else if (srcImpl) {
              gaps.push({
                element_id: el.id,
                name: el.name,
                purpose: el.purpose,
                category: el.category,
                source_component: srcImpl.component,
                data_contract_summary: `inputs: ${el.data_contract.inputs.map((i) => `${i.name}: ${i.type}`).join(", ") || "none"}; outputs: ${el.data_contract.outputs.map((o) => `${o.name}: ${o.type}`).join(", ") || "none"}; interactions: ${el.interactions.map((i) => i.action).join(", ") || "none"}`,
                complexity_estimate: estimateComplexity(el),
              });
            }
          }

          return success({
            source_platform: params.source_platform,
            target_platform: params.target_platform,
            already_ported: ported,
            migration_needed: gaps,
            total_elements: sourceElements.length,
            ported_count: ported.length,
            gap_count: gaps.length,
            coverage_percent:
              sourceElements.length === 0
                ? 100
                : Math.round((ported.length / sourceElements.length) * 100),
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );
}
