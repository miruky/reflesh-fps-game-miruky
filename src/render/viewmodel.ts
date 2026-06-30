import * as THREE from 'three';
import type { WeaponClass, ViewModelShape, WeaponDef } from '../game/weapons';

const HIP_POSITION = new THREE.Vector3(0.24, -0.22, -0.5);
const ADS_POSITION = new THREE.Vector3(0, -0.142, -0.42);
const LOWERED_OFFSET = -0.35;
// 銃身・マズルの基準高さ(全シルエット共通)。トレーサー原点もこの高さに乗る
const BARREL_Y = 0.012;

// ── procedural シルエット定義 ───────────────────────────────────────────
// 給弾方式。mag-curved/straight=着脱式弾倉、drum=ドラム、box=箱型、belt=ベルト給弾、
// tube=チューブ弾倉(+フォアエンド)、horizontal=横置き弾倉(P90系)、none=なし
type FeedKind =
  | 'mag-curved'
  | 'mag-straight'
  | 'drum'
  | 'box'
  | 'belt'
  | 'tube'
  | 'horizontal'
  | 'none';
// ハンドガード形状。slim=細身、rail=レール付き、wood=木製、shroud=バレルシュラウド
type HandguardKind = 'none' | 'slim' | 'rail' | 'wood' | 'shroud';
// ストック形状。fixed=固定、skeleton=スケルトン、folding=折りたたみ
type StockKind = 'none' | 'fixed' | 'skeleton' | 'folding';
// マズルデバイス。brake=マズルブレーキ、flash=フラッシュハイダー、shroud=覆い
type MuzzleDevice = 'none' | 'brake' | 'flash' | 'shroud';
// アクセント帯(tracerColor)の貼り付け位置
type AccentBand = 'receiver' | 'handguard' | 'stock' | 'slide';

// 一体型光学機器(覗き口の太さ・長さ・高さ)
interface ScopeSpec {
  r: number;
  len: number;
  y: number;
}

// 1つの銃シルエットを完全に記述する行。SHAPE_SPECS が ViewModelShape ごとに保持する。
interface Silhouette {
  receiver: { w: number; h: number; d: number };
  barrelGauge: number;
  barrelLen: number;
  feed: FeedKind;
  handguard: HandguardKind;
  stock: StockKind;
  scope: ScopeSpec | null;
  boltHandle: boolean;
  muzzle: MuzzleDevice;
  accentBand: AccentBand;
  bodyScale: number;
  // 任意: 給弾部のZオフセット(bullpup=グリップ後方へ)
  feedZ?: number;
  // 任意: 上下二連の二本バレル(shotgun-double)
  twinBarrel?: boolean;
  // 任意: 回転式シリンダ(revolver)
  cylinder?: boolean;
}

