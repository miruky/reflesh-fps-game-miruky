import { describe, expect, it } from 'vitest';
import { STAGES } from '../game/stages';
import { resolveMood } from './atmosphere';
import { cinematicLightingProfile, cinematicVisualFogDensity } from './cinematic-lighting';

describe('cinematic lighting profile', () => {
  it('昼の視覚フォグを薄め、遠景と中景の分離を保つ', () => {
    expect(cinematicVisualFogDensity(0.01, 'day')).toBeCloseTo(0.0038);
  });

  it('全ムードで無方向光を主平行光より控え、白い平板化を防ぐ', () => {
    for (const mood of ['day', 'dusk', 'night', 'overcast', 'snow'] as const) {
      const profile = cinematicLightingProfile(mood);
      expect(profile.hemiScale).toBeGreaterThan(0);
      expect(profile.hemiScale).toBeLessThan(0.4);
      expect(profile.sunScale).toBeGreaterThanOrEqual(0.9);
      expect(profile.environmentCap).toBeGreaterThanOrEqual(0.34);
      expect(profile.environmentCap).toBeLessThanOrEqual(0.44);
      expect(profile.fogColorScale).toBeGreaterThanOrEqual(0.67);
      expect(profile.fogColorScale).toBeLessThanOrEqual(0.74);
      expect(profile.fogSkyMix).toBeLessThanOrEqual(0.16);
      expect(profile.visibleSkyScale).toBeLessThan(0.16);
      expect(profile.visibleSkyClamp).toBeLessThan(0.5);
    }
  });

  it('ゾンビ可読プロファイルはライト数を増やさず暗部と霧だけを改善する', () => {
    const profile = cinematicLightingProfile('night', true);
    expect(profile.hemiScale).toBeGreaterThan(0.6);
    expect(profile.fillScale).toBeGreaterThan(0.15);
    expect(profile.environmentCap).toBeGreaterThanOrEqual(0.55);
    expect(profile.environmentCap).toBeLessThan(0.65);
    expect(profile.visibleSkyClamp).toBeLessThan(0.4);
    expect(cinematicVisualFogDensity(0.0072, 'night', true)).toBeLessThan(0.003);
  });

  it('31ステージ全てで戦闘距離150mの可読性を残す', () => {
    for (const stage of STAGES) {
      const readableUndead = /^z\d\d$/.test(stage.id);
      const density = cinematicVisualFogDensity(
        stage.palette.fogDensity,
        resolveMood(stage.palette),
        readableUndead,
      );
      // THREE.FogExp2と同じ transmission = exp(-(density*distance)^2)。
      const transmissionAt150m = Math.exp(-density * density * 150 * 150);
      expect(transmissionAt150m, stage.id).toBeGreaterThan(0.65);
      expect(density, stage.id).toBeLessThanOrEqual(0.004);
    }
  });
});
