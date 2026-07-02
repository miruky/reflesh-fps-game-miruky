import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGunBody } from './viewmodel';
import { WEAPON_DEFS, type ViewModelShape, type WeaponDef } from '../game/weapons';

// 一人称腕は sleeve/glove の固有色で塗られる。銃本体にこれらが混ざっていなければ
// 「腕なし」と判定できる(dark/darker/accent とは別色)。
const SLEEVE_HEX = 0x2b2e34;
const GLOVE_HEX = 0x161820;

function meshCount(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) n += 1;
  });
  return n;
}

function hasArmMaterials(g: THREE.Object3D): boolean {
  let found = false;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mat = o.material as THREE.Material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        const hex = mat.color.getHex();
        if (hex === SLEEVE_HEX || hex === GLOVE_HEX) found = true;
      }
    }
  });
  return found;
}

describe('buildGunBody', () => {
  for (const [id, def] of Object.entries(WEAPON_DEFS)) {
    it(`${id}: Group・子mesh>0・muzzle前方・腕なし`, () => {
      const { gun, muzzle } = buildGunBody(def);
      expect(gun).toBeInstanceOf(THREE.Group);
      expect(meshCount(gun)).toBeGreaterThan(0);
      expect(muzzle.position.z).toBeLessThan(0);
      expect(muzzle.parent).toBe(gun);
      expect(hasArmMaterials(gun)).toBe(false);
    });
  }

  // 全形状が組めること(satisfies で網羅も型チェック)。
  const ALL_SHAPES = {
    rifle: 1,
    carbine: 1,
    bullpup: 1,
    smg: 1,
    pdw: 1,
    'machine-pistol': 1,
    dmr: 1,
    'sniper-bolt': 1,
    'dsr-bp': 1,
    fists: 1,
    'shotgun-pump': 1,
    'shotgun-auto': 1,
    'shotgun-double': 1,
    'lmg-belt': 1,
    'lmg-drum': 1,
    pistol: 1,
    revolver: 1,
  } satisfies Record<ViewModelShape, 1>;

  const base = Object.values(WEAPON_DEFS)[0];
  if (!base) throw new Error('WEAPON_DEFS is empty');

  for (const shape of Object.keys(ALL_SHAPES) as ViewModelShape[]) {
    it(`shape=${shape} が組める`, () => {
      const def: WeaponDef = { ...base, shape };
      const { gun, muzzle } = buildGunBody(def);
      expect(meshCount(gun)).toBeGreaterThan(0);
      expect(muzzle.position.z).toBeLessThan(0);
    });
  }

  it('アタッチメントでマズル原点が前進し、腕は混ざらない', () => {
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    const plain = buildGunBody(ar);
    const suppressed = buildGunBody({ ...ar, attachmentIds: ['suppressor'] });
    expect(suppressed.muzzle.position.z).toBeLessThan(plain.muzzle.position.z);
    expect(hasArmMaterials(suppressed.gun)).toBe(false);
  });
});
