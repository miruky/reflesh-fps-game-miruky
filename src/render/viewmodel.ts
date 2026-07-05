import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ViewModelShape, WeaponDef } from '../game/weapons';
import { classDefault, OPTIC_SPECS, resolveOpticId } from '../game/optics';

const HIP_POSITION = new THREE.Vector3(0.24, -0.22, -0.5);
// ADS 収束座標。X/Z は全武器共通、Y は武器ごとに resolveSightY で動的算出する
// (各銃のサイト=ビード/アイアン/レフレックス/スコープ をカメラ空間 Y=0 の射線へ載せる)。
const ADS_X = 0;
const ADS_Z = -0.42;
const LOWERED_OFFSET = -0.35;
// 銃身・マズルの基準高さ(全シルエット共通)。トレーサー原点もこの高さに乗る
const BARREL_Y = 0.012;

// 頂点カラーの陰影モード。flat=均一、gradY=下暗上明の擬似AO、
// machined=削り出し鋼(急勾配+稜線ベベル)、edgeHi=研磨リム(上端を二次で光らせる)。
type ShadeMode = 'flat' | 'gradY' | 'machined' | 'edgeHi';

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
type HandguardKind = 'none' | 'slim' | 'rail' | 'wood' | 'shroud' | 'vented';
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
  // ── R11 任意ディテール上書き(全て optional・未指定は resolveDetail が導出) ──
  // レシーバ造形。split=アッパー/ロア分割シーム
  receiverStyle?: 'mono' | 'split';
  // 排莢ポート(右面インセット+ブラスデフレクタ)を出すか
  ejectionPort?: boolean;
  // チャージングハンドル種別
  chargingHandle?: 'none' | 'rear' | 'side' | 'top';
  // 上面ピカティニーレール
  railTop?: 'none' | 'short' | 'full';
  // アイアンサイト種別
  ironSight?: 'none' | 'fixed' | 'flip' | 'ghost' | 'bead';
  // グリップ形状
  gripStyle?: 'ar' | 'smg' | 'pistol' | 'wood';
  // 銃身プロファイル
  barrelProfile?: 'plain' | 'fluted' | 'heavy' | 'shroud';
  // 拳銃可動スライド+セレーション
  slide?: boolean;
  // 露出ハンマー(revolver/shotgun-double)
  hammer?: boolean;
  // 放熱スリット本数(0=なし)
  ventSlots?: number;
  // アクセント帯を emissive 化するか(既定 true)
  accentEmissive?: boolean;
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
  // BO2 DSR-50: ブルパップ(弾倉がグリップ後方)・大型4ポートブレーキ・
  // ベンチレーテッドシュラウド・大型スコープ。R8でDSR(yamasemi)専用に追加
  'dsr-bp': {
    receiver: { w: 0.082, h: 0.1, d: 0.38 },
    barrelGauge: 0.038,
    barrelLen: 0.3,
    feed: 'mag-curved',
    feedZ: 0.14,
    handguard: 'vented',
    stock: 'none',
    scope: { r: 0.036, len: 0.22, y: 0.092 },
    boltHandle: true,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.35,
  },
  // 素手: buildGunBody が専用の早期分岐で拳を組むため、この行は網羅性のための最小値
  fists: {
    receiver: { w: 0.01, h: 0.01, d: 0.01 },
    barrelGauge: 0.01,
    barrelLen: 0.01,
    feed: 'none',
    handguard: 'none',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1,
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

// classDefault は optics.ts の単一真実源から import(shape 解決を viewmodel/match/optics で共有)。

// def から行を引く。Record<Union,V> 索引なので noUncheckedIndexedAccess でも undefined にならない。
function resolveSilhouette(def: WeaponDef): Silhouette {
  return SHAPE_SPECS[def.shape ?? classDefault(def.class)];
}

// シルエット行(寸法)から「造形ディテール」を導出する純関数。Silhouette の optional
// 上書きがあれば優先し、無ければクラス/形状から決める。既存17行を1文字も触らずに
// 新ディテールが乗る(後方互換)。enum を増やさず bool/既存enumで表現しswitch改修を避ける。
interface DetailSpec {
  receiverStyle: 'mono' | 'split';
  ejectionPort: boolean;
  charging: 'none' | 'rear' | 'side' | 'top';
  railTop: 'none' | 'short' | 'full';
  iron: 'none' | 'fixed' | 'flip' | 'ghost' | 'bead';
  grip: 'ar' | 'smg' | 'pistol' | 'wood';
  barrelProfile: 'plain' | 'fluted' | 'heavy' | 'shroud';
  slide: boolean;
  hammer: boolean;
  ventSlots: number;
  brassDeflector: boolean;
  accentEmissive: boolean;
}

function resolveDetail(sil: Silhouette, def: WeaponDef): DetailSpec {
  const cls = def.class;
  const shape = def.shape ?? classDefault(cls);
  const isPistolShape = shape === 'pistol' || shape === 'machine-pistol' || shape === 'revolver';
  // アッパー/ロア分割シームを持つ系統(AR/精密/LMG/BR)
  const split = cls === 'ar' || cls === 'sniper' || cls === 'marksman' || cls === 'lmg' || cls === 'br';
  const ejectionPort = sil.ejectionPort ?? (!isPistolShape && !sil.cylinder && sil.feed !== 'none');
  const charging: DetailSpec['charging'] =
    sil.chargingHandle ??
    (sil.boltHandle
      ? 'side'
      : cls === 'ar' || cls === 'br'
        ? 'rear'
        : cls === 'smg' && shape !== 'pdw'
          ? 'side'
          : 'none');
  const railTop: DetailSpec['railTop'] =
    sil.railTop ??
    (sil.scope
      ? 'short'
      : sil.handguard === 'rail' || cls === 'ar' || cls === 'lmg'
        ? 'full'
        : cls === 'smg' || cls === 'br'
          ? 'short'
          : 'none');
  const iron: DetailSpec['iron'] =
    sil.ironSight ??
    (shape === 'shotgun-double'
      ? 'bead'
      : shape === 'shotgun-pump'
        ? 'bead'
        : shape === 'shotgun-auto'
          ? 'ghost'
          : sil.scope
            ? 'none'
            : cls === 'ar' || cls === 'lmg'
              ? 'flip'
              : cls === 'pistol'
                ? 'fixed'
                : 'fixed');
  const grip: DetailSpec['grip'] =
    sil.gripStyle ??
    (shape === 'revolver'
      ? 'wood'
      : shape === 'shotgun-double'
        ? 'wood'
        : cls === 'pistol'
          ? 'pistol'
          : cls === 'smg'
            ? 'smg'
            : 'ar');
  const barrelProfile: DetailSpec['barrelProfile'] =
    sil.barrelProfile ??
    (shape === 'dsr-bp'
      ? 'shroud'
      : cls === 'sniper' || cls === 'marksman'
        ? 'fluted'
        : cls === 'lmg'
          ? 'heavy'
          : 'plain');
  const ventSlots = sil.ventSlots ?? (shape === 'dsr-bp' ? 4 : cls === 'lmg' ? 5 : 0);
  return {
    receiverStyle: sil.receiverStyle ?? (split ? 'split' : 'mono'),
    ejectionPort,
    charging,
    railTop,
    iron,
    grip,
    barrelProfile,
    slide: sil.slide ?? (shape === 'pistol' || shape === 'machine-pistol'),
    hammer: sil.hammer ?? (shape === 'revolver' || shape === 'shotgun-double'),
    ventSlots,
    brassDeflector: ejectionPort && cls !== 'shotgun',
    accentEmissive: sil.accentEmissive ?? true,
  };
}

function assertNever(x: never): never {
  throw new Error(`unexpected variant: ${String(x)}`);
}

// ── 共有マテリアル(頂点カラー系統) ─────────────────────────────────────
// バケツ方式: 系統ごとに1マテリアルへ merge するため、アルベドは頂点カラーで焼く。
// metalVC/polishVC/polyVC/glassThin/glassScope/reflexDot は全銃で1度だけ生成(userData.shared=true)。
// accent は emissive 帯用に tracerColor ごとにキャッシュ。sleeve/glove は腕専用(非merge)。
// 銃はカメラ近接(near 0.05)なので envMapIntensity/emissiveIntensity を抑えて近接Bloomハロを回避。
// ③透過根治: レンズは depthWrite:false の薄透過材へ分割。glassThin=レフレックス開口レンズ
// (ほぼ素通し)、glassScope=倍率スコープ管(やや色付き)。両 DoubleSide で覗き方向不問。
interface SharedMats {
  metalVC: THREE.MeshStandardMaterial; // レシーバ/バレル/レール/greeble(艶消し鋼)
  polishVC: THREE.MeshStandardMaterial; // ボルト/光学リング/銃口crown/シリンダ(研磨鋼)
  polyVC: THREE.MeshStandardMaterial; // ポリマー/木部/グリップ
  glassThin: THREE.MeshBasicMaterial; // 素通しレンズ(reflex/holo/rmr 等・透過・merge除外)
  glassScope: THREE.MeshStandardMaterial; // スコープ管レンズ(倍率・透過・merge除外)
  reflexDot: THREE.MeshBasicMaterial; // 赤ドット(加算・merge除外)
  sleeve: THREE.MeshStandardMaterial; // 腕(袖)
  glove: THREE.MeshStandardMaterial; // 手(手袋)
}
let sharedMats: SharedMats | null = null;
const accentCache = new Map<number, THREE.MeshStandardMaterial>();

function vcMat(metalness: number, roughness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness,
    roughness,
    envMapIntensity: 0.3,
  });
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
    // 素通しレンズ: depthWrite:false でレンズ越しの背後ジオメトリを塞がない。ほぼ透明の
    // 薄い寒色ティント。DoubleSide で接眼/対物どちらから見ても描画する。
    const glassThin = new THREE.MeshBasicMaterial({
      color: 0x8fb8e0,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    glassThin.userData.shared = true;
    // スコープ管レンズ: 素通しより濃いが depthWrite:false で背後を透かす。envMap を抑え
    // 近接Bloomハロを回避。color は arm hex(0x2b2e34/0x161820)と衝突させない(テスト保護)。
    const glassScope = new THREE.MeshStandardMaterial({
      color: 0x233348,
      roughness: 0.05,
      metalness: 0.4,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      envMapIntensity: 0.12,
      side: THREE.DoubleSide,
    });
    glassScope.userData.shared = true;
    // R14: 全光学のドット印を赤・小型・高透過へ(旧: 水色0x7ad1ff/opacity0.68で大きく視界を塞いだ)。
    // 加算合成なので赤でも芯は明るく残るが、透過を上げて背後の標的を隠さない
    const reflexDot = new THREE.MeshBasicMaterial({
      color: 0xff2a1c,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    reflexDot.userData.shared = true;
    sharedMats = {
      metalVC: vcMat(0.62, 0.34),
      polishVC: vcMat(0.9, 0.14),
      polyVC: vcMat(0.0, 0.72),
      glassThin,
      glassScope,
      reflexDot,
      sleeve: clothMat(0x2b2e34, 0.7),
      glove: clothMat(0x161820, 0.55),
    };
  }
  return sharedMats;
}

// アクセント帯: tracerColor を弱emissive化(近接なので intensity 0.5 に抑えて白飛び回避)。
function getAccent(color: number): THREE.MeshStandardMaterial {
  let m = accentCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.2,
      envMapIntensity: 0.3,
    });
    m.userData.shared = true;
    accentCache.set(color, m);
  }
  return m;
}

