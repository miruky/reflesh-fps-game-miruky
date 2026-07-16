// BO2/BO3式 武器カモチャレンジの純ロジック(段階定義・解除判定・進捗)。
// 保存形式は core/profile.ts、積算は progression.ts、描画は render/viewmodel.ts が担う。
// このモジュールは weapons.ts 以外に依存しない(決定論・副作用なし)。

import {
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  type WeaponClass,
  type WeaponDef,
} from './weapons';

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
  | 'dark-matter'
  | 'tokoyami'
  // R53-W2: Pack-a-Punch「鍛神」3段。kill数ラダー(CAMO_IDS)とは独立の「システム付与カモ」
  // (viewmodel が WeaponDef.papCamo 経由で優先適用する。PAP_CAMO_IDS 参照)
  | 'pap1'
  | 'pap2'
  | 'pap3'
  // R53-W2: 報酬カモ(ストーリー章クリア報酬)。REWARD_CAMO_IDS/REWARD_CAMO_CHAPTER 参照
  | 'jingai'
  | 'shinrai';

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

// ── R53-W2 Pack-a-Punch「鍛神」3段 ──────────────────────────────────────────
// kill数ラダー(CAMO_IDS)・equippedCamoFor の解放判定とは完全に独立。武器へは
// viewmodel.buildGun が WeaponDef.papCamo(matchが凍結ID文字列を積む)を最優先で適用する。
// CAMO_IDS には含めない(ARMORYの通常ピッカー/進捗表示の対象外=システム付与専用)。
export const PAP_CAMO_IDS: readonly CamoId[] = ['pap1', 'pap2', 'pap3'];
export const PAP_CAMO_NAMES: Record<'pap1' | 'pap2' | 'pap3', string> = {
  pap1: '鍛神・壱',
  pap2: '鍛神・弐',
  pap3: '鍛神・参',
};
export function isPapCamoId(id: string): id is 'pap1' | 'pap2' | 'pap3' {
  return (PAP_CAMO_IDS as readonly string[]).includes(id);
}

// ── R53-W2 報酬カモ(ストーリー章クリア報酬) ──────────────────────────────
// 解放条件そのもの(章クリア判定)は progression/match オーナーが配線する。ここでは
// id・表示名・対応章・視覚のみを定義する。isCamoUnlocked/equippedCamoFor/camoProgress は
// 呼び出し側が渡す unlockedRewardCamos(章クリアから算出した集合)を参照する拡張点を持つ。
export const REWARD_CAMO_IDS: readonly CamoId[] = ['jingai', 'shinrai'];
export const REWARD_CAMO_CHAPTER: Record<'jingai' | 'shinrai', string> = {
  jingai: 'ch9',
  shinrai: 'ch10',
};
const REWARD_CAMO_LABEL: Record<'jingai' | 'shinrai', string> = {
  jingai: '第9章クリアで解放',
  shinrai: '第10章クリアで解放',
};
export function isRewardCamoId(id: CamoId): id is 'jingai' | 'shinrai' {
  return (REWARD_CAMO_IDS as readonly string[]).includes(id);
}

export const CAMO_IDS: readonly CamoId[] = [
  ...CAMO_TIERS.map((t) => t.id),
  DIAMOND_CAMO.id,
  DARK_MATTER_CAMO.id,
  ...REWARD_CAMO_IDS,
];

export function isCamoId(id: string): id is CamoId {
  return (CAMO_IDS as readonly string[]).includes(id);
}

// 描画専用: CamoId型の全メンバーを網羅して判定する(通常ラダー(CAMO_IDS)に加え、
// tokoyami(クナイ専用)・pap1-3(PaP専用)も含む)。isCamoId は「解放ゲート対象か」の
// 判定なので、レンダリング側の「既知の見た目定義があるか」判定には本関数を使う
// (R53-W2: buildGunBody の明示camoId経路が isCamoId で pap/tokoyami を弾いていた欠落の根治)。
export function isKnownCamoId(id: string): id is CamoId {
  return Object.prototype.hasOwnProperty.call(CAMO_VISUALS, id);
}

