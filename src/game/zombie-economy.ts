// BO2ゾンビモード経済の純ロジックコア。three / rapier / DOM 依存なし。
// match.ts への配線は後続タスクが行う。
//
// 配線ポイント候補 (match 側):
//   - killEnemy(kind) → calcKillPoints(kind) でポイント加算
//   - openShop(slot) → buyResult / purchasePerk を呼んで残高更新・パーク適用
//   - rollBox()      → rollMysteryBox(Math.random) → weaponId で武器切替、boxMoves で箱座標更新
//   - ステージ開始   → generateShopLayout(stage.seed) → スロット番号ごとに 3D 座標を割り当て

import { PRIMARY_IDS } from './weapons';

// ─── ポイント定数(BO2準拠) ──────────────────────────────────────────────────

/** キル/ヒット時ポイント加算の基準値 */
export const POINTS = {
  /** 命中ごと +10 */
  hit: 10,
  /** 通常キル: 最終ヒット10 + ボーナス50 = 60 */
  kill: 60,
  /** ヘッドショットキル: 10 + HS ボーナス100 = 110 */
  hskill: 110,
  /** 近接(ナイフ/クナイ)キル +130 */
  melee: 130,
} as const;

/** ミステリーボックス使用コスト */
export const MYSTERY_BOX_COST = 950;
/** ハズレで箱が移動する確率(〜8%) */
export const BOX_MOVES_CHANCE = 0.08;
/** パーク同時所持上限 */
export const PERK_LIMIT = 4;

// ─── パーク定義 ───────────────────────────────────────────────────────────────

export type ZombiePerkId =
  | 'juggernog'
  | 'speed-cola'
  | 'double-tap'
  | 'stamin-up'
  | 'quick-revive';

/** パーク適用時の効果値。未指定フィールドはデフォルト値から変更しない */
export interface PerkEffect {
  /** 最大HP倍率。juggernog: 2.5 (100→250) */
  maxHpMultiplier?: number;
  /** リロード時間倍率。speed-cola: 0.5 */
  reloadMultiplier?: number;
  /** 発射レート倍率。double-tap: 1.33 (+33%) */
  fireRateMultiplier?: number;
  /** 弾ダメージ倍率。double-tap: 1.6 (2弾頭近似) */
  damageMultiplier?: number;
  /** 移動速度倍率。stamin-up: 1.07 */
  moveMultiplier?: number;
  /** 自己復活チャージ数。quick-revive: 1 */
  selfReviveCharges?: number;
}

export interface PerkDef {
  id: ZombiePerkId;
  name: string;
  price: number;
  description: string;
  effect: PerkEffect;
}

export const PERKS: Record<ZombiePerkId, PerkDef> = {
  juggernog: {
    id: 'juggernog',
    name: 'ジャガーノグ',
    price: 2500,
    description: '最大HP 100 → 250',
    effect: { maxHpMultiplier: 2.5 },
  },
  'speed-cola': {
    id: 'speed-cola',
    name: 'スピードコーラ',
    price: 3000,
    description: 'リロード時間 ×0.5',
    effect: { reloadMultiplier: 0.5 },
  },
  'double-tap': {
    id: 'double-tap',
    name: 'ダブルタップ',
    price: 2000,
    description: '発射レート +33%、弾ダメージ ×1.6',
    effect: { fireRateMultiplier: 1.33, damageMultiplier: 1.6 },
  },
  'stamin-up': {
    id: 'stamin-up',
    name: 'スタミナアップ',
    price: 2000,
    description: '移動速度 ×1.07',
    effect: { moveMultiplier: 1.07 },
  },
  'quick-revive': {
    id: 'quick-revive',
    name: 'クイックリバイブ',
    price: 500,
    description: '自己復活1回（ダウン後3秒で復活、所持消費）',
    effect: { selfReviveCharges: 1 },
  },
};

// ─── 壁武器(Wall Buys) ────────────────────────────────────────────────────────

export interface WallBuyDef {
  weaponId: string;
  /** 購入コスト。弾薬補充=本体半額だが∞予備弾仕様のため弾購入は省略 */
  price: number;
}

