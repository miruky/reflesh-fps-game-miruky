import { describe, expect, it } from 'vitest';
import { TEAM_PALETTES, teamPalette } from './teamcolors';

describe('TEAM_PALETTES', () => {
  it('IDが重複しない', () => {
    const ids = TEAM_PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全色が24bitの範囲に収まる', () => {
    for (const palette of TEAM_PALETTES) {
      for (const color of [palette.enemy, palette.enemyTracer, palette.ally, palette.allyTracer]) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('敵と味方の色が同一パレット内で異なる', () => {
    for (const palette of TEAM_PALETTES) {
      expect(palette.enemy).not.toBe(palette.ally);
      expect(palette.enemyTracer).not.toBe(palette.allyTracer);
    }
  });
});

describe('teamPalette', () => {
  it('IDで引ける', () => {
    expect(teamPalette('magenta-green').name).toContain('マゼンタ');
  });

  it('未知のIDは標準パレットに落ちる', () => {
    expect(teamPalette('unknown')).toBe(TEAM_PALETTES[0]);
  });
});
