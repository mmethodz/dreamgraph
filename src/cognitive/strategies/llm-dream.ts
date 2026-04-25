/**
 * Strategy 7 — LLM Dream (creative core).
 *
 * Uses an LLM to creatively analyze the knowledge graph and propose
 * connections that no structural algorithm would find. Includes
 * tension-weighted entity selection, source-code grounding, structured
 * output schema, and an evidence-verification parser.
 *
 * Co-located with `parseLlmDreamResponse` and `DREAM_RESPONSE_SCHEMA`.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import { logger } from "../../utils/logger.js";
import { engine } from "../engine.js";
import {
  getLlmProvider,
  isLlmAvailable,
  getDreamerLlmConfig,
  type LlmMessage,
} from "../llm.js";
import type { DreamEdge, DreamNode, TensionSignal } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { groundEntities } from "../../utils/senses.js";
import { dreamId, type FactSnapshot } from "./_shared.js";

// ---------------------------------------------------------------------------
// OpenAI Structured Outputs schema for dream responses.
// When `strict: true`, OpenAI guarantees every response matches this schema
// exactly — no malformed JSON, no missing fields, no matter how creative the
// string values get (temperature 0.9+).
//
// For Ollama this falls back to basic `format: "json"`.
// ---------------------------------------------------------------------------

const DREAM_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from:       { type: "string", description: "Source entity ID" },
          to:         { type: "string", description: "Target entity ID" },
          relation:   { type: "string", description: "Relationship verb" },
          reason:     { type: "string", description: "Why this connection exists (1-2 sentences)" },
          confidence: { type: "number", description: "0.0-1.0 confidence estimate" },
          type:       { type: "string", description: "Edge type (default: hypothetical)" },
          source_evidence: { type: "string", description: "REQUIRED: The source file path and line/function/class that justifies this connection. Must reference code from the Source Code Evidence section. Example: 'src/MEF/Hosting/ToolHost.cs:LoadPlugins() calls IPlugin.Initialize() — proving dependency chain'" },
        },
        required: ["from", "to", "relation", "reason", "confidence", "type", "source_evidence"],
        additionalProperties: false,
      },
    },
    new_nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:          { type: "string", description: "Unique ID (e.g. dream_llm_<name>)" },
          name:        { type: "string", description: "Human-readable name" },
          description: { type: "string", description: "What this concept represents" },
          intent:      { type: "string", description: "Speculative intent — WHY this entity should exist and what role it plays (becomes factual after normalization)" },
          type:        { type: "string", description: "Node type (default: hypothetical_feature)" },
          domain:      { type: "string", description: "Domain tag (e.g. inference, core, ui, networking)" },
          keywords:    { type: "array", items: { type: "string" }, description: "Semantic keywords for grounding" },
          category:    { type: "string", enum: ["feature", "workflow", "data_model"], description: "Target seed category if promoted" },
        },
        required: ["id", "name", "description", "intent", "type", "domain", "keywords", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["edges", "new_nodes"],
  additionalProperties: false,
};

/**
 * The heart of DreamGraph. Uses an LLM to creatively analyze the
 * knowledge graph and propose connections that no structural algorithm
 * would find. This is ACTUAL dreaming — speculative, creative, insightful.
 */
