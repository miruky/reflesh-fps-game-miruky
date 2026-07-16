import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GraphicsQuality } from '../core/settings';
import type {
  BoxSpec,
  GradeParams,
  GrassKind,
  MoodId,
  ParticleKind,
  SilhouetteKind,
  StagePalette,
} from '../game/stage';

// ============================================================================
// ムードプリセット
// ----------------------------------------------------------------------------
// 非回帰の原則: 既存 buildStageScene の太陽/露出/Hemi はパレット値のまま。ここが
// 供給するのは「既存が持たないチャンネル」= rim(冷たい逆光)/particle/silhouette/grade だけ。
// sun/elevation/exposure はプリセットに持たせない(既存パイプラインが真実の源)。
// ============================================================================
export interface RimSpec {
  color: string;
  intensity: number;
  dir: [number, number, number];
}

export interface MoodPreset {
  rim: RimSpec | null;
  particle: ParticleKind;
  silhouette: SilhouetteKind;
  grade: GradeParams;
}

export const MOOD_PRESETS: Record<MoodId, MoodPreset> = {
  day: {
    rim: null,
    particle: 'none',
    silhouette: 'ridge',
    grade: {
      tint: [1, 1, 1],
      contrast: 1.14,
      saturation: 1.1,
      vignette: 0.26,
      vignetteR: 0.82,
      grain: 0.012,
      chroma: 0.3,
    },
  },
  dusk: {
    rim: { color: '#ff8a4a', intensity: 0.22, dir: [-0.6, 0.25, -0.7] },
    particle: 'dust',
    silhouette: 'ridge',
    grade: {
      tint: [1.06, 0.98, 0.9],
      contrast: 1.06,
      saturation: 1.18,
      vignette: 0.28,
      vignetteR: 0.78,
      grain: 0.02,
      chroma: 0.6,
    },
  },
  night: {
    // 月光の冷たい逆光でシルエットを切る(太陽の逆側から差す)
    rim: { color: '#3b5bff', intensity: 0.16, dir: [0.7, 0.2, 0.6] },
    particle: 'firefly',
    silhouette: 'skyline',
    grade: {
      tint: [0.86, 0.94, 1.12],
      contrast: 1.12,
      saturation: 1.0,
      vignette: 0.4,
      vignetteR: 0.72,
      grain: 0.035,
      chroma: 0.9,
    },
  },
  overcast: {
    rim: null,
    particle: 'dust',
    silhouette: 'skyline',
    grade: {
      tint: [0.98, 0.99, 1.02],
      contrast: 1.07,
      saturation: 0.98,
      vignette: 0.26,
      vignetteR: 0.82,
      grain: 0.016,
      chroma: 0.4,
    },
  },
  snow: {
    rim: { color: '#bcd4ff', intensity: 0.14, dir: [-0.5, 0.3, -0.6] },
    particle: 'snow',
    silhouette: 'mountain',
    grade: {
      // R13 意図的な雪霧: tintを寒色へ振り(赤↓青↑)、彩度を落として銀青のヘイズに。
      // vignetteを上げて中央だけ抜けの良い「意図された霞」に見せる(白飛びの平板さを排除)。
      tint: [0.92, 0.98, 1.1],
      contrast: 1.1,
      saturation: 0.95,
      vignette: 0.32,
      vignetteR: 0.8,
      grain: 0.018,
      chroma: 0.4,
    },
  },
};

// ============================================================================
// 純ロジック(THREE非依存・テスト対象)
// ============================================================================

