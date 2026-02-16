import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { coneOffset, damageAtDistance, partMultiplier } from './ballistics';

describe('damageAtDistance', () => {
  const falloff = { start: 20, end: 40, minFactor: 0.5 };

  it('開始距離までは満額', () => {
    expect(damageAtDistance(30, 0, falloff)).toBe(30);
    expect(damageAtDistance(30, 20, falloff)).toBe(30);
  });

  it('終端以降は下限倍率で一定', () => {
    expect(damageAtDistance(30, 40, falloff)).toBe(15);
    expect(damageAtDistance(30, 100, falloff)).toBe(15);
  });

  it('中間は線形補間', () => {
    expect(damageAtDistance(30, 30, falloff)).toBeCloseTo(22.5);
  });
});

describe('coneOffset', () => {
  it('オフセットは指定角の円錐内に収まる', () => {
    const rand = mulberry32(7);
    const spread = 0.05;
    for (let i = 0; i < 500; i += 1) {
      const { yaw, pitch } = coneOffset(spread, rand);
      expect(Math.hypot(yaw, pitch)).toBeLessThanOrEqual(spread + 1e-9);
    }
  });

  it('スプレッド0なら必ず中心', () => {
    const rand = mulberry32(7);
    const { yaw, pitch } = coneOffset(0, rand);
    expect(yaw).toBe(0);
    expect(pitch).toBe(0);
  });
});

describe('partMultiplier', () => {
  it('ヘッドのみ倍率がかかる', () => {
    expect(partMultiplier('head', 1.6)).toBe(1.6);
    expect(partMultiplier('body', 1.6)).toBe(1);
  });
});