// 共有シングルトン+accentキャッシュを一度だけ解放(二重freeなし・冪等)。
function disposeShared(): void {
  if (sharedMats) {
    sharedMats.metalVC.dispose();
    sharedMats.polishVC.dispose();
    sharedMats.polyVC.dispose();
    sharedMats.glassThin.dispose();
    sharedMats.glassScope.dispose();
    sharedMats.reflexDot.dispose();
    sharedMats.sleeve.dispose();
    sharedMats.glove.dispose();
    sharedMats = null;
  }
  for (const m of accentCache.values()) m.dispose();
  accentCache.clear();
}

// ── ジオメトリ toolkit(頂点カラーを焼く) ───────────────────────────────
// gun ローカル座標系: -Z が前方、BARREL_Y が銃身中心高さ。
const _colCache = new Map<number, THREE.Color>();
function col(hex: number): THREE.Color {
  let c = _colCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    _colCache.set(hex, c);
  }
  return c;
}

// 頂点カラーを焼く。flat 以外は gun ローカルYの上明下暗で擬似AO(エッジ・面の陰影)を作る。
function setColor(g: THREE.BufferGeometry, color: THREE.Color, shade: ShadeMode): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  if (shade === 'flat') {
    for (let i = 0; i < n; i += 1) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
  } else {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(1e-5, maxY - minY);
    for (let i = 0; i < n; i += 1) {
      const t = (pos.getY(i) - minY) / span;
      let f: number;
      if (shade === 'gradY') {
        f = 0.8 + 0.24 * t; // 下=0.80 / 上=1.04(軽い立体感)
      } else if (shade === 'machined') {
        // 削り出し鋼: 下暗→上明の急勾配 + 上稜(t>0.86)にベベルハイライト。
        // 面内の微細縞(sin)は cyl16/ExtrudeGeometry の頂点密度では塗れず2トーンの
        // artifact になるため入れない(勾配 + 稜線ベベルで削り出し感を出す)。
        f = 0.72 + 0.3 * t + (t > 0.86 ? 0.22 : 0);
      } else {
        // edgeHi: 研磨リム。上端へ向け二次で持ち上げてエッジを強く光らせる
        f = 0.68 + 0.52 * t * t;
      }
      arr[i * 3] = color.r * f;
      arr[i * 3 + 1] = color.g * f;
      arr[i * 3 + 2] = color.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// 面取りボックス(丸角矩形をZ押し出し+前後ベベル)。箱っぽさを消すヒーロー面用。
// 実寸で生成し bakeAt でスケール1配置する(ベベル幅を歪ませないため)。非indexed。
function chamferBox(w: number, h: number, d: number, bevel: number): THREE.BufferGeometry {
  const b = Math.max(0.0008, Math.min(bevel, w * 0.5 - 1e-3, h * 0.5 - 1e-3, d * 0.5 - 1e-3));
  const hw = w / 2;
  const hh = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + b, -hh);
  s.lineTo(hw - b, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + b);
  s.lineTo(hw, hh - b);
  s.quadraticCurveTo(hw, hh, hw - b, hh);
  s.lineTo(-hw + b, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - b);
  s.lineTo(-hw, -hh + b);
  s.quadraticCurveTo(-hw, -hh, -hw + b, -hh);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, d - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb) {
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  }
  return geo;
}

