import { describe, expect, it } from 'vitest';
import { hotspotEma, spawnDistScore } from './match';

describe('spawnDistScore ② BO2式スポーンスコアリング', () => {
  it('最適帯(40-70m)は最高スコア 100', () => {
    expect(spawnDistScore(40)).toBe(100);
    expect(spawnDistScore(55)).toBe(100);
    expect(spawnDistScore(70)).toBe(100);
  });

  it('25m未満は大減点(負スコア)', () => {
    expect(spawnDistScore(0)).toBeLessThan(-100);
    expect(spawnDistScore(24)).toBeLessThan(0);
  });

  it('25-40m の移行帯は -100 〜 0 の範囲', () => {
    const s25 = spawnDistScore(25);
    const s32 = spawnDistScore(32);
    const s39 = spawnDistScore(39.99); // d<40 の境界直前(d=40 は最適帯で100になる)
    expect(s25).toBeCloseTo(-100, 0);
    expect(s32).toBeGreaterThan(-100);
    expect(s32).toBeLessThan(0);
    expect(s39).toBeCloseTo(0, 0);
  });

  it('遠距離(>70m)は距離が増えるほどスコアが下がる', () => {
    expect(spawnDistScore(80)).toBeLessThan(spawnDistScore(70));
    expect(spawnDistScore(120)).toBeLessThan(spawnDistScore(80));
    expect(spawnDistScore(200)).toBeLessThanOrEqual(spawnDistScore(120));
  });

  it('最高スコアは 100 でキャップ', () => {
    expect(spawnDistScore(50)).toBe(100);
    expect(spawnDistScore(60)).toBe(100);
  });

  it('最低スコアは -50 以上', () => {
    expect(spawnDistScore(500)).toBeGreaterThanOrEqual(-50);
    expect(spawnDistScore(1000)).toBeGreaterThanOrEqual(-50);
  });

  it('中距離(40-70m)は近距離(<25m)・遠距離(>150m)より常に高スコア', () => {
    for (const mid of [40, 55, 70]) {
      for (const near of [5, 15, 24]) {
        expect(spawnDistScore(mid)).toBeGreaterThan(spawnDistScore(near));
      }
      for (const far of [150, 250, 400]) {
        expect(spawnDistScore(mid)).toBeGreaterThan(spawnDistScore(far));
      }
    }
  });
});

describe('hotspotEma ① 戦闘引力ホットスポット', () => {
  it('初イベント(prev=null)はイベント位置をそのまま採用', () => {
    expect(hotspotEma(null, { x: 30, z: -12 })).toEqual({ x: 30, z: -12 });
  });

  it('以降は α=0.35 の指数移動平均で寄せる', () => {
    const next = hotspotEma({ x: 0, z: 0 }, { x: 100, z: -100 });
    expect(next.x).toBeCloseTo(35, 6);
    expect(next.z).toBeCloseTo(-35, 6);
  });

  it('同一位置のイベントを繰り返すとその位置へ収束する', () => {
    let pos: { x: number; z: number } | null = null;
    for (let i = 0; i < 30; i += 1) {
      pos = hotspotEma(pos, { x: 80, z: 40 });
    }
    expect(pos!.x).toBeCloseTo(80, 3);
    expect(pos!.z).toBeCloseTo(40, 3);
  });

  it('α指定で追従速度を変えられる(α=1で即時追従)', () => {
    expect(hotspotEma({ x: 10, z: 10 }, { x: 50, z: 90 }, 1)).toEqual({ x: 50, z: 90 });
  });

  it('決定論: 同じ入力列からは常に同じ軌跡', () => {
    const run = (): Array<{ x: number; z: number }> => {
      let p: { x: number; z: number } | null = null;
      const track: Array<{ x: number; z: number }> = [];
      for (const ev of [{ x: 10, z: 0 }, { x: -20, z: 35 }, { x: 5, z: 5 }]) {
        p = hotspotEma(p, ev);
        track.push(p);
      }
      return track;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
