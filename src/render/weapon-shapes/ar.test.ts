// R58 Phase C: AR系9挺の実在シルエット化 契約テスト(ar.ts 専有)。
// 目的: (1)各 ModelKey に固有 painter が登録され固有寸法を持つ(汎用コピー脱却の実測)、
// (2)painter がサイト系ジオメトリ(Plane/Circle/小Sphere)を一切足さない=サイト契約不変、
// (3)光学無=アイアン単ドット(持ち上げ機は Silhouette.sightY / 他は 0.075)で resolveSightY と一致、
// (4)reflex 装着=光学ドット(plane)1個のみ・二重ドット無し・plane.Y=resolveSightY。
// R59 SIGHT-CORE: 遮蔽武器の狙点を sil.sightY で持ち上げ(FAMAS/SG550=ハンドル上 0.152、
// SCAR-H=ハンプ稜上 0.112、HK416/ARX=+0.005、Tavor=ハンプ上 0.09)。期待値は AR_SHAPES.sightY と同期。
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildGunBody, resolveSightY } from '../viewmodel';
import { WEAPON_DEFS } from '../../game/weapons';
import type { WeaponDef } from '../../game/weapons';
import type { Silhouette } from './types';
import { AR_PAINTERS, AR_SHAPES } from './ar';

// 9挺: [weaponId, modelKey, 期待アイアン狙点Y]。持ち上げ機は AR_SHAPES[key].sightY(R59)。
const AR9: Array<[string, string, number]> = [
  ['kaede-ar', 'ar-famas', 0.152],
  ['miyama-br', 'ar-fal', 0.075],
  ['kasasagi-ar', 'ar-scar-h', 0.112],
  ['mukudori-br', 'ar-scar-l', 0.075],
  ['tobikuma-ar', 'ar-hk416', 0.08],
  ['ginyanma-ar', 'ar-mcx', 0.075],
  ['shinonome-ar', 'ar-arx', 0.08],
  ['kagerou-br', 'ar-sg550', 0.152],
  ['akatsuki-ar', 'bullpup', 0.09],
];

function def(id: string): WeaponDef {
  const d = WEAPON_DEFS[id];
  if (!d) throw new Error(`missing weapon ${id}`);
  return { ...d, attachmentIds: [] };
}

// gun 直下の個別 Mesh の照準ジオメトリを数える(バケツ merge 後は 'BufferGeometry' 型なので
// Plane/Circle/小Sphere には混ざらない=painter の外装は下記カウントに現れない)。
function aimGeo(gun: THREE.Object3D): { planes: THREE.Mesh[]; circles: THREE.Mesh[]; microSpheres: THREE.Mesh[] } {
  const planes: THREE.Mesh[] = [];
  const circles: THREE.Mesh[] = [];
  const microSpheres: THREE.Mesh[] = [];
  gun.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.geometry instanceof THREE.PlaneGeometry) planes.push(o);
    else if (o.geometry instanceof THREE.CircleGeometry) circles.push(o);
    else if (o.geometry instanceof THREE.SphereGeometry && o.geometry.parameters.radius <= 0.0022) microSpheres.push(o);
  });
  return { planes, circles, microSpheres };
}