// ── 銃本体ビルダ(ARMORY 3Dプレビューと共用) ──────────────────────────
// 一人称腕(sleeve/glove)は含めない、純粋な銃メッシュ + トレーサー原点muzzle。
export function buildGunBody(def: WeaponDef): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const gun = new THREE.Group();

  // 素手(id/shape='fists')は「クナイ(ニンジャ・ダガー)」を握る。銃は描かず、
  // 細身の刃+切先+鍔+柄(柄巻き)+柄頭リングを低ポリ+頂点カラーで組む。
  // FPVの腕は ViewModel.buildGun 側が右手グリップとして追加する。
  // resolveSightY('fists')=0 契約は不変(ADSで刃が画面中央=射線へ寄る)。
  // 早期分岐は merge toolkit を通さず(近接は1体描画なので寛容)。
  if (def.shape === 'fists') {
    const { metalVC, polishVC } = getShared();
    const accent = getAccent(def.tracerColor); // 刃紋/柄巻きの発光帯(tracerColor)
    const C_STEEL = 0x3a424e; // 研磨鋼(刃)
    const C_DARK = 0x1b1f26; // 峰・鍔の暗鋼
    const C_GRIP = 0x101216; // 柄(黒)
    const blade = new THREE.Group();
    // steel=頂点カラー鋼、glow=accent発光(頂点カラー不要)
    const steel = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      color: number,
      shade: ShadeMode,
      px: number,
      py: number,
      pz: number,
      rx = 0,
      ry = 0,
      rz = 0,
    ): void => {
      setColor(geo, col(color), shade);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      blade.add(m);
    };
    const glow = (
      geo: THREE.BufferGeometry,
      px: number,
      py: number,
      pz: number,
      rx = 0,
      ry = 0,
      rz = 0,
    ): void => {
      const m = new THREE.Mesh(geo, accent);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      blade.add(m);
    };
    // 刃身(薄板・幅Y0.03/厚みX0.013)。切先を前方(-Z)へ
    steel(new THREE.BoxGeometry(0.013, 0.03, 0.22), polishVC, C_STEEL, 'machined', 0, 0.006, -0.3);
    // 峰(暗い芯)を薄く重ねて厚みと稜線を出す
    steel(new THREE.BoxGeometry(0.008, 0.033, 0.2), metalVC, C_DARK, 'gradY', 0, 0.006, -0.3);
    // 切先(四角錐)
    steel(new THREE.ConeGeometry(0.02, 0.1, 4), polishVC, C_STEEL, 'machined', 0, 0.006, -0.46, Math.PI / 2, Math.PI / 4, 0);
    // 刃紋(下端の発光ライン)
    glow(new THREE.BoxGeometry(0.016, 0.006, 0.2), 0, -0.009, -0.3);
    // 鍔(クロスガード)
    steel(new THREE.BoxGeometry(0.075, 0.016, 0.022), metalVC, C_DARK, 'gradY', 0, 0.004, -0.175);
    // 柄(Z軸シリンダ)
    steel(new THREE.CylinderGeometry(0.016, 0.014, 0.13, 8), metalVC, C_GRIP, 'gradY', 0, 0, -0.1, Math.PI / 2, 0, 0);
    // 柄巻き(発光帯を3本)
    for (let i = 0; i < 3; i += 1) {
      glow(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8), 0, 0, -0.13 + i * 0.03, Math.PI / 2, 0, 0);
    }
    // 柄頭 + クナイらしいリング
    steel(new THREE.BoxGeometry(0.026, 0.026, 0.02), metalVC, C_DARK, 'gradY', 0, 0, -0.03);
    steel(new THREE.TorusGeometry(0.02, 0.005, 6, 10), metalVC, C_DARK, 'gradY', 0, 0, -0.008);
    // 順手グリップ・切先やや上の構え(rest)。ADS で逆手へ倒すため vm:kunai として名付ける
    blade.name = FIST_KUNAI;
    blade.position.set(0.02, -0.05, 0);
    blade.rotation.set(-0.12, 0.06, 0);
    gun.add(blade);
    const muzzleF = new THREE.Object3D();
    muzzleF.position.set(0, -0.03, -0.5);
    gun.add(muzzleF);
    return { gun, muzzle: muzzleF };
  }

  const sil = resolveSilhouette(def);
  const det = resolveDetail(sil, def);
  const bs = def.bodyScale ?? sil.bodyScale;
  const r = sil.receiver;
  const gauge = sil.barrelGauge;
  const recD = r.d * bs;
  const recHalf = recD / 2;
  const barLen = sil.barrelLen * bs;
  const barCenterZ = -(recHalf + 0.1 * bs);
  const barFrontZ = barCenterZ - barLen / 2;
  const barR = Math.max(0.006, gauge * 0.5);
  const attachments = def.attachmentIds ?? [];
  const extendedMag = attachments.includes('extended');
  const suppressor = attachments.includes('suppressor');

  const { metalVC, polishVC, polyVC, glassThin, glassScope, reflexDot } = getShared();
  const accent = getAccent(def.tracerColor);

  // ⑤ BO3寒色化: 頂点アルベドをブルースチール寄りへ(実際の陰影はvertexColor gradY+IBL/Bloom)。
  // どれも arm hex 0x2b2e34/0x161820 と不一致(監査済み)。C_WOOD/C_BRASS は暖寒コントラスト維持で据置。
  const C_BASE = 0x2c3340;
  const C_DARK = 0x20242c;
  const C_BARREL = 0x181b22;
  const C_RAIL = 0x14171e;
  const C_RIM = 0x515f74;
  const C_GROOVE = 0x101319;
  const C_POLISH = 0x424b58;
  const C_POLISH_HI = 0x5a6a80;
  const C_POLY = 0x191c22;
  const C_GRIP = 0x21242b;
  const C_WOOD = 0x5b3d24;
  const C_WOOD_HI = 0x6d4a2c;
  const C_BRASS = 0x8a6a2c;

  // 系統別バケツ(merge して1マテリアル・1メッシュへ)。accentFamは発光帯の行き先。
  const metalParts: THREE.BufferGeometry[] = [];
  const polishParts: THREE.BufferGeometry[] = [];
  const polyParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const temps: THREE.BufferGeometry[] = [];
  const accentFam = det.accentEmissive ? accentParts : metalParts;

  // 可動ノード(name='vm:*', rest=identity)。系統バケツを持ち最後にmergeしてGroupへ。
  interface Movable {
    group: THREE.Group;
    metal: THREE.BufferGeometry[];
    polish: THREE.BufferGeometry[];
    poly: THREE.BufferGeometry[];
  }
  const movables: Movable[] = [];
  const newMovable = (name: string): Movable => {
    const mv: Movable = { group: new THREE.Group(), metal: [], polish: [], poly: [] };
    mv.group.name = name;
    movables.push(mv);
    return mv;
  };

  // スクラッチ + 単位テンプレ(merge後まとめて破棄)
  const eul = new THREE.Euler();
  const q = new THREE.Quaternion();
  const vPos = new THREE.Vector3();
  const vScale = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cyl16 = new THREE.CylinderGeometry(1, 1, 1, 16);
  const tplTemps: THREE.BufferGeometry[] = [unitBox, cyl8, cyl16];

  // 単位テンプレを位置・スケール・回転で焼く(indexed→非indexed正規化して頂点カラー付与)
  const bake = (
    family: THREE.BufferGeometry[],
    tpl: THREE.BufferGeometry,
    color: number,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0,
    shade: ShadeMode = 'gradY',
  ): void => {
    eul.set(rx, ry, rz);
    q.setFromEuler(eul);
    vPos.set(px, py, pz);
    vScale.set(sx, sy, sz);
    m4.compose(vPos, q, vScale);
    const c = tpl.clone();
    c.applyMatrix4(m4);
    const g = c.index ? c.toNonIndexed() : c;
    if (g !== c) c.dispose();
    setColor(g, col(color), shade);
    family.push(g);
    temps.push(g);
  };
  // 実寸ジオメトリ(chamferBox/cone/torus/sphere)を所有・配置(スケール1)
  const bakeAt = (
    family: THREE.BufferGeometry[],
    geo: THREE.BufferGeometry,
    color: number,
    px: number,
    py: number,
    pz: number,
    rx = 0,
    ry = 0,
    rz = 0,
    shade: ShadeMode = 'gradY',
  ): void => {
    eul.set(rx, ry, rz);
    q.setFromEuler(eul);
    vPos.set(px, py, pz);
    vScale.set(1, 1, 1);
    m4.compose(vPos, q, vScale);
    geo.applyMatrix4(m4);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    setColor(g, col(color), shade);
    family.push(g);
    temps.push(g);
  };
  const boxP = (
    family: THREE.BufferGeometry[],
    color: number,
    w: number,
    h: number,
    d: number,
    px: number,
    py: number,
    pz: number,
    rx = 0,
    ry = 0,
    rz = 0,
    shade: ShadeMode = 'gradY',
  ): void => bake(family, unitBox, color, px, py, pz, w, h, d, rx, ry, rz, shade);
  const tubeZ = (
    family: THREE.BufferGeometry[],
    color: number,
    radius: number,
    len: number,
    px: number,
    py: number,
    pz: number,
    round = false,
    shade: ShadeMode = 'gradY',
  ): void =>
    bake(family, round ? cyl16 : cyl8, color, px, py, pz, radius, len, radius, Math.PI / 2, 0, 0, shade);
  const coneZ = (
    family: THREE.BufferGeometry[],
    color: number,
    rBack: number,
    rFront: number,
    len: number,
    px: number,
    py: number,
    pz: number,
    shade: ShadeMode = 'gradY',
  ): void => {
    const g = new THREE.CylinderGeometry(rFront, rBack, len, 10);
    bakeAt(family, g, color, px, py, pz, Math.PI / 2, 0, 0, shade);
  };
  // 上面ピカティニーレール(base + クロススラット): 至近でも読める最大の識別子
  const buildRailTop = (len: number, z0: number, yTop: number, width: number): void => {
    boxP(metalParts, C_RAIL, width, 0.006, len, 0, yTop, z0, 0, 0, 0, 'flat');
    const n = Math.max(3, Math.floor(len / 0.014));
    for (let i = 0; i < n; i += 1) {
      const zz = z0 - len / 2 + (i + 0.5) * (len / n);
      boxP(metalParts, i % 2 ? C_RIM : C_RAIL, width * 0.86, 0.004, 0.006, 0, yTop + 0.005, zz, 0, 0, 0, 'flat');
    }
  };
  // 発光アクセントライン: tracerColor を accentFam(発光帯の merge 先=DC不変)へ flat で焼く細帯。
  // 背稜スパイン/マグウェルリップなど「線」で銃を締める演出に使う。
  const accentLine = (w: number, h: number, d: number, x: number, y: number, z: number): void =>
    boxP(accentFam, def.tracerColor, w, h, d, x, y, z, 0, 0, 0, 'flat');

  // ── レシーバ(面取りヒーロー面) + 上稜線リムハイライト + 分割シーム + マグウェル ──
  // ヒーロー面は machined(削り出し鋼)で塗り、至近の主面に稜線ハイライトを立てる
  bakeAt(metalParts, chamferBox(r.w, r.h, recD, 0.005), C_BASE, 0, 0, 0, 0, 0, 0, 'machined');
  boxP(metalParts, C_RIM, r.w * 0.52, 0.006, recD * 0.9, 0, r.h / 2 - 0.001, 0, 0, 0, 0, 'flat');
  if (det.receiverStyle === 'split') {
    boxP(metalParts, C_GROOVE, r.w + 0.001, 0.004, recD * 0.84, 0, 0.006, 0, 0, 0, 0, 'flat');
  }
  // 背稜スパイン: レシーバ上稜の発光ライン。full レール時はレール下でZファイト・不可視のため出さない
  if (det.railTop !== 'full') {
    accentLine(0.006, 0.003, recD * 0.7, 0, r.h / 2 + 0.004, 0);
  }
  // マグウェルリップ: 着脱弾倉系の給弾口を発光帯で縁取る(底面共面を避け -r.h/2-0.004 へ)
  if (sil.feed === 'mag-curved' || sil.feed === 'mag-straight' || sil.feed === 'box' || sil.feed === 'drum') {
    accentLine(r.w * 0.72, 0.004, 0.06, 0, -r.h / 2 - 0.004, sil.feedZ ?? -0.03);
  }
  if (det.grip === 'ar' && sil.feed !== 'none' && sil.feed !== 'belt' && sil.feed !== 'tube') {
    bakeAt(metalParts, chamferBox(r.w + 0.012, 0.05, 0.06, 0.004), C_DARK, 0, -r.h / 2 + 0.006, -0.02);
  }

  // ⑤ 装甲ディテール(縦リブ+装甲プレート+発光シーム)。metalParts/accentFam へ merge=DC不変。
  // det.grip==='ar' ゲートで pistol/revolver/dual/fists/smg を除外(長物のみ)。排莢ポートは
  // 右面なので装甲リブは左面へ寄せて重複を避ける。頂点微増のみ(+DC ゼロ)。
  if (det.grip === 'ar') {
    for (let i = 0; i < 3; i += 1) {
      boxP(metalParts, C_RIM, 0.004, r.h * 0.5, 0.006, -(r.w / 2 + 0.002), 0.006, -recD * 0.16 + i * 0.05, 0, 0, 0, 'flat');
    }
    accentLine(0.003, 0.003, recD * 0.5, -(r.w / 2 - 0.004), r.h / 2 - 0.008, -recD * 0.02);
    bakeAt(metalParts, chamferBox(r.w + 0.006, 0.018, recD * 0.3, 0.003), C_POLISH, 0, -r.h / 2 + 0.004, -recD * 0.2, 0, 0, 0, 'flat');
  }

  // ── バレル + プロファイル ──
  if (sil.twinBarrel) {
    const off = barR + 0.004;
    for (const sy of [1, -1] as const) {
      tubeZ(metalParts, C_BARREL, barR, barLen, 0, BARREL_Y + sy * off, barCenterZ, true);
    }
    boxP(metalParts, C_RIM, 0.006, 0.004, barLen * 0.92, 0, BARREL_Y + off + barR, barCenterZ, 0, 0, 0, 'flat');
    bakeAt(metalParts, chamferBox(r.w * 0.9, r.h * 0.72, 0.05, 0.004), C_DARK, 0, BARREL_Y, -recHalf + 0.012);
  } else {
    tubeZ(metalParts, C_BARREL, barR, barLen, 0, BARREL_Y, barCenterZ, true);
    if (det.barrelProfile === 'fluted') {
      const flN = 6;
      for (let i = 0; i < flN; i += 1) {
        const a = (i / flN) * Math.PI * 2;
        boxP(
          metalParts,
          C_GROOVE,
          0.003,
          0.003,
          barLen * 0.55,
          Math.cos(a) * barR * 0.92,
          BARREL_Y + Math.sin(a) * barR * 0.92,
          barCenterZ,
          0,
          0,
          0,
          'flat',
        );
      }
    } else if (det.barrelProfile === 'heavy') {
      tubeZ(metalParts, C_DARK, barR + 0.008, barLen * 0.5, 0, BARREL_Y, barCenterZ + barLen * 0.22, true);
    }
  }

  // ── ハンドガード ──
  switch (sil.handguard) {
    case 'none':
      break;
    case 'slim': {
      bakeAt(metalParts, chamferBox(gauge + 0.014, gauge + 0.014, barLen * 0.62, 0.004), C_DARK, 0, BARREL_Y, barCenterZ + barLen * 0.12);
      for (const sx of [-1, 1] as const) {
        for (let i = 0; i < 3; i += 1) {
          boxP(metalParts, C_GROOVE, 0.003, gauge * 0.6, 0.012, sx * (gauge * 0.5 + 0.008), BARREL_Y, barCenterZ + (i - 1) * 0.03, 0, 0, 0, 'flat');
        }
      }
      break;
    }
    case 'rail': {
      bakeAt(metalParts, chamferBox(gauge + 0.02, gauge + 0.02, barLen * 0.7, 0.004), C_DARK, 0, BARREL_Y, barCenterZ + barLen * 0.05);
      for (const sx of [-1, 1] as const) {
        for (let i = 0; i < 3; i += 1) {
          boxP(metalParts, C_GROOVE, 0.004, 0.01, 0.03, sx * (gauge * 0.5 + 0.012), BARREL_Y, barCenterZ + (i - 1) * 0.045, 0, 0, 0, 'flat');
        }
      }
      break;
    }
    case 'wood': {
      bakeAt(polyParts, chamferBox(gauge + 0.022, gauge + 0.022, barLen * 0.7, 0.006), C_WOOD, 0, BARREL_Y - 0.004, barCenterZ + barLen * 0.1);
      boxP(polyParts, C_WOOD_HI, gauge * 0.5, 0.004, barLen * 0.6, 0, BARREL_Y + gauge * 0.5, barCenterZ + barLen * 0.1, 0, 0, 0, 'flat');
      break;
    }
    case 'shroud': {
      bakeAt(metalParts, chamferBox(gauge + 0.03, gauge + 0.03, barLen * 0.85, 0.005), C_DARK, 0, BARREL_Y, barCenterZ);
      const vn = Math.max(3, det.ventSlots || 5);
      for (let i = 0; i < vn; i += 1) {
        const zz = barCenterZ - barLen * 0.32 + (i * (barLen * 0.64)) / (vn - 1);
        for (const sx of [-1, 1] as const) {
          boxP(metalParts, C_GROOVE, 0.004, gauge * 0.9, 0.01, sx * (gauge * 0.5 + 0.014), BARREL_Y, zz, 0, 0, 0, 'flat');
        }
      }
      break;
    }
    case 'vented': {
      bakeAt(metalParts, chamferBox(gauge + 0.034, gauge + 0.03, barLen * 0.8, 0.005), C_DARK, 0, BARREL_Y, barCenterZ);
      const vn = Math.max(3, det.ventSlots || 4);
      for (let i = 0; i < vn; i += 1) {
        const zz = barCenterZ - barLen * 0.3 + (i * (barLen * 0.6)) / (vn - 1);
        boxP(metalParts, C_GROOVE, gauge + 0.04, 0.006, 0.014, 0, BARREL_Y + 0.006, zz, 0, 0, 0, 'flat');
        boxP(metalParts, C_GROOVE, gauge + 0.04, 0.006, 0.014, 0, BARREL_Y - 0.01, zz, 0, 0, 0, 'flat');
      }
      for (const sx of [-1, 1] as const) {
        boxP(metalParts, C_RIM, 0.006, 0.012, barLen * 0.7, sx * (gauge + 0.02), BARREL_Y + 0.012, barCenterZ, 0, 0, 0, 'flat');
      }
      break;
    }
    default:
      assertNever(sil.handguard);
  }

  // ── 上面レール ──
  if (det.railTop !== 'none') {
    const railLen = det.railTop === 'full' ? recD * 0.7 : recD * 0.34;
    buildRailTop(railLen, -recD * 0.1, r.h / 2 + 0.006, r.w * 0.6);
  }

  // ── アイアンサイト(scope機は省略=光学優先) ──
  // R15: 参考画像のスタイルへ統一 — 後照星は外・上へ角度をつけた「耳」2本(基部に琥珀アクセント)、
  // 前照星は小さな琥珀の発光ビード。暗所でも消えず、耳の間に小さな琥珀点を合わせて狙う。
  if (!sil.scope) {
    const amberMat = getAccent(0xffab1e); // 琥珀ファイバ(shared+disposeSharedで解放)
    const amberDot = (x: number, y: number, z: number, r: number): void => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), amberMat);
      d.position.set(x, y, z);
      gun.add(d);
    };
    // 後照星の「耳」2本(黒ポストを外へロール)+ 基部の琥珀点(参考画像の耳の付け根の光)。
    // ①R16: 枠を広めに開き超見やすく — 耳を左右へ広げ(X 0.028)・強くロール(0.34)・大きく(h0.04/w0.010)、
    // 基部の琥珀点も外・上へ(x0.022/y0.060/r0.003)。bead機(ショットガン)は前ビードがバレル上(高い)で
    // 耳と挟まないため耳を出さず単ビード構成に。
    if (det.iron !== 'bead') {
      // full-rail機は耳を少し上げて上端レール線に枠を揃える。0.078まで上げると前ビード(y=0.062)が
      // 枠の底に突く(底突き)ため 0.072 で止める。他機は 0.066。
      const earPy = det.railTop === 'full' ? 0.072 : 0.066;
      for (const sx of [-1, 1] as const) {
        boxP(metalParts, C_DARK, 0.01, 0.04, 0.01, sx * 0.028, earPy, -recD - 0.006, 0, 0, sx * 0.34);
        amberDot(sx * 0.022, 0.06, -recD - 0.009, 0.003);
      }
    }
    if (det.iron === 'bead') {
      // ショットガン等: バレル上の前照星ビード(brassはresolveSightY契約=polish top cluster)
      const bead = new THREE.SphereGeometry(0.006, 10, 8);
      bakeAt(polishParts, bead, C_BRASS, 0, BARREL_Y + gauge * 0.6, barFrontZ + 0.02, 0, 0, 0, 'flat');
      amberDot(0, BARREL_Y + gauge * 0.6, barFrontZ + 0.024, 0.0026);
    } else if (det.iron !== 'none') {
      // 前照星の小ポスト(黒・やや太く0.006)+ 目立つ琥珀ビード(0.0032)。狙点=resolveSightY 0.062 に一致・
      // 凍結(x0/y0.062/z0.14 は不変)。広げた耳の間に中央で載る。
      boxP(metalParts, C_DARK, 0.006, 0.018, 0.007, 0, 0.056, 0.14);
      amberDot(0, 0.062, 0.14, 0.0032);
    }
  }

  // ── グリップ + トリガーガード ──
  {
    const gripGeo = chamferBox(0.05, 0.135, 0.056, 0.006);
    bakeAt(polyParts, gripGeo, det.grip === 'wood' ? C_WOOD : C_GRIP, 0, -0.1, 0.1, 0.3, 0, 0);
    for (let i = 0; i < 3; i += 1) {
      boxP(polyParts, C_GROOVE, 0.052, 0.004, 0.05, 0, -0.075 - i * 0.022, 0.108, 0.3, 0, 0, 'flat');
    }
    boxP(metalParts, C_DARK, 0.01, 0.024, 0.04, 0, -0.045, 0.03);
    boxP(metalParts, C_DARK, 0.04, 0.008, 0.012, 0, -0.062, 0.05, 0, 0, 0, 'flat');
  }

  // ── 給弾部(着脱弾倉/フォアエンドは可動 vm:*) ──
  switch (sil.feed) {
    case 'mag-curved': {
      const mv = newMovable('vm:magazine');
      const h = extendedMag ? 0.18 : 0.13;
      const segs = 3;
      const baseY = extendedMag ? -0.135 : -0.11;
      const z0 = sil.feedZ ?? -0.04;
      for (let i = 0; i < segs; i += 1) {
        const t = i / (segs - 1);
        bakeAt(
          mv.poly,
          chamferBox(0.044, h / segs + 0.006, 0.066, 0.004),
          C_POLY,
          0,
          baseY + (t - 0.5) * h * 0.66,
          z0 + t * 0.012,
          -0.15 - t * 0.05,
          0,
          0,
        );
      }
      boxP(mv.metal, C_RIM, 0.046, 0.01, 0.062, 0, baseY + h * 0.42, z0, -0.15, 0, 0, 'flat');
      boxP(mv.poly, C_GROOVE, 0.046, 0.006, 0.05, 0, baseY, z0, -0.15, 0, 0, 'flat');
      break;
    }
    case 'mag-straight': {
      const mv = newMovable('vm:magazine');
      const h = extendedMag ? 0.2 : 0.15;
      const y = extendedMag ? -0.145 : -0.12;
      const z0 = sil.feedZ ?? -0.02;
      bakeAt(mv.poly, chamferBox(0.04, h, 0.058, 0.004), C_POLY, 0, y, z0);
      boxP(mv.metal, C_RIM, 0.042, 0.01, 0.056, 0, y + h * 0.42, z0, 0, 0, 0, 'flat');
      break;
    }
    case 'horizontal': {
      const mv = newMovable('vm:magazine');
      bakeAt(mv.poly, chamferBox(0.05, 0.03, 0.16 * bs, 0.004), C_POLY, 0, 0.055, barCenterZ + 0.02);
      for (let i = 0; i < 5; i += 1) {
        boxP(mv.poly, C_GROOVE, 0.05, 0.004, 0.006, 0, 0.07, barCenterZ - 0.05 + i * 0.025, 0, 0, 0, 'flat');
      }
      break;
    }
    case 'drum': {
      const mv = newMovable('vm:magazine');
      tubeZ(mv.poly, C_POLY, 0.07, 0.05, 0, -0.12, sil.feedZ ?? -0.02, true);
      for (const a of [0.6, 2.2] as const) {
        boxP(mv.metal, C_RIM, 0.11, 0.006, 0.03, 0, -0.12, (sil.feedZ ?? -0.02) + 0.026, 0, 0, a, 'flat');
      }
      break;
    }
    case 'box': {
      const mv = newMovable('vm:magazine');
      bakeAt(mv.poly, chamferBox(0.068, 0.12, 0.078, 0.005), C_POLY, 0, -0.105, sil.feedZ ?? -0.05);
      boxP(mv.metal, C_RIM, 0.07, 0.01, 0.08, 0, -0.05, sil.feedZ ?? -0.05, 0, 0, 0, 'flat');
      break;
    }
    case 'belt': {
      bakeAt(metalParts, chamferBox(0.09, 0.11, 0.13, 0.005), C_DARK, 0, -0.1, -0.05);
      for (let i = 0; i < 4; i += 1) {
        boxP(polishParts, C_BRASS, 0.012, 0.016, 0.012, 0.012 - i * 0.008, -0.03 - i * 0.006, -0.1 - i * 0.004, 0, 0, 0.3, 'flat');
      }
      break;
    }
    case 'tube': {
      tubeZ(metalParts, C_BARREL, 0.015, 0.22 * bs, 0, -0.025, -0.24 * bs, true);
      const mv = newMovable('vm:forend');
      bakeAt(mv.poly, chamferBox(0.055, 0.045, 0.12, 0.006), C_POLY, 0, -0.03, -0.16);
      for (let i = 0; i < 4; i += 1) {
        boxP(mv.poly, C_GROOVE, 0.057, 0.004, 0.008, 0, -0.008, -0.2 + i * 0.026, 0, 0, 0, 'flat');
      }
      break;
    }
    case 'none':
      break;
    default:
      assertNever(sil.feed);
  }

  // ── ストック ──
  const stockZ = recHalf + 0.05 * bs;
  switch (sil.stock) {
    case 'none':
      break;
    case 'fixed': {
      bakeAt(
        det.grip === 'wood' ? polyParts : metalParts,
        chamferBox(0.05, 0.075, 0.13, 0.006),
        det.grip === 'wood' ? C_WOOD : C_DARK,
        0,
        -0.02,
        stockZ + 0.04,
      );
      if (det.barrelProfile === 'fluted') {
        boxP(metalParts, C_DARK, 0.03, 0.02, 0.08, 0, 0.03, stockZ + 0.03);
      }
      break;
    }
    case 'folding': {
      bakeAt(metalParts, chamferBox(0.04, 0.05, 0.09, 0.005), C_DARK, 0.035, -0.01, stockZ);
      break;
    }
    case 'skeleton': {
      boxP(metalParts, C_DARK, 0.04, 0.012, 0.14, 0, 0.03, stockZ + 0.05);
      boxP(metalParts, C_DARK, 0.04, 0.012, 0.12, 0, -0.05, stockZ + 0.04);
      boxP(metalParts, C_DARK, 0.04, 0.09, 0.014, 0, -0.01, stockZ + 0.11);
      break;
    }
    default:
      assertNever(sil.stock);
  }
  // スリングループ(静的・長物のみ)
  if (sil.stock !== 'none') {
    const loop = new THREE.TorusGeometry(0.008, 0.0025, 6, 10);
    bakeAt(metalParts, loop, C_DARK, -(r.w / 2), -0.02, stockZ - 0.02, Math.PI / 2, 0, 0, 'flat');
  }

  // ── 排莢ポート(右面インセット) + ボルト面 + ブラスデフレクタ ──
  if (det.ejectionPort) {
    const px = r.w / 2 + 0.001;
    const pz = -recD * 0.12;
    boxP(metalParts, C_GROOVE, 0.006, 0.03, 0.055, px, 0.01, pz, 0, 0, 0, 'flat');
    boxP(polishParts, C_POLISH_HI, 0.004, 0.022, 0.04, px + 0.003, 0.01, pz, 0, 0, 0, 'flat');
    if (det.brassDeflector) {
      boxP(metalParts, C_RIM, 0.014, 0.02, 0.02, px + 0.004, 0.006, pz + 0.03, 0, -0.5, 0, 'flat');
    }
  }

  // ── チャージング/ボルトハンドル(可動) ──
  if (det.charging === 'rear') {
    const mv = newMovable('vm:charging');
    boxP(mv.polish, C_POLISH, 0.04, 0.014, 0.014, 0, r.h / 2 + 0.006, recHalf - 0.02, 0, 0, 0, 'flat');
    boxP(mv.polish, C_POLISH, 0.012, 0.012, 0.05, 0, r.h / 2 + 0.006, recHalf + 0.005, 0, 0, 0, 'flat');
  } else if (det.charging === 'side') {
    const mv = newMovable(sil.boltHandle ? 'vm:bolt' : 'vm:charging');
    boxP(mv.polish, C_POLISH, 0.012, 0.012, 0.04, 0.05, 0.012, 0.06, 0, 0, 0, 'flat');
    const knob = new THREE.SphereGeometry(0.012, 10, 8);
    bakeAt(mv.polish, knob, C_POLISH_HI, 0.066, 0.012, 0.06, 0, 0, 0, 'flat');
  }

  // ── 一体型光学(スコープ)── ③透過根治
  // 主筒を openEnded 化(接眼キャップ除去)、ベゼル/前アクセントを中空アニュラス(RingGeometry)
  // へ差し替えて bore 中心を開放。接眼→透明glassR→開放bore→透明glassF→ワールド の視軸を通す。
  // 座標(s.y)不変で resolveSightY 契約に無影響。glassScope+renderOrder=2 で近接ソート安定。
  if (sil.scope) {
    const s = sil.scope;
    // openEnded 主筒(キャップ無し)。共有 cyl16 は openEnded=false のため fresh を焼く(temps 経由で dispose)。
    const tube = new THREE.CylinderGeometry(s.r, s.r, s.len, 16, 1, true);
    bakeAt(metalParts, tube, C_DARK, 0, s.y, -0.02, Math.PI / 2, 0, 0, 'gradY');
    // 前後ベゼルは中空アニュラス(既定XY面=±Z向き・無回転)。polishParts へ merge=+0DC。
    for (const zz of [-0.02 - s.len / 2 + 0.01, -0.02 + s.len / 2 - 0.01] as const) {
      const bezel = new THREE.RingGeometry(s.r - 0.001, s.r + 0.006, 20);
      bakeAt(polishParts, bezel, C_POLISH, 0, s.y, zz, 0, 0, 0, 'flat');
    }
    // タレット(上/横)は bore を塞がない位置なのでソリッドのまま。
    for (const zz of [-0.03, 0.03] as const) {
      boxP(metalParts, C_DARK, 0.03, 0.04, 0.022, 0, s.y - 0.03, zz);
    }
    boxP(polishParts, C_POLISH, 0.02, 0.022, 0.024, 0, s.y + s.r, -0.02);
    boxP(polishParts, C_POLISH, 0.024, 0.02, 0.02, s.r, s.y, -0.02);
    const frontZ = -0.02 - s.len / 2;
    // 前アクセントリングも中空アニュラス(accentFam へ merge)。bore 中心を開放。
    const accRing = new THREE.RingGeometry(s.r - 0.001, s.r + 0.006, 20);
    bakeAt(accentFam, accRing, def.tracerColor, 0, s.y, frontZ + 0.004, 0, 0, 0, 'flat');
    // レンズ(glassScope・透過・renderOrder=2)。CircleGeometry の最初=対物 glassF(=s.y)を維持。
    const glassF = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.86, 20), glassScope);
    glassF.rotation.y = Math.PI;
    glassF.position.set(0, s.y, frontZ - 0.001);
    glassF.renderOrder = 2;
    const glassR = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.82, 20), glassScope);
    glassR.position.set(0, s.y, -0.02 + s.len / 2 + 0.001);
    glassR.renderOrder = 2;
    gun.add(glassF, glassR);
  }

  // ── アクセント帯(tracerColor・弱emissive) ──
  switch (sil.accentBand) {
    case 'receiver':
      boxP(accentFam, def.tracerColor, r.w + 0.003, 0.016, 0.1, 0, 0.028, 0.08, 0, 0, 0, 'flat');
      break;
    case 'handguard':
      boxP(accentFam, def.tracerColor, gauge + 0.016, 0.012, barLen * 0.4, 0, BARREL_Y + gauge * 0.6, barCenterZ, 0, 0, 0, 'flat');
      break;
    case 'stock':
      boxP(accentFam, def.tracerColor, 0.04, 0.014, 0.06, 0, 0.0, recHalf + 0.06 * bs, 0, 0, 0, 'flat');
      break;
    case 'slide':
      boxP(accentFam, def.tracerColor, r.w + 0.004, 0.012, recD * 0.5, 0, r.h / 2 - 0.004, -recD * 0.12, 0, 0, 0, 'flat');
      break;
    default:
      assertNever(sil.accentBand);
  }

  // ── 回転シリンダ(可動 vm:cylinder) + エジェクターロッド ──
  // ピボット(bore中心)を group.position に置き、パーツはピボット基準ローカルで焼く。
  // rest(rotation=0)は従来と同一の見た目で、回転はローカルZ軸で in-place に回る。
  if (sil.cylinder) {
    const mv = newMovable('vm:cylinder');
    mv.group.position.set(0, -0.01, 0.04);
    tubeZ(mv.polish, C_POLISH, 0.032, 0.05, 0, 0, 0, true);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      boxP(mv.polish, C_GROOVE, 0.004, 0.004, 0.05, Math.cos(a) * 0.026, Math.sin(a) * 0.026, 0, 0, 0, 0, 'flat');
    }
    tubeZ(metalParts, C_DARK, 0.006, barLen * 0.7, 0, BARREL_Y - gauge * 0.6, barCenterZ, true);
  }
  if (det.hammer) {
    boxP(polishParts, C_POLISH_HI, 0.01, 0.02, 0.014, 0, r.h / 2 + 0.004, recHalf - 0.01);
  }

  // ── 拳銃スライド(可動 vm:slide) + セレーション + サイト ──
  if (det.slide) {
    const mv = newMovable('vm:slide');
    bakeAt(mv.metal, chamferBox(r.w + 0.006, 0.03, recD * 0.92, 0.004), C_BASE, 0, r.h / 2 - 0.008, -recD * 0.02, 0, 0, 0, 'machined');
    for (let i = 0; i < 6; i += 1) {
      boxP(mv.metal, C_GROOVE, r.w + 0.008, 0.02, 0.004, 0, r.h / 2 - 0.008, recHalf * 0.5 - i * 0.01, 0, 0, 0, 'flat');
    }
    boxP(mv.metal, C_DARK, 0.008, 0.01, 0.008, 0, r.h / 2 + 0.006, -recD * 0.42);
    boxP(mv.metal, C_DARK, 0.02, 0.012, 0.01, 0, r.h / 2 + 0.006, recHalf * 0.7);
  }

  // ── マズルデバイス / サプレッサ(muzzle.z 契約: サプレッサで前進) ──
  let muzzleZ: number;
  if (suppressor) {
    const suppZ = barFrontZ - 0.06 * bs;
    tubeZ(metalParts, C_DARK, 0.026, 0.14, 0, BARREL_Y, suppZ, true);
    for (let i = 0; i < 4; i += 1) {
      boxP(metalParts, C_GROOVE, 0.054, 0.004, 0.006, 0, BARREL_Y + 0.026, suppZ - 0.05 + i * 0.03, 0, 0, 0, 'flat');
    }
    muzzleZ = suppZ - 0.075;
  } else {
    switch (sil.muzzle) {
      case 'none': {
        // 可視マズルクラウン: バレル外径よりわずかに太い研磨リング(edgeHi)で銃口を縁取る。
        // round=false(cyl8)で頂点半減。旧 barR*0.7 はバレル内部埋没で不可視だった
        tubeZ(polishParts, C_POLISH_HI, barR * 1.02, 0.012, 0, BARREL_Y, barFrontZ - 0.004, false, 'edgeHi');
        muzzleZ = barFrontZ - 0.01 * bs;
        break;
      }
      case 'brake': {
        bakeAt(metalParts, chamferBox(gauge * 2.4, gauge * 2.0, 0.085, 0.004), C_DARK, 0, BARREL_Y, barFrontZ - 0.042);
        boxP(metalParts, C_GROOVE, gauge * 1.6, 0.006, 0.02, 0, BARREL_Y + gauge * 1.02, barFrontZ - 0.028, 0, 0, 0, 'flat');
        boxP(metalParts, C_GROOVE, gauge * 1.6, 0.006, 0.02, 0, BARREL_Y + gauge * 1.02, barFrontZ - 0.06, 0, 0, 0, 'flat');
        boxP(metalParts, C_GROOVE, 0.006, gauge * 1.3, 0.05, -gauge * 1.24, BARREL_Y, barFrontZ - 0.042, 0, 0, 0, 'flat');
        boxP(metalParts, C_GROOVE, 0.006, gauge * 1.3, 0.05, gauge * 1.24, BARREL_Y, barFrontZ - 0.042, 0, 0, 0, 'flat');
        // 可視マズルクラウン(cyl8・edgeHi 研磨リム)。ブレーキ本体前端の銃口を縁取る
        tubeZ(polishParts, C_POLISH_HI, barR * 1.02, 0.012, 0, BARREL_Y, barFrontZ - 0.004, false, 'edgeHi');
        muzzleZ = barFrontZ - 0.1;
        break;
      }
      case 'flash': {
        coneZ(metalParts, C_DARK, gauge * 0.75, gauge * 0.55, 0.04, 0, BARREL_Y, barFrontZ - 0.02);
        for (let i = 0; i < 3; i += 1) {
          const a = (i / 3) * Math.PI * 2;
          boxP(metalParts, C_GROOVE, 0.003, gauge * 0.5, 0.03, Math.cos(a) * gauge * 0.5, BARREL_Y + Math.sin(a) * gauge * 0.5, barFrontZ - 0.02, 0, 0, 0, 'flat');
        }
        muzzleZ = barFrontZ - 0.05;
        break;
      }
      case 'shroud': {
        tubeZ(metalParts, C_DARK, gauge + 0.01, 0.05, 0, BARREL_Y, barFrontZ - 0.025, true);
        muzzleZ = barFrontZ - 0.06;
        break;
      }
      default:
        muzzleZ = barFrontZ - 0.01 * bs;
        assertNever(sil.muzzle);
    }
  }
  // machine-pistol コンペンセイター(slide持ち・裸口のとき)
  if (det.slide && sil.muzzle === 'none' && !suppressor) {
    boxP(metalParts, C_DARK, gauge * 1.4, gauge * 1.2, 0.02, 0, BARREL_Y, barFrontZ - 0.01);
  }

  // ── 着脱式光学(OPTIC_SPECS.housing 別)── ③スコープ種類を倍増
  // 共有ヘルパ: openEnded 筒 + 中空アニュラス + glassScope レンズの倍率スコープ管を焼く。
  // 筒/リング/マウントは metalParts/polishParts/accentFam へ merge(+0DC)、レンズのみ透明add。
  const mountedScopeTube = (
    sy: number,
    tr: number,
    tlen: number,
    cz = 0,
    accentColor = def.tracerColor,
  ): void => {
    const tube = new THREE.CylinderGeometry(tr, tr, tlen, 16, 1, true);
    bakeAt(metalParts, tube, C_DARK, 0, sy, cz, Math.PI / 2, 0, 0, 'gradY');
    for (const zz of [cz - tlen / 2 + 0.008, cz + tlen / 2 - 0.008] as const) {
      const ring = new THREE.RingGeometry(tr - 0.001, tr + 0.005, 18);
      bakeAt(polishParts, ring, C_POLISH, 0, sy, zz, 0, 0, 0, 'flat');
    }
    boxP(metalParts, C_DARK, tr * 1.3, 0.02, tlen * 0.42, 0, sy - tr - 0.012, cz, 0, 0, 0, 'flat');
    const acc = new THREE.RingGeometry(tr - 0.001, tr + 0.005, 18);
    bakeAt(accentFam, acc, accentColor, 0, sy, cz - tlen / 2 + 0.001, 0, 0, 0, 'flat');
    const lensF = new THREE.Mesh(new THREE.CircleGeometry(tr * 0.85, 18), glassScope);
    lensF.rotation.y = Math.PI;
    lensF.position.set(0, sy, cz - tlen / 2 - 0.001);
    lensF.renderOrder = 2;
    const lensR = new THREE.Mesh(new THREE.CircleGeometry(tr * 0.8, 18), glassScope);
    lensR.position.set(0, sy, cz + tlen / 2 + 0.001);
    lensR.renderOrder = 2;
    gun.add(lensF, lensR);
  };
  // 素通しドット窓: reflexDot は「最初かつ唯一の PlaneGeometry」を維持(ドリフトテスト保護)。
  // レンズは glassThin CircleGeometry(dot より前に Plane を出さない)。y は sy 固定。
  const reflexDotWindow = (sy: number, lensR: number, dotS: number, dz: number): void => {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(lensR, 18), glassThin);
    lens.position.set(0, sy, dz);
    lens.renderOrder = 2;
    const dot = new THREE.Mesh(new THREE.PlaneGeometry(dotS, dotS), reflexDot);
    dot.position.set(0, sy, dz - 0.008);
    dot.renderOrder = 3;
    gun.add(lens, dot);
  };
  // 全着脱 housing は sil.scope===null ガード配下(内蔵scope機は上流で構築済み=二重build回避)。
  if (sil.scope === null) {
    const om = OPTIC_SPECS[resolveOpticId(def)];
    if (om) {
      const sy = om.sightY;
      switch (om.housing) {
        case 'reflex': {
          // 開口フレーム(底レール+上リム+左右ピラー)。bore を塞がず素通し。
          boxP(metalParts, C_DARK, 0.05, 0.01, 0.05, 0, sy - 0.026, 0.05, 0, 0, 0, 'flat');
          boxP(metalParts, C_DARK, 0.05, 0.006, 0.05, 0, sy + 0.022, 0.05, 0, 0, 0, 'flat');
          for (const sx of [-1, 1] as const) {
            boxP(metalParts, C_DARK, 0.006, 0.05, 0.05, sx * 0.023, sy - 0.002, 0.05, 0, 0, 0, 'flat');
          }
          reflexDotWindow(sy, 0.018, 0.006, 0.05);
          break;
        }
        case 'holo': {
          // ホロサイト: 横長フード+後方エミッタ+四角スクリーン(PlaneGeometry)。
          boxP(metalParts, C_DARK, 0.07, 0.012, 0.055, 0, sy - 0.03, 0.05, 0, 0, 0, 'flat');
          boxP(metalParts, C_DARK, 0.012, 0.05, 0.055, -0.032, sy, 0.05, 0, 0, 0, 'flat');
          boxP(metalParts, C_DARK, 0.07, 0.006, 0.012, 0, sy + 0.026, 0.03, 0, 0, 0, 'flat');
          const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.04), glassThin);
          screen.position.set(0, sy, 0.05);
          screen.renderOrder = 2;
          // R15: 他光学のドットに合わせて小型化(旧0.02は突出して大きかった)
          const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.008), reflexDot);
          dot.position.set(0, sy, 0.045);
          dot.renderOrder = 3;
          gun.add(screen, dot);
          break;
        }
        case 'rmr': {
          // ピコ(ミニRMR): フレームのみ ×0.62 縮小、レティクル/レンズ中心は sy 固定。
          const f = 0.62;
          boxP(metalParts, C_DARK, 0.032, 0.008, 0.032, 0, sy - 0.016 * f, 0.05, 0, 0, 0, 'flat');
          for (const sx of [-1, 1] as const) {
            boxP(metalParts, C_DARK, 0.005, 0.03 * f, 0.03, sx * 0.014, sy, 0.05, 0, 0, 0, 'flat');
          }
          boxP(metalParts, C_DARK, 0.032, 0.005, 0.01, 0, sy + 0.016 * f, 0.045, 0, 0, 0, 'flat');
          reflexDotWindow(sy, 0.011, 0.005, 0.05);
          break;
        }
        case 'delta': {
          // デルタ(プリズム)サイト: コンパクト本体+上レール+etchedレティクル。
          bakeAt(metalParts, chamferBox(0.038, 0.05, 0.05, 0.004), C_DARK, 0, sy - 0.01, 0.05);
          boxP(metalParts, C_RIM, 0.038, 0.006, 0.05, 0, sy + 0.016, 0.05, 0, 0, 0, 'flat');
          // R13: レンズ/ドットは筐体の射手側面(z≈0.075)より手前へ。ソリッド箱に潜ると
          // 不透明筐体が先に深度を書き、depthTestでドット断片が破棄されて見えなくなる
          reflexDotWindow(sy, 0.014, 0.006, 0.09);
          break;
        }
        case 'canted': {
          // カンテッド(副照準): 左へ僅かにロールした小型ハウジング。ADS整合のため dot は sy 中心。
          bakeAt(metalParts, chamferBox(0.03, 0.03, 0.04, 0.003), C_DARK, 0, sy - 0.006, 0.055, 0, 0, 0.5);
          // R13: dz を筐体の射手側面(z≈0.075)より手前へ出しドット埋没(深度オクルージョン)を回避
          reflexDotWindow(sy, 0.01, 0.005, 0.088);
          break;
        }
        case 'acog': {
          mountedScopeTube(sy, 0.024, 0.13);
          break;
        }
        case 'variable': {
          mountedScopeTube(sy, 0.026, 0.16);
          const magRing = new THREE.RingGeometry(0.026, 0.032, 16);
          bakeAt(polishParts, magRing, C_POLISH_HI, 0, sy, 0.03, 0, 0, 0, 'flat');
          break;
        }
        case 'thermal': {
          // リコン/暗視スコープ: 素通し倍率管 + 上面センサフード + 琥珀エミッタ。全画面フィルタは
          // HUD 側(sightStyle==='thermal')が担当、ここは housing + 熱センサ発光を表現。
          mountedScopeTube(sy, 0.024, 0.12);
          boxP(metalParts, C_DARK, 0.05, 0.02, 0.05, 0, sy + 0.03, -0.02, 0, 0, 0, 'flat');
          // R13: 琥珀の熱センサ発光。accentFam(固定tracerColor)ではtintが無効化されるため、
          // 単色emissive材(getAccent・非merge・shared+disposeShared解放)で対物リングを灯す
          const amberRing = new THREE.Mesh(
            new THREE.RingGeometry(0.014, 0.023, 18),
            getAccent(typeof om.tint === 'number' ? om.tint : 0xffb060),
          );
          amberRing.position.set(0, sy, -0.062);
          amberRing.rotation.y = Math.PI;
          gun.add(amberRing);
          break;
        }
        case 'hybrid': {
          // ハイブリッド: 前方に赤ドット窓(照準面=sy)、後方に倍率マグ管を同軸配置。
          boxP(metalParts, C_DARK, 0.045, 0.01, 0.04, 0, sy - 0.024, -0.02, 0, 0, 0, 'flat');
          for (const sx of [-1, 1] as const) {
            boxP(metalParts, C_DARK, 0.005, 0.045, 0.04, sx * 0.021, sy, -0.02, 0, 0, 0, 'flat');
          }
          reflexDotWindow(sy, 0.016, 0.006, -0.02);
          mountedScopeTube(sy, 0.02, 0.07, 0.06);
          break;
        }
        case 'scope':
          // 内蔵スコープ: 上流の sil.scope 分岐で構築済み(ここでは何もしない)。
          break;
        default:
          break;
      }
    }
  }
  // ── 着脱テレスコピック(レジストリ外レガシー・倍率マグ)── ③透過根治
  // 主筒 openEnded + 前後リング中空アニュラス + glassScope レンズで覗いて背後が透ける。
  if (attachments.includes('telescopic') && sil.scope === null) {
    const ty = 0.08;
    const tr = 0.026;
    const tube = new THREE.CylinderGeometry(tr, tr, 0.14, 16, 1, true);
    bakeAt(metalParts, tube, C_DARK, 0, ty, 0.0, Math.PI / 2, 0, 0, 'gradY');
    for (const zz of [-0.06, 0.06] as const) {
      const ring = new THREE.RingGeometry(tr - 0.002, tr + 0.006, 18);
      bakeAt(polishParts, ring, C_POLISH, 0, ty, zz, 0, 0, 0, 'flat');
    }
    const gf = new THREE.Mesh(new THREE.CircleGeometry(tr * 0.86, 18), glassScope);
    gf.rotation.y = Math.PI;
    gf.position.set(0, ty, -0.069);
    gf.renderOrder = 2;
    const gr = new THREE.Mesh(new THREE.CircleGeometry(tr * 0.82, 18), glassScope);
    gr.position.set(0, ty, 0.069);
    gr.renderOrder = 2;
    gun.add(gf, gr);
  }
  if (attachments.includes('vertical') || attachments.includes('angled')) {
    const angled = attachments.includes('angled');
    bakeAt(polyParts, chamferBox(0.04, 0.09, 0.05, 0.005), C_POLY, 0, -0.085, -0.2 * bs, angled ? 0.5 : 0, 0, 0);
  }

  // ── 系統別に1メッシュへ畳む + 可動Groupを追加 ──
  const addFamily = (parts: THREE.BufferGeometry[], material: THREE.Material, parent: THREE.Object3D): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    if (!merged) return;
    parent.add(new THREE.Mesh(merged, material));
  };
  addFamily(metalParts, metalVC, gun);
  addFamily(polishParts, polishVC, gun);
  addFamily(polyParts, polyVC, gun);
  addFamily(accentParts, accent, gun);
  for (const mv of movables) {
    addFamily(mv.metal, metalVC, mv.group);
    addFamily(mv.polish, polishVC, mv.group);
    addFamily(mv.poly, polyVC, mv.group);
    gun.add(mv.group);
  }
  // 焼き込みに使った一時ジオメトリ + テンプレを破棄(merge後は不要)
  for (const t of temps) t.dispose();
  for (const t of tplTemps) t.dispose();

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BARREL_Y, muzzleZ);
  gun.add(muzzle);
  return { gun, muzzle };
}

