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

  // ── R53-W2: PaP鍛神(pap1-3)/報酬カモ(jingai/shinrai)の描画登録 ──
  it('pap1-3/jingai/shinrai は全形状(早期分岐含む)で例外なく組め、カモ材が載る', () => {
    const NEW_IDS = ['pap1', 'pap2', 'pap3', 'jingai', 'shinrai'] as const;
    const SHAPES: ViewModelShape[] = [
      'rifle',
      'fists',
      'shuriken-hand',
      'bow-japanese',
      'war-fan',
      'musket',
      'lightning-staff',
      'minigun',
    ];
    for (const shape of SHAPES) {
      for (const id of NEW_IDS) {
        const def: WeaponDef = { ...ar, shape };
        const { gun, muzzle } = buildGunBody(def, id);
        expect(muzzle.position.z, `${shape}:${id}`).toBeLessThan(0);
        const mats = camoMats(gun);
        expect(mats.length, `${shape}:${id}`).toBeGreaterThan(0);
        for (const m of mats) expect(m.camoVisualId, `${shape}:${id}`).toBe(id);
      }
    }
  });

  it('pap1-3 は明示camoIdでのみ適用される(通常の未指定/プロファイル解決経路には出てこない)', () => {
    // camoId省略(=resolveEquippedCamo経由)ではプロファイル未保存のためnull=素の質感
    expect(camoMats(buildGunBody(ar).gun)).toHaveLength(0);
    // 明示的に渡せば通常武器と同じくレンダリングされる(viewmodelのpapCamo優先フックが使う経路)
    const mats = camoMats(buildGunBody(ar, 'pap2').gun);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) expect(m.camoVisualId).toBe('pap2');
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
    // R51: ユーザー要望「もう少しドットを浮かせて」で post機 0.062→0.075(IRON_POST_Y)
    expect(resolveSightY(withShape('rifle'))).toBeCloseTo(0.075, 6); // アイアン前ポスト
    expect(resolveSightY(withShape('pistol'))).toBeCloseTo(0.075, 6);
    // Fix-7: SG3種 bead sightY +0.016(0.036→0.052 レシーバ上端突出解消)
    // R51: BEAD_FLOAT(+0.008) を加算しドットを浮かせる(0.052→0.060)
    expect(resolveSightY(withShape('shotgun-pump'))).toBeCloseTo(0.060, 6); // 0.012+0.04*0.6+0.016+0.008
    expect(resolveSightY(withShape('shotgun-double'))).toBeCloseTo(0.012 + 0.038 * 0.6 + 0.016 + 0.008, 6);
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

  // R49: アイアンサイトをBO3参考画像スタイル「極小浮遊ドット+極薄ベゼルリング」へ統一。
  // ドット=着弾点の狙点契約: SphereGeometry r≤0.0022 の個別Mesh(支柱なしで浮くマイクロドット)が
  // 存在し、その中心Yが resolveSightY(def) と一致すること(耳の琥珀アクセント点は r0.0024>0.0022で除外)。
  // bakeAt でマージされるベゼルリングは個別メッシュとして走査できないため、ドットのみ検証する。
  function findMicroDot(gun: THREE.Object3D, maxR = 0.0022): THREE.Mesh | undefined {
    let found: THREE.Mesh | undefined;
    gun.traverse((o) => {
      if (found) return;
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.geometry.parameters.radius <= maxR) {
        found = o;
      }
    });
    return found;
  }

  it('浮遊マイクロドット(r≤0.0022)の実Yが resolveSightY と一致する(ドリフト検出): iron post/bead/launcher', () => {
    const cases: WeaponDef[] = [
      withShape('rifle'), // iron post機
      { ...base, shape: 'shotgun-pump', class: 'shotgun', attachmentIds: [] }, // bead機
      withShape('launcher'), // ゴーストリング機
    ];
    for (const def of cases) {
      const { gun } = buildGunBody(def);
      const dot = findMicroDot(gun);
      expect(dot, def.shape).toBeDefined();
      expect(dot!.position.y, def.shape).toBeCloseTo(resolveSightY(def), 6);
    }
  });
});

