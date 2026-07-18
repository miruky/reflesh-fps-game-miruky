import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rand } from '../core/rng';
import type { GraphicsQuality } from '../core/settings';
import type { BoxSpec, PropPlacement, StageDef } from '../game/stage';
import {
  markCinematicDetail,
  type CinematicDetailPriority,
} from './cinematic-detail';
import { buildCinematicEnvironment } from './cinematic-environment';

/**
 * 全ステージへ適用する映画品質の環境アートレイヤ。
 *
 * gameplayのBoxSpec／Rapierコライダーを一切変更せず、以下を少数DCへ集約して重ねる。
 * - 地表の主要動線、路面標示、排水／補修跡
 * - 大型建造物の窓、外装フレーム、屋上設備
 * - 中景のマクロ瓦礫
 * - 境界外の都市／岩稜シルエット
 * - 各固定ステージ固有のヒーロー・ランドマーク
 *
 * 生成キャンペーンは `gen-<biome>-<seed>` から同じ品質レイヤを決定論的に得る。
 */

export type StageVisualFamily =
  | 'military'
  | 'industrial'
  | 'heritage'
  | 'wilderness'
  | 'arctic'
  | 'urban'
  | 'airport'
  | 'geothermal'
  | 'undead';

export type StageLandmarkKind =
  | 'range-radar'
  | 'container-crane'
  | 'palace-dome'
  | 'desert-gate'
  | 'harbor-crane'
  | 'hill-fortress'
  | 'desert-rig'
  | 'polar-array'
  | 'refinery-stack'
  | 'neon-spire'
  | 'rooftop-helipad'
  | 'quarry-conveyor'
  | 'bamboo-pagoda'
  | 'terrace-village'
  | 'coastal-lighthouse'
  | 'rail-terminal'
  | 'canyon-bridge'
  | 'lakeside-observatory'
  | 'airport-control'
  | 'onsen-pagoda'
  | 'ruined-city'
  | 'burning-block'
  | 'wrecked-port'
  | 'ruined-cathedral'
  | 'lava-mine'
  | 'slaughter-stack'
  | 'quarantine-gate'
  | 'subway-vault'
  | 'broken-ferris-wheel'
  | 'volcano-fortress'
  | 'training-tower';

export interface StageVisualIdentity {
  readonly family: StageVisualFamily;
  readonly landmark: StageLandmarkKind;
}

const FIXED_IDENTITIES: Readonly<Record<string, StageVisualIdentity>> = {
  kunren: { family: 'military', landmark: 'range-radar' },
  souko: { family: 'industrial', landmark: 'container-crane' },
  nakaniwa: { family: 'heritage', landmark: 'palace-dome' },
  kairou: { family: 'heritage', landmark: 'desert-gate' },
  kouwan: { family: 'industrial', landmark: 'harbor-crane' },
  takadai: { family: 'wilderness', landmark: 'hill-fortress' },
  sakyuu: { family: 'wilderness', landmark: 'desert-rig' },
  setsugen: { family: 'arctic', landmark: 'polar-array' },
  koushou: { family: 'industrial', landmark: 'refinery-stack' },
  yoichi: { family: 'urban', landmark: 'neon-spire' },
  okujou: { family: 'urban', landmark: 'rooftop-helipad' },
  saisekiba: { family: 'industrial', landmark: 'quarry-conveyor' },
  chikurin: { family: 'heritage', landmark: 'bamboo-pagoda' },
  tanada: { family: 'wilderness', landmark: 'terrace-village' },
  misaki: { family: 'military', landmark: 'coastal-lighthouse' },
  haieki: { family: 'industrial', landmark: 'rail-terminal' },
  kyokoku: { family: 'wilderness', landmark: 'canyon-bridge' },
  kohan: { family: 'wilderness', landmark: 'lakeside-observatory' },
  kuko: { family: 'airport', landmark: 'airport-control' },
  onsengai: { family: 'heritage', landmark: 'onsen-pagoda' },
  z01: { family: 'undead', landmark: 'ruined-city' },
  z02: { family: 'undead', landmark: 'burning-block' },
  z03: { family: 'undead', landmark: 'wrecked-port' },
  z04: { family: 'undead', landmark: 'ruined-cathedral' },
  z05: { family: 'geothermal', landmark: 'lava-mine' },
  z06: { family: 'undead', landmark: 'slaughter-stack' },
  z07: { family: 'undead', landmark: 'quarantine-gate' },
  z08: { family: 'undead', landmark: 'subway-vault' },
  z09: { family: 'undead', landmark: 'broken-ferris-wheel' },
  z10: { family: 'geothermal', landmark: 'volcano-fortress' },
  renshujo: { family: 'military', landmark: 'training-tower' },
};

const GENERATED_IDENTITIES: Readonly<Record<string, StageVisualIdentity>> = {
  urban: { family: 'urban', landmark: 'ruined-city' },
  industrial: { family: 'industrial', landmark: 'refinery-stack' },
  desert: { family: 'wilderness', landmark: 'desert-rig' },
  snow: { family: 'arctic', landmark: 'polar-array' },
  neon: { family: 'urban', landmark: 'neon-spire' },
  verdant: { family: 'heritage', landmark: 'bamboo-pagoda' },
  harbor: { family: 'industrial', landmark: 'harbor-crane' },
  dusk: { family: 'military', landmark: 'hill-fortress' },
};

export function resolveStageVisualIdentity(stage: Pick<StageDef, 'id' | 'palette' | 'recipe'>): StageVisualIdentity {
  const fixed = FIXED_IDENTITIES[stage.id];
  if (fixed) return fixed;
  const generatedBiome = /^gen-([a-z]+)-\d+$/.exec(stage.id)?.[1];
  if (generatedBiome) {
    const generated = GENERATED_IDENTITIES[generatedBiome];
    if (generated) return generated;
  }
  const theme = stage.recipe?.theme ?? '';
  if (/空港|滑走|エプロン/.test(theme)) return { family: 'airport', landmark: 'airport-control' };
  if (/雪|氷|極地/.test(theme) || stage.palette.mood === 'snow') return { family: 'arctic', landmark: 'polar-array' };
  if (/溶岩|火口|坑道/.test(theme) || stage.palette.particle === 'lava') return { family: 'geothermal', landmark: 'lava-mine' };
  if (/神殿|聖堂|寺|宮殿|温泉/.test(theme)) return { family: 'heritage', landmark: 'palace-dome' };
  if (/工業|工場|港|倉庫|製鉄|採石/.test(theme)) return { family: 'industrial', landmark: 'refinery-stack' };
  if (stage.palette.mood === 'night' || stage.palette.emissiveAccent) return { family: 'urban', landmark: 'neon-spire' };
  if (/砂|峡谷|丘|湖|田|林/.test(theme)) return { family: 'wilderness', landmark: 'canyon-bridge' };
  return { family: 'military', landmark: 'range-radar' };
}

interface StageKitBudget {
  readonly routes: number;
  readonly routeMarks: number;
  readonly groundPatches: number;
  readonly surfaceSeams: number;
  readonly facadePanels: number;
  readonly facadeFrames: number;
  readonly rooftopUnits: number;
  readonly contactShadows: number;
  readonly grimeBands: number;
  readonly downspouts: number;
  readonly rubble: number;
  readonly skyline: number;
  readonly infrastructure: number;
  readonly utilityCabinets: number;
}

const BUDGETS: Readonly<Record<GraphicsQuality, StageKitBudget>> = {
  low: {
    routes: 2, routeMarks: 8, groundPatches: 7, surfaceSeams: 12, facadePanels: 24, facadeFrames: 18,
    rooftopUnits: 8, contactShadows: 16, grimeBands: 12, downspouts: 6, rubble: 18, skyline: 10,
    infrastructure: 6, utilityCabinets: 0,
  },
  medium: {
    routes: 4, routeMarks: 24, groundPatches: 18, surfaceSeams: 36, facadePanels: 90, facadeFrames: 60,
    rooftopUnits: 28, contactShadows: 44, grimeBands: 36, downspouts: 18, rubble: 56, skyline: 24,
    infrastructure: 12, utilityCabinets: 4,
  },
  high: {
    routes: 7, routeMarks: 56, groundPatches: 36, surfaceSeams: 72, facadePanels: 260, facadeFrames: 180,
    rooftopUnits: 64, contactShadows: 88, grimeBands: 72, downspouts: 36, rubble: 120, skyline: 42,
    infrastructure: 20, utilityCabinets: 8,
  },
};

