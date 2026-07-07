// XP・レベル・アンロック・チャレンジ・ランクの計算。保存形式はprofile.tsが扱う

import { CAMPAIGN, missionById, type ModifierId } from './campaign';
import type { Difficulty } from './bot';
import type { GameMode } from './modes';
import {
  applyDailies,
  dateStringFromSeed,
  todayDateSeed,
  emptyDailyState,
  type DailyState,
} from './dailies';
import {
  CAMO_CLASS_LABELS,
  CAMO_TIERS,
  camoClassOf,
  camoTierFor,
  DARK_MATTER_CAMO,
  darkMatterFor,
  DIAMOND_CAMO,
  diamondFor,
  weaponNameOf,
  type CamoId,
  type WeaponCamoStats,
} from './camo';
import type { WeaponClass } from './weapons';

// DailyState / emptyDailyState は dailies.ts で定義 → ここで re-export して後方互換を保つ
export type { DailyState };
export { emptyDailyState };

export interface CareerStats {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  captures: number;
  bestStreak: number;
}

// 1試合単位の自己ベスト。累計のCareerStatsとは別に「最高の一戦」を覚えておく
export interface PersonalRecords {
  // 1試合での最多キル
  mostKills: number;
  // 連勝の最長記録と現在の連勝数(敗北で0へ戻る)
  bestWinStreak: number;
  currentWinStreak: number;
}

// ── R6 キャンペーン進行 ──
export interface MissionBest {
  bestTimeS: number;
  stars: number; // 0..3。表示時に parTimeS から再計算もできる
  difficulty: Difficulty;
}

export interface CampaignState {
  clearedMissions: string[];
  unlockedChapters: string[]; // 既定 ['ch1']
  missionBests: Record<string, MissionBest>;
}

export interface Profile {
  xp: number;
  rating: number;
  stats: CareerStats;
  records: PersonalRecords;
  completedChallenges: string[];
  // 表示名ごとのキル数(武器・投擲物・近接)
  weaponKills: Record<string, number>;
  // 武器IDごとのカモ用累計統計(kills/ヘッドショットキル)。カモチャレンジの単一真実源
  weaponStats: Record<string, WeaponCamoStats>;
  // 武器IDごとの選択中カモID(未選択キーは無し)。装備可否は camo.ts が毎回検証する
  selectedCamos: Record<string, string>;
  // 初取得済みメダルID(初回バッジ解放の判定に使う)
  unlockedMedals: string[];
  // メダルIDごとの累計取得回数
  medalCounts: Record<string, number>;
  // キャンペーン進行(章/ミッション解放・クリア・自己ベスト)
  campaign: CampaignState;
  // スコアアタックの自己ベスト(curatedステージidのみ・件数キャップ)
  scoreRecords: Record<string, number>;
  // デイリーチャレンジ + ストリーク
  daily: DailyState;
}

export interface MatchSummary {
  won: boolean;
  rated: boolean; // リザルトまで到達した試合のみtrue。中断はレートを動かさない
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  captures: number;
  bestStreak: number;
  weaponKills: Record<string, number>;
  // 武器IDごとのプレイヤーキル数(カモチャレンジ用・省略可=旧経路互換)
  killsByWeapon?: Record<string, number>;
  // 武器IDごとのヘッドショットキル数(カモのゴールド条件用・省略可)
  hsByWeapon?: Record<string, number>;
  // この試合で初解放したメダルID
  unlockedMedals: string[];
  // この試合で取得したメダルIDごとの回数
  medalCounts: Record<string, number>;
  // この試合のメダルXP合計
  medalXp: number;
}

export function emptyProfile(): Profile {
  return {
    xp: 0,
    rating: 1000,
    stats: {
      matches: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      captures: 0,
      bestStreak: 0,
    },
    records: {
      mostKills: 0,
      bestWinStreak: 0,
      currentWinStreak: 0,
    },
    completedChallenges: [],
    weaponKills: {},
    weaponStats: {},
    selectedCamos: {},
    unlockedMedals: [],
    medalCounts: {},
    // 第1章のみ最初から解放(全既存セーブも第1章から開始でき、softlock回避)
    campaign: { clearedMissions: [], unlockedChapters: ['ch1'], missionBests: {} },
    scoreRecords: {},
    daily: emptyDailyState(),
  };
}