// 全15形状を網羅した寸法表。Record<ViewModelShape, Silhouette> なので、
// weapons.ts が ViewModelShape を増やすと「キー欠落」を tsc が検出する(exhaustive)。
const SHAPE_SPECS: Record<ViewModelShape, Silhouette> = {
  rifle: {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.034,
    barrelLen: 0.24,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
  },
  carbine: {
    receiver: { w: 0.072, h: 0.092, d: 0.28 },
    barrelGauge: 0.032,
    barrelLen: 0.16,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'folding',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.95,
  },
  bullpup: {
    receiver: { w: 0.08, h: 0.1, d: 0.4 },
    barrelGauge: 0.032,
    barrelLen: 0.2,
    feed: 'mag-curved',
    handguard: 'slim',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.95,
    feedZ: 0.16,
  },
  smg: {
    receiver: { w: 0.07, h: 0.088, d: 0.3 },
    barrelGauge: 0.03,
    barrelLen: 0.18,
    feed: 'mag-straight',
    handguard: 'slim',
    stock: 'folding',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
  },
  pdw: {
    receiver: { w: 0.07, h: 0.09, d: 0.3 },
    barrelGauge: 0.028,
    barrelLen: 0.14,
    feed: 'horizontal',
    handguard: 'shroud',
    stock: 'folding',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'handguard',
    bodyScale: 0.85,
  },
  'machine-pistol': {
    receiver: { w: 0.062, h: 0.085, d: 0.22 },
    barrelGauge: 0.026,
    barrelLen: 0.1,
    feed: 'mag-straight',
    handguard: 'none',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'slide',
    bodyScale: 0.8,
  },
  dmr: {
    receiver: { w: 0.075, h: 0.095, d: 0.36 },
    barrelGauge: 0.032,
    barrelLen: 0.28,
    feed: 'mag-curved',
    handguard: 'slim',
    stock: 'fixed',
    scope: { r: 0.026, len: 0.15, y: 0.085 },
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.18,
  },
  'sniper-bolt': {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.034,
    barrelLen: 0.24,
    feed: 'mag-curved',
    handguard: 'slim',
    stock: 'fixed',
    scope: { r: 0.03, len: 0.16, y: 0.08 },
    boltHandle: true,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.25,
  },
  'shotgun-pump': {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.04,
    barrelLen: 0.24,
    feed: 'tube',
    handguard: 'none',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.1,
  },
  'shotgun-auto': {
    receiver: { w: 0.08, h: 0.1, d: 0.36 },
    barrelGauge: 0.04,
    barrelLen: 0.26,
    feed: 'box',
    handguard: 'rail',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.08,
  },
  'shotgun-double': {
    receiver: { w: 0.085, h: 0.105, d: 0.3 },
    barrelGauge: 0.038,
    barrelLen: 0.3,
    feed: 'none',
    handguard: 'wood',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'stock',
    bodyScale: 1.05,
    twinBarrel: true,
  },
  'lmg-belt': {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.036,
    barrelLen: 0.24,
    feed: 'belt',
    handguard: 'shroud',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.15,
  },
  'lmg-drum': {
    receiver: { w: 0.082, h: 0.1, d: 0.34 },
    barrelGauge: 0.036,
    barrelLen: 0.24,
    feed: 'drum',
    handguard: 'shroud',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.12,
  },
  pistol: {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.034,
    barrelLen: 0.24,
    feed: 'none',
    handguard: 'none',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 0.65,
  },
  revolver: {
    receiver: { w: 0.05, h: 0.08, d: 0.2 },
    barrelGauge: 0.024,
    barrelLen: 0.16,
    feed: 'none',
    handguard: 'none',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'slide',
    bodyScale: 0.72,
    cylinder: true,
  },
};

// クラス既定のシルエット。def.shape 未指定時のフォールバック。
function classDefault(cls: WeaponClass): ViewModelShape {
  switch (cls) {
    case 'ar':
      return 'rifle';
    case 'smg':
      return 'smg';
    case 'sniper':
      return 'sniper-bolt';
    case 'shotgun':
      return 'shotgun-pump';
    case 'br':
      return 'rifle';
    case 'lmg':
      return 'lmg-belt';
    case 'pistol':
      return 'pistol';
    case 'marksman':
      return 'dmr';
  }
}

// def から行を引く。Record<Union,V> 索引なので noUncheckedIndexedAccess でも undefined にならない。
function resolveSilhouette(def: WeaponDef): Silhouette {
  return SHAPE_SPECS[def.shape ?? classDefault(def.class)];
}

function assertNever(x: never): never {
  throw new Error(`unexpected variant: ${String(x)}`);
}

// ── 共有マテリアル ──────────────────────────────────────────────────────
// dark/darker/sleeve/glove は全銃で1度だけ生成して使い回す(userData.shared=true)。
// accent は tracerColor ごとにキャッシュ。レンズ・木材など固有色は非shared。
interface SharedMats {
  dark: THREE.MeshStandardMaterial;
  darker: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
}
let sharedMats: SharedMats | null = null;
const accentCache = new Map<number, THREE.MeshStandardMaterial>();

// 銃はカメラ近接(near 0.05)でワールドIBLの反射方向がズレるため envMapIntensity を抑える
function metalMat(color: number, roughness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, envMapIntensity: 0.3 });
  m.userData.shared = true;
  return m;
}
function clothMat(color: number, roughness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness });
  m.userData.shared = true;
  return m;
}

function getShared(): SharedMats {
  if (!sharedMats) {
    sharedMats = {
      dark: metalMat(0x2e3138, 0.45),
      darker: metalMat(0x1d1f24, 0.5),
      sleeve: clothMat(0x2b2e34, 0.7),
      glove: clothMat(0x161820, 0.55),
    };
  }
  return sharedMats;
}

