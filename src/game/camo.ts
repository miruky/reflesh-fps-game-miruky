// BO2/BO3式 武器カモチャレンジの純ロジック(段階定義・解除判定・進捗)。
// 保存形式は core/profile.ts、積算は progression.ts、描画は render/viewmodel.ts が担う。
// このモジュールは weapons.ts 以外に依存しない(決定論・副作用なし)。

import { PRIMARY_IDS, WEAPON_DEFS, type WeaponClass } from './weapons';

// ── カモID ────────────────────────────────────────────────────────────────
// 9段の武器別カモ(キル階段) + ダイヤ(クラス制覇) + ダークマター(全クラス制覇)
export type CamoId =
  | 'dirt'
  | 'woodland'
  | 'tiger'
  | 'blue'
  | 'red'
  | 'ghost'
  | 'lava'
  | 'neon'
  | 'gold'
  | 'diamond'
  | 'dark-matter';

// 武器ごとのカモ用累計統計。headshots は「ヘッドショットキル」を数える(BO2式)
export interface WeaponCamoStats {
  kills: number;
  headshots: number;
}

export interface CamoDef {
  id: CamoId;
  name: string;
  // 解除に必要なその武器での累計キル数
  kills: number;
  // 追加条件: 累計ヘッドショットキル(ゴールドのみ 100)
  headshots: number;
  // リザルトで計上する解除XP(xpMul 適用前)
  xp: number;
}

// 武器別カモの9段階。キル階段 25/50/75/100/150/200/300/400/500。
// ゴールドのみ「HS100込み」(500キル AND ヘッドショットキル100)。
export const CAMO_TIERS: readonly CamoDef[] = [
  { id: 'dirt', name: '汚れ迷彩', kills: 25, headshots: 0, xp: 100 },
  { id: 'woodland', name: '森林', kills: 50, headshots: 0, xp: 100 },
  { id: 'tiger', name: 'タイガー', kills: 75, headshots: 0, xp: 150 },
  { id: 'blue', name: 'ブルー', kills: 100, headshots: 0, xp: 150 },
  { id: 'red', name: 'レッド', kills: 150, headshots: 0, xp: 200 },
  { id: 'ghost', name: 'ゴースト', kills: 200, headshots: 0, xp: 200 },
  { id: 'lava', name: '溶岩', kills: 300, headshots: 0, xp: 250 },
  { id: 'neon', name: 'ネオン', kills: 400, headshots: 0, xp: 300 },
  { id: 'gold', name: 'ゴールド', kills: 500, headshots: 100, xp: 500 },
];

// マスタリーカモ(条件は段階表と別系統)
export const DIAMOND_CAMO = { id: 'diamond' as const, name: 'ダイヤ', xp: 1000 };
export const DARK_MATTER_CAMO = { id: 'dark-matter' as const, name: 'ダークマター', xp: 2500 };

export const CAMO_IDS: readonly CamoId[] = [
  ...CAMO_TIERS.map((t) => t.id),
  DIAMOND_CAMO.id,
  DARK_MATTER_CAMO.id,
];

export function isCamoId(id: string): id is CamoId {
  return (CAMO_IDS as readonly string[]).includes(id);
}

export function camoName(id: CamoId): string {
  if (id === 'diamond') return DIAMOND_CAMO.name;
  if (id === 'dark-matter') return DARK_MATTER_CAMO.name;
  return CAMO_TIERS.find((t) => t.id === id)?.name ?? id;
}

// ── 対象武器とクラス ──────────────────────────────────────────────────────
// カモ対象 = 全プライマリから fists(クナイ)を除いた25本
export const CAMO_WEAPON_IDS: readonly string[] = PRIMARY_IDS.filter((id) => id !== 'fists');

// カモ対象武器が属するクラス集合(出現順・重複なし)。ダークマター判定の分母になる
export const CAMO_CLASSES: readonly WeaponClass[] = CAMO_WEAPON_IDS.reduce<WeaponClass[]>(
  (acc, id) => {
    const cls = WEAPON_DEFS[id]?.class;
    if (cls && !acc.includes(cls)) acc.push(cls);
    return acc;
  },
  [],
);

// クラス表示名(リザルト行・ARMORYのダイヤ進捗表示に使う)
export const CAMO_CLASS_LABELS: Record<WeaponClass, string> = {
  ar: 'アサルトライフル',
  smg: 'サブマシンガン',
  marksman: 'マークスマン',
  sniper: 'スナイパー',
  shotgun: 'ショットガン',
  br: 'バトルライフル',
  lmg: 'ライトマシンガン',
  pistol: 'ハンドガン',
  launcher: 'ロケットランチャー',
};

// カモ対象武器のクラス(非対象・未知IDは null)
export function camoClassOf(weaponId: string): WeaponClass | null {
  if (!CAMO_WEAPON_IDS.includes(weaponId)) return null;
  return WEAPON_DEFS[weaponId]?.class ?? null;
}