// XP乗数定数。呼び出し側(main.ts)はこれをそのまま applyMatch/applyCampaignMission の xpMul に渡す。
// 訓練モードは統計汚染防止のため呼び出し側で xpMul 適用をスキップする(ここでは定義しない)。
export const XP_MUL_NORMAL = 500; // 通常(非ゾンビ)モード — 試合XP全体に掛ける乗数
export const XP_MUL_ZOMBIE =  25; // ゾンビモード — 試合XP全体に掛ける乗数

// レベルnからn+1へ必要なXP。
// L1-99:    750 + (n-1)*250 の一次曲線(既存セーブとの後方互換を維持するため不変)。
// L100-499: +100/レベルで緩やかに成長(高原フェーズ1)。
// L500-999: +50/レベルでさらに緩やかに成長(高原フェーズ2)。
// L1000-9999: +25/レベルでさらに高原化(L999=90_450 との連続性を維持)。
// L10000-99998: +10/レベルで究極高原化(L9999=315_450 との連続性を維持)。
// 単調増加・オーバーフロー無し・最大値は xpToNext(99998)=1_215_440 で Number.MAX_SAFE_INTEGER と十分離れている。
export function xpToNext(level: number): number {
  if (level < 100) {
    // L1-99 は旧曲線と同一(後方互換)
    return 750 + (level - 1) * 250;
  }
  if (level < 500) {
    // L100-499: 25_500 → 65_400 (+100/レベル)
    return 25_500 + (level - 100) * 100;
  }
  if (level < 1000) {
    // L500-999: 65_500 → 90_450 (+50/レベル)
    return 65_500 + (level - 500) * 50;
  }
  if (level < 10000) {
    // L1000-9999: さらに高原化(+25/レベル)。xpToNext(999)=90_450 との連続性を維持。
    return 90_450 + (level - 999) * 25;
  }
  // L10000-99998: 究極高原化(+10/レベル)。xpToNext(9999)=315_450 との連続性を維持。
  return 315_450 + (level - 9999) * 10;
}

export const MAX_LEVEL = 99999;

export interface LevelState {
  level: number;
  intoLevel: number;
  toNext: number;
}