function getAccent(color: number): THREE.MeshStandardMaterial {
  let m = accentCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, envMapIntensity: 0.3 });
    m.userData.shared = true;
    accentCache.set(color, m);
  }
  return m;
}

// 共有シングルトン+accentキャッシュを一度だけ解放(二重freeなし・冪等)。
function disposeShared(): void {
  if (sharedMats) {
    sharedMats.dark.dispose();
    sharedMats.darker.dispose();
    sharedMats.sleeve.dispose();
    sharedMats.glove.dispose();
    sharedMats = null;
  }
  for (const m of accentCache.values()) m.dispose();
  accentCache.clear();
}

// ── 銃本体ビルダ(ARMORY 3Dプレビューと共用) ──────────────────────────
// 一人称腕(sleeve/glove)は含めない、純粋な銃メッシュ + トレーサー原点muzzle。
export function buildGunBody(def: WeaponDef): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const gun = new THREE.Group();
  const { dark, darker } = getShared();
  const accent = getAccent(def.tracerColor);

  const sil = resolveSilhouette(def);
  const bs = def.bodyScale ?? sil.bodyScale;
  const r = sil.receiver;
  const gauge = sil.barrelGauge;
  const recD = r.d * bs;
  const recHalf = recD / 2;
  const barLen = sil.barrelLen * bs;
  const barCenterZ = -(recHalf + 0.1 * bs);
  const barFrontZ = barCenterZ - barLen / 2;
  const attachments = def.attachmentIds ?? [];
  const extendedMag = attachments.includes('extended');

  const box = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (r1: number, r2: number, h: number, mat: THREE.Material): THREE.Mesh =>
    new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h), mat);

  // レシーバ + バレル(二連は左右へ)
  const receiver = box(r.w, r.h, recD, dark);
  gun.add(receiver);
  if (sil.twinBarrel) {
    const off = gauge * 0.6 + 0.002;
    const bl = box(gauge, gauge, barLen, darker);
    bl.position.set(-off, BARREL_Y, barCenterZ);
    const br = box(gauge, gauge, barLen, darker);
    br.position.set(off, BARREL_Y, barCenterZ);
    gun.add(bl, br);
  } else {
    const barrel = box(gauge, gauge, barLen, darker);
    barrel.position.set(0, BARREL_Y, barCenterZ);
    gun.add(barrel);
  }

  // グリップ(全形状共通。一人称の右手位置に対応)
  const grip = box(0.05, 0.14, 0.06, darker);
  grip.position.set(0, -0.1, 0.1);
  grip.rotation.x = 0.3;
  gun.add(grip);

  // アイアンサイト(前後)
  const frontSight = box(0.008, 0.035, 0.008, darker);
  frontSight.position.set(0, 0.065, -recD);
  const rearLeft = box(0.012, 0.03, 0.012, darker);
  rearLeft.position.set(-0.018, 0.062, 0.14);
  const rearRight = box(0.012, 0.03, 0.012, darker);
  rearRight.position.set(0.018, 0.062, 0.14);
  gun.add(frontSight, rearLeft, rearRight);

  // アクセント帯(tracerColor)
  switch (sil.accentBand) {
    case 'receiver': {
      const s = box(r.w + 0.003, 0.02, 0.1, accent);
      s.position.set(0, 0.02, 0.08);
      gun.add(s);
      break;
    }
    case 'handguard': {
      const s = box(gauge + 0.016, 0.012, barLen * 0.4, accent);
      s.position.set(0, BARREL_Y + gauge * 0.6, barCenterZ);
      gun.add(s);
      break;
    }
    case 'stock': {
      const s = box(0.04, 0.016, 0.06, accent);
      s.position.set(0, 0.0, recHalf + 0.06 * bs);
      gun.add(s);
      break;
    }
    case 'slide': {
      const s = box(r.w + 0.004, 0.012, recD * 0.5, accent);
      s.position.set(0, r.h / 2 - 0.004, -recD * 0.12);
      gun.add(s);
      break;
    }
    default:
      assertNever(sil.accentBand);
  }

  // 給弾部
  switch (sil.feed) {
    case 'mag-curved': {
      const h = extendedMag ? 0.18 : 0.13;
      const mag = box(0.045, h, 0.07, dark);
      mag.position.set(0, extendedMag ? -0.135 : -0.11, sil.feedZ ?? -0.04);
      mag.rotation.x = -0.15;
      gun.add(mag);
      break;
    }
    case 'mag-straight': {
      const h = extendedMag ? 0.2 : 0.15;
      const mag = box(0.04, h, 0.06, dark);
      mag.position.set(0, extendedMag ? -0.145 : -0.12, sil.feedZ ?? -0.02);
      gun.add(mag);
      break;
    }
    case 'horizontal': {
      // P90系: 銃身の上に横たわる弾倉
      const mag = box(0.05, 0.03, 0.16 * bs, dark);
      mag.position.set(0, 0.055, barCenterZ + 0.02);
      gun.add(mag);
      break;
    }
    case 'drum': {
      const drum = cyl(0.07, 0.07, 0.05, dark);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0, -0.12, sil.feedZ ?? -0.02);
      gun.add(drum);
      break;
    }
    case 'box': {
      const mag = box(0.07, 0.12, 0.08, dark);
      mag.position.set(0, -0.105, sil.feedZ ?? -0.05);
      gun.add(mag);
      break;
    }
    case 'belt': {
      // 給弾ボックス + ベルト帯
      const ammoBox = box(0.09, 0.11, 0.13, dark);
      ammoBox.position.set(0, -0.1, -0.05);
      const belt = box(0.05, 0.02, 0.05, darker);
      belt.position.set(0.02, -0.04, -0.1);
      belt.rotation.z = 0.3;
      gun.add(ammoBox, belt);
      break;
    }
    case 'tube': {
      // チューブ弾倉 + 摺動フォアエンド(ポンプ)
      const tube = box(0.03, 0.03, 0.22 * bs, darker);
      tube.position.set(0, -0.025, -0.24 * bs);
      const forend = box(0.055, 0.045, 0.12, dark);
      forend.position.set(0, -0.03, -0.16);
      gun.add(tube, forend);
      break;
    }
    case 'none':
      break;
    default:
      assertNever(sil.feed);
  }

  // ハンドガード
  switch (sil.handguard) {
    case 'none':
      break;
    case 'slim': {
      const g = box(gauge + 0.012, gauge + 0.012, barLen * 0.6, darker);
      g.position.set(0, BARREL_Y, barCenterZ + barLen * 0.12);
      gun.add(g);
      break;
    }
    case 'rail': {
      const g = box(gauge + 0.018, gauge + 0.018, barLen * 0.7, dark);
      g.position.set(0, BARREL_Y, barCenterZ + barLen * 0.05);
      const rail = box(gauge + 0.006, 0.008, barLen * 0.7, darker);
      rail.position.set(0, BARREL_Y + gauge * 0.6, barCenterZ + barLen * 0.05);
      gun.add(g, rail);
      break;
    }
    case 'wood': {
      // 木製は固有色(非shared)。dispose の traverse で個別解放される
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x6a4a2c,
        roughness: 0.6,
        envMapIntensity: 0.3,
      });
      const g = box(gauge + 0.02, gauge + 0.02, barLen * 0.7, woodMat);
      g.position.set(0, BARREL_Y - 0.005, barCenterZ + barLen * 0.1);
      gun.add(g);
      break;
    }
    case 'shroud': {
      const g = box(gauge + 0.03, gauge + 0.03, barLen * 0.85, darker);
      g.position.set(0, BARREL_Y, barCenterZ);
      gun.add(g);
      break;
    }
    default:
      assertNever(sil.handguard);
  }

  // ストック(肩付け側へ伸びる)
  const stockZ = recHalf + 0.05 * bs;
  switch (sil.stock) {
    case 'none':
      break;
    case 'fixed': {
      const s = box(0.05, 0.075, 0.13, dark);
      s.position.set(0, -0.02, stockZ + 0.04);
      gun.add(s);
      break;
    }
    case 'folding': {
      const s = box(0.04, 0.05, 0.09, darker);
      s.position.set(0.035, -0.01, stockZ);
      gun.add(s);
      break;
    }
    case 'skeleton': {
      const top = box(0.04, 0.012, 0.14, darker);
      top.position.set(0, 0.03, stockZ + 0.05);
      const bottom = box(0.04, 0.012, 0.12, darker);
      bottom.position.set(0, -0.05, stockZ + 0.04);
      const back = box(0.04, 0.09, 0.012, darker);
      back.position.set(0, -0.01, stockZ + 0.11);
      gun.add(top, bottom, back);
      break;
    }
    default:
      assertNever(sil.stock);
  }

  // 一体型光学機器
  if (sil.scope) {
    const optic = cyl(sil.scope.r, sil.scope.r, sil.scope.len, darker);
    optic.rotation.x = Math.PI / 2;
    optic.position.set(0, sil.scope.y, -0.02);
    const mount = box(0.03, 0.03, 0.04, darker);
    mount.position.set(0, sil.scope.y - 0.03, 0.0);
    gun.add(optic, mount);
  }

  // ボルトハンドル(右側に突き出る)
  if (sil.boltHandle) {
    const arm = box(0.012, 0.012, 0.04, darker);
    arm.position.set(0.05, 0.01, 0.06);
    const knob = box(0.02, 0.02, 0.02, darker);
    knob.position.set(0.066, 0.01, 0.06);
    gun.add(arm, knob);
  }

  // 回転式シリンダ
  if (sil.cylinder) {
    const drum = cyl(0.032, 0.032, 0.05, dark);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.01, 0.04);
    gun.add(drum);
  }

  // マズルデバイス + サプレッサ。muzzle 原点は bodyScale*barrelLen に連動(barFrontZ起点)。
  const suppressor = attachments.includes('suppressor');
  let muzzleZ: number;
  if (suppressor) {
    const suppZ = barFrontZ - 0.06 * bs;
    const tube = cyl(0.026, 0.026, 0.14, darker);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, BARREL_Y, suppZ);
    gun.add(tube);
    muzzleZ = suppZ - 0.075;
  } else {
    switch (sil.muzzle) {
      case 'none':
        muzzleZ = barFrontZ - 0.01 * bs;
        break;
      case 'brake': {
        const d = box(gauge + 0.018, gauge + 0.018, 0.03, darker);
        d.position.set(0, BARREL_Y, barFrontZ - 0.015);
        gun.add(d);
        muzzleZ = barFrontZ - 0.04;
        break;
      }
      case 'flash': {
        const d = cyl(gauge * 0.75, gauge * 0.55, 0.04, darker);
        d.rotation.x = Math.PI / 2;
        d.position.set(0, BARREL_Y, barFrontZ - 0.02);
        gun.add(d);
        muzzleZ = barFrontZ - 0.05;
        break;
      }
      case 'shroud': {
        const d = cyl(gauge + 0.01, gauge + 0.01, 0.05, darker);
        d.rotation.x = Math.PI / 2;
        d.position.set(0, BARREL_Y, barFrontZ - 0.025);
        gun.add(d);
        muzzleZ = barFrontZ - 0.06;
        break;
      }
      default:
        muzzleZ = barFrontZ - 0.01 * bs;
        assertNever(sil.muzzle);
    }
  }

  // ── 着脱式アタッチメント(レフレックス/テレスコ/バーティカル|アングル) ──
  if (attachments.includes('reflex')) {
    const frame = box(0.05, 0.05, 0.02, darker);
    frame.position.set(0, 0.075, 0.05);
    const lens = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.034),
      new THREE.MeshBasicMaterial({
        color: 0x7ad1ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    lens.position.set(0, 0.075, 0.038);
    gun.add(frame, lens);
  }
  // 一体型スコープを持たない銃のみ、テレスコピックを上に載せる
  if (attachments.includes('telescopic') && sil.scope === null) {
    const scope = cyl(0.026, 0.026, 0.14, darker);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, 0.0);
    gun.add(scope);
  }
  if (attachments.includes('vertical') || attachments.includes('angled')) {
    const foregrip = box(0.04, 0.09, 0.05, darker);
    foregrip.position.set(0, -0.085, -0.2 * bs);
    if (attachments.includes('angled')) foregrip.rotation.x = 0.5;
    gun.add(foregrip);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BARREL_Y, muzzleZ);
  gun.add(muzzle);
  return { gun, muzzle };
}

