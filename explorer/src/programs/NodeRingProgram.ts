/**
 * NodeRingProgram — DreamGraph custom WebGL program for nodes.
 *
 * Visual contract (plans/DREAMGRAPH_EXPLORER.md §3.2):
 *   • Filled inner disc tinted by node `health` (red lean as health drops)
 *   • Outer confidence ring whose brightness scales with `confidence`
 *   • `dream_node` kinds shimmer along a u_time gradient
 *   • `tension` kinds pulse alpha at ~1.4 Hz
 *
 * Implementation patterned on Sigma 3's built-in NodeCircleProgram.
 * VERTICES=3 with a constant `a_angle` so the vertex shader expands
 * each node point into a triangle large enough for the fragment shader
 * to draw a soft disc + ring with antialiasing.
 *
 * Per-node attributes added beyond the stock circle program:
 *   a_ring     vec4 UNSIGNED_BYTE  ring color (RGBA bytes)
 *   a_meta     vec4 UNSIGNED_BYTE  {health, confidence, kind, reserved}
 *
 * `kind` is encoded as a small integer 0..255:
 *   0 = neutral, 1 = dream (shimmer), 2 = tension (pulse), 3 = focused
 */

import { NodeProgram, ProgramInfo } from "sigma/rendering";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import type { Attributes } from "graphology-types";
import { floatColor } from "sigma/utils";

export const NODE_KIND_NEUTRAL = 0;
export const NODE_KIND_DREAM = 1;
export const NODE_KIND_TENSION = 2;
export const NODE_KIND_FOCUSED = 3;

const VERTEX_SHADER_SOURCE = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec4 a_ring;
attribute vec4 a_meta;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform float u_time;

varying vec4 v_color;
varying vec4 v_ring;
varying vec4 v_meta;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_phase;

const float bias = 255.0 / 254.0;

void main() {
  // Per-node phase derived from id bytes — gives every node an
  // unsynchronized breathe so the canvas has organic life.
  float seed = a_id.r * 255.0 + a_id.g * 71.0 + a_id.b * 13.0;
  float phase = mod(seed, 6.2831);
  float kind = floor(a_meta.z * 255.0 + 0.5);

  // Subtle breathe: ±3% size oscillation. Tension nodes pulse harder.
  float breatheAmp = (kind > 1.5 && kind < 2.5) ? 0.10 : 0.03;
  float breathe = 1.0 + breatheAmp * sin(u_time * 1.4 + phase);

  // Match NodeCircleProgram's expansion math (×4 size).
  float size = a_size * breathe * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);

  v_diffVector = diffVector;
  v_radius = size / 2.0;
  v_phase = phase;

  #ifdef PICKING_MODE
  v_color = a_id;
  v_ring = vec4(0.0);
  v_meta = vec4(0.0);
  #else
  v_color = a_color;
  v_ring = a_ring;
  v_meta = a_meta;
  #endif

  v_color.a *= bias;
  v_ring.a *= bias;
}
`;

const FRAGMENT_SHADER_SOURCE = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec4 v_ring;
varying vec4 v_meta;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_phase;

uniform float u_correctionRatio;
uniform float u_time;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float distFromCenter = length(v_diffVector);
  float border = u_correctionRatio * 2.0;
  float outerEdge = distFromCenter - v_radius + border;

  #ifdef PICKING_MODE
  if (outerEdge > border) {
    gl_FragColor = transparent;
  } else {
    gl_FragColor = v_color;
  }
  return;
  #endif

  if (outerEdge > border) {
    gl_FragColor = transparent;
    return;
  }

  // Normalized 2D coords inside the disc, in [-1, 1].
  vec2 uv = v_diffVector / max(v_radius, 0.0001);
  float r = clamp(length(uv), 0.0, 1.0);

  float health = v_meta.x;
  float confidence = v_meta.y;
  float kind = floor(v_meta.z * 255.0 + 0.5);

  float innerMask = 1.0 - smoothstep(0.58, 0.66, r);
  float ringMask  = smoothstep(0.62, 0.70, r) * (1.0 - smoothstep(0.88, 0.96, r));
  float haloMask  = smoothstep(0.90, 1.0, r);

  float aa = 1.0;
  if (outerEdge > 0.0) {
    aa = 1.0 - clamp(outerEdge / border, 0.0, 1.0);
  }

  // ── Inner disc with health tint and a fake-3D specular highlight ─
  vec3 healthShift = mix(vec3(1.0, 0.42, 0.42), vec3(1.0), clamp(health + 0.15, 0.0, 1.0));
  vec3 innerRGB = v_color.rgb * healthShift;

  // Specular highlight at upper-left: gives every node a glassy bead look.
  vec2 lightDir = vec2(-0.35, 0.45);
  float specD = distance(uv, lightDir);
  float spec = exp(-specD * specD * 18.0) * 0.55;
  innerRGB = innerRGB + vec3(spec);

  // Soft inner shadow toward bottom-right edge for depth.
  float shade = 1.0 - smoothstep(0.0, 0.6, distance(uv, vec2(0.4, -0.45)));
  innerRGB *= 0.85 + 0.25 * shade;

  // ── Confidence ring ─────────────────────────────────────────────
  float ringIntensity = 0.25 + confidence * 0.85;
  vec3 ringRGB = v_ring.rgb;

  // Dream shimmer: angular sine sweep on the ring.
  if (kind > 0.5 && kind < 1.5) {
    float angle = atan(v_diffVector.y, v_diffVector.x);
    float wave = 0.5 + 0.5 * sin(angle * 3.0 + u_time * 1.6 + v_phase);
    ringIntensity *= 0.55 + 0.65 * wave;
    ringRGB = mix(ringRGB, vec3(1.0, 0.95, 1.0), wave * 0.4);
  }
  // Tension pulse.
  float pulseAmt = 0.0;
  if (kind > 1.5 && kind < 2.5) {
    pulseAmt = 0.5 + 0.5 * sin(u_time * 2.8 + v_phase);
    ringIntensity *= 0.7 + 0.7 * pulseAmt;
  }
  // Focused (hovered).
  if (kind > 2.5) {
    ringIntensity = 1.25 + 0.15 * sin(u_time * 5.0);
  }

  // ── Compose layers ──────────────────────────────────────────────
  vec3 rgb = innerRGB * innerMask
           + ringRGB * ringIntensity * ringMask
           + ringRGB * 0.45 * haloMask * (0.6 + pulseAmt * 0.6);

  float alpha = (innerMask * v_color.a)
              + (ringMask  * v_ring.a * (0.6 + ringIntensity * 0.45))
              + (haloMask  * v_ring.a * 0.30 * (0.5 + pulseAmt));

  gl_FragColor = vec4(rgb, alpha * aa);
}
`;

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;
const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_matrix", "u_time"] as const;