export function levelFromXp(xp: number): LevelState {
  let level = 1;
  let rest = Math.max(0, xp);
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, intoLevel: rest, toNext: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

// アンロック対象。武器とアタッチメントをレベルで開放する
export interface UnlockDef {
  kind: 'weapon' | 'attachment';
  id: string;
  name: string;
  level: number;
}

export const UNLOCKS: UnlockDef[] = [
  // 既存クラス各1本(L1-6)を温存
  { kind: 'weapon', id: 'kaede-ar', name: 'カエデAR', level: 1 },
  { kind: 'weapon', id: 'tsubaki-smg', name: 'ツバキSMG', level: 2 },
  { kind: 'attachment', id: 'reflex', name: 'リフレックスサイト', level: 2 },
  { kind: 'weapon', id: 'hiiragi-sg', name: 'ヒイラギSG', level: 3 },
  { kind: 'attachment', id: 'vertical', name: 'バーティカルグリップ', level: 3 },
  { kind: 'weapon', id: 'yamasemi-dmr', name: 'DSR', level: 4 },
  { kind: 'weapon', id: 'kawasemi-pistol', name: 'カワセミ', level: 4 },
  { kind: 'attachment', id: 'extended', name: '拡張マガジン', level: 4 },
  { kind: 'weapon', id: 'miyama-br', name: 'ミヤマBR', level: 5 },
  { kind: 'attachment', id: 'suppressor', name: 'サプレッサー', level: 5 },
  { kind: 'weapon', id: 'kumagera-lmg', name: 'クマゲラLMG', level: 6 },
  { kind: 'attachment', id: 'angled', name: 'アングルドグリップ', level: 6 },
  // ── ③追加光学8種を段階配置(pico/holo 早期→delta/canted 中盤→acog/variable/hybrid/thermal 後半) ──
  { kind: 'attachment', id: 'pico', name: 'ピコドット', level: 3 },
  { kind: 'attachment', id: 'holographic', name: 'ホロサイト', level: 5 },
  { kind: 'attachment', id: 'delta', name: 'デルタサイト', level: 8 },
  { kind: 'attachment', id: 'canted', name: 'カンテッドサイト', level: 10 },
  { kind: 'attachment', id: 'acog', name: 'ACOGスコープ', level: 12 },
  { kind: 'attachment', id: 'variable', name: 'バリアブルスコープ', level: 15 },
  { kind: 'attachment', id: 'hybrid', name: 'ハイブリッドサイト', level: 18 },
  { kind: 'attachment', id: 'thermal', name: 'リコンスコープ', level: 22 },
  // 追加18プライマリを L7-L24 へ1本/レベルで配置
  { kind: 'weapon', id: 'kasasagi-ar', name: 'カササギAR', level: 7 },
  { kind: 'attachment', id: 'compensator', name: 'コンペンセイター', level: 7 },
  { kind: 'weapon', id: 'ginyanma-ar', name: 'ギンヤンマAR', level: 8 },
  { kind: 'attachment', id: 'telescopic', name: 'テレスコピックサイト', level: 8 },
  { kind: 'weapon', id: 'hayabusa-smg', name: 'ハヤブサSMG', level: 9 },
  { kind: 'attachment', id: 'quick', name: 'クイックマガジン', level: 9 },
  { kind: 'weapon', id: 'akatsuki-ar', name: 'アカツキAR', level: 10 },
  { kind: 'weapon', id: 'taka-revolver', name: 'タカ', level: 10 },
  { kind: 'weapon', id: 'sasameki-smg', name: 'ササメキSMG', level: 11 },
  { kind: 'weapon', id: 'kagerou-br', name: 'カゲロウBR', level: 12 },
  { kind: 'weapon', id: 'shinonome-ar', name: 'シノノメAR', level: 13 },
  { kind: 'weapon', id: 'mozu-smg', name: 'モズSMG', level: 14 },
  { kind: 'weapon', id: 'kogarashi', name: 'コガラシ', level: 14 },
  { kind: 'weapon', id: 'enaga-pdw', name: 'エナガPDW', level: 15 },
  { kind: 'weapon', id: 'tobikuma-ar', name: 'トビクモAR', level: 16 },
  { kind: 'weapon', id: 'shirasagi-mk', name: 'シラサギMK', level: 17 },
  { kind: 'weapon', id: 'fukurou-sg', name: 'フクロウSG', level: 18 },
  { kind: 'weapon', id: 'tsuchigumo-lmg', name: 'ツチグモLMG', level: 19 },
  { kind: 'weapon', id: 'hibari-mk', name: 'ヒバリMK', level: 20 },
  { kind: 'weapon', id: 'raijin-sg', name: 'ライジンSG', level: 21 },
  { kind: 'weapon', id: 'raitei-lmg', name: 'ライテイLMG', level: 22 },
  { kind: 'weapon', id: 'raicho-sniper', name: 'ライチョウ', level: 23 },
  { kind: 'weapon', id: 'shirayuki-sniper', name: 'シラユキ', level: 24 },
];

export function unlockLevelOf(kind: 'weapon' | 'attachment', id: string): number {
  const def = UNLOCKS.find((u) => u.kind === kind && u.id === id);
  return def ? def.level : 1;
}

export function isUnlocked(kind: 'weapon' | 'attachment', id: string, level: number): boolean {
  return level >= unlockLevelOf(kind, id);
}

export interface ChallengeDef {
  id: string;
  name: string;
  desc: string;
  xp: number;
  // 試合後の累計statsと当該試合の内容から達成を判定する
  test: (career: CareerStats, match: MatchSummary, weaponKills: Record<string, number>) => boolean;
  // 進捗表示用。現在値と目標値
  progress: (career: CareerStats, weaponKills: Record<string, number>) => [number, number];
}

const grenadeKills = (weaponKills: Record<string, number>): number =>
  (weaponKills['フラグ'] ?? 0) + (weaponKills['焼夷'] ?? 0);

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'first-blood',
    name: '初陣',
    desc: '初めてのキルを取る',
    xp: 200,
    test: (career) => career.kills >= 1,
    progress: (career) => [Math.min(career.kills, 1), 1],
  },
  {
    id: 'killer-50',
    name: '歴戦',
    desc: '累計50キル',
    xp: 500,
    test: (career) => career.kills >= 50,
    progress: (career) => [Math.min(career.kills, 50), 50],
  },
  {
    id: 'killer-200',
    name: '百戦錬磨',
    desc: '累計200キル',
    xp: 1000,
    test: (career) => career.kills >= 200,
    progress: (career) => [Math.min(career.kills, 200), 200],
  },
  {
    id: 'headhunter-25',
    name: '急所狙い',
    desc: 'ヘッドショット累計25回',
    xp: 500,
    test: (career) => career.headshots >= 25,
    progress: (career) => [Math.min(career.headshots, 25), 25],
  },
  {
    id: 'sharpshooter',
    name: '精密射撃',
    desc: '1試合で命中率50%以上(10発以上)',
    xp: 300,
    test: (_career, match) => match.shotsFired >= 10 && match.shotsHit / match.shotsFired >= 0.5,
    progress: () => [0, 1],
  },
  {
    id: 'rampage',
    name: '連続撃破',
    desc: '1試合で5連続キル',
    xp: 400,
    test: (_career, match) => match.bestStreak >= 5,
    progress: () => [0, 1],
  },
  {
    id: 'conqueror-10',
    name: '制圧者',
    desc: '拠点制圧 累計10回',
    xp: 500,
    test: (career) => career.captures >= 10,
    progress: (career) => [Math.min(career.captures, 10), 10],
  },
  {
    id: 'winner-10',
    name: '常勝',
    desc: '勝利 累計10回',
    xp: 600,
    test: (career) => career.wins >= 10,
    progress: (career) => [Math.min(career.wins, 10), 10],
  },
  {
    id: 'grenadier-20',
    name: '爆発物取扱者',
    desc: '投擲物キル 累計20回',
    xp: 400,
    test: (_career, _match, weaponKills) => grenadeKills(weaponKills) >= 20,
    progress: (_career, weaponKills) => [Math.min(grenadeKills(weaponKills), 20), 20],
  },
  {
    id: 'melee-10',
    name: '白兵戦',
    desc: '近接キル 累計10回',
    xp: 400,
    test: (_career, _match, weaponKills) => (weaponKills['近接'] ?? 0) >= 10,
    progress: (_career, weaponKills) => [Math.min(weaponKills['近接'] ?? 0, 10), 10],
  },
];