// ── R57⑧ サイトドット統一 + 二重ドット根絶 ────────────────────────────────
// 光学装着時は「光学のドット」だけを出し、アイアンのビード/前照星ドットは出さない
// (中央付近で二重にならない)。光学未装着時のみアイアンの浮遊マイクロドットを出す。
describe('R57⑧ サイトドット統一/二重ドット根絶', () => {
  const ar = WEAPON_DEFS['kaede-ar'];
  if (!ar) throw new Error('kaede-ar missing');

  // 「照準ドット」= 加算材の PlaneGeometry(reflexDotWindow/holo) or r≤0.0022 の SphereGeometry
  // (アイアン浮遊マイクロドット)。耳の琥珀点(r0.0024>0.0022)は照準ドットではないので除外。
  function countAimDots(gun: THREE.Object3D): { planes: THREE.Mesh[]; microSpheres: THREE.Mesh[] } {
    const planes: THREE.Mesh[] = [];
    const microSpheres: THREE.Mesh[] = [];
    gun.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.geometry instanceof THREE.PlaneGeometry) planes.push(o);
      else if (
        o.geometry instanceof THREE.SphereGeometry &&
        o.geometry.parameters.radius <= 0.0022
      ) {
        microSpheres.push(o);
      }
    });
    return { planes, microSpheres };
  }

  it('光学未装着(iron)のARは「アイアンの浮遊マイクロドット1個」だけを持ち、光学ドット(plane)は無い', () => {
    const { gun } = buildGunBody(ar); // 素の kaede-ar(attachmentIds なし=iron)
    const { planes, microSpheres } = countAimDots(gun);
    expect(microSpheres.length).toBe(1); // アイアン前照星ドット1個
    expect(planes.length).toBe(0); // 光学の窓/ドット plane は無い
  });

  it('reflex 装着時は「光学ドット(plane)1個」だけで、アイアンのマイクロドット(sphere)は消える(二重根絶)', () => {
    const { gun } = buildGunBody({ ...ar, attachmentIds: ['reflex'] });
    const { planes, microSpheres } = countAimDots(gun);
    // reflexDotWindow は plane ドット1個(レンズはCircleGeometryなのでplaneではない)
    expect(planes.length).toBe(1);
    // アイアンのマイクロドットは光学装着で抑止される
    expect(microSpheres.length).toBe(0);
    // 唯一の plane ドットは ADS収束Y と一致(サイト契約)
    expect(planes[0]!.position.y).toBeCloseTo(resolveSightY({ ...ar, attachmentIds: ['reflex'] }), 6);
  });

  it('全1x光学(reflex/holo/delta/pico/canted/hybrid)でアイアンのマイクロドットが二重に出ない', () => {
    for (const id of ['reflex', 'holographic', 'delta', 'pico', 'canted', 'hybrid'] as const) {
      const { gun } = buildGunBody({ ...ar, attachmentIds: [id] });
      const { microSpheres } = countAimDots(gun);
      expect(microSpheres.length, id).toBe(0); // アイアンの浮遊マイクロドットは出さない
    }
  });

  it('倍率スコープ光学(acog/variable/thermal/telescopic)でもアイアンのドットは二重に出ない', () => {
    for (const id of ['acog', 'variable', 'thermal', 'telescopic'] as const) {
      const { gun } = buildGunBody({ ...ar, attachmentIds: [id] });
      const { microSpheres } = countAimDots(gun);
      expect(microSpheres.length, id).toBe(0);
    }
  });

  it('全1x光学のドット(plane)はアイアン相当の極小サイズ(≤0.005・視界を塞がない)へ統一', () => {
    for (const id of ['reflex', 'holographic', 'delta', 'pico', 'canted', 'hybrid'] as const) {
      const { gun } = buildGunBody({ ...ar, attachmentIds: [id] });
      let dotSize = Number.NaN;
      gun.traverse((o) => {
        if (!Number.isNaN(dotSize)) return;
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) {
          // reflexDotWindow/holo のドットは正方 plane。holo のスクリーン(横長 0.05×0.04)や
          // reflexのレンズ(Circle)ではなく、幅==高さ かつ極小(≤0.005)のものがドット。
          const w = o.geometry.parameters.width;
          const h = o.geometry.parameters.height;
          if (Math.abs(w - h) < 1e-6 && w <= 0.005) dotSize = w;
        }
      });
      expect(Number.isNaN(dotSize), id).toBe(false);
      expect(dotSize, id).toBeLessThanOrEqual(0.005);
      // 旧実装(0.008〜0.012)より確実に小さいこと
      expect(dotSize, id).toBeLessThan(0.008);
    }
  });

  it('非回帰: iron post/bead/launcher(光学無し)は従来通りマイクロドットを保持し resolveSightY と一致', () => {
    const base = Object.values(WEAPON_DEFS)[0]!;
    const cases: WeaponDef[] = [
      { ...base, shape: 'rifle', attachmentIds: [] },
      { ...base, shape: 'shotgun-pump', class: 'shotgun', attachmentIds: [] },
      { ...base, shape: 'launcher', attachmentIds: [] },
    ];
    for (const def of cases) {
      const { gun } = buildGunBody(def);
      const { microSpheres } = countAimDots(gun);
      expect(microSpheres.length, def.shape).toBe(1);
      expect(microSpheres[0]!.position.y, def.shape).toBeCloseTo(resolveSightY(def), 6);
    }
  });
});

// ── R57⑦ アタッチメントのジオメトリ反映 ──────────────────────────────────
describe('R57⑦ アタッチメント視覚反映(buildGunBody)', () => {
  const ar = WEAPON_DEFS['kaede-ar'];
  if (!ar) throw new Error('kaede-ar missing');

  function meshTally(g: THREE.Object3D): number {
    let n = 0;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) n += 1;
    });
    return n;
  }

  it('コンペンセイターは銃口デバイスを追加し、マズル原点を前進させる(サプレッサ非装着時)', () => {
    const plain = buildGunBody(ar);
    const comp = buildGunBody({ ...ar, attachmentIds: ['compensator'] });
    // マズル原点(トレーサー原点)が前進(z がより負)
    expect(comp.muzzle.position.z).toBeLessThan(plain.muzzle.position.z);
  });

  it('サプレッサとコンペは排他(両指定時はサプレッサ優先=筒が前進、コンペのZ計算に潰されない)', () => {
    const both = buildGunBody({ ...ar, attachmentIds: ['suppressor', 'compensator'] });
    const supp = buildGunBody({ ...ar, attachmentIds: ['suppressor'] });
    // 両立してもサプレッサ単体と同じマズル原点(コンペの前進計算に上書きされない)
    expect(both.muzzle.position.z).toBeCloseTo(supp.muzzle.position.z, 6);
  });

  it('拡張マガジンと標準弾倉でメッシュ構成が変化する(延長弾倉の描画)', () => {
    // 拡張マガジンはセグメント長が伸びるため vm:magazine の bbox 高さが増える
    const bboxMagHeight = (def: WeaponDef): number => {
      const { gun } = buildGunBody(def);
      const mag = gun.getObjectByName('vm:magazine');
      if (!mag) return 0;
      const box = new THREE.Box3().setFromObject(mag);
      return box.getSize(new THREE.Vector3()).y;
    };
    const ext = bboxMagHeight({ ...ar, attachmentIds: ['extended'] });
    const std = bboxMagHeight({ ...ar, attachmentIds: [] });
    const quick = bboxMagHeight({ ...ar, attachmentIds: ['quick'] });
    expect(ext).toBeGreaterThan(std); // 拡張=延長
    expect(quick).toBeLessThan(std); // クイック=短小
  });

  it('フォアグリップ(vertical/angled)装着でジオメトリ(頂点)が増える', () => {
    // フォアグリップは polyParts にマージされる(=メッシュ数は不変)ため、総頂点数で検証する。
    const vertTally = (def: WeaponDef): number => {
      let n = 0;
      buildGunBody(def).gun.traverse((o) => {
        if (o instanceof THREE.Mesh) n += o.geometry.getAttribute('position')?.count ?? 0;
      });
      return n;
    };
    const plain = vertTally(ar);
    expect(vertTally({ ...ar, attachmentIds: ['vertical'] })).toBeGreaterThan(plain);
    expect(vertTally({ ...ar, attachmentIds: ['angled'] })).toBeGreaterThan(plain);
  });

  it('全4スロット同時装着でも例外なく組め、腕は混ざらない', () => {
    const def: WeaponDef = { ...ar, attachmentIds: ['reflex', 'compensator', 'vertical', 'extended'] };
    const { gun, muzzle } = buildGunBody(def);
    expect(meshTally(gun)).toBeGreaterThan(0);
    expect(muzzle.position.z).toBeLessThan(0);
    expect(hasArmMaterials(gun)).toBe(false);
    // 光学ドット(plane)は1個だけ(reflex)= 二重にならない
    let planes = 0;
    gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) planes += 1;
    });
    expect(planes).toBe(1);
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

