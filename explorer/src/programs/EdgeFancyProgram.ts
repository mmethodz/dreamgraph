/**
 * EdgeFancyProgram — gradient + animated edges for DreamGraph.
 *
 * Replaces Sigma 3's stock EdgeRectangleProgram with a richer renderer:
 *
 *   • Per-edge two-color gradient (source → target node color).
 *   • Per-edge `kind` byte drives style:
 *       0 = fact      → flat gradient
 *       1 = validated → bright core + outer glow falloff
 *       2 = candidate → dashed marching ants (animated)
 *       3 = dream     → shimmer pulse traveling along the edge
 *       4 = tension   → brightness pulse (~1.4 Hz)
 *   • Antialiasing on the edge thickness via smoothstep on the perpendicular
 *     normal, identical math to the stock program.
 *
 * Geometry: 6 vertices forming a rectangle aligned with the edge axis.
 * (a_positionStart, a_positionEnd) + a_normal * a_normalCoef expands each
 * vertex perpendicular to the edge. Constant attributes a_positionCoef and
 * a_normalCoef pick which corner of the rectangle this vertex represents.
 *
 * Coordinate space: the vertex shader emits a varying `v_t` ∈ [0, 1] along
 * the edge from source to target, and `v_normal` ∈ [-1, 1] across the edge,
 * which the fragment shader uses for both gradients and dashing.
 */

import { EdgeProgram, ProgramInfo } from "sigma/rendering";
import type {
  EdgeDisplayData,
  NodeDisplayData,
  RenderParams,
} from "sigma/types";
import type { Attributes } from "graphology-types";
import { floatColor } from "sigma/utils";

export const EDGE_KIND_FACT = 0;
export const EDGE_KIND_VALIDATED = 1;
export const EDGE_KIND_CANDIDATE = 2;
export const EDGE_KIND_DREAM = 3;
export const EDGE_KIND_TENSION = 4;

export interface EdgeFancyDisplayData extends EdgeDisplayData {
  /** Source node fill color used for the gradient start. */
  colorStart?: string;
  /** Target node fill color used for the gradient end. */
  colorEnd?: string;
  /** Edge kind selector, see EDGE_KIND_* constants. */
  edgeKind?: number;
  /** 0..1 confidence; modulates brightness. */
  conf?: number;
}

const VERTEX_SHADER_SOURCE = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;        // gradient start (source node)
attribute vec4 a_color_end;    // gradient end (target node)
attribute vec4 a_meta;         // .x = kind/255, .y = confidence/255, .z = length px, .w reserved
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color_start;
varying vec4 v_color_end;
varying vec4 v_meta;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_t;             // 0 at source, 1 at target

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;
  v_t = a_positionCoef;
  v_meta = a_meta;

  #ifdef PICKING_MODE
  v_color_start = a_id;
  v_color_end = a_id;
  #else
  v_color_start = a_color;
  v_color_end = a_color_end;
  #endif

  v_color_start.a *= bias;
  v_color_end.a *= bias;
}
`;

const FRAGMENT_SHADER_SOURCE = /* glsl */ `
precision mediump float;

varying vec4 v_color_start;
varying vec4 v_color_end;
varying vec4 v_meta;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_t;

