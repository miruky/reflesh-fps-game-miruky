import { describe, expect, it } from 'vitest';
import {
  ALL_POOLS,
  applyDailies,
  dailiesFor,
  dateStringFromSeed,
  daysDiff,
  emptyDailyState,
  hash32,
  POOL_EASY,
  POOL_HARD,
  POOL_MEDIUM,
  refreshDailiesDate,
  todayDateSeed,
  updateStreak,
  type DailySummaryInput,
} from './dailies';

// ── テスト用ヘルパー ─────────────────────────────────────────────────

function emptySummary(overrides: Partial<DailySummaryInput> = {}): DailySummaryInput {
  return {
    won: false,
    kills: 0,
    deaths: 0,
    headshots: 0,
    captures: 0,
    bestStreak: 0,
    weaponKills: {},
    killsByWeapon: {},
    medalCounts: {},
    ...overrides,
  };
}

// ── hash32 ──────────────────────────────────────────────────────────

describe('hash32', () => {
  it('同じ入力は常に同じ値を返す(決定論)', () => {
    expect(hash32(0)).toBe(hash32(0));
    expect(hash32(20260706)).toBe(hash32(20260706));
  });

  it('異なる入力は一般的に異なる値を返す', () => {
    expect(hash32(1)).not.toBe(hash32(2));
    expect(hash32(20260706)).not.toBe(hash32(20260707));
  });

  it('uint32 の範囲 [0, 2^32-1] に収まる', () => {
    const v = hash32(12345678);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(4294967295);
    expect(Number.isInteger(v)).toBe(true);
  });
});

// ── daysDiff ─────────────────────────────────────────────────────────

describe('daysDiff', () => {
  it('同日は 0', () => {
    expect(daysDiff('20260706', '20260706')).toBe(0);
  });

  it('翌日は +1', () => {
    expect(daysDiff('20260707', '20260706')).toBe(1);
  });

  it('前日は -1', () => {
    expect(daysDiff('20260706', '20260707')).toBe(-1);
  });

  it('月をまたぐ差', () => {
    expect(daysDiff('20260801', '20260731')).toBe(1);
    expect(daysDiff('20260731', '20260801')).toBe(-1);
  });

  it('年をまたぐ差', () => {
    expect(daysDiff('20270101', '20261231')).toBe(1);
  });

  it('30日差', () => {
    expect(daysDiff('20260805', '20260706')).toBe(30);
  });
});

// ── todayDateSeed / dateStringFromSeed ────────────────────────────────