export interface RankDef {
  name: string;
  rating: number;
}

export const RANKS: RankDef[] = [
  { name: '新兵', rating: 0 },
  { name: '伍長', rating: 1050 },
  { name: '軍曹', rating: 1150 },
  { name: '曹長', rating: 1250 },
  { name: '少尉', rating: 1350 },
  { name: '中尉', rating: 1450 },
  { name: '大尉', rating: 1550 },
  { name: '少佐', rating: 1700 },
  { name: '大佐', rating: 1850 },
  { name: '将官', rating: 2000 },
];

export function rankFromRating(rating: number): RankDef {
  let current = RANKS[0]!;
  for (const rank of RANKS) {
    if (rating >= rank.rating) current = rank;
  }
  return current;
}

// ── レベル帯ランク名(レーティングとは独立した、累積レベルによる階位) ────────────────
// L1-999: 100刻み10段 / L1000-9999: 1000刻み10段(L9999のみ単独「創世神」)
// L10000-99999: 10000刻み10段(超越階級・日本神話)
export interface RankName {
  name: string;
  tier: number; // 0(新兵) 〜 29(森羅万象)
}

// 降順に並べ、初めて level >= minLevel となるエントリを返す
const LEVEL_RANK_TABLE: ReadonlyArray<{ minLevel: number; name: string; tier: number }> = [
  // ── 超越階級 L10000-L99999 (tier 20-29) ─────────────────────────────────────
  { minLevel: 99999, name: '森羅万象', tier: 29 }, // 宇宙万物を超越する究極の境地
  { minLevel: 90000, name: '天地開闢', tier: 28 }, // 天地の創造そのもの
  { minLevel: 80000, name: '高御産',   tier: 27 }, // 高御産巣日神 — 天の創造神
  { minLevel: 70000, name: '豊雲野',   tier: 26 }, // 豊雲野神 — 神世の大気を満たす神
  { minLevel: 60000, name: '国常立',   tier: 25 }, // 国之常立神 — 大地の永遠の神
  { minLevel: 50000, name: '御中主',   tier: 24 }, // 天之御中主神 — 天の中心に鎮座する始原神
  { minLevel: 40000, name: '伊邪那岐', tier: 23 }, // 天地の創造主、黄泉から帰還した神
  { minLevel: 30000, name: '月読',     tier: 22 }, // 月読命 — 夜の世界を治める月神
  { minLevel: 20000, name: '須佐之男', tier: 21 }, // 須佐之男命 — 嵐と剣の覇神
  { minLevel: 10000, name: '天照',     tier: 20 }, // 天照大神 — 高天原を統べる太陽神
  // ── 神話階級 L1000-L9999 (tier 10-19) ──────────────────────────────────────
  { minLevel:  9999, name: '創世神',   tier: 19 },
  { minLevel:  9000, name: '神話',     tier: 18 },
  { minLevel:  8000, name: '神威',     tier: 17 },
  { minLevel:  7000, name: '破壊神',   tier: 16 },
  { minLevel:  6000, name: '軍神',     tier: 15 },
  { minLevel:  5000, name: '天下無双', tier: 14 },
  { minLevel:  4000, name: '戦神',     tier: 13 },
  { minLevel:  3000, name: '雷神',     tier: 12 },
  { minLevel:  2000, name: '武神',     tier: 11 },
  { minLevel:  1000, name: '剣聖',     tier: 10 },
  // ── 武人階級 L1-L999 (tier 0-9) ─────────────────────────────────────────────
  { minLevel:   900, name: '覇王',     tier:  9 },
  { minLevel:   800, name: '羅刹',     tier:  8 },
  { minLevel:   700, name: '鬼神',     tier:  7 },
  { minLevel:   600, name: '修羅',     tier:  6 },
  { minLevel:   500, name: '剣豪',     tier:  5 },
  { minLevel:   400, name: '侍大将',   tier:  4 },
  { minLevel:   300, name: '侍',       tier:  3 },
  { minLevel:   200, name: '武者',     tier:  2 },
  { minLevel:   100, name: '足軽',     tier:  1 },
  { minLevel:     1, name: '新兵',     tier:  0 },
];

