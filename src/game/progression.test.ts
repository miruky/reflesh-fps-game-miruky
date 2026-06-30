import { describe, expect, it } from 'vitest';
import {
  applyMatch,
  CHALLENGES,
  emptyProfile,
  isUnlocked,
  levelFromXp,
  MAX_LEVEL,
  rankFromRating,
  UNLOCKS,
  xpToNext,
  type MatchSummary,
} from './progression';

function summary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    won: false,
    rated: true,
    kills: 0,
    deaths: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    captures: 0,
    bestStreak: 0,
    weaponKills: {},
    unlockedMedals: [],
    medalCounts: {},
    medalXp: 0,
    ...overrides,
  };
}

describe('levelFromXp', () => {
  it('XP0はレベル1', () => {
    const state = levelFromXp(0);
    expect(state.level).toBe(1);
    expect(state.toNext).toBe(xpToNext(1));
  });

  it('必要XPちょうどでレベルが上がる', () => {
    const state = levelFromXp(xpToNext(1));
    expect(state.level).toBe(2);
    expect(state.intoLevel).toBe(0);
  });

  it('レベル上限で頭打ちになる', () => {
    const state = levelFromXp(100_000_000);
    expect(state.level).toBe(MAX_LEVEL);
    expect(state.toNext).toBe(0);
  });
});

describe('アンロック', () => {
  it('初期レベルでARだけが使える', () => {
    expect(isUnlocked('weapon', 'kaede-ar', 1)).toBe(true);
    expect(isUnlocked('weapon', 'kumagera-lmg', 1)).toBe(false);
  });

  it('全アンロックがレベル上限以下に収まる', () => {
    for (const unlock of UNLOCKS) {
      expect(unlock.level).toBeGreaterThanOrEqual(1);
      expect(unlock.level).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});

describe('applyMatch', () => {
  it('キルと勝敗がXPと統計に反映される', () => {
    const profile = emptyProfile();
    const progress = applyMatch(profile, summary({ won: true, kills: 8, headshots: 2 }));
    expect(profile.stats.kills).toBe(8);
    expect(profile.stats.wins).toBe(1);
    // 勝利500 + キル800 + HS50 + 初陣200
    expect(progress.xpTotal).toBe(1550);
    expect(profile.xp).toBe(1550);
  });

  it('敗北でも参加XPが入る', () => {
    const profile = emptyProfile();
    const progress = applyMatch(profile, summary());
    expect(progress.xpTotal).toBe(150);
  });

  it('チャレンジは一度しか達成されない', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ kills: 1 }));
    expect(profile.completedChallenges).toContain('first-blood');
    const second = applyMatch(profile, summary({ kills: 1 }));
    expect(second.completedChallenges).toHaveLength(0);
  });

  it('レベルアップで該当アンロックが報告される', () => {
    const profile = emptyProfile();
    profile.xp = xpToNext(1) - 100; // あと100でレベル2
    const progress = applyMatch(profile, summary({ kills: 1 }));
    expect(progress.levelAfter.level).toBeGreaterThan(progress.levelBefore.level);
    expect(progress.newUnlocks.some((u) => u.level === 2)).toBe(true);
  });

  it('レートは勝ちで上がり負けで下がり、未完了試合では動かない', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ won: true }));
    expect(profile.rating).toBe(1025);
    applyMatch(profile, summary());
    expect(profile.rating).toBe(1010);
    applyMatch(profile, summary({ rated: false }));
    expect(profile.rating).toBe(1010);
  });

  it('投擲物キルのチャレンジは武器名の集計で進む', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ kills: 20, weaponKills: { フラグ: 12, 焼夷: 8 } }));
    expect(profile.completedChallenges).toContain('grenadier-20');
  });
});

describe('自己ベスト記録', () => {
  it('1試合最多キルを更新し、下回る試合では更新しない', () => {
    const profile = emptyProfile();
    const first = applyMatch(profile, summary({ kills: 5 }));
    expect(profile.records.mostKills).toBe(5);
    expect(first.newRecords).toContain('1試合最多キル 5');
    const second = applyMatch(profile, summary({ kills: 3 }));
    expect(profile.records.mostKills).toBe(5);
    expect(second.newRecords).toHaveLength(0);
  });

  it('0キルの試合は記録にならない', () => {
    const profile = emptyProfile();
    const progress = applyMatch(profile, summary({ kills: 0 }));
    expect(profile.records.mostKills).toBe(0);
    expect(progress.newRecords).toHaveLength(0);
  });

  it('連勝を数え、敗北で途切れても最長は残る', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ won: true }));
    applyMatch(profile, summary({ won: true }));
    expect(profile.records.currentWinStreak).toBe(2);
    expect(profile.records.bestWinStreak).toBe(2);
    applyMatch(profile, summary({ won: false }));
    expect(profile.records.currentWinStreak).toBe(0);
    expect(profile.records.bestWinStreak).toBe(2);
  });

  it('連勝の報告は2連勝以上から', () => {
    const profile = emptyProfile();
    const one = applyMatch(profile, summary({ won: true }));
    expect(one.newRecords.some((r) => r.startsWith('連勝'))).toBe(false);
    const two = applyMatch(profile, summary({ won: true }));
    expect(two.newRecords).toContain('連勝 2');
  });
});

describe('rankFromRating', () => {
  it('初期レートは新兵', () => {
    expect(rankFromRating(1000).name).toBe('新兵');
  });

  it('しきい値ちょうどで昇格する', () => {
    expect(rankFromRating(1050).name).toBe('伍長');
    expect(rankFromRating(2000).name).toBe('将官');
  });
});

describe('CHALLENGES定義', () => {
  it('IDが重複しない', () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('進捗は目標値を超えない', () => {
    const profile = emptyProfile();
    profile.stats.kills = 9999;
    profile.stats.captures = 9999;
    for (const challenge of CHALLENGES) {
      const [current, goal] = challenge.progress(profile.stats, { 近接: 9999, フラグ: 9999 });
      expect(current).toBeLessThanOrEqual(goal);
    }
  });
});
