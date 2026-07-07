import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGunBody, CamoStandardMaterial, resolveSightY, ViewModel } from './viewmodel';
import { WEAPON_DEFS, type ViewModelShape, type WeaponDef } from '../game/weapons';
import { OPTIC_SPECS, resolveOpticId } from '../game/optics';
import { CAMO_IDS, CAMO_VISUALS } from '../game/camo';

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
    launcher: 1,
    // R33 新shape 8種
    'sniper-semi': 1,
    antimateriel: 1,
    'shuriken-hand': 1,
    'bow-japanese': 1,
    'war-fan': 1,
    musket: 1,
    'lightning-staff': 1,
    minigun: 1,
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

// ── R25 武器カモ: buildGunBody(def, camoId) の材差し替えを検証する ──
describe('武器カモ(buildGunBody)', () => {
  const ar = WEAPON_DEFS['kaede-ar'];
  if (!ar) throw new Error('kaede-ar missing');

  function camoMats(g: THREE.Object3D): CamoStandardMaterial[] {
    const out: CamoStandardMaterial[] = [];
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof CamoStandardMaterial) {
        out.push(o.material);
      }
    });
    return out;
  }

  it('全カモIDで銃が組め、主要バケツにカモ材が載る', () => {
    for (const id of CAMO_IDS) {
      const { gun, muzzle } = buildGunBody(ar, id);
      expect(muzzle.position.z, id).toBeLessThan(0);
      const mats = camoMats(gun);
      expect(mats.length, id).toBeGreaterThan(0);
      for (const m of mats) expect(m.camoVisualId, id).toBe(id);
    }
  });

  it('ゴールドは金属金(metalness 1.0)+微発光、ダイヤは強スペキュラ', () => {
    const gold = camoMats(buildGunBody(ar, 'gold').gun)[0];
    expect(gold).toBeDefined();
    expect(gold!.metalness).toBe(1.0);
    expect(gold!.emissiveIntensity).toBeGreaterThan(0);
    const dia = camoMats(buildGunBody(ar, 'diamond').gun)[0];
    expect(dia!.roughness).toBeLessThanOrEqual(0.2);
  });

  it('camoId=null/不正ID/プロファイル無しはカモ材を使わない', () => {
    expect(camoMats(buildGunBody(ar, null).gun)).toHaveLength(0);
    expect(camoMats(buildGunBody(ar, 'rainbow').gun)).toHaveLength(0);
    // 省略時はプロファイル解決(テスト環境=保存なし)で素の質感
    expect(camoMats(buildGunBody(ar).gun)).toHaveLength(0);
  });

  it('カモ適用でも研磨(polish)系の素材は素のまま残る(コントラスト維持)', () => {
    const { gun } = buildGunBody(ar, 'gold');
    let polish = 0;
    gun.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material;
      if (
        m instanceof THREE.MeshStandardMaterial &&
        !(m instanceof CamoStandardMaterial) &&
        m.vertexColors &&
        m.metalness >= 0.85
      ) {
        polish += 1;
      }
    });
    expect(polish).toBeGreaterThan(0);
  });

  it('カモ材は clone してもカモであり続ける(ARMORYプレビューの複製経路)', () => {
    const mat = camoMats(buildGunBody(ar, 'dark-matter').gun)[0];
    expect(mat).toBeDefined();
    const cloned = mat!.clone();
    expect(cloned).toBeInstanceOf(CamoStandardMaterial);
    expect(cloned.camoVisualId).toBe('dark-matter');
    expect(cloned.customProgramCacheKey()).toBe(mat!.customProgramCacheKey());
    expect(cloned.metalness).toBe(CAMO_VISUALS['dark-matter'].metalness);
    cloned.dispose();
  });

  it('カモ適用は照準ジオメトリ(reflexドット/レンズ)に触れない', () => {
    const def: WeaponDef = { ...ar, attachmentIds: ['reflex'] };
    let dotY = Number.NaN;
    buildGunBody(def, 'gold').gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'PlaneGeometry' && Number.isNaN(dotY)) {
        dotY = o.position.y;
      }
    });
    expect(dotY).toBeCloseTo(resolveSightY(def), 6);
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
    // F1: sniper-semi/antimateriel 内蔵スコープ
    expect(resolveSightY(withShape('sniper-semi'))).toBeCloseTo(0.086, 6);
    expect(resolveSightY(withShape('antimateriel'))).toBeCloseTo(0.092, 6);
    // F4/F10/F11: 特殊形状は射線中心(0)
    expect(resolveSightY(withShape('minigun'))).toBe(0);
    expect(resolveSightY(withShape('lightning-staff'))).toBe(0);
    expect(resolveSightY(withShape('bow-japanese'))).toBe(0);
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

  it('着脱光学の各 housing が組め、ADS収束Yが OPTIC_SPECS.sightY と一致する', () => {
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    for (const id of ['reflex', 'holographic', 'delta', 'pico', 'canted', 'acog', 'variable', 'thermal', 'hybrid'] as const) {
      const def: WeaponDef = { ...ar, attachmentIds: [id] };
      const { gun, muzzle } = buildGunBody(def);
      expect(meshCount(gun), id).toBeGreaterThan(0);
      expect(muzzle.position.z, id).toBeLessThan(0);
      expect(hasArmMaterials(gun), id).toBe(false);
      // resolveOpticId が付与光学を解決し、resolveSightY が sightY を返す
      expect(resolveOpticId(def), id).toBe(id);
      expect(resolveSightY(def), id).toBeCloseTo(OPTIC_SPECS[id]!.sightY, 6);
    }
  });

  it('着脱reflex のドット(plane)は依然として最初かつ 0.08 面(倍増後も不変)', () => {
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    const { gun } = buildGunBody({ ...ar, attachmentIds: ['reflex'] });
    let dotY = Number.NaN;
    gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'PlaneGeometry' && Number.isNaN(dotY)) {
        dotY = o.position.y;
      }
    });
    expect(dotY).toBeCloseTo(0.08, 6);
  });

  it('F1: sniper-semi/antimateriel はscope-sniper-semi/scope-antimaterielへ解決される', () => {
    const base = Object.values(WEAPON_DEFS)[0]!;
    const sniperSemi: WeaponDef = { ...base, shape: 'sniper-semi' };
    const anti: WeaponDef = { ...base, shape: 'antimateriel' };
    expect(resolveOpticId(sniperSemi)).toBe('scope-sniper-semi');
    expect(resolveOpticId(anti)).toBe('scope-antimateriel');
    expect(OPTIC_SPECS['scope-sniper-semi']!.sightY).toBeCloseTo(0.086, 6);
    expect(OPTIC_SPECS['scope-antimateriel']!.sightY).toBeCloseTo(0.092, 6);
  });

  it('内蔵スコープ機(DMR/sniper/DSR)はレンズCircleを持ち、resolveSightYと一致する', () => {
    for (const [shape, expected] of [
      ['dmr', 0.085],
      ['sniper-bolt', 0.08],
      ['dsr-bp', 0.092],
    ] as const) {
      const base = Object.values(WEAPON_DEFS)[0]!;
      const def: WeaponDef = { ...base, shape };
      const { gun } = buildGunBody(def);
      let glassY = Number.NaN;
      gun.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry.type === 'CircleGeometry' && Number.isNaN(glassY)) {
          glassY = o.position.y;
        }
      });
      expect(Number.isNaN(glassY), shape).toBe(false);
      expect(glassY, shape).toBeCloseTo(expected, 6);
      expect(resolveSightY(def), shape).toBeCloseTo(expected, 6);
    }
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