export function camoName(id: CamoId): string {
  if (id === 'diamond') return DIAMOND_CAMO.name;
  if (id === 'dark-matter') return DARK_MATTER_CAMO.name;
  if (id === 'tokoyami') return '常闇';
  if (id === 'pap1' || id === 'pap2' || id === 'pap3') return PAP_CAMO_NAMES[id];
  if (id === 'jingai') return '燼骸';
  if (id === 'shinrai') return '神雷';
  return CAMO_TIERS.find((t) => t.id === id)?.name ?? id;
}

// ── 対象武器とクラス ──────────────────────────────────────────────────────
// カモ対象 = fists(専用ラダー)を除く全プライマリ + 全セカンダリ。
// 同じ武器IDを複数スロットへ公開する将来変更でも分母が二重にならないよう Set で正規化する。
export const CAMO_WEAPON_IDS: readonly string[] = [
  ...new Set([...PRIMARY_IDS.filter((id) => id !== 'fists'), ...SECONDARY_IDS]),
];

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
  exotic: '特殊兵装',
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
  const direct = NAME_TO_ID.get(name);
  if (direct) return direct;
  // R60③: ゾンビの Pack-a-Punch(鍛神台)は表示名へ「・改/改二/改三」を付す。逆引きが外れると
  // camoWeaponId=null になり、PaP後の銃キルがカモ実績に一切計上されなかった(ゾンビでは早期に
  // PaPし大半のキルがこの状態のため「解除が少ない」体感の根本原因)。接尾辞を剥がして基礎IDへ。
  const stripped = name.replace(/・改(?:二|三)?$/, '');
  return NAME_TO_ID.get(stripped) ?? null;
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
// 加わるため「先頭からの連続達成数 = 達成総数」が常に成り立つ。
// 任意の weaponId を渡すと、最終段(gold)の閾値を武器クラス依存の緩和条件
// (goldConditionFor)で判定する。exoticクラスはヘッドショット条件を持たない(キルは500のまま
// =9段ラダーの単調性を保つ)。weaponId 未指定は従来通り CAMO_TIERS の標準閾値(500/100)で
// 判定する(既存呼び出しは完全後方互換)。これにより「ゴールド解除通知(progression)/装備
// ゲート(goldForWeapon)/進捗表示(camoProgress)」の3経路が同じ結論を出す(単一真実源)。
export function camoTierFor(stats: WeaponCamoStats | undefined, weaponId?: string): number {
  const s = stats ?? EMPTY_STATS;
  const gc = weaponId ? goldConditionFor(weaponId) : null;
  let n = 0;
  for (const tier of CAMO_TIERS) {
    const needKills = tier.id === 'gold' && gc ? gc.kills : tier.kills;
    const needHs = tier.id === 'gold' && gc ? gc.headshots : tier.headshots;
    if (s.kills >= needKills && s.headshots >= needHs) n += 1;
    else break;
  }
  return n;
}

// その武器がゴールド到達済みか(武器クラス非依存=後方互換。新コードは goldForWeapon を使う)
export function goldFor(stats: WeaponCamoStats | undefined): boolean {
  return camoTierFor(stats) >= CAMO_TIERS.length;
}

// 特殊兵装のゴールド条件。ビーム/ミニガン/扇/弓に加え、爆風主体で命中部位を
// プレイヤーが安定して選べない業火RLではHSを必要条件にしない。
// 9段ラダーの最終到達点は標準武器と同じ500キルに維持し、金→ダイヤの順序も保つ。
export const EXOTIC_GOLD_KILLS = 500;
export const EXOTIC_GOLD_HS = 0;
export const GOLD_HEADSHOT_EXEMPT_WEAPON_IDS: readonly string[] = ['gouka-rl'];

/**
 * 武器クラスを考慮したゴールド解除条件を返す。
 * exotic クラスと業火RLは 500kills(ヘッドショット不要)、それ以外は標準(500kills+HS100)。
 */
export function goldConditionFor(weaponId: string): { kills: number; headshots: number } {
  const goldTier = CAMO_TIERS.find((t) => t.id === 'gold')!;
  const cls = WEAPON_DEFS[weaponId]?.class;
  if (cls === 'exotic' || GOLD_HEADSHOT_EXEMPT_WEAPON_IDS.includes(weaponId)) {
    return { kills: EXOTIC_GOLD_KILLS, headshots: EXOTIC_GOLD_HS };
  }
  return { kills: goldTier.kills, headshots: goldTier.headshots };
}

