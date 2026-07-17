// R36 性能軽量化の純関数群のテスト:
// ★1 影LODバケット(shadowLodFlags) / ★2 巨躯KCC距離LOD(giantKccActive)
// ★Z ゾンビKCC距離LOD(zombieKccActive) / R100 cap検証(zombieTotal/ZOMBIE_MAX_ALIVE)
// F2 修羅の弾返却(refundRound) / F8 手裏剣disc寿命クランプ(shurikenDiscLife)
import { describe, expect, it } from 'vitest';
import { refundRound, shadowLodFlags, shurikenDiscLife } from './match';
import { giantKccActive, zombieKccActive } from './bot';
import { zombieTotal, ZOMBIE_MAX_ALIVE } from './zombie';

describe('shadowLodFlags(★1 影LODバケット)', () => {
  it('cap以下なら全員true', () => {
    expect(shadowLodFlags([9, 1, 4], 8)).toEqual([true, true, true]);
    expect(shadowLodFlags([5, 5, 5, 5, 5, 5, 5, 5], 8)).toEqual(new Array(8).fill(true));
  });

  it('capを超えたら近い順にcap体のみtrue', () => {
    // d2: index2(1) < index0(4) < index3(9) < index1(16)
    expect(shadowLodFlags([4, 16, 1, 9], 2)).toEqual([true, false, true, false]);
  });

  it('同距離は先着(index昇順)で安定', () => {
    expect(shadowLodFlags([3, 3, 3], 2)).toEqual([true, true, false]);
  });

  it('空配列は空を返す', () => {
    expect(shadowLodFlags([], 8)).toEqual([]);
  });

  it('cap=8で54体(全巨躯想定)でもtrueは8体のみ', () => {
    const d2 = Array.from({ length: 54 }, (_, i) => (54 - i) * (54 - i));
    const flags = shadowLodFlags(d2, 8);
    expect(flags.filter(Boolean)).toHaveLength(8);
    // 最も近い8体 = 末尾8つ(d2が小さい)
    for (let i = 46; i < 54; i += 1) expect(flags[i]).toBe(true);
  });
});

describe('giantKccActive(★2 巨躯KCC距離LOD)', () => {
  it('30m以内は毎フレーム衝突解決する(近接戦闘の非回帰)', () => {
    for (let frame = 0; frame < 4; frame += 1) {
      expect(giantKccActive(0, frame, 12)).toBe(true);
      expect(giantKccActive(1, frame, 30)).toBe(true);
    }
  });

  it('30m超はuid%2バケットで2フレームに1回', () => {
    // uid偶数: 偶数フレームのみ担当
    expect(giantKccActive(2, 0, 50)).toBe(true);
    expect(giantKccActive(2, 1, 50)).toBe(false);
    expect(giantKccActive(2, 2, 50)).toBe(true);
    // uid奇数: 奇数フレームのみ担当(偶数uidとフレーム交代=全体で半減)
    expect(giantKccActive(3, 0, 50)).toBe(false);
    expect(giantKccActive(3, 1, 50)).toBe(true);
  });

  it('target不明(Infinity)は遠距離扱いで間引く', () => {
    expect(giantKccActive(0, 1, Infinity)).toBe(false);
    expect(giantKccActive(0, 2, Infinity)).toBe(true);
  });
});

