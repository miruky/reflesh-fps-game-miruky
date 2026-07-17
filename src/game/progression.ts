// XP・レベル・アンロック・チャレンジ・ランクの計算。保存形式はprofile.tsが扱う

import { CAMPAIGN, missionById, type ModifierId, type MissionChallengeDef } from './campaign';
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
  REWARD_CAMO_CHAPTER,
  weaponNameOf,
  type CamoId,
  type CamoClass,
  type WeaponCamoStats,
} from './camo';

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

// ── R53-W2: お守り(charm)。CharmId の単一の真実は zombie-economy.ts(B-ECON)。
// 再exportで既存の `import { CharmId } from './progression'` 消費側との互換を維持する。
export type { CharmId } from './zombie-economy';
import {
  hasPerkCarryUnlockSet,
  type CharmId,
  type ZombiePerkId,
} from './zombie-economy';

export const CHARM_IDS: readonly CharmId[] = ['startpt', 'revive', 'bossdmg', 'perkcarry'];

export function isCharmId(id: string): id is CharmId {
  return (CHARM_IDS as readonly string[]).includes(id);
}

// お守りの解放状態(装備は1個まで)
export interface CharmState {
  unlocked: CharmId[];
  equipped: CharmId | null;
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
  // ── R53-W2追加(旧セーブとの後方互換のため全てoptional。parseProfileが安全に補完する) ──
  // ゾンビモードの累計統計(charm解放条件の入力)。ゾンビ以外のモードでは変化しない
  bestZombieRound?: number;
  zombieKills?: number;
  zombieBossKills?: number;
  // 同一試合内で継承の守り札必要パーク5種(quick-revive除外)を所持した実績。
  // 一度成立したら永続保存し、結果処理後の再起動でも解放状態を復元できる。
  zombiePerkSetCompleted?: boolean;
  // お守り(charm)の解放/装備状態。メニューの「お守りピッカー」はこのフィールドを読む
  charms?: CharmState;
  // 称号(rankNameForの階位ランクとは独立した、実績由来の呼称)。表示順=解放順
  titles?: string[];
  // 報酬カモ(camo.ts の REWARD_CAMO_IDS: jingai/shinrai)の解放状態。CAMO_TIERSの
  // kill数条件/ダイヤ/ダークマターとは別枠。フィールド名は camo.ts の
  // isCamoUnlocked/equippedCamoFor が期待する `unlockedRewardCamos` に合わせてあり、
  // Profile を構造的にそのまま渡す既存呼び出し(viewmodel.ts/match.ts の
  // equippedCamoFor(weaponId, profile) 経路)にそのまま刺さる。
  unlockedRewardCamos?: CamoId[];
  // ★V-D HIGH修正(R53): 黒雷帝キルの生涯累計(刀身雷脈=100キル判定の単一真実源)。
  // medalCounts['kokurai-kill'] は「初キルメダルの発火回数≒試合数」でありキル数ではない。
  // 毎試合 summary.kokuraiKills(tracker.kokuraiKillCount)を加算する。optional=後方互換
  kokuraiKillsTotal?: number;
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
  // ── R53-W2: ゾンビモード専用の統計(省略可=旧経路互換)。mode==='zombie'の時のみ
  // accumulateMatchが読み、profile.bestZombieRound/zombieBossKillsへ積算する。
  // zombieKillsそのものは既存のkillsをそのまま流用するため専用フィールドは設けない
  // (ゾンビモードの撃破対象は実質全てゾンビのため)。
  zombieRound?: number;
  zombieBossKills?: number;
  // 試合終了時に所持しているパーク種。継承の守り札解放判定用。
  zombiePerksHeld?: readonly ZombiePerkId[];
  // ★V-D HIGH修正(R53): この試合の黒雷帝キル実数(tracker.kokuraiKillCount)。
  // profile.kokuraiKillsTotal(刀身雷脈=100キル判定)へ積算する。省略可=旧経路互換
  kokuraiKills?: number;
}

// ── R53-W2: お守り(charm)解放条件。全て profile のゾンビ累計統計から判定する純関数 ──
const CHARM_UNLOCK_CONDITIONS: Record<CharmId, (profile: Profile) => boolean> = {
  startpt: (profile) => (profile.bestZombieRound ?? 0) >= 10,
  revive: (profile) => (profile.zombieKills ?? 0) >= 500,
  bossdmg: (profile) => (profile.zombieBossKills ?? 0) >= 10,
  perkcarry: (profile) => profile.zombiePerkSetCompleted === true,
};

