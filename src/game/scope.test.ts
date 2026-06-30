import { describe, expect, it } from 'vitest';
import { BREATH_MAX_S, breathStep, lissajousSway, SWAY_AMP_DEG, swayAmp } from './scope';

describe('scope 純粋ロジック', () => {
  it('lissajousSwayは振幅以内で確定的、amp<=0で0', () => {
    const a = lissajousSway(1.234, 0.35);
    const b = lissajousSway(1.234, 0.35);
    expect(a).toEqual(b); // 同じ時刻なら同じ値
    for (let t = 0; t < 20; t += 0.37) {
      const s = lissajousSway(t, 0.35);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(0.35 + 1e-9);
    }
    expect(lissajousSway(5, 0)).toEqual({ x: 0, y: 0 });
    expect(lissajousSway(5, -1)).toEqual({ x: 0, y: 0 });
  });

  it('breathStepは止めると減り、離すと回復し、0..maxで飽和', () => {
    let r = breathStep(BREATH_MAX_S, 0.5, true);
    expect(r.meter).toBeLessThan(BREATH_MAX_S);
    expect(r.steady).toBe(true);
    // 使い切るまで止め続ける
    let m = BREATH_MAX_S;
    for (let i = 0; i < 100; i += 1) m = breathStep(m, 0.1, true).meter;
    expect(m).toBe(0);
    expect(breathStep(0, 0.1, true).steady).toBe(false); // 息切れ
    // 離して回復(maxを超えない)
    r = breathStep(0, 1, false);
    expect(r.meter).toBeGreaterThan(0);
    expect(r.steady).toBe(false);
    let full = BREATH_MAX_S;
    for (let i = 0; i < 100; i += 1) full = breathStep(full, 0.1, false).meter;
    expect(full).toBe(BREATH_MAX_S);
  });

  it('swayAmpは息切れ(meter=0)で倍化し、残量ありでは等倍、base<=0は0', () => {
    expect(swayAmp(0, SWAY_AMP_DEG)).toBeCloseTo(SWAY_AMP_DEG * 2, 9);
    expect(swayAmp(1.2, SWAY_AMP_DEG)).toBe(SWAY_AMP_DEG);
    expect(swayAmp(0, 0)).toBe(0);
  });
});
