// デイリーチャレンジ + 連続日数ストリーク (純ロジック・完全独立モジュール)
// Date.now() 不使用 — dateSeed(YYYYMMDD数値) / nowDate(YYYYMMDD文字列) を注入して決定論。
// progression.ts への import が一切ないため循環参照が発生しない。

import type { GameMode } from './modes';

// ── 型定義 ─────────────────────────────────────────────────────────

/**
 * check 関数が参照する試合サマリの最小インターフェース。
 * MatchSummary はこの型と構造的に互換するため、そのまま渡せる。
 */
export interface DailySummaryInput {
  won: boolean;
  kills: number;
  deaths: number;
  headshots: number;
  captures: number;
  bestStreak: number;
  weaponKills: Record<string, number>;
  killsByWeapon?: Record<string, number>;
  medalCounts: Record<string, number>;
}

export interface DailyChallengeDef {
  id: string;
  label: string;
  target: number;
  /**
   * xpMul 対象外の固定報酬XP。
   * 難易度別: easy=2000 / medium=5000 / hard=10000
   */
  rewardXp: number;
  /**
   * 1試合の DailySummaryInput + GameMode から得られる進捗増分を返す。
   * クランプは applyDailies が行う。
   */
  check: (summary: DailySummaryInput, mode: GameMode) => number;
}

export interface DailyState {
  /** 今日の日付 "YYYYMMDD" */
  currentDate: string;
  /** 今日の3チャレンジ各々の進捗 */
  progress: [number, number, number];
  /** 各チャレンジの報酬受け取り済みフラグ */
  claimed: [boolean, boolean, boolean];
  /** 連続クリア日数 */
  streakDays: number;
  /** 最後にチャレンジをクリアした日 "YYYYMMDD" (未クリア時は空文字) */
  lastClearDate: string;
}

export interface DailyXpEntry {
  label: string;
  xp: number;
}

export function emptyDailyState(): DailyState {
  return {
    currentDate: '',
    progress: [0, 0, 0],
    claimed: [false, false, false],
    streakDays: 0,
    lastClearDate: '',
  };
}

// ── 武器クラス別キル計算ヘルパー ─────────────────────────────────

// スナイパークラスの武器ID一覧(yamasemi-dmr も class:'sniper')
const SNIPER_IDS: readonly string[] = ['yamasemi-dmr', 'raicho-sniper', 'shirayuki-sniper'];
// ロケットランチャーの武器ID一覧
const LAUNCHER_IDS: readonly string[] = ['gouka-rl'];

function weaponIdKills(summary: DailySummaryInput, ids: readonly string[]): number {
  const kbw = summary.killsByWeapon ?? {};
  return ids.reduce((acc, id) => acc + (kbw[id] ?? 0), 0);
}

function totalMedals(summary: DailySummaryInput): number {
  return Object.values(summary.medalCounts).reduce((a, b) => a + b, 0);
}

// ── チャレンジプール (各難易度5種 × 3難易度 = 15種) ────────────────

/** 難易度: easy — 報酬 2000 XP */
export const POOL_EASY: readonly DailyChallengeDef[] = [
  {
    id: 'daily-win',
    label: '1試合勝利する',
    target: 1,
    rewardXp: 2000,
    check: (s) => (s.won ? 1 : 0),
  },
  {
    id: 'daily-kill-5',
    label: '1試合でキル5以上',
    target: 5,
    rewardXp: 2000,
    check: (s) => s.kills,
  },
  {
    id: 'daily-hs-3',
    label: 'ヘッドショットキル3回',
    target: 3,
    rewardXp: 2000,
    check: (s) => s.headshots,
  },
  {
    id: 'daily-melee-3',
    label: '近接キル3回',
    target: 3,
    rewardXp: 2000,
    // 近接(ナイフ)またはクナイ(ガンゲームの最終段)のどちらも計上
    check: (s) => (s.weaponKills['近接'] ?? 0) + (s.weaponKills['クナイ'] ?? 0),
  },
  {
    id: 'daily-streak-4',
    label: '4連続キル達成',
    target: 1,
    rewardXp: 2000,
    check: (s) => (s.bestStreak >= 4 ? 1 : 0),
  },
];

