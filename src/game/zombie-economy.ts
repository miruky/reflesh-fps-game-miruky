// BO2ゾンビモード経済の純ロジックコア。three / rapier / DOM 依存なし。
// match.ts への配線は後続タスクが行う。
//
// 配線ポイント候補 (match 側):
//   - killEnemy(kind) → calcKillPoints(kind) でポイント加算
//   - openShop(slot) → buyResult / purchasePerk を呼んで残高更新・パーク適用
//   - rollBox()      → rollMysteryBox(Math.random) → weaponId で武器切替、boxMoves で箱座標更新
//   - ステージ開始   → generateShopLayout(stage.seed) → スロット番号ごとに 3D 座標を割り当て
//   - 武器切替/PAP購入/パーク購入のたび → composeZombieWeaponDef(WEAPON_DEFS[id], {papTier,
//     extMagStacks, doubleTapStacks, speedColaStacks}) を呼び直して WeaponDef を再構築する
//     (R53-W2: 現在値への乗算は禁止。必ずこの関数経由でベース値から再計算する)
//   - killEnemy() 内  → rollPowerUp(Math.random) で地面ドロップ判定、拾得時は種別ごとに
//     POWERUP_DURATION_S / NUKE_BONUS_PT / CARPENTER_BONUS_PT を適用
//   - ゾンビ湧き時   → rollZombieVariant(round, Math.random, aliveMiasmaCount) で特殊個体化
//   - ラウンド開始   → specialRoundKind(round)(zombie.ts) で 'rush' なら RUSH_HP_MUL 等を適用
//   - ShopSlotKind 'pack-a-punch'/'door' の3D配置・購入UIは今回未配線(電源システムも見送り)
//   - メニュー       → CHARMS から選択したcharmの effect を試合開始時に適用

import { PRIMARY_IDS, type WeaponDef } from './weapons';

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
// パーク所持数の上限は設けない(quick-revive 以外は無限スタックが正式仕様。R53-W2)。
// purchasePerk() がスタック数を無条件に加算し、match.ts 側も上限チェックを行わない。

// ─── パーク定義 ───────────────────────────────────────────────────────────────

export type ZombiePerkId =
  | 'juggernog'
  | 'speed-cola'
  | 'double-tap'
  | 'stamin-up'
  | 'quick-revive'
  | 'ext-mag';

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
  /** マガジン容量の加算率/スタック。ext-mag: 0.5(容量=基礎×(1+0.5×スタック数)、切り上げ) */
  magCapacityBonusPerStack?: number;
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
  'ext-mag': {
    id: 'ext-mag',
    name: '拡張マガジン',
    price: 1000,
    description: 'マガジン容量 +50%/スタック(切り上げ、無限スタック)',
    effect: { magCapacityBonusPerStack: 0.5 },
  },
};

// ─── 壁武器(Wall Buys) ────────────────────────────────────────────────────────

export interface WallBuyDef {
  weaponId: string;
  /** 購入コスト。弾薬補充=本体半額だが∞予備弾仕様のため弾購入は省略 */
  price: number;
}

/**
 * 壁購入武器リスト。入門500/AR級1200/強武器1500/クナイ3500/DSR2500の8本(標準) +
 * 特殊兵装4本(業火RL2500/修羅LMG3000/月光弓2200/天雷杖2800) = 計12本。
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
  { weaponId: 'fists', price: 3500 },      // クナイ(旧2000→3500: 強力な近接戦力に見合う価格)
  { weaponId: 'yamasemi-dmr', price: 2500 },
  // 特殊兵装枠 ─ 高ラウンド向けエキゾチック武器(optional pool に追加)
  { weaponId: 'gouka-rl', price: 2500 },      // 業火ロケットランチャー
  { weaponId: 'shura-lmg', price: 3000 },     // 修羅LMG(ミニガン)
  { weaponId: 'gekkou-bow', price: 2200 },    // 月光弓
  { weaponId: 'tenrai-staff', price: 2800 },  // 天雷杖
];

/** generateShopLayout が必ず配置する壁武器 ID */
export const MANDATORY_WALL_BUY_IDS: readonly string[] = ['fists', 'yamasemi-dmr'];

