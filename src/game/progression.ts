// XP・レベル・アンロック・チャレンジ・ランクの計算。保存形式はprofile.tsが扱う

import { CAMPAIGN, missionById, type ModifierId } from './campaign';
import type { Difficulty } from './bot';

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
  // 初取得済みメダルID(初回バッジ解放の判定に使う)
  unlockedMedals: string[];
  // メダルIDごとの累計取得回数
  medalCounts: Record<string, number>;
  // キャンペーン進行(章/ミッション解放・クリア・自己ベスト)
  campaign: CampaignState;
  // スコアアタックの自己ベスト(curatedステージidのみ・件数キャップ)
  scoreRecords: Record<string, number>;
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
    unlockedMedals: [],
    medalCounts: {},
    // 第1章のみ最初から解放(全既存セーブも第1章から開始でき、softlock回避)
    campaign: { clearedMissions: [], unlockedChapters: ['ch1'], missionBests: {} },
    scoreRecords: {},
  };
}

// レベルnからn+1へ必要なXP。緩やかな一次曲線
export function xpToNext(level: number): number {
  return 750 + (level - 1) * 250;
}

export const MAX_LEVEL = 100;

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

const RATING_WIN = 25;
const RATING_LOSS = -15;

export interface XpEntry {
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
}

// 試合結果をプロフィールへ反映する。profileはその場で更新される
export function applyMatch(profile: Profile, summary: MatchSummary): MatchProgress {
  return accumulateMatch(profile, summary, { rated: summary.rated, trackWinStreak: true });
}

// applyMatch / applyCampaignMission の共通の積算。rating と連勝記録の扱いだけ呼び側で切り替える
// (キャンペーンは競技レート・PvP連勝記録を汚染しない)
function accumulateMatch(
  profile: Profile,
  summary: MatchSummary,
  opts: { rated: boolean; trackWinStreak: boolean },
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
      records.currentWinStreak = 0;
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

  const completed: ChallengeDef[] = [];
  for (const challenge of CHALLENGES) {
    if (profile.completedChallenges.includes(challenge.id)) continue;
    if (challenge.test(stats, summary, profile.weaponKills)) {
      profile.completedChallenges.push(challenge.id);
      completed.push(challenge);
      xpBreakdown.push({ label: `任務達成: ${challenge.name}`, xp: challenge.xp });
    }
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
export function applyCampaignMission(profile: Profile, summary: MissionSummary): CampaignProgress {
  const base = accumulateMatch(profile, summary, { rated: false, trackWinStreak: false });
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
    base.xpBreakdown.push({ label: '初制圧ボーナス', xp: 800 });
    profile.xp += 800;
    base.xpTotal += 800;
    base.levelAfter = levelFromXp(profile.xp);
    // ボーナスでレベルが上がった分の解放も結果画面に出す(取りこぼし防止)
    base.newUnlocks = UNLOCKS.filter(
      (u) => u.level > base.levelBefore.level && u.level <= base.levelAfter.level,
    );
  }

  return { ...base, missionId: summary.missionId, firstClear, stars, chapterUnlocked, missionBest };
}