// クラスに属するカモ対象武器ID一覧
export function camoWeaponsOfClass(cls: WeaponClass): readonly string[] {
  return CAMO_WEAPON_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls);
}

// 武器の表示名(未知IDはIDのまま返す)
export function weaponNameOf(weaponId: string): string {
  return WEAPON_DEFS[weaponId]?.name ?? weaponId;
}

// 表示名 → 武器ID の逆引き(match.ts のキル記録が使う)。未知の名前(近接/投擲など)は null
const NAME_TO_ID = new Map<string, string>();
for (const [id, def] of Object.entries(WEAPON_DEFS)) NAME_TO_ID.set(def.name, id);
export function weaponIdByName(name: string): string | null {
  return NAME_TO_ID.get(name) ?? null;
}

// ── 判定純関数 ────────────────────────────────────────────────────────────
const EMPTY_STATS: WeaponCamoStats = { kills: 0, headshots: 0 };

function statsOf(
  allStats: Record<string, WeaponCamoStats>,
  weaponId: string,
): WeaponCamoStats {
  return allStats[weaponId] ?? EMPTY_STATS;
}

// 解除済みの段階数(0..9)。段階表は先頭からキル閾値が単調増加で、ゴールドのみHS条件が
// 加わるため「先頭からの連続達成数 = 達成総数」が常に成り立つ
export function camoTierFor(stats: WeaponCamoStats | undefined): number {
  const s = stats ?? EMPTY_STATS;
  let n = 0;
  for (const tier of CAMO_TIERS) {
    if (s.kills >= tier.kills && s.headshots >= tier.headshots) n += 1;
    else break;
  }
  return n;
}

// その武器がゴールド到達済みか
export function goldFor(stats: WeaponCamoStats | undefined): boolean {
  return camoTierFor(stats) >= CAMO_TIERS.length;
}

// ダイヤ: 同クラスのカモ対象武器が全てゴールドで解除
export function diamondFor(
  cls: WeaponClass,
  allStats: Record<string, WeaponCamoStats>,
): boolean {
  const weapons = camoWeaponsOfClass(cls);
  if (weapons.length === 0) return false;
  return weapons.every((id) => goldFor(statsOf(allStats, id)));
}

// ダークマター: 全クラスがダイヤで解除(全武器に適用可)
export function darkMatterFor(allStats: Record<string, WeaponCamoStats>): boolean {
  return CAMO_CLASSES.every((cls) => diamondFor(cls, allStats));
}

// 指定カモが指定武器で解除済みか(diamond はその武器のクラス、dark-matter は全体で判定)
export function isCamoUnlocked(
  camoId: CamoId,
  weaponId: string,
  allStats: Record<string, WeaponCamoStats>,
): boolean {
  if (!CAMO_WEAPON_IDS.includes(weaponId)) return false;
  if (camoId === 'dark-matter') return darkMatterFor(allStats);
  if (camoId === 'diamond') {
    const cls = camoClassOf(weaponId);
    return cls !== null && diamondFor(cls, allStats);
  }
  const idx = CAMO_TIERS.findIndex((t) => t.id === camoId);
  if (idx < 0) return false;
  return camoTierFor(statsOf(allStats, weaponId)) > idx;
}

// UI用の進捗。current は target を超えない。label は条件の説明文
export interface CamoProgress {
  current: number;
  target: number;
  label: string;
}

export function camoProgress(
  camoId: CamoId,
  weaponId: string,
  allStats: Record<string, WeaponCamoStats>,
): CamoProgress {
  if (camoId === 'dark-matter') {
    const current = CAMO_CLASSES.filter((cls) => diamondFor(cls, allStats)).length;
    return { current, target: CAMO_CLASSES.length, label: '全クラスでダイヤを解除' };
  }
  if (camoId === 'diamond') {
    const cls = camoClassOf(weaponId);
    const weapons = cls ? camoWeaponsOfClass(cls) : [];
    const current = weapons.filter((id) => goldFor(statsOf(allStats, id))).length;
    const clsLabel = cls ? CAMO_CLASS_LABELS[cls] : 'クラス';
    return { current, target: Math.max(1, weapons.length), label: `${clsLabel}全武器をゴールドに` };
  }
  const tier = CAMO_TIERS.find((t) => t.id === camoId);
  if (!tier) return { current: 0, target: 1, label: '' };
  const s = statsOf(allStats, weaponId);
  if (tier.headshots > 0 && s.kills >= tier.kills) {
    // キル条件は満了 → 残るHS条件の進捗を出す(ゴールド)
    return {
      current: Math.min(s.headshots, tier.headshots),
      target: tier.headshots,
      label: `HSキル ${tier.headshots}(累計${tier.kills}キル達成済)`,
    };
  }
  const label =
    tier.headshots > 0 ? `累計${tier.kills}キル + HSキル${tier.headshots}` : `累計${tier.kills}キル`;
  return { current: Math.min(s.kills, tier.kills), target: tier.kills, label };
}

