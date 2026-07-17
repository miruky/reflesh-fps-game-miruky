import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../game/campaign';
import { emptyProfile } from '../game/progression';
import { parseProfile, serializeProfile } from './profile';

describe('parseProfile', () => {
  it('シリアライズとの往復で値が保たれる', () => {
    const profile = emptyProfile();
    profile.xp = 4200;
    profile.rating = 1185;
    profile.stats.kills = 73;
    profile.completedChallenges.push('first-blood');
    profile.weaponKills['カエデAR'] = 40;
    const restored = parseProfile(serializeProfile(profile));
    expect(restored).toEqual(profile);
  });

  it('壊れたJSONは初期プロフィールに落ちる', () => {
    expect(parseProfile('{not json')).toEqual(emptyProfile());
    expect(parseProfile('null')).toEqual(emptyProfile());
    expect(parseProfile('"text"')).toEqual(emptyProfile());
  });

  it('不正な数値は初期値で埋める', () => {
    const restored = parseProfile(
      JSON.stringify({
        xp: -50,
        rating: 'high',
        stats: { kills: Number.NaN, wins: 3 },
        completedChallenges: ['ok', 123],
        weaponKills: { スズメ: -5, 近接: 2 },
      }),
    );
    expect(restored.xp).toBe(0);
    expect(restored.rating).toBe(1000);
    expect(restored.stats.kills).toBe(0);
    expect(restored.stats.wins).toBe(3);
    expect(restored.completedChallenges).toEqual(['ok']);
    expect(restored.weaponKills).toEqual({ 近接: 2 });
  });

  it('campaign/scoreRecordsが往復で保存復元される', () => {
    const profile = emptyProfile();
    profile.campaign.clearedMissions.push('c1m1-cold-boot');
    profile.campaign.unlockedChapters.push('ch2');
    profile.campaign.missionBests['c1m1-cold-boot'] = {
      bestTimeS: 42.5,
      stars: 3,
      difficulty: 'normal',
    };
    profile.scoreRecords['score:kunren'] = 18;
    const restored = parseProfile(serializeProfile(profile));
    expect(restored).toEqual(profile);
  });

  it('weaponStats/selectedCamos(カモ)が往復で保存復元される', () => {
    const profile = emptyProfile();
    profile.weaponStats['kaede-ar'] = { kills: 120, headshots: 10 };
    profile.weaponStats['gouka-rl'] = { kills: 500, headshots: 100 };
    profile.selectedCamos['kaede-ar'] = 'blue';
    profile.selectedCamos['gouka-rl'] = 'gold';
    const restored = parseProfile(serializeProfile(profile));
    expect(restored).toEqual(profile);
  });

  it('不正なweaponStats/selectedCamosは安全に弾く', () => {
    const restored = parseProfile(
      JSON.stringify({
        weaponStats: {
          bad1: { kills: -5, headshots: 'x' }, // 両方不正→0/0で破棄
          good: { kills: 10, headshots: 2 },
          bad2: 5, // オブジェクトでない→破棄
        },
        selectedCamos: {
          w1: 'gold',
          w2: 'rainbow', // 未知のカモID→破棄
          w3: 7, // 文字列でない→破棄
        },
      }),
    );
    expect(restored.weaponStats).toEqual({ good: { kills: 10, headshots: 2 } });
    expect(restored.selectedCamos).toEqual({ w1: 'gold' });
  });

  it('カモフィールド欠落の旧セーブは空で開始(後方互換)', () => {
    const restored = parseProfile(JSON.stringify({ xp: 100 }));
    expect(restored.weaponStats).toEqual({});
    expect(restored.selectedCamos).toEqual({});
  });

  it('campaign欠落の旧セーブはch1解放の既定で補完される', () => {
    const restored = parseProfile(JSON.stringify({ xp: 100 }));
    expect(restored.campaign.unlockedChapters).toEqual(['ch1']);
    expect(restored.campaign.clearedMissions).toEqual([]);
    expect(restored.scoreRecords).toEqual({});
    expect(restored.xp).toBe(100);
  });

  it('不正なcampaign/scoreRecordsは安全に弾く(ch1は常に残す)', () => {
    const restored = parseProfile(
      JSON.stringify({
        campaign: {
          clearedMissions: ['ok', 5, null],
          unlockedChapters: ['ch3'], // ch1欠落 → 補完される
          missionBests: {
            good: { bestTimeS: 10, stars: 2, difficulty: 'hard' },
            badStars: { bestTimeS: 10, stars: 99, difficulty: 'easy' }, // クランプ
            badDiff: { bestTimeS: 10, stars: 1, difficulty: 'wat' }, // 破棄
            badTime: { bestTimeS: -1, stars: 1, difficulty: 'easy' }, // 破棄
          },
        },
        scoreRecords: { a: 5, b: -3, c: 'x' },
      }),
    );
    expect(restored.campaign.clearedMissions).toEqual(['ok']);
    expect(restored.campaign.unlockedChapters).toContain('ch1');
    expect(restored.campaign.unlockedChapters).toContain('ch3');
    expect(restored.campaign.missionBests['good']).toEqual({
      bestTimeS: 10,
      stars: 2,
      difficulty: 'hard',
    });
    expect(restored.campaign.missionBests['badStars']?.stars).toBe(3);
    expect(restored.campaign.missionBests['badDiff']).toBeUndefined();
    expect(restored.campaign.missionBests['badTime']).toBeUndefined();
    expect(restored.scoreRecords).toEqual({ a: 5 });
  });

  // ── R53-W2: ゾンビ統計/charm/titles/unlockedRewardCamos の後方互換 ──────────
  it('R53-W2フィールド欠落の旧セーブは0/空配列/nullで安全に開始(後方互換)', () => {
    const restored = parseProfile(JSON.stringify({ xp: 100 }));
    expect(restored.bestZombieRound).toBe(0);
    expect(restored.zombieKills).toBe(0);
    expect(restored.zombieBossKills).toBe(0);
    expect(restored.zombiePerkSetCompleted).toBe(false);
    // charms/titles/unlockedRewardCamosはoptionalなTS型だが、emptyProfile()由来の
    // 具体的な既定値(空)で埋まる(メニュー側が`?.`無しで安全に読める設計)
    expect(restored.charms).toEqual({ unlocked: [], equipped: null });
    expect(restored.titles).toEqual([]);
    expect(restored.unlockedRewardCamos).toEqual([]);
    expect(restored.xp).toBe(100);
  });

  it('R53-W2フィールドが往復で保存復元される', () => {
    const profile = emptyProfile();
    profile.bestZombieRound = 42;
    profile.zombieKills = 1234;
    profile.zombieBossKills = 7;
    profile.zombiePerkSetCompleted = true;
    profile.charms = { unlocked: ['startpt', 'revive'], equipped: 'startpt' };
    profile.titles = ['雷帝の後継'];
    profile.unlockedRewardCamos = ['jingai', 'shinrai'];
    const restored = parseProfile(serializeProfile(profile));
    expect(restored).toEqual(profile);
  });

  it('不正なcharms(未知ID/equippedが未解放)は安全に弾く', () => {
    const restored = parseProfile(
      JSON.stringify({
        charms: {
          unlocked: ['startpt', 'not-a-charm', 5, 'revive'],
          equipped: 'bossdmg', // unlockedに含まれない → 無効化してnull
        },
      }),
    );
    expect(restored.charms).toEqual({ unlocked: ['startpt', 'revive'], equipped: null });
  });

  it('equippedがunlockedに含まれていれば採用される', () => {
    const restored = parseProfile(
      JSON.stringify({
        charms: { unlocked: ['revive'], equipped: 'revive' },
      }),
    );
    expect(restored.charms).toEqual({ unlocked: ['revive'], equipped: 'revive' });
  });

  it('不正なtitles(非文字列混入)は文字列のみ採用する', () => {
    const restored = parseProfile(JSON.stringify({ titles: ['雷帝の後継', 42, null] }));
    expect(restored.titles).toEqual(['雷帝の後継']);
  });

  it('unlockedRewardCamosは既知の報酬カモID(jingai/shinrai)のみ採用し、それ以外は弾く', () => {
    const restored = parseProfile(
      JSON.stringify({
        // 'gold'はCAMO_TIERS由来の通常カモ(報酬カモではない)なので弾かれる。
        // 'not-a-camo'は未知ID、7/falseは非文字列。
        unlockedRewardCamos: ['jingai', 'gold', 'not-a-camo', 7, false],
      }),
    );
    expect(restored.unlockedRewardCamos).toEqual(['jingai']);
  });

  it('負のゾンビ統計値は0に丸められる', () => {
    const restored = parseProfile(
      JSON.stringify({ bestZombieRound: -5, zombieKills: -1, zombieBossKills: Number.NaN }),
    );
    expect(restored.bestZombieRound).toBe(0);
    expect(restored.zombieKills).toBe(0);
    expect(restored.zombieBossKills).toBe(0);
  });

  it('perkcarry同一試合実績はbooleanのtrueだけを採用する', () => {
    expect(parseProfile(JSON.stringify({ zombiePerkSetCompleted: true })).zombiePerkSetCompleted).toBe(
      true,
    );
    expect(parseProfile(JSON.stringify({ zombiePerkSetCompleted: 'true' })).zombiePerkSetCompleted).toBe(
      false,
    );
    expect(parseProfile(JSON.stringify({ zombiePerkSetCompleted: 1 })).zombiePerkSetCompleted).toBe(
      false,
    );
  });
});

