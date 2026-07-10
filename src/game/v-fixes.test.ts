// R53 V-W2W3 一括修正の回帰テスト。4本の敵対的レビュー(A=ゾンビ/B=ストーリー+S&D/
// C=環境+InstancedMesh/D=MK.III+黒雷帝)で確証された修正の固定化。
import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import { instaKillApplies, papInteractSealed, papTierAfterWallBuy } from './match';
import { StreakManager } from './scorestreaks';
import { applyMatch, emptyProfile, type MatchSummary } from './progression';
import { parseProfile } from '../core/profile';

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

describe('V-A: インスタキルのボス除外(instaKillApplies)', () => {
  it('タイマー中でも boss tier には適用されない(nukeのboss除外と対称)', () => {
    expect(instaKillApplies(10, 'boss')).toBe(false);
    expect(instaKillApplies(10, 'normal')).toBe(true);
    expect(instaKillApplies(10, 'elite')).toBe(true);
  });

  it('タイマー0では誰にも適用されない', () => {
    expect(instaKillApplies(0, 'normal')).toBe(false);
  });
});

describe('V-A: 鍛神台の封印(papInteractSealed)', () => {
  it('ドアが存在し未開放の間は封印される(=tier進行もコスト徴収も起きない)', () => {
    expect(papInteractSealed(true, false)).toBe(true);
  });

  it('ドア開放で解錠、ドア無しレイアウトでは封印しない(恒久使用不能の防止)', () => {
    expect(papInteractSealed(true, true)).toBe(false);
    expect(papInteractSealed(false, false)).toBe(false);
  });
});

describe('V-A: 所持中改造武器の壁再購入はtier維持(papTierAfterWallBuy)', () => {
  it('所持中かつtier>0 → 維持(弾補給扱い、BO2準拠)', () => {
    expect(papTierAfterWallBuy(true, 2)).toBe(2);
    expect(papTierAfterWallBuy(true, 3)).toBe(3);
  });

  it('非所持(新品取得)または未改造 → tier0', () => {
    expect(papTierAfterWallBuy(false, 2)).toBe(0);
    expect(papTierAfterWallBuy(true, 0)).toBe(0);
  });
});

describe('V-B: c10m5ボスラッシュのbossOnly判定(データ固定)', () => {
  it('c10m5のみbossOnly=true、ch1-8の既存eliminate-countは総キル判定のまま(セマンティクス不変)', () => {
    let c10m5Found = false;
    for (const ch of CAMPAIGN) {
      for (const m of ch.missions) {
        if (m.objective.kind !== 'eliminate-count') continue;
        if (m.id === 'c10m5-guardian-gauntlet') {
          c10m5Found = true;
          expect(m.objective.bossOnly).toBe(true);
        } else {
          // 他のeliminate-countは従来の総キル判定(bossOnly未設定)
          expect(m.objective.bossOnly, m.id).toBeUndefined();
        }
      }
    }
    expect(c10m5Found).toBe(true);
  });

  it('c9m6にrewardId(jingai)が付与されている(メニュー報酬バッジ整合)', () => {
    const c9m6 = CAMPAIGN.flatMap((c) => c.missions).find((m) => m.id === 'c9m6-ash-swordsman');
    expect(c9m6?.rewardId).toBe('jingai');
  });
});

describe('V-B: S&Dラウンド頭のストリーク全消去(StreakManager.resetAll)', () => {
  it('progressもバンクも全消去される', () => {
    const sm = new StreakManager();
    sm.addScore(2000); // いくつかバンクされる
    expect(sm.state.banked.some((b) => b)).toBe(true);
    sm.resetAll();
    expect(sm.state.progress).toBe(0);
    expect(sm.state.banked.every((b) => !b)).toBe(true);
  });
});

describe('V-D: 刀身雷脈の生涯キル累計(profile.kokuraiKillsTotal)', () => {
  it('summary.kokuraiKills(実キル数)が試合ごとに積算される', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({ kokuraiKills: 60 }));
    applyMatch(profile, summary({ kokuraiKills: 45 }));
    expect(profile.kokuraiKillsTotal).toBe(105); // 100超え=次試合開始時から雷脈適用域
  });

  it('未供給の試合では変化しない(旧経路互換)', () => {
    const profile = emptyProfile();
    applyMatch(profile, summary({}));
    expect(profile.kokuraiKillsTotal ?? 0).toBe(0);
  });

  it('旧セーブ(フィールド欠落)のparseは0で開始し壊れない', () => {
    const parsed = parseProfile(JSON.stringify({ xp: 100 }));
    expect(parsed.kokuraiKillsTotal).toBe(0);
  });
});
