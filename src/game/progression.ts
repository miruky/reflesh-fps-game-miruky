// XP・レベル・アンロック・チャレンジ・ランクの計算。保存形式はprofile.tsが扱う

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

export interface Profile {
  xp: number;
  rating: number;
  stats: CareerStats;
  completedChallenges: string[];
  // 表示名ごとのキル数(武器・投擲物・近接)
  weaponKills: Record<string, number>;
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
    completedChallenges: [],
    weaponKills: {},
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
  { kind: 'weapon', id: 'kaede-ar', name: 'カエデAR', level: 1 },
  { kind: 'weapon', id: 'tsubaki-smg', name: 'ツバキSMG', level: 2 },
  { kind: 'attachment', id: 'reflex', name: 'リフレックスサイト', level: 2 },
  { kind: 'weapon', id: 'hiiragi-sg', name: 'ヒイラギSG', level: 3 },
  { kind: 'attachment', id: 'vertical', name: 'バーティカルグリップ', level: 3 },
  { kind: 'weapon', id: 'yamasemi-dmr', name: 'ヤマセミDMR', level: 4 },
  { kind: 'attachment', id: 'extended', name: '拡張マガジン', level: 4 },
  { kind: 'weapon', id: 'miyama-br', name: 'ミヤマBR', level: 5 },
  { kind: 'attachment', id: 'suppressor', name: 'サプレッサー', level: 5 },
  { kind: 'weapon', id: 'kumagera-lmg', name: 'クマゲラLMG', level: 6 },
  { kind: 'attachment', id: 'angled', name: 'アングルドグリップ', level: 6 },
  { kind: 'attachment', id: 'compensator', name: 'コンペンセイター', level: 7 },
  { kind: 'attachment', id: 'telescopic', name: 'テレスコピックサイト', level: 8 },
  { kind: 'attachment', id: 'quick', name: 'クイックマガジン', level: 9 },
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
}

// 試合結果をプロフィールへ反映する。profileはその場で更新される
export function applyMatch(profile: Profile, summary: MatchSummary): MatchProgress {
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
  if (summary.rated) {
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
  };
}