export interface CinematicStageKitOptions {
  readonly stage: StageDef;
  readonly tier: GraphicsQuality;
  readonly boxes: readonly BoxSpec[];
  readonly propPlacements: readonly PropPlacement[];
}

function markObject(
  object: THREE.Object3D,
  priority: CinematicDetailPriority = 0,
): void {
  object.userData.cinematicStageKit = true;
  markCinematicDetail(object, priority);
}

function shade(hex: string, lightnessDelta: number, saturationDelta = 0): THREE.Color {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(
    hsl.h,
    THREE.MathUtils.clamp(hsl.s + saturationDelta, 0, 1),
    THREE.MathUtils.clamp(hsl.l + lightnessDelta, 0.015, 0.92),
  );
  return color;
}

function configureInstances(
  mesh: THREE.InstancedMesh,
  priority: CinematicDetailPriority = 0,
): THREE.InstancedMesh {
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  markObject(mesh, priority);
  return mesh;
}

function makeMatrix(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw = 0,
  rx = 0,
  rz = 0,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

function routeColors(family: StageVisualFamily, stage: StageDef): { surface: THREE.Color; mark: THREE.Color } {
  switch (family) {
    case 'heritage':
      // 草地パレットでも主要動線は石畳として読ませる。床色由来だと全面が同じ緑へ
      // 融合し、広場の距離・進行方向が失われていた。
      return { surface: shade(stage.palette.wall, -0.28, -0.16), mark: shade(stage.palette.wall, 0.08, -0.12) };
    case 'wilderness': {
      const earth = new THREE.Color(stage.palette.obstacle)
        .lerp(new THREE.Color(stage.palette.floor), 0.28)
        .multiplyScalar(0.66);
      return { surface: earth, mark: shade(stage.palette.wall, -0.06, -0.14) };
    }
    case 'arctic':
      return { surface: shade(stage.palette.floor, -0.16, 0.02), mark: new THREE.Color(0xaecbe0) };
    case 'geothermal':
      return { surface: new THREE.Color(0x171719), mark: shade(stage.palette.accent, -0.12, 0.08) };
    case 'urban':
    case 'airport':
      return { surface: shade(stage.palette.floor, -0.34, -0.08), mark: shade(stage.palette.accent, 0.04, 0.05) };
    case 'industrial':
    case 'undead':
      return { surface: shade(stage.palette.floor, -0.36, -0.12), mark: shade(stage.palette.accent, -0.04, 0.05) };
    default:
      return { surface: shade(stage.palette.floor, -0.4, -0.1), mark: shade(stage.palette.wall, 0.25, -0.12) };
  }
}

function buildGroundRoutes(
  stage: StageDef,
  family: StageVisualFamily,
  budget: StageKitBudget,
  boxes: readonly BoxSpec[],
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:ground-navigation-layer';
  markObject(root);
  const colors = routeColors(family, stage);
  const roadGeo = new THREE.PlaneGeometry(1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  const roadMat = new THREE.MeshStandardMaterial({
    // instanceColorへニュートラルグレーを掛け、強い直射+IBL下でも道路を床から分離する。
    color: 0x777c82,
    roughness: family === 'urban' || family === 'industrial' || family === 'undead' ? 0.68 : 0.9,
    metalness: family === 'geothermal' ? 0.16 : 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const roads = new THREE.InstancedMesh(roadGeo, roadMat, budget.routes);
  roads.name = 'aaa:macro-routes';
  roads.receiveShadow = true;
  const routeData: Array<{ x: number; z: number; yaw: number; width: number; length: number }> = [];
  for (let i = 0; i < budget.routes; i += 1) {
    // 先頭2本は必ずマップ中心を直交して通す。外周スポーンから中心を見る開始画面でも
    // 主要動線が読み取れ、巨大な空白床が画面全体を占めない。残りだけをシード散布する。
    const cardinal = i < 2 ? i * (Math.PI / 2) : Math.floor(rand() * 4) * (Math.PI / 2);
    const yaw = cardinal + (i < 2 ? 0 : (rand() - 0.5) * 0.14);
    const widthBase = family === 'airport' ? 12 : family === 'heritage' ? 5.5 : family === 'wilderness' ? 6.5 : 8;
    const width = widthBase * (i < 2 ? 1.08 : 0.78 + rand() * 0.5);
    const length = stage.size * (i < 2 ? 0.94 : 0.38 + rand() * 0.42);
    const lateral = i < 2 ? 0 : (rand() - 0.5) * stage.size * 0.56;
    const x = Math.cos(yaw + Math.PI / 2) * lateral;
    const z = Math.sin(yaw + Math.PI / 2) * lateral;
    roads.setMatrixAt(i, makeMatrix(x, 0.012 + i * 0.00003, z, width, 1, length, yaw));
    roads.setColorAt(i, colors.surface.clone().multiplyScalar(0.88 + rand() * 0.18));
    routeData.push({ x, z, yaw, width, length });
  }
  root.add(configureInstances(roads, 0));

  // 道路／主要動線の両端へ低い縁石・路肩を追加。高さ8cm以下の視覚専用形状なので
  // KCCや弾道を変えず、遠近の収束線だけを強くして巨大平面の距離感を作る。
  const shoulderGeo = new THREE.BoxGeometry(1, 1, 1);
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: family === 'urban' || family === 'industrial' || family === 'airport' ? 0.76 : 0.92,
    metalness: 0.01,
  });
  const shoulders = new THREE.InstancedMesh(shoulderGeo, shoulderMat, routeData.length * 2);
  shoulders.name = 'aaa:route-shoulders';
  shoulders.receiveShadow = true;
  const shoulderColor = family === 'arctic'
    ? shade(stage.palette.wall, -0.12, -0.08)
    : shade(stage.palette.wall, -0.2, -0.1);
  for (let i = 0; i < routeData.length; i += 1) {
    const route = routeData[i]!;
    for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
      const side = sideIndex === 0 ? -1 : 1;
      const lateral = side * (route.width / 2 + 0.16);
      const x = route.x + Math.cos(route.yaw) * lateral;
      const z = route.z - Math.sin(route.yaw) * lateral;
      const shoulderWidth = family === 'wilderness' ? 0.42 : 0.24;
      const shoulderHeight = family === 'wilderness' ? 0.035 : 0.075;
      shoulders.setMatrixAt(
        i * 2 + sideIndex,
        makeMatrix(x, shoulderHeight / 2 + 0.014, z, shoulderWidth, shoulderHeight, route.length, route.yaw),
      );
      shoulders.setColorAt(i * 2 + sideIndex, shoulderColor);
    }
  }
  root.add(configureInstances(shoulders, 1));

  const markGeo = new THREE.BoxGeometry(1, 1, 1);
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -3,
  });
  const marks = new THREE.InstancedMesh(markGeo, markMat, budget.routeMarks);
  marks.name = 'aaa:route-markings-and-drains';
  marks.receiveShadow = true;
  for (let i = 0; i < budget.routeMarks; i += 1) {
    const route = routeData[i % routeData.length]!;
    const t = rand() - 0.5;
    const along = t * route.length * 0.9;
    const side = (rand() - 0.5) * route.width * 0.75;
    const x = route.x + Math.sin(route.yaw) * along + Math.cos(route.yaw) * side;
    const z = route.z + Math.cos(route.yaw) * along - Math.sin(route.yaw) * side;
    const isDrain = i % 5 === 0;
    const isDash = family === 'airport' || family === 'military' || family === 'industrial' || family === 'urban';
    const width = isDrain ? 0.85 : isDash ? 0.11 : 0.22;
    const length = isDrain ? 1.6 : isDash ? 3.5 : 1.1;
    marks.setMatrixAt(i, makeMatrix(x, 0.026 + i * 0.00002, z, width, 0.018, length, route.yaw));
    marks.setColorAt(i, isDrain ? shade(stage.palette.wall, -0.22, -0.1) : colors.mark);
  }
  root.add(configureInstances(marks, 1));

  // 大面積の色調補修／濡れ／土埃パッチ。巨大床のどこから開始しても単色平面にならない密度で散布し、
  // 円周はフラグメントalphaで柔らかく消すため「貼った円盤」には見えない。
  const patchGeo = new THREE.CircleGeometry(1, 28);
  patchGeo.rotateX(-Math.PI / 2);
  const patchMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: family === 'urban' || family === 'industrial' || family === 'undead' ? 0.58 : 0.91,
    metalness: family === 'geothermal' ? 0.18 : 0.01,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  patchMat.customProgramCacheKey = () => 'hibana-ground-patch-radial-v1';
  patchMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStagePatchUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvStagePatchUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStagePatchUv;')
      .replace(
        '#include <alphamap_fragment>',
        '#include <alphamap_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.28, 0.5, length(vStagePatchUv - 0.5));',
      );
  };
  const patches = new THREE.InstancedMesh(patchGeo, patchMat, budget.groundPatches);
  patches.name = 'aaa:ground-surface-patches';
  patches.receiveShadow = true;
  const patchBase = shade(stage.palette.floor, family === 'arctic' ? -0.08 : -0.18, -0.08);
  const half = stage.size * 0.46;
  for (let i = 0; i < budget.groundPatches; i += 1) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      x = (rand() * 2 - 1) * half;
      z = (rand() * 2 - 1) * half;
      if (!groundOccupied(boxes, x, z, 1.5)) break;
    }
    const rx = 3.5 + rand() * 10.5;
    const rz = rx * (0.35 + rand() * 0.7);
    patches.setMatrixAt(i, makeMatrix(x, 0.017 + i * 0.00002, z, rx, 1, rz, rand() * Math.PI));
    patches.setColorAt(i, patchBase.clone().multiplyScalar(0.72 + rand() * 0.42));
  }
  root.add(configureInstances(patches, 2));

  // 近景の床へ施工目地・細い亀裂を散らす。1本ずつのMeshにはせず全品質で1DCに集約し、
  // 物理床より3cmだけ上へ置くことで、当たり判定を一切変えず足元の実寸スケールを作る。
  const seamGeometry = new THREE.BoxGeometry(1, 1, 1);
  const seamMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: family === 'urban' || family === 'industrial' || family === 'undead' ? 0.62 : 0.88,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -3,
  });
  const seams = new THREE.InstancedMesh(seamGeometry, seamMaterial, budget.surfaceSeams);
  seams.name = 'aaa:ground-surface-seams';
  seams.receiveShadow = false;
  const seamBase = family === 'arctic'
    ? new THREE.Color(0x6d8798)
    : family === 'wilderness' || family === 'heritage'
      ? shade(stage.palette.obstacle, -0.3, -0.16)
      : shade(stage.palette.floor, -0.48, -0.14);
  for (let i = 0; i < budget.surfaceSeams; i += 1) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      x = (rand() * 2 - 1) * half;
      z = (rand() * 2 - 1) * half;
      if (!groundOccupied(boxes, x, z, 0.8)) break;
    }
    const longJoint = i % 7 === 0;
    const width = longJoint ? 0.045 + rand() * 0.035 : 0.025 + rand() * 0.028;
    const length = longJoint ? 2.8 + rand() * 3.8 : 0.65 + rand() * 2.2;
    seams.setMatrixAt(i, makeMatrix(x, 0.028 + i * 0.000002, z, width, 0.008, length, rand() * Math.PI));
    seams.setColorAt(i, seamBase.clone().multiplyScalar(0.7 + rand() * 0.38));
  }
  root.add(configureInstances(seams, 2));
  return root;
}

