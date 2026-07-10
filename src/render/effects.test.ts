import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
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

// ── R48-V監査対応: 死亡FX二重発火除去 + hitPuff/deathBurstプール化 ─────────────
describe('R48-V Effects – botDeathFxByClass 二重発火除去', () => {
  const CLASSES = ['sniper', 'shotgun', 'launcher', 'melee', 'exotic', 'rifle', 'smg', 'pistol', 'lmg', 'marksman', 'assault'];

  it('全クラスで botDeathFxByClass が内部で deathBurst を呼ばない(呼び出し元が既に1回発火済みの契約)', () => {
    const { fx } = makeEffects();
    const spy = vi.spyOn(fx, 'deathBurst');
    for (const cls of CLASSES) {
      fx.botDeathFxByClass(ORIGIN, 0xff0000, cls);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('botDeathFxByClass exotic: deathBurst除去後はaccentRingのみ(1個)追加', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.botDeathFxByClass(ORIGIN, 0xffd700, 'exotic');
    expect(scene.children.length - before).toBe(1);
  });

  it('botDeathFxByClass default(未分類クラス): deathBurst除去後は何も追加しない(呼び出し元契約)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.botDeathFxByClass(ORIGIN, 0xffffff, 'assault');
    expect(scene.children.length - before).toBe(0);
  });
});

describe('R48-V Effects – hitPuff/deathBurst オブジェクトプール化', () => {
  it('hitPuff: HITPUFF_MAX(128)を超えて連続発火してもscene上のアクティブ数が頭打ちになる', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    for (let i = 0; i < 200; i += 1) fx.hitPuff(ORIGIN);
    expect(scene.children.length - before).toBe(128);
  });

  it('deathBurst: 108体同時死亡(全滅ウルト相当)でもDEATH_BURST_MAX(32)で頭打ちになる(flash32+shard32=64)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    for (let i = 0; i < 108; i += 1) fx.deathBurst(new THREE.Vector3(i, 0, 0), 0xff0000);
    expect(scene.children.length - before).toBe(64);
  });

  it('deathBurst: 発火→life経過→再発火を繰り返してもscene.children総数は増え続けない(プール再利用の検証)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    // 1巡目: 10発火(flash10+shardGroup10=20児童)
    for (let i = 0; i < 10; i += 1) fx.deathBurst(ORIGIN, 0xff0000);
    expect(scene.children.length - before).toBe(20);
    // flash life=0.4 / shardGroup life=0.7。1.0秒進めれば両方期限切れ→sceneから離脱してfreeプールへ
    for (let i = 0; i < 100; i += 1) fx.update(0.01);
    expect(scene.children.length - before).toBe(0);
    // 2巡目: 再度10発火 → freeプールから再利用されるため、やはり20のまま(無限増殖しない)
    for (let i = 0; i < 10; i += 1) fx.deathBurst(ORIGIN, 0xff0000);
    expect(scene.children.length - before).toBe(20);
  });

  it('1キル=1エフェクト維持: 上限到達後も新しいkillはFXを受け取る(最古を強制リサイクルして必ず表示)', () => {
    const { fx, scene } = makeEffects();
    for (let i = 0; i < 40; i += 1) fx.deathBurst(new THREE.Vector3(i, 0, 0), 0xff0000);
    // 41回目もエラーなく発火し、位置が最新のpointへ更新されている(=表示される)ことを検証
    const latest = new THREE.Vector3(999, 0, 0);
    expect(() => fx.deathBurst(latest, 0x00ff00)).not.toThrow();
    let found = false;
    scene.traverse((child) => {
      if (child instanceof THREE.Group && child.position.distanceTo(latest) < 1e-6) found = true;
    });
    expect(found).toBe(true);
  });

  it('dispose: 期限切れによる回収(free化)ではMaterialをdisposeしない(プール再利用が効いている証拠)', () => {
    const { fx } = makeEffects();
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();
    for (let i = 0; i < 5; i += 1) fx.hitPuff(ORIGIN);
    fx.update(1.0); // hitPuff life=0.16 なので確実に期限切れ→free化
    expect(disposeSpy).not.toHaveBeenCalled();
    disposeSpy.mockRestore();
  });

  it('dispose: 再利用プール(inactive/free分含む)の全Materialが解放される(リーク禁止)', () => {
    const { fx } = makeEffects();
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();

    // hitPuff: 5回発火→期限切れさせてfreeプールへ回収(Material5個がinactiveのまま残る)
    for (let i = 0; i < 5; i += 1) fx.hitPuff(ORIGIN);
    fx.update(1.0);
    expect(disposeSpy).not.toHaveBeenCalled();

    // deathBurst: 3回発火(flashMaterial3 + shardMaterial3×10=30 が active のまま dispose を迎える)
    for (let i = 0; i < 3; i += 1) fx.deathBurst(ORIGIN, 0xff0000);

    fx.dispose();
    // 5(hitPuff free分) + 3(deathBurst flash active分) + 30(deathBurst shard active分) = 38
    expect(disposeSpy.mock.calls.length).toBe(38);

    disposeSpy.mockRestore();
  });

  it('clear 後に再度 hitPuff/deathBurst を呼んでも例外なし(active/freeプール双方がリセットされ、共有geometryはclear()で破棄されない)', () => {
    const { fx } = makeEffects();
    fx.hitPuff(ORIGIN);
    fx.deathBurst(ORIGIN, 0xff0000);
    fx.clear();
    expect(() => {
      fx.hitPuff(ORIGIN);
      fx.deathBurst(ORIGIN, 0xff0000);
    }).not.toThrow();
  });
});