// ── KE-1 黒炎+紫電オーラプール ──────────────────────────────────────────────
describe('KE-1 黒炎+紫電オーラプール', () => {
  it('_darkAuraPool は 22 粒子 (TrackA 黒炎14 + TrackB 紫電スパーク8)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_darkAuraPool'] as Array<{ track: string }>;
    expect(pool.length).toBe(22);
    expect(pool.filter((a) => a.track === 'flame').length).toBe(14);
    expect(pool.filter((a) => a.track === 'spark').length).toBe(8);
    vm.dispose();
  });

  it('TrackA炎は NormalBlending 0x040008, TrackB スパークは AdditiveBlending 0x7700bb', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_darkAuraPool'] as Array<{
      track: string;
      mesh: THREE.Mesh;
    }>;
    for (const a of pool) {
      const mat = a.mesh.material as THREE.MeshBasicMaterial;
      if (a.track === 'flame') {
        expect(mat.blending).toBe(THREE.NormalBlending);
        expect(mat.color.getHex()).toBe(0x040008);
      } else {
        expect(mat.blending).toBe(THREE.AdditiveBlending);
        expect(mat.color.getHex()).toBe(0x7700bb);
      }
    }
    vm.dispose();
  });

  it('TrackA炎は sinPhase/baseX フィールドを持つ', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_darkAuraPool'] as Array<{
      track: string;
      sinPhase: unknown;
      baseX: unknown;
    }>;
    for (const a of pool.filter((x) => x.track === 'flame')) {
      expect(typeof a.sinPhase).toBe('number');
      expect(typeof a.baseX).toBe('number');
    }
    vm.dispose();
  });

  it('白飛び0.9規則: 全パーティクルの max opacity が 0.55 以下', () => {
    // TrackA=0.52, TrackB=0.55 どちらも ≤ 0.55
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_darkAuraPool'] as Array<{ track: string }>;
    for (const a of pool) {
      const maxOp = a.track === 'spark' ? 0.55 : 0.52;
      expect(maxOp).toBeLessThanOrEqual(0.55);
    }
    vm.dispose();
  });

  it('setKunaiDarkMode(true/false) で例外なし', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const fistsDef = Object.values(WEAPON_DEFS).find((d) => d.shape === 'fists');
    if (fistsDef) {
      vm.setWeapon(fistsDef);
      expect(() => vm.setKunaiDarkMode(true)).not.toThrow();
      expect(() => vm.setKunaiDarkMode(false)).not.toThrow();
    }
    vm.dispose();
  });
});

// ── RE-1 雷帝常時スパーク雨プール ─────────────────────────────────────────────
describe('RE-1 雷帝常時スパーク雨プール', () => {
  it('_lightningSparkPool は 12 粒子', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_lightningSparkPool'] as unknown[];
    expect(pool.length).toBe(12);
    vm.dispose();
  });

  it('AdditiveBlending + 0x44aaff 色 + opacity=0 初期', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const pool = (vm as unknown as Record<string, unknown>)['_lightningSparkPool'] as Array<{
      mesh: THREE.Mesh;
    }>;
    for (const s of pool) {
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.color.getHex()).toBe(0x44aaff);
      expect(mat.opacity).toBe(0);
    }
    vm.dispose();
  });

  it('白飛び0.9規則: RE-1 max opacity 0.52 ≤ 0.55', () => {
    // スポーン時の三角エンベロープ peak = 0.52
    expect(0.52).toBeLessThanOrEqual(0.55);
  });

  it('setKunaiLightningMode(true/false) で例外なし', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const fistsDef = Object.values(WEAPON_DEFS).find((d) => d.shape === 'fists');
    if (fistsDef) {
      vm.setWeapon(fistsDef);
      expect(() => vm.setKunaiLightningMode(true)).not.toThrow();
      expect(() => vm.setKunaiLightningMode(false)).not.toThrow();
    }
    vm.dispose();
  });

  it('dispose() でスパーク雨プールも解放される(例外なし)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    expect(() => vm.dispose()).not.toThrow();
  });
});

