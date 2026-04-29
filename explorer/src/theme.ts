/**
 * Edge & node visual vocabulary — single source of truth for the SPA.
 *
 * Mirrors plans/DREAMGRAPH_EXPLORER.md §3.2. Phase 1 expresses these
 * with stock Sigma styling (color, thickness, dashed via type=line/arrow);
 * Phase 1.5 will introduce custom Sigma `Program`s for shimmer/pulse.
 */

import type { ExplorerEdgeKind, ExplorerNodeType } from "./types";

export const NODE_COLORS: Record<ExplorerNodeType, string> = {
  feature: "#7aa2ff",      // cool blue
  workflow: "#5dd2c4",     // teal
  data_model: "#f6c177",   // amber
  capability: "#ff8fd6",   // hot pink — distinct from dream
  datastore: "#22d3ee",    // cyan — infrastructure hub (per plans/DATASTORE_AS_HUB.md)
  dream_node: "#b07bff",   // lavender
  tension: "#ff6b6b",      // red
};

export interface EdgeStyle {
  color: string;
  size: number;
  type?: string;
}

export const EDGE_STYLES: Record<ExplorerEdgeKind, EdgeStyle> = {
  fact: { color: "#4b6584", size: 1.2 },
  validated: { color: "#7ee787", size: 1.6 },
  candidate: { color: "#7aa2ff", size: 1.0 },
  dream: { color: "#b284ff", size: 1.0 },
  tension: { color: "#ff6b6b", size: 2.0 },
};

/** Confidence ring will be a custom shader in Phase 1.5; for now we
 *  fake it with a halo color drawn into the node fill. */
export function nodeRenderColor(type: ExplorerNodeType, health: number): string {
  const base = NODE_COLORS[type];
  if (health >= 0.9) return base;
  // Tilt toward warning color when health drops.
  return mixHex(base, "#ff6b6b", Math.min(1, (1 - health) * 1.5));
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r * (1 - t) + pb.r * t);
  const g = Math.round(pa.g * (1 - t) + pb.g * t);
  const bl = Math.round(pa.b * (1 - t) + pb.b * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