export function rankNameFor(level: number): RankName {
  for (const r of LEVEL_RANK_TABLE) {
    if (level >= r.minLevel) return { name: r.name, tier: r.tier };
  }
  return { name: '新兵', tier: 0 };
}

/**
 * 前後レベルランクのtier変化を検出するヘルパ(リザルト・昇位演出用)。
 * tier が上がった場合は新ランクの RankName を返す。変化なしは null。
 */
export function levelRankUpgrade(levelBefore: LevelState, levelAfter: LevelState): RankName | null {
  const before = rankNameFor(levelBefore.level);
  const after = rankNameFor(levelAfter.level);
  return after.tier > before.tier ? after : null;
}

const RATING_WIN = 25;
const RATING_LOSS = -15;

export interface XpEntry {
  label: string;
  xp: number;
}

// この試合で新規解除したカモ(リザルトの「カモ解除!」行に使う)
export interface CamoUnlock {
  camoId: CamoId;
  camoName: string;
  // 段階/ゴールドは対象武器、diamond はクラス、dark-matter は全体(weaponId 無し)
  weaponId: string | null;
  label: string;
  xp: number;
}

export interface MatchProgress {
  xpBreakdown: XpEntry[];
  xpTotal: number;
  levelBefore: LevelState;
  levelAfter: LevelState;
  newUnlocks: UnlockDef[];
  completedChallenges: ChallengeDef[];
  ratingBefore: number;
  ratingAfter: number;
  rankBefore: RankDef;
  rankAfter: RankDef;
  // この試合で更新した自己ベストの説明(なければ空)
  newRecords: string[];
  // この試合で解除したカモ(なければ空)
  newCamos: CamoUnlock[];
}

// カモ統計の積算と新規解除の検出。profile.weaponStats はエントリ差し替えで更新する
// (before スナップショットが浅いコピーで済む)。解除XPは呼び側が xpBreakdown へ積む。
function applyCamoStats(profile: Profile, summary: MatchSummary): CamoUnlock[] {
  const kbw = summary.killsByWeapon ?? {};
  const hbw = summary.hsByWeapon ?? {};
  const touched = new Set([...Object.keys(kbw), ...Object.keys(hbw)]);
  if (touched.size === 0) return [];

  const before = { ...profile.weaponStats };
  for (const id of touched) {
    const prev = profile.weaponStats[id] ?? { kills: 0, headshots: 0 };
    profile.weaponStats[id] = {
      kills: prev.kills + Math.max(0, kbw[id] ?? 0),
      headshots: prev.headshots + Math.max(0, hbw[id] ?? 0),
    };
  }

  const unlocks: CamoUnlock[] = [];
  const classesTouched = new Set<WeaponClass>();
  for (const id of touched) {
    const cls = camoClassOf(id);
    if (!cls) continue; // 副武器/近接などカモ対象外は統計のみ積む
    classesTouched.add(cls);
    const tierBefore = camoTierFor(before[id]);
    const tierAfter = camoTierFor(profile.weaponStats[id]);
    for (let t = tierBefore; t < tierAfter; t += 1) {
      const tier = CAMO_TIERS[t]!;
      unlocks.push({
        camoId: tier.id,
        camoName: tier.name,
        weaponId: id,
        label: `${weaponNameOf(id)}「${tier.name}」`,
        xp: tier.xp,
      });
    }
  }
  // ダイヤ: 影響を受けたクラスのみ before/after 比較(1試合で複数クラス同時成立も拾う)
  for (const cls of classesTouched) {
    if (!diamondFor(cls, before) && diamondFor(cls, profile.weaponStats)) {
      unlocks.push({
        camoId: DIAMOND_CAMO.id,
        camoName: DIAMOND_CAMO.name,
        weaponId: null,
        label: `${CAMO_CLASS_LABELS[cls]}全武器「${DIAMOND_CAMO.name}」`,
        xp: DIAMOND_CAMO.xp,
      });
    }
  }
  // ダークマター: 全クラスダイヤの成立瞬間を検出
  if (!darkMatterFor(before) && darkMatterFor(profile.weaponStats)) {
    unlocks.push({
      camoId: DARK_MATTER_CAMO.id,
      camoName: DARK_MATTER_CAMO.name,
      weaponId: null,
      label: `全クラス制覇「${DARK_MATTER_CAMO.name}」`,
      xp: DARK_MATTER_CAMO.xp,
    });
  }
  return unlocks;
}