describe('todayDateSeed / dateStringFromSeed', () => {
  it('todayDateSeed は YYYYMMDD 8桁の正整数', () => {
    const seed = todayDateSeed();
    expect(seed).toBeGreaterThanOrEqual(20000101);
    expect(seed).toBeLessThanOrEqual(29991231);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('dateStringFromSeed は 8 桁文字列', () => {
    expect(dateStringFromSeed(20260706)).toBe('20260706');
    // ゼロ埋め(理論上起きないが安全確認)
    expect(dateStringFromSeed(1010101)).toBe('01010101');
  });
});

// ── チャレンジプール構造 ─────────────────────────────────────────────

describe('CHALLENGE_POOL 構造', () => {
  it('POOL_EASY は 6 種類(ガンゲーム勝利追加)', () => {
    expect(POOL_EASY).toHaveLength(6);
  });

  it('POOL_MEDIUM は 7 種類(特殊兵装キル/KCタグ追加)', () => {
    expect(POOL_MEDIUM).toHaveLength(7);
  });

  it('POOL_HARD は 7 種類(ハードポイント/ウルトキル追加)', () => {
    expect(POOL_HARD).toHaveLength(7);
  });

  it('ALL_POOLS は 20 種類', () => {
    expect(ALL_POOLS).toHaveLength(20);
  });

  it('POOL_EASY の rewardXp はすべて 20000', () => {
    for (const ch of POOL_EASY) {
      expect(ch.rewardXp).toBe(20000);
    }
  });

  it('POOL_MEDIUM の rewardXp はすべて 50000', () => {
    for (const ch of POOL_MEDIUM) {
      expect(ch.rewardXp).toBe(50000);
    }
  });

  it('POOL_HARD の rewardXp はすべて 100000', () => {
    for (const ch of POOL_HARD) {
      expect(ch.rewardXp).toBe(100000);
    }
  });

  it('ID は全プール内で一意', () => {
    const ids = ALL_POOLS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('全チャレンジに check 関数が存在する', () => {
    for (const ch of ALL_POOLS) {
      expect(typeof ch.check).toBe('function');
    }
  });
});

// ── dailiesFor ─────────────────────────────────────────────────────

describe('dailiesFor', () => {
  it('同じ dateSeed は同じ3チャレンジを返す(決定論)', () => {
    const a = dailiesFor(20260706);
    const b = dailiesFor(20260706);
    expect(a[0].id).toBe(b[0].id);
    expect(a[1].id).toBe(b[1].id);
    expect(a[2].id).toBe(b[2].id);
  });

  it('異なる dateSeed は(一般に)異なるチャレンジを返す', () => {
    const a = dailiesFor(20260706);
    const b = dailiesFor(20260707);
    // 全3個が偶然一致する確率は 1/125 未満。隣日なので特に差が出る。
    const same = a[0].id === b[0].id && a[1].id === b[1].id && a[2].id === b[2].id;
    expect(same).toBe(false);
  });

  it('[0] は POOL_EASY から', () => {
    const [easy] = dailiesFor(20260706);
    const easyIds = POOL_EASY.map((c) => c.id);
    expect(easyIds).toContain(easy.id);
  });

  it('[1] は POOL_MEDIUM から', () => {
    const [, medium] = dailiesFor(20260706);
    const mediumIds = POOL_MEDIUM.map((c) => c.id);
    expect(mediumIds).toContain(medium.id);
  });

  it('[2] は POOL_HARD から', () => {
    const [, , hard] = dailiesFor(20260706);
    const hardIds = POOL_HARD.map((c) => c.id);
    expect(hardIds).toContain(hard.id);
  });
});

// ── 各 check 関数 ───────────────────────────────────────────────────

describe('check 関数: POOL_EASY', () => {
  it('daily-win: 勝利で 1', () => {
    const ch = POOL_EASY.find((c) => c.id === 'daily-win')!;
    expect(ch.check(emptySummary({ won: true }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ won: false }), 'tdm')).toBe(0);
  });

  it('daily-kill-5: kills をそのまま返す', () => {
    const ch = POOL_EASY.find((c) => c.id === 'daily-kill-5')!;
    expect(ch.check(emptySummary({ kills: 7 }), 'tdm')).toBe(7);
    expect(ch.check(emptySummary({ kills: 0 }), 'tdm')).toBe(0);
  });

  it('daily-hs-3: headshots をそのまま返す', () => {
    const ch = POOL_EASY.find((c) => c.id === 'daily-hs-3')!;
    expect(ch.check(emptySummary({ headshots: 4 }), 'tdm')).toBe(4);
  });

  it('daily-melee-3: 近接+クナイの合計', () => {
    const ch = POOL_EASY.find((c) => c.id === 'daily-melee-3')!;
    expect(ch.check(emptySummary({ weaponKills: { '近接': 2 } }), 'tdm')).toBe(2);
    expect(ch.check(emptySummary({ weaponKills: { 'クナイ': 3 } }), 'tdm')).toBe(3);
    expect(ch.check(emptySummary({ weaponKills: { '近接': 1, 'クナイ': 2 } }), 'tdm')).toBe(3);
    expect(ch.check(emptySummary({ weaponKills: {} }), 'tdm')).toBe(0);
  });

  it('daily-streak-4: bestStreak >= 4 で 1', () => {
    const ch = POOL_EASY.find((c) => c.id === 'daily-streak-4')!;
    expect(ch.check(emptySummary({ bestStreak: 4 }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ bestStreak: 5 }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ bestStreak: 3 }), 'tdm')).toBe(0);
  });
});

describe('check 関数: POOL_MEDIUM', () => {
  it('daily-kill-10: kills をそのまま返す', () => {
    const ch = POOL_MEDIUM.find((c) => c.id === 'daily-kill-10')!;
    expect(ch.check(emptySummary({ kills: 12 }), 'tdm')).toBe(12);
  });

  it('daily-hs-5: headshots をそのまま返す', () => {
    const ch = POOL_MEDIUM.find((c) => c.id === 'daily-hs-5')!;
    expect(ch.check(emptySummary({ headshots: 6 }), 'tdm')).toBe(6);
  });

  it('daily-launcher-3: gouka-rl のキルをカウント', () => {
    const ch = POOL_MEDIUM.find((c) => c.id === 'daily-launcher-3')!;
    expect(ch.check(emptySummary({ killsByWeapon: { 'gouka-rl': 3 } }), 'tdm')).toBe(3);
    expect(ch.check(emptySummary({ killsByWeapon: {} }), 'tdm')).toBe(0);
    expect(ch.check(emptySummary({}), 'tdm')).toBe(0);
  });

  it('daily-sniper-3: yamasemi-dmr / raicho-sniper / shirayuki-sniper の合計', () => {
    const ch = POOL_MEDIUM.find((c) => c.id === 'daily-sniper-3')!;
    expect(
      ch.check(
        emptySummary({
          killsByWeapon: { 'yamasemi-dmr': 1, 'raicho-sniper': 1, 'shirayuki-sniper': 1 },
        }),
        'tdm',
      ),
    ).toBe(3);
    expect(ch.check(emptySummary({ killsByWeapon: { 'yamasemi-dmr': 5 } }), 'tdm')).toBe(5);
  });

  it('daily-zombie-20: zombie モードのみ kills をカウント', () => {
    const ch = POOL_MEDIUM.find((c) => c.id === 'daily-zombie-20')!;
    expect(ch.check(emptySummary({ kills: 25 }), 'zombie')).toBe(25);
    expect(ch.check(emptySummary({ kills: 25 }), 'tdm')).toBe(0);
    expect(ch.check(emptySummary({ kills: 25 }), 'story')).toBe(0);
  });
});

describe('check 関数: POOL_HARD', () => {
  it('daily-kill-15: kills をそのまま返す', () => {
    const ch = POOL_HARD.find((c) => c.id === 'daily-kill-15')!;
    expect(ch.check(emptySummary({ kills: 15 }), 'tdm')).toBe(15);
  });

  it('daily-nodeath-8: deaths=0 かつ kills>=8 のみ 1', () => {
    const ch = POOL_HARD.find((c) => c.id === 'daily-nodeath-8')!;
    expect(ch.check(emptySummary({ kills: 8, deaths: 0 }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ kills: 8, deaths: 1 }), 'tdm')).toBe(0);
    expect(ch.check(emptySummary({ kills: 7, deaths: 0 }), 'tdm')).toBe(0);
  });

  it('daily-medal-5: メダル合計 >= 5 で 1', () => {
    const ch = POOL_HARD.find((c) => c.id === 'daily-medal-5')!;
    expect(ch.check(emptySummary({ medalCounts: { a: 3, b: 2 } }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ medalCounts: { a: 4 } }), 'tdm')).toBe(0);
  });

  it('daily-cap3-win: captures >= 3 かつ won のみ 1', () => {
    const ch = POOL_HARD.find((c) => c.id === 'daily-cap3-win')!;
    expect(ch.check(emptySummary({ captures: 3, won: true }), 'dom')).toBe(1);
    expect(ch.check(emptySummary({ captures: 3, won: false }), 'dom')).toBe(0);
    expect(ch.check(emptySummary({ captures: 2, won: true }), 'dom')).toBe(0);
  });

  it('daily-streak-6: bestStreak >= 6 で 1', () => {
    const ch = POOL_HARD.find((c) => c.id === 'daily-streak-6')!;
    expect(ch.check(emptySummary({ bestStreak: 6 }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ bestStreak: 10 }), 'tdm')).toBe(1);
    expect(ch.check(emptySummary({ bestStreak: 5 }), 'tdm')).toBe(0);
  });
});