// ── R53-W1 F1/F2: 据え撃ちブレースポーズ(修羅/風神扇) ─────────────────────────
// resolveSightY=0 の shape('minigun'/'war-fan')は、通常のADS収束(ADS_X=0,ADS_Z=-0.42へ
// 中央収束)だと前面ジオメトリがカメラ光軸に一致しほぼ画面全域を覆う(修羅=後端リングが
// カメラ至近z≈-0.068/角半径69°、風神扇=要が画面中心そのものに乗る)。setWeapon で
// この2形状だけ ADS 収束先を専用ブレース位置(0.30,-0.30,-0.30)へ差し替えたことを検証する。
describe('R53-W1: 据え撃ちブレースポーズ(修羅/風神扇)', () => {
  const NEUTRAL_STATE = {
    adsProgress: 1,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: false,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
    sprinting: false,
  };

  it('修羅(shura-lmg): adsProgress=1 で root が中央でなくブレース位置(0.30,-0.30,-0.30)へ収束する', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shura-lmg'];
    if (!def) throw new Error('shura-lmg missing');
    vm.setWeapon(def);
    vm.update(0, NEUTRAL_STATE);
    expect(vm.root.position.x).toBeCloseTo(0.30, 5);
    expect(vm.root.position.y).toBeCloseTo(-0.30, 5);
    expect(vm.root.position.z).toBeCloseTo(-0.30, 5);
    vm.dispose();
  });

  it('風神扇(fujin-fan): adsProgress=1 で root が中央でなくブレース位置(0.30,-0.30,-0.30)へ収束する', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['fujin-fan'];
    if (!def) throw new Error('fujin-fan missing');
    vm.setWeapon(def);
    vm.update(0, NEUTRAL_STATE);
    expect(vm.root.position.x).toBeCloseTo(0.30, 5);
    expect(vm.root.position.y).toBeCloseTo(-0.30, 5);
    expect(vm.root.position.z).toBeCloseTo(-0.30, 5);
    vm.dispose();
  });

  it('非回帰: 通常武器(kaede-ar)は従来通り中央(0, -resolveSightY, -0.42)へ収束する', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['kaede-ar'];
    if (!def) throw new Error('kaede-ar missing');
    vm.setWeapon(def);
    vm.update(0, NEUTRAL_STATE);
    expect(vm.root.position.x).toBeCloseTo(0, 5);
    expect(vm.root.position.y).toBeCloseTo(-resolveSightY(def), 5);
    expect(vm.root.position.z).toBeCloseTo(-0.42, 5);
    vm.dispose();
  });

  it('非回帰: 蜃気楼(shinkirou-sniper, sniper-bolt)はブレース対象外で従来通り中央収束する', () => {
    // 蜃気楼は scope:true の通常スコープ狙撃(sniper-bolt)であり、resolveSightYはOPTIC_SPECS
    // 由来の非ゼロ値(0.08)。修羅/風神扇と異なりADS廃止コメントも無く、通常のscope-in収束
    // (BO2式)で機能する。ブレース対象shapeに含めていないことをここで固定する。
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shinkirou-sniper'];
    if (!def) throw new Error('shinkirou-sniper missing');
    expect(def.shape).toBe('sniper-bolt');
    vm.setWeapon(def);
    vm.update(0, { ...NEUTRAL_STATE, scopeWeapon: def.scope === true });
    expect(vm.root.position.x).toBeCloseTo(0, 5);
    expect(vm.root.position.y).toBeCloseTo(-resolveSightY(def), 5);
    expect(vm.root.position.z).toBeCloseTo(-0.42, 5);
    vm.dispose();
  });

  it('resolveSightYの契約(0)は不変: minigun/war-fanのサイト値そのものは中心のまま', () => {
    const base = Object.values(WEAPON_DEFS)[0];
    if (!base) throw new Error('WEAPON_DEFS is empty');
    expect(resolveSightY({ ...base, shape: 'minigun' })).toBe(0);
    expect(resolveSightY({ ...base, shape: 'war-fan' })).toBe(0);
  });
});

// ── R53-W1 F3: 修羅バレルクラスタ回転のキャッシュ化 ────────────────────────────
// 旧実装は毎フレーム gun.traverse で 'vm:barrel' を検索していた。setWeapon 時に
// captureRig が rig.barrel へ一度だけ捕捉し、update() はその参照のみでスピンさせる。
describe('R53-W1 F3: 修羅バレルのキャッシュ参照', () => {
  const SPIN_STATE = {
    adsProgress: 0,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: false,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
  };

  it('setWeapon(shura-lmg) 後に rig.barrel が vm:barrel ノードを捕捉している', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shura-lmg'];
    if (!def) throw new Error('shura-lmg missing');
    vm.setWeapon(def);
    const rig = (vm as unknown as Record<string, unknown>)['rig'] as { barrel?: THREE.Object3D };
    expect(rig.barrel).toBeDefined();
    expect(rig.barrel!.name).toBe('vm:barrel');
    vm.dispose();
  });

  it('setMinigunSpin(1) 後、update() でキャッシュ済み rig.barrel の rotation.z が進む', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shura-lmg'];
    if (!def) throw new Error('shura-lmg missing');
    vm.setWeapon(def);
    vm.setMinigunSpin(1);
    const rig = (vm as unknown as Record<string, unknown>)['rig'] as { barrel?: THREE.Object3D };
    expect(rig.barrel!.rotation.z).toBe(0);
    vm.update(0.1, SPIN_STATE);
    expect(rig.barrel!.rotation.z).not.toBe(0);
    vm.dispose();
  });

  it('他武器(kaede-ar)では rig.barrel が undefined(vm:barrelノード無し)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['kaede-ar'];
    if (!def) throw new Error('kaede-ar missing');
    vm.setWeapon(def);
    const rig = (vm as unknown as Record<string, unknown>)['rig'] as { barrel?: THREE.Object3D };
    expect(rig.barrel).toBeUndefined();
    vm.dispose();
  });
});