interface FacadeMatrix {
  readonly matrix: THREE.Matrix4;
  readonly color: THREE.Color;
}

function facadeCandidates(boxes: readonly BoxSpec[]): BoxSpec[] {
  return boxes
    .filter((box) => !box.ghost && !box.decor && !box.prop && !box.breakable && box.h >= 3.2 && Math.max(box.w, box.d) >= 4)
    .sort((a, b) => Number(Boolean(b.district)) - Number(Boolean(a.district))
      || b.h * Math.max(b.w, b.d) - a.h * Math.max(a.w, a.d));
}

function buildFacadeLayer(
  stage: StageDef,
  family: StageVisualFamily,
  boxes: readonly BoxSpec[],
  budget: StageKitBudget,
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:architectural-facades';
  markObject(root);
  const candidates = facadeCandidates(boxes);
  if (candidates.length === 0) return root;
  const panels: FacadeMatrix[] = [];
  const frames: FacadeMatrix[] = [];
  const roofs: FacadeMatrix[] = [];

  for (let ci = 0; ci < candidates.length; ci += 1) {
    const box = candidates[ci]!;
    const longX = box.w >= box.d;
    const long = longX ? box.w : box.d;
    const columns = THREE.MathUtils.clamp(Math.floor(long / 2.8), 2, 8);
    const rows = THREE.MathUtils.clamp(Math.floor(box.h / 3.1), 1, 5);
    const primarySide = ((ci + stage.seed) & 1) === 0 ? 1 : -1;
    // 建築地区は中を通過でき、両方向から見えるため長辺の両面を仕上げる。
    // 全パネルは同じInstancedMeshなので、建物の情報量を増やしてもdraw callは増えない。
    const sideSigns: readonly number[] = box.district ? [-1, 1] : [primarySide];
    const panelBase = family === 'heritage'
      ? shade(stage.palette.wall, -0.2, -0.08)
      : family === 'arctic'
        ? new THREE.Color(0x71838c)
        : family === 'undead' || family === 'geothermal'
          ? shade(stage.palette.wall, 0.02, -0.14)
          : shade(stage.palette.wall, -0.08, -0.14);

    for (const sideSign of sideSigns) {
      for (let row = 0; row < rows && panels.length < budget.facadePanels; row += 1) {
        for (let col = 0; col < columns && panels.length < budget.facadePanels; col += 1) {
          const u = (col + 0.5) / columns - 0.5;
          const y = box.y - box.h / 2 + 1.35 + row * Math.min(2.8, (box.h - 1.4) / Math.max(1, rows));
          const panelW = Math.min(1.65, long / columns * 0.62);
          const panelH = family === 'heritage' ? 1.45 : 1.15;
          let matrix: THREE.Matrix4;
          if (longX) {
            matrix = makeMatrix(box.x + u * long * 0.86, y, box.z + sideSign * (box.d / 2 + 0.035), panelW, panelH, 0.055);
          } else {
            matrix = makeMatrix(box.x + sideSign * (box.w / 2 + 0.035), y, box.z + u * long * 0.86, 0.055, panelH, panelW);
          }
          panels.push({ matrix, color: panelBase.clone().multiplyScalar(0.8 + rand() * 0.28) });
        }
      }
    }

    // 水平帯・垂直ピラスター。面の大きさを読み取れる反復モジュールを作る。
    if (frames.length < budget.facadeFrames) {
      const trim = shade(box.color, 0.1, -0.04);
      for (const sideSign of sideSigns) {
        for (let row = 1; row < rows && frames.length < budget.facadeFrames; row += 1) {
          const y = box.y - box.h / 2 + row * (box.h / rows);
          const matrix = longX
            ? makeMatrix(box.x, y, box.z + sideSign * (box.d / 2 + 0.065), long * 0.94, 0.09, 0.08)
            : makeMatrix(box.x + sideSign * (box.w / 2 + 0.065), y, box.z, 0.08, 0.09, long * 0.94);
          frames.push({ matrix, color: trim });
        }
        for (let col = 0; col <= columns && frames.length < budget.facadeFrames; col += 2) {
          const u = col / columns - 0.5;
          const matrix = longX
            ? makeMatrix(box.x + u * long * 0.9, box.y, box.z + sideSign * (box.d / 2 + 0.07), 0.09, box.h * 0.92, 0.09)
            : makeMatrix(box.x + sideSign * (box.w / 2 + 0.07), box.y, box.z + u * long * 0.9, 0.09, box.h * 0.92, 0.09);
          frames.push({ matrix, color: trim });
        }
      }
    }

    if (box.h >= 5 && roofs.length < budget.rooftopUnits) {
      const top = box.y + box.h / 2;
      const unitCount = Math.min(3, budget.rooftopUnits - roofs.length);
      for (let unit = 0; unit < unitCount; unit += 1) {
        const along = (unit - (unitCount - 1) / 2) * Math.min(3, long * 0.2);
        const x = box.x + (longX ? along : (rand() - 0.5) * box.w * 0.4);
        const z = box.z + (longX ? (rand() - 0.5) * box.d * 0.4 : along);
        roofs.push({
          matrix: makeMatrix(x, top + 0.42, z, 0.9 + rand() * 0.7, 0.75 + rand() * 0.45, 0.9 + rand() * 0.7, rand() * Math.PI),
          color: shade(stage.palette.obstacle, -0.08, -0.1),
        });
      }
    }
    if (panels.length >= budget.facadePanels && frames.length >= budget.facadeFrames && roofs.length >= budget.rooftopUnits) break;
  }

  const addInstanced = (
    name: string,
    entries: readonly FacadeMatrix[],
    material: THREE.MeshStandardMaterial,
    castShadow: boolean,
  ): void => {
    if (entries.length === 0) {
      material.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, entries.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      mesh.setMatrixAt(i, entry.matrix);
      mesh.setColorAt(i, entry.color);
    }
    const priority: CinematicDetailPriority =
      name === 'aaa:facade-frames' ? 0 : name === 'aaa:facade-panels' ? 1 : 2;
    root.add(configureInstances(mesh, priority));
  };

  const night = stage.palette.mood === 'night' || family === 'undead';
  addInstanced('aaa:facade-panels', panels, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.12,
    emissive: night ? shade(stage.palette.accent, -0.3) : new THREE.Color(0x000000),
    emissiveIntensity: night ? 0.12 : 0,
    envMapIntensity: 0.26,
  }), false);
  addInstanced('aaa:facade-frames', frames, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3 }), true);
  addInstanced('aaa:rooftop-mechanical', roofs, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.46 }), true);
  return root;
}