// ADS 収束 Y を武器ごとに算出する純関数。buildGunBody のサイト焼き座標の「鏡写し」であり、
// ADS 時に各銃のサイトがカメラ空間 Y=0(画面中央=射線)へ載るよう root.position.y=-sightY を作る。
// 返す各値は buildGunBody の対応ジオメトリと必ず一致させること(片方だけ動かすと照準がずれる):
//   fists                    → 0                    (拳のみ・サイト無し)
//   built-in scope           → sil.scope.y          (buildGunBody 「一体型光学」 tubeZ(…, s.y, …))
//   reflex 着脱               → 0.08                 (buildGunBody 着脱 reflex dot.position.set(0, 0.08, …))
//   telescopic 着脱(scope無)  → 0.08                (buildGunBody 着脱 telescopic tubeZ(…, 0.08, …))
//   iron bead                → BARREL_Y + gauge*0.6  (buildGunBody アイアンサイト bead bakeAt(…, BARREL_Y+gauge*0.6, …))
//   iron post(fixed/flip/ghost)→ 0.062              (R15: 狙点は前照星の琥珀ビード amberDot(0, 0.062, 0.14, …)。前ポスト箱は y=0.056 に降下)
export function resolveSightY(def: WeaponDef): number {
  if (def.shape === 'fists') return 0;
  // 光学(内蔵スコープ/着脱reflex/holo/…)は OPTIC_SPECS.sightY を単一真実源に。
  // 内蔵スコープは resolveOpticId が shape から scope-dmr/sniper/dsr を最優先で返す。
  const om = OPTIC_SPECS[resolveOpticId(def)];
  if (om) return om.sightY;
  // レジストリ外(iron/telescopic レガシー)のフォールバック。
  const sil = resolveSilhouette(def);
  const attachments = def.attachmentIds ?? [];
  if (attachments.includes('telescopic')) return 0.08;
  const det = resolveDetail(sil, def);
  if (det.iron === 'bead') return BARREL_Y + sil.barrelGauge * 0.6;
  return 0.062;
}