// 試合結果をプロフィールへ反映する。profileはその場で更新される。
// xpMul: 1試合のXP全体に掛ける乗数(省略=1)。ゾンビ以外の全モードは ×10 を推奨。
// mode: ゲームモード(省略時はデイリーチャレンジ判定をスキップ)。
export function applyMatch(
  profile: Profile,
  summary: MatchSummary,
  xpMul = 1,
  mode?: GameMode,
): MatchProgress {
  return accumulateMatch(profile, summary, {
    rated: summary.rated,
    trackWinStreak: true,
    xpMul,
    mode,
  });
}

// applyMatch / applyCampaignMission の共通の積算。rating と連勝記録の扱いだけ呼び側で切り替える
// (キャンペーンは競技レート・PvP連勝記録を汚染しない)
function accumulateMatch(
  profile: Profile,
  summary: MatchSummary,
  opts: { rated: boolean; trackWinStreak: boolean; xpMul?: number; mode?: GameMode },
): MatchProgress {
  const stats = profile.stats;
  stats.matches += 1;
  if (summary.won) stats.wins += 1;
  stats.kills += summary.kills;
  stats.deaths += summary.deaths;
  stats.headshots += summary.headshots;
  stats.shotsFired += summary.shotsFired;
  stats.shotsHit += summary.shotsHit;
  stats.captures += summary.captures;
  stats.bestStreak = Math.max(stats.bestStreak, summary.bestStreak);
  for (const [name, count] of Object.entries(summary.weaponKills)) {
    profile.weaponKills[name] = (profile.weaponKills[name] ?? 0) + count;
  }
  // メダル: 初解放IDの重複なしマージ + 取得回数の加算マージ
  for (const id of summary.unlockedMedals) {
    if (!profile.unlockedMedals.includes(id)) profile.unlockedMedals.push(id);
  }
  for (const [id, count] of Object.entries(summary.medalCounts)) {
    profile.medalCounts[id] = (profile.medalCounts[id] ?? 0) + count;
  }
  // カモ: 武器ID別統計の積算と新規解除の検出(XPは下のbreakdownで計上する)
  const newCamos = applyCamoStats(profile, summary);

  // 自己ベストの更新。更新したものは結果画面で知らせる
  const records = profile.records;
  const newRecords: string[] = [];
  if (summary.kills > records.mostKills) {
    records.mostKills = summary.kills;
    if (summary.kills > 0) newRecords.push(`1試合最多キル ${summary.kills}`);
  }
  if (opts.trackWinStreak) {
    if (summary.won) {
      records.currentWinStreak += 1;
      if (records.currentWinStreak > records.bestWinStreak) {
        records.bestWinStreak = records.currentWinStreak;
        if (records.currentWinStreak >= 2) newRecords.push(`連勝 ${records.currentWinStreak}`);
      }
    } else {
      // R48 ユーザー要望「敗北をなかったことに」: 連勝は敗北でリセットしない
      // (勝利のみが記録を進める。currentWinStreak は事実上「積み上げ連勝」)
    }
  }

  const xpBreakdown: XpEntry[] = [];
  xpBreakdown.push({ label: summary.won ? '勝利' : '試合参加', xp: summary.won ? 500 : 150 });
  if (summary.kills > 0)
    xpBreakdown.push({ label: `キル x${summary.kills}`, xp: summary.kills * 100 });
  if (summary.headshots > 0) {
    xpBreakdown.push({ label: `ヘッドショット x${summary.headshots}`, xp: summary.headshots * 25 });
  }
  if (summary.captures > 0) {
    xpBreakdown.push({ label: `拠点制圧 x${summary.captures}`, xp: summary.captures * 150 });
  }
  // メダルXPは試合中のトーストとは別に、リザルトで1行だけ計上する(二重計上回避)
  if (summary.medalXp > 0) xpBreakdown.push({ label: 'メダル', xp: summary.medalXp });

  // カモ解除行(xpBreakdown 流儀でリザルトに1行ずつ出る)
  for (const camo of newCamos) {
    xpBreakdown.push({ label: `カモ解除: ${camo.label}`, xp: camo.xp });
  }

  const completed: ChallengeDef[] = [];
  for (const challenge of CHALLENGES) {
    if (profile.completedChallenges.includes(challenge.id)) continue;
    if (challenge.test(stats, summary, profile.weaponKills)) {
      profile.completedChallenges.push(challenge.id);
      completed.push(challenge);
      xpBreakdown.push({ label: `任務達成: ${challenge.name}`, xp: challenge.xp });
    }
  }

  // 非ゾンビ全モードのXP乗数適用(リザルト表示との一貫性のため breakdown ごと乗せる)
  const mul = opts.xpMul ?? 1;
  if (mul !== 1) {
    for (const e of xpBreakdown) e.xp = Math.round(e.xp * mul);
  }

  // ── デイリーチャレンジ判定(xpMul対象外の固定XP。モード指定時のみ実行)──
  // デイリー報酬は乗数をかけない固定値なので、乗算ブロックの後に追加する。
  if (opts.mode !== undefined) {
    const dateSeed = todayDateSeed();
    const nowDate = dateStringFromSeed(dateSeed);
    const dailyEntries = applyDailies(profile.daily, summary, opts.mode, nowDate, dateSeed);
    for (const e of dailyEntries) xpBreakdown.push(e);
  }

  const xpTotal = xpBreakdown.reduce((sum, entry) => sum + entry.xp, 0);
  const levelBefore = levelFromXp(profile.xp);
  profile.xp += xpTotal;
  const levelAfter = levelFromXp(profile.xp);

  const newUnlocks = UNLOCKS.filter(
    (u) => u.level > levelBefore.level && u.level <= levelAfter.level,
  );

  const ratingBefore = profile.rating;
  if (opts.rated) {
    profile.rating = Math.max(0, profile.rating + (summary.won ? RATING_WIN : RATING_LOSS));
  }

  return {
    xpBreakdown,
    xpTotal,
    levelBefore,
    levelAfter,
    newUnlocks,
    completedChallenges: completed,
    ratingBefore,
    ratingAfter: profile.rating,
    rankBefore: rankFromRating(ratingBefore),
    rankAfter: rankFromRating(profile.rating),
    newRecords,
    newCamos,
  };
}