/** 難易度: medium — 報酬 5000 XP */
export const POOL_MEDIUM: readonly DailyChallengeDef[] = [
  {
    id: 'daily-kill-10',
    label: '1試合でキル10以上',
    target: 10,
    rewardXp: 5000,
    check: (s) => s.kills,
  },
  {
    id: 'daily-hs-5',
    label: 'ヘッドショットキル5回',
    target: 5,
    rewardXp: 5000,
    check: (s) => s.headshots,
  },
  {
    id: 'daily-launcher-3',
    label: 'ロケランでキル3回',
    target: 3,
    rewardXp: 5000,
    check: (s) => weaponIdKills(s, LAUNCHER_IDS),
  },
  {
    id: 'daily-sniper-3',
    label: 'スナイパーキル3回',
    target: 3,
    rewardXp: 5000,
    check: (s) => weaponIdKills(s, SNIPER_IDS),
  },
  {
    id: 'daily-zombie-20',
    label: 'ゾンビで20体以上倒す',
    target: 20,
    rewardXp: 5000,
    check: (s, m) => (m === 'zombie' ? s.kills : 0),
  },
];

/** 難易度: hard — 報酬 10000 XP */
export const POOL_HARD: readonly DailyChallengeDef[] = [
  {
    id: 'daily-kill-15',
    label: '1試合でキル15以上',
    target: 15,
    rewardXp: 10000,
    check: (s) => s.kills,
  },
  {
    id: 'daily-nodeath-8',
    label: 'デスなしでキル8以上',
    target: 1,
    rewardXp: 10000,
    check: (s) => (s.deaths === 0 && s.kills >= 8 ? 1 : 0),
  },
  {
    id: 'daily-medal-5',
    label: '1試合でメダル5個以上',
    target: 1,
    rewardXp: 10000,
    check: (s) => (totalMedals(s) >= 5 ? 1 : 0),
  },
  {
    id: 'daily-cap3-win',
    label: '拠点制圧3回以上で勝利',
    target: 1,
    rewardXp: 10000,
    check: (s) => (s.captures >= 3 && s.won ? 1 : 0),
  },
  {
    id: 'daily-streak-6',
    label: '6連続キル達成',
    target: 1,
    rewardXp: 10000,
    check: (s) => (s.bestStreak >= 6 ? 1 : 0),
  },
];

// 全プールを1配列で参照できるように結合(テスト用)
export const ALL_POOLS: readonly DailyChallengeDef[] = [
  ...POOL_EASY,
  ...POOL_MEDIUM,
  ...POOL_HARD,
];

// ── 決定論的ハッシュ ────────────────────────────────────────────────

/**
 * 32ビット整数の非暗号ハッシュ。
 * 同じ入力は常に同じ出力を返す純関数(テスト可能・シード注入可能)。
 */
export function hash32(n: number): number {
  let h = n >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  // XOR は signed int32 を返すため >>> 0 で uint32 に戻す
  return h >>> 0;
}

// ── 日付演算(Date.now() 不使用・決定論) ──────────────────────────

/**
 * YYYYMMDD 文字列2枚の差を日数で返す。
 * Date.UTC は固定引数なので呼ぶたびに同じ値を返す(Date.now() とは無関係)。
 */
export function daysDiff(a: string, b: string): number {
  const toUtcMs = (s: string): number => {
    const y = Number(s.slice(0, 4));
    const mo = Number(s.slice(4, 6)) - 1;
    const d = Number(s.slice(6, 8));
    return Date.UTC(y, mo, d);
  };
  return Math.round((toUtcMs(a) - toUtcMs(b)) / 86_400_000);
}

// ── UI/保存層ヘルパー (テストでは直接 dateSeed / nowDate を渡す) ──

/**
 * 現在のローカル日付を YYYYMMDD の数値で返す。
 * UI・保存層のみで使うこと(純ロジックテストでは直接数値を渡す)。
 */
export function todayDateSeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** dateSeed(YYYYMMDD 数値) を "YYYYMMDD" 8桁文字列へ変換する。 */
export function dateStringFromSeed(dateSeed: number): string {
  return String(dateSeed).padStart(8, '0');
}

// ─��� 本日のデイリー3選 ─────────────────────────────────────────────

/**
 * dateSeed(YYYYMMDD 数値)から本日の3チャレンジを決定論で選ぶ。
 * 戻り値は常に [easy, medium, hard] の順。
 */