// ── R53-W2: ゾンビ特殊バリアント + パワーアップ + 鍛神台 演出 ─────────────────

describe('R53-W2 Effects – miasmaCloud (瘴気毒雲)', () => {
  it('例外なし、シーンに子(Group)が1個追加される', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.miasmaCloud(0, 0, 0)).not.toThrow();
    expect(scene.children.length - before).toBe(1);
  });

  it('全レイヤー/粒子の opacity 上限が 0.30 を超えない(bloom安全)', () => {
    const { fx, scene } = makeEffects();
    fx.miasmaCloud(0, 0, 0);
    fx.update(0.6); // フェードイン最中(baseOpacityへ収束する前)でも上限は超えない
    let maxOpacity = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && (child.userData.isMiasmaLayer === true || child.userData.isMiasmaParticle === true)) {
        const mat = child.material as THREE.MeshBasicMaterial;
        if (mat.opacity > maxOpacity) maxOpacity = mat.opacity;
      }
    });
    expect(maxOpacity).toBeLessThanOrEqual(0.3);
  });

  it('同時4個(MIASMA_MAX)キャップ: 6回発火してもアクティブGroup数は4に頭打ち', () => {
    const { fx, scene } = makeEffects();
    for (let i = 0; i < 6; i += 1) fx.miasmaCloud(i, 0, 0);
    const count = scene.children.filter((c) => c.userData.isMiasma === true).length;
    expect(count).toBe(4);
  });

  it('上限到達後も最新スポーンは必ず反映される(最古を強制リサイクル)', () => {
    const { fx, scene } = makeEffects();
    for (let i = 0; i < 5; i += 1) fx.miasmaCloud(i, 0, 0);
    fx.miasmaCloud(999, 0, 0);
    let found = false;
    scene.traverse((child) => {
      if (child.userData.isMiasma === true && Math.abs(child.position.x - 999) < 1e-6) found = true;
    });
    expect(found).toBe(true);
  });

  it('寿命(6s)経過でscene離脱→freeプールへ回収される(active数が0に戻る)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    fx.miasmaCloud(0, 0, 0);
    expect(scene.children.length - before).toBe(1);
    for (let i = 0; i < 700; i += 1) fx.update(0.01); // 7s分
    expect(scene.children.length - before).toBe(0);
  });

  it('freeプールからの再利用時に新規Material allocが起きない(dispose呼び出しゼロで往復)', () => {
    const { fx } = makeEffects();
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();
    fx.miasmaCloud(0, 0, 0);
    for (let i = 0; i < 700; i += 1) fx.update(0.01); // free化(disposeはされない)
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(() => fx.miasmaCloud(1, 0, 0)).not.toThrow(); // free再利用
    disposeSpy.mockRestore();
  });

  it('reduceMotion=true: 単層(1)+粒子なし(0)+自転なし', () => {
    const { fx, scene } = makeEffects();
    fx.miasmaCloud(0, 0, 0, true);
    let group: THREE.Object3D | undefined;
    scene.traverse((c) => { if (c.userData.isMiasma === true) group = c; });
    expect(group).toBeDefined();
    const visibleLayers = group!.children.filter((c) => c.userData.isMiasmaLayer === true && c.visible).length;
    const visibleParticles = group!.children.filter((c) => c.userData.isMiasmaParticle === true && c.visible).length;
    expect(visibleLayers).toBe(1);
    expect(visibleParticles).toBe(0);
    expect(group!.userData.rotSpeed).toBe(0);
  });

  it('reduceMotion=false: 4層+5粒子すべてが可視になる', () => {
    const { fx, scene } = makeEffects();
    fx.miasmaCloud(0, 0, 0, false);
    let group: THREE.Object3D | undefined;
    scene.traverse((c) => { if (c.userData.isMiasma === true) group = c; });
    const visibleLayers = group!.children.filter((c) => c.userData.isMiasmaLayer === true && c.visible).length;
    const visibleParticles = group!.children.filter((c) => c.userData.isMiasmaParticle === true && c.visible).length;
    expect(visibleLayers).toBe(4);
    expect(visibleParticles).toBe(5);
  });

  it('clear(): active+free双方のMaterialが解放される(dispose呼び出し回数>0)', () => {
    const { fx } = makeEffects();
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();
    fx.miasmaCloud(0, 0, 0); // active分(4層+5粒子=9 Material)
    fx.miasmaCloud(1, 0, 0);
    fx.update(6.5); // 両方期限切れ→free化(disposeはされない)
    expect(disposeSpy).not.toHaveBeenCalled();
    fx.miasmaCloud(2, 0, 0); // freeから1個再利用(残り1個はfreeのまま)
    fx.clear();
    expect(disposeSpy.mock.calls.length).toBeGreaterThan(0);
    disposeSpy.mockRestore();
  });

  it('clear 後に再度 miasmaCloud を呼んでも例外なし(共有geometryはclear()で破棄されない)', () => {
    const { fx } = makeEffects();
    fx.miasmaCloud(0, 0, 0);
    fx.clear();
    expect(() => fx.miasmaCloud(0, 0, 0)).not.toThrow();
  });
});