/**
 * 武器クラスを考慮したゴールド到達判定。
 * exotic クラスは緩和条件(500kills、HS不要)で判定する。
 * R57-⑤: 前段8段の閾値は goldConditionFor(緩和後の gold 閾値)を上限にキャップして確認する。
 * こうすることで「緩和した gold 閾値が中間段の閾値を下回る」ポリシーに変えても、前段ループが
 * gold 到達を構造的にブロックしない(旧バグ=exotic緩和がneon400に阻まれ到達不能、の再発防止)。
 */
export function goldForWeapon(weaponId: string, stats: WeaponCamoStats | undefined): boolean {
  const s = stats ?? EMPTY_STATS;
  const gc = goldConditionFor(weaponId);
  // gold 手前の 8 段階を確認。ただし各段の要求は gold(緩和後)閾値を超えない範囲に制限する。
  for (let i = 0; i < CAMO_TIERS.length - 1; i++) {
    const tier = CAMO_TIERS[i]!;
    if (s.kills < Math.min(tier.kills, gc.kills)) return false;
    if (s.headshots < Math.min(tier.headshots, gc.headshots)) return false;
  }
  // 最終段(gold)は武器クラス依存条件
  return s.kills >= gc.kills && s.headshots >= gc.headshots;
}

// ダイヤ: 同クラスのカモ対象武器が全てゴールドで解除(exotic は緩和条件で判定)
export function diamondFor(
  cls: WeaponClass,
  allStats: Record<string, WeaponCamoStats>,
): boolean {
  const weapons = camoWeaponsOfClass(cls);
  if (weapons.length === 0) return false;
  return weapons.every((id) => goldForWeapon(id, statsOf(allStats, id)));
}

// ダークマター: 全クラスがダイヤで解除(全武器に適用可)
export function darkMatterFor(allStats: Record<string, WeaponCamoStats>): boolean {
  return CAMO_CLASSES.every((cls) => diamondFor(cls, allStats));
}

// 指定カモが指定武器で解除済みか(diamond はその武器のクラス、dark-matter は全体で判定)。
// rewardUnlocked: 章クリア報酬カモ(jingai/shinrai)の解放集合。progression/menu オーナーが
// campaign.clearedMissions 等から算出して渡す(camo.ts は weapons.ts 以外に依存しないため、
// キャンペーン進行そのものは読みに行かない=呼び出し側が結果だけを渡す拡張点)。未指定(既存
// 呼び出し)は「報酬カモは全て未解放」という安全側デフォルトになる。
export function isCamoUnlocked(
  camoId: CamoId,
  weaponId: string,
  allStats: Record<string, WeaponCamoStats>,
  rewardUnlocked?: ReadonlySet<CamoId> | readonly CamoId[],
): boolean {
  if (!CAMO_WEAPON_IDS.includes(weaponId)) return false;
  if (isRewardCamoId(camoId)) {
    if (!rewardUnlocked) return false;
    return Array.isArray(rewardUnlocked)
      ? rewardUnlocked.includes(camoId)
      : (rewardUnlocked as ReadonlySet<CamoId>).has(camoId);
  }
  if (camoId === 'dark-matter') return darkMatterFor(allStats);
  if (camoId === 'diamond') {
    const cls = camoClassOf(weaponId);
    return cls !== null && diamondFor(cls, allStats);
  }
  const idx = CAMO_TIERS.findIndex((t) => t.id === camoId);
  if (idx < 0) return false;
  // gold(最終段)は武器クラス依存の緩和条件を使う
  if (camoId === 'gold') {
    return goldForWeapon(weaponId, statsOf(allStats, weaponId));
  }
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
  if (isRewardCamoId(camoId)) {
    return { current: 0, target: 1, label: REWARD_CAMO_LABEL[camoId] };
  }
  if (camoId === 'dark-matter') {
    const current = CAMO_CLASSES.filter((cls) => diamondFor(cls, allStats)).length;
    return { current, target: CAMO_CLASSES.length, label: '全クラスでダイヤを解除' };
  }
  if (camoId === 'diamond') {
    const cls = camoClassOf(weaponId);
    const weapons = cls ? camoWeaponsOfClass(cls) : [];
    const current = weapons.filter((id) => goldForWeapon(id, statsOf(allStats, id))).length;
    const clsLabel = cls ? CAMO_CLASS_LABELS[cls] : 'クラス';
    return { current, target: Math.max(1, weapons.length), label: `${clsLabel}全武器をゴールドに` };
  }
  const tier = CAMO_TIERS.find((t) => t.id === camoId);
  if (!tier) return { current: 0, target: 1, label: '' };
  const s = statsOf(allStats, weaponId);
  // ゴールドは武器依存条件(exotic/業火RLは500kills・HS不要)
  const effectiveKills = camoId === 'gold' ? goldConditionFor(weaponId).kills : tier.kills;
  const effectiveHs = camoId === 'gold' ? goldConditionFor(weaponId).headshots : tier.headshots;
  if (effectiveHs > 0 && s.kills >= effectiveKills) {
    // キル条件は満了 → 残るHS条件の進捗を出す(ゴールド)
    return {
      current: Math.min(s.headshots, effectiveHs),
      target: effectiveHs,
      label: `HSキル ${effectiveHs}(累計${effectiveKills}キル達成済)`,
    };
  }
  const label =
    effectiveHs > 0 ? `累計${effectiveKills}キル + HSキル${effectiveHs}` : `累計${effectiveKills}キル`;
  return { current: Math.min(s.kills, effectiveKills), target: effectiveKills, label };
}

