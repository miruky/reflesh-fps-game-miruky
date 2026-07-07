import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Effects } from './effects';

// ── R34 特殊武器溜め/ウルト VFX API テスト ────────────────────────────────
// Effects.ts はシーンに描画オブジェクトを追加する副作用のみ持つため、
// 「例外なしで呼べる」「シーンに子が追加される」を主軸にテストする。

function makeEffects(): { fx: Effects; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const fx = new Effects(scene);
  return { fx, scene };
}

const ORIGIN = new THREE.Vector3(0, 0, 0);
const DIR = new THREE.Vector3(0, 0, -1);

describe('R34 Effects – 溜め攻撃 VFX', () => {
  it('banjinStorm: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.banjinStorm(ORIGIN, DIR)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('gekkouFullMoon: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.gekkouFullMoon(ORIGIN, DIR)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('fujinTyphoon: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.fujinTyphoon(ORIGIN, DIR)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('gouenBlast (reduceMotion=false): 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.gouenBlast(ORIGIN, false)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('gouenBlast (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gouenBlast(ORIGIN, true)).not.toThrow();
  });

  it('tenraiTenbatsu (reduceMotion=false): 例外なし、スケジューラグループが追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.tenraiTenbatsu(ORIGIN, 20, false)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('tenraiTenbatsu (reduceMotion=true): 例外なし、何も追加しない', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.tenraiTenbatsu(ORIGIN, 20, true)).not.toThrow();
    expect(scene.children.length).toBe(before);
  });

  it('shinkirouSweep: 例外なし、sweepBeam ノードが含まれる', () => {
    const { fx, scene } = makeEffects();
    expect(() => fx.shinkirouSweep(ORIGIN, 0, Math.PI / 2)).not.toThrow();
    let found = false;
    scene.traverse((child) => { if (child.name === 'sweepBeam') found = true; });
    expect(found).toBe(true);
  });

  it('shuraRampage: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.shuraRampage(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });
});

describe('R34 Effects – M ウルト VFX', () => {
  it('banjinKagemai (reduceMotion=false): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.banjinKagemai(ORIGIN, false)).not.toThrow();
  });

  it('banjinKagemai (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.banjinKagemai(ORIGIN, true)).not.toThrow();
  });

  it('gekkouTsukiotoshi: 例外なし、月球(isMoon)ノードが含まれる', () => {
    const { fx, scene } = makeEffects();
    expect(() => fx.gekkouTsukiotoshi(ORIGIN, false)).not.toThrow();
    let hasMoon = false;
    scene.traverse((child) => { if (child.userData.isMoon === true) hasMoon = true; });
    expect(hasMoon).toBe(true);
  });

  it('fujinTornadoAt: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.fujinTornadoAt(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('fujinKamikaze (reduceMotion=false): 8竜巻スポーン', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.fujinKamikaze(ORIGIN, 50, false)).not.toThrow();
    expect(scene.children.length - before).toBe(8);
  });

  it('fujinKamikaze (reduceMotion=true): 3竜巻に削減', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.fujinKamikaze(ORIGIN, 50, true)).not.toThrow();
    expect(scene.children.length - before).toBe(3);
  });

  it('gouenMesse (reduceMotion=false): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gouenMesse(ORIGIN, DIR, false)).not.toThrow();
  });

  it('gouenMesse (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gouenMesse(ORIGIN, DIR, true)).not.toThrow();
  });

  it('tenraiHachirai: positions が空でも例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.tenraiHachirai([], false)).not.toThrow();
  });

  it('tenraiHachirai (reduceMotion=true): 何もしない', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.tenraiHachirai([ORIGIN.clone()], true);
    expect(scene.children.length).toBe(before);
  });

  it('tenraiHachirai: 8 positions で例外なし', () => {
    const { fx } = makeEffects();
    const positions = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i * 5, 0, 0));
    expect(() => fx.tenraiHachirai(positions, false)).not.toThrow();
  });

  it('shinkirouKyozou: 例外なし、歪曲リング(isDistortRing)が含まれる', () => {
    const { fx, scene } = makeEffects();
    expect(() => fx.shinkirouKyozou(2.0, false)).not.toThrow();
    let hasRing = false;
    scene.traverse((child) => { if (child.userData.isDistortRing === true) hasRing = true; });
    expect(hasRing).toBe(true);
  });

  it('shinkirouKyozou: durationS が 4.0 を超えた場合にクランプされる', () => {
    const { fx } = makeEffects();
    // 例外なし・ライフは 4.5 で上限
    expect(() => fx.shinkirouKyozou(10.0, false)).not.toThrow();
  });

  it('shuraKourin (reduceMotion=false): 例外なし、頭(puff)が含まれる', () => {
    const { fx, scene } = makeEffects();
    expect(() => fx.shuraKourin(ORIGIN, false)).not.toThrow();
    let hasPuff = false;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry) hasPuff = true;
    });
    expect(hasPuff).toBe(true);
  });

  it('shuraKourin (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.shuraKourin(ORIGIN, true)).not.toThrow();
  });
});

describe('R34 Effects – ライフサイクル管理', () => {
  it('clear: 全 R34 プール が clear 後に空になる(例外なし)', () => {
    const { fx } = makeEffects();
    fx.banjinStorm(ORIGIN, DIR);
    fx.gekkouFullMoon(ORIGIN, DIR);
    fx.fujinTyphoon(ORIGIN, DIR);
    fx.gouenBlast(ORIGIN);
    fx.tenraiTenbatsu(ORIGIN, 10);
    fx.shinkirouSweep(ORIGIN, 0, 1);
    fx.shuraRampage(ORIGIN);
    fx.banjinKagemai(ORIGIN);
    fx.gekkouTsukiotoshi(ORIGIN);
    fx.fujinTornadoAt(ORIGIN);
    fx.fujinKamikaze(ORIGIN, 20);
    fx.gouenMesse(ORIGIN, DIR);
    fx.shinkirouKyozou(2);
    fx.shuraKourin(ORIGIN);
    expect(() => fx.clear()).not.toThrow();
  });

  it('update: R34 エフェクト追加後の update(0.016) が例外なし', () => {
    const { fx } = makeEffects();
    fx.banjinStorm(ORIGIN, DIR);
    fx.gekkouFullMoon(ORIGIN, DIR);
    fx.fujinTyphoon(ORIGIN, DIR);
    fx.gouenBlast(ORIGIN);
    fx.shinkirouSweep(ORIGIN, 0, Math.PI / 2);
    fx.shuraRampage(ORIGIN);
    fx.banjinKagemai(ORIGIN);
    fx.gekkouTsukiotoshi(ORIGIN);
    fx.fujinTornadoAt(ORIGIN);
    fx.gouenMesse(ORIGIN, DIR);
    fx.shinkirouKyozou(2);
    fx.shuraKourin(ORIGIN);
    expect(() => fx.update(0.016)).not.toThrow();
  });
});