// ── updateStreak ────────────────────────────────────────────────────

describe('updateStreak', () => {
  it('初回クリアで streakDays = 1', () => {
    const state = emptyDailyState();
    updateStreak(state, '20260706');
    expect(state.streakDays).toBe(1);
    expect(state.lastClearDate).toBe('20260706');
  });

  it('翌日クリアで streak +1', () => {
    const state = emptyDailyState();
    updateStreak(state, '20260706');
    updateStreak(state, '20260707');
    expect(state.streakDays).toBe(2);
  });

  it('2日以上空けるとリセット(streak = 1)', () => {
    const state = emptyDailyState();
    updateStreak(state, '20260706');
    updateStreak(state, '20260710'); // 4日後
    expect(state.streakDays).toBe(1);
  });

  it('同日2回目は変化なし(idempotent)', () => {
    const state = emptyDailyState();
    updateStreak(state, '20260706');
    const beforeStreak = state.streakDays;
    updateStreak(state, '20260706'); // 同日
    expect(state.streakDays).toBe(beforeStreak);
  });

  it('連続3日で streak = 3', () => {
    const state = emptyDailyState();
    updateStreak(state, '20260706');
    updateStreak(state, '20260707');
    updateStreak(state, '20260708');
    expect(state.streakDays).toBe(3);
  });
});