// ── クナイ(fists)専用カモラダー ──────────────────────────────────────────
// 標準9段と同じキル閾値。gold は blink-slash キルを fists.headshots で代用。
// 常闇は1000近接キルで解除するクナイ固有の最終カモ。
export const TOKOYAMI_CAMO = { id: 'tokoyami' as const, name: '常闇', xp: 5000 };

// dirt..gold(9段) + tokoyami。diamond/dark-matter はクナイ非対象
export const KUNAI_CAMO_IDS: readonly CamoId[] = [
  ...CAMO_TIERS.map((t) => t.id),
  TOKOYAMI_CAMO.id,
];

export function isKunaiCamoId(id: string): id is CamoId {
  return (KUNAI_CAMO_IDS as readonly string[]).includes(id);
}

export function isKunaiCamoUnlocked(
  camoId: CamoId,
  stats: WeaponCamoStats | undefined,
): boolean {
  const s = stats ?? EMPTY_STATS;
  if (camoId === 'tokoyami') return s.kills >= 1000;
  // dirt..gold: same thresholds as standard. gold adds blink-slash (headshots) condition
  const tierIdx = CAMO_TIERS.findIndex((t) => t.id === camoId);
  if (tierIdx < 0) return false;
  // must have passed every prior tier too
  for (let i = 0; i <= tierIdx; i++) {
    const t = CAMO_TIERS[i]!;
    if (s.kills < t.kills) return false;
    if (t.headshots > 0 && s.headshots < t.headshots) return false;
  }
  return true;
}

export function kunaiCamoProgress(
  camoId: CamoId,
  stats: WeaponCamoStats | undefined,
): CamoProgress {
  const s = stats ?? EMPTY_STATS;
  if (camoId === 'tokoyami') {
    return { current: Math.min(s.kills, 1000), target: 1000, label: '近接キル1000' };
  }
  const tier = CAMO_TIERS.find((t) => t.id === camoId);
  if (!tier) return { current: 0, target: 1, label: '' };
  if (tier.headshots > 0 && s.kills >= tier.kills) {
    return {
      current: Math.min(s.headshots, tier.headshots),
      target: tier.headshots,
      label: `ブリンクスラッシュキル${tier.headshots}(累計${tier.kills}キル達成済)`,
    };
  }
  const label =
    tier.headshots > 0
      ? `累計${tier.kills}キル + ブリンクスラッシュ${tier.headshots}`
      : `累計${tier.kills}キル`;
  return { current: Math.min(s.kills, tier.kills), target: tier.kills, label };
}