describe('zombieKccActive(★Z ゾンビKCC距離LOD)', () => {
  it('25m以内は常時フル解決(every frame)', () => {
    for (let frame = 0; frame < 4; frame += 1) {
      expect(zombieKccActive(0, frame, 0)).toBe(true);
      expect(zombieKccActive(7, frame, 25)).toBe(true);
    }
  });

  it('25-60m の最近接個体は uid%2 バケット(2フレームに1回)', () => {
    // uid偶数: 偶数フレームのみ担当
    expect(zombieKccActive(4, 0, 40)).toBe(true);
    expect(zombieKccActive(4, 1, 40)).toBe(false);
    expect(zombieKccActive(4, 2, 40)).toBe(true);
    // uid奇数: 奇数フレームのみ担当
    expect(zombieKccActive(3, 0, 40)).toBe(false);
    expect(zombieKccActive(3, 1, 40)).toBe(true);
    expect(zombieKccActive(3, 2, 40)).toBe(false);
  });

  it('60m超は uid%8 バケット(8フレームに1回)', () => {
    // uid=0: frame%8===0 のときだけ true
    expect(zombieKccActive(0, 0, 80)).toBe(true);
    expect(zombieKccActive(0, 1, 80)).toBe(false);
    expect(zombieKccActive(0, 2, 80)).toBe(false);
    expect(zombieKccActive(0, 3, 80)).toBe(false);
    expect(zombieKccActive(0, 4, 80)).toBe(false);
    expect(zombieKccActive(0, 8, 80)).toBe(true);
    // uid=1: frame%8===1 のときだけ true
    expect(zombieKccActive(1, 0, 80)).toBe(false);
    expect(zombieKccActive(1, 1, 80)).toBe(true);
    expect(zombieKccActive(1, 2, 80)).toBe(false);
  });

  it('distToPlayer=Infinity は60m超扱いで uid%8 バケット', () => {
    expect(zombieKccActive(0, 0, Infinity)).toBe(true);
    expect(zombieKccActive(0, 1, Infinity)).toBe(false);
    expect(zombieKccActive(0, 4, Infinity)).toBe(false);
    expect(zombieKccActive(0, 8, Infinity)).toBe(true);
  });
});

describe('R100 cap検証(zombieTotal / ZOMBIE_MAX_ALIVE)', () => {
  it('zombieTotal(100) は 270 に収まる(上限クランプ)', () => {
    expect(zombieTotal(100)).toBe(270);
  });

  it('zombieTotal は r=1 から単調増加し r≈40 で 270 に到達する', () => {
    let prev = 0;
    let cappedAt: number | null = null;
    for (let r = 1; r <= 100; r += 1) {
      const v = zombieTotal(r);
      expect(v).toBeGreaterThanOrEqual(prev);
      if (cappedAt === null && v === 270) cappedAt = r;
      prev = v;
    }
    // r=40 付近でキャップに達しているはず
    expect(cappedAt).not.toBeNull();
    expect(cappedAt!).toBeLessThanOrEqual(50);
  });

  it('ZOMBIE_MAX_ALIVE.high === 108(alive上限=R100でも変わらない)', () => {
    expect(ZOMBIE_MAX_ALIVE.high).toBe(108);
  });
});

describe('refundRound(F2 修羅スピンアップの弾返却)', () => {
  it('容量未満なら+1する', () => {
    expect(refundRound(0, 150)).toBe(1);
    expect(refundRound(148, 150)).toBe(149);
  });

  it('容量でclampする(過剰返却しない)', () => {
    expect(refundRound(150, 150)).toBe(150);
    expect(refundRound(149, 150)).toBe(150);
  });
});

describe('shurikenDiscLife(F8 手裏剣disc寿命クランプ)', () => {
  it('ヒット無しは既定0.5s', () => {
    expect(shurikenDiscLife(null, 60)).toBe(0.5);
  });

  it('着弾距離/速度で飛行時間をクランプ(12m/60m/s=0.2s)', () => {
    expect(shurikenDiscLife(12, 60)).toBeCloseTo(0.2);
  });

  it('遠距離ヒットでも既定0.5sを超えない', () => {
    expect(shurikenDiscLife(60, 60)).toBe(0.5);
  });

  it('至近ヒットはほぼ即時消滅', () => {
    expect(shurikenDiscLife(0.6, 60)).toBeCloseTo(0.01);
  });

  it('不正入力(速度0/負距離)は既定0.5sへフォールバック', () => {
    expect(shurikenDiscLife(10, 0)).toBe(0.5);
    expect(shurikenDiscLife(-1, 60)).toBe(0.5);
  });
});