// ── R34 setExoticCharge API テスト ────────────────────────────────────────
describe('setExoticCharge', () => {
  const EXOTIC_IDS = [
    'banjin-smg',
    'gekkou-bow',
    'fujin-fan',
    'gouen-musket',
    'tenrai-staff',
    'shinkirou-sniper',
    'shura-lmg',
  ] as const;

  it('setExoticCharge: 7武器すべてで例外なし (charge01=0)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    for (const id of EXOTIC_IDS) {
      const def = WEAPON_DEFS[id];
      if (!def) continue;
      vm.setWeapon(def);
      expect(() => vm.setExoticCharge(id, 0)).not.toThrow();
    }
  });

  it('setExoticCharge: 7武器すべてで例外なし (charge01=1)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    for (const id of EXOTIC_IDS) {
      const def = WEAPON_DEFS[id];
      if (!def) continue;
      vm.setWeapon(def);
      expect(() => vm.setExoticCharge(id, 1)).not.toThrow();
    }
  });

  it('setExoticCharge: charge01 がクランプされる (範囲外値で例外なし)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['gekkou-bow'];
    if (def) {
      vm.setWeapon(def);
      expect(() => vm.setExoticCharge('gekkou-bow', -1)).not.toThrow();
      expect(() => vm.setExoticCharge('gekkou-bow', 2)).not.toThrow();
    }
  });

  it('setExoticCharge: 未知 weaponId で例外なし', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    expect(() => vm.setExoticCharge('unknown-weapon', 0.5)).not.toThrow();
  });

  it('setExoticCharge: gun が null の状態(武器未設定)でも例外なし', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    expect(() => vm.setExoticCharge('gouen-musket', 0.5)).not.toThrow();
  });

  it('fujin-fan: vm:fanRib ノードに fanBaseAngle が設定されている', () => {
    const def = WEAPON_DEFS['fujin-fan'];
    if (!def) return;
    const { gun } = buildGunBody(def);
    const ribs: THREE.Object3D[] = [];
    gun.traverse((child) => {
      if (child.name === 'vm:fanRib') ribs.push(child);
    });
    expect(ribs.length).toBeGreaterThan(0);
    for (const rib of ribs) {
      expect(typeof rib.userData.fanBaseAngle).toBe('number');
    }
  });

  it('banjin-smg: vm:shurikenBlade ノードが存在する', () => {
    const def = WEAPON_DEFS['banjin-smg'];
    if (!def) return;
    const { gun } = buildGunBody(def);
    const blades: THREE.Object3D[] = [];
    gun.traverse((child) => {
      if (child.name === 'vm:shurikenBlade') blades.push(child);
    });
    expect(blades.length).toBeGreaterThan(0);
  });

  it('tenrai-staff: vm:crystal ノードが存在する', () => {
    const def = WEAPON_DEFS['tenrai-staff'];
    if (!def) return;
    const { gun } = buildGunBody(def);
    const crystals: THREE.Object3D[] = [];
    gun.traverse((child) => {
      if (child.name === 'vm:crystal') crystals.push(child);
    });
    expect(crystals.length).toBeGreaterThan(0);
  });
});
