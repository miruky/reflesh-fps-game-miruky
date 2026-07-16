import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rand } from '../core/rng';
import type { GraphicsQuality } from '../core/settings';
import type { BoxSpec, PropPlacement, StagePalette } from '../game/stage';
import { markCinematicDetail } from './cinematic-detail';

interface DressingBudget {
  readonly debris: number;
  readonly shards: number;
  readonly stains: number;
  readonly cables: number;
}

const BUDGETS: Record<GraphicsQuality, DressingBudget> = {
  low: { debris: 48, shards: 12, stains: 4, cables: 0 },
  medium: { debris: 180, shards: 48, stains: 10, cables: 4 },
  high: { debris: 420, shards: 108, stains: 20, cables: 10 },
};

export interface CinematicSetDressingOptions {
  readonly size: number;
  readonly seed: number;
  readonly tier: GraphicsQuality;
  readonly palette: StagePalette;
  readonly boxes: readonly BoxSpec[];
  readonly propPlacements: readonly PropPlacement[];
}

function groundBoxContains(box: BoxSpec, x: number, z: number, margin: number): boolean {
  if (box.ghost || box.decor) return false;
  // 地上から大きく離れた梁・屋根の下には小物を置ける。接地遮蔽物だけを避ける。
  if (box.y - box.h / 2 > 0.25) return false;
  return (
    Math.abs(x - box.x) < box.w / 2 + margin &&
    Math.abs(z - box.z) < box.d / 2 + margin
  );
}

function randomGroundPoint(
  rand: Rand,
  size: number,
  boxes: readonly BoxSpec[],
  margin: number,
): THREE.Vector3 {
  const half = size * 0.48;
  let x = 0;
  let z = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    x = (rand() * 2 - 1) * half;
    z = (rand() * 2 - 1) * half;
    if (!boxes.some((box) => groundBoxContains(box, x, z, margin))) break;
  }
  return new THREE.Vector3(x, 0, z);
}

function propBiasedPoint(
  rand: Rand,
  size: number,
  boxes: readonly BoxSpec[],
  props: readonly PropPlacement[],
  index: number,
): THREE.Vector3 {
  // 物語性のある密度を作るため約55%を既存プロップ周辺へ寄せる。プロップ無しは均等配置。
  if (props.length > 0 && rand() < 0.55) {
    const anchor = props[index % props.length];
    if (anchor) {
      const radius = 0.45 + rand() * 2.4;
      const angle = rand() * Math.PI * 2;
      return new THREE.Vector3(
        anchor.cx + Math.cos(angle) * radius,
        0,
        anchor.cz + Math.sin(angle) * radius,
      );
    }
  }
  return randomGroundPoint(rand, size, boxes, 0.18);
}

function colorVariation(base: THREE.Color, rand: Rand, min = 0.55, max = 1.05): THREE.Color {
  return base.clone().multiplyScalar(THREE.MathUtils.lerp(min, max, rand()));
}