export async function llmDream(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): Promise<{ edges: DreamEdge[]; nodes: DreamNode[] }> {
  const edges: DreamEdge[] = [];
  const nodes: DreamNode[] = [];
  const now = new Date().toISOString();

  // Check LLM availability
  const available = await isLlmAvailable();
  if (!available) {
    logger.warn("LLM dream: provider not available — check DREAMGRAPH_LLM_PROVIDER, DREAMGRAPH_LLM_API_KEY, and model config. Skipping LLM dreaming.");
    return { edges, nodes };
  }

  const llm = getLlmProvider();

  // Build context for the LLM — summarize the knowledge graph
  const entitySummaries: string[] = [];
  const edgeSummaries: string[] = [];
  const entityIds = Array.from(snapshot.entities.keys());

  // -----------------------------------------------------------------------
  // Tension-weighted entity selection
  // -----------------------------------------------------------------------
  let tensionsForSelection: TensionSignal[] = [];
  try {
    tensionsForSelection = await engine.getUnresolvedTensions();
  } catch { /* ignore */ }

  const tensionEntityIds = new Set<string>();
  const tensionDomains = new Map<string, number>();
  for (const t of tensionsForSelection) {
    for (const eid of t.entities) tensionEntityIds.add(eid);
    const d = t.domain ?? "general";
    tensionDomains.set(d, (tensionDomains.get(d) ?? 0) + t.urgency);
  }

  const allEntities = Array.from(snapshot.entities.values());
  const scored = allEntities.map((e) => {
    let score = 0;
    if (tensionEntityIds.has(e.id)) score += 5.0;
    if (e.domain && tensionDomains.has(e.domain)) {
      score += (tensionDomains.get(e.domain) ?? 0) * 1.5;
    }
    if (e.type === "data_model") score += 1.0;
    if (e.type === "workflow") score += 0.8;
    score += Math.min(e.links.length * 0.15, 1.5);
    if (e.description && e.description.length > 50) score += 0.3;
    score += Math.random() * 0.5;
    return { entity: e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const entitiesToSummarize = scored.slice(0, 80).map((s) => s.entity);

  // --- BLINDFOLDED SUMMARIES ---
  for (const e of entitiesToSummarize) {
    const parts = [`[${e.id}] ${e.name} (${e.type}, domain: ${e.domain || "none"})`];
    if (e.source_files.length > 0) parts.push(`  files: ${e.source_files.slice(0, 3).join(", ")}`);
    entitySummaries.push(parts.join("\n"));
  }

  // Only show VALIDATED edges (cap at 20)
  let edgeCount = 0;
  for (const e of snapshot.entities.values()) {
    if (edgeCount >= 20) break;
    for (const link of e.links) {
      if (edgeCount >= 20) break;
      if (link.strength === "strong" || link.strength === "moderate") {
        edgeSummaries.push(
          `${e.id} --[${link.relationship}]--> ${link.target}`,
        );
        edgeCount++;
      }
    }
  }

  // Get recent tensions for context
  let tensionContext = "";
  try {
    const tensions = await engine.getUnresolvedTensions();
    if (tensions.length > 0) {
      tensionContext = "\n## Active Tensions (areas the system struggles with)\n" +
        tensions.slice(0, 10).map((t) =>
          `- [${t.type}] ${t.description} (urgency: ${t.urgency}, entities: ${t.entities.join(", ")})`,
        ).join("\n");
    }
  } catch { /* ignore */ }

  // Get recently validated edges
  let validatedContext = "";
  try {
    const validated = await engine.getRecentValidatedEdges(10);
    if (validated.length > 0) {
      validatedContext = "\n## Recently Validated Insights (high-confidence discoveries)\n" +
        validated.map((v) =>
          `- ${v.from} --[${v.relation}]--> ${v.to} (confidence: ${v.confidence})`,
        ).join("\n");
    }
  } catch { /* ignore */ }

  // -----------------------------------------------------------------------
  // Reality Grounding Phase
  // -----------------------------------------------------------------------
  let groundingContext = "";
  try {
    const entitiesToGround = entitiesToSummarize
      .filter((e) => e.source_files.length > 0)
      .sort((a, b) => {
        const aT = tensionEntityIds.has(a.id) ? 1 : 0;
        const bT = tensionEntityIds.has(b.id) ? 1 : 0;
        return bT - aT;
      })
      .slice(0, 8)
      .map((e) => ({ id: e.id, sourceFiles: e.source_files }));

    if (entitiesToGround.length > 0) {
      const grounding = await groundEntities(entitiesToGround, 8, 40);
      if (grounding.length > 0) {
        const snippets = grounding.map((g) => {
          let text = `### ${g.entityId} — ${g.file}\n\`\`\`\n${g.snippet}\n\`\`\``;
          if (g.recentChanges && g.recentChanges.length > 0) {
            text += `\nRecent changes: ${g.recentChanges.map((c) => c.message).join("; ")}`;
          }
          return text;
        });
        groundingContext = "\n## Source Code Evidence (real code from the project)\n" +
          snippets.join("\n\n");
        logger.info(
          `LLM dream grounding: read ${grounding.length} source files for ${entitiesToGround.length} entities`,
        );
      }
    }
  } catch (err) {
    logger.debug(`LLM dream grounding: failed (${err instanceof Error ? err.message : "error"})`);
  }

  const systemPrompt = `You are the cognitive dream engine of DreamGraph — a knowledge graph system that analyzes software projects. Your role is to DREAM: to make creative, speculative connections between entities that structural analysis alone would miss.

You analyze a knowledge graph of features, workflows, and data models and propose NOVEL relationships, hidden patterns, architectural insights, and potential risks.

Rules:
- Output ONLY valid JSON — an array of edge objects
- Each edge needs: from (entity ID), to (entity ID), relation (verb), reason (1-2 sentences WHY), confidence (0.0-1.0), type ("hypothetical" for dream edges), and source_evidence (MANDATORY)
- Use EXISTING entity IDs from the graph (listed below). Do NOT invent entity IDs.
- **PROOF OF WORK**: Every edge MUST include a "source_evidence" field citing the specific source file path, function, class, or line from the Source Code Evidence section below. Edges without source evidence will be REJECTED by the normalizer. If you cannot cite real code, do not propose the edge.
- Be creative but grounded IN THE CODE — propose connections that the source code PROVES or strongly implies
- Focus on: hidden dependencies found in actual imports/calls, architectural patterns visible in code structure, data flow through actual function signatures, integration points proven by shared interfaces
- Confidence guide: 0.3-0.5 = code hints at it, 0.5-0.7 = code structure supports it, 0.7-0.9 = code directly proves it
- Aim for ${Math.min(max, 15)} edges (quality over quantity)
- **NEW CONCEPTS**: Actively propose 2-5 new_node objects for concepts the graph is MISSING. Look for: shared abstractions (e.g. a "Billing Pipeline" hub connecting invoice, payment, subscription features), cross-cutting concerns (authorization layer, audit logging, caching strategy), unnamed integration points, and architectural patterns visible in the code. Each new_node needs: id (dream_llm_<snake_case_name>), name, description, intent (WHY this concept should exist), type ("hypothetical_feature" or "hypothetical_workflow" or "hypothetical_entity"), domain (match an existing domain from the graph, e.g. "invoicing", "core", "auth"), keywords (array of semantic tags that overlap with existing entity keywords), and category ("feature", "workflow", or "data_model"). Nodes with strong domain and keyword grounding will be promoted into the fact graph after normalization.
- Copy-paste exact identifiers, class names, or short code fragments (under 50 characters). Do NOT include markdown formatting, newlines, or extra indentation in the source_evidence string, as this will break the exact substring verification.
- Output format MUST be strictly this JSON array:
  [
    {
      "from": "entity-1",
      "to": "entity-2",
      "relation": "implements",
      "reason": "Because Class A implements Interface B.",
      "confidence": 0.8,
      "type": "hypothetical",
      "source_evidence": "public class JsonFormatter : IGuiTool",
      "new_node": null // OR the new node object if applicable
    }
  ]

CRITICAL: Your source_evidence field is verified programmatically against the actual source code provided. If it contains ANY text not present in the Source Code Evidence section, the edge is REJECTED. Copy-paste exact identifiers, class names, method names, or code fragments. Do NOT paraphrase, abbreviate, or invent code.

CRITICAL: If the provided source code does NOT contain evidence for a connection, return FEWER edges or an empty array. It is better to return 0 edges than to fabricate evidence. Empty arrays are a valid and expected response.`;

  const userPrompt = `# Knowledge Graph — Dream Cycle #${cycle}

## Entities (${snapshot.entities.size} total)
${entitySummaries.join("\n\n")}

## Known Edges (${snapshot.edgeSet.size} total, showing ${edgeSummaries.length})
${edgeSummaries.join("\n")}

## Domains
${Array.from(snapshot.domains).join(", ")}

## Source File Overlaps (entities sharing implementation files)
${Array.from(snapshot.sourceFileIndex.entries())
  .filter(([, ids]) => ids.length > 1)
  .slice(0, 20)
  .map(([file, ids]) => `${file}: ${ids.join(", ")}`)
  .join("\n") || "(none detected)"}
${tensionContext}
${validatedContext}
${groundingContext}

Analyze the SOURCE CODE EVIDENCE above together with the entity graph. Propose ${Math.min(max, 15)} edge hypotheses that are GROUNDED IN THE CODE you can see. Every edge must cite specific source evidence.

Also propose 2-5 new_nodes for MISSING CONCEPTS — shared abstractions, integration hubs, cross-cutting concerns, or architectural patterns that the current graph doesn't capture but the code implies. Use domain and keywords that match existing entities so the normalizer can ground them.

Output a JSON object with:
{
  "edges": [
    { "from": "entity_id", "to": "entity_id", "relation": "verb", "reason": "why this connection", "confidence": 0.5, "source_evidence": "src/path/File.cs:ClassName.Method() — proves X" }
  ],
  "new_nodes": [
    { "id": "dream_llm_name", "name": "Descriptive Name", "description": "What this concept represents", "intent": "WHY this entity should exist and what role it plays in the system", "type": "hypothetical_feature", "domain": "core", "keywords": ["tag1", "tag2"], "category": "feature" }
  ]
}`;

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const dreamerCfg = getDreamerLlmConfig();
    logger.info(
      `LLM dream: sending prompt (${entitySummaries.length} entities, ${edgeSummaries.length} edges) ` +
      `to model=${dreamerCfg.model}, temp=${dreamerCfg.temperature}, maxTokens=${dreamerCfg.maxTokens}`,
    );

    const response = await llm.complete(messages, {
      temperature: dreamerCfg.temperature,
      maxTokens: dreamerCfg.maxTokens,
      model: dreamerCfg.model,
      jsonSchema: {
        name: "dream_response",
        schema: DREAM_RESPONSE_SCHEMA,
      },
    });

    logger.info(`LLM dream: received ${response.text.length} chars from ${response.model}`);

    const parsed = parseLlmDreamResponse(response.text, snapshot, cycle, now, entityIds, groundingContext);
    edges.push(...parsed.edges.slice(0, max));
    nodes.push(...parsed.nodes.slice(0, Math.ceil(max / 2)));

    logger.info(
      `LLM dream: ${edges.length} edges, ${nodes.length} nodes from ${response.model} ` +
      `(${response.tokensUsed ?? "?"} tokens)`,
    );
  } catch (err) {
    const dreamerModel = getDreamerLlmConfig().model;
    const providerName = getLlmProvider().name;
    logger.warn(
      `LLM dream FAILED (provider=${providerName}, model=${dreamerModel}): ` +
      `${err instanceof Error ? err.message : "unknown error"}. ` +
      `Check the model name and API key in Dashboard > Config > LLM.`,
    );
  }

  return { edges, nodes };
}

/**
 * Parse LLM response JSON into DreamEdge[] and DreamNode[].
 * Tolerant parser — handles partial/malformed output gracefully.
 */
function parseLlmDreamResponse(
  text: string,
  snapshot: FactSnapshot,
  cycle: number,
  now: string,
  knownIds: string[],
  groundingContext: string = "",
): { edges: DreamEdge[]; nodes: DreamNode[] } {
  const edges: DreamEdge[] = [];
  const nodes: DreamNode[] = [];

  let data: {
    edges?: Array<{
      from?: string;
      to?: string;
      relation?: string;
      reason?: string;
      confidence?: number;
      type?: string;
      source_evidence?: string;
    }>;
    new_nodes?: Array<{
      id?: string;
      name?: string;
      description?: string;
      intent?: string;
      type?: string;
      domain?: string;
      keywords?: string[];
      category?: string;
    }>;
  };

  try {
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];

    data = JSON.parse(jsonStr);
  } catch {
    logger.debug("LLM dream: failed to parse JSON response");
    return { edges, nodes };
  }

  const idSet = new Set(knownIds);

  // Process new nodes first (so their IDs are available for edges)
  const newNodeIds = new Set<string>();
  for (const n of data.new_nodes ?? []) {
    if (!n.id || !n.name) continue;

    const nodeId = n.id.startsWith("dream_") ? n.id : `dream_llm_${n.id}`;
    newNodeIds.add(nodeId);

    let category: DreamNode["category"];
    if (n.category === "feature" || n.category === "workflow" || n.category === "data_model") {
      category = n.category;
    } else if (n.type?.includes("workflow")) {
      category = "workflow";
    } else if (n.type?.includes("entity") || n.type?.includes("data_model")) {
      category = "data_model";
    } else {
      category = "feature";
    }

    const nodeInspiration: string[] = [];
    const nodeDomain = (n.domain ?? "").toLowerCase();
    const nodeKws = new Set((n.keywords ?? []).map((k: string) => k.toLowerCase()));
    for (const eid of knownIds) {
      if (nodeInspiration.length >= 8) break;
      const entity = snapshot.entities.get(eid);
      if (!entity) continue;
      const domainMatch = nodeDomain && entity.domain?.toLowerCase() === nodeDomain;
      const kwMatch = entity.keywords?.some((k: string) => nodeKws.has(k.toLowerCase()));
      if (domainMatch || kwMatch) nodeInspiration.push(eid);
    }

    nodes.push({
      id: nodeId,
      type: (n.type as DreamNode["type"]) ?? "hypothetical_feature",
      name: n.name,
      description: n.description ?? "",
      intent: n.intent ?? "",
      inspiration: nodeInspiration,
      confidence: 0.4,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      ttl: DEFAULT_DECAY.ttl,
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      domain: n.domain ?? "",
      keywords: Array.isArray(n.keywords) ? n.keywords : [],
      category,
    });
  }

  const normalizedGrounding = groundingContext.replace(/\s+/g, " ").toLowerCase();

  function isEvidenceGrounded(evidence: string): boolean {
    if (!evidence || evidence.trim().length < 10) return false;
    if (!normalizedGrounding) return false;

    const tokens = evidence.match(/[A-Za-z_][A-Za-z0-9_.]{3,}/g) ?? [];
    const uniqueTokens = [...new Set(tokens.map((t) => t.toLowerCase()))];

    let matchCount = 0;
    for (const token of uniqueTokens) {
      if (normalizedGrounding.includes(token)) {
        matchCount++;
      }
    }

    return matchCount >= 2;
  }

  let rejectedNoEvidence = 0;
  let rejectedFakeEvidence = 0;
  for (const e of data.edges ?? []) {
    if (!e.from || !e.to || !e.relation) continue;

    if (!e.source_evidence || e.source_evidence.trim().length < 10) {
      rejectedNoEvidence++;
      continue;
    }

    if (!isEvidenceGrounded(e.source_evidence)) {
      rejectedFakeEvidence++;
      logger.debug(`LLM dream: rejected fabricated evidence: "${e.source_evidence.slice(0, 80)}..."`);
      continue;
    }

    const fromValid = idSet.has(e.from) || newNodeIds.has(e.from);
    const toValid = idSet.has(e.to) || newNodeIds.has(e.to);
    if (!fromValid || !toValid) {
      logger.debug(`LLM dream: skipping edge with unknown ID: ${e.from} → ${e.to}`);
      continue;
    }

    if (snapshot.edgeSet.has(`${e.from}|${e.to}`)) continue;

    const confidence = typeof e.confidence === "number"
      ? Math.max(0, Math.min(e.confidence, 1))
      : 0.5;

    edges.push({
      id: dreamId("llm"),
      from: e.from,
      to: e.to,
      type: (e.type as DreamEdge["type"]) ?? "hypothetical",
      relation: e.relation,
      reason: e.reason ?? `LLM-generated: ${e.from} → ${e.to}`,
      confidence: Math.round(confidence * 100) / 100,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "llm_dream",
      meta: { llm_generated: true, source_evidence: e.source_evidence ?? "" },
      ttl: DEFAULT_DECAY.ttl + 2,
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
  }

  if (rejectedNoEvidence > 0 || rejectedFakeEvidence > 0) {
    logger.info(`LLM dream: rejected ${rejectedNoEvidence} edges with no evidence, ${rejectedFakeEvidence} with fabricated evidence (proof-of-work filter)`);
  }

  // Backfill node inspiration from accepted edges
  for (const node of nodes) {
    const existing = new Set(node.inspiration);
    for (const edge of edges) {
      if (existing.size >= 12) break;
      if (edge.from === node.id && idSet.has(edge.to) && !existing.has(edge.to)) {
        existing.add(edge.to);
      } else if (edge.to === node.id && idSet.has(edge.from) && !existing.has(edge.from)) {
        existing.add(edge.from);
      }
    }
    node.inspiration = [...existing];
  }

  return { edges, nodes };
}