// 未解放のcharmのうち条件を満たしたものをprofile.charmsへ積む。新規解放したIDを返す
// (結果画面の「お守り解放!」通知に使える)。冪等: 既に解放済みのIDは重複追加しない。
export function refreshCharmUnlocks(profile: Profile): CharmId[] {
  if (!profile.charms) profile.charms = { unlocked: [], equipped: null };
  const newly: CharmId[] = [];
  for (const id of CHARM_IDS) {
    if (profile.charms.unlocked.includes(id)) continue;
    if (CHARM_UNLOCK_CONDITIONS[id](profile)) {
      profile.charms.unlocked.push(id);
      newly.push(id);
    }
  }
  return newly;
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
    // R53-W2: 型は後方互換のためoptionalだが、新規プロフィールは常に具体値で埋める
    bestZombieRound: 0,
    zombieKills: 0,
    zombieBossKills: 0,
    zombiePerkSetCompleted: false,
    charms: { unlocked: [], equipped: null },
    titles: [],
    unlockedRewardCamos: [],
    kokuraiKillsTotal: 0,
  };
}

// XP乗数定数。呼び出し側(main.ts)はこれをそのまま applyMatch/applyCampaignMission の xpMul に渡す。
// 訓練モードは統計汚染防止のため呼び出し側で xpMul 適用をスキップする(ここでは定義しない)。
export const XP_MUL_NORMAL = 500; // 通常(非ゾンビ)モード — 試合XP全体に掛ける乗数
export const XP_MUL_ZOMBIE =  25; // ゾンビモード — 試合XP全体に掛ける乗数

// ── R53-W2: XP方針の設計判断(コメントのみ・意図的に未実装) ──────────────────
// 1. Pack-a-Punch改造/パワーアップ取得はXPを付与しない。これらはゾンビの
//    ポイント経済(zombie-economy.ts の POINTS/PAP_COST)で完結させ、XP経済とは
//    分離する。accumulateMatch/applyMatch に「PaP実行時のXP加算」のようなフックは
//    意図的に追加していない — 追加する場合はこの分離方針を破ることになるため要相談。
// 2. S&D(Search & Destroy)勝利は専用のXP行を設けない。チームモードの既存の
//    「勝利500xp / 試合参加150xp」(xpBreakdown内の 'won: true'→500 の行、
//    accumulateMatch側)が自然にカバーするため、S&D固有のXP加算ロジックは不要
//    (S&Dモード自体は本ラウンド時点でmodes.tsに未着地。着地後もこの方針は不変)。

// レベルnからn+1へ必要なXP。
// L1-99:    750 + (n-1)*250 の一次曲線(既存セーブとの後方互換を維持するため不変)。
// L100-499: +100/レベルで緩やかに成長(高原フェーズ1)。
// L500-999: +50/レベルでさらに緩やかに成長(高原フェーズ2)。
// L1000-9999: +25/レベルでさらに高原化(L999=90_450 との連続性を維持)。
// L10000以降: +10/レベルで究極高原化(L9999=315_450 との連続性を維持)。
// R49でレベルを無限化したため、この区分に上限は無く無限に延長される(等差数列のまま)。
// 単調増加・オーバーフロー無し(levelFromXp側はL10000以降を閉形式で解くため巨大XPでも軽量)。
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
  // L10000以降: 究極高原化(+10/レベル)。xpToNext(9999)=315_450 との連続性を維持し、
  // 上限なく無限に続く(R49レベル無限化)。
  return 315_450 + (level - 9999) * 10;
}

// R49でレベル無限化する前は「レベル上限(頭打ち)」を表す定数だった。
// 現在は頭打ちが無いため levelFromXp では使用しない。定数自体は外部互換のため残し、
// 「事実上の上限なし」を表す Number.MAX_SAFE_INTEGER を割り当てる
// (progression.ts / progression.test.ts 以外からこの定数を参照している箇所は無いことを確認済み)。
export const MAX_LEVEL = Number.MAX_SAFE_INTEGER;

export interface LevelState {
  level: number;
  intoLevel: number;
  toNext: number;
}