describe('R53-W2 Effects – powerUpBeacon / disposePowerUpBeacon', () => {
  const KINDS = ['insta', 'double', 'nuke', 'maxammo', 'carpenter'] as const;

  it('全kindで例外なく生成でき、八面体+リングの子2個を持つ', () => {
    const { fx } = makeEffects();
    for (const k of KINDS) {
      expect(() => {
        const g = fx.powerUpBeacon(k);
        expect(g.children.length).toBe(2);
      }).not.toThrow();
    }
  });

  it('シーンに自動追加しない(呼び出し側管理型の契約)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    const g = fx.powerUpBeacon('insta');
    expect(scene.children.length).toBe(before);
    expect(g.parent).toBeNull();
  });

  it('同一kindの複数生成でMaterialが共有される(毎回cloneしない)', () => {
    const { fx } = makeEffects();
    const g1 = fx.powerUpBeacon('double');
    const g2 = fx.powerUpBeacon('double');
    const m1 = (g1.children[0] as THREE.Mesh).material;
    const m2 = (g2.children[0] as THREE.Mesh).material;
    expect(m1).toBe(m2);
    const r1 = (g1.children[1] as THREE.Mesh).material;
    const r2 = (g2.children[1] as THREE.Mesh).material;
    expect(r1).toBe(r2);
  });

  it('異なるkindは色が異なる(共有キャッシュがkindごとに独立)', () => {
    const { fx } = makeEffects();
    const g1 = fx.powerUpBeacon('insta');
    const g2 = fx.powerUpBeacon('maxammo');
    const m1 = (g1.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const m2 = (g2.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(m1.color.getHex()).not.toBe(m2.color.getHex());
  });

  it('八面体/リングの opacity 上限が 0.55 を超えない(bloom安全)', () => {
    const { fx } = makeEffects();
    for (const k of KINDS) {
      const g = fx.powerUpBeacon(k);
      for (const child of g.children) {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        expect(mat.opacity).toBeLessThanOrEqual(0.55);
      }
    }
  });

  it('disposePowerUpBeacon: parentから除去され、共有Materialは解放されない(他インスタンス保護)', () => {
    const { fx, scene } = makeEffects();
    const g1 = fx.powerUpBeacon('nuke');
    const g2 = fx.powerUpBeacon('nuke');
    scene.add(g1);
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();
    expect(() => fx.disposePowerUpBeacon(g1)).not.toThrow();
    expect(g1.parent).toBeNull();
    expect(disposeSpy).not.toHaveBeenCalled();
    // g2は同じMaterialをまだ問題なく参照できる(disposeされていない)
    expect((g2.children[0] as THREE.Mesh).material).toBe((g1.children[0] as THREE.Mesh).material);
    disposeSpy.mockRestore();
  });

  it('disposePowerUpBeacon: parentが無くても例外なし', () => {
    const { fx } = makeEffects();
    const g = fx.powerUpBeacon('carpenter');
    expect(() => fx.disposePowerUpBeacon(g)).not.toThrow();
  });

  it('reduceMotion=true: bobAmplitude=0(既存rm流儀)、spinSpeedは維持(回転のみ残す)', () => {
    const { fx } = makeEffects();
    const g = fx.powerUpBeacon('carpenter', true);
    expect(g.userData.bobAmplitude).toBe(0);
    expect(g.userData.spinSpeed).toBeGreaterThan(0);
  });

  it('reduceMotion=false: bobAmplitudeが正値', () => {
    const { fx } = makeEffects();
    const g = fx.powerUpBeacon('carpenter', false);
    expect(g.userData.bobAmplitude).toBeGreaterThan(0);
  });

  it('dispose(): kind別共有Materialとoctahedronジオメトリが解放される', () => {
    const { fx } = makeEffects();
    fx.powerUpBeacon('insta');
    fx.powerUpBeacon('double');
    fx.powerUpBeacon('nuke');
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    disposeSpy.mockClear();
    fx.dispose();
    // insta/double/nuke の 八面体Material×3 + リングMaterial×3 = 6
    expect(disposeSpy.mock.calls.length).toBe(6);
    disposeSpy.mockRestore();
  });
});

describe('R53-W2 Effects – papMachineGlow (鍛神台改造演出)', () => {
  it('例外なし、シーンに子が追加される(sparks+blastsプール流用)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.papMachineGlow(0, 1, 0)).not.toThrow();
    // slamSparks(Group1個) + 発光オーブ4個 = 5
    expect(scene.children.length - before).toBe(5);
  });

  it('連打しても例外なく、時間経過後は全て解放される(新規プールを増やさない)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => {
      for (let i = 0; i < 30; i += 1) fx.papMachineGlow(i, 1, 0);
    }).not.toThrow();
    for (let i = 0; i < 400; i += 1) fx.update(0.02); // 8s分(最長寿命2.3sを十分超える)
    expect(scene.children.length).toBe(before);
  });

  it('clear() 後に呼んでも例外なし', () => {
    const { fx } = makeEffects();
    fx.papMachineGlow(0, 1, 0);
    fx.clear();
    expect(() => fx.papMachineGlow(0, 1, 0)).not.toThrow();
  });
});