function buildGroundingLayer(
  stage: StageDef,
  family: StageVisualFamily,
  boxes: readonly BoxSpec[],
  budget: StageKitBudget,
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:architectural-grounding';
  markObject(root);

  // 小〜中型遮蔽物の真下へ柔らかい接地影を1 InstancedMeshで敷く。
  // medium tierでもSSAO無しで「床から浮く箱」を抑え、highのAOとは強度を重ねすぎない。
  const contactCandidates = boxes
    .filter((box) => {
      if (box.ghost || box.decor || box.prop) return false;
      const bottom = box.y - box.h / 2;
      const footprint = box.w * box.d;
      return bottom <= 0.22 && footprint >= 0.8 && footprint <= 150 && Math.max(box.w, box.d) <= 18;
    })
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .slice(0, budget.contactShadows);
  if (contactCandidates.length > 0) {
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: family === 'arctic' ? 0.2 : 0.31,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    mat.customProgramCacheKey = () => 'hibana-contact-shadow-radial-v1';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vContactUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvContactUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vContactUv;')
        .replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.12, 0.5, length(vContactUv - 0.5));',
        );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, contactCandidates.length);
    mesh.name = 'aaa:contact-shadows';
    mesh.renderOrder = 0;
    for (let i = 0; i < contactCandidates.length; i += 1) {
      const box = contactCandidates[i]!;
      mesh.setMatrixAt(i, makeMatrix(
        box.x,
        0.006 + i * 0.000002,
        box.z,
        box.w * (0.58 + rand() * 0.08),
        1,
        box.d * (0.58 + rand() * 0.08),
        rand() * 0.08,
      ));
    }
    root.add(configureInstances(mesh, 0));
  }

  const candidates = facadeCandidates(boxes);
  const grimeEntries: FacadeMatrix[] = [];
  const pipeEntries: FacadeMatrix[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const box = candidates[i]!;
    const longX = box.w >= box.d;
    const long = longX ? box.w : box.d;
    const side = ((i + stage.seed) & 1) === 0 ? 1 : -1;
    if (grimeEntries.length < budget.grimeBands) {
      const height = 0.28 + Math.min(0.52, box.h * 0.035) + rand() * 0.14;
      const bottom = box.y - box.h / 2;
      grimeEntries.push({
        matrix: longX
          ? makeMatrix(box.x, bottom + height / 2 + 0.025, box.z + side * (box.d / 2 + 0.041), long * 0.96, height, 0.045)
          : makeMatrix(box.x + side * (box.w / 2 + 0.041), bottom + height / 2 + 0.025, box.z, 0.045, height, long * 0.96),
        color: shade(box.color, -0.24, -0.12).multiplyScalar(0.72 + rand() * 0.22),
      });
    }
    if (pipeEntries.length < budget.downspouts && box.h >= 4.5 && long >= 6) {
      const pipeH = Math.min(7.5, box.h * 0.74);
      const offset = (rand() - 0.5) * long * 0.7;
      pipeEntries.push({
        matrix: longX
          ? makeMatrix(box.x + offset, box.y - box.h / 2 + pipeH / 2 + 0.18, box.z + side * (box.d / 2 + 0.1), 0.12, pipeH, 0.12)
          : makeMatrix(box.x + side * (box.w / 2 + 0.1), box.y - box.h / 2 + pipeH / 2 + 0.18, box.z + offset, 0.12, pipeH, 0.12),
        color: shade(stage.palette.obstacle, -0.18, -0.08),
      });
    }
    if (grimeEntries.length >= budget.grimeBands && pipeEntries.length >= budget.downspouts) break;
  }

  const addBoxes = (
    name: string,
    entries: readonly FacadeMatrix[],
    material: THREE.MeshStandardMaterial,
    priority: CinematicDetailPriority,
  ): void => {
    if (entries.length === 0) {
      material.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, entries.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      mesh.setMatrixAt(i, entry.matrix);
      mesh.setColorAt(i, entry.color);
    }
    root.add(configureInstances(mesh, priority));
  };
  addBoxes(
    'aaa:facade-base-grime',
    grimeEntries,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 }),
    1,
  );
  addBoxes(
    'aaa:facade-downspouts',
    pipeEntries,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.58 }),
    2,
  );
  return root;
}

function groundOccupied(boxes: readonly BoxSpec[], x: number, z: number, margin: number): boolean {
  return boxes.some((box) => {
    if (box.ghost || box.decor) return false;
    if (box.y - box.h / 2 > 0.2) return false;
    return Math.abs(x - box.x) < box.w / 2 + margin && Math.abs(z - box.z) < box.d / 2 + margin;
  });
}

function buildMacroRubble(
  stage: StageDef,
  family: StageVisualFamily,
  boxes: readonly BoxSpec[],
  props: readonly PropPlacement[],
  count: number,
  rand: Rand,
): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: family === 'industrial' ? 0.08 : 0.01 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'aaa:macro-rubble-clusters';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  const base = shade(stage.palette.obstacle, -0.1, -0.08);
  const half = stage.size * 0.47;
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let z = 0;
    const anchor = props.length > 0 && rand() < 0.62 ? props[i % props.length] : undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (anchor) {
        const angle = rand() * Math.PI * 2;
        const radius = 1.2 + rand() * 4.5;
        x = anchor.cx + Math.cos(angle) * radius;
        z = anchor.cz + Math.sin(angle) * radius;
      } else {
        x = (rand() * 2 - 1) * half;
        z = (rand() * 2 - 1) * half;
      }
      if (!groundOccupied(boxes, x, z, 0.35)) break;
    }
    const r = 0.16 + rand() ** 2 * 0.72;
    mesh.setMatrixAt(i, makeMatrix(x, r * 0.38, z, r * (0.65 + rand()), r * (0.35 + rand() * 0.4), r * (0.7 + rand()), rand() * Math.PI, rand() * 0.4, rand() * 0.4));
    mesh.setColorAt(i, base.clone().multiplyScalar(0.64 + rand() * 0.48));
  }
  return configureInstances(mesh, 2);
}

