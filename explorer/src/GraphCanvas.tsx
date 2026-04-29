import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Attributes } from "graphology-types";
import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import {
  NodeRingProgram,
  NODE_KIND_DREAM,
  NODE_KIND_FOCUSED,
  NODE_KIND_NEUTRAL,
  NODE_KIND_TENSION,
  type NodeRingDisplayData,
} from "./programs/NodeRingProgram";
import {
  EdgeFancyProgram,
  EDGE_KIND_CANDIDATE,
  EDGE_KIND_DREAM,
  EDGE_KIND_FACT,
  EDGE_KIND_TENSION,
  EDGE_KIND_VALIDATED,
} from "./programs/EdgeFancyProgram";
import type { ExplorerEdgeKind, ExplorerNodeType, GraphSnapshot } from "./types";
import { EDGE_STYLES, NODE_COLORS } from "./theme";
import { postClientMetrics } from "./api";
import type { ExplorerMode, FilterState } from "./filters";
import { PulseOverlay } from "./PulseOverlay";
import type { PulseToken } from "./sse";

interface Props {
  snapshot: GraphSnapshot;
  onSelect: (nodeId: string | null) => void;
  filters: FilterState;
  mode: ExplorerMode;
  selected: string | null;
  pulses?: PulseToken[];
}

interface NodeAttrs extends Attributes {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  ringColor: string;
  ringKind: number;
  health: number;
  confidence: number;
  nodeType: string;
  degree: number;
  type: "ring";
}

interface EdgeAttrs extends Attributes {
  color: string;
  colorStart: string;
  colorEnd: string;
  size: number;
  edgeKind: number;
  edgeKindName: string;
  conf: number;
  type: "fancy";
}