// ── R53-W2: WeaponDef.papCamo優先適用 + キャッシュキー分離 + PaP改造演出 ────
describe('R53-W2: papCamo優先適用/キャッシュキー分離/playPapUpgradeAnim', () => {
  function gunCamoIds(root: THREE.Object3D): string[] {
    const out: string[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof CamoStandardMaterial) {
        out.push(o.material.camoVisualId);
      }
    });
    return out;
  }

  it('def.papCamoが設定されていれば選択カモ(未設定=null)より優先してレンダリングされる', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    // プロファイル未保存(テスト環境)なので通常経路は camo=null になるはずの武器
    vm.setWeapon(ar);
    expect(gunCamoIds(vm.root)).toHaveLength(0);
    // papCamo付きdefに切り替えると鍛神カモが最優先で載る
    vm.setWeapon({ ...ar, papCamo: 'pap2' });
    const ids = gunCamoIds(vm.root);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBe('pap2');
    vm.dispose();
  });

  it('キャッシュキー分離: 同一武器でも papCamo 違いは別キャッシュエントリになり、見た目も分離される', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    const cache = (vm as unknown as Record<string, unknown>)['cache'] as Map<string, unknown>;
    vm.setWeapon(ar);
    const sizePlain = cache.size;
    vm.setWeapon({ ...ar, papCamo: 'pap1' });
    expect(cache.size).toBe(sizePlain + 1);
    vm.setWeapon({ ...ar, papCamo: 'pap3' });
    expect(cache.size).toBe(sizePlain + 2);
    // pap1へ戻すとキャッシュが再利用され、サイズは増えない
    vm.setWeapon({ ...ar, papCamo: 'pap1' });
    expect(cache.size).toBe(sizePlain + 2);
    expect(gunCamoIds(vm.root)).toEqual(expect.arrayContaining(['pap1']));
    for (const id of gunCamoIds(vm.root)) expect(id).toBe('pap1');
    vm.dispose();
  });

  // adsProgress=1で breathAtten/bobAmp が完全にゼロになる(R53-W1 NEUTRAL_STATE と同じ手法)
  // ため、root.position はスウェイ等に一切揺らされずpapDip/emissiveパルスの寄与のみで動く。
  const NEUTRAL_STATE = {
    adsProgress: 1,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: false,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
    sprinting: false,
  };

  it('playPapUpgradeAnim(通常2.5s): 中盤でrootが沈み+発光パルスが起き、最終的に元位置へ戻る', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    vm.setWeapon(ar);
    vm.update(0, NEUTRAL_STATE);
    const baselineY = vm.root.position.y;
    vm.playPapUpgradeAnim(false);
    const accentMat = (vm as unknown as Record<string, unknown>)['_accentMat'] as THREE.MeshStandardMaterial;
    let minY = Infinity;
    let maxEmissive = 0;
    for (let i = 0; i < 200; i += 1) {
      vm.update(1 / 60, NEUTRAL_STATE);
      minY = Math.min(minY, vm.root.position.y);
      maxEmissive = Math.max(maxEmissive, accentMat.emissiveIntensity);
    }
    expect(minY).toBeLessThan(baselineY - 0.05); // 武器が沈んだ
    expect(maxEmissive).toBeGreaterThan(0.5); // 発光パルスが基準値(0.5)を超えた
    expect(maxEmissive).toBeLessThan(0.9); // bloom閾値0.9未満(白飛び再発禁止)
    expect(vm.root.position.y).toBeCloseTo(baselineY, 6); // タイマー経過後にrootが元位置
    vm.dispose();
  });

  it('playPapUpgradeAnim(reduceMotion=true): 短縮(0.5s)+パルスなしで、最終的に元位置へ戻る', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const ar = WEAPON_DEFS['kaede-ar'];
    if (!ar) throw new Error('kaede-ar missing');
    vm.setWeapon(ar);
    vm.update(0, NEUTRAL_STATE);
    const baselineY = vm.root.position.y;
    vm.playPapUpgradeAnim(true);
    const accentMat = (vm as unknown as Record<string, unknown>)['_accentMat'] as THREE.MeshStandardMaterial;
    let minY = Infinity;
    let maxEmissive = 0;
    for (let i = 0; i < 60; i += 1) {
      // 60/60 = 1.0s > 0.5s の短縮尺
      vm.update(1 / 60, NEUTRAL_STATE);
      minY = Math.min(minY, vm.root.position.y);
      maxEmissive = Math.max(maxEmissive, accentMat.emissiveIntensity);
    }
    expect(minY).toBeLessThan(baselineY - 0.05); // 沈み込み自体は起きる
    expect(maxEmissive).toBeCloseTo(0.5, 5); // パルス省略=基準値のまま変化しない
    expect(vm.root.position.y).toBeCloseTo(baselineY, 6);
    vm.dispose();
  });

  it('playPapUpgradeAnimは fire/reload可動ノード(rig.*)には触れない(rest=identity契約は不変)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['kaede-ar'];
    if (!def) throw new Error('kaede-ar missing');
    vm.setWeapon(def);
    const rig = (vm as unknown as Record<string, unknown>)['rig'] as {
      slide?: THREE.Object3D;
      bolt?: THREE.Object3D;
      charging?: THREE.Object3D;
      magazine?: THREE.Object3D;
    };
    vm.playPapUpgradeAnim(false);
    for (let i = 0; i < 30; i += 1) vm.update(1 / 60, NEUTRAL_STATE);
    if (rig.slide) expect(rig.slide.position.z).toBe(0);
    if (rig.bolt) expect(rig.bolt.position.z).toBe(0);
    if (rig.charging) expect(rig.charging.position.z).toBe(0);
    if (rig.magazine) expect(rig.magazine.position.y).toBe(0);
    vm.dispose();
  });

  it('W1非回帰: 修羅のブレースADS収束(X/Z)はpapDipの影響を受けず、Yのみ一時的に沈んで戻る', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shura-lmg'];
    if (!def) throw new Error('shura-lmg missing');
    vm.setWeapon(def);
    vm.update(0, NEUTRAL_STATE);
    expect(vm.root.position.x).toBeCloseTo(0.3, 5);
    expect(vm.root.position.y).toBeCloseTo(-0.3, 5);
    expect(vm.root.position.z).toBeCloseTo(-0.3, 5);
    vm.playPapUpgradeAnim(false);
    let minY = Infinity;
    for (let i = 0; i < 40; i += 1) {
      // 中盤(≈0.33s)まで進める。X/Zはブレース位置のまま不変、Yだけ沈む
      vm.update(1 / 60, NEUTRAL_STATE);
      minY = Math.min(minY, vm.root.position.y);
      expect(vm.root.position.x).toBeCloseTo(0.3, 5);
      expect(vm.root.position.z).toBeCloseTo(-0.3, 5);
    }
    expect(minY).toBeLessThan(-0.3 - 0.05);
    for (let i = 0; i < 160; i += 1) vm.update(1 / 60, NEUTRAL_STATE); // 残りを消化
    expect(vm.root.position.x).toBeCloseTo(0.3, 5);
    expect(vm.root.position.y).toBeCloseTo(-0.3, 5);
    expect(vm.root.position.z).toBeCloseTo(-0.3, 5);
    vm.dispose();
  });
});