function buildDebris(
  budget: number,
  rand: Rand,
  options: CinematicSetDressingOptions,
): THREE.InstancedMesh {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const pos = geometry.getAttribute('position');
  // 正規化された岩を非対称化。同一メッシュでもランダム回転・非一様scaleで反復感を隠す。
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const warp = 0.82 + (((i * 37 + options.seed) >>> 0) % 19) / 60;
    pos.setXYZ(i, x * warp, y * (0.55 + warp * 0.24), z * (1.12 - warp * 0.14));
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, budget);
  mesh.name = 'aaa:micro-debris';
  mesh.userData.cinematicSetDressing = true;
  markCinematicDetail(mesh, 2);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const base = new THREE.Color(options.palette.obstacle).lerp(new THREE.Color(options.palette.floor), 0.5);
  for (let i = 0; i < budget; i += 1) {
    const p = propBiasedPoint(rand, options.size, options.boxes, options.propPlacements, i);
    const radius = 0.025 + rand() ** 2 * 0.19;
    p.y = radius * (0.36 + rand() * 0.18);
    euler.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI);
    q.setFromEuler(euler);
    scale.set(radius * (0.65 + rand()), radius * (0.45 + rand() * 0.65), radius * (0.65 + rand()));
    matrix.compose(p, q, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, colorVariation(base, rand));
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildShards(
  budget: number,
  rand: Rand,
  options: CinematicSetDressingOptions,
): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, budget);
  mesh.name = 'aaa:ground-shards';
  mesh.userData.cinematicSetDressing = true;
  markCinematicDetail(mesh, 3);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const paper = new THREE.Color(options.palette.wall).lerp(new THREE.Color(0x4c4a45), 0.55);
  for (let i = 0; i < budget; i += 1) {
    const p = propBiasedPoint(rand, options.size, options.boxes, options.propPlacements, i + 131);
    p.y = 0.016 + rand() * 0.012;
    euler.set((rand() - 0.5) * 0.16, rand() * Math.PI * 2, (rand() - 0.5) * 0.16);
    q.setFromEuler(euler);
    const long = 0.05 + rand() * 0.24;
    scale.set(long * (0.25 + rand() * 0.65), 1, long);
    matrix.compose(p, q, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, colorVariation(paper, rand, 0.65, 1.12));
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildStains(
  budget: number,
  rand: Rand,
  options: CinematicSetDressingOptions,
): THREE.InstancedMesh {
  const geometry = new THREE.CircleGeometry(1, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.palette.floor).multiplyScalar(0.25),
    roughness: options.palette.mood === 'overcast' || options.palette.mood === 'night' ? 0.12 : 0.78,
    metalness: 0.04,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, budget);
  mesh.name = 'aaa:stains-and-puddles';
  mesh.userData.cinematicSetDressing = true;
  markCinematicDetail(mesh, 2);
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let i = 0; i < budget; i += 1) {
    const p = randomGroundPoint(rand, options.size, options.boxes, 0.4);
    p.y = 0.012 + i * 0.00001;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const radius = 0.35 + rand() * 1.35;
    scale.set(radius * (0.45 + rand() * 0.8), 1, radius);
    matrix.compose(p, q, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildCables(
  budget: number,
  rand: Rand,
  options: CinematicSetDressingOptions,
): THREE.Mesh | null {
  if (budget <= 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < budget; i += 1) {
    const origin = propBiasedPoint(rand, options.size, options.boxes, options.propPlacements, i + 313);
    const length = 2.5 + rand() * 6.5;
    const angle = rand() * Math.PI * 2;
    const rightX = Math.cos(angle + Math.PI / 2);
    const rightZ = Math.sin(angle + Math.PI / 2);
    const points: THREE.Vector3[] = [];
    for (let p = 0; p < 5; p += 1) {
      const t = p / 4;
      const bow = Math.sin(t * Math.PI) * (rand() - 0.5) * length * 0.2;
      points.push(new THREE.Vector3(
        origin.x + Math.cos(angle) * length * (t - 0.5) + rightX * bow,
        0.028 + Math.sin(t * Math.PI) * 0.012,
        origin.z + Math.sin(angle) * length * (t - 0.5) + rightZ * bow,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    parts.push(new THREE.TubeGeometry(curve, 16, 0.012 + rand() * 0.012, 5, false));
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) return null;
  const material = new THREE.MeshStandardMaterial({
    color: 0x111315,
    roughness: 0.66,
    metalness: 0.18,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'aaa:ground-cables';
  mesh.userData.cinematicSetDressing = true;
  markCinematicDetail(mesh, 3);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 3〜4 draw callだけで、地面の「何もないCG平面」を瓦礫・紙片・染み・ケーブルへ分解する。
 * 物理コライダーを一切作らないため、移動・BOTナビ・弾道の決定論には影響しない。
 */
export function buildCinematicSetDressing(options: CinematicSetDressingOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = 'aaa:cinematic-set-dressing';
  root.userData.cinematicSetDressing = true;
  const budget = BUDGETS[options.tier];
  const rand = mulberry32(options.seed ^ 0x6a09e667);
  root.add(buildDebris(budget.debris, rand, options));
  root.add(buildShards(budget.shards, rand, options));
  root.add(buildStains(budget.stains, rand, options));
  const cables = buildCables(budget.cables, rand, options);
  if (cables) root.add(cables);
  return root;
}