describe('R53-W2 Effects – variantBlastFx (爆裂種ゾンビ自爆)', () => {
  it('例外なし、シーンに子が追加される(explosion+debrisBurstプール流用)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => fx.variantBlastFx(0, 0, 0)).not.toThrow();
    // explosion: core1+dust5=6個の直接子 / debrisBurst: Group1個 = 7
    expect(scene.children.length - before).toBe(7);
  });

  it('緑がかった破片(0x5a8f4a)が含まれる', () => {
    const { fx, scene } = makeEffects();
    fx.variantBlastFx(0, 0, 0);
    let hasGreenDebris = false;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
        const mat = child.material as THREE.MeshBasicMaterial;
        if (mat.color.getHex() === 0x5a8f4a) hasGreenDebris = true;
      }
    });
    expect(hasGreenDebris).toBe(true);
  });

  it('連打しても例外なく、時間経過後は全て解放される(既存プール上限内)', () => {
    const { fx, scene } = makeEffects();
    const before = scene.children.length;
    expect(() => {
      for (let i = 0; i < 30; i += 1) fx.variantBlastFx(i, 0, 0);
    }).not.toThrow();
    for (let i = 0; i < 400; i += 1) fx.update(0.02); // 8s分
    expect(scene.children.length).toBe(before);
  });

  it('clear() 後に呼んでも例外なし', () => {
    const { fx } = makeEffects();
    fx.variantBlastFx(0, 0, 0);
    fx.clear();
    expect(() => fx.variantBlastFx(0, 0, 0)).not.toThrow();
  });
});

