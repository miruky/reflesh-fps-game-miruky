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
  levelRankUpgrade,
  MAX_LEVEL,
  rankFromRating,
  rankNameFor,
  starRate,
  UNLOCKS,
  XP_MUL_NORMAL,
  XP_MUL_ZOMBIE,
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

  it('R49: レベルは無限化されており頭打ちにならない', () => {
    // XP_FOR_L99999 ≈ 70_774_851_550。80Bは確実に旧上限L99999を超える
    const state = levelFromXp(80_000_000_000);
    expect(state.level).toBeGreaterThan(99999);
    expect(state.toNext).toBeGreaterThan(0);
    // 更にXPを積むと、旧上限に縛られずさらにレベルが上がる
    const more = levelFromXp(80_000_000_000 + 10_000_000_000);
    expect(more.level).toBeGreaterThan(state.level);
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

  it('連勝を数え、敗北でもリセットされない(R48仕様)', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ won: true }));
    applyMatch(profile, summary({ won: true }));
    expect(profile.records.currentWinStreak).toBe(2);
    expect(profile.records.bestWinStreak).toBe(2);
    applyMatch(profile, summary({ won: false }));
    expect(profile.records.currentWinStreak).toBe(2); // R48: 敗北でリセットしない
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
  it('XP_MUL_NORMAL の定数値が 500 である', () => {
    expect(XP_MUL_NORMAL).toBe(500);
  });

  it('XP_MUL_ZOMBIE の定数値が 25 である', () => {
    expect(XP_MUL_ZOMBIE).toBe(25);
  });

  it('XP_MUL_NORMAL(×500)で1試合のXP合計・各行とも500倍になる(非ゾンビ相当)', () => {
    const profile = emptyProfile();
    // won=true, kills=5: 勝利500+キル500+初陣チャレンジ200 = 1200 → ×500 = 600_000
    const progress = applyMatch(profile, summary({ won: true, kills: 5 }), XP_MUL_NORMAL);
    expect(progress.xpTotal).toBe(600_000);
    expect(profile.xp).toBe(600_000);
    // breakdown のキルXPも500倍
    const killEntry = progress.xpBreakdown.find((e) => e.label.startsWith('キル'));
    expect(killEntry?.xp).toBe(250_000); // 5 * 100 * 500
  });

  it('XP_MUL_ZOMBIE(×25)でゾンビモード相当の25倍になる', () => {
    const p1 = emptyProfile();
    const p2 = emptyProfile();
    const s = summary({ won: false, kills: 3 });
    const base = applyMatch(p1, { ...s }); // xpMul=1 の基準
    const scaled = applyMatch(p2, { ...s }, XP_MUL_ZOMBIE);
    expect(scaled.xpTotal).toBe(base.xpTotal * XP_MUL_ZOMBIE);
    expect(p2.xp).toBe(p1.xp * XP_MUL_ZOMBIE);
    // breakdown のキルXPも25倍
    const killEntry = scaled.xpBreakdown.find((e) => e.label.startsWith('キル'));
    expect(killEntry?.xp).toBe(3 * 100 * XP_MUL_ZOMBIE); // 3 * 100 * 25 = 7500
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
    expect(xpToNext(10000)).toBe(315_460);           // L10000+新曲線
  });

  it('キャンペーンミッションでも XP_MUL_NORMAL が効く(初制圧ボーナス込み)', () => {
    const ch1 = CAMPAIGN[0]!;
    const m1 = ch1.missions[0]!;
    const p1 = emptyProfile();
    const p2 = emptyProfile();
    // won=true, kills=0: 勝利500+初制圧ボーナス800 = 1300 → ×500 = 650_000
    // R53修正: デイリーチャレンジXPは設計上 xpMul 対象外(R31)かつ「今日の日付シード」で
    // 達成有無が変わるため、デイリー行を除いた乗算部のみで等式を検証する(日付非依存化。
    // 旧アサート scaled.xpTotal === base.xpTotal×MUL は、デイリーが達成される日付でのみ
    // 落ちる flaky だった)
    const ms = missionSummary(m1.id, ch1.id, true, 30);
    const base = applyCampaignMission(p1, { ...ms });
    const scaled = applyCampaignMission(p2, { ...ms }, XP_MUL_NORMAL);
    const dailySum = (rows: { label: string; xp: number }[]): number =>
      rows.filter((r) => r.label.startsWith('デイリー')).reduce((s, r) => s + r.xp, 0);
    const baseDaily = dailySum(base.xpBreakdown);
    const scaledDaily = dailySum(scaled.xpBreakdown);
    // デイリー行は両プロフィールで同一(同じ日付シード・同じ戦績)かつ非乗算
    expect(scaledDaily).toBe(baseDaily);
    expect(scaled.xpTotal - scaledDaily).toBe((base.xpTotal - baseDaily) * XP_MUL_NORMAL);
    expect(p2.xp - scaledDaily).toBe((p1.xp - baseDaily) * XP_MUL_NORMAL);
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

// ── レベル曲線テスト(旧上限99999まわり・R49以降は無限に継続) ──────────────────────
// 累積XP定数(テスト内でも同一ロジックで導出できるが、固定値で回帰テストとして保持する)
// sum(xpToNext(1..99))    = 99*750 + 250*(98*99/2) = 1_287_000
// sum(xpToNext(100..499)) = 400*25_500 + 100*(399*400/2) = 18_180_000
// sum(xpToNext(500..998)) = 499*65_500 + 50*(498*499/2) = 38_897_050
// xpToNext(999) = 65_500 + 499*50 = 90_450
// sum(xpToNext(1..999))   = 58_454_500
// sum(xpToNext(1000..4999)) = 4000*90_450 + 25*(4000*4001/2) = 561_850_000
// sum(xpToNext(1000..9998)) = 8999*90_450 + 25*(8999*9000/2) = 1_826_347_050
// xpToNext(9999) = 90_450 + 9000*25 = 315_450
// sum(xpToNext(1..9999))  = 1_884_801_550 + 315_450 = 1_885_117_000
// sum(xpToNext(10000..49999)) = 40000*315_450 + 10*(40000*40001/2) = 20_618_200_000
// sum(xpToNext(10000..99998)) = 89999*315_450 + 10*(89999*90000/2) = 68_889_734_550
const XP_FOR_L100   = 1_287_000;
const XP_FOR_L999   = 1_287_000 + 18_180_000 + 38_897_050; // = 58_364_050
const XP_FOR_L1000  = 58_454_500;
const XP_FOR_L5000  = 620_304_500;   // XP_FOR_L1000 + 561_850_000
const XP_FOR_L9999  = 1_884_801_550; // XP_FOR_L1000 + 1_826_347_050
const XP_FOR_L10000 = 1_885_117_000; // XP_FOR_L9999 + xpToNext(9999)=315_450
const XP_FOR_L50000 = 22_503_317_000; // XP_FOR_L10000 + 20_618_200_000
const XP_FOR_L99999 = 70_774_851_550; // XP_FOR_L10000 + 68_889_734_550

describe('無限レベル進行曲線(旧上限99999を含む)', () => {
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
    expect(xpToNext(1000)).toBe(90_450 + 25);        // 90_475
    expect(xpToNext(9998)).toBe(90_450 + 8999 * 25); // 315_425
    expect(xpToNext(9999)).toBe(315_450);             // L9999 は旧formula の末尾
  });

  it('L5000 到達累積XP が正しい', () => {
    const state = levelFromXp(XP_FOR_L5000);
    expect(state.level).toBe(5000);
    expect(state.toNext).toBe(xpToNext(5000));
  });

  it('XP_FOR_L9999 で旧上限L9999ちょうど — 後方互換(toNext は新曲線値)', () => {
    const state = levelFromXp(XP_FOR_L9999);
    expect(state.level).toBe(9999);
    expect(state.toNext).toBe(xpToNext(9999)); // = 315_450(新曲線では L10000 へ続く)
  });

  it('xpToNext は L9999→L10000 境界でも単調増加する(曲線切り替え)', () => {
    expect(xpToNext(9999)).toBe(315_450);  // old tier 末尾
    expect(xpToNext(10000)).toBe(315_460); // new tier 先頭(+10)
    expect(xpToNext(10000)).toBeGreaterThan(xpToNext(9999));
  });

  it('L10000 到達累積XP が正しい', () => {
    const state = levelFromXp(XP_FOR_L10000);
    expect(state.level).toBe(10000);
    expect(state.toNext).toBe(xpToNext(10000)); // = 315_460
  });

  it('L50000 到達累積XP が正しい', () => {
    const state = levelFromXp(XP_FOR_L50000);
    expect(state.level).toBe(50000);
    expect(state.toNext).toBe(xpToNext(50000));
  });

  it('L99999(旧上限)ちょうどで level=99999・toNext>0(R49: 頭打ちしない)', () => {
    const state = levelFromXp(XP_FOR_L99999);
    expect(state.level).toBe(99999);
    expect(state.intoLevel).toBe(0);
    expect(state.toNext).toBe(xpToNext(99999)); // = 1_215_450(旧実装ではここが0だった)
    expect(state.toNext).toBeGreaterThan(0);
  });

  it('L99999→L100000: xpToNext(99999)分積むと旧上限を超えて超越階級L100000に上がる(R49)', () => {
    // xpToNext は L10000 以降 +10/レベルの等差数列のまま自然延長される(区分の追加なし)
    expect(xpToNext(99999)).toBe(xpToNext(99998) + 10);
    const beyond = levelFromXp(XP_FOR_L99999 + xpToNext(99999));
    expect(beyond.level).toBe(100000);
    expect(beyond.intoLevel).toBe(0);
    expect(beyond.toNext).toBe(xpToNext(100000));
    expect(beyond.toNext).toBeGreaterThan(0);
  });

  it('L99999周辺・L100000周辺でも xpToNext は単調増加し続ける(区分境界の不連続なし)', () => {
    for (let l = 99990; l < 100010; l += 1) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
  });

  it('XP_FOR_L99999 は Number.MAX_SAFE_INTEGER 以内', () => {
    expect(XP_FOR_L99999).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('xpToNext は L1〜L250000 の全域で単調増加(旧上限99999をまたいでも連続)', () => {
    for (let l = 1; l < 250_000; l += 1) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
  });

  it('巨大XP(1e15)でも levelFromXp が有限時間・単調に解け、level/toNextが正しい状態を保つ', () => {
    const xp = 1e15;
    const state = levelFromXp(xp);
    expect(Number.isFinite(state.level)).toBe(true);
    expect(state.level).toBeGreaterThan(100000); // 旧上限・超越階級の初段をはるかに超える
    expect(state.intoLevel).toBeGreaterThanOrEqual(0);
    expect(state.toNext).toBeGreaterThan(0);
    expect(state.intoLevel).toBeLessThan(state.toNext);
    // 閉形式の解が正しいことをxpToNextとの整合で検算する:
    // (xp - intoLevel) 分でちょうど level に到達し、そこから toNext 未満しか進んでいない
    expect(xp - state.intoLevel).toBeGreaterThanOrEqual(0);

    // 単調性: XPを増やすとレベルは減らない(頭打ちなし)
    const more = levelFromXp(xp + 1_000_000_000);
    expect(more.level).toBeGreaterThanOrEqual(state.level);
  });

  it('Number.MAX_SAFE_INTEGER 付近の巨大XPでも levelFromXp が壊れない(有限・単調・非負)', () => {
    const state = levelFromXp(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(state.level)).toBe(true);
    expect(state.level).toBeGreaterThan(0);
    expect(Number.isFinite(state.intoLevel)).toBe(true);
    expect(state.intoLevel).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.toNext)).toBe(true);
    expect(state.toNext).toBeGreaterThan(0);
    expect(state.intoLevel).toBeLessThan(state.toNext);

    // 単調性を隣接XPでも確認(頭打ち・逆転が起きない)
    const slightlyLess = levelFromXp(Number.MAX_SAFE_INTEGER - 1_000_000_000);
    expect(slightlyLess.level).toBeLessThanOrEqual(state.level);
  });

  it('非有限・負のXPでも levelFromXp が例外を投げず安全に処理する', () => {
    expect(() => levelFromXp(Number.NaN)).not.toThrow();
    expect(() => levelFromXp(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(levelFromXp(-100).level).toBe(1);
    expect(levelFromXp(Number.NaN).level).toBe(1);
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

  it('L9000-9998 は神話(tier 18)', () => {
    expect(rankNameFor(9000)).toEqual({ name: '神話', tier: 18 });
    expect(rankNameFor(9998)).toEqual({ name: '神話', tier: 18 });
  });

  // ── 境界テスト: 旧上限/新10000境界/新上限 ─────────────────────────────────────
  it('L9999 ちょうどで創世神(tier 19) — 旧上限・変更なし', () => {
    expect(rankNameFor(9999)).toEqual({ name: '創世神', tier: 19 });
  });

  it('L10000 ちょうどで天照(tier 20) — 超越階級の開始', () => {
    expect(rankNameFor(10000)).toEqual({ name: '天照', tier: 20 });
    expect(rankNameFor(19999)).toEqual({ name: '天照', tier: 20 });
  });

  it('超越階級の各境界が正しく遷移する', () => {
    expect(rankNameFor(20000)).toEqual({ name: '須佐之男', tier: 21 });
    expect(rankNameFor(30000)).toEqual({ name: '月読',     tier: 22 });
    expect(rankNameFor(40000)).toEqual({ name: '伊邪那岐', tier: 23 });
    expect(rankNameFor(50000)).toEqual({ name: '御中主',   tier: 24 });
    expect(rankNameFor(60000)).toEqual({ name: '国常立',   tier: 25 });
    expect(rankNameFor(70000)).toEqual({ name: '豊雲野',   tier: 26 });
    expect(rankNameFor(80000)).toEqual({ name: '高御産',   tier: 27 });
    expect(rankNameFor(90000)).toEqual({ name: '天地開闢', tier: 28 });
  });

  it('L99999 ちょうどで森羅万象(tier 29) — 旧上限、超越階級(L100000)開始直前', () => {
    expect(rankNameFor(99999)).toEqual({ name: '森羅万象', tier: 29 });
  });

  // ── R49: 超越階級(L100000以降、10万レベルごと・無限に続く) ─────────────────────
  describe('超越階級(R49レベル無限化)', () => {
    it('L100000ちょうどで宇宙開闢(tier 30) — 超越階級の開始', () => {
      expect(rankNameFor(100000)).toEqual({ name: '宇宙開闢', tier: 30 });
    });

    it('L100000未満は超越階級に入らない(森羅万象のまま)', () => {
      expect(rankNameFor(99999)).toEqual({ name: '森羅万象', tier: 29 });
      // 整数レベルのみが有効値だが、念のため直前の値も確認
      expect(rankNameFor(100000 - 1)).toEqual({ name: '森羅万象', tier: 29 });
    });

    it('L250000で銀河創世(tier 31) — idx=floor(level/100000)で判定', () => {
      expect(rankNameFor(250000)).toEqual({ name: '銀河創世', tier: 31 });
    });

    it('凍結ラダー24段(idx1-24)が仕様どおりの名称・tierで並ぶ', () => {
      const ladder: Array<[number, string]> = [
        [100000, '宇宙開闢'], [200000, '銀河創世'], [300000, '時空超越'], [400000, '次元崩壊'],
        [500000, '多元宇宙'], [600000, '平行世界の王'], [700000, '因果律の支配者'], [800000, '概念超越'],
        [900000, '無限回帰'], [1000000, '永劫不滅'], [1100000, '天元突破'], [1200000, '星海の帝'],
        [1300000, '万象の祖'], [1400000, '理の外'], [1500000, '混沌の主宰'], [1600000, '秩序の根源'],
        [1700000, '世界改変'], [1800000, '創造と終焉'], [1900000, '全知全能'], [2000000, '絶対存在'],
        [2100000, '唯一絶対'], [2200000, '根源意志'], [2300000, '万物の彼方'], [2400000, '無限の無限'],
      ];
      for (const [lvl, name] of ladder) {
        expect(rankNameFor(lvl).name).toBe(name);
      }
      // tierは29+idxで単調増加(idx1→30 ... idx24→53)
      expect(ladder.map(([lvl]) => rankNameFor(lvl).tier)).toEqual(
        Array.from({ length: 24 }, (_, i) => 30 + i),
      );
    });

    it('L2400000で無限の無限(tier 53) — 凍結ラダーの最終段', () => {
      expect(rankNameFor(2_400_000)).toEqual({ name: '無限の無限', tier: 53 });
    });

    it('L2500000で無限の無限・2乗(tier 54) — 凍結ラダーを超えた先の生成規則', () => {
      expect(rankNameFor(2_500_000)).toEqual({ name: '無限の無限・2乗', tier: 54 });
    });

    it('無限の無限・n乗が idx に応じて無限に生成される', () => {
      expect(rankNameFor(2_600_000)).toEqual({ name: '無限の無限・3乗', tier: 55 });
      expect(rankNameFor(3_000_000)).toEqual({ name: '無限の無限・7乗', tier: 59 });
      expect(rankNameFor(10_000_000)).toEqual({ name: '無限の無限・77乗', tier: 129 });
    });

    it('tierはレベルが上がるほど厳密に単調増加し続ける(L1〜超越階級を横断)', () => {
      const samples = [1, 100, 999, 1000, 9999, 10000, 99999, 100000, 250000, 2_400_000, 2_500_000, 10_000_000];
      let prevTier = -1;
      for (const lvl of samples) {
        const tier = rankNameFor(lvl).tier;
        expect(tier).toBeGreaterThan(prevTier);
        prevTier = tier;
      }
    });

    it('levelRankUpgradeは超越階級の境界でも新ランクを検出する', () => {
      const lv = (level: number) => ({ level, intoLevel: 0, toNext: xpToNext(level) });
      const upgrade = levelRankUpgrade(lv(99999), lv(100000));
      expect(upgrade).toEqual({ name: '宇宙開闢', tier: 30 });
      const noUpgrade = levelRankUpgrade(lv(100000), lv(150000));
      expect(noUpgrade).toBeNull();
    });
  });

  it('全30段の名称が揃っている', () => {
    const samples: Array<[number, string]> = [
      // 既存20段(変更なし)
      [1, '新兵'], [100, '足軽'], [200, '武者'], [300, '侍'], [400, '侍大将'],
      [500, '剣豪'], [600, '修羅'], [700, '鬼神'], [800, '羅刹'], [900, '覇王'],
      [1000, '剣聖'], [2000, '武神'], [3000, '雷神'], [4000, '戦神'], [5000, '天下無双'],
      [6000, '軍神'], [7000, '破壊神'], [8000, '神威'], [9000, '神話'], [9999, '創世神'],
      // 超越10段
      [10000, '天照'], [20000, '須佐之男'], [30000, '月読'], [40000, '伊邪那岐'],
      [50000, '御中主'], [60000, '国常立'], [70000, '豊雲野'], [80000, '高御産'],
      [90000, '天地開闢'], [99999, '森羅万象'],
    ];
    for (const [lvl, name] of samples) {
      expect(rankNameFor(lvl).name).toBe(name);
    }
  });
});

describe('levelRankUpgrade', () => {
  const lv = (level: number) => ({ level, intoLevel: 0, toNext: xpToNext(Math.min(level, 99998)) });

  it('tier上昇(新兵→足軽)で新ランク名を返す', () => {
    const result = levelRankUpgrade(lv(99), lv(100));
    expect(result).not.toBeNull();
    expect(result?.name).toBe('足軽');
    expect(result?.tier).toBe(1);
  });

  it('tier上昇(覇王→剣聖)で新ランク名を返す', () => {
    const result = levelRankUpgrade(lv(999), lv(1000));
    expect(result?.name).toBe('剣聖');
    expect(result?.tier).toBe(10);
  });

  it('同tier内の昇格はnullを返す', () => {
    expect(levelRankUpgrade(lv(100), lv(150))).toBeNull();
    expect(levelRankUpgrade(lv(500), lv(599))).toBeNull();
  });

  it('レベル変動なしはnullを返す', () => {
    const state = lv(300);
    expect(levelRankUpgrade(state, state)).toBeNull();
  });

  it('複数tier一気に上がった場合も到達後tierを返す', () => {
    const result = levelRankUpgrade(lv(1), lv(500));
    expect(result?.name).toBe('剣豪');
    expect(result?.tier).toBe(5);
  });
});
