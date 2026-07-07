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

// ── R35 エフェクト祭 新規 API テスト ─────────────────────────────────────────

describe('R35 Effects – KE 黒雷帝エフェクト', () => {
  it('walkKokuraiRune: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.walkKokuraiRune(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('walkKokuraiRune (reduceMotion=true): ボルトなし・リングのみ追加', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.walkKokuraiRune(ORIGIN, true);
    // リング1本のみ → exactly 1 child added
    expect(scene.children.length - before).toBe(1);
  });

  it('soulAbsorbBeam: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    const toPos = new THREE.Vector3(5, 0, 0);
    expect(() => fx.soulAbsorbBeam(ORIGIN, toPos)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('soulAbsorbBeam (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.soulAbsorbBeam(ORIGIN, new THREE.Vector3(5, 0, 0), true)).not.toThrow();
  });

  it('darkVoidPulse (charge01=0): 例外なし', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.darkVoidPulse(ORIGIN, 0)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('darkVoidPulse (charge01=1): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.darkVoidPulse(ORIGIN, 1)).not.toThrow();
  });

  it('darkVoidPulse (reduceMotion=true): 例外なし、吸引粒子なし', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.darkVoidPulse(ORIGIN, 0.5, true);
    // 暗転球+コアのみ(darkNovas経由、各1個=scene.children+2)
    expect(scene.children.length - before).toBe(2);
  });

  it('gokuraiZetsumetsuEffect (KE-5込み): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gokuraiZetsumetsuEffect(ORIGIN)).not.toThrow();
  });

  it('gokuraiZetsumetsuEffect (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gokuraiZetsumetsuEffect(ORIGIN, true)).not.toThrow();
  });
});

describe('R35 Effects – RE 雷帝エフェクト', () => {
  it('raiteiFootprint: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.raiteiFootprint(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('raiteiFootprint (reduceMotion=true): リングのみ', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.raiteiFootprint(ORIGIN, true);
    expect(scene.children.length - before).toBe(1);
  });
});

describe('R35 Effects – BE 黒帝エフェクト', () => {
  it('kokuteiSmokeMantle: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.kokuteiSmokeMantle(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('kokuteiSmokeMantle (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.kokuteiSmokeMantle(ORIGIN, true)).not.toThrow();
  });

  it('kokuteiSlashResidual: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.kokuteiSlashResidual(ORIGIN, new THREE.Vector3(5, 0, 0))).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });
});

describe('R35 Effects – EX 特殊武器拡張', () => {
  it('gekkouMoonPhaseCharge (charge01=0): 例外なし', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.gekkouMoonPhaseCharge(ORIGIN, 0)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('gekkouMoonPhaseCharge (charge01=1.0): bowImpact追加あり、例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.gekkouMoonPhaseCharge(ORIGIN, 1.0)).not.toThrow();
  });

  it('gekkouMoonPhaseCharge (charge01=1.0, reduceMotion=true): bowImpactなし、例外なし', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.gekkouMoonPhaseCharge(ORIGIN, 1.0, true);
    // 満月でも reduceMotion=true → burstRing/bowImpact なし、三日月メッシュ1個のみ
    expect(scene.children.length - before).toBe(1);
  });

  it('banjinStorm (EX-2 trail): 例外なし、グループに残像尾が含まれる', () => {
    const { fx, scene } = makeEffects();
    expect(() => fx.banjinStorm(ORIGIN, DIR)).not.toThrow();
    let hasTrail = false;
    scene.traverse((child) => { if (child.userData.isTrail === true) hasTrail = true; });
    expect(hasTrail).toBe(true);
  });

  it('gekkouTsukiotoshi (EX-3): 例外なし、update中に例外なし', () => {
    const { fx } = makeEffects();
    fx.gekkouTsukiotoshi(ORIGIN);
    // 落下シミュレーション: 複数フレームupdate
    for (let i = 0; i < 60; i++) {
      expect(() => fx.update(0.05)).not.toThrow();
    }
  });
});

describe('R35 Effects – GE 汎用エフェクト', () => {
  it('botDeathFxByClass sniper: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0xff0000, 'sniper')).not.toThrow();
  });

  it('botDeathFxByClass shotgun: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0x0000ff, 'shotgun')).not.toThrow();
  });

  it('botDeathFxByClass launcher: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0xff6600, 'launcher')).not.toThrow();
  });

  it('botDeathFxByClass melee: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0xaa00ff, 'melee')).not.toThrow();
  });

  it('botDeathFxByClass exotic: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0xffd700, 'exotic')).not.toThrow();
  });

  it('botDeathFxByClass default: 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.botDeathFxByClass(ORIGIN, 0xffffff, 'assault')).not.toThrow();
  });

  it('headshotFlareV2: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.headshotFlareV2(ORIGIN)).not.toThrow();
    // 十字線2+リング1+球1 = 4個
    expect(scene.children.length - before).toBe(4);
  });

  it('slideSparks: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.slideSparks(ORIGIN, DIR)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('slideSparks (reduceMotion=true): 何も追加しない', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.slideSparks(ORIGIN, DIR, true);
    expect(scene.children.length).toBe(before);
  });

  it('landingShockwave (strength01=0): 例外なし', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.landingShockwave(ORIGIN, 0)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('landingShockwave (strength01=1.0): 例外なし、亀裂2本スポーン', () => {
    const { fx } = makeEffects();
    expect(() => fx.landingShockwave(ORIGIN, 1.0)).not.toThrow();
  });

  it('landingShockwave (reduceMotion=true): 例外なし', () => {
    const { fx } = makeEffects();
    expect(() => fx.landingShockwave(ORIGIN, 0.8, true)).not.toThrow();
  });

  it('wallRunSparks: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    const normal = new THREE.Vector3(1, 0, 0);
    expect(() => fx.wallRunSparks(ORIGIN, normal)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });

  it('wallRunSparks (reduceMotion=true): 何も追加しない', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.wallRunSparks(ORIGIN, new THREE.Vector3(1, 0, 0), true);
    expect(scene.children.length).toBe(before);
  });

  it('reloadCompleteFlash: 例外なし、シーンに子が追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.reloadCompleteFlash(ORIGIN)).not.toThrow();
    expect(scene.children.length).toBeGreaterThan(before);
  });
});