function buildDistantWorld(
  stage: StageDef,
  family: StageVisualFamily,
  count: number,
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:distant-world';
  markObject(root);
  const isNatural = family === 'wilderness' || family === 'arctic' || family === 'geothermal';

  // プレイ領域の外側を一枚の滑らかな地形で繋ぐ。物理は不可視境界の内側だけなので、
  // 「世界は先へ続いて見えるが進めない」通常のFPSマップ境界になる。旧4枚の拡張床だけでは
  // 外周端が直線に切れ、箱庭/ジオラマ感が出ていた。
  const lowBudget = count <= BUDGETS.low.skyline;
  const highBudget = count >= BUDGETS.high.skyline;
  const radialSegments = lowBudget ? 48 : highBudget ? 96 : 72;
  const radialRings = lowBudget ? 4 : highBudget ? 8 : 6;
  const innerRadius = stage.size * 0.67;
  const outerRadius = stage.size * 1.9;
  const terrainGeometry = new THREE.RingGeometry(
    innerRadius,
    outerRadius,
    radialSegments,
    radialRings,
  );
  const positions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
  const phase = (stage.seed % 997) * 0.017;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getY(i);
    const radius = Math.hypot(x, z);
    const t = THREE.MathUtils.clamp((radius - innerRadius) / (outerRadius - innerRadius), 0, 1);
    const eased = t * t * (3 - 2 * t);
    const angle = Math.atan2(z, x);
    const macro = Math.sin(angle * 3 + phase) * 0.55 + Math.sin(angle * 7 - phase * 0.7) * 0.25;
    const naturalLift = family === 'arctic'
      ? 18
      : family === 'geothermal'
        ? 14
        : family === 'wilderness'
          ? 10
          : 2.4;
    const micro = Math.sin(x * 0.028 + phase) * Math.cos(z * 0.024 - phase) * (isNatural ? 2.2 : 0.45);
    positions.setZ(i, -0.08 + eased * (naturalLift * (0.48 + macro * 0.44) + micro));
  }
  positions.needsUpdate = true;
  terrainGeometry.computeVertexNormals();
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: shade(stage.palette.floor, isNatural ? -0.08 : -0.16, -0.05),
    roughness: isNatural ? 0.96 : 0.86,
    metalness: family === 'urban' || family === 'industrial' || family === 'airport' ? 0.03 : 0,
    fog: true,
  });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.name = 'aaa:continuous-world-terrain';
  terrain.receiveShadow = false;
  terrain.castShadow = false;
  markObject(terrain, 0);
  root.add(terrain);

  // 港・湖・岬は地形の下へ大水面を敷き、境界の先に実在する湾/湖として読ませる。
  if (['kouwan', 'kohan', 'misaki', 'z03'].includes(stage.id)) {
    const waterGeometry = new THREE.CircleGeometry(stage.size * 2.05, radialSegments);
    waterGeometry.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      waterGeometry,
      new THREE.MeshStandardMaterial({
        color: shade(stage.palette.sky, -0.32, 0.1),
        roughness: 0.18,
        metalness: 0.28,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    water.name = 'aaa:world-water-horizon';
    water.position.y = -0.42;
    water.renderOrder = -1;
    markObject(water, 0);
    root.add(water);
  }

  const geometry = isNatural
    ? new THREE.ConeGeometry(1, 1, highBudget ? 10 : 8, 3)
    : new THREE.BoxGeometry(1, 1, 1, highBudget ? 2 : 1, highBudget ? 2 : 1, highBudget ? 2 : 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: isNatural ? 0.98 : 0.84,
    metalness: isNatural ? 0 : 0.08,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = isNatural ? 'aaa:distant-ridges' : 'aaa:distant-skyline';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const base = shade(stage.palette.wall, -0.1, -0.08);
  const artificialAnchors: Array<{ x: number; z: number; height: number; width: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.12;
    const radius = stage.size * (0.76 + rand() * 0.18);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (isNatural) {
      const width = 8 + rand() * 18;
      const height = family === 'arctic' ? 13 + rand() * 24 : 7 + rand() * 17;
      mesh.setMatrixAt(i, makeMatrix(x, height * 0.42 - 1, z, width, height, width * (0.55 + rand() * 0.6), rand() * Math.PI, 0, (rand() - 0.5) * 0.16));
    } else {
      const width = 3.5 + rand() * 8;
      const depth = 3.5 + rand() * 8;
      const height = 8 + rand() ** 1.5 * 24;
      mesh.setMatrixAt(i, makeMatrix(x, height / 2 - 1, z, width, height, depth, rand() * Math.PI));
      artificialAnchors.push({ x, z, height, width });
    }
    mesh.setColorAt(i, base.clone().multiplyScalar(0.64 + rand() * 0.35));
  }
  root.add(configureInstances(mesh, 0));

  // 人工景観は屋上設備を別シルエットとして載せ、単なる直方体列から都市/工業地区へ変える。
  if (!isNatural && count > 0) {
    const roofGeometry = new THREE.CylinderGeometry(1, 1.15, 1, 8);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: shade(stage.palette.wall, -0.18, -0.1),
      roughness: 0.82,
      metalness: 0.12,
      fog: true,
    });
    const roofs = new THREE.InstancedMesh(roofGeometry, roofMaterial, Math.max(4, Math.floor(count * 0.55)));
    roofs.name = 'aaa:distant-rooftop-equipment';
    for (let i = 0; i < roofs.count; i += 1) {
      const anchor = artificialAnchors[(i * 2 + 1) % artificialAnchors.length]!;
      const width = Math.min(anchor.width * 0.24, 2.2) * (0.8 + (i % 3) * 0.12);
      roofs.setMatrixAt(i, makeMatrix(
        anchor.x,
        anchor.height - 0.1,
        anchor.z,
        width,
        1.8 + (i % 3) * 0.7,
        width,
      ));
    }
    root.add(configureInstances(roofs, 1));
  }
  return root;
}

function mergedFixtureGeometry(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`failed to merge ${label}`);
  merged.computeVertexNormals();
  return merged;
}

function infrastructurePoleGeometry(family: StageVisualFamily): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.085, 0.13, 4.9, 10, 3);
  pole.translate(0, 2.45, 0);
  parts.push(pole);
  const crossArm = new THREE.BoxGeometry(family === 'airport' ? 1.35 : 0.92, 0.09, 0.11);
  crossArm.translate(0, 4.62, 0);
  parts.push(crossArm);
  for (const x of [-0.36, 0.36]) {
    const insulator = new THREE.CylinderGeometry(0.045, 0.055, 0.18, 8, 1);
    insulator.translate(x, 4.76, 0);
    parts.push(insulator);
  }
  const lampArm = new THREE.BoxGeometry(0.7, 0.055, 0.065);
  lampArm.translate(0.34, family === 'heritage' ? 4.28 : 4.42, 0);
  parts.push(lampArm);
  return mergedFixtureGeometry(parts, 'stage infrastructure pole');
}

function utilityCabinetGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(0.82, 1.35, 0.48);
  body.translate(0, 0.675, 0);
  parts.push(body);
  const cap = new THREE.BoxGeometry(0.9, 0.08, 0.56);
  cap.translate(0, 1.39, 0);
  parts.push(cap);
  const door = new THREE.BoxGeometry(0.64, 0.96, 0.035);
  door.translate(0, 0.72, 0.258);
  parts.push(door);
  for (let slot = -2; slot <= 2; slot += 1) {
    const vent = new THREE.BoxGeometry(0.34, 0.025, 0.025);
    vent.translate(0, 0.42 + slot * 0.075, 0.285);
    parts.push(vent);
  }
  return mergedFixtureGeometry(parts, 'stage utility cabinet');
}

/**
 * 不可視境界のすぐ外へ、人間スケールのインフラを連続配置する。
 * プレイヤー／AI／弾道とは交差せず、箱庭の外にも道路と生活圏が続くことだけを示す。
 * highでも pole/lamp/cabinet/cable の最大4DCに固定する。
 */
