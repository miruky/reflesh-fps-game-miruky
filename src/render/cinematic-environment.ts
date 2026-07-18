import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rand } from '../core/rng';
import type { GraphicsQuality } from '../core/settings';
import type { BoxSpec, StageDef } from '../game/stage';
import {
  markCinematicDetail,
  type CinematicDetailPriority,
} from './cinematic-detail';
import type { StageVisualFamily } from './cinematic-stage-kit';

/**
 * 参考ステージ群に共通する「自然物・水・ガラス・局所灯」を少数DCへ集約する。
 * 物理・AI・弾道へは一切触れず、全て静的な視覚オブジェクト。
 */

export type ScenicVegetation = 'none' | 'lush' | 'dry' | 'conifer' | 'dead';

export interface ScenicProfile {
  readonly vegetation: ScenicVegetation;
  readonly water: boolean;
  readonly glass: boolean;
  readonly rocks: boolean;
  readonly practicalLights: boolean;
}

export function resolveScenicProfile(
  stage: Pick<StageDef, 'id' | 'palette'>,
  family: StageVisualFamily,
): ScenicProfile {
  const grass = stage.palette.grassKind ?? 'none';
  const lush = grass === 'blade' || grass === 'reed';
  const undead = family === 'undead';
  const vegetation: ScenicVegetation =
    undead ? 'dead' :
      family === 'arctic' ? 'conifer' :
        lush || family === 'heritage' || family === 'urban' ? 'lush' :
          grass === 'dry' ||
          family === 'wilderness' ||
          family === 'geothermal' ||
          family === 'military' ||
          family === 'industrial' ||
          family === 'airport' ? 'dry' :
            'none';
  return {
    vegetation,
    water:
      grass === 'reed' ||
      stage.id === 'kouwan' ||
      stage.id === 'kohan' ||
      stage.id === 'onsengai' ||
      stage.id === 'z03' ||
      family === 'airport' ||
      stage.palette.mood === 'overcast',
    glass:
      family === 'heritage' ||
      family === 'urban' ||
      family === 'airport' ||
      family === 'military',
    rocks:
      family === 'wilderness' ||
      family === 'arctic' ||
      family === 'geothermal' ||
      family === 'military' ||
      family === 'airport' ||
      undead,
    practicalLights:
      stage.palette.mood === 'night' ||
      stage.palette.mood === 'dusk' ||
      undead ||
      family === 'industrial' ||
      family === 'airport',
  };
}

interface ScenicBudget {
  readonly trees: number;
  readonly rocks: number;
  readonly water: number;
  readonly glass: number;
  readonly lights: number;
}

const BUDGETS: Readonly<Record<GraphicsQuality, ScenicBudget>> = {
  low: { trees: 6, rocks: 10, water: 2, glass: 4, lights: 8 },
  medium: { trees: 18, rocks: 28, water: 6, glass: 14, lights: 24 },
  high: { trees: 36, rocks: 64, water: 12, glass: 28, lights: 52 },
};

export interface CinematicEnvironmentOptions {
  readonly stage: StageDef;
  readonly tier: GraphicsQuality;
  readonly family: StageVisualFamily;
  readonly boxes: readonly BoxSpec[];
}

function mark(
  object: THREE.Object3D,
  priority: CinematicDetailPriority,
): void {
  object.userData.cinematicEnvironment = true;
  markCinematicDetail(object, priority);
}

function shade(hex: string, lightnessDelta: number, saturationDelta = 0): THREE.Color {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(
    hsl.h,
    THREE.MathUtils.clamp(hsl.s + saturationDelta, 0, 1),
    THREE.MathUtils.clamp(hsl.l + lightnessDelta, 0.015, 0.9),
  );
  return color;
}

function matrix(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
  rx = 0,
  rz = 0,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

function groundOccupied(
  boxes: readonly BoxSpec[],
  x: number,
  z: number,
  margin: number,
): boolean {
  return boxes.some((box) => {
    if (box.ghost || box.decor) return false;
    if (box.y - box.h / 2 > 0.3) return false;
    return (
      Math.abs(x - box.x) < box.w / 2 + margin &&
      Math.abs(z - box.z) < box.d / 2 + margin
    );
  });
}

function scenicPoint(
  stage: StageDef,
  boxes: readonly BoxSpec[],
  rand: Rand,
  index: number,
  count: number,
  margin: number,
): THREE.Vector3 {
  const half = stage.size * 0.45;
  let x = 0;
  let z = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // 半数は中心寄り、半数は外周の背景フレームへ。どのスポーンでも自然物が画角に入る。
    if ((index & 1) === 0) {
      const angle = (index / Math.max(1, count)) * Math.PI * 2 + rand() * 0.45;
      const radius = stage.size * (0.2 + rand() * 0.18);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    } else {
      x = (rand() * 2 - 1) * half;
      z = (rand() * 2 - 1) * half;
    }
    if (!groundOccupied(boxes, x, z, margin)) break;
  }
  return new THREE.Vector3(x, 0, z);
}

