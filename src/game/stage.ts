import { mulberry32 } from '../core/rng';

export interface StagePalette {
  sky: string;
  fog: string;
  floor: string;
  wall: string;
  obstacle: string;
  accent: string;
  lightColor: string;
  lightIntensity: number;
  ambientIntensity: number;
  fogDensity: number;
  emissiveAccent: boolean;
}

export interface StageDef {
  id: string;
  name: string;
  subtitle: string;
  seed: number;
  size: number;
  obstacleCount: number;
  maxHeight: number;
  botCount: number;
  palette: StagePalette;
}

export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  emissive: boolean;
}

export type SpawnPoint = [number, number, number];

export interface StageLayout {
  boxes: BoxSpec[];
  playerSpawns: SpawnPoint[];
  botSpawns: SpawnPoint[];
}

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function overlaps(a: Aabb, b: Aabb, margin: number): boolean {
  return (
    a.minX - margin < b.maxX &&
    a.maxX + margin > b.minX &&
    a.minZ - margin < b.maxZ &&
    a.maxZ + margin > b.minZ
  );
}

function aabbOf(x: number, z: number, w: number, d: number): Aabb {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

const SPAWN_CLEARANCE = 6;
const GRID = 2;

// シードから決定論的にレイアウトを生成する。障害物は原点対称に複製し、
// 対戦時にどのスポーンからも地形条件が同じになるようにする。
export function generateStage(def: StageDef): StageLayout {
  const rand = mulberry32(def.seed);
  const half = def.size / 2;
  const wallHeight = Math.max(5, def.maxHeight + 2.5);
  const boxes: BoxSpec[] = [];
  const placed: Aabb[] = [];

  const walls: Array<[number, number, number, number]> = [
    [0, -half - 0.5, def.size + 2, 1],
    [0, half + 0.5, def.size + 2, 1],
    [-half - 0.5, 0, 1, def.size + 2],
    [half + 0.5, 0, 1, def.size + 2],
  ];
  for (const [x, z, w, d] of walls) {
    boxes.push({ x, y: wallHeight / 2, z, w, h: wallHeight, d, color: def.palette.wall, emissive: false });
  }

  const corners: SpawnPoint[] = [
    [half - 4, 0, half - 4],
    [-(half - 4), 0, half - 4],
    [half - 4, 0, -(half - 4)],
    [-(half - 4), 0, -(half - 4)],
  ];

  let attempts = 0;
  while (placed.length < def.obstacleCount && attempts < def.obstacleCount * 30) {
    attempts += 1;
    const x = Math.round(((rand() * 2 - 1) * (half - 5)) / GRID) * GRID;
    const z = Math.round(((rand() * 2 - 1) * (half - 5)) / GRID) * GRID;
    const w = Math.round(2 + rand() * 5);
    const d = Math.round(2 + rand() * 5);
    const low = rand() < 0.3;
    const h = low ? 1 + rand() * 0.3 : 1.8 + rand() * (def.maxHeight - 1.8);

    const nearSpawn = corners.some(
      ([sx, , sz]) => Math.hypot(x - sx, z - sz) < SPAWN_CLEARANCE,
    );
    if (nearSpawn) continue;

    const box = aabbOf(x, z, w, d);
    if (placed.some((p) => overlaps(p, box, 1))) continue;

    const accent = rand() < 0.18;
    const color = accent ? def.palette.accent : def.palette.obstacle;
    boxes.push({ x, y: h / 2, z, w, h, d, color, emissive: accent && def.palette.emissiveAccent });
    placed.push(box);

    // 原点対称の複製。原点上や複製先が重なる場合は単体配置のままにする
    const mirror = aabbOf(-x, -z, w, d);
    const mirrorNearSpawn = corners.some(
      ([sx, , sz]) => Math.hypot(-x - sx, -z - sz) < SPAWN_CLEARANCE,
    );
    if ((x !== 0 || z !== 0) && !mirrorNearSpawn && !placed.some((p) => overlaps(p, mirror, 1))) {
      boxes.push({
        x: -x,
        y: h / 2,
        z: -z,
        w,
        h,
        d,
        color,
        emissive: accent && def.palette.emissiveAccent,
      });
      placed.push(mirror);
    }
  }

  const edge = half - 4;
  const botSpawns: SpawnPoint[] = [
    [0, 0, edge],
    [0, 0, -edge],
    [edge, 0, 0],
    [-edge, 0, 0],
    [edge / 2, 0, -edge / 2],
    [-edge / 2, 0, edge / 2],
  ];

  return { boxes, playerSpawns: corners, botSpawns };
}
