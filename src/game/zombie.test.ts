import { describe, expect, it } from 'vitest';
import {
  ZOMBIE_MAX_ALIVE,
  zombieEliteRate,
  zombieHp,
  zombieRunRate,
  zombieSpawnGap,
  zombieTotal,
} from './zombie';

describe('zombie round curves', () => {
  it('総数は単調非減少で90にクランプされる', () => {
    let prev = 0;
    for (let r = 1; r <= 60; r += 1) {
      const n = zombieTotal(r);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(90);
      prev = n;
    }
    expect(zombieTotal(1)).toBe(8);
    expect(zombieTotal(60)).toBe(90); // 十分大きいラウンドで上限に達する
  });

  it('HPは単調非減少・r9で線形の頂点・600でクランプ', () => {
    let prev = 0;
    for (let r = 1; r <= 200; r += 1) {
      const hp = zombieHp(r);
      expect(hp).toBeGreaterThanOrEqual(prev);
      expect(hp).toBeLessThanOrEqual(600);
      prev = hp;
    }
    expect(zombieHp(1)).toBe(40);
    expect(zombieHp(9)).toBe(104);
    expect(zombieHp(10)).toBeGreaterThan(zombieHp(9)); // 指数への接続で不連続落ちしない
    expect(zombieHp(200)).toBe(600);
  });

  it('走行率は0.9でクランプされ単調増加', () => {
    expect(zombieRunRate(1)).toBeCloseTo(0.145, 3);
    let prev = -1;
    for (let r = 1; r <= 40; r += 1) {
      const v = zombieRunRate(r);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(0.9);
      prev = v;
    }
    expect(zombieRunRate(40)).toBe(0.9);
  });

  it('elite率はr5未満で0、r5以上で0.15', () => {
    expect(zombieEliteRate(4)).toBe(0);
    expect(zombieEliteRate(5)).toBe(0.15);
    expect(zombieEliteRate(20)).toBe(0.15);
  });

  it('湧き間隔は下限0.6を割らない', () => {
    for (let r = 1; r <= 60; r += 1) {
      expect(zombieSpawnGap(r)).toBeGreaterThanOrEqual(0.6);
    }
    expect(zombieSpawnGap(1)).toBeCloseTo(1.71, 3);
    expect(zombieSpawnGap(60)).toBe(0.6);
  });

  it('同時生存上限はtier順で増える', () => {
    expect(ZOMBIE_MAX_ALIVE.low).toBeLessThan(ZOMBIE_MAX_ALIVE.medium);
    expect(ZOMBIE_MAX_ALIVE.medium).toBeLessThan(ZOMBIE_MAX_ALIVE.high);
    expect(ZOMBIE_MAX_ALIVE.high).toBe(24);
  });
});
