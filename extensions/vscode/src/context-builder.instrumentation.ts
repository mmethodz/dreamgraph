import type { ContextEnvironmentMetrics, ContextEvidenceKind, ContextInstrumentation, EvidenceItem } from "./types.js";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildContextInstrumentation(
  included: EvidenceItem[],
  omitted: Array<{ title: string; reason: string; required: boolean; kind?: ContextEvidenceKind }>,
  environment?: ContextEnvironmentMetrics | null,
  previousStablePrefixHash?: string | null,
): { instrumentation: ContextInstrumentation; stablePrefixHash: string } {
  const graphKinds: ContextEvidenceKind[] = [
    "adr",
    "tension",
    "api",
    "workflow",
    "feature",
    "ui",
    "causal",
    "temporal",
    "data_model",
    "cognitive_status",
  ];

  const layerTokenEstimates = {
    environment: included
      .filter((item) => item.kind === "environment")
      .reduce((sum, item) => sum + item.tokenCost, 0),
    task: included
      .filter((item) => item.kind === "task")
      .reduce((sum, item) => sum + item.tokenCost, 0),
    code: included
      .filter((item) => item.kind === "code")
      .reduce((sum, item) => sum + item.tokenCost, 0),
    graph: included
      .filter((item) => graphKinds.includes(item.kind))
      .reduce((sum, item) => sum + item.tokenCost, 0),
    notes: included
      .filter((item) => item.kind === "note")
      .reduce((sum, item) => sum + item.tokenCost, 0),
    totalEvidence: included.reduce((sum, item) => sum + item.tokenCost, 0),
  };

  const includedByKind: Partial<Record<ContextEvidenceKind, number>> = {};
  for (const item of included) {
    includedByKind[item.kind] = (includedByKind[item.kind] ?? 0) + 1;
  }

  const omittedByKind: Partial<Record<ContextEvidenceKind, number>> = {};
  for (const item of omitted) {
    if (!item.kind) continue;
    omittedByKind[item.kind] = (omittedByKind[item.kind] ?? 0) + 1;
  }

  const taskText = included
    .filter((item) => item.kind === "task")
    .map((item) => item.content)
    .join("\n\n");
  const environmentText = included
    .filter((item) => item.kind === "environment")
    .map((item) => item.content)
    .join("\n\n");
  const graphText = included
    .filter((item) => graphKinds.includes(item.kind))
    .map((item) => item.content)
    .join("\n\n");
  const codeText = included
    .filter((item) => item.kind === "code")
    .map((item) => item.content)
    .join("\n\n");
  const notesText = included
    .filter((item) => item.kind === "note")
    .map((item) => item.content)
    .join("\n\n");

  const taskHash = stableHash(taskText);
  const environmentHash = environment?.hash ?? stableHash(environmentText);
  const graphHash = stableHash(graphText);
  const codeHash = stableHash(codeText);
  const notesHash = stableHash(notesText);

  const stablePrefix = [
    "context-architecture:v2",
    environment?.stablePrefixHash ?? environmentHash,
  ].join("\n--\n");
  const stablePrefixHash = stableHash(stablePrefix);
  const stablePrefixBytes = environment?.stablePrefixBytes ?? Buffer.byteLength(stablePrefix, "utf8");
  const stablePrefixTokenEstimate = environment?.stablePrefixTokenEstimate ?? estimateTokens(stablePrefix);
  const stableReuseRatio = previousStablePrefixHash
    ? previousStablePrefixHash === stablePrefixHash ? 1 : 0
    : environment?.stableReuseRatio;
  const churned = previousStablePrefixHash
    ? previousStablePrefixHash !== stablePrefixHash
    : false;

  return {
    stablePrefixHash,
    instrumentation: {
      layerTokenEstimates,
      evidenceCounts: {
        includedByKind,
        omittedByKind,
      },
      environment: environment ?? undefined,
      cacheChurn: {
        stablePrefixHash,
        stablePrefixBytes,
        stablePrefixTokenEstimate,
        stableReuseRatio,
        churned,
        layerHashes: {
          task: taskHash,
          environment: environmentHash,
          graph: graphHash,
          code: codeHash,
          notes: notesHash,
        },
        packetVolatilityKey: `${environment?.volatilityKey ?? environmentHash}::${graphHash}::${codeHash}`,
      },
    },
  };
}