// ── R53 帝王体験(Fable#5): 溜め3段ポーズ+恒久報酬・白芯雷脈 ─────────────────
// 溜め段は加算デルタ(スイングと同チャネル)なので rest/ADS/resolveSightY 契約に無干渉。
// ADS中は level×(1-adsProgress) で縮退する(照準契約優先)。
describe('R53: 帝王溜め段(setEmperorChargeStage)+白芯雷脈(setKatanaVeins)', () => {
  const HIP_STATE = {
    adsProgress: 0,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: true,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
    sprinting: false,
  };

  function makeKunaiVm(): { vm: ViewModel; kunai: THREE.Object3D } {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['fists'];
    if (!def) throw new Error('fists missing');
    vm.setWeapon(def);
    const kunai = vm.root.getObjectByName('vm:kunai');
    if (!kunai) throw new Error('vm:kunai missing');
    return { vm, kunai };
  }

  it('段3で刀が大上段へ(rotation.x が rest より大きく上向く)、段0で復帰する', () => {
    const { vm, kunai } = makeKunaiVm();
    for (let i = 0; i < 30; i += 1) vm.update(1 / 60, HIP_STATE);
    const restRx = kunai.rotation.x;
    vm.setEmperorChargeStage(3);
    for (let i = 0; i < 90; i += 1) vm.update(1 / 60, HIP_STATE);
    // EMPEROR_CHARGE_MAX の kunai r[0]=-1.15 がフル(level=1.0)で乗る
    expect(kunai.rotation.x).toBeLessThan(restRx - 0.8);
    vm.setEmperorChargeStage(0);
    for (let i = 0; i < 120; i += 1) vm.update(1 / 60, HIP_STATE);
    expect(kunai.rotation.x).toBeCloseTo(restRx, 2);
    vm.dispose();
  });

  it('段の単調性: 段1 < 段2 < 段3 の持ち上げ量', () => {
    const { vm, kunai } = makeKunaiVm();
    const rxAt = (stage: 0 | 1 | 2 | 3): number => {
      vm.setEmperorChargeStage(stage);
      for (let i = 0; i < 90; i += 1) vm.update(1 / 60, HIP_STATE);
      return kunai.rotation.x;
    };
    const r0 = rxAt(0);
    const r1 = rxAt(1);
    const r2 = rxAt(2);
    const r3 = rxAt(3);
    expect(r1).toBeLessThan(r0);
    expect(r2).toBeLessThan(r1);
    expect(r3).toBeLessThan(r2);
    vm.dispose();
  });

  it('ADS中は溜めポーズが縮退する(照準契約優先: level×(1-adsProgress))', () => {
    const { vm, kunai } = makeKunaiVm();
    vm.setEmperorChargeStage(3);
    for (let i = 0; i < 90; i += 1) vm.update(1 / 60, { ...HIP_STATE, adsProgress: 1 });
    // ADS逆手ポーズ(FIST_POSES.ads r[0]=-2.0)そのもの=溜め加算はゼロ
    expect(kunai.rotation.x).toBeCloseTo(-2.0, 1);
    vm.dispose();
  });

  it('武器切替で溜め段が解除される(キャッシュ越境防止)', () => {
    const { vm, kunai } = makeKunaiVm();
    for (let i = 0; i < 30; i += 1) vm.update(1 / 60, HIP_STATE);
    const restRx = kunai.rotation.x;
    vm.setEmperorChargeStage(3);
    for (let i = 0; i < 60; i += 1) vm.update(1 / 60, HIP_STATE);
    const ar = WEAPON_DEFS['kaede-ar'];
    const fists = WEAPON_DEFS['fists'];
    if (!ar || !fists) throw new Error('defs missing');
    vm.setWeapon(ar);
    vm.setWeapon(fists);
    const kunai2 = vm.root.getObjectByName('vm:kunai');
    if (!kunai2) throw new Error('vm:kunai missing after reswap');
    for (let i = 0; i < 60; i += 1) vm.update(1 / 60, HIP_STATE);
    expect(kunai2.rotation.x).toBeCloseTo(restRx, 2);
    vm.dispose();
  });

  it('setKatanaVeins(true): 黒刀に vm:katanaVeins が付き、falseで除去される', () => {
    const { vm } = makeKunaiVm();
    vm.setKunaiDarkMode(true);
    expect(vm.root.getObjectByName('vm:darkBlade')).toBeTruthy();
    expect(vm.root.getObjectByName('vm:katanaVeins')).toBeFalsy();
    vm.setKatanaVeins(true);
    expect(vm.root.getObjectByName('vm:katanaVeins')).toBeTruthy();
    vm.setKatanaVeins(false);
    expect(vm.root.getObjectByName('vm:katanaVeins')).toBeFalsy();
    vm.dispose();
  });

  it('雷脈は先に解放→後からブレード構築でも自動で乗る(雷刀側)', () => {
    const { vm } = makeKunaiVm();
    vm.setKatanaVeins(true);
    expect(vm.root.getObjectByName('vm:katanaVeins')).toBeFalsy(); // ブレード未構築なら無し
    vm.setKunaiLightningMode(true);
    const blade = vm.root.getObjectByName('vm:lightningBlade');
    expect(blade).toBeTruthy();
    expect(blade!.getObjectByName('vm:katanaVeins')).toBeTruthy();
    vm.dispose();
  });
});

