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

describe('XP乗数', () => {
  it('xpMul=50 で1試合のXP合計・各行とも50倍になる(非ゾンビ相当)', () => {
    const profile = emptyProfile();
    // won=true, kills=5: 勝利500+キル500+初陣チャレンジ200 = 1200 → ×50 = 60000
    const progress = applyMatch(profile, summary({ won: true, kills: 5 }), 50);
    expect(progress.xpTotal).toBe(60000);
    expect(profile.xp).toBe(60000);
    // breakdown のキルXPも50倍
    const killEntry = progress.xpBreakdown.find((e) => e.label.startsWith('キル'));
    expect(killEntry?.xp).toBe(25000); // 5 * 100 * 50
  });

  it('xpMul=5 でゾンビモード相当の5倍になる', () => {
    const p1 = emptyProfile();
    const p2 = emptyProfile();
    const s = summary({ won: false, kills: 3 });
    const base = applyMatch(p1, { ...s }); // xpMul=1 の基準
    const scaled = applyMatch(p2, { ...s }, 5);
    expect(scaled.xpTotal).toBe(base.xpTotal * 5);
    expect(p2.xp).toBe(p1.xp * 5);
    // breakdown のキルXPも5倍
    const killEntry = scaled.xpBreakdown.find((e) => e.label.startsWith('キル'));
    expect(killEntry?.xp).toBe(3 * 100 * 5); // 3 * 100 * 5 = 1500
  });

  it('xpMul=1 は省略時と同一(乗算なし)', () => {
    const p1 = emptyProfile();
    const p2 = emptyProfile();
    const s = summary({ won: false, kills: 3 });
    const r1 = applyMatch(p1, { ...s });
    const r2 = applyMatch(p2, { ...s }, 1);
    expect(r2.xpTotal).toBe(r1.xpTotal);
    expect(p2.xp).toBe(p1.xp);
  });

  it('xpMul はレベル曲線 xpToNext に影響しない', () => {
    expect(xpToNext(1)).toBe(750);
    expect(xpToNext(100)).toBe(25_500);
    expect(xpToNext(999)).toBe(65_500 + 499 * 50); // = 90_450
  });

  it('キャンペーンミッションでも xpMul=50 が効く(初制圧ボーナス込み)', () => {
    const ch1 = CAMPAIGN[0]!;
    const m1 = ch1.missions[0]!;
    const p1 = emptyProfile();
    const p2 = emptyProfile();
    // won=true, kills=0: 勝利500+初制圧ボーナス800 = 1300 → ×50 = 65000
    const ms = missionSummary(m1.id, ch1.id, true, 30);
    const base = applyCampaignMission(p1, { ...ms });
    const scaled = applyCampaignMission(p2, { ...ms }, 50);
    expect(scaled.xpTotal).toBe(base.xpTotal * 50);
    expect(p2.xp).toBe(p1.xp * 50);
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

// ── MAX_LEVEL=1000 曲線テスト ─────────────────────────────────────────────────────
// 累積XP定数(テスト内でも同一ロジックで導出できるが、固定値で回帰テストとして保持する)
// sum(xpToNext(1..99))  = 99*750 + 250*(98*99/2) = 1_287_000
// sum(xpToNext(100..499)) = 400*25_500 + 100*(399*400/2) = 18_180_000
// sum(xpToNext(500..998)) = 499*65_500 + 50*(498*499/2) = 38_897_050
// xpToNext(999) = 65_500 + 499*50 = 90_450
// sum(xpToNext(1..999)) = 58_454_500
const XP_FOR_L100  = 1_287_000;
const XP_FOR_L999  = 1_287_000 + 18_180_000 + 38_897_050; // = 58_364_050
const XP_FOR_L1000 = 58_454_500;

describe('MAX_LEVEL=1000 進行曲線', () => {
  it('L1-99 の xpToNext は旧曲線と同一(後方互換)', () => {
    expect(xpToNext(1)).toBe(750);
    expect(xpToNext(50)).toBe(750 + 49 * 250);  // 13_000
    expect(xpToNext(99)).toBe(750 + 98 * 250);  // 25_250
  });

  it('既存セーブXPで旧L100が下がらない(後方互換)', () => {
    // 旧L100到達XP = 1_287_000 → 新計算でも level>=100 を保証
    const state = levelFromXp(XP_FOR_L100);
    expect(state.level).toBeGreaterThanOrEqual(100);
  });

  it('xpToNext は L100 で旧曲線と連続する(不連続なし)', () => {
    // 旧曲線 xpToNext(100) = 750 + 99*250 = 25_500。新曲線も同値で継続。
    expect(xpToNext(100)).toBe(25_500);
  });

  it('L999→L1000: toNext 分 XP 積算で上限到達', () => {
    const before = levelFromXp(XP_FOR_L999);
    expect(before.level).toBe(999);
    expect(before.toNext).toBe(xpToNext(999));  // = 90_450

    const after = levelFromXp(XP_FOR_L999 + xpToNext(999));
    expect(after.level).toBe(MAX_LEVEL);  // = 1000
    expect(after.toNext).toBe(0);
  });

  it('L1000(上限)で toNext=0 かつ level=MAX_LEVEL', () => {
    const state = levelFromXp(XP_FOR_L1000);
    expect(state.level).toBe(MAX_LEVEL);
    expect(state.toNext).toBe(0);
    // 更に XP を積んでも 1000 を超えない
    expect(levelFromXp(XP_FOR_L1000 + 10_000_000).level).toBe(MAX_LEVEL);
  });

  it('xpToNext は L1→L999 の全域で単調増加', () => {
    for (let l = 1; l < 999; l += 1) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
  });
});