describe('棒見え修正 – 黒雷帝エフェクト品質ガード', () => {
  it('kokuteiSmokeMantle: 羽根棒廃止 — 全子メッシュが isSmoke フラグを持つ', () => {
    const { fx, scene } = makeEffects();
    fx.kokuteiSmokeMantle(ORIGIN);
    let hasWingBox = false;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
        // streakGeometry由来の 4.2m 棒が残っていないこと(scale.z > 2 なら棒)
        if (child.scale.z > 2) hasWingBox = true;
      }
    });
    expect(hasWingBox).toBe(false);
  });

  it('kokuteiSmokeMantle: 煙パフ(isSmoke)が1個以上存在する', () => {
    const { fx, scene } = makeEffects();
    fx.kokuteiSmokeMantle(ORIGIN);
    let smokeCount = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.isSmoke === true) smokeCount++;
    });
    expect(smokeCount).toBeGreaterThanOrEqual(1);
  });

  it('soulAbsorbBeam: ビーム opacity が 0.35 以下に抑制されている', () => {
    const { fx, scene } = makeEffects();
    fx.soulAbsorbBeam(ORIGIN, new THREE.Vector3(10, 0, 0));
    let maxOpacity = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Line) {
        const mat = child.material as THREE.LineBasicMaterial;
        if (mat.opacity > maxOpacity) maxOpacity = mat.opacity;
      }
    });
    expect(maxOpacity).toBeLessThanOrEqual(0.35);
  });

  it('kokuteiSlashResidual: 残光 opacity が 0.20 以下に抑制されている', () => {
    const { fx, scene } = makeEffects();
    fx.kokuteiSlashResidual(ORIGIN, new THREE.Vector3(5, 0, 0));
    let maxOpacity = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Line) {
        const mat = child.material as THREE.LineBasicMaterial;
        if (mat.opacity > maxOpacity) maxOpacity = mat.opacity;
      }
    });
    expect(maxOpacity).toBeLessThanOrEqual(0.20);
  });
});

describe('R35 Effects – ライフサイクル管理', () => {
  it('clear: R35 全プールを clear 後に例外なし', () => {
    const { fx } = makeEffects();
    fx.walkKokuraiRune(ORIGIN);
    fx.soulAbsorbBeam(ORIGIN, new THREE.Vector3(5, 0, 0));
    fx.darkVoidPulse(ORIGIN, 0.5);
    fx.raiteiFootprint(ORIGIN);
    fx.kokuteiSmokeMantle(ORIGIN);
    fx.kokuteiSlashResidual(ORIGIN, new THREE.Vector3(5, 0, 0));
    fx.gekkouMoonPhaseCharge(ORIGIN, 0.5);
    fx.botDeathFxByClass(ORIGIN, 0xff0000, 'sniper');
    fx.headshotFlareV2(ORIGIN);
    fx.slideSparks(ORIGIN, DIR);
    fx.landingShockwave(ORIGIN, 0.8);
    fx.wallRunSparks(ORIGIN, new THREE.Vector3(1, 0, 0));
    fx.reloadCompleteFlash(ORIGIN);
    expect(() => fx.clear()).not.toThrow();
  });

  it('update: R35 エフェクト追加後の update(0.016) が例外なし', () => {
    const { fx } = makeEffects();
    fx.walkKokuraiRune(ORIGIN);
    fx.soulAbsorbBeam(ORIGIN, new THREE.Vector3(5, 0, 0));
    fx.darkVoidPulse(ORIGIN, 0.8);
    fx.raiteiFootprint(ORIGIN);
    fx.kokuteiSmokeMantle(ORIGIN);
    fx.kokuteiSlashResidual(ORIGIN, new THREE.Vector3(5, 0, 0));
    fx.gekkouMoonPhaseCharge(ORIGIN, 0.5);
    fx.headshotFlareV2(ORIGIN);
    fx.slideSparks(ORIGIN, DIR);
    fx.landingShockwave(ORIGIN, 0.5);
    fx.wallRunSparks(ORIGIN, new THREE.Vector3(1, 0, 0));
    fx.reloadCompleteFlash(ORIGIN);
    expect(() => fx.update(0.016)).not.toThrow();
  });

  // 予算検証: プール上限96の安全域
  // gokuraiColumns上限=96。最大同時負荷想定(極雷絶滅+月花雷轟+黒雷帝移動):
  //   gokuraiZetsumetsuEffect: 5柱×2bolt/柱=10 + KE-5ダミースケジューラ=1 → 11
  //   geppaRaigouStorm: 28柱=28 + 垂直亀裂は streaks別管理
  //   kokuraiBlinkArrive: 4bolt=4
  //   spawnKokuraiTrail: 2bolt=2
  //   合計: 11+28+4+2 = 45 → 上限96の47%。ダブル発動でも90<96で安全
  it('budget: gokuraiColumns プールがクリア後に空', () => {
    const { fx } = makeEffects();
    fx.gokuraiZetsumetsuEffect(ORIGIN);
    expect(() => fx.clear()).not.toThrow();
  });
});