describe('R58 AR系 実在シルエット化', () => {
  it('9挺すべてに固有 painter が登録されている', () => {
    for (const [, key] of AR9) {
      expect(AR_PAINTERS[key as keyof typeof AR_PAINTERS], key).toBeTypeOf('function');
    }
    // 汎用 rifle/carbine には painter を付けない(modelKey 無し武器のフォールバックは素の汎用外装)
    expect(AR_PAINTERS.rifle).toBeUndefined();
    expect(AR_PAINTERS.carbine).toBeUndefined();
  });

  it('固有 ar-* シルエットは汎用 rifle/carbine の逐語コピーではない(実在寸法へ改修済み)', () => {
    const rifle = JSON.stringify(AR_SHAPES.rifle);
    const carbine = JSON.stringify(AR_SHAPES.carbine);
    for (const key of ['ar-famas', 'ar-fal', 'ar-scar-h', 'ar-hk416', 'ar-mcx', 'ar-arx', 'ar-sg550', 'ar-scar-l'] as const) {
      const s = JSON.stringify(AR_SHAPES[key]);
      expect(s, key).not.toBe(rifle);
      expect(s, key).not.toBe(carbine);
    }
  });

  it('FAMAS/SG-512 は carryHandle を立て、狙点がハンドル上端(0.144)より高い(R59: 上から覗く)', () => {
    expect(AR_SHAPES['ar-famas'].carryHandle).toBe('famas');
    expect(AR_SHAPES['ar-sg550'].carryHandle).toBe('ar15');
    expect(AR_SHAPES['ar-famas'].sightY).toBeCloseTo(0.152, 6);
    expect(AR_SHAPES['ar-sg550'].sightY).toBeCloseTo(0.152, 6);
    expect(resolveSightY(def('kaede-ar'))).toBeCloseTo(0.152, 6);
    expect(resolveSightY(def('kagerou-br'))).toBeCloseTo(0.152, 6);
    // ハンドル天面バー(top=0.144)より上=トンネルに遮られない
    expect(resolveSightY(def('kaede-ar'))).toBeGreaterThan(0.144);
  });

  it('光学無=アイアン浮遊ドット1個のみ / painter は Plane/Circle/小Sphere を足さない / Y=resolveSightY', () => {
    for (const [id, , expectY] of AR9) {
      const d = def(id);
      const { gun } = buildGunBody(d);
      const { planes, circles, microSpheres } = aimGeo(gun);
      expect(planes.length, `${id} planes`).toBe(0); // 光学ドット無し
      expect(circles.length, `${id} circles`).toBe(0); // 一体スコープ無し
      expect(microSpheres.length, `${id} microSpheres`).toBe(1); // アイアン単ドット(painter は球を足さない)
      expect(microSpheres[0]!.position.y, `${id} dotY`).toBeCloseTo(expectY, 6);
      expect(resolveSightY(d), `${id} sightY`).toBeCloseTo(expectY, 6);
    }
  });

  it('reflex 装着=光学ドット(plane)1個のみ・二重ドット無し・plane.Y=resolveSightY(持ち上げ機は sil.sightY)', () => {
    // R58 E1後続/R59: 持ち上げ機(sil.sightY)は装着光学も同じ狙点へマウント
    // (遮蔽物の下に光学が潜って不可視になる問題の根治)。他は従来どおり OPTIC_SPECS.reflex=0.08。
    for (const [id, key] of AR9) {
      const d: WeaponDef = { ...def(id), attachmentIds: ['reflex'] };
      const { gun } = buildGunBody(d);
      const { planes, microSpheres } = aimGeo(gun);
      expect(planes.length, `${id} reflex planes`).toBe(1);
      expect(microSpheres.length, `${id} reflex microSpheres`).toBe(0); // アイアン抑止(二重ドット根絶)
      expect(planes[0]!.position.y, `${id} reflex plane Y`).toBeCloseTo(resolveSightY(d), 6);
      const sil: Silhouette = AR_SHAPES[key as keyof typeof AR_SHAPES];
      expect(resolveSightY(d), `${id} reflex sightY`).toBeCloseTo(sil.sightY ?? 0.08, 6);
    }
  });

  it('全9挺が例外なく組め、muzzle 原点は前方(z<0)', () => {
    for (const [id] of AR9) {
      const { gun, muzzle } = buildGunBody(def(id));
      let meshes = 0;
      gun.traverse((o) => { if (o instanceof THREE.Mesh) meshes += 1; });
      expect(meshes, id).toBeGreaterThan(0);
      expect(muzzle.position.z, id).toBeLessThan(0);
    }
  });
});