// 装備中カモの解決。選択が無い/未解除/不正IDなら null(viewmodel が素の質感で描く)。
// unlockedRewardCamos は isCamoUnlocked と同じ拡張点(章クリア報酬カモの解放集合)。
// PaP鍛神(pap1-3)はこの経路を経由しない(WeaponDef.papCamo をviewmodelが優先適用する
// 独立系統のため、selectedCamos/equippedCamoFor には現れない)。
export function equippedCamoFor(
  weaponId: string,
  profile: {
    selectedCamos: Record<string, string>;
    weaponStats: Record<string, WeaponCamoStats>;
    unlockedRewardCamos?: ReadonlySet<CamoId> | readonly CamoId[];
  },
): CamoId | null {
  const sel = profile.selectedCamos[weaponId];
  if (!sel) return null;
  // クナイ(fists)は専用ラダーで判定
  if (weaponId === 'fists') {
    if (!isKunaiCamoId(sel)) return null;
    const kunaiStats = profile.weaponStats['fists'];
    return isKunaiCamoUnlocked(sel as CamoId, kunaiStats) ? (sel as CamoId) : null;
  }
  if (!isCamoId(sel)) return null;
  return isCamoUnlocked(sel, weaponId, profile.weaponStats, profile.unlockedRewardCamos) ? sel : null;
}

// ── R57-⑤ カモ性能ボーナス(ゴールド/ダイヤ/ダークマター) ─────────────────
// ゴールド/ダイヤ/ダークマターの高位カモは「見た目報酬」だけでなく武器性能を控えめに
// 向上させる。バランスを壊さないためダメージ/RPM/射程/弾数は一切変更せず、ハンドリング系
// (リロード/ADS/持ち替え速度・移動時精度・反動)だけを段階的に強化する。純関数で、元の
// WeaponDef は決して変更しない(通常カモ/未知IDは同一参照をそのまま返す=ゼロコスト)。
//
// 適用ポイント(配線はオーケストレータが match.ts / weapon-preview.ts 側で実施):
//   const camoId = equippedCamoFor(weaponId, profile);   // 解決済みの装備カモ
//   const effectiveDef = camoId ? applyCamoStats(baseDef, camoId) : baseDef;
// applyAttachments の「後段」に挟むこと(アタッチメント適用済み def をさらにコピーして
// ボーナスを乗せる)。ARMORY のスタッツバー(computeWeaponBars)へ applyCamoStats(def,camo) を
// 渡せば既存の ▲/▼ 差分表示(armory.ts renderStats)にそのままボーナスが反映される。

interface CamoStatBonus {
  // <1 で高速化(リロード/ADS/持ち替えの所要ms・移動拡散・反動キック)
  reload: number;
  ads: number;
  swap: number;
  moveSpread?: number; // 移動時拡散(度)。<1 で移動中の精度が上がる
  recoil?: number; // recoilPattern の pitch/yaw を一律スケール。<1 で反動減
  recoilRecovery?: number; // recoilRecoveryPerS を乗算。>1 で収束が速い
  hipSpread?: number; // 腰だめの基礎拡散。<1 で集弾性が上がる
  adsSpread?: number; // ADS時の基礎拡散。<1 で精密射撃が安定する
  bloomPerShot?: number; // 連射ごとの拡散増加。<1 で持続射撃が安定する
  bloomRecovery?: number; // 拡散収束速度。>1 で次のバーストへ早く戻る
}

// 個性を重ねる高位カモ補正。Goldは装填・持ち替えのテンポ、Diamondは
// ADS・集弾・反動制御に特化する。Dark Matterは最終報酬として全項目で
// Diamondを上回り、Goldの最得意分野(装填/持ち替え)も超える。
const CAMO_STAT_BONUS: Partial<Record<CamoId, CamoStatBonus>> = {
  gold: {
    reload: 0.84, ads: 0.9, swap: 0.84,
    bloomRecovery: 1.12,
  },
  diamond: {
    reload: 0.88, ads: 0.84, swap: 0.88,
    moveSpread: 0.76, recoil: 0.76, recoilRecovery: 1.3,
    hipSpread: 0.88, adsSpread: 0.78, bloomPerShot: 0.82, bloomRecovery: 1.28,
  },
  'dark-matter': {
    reload: 0.78, ads: 0.76, swap: 0.76,
    moveSpread: 0.62, recoil: 0.62, recoilRecovery: 1.55,
    hipSpread: 0.76, adsSpread: 0.65, bloomPerShot: 0.68, bloomRecovery: 1.5,
  },
};