// L10000以降、xpToNext(level) は初項 A=xpToNext(LINEAR_TAIL_START)・公差10の等差数列のまま
// 無限に続く。levelFromXp はこの区間を「1レベルずつ引き算」せず、m段先まで進める閉形式
// (二次方程式)で直接解くため、巨大XP(1e15超など)でも定数時間に近い計算量で済む。
const LINEAR_TAIL_START = 10_000;

// L10000から m 段先までの必要XP合計(等差数列の部分和): m*A + D*m*(m-1)/2
function linearTailPartialSum(m: number, first: number, diff: number): number {
  return m * first + (diff * m * (m - 1)) / 2;
}

// linearTailPartialSum(m) <= rest を満たす最大の m(m>=0)を二次方程式の根から直接求める。
// 5m^2 + (A - D/2)m - rest = 0 (D=10 なので D/2=5) を m について解き、非負根を採用する。
// 浮動小数点の丸め誤差は僅かにズレ得るため、実測の部分和との突き合わせで±1補正する
// (partialSumは単調増加なので補正ループは必ず有限回で収束する)。
function solveLinearTailLevels(rest: number, first: number, diff: number): number {
  const half = diff / 2;
  const b = first - half;
  const disc = b * b + 4 * half * rest;
  let m = Math.floor((-b + Math.sqrt(disc)) / (2 * half));
  if (!Number.isFinite(m) || m < 0) m = 0;
  while (m > 0 && linearTailPartialSum(m, first, diff) > rest) m -= 1;
  while (linearTailPartialSum(m + 1, first, diff) <= rest) m += 1;
  return m;
}