// 装備中カモの解決。選択が無い/未解除/不正IDなら null(viewmodel が素の質感で描く)
export function equippedCamoFor(
  weaponId: string,
  profile: {
    selectedCamos: Record<string, string>;
    weaponStats: Record<string, WeaponCamoStats>;
  },
): CamoId | null {
  const sel = profile.selectedCamos[weaponId];
  if (!sel || !isCamoId(sel)) return null;
  return isCamoUnlocked(sel, weaponId, profile.weaponStats) ? sel : null;
}

// ── カモ見た目の定義(アセットレス: 色とパターン種のみのデータ) ────────────
// viewmodel.ts が onBeforeCompile の軽量ノイズGLSLへ焼き込み、menu.ts がチップの
// スウォッチ(CSSグラデ)に使う。emissiveIntensity は Bloom 白飛び回避のため 0.5 以下。
export type CamoPattern = 'blotch' | 'stripe' | 'facet' | 'pulse' | 'solid';

export interface CamoVisual {
  id: CamoId;
  colorA: number;
  colorB: number;
  colorC: number;
  pattern: CamoPattern;
  // パターン周波数(銃ローカル座標系。銃は全長 ~0.9m なので 6-18 が適正)
  scale: number;
  metalness: number;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
}

export const CAMO_VISUALS: Record<CamoId, CamoVisual> = {
  dirt: {
    id: 'dirt', colorA: 0x5a4f3a, colorB: 0x3a3327, colorC: 0x6e6650,
    pattern: 'blotch', scale: 14, metalness: 0.35, roughness: 0.68,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  woodland: {
    id: 'woodland', colorA: 0x3d5a32, colorB: 0x243820, colorC: 0x8a8a5c,
    pattern: 'blotch', scale: 16, metalness: 0.3, roughness: 0.7,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  tiger: {
    id: 'tiger', colorA: 0xc9832e, colorB: 0x191410, colorC: 0x8a5a20,
    pattern: 'stripe', scale: 9, metalness: 0.4, roughness: 0.55,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  blue: {
    id: 'blue', colorA: 0x2e5f9e, colorB: 0x142c4d, colorC: 0x6fa3d8,
    pattern: 'blotch', scale: 15, metalness: 0.55, roughness: 0.45,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  red: {
    id: 'red', colorA: 0xa32626, colorB: 0x330d0d, colorC: 0xd86f6f,
    pattern: 'stripe', scale: 11, metalness: 0.55, roughness: 0.45,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  ghost: {
    id: 'ghost', colorA: 0xb9bfc9, colorB: 0x6f7885, colorC: 0xe9edf4,
    pattern: 'blotch', scale: 18, metalness: 0.45, roughness: 0.5,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  lava: {
    id: 'lava', colorA: 0x1a0d07, colorB: 0xff5a18, colorC: 0xffb13d,
    pattern: 'pulse', scale: 7, metalness: 0.3, roughness: 0.6,
    emissive: 0xff4a10, emissiveIntensity: 0.5,
  },
  neon: {
    id: 'neon', colorA: 0x12151c, colorB: 0x22d9f2, colorC: 0xff3df2,
    pattern: 'stripe', scale: 8, metalness: 0.5, roughness: 0.35,
    emissive: 0x22d9f2, emissiveIntensity: 0.45,
  },
  // ゴールド = 金属金(metalness 1.0 + 金色 + 微発光)
  gold: {
    id: 'gold', colorA: 0xd9a63c, colorB: 0xb0801f, colorC: 0xf2d27a,
    pattern: 'solid', scale: 10, metalness: 1.0, roughness: 0.24,
    emissive: 0x8a5f14, emissiveIntensity: 0.22,
  },
  // ダイヤ = 氷青の結晶ノイズ + 強スペキュラ(低roughness)
  diamond: {
    id: 'diamond', colorA: 0xbfe4ff, colorB: 0x5da4e8, colorC: 0xf2faff,
    pattern: 'facet', scale: 12, metalness: 0.85, roughness: 0.12,
    emissive: 0x9fd0ff, emissiveIntensity: 0.25,
  },
  // ダークマター = 暗紫の脈動ノイズ(uTimeアニメ)
  'dark-matter': {
    id: 'dark-matter', colorA: 0x120520, colorB: 0x5e00a8, colorC: 0xb133ff,
    pattern: 'pulse', scale: 6, metalness: 0.55, roughness: 0.4,
    emissive: 0x7a1fd0, emissiveIntensity: 0.5,
  },
};
