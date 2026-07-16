import { describe, expect, it } from 'vitest';
import { cinematicLightingProfile, cinematicVisualFogDensity } from './cinematic-lighting';

describe('cinematic lighting profile', () => {
  it('昼の視覚フォグを薄め、遠景と中景の分離を保つ', () => {
    expect(cinematicVisualFogDensity(0.01, 'day')).toBeCloseTo(0.005);
  });

  it('全ムードで環境光を直射より控えめにし、白い平板化を防ぐ', () => {
    for (const mood of ['day', 'dusk', 'night', 'overcast', 'snow'] as const) {
      const profile = cinematicLightingProfile(mood);
      expect(profile.hemiScale).toBeGreaterThan(0);
      expect(profile.hemiScale).toBeLessThan(0.5);
      expect(profile.environmentCap).toBeGreaterThan(0.4);
      expect(profile.environmentCap).toBeLessThanOrEqual(0.6);
    }
  });
});