export function levelFromXp(xp: number): LevelState {
  let level = 1;
  // 非有限値(NaN/Infinity)は0扱いにして、以降の計算が壊れないようにする
  let rest = Math.max(0, Number.isFinite(xp) ? xp : 0);
  // L1-9999は区分が細かく切り替わるため、そのまま線形スキャンする(最大9999回・軽量)
  while (level < LINEAR_TAIL_START && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  // L10000へ到達した場合のみ、そこから先は無限に続く等差数列を閉形式で一気に解く
  if (level === LINEAR_TAIL_START) {
    const first = xpToNext(LINEAR_TAIL_START);
    const diff = 10;
    const m = solveLinearTailLevels(rest, first, diff);
    level += m;
    rest -= linearTailPartialSum(m, first, diff);
  }
  return { level, intoLevel: rest, toNext: xpToNext(level) };
}

// アンロック対象。武器とアタッチメントをレベルで開放する
export interface UnlockDef {
  kind: 'weapon' | 'attachment';
  id: string;
  name: string;
  level: number;
}

// R57-④フォローアップ: 武器の name は weapons.ts (WEAPON_DEFS) のリネームへ自動追従させるため
// 静的な日本語コードネームではなく weaponNameOf(id) で動的参照する(将来の改名でも解放通知が食い違わない)。
// アタッチメントは改名対象外のため、従来どおり静的な name 文字列を保持する。
export const UNLOCKS: UnlockDef[] = [
  // 既存クラス各1本(L1-6)を温存
  { kind: 'weapon', id: 'kaede-ar', name: weaponNameOf('kaede-ar'), level: 1 },
  { kind: 'weapon', id: 'tsubaki-smg', name: weaponNameOf('tsubaki-smg'), level: 2 },
  { kind: 'attachment', id: 'reflex', name: 'リフレックスサイト', level: 2 },
  { kind: 'weapon', id: 'hiiragi-sg', name: weaponNameOf('hiiragi-sg'), level: 3 },
  { kind: 'attachment', id: 'vertical', name: 'バーティカルグリップ', level: 3 },
  { kind: 'weapon', id: 'yamasemi-dmr', name: weaponNameOf('yamasemi-dmr'), level: 4 },
  { kind: 'weapon', id: 'kawasemi-pistol', name: weaponNameOf('kawasemi-pistol'), level: 4 },
  { kind: 'attachment', id: 'extended', name: '拡張マガジン', level: 4 },
  { kind: 'weapon', id: 'miyama-br', name: weaponNameOf('miyama-br'), level: 5 },
  { kind: 'attachment', id: 'suppressor', name: 'サプレッサー', level: 5 },
  { kind: 'weapon', id: 'kumagera-lmg', name: weaponNameOf('kumagera-lmg'), level: 6 },
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
  { kind: 'weapon', id: 'kasasagi-ar', name: weaponNameOf('kasasagi-ar'), level: 7 },
  { kind: 'attachment', id: 'compensator', name: 'コンペンセイター', level: 7 },
  { kind: 'weapon', id: 'ginyanma-ar', name: weaponNameOf('ginyanma-ar'), level: 8 },
  { kind: 'attachment', id: 'telescopic', name: 'テレスコピックサイト', level: 8 },
  { kind: 'weapon', id: 'hayabusa-smg', name: weaponNameOf('hayabusa-smg'), level: 9 },
  { kind: 'attachment', id: 'quick', name: 'クイックマガジン', level: 9 },
  { kind: 'weapon', id: 'akatsuki-ar', name: weaponNameOf('akatsuki-ar'), level: 10 },
  { kind: 'weapon', id: 'taka-revolver', name: weaponNameOf('taka-revolver'), level: 10 },
  { kind: 'weapon', id: 'sasameki-smg', name: weaponNameOf('sasameki-smg'), level: 11 },
  { kind: 'weapon', id: 'kagerou-br', name: weaponNameOf('kagerou-br'), level: 12 },
  { kind: 'weapon', id: 'shinonome-ar', name: weaponNameOf('shinonome-ar'), level: 13 },
  { kind: 'weapon', id: 'mozu-smg', name: weaponNameOf('mozu-smg'), level: 14 },
  { kind: 'weapon', id: 'kogarashi', name: weaponNameOf('kogarashi'), level: 14 },
  { kind: 'weapon', id: 'enaga-pdw', name: weaponNameOf('enaga-pdw'), level: 15 },
  { kind: 'weapon', id: 'tobikuma-ar', name: weaponNameOf('tobikuma-ar'), level: 16 },
  { kind: 'weapon', id: 'shirasagi-mk', name: weaponNameOf('shirasagi-mk'), level: 17 },
  { kind: 'weapon', id: 'fukurou-sg', name: weaponNameOf('fukurou-sg'), level: 18 },
  { kind: 'weapon', id: 'tsuchigumo-lmg', name: weaponNameOf('tsuchigumo-lmg'), level: 19 },
  { kind: 'weapon', id: 'hibari-mk', name: weaponNameOf('hibari-mk'), level: 20 },
  { kind: 'weapon', id: 'raijin-sg', name: weaponNameOf('raijin-sg'), level: 21 },
  { kind: 'weapon', id: 'raitei-lmg', name: weaponNameOf('raitei-lmg'), level: 22 },
  { kind: 'weapon', id: 'raicho-sniper', name: weaponNameOf('raicho-sniper'), level: 23 },
  { kind: 'weapon', id: 'shirayuki-sniper', name: weaponNameOf('shirayuki-sniper'), level: 24 },
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
// L10000-99999: 10000刻み10段(超越階級・日本神話、L99999=森羅万象で一旦の頂点)
// L100000以降: 10万刻みで「森羅万象」を超える超越階級が無限に続く(R49レベル無限化)。
// tierはR49以降も単調増加し続けるため上限は無い。
export interface RankName {
  name: string;
  tier: number; // 0(新兵) 〜 29(森羅万象) 〜 無限(森羅万象超の超越階級)
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

// ── 超越階級(L100000以降・森羅万象を超えて更に進化する階位) ─────────────────────
// idx = floor(level / TRANSCEND_STEP)。idx 1-24 は固定の凍結ラダー、tier = 29 + idx で
// 既存の tier(0-29)から単調に続く。idx 25以降は「無限の無限・n乗」を文字列生成で無限に
// 続ける(idx=24の「無限の無限」を基準に、idx-23 乗という体で表す)。
const TRANSCEND_STEP = 100_000;

const TRANSCEND_RANK_NAMES: readonly string[] = [
  '宇宙開闢', '銀河創世', '時空超越', '次元崩壊', '多元宇宙',
  '平行世界の王', '因果律の支配者', '概念超越', '無限回帰', '永劫不滅',
  '天元突破', '星海の帝', '万象の祖', '理の外', '混沌の主宰',
  '秩序の根源', '世界改変', '創造と終焉', '全知全能', '絶対存在',
  '唯一絶対', '根源意志', '万物の彼方', '無限の無限',
];

function transcendRankFor(idx: number): RankName {
  const tier = 29 + idx;
  if (idx <= TRANSCEND_RANK_NAMES.length) {
    return { name: TRANSCEND_RANK_NAMES[idx - 1]!, tier };
  }
  // idx=25→「無限の無限・2乗」、idx=26→「・3乗」…と無限に続く命名
  const power = idx - (TRANSCEND_RANK_NAMES.length - 1);
  return { name: `無限の無限・${power}乗`, tier };
}

export function rankNameFor(level: number): RankName {
  if (level >= TRANSCEND_STEP) {
    return transcendRankFor(Math.floor(level / TRANSCEND_STEP));
  }
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
  const classesTouched = new Set<CamoClass>();
  for (const id of touched) {
    const cls = camoClassOf(id);
    if (!cls) continue; // 拳などカモ対象外は統計のみ積む
    classesTouched.add(cls);
    // R57 ⑤: exotic(特殊兵装)は金の緩和閾値(HSのみ緩和)で判定するため weaponId を渡す。
    // 非exoticは省略時と同結論(500/100)=完全後方互換。金→ダイヤの解放順の逆転を解消。
    const tierBefore = camoTierFor(before[id], id);
    const tierAfter = camoTierFor(profile.weaponStats[id], id);
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
  // ダークマター: 全カモ対象武器のダイヤ成立瞬間を検出
  if (!darkMatterFor(before) && darkMatterFor(profile.weaponStats)) {
    unlocks.push({
      camoId: DARK_MATTER_CAMO.id,
      camoName: DARK_MATTER_CAMO.name,
      weaponId: null,
      label: `全武器ダイヤ制覇「${DARK_MATTER_CAMO.name}」`,
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
  // ── R53-W2: ゾンビ統計の積算(charm解放条件の入力。ゾンビモードのみ加算) ──
  // zombieKills は summary.kills をそのまま採用する(ゾンビモードの撃破対象は実質
  // 全てゾンビのため、専用フィールドを増やさず既存値を流用する)。bestZombieRound/
  // zombieBossKills は summary 側の新設optionalフィールドから読む(match.ts の
  // result() がまだこれらを埋めていない場合は 0 加算 = 実質ノーオペになるだけで安全)。
  if (opts.mode === 'zombie') {
    profile.bestZombieRound = Math.max(profile.bestZombieRound ?? 0, summary.zombieRound ?? 0);
    profile.zombieKills = (profile.zombieKills ?? 0) + Math.max(0, summary.kills);
    profile.zombieBossKills =
      (profile.zombieBossKills ?? 0) + Math.max(0, summary.zombieBossKills ?? 0);
    if (hasPerkCarryUnlockSet(summary.zombiePerksHeld ?? [])) {
      profile.zombiePerkSetCompleted = true;
    }
    refreshCharmUnlocks(profile);
  }
  // ★V-D HIGH修正(R53): 黒雷帝キル実数の生涯積算(刀身雷脈=100キル判定)。帝王システムは
  // 全モードで発動しうるため mode ゲートの外で加算する(summary未供給時は0=ノーオペ)
  if ((summary.kokuraiKills ?? 0) > 0) {
    profile.kokuraiKillsTotal = (profile.kokuraiKillsTotal ?? 0) + Math.max(0, summary.kokuraiKills ?? 0);
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
  // ── R54-W2: 3つ目の★条件(MissionDef.challenge)の判定入力(P0-A修正) ──
  // 'no-reload' チャレンジ専用。ミッション中のリロード回数。省略時はevalMissionChallengeが
  // 安全側(challengeMet=false)にフォールバックする。供給はstory-engine側の後続作業(申し送り)。
  reloads?: number;
  // 呼び出し側が試合中に自前でチャレンジ達成を判定できた場合の直接上書き値(将来の拡張点)。
  // 省略時は applyCampaignMission が evalMissionChallenge(mission.challenge, summary) で
  // MissionSummary の既存フィールド(deaths/headshots/shotsFired/shotsHit/weaponKills/reloads)
  // から自動算出する。現時点でこのフィールドを供給する呼び出し元は無い(常にundefined)。
  challengeMet?: boolean;
}

export interface CampaignProgress extends MatchProgress {
  missionId: string;
  firstClear: boolean;
  stars: number;
  // R54-W2: このミッションで3つ目の★チャレンジ(MissionDef.challenge)を満たしたか。
  // menu.ts側の結果画面「チャレンジ達成!」表示にそのまま使える(申し送り: 表示配線は未着手)。
  challengeMet: boolean;
  chapterUnlocked: string | null;
  missionBest: MissionBest | null;
  // R53-W2: この試合(ミッションクリア)で新規解放した報酬カモ(camo.ts REWARD_CAMO_IDS)/称号
  newRewardCamos: CamoId[];
  newTitles: string[];
}

// ── R53-W2: 報酬カモ / 称号 の汎用ヘルパ ─────────────────────────────────────
// どちらも冪等(既に持っていれば false を返し何もしない)。

// 報酬カモ(camo.ts REWARD_CAMO_IDS: jingai/shinrai)をprofileへ積む。新規解放ならtrue。
// フィールド名 unlockedRewardCamos は camo.ts の isCamoUnlocked/equippedCamoFor が
// 第4引数/profile.unlockedRewardCamosとして期待する拡張点そのもの。
export function unlockRewardCamo(profile: Profile, camoId: CamoId): boolean {
  if (!profile.unlockedRewardCamos) profile.unlockedRewardCamos = [];
  if (profile.unlockedRewardCamos.includes(camoId)) return false;
  profile.unlockedRewardCamos.push(camoId);
  return true;
}

// 称号をprofileへ積む。新規解放ならtrue
export function addTitle(profile: Profile, title: string): boolean {
  if (!profile.titles) profile.titles = [];
  if (profile.titles.includes(title)) return false;
  profile.titles.push(title);
  return true;
}

// chapterId → 報酬カモID の逆引き(camo.ts の REWARD_CAMO_CHAPTER = {jingai:'ch9',
// shinrai:'ch10'} を反転しただけ。camo.ts側で章の対応が変わってもここは自動追従する)。
const CHAPTER_REWARD_CAMO: Partial<Record<string, CamoId>> = Object.fromEntries(
  Object.entries(REWARD_CAMO_CHAPTER).map(([camoId, chapterId]) => [chapterId, camoId as CamoId]),
);

// ── R53-W2: 帝王編(ch9/ch10)報酬 ────────────────────────────────────────────
// 報酬カモの対応(章→カモID)は camo.ts の REWARD_CAMO_CHAPTER が単一の真実源
// (CHAPTER_REWARD_CAMO はその逆引き)。称号は camo.ts に対応する概念が無いため、
// ch10クリア→「雷帝の後継」だけこの関数内にハードコードする。
// CAMPAIGN配列への帝王編ミッション追加自体はB-CAMPが並行実装中のため、本関数は
// CAMPAIGN/chapterCleared()に依存しない純関数として書く(呼び側がchapterFullyCleared
// 判定を渡す)。着地後、campaign.ts側の実章IDがch9/ch10と一致するか要確認。
export function applyChapterRewards(
  profile: Profile,
  chapterId: string,
  chapterFullyCleared: boolean,
): { newRewardCamos: CamoId[]; newTitles: string[] } {
  const newRewardCamos: CamoId[] = [];
  const newTitles: string[] = [];
  if (!chapterFullyCleared) return { newRewardCamos, newTitles };
  const rewardCamo = CHAPTER_REWARD_CAMO[chapterId];
  if (rewardCamo && unlockRewardCamo(profile, rewardCamo)) {
    newRewardCamos.push(rewardCamo);
  }
  // ch10全クリア → 称号「雷帝の後継」
  if (chapterId === 'ch10' && addTitle(profile, '雷帝の後継')) {
    newTitles.push('雷帝の後継');
  }
  return { newRewardCamos, newTitles };
}

// R54-W2: 近接(格闘/クナイ系)キル数の集計。match.ts の isMeleeKill 判定(該当箇所の
// weaponName 列挙)と揃えてある — '近接'(基本の格闘/ナイフ)に加え、黒帝/雷帝キットの
// 派生斬撃もすべて「近接」として数える(MissionChallengeKind='weapon-class' の判定基盤)。
const MELEE_WEAPON_NAMES: readonly string[] = [
  '近接',
  'ダイブスラム',
  '黒帝斬撃',
  'ブリンク斬撃',
  '雷帝斬撃',
];
function meleeKillsOf(weaponKills: Record<string, number>): number {
  return MELEE_WEAPON_NAMES.reduce((sum, name) => sum + (weaponKills[name] ?? 0), 0);
}

// R54-W2: accuracy チャレンジの最低試投数(1発だけ命中して100%…のような自明達成を防ぐ)。
// 既存の CHALLENGES 'sharpshooter'(shotsFired>=10 かつ 50%以上)と揃えた基準値。
const ACCURACY_CHALLENGE_MIN_SHOTS = 10;

// R54-W2 P0-A: MissionDef.challenge(3つ目の★条件)の判定純関数。
// challenge が未設定(旧データ相当)なら false を返す(3★は par+勝利の2★止まりで安全)。
// no-reload は summary.reloads が未供給(undefined)の間は常に false(story-engineの後続作業待ち)。
export function evalMissionChallenge(
  challenge: MissionChallengeDef | undefined,
  summary: MissionSummary,
): boolean {
  if (!challenge) return false;
  switch (challenge.kind) {
    case 'no-death':
      return summary.deaths === 0;
    case 'hs-count':
      return summary.headshots >= (challenge.value ?? 1);
    case 'accuracy': {
      if (summary.shotsFired < ACCURACY_CHALLENGE_MIN_SHOTS) return false;
      const pct = (summary.shotsHit / summary.shotsFired) * 100;
      return pct >= (challenge.value ?? 0);
    }
    case 'no-reload':
      return summary.reloads !== undefined && summary.reloads === 0;
    case 'weapon-class':
      return meleeKillsOf(summary.weaponKills) >= (challenge.value ?? 1);
    default: {
      // 網羅性チェック: MissionChallengeKind に新種を足したらここでコンパイルエラーになる
      const exhaustive: never = challenge.kind;
      return exhaustive;
    }
  }
}

// 星評価: 勝利=1★、par以内で+1★、ミッション固有チャレンジ達成で+1★(最大3)。敗北は0。
// R54-W2: 旧shape(modCount: number)からの意味変更。誰でも選べる「モディファイア有無」は
// 単なる難易度自己申告で3★を無条件に配っていた(P0-A: 19ミッションで実質3★固定/到達不能の
// 温床)。腕前チャレンジ(evalMissionChallenge)の合否に置き換えることで、3★を「うまくやった」
// 証明に戻す。モディファイア自体はXPボーナスへ役割を移した(applyCampaignMission参照)。
export function starRate(timeS: number, parTimeS: number, challengeMet: boolean): number {
  let s = 1;
  if (timeS <= parTimeS) s += 1;
  if (challengeMet) s += 1;
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

// R55: ★(スター)獲得や「前章を全制圧しないと次章が触れない」というゲートはユーザー要望
// (「★を取らないとストーリー解放されないシステムを廃止してください。面倒なので」)により撤廃。
// 全章・全ミッションを最初から自由に選択できる — ここは missionId が実在するかどうかの
// 存在チェックのみを行う純関数へ縮退した。profile引数は ui2/ui1 双方の既存呼び出し規約
// (isMissionUnlocked(profile, missionId))との互換のために残す(将来ミッション単位の個別
// ロックを復活させたくなった場合の拡張点)。★自体は任意の実績評価として引き続き記録・表示
// する(starRate/missionBests/progression結果画面は無改変)。
//
// R55-W-C: ただし上記の全解放は「隠し章」には適用しない。chB「歴戦の間」はR54-F6で
// 「ch10全クリアまで秘匿(ネタバレ+実績先食い防止)」として設計された特別章で、★ゲート
// 撤廃の巻き添えで新規プロフィールから即閲覧・プレイ可能になっていた回帰を修正する。
// SECRET_CHAPTER_IDS に属する章のミッションだけ、既存の unlockedChapters 簿記
// (章クリア時の連鎖push=progression.ts下部 / 旧セーブの遡及付与=profile.ts)を
// 解放条件として使う。通常章(ch1-ch10)は従来通り無条件に解放したまま。
const SECRET_CHAPTER_IDS: readonly string[] = ['chB'];

export function isMissionUnlocked(profile: Profile, missionId: string): boolean {
  const mission = missionById(missionId);
  if (!mission) return false;
  if (SECRET_CHAPTER_IDS.includes(mission.chapterId)) {
    return profile.campaign.unlockedChapters.includes(mission.chapterId);
  }
  return true;
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

  // R54-W2: モディファイアは星評価から切り離し、XPボーナス(モディファイア数×15%、加算)へ
  // 役割変更した。旧仕様(modCount>0で無条件に3★目)は「モディファイアを選ぶだけで誰でも
  // 3★になる」抜け穴で、P0-A(19ミッションで3★が構造的に到達不能)の裏側の原因でもあった
  // (腕前を問わない3★経路が既に存在するのに、大半のミッションではそれすら選べなかった)。
  // 難易度を上げた分の見返りはXPで受け取る形にする。実装位置はここ1箇所のみ(base.xpTotal/
  // profile.xp/base.levelAfter/base.newUnlocks を一貫して更新する必要があるため)。
  // 勝利時のみ加算(旧仕様でも modCount による★ボーナスは missionWon 分岐の内側でのみ
  // 効いていたため、報酬の対象範囲はそのまま踏襲する)。
  if (summary.missionWon && summary.modifiers.length > 0) {
    const modBonusXp = Math.round(base.xpTotal * summary.modifiers.length * 0.15);
    if (modBonusXp > 0) {
      base.xpBreakdown.push({
        label: `モディファイア報酬 x${summary.modifiers.length}`,
        xp: modBonusXp,
      });
      profile.xp += modBonusXp;
      base.xpTotal += modBonusXp;
      base.levelAfter = levelFromXp(profile.xp);
      // ボーナスでレベルが上がった分の解放も結果画面に出す(取りこぼし防止。下の初制圧
      // ボーナスと同じ流儀)
      base.newUnlocks = UNLOCKS.filter(
        (u) => u.level > base.levelBefore.level && u.level <= base.levelAfter.level,
      );
    }
  }

  const camp = profile.campaign;
  const mission = missionById(summary.missionId);
  const firstClear = summary.missionWon && !camp.clearedMissions.includes(summary.missionId);
  const par = mission?.parTimeS ?? summary.timeS;
  // 生存/防衛は「規定時間を耐え抜く=成功」なので、par比較に通すと常に時間オーバーで
  // 時間★が取れない。クリア時間をparにクランプして時間★を成立させる
  const kind = mission?.objective.kind;
  const survival = kind === 'survive' || kind === 'defend';
  const effTime = survival ? Math.min(summary.timeS, par) : summary.timeS;
  // R54-W2 P0-A: 3つ目の★はミッション固有チャレンジ(MissionDef.challenge)の達成可否で
  // 決める。summary.challengeMet が明示供給されていればそれを優先し(将来の直接供給用の
  // 拡張点)、無ければ純関数 evalMissionChallenge で自動算出する。
  const challengeMet = summary.challengeMet ?? evalMissionChallenge(mission?.challenge, summary);
  const stars = summary.missionWon ? starRate(effTime, par, challengeMet) : 0;

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

  const chapterFullyCleared = summary.missionWon && chapterCleared(profile, summary.chapterId);
  let chapterUnlocked: string | null = null;
  if (chapterFullyCleared) {
    const next = nextChapterId(summary.chapterId);
    if (next && !camp.unlockedChapters.includes(next)) {
      // R55 W-C5[LOW-16]: unlockedChaptersへのpushはchB連鎖ゲート(isMissionUnlocked/
      // SECRET_CHAPTER_IDS)に必須の簿記なので維持する。一方でUIへ返すchapterUnlockedは
      // 演出専用フィールド — ★ゲート撤廃(R55)で章は自由順に遊べるため、次章を先に
      // 遊び終えてから(章クリア順が前後して)当該前章を今クリアするケースでは、next側は
      // 実際には既にクリア済みで「新規に遊べるようになった章」ではない。そのまま
      // chapterUnlocked=nextを返すと、既にクリア済みの章に対しても「新章解放!」通知が
      // 誤発火する(簿記push=非破壊の内部状態と、UI演出=一度だけ見せたい通知を分離)。
      camp.unlockedChapters.push(next);
      if (!chapterCleared(profile, next)) {
        chapterUnlocked = next;
      }
    }
  }
  // R53-W2: 帝王編(ch9/ch10)報酬。章IDはcamo.tsのREWARD_CAMO_CHAPTERが真実源
  // ({jingai:'ch9', shinrai:'ch10'})。CAMPAIGN配列(campaign.ts)への帝王編ミッション
  // 追加自体はB-CAMPが並行実装中で本ファイル執筆時点では未着地のため、実際にch9/ch10を
  // 全クリアするまではchapterFullyClearedが常にfalseとなり、この呼び出しは安全に
  // 無効化された状態で存在する(applyChapterRewardsのコメント参照)。
  const { newRewardCamos, newTitles } = applyChapterRewards(
    profile,
    summary.chapterId,
    chapterFullyCleared,
  );

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

  return {
    ...base,
    missionId: summary.missionId,
    firstClear,
    stars,
    challengeMet,
    chapterUnlocked,
    missionBest,
    newRewardCamos,
    newTitles,
  };
}
