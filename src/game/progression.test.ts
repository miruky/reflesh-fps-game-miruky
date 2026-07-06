import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import { WEAPON_DEFS } from './weapons';
import { ATTACHMENT_DEFS } from './attachments';
import { CAMO_WEAPON_IDS } from './camo';
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
  rankNameFor,
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
    // XP_FOR_L9999 = 1_884_801_550。2Bは確実にL9999超え
    const state = levelFromXp(2_000_000_000);
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

describe('カモチャレンジ積算(applyMatch)', () => {
  it('武器別キル/HSが weaponStats へ累積される', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ kills: 10, killsByWeapon: { 'kaede-ar': 10 }, hsByWeapon: { 'kaede-ar': 3 } }));
    applyMatch(profile, summary({ kills: 5, killsByWeapon: { 'kaede-ar': 5 } }));
    expect(profile.weaponStats['kaede-ar']).toEqual({ kills: 15, headshots: 3 });
  });

  it('しきい値到達でカモ解除がnewCamosとXP内訳に載る', () => {
    const profile = emptyProfile();
    profile.weaponStats['kaede-ar'] = { kills: 20, headshots: 0 };
    const progress = applyMatch(
      profile,
      summary({ kills: 5, killsByWeapon: { 'kaede-ar': 5 } }),
    );
    expect(progress.newCamos).toHaveLength(1);
    expect(progress.newCamos[0]?.camoId).toBe('dirt');
    expect(progress.newCamos[0]?.label).toContain('カエデAR');
    expect(progress.xpBreakdown.some((e) => e.label.startsWith('カモ解除:'))).toBe(true);
  });

  it('1試合で複数段を跨ぐと全段が報告される', () => {
    const profile = emptyProfile();
    const progress = applyMatch(
      profile,
      summary({ kills: 120, killsByWeapon: { 'tsubaki-smg': 120 } }),
    );
    expect(progress.newCamos.map((c) => c.camoId)).toEqual(['dirt', 'woodland', 'tiger', 'blue']);
  });

  it('ゴールドは500キルだけでは開かず、HS100で開く', () => {
    const profile = emptyProfile();
    const first = applyMatch(
      profile,
      summary({ kills: 500, killsByWeapon: { 'kaede-ar': 500 }, hsByWeapon: { 'kaede-ar': 99 } }),
    );
    expect(first.newCamos.map((c) => c.camoId)).not.toContain('gold');
    const second = applyMatch(
      profile,
      summary({ kills: 1, killsByWeapon: { 'kaede-ar': 1 }, hsByWeapon: { 'kaede-ar': 1 } }),
    );
    expect(second.newCamos.map((c) => c.camoId)).toEqual(['gold']);
  });

  it('単独武器クラス(launcher)のゴールドで同試合内にダイヤも解除される', () => {
    const profile = emptyProfile();
    const progress = applyMatch(
      profile,
      summary({ kills: 500, killsByWeapon: { 'gouka-rl': 500 }, hsByWeapon: { 'gouka-rl': 100 } }),
    );
    const ids = progress.newCamos.map((c) => c.camoId);
    expect(ids).toContain('gold');
    expect(ids).toContain('diamond');
  });

  it('最後のクラスがダイヤに達するとダークマターが解除される', () => {
    const profile = emptyProfile();
    // launcher(gouka-rl)以外の全カモ対象武器をゴールド済みにしておく
    for (const id of CAMO_WEAPON_IDS) {
      if (id === 'gouka-rl') continue;
      profile.weaponStats[id] = { kills: 500, headshots: 100 };
    }
    const progress = applyMatch(
      profile,
      summary({ kills: 500, killsByWeapon: { 'gouka-rl': 500 }, hsByWeapon: { 'gouka-rl': 100 } }),
    );
    const ids = progress.newCamos.map((c) => c.camoId);
    expect(ids).toContain('gold');
    expect(ids).toContain('diamond');
    expect(ids).toContain('dark-matter');
    expect(progress.xpBreakdown.some((e) => e.label.includes('ダークマター'))).toBe(true);
  });

  it('既解除のカモは再報告されない', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ kills: 30, killsByWeapon: { 'kaede-ar': 30 } }));
    const again = applyMatch(profile, summary({ kills: 1, killsByWeapon: { 'kaede-ar': 1 } }));
    expect(again.newCamos).toHaveLength(0);
  });

  it('killsByWeapon省略(旧経路)は何も起きない(後方互換)', () => {
    const profile = emptyProfile();
    const progress = applyMatch(profile, summary({ kills: 100, weaponKills: { カエデAR: 100 } }));
    expect(progress.newCamos).toHaveLength(0);
    expect(profile.weaponStats).toEqual({});
  });

  it('副武器・近接など対象外IDは統計のみ積み、解除は発生しない', () => {
    const profile = emptyProfile();
    const progress = applyMatch(profile, summary({ kills: 200, killsByWeapon: { suzume: 200 } }));
    expect(profile.weaponStats['suzume']).toEqual({ kills: 200, headshots: 0 });
    expect(progress.newCamos).toHaveLength(0);
  });

  it('カモ解除XPにも xpMul が掛かる', () => {
    const profile = emptyProfile();
    const progress = applyMatch(
      profile,
      summary({ kills: 25, killsByWeapon: { 'kaede-ar': 25 } }),
      10,
    );
    const row = progress.xpBreakdown.find((e) => e.label.startsWith('カモ解除:'));
    expect(row?.xp).toBe(1000); // dirt 100 XP × 10
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

// ── MAX_LEVEL=9999 曲線テスト ─────────────────────────────────────────────────────
// 累積XP定数(テスト内でも同一ロジックで導出できるが、固定値で回帰テストとして保持する)
// sum(xpToNext(1..99))    = 99*750 + 250*(98*99/2) = 1_287_000
// sum(xpToNext(100..499)) = 400*25_500 + 100*(399*400/2) = 18_180_000
// sum(xpToNext(500..998)) = 499*65_500 + 50*(498*499/2) = 38_897_050
// xpToNext(999) = 65_500 + 499*50 = 90_450
// sum(xpToNext(1..999))   = 58_454_500
// sum(xpToNext(1000..4999)) = 4000*90_450 + 25*(4000*4001/2) = 561_850_000
// sum(xpToNext(1000..9998)) = 8999*90_450 + 25*(8999*9000/2) = 1_826_347_050
const XP_FOR_L100  = 1_287_000;
const XP_FOR_L999  = 1_287_000 + 18_180_000 + 38_897_050; // = 58_364_050
const XP_FOR_L1000 = 58_454_500;
const XP_FOR_L5000 = 620_304_500;  // XP_FOR_L1000 + 561_850_000
const XP_FOR_L9999 = 1_884_801_550; // XP_FOR_L1000 + 1_826_347_050

describe('MAX_LEVEL=9999 進行曲線', () => {
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

  it('L999→L1000: xpToNext(999) 分積んでL1000に上がる', () => {
    const before = levelFromXp(XP_FOR_L999);
    expect(before.level).toBe(999);
    expect(before.toNext).toBe(xpToNext(999));  // = 90_450

    // XP_FOR_L1000 = XP_FOR_L999 + xpToNext(999) = 58_454_500
    const after = levelFromXp(XP_FOR_L1000);
    expect(after.level).toBe(1000);
    expect(after.toNext).toBe(xpToNext(1000));  // = 90_475
  });

  it('xpToNext は L1000 で L999 より 25 多い(高原化継続)', () => {
    expect(xpToNext(1000)).toBe(90_450 + 25);       // 90_475
    expect(xpToNext(9998)).toBe(90_450 + 8999 * 25); // 315_425
  });

  it('L5000 到達累積XP が正しい', () => {
    const state = levelFromXp(XP_FOR_L5000);
    expect(state.level).toBe(5000);
    expect(state.toNext).toBe(xpToNext(5000));
  });

  it('L9999(上限)で toNext=0 かつ level=MAX_LEVEL', () => {
    const state = levelFromXp(XP_FOR_L9999);
    expect(state.level).toBe(MAX_LEVEL);  // = 9999
    expect(state.toNext).toBe(0);
    // 更に XP を積んでも 9999 を超えない
    expect(levelFromXp(XP_FOR_L9999 + 10_000_000).level).toBe(MAX_LEVEL);
  });

  it('xpToNext は L1〜L(MAX_LEVEL-1) の全域で単調増加', () => {
    for (let l = 1; l < MAX_LEVEL - 1; l += 1) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
  });
});

describe('rankNameFor', () => {
  it('L1-99 は新兵(tier 0)', () => {
    expect(rankNameFor(1)).toEqual({ name: '新兵', tier: 0 });
    expect(rankNameFor(99)).toEqual({ name: '新兵', tier: 0 });
  });

  it('L100 ちょうどで足軽(tier 1)', () => {
    expect(rankNameFor(100)).toEqual({ name: '足軽', tier: 1 });
    expect(rankNameFor(199)).toEqual({ name: '足軽', tier: 1 });
  });

  it('L999 は覇王(tier 9)', () => {
    expect(rankNameFor(999)).toEqual({ name: '覇王', tier: 9 });
  });

  it('L1000 ちょうどで剣聖(tier 10)', () => {
    expect(rankNameFor(1000)).toEqual({ name: '剣聖', tier: 10 });
    expect(rankNameFor(1999)).toEqual({ name: '剣聖', tier: 10 });
  });

  it('L9999 ちょうどで創世神(tier 19)', () => {
    expect(rankNameFor(9999)).toEqual({ name: '創世神', tier: 19 });
  });

  it('L9000-9998 は神話(tier 18)', () => {
    expect(rankNameFor(9000)).toEqual({ name: '神話', tier: 18 });
    expect(rankNameFor(9998)).toEqual({ name: '神話', tier: 18 });
  });

  it('全20段の名称が揃っている', () => {
    const samples: Array<[number, string]> = [
      [1, '新兵'], [100, '足軽'], [200, '武者'], [300, '侍'], [400, '侍大将'],
      [500, '剣豪'], [600, '修羅'], [700, '鬼神'], [800, '羅刹'], [900, '覇王'],
      [1000, '剣聖'], [2000, '武神'], [3000, '雷神'], [4000, '戦神'], [5000, '天下無双'],
      [6000, '軍神'], [7000, '破壊神'], [8000, '神威'], [9000, '神話'], [9999, '創世神'],
    ];
    for (const [lvl, name] of samples) {
      expect(rankNameFor(lvl).name).toBe(name);
    }
  });
});