function buildBoundaryInfrastructure(
  stage: StageDef,
  family: StageVisualFamily,
  budget: StageKitBudget,
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:boundary-infrastructure';
  markObject(root, 0);
  const anchors: Array<{ x: number; z: number; height: number; yaw: number; lean: number }> = [];
  for (let i = 0; i < budget.infrastructure; i += 1) {
    const angle = (i / budget.infrastructure) * Math.PI * 2 + (rand() - 0.5) * 0.1;
    const radius = stage.size * (0.535 + rand() * 0.055);
    const height = 0.86 + rand() * 0.24;
    anchors.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      height,
      yaw: -angle + Math.PI / 2,
      lean: family === 'undead' || family === 'geothermal'
        ? (rand() - 0.5) * 0.16
        : (rand() - 0.5) * 0.025,
    });
  }

  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: family === 'heritage' || family === 'wilderness' ? 0.82 : 0.56,
    metalness: family === 'heritage' || family === 'wilderness' ? 0.08 : 0.46,
    fog: true,
  });
  const poles = new THREE.InstancedMesh(infrastructurePoleGeometry(family), poleMaterial, anchors.length);
  poles.name = 'aaa:perimeter-utility-poles';
  poles.castShadow = false;
  poles.receiveShadow = false;
  const poleBase = family === 'heritage' || family === 'wilderness'
    ? new THREE.Color(0x4b3b2c)
    : shade(stage.palette.obstacle, -0.2, -0.12);
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    poles.setMatrixAt(i, makeMatrix(
      anchor.x,
      0,
      anchor.z,
      anchor.height,
      anchor.height,
      anchor.height,
      anchor.yaw,
      0,
      anchor.lean,
    ));
    poles.setColorAt(i, poleBase.clone().multiplyScalar(0.72 + rand() * 0.34));
  }
  root.add(configureInstances(poles, 0));

  const lampColor = family === 'arctic' || family === 'airport'
    ? new THREE.Color(0xc7eaff)
    : family === 'undead' || stage.palette.mood === 'night'
      ? shade(stage.palette.accent, 0.08, 0.04)
      : new THREE.Color(0xffd6a0);
  const lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.12, 0.2),
    new THREE.MeshStandardMaterial({
      color: lampColor,
      emissive: lampColor,
      emissiveIntensity: family === 'undead' || stage.palette.mood === 'night' ? 0.7 : 0.22,
      roughness: 0.35,
      metalness: 0.08,
      fog: true,
    }),
    anchors.length,
  );
  lamps.name = 'aaa:perimeter-practical-lamps';
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    lamps.setMatrixAt(i, makeMatrix(
      anchor.x + Math.cos(anchor.yaw) * 0.68 * anchor.height,
      4.42 * anchor.height,
      anchor.z - Math.sin(anchor.yaw) * 0.68 * anchor.height,
      anchor.height,
      anchor.height,
      anchor.height,
      anchor.yaw,
      0,
      anchor.lean,
    ));
  }
  root.add(configureInstances(lamps, 1));

  if (budget.utilityCabinets > 0) {
    const cabinets = new THREE.InstancedMesh(
      utilityCabinetGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.42, fog: true }),
      budget.utilityCabinets,
    );
    cabinets.name = 'aaa:perimeter-utility-cabinets';
    cabinets.receiveShadow = false;
    const base = shade(stage.palette.wall, -0.16, -0.12);
    for (let i = 0; i < budget.utilityCabinets; i += 1) {
      const anchor = anchors[(i * 2 + 1) % anchors.length]!;
      cabinets.setMatrixAt(i, makeMatrix(
        anchor.x + Math.cos(anchor.yaw + Math.PI / 2) * 0.85,
        0,
        anchor.z - Math.sin(anchor.yaw + Math.PI / 2) * 0.85,
        0.84 + rand() * 0.28,
        0.84 + rand() * 0.22,
        0.84 + rand() * 0.28,
        anchor.yaw,
      ));
      cabinets.setColorAt(i, base.clone().multiplyScalar(0.72 + rand() * 0.3));
    }
    root.add(configureInstances(cabinets, 2));
  }

  if (budget.utilityCabinets > 0 && family !== 'airport') {
    const cableParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i]!;
      const b = anchors[(i + 1) % anchors.length]!;
      const ay = 4.72 * a.height;
      const by = 4.72 * b.height;
      const points = [
        new THREE.Vector3(a.x, ay, a.z),
        new THREE.Vector3((a.x * 2 + b.x) / 3, THREE.MathUtils.lerp(ay, by, 1 / 3) - 0.22, (a.z * 2 + b.z) / 3),
        new THREE.Vector3((a.x + b.x * 2) / 3, THREE.MathUtils.lerp(ay, by, 2 / 3) - 0.22, (a.z + b.z * 2) / 3),
        new THREE.Vector3(b.x, by, b.z),
      ];
      cableParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 8, 0.018, 3, false));
    }
    const cables = new THREE.Mesh(
      mergedFixtureGeometry(cableParts, 'stage overhead cables'),
      new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.58, metalness: 0.34, fog: true }),
    );
    cables.name = 'aaa:perimeter-overhead-cables';
    cables.castShadow = false;
    cables.receiveShadow = false;
    markObject(cables, 3);
    root.add(cables);
  }
  return root;
}

/**
 * ステージ別生成アートを、プレイ境界よりも外側の遠景だけに合成する。
 *
 * サムネイルを床や衝突物の代わりに貼る「ハリボテ」ではなく、上で生成した
 * 実体建築・連続地形・ヒーローランドマークのさらに奥でのみ使う matte painting。
 * 640x368 WebP 1枚、1 draw call、ステージ交換時にテクスチャをdisposeする。lowでは読み込まない。
 */