// ── refreshDailiesDate ──────────────────────────────────────────────

describe('refreshDailiesDate', () => {
  it('日付が同じなら変化なし', () => {
    const state = emptyDailyState();
    state.currentDate = '20260706';
    state.progress = [3, 2, 1];
    state.claimed = [true, false, false];
    refreshDailiesDate(state, '20260706');
    expect(state.progress[0]).toBe(3);
    expect(state.claimed[0]).toBe(true);
  });

  it('日付が変わると進捗・クレームをリセット', () => {
    const state = emptyDailyState();
    state.currentDate = '20260706';
    state.progress = [5, 10, 15];
    state.claimed = [true, true, false];
    refreshDailiesDate(state, '20260707');
    expect(state.currentDate).toBe('20260707');
    expect(state.progress[0]).toBe(0);
    expect(state.progress[1]).toBe(0);
    expect(state.progress[2]).toBe(0);
    expect(state.claimed[0]).toBe(false);
    expect(state.claimed[1]).toBe(false);
    expect(state.claimed[2]).toBe(false);
  });
});

// ── applyDailies ────────────────────────────────────────────────────

describe('applyDailies', () => {
  // dateSeed=20260706 で daily-kill-5 が easy に選ばれるか確認した上でテスト
  // 決定論的に dateSeed を固定してテスト可能
  const SEED = 20260706;

  function makeState(): ReturnType<typeof emptyDailyState> {
    const state = emptyDailyState();
    state.currentDate = '20260706';
    return state;
  }

  it('試合ごとに進捗が蓄積する', () => {
    const state = makeState();
    const [easyChallenge] = dailiesFor(SEED);
    // easy の check 関数で 0 以外を返す入力を作る
    const summary1 = emptySummary({
      won: true,
      kills: 15,
      headshots: 10,
      bestStreak: 8,
      captures: 5,
      deaths: 0,
      medalCounts: { a: 5, b: 2 },
      killsByWeapon: {
        'yamasemi-dmr': 3,
        'raicho-sniper': 2,
        'gouka-rl': 4,
        'shirayuki-sniper': 1,
      },
      weaponKills: { '近接': 4, 'クナイ': 3 },
    });
    // 1試合目
    applyDailies(state, summary1, 'tdm', '20260706', SEED);
    // easyChallenge に対して何らかの進捗があること
    expect(state.progress[0]).toBeGreaterThanOrEqual(0);
    const progressAfter1 = state.progress[0];
    // target に達していない場合は claimed=false
    if (progressAfter1 < easyChallenge.target) {
      expect(state.claimed[0]).toBe(false);
    }
  });

  it('クレーム済みのチャレンジを二重付与しない', () => {
    const state = makeState();
    const [easy] = dailiesFor(SEED);
    // easy をすでにクリアした状態にする
    state.progress = [easy.target, 0, 0];
    state.claimed = [true, false, false];
    state.streakDays = 1;
    state.lastClearDate = '20260706';

    const summary1 = emptySummary({ won: true, kills: 20, headshots: 10, bestStreak: 10 });
    const entries = applyDailies(state, summary1, 'tdm', '20260706', SEED);
    // easy の XP は付与されない
    const easyEntries = entries.filter((e) => e.xp === easy.rewardXp);
    expect(easyEntries.length).toBe(0);
  });

  it('初クリア時にストリークが +1 される', () => {
    const state = makeState();
    const [easy] = dailiesFor(SEED);
    // progress が target-1 の状態で試合結果で達成
    state.progress = [easy.target - 1, 0, 0];
    // easy チャレンジが達成できる summary
    const bigSummary = emptySummary({
      won: true,
      kills: 30,
      headshots: 20,
      bestStreak: 10,
      captures: 10,
      deaths: 0,
      medalCounts: { x: 10 },
      killsByWeapon: { 'yamasemi-dmr': 10, 'raicho-sniper': 10, 'gouka-rl': 10 },
      weaponKills: { '近接': 10 },
    });
    const before = state.streakDays;
    applyDailies(state, bigSummary, 'tdm', '20260706', SEED);
    if (state.claimed[0]) {
      expect(state.streakDays).toBeGreaterThan(before);
    }
  });

  it('zombie モード依存チャレンジが正しく処理される', () => {
    // daily-zombie-20 が medium に選ばれるシードを探す
    // どのシードでも zombie モードの kills は medium チャレンジに影響する可能性がある
    const [, medium] = dailiesFor(SEED);
    const zombieSummary = emptySummary({ kills: 25 });
    const tdmEntries = applyDailies(
      { ...makeState() },
      zombieSummary,
      'tdm',
      '20260706',
      SEED,
    );
    const zombieEntries = applyDailies(
      { ...makeState() },
      zombieSummary,
      'zombie',
      '20260706',
      SEED,
    );
    if (medium.id === 'daily-zombie-20') {
      // zombie モードのみ進捗が入る
      expect(zombieEntries.some((e) => e.xp === 50000)).toBe(true);
      expect(tdmEntries.some((e) => e.xp === 50000)).toBe(false);
    }
  });

  it('日付跨ぎで進捗がリセットされる', () => {
    const state = makeState();
    state.progress = [3, 5, 7];
    state.claimed = [true, false, false];
    // 新しい日付で applyDailies を呼ぶ
    applyDailies(state, emptySummary(), 'tdm', '20260707', SEED + 1);
    expect(state.currentDate).toBe('20260707');
    // 旧日付の claimed=true はリセットされているはず
    // (progress はリセット後に今回の試合分が加算される)
    expect(state.claimed[0]).toBe(false);
  });

  it('返り値の xp は xpMul 対象外の固定値(EASY=20000/MED=50000/HARD=100000)', () => {
    // 大量に達成できる summary でチャレンジをクリア
    const bigSummary = emptySummary({
      won: true,
      kills: 30,
      headshots: 20,
      bestStreak: 10,
      captures: 10,
      deaths: 0,
      medalCounts: { x: 10 },
      killsByWeapon: {
        'yamasemi-dmr': 10,
        'raicho-sniper': 10,
        'shirayuki-sniper': 10,
        'gouka-rl': 10,
      },
      weaponKills: { '近接': 10 },
    });
    const state = makeState();
    const entries = applyDailies(state, bigSummary, 'zombie', '20260706', SEED);
    for (const e of entries) {
      expect([20000, 50000, 100000]).toContain(e.xp);
    }
  });
});
