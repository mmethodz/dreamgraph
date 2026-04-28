/**
 * Phase 3 / Slice 2 — Pulse halo overlay.
 *
 * Renders expanding rings on top of the Sigma WebGL canvas to highlight
 * nodes that just had a cognitive event (tension created/resolved,
 * candidate added/promoted). Coordinates are pulled from the Sigma
 * instance via `graphToViewport` once per animation frame.
 */

import { useEffect, useRef } from "react";
import type Sigma from "sigma";
import type { Attributes } from "graphology-types";
import type { PulseToken } from "./sse";

interface Props<N extends Attributes, E extends Attributes> {
  sigmaRef: React.MutableRefObject<Sigma<N, E> | null>;
  pulses: PulseToken[];
}

const PULSE_DURATION_MS = 1200;
const COLORS: Record<PulseToken["kind"], string> = {
  "snapshot.changed": "#7aa2ff",
  "cache.invalidated": "#7aa2ff",
  "dream.cycle.completed": "#d4b3ff",
  "tension.created": "#ff7474",
  "tension.resolved": "#9be8de",
  "candidate.added": "#ffc58a",
  "candidate.promoted": "#a8c2ff",
  "candidate.rejected": "#c87ab8",
  "audit.appended": "#f0d56b",
};

export function PulseOverlay<N extends Attributes, E extends Attributes>({
  sigmaRef,
  pulses,
}: Props<N, E>): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulsesRef = useRef<PulseToken[]>(pulses);
  pulsesRef.current = pulses;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cancelled = false;

    const resize = () => {
      const sigma = sigmaRef.current;
      if (!sigma) return;
      const dim = sigma.getDimensions();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(dim.width * dpr));
      canvas.height = Math.max(1, Math.floor(dim.height * dpr));
      canvas.style.width = `${dim.width}px`;
      canvas.style.height = `${dim.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const draw = () => {
      if (cancelled) return;
      const sigma = sigmaRef.current;
      if (!sigma) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const dim = sigma.getDimensions();
      ctx.clearRect(0, 0, dim.width, dim.height);

      const now = Date.now();
      const graph = sigma.getGraph();

      for (const p of pulsesRef.current) {
        const age = now - p.startedAt;
        if (age >= PULSE_DURATION_MS) continue;
        if (!graph.hasNode(p.id)) continue;

        const attrs = sigma.getNodeDisplayData(p.id);
        if (!attrs) continue;
        const vp = sigma.graphToViewport(attrs);

        const t = age / PULSE_DURATION_MS;
        const baseR = Math.max(8, attrs.size ?? 8);
        const radius = baseR + t * 60;
        const alpha = (1 - t) * 0.85;

        ctx.beginPath();
        ctx.arc(vp.x, vp.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(COLORS[p.kind] ?? "#ffffff", alpha);
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner glow ring for visibility on busy backgrounds.
        ctx.beginPath();
        ctx.arc(vp.x, vp.y, radius * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(COLORS[p.kind] ?? "#ffffff", alpha * 0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [sigmaRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pulse-overlay"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  );
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