// ─── ミステリーボックス プール ────────────────────────────────────────────────

/**
 * ミステリーボックスで排出可能な全武器 ID。
 * fists(クナイ)を除く全プライマリ武器 + セカンダリexotic(banjin-smg/misago-pistol)。
 * スナイパー・LMG・特殊兵装含む。高ラウンドの報酬多様性向上のため副武器exoticを追加。
 */
export const MYSTERY_BOX_POOL: readonly string[] = [
  ...PRIMARY_IDS.filter((id) => id !== 'fists'),
  'banjin-smg',    // セカンダリexotic: 手裏剣連射SMG
  'misago-pistol', // セカンダリexotic: 特殊ハンドガン
];

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

/**
 * 拡張マガジン(ext-mag)適用後の装弾数を返す。
 * 基礎容量(WEAPON_DEFS由来、未改変値) × (1 + 0.5×スタック数) を切り上げる。
 * speed-cola(複利0.85^n)と異なり線形加算のため、呼び出し側は毎回このベース値から
 * 再計算すること(現在値からの複利ではない)。stackCount<=0 は基礎容量のまま。
 */
export function applyExtMagCapacity(baseCapacity: number, stackCount: number): number {
  if (stackCount <= 0) return baseCapacity;
  return Math.ceil(baseCapacity * (1 + 0.5 * stackCount));
}

// ─── Pack-a-Punch + 武器合成(R53-W2) ───────────────────────────────────────
//
// ダメージ/弾数系のパークとPack-a-PunchはこれまでR52まで match.ts 側で
// 「現在値へ乗数を都度掛ける」形で個別に配線されており、乗算パイプが錯綜していた
// (例: speed-cola は複利、ext-mag は線形加算、double-tap は初回×1.6+以降+0.3加算 …)。
// R53 では composeZombieWeaponDef() に一本化し、常に WEAPON_DEFS の基礎値から
// 再計算する(現在値からの複利は禁止)。match.ts 側は武器切替のたびにこの関数を
// 呼び直すことで、スタック数の組み合わせに依らず決定論的な結果を得る。

/** Pack-a-Punch ダメージ倍率。[tier0, tier1, tier2, tier3] */
export const PAP_DMG_MUL = [1, 2.5, 5, 8] as const;
/** Pack-a-Punch 購入コスト(初回)。[tier0(未使用), tier1, tier2, tier3] */
// ★W4B監査: [0,5000,15000,30000]では到達がR5/R8/R11と設計意図(R20/R35の壁解消)より
// 3-4倍早い(実経済シミュ)。後段を引き上げ、到達R5/R13/R19の段階感に(BO2初段5000は維持)
export const PAP_COST = [0, 5000, 20000, 45000] as const;
/** 現在の tier のまま再購入(マガジン全補充のみ)する際のコスト */
export const PAP_REFILL_COST = 2000;

/** Pack-a-Punch の名称接尾辞。[tier0(未使用), tier1, tier2, tier3] */
const PAP_NAME_SUFFIX = ['', '・改', '・改二', '・改三'] as const;

export type PapTier = 0 | 1 | 2 | 3;

export interface ComposeZombieWeaponOpts {
  papTier: PapTier;
  extMagStacks: number;
  doubleTapStacks: number;
  speedColaStacks: number;
}

/**
 * WEAPON_DEFS の基礎値(base)から、Pack-a-Punch tier とパークのスタック数を
 * 一括合成した WeaponDef を都度再計算して返す純関数。
 *
 * - damage       = round(base.damage × PAP_DMG_MUL[papTier] × (1 + 0.3×doubleTapStacks))
 * - magazineSize = ceil(base.magazineSize × (papTier>=1 ? 1.5 : 1) × (1 + 0.5×extMagStacks))
 * - rpm          = round(base.rpm × (doubleTapStacks>0 ? 1.33 : 1))
 * - reloadTacticalMs/reloadEmptyMs = round(base値 × max(0.25, 0.85^speedColaStacks))
 *   (下限0.25は既存 speed-cola 実装[match.ts applyZombiePerk]の床と同値)
 * - name = papTier>0 なら base.name + ['', '・改', '・改二', '・改三'][papTier]
 *
 * fists(クナイ)は呼び出し側で除外される前提だが、本関数もガードとして base を
 * そのまま返す(近接武器にPAP/パーク乗数を適用しない)。
 */