export function GraphCanvas({ snapshot, onSelect, filters, mode, selected, pulses }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  hoveredRef.current = hovered;

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Pre-compute focus set when in focus mode (selected + 2-hop neighbors).
  const focusSetRef = useRef<Set<string> | null>(null);

  // Pre-compute the undirected neighborhood once so the hover reducer is O(1).
  const neighborhood = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of snapshot.edges) {
      if (!map.has(e.s)) map.set(e.s, new Set());
      if (!map.has(e.t)) map.set(e.t, new Set());
      map.get(e.s)!.add(e.t);
      map.get(e.t)!.add(e.s);
    }
    return map;
  }, [snapshot]);
  const neighborhoodRef = useRef(neighborhood);
  neighborhoodRef.current = neighborhood;

  // When the hovered or selected node changes, pre-compute its 1/2/3-hop
  // neighbor sets once. The reducer then does O(1) Set lookups per node.
  // We also drive a temporal fade (intensityRef) so the highlight eases
  // in/out instead of snapping when the user moves the mouse.
  const ringsRef = useRef<{ d1: Set<string>; d2: Set<string>; d3: Set<string> }>({
    d1: new Set(),
    d2: new Set(),
    d3: new Set(),
  });
  /** The node currently driving the ripple (hover wins, else selected). */
  const anchorRef = useRef<string | null>(null);
  /** Animated 0..1 — 1 = full ripple, 0 = back to default. */
  const intensityRef = useRef(0);
  /** Where the rAF loop is easing intensity toward. */
  const targetIntensityRef = useRef(0);

  useEffect(() => {
    const next = hovered ?? selected;
    if (!next) {
      // Fade out, but keep anchor + rings until intensity actually reaches 0
      // (the rAF loop clears them once the fade completes).
      targetIntensityRef.current = 0;
      return;
    }
    if (next !== anchorRef.current) {
      anchorRef.current = next;
      const d1 = new Set(neighborhood.get(next) ?? []);
      const d2 = new Set<string>();
      for (const n of d1) {
        for (const m of neighborhood.get(n) ?? []) {
          if (m !== next && !d1.has(m)) d2.add(m);
        }
      }
      const d3 = new Set<string>();
      for (const n of d2) {
        for (const m of neighborhood.get(n) ?? []) {
          if (m !== next && !d1.has(m) && !d2.has(m)) d3.add(m);
        }
      }
      ringsRef.current = { d1, d2, d3 };
    }
    targetIntensityRef.current = 1;
  }, [hovered, selected, neighborhood]);

  // Build / rebuild the renderer when the snapshot changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph<NodeAttrs, EdgeAttrs>({
      multi: false,
      type: "directed",
    });

    // Random seed positions then ForceAtlas2 for an organic layout.
    const rand = mulberry32(1337); // deterministic across reloads
    for (const n of snapshot.nodes) {
      const ringKind = computeRingKind(n.type, n.health);
      graph.addNode(n.id, {
        label: n.label,
        x: rand() * 1000 - 500,
        y: rand() * 1000 - 500,
        size: 4 + Math.min(10, n.degree * 0.6),
        color: NODE_COLORS[n.type],
        ringColor: ringColorFor(n.type, n.health),
        ringKind,
        health: n.health,
        confidence: n.confidence,
        nodeType: n.type,
        degree: n.degree,
        type: "ring",
      });
    }

    for (const e of snapshot.edges) {
      if (!graph.hasNode(e.s) || !graph.hasNode(e.t)) continue;
      const style = EDGE_STYLES[e.kind];
      const id = `${e.s}->${e.t}::${e.kind}`;
      if (graph.hasEdge(id)) continue;
      const sNode = graph.getNodeAttributes(e.s);
      const tNode = graph.getNodeAttributes(e.t);
      try {
        graph.addEdgeWithKey(id, e.s, e.t, {
          color: style.color,
          colorStart: sNode.color,
          colorEnd: tNode.color,
          size: style.size,
          edgeKind: edgeKindByte(e.kind),
          edgeKindName: e.kind,
          conf: e.conf,
          type: "fancy",
        });
      } catch {
        // Duplicate or self-loop — skip.
      }
    }

    // ~120 ForceAtlas2 iters give a recognizable structure on first paint
    // without blocking the UI for long. inferSettings tunes scaling/gravity
    // by graph size; barnesHut keeps it tractable at ~400 nodes.
    const t0 = performance.now();
    const fa2Settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 120,
      settings: { ...fa2Settings, barnesHutOptimize: true, slowDown: 5 },
    });
    const layoutMs = Math.round(performance.now() - t0);

    const sigma = new Sigma<NodeAttrs, EdgeAttrs>(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: "#4b6584",
      labelColor: { color: "#eef1f6" },
      labelSize: 12,
      labelWeight: "500",
      labelDensity: 0.55,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 8,
      minCameraRatio: 0.05,
      maxCameraRatio: 8,
      zIndex: true,
      defaultDrawNodeLabel: drawGlowingLabel,
      // Sigma uses a SEPARATE drawer when a node is hovered; the stock
      // one renders a white pill with dark text — unreadable on our dark
      // canvas. Reuse our glowing label so hover stays on-theme.
      defaultDrawNodeHover: drawGlowingLabel,
      nodeProgramClasses: {
        ring: NodeRingProgram,
      },
      edgeProgramClasses: {
        fancy: EdgeFancyProgram,
      },
      // Reducers run every render. We compose:
      //   1. Hard hide based on filters / focus mode.
      //   2. A 3-hop ripple highlight anchored on hover-or-selection,
      //      blended with `intensityRef` for smooth fade-in/out.
      nodeReducer: (node, data): Partial<NodeRingDisplayData> => {
        const f = filtersRef.current;
        const focusSet = modeRef.current === "focus" ? focusSetRef.current : null;
        if (
          !f.nodeTypes.has(data.nodeType as ExplorerNodeType) ||
          data.confidence < f.minConfidence ||
          (focusSet && !focusSet.has(node))
        ) {
          return { ...data, hidden: true, label: "" };
        }
        const reduced: Partial<NodeRingDisplayData> = {
          ...data,
          ringColor: data.ringColor,
          ringKind: data.ringKind,
          health: data.health,
          confidence: data.confidence,
          // Suppress noisy dream-artifact labels by default.
          label: isNoisyLabel(data.label, data.nodeType) ? "" : data.label,
          type: "ring",
        };

        // Universal baseline: every node sits at ~55% so the canvas reads
        // as a muted backdrop. Hover/selection then lifts the anchor +
        // 1-hop neighbors back up to 100%.
        const BASE = 0.55;
        const anchor = anchorRef.current;
        const k = intensityRef.current;
        if (!anchor || k <= 0.01) {
          reduced.color = withAlpha(data.color, BASE);
          reduced.ringColor = withAlpha(data.ringColor, BASE);
          return reduced;
        }

        const { d1, d2, d3 } = ringsRef.current;
        // factor = where alpha lands at full intensity.
        let factor = 0.04;
        let isAnchor = false;
        let isClose = false;
        if (node === anchor) { factor = 1.0; isAnchor = true; isClose = true; }
        else if (d1.has(node)) { factor = 1.0; isClose = true; }
        else if (d2.has(node)) { factor = 0.18; }
        else if (d3.has(node)) { factor = 0.08; }

        // Lerp from BASE toward `factor` as intensity rises.
        const alpha = BASE + k * (factor - BASE);
        reduced.color = withAlpha(data.color, alpha);
        reduced.ringColor = withAlpha(data.ringColor, Math.max(0.04, alpha * 0.95));

        if (isAnchor) {
          reduced.ringKind = NODE_KIND_FOCUSED;
          // Anchor more than doubles in size so its opaque disc clearly
          // covers the edge endpoints meeting it.
          reduced.size = (data.size ?? 5) * (1 + 1.4 * k);
          reduced.zIndex = 4;
          reduced.label = data.label;
          reduced.forceLabel = true;
        } else if (isClose) {
          // 1-hop neighbors grow ~90% so even thin nodes have enough
          // opaque disc area to cover incoming highlighted edges.
          reduced.size = (data.size ?? 5) * (1 + 0.9 * k);
          reduced.zIndex = 2;
          // Keep noisy dream-artifact labels suppressed even on hover —
          // restoring data.label here was leaking the long rejection text.
          if (!isNoisyLabel(data.label, data.nodeType)) {
            reduced.label = data.label;
            reduced.forceLabel = true;
          }
        } else {
          // Outside d1: blank label entirely so it can't bleed through.
          reduced.label = "";
          reduced.forceLabel = false;
          reduced.zIndex = d2.has(node) ? 1 : 0;
        }
        return reduced;
      },
      edgeReducer: (edge, data): Partial<EdgeAttrs> => {
        const f = filtersRef.current;
        const focusSet = modeRef.current === "focus" ? focusSetRef.current : null;
        const arrow = edge.indexOf("->");
        const sep = edge.indexOf("::");
        const src = arrow > 0 ? edge.slice(0, arrow) : "";
        const tgt = arrow > 0 && sep > arrow ? edge.slice(arrow + 2, sep) : "";
        if (
          !f.edgeKinds.has(data.edgeKindName as ExplorerEdgeKind) ||
          data.conf < f.minConfidence ||
          (focusSet && (!focusSet.has(src) || !focusSet.has(tgt)))
        ) {
          return { ...data, hidden: true };
        }

        const anchor = anchorRef.current;
        const k = intensityRef.current;

        // Idle baseline: every edge gets DARKENED (rgb scaled toward 0)
        // and alpha reduced so dense overlap can't sum to bright white.
        if (!anchor || k <= 0.01) {
          return {
            ...data,
            colorStart: dimRgb(data.colorStart, 0.30, 0.35),
            colorEnd: dimRgb(data.colorEnd, 0.30, 0.35),
          };
        }

        const { d1, d2, d3 } = ringsRef.current;

        // Classify by hop distance of the *closer* endpoint to the anchor.
        const dist = (id: string): number => {
          if (id === anchor) return 0;
          if (d1.has(id)) return 1;
          if (d2.has(id)) return 2;
          if (d3.has(id)) return 3;
          return 4;
        };
        const minHop = Math.min(dist(src), dist(tgt));
        const maxHop = Math.max(dist(src), dist(tgt));
        const touchesAnchor = src === anchor || tgt === anchor;

        let scale: number;
        let alpha: number;
        if (touchesAnchor) {
          // Active: full RGB, full alpha. Glow done elsewhere.
          scale = 1.0; alpha = 1.0;
        } else if (minHop <= 1 && maxHop <= 2) {
          scale = 0.18; alpha = 0.20;
        } else if (minHop <= 2 && maxHop <= 3) {
          scale = 0.10; alpha = 0.12;
        } else {
          scale = 0.04; alpha = 0.06;
        }

        // Lerp from idle-dim toward target as intensity rises.
        const idleScale = 0.30;
        const idleAlpha = 0.35;
        const finalScale = idleScale + k * (scale - idleScale);
        const finalAlpha = idleAlpha + k * (alpha - idleAlpha);

        const out: Partial<EdgeAttrs> = {
          ...data,
          colorStart: dimRgb(data.colorStart, finalScale, finalAlpha),
          colorEnd: dimRgb(data.colorEnd, finalScale, finalAlpha),
        };
        if (touchesAnchor) {
          // Active edge: thicker line + push gradient hard toward white
          // so it visibly glows against the 50%-alpha background graph.
          out.size = data.size * (1 + 1.2 * k);
          out.colorStart = brighten(data.colorStart, k);
          out.colorEnd = brighten(data.colorEnd, k);
          out.zIndex = 1;
        }
        return out;
      },
    });

    sigmaRef.current = sigma;

    sigma.on("clickNode", ({ node }) => onSelect(node));
    sigma.on("clickStage", () => {
      // Belt-and-suspenders: also clear the ripple immediately so a
      // background click visibly resets the view even if React batching
      // delays the prop update.
      anchorRef.current = null;
      ringsRef.current = { d1: new Set(), d2: new Set(), d3: new Set() };
      intensityRef.current = 0;
      targetIntensityRef.current = 0;
      onSelect(null);
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("enterNode", ({ node }) => setHovered(node));
    sigma.on("leaveNode", () => setHovered(null));

    // Animation loop drives u_time in NodeRingProgram so the confidence
    // ring shimmer and tension pulse breathe smoothly. Capped at ~30 fps
    // to stay under the perf budget.
    let frame = 0;
    let drops = 0;
    let lastTs = performance.now();
    let lastAnimTs = performance.now();
    let rafId = 0;
    const tick = (ts: number) => {
      frame++;
      const dt = ts - lastTs;
      lastTs = ts;
      if (dt > 33) drops++;

      // Tween ripple intensity toward target (~250 ms full transition).
      const target = targetIntensityRef.current;
      const cur = intensityRef.current;
      if (cur !== target) {
        const step = dt / 250;
        const next =
          target > cur
            ? Math.min(target, cur + step)
            : Math.max(target, cur - step);
        intensityRef.current = next;
        if (next === 0) anchorRef.current = null;
        // Reducers re-run + per-vertex colors re-encode only on refresh().
        // scheduleRender alone would just re-flush uniforms, leaving the
        // ripple invisible. skipIndexation keeps it cheap.
        sigma.refresh({ skipIndexation: true });
        lastAnimTs = ts;
      } else if (ts - lastAnimTs >= 33) {
        sigma.scheduleRender();
        lastAnimTs = ts;
      }

      if (frame % 60 === 0) {
        const fpsEst = Math.round(1000 / Math.max(1, dt));
        setFps(fpsEst);
        postClientMetrics({
          "render.fps_estimate": fpsEst,
          "render.node_count": snapshot.nodes.length,
          "render.frame_drops": drops,
        });
        drops = 0;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // eslint-disable-next-line no-console
    console.info(
      `[explorer] layout=${layoutMs}ms nodes=${snapshot.nodes.length} edges=${snapshot.edges.length}`,
    );

    return () => {
      cancelAnimationFrame(rafId);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [snapshot, onSelect]);

  // Filter / mode / selection changes need the reducers to re-run; the
  // hover-driven ripple already triggers refreshes via the rAF loop.
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [filters, mode, selected]);

  // Recompute focus set when selection or mode changes.
  useEffect(() => {
    if (mode !== "focus" || !selected) {
      focusSetRef.current = null;
      return;
    }
    const set = new Set<string>([selected]);
    const d1 = neighborhood.get(selected) ?? new Set<string>();
    for (const n of d1) set.add(n);
    for (const n of d1) {
      const d2 = neighborhood.get(n);
      if (!d2) continue;
      for (const m of d2) set.add(m);
    }
    focusSetRef.current = set;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [mode, selected, neighborhood]);

  // Animate camera to the selected node.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !selected) return;
    if (!sigma.getGraph().hasNode(selected)) return;
    const display = sigma.getNodeDisplayData(selected);
    if (!display) return;
    sigma.getCamera().animate(
      { x: display.x, y: display.y, ratio: 0.5 },
      { duration: 600 },
    );
  }, [selected]);

  return (
    <div className="canvas-wrap">
      <div ref={containerRef} className="canvas" />
      <PulseOverlay sigmaRef={sigmaRef} pulses={pulses ?? []} />
      <div className="status">
        <strong>{snapshot.stats.node_count}</strong> nodes ·{" "}
        <strong>{snapshot.stats.edge_count}</strong> edges ·{" "}
        build <strong>{snapshot.stats.build_ms} ms</strong>
        {fps !== null ? (
          <>
            {" · "}render <strong>{fps} fps</strong>
          </>
        ) : null}
        {hovered ? (
          <>
            {" · hover "}
            <strong>{hovered}</strong>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function computeRingKind(type: string, health: number): number {
  if (type === "tension") return NODE_KIND_TENSION;
  if (type === "dream_node") return NODE_KIND_DREAM;
  if (health < 0.5) return NODE_KIND_TENSION;
  return NODE_KIND_NEUTRAL;
}

/**
 * Pick a ring (halo) color: a brightened sibling of the node fill so the
 * ring reads as a glow of the same hue. Tension and unhealthy nodes lean
 * red so the eye finds problems first.
 */
function ringColorFor(type: string, health: number): string {
  if (type === "tension" || health < 0.4) return "#ff7474";
  if (type === "dream_node") return "#d4b3ff";
  if (type === "feature") return "#a8c2ff";
  if (type === "workflow") return "#9be8de";
  if (type === "data_model") return "#ffd9a3";
  if (type === "capability") return "#ffc2e6";
  if (type === "datastore") return "#7feaf5";
  return "#d8dde3";
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    let v = color.slice(1);
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    const n = parseInt(v, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (m) {
    const parts = m[1].split(",").slice(0, 3).map((p) => p.trim());
    return `rgba(${parts.join(", ")}, ${alpha.toFixed(3)})`;
  }
  return color;
}

/**
 * Multiply RGB toward black by `scale` AND set alpha. Critical for dim
 * baseline edges: with many overlapping translucent edges, alpha alone
 * doesn't reduce apparent brightness because the colors sum additively.
 * Darkening the RGB itself is the only way to make the dimmed layer
 * actually look dim.
 */
function dimRgb(color: string, scale: number, alpha: number): string {
  const s = Math.max(0, Math.min(1, scale));
  let r = 0, g = 0, b = 0;
  if (color.startsWith("#")) {
    let v = color.slice(1);
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    const n = parseInt(v, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(color);
    if (m) {
      const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
      r = parts[0] ?? 0; g = parts[1] ?? 0; b = parts[2] ?? 0;
    }
  }
  return `rgba(${Math.round(r * s)}, ${Math.round(g * s)}, ${Math.round(b * s)}, ${alpha.toFixed(3)})`;
}

/**
 * Lighten a #rrggbb / #rgb / rgba(...) color toward white by `amount` (0..1).
 * Used for the anchor-edge glow — small lift so it stands out without
 * blowing out the node colors.
 */
function brighten(color: string, amount: number): string {
  const lift = Math.max(0, Math.min(1, amount)) * 180; // 0..180 channels
  if (color.startsWith("#")) {
    let v = color.slice(1);
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    const n = parseInt(v, 16);
    const r = Math.min(255, ((n >> 16) & 255) + lift);
    const g = Math.min(255, ((n >> 8) & 255) + lift);
    const b = Math.min(255, (n & 255) + lift);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    const r = Math.min(255, (parts[0] ?? 0) + lift);
    const g = Math.min(255, (parts[1] ?? 0) + lift);
    const b = Math.min(255, (parts[2] ?? 0) + lift);
    const a = parts[3] ?? 1;
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
  }
  return color;
}

// Tiny seeded PRNG for deterministic initial node positions across reloads.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/*  Label drawer — readable text on any background.                   */
/* ------------------------------------------------------------------ */

/**
 * Draw a node label with a soft outer glow + dark outline + crisp fill.
 * Sigma's stock drawer is just black text on a light page — invisible
 * on our dark canvas. We layer:
 *   1. blurred dark "shadow" pass for a vignette behind the text
 *   2. ~2.5px black stroke at 0.85 alpha for the outline
 *   3. white fill at full opacity
 */
function drawGlowingLabel(
  ctx: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color">,
  settings: Settings<NodeAttrs, EdgeAttrs, Attributes>,
): void {
  if (!data.label) return;
  const size = (settings.labelSize ?? 12);
  const font = settings.labelFont ?? "sans-serif";
  const weight = settings.labelWeight ?? "500";
  ctx.font = `${weight} ${size}px ${font}`;

  const x = data.x + data.size + 6;
  const y = data.y + size / 3;

  // Measure to size a dark pill behind the text. Without this, light text
  // sits on top of bright pink/cyan edges and disappears entirely.
  const text = data.label;
  const w = ctx.measureText(text).width;
  const padX = 5;
  const padY = 3;
  const pillX = x - padX;
  const pillY = y - size + 1;
  const pillW = w + padX * 2;
  const pillH = size + padY * 2;
  const radius = Math.min(6, pillH / 2);

  // Pill background — translucent near-black, rounded corners.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pillX + radius, pillY);
  ctx.lineTo(pillX + pillW - radius, pillY);
  ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + radius);
  ctx.lineTo(pillX + pillW, pillY + pillH - radius);
  ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - radius, pillY + pillH);
  ctx.lineTo(pillX + radius, pillY + pillH);
  ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - radius);
  ctx.lineTo(pillX, pillY + radius);
  ctx.quadraticCurveTo(pillX, pillY, pillX + radius, pillY);
  ctx.closePath();
  ctx.fillStyle = "rgba(6, 9, 14, 0.92)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 8;
  ctx.fill();
  // Hairline border so the pill resolves against bright backgrounds.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Outline + bright fill on top.
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#f3f5f9";
  ctx.fillText(text, x, y);
}

/* ------------------------------------------------------------------ */
/*  Edge helpers                                                      */
/* ------------------------------------------------------------------ */

function edgeKindByte(kind: string): number {
  switch (kind) {
    case "validated": return EDGE_KIND_VALIDATED;
    case "candidate": return EDGE_KIND_CANDIDATE;
    case "dream":     return EDGE_KIND_DREAM;
    case "tension":   return EDGE_KIND_TENSION;
    default:          return EDGE_KIND_FACT;
  }
}

/**
 * Many dream-artifact nodes carry verbose labels like
 *   `Dream "dream_llm_1777..." rejected: Insufficient evidence.`
 * which crowd the canvas. Hide them by default; the hover/neighbor
 * branch in nodeReducer re-enables the label when the user actually
 * cares about that node.
 */
function isNoisyLabel(label: string | undefined, nodeType: string): boolean {
  if (!label) return false;
  if (nodeType === "dream_node") return true;
  if (label.startsWith("Dream \"")) return true;
  if (label.startsWith("dream_")) return true;
  return false;
}

