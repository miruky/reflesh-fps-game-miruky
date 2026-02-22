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
});