/**
 * カモの性能ボーナスを WeaponDef へ適用したコピーを返す(純関数・元defは非破壊)。
 * gold/diamond/dark-matter 以外(通常カモ・未知ID)は素通しで同一参照を返す。
 * ダメージ/RPM/射程/弾数など火力・射程に関わる数値は一切変更しない(バランス維持)。
 */
export function applyCamoStats(def: WeaponDef, camoId: string): WeaponDef {
  const b = CAMO_STAT_BONUS[camoId as CamoId];
  if (!b) return def; // 通常カモ/未装備/未知は素通し(コピーもしない)
  const next: WeaponDef = {
    ...def,
    reloadTacticalMs: def.reloadTacticalMs * b.reload,
    reloadEmptyMs: def.reloadEmptyMs * b.reload,
    adsTimeMs: def.adsTimeMs * b.ads,
    switchMs: def.switchMs * b.swap,
  };
  if (b.moveSpread !== undefined) next.movementSpreadDeg = def.movementSpreadDeg * b.moveSpread;
  if (b.recoil !== undefined) {
    const m = b.recoil;
    // recoilPattern は配列参照なので、変更時は要素ごと clone して元defを汚さない
    next.recoilPattern = def.recoilPattern.map((step) => ({ pitch: step.pitch * m, yaw: step.yaw * m }));
  }
  if (b.recoilRecovery !== undefined) next.recoilRecoveryPerS = def.recoilRecoveryPerS * b.recoilRecovery;
  if (b.hipSpread !== undefined) next.spreadHipDeg = def.spreadHipDeg * b.hipSpread;
  if (b.adsSpread !== undefined) next.spreadAdsDeg = def.spreadAdsDeg * b.adsSpread;
  if (b.bloomPerShot !== undefined) next.bloomPerShotDeg = def.bloomPerShotDeg * b.bloomPerShot;
  if (b.bloomRecovery !== undefined) next.bloomRecoveryDegPerS = def.bloomRecoveryDegPerS * b.bloomRecovery;
  return next;
}

