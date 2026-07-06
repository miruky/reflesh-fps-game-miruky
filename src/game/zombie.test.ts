import { describe, expect, it } from 'vitest';
import {
  ZOMBIE_MAX_ALIVE,
  zombieEliteRate,
  zombieHp,
  zombieRunRate,
  zombieSpawnGap,
  zombieTotal,
  isBossRound,
  zombieBossHp,
  zombieBossSpeedMul,
  zombieBossDamage,
} from './zombie';

describe('zombie round curves', () => {
  it('総数は単調非減少で270にクランプされる', () => {
    let prev = 0;
    for (let r = 1; r <= 60; r += 1) {
      const n = zombieTotal(r);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(270);
      prev = n;
    }
    expect(zombieTotal(1)).toBe(32); // 大増員×3: Math.round(25.2+6.3+0.462)=32
    expect(zombieTotal(60)).toBe(270); // 十分大きいラウンドで上限に達する
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
    expect(ZOMBIE_MAX_ALIVE.high).toBe(108); // 大増員対応: low54/med84/high108
  });
});

describe('zombie boss curves', () => {
  it('isBossRound: 5の倍数(r>0)だけ true', () => {
    expect(isBossRound(5)).toBe(true);
    expect(isBossRound(10)).toBe(true);
    expect(isBossRound(15)).toBe(true);
    expect(isBossRound(20)).toBe(true);
    expect(isBossRound(1)).toBe(false);
    expect(isBossRound(4)).toBe(false);
    expect(isBossRound(6)).toBe(false);
    expect(isBossRound(0)).toBe(false);
  });

  it('zombieBossHp: r5=3000, r10=7000, r15=14000, r20=26000', () => {
    expect(zombieBossHp(5)).toBe(3000);
    expect(zombieBossHp(10)).toBe(7000);
    expect(zombieBossHp(15)).toBe(14000);
    expect(zombieBossHp(20)).toBe(26000);
  });

  it('zombieBossHp: r20超は×1.9で増加し200000でクランプ', () => {
    expect(zombieBossHp(25)).toBe(Math.min(200000, Math.round(26000 * 1.9)));
    // 十分大きいラウンドで上限へ
    expect(zombieBossHp(200)).toBe(200000);
  });

  it('zombieBossSpeedMul: r5=1.2, r10=1.3, 上限2.0', () => {
    expect(zombieBossSpeedMul(5)).toBeCloseTo(1.2, 5);
    expect(zombieBossSpeedMul(10)).toBeCloseTo(1.3, 5);
    // 十分大きいラウンドで上限
    expect(zombieBossSpeedMul(200)).toBe(2.0);
  });

  it('zombieBossDamage: r5=45, r10=51, 上限90', () => {
    expect(zombieBossDamage(5)).toBe(45);
    expect(zombieBossDamage(10)).toBe(51);
    expect(zombieBossDamage(200)).toBe(90);
  });
});

describe('r=999 クランプ・NaN なし(ラウンド選択1-999対応)', () => {
  it('zombieTotal(999)=270(上限クランプ)', () => {
    expect(zombieTotal(999)).toBe(270);
  });

  it('zombieHp(999)=600(上限クランプ)', () => {
    expect(zombieHp(999)).toBe(600);
  });

  it('zombieRunRate(999)=0.9(上限クランプ)', () => {
    expect(zombieRunRate(999)).toBe(0.9);
  });

  it('zombieSpawnGap(999)=0.6(下限クランプ)', () => {
    expect(zombieSpawnGap(999)).toBe(0.6);
  });

  it('isBossRound(999)=false, isBossRound(995)=true', () => {
    expect(isBossRound(999)).toBe(false); // 999 % 5 = 4
    expect(isBossRound(995)).toBe(true);  // 995 % 5 = 0
  });

  it('ボス曲線がr999以上で上限クランプ(NaN・Infinity 無し)', () => {
    expect(zombieBossHp(995)).toBe(200000);
    expect(zombieBossSpeedMul(995)).toBe(2.0);
    expect(zombieBossDamage(995)).toBe(90);
    // 全曲線でNaNが出ないことを確認
    expect(Number.isNaN(zombieTotal(999))).toBe(false);
    expect(Number.isNaN(zombieHp(999))).toBe(false);
    expect(Number.isNaN(zombieRunRate(999))).toBe(false);
    expect(Number.isNaN(zombieSpawnGap(999))).toBe(false);
    expect(Number.isNaN(zombieBossHp(995))).toBe(false);
    expect(Number.isNaN(zombieBossSpeedMul(995))).toBe(false);
    expect(Number.isNaN(zombieBossDamage(995))).toBe(false);
  });

  it('r=1〜999 全域で各曲線がfinite', () => {
    for (const r of [1, 50, 100, 200, 500, 750, 999]) {
      expect(Number.isFinite(zombieTotal(r))).toBe(true);
      expect(Number.isFinite(zombieHp(r))).toBe(true);
      expect(Number.isFinite(zombieRunRate(r))).toBe(true);
      expect(Number.isFinite(zombieSpawnGap(r))).toBe(true);
    }
  });
});