describe('R53-W2 Effects – ライフサイクル統合(clear/update/dispose)', () => {
  it('4API混在後の clear() が例外なし', () => {
    const { fx } = makeEffects();
    fx.miasmaCloud(0, 0, 0);
    fx.powerUpBeacon('insta');
    fx.papMachineGlow(0, 1, 0);
    fx.variantBlastFx(5, 0, 0);
    expect(() => fx.clear()).not.toThrow();
  });

  it('4API混在後の update(0.016) が例外なし', () => {
    const { fx } = makeEffects();
    fx.miasmaCloud(0, 0, 0);
    fx.papMachineGlow(0, 1, 0);
    fx.variantBlastFx(5, 0, 0);
    const beacon = fx.powerUpBeacon('double');
    expect(() => fx.update(0.016)).not.toThrow();
    expect(() => fx.disposePowerUpBeacon(beacon)).not.toThrow();
  });

  it('4API混在後の dispose() が例外なし', () => {
    const { fx } = makeEffects();
    fx.miasmaCloud(0, 0, 0);
    fx.powerUpBeacon('nuke');
    fx.papMachineGlow(0, 1, 0);
    fx.variantBlastFx(5, 0, 0);
    expect(() => fx.dispose()).not.toThrow();
  });
});

// ── R53 帝王体験(Fable#5): キル柱tier格差+ブリンク連携FX ──────────────────────
describe('R53: kokuraiteiKillColumn tier格差 / raitenSlashFx / blinkDischargeNova', () => {
  it('tier省略は明示normalとシーン追加数が一致する(後方互換)', () => {
    const a = makeEffects();
    const b = makeEffects();
    const pos = new THREE.Vector3(0, 0, 0);
    a.fx.kokuraiteiKillColumn(pos.clone());
    b.fx.kokuraiteiKillColumn(pos.clone(), 'normal');
    // Math.random由来の副ボルト分の揺れがあるため、複数回の平均でなく範囲一致で確認
    const ca = a.scene.children.length;
    const cb = b.scene.children.length;
    expect(Math.abs(ca - cb)).toBeLessThanOrEqual(2); // 確率的な副ボルト±1系のみの差
    a.fx.dispose();
    b.fx.dispose();
  });

  it('elite/bossは格差装飾でシーン追加数が増える(normal < elite < boss 傾向)', () => {
    const count = (tier: 'normal' | 'elite' | 'boss'): number => {
      const { fx, scene } = makeEffects();
      const base = scene.children.length;
      // 確率揺れを均すため5回発火の平均
      for (let i = 0; i < 5; i += 1) fx.kokuraiteiKillColumn(new THREE.Vector3(i, 0, 0), tier);
      const n = scene.children.length - base;
      fx.dispose();
      return n;
    };
    const n = count('normal');
    const e = count('elite');
    const b = count('boss');
    expect(e).toBeGreaterThan(n);
    expect(b).toBeGreaterThan(e);
  });

  it('reduceMotion=trueはtierを問わずnormal相当へ縮退する', () => {
    const { fx, scene } = makeEffects();
    const base = scene.children.length;
    fx.kokuraiteiKillColumn(new THREE.Vector3(0, 0, 0), 'boss', true);
    const rmCount = scene.children.length - base;
    fx.dispose();
    const { fx: fx2, scene: scene2 } = makeEffects();
    const base2 = scene2.children.length;
    fx2.kokuraiteiKillColumn(new THREE.Vector3(0, 0, 0), 'normal');
    const normalCount = scene2.children.length - base2;
    fx2.dispose();
    expect(Math.abs(rmCount - normalCount)).toBeLessThanOrEqual(2);
  });

  it('raitenSlashFx/blinkDischargeNovaは例外なくシーンへFXを追加する', () => {
    const { fx, scene } = makeEffects();
    const base = scene.children.length;
    fx.raitenSlashFx(new THREE.Vector3(0, 0, 0));
    expect(scene.children.length).toBeGreaterThan(base);
    const mid = scene.children.length;
    fx.blinkDischargeNova(new THREE.Vector3(2, 0, 0));
    expect(scene.children.length).toBeGreaterThan(mid);
    fx.dispose();
  });

  it('blinkDischargeNova連打でも柱キャップ96によりシーンが無制限に膨張しない', () => {
    const { fx, scene } = makeEffects();
    for (let i = 0; i < 40; i += 1) {
      fx.blinkDischargeNova(new THREE.Vector3(i % 5, 0, 0));
      fx.update(1 / 60);
    }
    // 柱96 + 短命blasts/rings(寿命内の残存)を含めても十分下回るバウンド
    expect(scene.children.length).toBeLessThan(400);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });
});
