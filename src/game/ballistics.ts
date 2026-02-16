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
export type HitPart = typeof HEAD | typeof BODY;

export function partMultiplier(part: HitPart, headshotMultiplier: number): number {
  return part === HEAD ? headshotMultiplier : 1;
}
