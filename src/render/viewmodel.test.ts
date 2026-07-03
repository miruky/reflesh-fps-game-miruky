import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGunBody, resolveSightY } from './viewmodel';
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

// resolveSightY は ADS 収束 Y(=-adsY)を武器ごとに決める純関数。buildGunBody のサイト
// 焼き座標の鏡写しなので、(1)形状別の契約値、(2)実ジオメトリとの一致 の両面を検証する。
describe('resolveSightY', () => {
  const base = Object.values(WEAPON_DEFS)[0];
  if (!base) throw new Error('WEAPON_DEFS is empty');
  const withShape = (shape: ViewModelShape, attachmentIds: string[] = []): WeaponDef => ({
    ...base,
    shape,
    attachmentIds,
  });

  it('形状別のサイト高さ(契約値)を返す', () => {
    expect(resolveSightY(withShape('fists'))).toBe(0);
    expect(resolveSightY(withShape('rifle'))).toBeCloseTo(0.062, 6); // アイアン前ポスト
    expect(resolveSightY(withShape('pistol'))).toBeCloseTo(0.062, 6);
    expect(resolveSightY(withShape('shotgun-pump'))).toBeCloseTo(0.012 + 0.04 * 0.6, 6); // ビード
    expect(resolveSightY(withShape('shotgun-double'))).toBeCloseTo(0.012 + 0.038 * 0.6, 6);
    expect(resolveSightY(withShape('dmr'))).toBeCloseTo(0.085, 6); // 一体型スコープ
    expect(resolveSightY(withShape('sniper-bolt'))).toBeCloseTo(0.08, 6);
    expect(resolveSightY(withShape('dsr-bp'))).toBeCloseTo(0.092, 6);
    expect(resolveSightY(withShape('rifle', ['reflex']))).toBeCloseTo(0.08, 6);
    expect(resolveSightY(withShape('rifle', ['telescopic']))).toBeCloseTo(0.08, 6);
  });

  it('スコープ管(glass)の実Yと一致する(ドリフト検出)', () => {
    const def = withShape('sniper-bolt');
    const { gun } = buildGunBody(def);
    let glassY = Number.NaN;
    gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'CircleGeometry' && Number.isNaN(glassY)) {
        glassY = o.position.y;
      }
    });
    expect(Number.isNaN(glassY)).toBe(false);
    expect(glassY).toBeCloseTo(resolveSightY(def), 6);
  });

  it('レフレックスドット(plane)の実Yと一致する(ドリフト検出)', () => {
    const def = withShape('rifle', ['reflex']);
    const { gun } = buildGunBody(def);
    let dotY = Number.NaN;
    gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'PlaneGeometry' && Number.isNaN(dotY)) {
        dotY = o.position.y;
      }
    });
    expect(Number.isNaN(dotY)).toBe(false);
    expect(dotY).toBeCloseTo(resolveSightY(def), 6);
  });

  it('アイアンビード球の実Yと一致する(ドリフト検出)', () => {
    // class を shotgun に合わせる(base の 'ar' のままだと AR 用リアチャージングハンドルが
    // polish 系に載り、ビードより高い頂点が混ざって最上クラスタ判定を汚すため)。
    const def: WeaponDef = { ...base, shape: 'shotgun-pump', class: 'shotgun', attachmentIds: [] };
    const { gun } = buildGunBody(def);
    // 研磨(polish)系メッシュ = vertexColors かつ metalness≈0.9。ビードは polish の最上クラスタ。
    const pts: THREE.Vector3[] = [];
    gun.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = o.material;
      if (!(mat instanceof THREE.MeshStandardMaterial) || !mat.vertexColors || mat.metalness < 0.85) {
        return;
      }
      const p = o.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 1) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    });
    expect(pts.length).toBeGreaterThan(0);
    // 最上頂点の近傍(半径0.013>ビード直径0.012)クラスタ=ビード球のみ。bbox中点=球中心Y。
    let top = pts[0];
    if (!top) throw new Error('no polish vertices');
    for (const v of pts) if (v.y > top.y) top = v;
    const anchor = top;
    const near = pts.filter((v) => v.distanceTo(anchor) < 0.013);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of near) {
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    expect((minY + maxY) / 2).toBeCloseTo(resolveSightY(def), 3);
  });
});