// ── キャンペーンの進行ロジック ──────────────────────────────────

export interface MissionSummary extends MatchSummary {
  missionId: string;
  chapterId: string;
  missionWon: boolean;
  timeS: number;
  objectiveMet: boolean;
  modifiers: ModifierId[];
}

export interface CampaignProgress extends MatchProgress {
  missionId: string;
  firstClear: boolean;
  stars: number;
  chapterUnlocked: string | null;
  missionBest: MissionBest | null;
}

// 星評価: 勝利=1★、par以内で+1★、モディファイア有りで+1★(最大3)。敗北は0。
export function starRate(timeS: number, parTimeS: number, modCount: number): number {
  let s = 1;
  if (timeS <= parTimeS) s += 1;
  if (modCount > 0) s += 1;
  return Math.min(3, s);
}

// 章の全6ミッションがクリア済みか
export function chapterCleared(profile: Profile, chapterId: string): boolean {
  const ch = CAMPAIGN.find((c) => c.id === chapterId);
  if (!ch) return false;
  return ch.missions.every((m) => profile.campaign.clearedMissions.includes(m.id));
}

// 次章のID(無ければnull)
export function nextChapterId(chapterId: string): string | null {
  const i = CAMPAIGN.findIndex((c) => c.id === chapterId);
  if (i < 0 || i + 1 >= CAMPAIGN.length) return null;
  return CAMPAIGN[i + 1]!.id;
}