// ── カモ見た目の定義(アセットレス: 色とパターン種のみのデータ) ────────────
// viewmodel.ts が onBeforeCompile の軽量ノイズGLSLへ焼き込み、menu.ts がチップの
// スウォッチ(CSSグラデ)に使う。emissiveIntensity は Bloom 白飛び回避のため 0.5 以下
// (CAMO_IDS対象=通常ラダー+報酬カモ)。pap1-3(CAMO_IDS非対象)は 0.55 以下が上限。
// circuit = R53-W2 追加(PaP鍛神): 静的な二重ノイズ発光脈(viewmodel.camoPatternGLSL実装)。
// diamond-stud = ダイヤ専用。金/オリーブの金属下地へ極小の銀色スタッドを
// 互い違いに高密度配置し、色・粗さ・擬似凹凸を同じマスクで駆動する。
export type CamoPattern =
  | 'blotch'
  | 'stripe'
  | 'facet'
  | 'pulse'
  | 'solid'
  | 'circuit'
  | 'diamond-stud';

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
  // R55: 任意フィールド(既定なし=他カモは無変更)。指定した迷彩だけ挙動が変わる。
  // envMapIntensity: IBL反射の強さ。未指定時は viewmodel 側の既定(近接Bloom回避の抑えめ値)
  // を継承する。diamond のような「鏡面ギラつき」を狙うカモだけ引き上げる想定
  envMapIntensity?: number;
  // sparkle: 0-1。指定時のみ viewmodel が微細ハイライトと低エネルギーの
  // 白金グリッターを onBeforeCompile で焼き込む
  // (法線マップ非使用・アセットレス。emissiveIntensity とは別枠の加算なので白飛び鉄則を
  // 破らない範囲でこの値だけ大きくできる)。0/未指定なら完全に無コスト(分岐ごと省略)。
  sparkle?: number;
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
  // ダイヤ = 参考画像のカスタムライフルを規範にした、金/暗オリーブの金属下地+
  // 高密度の銀色ダイヤスタッド。スタッド中心は白金、外周は暗い銀とし、同じマスクで
  // roughness/metalness/擬似凹凸を切り替える。白発光で塗り潰さず、小さな鏡面が個別に光る。
  diamond: {
    id: 'diamond', colorA: 0x51461e, colorB: 0xc09237, colorC: 0xb9c0c2,
    pattern: 'diamond-stud', scale: 132, metalness: 0.86, roughness: 0.26,
    emissive: 0xc3c9cc, emissiveIntensity: 0.012,
    envMapIntensity: 0.32, sparkle: 0.2,
  },
  // ダークマター = 暗紫の脈動ノイズ(uTimeアニメ)
  'dark-matter': {
    id: 'dark-matter', colorA: 0x120520, colorB: 0x5e00a8, colorC: 0xb133ff,
    pattern: 'pulse', scale: 6, metalness: 0.55, roughness: 0.4,
    emissive: 0x7a1fd0, emissiveIntensity: 0.5,
  },
  // 常闇 = 絶対暗黒(クナイ専用。fists 1000近接キルで解除)
  tokoyami: {
    id: 'tokoyami', colorA: 0x000000, colorB: 0x060006, colorC: 0x1a001a,
    pattern: 'pulse', scale: 5, metalness: 0.15, roughness: 0.98,
    emissive: 0x000000, emissiveIntensity: 0,
  },
  // ── R53-W2 Pack-a-Punch「鍛神」3段(システム付与・CAMO_IDS非対象) ──────────
  // pap1 = 橙の回路脈(静的・circuit)。暗鋼基板に細い発光ラインが走る初段
  pap1: {
    id: 'pap1', colorA: 0x120a06, colorB: 0xff7a1a, colorC: 0xffb066,
    pattern: 'circuit', scale: 11, metalness: 0.55, roughness: 0.5,
    emissive: 0xff5a10, emissiveIntensity: 0.5,
  },
  // pap2 = 金の回路脈+微パルス(既存の uCamoTime 基盤を再利用する pulse パターン)
  pap2: {
    id: 'pap2', colorA: 0x14100a, colorB: 0xd9a63c, colorC: 0xfff0c2,
    pattern: 'pulse', scale: 9, metalness: 0.65, roughness: 0.38,
    emissive: 0xd9a63c, emissiveIntensity: 0.5,
  },
  // pap3 = 白金+黒地の高密度回路(静的circuit・scaleを上げて脈を密にする)
  pap3: {
    id: 'pap3', colorA: 0x0a0a0c, colorB: 0xe8ecf2, colorC: 0xffe9a8,
    pattern: 'circuit', scale: 17, metalness: 0.78, roughness: 0.22,
    emissive: 0xdfe6f2, emissiveIntensity: 0.5,
  },
  // ── R53-W2 報酬カモ(ストーリー章クリア報酬) ─────────────────────────────
  // 燼骸(jingai) = 灰白のひび割れ+黒地(ch9報酬)。facetの稜線をひび割れに見立てる
  jingai: {
    id: 'jingai', colorA: 0x0d0d0d, colorB: 0xcfcdc4, colorC: 0xe8e6de,
    pattern: 'facet', scale: 14, metalness: 0.2, roughness: 0.85,
    emissive: 0xff6a2c, emissiveIntensity: 0.2,
  },
  // 神雷(shinrai) = 藍黒地+氷青の雷紋(ch10報酬)。pulseの脈動をクナイ映えする電光に
  shinrai: {
    id: 'shinrai', colorA: 0x0a0e1c, colorB: 0x3fa8ff, colorC: 0xdff3ff,
    pattern: 'pulse', scale: 8, metalness: 0.5, roughness: 0.4,
    emissive: 0x5fc0ff, emissiveIntensity: 0.45,
  },
};