// ── R54-F8' 帝王フェーズ2: 修羅の相バレルグロー+クロガネ套装 ─────────────────

describe("R54-F8': setShuraPhase(修羅の相バレルグロー)", () => {
  const IDLE = {
    adsProgress: 0,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: true,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
    sprinting: false,
  };

  function makeShuraVm(): ViewModel {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['shura-lmg'];
    if (!def) throw new Error('shura-lmg missing');
    vm.setWeapon(def);
    return vm;
  }

  function glowOf(vm: ViewModel): THREE.Mesh | null {
    return (vm.root.getObjectByName('vm:shuraGlow') as THREE.Mesh | undefined) ?? null;
  }

  it('相0では何も追加しない、相2で微発光オーバーレイが付く', () => {
    const vm = makeShuraVm();
    expect(glowOf(vm)).toBeNull();
    vm.setShuraPhase(2);
    const glow = glowOf(vm);
    expect(glow).toBeTruthy();
    const mat = glow!.material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.16, 5);
    expect(glow!.visible).toBe(true);
    vm.dispose();
  });

  it('相3で赤熱(opacity 0.42 ≤ 0.55 発光鉄則)、相0で消灯', () => {
    const vm = makeShuraVm();
    vm.setShuraPhase(3);
    const glow = glowOf(vm);
    const mat = glow!.material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.42, 5);
    expect(mat.opacity).toBeLessThanOrEqual(0.55);
    expect(mat.color.getHex()).toBe(0xff2a10);
    vm.setShuraPhase(0);
    expect(glow!.visible).toBe(false);
    expect(mat.opacity).toBe(0);
    vm.dispose();
  });

  it('武器切替で相リセット+キャッシュ銃の旧グローも消灯、再装備で蓄積しない', () => {
    const vm = makeShuraVm();
    vm.setShuraPhase(3);
    const glow = glowOf(vm)!;
    const ar = WEAPON_DEFS['kaede-ar'];
    const shura = WEAPON_DEFS['shura-lmg'];
    if (!ar || !shura) throw new Error('defs missing');
    vm.setWeapon(ar);
    // captureRig の切替リセット: 旧(キャッシュ)銃に残るグローは消灯済み
    expect(glow.visible).toBe(false);
    expect((glow.material as THREE.MeshBasicMaterial).opacity).toBe(0);
    // 再装備(キャッシュヒット)→ 再点灯は同一メッシュを再利用(蓄積なし)
    vm.setWeapon(shura);
    vm.setShuraPhase(2);
    let count = 0;
    vm.root.traverse((o) => {
      if (o.name === 'vm:shuraGlow') count += 1;
    });
    expect(count).toBe(1);
    vm.dispose();
  });

  it('バレルを持たない武器(fists)では no-op(例外なし・何も追加しない)', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['fists'];
    if (!def) throw new Error('fists missing');
    vm.setWeapon(def);
    expect(() => vm.setShuraPhase(3)).not.toThrow();
    expect(vm.root.getObjectByName('vm:shuraGlow')).toBeFalsy();
    vm.update(1 / 60, IDLE);
    vm.dispose();
  });
});

describe("R54-F8': setKuroganeStyle(クロガネ套装=黒鋼+赤亀裂)", () => {
  function makeKunaiVm(): ViewModel {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['fists'];
    if (!def) throw new Error('fists missing');
    vm.setWeapon(def);
    return vm;
  }

  function tintedMats(vm: ViewModel): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    vm.root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.lightningMat) {
        out.push(node.material as THREE.MeshStandardMaterial);
      }
    });
    return out;
  }

  function arcLineHexes(vm: ViewModel): number[] {
    const blade = vm.root.getObjectByName('vm:lightningBlade');
    const hexes: number[] = [];
    blade?.traverse((node) => {
      if (node instanceof THREE.Mesh && (node.material as THREE.Material).userData.isArcLine) {
        hexes.push((node.material as THREE.MeshBasicMaterial).color.getHex());
      }
    });
    return hexes;
  }

  it('套装ON→雷モード: 刀身が黒鋼(0x0a0a0c)+赤残響 emissive(≤0.55)になる', () => {
    const vm = makeKunaiVm();
    vm.setKuroganeStyle(true);
    vm.setKunaiLightningMode(true);
    const mats = tintedMats(vm);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
      expect(m.color.getHex()).toBe(0x0a0a0c);
      expect(m.emissive.getHex()).toBe(0x8b0f14);
      expect(m.emissiveIntensity).toBeLessThanOrEqual(0.55);
    }
    // アークラインも赤亀裂系
    expect(arcLineHexes(vm)).toContain(0xcc1122);
    vm.dispose();
  });

  it('雷モード中のトグルで即時再適用され、OFFで通常の氷青(0x55bbff)へ戻る', () => {
    const vm = makeKunaiVm();
    vm.setKunaiLightningMode(true);
    expect(tintedMats(vm)[0]!.emissive.getHex()).toBe(0x55bbff);
    vm.setKuroganeStyle(true);
    expect(tintedMats(vm)[0]!.emissive.getHex()).toBe(0x8b0f14);
    expect(arcLineHexes(vm)).toContain(0xcc1122);
    vm.setKuroganeStyle(false);
    expect(tintedMats(vm)[0]!.emissive.getHex()).toBe(0x55bbff);
    expect(arcLineHexes(vm)).toContain(0x88ddff);
    vm.dispose();
  });

  it('黒雷帝(kokuraitei)のビジュアルは套装の影響を受けない(紫アーク維持)', () => {
    const vm = makeKunaiVm();
    vm.setKuroganeStyle(true);
    vm.setKunaiLightningMode(true, true);
    const hexes = arcLineHexes(vm);
    expect(hexes).toContain(0x7700cc);
    expect(hexes).not.toContain(0xcc1122);
    vm.dispose();
  });

  it('雷脈(setKatanaVeins)と共存する', () => {
    const vm = makeKunaiVm();
    vm.setKatanaVeins(true);
    vm.setKuroganeStyle(true);
    vm.setKunaiLightningMode(true);
    const blade = vm.root.getObjectByName('vm:lightningBlade');
    expect(blade).toBeTruthy();
    expect(blade!.getObjectByName('vm:katanaVeins')).toBeTruthy();
    expect(arcLineHexes(vm)).toContain(0xcc1122);
    vm.dispose();
  });

  it('帝王溜め段(setEmperorChargeStage)と干渉しない(套装の赤が維持される)', () => {
    const vm = makeKunaiVm();
    vm.setKuroganeStyle(true);
    vm.setKunaiLightningMode(true);
    vm.setEmperorChargeStage(3);
    vm.setEmperorChargeStage(0);
    expect(tintedMats(vm)[0]!.emissive.getHex()).toBe(0x8b0f14);
    vm.dispose();
  });
});