// 可動ノード(buildGunBody が name='vm:*' の Group として分離)の参照束。
// setWeapon で一度だけ引き、毎フレーム探索しない。全て optional(その銃に無ければ undefined)。
interface MovableRig {
  slide?: THREE.Object3D; // 拳銃スライド(前後)
  bolt?: THREE.Object3D; // ボルトアクション(側面ハンドル)
  charging?: THREE.Object3D; // チャージングハンドル(AR/SMG)
  magazine?: THREE.Object3D; // 着脱弾倉(リロードで落下)
  cylinder?: THREE.Object3D; // 回転シリンダ(発砲で回る)
  forend?: THREE.Object3D; // ポンプ・フォアエンド(前後)
}

// ── クナイ(素手)ADS 逆手ダガー構え ─────────────────────────────────────
// 通常(腰だめ)は順手で刃を前方(-Z)へ。ADS 右クリックで「逆手グリップ(刃を下・
// 後ろへ)+右前腕を胸前で横に構える」=進撃の巨人「心臓を捧げよ」風の暗殺者スタンスへ。
// rest(腰だめ)= buildGunBody/buildGun がメッシュを配置する実値、ads = 逆手構えの目標値を
// この1表に集約し、ViewModel.update が adsProgress(視覚イーズ後)で rest→ads を線形補間する。
// 銃(非fists)は該当 vm:* ノードを持たないため完全に非干渉。射線(muzzle)/resolveSightY 契約も不変。
interface FistPose {
  name: string;
  rest: { p: [number, number, number]; r: [number, number, number] };
  ads: { p: [number, number, number]; r: [number, number, number] };
}
const FIST_KUNAI = 'vm:kunai';
const FIST_POSES: FistPose[] = [
  // 刃: 順手(切先-Z前方)→ 逆手(切先を下〜後ろへ倒し、刃腹をカメラへロール)
  { name: FIST_KUNAI, rest: { p: [0.02, -0.05, 0], r: [-0.12, 0.06, 0] }, ads: { p: [-0.05, -0.02, -0.02], r: [-2.0, 0.15, 0.5] } },
  // 右前腕: 右下から胸前へ持ち上げ、Yヨーで画面を横切る水平構えへ(捧げよ心臓)
  { name: 'vm:fistRArm', rest: { p: [0.08, -0.2, 0.12], r: [0.5, -0.12, 0] }, ads: { p: [0.0, -0.11, 0.04], r: [0.12, 0.95, 0.12] } },
  // 右手: 逆手グリップへ回り込む
  { name: 'vm:fistRHand', rest: { p: [0.02, -0.07, -0.09], r: [0.2, 0.05, 0] }, ads: { p: [-0.05, -0.03, -0.04], r: [0.85, 0.1, 0.35] } },
  // 左前腕: 添え手を引いて胸前を空ける
  { name: 'vm:fistLArm', rest: { p: [-0.1, -0.16, -0.02], r: [0.42, 0.24, 0.1] }, ads: { p: [-0.16, -0.24, 0.16], r: [0.6, 0.15, -0.05] } },
  // 左手: 引く
  { name: 'vm:fistLHand', rest: { p: [-0.11, -0.09, -0.16], r: [0.25, 0.1, 0] }, ads: { p: [-0.17, -0.16, 0.04], r: [0.3, 0, 0] } },
];