/**
 * 壁購入武器リスト。入門500/AR級1200/強武器1500/クナイ2000/DSR2500の8本。
 * generateShopLayout は fists・yamasemi-dmr を常に配置し、残りから4〜6本を選ぶ。
 * weapons.ts の WEAPON_DEFS に実在する primary 武器 ID のみを使用する。
 */
export const WALL_BUYS: readonly WallBuyDef[] = [
  // 入門 500 ─ 初期ラウンドに届く価格
  { weaponId: 'hiiragi-sg', price: 500 },
  { weaponId: 'tsubaki-smg', price: 500 },
  // AR級 1200 ─ R5〜7 圏の主力
  { weaponId: 'kaede-ar', price: 1200 },
  { weaponId: 'ginyanma-ar', price: 1200 },
  // 強武器 1500 ─ R7〜9 以降の高火力枠
  { weaponId: 'miyama-br', price: 1500 },
  { weaponId: 'kasasagi-ar', price: 1500 },
  // 必置武器 ─ generateShopLayout が常に配置する
  { weaponId: 'fists', price: 2000 },
  { weaponId: 'yamasemi-dmr', price: 2500 },
];

/** generateShopLayout が必ず配置する壁武器 ID */
export const MANDATORY_WALL_BUY_IDS: readonly string[] = ['fists', 'yamasemi-dmr'];

// ─── ミステリーボックス プール ────────────────────────────────────────────────

/**
 * ミステリーボックスで排出可能な全武器 ID。
 * fists(クナイ)を除く全プライマリ武器。スナイパー・LMG 含む。
 */
export const MYSTERY_BOX_POOL: readonly string[] = PRIMARY_IDS.filter(
  (id) => id !== 'fists',
);

// ─── 純関数 ───────────────────────────────────────────────────────────────────

/** points >= cost かどうかを返す */
export function canBuy(points: number, cost: number): boolean {
  return points >= cost;
}

/**
 * cost を差し引いた残高を返す。
 * @throws 残高不足の場合 Error
 */
export function buyResult(points: number, cost: number): number {
  if (!canBuy(points, cost)) throw new Error('insufficient points');
  return points - cost;
}

export interface MysteryBoxResult {
  weaponId: string;
  /**
   * true のとき箱が別位置へ移動する。
   * match 側はこのフラグを見て Mystery Box の 3D 座標を再抽選すること。
   */
  boxMoves: boolean;
}

/**
 * ミステリーボックスを回す。
 * @param rand テスト注入用の乱数生成器 [0, 1)。本番は Math.random を渡す。
 * @returns 排出武器 ID と箱移動フラグ。約 BOX_MOVES_CHANCE(8%) で boxMoves=true。
 */
export function rollMysteryBox(rand: () => number): MysteryBoxResult {
  const pool = MYSTERY_BOX_POOL;
  const idx = Math.floor(rand() * pool.length);
  const weaponId = pool[idx] ?? pool[0]!;
  const boxMoves = rand() < BOX_MOVES_CHANCE;
  return { weaponId, boxMoves };
}

/** perkId に対応する効果値を返す */
export function getPerkEffect(perkId: ZombiePerkId): PerkEffect {
  return PERKS[perkId].effect;
}

export type PurchaseError =
  | 'insufficient-points'
  | 'quick-revive-charged';

export interface PurchaseResult {
  ok: boolean;
  remainingPoints: number;
  error?: PurchaseError;
  /** 購入後のスタック数。失敗時は購入前の値(0=未所持) */
  stackCount: number;
}

/**
 * パーク購入を検証して結果を返す。純関数なので stacks を直接変更しない。
 * ok=true のとき呼び出し元が stacks を更新し、残高を結果の remainingPoints へ置き換えること。
 * quick-revive 以外はスタック無限購入可能。quick-revive は charge>0 のとき拒否。
 */
