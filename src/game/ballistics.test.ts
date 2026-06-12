import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import {
  coneOffset,
  damageAtDistance,
  partFromHitHeight,
  partMultiplier,
  penetrationFactor,
} from './ballistics';

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
  it('ヘッドのみ高倍率がかかる', () => {
    expect(partMultiplier('head', 1.6)).toBe(1.6);
    expect(partMultiplier('body', 1.6)).toBe(1);
  });

  it('脚部は減衰する', () => {
    expect(partMultiplier('limb', 1.6)).toBeLessThan(1);
  });
});

describe('partFromHitHeight', () => {
  it('腰の高さを境に胴体と脚部を分ける', () => {
    expect(partFromHitHeight(0.3, -0.15)).toBe('body');
    expect(partFromHitHeight(-0.15, -0.15)).toBe('body');
    expect(partFromHitHeight(-0.4, -0.15)).toBe('limb');
  });
});

describe('penetrationFactor', () => {
  it('貫通力を超える厚みは貫けない', () => {
    expect(penetrationFactor(0.5, 0.5)).toBe(0);
    expect(penetrationFactor(1.0, 0.5)).toBe(0);
  });

  it('貫通力0の武器は何も貫けない', () => {
    expect(penetrationFactor(0.1, 0)).toBe(0);
  });

  it('薄い壁ほど残存ダメージが大きく、上限は7割', () => {
    const thin = penetrationFactor(0.1, 0.8);
    const thick = penetrationFactor(0.6, 0.8);
    expect(thin).toBeGreaterThan(thick);
    expect(thin).toBeLessThanOrEqual(0.7);
    expect(thick).toBeGreaterThan(0);
  });
});