// #rrggbb の HSL 明度 L=(max+min)/2 を返す。色相/彩度に依らない。
export function hexLightness(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

// パレットからムードを分類する。mood明示 > 雪 > 夜 > 夕 > 曇 > 昼。
// 既存20パレットは無改変でもここで既定ムードを得られる(後方互換)。
export function resolveMood(p: StagePalette): MoodId {
  if (p.mood) return p.mood;
  const floorL = hexLightness(p.floor);
  const skyL = hexLightness(p.sky);
  if (p.fogDensity >= 0.024 && floorL > 0.8) return 'snow';
  if (skyL < 0.22 || (p.emissiveAccent && p.lightIntensity < 0.9)) return 'night';
  const elevation = p.elevation ?? 35;
  if (elevation <= 16) return 'dusk';
  const turbidity = p.turbidity ?? 6;
  const rayleigh = p.rayleigh ?? 2;
  if (turbidity >= 9 && rayleigh < 1.2) return 'overcast';
  return 'day';
}

// ムード既定のグレードにパレット別上書きをマージして GradeParams を得る。
export function resolveGrade(mood: MoodId, palette: StagePalette): GradeParams {
  return { ...MOOD_PRESETS[mood].grade, ...palette.grade };
}

export interface GrassPlacement {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  tilt: number;
}

// 箱(AABB+margin)に刺さらないか判定する。
export function insideBox(x: number, z: number, box: BoxSpec, margin: number): boolean {
  return (
    x > box.x - box.w / 2 - margin &&
    x < box.x + box.w / 2 + margin &&
    z > box.z - box.d / 2 - margin &&
    z < box.z + box.d / 2 + margin
  );
}

// 草タフトを決定論的に散布する。箱のAABB内(+margin)は避ける。
// [-half+2, half-2]^2 に散布し、外周壁際は 2m 内側から始める。
export function placeGrass(
  rng: () => number,
  half: number,
  count: number,
  boxes: readonly BoxSpec[],
  margin = 0.6,
): GrassPlacement[] {
  const out: GrassPlacement[] = [];
  const lo = -half + 2;
  const span = 2 * (half - 2);
  const limit = count * 4;
  let attempts = 0;
  while (out.length < count && attempts < limit) {
    attempts += 1;
    const x = lo + rng() * span;
    const z = lo + rng() * span;
    if (boxes.some((b) => insideBox(x, z, b, margin))) continue;
    out.push({
      x,
      z,
      yaw: rng() * Math.PI * 2,
      scale: 0.7 + rng() * 0.6,
      tilt: (rng() * 2 - 1) * 0.15,
    });
  }
  return out;
}

// tier 別の予算。low は完全ゲート(0=何も作らない)。
function grassBudget(tier: GraphicsQuality): number {
  // R12軽量化: 見た目を保ったまま確定的に頂点削減(high 4000→3000, med 2000→1500)
  return tier === 'high' ? 3000 : tier === 'medium' ? 1500 : 0;
}
function particleBudget(tier: GraphicsQuality): number {
  // R12軽量化: サイズ/密度で視覚維持しつつ数を確定削減(high 1500→1100)
  return tier === 'high' ? 1100 : tier === 'medium' ? 800 : 0;
}

// ============================================================================
// GLSL 断片
// ============================================================================
const WIND_GLSL = /* glsl */ `
  vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float bendW = position.y;
  float phase = wp.x * 0.35 + wp.z * 0.42 + uTime * 1.6;
  float gust = sin(phase) + 0.4 * sin(phase * 2.3 + 1.7);
  transformed.x += uWind.x * bendW * bendW * (0.12 + 0.06 * gust);
  transformed.z += uWind.y * bendW * bendW * (0.12 + 0.06 * gust);
`;

const FOG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FOG_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uScale;
  uniform vec2 uDrift;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    vec2 d = vUv - 0.5;
    float radial = smoothstep(0.5, 0.12, length(d));
    float n = vnoise(vUv * uScale + uTime * uDrift);
    n = 0.55 + 0.45 * n;
    gl_FragColor = vec4(uColor, uOpacity * radial * n);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uFall;
  uniform vec2 uDrift;
  uniform float uBox;
  uniform vec3 uCamPos;
  uniform float uSize;
  varying float vDepth;
  varying float vPhase;
  void main() {
    vPhase = aPhase;
    vec3 wpos = position;
    wpos.y -= mod(uFall * uTime + aPhase * uBox, uBox);
    wpos.x += uDrift.x * sin(uTime * 0.7 + aPhase * 6.2831);
    wpos.z += uDrift.y * cos(uTime * 0.9 + aPhase * 6.2831);
    vec3 rel = mod((wpos - uCamPos) + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCamPos + rel;
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * (300.0 / max(-mv.z, 1.0)), 1.0, uSize);
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uPulse;
  varying float vDepth;
  varying float vPhase;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    float fog = uFogDensity * vDepth;
    a *= exp(-fog * fog);
    a *= uOpacity;
    if (uPulse > 0.5 && uPulse < 1.5) {
      a *= 0.5 + 0.5 * sin(uTime * 6.0 + vPhase * 6.2831); // ember 明滅
    } else if (uPulse > 1.5) {
      a *= 0.3 + 0.7 * abs(sin(uTime * 1.2 + vPhase * 6.2831)); // firefly パルス
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface ParticleSpec {
  color: string;
  fall: number;
  drift: [number, number];
  additive: boolean;
  size: number;
  opacity: number;
  pulse: number;
  box: number;
}

const PARTICLE_SPECS: Record<Exclude<ParticleKind, 'none'>, ParticleSpec> = {
  snow: { color: '#eef4ff', fall: 1.5, drift: [0.5, 0.4], additive: false, size: 8, opacity: 0.85, pulse: 0, box: 40 },
  dust: { color: '#b8b0a2', fall: 0.15, drift: [0.2, 0.2], additive: false, size: 4, opacity: 0.45, pulse: 0, box: 60 },
  ember: { color: '#ff8a3c', fall: -0.4, drift: [0.3, 0.3], additive: true, size: 5, opacity: 0.9, pulse: 1, box: 40 },
  firefly: { color: '#c8ff6a', fall: 0.0, drift: [0.6, 0.6], additive: true, size: 6, opacity: 0.9, pulse: 2, box: 26 },
  // ⑥ゾンビ用: 溶岩の火の粉。emberより赤く強く、下から上へ舞い上がる(fall負=上昇)。
  // 加算+ember明滅(pulse=1)で溶岩の熱を表現。色は #ff3a12(全面赤グレードを避けるため点は小さめ)。
  lava: { color: '#ff3a12', fall: -0.5, drift: [0.35, 0.4], additive: true, size: 5, opacity: 0.95, pulse: 1, box: 40 },
  // ⑥ゾンビ用: 灰。暗い温グレーがゆっくり降る(fall正・低速)。非加算で沈む陰鬱なムード。
  ash: { color: '#4a443d', fall: 0.22, drift: [0.24, 0.2], additive: false, size: 4, opacity: 0.5, pulse: 0, box: 55 },
};

interface GrassSpec {
  height: number;
  width: number;
  tipToAccent: number; // 先端色をaccentへ寄せる割合
  tipToWhite: number; // 先端色を白へ寄せる割合
}

const GRASS_SPECS: Record<Exclude<GrassKind, 'none'>, GrassSpec> = {
  blade: { height: 0.55, width: 0.09, tipToAccent: 0.28, tipToWhite: 0.18 },
  dry: { height: 0.42, width: 0.08, tipToAccent: 0.1, tipToWhite: 0.3 },
  reed: { height: 0.95, width: 0.05, tipToAccent: 0.22, tipToWhite: 0.16 },
  snowtuft: { height: 0.3, width: 0.11, tipToAccent: 0.05, tipToWhite: 0.6 },
};

// ============================================================================
// Atmosphere — フィールドごとの映画的ムードを組み立てる非干渉レイヤ
// ============================================================================
export class Atmosphere {
  private readonly scene: THREE.Scene;
  private readonly palette: StagePalette;
  private readonly reduceMotion: boolean;
  private readonly rng: () => number;
  private readonly dpr: number;

  // dispose対象と毎フレーム更新対象
  private readonly objects: THREE.Object3D[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly timeUniforms: Array<{ value: number }> = [];
  private readonly fogPlanes: THREE.Mesh[] = [];
  private particleCam: { value: THREE.Vector3 } | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    palette: StagePalette,
    mood: MoodId,
    tier: GraphicsQuality,
    reduceMotion: boolean,
    size: number,
    boxes: readonly BoxSpec[],
    sunDir: THREE.Vector3,
    rng: () => number,
  ) {
    this.scene = scene;
    this.palette = palette;
    this.reduceMotion = reduceMotion;
    this.rng = rng;
    this.dpr = renderer.getPixelRatio();

    // low tier は完全ゲート: 何も生成しない(モバイル安全)
    if (tier === 'low') return;

    const preset = MOOD_PRESETS[mood];
    this.buildGroundFog(size, tier, mood);
    this.buildGrass(size, boxes, grassBudget(tier));
    this.buildParticles(palette.particle ?? preset.particle, particleBudget(tier));
    this.buildSilhouette(palette.silhouette ?? preset.silhouette, mood, size);
    this.buildRim(preset.rim, sunDir, size);
  }

  // ── グラウンドフォグ: カメラ追従の板。上端≤1.1mで立ち姿の胴/頭を隠さない ──
  // R12軽量化: highは3枚(厚み)、mediumは1枚(αオーバードロー-66%・opacity増で密度代償)
  private buildGroundFog(size: number, tier: GraphicsQuality, mood: MoodId): void {
    // R13: 過剰なオーバードロー/白飛びを断つため密度を 0.65 で頭打ちにする。
    const strength = Math.min(this.palette.groundFog ?? 0, 0.65);
    if (strength <= 0) return;
    const top = Math.min(this.palette.groundFogTop ?? 1.1, 1.5);
    // 白寄せ(whitePush): 元々一律0.15で足元を白く霞ませていたが、雪/曇はただでさえ
    // 空とフォグが高明度で「バグっぽい白飛び」になる。雪/曇は0.05に抑え、フォグ固有の
    // 銀青/乳白の色相を残して意図的な大気に。それ以外(砂塵/夕/夜)は0.15で従来通り。
    const whitePush = mood === 'snow' || mood === 'overcast' ? 0.05 : 0.15;
    const color = new THREE.Color(this.palette.fog).lerp(new THREE.Color(1, 1, 1), whitePush);
    const geo = new THREE.PlaneGeometry(size * 1.3, size * 1.3);
    this.geometries.push(geo);
    const layers: Array<[number, number]> =
      tier === 'high'
        ? [
            [top * 0.22, 0.1],
            [top * 0.55, 0.07],
            [top * 1.0, 0.05],
          ]
        : [[top * 0.6, 0.15]]; // 1枚に集約(最上層をやや濃く)
    for (const [y, baseOpacity] of layers) {
      const uTime = { value: 0 };
      this.timeUniforms.push(uTime);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: color.clone() },
          uOpacity: { value: baseOpacity * strength },
          uTime,
          uScale: { value: 5.0 },
          uDrift: { value: new THREE.Vector2(0.01, 0.008) },
        },
        vertexShader: FOG_VERT,
        fragmentShader: FOG_FRAG,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = y;
      plane.frustumCulled = false;
      plane.renderOrder = 2;
      this.scene.add(plane);
      this.objects.push(plane);
      this.fogPlanes.push(plane);
    }
  }

  // ── 草: 3枚くさびのタフトを InstancedMesh + 風頂点シェーダで ──
  private buildGrass(size: number, boxes: readonly BoxSpec[], budget: number): void {
    const kind = this.palette.grassKind;
    if (!kind || kind === 'none') return;
    const count = Math.floor(budget * (this.palette.grassDensity ?? 0.6));
    if (count <= 0) return;
    const half = size / 2;
    const placements = placeGrass(this.rng, half, count, boxes);
    if (placements.length === 0) return;

    const spec = GRASS_SPECS[kind];
    const geo = this.buildTuftGeometry(spec);
    this.geometries.push(geo);

    const uWind = { value: new THREE.Vector2(0.9, 0.4) };
    const windTime = { value: 0 };
    this.timeUniforms.push(windTime);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windTime;
      shader.uniforms.uWind = uWind;
      shader.vertexShader = `uniform float uTime;\nuniform vec2 uWind;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${WIND_GLSL}`,
      );
    };
    this.materials.push(mat);

    const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < placements.length; i += 1) {
      const pl = placements[i]!;
      dummy.position.set(pl.x, 0, pl.z);
      dummy.rotation.set(pl.tilt, pl.yaw, 0);
      dummy.scale.setScalar(pl.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  // 1タフト=3枚の先細り三角ブレード(Y回りに60°ずつ)。頂点カラー基部暗→先端明。
  private buildTuftGeometry(spec: GrassSpec): THREE.BufferGeometry {
    const floor = new THREE.Color(this.palette.floor);
    const accent = new THREE.Color(this.palette.accent);
    const base = floor.clone().lerp(new THREE.Color(0, 0, 0), 0.35);
    const tip = floor
      .clone()
      .lerp(new THREE.Color(1, 1, 1), spec.tipToWhite)
      .lerp(accent, spec.tipToAccent);

    const positions: number[] = [];
    const colors: number[] = [];
    const w = spec.width;
    const h = spec.height;
    for (let b = 0; b < 3; b += 1) {
      const a = (b / 3) * Math.PI; // 0, 60, 120°
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      // base-left, base-right(y=0), apex(y=h)
      const bl: [number, number, number] = [-w * cx, 0, -w * sx];
      const br: [number, number, number] = [w * cx, 0, w * sx];
      const ap: [number, number, number] = [0, h, 0];
      positions.push(...bl, ...br, ...ap);
      colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ── 環境パーティクル: 単一 Points + GLSL 無限wrap。CPU更新はカメラ位置のみ ──
  private buildParticles(kind: ParticleKind, budget: number): void {
    if (kind === 'none') return;
    const count = Math.floor(budget * (this.palette.particleAmount ?? 0.6));
    if (count <= 0) return;
    const spec = PARTICLE_SPECS[kind];

    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = this.rng() * spec.box;
      positions[i * 3 + 1] = this.rng() * spec.box;
      positions[i * 3 + 2] = this.rng() * spec.box;
      phases[i] = this.rng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geometries.push(geo);

    const uTime = { value: 0 };
    const uCamPos = { value: new THREE.Vector3() };
    this.timeUniforms.push(uTime);
    this.particleCam = uCamPos;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uCamPos,
        uColor: { value: new THREE.Color(spec.color) },
        uOpacity: { value: spec.opacity },
        uFall: { value: spec.fall },
        uDrift: { value: new THREE.Vector2(spec.drift[0], spec.drift[1]) },
        uBox: { value: spec.box },
        uSize: { value: spec.size * this.dpr },
        uFogDensity: { value: this.palette.fogDensity },
        uPulse: { value: spec.pulse },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.materials.push(mat);

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.scene.add(points);
    this.objects.push(points);
  }

  // ── 遠景シルエット: 種別別に merge した1メッシュ。play壁の外(R=size*2.4)の環状 ──
  private buildSilhouette(kind: SilhouetteKind, mood: MoodId, size: number): void {
    if (kind === 'none') return;
    const radius = size * 2.4;
    const baseCol = new THREE.Color(this.palette.fog).lerp(new THREE.Color(0, 0, 0), 0.25);
    const rimCol = baseCol.clone().lerp(new THREE.Color(this.palette.sky), 0.35);

    const parts: THREE.BufferGeometry[] = [];
    const windowParts: THREE.BufferGeometry[] = [];
    const countMap: Record<SilhouetteKind, number> = {
      none: 0,
      mountain: 24,
      ridge: 24,
      skyline: 32,
    };
    const n = countMap[kind];
    for (let i = 0; i < n; i += 1) {
      const ang = (i / n) * Math.PI * 2 + (this.rng() - 0.5) * 0.15;
      const r = radius * (0.9 + this.rng() * 0.25);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;

      let geo: THREE.BufferGeometry;
      let height: number;
      if (kind === 'skyline') {
        const w = 8 + this.rng() * 12;
        height = 12 + this.rng() * 28;
        const depth = 8 + this.rng() * 8;
        geo = new THREE.BoxGeometry(w, height, depth);
        geo.translate(0, height / 2, 0);
        if (mood === 'night') this.addWindows(windowParts, x, z, ang, w, height, depth);
      } else {
        const isMountain = kind === 'mountain';
        height = isMountain ? 20 + this.rng() * 25 : 10 + this.rng() * 12;
        const rad = height * (isMountain ? 0.55 : 0.7);
        geo = new THREE.ConeGeometry(rad, height, 4);
        geo.translate(0, height / 2, 0);
        geo.rotateY(this.rng() * Math.PI);
      }
      this.bakeSilhouetteColor(geo, baseCol, rimCol, height);
      geo.translate(x, 0, z);
      parts.push(geo);
    }

    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged) {
      this.geometries.push(merged);
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        fog: true,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      this.objects.push(mesh);
    }

    if (windowParts.length > 0) {
      const win = mergeGeometries(windowParts, false);
      for (const g of windowParts) g.dispose();
      if (win) {
        this.geometries.push(win);
        const winMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#ffd27a'),
          fog: true,
          transparent: true,
          opacity: 0.85,
        });
        this.materials.push(winMat);
        const winMesh = new THREE.Mesh(win, winMat);
        winMesh.castShadow = false;
        this.scene.add(winMesh);
        this.objects.push(winMesh);
      }
    }
  }

  // 夜スカイラインの発光窓: ビルの中心向き面に小さな四角を数個。merge して1DC。
  private addWindows(
    out: THREE.BufferGeometry[],
    bx: number,
    bz: number,
    ang: number,
    w: number,
    h: number,
    depth: number,
  ): void {
    const rows = 4;
    const cols = 3;
    const faceZ = depth / 2 + 0.05;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (this.rng() < 0.45) continue; // 半分ほどは消灯
        const quad = new THREE.PlaneGeometry(w * 0.14, h * 0.09);
        const lx = (c / (cols - 1) - 0.5) * w * 0.6;
        const ly = (r / rows) * h * 0.8 + h * 0.12;
        quad.translate(lx, ly, faceZ);
        // ビル中心へ向ける方位に回してから配置
        quad.rotateY(-ang + Math.PI / 2);
        quad.translate(bx, 0, bz);
        out.push(quad);
      }
    }
  }

  // 局所yで基部暗→稜線明の頂点カラーを焼く。
  private bakeSilhouetteColor(
    geo: THREE.BufferGeometry,
    base: THREE.Color,
    rim: THREE.Color,
    height: number,
  ): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / height, 0, 1);
      const c = base.clone().lerp(rim, t * t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }

  // ── 夜/夕/雪の冷たい逆光。影を落とさない(追加コストほぼ0)自前のリムライト ──
  private buildRim(rim: RimSpec | null, sunDir: THREE.Vector3, size: number): void {
    if (!rim) return;
    const light = new THREE.DirectionalLight(new THREE.Color(rim.color), rim.intensity);
    // 太陽と概ね逆側から差してシルエットの縁を切る。dir はムード指定の方向を基準に。
    const dir = new THREE.Vector3(rim.dir[0], rim.dir[1], rim.dir[2]).normalize();
    if (dir.dot(sunDir) > 0.2) dir.multiplyScalar(-1); // 太陽と同側なら反転して逆光にする
    light.position.copy(dir).multiplyScalar(size);
    light.castShadow = false;
    this.scene.add(light);
    this.objects.push(light);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    if (!this.reduceMotion) this.time += dt;
    for (const u of this.timeUniforms) u.value = this.time;
    if (this.particleCam) this.particleCam.value.copy(camPos);
    for (const plane of this.fogPlanes) {
      plane.position.x = camPos.x;
      plane.position.z = camPos.z;
    }
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      // InstancedMeshはinstanceMatrix等のGPUバッファをdispose()で明示解放する
      // (geo/matのdisposeだけでは残り、試合ごとにVRAMがリークする)
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    }
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.objects.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
    this.timeUniforms.length = 0;
    this.fogPlanes.length = 0;
    this.particleCam = null;
  }
}
