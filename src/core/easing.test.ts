import { describe, expect, it } from 'vitest';
import { easeOutCubic, easeOutQuint, lerp } from './easing';

describe('easeOutCubic', () => {
  it('端点を固定する', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('終端で減速する(中点が0.5を上回る)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('単調増加する', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('範囲外のtを端へ丸める', () => {
    expect(easeOutCubic(-2)).toBe(0);
    expect(easeOutCubic(3)).toBe(1);
    expect(easeOutCubic(NaN)).toBe(0);
  });
});

describe('easeOutQuint', () => {
  it('端点を固定する', () => {
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
  });

  it('同じ進捗ではcubicより終端へ寄る', () => {
    expect(easeOutQuint(0.5)).toBeGreaterThan(easeOutCubic(0.5));
  });
});

describe('lerp', () => {
  it('端点と中点を返す', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('進捗を0..1へクランプする', () => {
    expect(lerp(0, 100, -1)).toBe(0);
    expect(lerp(0, 100, 2)).toBe(100);
  });
});
