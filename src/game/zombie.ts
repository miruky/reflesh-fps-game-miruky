// BO2式ラウンド制ゾンビモードの純粋な進行曲線とディレクタ定数。
// 描画・物理・状態には依存しない(match.ts が唯一の状態保持者=単体テスト可能)。

// 同時生存できるゾンビの上限。描画/物理予算を守るための tier 連動クランプ。
// InstancedMesh 化が困難なため、この上限 + 距離LOD + 近接影のみで多数描画を軽量化する。
export type ZombieTierCapKey = 'low' | 'medium' | 'high';
export const ZOMBIE_MAX_ALIVE: Record<ZombieTierCapKey, number> = {
  low: 14,
  medium: 20,
  high: 24,
};

// ラウンド r で湧く総数。r1≈8 / r10≈32 / r20≈80(上限90でTTK壁を防ぐ)。
// count と速度でプレッシャーを掛ける方針(HPは緩やかにしか上げない)。
export function zombieTotal(r: number): number {
  return Math.min(90, Math.round(6 + r * 1.5 + r * r * 0.11));
}

// ラウンド r の1体あたりHP。1〜9は線形(40→104)、以降は緩やかな指数(×1.07/round)。
// ユーザー要件「HPは少しだけ上がる」に沿ってBO2の弾スポンジ化を避け、上限600でクランプ。
export function zombieHp(r: number): number {
  if (r <= 9) return 40 + (r - 1) * 8;
  return Math.min(600, Math.round((40 + 8 * 8) * Math.pow(1.07, r - 9)));
}

// 走行(全力疾走)個体の出現率。序盤は歩き主体、後半ほど走りが増える。上限0.9。
export function zombieRunRate(r: number): number {
  return Math.min(0.9, 0.1 + r * 0.045);
}

// elite(高HP/俊敏)個体の出現率。r5 から 15%。
export function zombieEliteRate(r: number): number {
  return r >= 5 ? 0.15 : 0;
}

// 1体ごとのドリップ湧き間隔(秒)。後半ほど詰まるが下限0.6で同時湧きの洪水を防ぐ。
export function zombieSpawnGap(r: number): number {
  return Math.max(0.6, 1.8 - r * 0.09);
}
