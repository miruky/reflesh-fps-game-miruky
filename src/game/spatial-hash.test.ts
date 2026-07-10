import { describe, expect, it } from 'vitest';
import { ZOMBIE_SEP_MAX_MPS, ZOMBIE_SEP_RANGE_M, ZombieSeparationGrid } from './spatial-hash';

describe('ZombieSeparationGrid 未rebuild(非回帰の安全設計)', () => {
  it('一度もrebuild()していない格子は常に{x:0, z:0}を返す', () => {
    const grid = new ZombieSeparationGrid();
    const out = { x: 999, z: 999 };
    grid.separation(1, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });
});

describe('ZombieSeparationGrid 反発方向', () => {
  it('東(+x)にいる隣接個体からは西(-x)向きに押される', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.5, z: 0 }, // 距離0.5 < 1.2m
    ]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    expect(out.x).toBeLessThan(0);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it('北(+z)にいる隣接個体からは南(-z)向きに押される', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0, z: 0.5 },
    ]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.z).toBeLessThan(0);
  });

  it('同方向に複数の近接個体がいると反発は合算されて単独より大きくなる', () => {
    // 3体とも自分から見てほぼ同じ側(+x寄り)に置き、ベクトルが打ち消し合わないようにする
    const single = new ZombieSeparationGrid();
    single.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.5, z: 0 },
    ]);
    const outSingle = { x: 0, z: 0 };
    single.separation(1, 0, 0, outSingle);

    const multi = new ZombieSeparationGrid();
    multi.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.5, z: 0 },
      { uid: 3, x: 0.5, z: 0.15 },
      { uid: 4, x: 0.6, z: -0.1 },
    ]);
    const outMulti = { x: 0, z: 0 };
    multi.separation(1, 0, 0, outMulti);

    const magSingle = Math.hypot(outSingle.x, outSingle.z);
    const magMulti = Math.hypot(outMulti.x, outMulti.z);
    expect(magMulti).toBeGreaterThan(magSingle);
  });
});

describe('ZombieSeparationGrid 範囲外無干渉', () => {
  it('距離が1.2m以上の個体は反発に寄与しない', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: ZOMBIE_SEP_RANGE_M, z: 0 }, // ちょうど閾値=range未満のみ寄与する設計
    ]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });

  it('遠く離れた個体(別セルかつ範囲外)は完全に無視される', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 40, z: -25 },
    ]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });

  it('自分自身のuidは反発の対象にならない(同一座標2件でもゼロ)', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([{ uid: 1, x: 5, z: 5 }]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 5, 5, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });
});

describe('ZombieSeparationGrid 反発量の上限とスケール', () => {
  it('完全接触に近いほど反発量はZOMBIE_SEP_MAX_MPSに漸近するが超えない', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.01, z: 0 }, // ほぼ密着
    ]);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    const mag = Math.hypot(out.x, out.z);
    expect(mag).toBeLessThanOrEqual(ZOMBIE_SEP_MAX_MPS + 1e-9);
    expect(mag).toBeGreaterThan(ZOMBIE_SEP_MAX_MPS * 0.9);
  });

  it('重なりが浅いほど反発量は比例して小さくなる', () => {
    const near = new ZombieSeparationGrid();
    near.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.1, z: 0 },
    ]);
    const outNear = { x: 0, z: 0 };
    near.separation(1, 0, 0, outNear);

    const far = new ZombieSeparationGrid();
    far.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 1.1, z: 0 },
    ]);
    const outFar = { x: 0, z: 0 };
    far.separation(1, 0, 0, outFar);

    expect(Math.hypot(outNear.x, outNear.z)).toBeGreaterThan(Math.hypot(outFar.x, outFar.z));
  });
});

describe('ZombieSeparationGrid 再構築', () => {
  it('rebuild()を呼び直すと旧エントリは完全に消え、新エントリだけが有効になる', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.5, z: 0 },
    ]);
    const out1 = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out1);
    expect(Math.hypot(out1.x, out1.z)).toBeGreaterThan(0);

    // uid=2 がいなくなり、遠方のuid=3だけになった新フレーム
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 3, x: 50, z: 50 },
    ]);
    const out2 = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out2);
    expect(out2).toEqual({ x: 0, z: 0 });
  });

  it('rebuild()後にsizeが登録数と一致する', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 1, z: 1 },
      { uid: 3, x: 2, z: 2 },
    ]);
    expect(grid.size).toBe(3);
  });

  it('多数(200件)登録してもクラッシュせず、近傍のみ寄与する(格子のスケール確認)', () => {
    const grid = new ZombieSeparationGrid();
    const entries = [];
    for (let i = 0; i < 200; i += 1) {
      entries.push({ uid: i, x: (i % 20) * 5, z: Math.floor(i / 20) * 5 }); // 5m間隔=範囲外
    }
    entries.push({ uid: 9999, x: 0.3, z: 0 }); // uid=0(0,0)の近傍に1件だけ追加
    grid.rebuild(entries);
    const out = { x: 0, z: 0 };
    grid.separation(0, 0, 0, out);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(0);

    const outFar = { x: 0, z: 0 };
    grid.separation(1, 5, 0, outFar); // 5m間隔で隣接配置された他個体からは影響を受けない
    expect(outFar).toEqual({ x: 0, z: 0 });
  });

  it('clear()後は登録済みでもseparation()が常にゼロを返す', () => {
    const grid = new ZombieSeparationGrid();
    grid.rebuild([
      { uid: 1, x: 0, z: 0 },
      { uid: 2, x: 0.5, z: 0 },
    ]);
    grid.clear();
    expect(grid.size).toBe(0);
    const out = { x: 0, z: 0 };
    grid.separation(1, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });
});