type Uniform = (typeof UNIFORMS)[number];

export interface NodeRingDisplayData extends NodeDisplayData {
  ringColor?: string;
  health?: number;
  confidence?: number;
  ringKind?: number;
}

export class NodeRingProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends NodeProgram<Uniform, N, E, G> {
  static readonly ANGLE_1 = 0;
  static readonly ANGLE_2 = (2 * Math.PI) / 3;
  static readonly ANGLE_3 = (4 * Math.PI) / 3;

  getDefinition() {
    return {
      VERTICES: 3,
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_ring", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_meta", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
      CONSTANT_DATA: [
        [NodeRingProgram.ANGLE_1],
        [NodeRingProgram.ANGLE_2],
        [NodeRingProgram.ANGLE_3],
      ],
    };
  }

  processVisibleItem(
    nodeIndex: number,
    startIndex: number,
    data: NodeRingDisplayData,
  ): void {
    const array = this.array;
    const fillColor = floatColor(data.color);
    const ringColor = floatColor(data.ringColor ?? data.color);

    // Pack metadata bytes [0..255]: health, confidence, kind, reserved.
    const health = clampByte((data.health ?? 1) * 255);
    const confidence = clampByte((data.confidence ?? 1) * 255);
    const kind = clampByte(data.ringKind ?? NODE_KIND_NEUTRAL);
    const metaFloat = packFourBytesToFloat(health, confidence, kind, 0);

    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = fillColor;
    array[startIndex++] = ringColor;
    array[startIndex++] = metaFloat;
    array[startIndex++] = nodeIndex;
  }

  setUniforms(params: RenderParams, programInfo: ProgramInfo): void {
    const { gl, uniformLocations } = programInfo;
    gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
    gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
    gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
    // u_time is in seconds since first render of this program instance.
    gl.uniform1f(uniformLocations.u_time, performance.now() / 1000);
  }
}

// ── helpers ────────────────────────────────────────────────────

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

/**
 * Pack 4 bytes (each 0..255) into a single Float32 the same way Sigma
 * packs colors with `floatColor()`. We borrow the same encoding so the
 * normalized UNSIGNED_BYTE attribute reads as vec4 / 255 in the shader.
 */
function packFourBytesToFloat(r: number, g: number, b: number, a: number): number {
  // Reuse a temp Uint8/Float32 view via DataView to avoid GC churn.
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
