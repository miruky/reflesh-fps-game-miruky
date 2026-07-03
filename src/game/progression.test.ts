import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import { WEAPON_DEFS } from './weapons';
import { ATTACHMENT_DEFS } from './attachments';
import {
  applyCampaignMission,
  applyMatch,
  applyScoreRecord,
  chapterCleared,
  CHALLENGES,
  emptyProfile,
  isMissionUnlocked,
  isUnlocked,
  levelFromXp,
  MAX_LEVEL,
  rankFromRating,
  starRate,
  UNLOCKS,
  xpToNext,
  type MatchSummary,
  type MissionSummary,
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

  it('全ウェポンアンロックのIDが武器定義表に存在する', () => {
    const weaponUnlocks = UNLOCKS.filter((u) => u.kind === 'weapon');
    // 既存6 + 追加21(主18 + 副3)= 27本
    expect(weaponUnlocks.length).toBe(27);
    for (const u of weaponUnlocks) {
      expect(WEAPON_DEFS[u.id], u.id).toBeDefined();
    }
    // ウェポンアンロックのIDは重複しない
    const ids = weaponUnlocks.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全アタッチメントアンロックのIDがアタッチメント定義表に存在する', () => {
    const attachmentUnlocks = UNLOCKS.filter((u) => u.kind === 'attachment');
    // 既存8(reflex/vertical/extended/suppressor/angled/compensator/telescopic/quick)+ 追加光学8 = 16
    expect(attachmentUnlocks.length).toBe(16);
    for (const u of attachmentUnlocks) {
      expect(ATTACHMENT_DEFS[u.id], u.id).toBeDefined();
    }
    // アタッチメントアンロックのIDは重複しない
    const ids = attachmentUnlocks.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('レベル24までに最強ボルト(シラユキ)が解放される', () => {
    const shirayuki = UNLOCKS.find((u) => u.id === 'shirayuki-sniper');
    expect(shirayuki).toBeDefined();
    expect(shirayuki!.level).toBeLessThanOrEqual(24);
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

function missionSummary(
  missionId: string,
  chapterId: string,
  won: boolean,
  timeS: number,
  overrides: Partial<MissionSummary> = {},
): MissionSummary {
  return {
    ...summary({ won, rated: false }),
    missionId,
    chapterId,
    missionWon: won,
    timeS,
    objectiveMet: won,
    modifiers: [],
    ...overrides,
  };
}

describe('starRate', () => {
  it('勝利=1★、par以内で+1★、モディファイア有りで+1★(最大3)', () => {
    expect(starRate(50, 100, 1)).toBe(3);
    expect(starRate(50, 100, 0)).toBe(2);
    expect(starRate(150, 100, 0)).toBe(1);
    expect(starRate(150, 100, 2)).toBe(2);
    expect(starRate(50, 100, 5)).toBe(3); // 上限3
  });
});

describe('applyScoreRecord', () => {
  it('初回は新記録、下回ると更新しない', () => {
    const p = emptyProfile();
    expect(applyScoreRecord(p, 'score:s1', 12)).toBe(true);
    expect(p.scoreRecords['score:s1']).toBe(12);
    expect(applyScoreRecord(p, 'score:s1', 8)).toBe(false);
    expect(p.scoreRecords['score:s1']).toBe(12);
    expect(applyScoreRecord(p, 'score:s1', 20)).toBe(true);
    expect(p.scoreRecords['score:s1']).toBe(20);
  });
  it('0以下や非有限は記録しない', () => {
    const p = emptyProfile();
    expect(applyScoreRecord(p, 'k', 0)).toBe(false);
    expect(applyScoreRecord(p, 'k', Number.NaN)).toBe(false);
    expect(Object.keys(p.scoreRecords)).toHaveLength(0);
  });
});

describe('キャンペーン進行', () => {
  const ch1 = CAMPAIGN[0]!;
  const m1 = ch1.missions[0]!;
  const m2 = ch1.missions[1]!;

  it('新規プロフィールはch1の第1ミッションのみ解放', () => {
    const p = emptyProfile();
    expect(isMissionUnlocked(p, m1.id)).toBe(true);
    expect(isMissionUnlocked(p, m2.id)).toBe(false);
    expect(isMissionUnlocked(p, CAMPAIGN[1]!.missions[0]!.id)).toBe(false);
  });

  it('初クリアで記録追加+初制圧ボーナス、再クリアは重複なし', () => {
    const p = emptyProfile();
    const first = applyCampaignMission(p, missionSummary(m1.id, ch1.id, true, 40));
    expect(first.firstClear).toBe(true);
    expect(p.campaign.clearedMissions).toContain(m1.id);
    expect(first.xpBreakdown.some((e) => e.label === '初制圧ボーナス')).toBe(true);
    expect(isMissionUnlocked(p, m2.id)).toBe(true); // 次が解放
    const again = applyCampaignMission(p, missionSummary(m1.id, ch1.id, true, 40));
    expect(again.firstClear).toBe(false);
    expect(p.campaign.clearedMissions.filter((x) => x === m1.id)).toHaveLength(1);
  });

  it('章を全クリアすると次章が解放される', () => {
    const p = emptyProfile();
    for (const m of ch1.missions) {
      applyCampaignMission(p, missionSummary(m.id, ch1.id, true, 30));
    }
    expect(chapterCleared(p, ch1.id)).toBe(true);
    expect(p.campaign.unlockedChapters).toContain(CAMPAIGN[1]!.id);
  });

  it('キャンペーンはPvP連勝記録・レートを汚染しない', () => {
    const p = emptyProfile();
    p.records.currentWinStreak = 3;
    const ratingBefore = p.rating;
    applyCampaignMission(p, missionSummary(m1.id, ch1.id, true, 30));
    expect(p.records.currentWinStreak).toBe(3); // 不変
    expect(p.rating).toBe(ratingBefore); // 不変
  });

  it('敗北は星0でクリア扱いにならない', () => {
    const p = emptyProfile();
    const r = applyCampaignMission(p, missionSummary(m1.id, ch1.id, false, 200));
    expect(r.stars).toBe(0);
    expect(p.campaign.clearedMissions).not.toContain(m1.id);
  });

  it('生存/防衛ミッションは規定時間を超えても時間★が成立する(2★以上)', () => {
    const survive = CAMPAIGN.flatMap((c) => c.missions).find((m) => m.objective.kind === 'survive');
    expect(survive).toBeTruthy();
    if (!survive) return;
    const p = emptyProfile();
    // 生存はクリア時間=生存時間でpar超過になりがち。それでも時間★が出る(>=2)
    const r = applyCampaignMission(
      p,
      missionSummary(survive.id, survive.chapterId, true, survive.parTimeS + 60, {
        modifiers: [],
      }),
    );
    expect(r.stars).toBeGreaterThanOrEqual(2);
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