export function purchasePerk(
  stacks: Readonly<Partial<Record<ZombiePerkId, number>>>,
  perkId: ZombiePerkId,
  points: number,
  quickReviveCharges?: number,
): PurchaseResult {
  const perk = PERKS[perkId];
  if (!canBuy(points, perk.price)) {
    return { ok: false, remainingPoints: points, error: 'insufficient-points', stackCount: stacks[perkId] ?? 0 };
  }
  if (perkId === 'quick-revive') {
    if ((quickReviveCharges ?? 0) > 0) {
      return { ok: false, remainingPoints: points, error: 'quick-revive-charged', stackCount: 1 };
    }
    return { ok: true, remainingPoints: points - perk.price, stackCount: 1 };
  }
  const current = stacks[perkId] ?? 0;
  return { ok: true, remainingPoints: points - perk.price, stackCount: current + 1 };
}

// ─── ショップレイアウト生成 ───────────────────────────────────────────────────

export type ShopSlotKind = 'wall-buy' | 'perk-machine' | 'mystery-box';

export interface ShopSlot {
  kind: ShopSlotKind;
  /** レイアウト内の連番(0 始まり)。match 側がこの番号を 3D 座標へ変換する */
  slotIndex: number;
  /** wall-buy の場合のみ設定される */
  weaponId?: string;
  /** perk-machine の場合のみ設定される */
  perkId?: ZombiePerkId;
  /** 購入コスト */
  cost: number;
}

export interface ShopLayout {
  /** スロット順序リスト。slotIndex と配列インデックスは一致する */
  slots: ShopSlot[];
}

// ─── 内部: 決定論的 PRNG(mulberry32) ─────────────────────────────────────────

/** seed から決定論的乱数列を生成する(mulberry32 アルゴリズム) */
function makePrng(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] の整数を一様に返す */
function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Fisher-Yates in-place shuffle */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

const ALL_PERK_IDS: ZombiePerkId[] = [
  'juggernog',
  'speed-cola',
  'double-tap',
  'stamin-up',
  'quick-revive',
];

/**
 * seed から決定論的にゾンビステージのショップ配置を生成する。
 *
 * - 壁武器スポット: 6〜8 個(fists+DSR は必置、残りから4〜6本を選出)
 * - パーク自販機 : 3〜4 台(ALL_PERK_IDS から重複なしで選出)
 * - ミステリーボックス: 1 個(常に末尾)
 *
 * 3D 座標付けは match 側に委譲。ここでは「何をどの slotIndex に置くか」のみ確定する。
 * stages.ts の StageDef.seed をそのまま渡すと z01〜z10 の各ステージが固有の配置になる。
 */
export function generateShopLayout(seed: number): ShopLayout {
  const rand = makePrng(seed);
  const slots: ShopSlot[] = [];
  let slotIndex = 0;

  const perkCount = randInt(rand, 3, 4);

  // 壁武器: fists+DSR は必置、残り6本(optional)からoptionalCount個をシャッフル選出
  // 必置2 + optional4〜6 = 合計6〜8本
  const optionalCount = randInt(rand, 4, 6);
  const mandatoryWalls = WALL_BUYS.filter((wb) => MANDATORY_WALL_BUY_IDS.includes(wb.weaponId));
  const optionalWalls = shuffle(
    WALL_BUYS.filter((wb) => !MANDATORY_WALL_BUY_IDS.includes(wb.weaponId)),
    rand,
  );
  const selectedWalls = shuffle(
    [...mandatoryWalls, ...optionalWalls.slice(0, optionalCount)],
    rand,
  );
  for (const wb of selectedWalls) {
    slots.push({
      kind: 'wall-buy',
      slotIndex,
      weaponId: wb.weaponId,
      cost: wb.price,
    });
    slotIndex += 1;
  }

  // パーク自販機: shuffle して先頭 perkCount 個を採用(重複なし)
  // perkCount(3〜4) < ALL_PERK_IDS.length(5) なので範囲内アクセスが保証される
  const perkPool = shuffle([...ALL_PERK_IDS], rand);
  for (let i = 0; i < perkCount; i += 1) {
    const pid = perkPool[i]!;
    slots.push({
      kind: 'perk-machine',
      slotIndex,
      perkId: pid,
      cost: PERKS[pid].price,
    });
    slotIndex += 1;
  }

  // ミステリーボックス: 常に 1 個、末尾
  slots.push({
    kind: 'mystery-box',
    slotIndex,
    cost: MYSTERY_BOX_COST,
  });

  return { slots };
}