// ミッションが選択可能か: 所属章が解放済み かつ (先頭 or 直前ミッションがクリア済み)
export function isMissionUnlocked(profile: Profile, missionId: string): boolean {
  const m = missionById(missionId);
  if (!m) return false;
  if (!profile.campaign.unlockedChapters.includes(m.chapterId)) return false;
  if (m.index === 0) return true;
  const ch = CAMPAIGN.find((c) => c.id === m.chapterId);
  const prev = ch?.missions[m.index - 1];
  return prev ? profile.campaign.clearedMissions.includes(prev.id) : true;
}

const SCORE_RECORD_CAP = 64; // localStorage肥大化を防ぐ件数上限

// スコアアタックの自己ベスト更新。新記録なら true。curatedステージのみ呼ぶ想定。
export function applyScoreRecord(profile: Profile, key: string, kills: number): boolean {
  if (!Number.isFinite(kills) || kills <= 0) return false;
  const prev = profile.scoreRecords[key] ?? 0;
  if (kills <= prev) return false;
  // 上限超過時は最小値の記録を1件落として枠を空ける。ただし新記録が最小値以下なら
  // 既存のより高い記録を低い値で潰してしまうので、追い出さず保存も諦める
  const keys = Object.keys(profile.scoreRecords);
  if (prev === 0 && keys.length >= SCORE_RECORD_CAP) {
    let minKey = keys[0]!;
    for (const k of keys) if ((profile.scoreRecords[k] ?? 0) < (profile.scoreRecords[minKey] ?? 0)) minKey = k;
    if (kills <= (profile.scoreRecords[minKey] ?? 0)) return false;
    delete profile.scoreRecords[minKey];
  }
  profile.scoreRecords[key] = kills;
  return true;
}

// ミッション結果をプロフィールへ反映。XP/stats/メダルは共通積算、加えてクリア記録・
// 星・章解放・初制圧ボーナスを処理する。競技レート/PvP連勝は汚染しない。
// xpMul: ゾンビ以外の全モード同様に ×10 を推奨。
export function applyCampaignMission(profile: Profile, summary: MissionSummary, xpMul = 1): CampaignProgress {
  const base = accumulateMatch(profile, summary, { rated: false, trackWinStreak: false, xpMul, mode: 'story' });
  const camp = profile.campaign;
  const mission = missionById(summary.missionId);
  const firstClear = summary.missionWon && !camp.clearedMissions.includes(summary.missionId);
  const par = mission?.parTimeS ?? summary.timeS;
  // 生存/防衛は「規定時間を耐え抜く=成功」なので、par比較に通すと常に時間オーバーで
  // 時間★が取れない。クリア時間をparにクランプして時間★を成立させる
  const kind = mission?.objective.kind;
  const survival = kind === 'survive' || kind === 'defend';
  const effTime = survival ? Math.min(summary.timeS, par) : summary.timeS;
  const stars = summary.missionWon ? starRate(effTime, par, summary.modifiers.length) : 0;

  if (summary.missionWon && !camp.clearedMissions.includes(summary.missionId)) {
    camp.clearedMissions.push(summary.missionId);
  }
  let missionBest: MissionBest | null = camp.missionBests[summary.missionId] ?? null;
  if (summary.missionWon) {
    const better =
      !missionBest || stars > missionBest.stars || summary.timeS < missionBest.bestTimeS;
    if (better) {
      missionBest = {
        bestTimeS: missionBest ? Math.min(missionBest.bestTimeS, summary.timeS) : summary.timeS,
        stars: missionBest ? Math.max(missionBest.stars, stars) : stars,
        difficulty: missionById(summary.missionId)?.difficulty ?? 'normal',
      };
      camp.missionBests[summary.missionId] = missionBest;
    }
  }

  let chapterUnlocked: string | null = null;
  if (summary.missionWon && chapterCleared(profile, summary.chapterId)) {
    const next = nextChapterId(summary.chapterId);
    if (next && !camp.unlockedChapters.includes(next)) {
      camp.unlockedChapters.push(next);
      chapterUnlocked = next;
    }
  }

  if (firstClear) {
    const bonusXp = Math.round(800 * xpMul);
    base.xpBreakdown.push({ label: '初制圧ボーナス', xp: bonusXp });
    profile.xp += bonusXp;
    base.xpTotal += bonusXp;
    base.levelAfter = levelFromXp(profile.xp);
    // ボーナスでレベルが上がった分の解放も結果画面に出す(取りこぼし防止)
    base.newUnlocks = UNLOCKS.filter(
      (u) => u.level > base.levelBefore.level && u.level <= base.levelAfter.level,
    );
  }

  return { ...base, missionId: summary.missionId, firstClear, stars, chapterUnlocked, missionBest };
}