function buildDistantStageMatte(stage: StageDef, tier: GraphicsQuality): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:distant-stage-matte-root';
  markObject(root, 1);
  if (tier === 'low' || !FIXED_IDENTITIES[stage.id]) return root;

  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const url = `${base}assets/stage-thumbs/${stage.id}.webp`;
  const canLoadImage = typeof document !== 'undefined' && typeof document.createElementNS === 'function';
  const texture = !canLoadImage
    ? new THREE.DataTexture(new Uint8Array([96, 104, 112, 255]), 1, 1)
    : new THREE.TextureLoader().load(url);
  texture.name = `stage-matte:${stage.id}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  // 左右端を鏡面反復し、環境マット間の縦シームを消す。
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(4, 1);
  texture.offset.x = ((stage.seed * 37) % 100) / 100;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const radius = stage.size * 0.92;
  // 1リピート分の物理アスペクトを元画像(640/368)に合わせ、横伸びを防ぐ。
  const sourceAspect = 640 / 368;
  const imageHeightAtCorrectAspect = (Math.PI * 2 * radius / 4) / sourceAspect;
  // サムネイルの天井・橋・クレーンを360度パノラマの頭上に再利用すると、
  // 「巨大な天井」に見える。正しい縦横比の高さだけを使い、上偲42%を長くフェードして
  // 実3D遠景とSky.jsへ戻す。マットは地平線の低い帯に限定する。
  const height = imageHeightAtCorrectAspect;
  texture.repeat.y = 1;
  texture.offset.y = 0;
  const alphaBytes = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i += 1) {
    const t = i / 63;
    const bottom = THREE.MathUtils.clamp(t / 0.12, 0, 1);
    const top = THREE.MathUtils.clamp((1 - t) / 0.42, 0, 1);
    const x = Math.min(bottom, top);
    const smooth = x * x * (3 - 2 * x);
    const value = Math.round(smooth * 255);
    alphaBytes[i * 4] = value;
    alphaBytes[i * 4 + 1] = value;
    alphaBytes[i * 4 + 2] = value;
    alphaBytes[i * 4 + 3] = 255;
  }
  const alphaMap = new THREE.DataTexture(alphaBytes, 1, 64, THREE.RGBAFormat);
  alphaMap.name = `stage-matte-alpha:${stage.id}`;
  alphaMap.wrapS = THREE.ClampToEdgeWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  alphaMap.repeat.set(1, 1);
  alphaMap.offset.y = 0;
  alphaMap.minFilter = THREE.LinearFilter;
  alphaMap.magFilter = THREE.LinearFilter;
  alphaMap.needsUpdate = true;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, tier === 'high' ? 72 : 48, 1, true);
  const undead = /^z\d\d$/.test(stage.id);
  const material = new THREE.MeshBasicMaterial({
    color: undead ? new THREE.Color(1.28, 1.28, 1.28) : new THREE.Color(0xffffff),
    map: texture,
    alphaMap,
    side: THREE.BackSide,
    transparent: true,
    opacity: undead ? 0.40 : 0.28,
    depthWrite: false,
    fog: true,
    toneMapped: false,
  });
  material.userData.ownedMaps = [texture, alphaMap];
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'aaa:distant-stage-matte';
  mesh.position.y = height / 2 - 4;
  mesh.rotation.y = ((stage.seed * 0.61803398875) % 1) * Math.PI * 2;
  mesh.renderOrder = -3;
  mesh.frustumCulled = false;
  markObject(mesh, 1);
  root.add(mesh);
  return root;
}

type HeroFamily = 'structure' | 'metal' | 'glass' | 'accent';

interface HeroBuilder {
  readonly parts: Record<HeroFamily, THREE.BufferGeometry[]>;
  box: (family: HeroFamily, x: number, y: number, z: number, w: number, h: number, d: number, rx?: number, ry?: number, rz?: number) => void;
  cylinder: (family: HeroFamily, x: number, y: number, z: number, top: number, bottom: number, h: number, segments?: number, rx?: number, rz?: number) => void;
  torus: (family: HeroFamily, x: number, y: number, z: number, radius: number, tube: number, rx?: number, ry?: number, rz?: number, arc?: number) => void;
  cone: (family: HeroFamily, x: number, y: number, z: number, radius: number, h: number, segments?: number) => void;
}

function heroBuilder(): HeroBuilder {
  const parts: Record<HeroFamily, THREE.BufferGeometry[]> = { structure: [], metal: [], glass: [], accent: [] };
  const apply = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    ));
  };
  return {
    parts,
    box(family, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
      const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
      apply(g, x, y, z, rx, ry, rz);
      parts[family].push(g);
    },
    cylinder(family, x, y, z, top, bottom, h, segments = 12, rx = 0, rz = 0) {
      const g = new THREE.CylinderGeometry(top, bottom, h, segments, 1);
      apply(g, x, y, z, rx, 0, rz);
      parts[family].push(g);
    },
    torus(family, x, y, z, radius, tube, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) {
      const g = new THREE.TorusGeometry(radius, tube, 6, 28, arc);
      apply(g, x, y, z, rx, ry, rz);
      parts[family].push(g);
    },
    cone(family, x, y, z, radius, h, segments = 12) {
      const g = new THREE.ConeGeometry(radius, h, segments);
      apply(g, x, y, z);
      parts[family].push(g);
    },
  };
}

function addTower(builder: HeroBuilder, height: number, width: number, antenna = true): void {
  builder.box('structure', 0, height * 0.34, 0, width, height * 0.68, width);
  builder.box('glass', 0, height * 0.72, 0, width * 1.3, height * 0.14, width * 1.3);
  builder.box('metal', 0, height * 0.83, 0, width * 1.45, 0.45, width * 1.45);
  if (antenna) builder.cylinder('metal', 0, height * 0.94, 0, 0.12, 0.18, height * 0.22, 8);
}

function addCrane(builder: HeroBuilder, height: number, span: number, damaged = false): void {
  builder.box('metal', -span * 0.32, height * 0.5, 0, 0.8, height, 0.8, 0, 0, damaged ? -0.12 : 0);
  builder.box('metal', span * 0.32, height * 0.5, 0, 0.8, height, 0.8, 0, 0, damaged ? 0.08 : 0);
  builder.box('structure', 0, height, 0, span, 0.8, 1.1, 0, 0, damaged ? -0.06 : 0);
  for (let i = -3; i <= 3; i += 1) builder.box('accent', i * span / 7, height + 0.08, 0.58, 0.16, 0.16, 0.08);
  builder.cylinder('metal', span * 0.1, height * 0.72, 0, 0.12, 0.12, height * 0.48, 8);
}

function addPagoda(builder: HeroBuilder, tiers: number, scale = 1): void {
  for (let i = 0; i < tiers; i += 1) {
    const width = (7.5 - i * 1.1) * scale;
    const y = i * 3.1 * scale;
    builder.box('structure', 0, y + 1.35 * scale, 0, width * 0.68, 2.7 * scale, width * 0.68);
    builder.box('metal', 0, y + 2.85 * scale, 0, width, 0.34 * scale, width, 0, 0, i % 2 === 0 ? 0.025 : -0.025);
    builder.cone('accent', 0, y + 3.18 * scale, 0, width * 0.73, 1.05 * scale, 4);
  }
  builder.cylinder('accent', 0, tiers * 3.1 * scale + 0.6, 0, 0.08, 0.12, 2.5 * scale, 8);
}

function addFortress(builder: HeroBuilder, burning = false): void {
  builder.box('structure', 0, 3, 0, 16, 6, 9);
  for (const x of [-6.5, 6.5]) {
    builder.cylinder('structure', x, 5.2, 0, 2.1, 2.5, 10.4, 10);
    builder.cone(burning ? 'accent' : 'metal', x, 11.4, 0, 2.6, 2.2, 10);
  }
  builder.box('metal', 0, 6.5, 4.7, 6, 0.7, 0.55);
}

function addOffset(
  builder: HeroBuilder,
  x: number,
  y: number,
  z: number,
  build: () => void,
): void {
  const starts: Record<HeroFamily, number> = {
    structure: builder.parts.structure.length,
    metal: builder.parts.metal.length,
    glass: builder.parts.glass.length,
    accent: builder.parts.accent.length,
  };
  build();
  for (const family of Object.keys(starts) as HeroFamily[]) {
    for (let i = starts[family]; i < builder.parts[family].length; i += 1) {
      builder.parts[family][i]?.translate(x, y, z);
    }
  }
}

function buildHeroGeometry(kind: StageLandmarkKind): Record<HeroFamily, THREE.BufferGeometry[]> {
  const b = heroBuilder();
  switch (kind) {
    case 'range-radar':
      addTower(b, 18, 4.5);
      b.cylinder('metal', 0, 20.6, 0, 0.28, 0.28, 3.5, 10, 0, 0.3);
      b.torus('accent', 0, 22.2, 0, 3.2, 0.18, Math.PI / 2, 0, 0);
      b.box('accent', 0, 22.2, 0, 6.4, 0.18, 0.16, 0, 0, 0.25);
      break;
    case 'container-crane': addCrane(b, 18, 18); b.box('structure', 0, 1.2, 3.5, 12, 2.4, 5); break;
    case 'harbor-crane': addCrane(b, 24, 24); b.box('metal', 7, 27, 0, 22, 0.6, 0.8, 0, 0, -0.12); break;
    case 'wrecked-port': addCrane(b, 21, 22, true); b.box('structure', -3, 1, 4, 15, 2, 5, 0, 0.25, 0.08); break;
    case 'palace-dome':
      b.box('structure', 0, 4, 0, 17, 8, 11);
      b.cylinder('glass', 0, 9.5, 0, 4.8, 5.8, 4.5, 20);
      b.cone('metal', 0, 14, 0, 5.4, 4.5, 20);
      for (const x of [-6.5, 6.5]) addOffset(b, x, 0, 0, () => addTower(b, 12, 2.4, false));
      break;
    case 'desert-gate':
      for (const x of [-7, 7]) addOffset(b, x, 0, 0, () => addTower(b, 20, 3.5, false));
      b.box('structure', 0, 16, 0, 17.5, 3, 3.4);
      b.box('accent', 0, 18, 1.8, 13, 0.55, 0.2);
      break;
    case 'hill-fortress': addFortress(b); break;
    case 'desert-rig':
      addTower(b, 17, 5);
      b.box('metal', 0, 15, 0, 18, 0.75, 1, 0, 0, -0.18);
      b.cylinder('metal', 6, 8, 0, 0.3, 0.3, 15, 8, 0, 0.18);
      break;
    case 'polar-array':
      addTower(b, 12, 4);
      for (const x of [-7, 0, 7]) {
        b.cylinder('metal', x, 3.5, 0, 0.18, 0.25, 7, 8);
        b.torus('glass', x, 7.4, 0, 2.5, 0.24, Math.PI / 2, 0, 0, Math.PI);
      }
      break;
    case 'refinery-stack':
    case 'slaughter-stack':
      for (const x of [-6, 0, 6]) {
        b.cylinder('structure', x, 10 + Math.abs(x) * 0.25, 0, 0.8, 1.4, 20 + Math.abs(x) * 0.5, 14);
        for (let y = 4; y < 20; y += 4) b.torus('metal', x, y, 0, 1.2, 0.12, Math.PI / 2);
      }
      b.box('metal', 0, 5, 0, 16, 0.5, 0.7);
      b.box('accent', 0, 10, 0, 16, 0.35, 0.5);
      break;
    case 'neon-spire': addTower(b, 32, 6); for (let y = 4; y < 30; y += 4) b.box('accent', 0, y, 3.08, 5.2, 0.18, 0.08); break;
    case 'rooftop-helipad':
      addTower(b, 19, 8, false);
      b.cylinder('structure', 0, 20.2, 0, 9, 9, 0.8, 24);
      b.torus('accent', 0, 20.65, 0, 5.2, 0.22, Math.PI / 2);
      b.box('accent', 0, 20.7, 0, 0.35, 0.12, 7);
      break;
    case 'quarry-conveyor':
      for (const x of [-8, 0, 8]) addOffset(b, x, 0, 0, () => addTower(b, 11 + (x === 0 ? 6 : 0), 3, false));
      b.box('metal', 0, 14, 0, 22, 1, 2.2, 0, 0, -0.16);
      break;
    case 'bamboo-pagoda': addPagoda(b, 5, 1); break;
    case 'onsen-pagoda': addPagoda(b, 4, 1.15); b.box('glass', 8, 3, 0, 8, 6, 7); break;
    case 'terrace-village':
      for (let i = 0; i < 5; i += 1) {
        b.box('structure', (i - 2) * 4.2, 1.3 + i * 1.4, i * 1.5, 3.5, 2.6, 3);
        b.cone('metal', (i - 2) * 4.2, 3.1 + i * 1.4, i * 1.5, 2.7, 1.6, 4);
      }
      break;
    case 'coastal-lighthouse':
      b.cylinder('structure', 0, 10, 0, 2.2, 3.5, 20, 16);
      b.cylinder('glass', 0, 21.5, 0, 3.1, 3.1, 3, 18);
      b.cone('metal', 0, 24.5, 0, 3.5, 3, 18);
      b.box('accent', 0, 22, 3.3, 0.25, 0.25, 5);
      break;
    case 'rail-terminal':
      b.box('structure', 0, 5, 0, 24, 10, 10);
      for (let x = -9; x <= 9; x += 6) b.torus('metal', x, 9.5, 0, 4.1, 0.3, 0, 0, 0, Math.PI);
      b.box('glass', 0, 6, 5.1, 18, 3, 0.2);
      break;
    case 'canyon-bridge':
      for (const x of [-10, 10]) addOffset(b, x, 0, 0, () => addTower(b, 18, 3.8, false));
      b.box('metal', 0, 13, 0, 26, 1.1, 3.2);
      for (let x = -8; x <= 8; x += 4) b.box('accent', x, 11, 1.7, 0.12, 4, 0.12, 0, 0, x * 0.012);
      break;
    case 'lakeside-observatory':
      b.box('structure', 0, 4, 0, 12, 8, 9);
      b.cylinder('glass', 0, 10, 0, 5.5, 6, 5, 24);
      b.torus('metal', 0, 12, 0, 5.8, 0.35, Math.PI / 2);
      b.box('metal', 0, 14, 0, 0.8, 7, 0.8, 0, 0, 0.55);
      break;
    case 'airport-control': addTower(b, 28, 5.5); b.box('glass', 0, 22, 0, 11, 4.5, 11); b.cylinder('accent', 0, 31, 0, 0.12, 0.12, 6, 8); break;
    case 'ruined-city': addTower(b, 25, 7); b.box('structure', 7, 8, 1, 8, 16, 7, 0, 0, 0.12); b.box('accent', -3, 17, 3.6, 4, 0.3, 0.2); break;
    case 'burning-block': addFortress(b, true); b.cone('accent', 0, 14, 0, 4, 9, 9); break;
    case 'ruined-cathedral':
      b.box('structure', 0, 6, 0, 17, 12, 10);
      for (const x of [-6, 0, 6]) b.torus('glass', x, 8, 5.1, 2.1, 0.25, 0, 0, 0, Math.PI);
      for (const x of [-7, 7]) addOffset(b, x, 0, 0, () => addTower(b, 20, 3.2, false));
      break;
    case 'lava-mine':
      addCrane(b, 17, 18, true);
      b.cylinder('structure', 0, 4, 4, 5, 7, 8, 14);
      b.torus('accent', 0, 8, 4, 5.1, 0.3, Math.PI / 2);
      break;
    case 'quarantine-gate':
      for (const x of [-8, 8]) addOffset(b, x, 0, 0, () => addTower(b, 17, 4, true));
      b.box('metal', 0, 13, 0, 20, 1.2, 2.2);
      b.box('accent', 0, 14, 1.2, 11, 0.55, 0.18);
      break;
    case 'subway-vault':
      b.box('structure', 0, 4, 0, 24, 8, 12);
      for (const x of [-8, 0, 8]) b.torus('metal', x, 4, 6.2, 3.5, 0.4, 0, 0, 0, Math.PI);
      b.box('accent', 0, 8.5, 6.3, 18, 0.35, 0.2);
      break;
    case 'broken-ferris-wheel':
      for (const x of [-4, 4]) b.box('metal', x, 9, 0, 0.7, 18, 0.7, 0, 0, x * 0.045);
      b.torus('structure', 0, 17, 0, 10, 0.45, 0, 0, 0, Math.PI * 1.65);
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 10) * Math.PI * 1.65;
        b.box('accent', Math.cos(a) * 10, 17 + Math.sin(a) * 10, 0, 0.7, 0.7, 0.7);
      }
      break;
    case 'volcano-fortress': addFortress(b, true); b.cone('structure', 0, -1.5, 0, 18, 16, 16); b.torus('accent', 0, 6.2, 0, 8, 0.35, Math.PI / 2); break;
    case 'training-tower': addTower(b, 16, 4); b.box('accent', 0, 12, 2.2, 3.2, 2.2, 0.18); break;
  }
  return b.parts;
}

function buildHeroLandmark(stage: StageDef, identity: StageVisualIdentity): THREE.Group {
  const root = new THREE.Group();
  root.name = `aaa:hero-landmark:${identity.landmark}`;
  root.userData.stageLandmark = identity.landmark;
  markObject(root);
  const parts = buildHeroGeometry(identity.landmark);
  const colors: Record<HeroFamily, THREE.Color> = {
    structure: shade(stage.palette.wall, -0.04, -0.04),
    metal: shade(stage.palette.obstacle, 0.04, -0.06),
    glass: shade(stage.palette.sky, -0.26, 0.08),
    accent: shade(stage.palette.accent, -0.02, 0.02),
  };
  const materials: Record<HeroFamily, () => THREE.MeshStandardMaterial> = {
    structure: () => new THREE.MeshStandardMaterial({ color: colors.structure, roughness: 0.86, metalness: 0.04 }),
    metal: () => new THREE.MeshStandardMaterial({ color: colors.metal, roughness: 0.55, metalness: 0.48 }),
    glass: () => new THREE.MeshStandardMaterial({ color: colors.glass, roughness: 0.24, metalness: 0.32, envMapIntensity: 0.45 }),
    accent: () => new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: stage.palette.emissiveAccent || identity.family === 'undead' || identity.family === 'geothermal' ? 0.28 : 0.06,
      roughness: 0.48,
      metalness: 0.2,
    }),
  };
  for (const family of Object.keys(parts) as HeroFamily[]) {
    const geos = parts[family];
    if (geos.length === 0) continue;
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[family]());
    mesh.name = `aaa:hero:${family}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    markObject(mesh, 0);
    root.add(mesh);
  }
  const angle = ((stage.seed * 0.61803398875) % 1) * Math.PI * 2;
  const radius = stage.size * 0.74;
  root.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  root.rotation.y = -angle + Math.PI / 2;
  root.scale.setScalar(stage.size < 240 ? 0.82 : 1);
  return root;
}

export function buildCinematicStageKit(options: CinematicStageKitOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:cinematic-stage-kit';
  markObject(root);
  const identity = resolveStageVisualIdentity(options.stage);
  const budget = BUDGETS[options.tier];
  const rand = mulberry32(options.stage.seed ^ 0x243f6a88);
  root.userData.stageVisualIdentity = identity;
  root.add(buildGroundRoutes(options.stage, identity.family, budget, options.boxes, rand));
  root.add(buildFacadeLayer(options.stage, identity.family, options.boxes, budget, rand));
  root.add(buildGroundingLayer(options.stage, identity.family, options.boxes, budget, rand));
  root.add(buildMacroRubble(options.stage, identity.family, options.boxes, options.propPlacements, budget.rubble, rand));
  root.add(buildDistantWorld(options.stage, identity.family, budget.skyline, rand));
  root.add(buildBoundaryInfrastructure(options.stage, identity.family, budget, rand));
  root.add(buildDistantStageMatte(options.stage, options.tier));
  root.add(buildHeroLandmark(options.stage, identity));
  root.add(buildCinematicEnvironment({
    stage: options.stage,
    tier: options.tier,
    family: identity.family,
    boxes: options.boxes,
  }));
  return root;
}