// ── R54-F6: 隠し章chB「歴戦の間」の遡及アンロック(ロード正規化) ──────────────
describe('chB遡及アンロック(R54-F6)', () => {
  const ch10Ids = CAMPAIGN.find((c) => c.id === 'ch10')!.missions.map((m) => m.id);

  it('ch10全6ミッションをクリア済みの旧セーブはロード時にchBが解放される', () => {
    const restored = parseProfile(
      JSON.stringify({
        campaign: { clearedMissions: ch10Ids, unlockedChapters: ['ch1', 'ch10'] },
      }),
    );
    expect(restored.campaign.unlockedChapters).toContain('chB');
  });

  it('ch10が1ミッションでも未クリアならchBは付与されない', () => {
    const restored = parseProfile(
      JSON.stringify({
        campaign: { clearedMissions: ch10Ids.slice(0, 5), unlockedChapters: ['ch1', 'ch10'] },
      }),
    );
    expect(restored.campaign.unlockedChapters).not.toContain('chB');
  });

  it('既にchB解放済みのセーブで重複pushしない', () => {
    const restored = parseProfile(
      JSON.stringify({
        campaign: { clearedMissions: ch10Ids, unlockedChapters: ['ch1', 'ch10', 'chB'] },
      }),
    );
    expect(restored.campaign.unlockedChapters.filter((id) => id === 'chB')).toHaveLength(1);
  });
});
