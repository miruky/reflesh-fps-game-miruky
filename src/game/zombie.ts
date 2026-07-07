// BO2式ラウンド制ゾンビモードの純粋な進行曲線とディレクタ定数。
// 描画・物理・状態には依存しない(match.ts が唯一の状態保持者=単体テスト可能)。

// 同時生存できるゾンビの上限。描画/物理予算を守るための tier 連動クランプ。
// InstancedMesh 化が困難なため、この上限 + 距離LOD + 近接影のみで多数描画を軽量化する。
export type ZombieTierCapKey = 'low' | 'medium' | 'high';
export const ZOMBIE_MAX_ALIVE: Record<ZombieTierCapKey, number> = {
  low: 40 /* V32: match側のtier保護と一致(54は実効しない死値だった) */,
  medium: 84,
  high: 108,
};

// ラウンド r で湧く総数。r1≈32 / r10≈134(上限270でTTK壁を防ぐ)。
// 大増員対応: 全係数×3(旧 8.4/2.1/0.154 → 25.2/6.3/0.462)。
// count と速度でプレッシャーを掛ける方針(HPは緩やかにしか上げない)。
export function zombieTotal(r: number): number {
  return Math.min(270, Math.round(25.2 + r * 6.3 + r * r * 0.462));
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

// ─── ボス曲線(5ラウンドごとに1体出現) ────────────────────────────────────────

/** r が 5 の倍数(r>0)のときボスラウンド */
export function isBossRound(r: number): boolean {
  return r > 0 && r % 5 === 0;
}

/**
 * ボスのHP。r5=3000/r10=7000/r15=14000/r20=26000/以降×1.5毎5ラウンド、上限80000。
 * R35付近で上限に到達。実用DPSで2〜4分で撃破できる水準(序盤 r5/r10 は従来値を維持)。
 */
export function zombieBossHp(r: number): number {
  const tier = Math.floor(r / 5);
  if (tier <= 0) return 3000;
  const base = [0, 3000, 7000, 14000, 26000] as const;
  if (tier <= 4) return base[tier] ?? 3000;
  // r20超: 26000 × 1.5^(tier-4)、上限80000
  const steps = tier - 4;
  return Math.min(80000, Math.round(26000 * Math.pow(1.5, steps)));
}

/**
 * ボスの移動速度倍率(ZOMBIE_MOVE_MUL への係数)。r5=1.2→上限2.0。
 */
export function zombieBossSpeedMul(r: number): number {
  const tier = Math.floor(r / 5);
  return Math.min(2.0, 1.2 + (tier - 1) * 0.1);
}

/**
 * ボスの近接ダメージ。r5=45→上限90。
 */
export function zombieBossDamage(r: number): number {
  const tier = Math.floor(r / 5);
  return Math.min(90, 45 + (tier - 1) * 6);
}