export function dailiesFor(
  dateSeed: number,
): [DailyChallengeDef, DailyChallengeDef, DailyChallengeDef] {
  const pick = (pool: readonly DailyChallengeDef[], salt: number): DailyChallengeDef => {
    const idx = hash32(dateSeed * 97 + salt) % pool.length;
    return pool[idx] as DailyChallengeDef;
  };
  return [pick(POOL_EASY, 1), pick(POOL_MEDIUM, 2), pick(POOL_HARD, 3)];
}

// ── ストリーク更新(純関数) ──────────────────────────────────────────

/**
 * nowDate の日にチャレンジクリアが発生した際のストリーク更新。
 * 同日2回目以降は何もしない。
 * - 翌日(diff=1): streak +1
 * - 当日(diff=0): 変化なし(ガード済み)
 * - 2日以上空き: streak を 1 へリセット
 */
export function updateStreak(state: DailyState, nowDate: string): void {
  if (state.lastClearDate === nowDate) return; // 今日はすでに更新済み

  const prev = state.lastClearDate;
  state.lastClearDate = nowDate;

  if (prev === '') {
    // 初回クリア
    state.streakDays = 1;
    return;
  }

  const diff = daysDiff(nowDate, prev);
  if (diff === 1) {
    state.streakDays += 1;
  } else if (diff > 1) {
    state.streakDays = 1;
  }
  // diff < 0 は時計を巻き戻したケース — streak は変えない(安全サイドに倒す)
}

// ── 日付リフレッシュ(メニュー表示時に呼ぶ) ───────────────────────

/**
 * nowDate が前回と異なる場合に進捗・クレーム状態をリセットする。
 * 試合を経由しないメニュー表示でも日付跨ぎを正しく反映するために使う。
 */
export function refreshDailiesDate(state: DailyState, nowDate: string): void {
  if (state.currentDate === nowDate) return;
  state.currentDate = nowDate;
  // V31修正: 1日以上欠かした場合はストリークを即0へ(達成まで過大表示が残らないように)
  if (state.lastClearDate && daysDiff(state.lastClearDate, nowDate) > 1) {
    state.streakDays = 0;
  }
  state.progress[0] = 0;
  state.progress[1] = 0;
  state.progress[2] = 0;
  state.claimed[0] = false;
  state.claimed[1] = false;
  state.claimed[2] = false;
}

// ── デイリー進捗の反映 ─────────────────────────────────────────────

/**
 * 1試合の結果をデイリーステートへ反映し、新たに付与する XP 内訳を返す。
 * profile.daily を直接変更する。
 * 返り値は xpBreakdown へ push すること。
 * ※ 返り値の xp は xpMul 対象外の固定値 — 呼び側で乗算しないこと。
 *
 * @param daily    profile.daily への参照(変更される)
 * @param summary  試合サマリ(DailySummaryInput と構造的に互換)
 * @param mode     ゲームモード
 * @param nowDate  今日の "YYYYMMDD" 文字列(UI層で生成して渡す)
 * @param dateSeed 今日の YYYYMMDD 数値(dailiesFor に渡す)
 */
export function applyDailies(
  daily: DailyState,
  summary: DailySummaryInput,
  mode: GameMode,
  nowDate: string,
  dateSeed: number,
): DailyXpEntry[] {
  // 日付が変わっていたら進捗・クレームをリセット
  refreshDailiesDate(daily, nowDate);

  const [ch0, ch1, ch2] = dailiesFor(dateSeed);
  const earned: DailyXpEntry[] = [];

  // 各難易度(0=easy, 1=medium, 2=hard)を個別に処理。タプルの直接アクセスで型安全。
  for (const [ch, i] of [
    [ch0, 0] as const,
    [ch1, 1] as const,
    [ch2, 2] as const,
  ]) {
    if (daily.claimed[i]) continue;
    const gained = ch.check(summary, mode);
    const prev = daily.progress[i];
    const newProg = Math.min(ch.target, prev + gained);
    daily.progress[i] = newProg;

    if (newProg >= ch.target) {
      daily.claimed[i] = true;
      earned.push({ label: `デイリー達成！${ch.label}`, xp: ch.rewardXp });
      updateStreak(daily, nowDate);
    }
  }

  return earned;
}