export function composeZombieWeaponDef(base: WeaponDef, opts: ComposeZombieWeaponOpts): WeaponDef {
  if (base.id === 'fists') return base;
  const { papTier, extMagStacks, doubleTapStacks, speedColaStacks } = opts;

  const dmgMul = PAP_DMG_MUL[papTier];
  const damage = Math.round(base.damage * dmgMul * (1 + 0.3 * doubleTapStacks));

  const magMul = (papTier >= 1 ? 1.5 : 1) * (1 + 0.5 * extMagStacks);
  const magazineSize = Math.ceil(base.magazineSize * magMul);

  const rpm = Math.round(base.rpm * (doubleTapStacks > 0 ? 1.33 : 1));

  const reloadMul = Math.max(0.25, Math.pow(0.85, speedColaStacks));
  const reloadTacticalMs = Math.round(base.reloadTacticalMs * reloadMul);
  const reloadEmptyMs = Math.round(base.reloadEmptyMs * reloadMul);

  const name = papTier > 0 ? base.name + PAP_NAME_SUFFIX[papTier] : base.name;

  return { ...base, damage, magazineSize, rpm, reloadTacticalMs, reloadEmptyMs, name };
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

// ─── パワーアップ(キルドロップ)────────────────────────────────────────────────
//
// BO2式の地面ドロップ。キル時に抽選し、拾うと即時〜一定時間効果を発揮する。
// insta(インスタキル)/double(ポイント2倍)は時限式、nuke(全滅+ボーナス)/
// maxammo(全弾補充)/carpenter(バリケード全修復+ボーナス)は即時消費。

export type PowerUpKind = 'insta' | 'double' | 'nuke' | 'maxammo' | 'carpenter';

/** 未回収のまま消える(despawn)までの秒数 */
export const POWERUP_DESPAWN_S = 30;
/** 同時に地面へ存在できるパワーアップの上限数 */
export const POWERUP_ROUND_CAP = 4;
/** insta/double の効果持続秒数 */
export const POWERUP_DURATION_S = 30;
/** nuke 使用時のボーナスポイント */
export const NUKE_BONUS_PT = 400;
/** carpenter 使用時のボーナスポイント */
export const CARPENTER_BONUS_PT = 200;

/** キル時にパワーアップがドロップする確率 */
const POWERUP_DROP_CHANCE = 0.025;
const POWERUP_KINDS: readonly PowerUpKind[] = ['insta', 'double', 'nuke', 'maxammo', 'carpenter'];

/**
 * キル1件につき呼び出す。まず POWERUP_DROP_CHANCE(2.5%)でドロップ判定を行い、
 * ドロップする場合のみ2回目の rand() で種別を一様抽選する(非ドロップ時は
 * rand() を1回しか消費しない)。
 */
export function rollPowerUp(rand: () => number): PowerUpKind | null {
  if (rand() >= POWERUP_DROP_CHANCE) return null;
  const idx = Math.floor(rand() * POWERUP_KINDS.length);
  return POWERUP_KINDS[idx] ?? POWERUP_KINDS[0]!;
}

// ─── ゾンビ特殊バリアント(R53-W2) ──────────────────────────────────────────
//
// 通常ゾンビに稀に混じる特殊個体。撃破時に固有の効果を発生させる。
// 識別子(ZombieVariant)はここを単一の真実として定義する(経済/報酬ロジックとの
// 結び付きが強いため)。bot.ts 側は見た目適用のみを担い、この型をそのまま輸入する。
// match.ts 側が rollZombieVariant() の戻り値を見て見た目/爆発/毒霧/装甲を適用する。

export type ZombieVariant = 'blast' | 'miasma' | 'shell';

/** blast(自爆ゾンビ)撃破時の爆発半径(m) */
export const BLAST_RADIUS_M = 3;
/** blast 撃破時の爆発ダメージ */
export const BLAST_DMG = 40;
/** miasma(瘴気ゾンビ)撃破時に残る毒霧の半径(m) */
export const MIASMA_RADIUS_M = 4;
/** miasma 毒霧の持続時間(秒) */
export const MIASMA_DURATION_S = 6;
/** miasma 毒霧内にいる間の秒間ダメージ */
export const MIASMA_DPS = 8;
/** shell(装甲ゾンビ)の正面被ダメージ軽減率。ヘッドショットは貫通のため軽減なし */
export const SHELL_FRONT_REDUCTION = 0.7;

const BLAST_ROUND_MIN = 8;
const BLAST_CHANCE = 0.08;
const MIASMA_ROUND_MIN = 12;
const MIASMA_CHANCE = 0.06;
/** 生存 miasma 数がこの値以上のとき、抽選対象から除外する(毒霧の重ね掛け防止) */
const MIASMA_ALIVE_CAP = 6;
const SHELL_ROUND_MIN = 15;
const SHELL_CHANCE = 0.06;

/**
 * ラウンド r・乱数生成器 rand・現在生存中の miasma 個体数 aliveMiasma から
 * 湧かせるゾンビのバリアントを1体分だけ抽選する。
 *
 * - blast: r>=8 で 8%
 * - miasma: r>=12 で 6%(aliveMiasma>=6 のときは抽選から除外)
 * - shell: r>=15 で 6%
 *
 * 判定は blast→miasma→shell の順で行い、複数条件が重複しても最初に当たった
 * 1種のみを返す(重ね掛けなし)。どれにも当たらなければ null(通常ゾンビ)。
 */
export function rollZombieVariant(
  round: number,
  rand: () => number,
  aliveMiasma: number,
): ZombieVariant | null {
  if (round >= BLAST_ROUND_MIN && rand() < BLAST_CHANCE) return 'blast';
  if (round >= MIASMA_ROUND_MIN && aliveMiasma < MIASMA_ALIVE_CAP && rand() < MIASMA_CHANCE) {
    return 'miasma';
  }
  if (round >= SHELL_ROUND_MIN && rand() < SHELL_CHANCE) return 'shell';
  return null;
}

// ─── ショップレイアウト生成 ───────────────────────────────────────────────────

export type ShopSlotKind =
  | 'wall-buy'
  | 'perk-machine'
  | 'mystery-box'
  | 'pack-a-punch'
  | 'door';

/** door(PaP台を内包する建物入口)の購入コスト */
export const DOOR_COST = 1750;

// ── W4D-NIT: 「継承の守り札(perkcarry)」のlocalStorageキー(単一の真実)。
// 書き込み=match.ts(試合初回パーク購入時)、読み取り=menu.ts(次試合のcarriedPerk解決)
export const LAST_ZOMBIE_PERK_KEY = 'hibana.zombie.lastPerk.v1';

export interface ShopSlot {
  kind: ShopSlotKind;
  /** レイアウト内の連番(0 始まり)。match 側がこの番号を 3D 座標へ変換する */
  slotIndex: number;
  /** wall-buy の場合のみ設定される */
  weaponId?: string;
  /** perk-machine の場合のみ設定される */
  perkId?: ZombiePerkId;
  /**
   * 購入コスト。pack-a-punch は tier ごとに PAP_COST/PAP_REFILL_COST を
   * 別途参照するためスロット自体は 0(このスロットの「入場」自体に対価はない)。
   */
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
  'ext-mag',
];

/**
 * seed から決定論的にゾンビステージのショップ配置を生成する。
 *
 * - 壁武器スポット: 6〜8 個(fists+DSR は必置、残りから4〜6本を選出)
 * - パーク自販機 : 3〜4 台(ALL_PERK_IDS から重複なしで選出)
 * - ミステリーボックス: 1 個
 * - Pack-a-Punch 台: 1 個(無条件で常に配置)
 * - ドア: 1 枚(PaP台を内包する建物の入口。DOOR_COST 固定)
 *
 * PaP台とドアは乱数を消費しない固定エントリのため、既存スロット(壁武器/パーク/
 * ミステリーボックス)の rand 消費列・並び順には一切影響しない
 * (R52実証済みの「rand消費列の末尾に追加する」安全パターンを踏襲)。
 * 電源(power switch)システムは今回のスコープでは見送り(PaP/ドアは常時通電の体で配置のみ行う)。
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
  // perkCount(3〜4) < ALL_PERK_IDS.length(6) なので範囲内アクセスが保証される
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

  // ミステリーボックス: 常に 1 個
  slots.push({
    kind: 'mystery-box',
    slotIndex,
    cost: MYSTERY_BOX_COST,
  });
  slotIndex += 1;

  // rand消費列の末尾に追加(R52実証パターン): 以降は乱数を一切消費しないため、
  // 既存スロット(壁武器/パーク/ミステリーボックス)の並び順・内容はseed不変のまま維持される。
  // Pack-a-Punch 台: 常に1個、無条件配置
  slots.push({
    kind: 'pack-a-punch',
    slotIndex,
    cost: 0,
  });
  slotIndex += 1;

  // ドア: PaP台を内包する建物の入口。常に1枚、固定コスト
  slots.push({
    kind: 'door',
    slotIndex,
    cost: DOOR_COST,
  });

  return { slots };
}

// ─── お守り(charm)───────────────────────────────────────────────────────────
//
// 試合開始前にメニューで1つ選んで装備する永続メタ進行アイテム。
// 解放条件の達成判定・装備UIの配線は match/menu 側が行う(ここは純データのみ)。

export type CharmId = 'startpt' | 'revive' | 'bossdmg' | 'perkcarry';

/** charm 適用時の効果値。未指定フィールドはデフォルト値から変更しない */
export interface CharmEffect {
  /** startpt: 開幕時に加算される追加ポイント */
  bonusStartPoints?: number;
  /** revive: 初回ダウン時に自動発動する自己復活の回数 */
  autoReviveCharges?: number;
  /** bossdmg: ボスに対するダメージ倍率 */
  bossDamageMultiplier?: number;
  /** perkcarry: 前試合から引き継ぐパークの種類数 */
  perkCarryCount?: number;
}

export interface CharmDef {
  id: CharmId;
  name: string;
  description: string;
  /** 解放条件の説明文。実際の達成判定は match/menu 側の実績連携に委譲する */
  unlockCondition: string;
  effect: CharmEffect;
}

export const CHARMS: Record<CharmId, CharmDef> = {
  startpt: {
    id: 'startpt',
    name: '始まりの守り札',
    description: '開幕時に+1000ポイントを獲得する',
    unlockCondition: 'ゾンビモードを1試合クリアする',
    effect: { bonusStartPoints: 1000 },
  },
  revive: {
    id: 'revive',
    name: '不屈の守り札',
    description: '初回ダウン時に自動で復活する(1回のみ、所持消費)',
    unlockCondition: 'ラウンド20に到達する',
    effect: { autoReviveCharges: 1 },
  },
  bossdmg: {
    id: 'bossdmg',
    name: '討伐の守り札',
    description: 'ボスへのダメージ+20%',
    unlockCondition: 'ボスを10体撃破する',
    effect: { bossDamageMultiplier: 1.2 },
  },
  perkcarry: {
    id: 'perkcarry',
    name: '継承の守り札',
    description: '前回の試合で所持していたパークを1種引き継ぐ',
    unlockCondition: '1試合で全パーク種を所持する',
    effect: { perkCarryCount: 1 },
  },
};

/** charmId に対応する効果値を返す */
export function getCharmEffect(charmId: CharmId): CharmEffect {
  return CHARMS[charmId].effect;
}