// カメラ直付けの一人称武器モデル。procedural な銃本体に一人称腕を足し、
// スウェイ・ボブ・リコイルキック・リロードを手続きで動かす。
export class ViewModel {
  readonly root = new THREE.Group();

  private gun: THREE.Group | null = null;
  private muzzle = new THREE.Object3D();
  private flashMesh: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private readonly cache = new Map<string, { gun: THREE.Group; muzzle: THREE.Object3D }>();

  // ADS 収束オフセット。setWeapon で adsY=-resolveSightY(def) をキャッシュし、
  // adsTarget=(ADS_X, adsY, ADS_Z) を毎フレーム lerp 先に使う(_pos はスクラッチで alloc 回避)。
  private adsY = -0.142;
  private readonly adsTarget = new THREE.Vector3(ADS_X, -0.142, ADS_Z);
  private readonly _pos = new THREE.Vector3();

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
  // クナイ斬撃の横キック(右薙ぎ=正/左薙ぎ=負のロール。fire(variation)で加算)
  private kickSide = 0;
  // スプリント中に銃を下げる量(滑らかに追従)。raiseRatioとは独立した加算項
  private sprintLower = 0;
  // 呼吸スウェイ位相(~0.295 Hz サイン波。ADS 収束でゼロ収束)
  private breathPhase = 0;
  // サプレッサー装着状態キャッシュ(setWeapon 時に更新。fire() フラッシュ減光で参照)
  private isSuppressed = false;
  // 可動ノード(vm:*)の参照 + メカアニメ状態。root には触れずローカルのみ動かす(スコープイン非干渉)。
  private rig: MovableRig = {};
  // クナイ(素手)ADS逆手ポーズの対象ノード束。非fistsでは空(該当ノードが無いため)。
  private fistNodes: { node: THREE.Object3D; pose: FistPose }[] = [];
  private mechTimer = 0; // slide/bolt/charging/forend の1サイクル残時間(0.16s)
  private cylTarget = 0; // シリンダ目標角(発砲ごとに -60°)
  private cylCur = 0; // シリンダ現在角(補間)

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.copy(HIP_POSITION);

    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffaa44,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flashMesh.visible = false;
    // intensity=0(オフ時), distance=4(4m到達で完全減衰), decay=2(物理正則フォールオフ)
    this.flashLight = new THREE.PointLight(0xffaa44, 0, 4, 2);
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
    this.captureRig();
    // サプレッサー装着状態をキャッシュ(fire() フラッシュ減光で参照する)
    this.isSuppressed = !!def.suppressed || (def.attachmentIds ?? []).includes('suppressor');
    // 各武器のサイト高さを ADS 収束 Y へ反映(attachmentIds 可変にも追従)。キャッシュ両経路後。
    this.adsY = -resolveSightY(def);
    this.adsTarget.set(ADS_X, this.adsY, ADS_Z);
  }

  // 可動ノード参照を一度だけ引き、メカ状態をrest(identity変形)へ戻す。銃はキャッシュ
  // 再利用されるため、切替時に前回のslide後退/シリンダ角が残らないよう明示リセットする。
  private captureRig(): void {
    const g = this.gun;
    this.rig = g
      ? {
          slide: g.getObjectByName('vm:slide'),
          bolt: g.getObjectByName('vm:bolt'),
          charging: g.getObjectByName('vm:charging'),
          magazine: g.getObjectByName('vm:magazine'),
          cylinder: g.getObjectByName('vm:cylinder'),
          forend: g.getObjectByName('vm:forend'),
        }
      : {};
    // クナイ逆手ポーズ対象を捕捉(該当ノードが無い銃では空=非干渉)。restへ復帰させておく。
    this.fistNodes = [];
    if (g) {
      for (const pose of FIST_POSES) {
        const node = g.getObjectByName(pose.name);
        if (node) {
          node.position.set(pose.rest.p[0], pose.rest.p[1], pose.rest.p[2]);
          node.rotation.set(pose.rest.r[0], pose.rest.r[1], pose.rest.r[2]);
          this.fistNodes.push({ node, pose });
        }
      }
    }
    this.mechTimer = 0;
    this.cylTarget = 0;
    this.cylCur = 0;
    if (this.rig.slide) this.rig.slide.position.z = 0;
    if (this.rig.bolt) this.rig.bolt.position.z = 0;
    if (this.rig.charging) this.rig.charging.position.z = 0;
    if (this.rig.forend) this.rig.forend.position.z = 0;
    if (this.rig.magazine) this.rig.magazine.position.y = 0;
    if (this.rig.cylinder) this.rig.cylinder.rotation.z = 0;
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
    if (def.shape === 'fists') {
      // クナイ(ダガー): 右手が柄(局所 z≈-0.10)を順手で握り、左手は添え手として前方へ構える。
      // 銃握り位置の手を流用せず、柄の位置に手首を合わせる専用配置。
      // vm:fist* として名付け、update が rest↔逆手ADS を補間する(FIST_POSES の rest と一致)
      const rArmF = limb(sleeve, 0.08, 0.08, 0.32, 0.08, -0.2, 0.12, 0.5, -0.12, 0);
      rArmF.name = 'vm:fistRArm';
      const rHandF = limb(glove, 0.06, 0.07, 0.1, 0.02, -0.07, -0.09, 0.2, 0.05, 0);
      rHandF.name = 'vm:fistRHand';
      const lArmF = limb(sleeve, 0.08, 0.08, 0.3, -0.1, -0.16, -0.02, 0.42, 0.24, 0.1);
      lArmF.name = 'vm:fistLArm';
      const lHandF = limb(glove, 0.065, 0.06, 0.09, -0.11, -0.09, -0.16, 0.25, 0.1, 0);
      lHandF.name = 'vm:fistLHand';
      gun.add(rArmF, rHandF, lArmF, lHandF);
      return { gun, muzzle };
    }
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

  // variation: クナイ斬撃モーション(0=右薙ぎ / 1=左薙ぎ / 2=突き)。fists専用で他武器は未指定
  fire(scoped = false, flash = true, variation?: number): void {
    if (variation !== undefined) {
      // クナイ3連モーション: 横ロール+前キックの組み合わせで薙ぎ/突きを描き分ける
      const v = ((variation % 3) + 3) % 3;
      if (v === 0) {
        // 右薙ぎ: 右ロール+軽い前キック
        this.kickZ = Math.min(0.09, this.kickZ + 0.06);
        this.kickRot = Math.min(0.16, this.kickRot + 0.1);
        this.kickSide = Math.min(0.18, this.kickSide + 0.14);
      } else if (v === 1) {
        // 左薙ぎ: 左ロール+軽い前キック
        this.kickZ = Math.min(0.09, this.kickZ + 0.06);
        this.kickRot = Math.min(0.16, this.kickRot + 0.1);
        this.kickSide = Math.max(-0.18, this.kickSide - 0.14);
      } else {
        // 突き: 強い前キックのみ(ロールは減衰)
        this.kickZ = Math.min(0.14, this.kickZ + 0.12);
        this.kickRot = Math.min(0.12, this.kickRot + 0.08);
        this.kickSide *= 0.3;
      }
      return;
    }
    // スコープ武器はボルト排莢のように大きく後退・跳ね上げる(BO2 DSRの重い一撃)
    this.kickZ = Math.min(scoped ? 0.2 : 0.08, this.kickZ + (scoped ? 0.18 : 0.045));
    this.kickRot = Math.min(scoped ? 0.34 : 0.18, this.kickRot + (scoped ? 0.22 : 0.09));
    // flash=false は素手パンチ等の非発砲キック(マズルフラッシュを出さない)
    if (flash) this.flashTimer = scoped ? 0.03 : 0.045;
    // スコープ武器のみ、約180ms後にボルト閉鎖の小さな揺り戻しを入れる
    if (scoped) this.counterKickTimer = 0.18;
    // メカニカル・サイクル: slide/bolt/charging/forend の後退→復帰。シリンダは1発分回す。
    // 発砲時のみ起動(flash=false のパンチは除外)。root非関与でスコープインへ非干渉。
    if (flash) {
      this.mechTimer = 0.16;
      if (this.rig.cylinder) this.cylTarget -= Math.PI / 3;
    }
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
      scopeWeapon?: boolean; // スコープ武器: ADSでスコープが目へ飛び込む所作を出す
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

    // 呼吸スウェイ(BO2/BO3: ~0.295 Hz サイン波、振幅~0.003m)。
    // ADS 収束(ads→1)でゼロへ。resolveSightY 契約: ads=1 時は breathAtten=0 なので無影響。
    this.breathPhase += dt * 0.295;
    const breathAtten = Math.pow(1.0 - ads, 2) * state.motionScale;
    const breathX = Math.sin(this.breathPhase) * 0.003 * breathAtten;
    const breathY = Math.sin(this.breathPhase * 0.73 + 1.1) * 0.002 * breathAtten;

    // スプリング的指数回復(≈0.82/frame @60fps = exp(-12*dt))。
    // 線形より初期がすばやく後半がなめらかで「重い一撃の余韻→すっと戻る」撃ち味を作る
    const kickDecay = Math.exp(-dt * 12.0);
    this.kickZ *= kickDecay;
    this.kickRot *= kickDecay;
    this.kickSide *= Math.exp(-dt * 14.0); // 横キックは少し速く戻す(斬撃の切れ味)
    this.flashTimer -= dt;
    this.flashMesh.visible = this.flashTimer > 0;
    // サプレッサー付きは intensity/scale を 1/4 に抑えて炎を消す
    const flashSuppFactor = this.isSuppressed ? 0.25 : 1.0;
    this.flashLight.intensity = this.flashTimer > 0 ? 8.0 * flashSuppFactor : 0;
    if (this.flashTimer > 0) {
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      // 毎発シード違いのスケールで連射のちらつきを自然に
      const fs = this.isSuppressed ? 0.3 + Math.random() * 0.35 : 0.7 + Math.random() * 0.85;
      this.flashMesh.scale.setScalar(fs);
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

    // ── メカニカル可動ノード(vm:*)アニメ ──
    // root には一切触れずローカルオフセットのみ。scopeWeapon の横スイープ/Zラッシュ/カントは
    // root 操作なので非干渉(可動ノードは gun 配下で root に追従するだけ)。rest は 0 で復帰する。
    if (this.mechTimer > 0) this.mechTimer = Math.max(0, this.mechTimer - dt);
    const mechCyc = this.mechTimer > 0 ? Math.sin((1 - this.mechTimer / 0.16) * Math.PI) : 0;
    const mechBack = mechCyc * 0.02; // 最大2cm後退
    if (this.rig.slide) this.rig.slide.position.z = mechBack;
    if (this.rig.bolt) this.rig.bolt.position.z = mechBack;
    if (this.rig.charging) this.rig.charging.position.z = mechBack * 0.7;
    if (this.rig.forend) this.rig.forend.position.z = mechBack;
    if (this.rig.cylinder) {
      this.cylCur += (this.cylTarget - this.cylCur) * Math.min(1, dt * 12);
      this.rig.cylinder.rotation.z = this.cylCur;
    }
    if (this.rig.magazine) {
      this.rig.magazine.position.y =
        state.reloadRatio !== null ? -Math.sin(state.reloadRatio * Math.PI) * 0.05 : 0;
    }

    // 視覚ADSはeaseOutQuintで「素早く構えて最後に据わる」BO2の所作にする。
    // ゲームプレイ(スプレッド/QS判定)は線形adsのままなので挙動は不変
    const adsVis = 1 - Math.pow(1 - ads, 5);

    // クナイ(素手)逆手ダガー構え: rest(順手・腰だめ)↔ads(逆手・胸前水平)を adsVis で補間。
    // 各ノードはローカル変形のみ(root非関与=射線/収束Y/スコープ所作に無干渉)。非fistsは空でスキップ。
    if (this.fistNodes.length) {
      const p = adsVis;
      for (const { node, pose } of this.fistNodes) {
        const rp = pose.rest.p;
        const ap = pose.ads.p;
        const rr = pose.rest.r;
        const ar = pose.ads.r;
        node.position.set(
          rp[0] + (ap[0] - rp[0]) * p,
          rp[1] + (ap[1] - rp[1]) * p,
          rp[2] + (ap[2] - rp[2]) * p,
        );
        node.rotation.set(
          rr[0] + (ar[0] - rr[0]) * p,
          rr[1] + (ar[1] - rr[1]) * p,
          rr[2] + (ar[2] - rr[2]) * p,
        );
      }
    }

    const pos = this._pos.lerpVectors(HIP_POSITION, this.adsTarget, adsVis);
    // BO2 DSR: 所作を「順序化」する。同時進行だとZラッシュが支配して正面から
    // 迫って見えるため、(1)右で構える→(2)右から中央へ横スイープ→(3)中央到達後に
    // スコープが目へ飛び込む→(4)ブラックアウト、の順に時間帯を分ける
    let scopeSlide = 0;
    if (state.scopeWeapon) {
      // X/Yはquintを使わず専用カーブ: 開始位置は腰だめよりさらに右(+0.12)で
      // ads 10〜68% をかけて中央へスイープ(それまで銃は明確に画面右にいる)
      const sweep = THREE.MathUtils.smoothstep(ads, 0.1, 0.68);
      scopeSlide = 1 - sweep;
      pos.x = THREE.MathUtils.lerp(HIP_POSITION.x + 0.12, ADS_X, sweep);
      // Y は武器ごとの adsY(=-sightY)へ収束させる。ADS_POSITION.y 固定だとサイトが
      // 画面中央からずれ、scopeReveal01 越えで上下スナップが出ていた
      pos.y = THREE.MathUtils.lerp(
        HIP_POSITION.y - 0.02,
        this.adsY,
        THREE.MathUtils.smoothstep(ads, 0.12, 0.7),
      );
      // Z ラッシュは中央到達後(58→74%がピーク)に発火: スコープが目へ飛び込み、
      // そのまま 70-90% のブラックアウト→スコープ画面へ繋がる
      const bell =
        THREE.MathUtils.smoothstep(ads, 0.58, 0.74) *
        (1 - THREE.MathUtils.smoothstep(ads, 0.74, 0.9));
      pos.z -= 0.2 * bell;
      pos.y += 0.05 * bell;
    }
    pos.x += this.swayX + bobX + breathX;
    // スコープを覗き込むほど銃を下げ、完全に覗いたらDOMスコープのため非表示にする
    pos.y +=
      this.swayY +
      bobY +
      breathY +
      LOWERED_OFFSET * state.raiseRatio -
      0.55 * state.scopeReveal01 -
      landDip +
      this.sprintLower;
    pos.z += this.kickZ;
    this.root.position.copy(pos);
    this.root.visible = state.alive && state.scopeReveal01 < 0.95;

    let rotX = this.kickRot * 0.6 + counterKick + state.raiseRatio * -0.5;
    // スコープ武器のADSで銃身をわずかに前へ倒す(スコープ接眼の所作)
    if (state.scopeWeapon) rotX += adsVis * 0.13;
    // 横滑り中は右担ぎのカント(傾き)+銃口をやや内向きに。中央到達で水平へ戻る
    let rotZ = -0.16 * scopeSlide;
    const slideYaw = 0.1 * scopeSlide;
    if (state.reloadRatio !== null) {
      const wave = Math.sin(state.reloadRatio * Math.PI);
      rotX -= wave * 0.55;
      rotZ = wave * 0.25;
      this.root.position.y -= wave * 0.09;
    }
    this.root.rotation.set(rotX, this.swayX * 2 + slideYaw, rotZ + this.kickSide * 0.7);
  }
}
