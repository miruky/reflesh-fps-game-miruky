import { describe, expect, it } from 'vitest';
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
});