uniform float u_time;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  #ifdef PICKING_MODE
  gl_FragColor = v_color_start;
  return;
  #endif

  // Antialiasing across the edge width.
  float dist = length(v_normal) * v_thickness;
  float aa = 1.0 - smoothstep(v_thickness - v_feather, v_thickness, dist);

  // Gradient between source and target colors.
  vec4 grad = mix(v_color_start, v_color_end, v_t);

  float kind = floor(v_meta.x * 255.0 + 0.5);
  float conf = v_meta.y;
  float lenPx = v_meta.z * 255.0;

  // ── Style per kind ─────────────────────────────────────────────
  float brightness = 0.7 + conf * 0.6;
  float coreBoost = 0.0;
  float dashMask = 1.0;

  // VALIDATED — bright core, soft outer glow.
  if (kind > 0.5 && kind < 1.5) {
    float center = 1.0 - abs(length(v_normal));
    coreBoost = pow(center, 2.0) * 0.6;
    brightness *= 1.1;
  }

  // CANDIDATE — dashed marching ants. Density scales with edge length
  // so short edges still show 2–3 dashes; long edges scroll quickly.
  if (kind > 1.5 && kind < 2.5) {
    float density = max(8.0, lenPx * 0.04);
    float phase = fract(v_t * density - u_time * 0.6);
    // Dash duty-cycle: 60% on, 40% off, with soft edges.
    dashMask = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.55, 0.65, phase));
    brightness *= 1.05;
  }

  // DREAM — a sparkle traveling along the edge (cosine pulse).
  if (kind > 2.5 && kind < 3.5) {
    float head = fract(u_time * 0.18);
    float d = abs(v_t - head);
    d = min(d, 1.0 - d); // wrap-around
    float sparkle = exp(-d * 18.0) * 1.4;
    grad.rgb = mix(grad.rgb, vec3(1.0, 0.95, 1.0), sparkle * 0.8);
    brightness *= 0.85 + 0.5 * (0.5 + 0.5 * sin(u_time * 1.2 + v_t * 6.28));
  }

  // TENSION — pulse the whole edge red-ward at ~1.4 Hz.
  if (kind > 3.5) {
    float pulse = 0.5 + 0.5 * sin(u_time * 2.8);
    grad.rgb = mix(grad.rgb, vec3(1.0, 0.42, 0.42), 0.4 + pulse * 0.4);
    brightness *= 0.85 + pulse * 0.6;
  }

  // Compose: gradient * brightness, plus a small white core boost (validated),
  // multiplied by dash mask and antialiasing.
  vec3 rgb = grad.rgb * brightness + vec3(coreBoost);
  float alpha = grad.a * aa * dashMask;

  if (alpha < 0.005) {
    gl_FragColor = transparent;
    return;
  }
  gl_FragColor = vec4(rgb, alpha);
}
`;

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;
const UNIFORMS = [
  "u_matrix",
  "u_zoomRatio",
  "u_sizeRatio",
  "u_correctionRatio",
  "u_pixelRatio",
  "u_feather",
  "u_minEdgeThickness",
  "u_time",
] as const;

type Uniform = (typeof UNIFORMS)[number];

export class EdgeFancyProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends EdgeProgram<Uniform, N, E, G> {
  getDefinition() {
    return {
      VERTICES: 6,
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_positionStart", size: 2, type: FLOAT },
        { name: "a_positionEnd", size: 2, type: FLOAT },
        { name: "a_normal", size: 2, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_color_end", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_meta", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [
        // a_positionCoef: 0 → start, 1 → end
        { name: "a_positionCoef", size: 1, type: FLOAT },
        // a_normalCoef: ±1 picks the side of the rectangle
        { name: "a_normalCoef", size: 1, type: FLOAT },
      ],
      // Six vertices forming two triangles — same layout as EdgeRectangleProgram.
      CONSTANT_DATA: [
        [0, 1],
        [0, -1],
        [1, 1],
        [1, 1],
        [0, -1],
        [1, -1],
      ],
    };
  }

  processVisibleItem(
    edgeIndex: number,
    startIndex: number,
    sourceData: NodeDisplayData,
    targetData: NodeDisplayData,
    data: EdgeFancyDisplayData,
  ): void {
    const thickness = data.size || 1;
    const x1 = sourceData.x;
    const y1 = sourceData.y;
    const x2 = targetData.x;
    const y2 = targetData.y;

    const colorStart = floatColor(data.colorStart ?? data.color);
    const colorEnd = floatColor(data.colorEnd ?? data.color);

    // Normal of length `thickness`, perpendicular to the edge.
    const dx = x2 - x1;
    const dy = y2 - y1;
    let len2 = dx * dx + dy * dy;
    let n1 = 0;
    let n2 = 0;
    let lenPx = 0;
    if (len2) {
      const lenInv = 1 / Math.sqrt(len2);
      n1 = -dy * lenInv * thickness;
      n2 = dx * lenInv * thickness;
      lenPx = Math.sqrt(len2);
    }

    // Pack metadata: kind, confidence, length-byte, reserved.
    const kindByte = clampByte(data.edgeKind ?? EDGE_KIND_FACT);
    const confByte = clampByte((data.conf ?? 0.6) * 255);
    // Length is informational for the dash density; cap at 255 px.
    const lenByte = clampByte(lenPx);
    const meta = packFourBytesToFloat(kindByte, confByte, lenByte, 0);

    const array = this.array;
    array[startIndex++] = x1;
    array[startIndex++] = y1;
    array[startIndex++] = x2;
    array[startIndex++] = y2;
    array[startIndex++] = n1;
    array[startIndex++] = n2;
    array[startIndex++] = colorStart;
    array[startIndex++] = colorEnd;
    array[startIndex++] = meta;
    array[startIndex++] = edgeIndex;
  }

  setUniforms(params: RenderParams, programInfo: ProgramInfo): void {
    const { gl, uniformLocations } = programInfo;
    gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
    gl.uniform1f(uniformLocations.u_zoomRatio, params.zoomRatio);
    gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
    gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
    gl.uniform1f(uniformLocations.u_pixelRatio, params.pixelRatio);
    gl.uniform1f(uniformLocations.u_feather, params.antiAliasingFeather);
    gl.uniform1f(uniformLocations.u_minEdgeThickness, params.minEdgeThickness);
    gl.uniform1f(uniformLocations.u_time, performance.now() / 1000);
  }
}

// ── helpers ──────────────────────────────────────────────────

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

function packFourBytesToFloat(r: number, g: number, b: number, a: number): number {
  if (!packBuf) {
    packBuf = new ArrayBuffer(4);
    packU8 = new Uint8Array(packBuf);
    packF32 = new Float32Array(packBuf);
  }
  packU8![0] = r;
  packU8![1] = g;
  packU8![2] = b;
  packU8![3] = a;
  return packF32![0];
}

let packBuf: ArrayBuffer | null = null;
let packU8: Uint8Array | null = null;
let packF32: Float32Array | null = null;