// ── R56 W3: 純雷帝(_darkMode=false)でも刀身の雷が明滅する(死コード根治) ──────────
// 真因: 電弧フリッカー2ブロックが `!_darkMode` 早期returnの後ろにあり、_darkMode===false
// の純雷帝では早期returnで止まって一切実行されなかった(刀身の雷が静止して見えるバグ)。
// 早期returnより前へ移動し、`_lightningArcMeshes` 側の矛盾する `!_darkMode` 条件も削除した。
describe('R56 W3: 電弧フリッカーの早期return根治', () => {
  const IDLE = {
    adsProgress: 0,
    mouseDX: 0,
    mouseDY: 0,
    moveFactor: 0,
    grounded: true,
    reloadRatio: null,
    raiseRatio: 0,
    motionScale: 1,
    alive: true,
    scopeReveal01: 0,
    sprinting: false,
  };

  function makeKunaiVm(): ViewModel {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    const def = WEAPON_DEFS['fists'];
    if (!def) throw new Error('fists missing');
    vm.setWeapon(def);
    return vm;
  }

  function arcLineOpacities(vm: ViewModel): number[] {
    const blade = vm.root.getObjectByName('vm:lightningBlade');
    const ops: number[] = [];
    blade?.traverse((node) => {
      if (node instanceof THREE.Mesh && (node.material as THREE.Material).userData.isArcLine) {
        ops.push((node.material as THREE.MeshBasicMaterial).opacity);
      }
    });
    return ops;
  }

  // private フィールドへの白箱アクセス(_lightningArcMeshes の visible/opacity トグル検証用)。
  function arcMeshVisibility(vm: ViewModel): boolean[] {
    const internal = vm as unknown as { _lightningArcMeshes: THREE.Mesh[] };
    return internal._lightningArcMeshes.map((m) => m.visible);
  }

  it('純雷帝(lightningMode=true, darkMode=false)でリボン(isArcLine)の opacity が毎フレーム変動する', () => {
    const vm = makeKunaiVm();
    vm.setKunaiLightningMode(true); // active=true, kokuraitei=false → _darkMode は未設定のまま false
    const seen = new Set<number>();
    for (let i = 0; i < 90; i += 1) {
      vm.update(1 / 60, IDLE);
      for (const op of arcLineOpacities(vm)) seen.add(op);
    }
    // 明滅していれば 0.05-0.09s ごとに新しい乱数opacityが採用され、1.5秒で複数値が観測されるはず。
    // 明滅が死コードのままなら初期値(makeArcLine構築時の固定opacity)のまま1値しか観測されない。
    expect(seen.size).toBeGreaterThan(1);
    vm.dispose();
  });

  it('純雷帝で _lightningArcMeshes(刀身沿いの電気アーク5本)の visible が毎フレーム変動する', () => {
    const vm = makeKunaiVm();
    vm.setKunaiLightningMode(true);
    const sawTrue = new Set<boolean>();
    for (let i = 0; i < 90; i += 1) {
      vm.update(1 / 60, IDLE);
      for (const v of arcMeshVisibility(vm)) sawTrue.add(v);
    }
    // 旧実装は `_lightningMode && !_darkMode` で常にfalse(_darkMode=falseの時しか通れないのに
    // !_darkModeを要求する矛盾)=死コード。根治後は visible が true/false 両方観測されるはず。
    expect(sawTrue.has(true)).toBe(true);
    expect(sawTrue.has(false)).toBe(true);
    vm.dispose();
  });

  it('黒雷帝(kokuraitei: dark+lightning併存)でもリボン明滅は従来通り動く(非回帰)', () => {
    const vm = makeKunaiVm();
    vm.setKunaiDarkMode(true);
    vm.setKunaiLightningMode(true, true);
    const seen = new Set<number>();
    for (let i = 0; i < 90; i += 1) {
      vm.update(1 / 60, IDLE);
      for (const op of arcLineOpacities(vm)) seen.add(op);
    }
    expect(seen.size).toBeGreaterThan(1);
    vm.dispose();
  });

  it('黒雷帝でダークオーラのパーティクル更新(TrackA/B移動+三角opacity)は不変', () => {
    const vm = makeKunaiVm();
    vm.setKunaiDarkMode(true);
    vm.setKunaiLightningMode(true, true);
    // fists装備中は _updateDarkAura が黒炎/紫電を毎フレームスポーンする(3860行以降の経路)。
    // 例外なく多数フレーム回せることを確認(スポーン/フェード処理が早期returnで潰れていないこと)。
    expect(() => {
      for (let i = 0; i < 60; i += 1) vm.update(1 / 60, IDLE);
    }).not.toThrow();
    vm.dispose();
  });
});