function configure(
  mesh: THREE.InstancedMesh,
  priority: CinematicDetailPriority,
): THREE.InstancedMesh {
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mark(mesh, priority);
  return mesh;
}

function addScenicWind(
  mesh: THREE.InstancedMesh,
  material: THREE.MeshStandardMaterial,
): void {
  const time = { value: 0 };
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uScenicTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uScenicTime;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  float scenicPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
#else
  float scenicPhase = 0.0;
#endif
  float scenicCrown = smoothstep(-1.2, 1.8, position.y);
  float scenicWind = sin(uScenicTime * 0.72 + scenicPhase) * 0.035
                   + sin(uScenicTime * 1.31 + scenicPhase * 1.7) * 0.012;
  transformed.x += scenicWind * scenicCrown;
  transformed.z += scenicWind * scenicCrown * 0.42;`,
      );
  };
  material.customProgramCacheKey = (): string => 'hibana-scenic-wind-v1';
  mesh.onBeforeRender = (): void => {
    time.value = (performance.now() % 600_000) * 0.001;
  };
}

function addWaterRipples(
  mesh: THREE.InstancedMesh,
  material: THREE.MeshStandardMaterial,
): void {
  const time = { value: 0 };
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uScenicWaterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vScenicWaterPos;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvScenicWaterPos = position.xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uScenicWaterTime;\nvarying vec2 vScenicWaterPos;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float scenicWaveA = sin(vScenicWaterPos.x * 8.0 + uScenicWaterTime * 0.82);
float scenicWaveB = sin((vScenicWaterPos.x + vScenicWaterPos.y) * 11.0 - uScenicWaterTime * 0.57);
float scenicRipple = scenicWaveA * 0.5 + scenicWaveB * 0.5;
diffuseColor.rgb *= 0.965 + scenicRipple * 0.035;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + scenicRipple * 0.035, 0.08, 0.28);',
      );
  };
  material.customProgramCacheKey = (): string => 'hibana-scenic-water-ripple-v1';
  mesh.onBeforeRender = (): void => {
    time.value = (performance.now() % 600_000) * 0.001;
  };
}

function treeTrunkGeometry(dead: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.36, 4.8, 14, 4);
  trunk.translate(0, 2.4, 0);
  parts.push(trunk);
  const branchCount = dead ? 5 : 3;
  for (let i = 0; i < branchCount; i += 1) {
    const length = dead ? 2.4 - i * 0.18 : 1.35 - i * 0.12;
    const branch = new THREE.CylinderGeometry(0.06, 0.14, length, 9, 2);
    branch.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((i % 2 === 0 ? -1 : 1) * 0.36, 3.1 + i * 0.28, (i % 3 - 1) * 0.24),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 * i, i * 1.7, (i % 2 === 0 ? -1 : 1) * 0.92)),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(branch);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('failed to merge cinematic tree');
  merged.computeVertexNormals();
  return merged;
}

function treeCrownGeometry(kind: Exclude<ScenicVegetation, 'none' | 'dead'>): THREE.BufferGeometry {
  if (kind === 'conifer') return new THREE.ConeGeometry(1.9, 4.6, 16, 5);
  const parts: THREE.BufferGeometry[] = [];
  const clusterCount = kind === 'lush' ? 7 : 5;
  for (let i = 0; i < clusterCount; i += 1) {
    const angle = (i / clusterCount) * Math.PI * 2;
    const radius = i === 0 ? 0 : kind === 'lush' ? 0.58 : 0.72;
    const crown = new THREE.IcosahedronGeometry(1, 2);
    crown.applyMatrix4(matrix(
      Math.cos(angle) * radius,
      i === 0 ? 0.25 : (i & 1) === 0 ? 0.18 : -0.08,
      Math.sin(angle) * radius,
      i === 0 ? 1.18 : 0.88,
      i === 0 ? 1.05 : kind === 'lush' ? 0.78 : 0.62,
      i === 0 ? 1.12 : 0.9,
      angle * 0.37,
    ));
    parts.push(crown);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('failed to merge cinematic tree crown');
  // 同じ頂点数のまま球状クラスターの輪郭を崩す。規則的な丸い塊ではなく、枝ごとに
  // 張り出しが異なる樹冠へし、遠距離でもジオラマのトピアリー感を抑える。
  const position = merged.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const radialWarp = 1 + Math.sin(x * 3.71 + y * 2.13 + z * 4.07) * 0.055;
    const verticalWarp = 1 + Math.sin(x * 2.31 - z * 3.19 + y * 1.73) * 0.035;
    position.setXYZ(i, x * radialWarp, y * verticalWarp, z * radialWarp);
  }
  position.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

function buildVegetation(
  options: CinematicEnvironmentOptions,
  profile: ScenicProfile,
  budget: ScenicBudget,
  rand: Rand,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:scenic-vegetation';
  mark(root, 0);
  if (profile.vegetation === 'none' || budget.trees <= 0) return root;

  const dead = profile.vegetation === 'dead';
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
  });
  const trunks = new THREE.InstancedMesh(treeTrunkGeometry(dead), trunkMaterial, budget.trees);
  trunks.name = dead ? 'aaa:dead-tree-silhouettes' : 'aaa:tree-trunks';
  trunks.castShadow = options.tier === 'high';
  trunks.receiveShadow = true;

  const crownGeometry = dead
    ? new THREE.IcosahedronGeometry(1, 0)
    : treeCrownGeometry(profile.vegetation as Exclude<ScenicVegetation, 'none' | 'dead'>);
  const crowns = dead
    ? null
    : new THREE.InstancedMesh(
      crownGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0,
      }),
      budget.trees,
    );
  if (crowns) {
    crowns.name = profile.vegetation === 'conifer' ? 'aaa:snow-conifer-crowns' : 'aaa:tree-canopies';
    crowns.castShadow = false;
    crowns.receiveShadow = true;
    addScenicWind(crowns, crowns.material as THREE.MeshStandardMaterial);
  } else {
    crownGeometry.dispose();
  }

  const trunkBase =
    profile.vegetation === 'dead'
      ? new THREE.Color(0x24201c)
      : profile.vegetation === 'dry'
        ? new THREE.Color(0x5b472f)
        : new THREE.Color(0x3c3024);
  const crownBase =
    profile.vegetation === 'conifer'
      ? new THREE.Color(0x29423d)
      : profile.vegetation === 'dry'
        ? new THREE.Color(0x6c7040)
        : new THREE.Color(0x285438);

  for (let i = 0; i < budget.trees; i += 1) {
    const p = scenicPoint(options.stage, options.boxes, rand, i, budget.trees, dead ? 0.7 : 1.4);
    const height = dead ? 0.75 + rand() * 1.1 : 0.72 + rand() * 0.95;
    const width = 0.72 + rand() * 0.55;
    const yaw = rand() * Math.PI * 2;
    trunks.setMatrixAt(i, matrix(p.x, 0, p.z, width, height, width, yaw, 0, (rand() - 0.5) * 0.08));
    trunks.setColorAt(i, trunkBase.clone().multiplyScalar(0.7 + rand() * 0.42));
    if (crowns) {
      const crownY = profile.vegetation === 'conifer' ? 4.2 * height : 4.5 * height;
      const crownW = (profile.vegetation === 'conifer' ? 1.15 : 1.8) * width;
      crowns.setMatrixAt(
        i,
        matrix(
          p.x,
          crownY,
          p.z,
          crownW * (0.82 + rand() * 0.35),
          (profile.vegetation === 'conifer' ? 1.25 : 1.4) * height,
          crownW * (0.82 + rand() * 0.35),
          yaw,
          (rand() - 0.5) * 0.12,
        ),
      );
      const crownColor = crownBase.clone().multiplyScalar(0.62 + rand() * 0.48);
      if (profile.vegetation === 'conifer' && (i & 3) === 0) crownColor.lerp(new THREE.Color(0xb5c5c9), 0.32);
      crowns.setColorAt(i, crownColor);
    }
  }
  root.add(configure(trunks, 0));
  if (crowns) root.add(configure(crowns, 1));
  return root;
}

function buildRocks(
  options: CinematicEnvironmentOptions,
  profile: ScenicProfile,
  budget: ScenicBudget,
  rand: Rand,
): THREE.InstancedMesh | null {
  if (!profile.rocks || budget.rocks <= 0) return null;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, metalness: 0 }),
    budget.rocks,
  );
  mesh.name = 'aaa:scenic-boulders';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const base =
    options.family === 'geothermal'
      ? new THREE.Color(0x211d1c)
      : shade(options.stage.palette.obstacle, -0.12, -0.08);
  for (let i = 0; i < budget.rocks; i += 1) {
    const p = scenicPoint(options.stage, options.boxes, rand, i + 73, budget.rocks, 0.4);
    const r = 0.35 + rand() ** 1.7 * 2.2;
    mesh.setMatrixAt(
      i,
      matrix(
        p.x,
        r * 0.32,
        p.z,
        r * (0.75 + rand() * 0.7),
        r * (0.42 + rand() * 0.55),
        r * (0.72 + rand() * 0.75),
        rand() * Math.PI,
        rand() * 0.4,
        rand() * 0.35,
      ),
    );
    mesh.setColorAt(i, base.clone().multiplyScalar(0.58 + rand() * 0.54));
  }
  return configure(mesh, 2);
}

function facadeCandidates(boxes: readonly BoxSpec[]): BoxSpec[] {
  return boxes
    .filter((box) => !box.ghost && !box.decor && !box.prop && box.h >= 4 && Math.max(box.w, box.d) >= 7)
    .sort((a, b) => b.h * Math.max(b.w, b.d) - a.h * Math.max(a.w, a.d));
}

function buildGlassAndLights(
  options: CinematicEnvironmentOptions,
  profile: ScenicProfile,
  budget: ScenicBudget,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:glass-and-practical-lighting';
  mark(root, 1);
  const candidates = facadeCandidates(options.boxes);

  if (profile.glass && candidates.length > 0) {
    const count = Math.min(budget.glass, candidates.length * 2);
    const glass = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x9dbdcb,
        roughness: 0.12,
        metalness: 0.35,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        envMapIntensity: 0.7,
      }),
      count,
    );
    glass.name = 'aaa:glass-skylights-and-canopies';
    glass.castShadow = false;
    glass.receiveShadow = true;
    for (let i = 0; i < count; i += 1) {
      const box = candidates[i % candidates.length]!;
      const longX = box.w >= box.d;
      const top = box.y + box.h / 2;
      const along = ((i & 1) === 0 ? -0.22 : 0.22) * (longX ? box.w : box.d);
      const x = box.x + (longX ? along : 0);
      const z = box.z + (longX ? 0 : along);
      glass.setMatrixAt(
        i,
        matrix(
          x,
          top + 0.32,
          z,
          longX ? Math.min(6, box.w * 0.34) : Math.min(3.5, box.w * 0.7),
          0.08,
          longX ? Math.min(3.5, box.d * 0.7) : Math.min(6, box.d * 0.34),
          0,
          (i & 1) === 0 ? 0.12 : -0.12,
        ),
      );
    }
    root.add(configure(glass, 1));
  }

  if (profile.practicalLights && candidates.length > 0) {
    const count = Math.min(budget.lights, candidates.length * 4);
    const color = shade(options.stage.palette.accent, 0.08, 0.04);
    const lights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.52,
        roughness: 0.42,
        metalness: 0.08,
      }),
      count,
    );
    lights.name = 'aaa:architectural-practical-lights';
    lights.castShadow = false;
    lights.receiveShadow = false;
    for (let i = 0; i < count; i += 1) {
      const box = candidates[i % candidates.length]!;
      const longX = box.w >= box.d;
      const long = longX ? box.w : box.d;
      const u = ((i % 4) + 0.5) / 4 - 0.5;
      const side = ((i + options.stage.seed) & 1) === 0 ? 1 : -1;
      lights.setMatrixAt(
        i,
        longX
          ? matrix(box.x + u * long * 0.75, box.y, box.z + side * (box.d / 2 + 0.08), 0.42, 0.12, 0.05)
          : matrix(box.x + side * (box.w / 2 + 0.08), box.y, box.z + u * long * 0.75, 0.05, 0.12, 0.42),
      );
    }
    root.add(configure(lights, 1));
  }
  return root;
}

function buildWater(
  options: CinematicEnvironmentOptions,
  profile: ScenicProfile,
  budget: ScenicBudget,
  rand: Rand,
): THREE.InstancedMesh | null {
  if (!profile.water || budget.water <= 0) return null;
  const geometry = new THREE.CircleGeometry(1, 32);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
      color: shade(options.stage.palette.sky, -0.32, 0.08),
      roughness: 0.16,
      metalness: 0.22,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -3,
    });
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    budget.water,
  );
  addWaterRipples(mesh, material);
  mesh.name = 'aaa:reflective-water-and-puddles';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  for (let i = 0; i < budget.water; i += 1) {
    const p = scenicPoint(options.stage, options.boxes, rand, i + 191, budget.water, 0.8);
    const radius = 1.4 + rand() * (options.family === 'wilderness' || options.stage.id === 'kohan' ? 5.5 : 2.8);
    mesh.setMatrixAt(
      i,
      matrix(p.x, 0.025 + i * 0.00002, p.z, radius * (0.7 + rand() * 0.75), 1, radius, rand() * Math.PI),
    );
  }
  return configure(mesh, 1);
}

export function buildCinematicEnvironment(
  options: CinematicEnvironmentOptions,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:cinematic-environment';
  mark(root, 0);
  const profile = resolveScenicProfile(options.stage, options.family);
  const budget = BUDGETS[options.tier];
  const rand = mulberry32(options.stage.seed ^ 0xbb67ae85);
  root.add(buildVegetation(options, profile, budget, rand));
  const rocks = buildRocks(options, profile, budget, rand);
  if (rocks) root.add(rocks);
  root.add(buildGlassAndLights(options, profile, budget));
  const water = buildWater(options, profile, budget, rand);
  if (water) root.add(water);
  return root;
}
