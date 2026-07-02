import { describe, expect, it } from 'vitest';
import { closestApproach } from './whizz';

const ORIGIN = { x: 0, y: 0, z: 0 };
const FORWARD = { x: 0, y: 0, z: -1 }; // -Z へ撃つ(hibanaの前方向)

describe('closestApproach', () => {
  it('真横通過: 耳の真横を抜ける弾は横距離そのものが dist になる', () => {
    const { dist, along } = closestApproach(ORIGIN, FORWARD, 20, { x: 1.5, y: 0, z: -10 });
    expect(dist).toBeCloseTo(1.5, 10);
    expect(along).toBeCloseTo(10, 10);
  });

  it('手前停弾: 壁で止まった弾は along が segLen にクランプされ耳に届かない', () => {
    const { dist, along } = closestApproach(ORIGIN, FORWARD, 5, { x: 1, y: 0, z: -10 });
    expect(along).toBe(5);
    // 停弾点(0,0,-5)から耳(1,0,-10)まで sqrt(1+25)。無限直線なら1になるところ
    expect(dist).toBeGreaterThan(1);
    expect(dist).toBeCloseTo(Math.hypot(1, 5), 10);
  });

  it('背後方向: 弾道の後方にいる耳は along=0(発射点が最近接)になる', () => {
    const { dist, along } = closestApproach(ORIGIN, FORWARD, 20, { x: 0, y: 0, z: 5 });
    expect(along).toBe(0);
    expect(dist).toBeCloseTo(5, 10);
  });

  it('平行遠方: 弾道から大きく外れた耳は距離がそのまま残る(ヒュン音の閾値外)', () => {
    const { dist } = closestApproach(ORIGIN, FORWARD, 20, { x: 30, y: 0, z: -10 });
    expect(dist).toBeCloseTo(30, 10);
  });
});
