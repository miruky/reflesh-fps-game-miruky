import type { Rand } from '../core/rng';

export interface Falloff {
  // startまでは基礎ダメージ満額、endでminFactor倍まで線形に減衰する
  start: number;
  end: number;
  minFactor: number;
}

export function damageAtDistance(base: number, distance: number, falloff: Falloff): number {
  if (distance <= falloff.start) return base;
  if (distance >= falloff.end) return base * falloff.minFactor;
  const t = (distance - falloff.start) / (falloff.end - falloff.start);
  return base * (1 - t * (1 - falloff.minFactor));
}

export interface ConeOffset {
  yaw: number;
  pitch: number;
}

// 円錐内で一様分布になるよう半径にsqrtをかける
export function coneOffset(spreadRad: number, rand: Rand): ConeOffset {
  const r = spreadRad * Math.sqrt(rand());
  const theta = rand() * Math.PI * 2;
  return { yaw: Math.cos(theta) * r, pitch: Math.sin(theta) * r };
}

export const HEAD = 'head';
export const BODY = 'body';
export const LIMB = 'limb';
export type HitPart = typeof HEAD | typeof BODY | typeof LIMB;

const LIMB_MULTIPLIER = 0.8;

export function partMultiplier(part: HitPart, headshotMultiplier: number): number {
  if (part === HEAD) return headshotMultiplier;
  if (part === LIMB) return LIMB_MULTIPLIER;
  return 1;
}

// 胴体カプセルへの着弾高さから部位を割り出す。腰より下は脚部扱い。
// relativeYはカプセル中心からの高さ
export function partFromHitHeight(relativeY: number, hipOffset: number): HitPart {
  return relativeY < hipOffset ? LIMB : BODY;
}

// 壁貫通後の残存ダメージ係数。powerMは貫通可能な壁の最大厚(m)。
// 貫通できても3割は必ず失い、厚みに比例してさらに減衰する
export function penetrationFactor(thicknessM: number, powerM: number): number {
  if (powerM <= 0 || thicknessM < 0) return 0;
  if (thicknessM >= powerM) return 0;
  return (1 - thicknessM / powerM) * 0.7;
}