// カメラ直付けの一人称武器モデル。procedural な銃本体に一人称腕を足し、
// スウェイ・ボブ・リコイルキック・リロードを手続きで動かす。
export class ViewModel {
  readonly root = new THREE.Group();

  private gun: THREE.Group | null = null;
  private muzzle = new THREE.Object3D();
  private flashMesh: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private readonly cache = new Map<string, { gun: THREE.Group; muzzle: THREE.Object3D }>();

  private swayX = 0;
  private swayY = 0;
  private kickZ = 0;
  private kickRot = 0;
  private flashTimer = 0;
  private bobPhase = 0;
  // 着地インパルス(着地の瞬間に銃が沈んで戻る)。タイマー方式で固定step発火・可変dt減衰
  private landBobTimer = 0;
  private landBobStrength = 0;
  // ボルト閉鎖の二段演出。発砲キックの後、わずかに逆回転して落ち着く
  private counterKickTimer = 0;
  // スプリント中に銃を下げる量(滑らかに追従)。raiseRatioとは独立した加算項
  private sprintLower = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.copy(HIP_POSITION);

    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flashMesh.visible = false;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 7);
  }

  setWeapon(def: WeaponDef): void {
    if (this.gun) this.root.remove(this.gun);
    const key = `${def.id}:${(def.attachmentIds ?? []).join(',')}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.buildGun(def);
      this.cache.set(key, entry);
    }
    this.gun = entry.gun;
    this.muzzle = entry.muzzle;
    this.root.add(this.gun);
    this.muzzle.add(this.flashMesh);
    this.muzzle.add(this.flashLight);
  }

  // 銃本体(buildGunBody)に一人称腕を足す。腕は銃グループの子なので
  // ADS・スウェイ・反動・リロードの動きにそのまま追従する。
  private buildGun(def: WeaponDef): { gun: THREE.Group; muzzle: THREE.Object3D } {
    const { gun, muzzle } = buildGunBody(def);
    const bs = def.bodyScale ?? resolveSilhouette(def).bodyScale;
    const { sleeve, glove } = getShared();
    const limb = (
      mat: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      rz: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      return m;
    };
    // 右手(グリップ)と右前腕(画面右下へ抜ける)
    const rHand = limb(glove, 0.06, 0.07, 0.11, 0.0, -0.11, 0.11, 0.3, 0, 0);
    const rArm = limb(sleeve, 0.08, 0.08, 0.3, 0.03, -0.22, 0.3, 0.62, -0.1, 0);
    // 左手(ハンドガード)と左前腕。前腕の手首側が左手に届くよう、ハンドガード
    // 寄りに置いて横断ヨーを抑える(以前は左下へ流れて手と分離していた)
    const lHand = limb(glove, 0.06, 0.07, 0.11, 0.0, -0.05, -0.16 * bs, 0.2, 0, 0);
    const lArm = limb(sleeve, 0.08, 0.08, 0.3, -0.03, -0.13, -0.04, 0.5, 0.2, 0.12);
    gun.add(rHand, rArm, lHand, lArm);
    return { gun, muzzle };
  }

  fire(scoped = false): void {
    // スコープ武器はボルト排莢のように大きく後退・跳ね上げる(BO2 DSRの重い一撃)
    this.kickZ = Math.min(scoped ? 0.2 : 0.08, this.kickZ + (scoped ? 0.18 : 0.045));
    this.kickRot = Math.min(scoped ? 0.34 : 0.18, this.kickRot + (scoped ? 0.22 : 0.09));
    this.flashTimer = scoped ? 0.03 : 0.045;
    // スコープ武器のみ、約180ms後にボルト閉鎖の小さな揺り戻しを入れる
    if (scoped) this.counterKickTimer = 0.18;
  }

  // 着地の瞬間に呼ぶ。強さ(0..1)に応じて銃が一度沈んで戻る
  applyLandBob(strength: number): void {
    this.landBobTimer = 0.28;
    this.landBobStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  muzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  // 試合破棄時に呼ぶ。キャッシュ済みの非アクティブな銃(切替で外した方)は
  // シーングラフから外れていてMatch.disposeのtraverseに拾われないため、
  // ここで全キャッシュとフラッシュメッシュのGPU資源を明示的に解放する。
  // geometry は常に、material は固有(非shared)のみ解放。共有シングルトンと
  // accentキャッシュは最後に1度だけ解放(二重freeなし)。2回呼んでも例外なし。
  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.gun.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mat = node.material as THREE.Material;
          if (mat.userData.shared !== true) mat.dispose();
        }
      });
    }
    this.cache.clear();
    this.flashMesh.geometry.dispose();
    (this.flashMesh.material as THREE.Material).dispose();
    disposeShared();
  }

  update(
    dt: number,
    state: {
      adsProgress: number;
      mouseDX: number;
      mouseDY: number;
      moveFactor: number;
      grounded: boolean;
      reloadRatio: number | null; // 0..1、リロード中以外はnull
      raiseRatio: number; // 1=構え直し開始直後、0=構え完了
      motionScale: number; // 画面揺れ軽減で1未満になる
      alive: boolean; // 死亡中は銃を隠す
      scopeReveal01: number; // スコープ覗き込み度。1に近いほど銃を引っ込めて隠す
      sprinting?: boolean; // スプリント中は銃を下げる(戦闘遷移コストの可視化)
    },
  ): void {
    const ads = state.adsProgress;

    const swayTargetX =
      THREE.MathUtils.clamp(-state.mouseDX * 0.0011, -0.03, 0.03) *
      (1 - ads * 0.85) *
      state.motionScale;
    const swayTargetY =
      THREE.MathUtils.clamp(state.mouseDY * 0.0011, -0.03, 0.03) *
      (1 - ads * 0.85) *
      state.motionScale;
    this.swayX += (swayTargetX - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (swayTargetY - this.swayY) * Math.min(1, dt * 10);

    if (state.grounded && state.moveFactor > 0.05) {
      this.bobPhase += dt * (6 + state.moveFactor * 6);
    }
    const bobAmp = 0.008 * state.moveFactor * (1 - ads * 0.9) * state.motionScale;
    const bobX = Math.sin(this.bobPhase) * bobAmp;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * bobAmp;

    // やや遅い回復で「重い一撃」の余韻を残す
    this.kickZ = Math.max(0, this.kickZ - dt * 0.35);
    this.kickRot = Math.max(0, this.kickRot - dt * 1.0);
    this.flashTimer -= dt;
    this.flashMesh.visible = this.flashTimer > 0;
    this.flashLight.intensity = this.flashTimer > 0 ? 4.0 : 0;
    if (this.flashTimer > 0) {
      this.flashMesh.rotation.z = Math.random() * Math.PI;
    }

    // 着地インパルス: 0.28sかけて一度沈んで戻る半周期サイン
    let landDip = 0;
    if (this.landBobTimer > 0) {
      const phase = 1 - this.landBobTimer / 0.28;
      landDip = Math.sin(phase * Math.PI) * 0.07 * this.landBobStrength * state.motionScale;
      this.landBobTimer = Math.max(0, this.landBobTimer - dt);
    }
    // スプリント時の銃下げ。target -0.08 へ滑らかに追従(覗き込み中は無効)
    const sprintTarget = state.sprinting && ads < 0.2 ? -0.08 : 0;
    this.sprintLower += (sprintTarget - this.sprintLower) * Math.min(1, dt * 8);
    // ボルト閉鎖の揺り戻し(発砲から約180ms、終盤に逆回転)
    let counterKick = 0;
    if (this.counterKickTimer > 0) {
      this.counterKickTimer = Math.max(0, this.counterKickTimer - dt);
      counterKick = -Math.sin((1 - this.counterKickTimer / 0.18) * Math.PI) * 0.04;
    }

    const pos = new THREE.Vector3().lerpVectors(HIP_POSITION, ADS_POSITION, ads);
    pos.x += this.swayX + bobX;
    // スコープを覗き込むほど銃を下げ、完全に覗いたらDOMスコープのため非表示にする
    pos.y +=
      this.swayY +
      bobY +
      LOWERED_OFFSET * state.raiseRatio -
      0.55 * state.scopeReveal01 -
      landDip +
      this.sprintLower;
    pos.z += this.kickZ;
    this.root.position.copy(pos);
    this.root.visible = state.alive && state.scopeReveal01 < 0.95;

    let rotX = this.kickRot * 0.6 + counterKick + state.raiseRatio * -0.5;
    let rotZ = 0;
    if (state.reloadRatio !== null) {
      const wave = Math.sin(state.reloadRatio * Math.PI);
      rotX -= wave * 0.55;
      rotZ = wave * 0.25;
      this.root.position.y -= wave * 0.09;
    }
    this.root.rotation.set(rotX, this.swayX * 2, rotZ);
  }
}
