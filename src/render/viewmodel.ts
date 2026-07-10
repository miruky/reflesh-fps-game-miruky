import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ViewModelShape, WeaponDef } from '../game/weapons';
import { classDefault, OPTIC_SPECS, resolveOpticId } from '../game/optics';
import {
  CAMO_VISUALS,
  equippedCamoFor,
  isKnownCamoId,
  type CamoId,
  type CamoVisual,
} from '../game/camo';
import { loadProfile } from '../core/profile';

const HIP_POSITION = new THREE.Vector3(0.24, -0.22, -0.5);
// ADS 収束座標。X/Z は全武器共通、Y は武器ごとに resolveSightY で動的算出する
// (各銃のサイト=ビード/アイアン/レフレックス/スコープ をカメラ空間 Y=0 の射線へ載せる)。
const ADS_X = 0;
const ADS_Z = -0.42;
// R53-W1 F1/F2: 据え撃ちブレースポーズ(ADS収束を中央でなく右下オフセットへ差し替える)。
// 対象は resolveSightY=0(中央射線基準)かつ「大型シルエット+ADSで精度が変わらない
// (spreadAdsDeg≒spreadHipDeg / adsFovScale=1)」武器 = 修羅(minigun)/風神扇(war-fan)。
// 通常の (ADS_X, -resolveSightY, ADS_Z) へ収束させると、この2形状は前面ジオメトリが
// カメラ光軸へ完全に一致し、しかもバレルクラスタ/扇骨がカメラのごく至近(数cm〜十数cm)
// まで迫るため画面のほぼ全域を覆う(実測: 修羅の後端リング(半径0.157m)は現状の
// ADS収束だとカメラ空間 z≈-0.068 まで迫り角半径69°=画面全域を覆う)。
// このブレース値 (0.30,-0.30,-0.30) は実ジオメトリを角度計算で検証済み:
//   修羅   : 後端リング/グリップはカメラ背面(near-plane超)へ抜けて非描画。前端リング
//            の画面中心からの最近接距離は約11.2°(腰だめ時の前端リング5.8°より広い)。
//   風神扇 : 要(ピボット)含む全リブが画面中心から26°以上。腰だめの前端相当(9.0°)を上回る。
// resolveSightY はどちらも 0 のまま不変(サイト契約は据え置き)。adsProgress の値自体も
// 不変のため、阿修羅連撃などのチャージ判定(adsProgress>0.3 && fireDown)には無関係。
const BRACE_ADS_TARGET = new THREE.Vector3(0.30, -0.30, -0.30);
const LOWERED_OFFSET = -0.35;
// 銃身・マズルの基準高さ(全シルエット共通)。トレーサー原点もこの高さに乗る
const BARREL_Y = 0.012;
// R51: アイアンサイト微調整(ユーザー要望「ドットをもう少し浮かせて」)。
// IRON_POST_Y = post機(fixed/flip/ghost)の狙点Y(旧0.062→新0.075)。
// BEAD_FLOAT = bead機(SG/musket)の狙点Y上乗せ量(旧beadY式に一律加算)。
// 両定数は buildGunBody(実ジオメトリ)と resolveSightY(契約値)の双方で参照し、
// ドリフトを構造的に防ぐ(どちらか片方だけ変更すると照準がズレるため)。
const IRON_POST_Y = 0.075;
const BEAD_FLOAT = 0.008;

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
  // ロケットランチャー: 肩担ぎの太い発射筒。前後グリップ相当はshroudハンドガード+AR gripで表現。
  // 排気ベント: ventSlots=5 の shroud ハンドガード。簡易照門: ironSight='bead'(前ビード)。
  // muzzle.z<0 契約: barFrontZ = -(recHalf+0.1*bs) - barLen/2*bs で常に負。brake は前端開放。
  launcher: {
    receiver: { w: 0.12, h: 0.12, d: 0.48 },
    barrelGauge: 0.054,
    barrelLen: 0.16,
    feed: 'none',
    handguard: 'shroud',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.4,
    ventSlots: 5,
    ironSight: 'bead',
  },
  // ── R33 新shape 8種 ─────────────────────────────────────────────────────
  // sniper-semi: SVD系セミオートスナイパー(ボルトハンドルなし/ストレートマグ/PSO-1風スコープ)
  'sniper-semi': {
    receiver: { w: 0.076, h: 0.096, d: 0.35 },
    barrelGauge: 0.032,
    barrelLen: 0.30,
    feed: 'mag-straight',
    handguard: 'slim',
    stock: 'fixed',
    scope: { r: 0.026, len: 0.16, y: 0.086 },
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.22,
    railTop: 'short',
    chargingHandle: 'side',
  },
  // antimateriel: Barrett系対物ライフル(大口径/ventSlots6/スケルトンストック/大型スコープ)
  antimateriel: {
    receiver: { w: 0.095, h: 0.11, d: 0.44 },
    barrelGauge: 0.048,
    barrelLen: 0.38,
    feed: 'mag-straight',
    handguard: 'shroud',
    stock: 'skeleton',
    scope: { r: 0.034, len: 0.20, y: 0.092 },
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.45,
    ventSlots: 6,
    chargingHandle: 'side',
    receiverStyle: 'split',
    ejectionPort: true,
  },
  // shuriken-hand: 早期分岐で buildGunBody が専用ジオメトリを組む。この行は型網羅用最小値
  'shuriken-hand': {
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
  // bow-japanese: 早期分岐で buildGunBody が専用ジオメトリを組む。この行は型網羅用最小値
  'bow-japanese': {
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
  // war-fan: 早期分岐で buildGunBody が専用ジオメトリを組む。この行は型網羅用最小値
  'war-fan': {
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
  // musket: 超長銃身火縄銃(木製前床/固定ストック/bead照門)
  musket: {
    receiver: { w: 0.062, h: 0.072, d: 0.28 },
    barrelGauge: 0.020,
    barrelLen: 0.52,
    feed: 'none',
    handguard: 'wood',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'stock',
    bodyScale: 1.3,
    gripStyle: 'wood',
    ironSight: 'bead',
    barrelProfile: 'plain',
  },
  // lightning-staff: 早期分岐で buildGunBody が専用ジオメトリを組む。この行は型網羅用最小値
  'lightning-staff': {
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
  // minigun: 早期分岐で buildGunBody が6バレルジオメトリを組む。この行は型網羅用最小値
  minigun: {
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
    // Fix-2: opacity 0.55→0.72(暗ステージでの視認性向上)
    const reflexDot = new THREE.MeshBasicMaterial({
      color: 0xff2a1c,
      transparent: true,
      opacity: 0.72,
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

// ── R25 武器カモ(プロシージャル)────────────────────────────────────────
// 主要メタル/ポリマー材質(metalVC/polyVC)を、カモ定義(camo.ts)に基づく
// onBeforeCompile の軽量ノイズGLSLで置き換える。研磨(polish)/レンズ/発光帯は
// 素のまま残してコントラストを保つ。カモ材はカモIDごとに1枚をモジュールキャッシュし
// (userData.shared=true)、disposeShared で他の共有材と同時に解放する。
// 銃キャッシュのキーにカモIDが入るため、材の差し替え・復元は不要(元本を汚さない)。

// 全カモ材で共有する時刻uniform(ダークマター等の脈動アニメ用)。描画直前に
// mesh.onBeforeRender が進めるので、本編ViewModelとARMORYプレビューの両方で動く。
const CAMO_TIME = { value: 0 };
const tickCamoTime = (): void => {
  CAMO_TIME.value = performance.now() * 0.001;
};

function glslColor(hex: number): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

// パターン本体。camoCol(必須)と camoEmissiveMul(任意・既定1.0)を組み立てる。
// 色・周波数はGLSL定数として焼き込む(uniform管理不要・clone安全)。
function camoPatternGLSL(v: CamoVisual): string {
  const A = glslColor(v.colorA);
  const B = glslColor(v.colorB);
  const C = glslColor(v.colorC);
  const S = v.scale.toFixed(2);
  switch (v.pattern) {
    case 'blotch':
      // 迷彩斑: 2周波の値ノイズで主/副/差し色を島状に混ぜる
      return `
        float n1 = camoNoise(vCamoPos * ${S});
        float n2 = camoNoise(vCamoPos * ${S} * 2.63 + 17.3);
        vec3 camoCol = mix(${A}, ${B}, smoothstep(0.42, 0.58, n1));
        camoCol = mix(camoCol, ${C}, smoothstep(0.60, 0.74, n2));`;
    case 'stripe':
      // 縞(タイガー/ネオン): ノイズで歪ませたsin縞。縞側(B)を発光対象にする
      return `
        float w = vCamoPos.z * ${S} + (camoNoise(vCamoPos * ${S} * 0.9) - 0.5) * 2.4;
        float band = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(w * 6.2832));
        vec3 camoCol = mix(${A}, ${B}, band);
        float n2 = camoNoise(vCamoPos * ${S} * 2.1 + 31.7);
        camoCol = mix(camoCol, ${C}, smoothstep(0.66, 0.80, n2));
        camoEmissiveMul = band;`;
    case 'facet':
      // 結晶(ダイヤ): セル状ファセット+氷白の稜線。面ごとに明度が割れる
      return `
        vec3 cell = floor(vCamoPos * ${S});
        float f = camoHash(cell);
        vec3 fr = fract(vCamoPos * ${S});
        float edge = smoothstep(0.0, 0.12, min(min(fr.x, fr.y), fr.z))
                   * smoothstep(0.0, 0.12, min(min(1.0 - fr.x, 1.0 - fr.y), 1.0 - fr.z));
        vec3 camoCol = mix(${C}, mix(${A}, ${B}, f), edge);
        camoEmissiveMul = 1.0 - 0.5 * edge;`;
    case 'pulse':
      // 脈動(溶岩/ダークマター): 流動するノイズ脈+時間で明滅する発光(uCamoTime)
      return `
        float n1 = camoNoise(vCamoPos * ${S} + vec3(0.0, 0.0, uCamoTime * 0.15));
        float vein = 1.0 - smoothstep(0.04, 0.16, abs(n1 - 0.5));
        float n2 = camoNoise(vCamoPos * ${S} * 2.2 + 11.1);
        vec3 camoCol = mix(${A}, ${B}, vein);
        camoCol = mix(camoCol, ${C}, vein * smoothstep(0.5, 0.8, n2));
        camoEmissiveMul = vein * (0.55 + 0.45 * sin(uCamoTime * 2.4 + n2 * 6.2832));`;
    case 'solid':
      // 単色(ゴールド): 微ノイズの色むら+まれなハイライト班のみ
      return `
        float n1 = camoNoise(vCamoPos * ${S});
        vec3 camoCol = mix(${A}, ${B}, n1 * 0.35);
        camoCol = mix(camoCol, ${C}, smoothstep(0.78, 0.96, camoNoise(vCamoPos * ${S} * 1.7 + 5.0)));`;
    case 'circuit':
      // 回路脈(R53-W2 PaP鍛神 pap1/pap3): 二重ノイズの発光脈を暗基板に通す。時間非依存
      // (静的)。交点(vein1*vein2)をハイライト色Cで明るくし「基板ジャンクション」感を出す
      return `
        float n1 = camoNoise(vCamoPos * ${S});
        float vein1 = 1.0 - smoothstep(0.02, 0.09, abs(n1 - 0.5));
        float n2 = camoNoise(vCamoPos * ${S} * 1.7 + 23.1);
        float vein2 = 1.0 - smoothstep(0.02, 0.08, abs(n2 - 0.5));
        vec3 camoCol = mix(${A}, ${B}, clamp(vein1 + vein2 * 0.7, 0.0, 1.0));
        camoCol = mix(camoCol, ${C}, vein1 * vein2);
        camoEmissiveMul = clamp(vein1 * 0.85 + vein2 * 0.5, 0.0, 1.0);`;
    default:
      return 'vec3 camoCol = diffuseColor.rgb;';
  }
}

// 頂点カラーで焼いた擬似AO(下暗上明)を保ったままアルベドをカモ柄へ差し替える。
// 位置は銃ローカル(vCamoPos)なので柄は武器に固定され、決定論で再現される。
function camoShaderPatch(
  shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string },
  v: CamoVisual,
): void {
  shader.uniforms.uCamoTime = CAMO_TIME;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCamoPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoPos = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vCamoPos;
uniform float uCamoTime;
float camoEmissiveMul = 1.0;
float camoHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float camoNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = camoHash(i);
  float n100 = camoHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = camoHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = camoHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = camoHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = camoHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = camoHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = camoHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
${camoPatternGLSL(v)}
  float camoLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float camoShade = clamp(camoLum * 3.6, 0.35, 1.3);
  diffuseColor.rgb = camoCol * camoShade;
}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance *= camoEmissiveMul;`,
    );
}

// clone しても柄が生き残るカモ材。WeaponPreview は setWeapon 時に material.clone() で
// プレビュー専用複製を作るため、Material.copy が運ばない onBeforeCompile を
// clone() のオーバーライドで再構成する。customProgramCacheKey でプログラムを
// カモIDごとに分離(同一シェーダ文字列は three が自動共有)。
export class CamoStandardMaterial extends THREE.MeshStandardMaterial {
  readonly camoVisualId: CamoId;

  constructor(visual: CamoVisual, base?: THREE.MeshStandardMaterial) {
    super();
    if (base) this.copy(base);
    this.camoVisualId = visual.id;
    this.vertexColors = true;
    this.metalness = visual.metalness;
    this.roughness = visual.roughness;
    this.emissive = new THREE.Color(visual.emissive);
    this.emissiveIntensity = visual.emissiveIntensity;
    this.onBeforeCompile = (shader) => camoShaderPatch(shader, visual);
  }

  override clone(): this {
    return new CamoStandardMaterial(CAMO_VISUALS[this.camoVisualId], this) as this;
  }

  override customProgramCacheKey(): string {
    return `camo:${this.camoVisualId}`;
  }
}

// カモIDごとに1枚だけ生成してモジュール共有(disposeSharedで解放)。
// メタル/ポリマー両バケツが同じ材を使う(質感はカモ定義側が決める)。
const camoMatCache = new Map<CamoId, CamoStandardMaterial>();

function getCamoMaterial(camoId: CamoId): CamoStandardMaterial {
  let m = camoMatCache.get(camoId);
  if (!m) {
    m = new CamoStandardMaterial(CAMO_VISUALS[camoId], getShared().metalVC);
    m.userData.shared = true;
    camoMatCache.set(camoId, m);
  }
  return m;
}

// プロファイルから装備カモを解決する(未解除・不正は camo.ts が null に落とす)。
// localStorage の無い環境(テスト/SSR)でも安全に null を返す。
function resolveEquippedCamo(weaponId: string): CamoId | null {
  try {
    return equippedCamoFor(weaponId, loadProfile());
  } catch {
    return null;
  }
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
  for (const m of camoMatCache.values()) m.dispose();
  camoMatCache.clear();
}

// ── ジオメトリ toolkit(頂点カラーを焼く) ───────────────────────────────
// gun ローカル座標系: -Z が前方、BARREL_Y が銃身中心高さ。
// billboard 用スクラッチ quaternion（毎フレーム alloc 回避）
const _bbCamQ = new THREE.Quaternion();
const _bbParentQ = new THREE.Quaternion();
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
// camoId: 省略(undefined)=プロファイルの装備カモを自動解決(ARMORYプレビューも
// これで反映される)、null=カモなし、CamoId=明示適用。
export function buildGunBody(
  def: WeaponDef,
  camoId?: string | null,
): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const gun = new THREE.Group();

  // 素手(id/shape='fists')は「クナイ(ニンジャ・ダガー)」を握る。銃は描かず、
  // 細身の刃+切先+鍔+柄(柄巻き)+柄頭リングを低ポリ+頂点カラーで組む。
  // FPVの腕は ViewModel.buildGun 側が右手グリップとして追加する。
  // resolveSightY('fists')=0 契約は不変(ADSで刃が画面中央=射線へ寄る)。
  // 早期分岐は merge toolkit を通さず(近接は1体描画なので寛容)。
  if (def.shape === 'fists') {
    const { metalVC, polishVC } = getShared();
    const accent = getAccent(def.tracerColor); // 刃紋/柄巻きの発光帯(tracerColor)
    const C_STEEL = 0x30383e; // 暗研磨鋼(刃) — Apex Wraith ダーク基調
    const C_DARK  = 0x181c22; // 峰・鍔の漆黒
    const C_GRIP  = 0x0e1014; // 柄(最暗)
    const blade = new THREE.Group();
    // steel=頂点カラー鋼、glow=accent発光(頂点カラー不要)
    // bladeCore=true のメッシュは黒帝モード中に setKunaiDarkMode が非表示にし、黒刀に差し替える
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
      bladeCore = false,
    ): void => {
      setColor(geo, col(color), shade);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      if (bladeCore) m.userData.kunaiBladeCore = true;
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
      kunaiGlow = false,
    ): void => {
      const m = new THREE.Mesh(geo, accent);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      // setKunaiDarkMode がこのフラグで刃紋メッシュを特定し、emissive を切り替える
      if (kunaiGlow) m.userData.kunaiGlow = true;
      blade.add(m);
    };
    // ── APEX WRAITH クナイ: 屈曲刃シルエット ────────────────────────────────
    // (a) 「く」字屈曲刃: セグメント1(直線前方) + セグメント2(下向き屈曲) で構成。
    //     back_face 接続点 = (0, 0.005, -0.355)。
    //     セグメント2 center: back_face - half_len * R_x(-0.5)*(0,0,1)
    //       = (0, 0.005-0.038, -0.355-0.070) = (0,-0.033,-0.425)
    // (b) 刃の両縁発光ライン(kunaiGlow=true / setKunaiDarkMode が emissive 切替)
    // (c) 短柄 + 柄尻リング(下記ガード以降で共通維持)
    // (d) 全体 ダーク基調(C_STEEL=暗鋼/C_DARK=漆黒)
    // セグメント1: グリップ前方の幅広直線刃 (Z中心:-0.265, Z範囲:-0.175〜-0.355)
    steel(new THREE.BoxGeometry(0.014, 0.044, 0.18), polishVC, C_STEEL, 'machined', 0, 0.005, -0.265, 0, 0, 0, true);
    // 峰(芯板): 稜線感を出すやや太い暗板
    steel(new THREE.BoxGeometry(0.008, 0.048, 0.16), metalVC, C_DARK, 'gradY', 0, 0.005, -0.255, 0, 0, 0, true);
    // セグメント2: rx=-0.5(≈29°下向き屈曲)。「く」字の屈曲刃先
    steel(new THREE.BoxGeometry(0.013, 0.038, 0.16), polishVC, C_STEEL, 'machined', 0, -0.033, -0.425, -0.5, 0, 0, true);
    // 峰(セグメント2): 同角度で薄く重ねる
    steel(new THREE.BoxGeometry(0.008, 0.042, 0.14), metalVC, C_DARK, 'gradY', 0, -0.033, -0.425, -0.5, 0, 0, true);
    // 発光ライン — 下縁:セグメント1 (bottom edge, kunaiGlow=true)
    glow(new THREE.BoxGeometry(0.018, 0.005, 0.17), 0, -0.014, -0.265, 0, 0, 0, true);
    // 発光ライン — 上縁:セグメント1 (top edge, Apex 両縁発光)
    glow(new THREE.BoxGeometry(0.016, 0.004, 0.16), 0, 0.025, -0.263, 0, 0, 0, true);
    // 発光ライン — 下縁:セグメント2 (rx=-0.5 で刃に追従, world中心≈(0,-0.050,-0.416))
    glow(new THREE.BoxGeometry(0.016, 0.005, 0.15), 0, -0.052, -0.416, -0.5, 0, 0, true);
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

    const fistsCamo: CamoId | null =
      camoId === undefined
        ? resolveEquippedCamo(def.id)
        : camoId !== null && isKnownCamoId(camoId)
          ? camoId
          : null;
    if (fistsCamo) {
      const cm = getCamoMaterial(fistsCamo);
      blade.traverse((node) => {
        if (node instanceof THREE.Mesh && node.userData.kunaiBladeCore === true) {
          node.material = cm;
          node.onBeforeRender = tickCamoTime; // V33: 時間アニメ系カモ(ダークマター等)を刃でも進める
        }
      });
    }

    const muzzleF = new THREE.Object3D();
    muzzleF.position.set(0, -0.03, -0.5);
    gun.add(muzzleF);
    return { gun, muzzle: muzzleF };
  }

  // ── shuriken-hand: 手甲(小手)+甲上ホルダー+浮遊十字手裏剣3枚 ────────────────
  if (def.shape === 'shuriken-hand') {
    const { metalVC, polishVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_GAUNT = 0x1a1e26;
    const C_DARK2 = 0x111418;
    const C_STEEL2 = 0x30383e;
    // 手甲本体(背板)
    const gauntlet = chamferBox(0.096, 0.072, 0.168, 0.008);
    setColor(gauntlet, col(C_GAUNT), 'machined');
    const gauntletM = new THREE.Mesh(gauntlet, metalVC);
    gauntletM.position.set(0, -0.02, 0.0);
    gun.add(gauntletM);
    // リストガード
    const wristGuard = new THREE.BoxGeometry(0.098, 0.016, 0.032);
    setColor(wristGuard, col(C_DARK2), 'flat');
    const wgm = new THREE.Mesh(wristGuard, metalVC);
    wgm.position.set(0, -0.02, 0.090);
    gun.add(wgm);
    // アクセントライン
    const accentLine2 = new THREE.BoxGeometry(0.082, 0.003, 0.120);
    setColor(accentLine2, col(def.tracerColor), 'flat');
    const alm = new THREE.Mesh(accentLine2, accent);
    alm.position.set(0, 0.018, 0.01);
    gun.add(alm);
    // ホルダーハブ
    const hub = new THREE.CylinderGeometry(0.026, 0.028, 0.020, 12);
    setColor(hub, col(C_STEEL2), 'edgeHi');
    const hubm = new THREE.Mesh(hub, polishVC);
    hubm.position.set(0, 0.010, -0.10);
    hubm.rotation.set(Math.PI / 2, 0, 0);
    gun.add(hubm);
    // 浮遊手裏剣 3枚
    for (let si = 0; si < 3; si += 1) {
      const starZ    = -0.08 - si * 0.028;
      const baseRot  = si * (Math.PI / 12);
      const isFront  = si === 0;
      for (let bi3 = 0; bi3 < 4; bi3 += 1) {
        const bAngle = (bi3 / 4) * Math.PI + baseRot;
        const bladeW = isFront ? 0.152 : (si === 1 ? 0.136 : 0.122);
        const bladeH = isFront ? 0.024 : (si === 1 ? 0.021 : 0.018);
        const bladeD = isFront ? 0.011 : 0.009;
        const blade = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
        if (isFront) {
          setColor(blade, col(def.tracerColor), 'flat');
          const bm4 = new THREE.Mesh(blade, accent);
          bm4.name = 'vm:shurikenBlade';
          bm4.userData.shurikenBaseZ = starZ;
          bm4.position.set(0, 0, starZ);
          bm4.rotation.set(0, 0, bAngle);
          gun.add(bm4);
        } else {
          setColor(blade, col(C_STEEL2), 'flat');
          const bm4b = new THREE.Mesh(blade, metalVC);
          bm4b.position.set(0, 0, starZ);
          bm4b.rotation.set(0, 0, bAngle);
          gun.add(bm4b);
        }
      }
      // 中心リング
      const cRing = new THREE.TorusGeometry(0.020, 0.005, 7, 14);
      setColor(cRing, col(isFront ? def.tracerColor : C_DARK2), 'flat');
      const crm2 = new THREE.Mesh(cRing, isFront ? accent : metalVC);
      crm2.position.set(0, 0, starZ);
      crm2.rotation.set(Math.PI / 2, 0, 0);
      gun.add(crm2);
    }
    // 手首グリップ
    const grip2 = new THREE.CylinderGeometry(0.030, 0.028, 0.160, 10);
    setColor(grip2, col(C_GAUNT), 'gradY');
    const grm2 = new THREE.Mesh(grip2, metalVC);
    grm2.position.set(0, -0.05, 0.06);
    grm2.rotation.set(Math.PI / 2, 0, 0);
    gun.add(grm2);
    const shurikenCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (shurikenCamo) {
      const cm4 = getCamoMaterial(shurikenCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material === metalVC) {
          node.material = cm4;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を万刃でも進める
        }
      });
    }
    const muzzleSH = new THREE.Object3D();
    muzzleSH.position.set(0, 0, -0.22);
    gun.add(muzzleSH);
    return { gun, muzzle: muzzleSH };
  }

  // ── bow-japanese: 上長下短の非対称和弓+籐巻き+矢羽根付き矢 ───────────────────
  if (def.shape === 'bow-japanese') {
    const { polishVC, polyVC, metalVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_BOW    = 0x3a2a18;
    const C_BOW_HI = 0x5a3e24;
    const C_ARROW  = 0x1a1a22;
    const C_TADO   = 0x8a6a38;
    // 上弭3セグメント(上長=0.40合計)
    const upperSegs = [
      { h: 0.16, y: 0.10, rx:  0.10 },
      { h: 0.14, y: 0.25, rx:  0.20 },
      { h: 0.10, y: 0.38, rx:  0.30 },
    ] as const;
    for (const seg of upperSegs) {
      const segGeo = new THREE.BoxGeometry(0.015, seg.h, 0.019);
      setColor(segGeo, col(C_BOW), 'gradY');
      const sm = new THREE.Mesh(segGeo, polyVC);
      sm.name = 'vm:limbT';
      sm.position.set(0, seg.y, -0.06);
      sm.rotation.set(seg.rx, 0, 0);
      gun.add(sm);
    }
    // 下弭3セグメント(下短=0.30合計)
    const lowerSegs = [
      { h: 0.13, y: -0.09, rx: -0.10 },
      { h: 0.11, y: -0.21, rx: -0.22 },
      { h: 0.06, y: -0.30, rx: -0.32 },
    ] as const;
    for (const seg of lowerSegs) {
      const segGeo = new THREE.BoxGeometry(0.015, seg.h, 0.019);
      setColor(segGeo, col(C_BOW_HI), 'gradY');
      const sm = new THREE.Mesh(segGeo, polyVC);
      sm.name = 'vm:limbB';
      sm.position.set(0, seg.y, -0.06);
      sm.rotation.set(seg.rx, 0, 0);
      gun.add(sm);
    }
    // 弦(上)
    const strTop = new THREE.BoxGeometry(0.005, 0.38, 0.005);
    setColor(strTop, col(def.tracerColor), 'flat');
    const stm5 = new THREE.Mesh(strTop, accent);
    stm5.name = 'vm:strT';
    stm5.position.set(0, 0.14, -0.18);
    gun.add(stm5);
    // 弦(下)
    const strBot = new THREE.BoxGeometry(0.005, 0.28, 0.005);
    setColor(strBot, col(def.tracerColor), 'flat');
    const sbm5 = new THREE.Mesh(strBot, accent);
    sbm5.name = 'vm:strB';
    sbm5.position.set(0, -0.10, -0.18);
    gun.add(sbm5);
    // 握り(グリップ)
    const grip3 = new THREE.BoxGeometry(0.030, 0.082, 0.026);
    setColor(grip3, col(C_BOW), 'flat');
    const grm3 = new THREE.Mesh(grip3, polyVC);
    grm3.position.set(0, 0, -0.06);
    gun.add(grm3);
    // 籐巻き(5帯)
    for (let ti = 0; ti < 5; ti += 1) {
      const tY = -0.036 + ti * 0.018;
      const tado = new THREE.BoxGeometry(0.032, 0.009, 0.028);
      setColor(tado, col(C_TADO), 'flat');
      const tdm = new THREE.Mesh(tado, polyVC);
      tdm.position.set(0, tY, -0.059);
      gun.add(tdm);
    }
    // 矢シャフト
    const shaft = new THREE.CylinderGeometry(0.006, 0.006, 0.44, 8);
    setColor(shaft, col(C_ARROW), 'gradY');
    const shm = new THREE.Mesh(shaft, metalVC);
    shm.name = 'vm:arrowShaft';
    shm.position.set(0, 0.01, -0.25);
    shm.rotation.set(Math.PI / 2, 0, 0);
    gun.add(shm);
    // 矢羽根 3枚(120°間隔)
    for (let fi = 0; fi < 3; fi += 1) {
      const fa = (fi / 3) * Math.PI * 2;
      const feather = new THREE.BoxGeometry(0.034, 0.002, 0.060);
      setColor(feather, col(0x882222), 'flat');
      const fm = new THREE.Mesh(feather, polyVC);
      fm.position.set(Math.cos(fa) * 0.011, 0.01 + Math.sin(fa) * 0.011, -0.025);
      fm.rotation.set(Math.PI / 2, 0, fa);
      gun.add(fm);
    }
    // 矢じり
    const tip = new THREE.ConeGeometry(0.008, 0.042, 8);
    setColor(tip, col(0x888888), 'edgeHi');
    const tm = new THREE.Mesh(tip, metalVC);
    tm.name = 'vm:arrowTip';
    tm.position.set(0, 0.01, -0.47);
    tm.rotation.set(Math.PI / 2, 0, 0);
    gun.add(tm);
    const bowCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (bowCamo) {
      const cm5 = getCamoMaterial(bowCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && (node.material === polyVC || node.material === metalVC || node.material === polishVC)) {
          node.material = cm5;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を月光弓でも進める
        }
      });
    }
    const muzzleBow = new THREE.Object3D();
    muzzleBow.position.set(0, 0.01, -0.49);
    gun.add(muzzleBow);
    return { gun, muzzle: muzzleBow };
  }

  // ── war-fan: 扇骨9本+扇面パネル+房飾りの鉄扇 ─────────────────────────────
  if (def.shape === 'war-fan') {
    const { metalVC, polishVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_FRAME = 0x1e2430;
    const C_PIVOT = 0x505868;
    const C_GOLD  = 0xb8822a;
    // 軸ピン(要)
    const pivotCore = new THREE.CylinderGeometry(0.013, 0.015, 0.036, 12);
    setColor(pivotCore, col(C_PIVOT), 'edgeHi');
    const pcm = new THREE.Mesh(pivotCore, polishVC);
    pcm.position.set(0, 0, 0.04);
    pcm.rotation.set(Math.PI / 2, 0, 0);
    gun.add(pcm);
    // 要の飾りリング
    for (const oz of [-0.022, 0.022] as const) {
      const ring = new THREE.TorusGeometry(0.014, 0.004, 8, 14);
      setColor(ring, col(C_GOLD), 'edgeHi');
      const rfm = new THREE.Mesh(ring, polishVC);
      rfm.position.set(0, 0, 0.04 + oz);
      gun.add(rfm);
    }
    // 柄(把)
    const handle = new THREE.BoxGeometry(0.022, 0.112, 0.022);
    setColor(handle, col(C_FRAME), 'gradY');
    const hm = new THREE.Mesh(handle, metalVC);
    hm.position.set(0, -0.062, 0.04);
    gun.add(hm);
    // 柄巻き帯
    for (let bi2 = 0; bi2 < 2; bi2 += 1) {
      const band = new THREE.CylinderGeometry(0.014, 0.013, 0.014, 10);
      setColor(band, col(C_GOLD), 'flat');
      const bm3 = new THREE.Mesh(band, metalVC);
      bm3.position.set(0, -0.028 - bi2 * 0.040, 0.04);
      bm3.rotation.set(Math.PI / 2, 0, 0);
      gun.add(bm3);
    }
    // 房飾り: 小球+3本の紐
    const tasselSphere = new THREE.SphereGeometry(0.012, 10, 8);
    setColor(tasselSphere, col(C_GOLD), 'edgeHi');
    const tsm = new THREE.Mesh(tasselSphere, polishVC);
    tsm.position.set(0, -0.130, 0.04);
    gun.add(tsm);
    for (let ci2 = 0; ci2 < 3; ci2 += 1) {
      const cord = new THREE.CylinderGeometry(0.0016, 0.0010, 0.028, 4);
      setColor(cord, col(C_GOLD), 'flat');
      const cm6 = new THREE.Mesh(cord, metalVC);
      cm6.position.set((ci2 - 1) * 0.009, -0.150, 0.04);
      gun.add(cm6);
    }
    // 骨9本: テーパ CylinderGeometry
    const ribCount = 9;
    const fanSpan = (Math.PI * 2) / 3;
    const ribLen   = 0.235;
    const ribHalf  = ribLen / 2;
    const baseZ    = -0.12;
    const fanFaceMat = new THREE.MeshBasicMaterial({
      color: def.tracerColor,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < ribCount; i += 1) {
      const angle = -fanSpan / 2 + (i / (ribCount - 1)) * fanSpan;
      const isEdge = i === 0 || i === ribCount - 1;
      const isMid  = i === 4;
      const rootR  = isEdge ? 0.006 : 0.0045;
      const tipR   = isEdge ? 0.003 : 0.002;
      const rib = new THREE.CylinderGeometry(tipR, rootR, ribLen, 6, 1);
      const ribColor = isEdge ? C_PIVOT : (isMid ? def.tracerColor : C_FRAME);
      setColor(rib, col(ribColor), 'gradY');
      const rm3 = new THREE.Mesh(rib, isEdge ? metalVC : (isMid ? accent : metalVC));
      rm3.name = 'vm:fanRib';
      rm3.userData.fanBaseAngle = angle;
      rm3.position.set(Math.sin(angle) * ribHalf, Math.cos(angle) * ribHalf - 0.02, baseZ);
      rm3.rotation.set(0, 0, angle);
      gun.add(rm3);
      // 骨先端の金飾り
      if (isEdge || isMid) {
        const tipBall = new THREE.SphereGeometry(isEdge ? 0.007 : 0.005, 8, 6);
        setColor(tipBall, col(C_GOLD), 'edgeHi');
        const tbm = new THREE.Mesh(tipBall, polishVC);
        tbm.position.set(Math.sin(angle) * ribLen, Math.cos(angle) * ribLen - 0.02, baseZ);
        gun.add(tbm);
      }
      // 扇面パネル(骨間)
      if (i < ribCount - 1) {
        const nextAngle = -fanSpan / 2 + ((i + 1) / (ribCount - 1)) * fanSpan;
        const midAngle  = (angle + nextAngle) / 2;
        const dA      = nextAngle - angle;
        const chord   = 2 * ribHalf * Math.sin(dA / 2) * 0.88;
        const panelGeo = new THREE.BoxGeometry(chord, 0.001, ribLen * 0.78);
        setColor(panelGeo, col(def.tracerColor), 'flat');
        const pfm = new THREE.Mesh(panelGeo, fanFaceMat);
        pfm.position.set(Math.sin(midAngle) * ribHalf * 0.82, Math.cos(midAngle) * ribHalf * 0.82 - 0.02, baseZ);
        pfm.rotation.set(0, 0, midAngle);
        gun.add(pfm);
      }
    }
    const fanCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (fanCamo) {
      const cm3 = getCamoMaterial(fanCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material === metalVC) {
          node.material = cm3;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を風神扇でも進める
        }
      });
    }
    const muzzleFan = new THREE.Object3D();
    muzzleFan.position.set(0, 0, -0.28);
    gun.add(muzzleFan);
    return { gun, muzzle: muzzleFan };
  }

  // ── musket: 木製銃床(カルカ溝)+火挟(サーペンタイン)+火皿+帯金3本の火縄銃 ─────
  // 早期分岐で火縄銃固有ジオメトリを組む。
  // R51: bead sightY=BARREL_Y+0.020*0.6+BEAD_FLOAT=0.032(旧0.024からドットを浮かせる)。
  if (def.shape === 'musket') {
    const { metalVC, polishVC, polyVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_WOOD   = 0x5b3d24;
    const C_WOOD_D = 0x3a2a16;
    const C_STEEL3 = 0x22262e;
    const C_BRASS  = 0x8a6a2c;
    const BARREL_Y_M = BARREL_Y;
    // 木製前床
    const forestock = chamferBox(0.038, 0.054, 0.52, 0.006);
    setColor(forestock, col(C_WOOD), 'gradY');
    const fsm = new THREE.Mesh(forestock, polyVC);
    fsm.position.set(0, BARREL_Y_M - 0.012, -0.24);
    gun.add(fsm);
    // カルカ溝(右側面の縦溝)
    const ramrodGroove = new THREE.BoxGeometry(0.003, 0.010, 0.46);
    setColor(ramrodGroove, col(C_WOOD_D), 'flat');
    const rggm = new THREE.Mesh(ramrodGroove, polyVC);
    rggm.position.set(0.022, BARREL_Y_M - 0.022, -0.24);
    gun.add(rggm);
    // 木製ストック(後床)
    const stock = chamferBox(0.048, 0.076, 0.130, 0.007);
    setColor(stock, col(C_WOOD), 'gradY');
    const stk = new THREE.Mesh(stock, polyVC);
    stk.position.set(0, -0.020, 0.100);
    gun.add(stk);
    // グリップネック
    const neck = chamferBox(0.036, 0.056, 0.068, 0.005);
    setColor(neck, col(C_WOOD), 'gradY');
    const nm3 = new THREE.Mesh(neck, polyVC);
    nm3.position.set(0, -0.010, 0.040);
    gun.add(nm3);
    // レシーバ(火挟座)
    const receiver = chamferBox(0.062, 0.072, 0.28, 0.005);
    setColor(receiver, col(C_STEEL3), 'machined');
    const rcvm = new THREE.Mesh(receiver, metalVC);
    rcvm.position.set(0, 0, 0);
    gun.add(rcvm);
    // バレル(超長銃身)
    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.52, 10);
    setColor(barrelGeo, col(C_STEEL3), 'gradY');
    const bgm = new THREE.Mesh(barrelGeo, metalVC);
    bgm.position.set(0, BARREL_Y_M, -0.26);
    bgm.rotation.set(Math.PI / 2, 0, 0);
    gun.add(bgm);
    // 銃身帯金 3本
    for (let bi4 = 0; bi4 < 3; bi4 += 1) {
      const bz = -0.06 - bi4 * 0.16;
      const band = new THREE.BoxGeometry(0.050, 0.020, 0.018);
      setColor(band, col(C_BRASS), 'flat');
      const bdm = new THREE.Mesh(band, polishVC);
      bdm.position.set(0, BARREL_Y_M - 0.018, bz);
      gun.add(bdm);
    }
    // 火挟(サーペンタイン): 下部ピン
    const serpPin = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 8);
    setColor(serpPin, col(C_STEEL3), 'machined');
    const spm = new THREE.Mesh(serpPin, polishVC);
    spm.position.set(0.034, 0.020, 0.050);
    spm.rotation.set(0, 0, Math.PI / 2);
    gun.add(spm);
    // 蛇胴(S字中央)
    const serpBody = new THREE.BoxGeometry(0.008, 0.042, 0.012);
    setColor(serpBody, col(C_STEEL3), 'machined');
    const sbgm = new THREE.Mesh(serpBody, polishVC);
    sbgm.position.set(0.036, 0.042, 0.050);
    sbgm.rotation.set(0, 0, 0.3);
    gun.add(sbgm);
    // 火縄挟み頭部(上端クランプ)
    const serpHead = new THREE.BoxGeometry(0.012, 0.018, 0.016);
    setColor(serpHead, col(C_BRASS), 'edgeHi');
    const shm3 = new THREE.Mesh(serpHead, polishVC);
    shm3.position.set(0.030, 0.074, 0.052);
    gun.add(shm3);
    // 火皿(フラッシュパン)
    const pan = chamferBox(0.028, 0.010, 0.022, 0.003);
    setColor(pan, col(C_BRASS), 'flat');
    const panm = new THREE.Mesh(pan, polishVC);
    panm.position.set(0.040, BARREL_Y_M + 0.002, 0.01);
    gun.add(panm);
    // 火蓋
    const panLid = new THREE.BoxGeometry(0.030, 0.004, 0.020);
    setColor(panLid, col(C_BRASS), 'flat');
    const plm = new THREE.Mesh(panLid, polishVC);
    plm.position.set(0.040, BARREL_Y_M + 0.009, 0.01);
    gun.add(plm);
    // アクセント帯
    const accentBand = new THREE.BoxGeometry(0.064, 0.012, 0.060);
    setColor(accentBand, col(def.tracerColor), 'flat');
    const acbm = new THREE.Mesh(accentBand, accent);
    acbm.position.set(0, 0.0, 0.06);
    gun.add(acbm);
    // ビード照準: bead Y = BARREL_Y + 0.020*0.6 + BEAD_FLOAT = 0.032(resolveSightY 契約)
    // R49: BO3スタイルの浮遊マイクロドットへ統一(旧brassビード球+太い琥珀点を置換)。
    // R50: ベゼルリングはユーザー要望で撤去(円形不要、ドットのみ)。
    // R51: BEAD_FLOAT を加算しドットを浮かせる(視界改善)。
    const beadY = BARREL_Y_M + 0.020 * 0.6 + BEAD_FLOAT;
    const microMusket = getAccent(0xff3b1a);
    const microM = new THREE.Mesh(new THREE.SphereGeometry(0.0019, 8, 6), microMusket);
    microM.position.set(0, beadY, -0.156);
    gun.add(microM);
    // カモ適用
    const musketCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (musketCamo) {
      const ccm7 = getCamoMaterial(musketCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && (node.material === metalVC || node.material === polyVC)) {
          node.material = ccm7;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を火縄銃でも進める
        }
      });
    }
    // muzzle z < 0 契約
    const muzzleMusket = new THREE.Object3D();
    muzzleMusket.position.set(0, BARREL_Y_M, -0.53);
    gun.add(muzzleMusket);
    return { gun, muzzle: muzzleMusket };
  }

  // ── lightning-staff: 節付き握り革+螺旋銘+爪3本がクリスタルを掴む天雷杖 ────────
  if (def.shape === 'lightning-staff') {
    const { metalVC, polishVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_STAFF = 0x1a1e28;
    const C_RING  = 0x404858;
    const C_CLAW  = 0x505f72;
    // シャフト本体
    const staffBody = new THREE.CylinderGeometry(0.016, 0.012, 0.72, 10);
    setColor(staffBody, col(C_STAFF), 'gradY');
    const stm6 = new THREE.Mesh(staffBody, metalVC);
    stm6.position.set(0, 0, -0.18);
    stm6.rotation.set(Math.PI / 2, 0, 0);
    gun.add(stm6);
    // 握り革の節(竹節): 4個
    for (let ni = 0; ni < 4; ni += 1) {
      const nodeZ = 0.06 - ni * 0.048;
      const node = new THREE.TorusGeometry(0.020, 0.006, 8, 14);
      setColor(node, col(C_RING), 'edgeHi');
      const nm2 = new THREE.Mesh(node, polishVC);
      nm2.position.set(0, 0, nodeZ);
      gun.add(nm2);
    }
    // 螺旋の銘: シャフト上に小ボックスを螺旋状に配置
    const spiralN = 10;
    for (let si2 = 0; si2 < spiralN; si2 += 1) {
      const t  = si2 / spiralN;
      const sa = t * Math.PI * 3.5;
      const sz = -0.02 - t * 0.44;
      const groove = new THREE.BoxGeometry(0.003, 0.003, 0.014);
      setColor(groove, col(C_RING), 'flat');
      const gm2 = new THREE.Mesh(groove, polishVC);
      gm2.position.set(Math.cos(sa) * 0.018, Math.sin(sa) * 0.018, sz);
      gm2.rotation.set(Math.PI / 2, sa + Math.PI / 2, 0);
      gun.add(gm2);
    }
    // クリスタルベースリング
    const crystalBase = new THREE.TorusGeometry(0.028, 0.007, 8, 16);
    setColor(crystalBase, col(C_RING), 'edgeHi');
    const cbm = new THREE.Mesh(crystalBase, polishVC);
    cbm.position.set(0, 0, -0.50);
    gun.add(cbm);
    // 先端金具爪 3本
    for (let ci3 = 0; ci3 < 3; ci3 += 1) {
      const ca = (ci3 / 3) * Math.PI * 2;
      const claw = new THREE.BoxGeometry(0.007, 0.006, 0.062);
      setColor(claw, col(C_CLAW), 'machined');
      const clm = new THREE.Mesh(claw, polishVC);
      clm.position.set(Math.cos(ca) * 0.034, Math.sin(ca) * 0.034, -0.48);
      clm.rotation.set(-Math.PI / 7, 0, ca + Math.PI / 2);
      gun.add(clm);
    }
    // 八面体クリスタル(tracerColor発光)
    const crystal = new THREE.OctahedronGeometry(0.04, 0);
    setColor(crystal, col(def.tracerColor), 'flat');
    const crystalMat = accent.clone();
    crystalMat.transparent = true;
    crystalMat.opacity = 0.9;
    const crm3 = new THREE.Mesh(crystal, crystalMat);
    crm3.name = 'vm:crystal';
    crm3.position.set(0, 0, -0.54);
    crm3.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    gun.add(crm3);
    // 中間リング × 2
    for (let ri = 0; ri < 2; ri += 1) {
      const ring2 = new THREE.TorusGeometry(0.022, 0.006, 8, 16);
      setColor(ring2, col(C_RING), 'edgeHi');
      const rm4 = new THREE.Mesh(ring2, polishVC);
      rm4.position.set(0, 0, -0.10 - ri * 0.18);
      gun.add(rm4);
    }
    const staffCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (staffCamo) {
      const ccm = getCamoMaterial(staffCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && (node.material === metalVC || node.material === polishVC)) {
          node.material = ccm;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を天雷杖でも進める
        }
      });
    }
    const muzzleSt = new THREE.Object3D();
    muzzleSt.position.set(0, 0, -0.57);
    gun.add(muzzleSt);
    return { gun, muzzle: muzzleSt };
  }

  // ── minigun: 正六角配置の6バレル+銃口リング+ハンドル+給弾ベルト箱 ──────────────
  if (def.shape === 'minigun') {
    const { metalVC, polishVC, polyVC } = getShared();
    const accent = getAccent(def.tracerColor);
    const C_BODY   = 0x1e2430;
    const C_BARREL = 0x14171e;
    const C_RING   = 0x404858;
    const C_HANDLE = 0x191c22;
    const bs2 = def.bodyScale ?? 1.6;
    // レシーバ本体
    const recBodyMG = chamferBox(0.16 * bs2, 0.16 * bs2, 0.52 * bs2, 0.012 * bs2);
    setColor(recBodyMG, col(C_BODY), 'machined');
    const rbm = new THREE.Mesh(recBodyMG, metalVC);
    rbm.position.set(0, 0, -0.06 * bs2);
    gun.add(rbm);
    // アクセントライン
    const recAccent = new THREE.BoxGeometry(0.162 * bs2, 0.012, 0.40 * bs2);
    setColor(recAccent, col(def.tracerColor), 'flat');
    const racm = new THREE.Mesh(recAccent, accent);
    racm.position.set(0, 0.085 * bs2, -0.06 * bs2);
    gun.add(racm);
    // バレルクラスター Group(vm:barrel)
    const barrelGroup = new THREE.Group();
    barrelGroup.name = 'vm:barrel';
    const rMG = 0.070 * bs2;
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const bx = Math.cos(angle) * rMG;
      const by = Math.sin(angle) * rMG;
      const bz = -(0.28 + 0.09) * bs2;
      const barrelMG = new THREE.CylinderGeometry(0.018 * bs2, 0.020 * bs2, 0.50 * bs2, 8);
      setColor(barrelMG, col(C_BARREL), 'gradY');
      const bmg = new THREE.Mesh(barrelMG, metalVC);
      bmg.position.set(bx, by, bz);
      bmg.rotation.set(Math.PI / 2, 0, 0);
      barrelGroup.add(bmg);
      // バレル前端の銃口リング
      const muzzleRing = new THREE.TorusGeometry(0.019 * bs2, 0.005 * bs2, 6, 12);
      setColor(muzzleRing, col(C_RING), 'edgeHi');
      const mrm = new THREE.Mesh(muzzleRing, polishVC);
      mrm.position.set(bx, by, bz - 0.252 * bs2);
      barrelGroup.add(mrm);
    }
    gun.add(barrelGroup);
    // 前端リング
    const frontRing = new THREE.TorusGeometry(0.098 * bs2, 0.015 * bs2, 8, 20);
    setColor(frontRing, col(C_RING), 'edgeHi');
    const frm = new THREE.Mesh(frontRing, polishVC);
    frm.position.set(0, 0, -0.57 * bs2);
    gun.add(frm);
    // 後端リング
    const rearRing = new THREE.TorusGeometry(0.098 * bs2, 0.015 * bs2, 8, 20);
    setColor(rearRing, col(C_RING), 'edgeHi');
    const rrm = new THREE.Mesh(rearRing, polishVC);
    rrm.position.set(0, 0, 0.22 * bs2);
    gun.add(rrm);
    // 中間アクセントリング
    const accentRingMG = new THREE.TorusGeometry(0.092 * bs2, 0.007 * bs2, 8, 20);
    setColor(accentRingMG, col(def.tracerColor), 'flat');
    const armg = new THREE.Mesh(accentRingMG, accent);
    armg.position.set(0, 0, -0.12 * bs2);
    gun.add(armg);
    // 給弾ベルト箱
    const ammoBox = chamferBox(0.082 * bs2, 0.124 * bs2, 0.145 * bs2, 0.008 * bs2);
    setColor(ammoBox, col(C_BODY), 'gradY');
    const abm = new THREE.Mesh(ammoBox, polyVC);
    abm.position.set(0, -0.145 * bs2, -0.01 * bs2);
    gun.add(abm);
    // ベルトコネクタ
    const beltConn = new THREE.BoxGeometry(0.030 * bs2, 0.030 * bs2, 0.035 * bs2);
    setColor(beltConn, col(C_RING), 'flat');
    const bcm = new THREE.Mesh(beltConn, polishVC);
    bcm.position.set(0, -0.07 * bs2, -0.015 * bs2);
    gun.add(bcm);
    // ハンドル(グリップ)
    const handleGeo = chamferBox(0.052 * bs2, 0.110 * bs2, 0.056 * bs2, 0.006 * bs2);
    setColor(handleGeo, col(C_HANDLE), 'gradY');
    const hgm = new THREE.Mesh(handleGeo, polyVC);
    hgm.position.set(0, -0.130 * bs2, 0.14 * bs2);
    hgm.rotation.set(0.30, 0, 0);
    gun.add(hgm);
    // マウントアーム
    const mountArm = new THREE.BoxGeometry(0.042 * bs2, 0.042 * bs2, 0.168 * bs2);
    setColor(mountArm, col(C_BODY), 'gradY');
    const mam = new THREE.Mesh(mountArm, metalVC);
    mam.position.set(0, 0.052 * bs2, 0.26 * bs2);
    gun.add(mam);
    const minigunCamo: CamoId | null =
      camoId === undefined ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId) ? camoId : null;
    if (minigunCamo) {
      const ccm = getCamoMaterial(minigunCamo);
      gun.traverse((node) => {
        if (node instanceof THREE.Mesh && (node.material === metalVC || node.material === polyVC)) {
          node.material = ccm;
          node.onBeforeRender = tickCamoTime; // 時間アニメ系カモ(pap2等)を修羅でも進める
        }
      });
    }
    const muzzleMG = new THREE.Object3D();
    muzzleMG.position.set(0, 0, -0.62 * bs2);
    gun.add(muzzleMG);
    return { gun, muzzle: muzzleMG };
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

  // R25 カモ: 装備カモ(または明示指定)を主要メタル/ポリマーバケツへ適用。
  // fists は上の早期分岐で戻っているためここには来ない(=カモ対象外)。
  const camo: CamoId | null =
    camoId === undefined
      ? resolveEquippedCamo(def.id)
      : camoId !== null && isKnownCamoId(camoId)
        ? camoId
        : null;
  const camoMat = camo ? getCamoMaterial(camo) : null;

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
  // R49: BO3参考画像スタイルへ統一 — 極小浮遊ドット(赤橙)。旧・前照星の黒ポスト箱+
  // 太い琥珀ビードは視界を塞ぐ主因だったため撤去し、支柱なしで浮かぶマイクロドットへ置換。
  // R50: ベゼルリングはユーザー要望で全撤去(円形不要)。フレームは「耳」2本が担う —
  // 参考画像に寄せて長く・細く(h0.065/w0.005、ロール0.34→0.18でほぼ垂直)、先端+基部に琥珀点。
  if (!sil.scope) {
    const amberMat = getAccent(0xffab1e); // 琥珀ファイバ(耳のアクセント。shared+disposeSharedで解放)
    const microMat = getAccent(0xff3b1a); // BO3風・浮遊マイクロドット(赤橙、照準点=着弾点)
    const amberDot = (x: number, y: number, z: number, r: number): void => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), amberMat);
      d.position.set(x, y, z);
      gun.add(d);
    };
    const microDot = (x: number, y: number, z: number, r: number): void => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), microMat);
      d.position.set(x, y, z);
      gun.add(d);
    };
    // 後照星の「耳」2本(参考画像のクワガタ型フレーム)+ 基部/先端の琥珀点。
    // R50: 画像に寄せて長く(h 0.04→0.065)・細く(w 0.008→0.005/d 0.01→0.008)、
    // ロール 0.34→0.18(画像の耳はほぼ垂直で先端がわずかに開く)。
    // R51: ユーザー要望「ベゼル(クワガタ耳)を横に広く」— 耳X ±0.028→±0.038(寸法h/w/d/rollは不変、
    // 新規リング/ベゼル形状は追加しない)。ドット上昇(IRON_POST_Y)に合わせ枠も追従させる:
    // earPy 0.066→0.070 / full-rail 0.072→0.076。先端琥珀点は新しい耳先端へ追従
    // (x = 0.038 + sin0.18*h/2 ≈ 0.044, y = earPy + cos0.18*h/2 ≈ earPy+0.03)。
    // bead機(ショットガン)は前ビードがバレル上(高い)で耳と挟まないため耳を出さず単ドット構成に。
    if (det.iron !== 'bead') {
      // full-rail機は耳を少し上げて上端レール線に枠を揃える(0.076)。他機は 0.070。
      const earPy = det.railTop === 'full' ? 0.076 : 0.070;
      for (const sx of [-1, 1] as const) {
        // Fix-1: 後照星耳を明るいミリタリーグレー(0x6a7e9a)へ。暗ステージで照門が消える問題の根治
        boxP(metalParts, 0x6a7e9a, 0.005, 0.065, 0.008, sx * 0.038, earPy, -recD - 0.006, 0, 0, sx * 0.18);
        amberDot(sx * 0.031, 0.064, -recD - 0.009, 0.0024);
        amberDot(sx * 0.044, earPy + 0.03, -recD - 0.009, 0.0024);
      }
    }
    if (det.iron === 'bead') {
      if (def.shape === 'launcher') {
        // ランチャー: マウンティングポスト+浮遊マイクロドット(R50: アパーチャリングは撤去=円形不要)。
        // ADS時にドット(y=0.088)が射線へ来る — resolveSightY 0.088 と一致させること。
        // これにより太い発射筒がカメラより下に逃げ、ドット越しに視界が通る。
        const RING_Y = 0.088;
        const RING_Z = -recHalf * 0.35; // レシーバ前方寄りの位置
        // マウンティングポスト(レシーバ天板 r.h/2 〜 ドット下 RING_Y-0.012 で止め、ドットを浮かせる)
        boxP(metalParts, C_DARK, 0.009, RING_Y - 0.012 - r.h / 2, 0.009, 0, (r.h / 2 + RING_Y - 0.012) / 2, RING_Z);
        // 浮遊マイクロドット(着弾点の直感的な目安)
        microDot(0, RING_Y, RING_Z - 0.005, 0.0021);
      } else {
        // ショットガン等: バレル上の前照星(R49: 浮遊マイクロドット。resolveSightY契約は
        // 個別Meshのマイクロドット中心Yで満たす)。R50: リング撤去(円形不要、ドットのみ)。
        // Fix-7: SG3種(shotgun-pump/double)の bead Y を +0.016 引き上げ(レシーバ上端突出を解消)
        // R51: BEAD_FLOAT を加算しドットを浮かせる(視界改善。musket早期分岐と同一定数)。
        const isSgBead = def.shape === 'shotgun-pump' || def.shape === 'shotgun-double'
          || (!def.shape && def.class === 'shotgun');
        const beadY = BARREL_Y + gauge * 0.6 + (isSgBead ? 0.016 : 0) + BEAD_FLOAT;
        const amberZ = barFrontZ + 0.024;
        microDot(0, beadY, amberZ, 0.0021);
      }
    } else if (det.iron !== 'none') {
      // R49: 前照星の黒ポスト箱+太い琥珀ビードを撤去し、支柱なしで浮かぶマイクロドットへ統一
      // (BO3参考画像スタイル)。狙点=resolveSightY IRON_POST_Y に一致・凍結(x0/z0.14 は不変)。
      // R50: ベゼルリング撤去 — 長く細くした耳の間に中央で浮かぶ。
      // R51: ユーザー要望「ドットをもう少し浮かせて」— 0.062→IRON_POST_Y(0.075)。
      microDot(0, IRON_POST_Y, 0.14, 0.0021);
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
          reflexDotWindow(sy, 0.018, 0.009, 0.05); // Fix-2: dotS 0.006→0.009
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
          // Fix-2: holo ドット 0.008→0.012 (×1.5 統一拡大)
          const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.012), reflexDot);
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
          reflexDotWindow(sy, 0.011, 0.008, 0.05); // Fix-2: dotS 0.005→0.008
          break;
        }
        case 'delta': {
          // デルタ(プリズム)サイト: コンパクト本体+上レール+etchedレティクル。
          bakeAt(metalParts, chamferBox(0.038, 0.05, 0.05, 0.004), C_DARK, 0, sy - 0.01, 0.05);
          boxP(metalParts, C_RIM, 0.038, 0.006, 0.05, 0, sy + 0.016, 0.05, 0, 0, 0, 'flat');
          // R13: レンズ/ドットは筐体の射手側面(z≈0.075)より手前へ。ソリッド箱に潜ると
          // 不透明筐体が先に深度を書き、depthTestでドット断片が破棄されて見えなくなる
          reflexDotWindow(sy, 0.014, 0.009, 0.09); // Fix-2: dotS 0.006→0.009
          break;
        }
        case 'canted': {
          // カンテッド(副照準): 左へ僅かにロールした小型ハウジング。ADS整合のため dot は sy 中心。
          bakeAt(metalParts, chamferBox(0.03, 0.03, 0.04, 0.003), C_DARK, 0, sy - 0.006, 0.055, 0, 0, 0.5);
          // R13: dz を筐体の射手側面(z≈0.075)より手前へ出しドット埋没(深度オクルージョン)を回避
          reflexDotWindow(sy, 0.01, 0.008, 0.088); // Fix-2: dotS 0.005→0.008
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
          reflexDotWindow(sy, 0.016, 0.009, -0.02); // Fix-2: dotS 0.006→0.009
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
  // カモ装備時はメタル/ポリマーバケツのみカモ材へ(研磨/発光帯/レンズは素のまま)。
  const addFamily = (parts: THREE.BufferGeometry[], material: THREE.Material, parent: THREE.Object3D): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, material);
    // 脈動カモ(uCamoTime)は描画側を問わず onBeforeRender で時刻を進める
    if (material instanceof CamoStandardMaterial) mesh.onBeforeRender = tickCamoTime;
    parent.add(mesh);
  };
  addFamily(metalParts, camoMat ?? metalVC, gun);
  addFamily(polishParts, polishVC, gun);
  addFamily(polyParts, camoMat ?? polyVC, gun);
  addFamily(accentParts, accent, gun);
  for (const mv of movables) {
    addFamily(mv.metal, camoMat ?? metalVC, mv.group);
    addFamily(mv.polish, polishVC, mv.group);
    addFamily(mv.poly, camoMat ?? polyVC, mv.group);
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
//   iron bead                → BARREL_Y + gauge*0.6 + BEAD_FLOAT (buildGunBody アイアンサイト bead microDot(…, beadY, …). R51でBEAD_FLOAT(+0.008)を加算)
//   iron post(fixed/flip/ghost)→ IRON_POST_Y(0.075)  (buildGunBody 前照星 microDot(0, IRON_POST_Y, 0.14, …)。R51でユーザー要望によりドットを浮かせる(旧0.062))
//   launcher ghost-ring        → 0.088               (buildGunBody launcher: amberDot(0, 0.088, …) ゴーストリング中心。R51では変更なし)
export function resolveSightY(def: WeaponDef): number {
  if (def.shape === 'fists') return 0;
  // ランチャー: ゴーストリングサイト中心(0.088)。ADS時に筒/レシーバを射線より下へ逃がして視界を通す。
  if (def.shape === 'launcher') return 0.088;
  // R33 特殊形状: 照準線を射線中心(0)に固定してADS時に武器ジオメトリが射線へ寄る。
  if (def.shape === 'shuriken-hand') return 0;
  // R33 天雷杖: クリスタル先端を射線中心(0)に整合(F10)。
  if (def.shape === 'lightning-staff') return 0;
  // R33 ミニガン: バレルクラスター中心Y=0に整合(F4)。
  if (def.shape === 'minigun') return 0;
  // R33 和弓: 矢じり射線中心(0)に整合(F11)。
  if (def.shape === 'bow-japanese') return 0;
  // R33 鉄扇: 中心射線基準。
  if (def.shape === 'war-fan') return 0;
  // 光学(内蔵スコープ/着脱reflex/holo/…)は OPTIC_SPECS.sightY を単一真実源に。
  // 内蔵スコープは resolveOpticId が shape から scope-dmr/sniper/dsr を最優先で返す。
  const om = OPTIC_SPECS[resolveOpticId(def)];
  if (om) return om.sightY;
  // レジストリ外(iron/telescopic レガシー)のフォールバック。
  const sil = resolveSilhouette(def);
  const attachments = def.attachmentIds ?? [];
  if (attachments.includes('telescopic')) return 0.08;
  const det = resolveDetail(sil, def);
  if (det.iron === 'bead') {
    // Fix-7: SG3種(shotgun-pump/double) の bead sightY を +0.016 引き上げ(0.036→0.052)
    // R51: BEAD_FLOAT(+0.008) を加算しドットを浮かせる(buildGunBody bead分岐/musket早期分岐と同一定数)
    const resolvedShape = def.shape ?? classDefault(def.class);
    const isSgShape = resolvedShape === 'shotgun-pump' || resolvedShape === 'shotgun-double';
    return BARREL_Y + sil.barrelGauge * 0.6 + (isSgShape ? 0.016 : 0) + BEAD_FLOAT;
  }
  // R51: iron post(fixed/flip/ghost)機の狙点。ユーザー要望「もう少しドットを浮かせて」で 0.062→IRON_POST_Y。
  return IRON_POST_Y;
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
  // R53-W1 F3: 修羅(ミニガン)バレルクラスタ(スピンで回る)。setWeapon時に一度だけ捕捉し、
  // 毎フレームの gun.traverse 検索(旧実装)を廃す。
  barrel?: THREE.Object3D;
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
// ── スイングトレイル / 黒帝オーラの定数 ──────────────────────────────────
const TRAIL_POOL_SIZE = 3;
const TRAIL_MAX_LIFE = 0.12; // s
// KE-1: 10→22 (TrackA 黒炎14 + TrackB 紫電スパーク8)
const DARK_AURA_POOL_SIZE = 22;
const DARK_AURA_FLAME_COUNT = 14;          // KE-1 TrackA 枚数
const DARK_AURA_SPAWN_INTERVAL = 0.03;     // s (TrackA 黒炎スポーン間隔)
const DARK_SPARK_SPAWN_INTERVAL = 0.05;    // s (KE-1 TrackB 紫電スパーク間隔)
// RE-1: 雷帝常時スパーク雨
const LIGHTNING_SPARK_POOL_SIZE = 12;
const LIGHTNING_SPARK_SPAWN_INTERVAL = 0.08; // s
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

// 黒帝モード専用の腰だめ構え(darkHip)。ADS 逆手は既存 FIST_POSES.ads のままで不変。
// _darkPoseBlend(0→1)で 0.25s かけて FIST_POSES.rest → darkHip へ遷移する。
interface DarkPose {
  name: string;
  darkHip: { p: [number, number, number]; r: [number, number, number] };
}
const DARK_POSES: DarkPose[] = [
  // 刀: Ghostrunner水平構え — 刀身が画面下部を横切るほぼ水平の構え。
  // 柄は画面右下(x+, y-)、刃は左前方へ長く伸びる。
  // ry=1.35 で local -Z 軸が (-0.976, 0, -0.22) ≈ -X方向(左)へ横断するため刀身が水平になる。
  { name: FIST_KUNAI,        darkHip: { p: [0.12, -0.16, -0.02], r: [0.10, 1.35, -0.30] } },
  // 右腕: 右下から柄を支える
  { name: 'vm:fistRArm',     darkHip: { p: [0.09, -0.21, 0.12],  r: [0.42, 0.10, -0.06] } },
  // 右手: 柄グリップ位置(画面右下)
  { name: 'vm:fistRHand',    darkHip: { p: [0.08, -0.14, -0.07], r: [0.28, 0.13, -0.08] } },
  // 左腕: 刀身に添える左腕
  { name: 'vm:fistLArm',     darkHip: { p: [0.02, -0.17, -0.04], r: [0.34, 0.14, 0.02] } },
  // 左手: 柄下端に添える
  { name: 'vm:fistLHand',    darkHip: { p: [0.02, -0.10, -0.14], r: [0.25, 0.08, 0.03] } },
];
// ノード名 → darkHip の高速引き(update ループで毎フレーム使う・モジュール初期化時に構築)
const DARK_POSE_MAP = new Map<string, { p: [number, number, number]; r: [number, number, number] }>();
for (const dp of DARK_POSES) DARK_POSE_MAP.set(dp.name, dp.darkHip);

// R53 帝王溜め3段ポーズ(加算デルタの最大値=段3「黒雷・天壊」の大上段。刀を天へ掲げる)。
// スイングデルタと同じ加算チャネルなので rest/darkHip/ADS/resolveSightY 契約に無干渉。
// 段→レベル: 0=0 / 1=0.3(浅い引き) / 2=0.6(満ちる) / 3=1.0(大上段)。
// M3配線: 溜め経過 0.5/1.2/2.2s の閾値跨ぎで setEmperorChargeStage(1|2|3)、リリース/中断で 0。
const EMPEROR_CHARGE_MAX = new Map<string, { p: [number, number, number]; r: [number, number, number] }>([
  [FIST_KUNAI, { p: [0.02, 0.12, 0.05], r: [-1.15, -0.2, 0.25] }],
  ['vm:fistRArm', { p: [0.01, 0.08, 0.03], r: [-0.55, 0, 0] }],
  ['vm:fistRHand', { p: [0, 0.06, 0.02], r: [-0.45, 0, 0] }],
  ['vm:fistLArm', { p: [0.02, 0.05, 0], r: [-0.35, 0, 0] }],
  ['vm:fistLHand', { p: [0.02, 0.04, 0], r: [-0.3, 0, 0] }],
]);
const EMPEROR_STAGE_LEVEL = [0, 0.3, 0.6, 1.0] as const;

// R53 白芯雷脈の共有マテリアル(モジュール寿命・全ブレードで1個。disposeSharedとは独立の
// 恒久キャッシュだが、userData.shared=true により全dispose経路でスキップされる=二重解放なし)
let katanaVeinMat: THREE.MeshBasicMaterial | null = null;
function getKatanaVeinMat(): THREE.MeshBasicMaterial {
  if (!katanaVeinMat) {
    katanaVeinMat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff, // 白芯(僅かに氷青)
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    katanaVeinMat.userData.shared = true;
  }
  return katanaVeinMat;
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
  // R53-W2: PaP改造演出(playPapUpgradeAnim)。武器が沈む→(非reduceMotion時のみ)発光
  // パルス→戻る。fire/reload可動ノード契約(rest=identity)には触れず、root一時オフセット+
  // アクセント材emissiveIntensity操作のみで表現する(rig.*ノードは不変)。
  private _papAnimTimer = 0; // 残り秒数(0=非活性)
  private _papAnimDuration = 0; // このアニメの総尺(進捗計算の分母)
  private _papAnimReduced = false; // true=短縮(0.5s)+パルス省略
  // アクセント材参照(tracerColorキャッシュ)。setWeapon毎に再取得。PaPパルスの対象。
  private _accentMat: THREE.MeshStandardMaterial | null = null;
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

  // ── スイングアニメーション(クナイ専用) ──────────────────────────────────
  private swingTimer = 0; // 残り時間(0=終了)
  private swingDuration = 0; // 総時間
  private swingType = -1; // -1=なし, 0=右薙ぎ, 1=左薙ぎ, 2=突き
  private _trailLastSpawnProg = -1; // トレイルスポーン済みフェーズ(重複防止)
  private readonly _trailGroup = new THREE.Group();
  private readonly _trailPool: Array<{ mesh: THREE.Mesh; life: number; maxLife: number }> = [];

  // ── 黒帝モード ───────────────────────────────────────────────────────────
  private _darkMode = false;
  // 刀構えブレンド係数。0=通常クナイ構え(FIST_POSES.rest), 1=黒帝刀構え(DARK_POSES.darkHip)
  // update()内で _darkMode に追従して 0.25s lerp。解除でも 0.25s かけてクナイ構えへ戻る。
  private _darkPoseBlend = 0;
  private readonly _darkAuraGroup = new THREE.Group();
  private readonly _darkAuraPool: Array<{
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    vel: THREE.Vector3;
    track: 'flame' | 'spark'; // KE-1: TrackA=flame(黒炎), TrackB=spark(紫電)
    sinPhase: number;          // KE-1 TrackA: X sin揺れ位相
    baseX: number;             // KE-1 TrackA: X揺れ基準位置
  }> = [];
  private _darkAuraSpawnTimer = 0;
  private _darkSparkSpawnTimer = 0; // KE-1 TrackB 紫電スパーク用タイマー
  // 黒帝モードで追加した黒刀グループ(THREE.Group)またはリムメッシュ。disposal で traverse する
  private _darkOverlayMeshes: THREE.Object3D[] = [];

  // ── 雷帝/黒雷帝モード ──────────────────────────────────────────────────────
  private _lightningMode = false;
  private _kokuraiteiMode = false; // dark + lightning combined
  private _arcFlickerTimer = 0;    // blade arc flicker cycle
  private _lightningOverlayMeshes: THREE.Object3D[] = [];
  // TubeGeometry ベースの電気アーク(5本)。雷帝発動中に可視, darkMode 優先で非表示。
  private _lightningArcMeshes: THREE.Mesh[] = [];
  // R51: 各アークを個別に(8-15Hz感で)明滅させるための残タイマー。_lightningArcMeshes と
  // インデックス対応(_buildLightningArcMeshes で同じ長さへリセット)。ジオメトリ再構築なし
  // = opacity/visible の変調のみで「静止した線」に見えないようにする(アロケーション無し)。
  private _lightningArcFlickerT: number[] = [];
  // ── RE-1 雷帝常時スパーク雨プール ────────────────────────────────────────────
  private readonly _lightningSparkPool: Array<{
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    velY: number; // 落下速度 (負値 m/s)
  }> = [];
  private readonly _lightningSparkGroup = new THREE.Group();
  private _lightningSparkSpawnTimer = 0;

  // ── R33 特殊武器 状態フィールド ──────────────────────────────────────────
  private _bowCharge01 = 0;       // 月光弓チャージ 0-1
  private _staffCharge01 = 0;     // 天雷杖チャージ 0-1
  // R53 帝王溜め段(0=非溜め)。レベルは段目標へ平滑追従し、fistNodesへ加算ポーズを乗せる
  private _emperorChargeStage: 0 | 1 | 2 | 3 = 0;
  private _emperorChargeLevel = 0;
  // 段3の刀身発光ブースト対象(base=適用時点の元opacity。段0/武器切替で復元=R24キャッシュ教訓)
  private _chargeGlowMats: { mat: THREE.MeshBasicMaterial; base: number }[] = [];
  // R53 恒久報酬: 黒刀/雷刀の白芯雷脈(kokurai-100キル)。ブレード構築時に反映される
  private _katanaVeinsOn = false;
  private _minigunBarrelRot = 0;  // 修羅バレル回転角 (rad)
  private _minigunSpin01 = 0;     // 修羅スピン度合い 0-1 (スムース)
  // Fix-5: 万刃 ADS-z 制御用チャージ保存(setExoticCharge → update 橋渡し)
  private _banjinCharge01 = 0;

  // ── スクラッチ変数(Vector3/Matrix4 alloc を避ける) ──────────────────────
  private readonly _v3scratch = new THREE.Vector3();
  private readonly _m4scratch = new THREE.Matrix4();

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

    // ── トレイルプール初期化(三日月形 ShapeGeometry × TRAIL_POOL_SIZE) ──
    const trailShape = new THREE.Shape();
    trailShape.moveTo(-0.09, 0);
    trailShape.quadraticCurveTo(0, 0.012, 0.09, 0);
    trailShape.quadraticCurveTo(0, -0.006, -0.09, 0);
    const trailGeoBase = new THREE.ShapeGeometry(trailShape, 6);
    for (let _ti = 0; _ti < TRAIL_POOL_SIZE; _ti += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x8ab4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(trailGeoBase.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      this._trailGroup.add(mesh);
      this._trailPool.push({ mesh, life: 0, maxLife: 0 });
    }
    trailGeoBase.dispose();
    this.root.add(this._trailGroup);

    // ── 黒帝オーラプール初期化(KE-1: TrackA黒炎×14 + TrackB紫電スパーク×8) ──
    // TrackA: PlaneGeometry 0.06×0.08, NormalBlending, 漆黒 0x040008
    // TrackB: PlaneGeometry 0.03×0.03, AdditiveBlending, 暗紫 0x7700bb
    // 白飛び0.9規則: maxOpacity=0.52(TrackA) / 0.55(TrackB) ≤ 0.55 ✓
    const flameGeoBase = new THREE.PlaneGeometry(0.06, 0.08);
    const sparkGeoBase = new THREE.PlaneGeometry(0.03, 0.03);
    for (let _ai = 0; _ai < DARK_AURA_POOL_SIZE; _ai += 1) {
      const isFlame = _ai < DARK_AURA_FLAME_COUNT;
      const mat = new THREE.MeshBasicMaterial({
        color: isFlame ? 0x040008 : 0x7700bb,
        transparent: true,
        opacity: 0,
        blending: isFlame ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(isFlame ? flameGeoBase.clone() : sparkGeoBase.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      // ビルボード: PlaneGeometry が常にカメラ正面を向く
      mesh.onBeforeRender = (_r, _s, cam): void => {
        cam.getWorldQuaternion(_bbCamQ);
        if (mesh.parent) {
          mesh.parent.getWorldQuaternion(_bbParentQ);
          _bbParentQ.invert();
          mesh.quaternion.copy(_bbCamQ).premultiply(_bbParentQ);
        } else {
          mesh.quaternion.copy(_bbCamQ);
        }
      };
      this._darkAuraGroup.add(mesh);
      this._darkAuraPool.push({
        mesh,
        life: 0,
        maxLife: 0,
        vel: new THREE.Vector3(),
        track: isFlame ? 'flame' : 'spark',
        sinPhase: 0,
        baseX: 0,
      });
    }
    flameGeoBase.dispose();
    sparkGeoBase.dispose();
    this.root.add(this._darkAuraGroup);

    // ── RE-1 雷帝スパーク雨プール初期化(PlaneGeometry 0.04 × LIGHTNING_SPARK_POOL_SIZE) ──
    // _kokuraiteiMode=false かつ _lightningMode=true の時のみ頭周囲へスポーン。
    // 白飛び0.9規則: maxOpacity=0.52 ≤ 0.55 ✓
    const lsGeoBase = new THREE.PlaneGeometry(0.04, 0.04);
    for (let _lsi = 0; _lsi < LIGHTNING_SPARK_POOL_SIZE; _lsi += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44aaff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(lsGeoBase.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      // ビルボード: 雷帝スパーク雨粒子も常にカメラ正面向き
      mesh.onBeforeRender = (_r, _s, cam): void => {
        cam.getWorldQuaternion(_bbCamQ);
        if (mesh.parent) {
          mesh.parent.getWorldQuaternion(_bbParentQ);
          _bbParentQ.invert();
          mesh.quaternion.copy(_bbCamQ).premultiply(_bbParentQ);
        } else {
          mesh.quaternion.copy(_bbCamQ);
        }
      };
      this._lightningSparkGroup.add(mesh);
      this._lightningSparkPool.push({ mesh, life: 0, maxLife: 0, velY: 0 });
    }
    lsGeoBase.dispose();
    this.root.add(this._lightningSparkGroup);
  }

  setWeapon(def: WeaponDef): void {
    if (this.gun) this.root.remove(this.gun);
    // 装備カモを解決してキャッシュキーに含める(ARMORYで変更→次のsetWeaponで反映)。
    // キー分離により材の差し替え/復元は不要=共有マテリアルの元本を汚さない(R24教訓)。
    // R53-W2: PaP鍛神(def.papCamo)は選択カモより優先(matchがクローンdefに積む契約。
    // camo.ts の通常解放ラダーとは無関係のシステム付与カモ)。camo変数へ折り込むだけで
    // キャッシュキーも自動分離される(R33教訓通り、キー変更=見た目変更)。
    const camo = def.papCamo ?? resolveEquippedCamo(def.id);
    const key = `${def.id}:${(def.attachmentIds ?? []).join(',')}:${camo ?? ''}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.buildGun(def, camo);
      this.cache.set(key, entry);
    }
    this.gun = entry.gun;
    this.muzzle = entry.muzzle;
    this.root.add(this.gun);
    this.muzzle.add(this.flashMesh);
    // R53-W2: PaP改造演出(playPapUpgradeAnim)の発光パルス対象。tracerColorは全形状で必須
    // フィールドなので常に解決できる(fists含む)。武器切替のたびに再取得すれば十分安全。
    this._accentMat = getAccent(def.tracerColor);
    this.muzzle.add(this.flashLight);
    this.captureRig();
    // サプレッサー装着状態をキャッシュ(fire() フラッシュ減光で参照する)
    this.isSuppressed = !!def.suppressed || (def.attachmentIds ?? []).includes('suppressor');
    // 各武器のサイト高さを ADS 収束 Y へ反映(attachmentIds 可変にも追従)。キャッシュ両経路後。
    this.adsY = -resolveSightY(def);
    // R53-W1 F1/F2: 修羅(minigun)/風神扇(war-fan)は通常の中央収束だと前面ジオメトリが
    // 画面のほぼ全域を覆うため、専用の据え撃ちブレース位置へ差し替える(BRACE_ADS_TARGET
    // 直上のコメント参照)。resolveSightY 契約(adsY 自体)は不変 = 他武器・他契約に無干渉。
    if (def.shape === 'minigun' || def.shape === 'war-fan') {
      this.adsTarget.copy(BRACE_ADS_TARGET);
    } else {
      this.adsTarget.set(ADS_X, this.adsY, ADS_Z);
    }
    // 黒帝モード状態保持: 武器切替を跨いで _darkMode=true を維持。fists再装備でビジュアル再適用。
    if (this._darkMode) {
      this._removeDarkRimOverlay(); // 古い銃のリムオーバーレイを削除
      if (def.shape === 'fists') {
        this._applyDarkModeVisuals();
      }
    }
    // 雷帝/黒雷帝モード状態保持: 武器切替を跨いで維持。fists再装備でビジュアル再適用。
    if (this._lightningMode) {
      this._removeLightningOverlay();
      if (def.shape === 'fists') {
        this._applyLightningModeVisuals();
      }
    }
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
          barrel: g.getObjectByName('vm:barrel'),
        }
      : {};
    // R53: 帝王溜め段は武器切替で必ず解除(発光ブーストの復元も含む — キャッシュ越境防止)
    this.setEmperorChargeStage(0);
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
  private buildGun(def: WeaponDef, camo: CamoId | null = null): { gun: THREE.Group; muzzle: THREE.Object3D } {
    const { gun, muzzle } = buildGunBody(def, camo);
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
      // クナイ3連モーション: 小さな root 揺れ + fistNodes スイングアニメーション開始
      // ━ root 揺れは従来より抑え気味(スイングオフセットが主役)
      const v = ((variation % 3) + 3) % 3;
      if (v === 0) {
        // 右薙ぎ: 右ロール + 軽い前キック
        this.kickZ = Math.min(0.05, this.kickZ + 0.03);
        this.kickRot = Math.min(0.08, this.kickRot + 0.05);
        this.kickSide = Math.min(0.06, this.kickSide + 0.04);
      } else if (v === 1) {
        // 左薙ぎ: 左ロール + 軽い前キック
        this.kickZ = Math.min(0.05, this.kickZ + 0.03);
        this.kickRot = Math.min(0.08, this.kickRot + 0.05);
        this.kickSide = Math.max(-0.06, this.kickSide - 0.04);
      } else {
        // 突き: 前キック
        this.kickZ = Math.min(0.08, this.kickZ + 0.07);
        this.kickRot = Math.min(0.07, this.kickRot + 0.05);
        this.kickSide *= 0.5;
      }
      // スイングアニメーション開始。進行中は即キャンセル→新規開始(480rpm連打対応)
      this.swingType = v;
      // 黒帝中は大太刀の重み+15%。480rpmキャンセル制(即再開始)は維持
      const darkDurScale = this._darkMode ? 1.15 : 1.0;
      this.swingDuration = (v === 2 ? 0.13 : 0.15) * darkDurScale;
      this.swingTimer = this.swingDuration;
      this._trailLastSpawnProg = -1; // スポーン状態リセット
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
    // トレイルプール解放
    for (const t of this._trailPool) {
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    // オーラプール解放(KE-1: TrackA/TrackB 共通)
    for (const a of this._darkAuraPool) {
      a.mesh.geometry.dispose();
      (a.mesh.material as THREE.Material).dispose();
    }
    // RE-1 雷帝スパーク雨プール解放
    for (const s of this._lightningSparkPool) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    // ダークリムオーバーレイ解放
    this._removeDarkRimOverlay();
    // 雷帝/黒雷帝オーバーレイ解放
    this._removeLightningOverlay();
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
    // スイングタイマー進行(fistNodes ブロックより前に decrement)
    if (this.swingTimer > 0) this.swingTimer = Math.max(0, this.swingTimer - dt);
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
    // R53-W2 PaP改造演出: 前後15%を沈み込み/復帰にease、中間は沈んだまま保持。
    // reduceMotion時は _papAnimReduced=true でパルス(papPulse)を0に固定するのみ
    // (沈み込み/復帰自体は同じ式のまま短尺(0.5s)で完了する)。
    let papPulse = 0;
    if (this._papAnimTimer > 0 && this._papAnimDuration > 0) {
      const t = 1 - this._papAnimTimer / this._papAnimDuration;
      const sinkIn = THREE.MathUtils.smoothstep(t, 0, 0.15);
      const sinkOut = 1 - THREE.MathUtils.smoothstep(t, 0.82, 1.0);
      landDip += 0.12 * Math.min(sinkIn, sinkOut);
      if (!this._papAnimReduced) {
        const pulseWindow =
          THREE.MathUtils.smoothstep(t, 0.12, 0.2) * (1 - THREE.MathUtils.smoothstep(t, 0.78, 0.86));
        papPulse = pulseWindow * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 6));
      }
      this._papAnimTimer = Math.max(0, this._papAnimTimer - dt);
    }
    // 火花的発光パルス: 既存アクセント材(getAccent)のemissiveIntensityを一時的に押し上げる。
    // 基準値0.5 + 最大0.25(peak 0.75 < bloom閾値0.9)。papPulse=0の間は常に基準値へ戻す
    // (タイマー満了後の最終フレームは既にpapPulse=0で書き込み済み=明示リセット不要)。
    if (this._accentMat && (this._papAnimTimer > 0 || papPulse > 0)) {
      this._accentMat.emissiveIntensity = 0.5 + papPulse * 0.25;
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

    // 黒帝刀構えブレンド: _darkMode時に 0.25s(lerp≈dt*4)かけて darkHipポーズへ遷移。
    // 解除でも同速で通常クナイ構えへ戻る。_darkPoseBlend は fistNodes ループ内で使用する。
    const _darkPoseTarget = this._darkMode ? 1.0 : 0.0;
    this._darkPoseBlend += (_darkPoseTarget - this._darkPoseBlend) * Math.min(1, dt * 4);

    // クナイ(素手)逆手ダガー構え: rest↔ads を adsVis で補間 + スイングオフセット加算。
    // スイングは加算デルタなので restポーズ/ADS逆手/resolveSightY 契約に無干渉。
    // 黒帝中は rest を DARK_POSES.darkHip へブレンドした上で ADS 補間する。
    if (this.fistNodes.length) {
      const p = adsVis;
      // スイングフラクション: 振り出し(0→0.4) は easeOutCubic、戻り(0.4→1) は smoothstep 1→0
      let swingFrac = 0;
      if (this.swingTimer > 0 && this.swingDuration > 0) {
        const sp = 1 - this.swingTimer / this.swingDuration;
        if (sp < 0.4) {
          const t = sp / 0.4;
          swingFrac = 1 - Math.pow(1 - t, 2.5); // easeOut: 鋭く振り抜く
        } else {
          const t = (sp - 0.4) / 0.6;
          swingFrac = 1 - t * t * (3 - 2 * t); // smoothstep 1→0: スッと構えへ戻る
        }
      }
      // 黒帝刀構え用呼吸ゆらぎ: 大太刀の刀先が僅かに揺れる(~0.21Hz, 振幅0.008rad)。
      // ADS 収束と _darkPoseBlend の積でゼロへ収束させる(resolveSightY 契約を守る)。
      const darkBreathRot =
        this._darkMode
          ? Math.sin(this.breathPhase * 0.7 + 0.5) * 0.008 * (1 - adsVis) * this._darkPoseBlend
          : 0;
      for (const { node, pose } of this.fistNodes) {
        const rp = pose.rest.p;
        const ap = pose.ads.p;
        const rr = pose.rest.r;
        const ar = pose.ads.r;
        // 黒帝中: rest をdarkHip へブレンドしてから ads 収束補間
        let rpx = rp[0], rpy = rp[1], rpz = rp[2];
        let rrx = rr[0], rry = rr[1], rrz = rr[2];
        if (this._darkPoseBlend > 0) {
          const dh = DARK_POSE_MAP.get(node.name);
          if (dh) {
            const b = this._darkPoseBlend;
            rpx += (dh.p[0] - rp[0]) * b;
            rpy += (dh.p[1] - rp[1]) * b;
            rpz += (dh.p[2] - rp[2]) * b;
            rrx += (dh.r[0] - rr[0]) * b;
            rry += (dh.r[1] - rr[1]) * b;
            rrz += (dh.r[2] - rr[2]) * b;
          }
        }
        const bx = rpx + (ap[0] - rpx) * p;
        const by = rpy + (ap[1] - rpy) * p;
        const bz = rpz + (ap[2] - rpz) * p;
        const brx = rrx + (ar[0] - rrx) * p;
        const bry = rry + (ar[1] - rry) * p;
        const brz = rrz + (ar[2] - rrz) * p;
        const sd = this._swingDelta(node.name, swingFrac);
        // 黒帝中かつ刀ノードには呼吸ゆらぎ(X軸回転)を加算して刀先が微動する演出を加える
        const breathAdd = node.name === FIST_KUNAI ? darkBreathRot : 0;
        // R53 帝王溜め段: 加算デルタ(段レベルに平滑追従)。ADS中は縮退(照準契約優先)
        const emp = EMPEROR_CHARGE_MAX.get(node.name);
        const el = this._emperorChargeLevel * (1 - p);
        const ex = emp ? emp.p[0] * el : 0;
        const ey = emp ? emp.p[1] * el : 0;
        const ez = emp ? emp.p[2] * el : 0;
        const erx = emp ? emp.r[0] * el : 0;
        const ery = emp ? emp.r[1] * el : 0;
        const erz = emp ? emp.r[2] * el : 0;
        node.position.set(bx + sd[0] + ex, by + sd[1] + ey, bz + sd[2] + ez);
        node.rotation.set(brx + sd[3] + breathAdd + erx, bry + sd[4] + ery, brz + sd[5] + erz);
      }
      // 溜めレベルの平滑追従+段3域(level>0.6)の刀身発光ブースト(base比+30%まで、opacity≤1)
      const empTarget = EMPEROR_STAGE_LEVEL[this._emperorChargeStage];
      this._emperorChargeLevel += (empTarget - this._emperorChargeLevel) * Math.min(1, dt * 10);
      if (this._chargeGlowMats.length) {
        const k = Math.max(0, (this._emperorChargeLevel - 0.6) / 0.4);
        for (const { mat, base } of this._chargeGlowMats) {
          mat.opacity = Math.min(1, base * (1 + 0.3 * k));
        }
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

    // スイングトレイルと黒帝オーラの毎フレーム更新
    this._updateTrails(dt);
    this._updateDarkAura(dt);
    // RE-1 雷帝スパーク雨の毎フレーム更新
    this._updateLightningSparkRain(dt);
    // R33 修羅バレル回転。R53-W1 F3: captureRig で捕捉済みの参照を使い、毎フレームの
    // traverse 検索を廃す(MovableRigの流儀。setWeapon 時に一度だけ引く)。
    if (this._minigunSpin01 > 0.01 && this.rig.barrel) {
      this._minigunBarrelRot += dt * this._minigunSpin01 * 26;
      this.rig.barrel.rotation.z = this._minigunBarrelRot;
    }
    // Fix-5: 万刃 ADS時ディスクz引き込み。腰だめ z=-0.12 → ADS z=+0.04 で視界クリア化。
    // setExoticCharge の charge オフセット(-c*0.06)と加算して update() が毎フレーム統合制御する。
    if (this.gun) {
      this.gun.traverse((child) => {
        if (child.name !== 'vm:shurikenBlade') return;
        child.position.z = THREE.MathUtils.lerp(-0.12, 0.04, adsVis) - this._banjinCharge01 * 0.06;
      });
    }
    // Fix-8: 天雷杖クリスタル ADS透過 (vm:crystal は tenrai-staff のみ存在)。
    // opacity 0.9(腰だめ) → 0.05(ADS) で視界確保。transparent=true は buildGunBody で設定済み。
    if (this.gun) {
      this.gun.traverse((child) => {
        if (child.name !== 'vm:crystal' || !(child instanceof THREE.Mesh)) return;
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.transparent) mat.opacity = THREE.MathUtils.lerp(0.9, 0.05, adsVis);
      });
    }
  }

  // ── スイングデルタ: ノード名とfrac(0→1)から fistNodes への追加変形(6要素配列)を返す ──
  // 各値は rest/ads ポーズへの加算オフセット。終了(frac=0)でゼロへ収束=休止ポーズ不変。
  private _swingDelta(
    name: string,
    f: number,
  ): [number, number, number, number, number, number] {
    if (f <= 0 || this.swingType < 0) return [0, 0, 0, 0, 0, 0];
    const t = this.swingType;
    // 黒帝中は大太刀にふさわしい振り幅1.4倍(3モーションの回転/移動デルタに適用)
    const amp = this._darkMode ? 1.4 : 1.0;
    if (name === FIST_KUNAI) {
      // 右薙ぎ: クナイが右→左へ弧を描き Zロールで切り込む
      if (t === 0) return [-0.14 * f * amp, -0.03 * f, -0.04 * f, -0.35 * f * amp,  0.6 * f * amp, -1.3 * f * amp];
      // 左薙ぎ: 逆方向
      if (t === 1) return [ 0.14 * f * amp, -0.03 * f, -0.04 * f, -0.35 * f * amp, -0.6 * f * amp,  1.3 * f * amp];
      // 突き: 前方へ鋭く突き込む
      return [0, 0.01 * f, -0.18 * f * amp, -0.8 * f * amp, 0, 0];
    }
    if (name === 'vm:fistRArm') {
      if (t === 0) return [-0.06 * f * amp, -0.01 * f, -0.02 * f,  0.05 * f * amp,  0.25 * f * amp, -0.45 * f * amp];
      if (t === 1) return [ 0.06 * f * amp, -0.01 * f, -0.02 * f,  0.05 * f * amp, -0.25 * f * amp,  0.45 * f * amp];
      return [0, 0, -0.06 * f * amp, -0.3 * f * amp, 0, 0];
    }
    if (name === 'vm:fistRHand') {
      if (t === 0) return [-0.04 * f * amp, -0.01 * f, -0.01 * f, 0.02 * f * amp,  0.18 * f * amp, -0.35 * f * amp];
      if (t === 1) return [ 0.04 * f * amp, -0.01 * f, -0.01 * f, 0.02 * f * amp, -0.18 * f * amp,  0.35 * f * amp];
      return [0, 0, -0.04 * f * amp, -0.2 * f * amp, 0, 0];
    }
    return [0, 0, 0, 0, 0, 0];
  }

  // ── トレイルのスポーン ────────────────────────────────────────────────────
  private _spawnTrail(phase: number): void {
    const trail = this._trailPool.find((tr) => tr.life <= 0);
    if (!trail) return;
    const kunai = this.gun?.getObjectByName(FIST_KUNAI);
    if (!kunai) return;
    // 刃先(kunaiローカル座標)を root ローカルへ変換。黒帝モード中は大型化後の黒刀刃先を使う
    this.root.updateWorldMatrix(true, false);
    // 通常クナイ刃先: セグメント2 前面 ≈ (0,-0.071,-0.495) → tipZ=-0.50
    const tipZ = this._darkMode ? -1.59 : -0.50;
    this._v3scratch.set(0, 0.006, tipZ);
    kunai.localToWorld(this._v3scratch);
    this._v3scratch.applyMatrix4(this._m4scratch.copy(this.root.matrixWorld).invert());
    trail.mesh.position.copy(this._v3scratch);
    // 向き: 薙ぎはロールを加え三日月が刃方向を指す
    const rz = this.swingType === 0 ? -0.4 : this.swingType === 1 ? 0.4 : 0;
    trail.mesh.rotation.set(0, 0, rz);
    trail.life = TRAIL_MAX_LIFE * (1 - phase * 0.35);
    trail.maxLife = trail.life;
    trail.mesh.visible = true;
    const mat = trail.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.55;
    mat.color.setHex(this._darkMode ? 0x6a00b0 : 0x8ab4ff);
  }

  // ── トレイルの毎フレーム更新 ──────────────────────────────────────────────
  private _updateTrails(dt: number): void {
    // 生存トレイルのフェードアウト
    for (const trail of this._trailPool) {
      if (trail.life > 0) {
        trail.life -= dt;
        const ratio = Math.max(0, trail.life / trail.maxLife);
        (trail.mesh.material as THREE.MeshBasicMaterial).opacity = ratio * 0.55;
        if (trail.life <= 0) trail.mesh.visible = false;
      }
    }
    // スポーン(スイング進行中かつクナイが有効なとき)
    if (this.swingTimer > 0 && this.swingDuration > 0 && this.gun?.getObjectByName(FIST_KUNAI)) {
      const sp = 1 - this.swingTimer / this.swingDuration;
      for (const thresh of [0.05, 0.22, 0.42] as const) {
        if (sp >= thresh && this._trailLastSpawnProg < thresh) {
          this._spawnTrail(thresh);
        }
      }
      this._trailLastSpawnProg = sp;
    } else if (this.swingTimer <= 0) {
      this._trailLastSpawnProg = -1;
    }
  }

  // ── KE-1 TrackA 黒炎スポーン ──────────────────────────────────────────────
  // PlaneGeometry 0.06×0.08, NormalBlending 0x040008, velY 0.9-1.6(上昇), 寿命0.35-0.55s
  // opacity 0→0.52→0(三角エンベロープ)。X は ±0.018 sin揺れで生存中に揺動する。
  private _spawnDarkFlame(): void {
    const slot = this._darkAuraPool.find((a) => a.life <= 0 && a.track === 'flame');
    if (!slot) return;
    const kunai = this.gun?.getObjectByName(FIST_KUNAI);
    if (!kunai) return;
    this.root.updateWorldMatrix(true, false);
    // 刃身全域にランダム散布(黒帝中は黒刀全域, 通常は刃身域)
    const auraZ = this._darkMode
      ? -0.19 - Math.random() * 0.90
      : -0.22 - Math.random() * 0.26;
    this._v3scratch.set(
      (Math.random() - 0.5) * 0.04,
      0.006 + (Math.random() - 0.5) * 0.03,
      auraZ,
    );
    kunai.localToWorld(this._v3scratch);
    this._v3scratch.applyMatrix4(this._m4scratch.copy(this.root.matrixWorld).invert());
    slot.mesh.position.copy(this._v3scratch);
    slot.baseX = this._v3scratch.x;
    slot.sinPhase = Math.random() * Math.PI * 2; // 初期位相ランダム
    slot.mesh.scale.setScalar(0.6 + Math.random() * 0.4);
    slot.mesh.rotation.z = Math.random() * Math.PI * 2;
    slot.life = 0.35 + Math.random() * 0.20; // 0.35-0.55s
    slot.maxLife = slot.life;
    slot.vel.set(0, 0.9 + Math.random() * 0.7, 0); // velY 0.9-1.6 m/s (上昇)
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  // ── KE-1 TrackB 紫電スパークスポーン ─────────────────────────────────────
  // PlaneGeometry 0.03, AdditiveBlending, 0x7700bb(通常)/0x8800ff(黒雷帝), velY -1.5〜-3.5
  // 0.05s毎に刃上ランダム位置へジャンプ。opacity 0→0.55→0, 寿命0.12-0.22s
  private _spawnDarkSpark(): void {
    const slot = this._darkAuraPool.find((a) => a.life <= 0 && a.track === 'spark');
    if (!slot) return;
    const kunai = this.gun?.getObjectByName(FIST_KUNAI);
    if (!kunai) return;
    this.root.updateWorldMatrix(true, false);
    const sparkZ = this._darkMode
      ? -0.19 - Math.random() * 0.90
      : -0.22 - Math.random() * 0.26;
    this._v3scratch.set(
      (Math.random() - 0.5) * 0.06,
      0.006 + (Math.random() - 0.5) * 0.04,
      sparkZ,
    );
    kunai.localToWorld(this._v3scratch);
    this._v3scratch.applyMatrix4(this._m4scratch.copy(this.root.matrixWorld).invert());
    slot.mesh.position.copy(this._v3scratch);
    slot.mesh.scale.setScalar(0.8 + Math.random() * 0.4);
    slot.mesh.rotation.z = Math.random() * Math.PI * 2;
    slot.life = 0.12 + Math.random() * 0.10; // 0.12-0.22s
    slot.maxLife = slot.life;
    slot.vel.set(0, -(1.5 + Math.random() * 2.0), 0); // velY -1.5〜-3.5 m/s (落下)
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    // 黒雷帝時はTrackBを強調色へ
    const sparkColor = this._kokuraiteiMode ? 0x8800ff : 0x7700bb;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(sparkColor);
  }

  // ── 黒帝オーラの毎フレーム更新 (KE-1: 2トラック対応) ───────────────────────
  // TrackA 黒炎: Y上昇(velY m/s直積分) + X sin揺れ(±0.018) + 三角opacity(0→0.52→0)
  // TrackB 紫電: Y落下(velY m/s直積分) + 三角opacity(0→0.55→0)
  // darkMode=false: 既存の即フェード契約継承(dt*3倍速、線形減衰)
  private _updateDarkAura(dt: number): void {
    if (!this._darkMode) {
      // darkMode=false でも生き残りパーティクルをフェードアウト(既存契約継承)
      for (const a of this._darkAuraPool) {
        if (a.life > 0) {
          a.life -= dt * 3; // 早めにフェード
          const peakOp = a.track === 'spark' ? 0.55 : 0.52;
          (a.mesh.material as THREE.MeshBasicMaterial).opacity =
            Math.max(0, a.life / a.maxLife) * peakOp;
          if (a.life <= 0) a.mesh.visible = false;
        }
      }
      return;
    }
    // 生存パーティクルの移動・フェード(2トラック分岐)
    for (const a of this._darkAuraPool) {
      if (a.life > 0) {
        a.life -= dt;
        if (a.track === 'flame') {
          // TrackA 黒炎: Y上昇(直積分) + X sin揺れ
          a.mesh.position.y += a.vel.y * dt;
          a.sinPhase += dt * 4.0; // ~0.64 Hz 揺れ
          a.mesh.position.x = a.baseX + 0.018 * Math.sin(a.sinPhase);
        } else {
          // TrackB 紫電スパーク: Y落下のみ(直積分)
          a.mesh.position.y += a.vel.y * dt;
        }
        // 三角エンベロープ opacity(0→peak→0)
        const peakOp = a.track === 'spark' ? 0.55 : 0.52;
        const ratio = a.life / a.maxLife; // 1→0
        (a.mesh.material as THREE.MeshBasicMaterial).opacity =
          peakOp * Math.sin(Math.PI * (1 - ratio));
        if (a.life <= 0) {
          (a.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
          a.mesh.visible = false;
        }
      }
    }
    // fists装備中のみスポーン
    if (this.gun?.getObjectByName(FIST_KUNAI)) {
      // TrackA 黒炎: 0.03s 毎
      this._darkAuraSpawnTimer -= dt;
      if (this._darkAuraSpawnTimer <= 0) {
        this._spawnDarkFlame();
        this._darkAuraSpawnTimer = DARK_AURA_SPAWN_INTERVAL;
      }
      // TrackB 紫電スパーク: 0.05s 毎
      this._darkSparkSpawnTimer -= dt;
      if (this._darkSparkSpawnTimer <= 0) {
        this._spawnDarkSpark();
        this._darkSparkSpawnTimer = DARK_SPARK_SPAWN_INTERVAL;
      }
    }
    // 電弧フリッカー: 0.05-0.09s ごとにランダム透明度変動
    if (this._lightningMode || this._kokuraiteiMode) {
      this._arcFlickerTimer -= dt;
      if (this._arcFlickerTimer <= 0) {
        this._arcFlickerTimer = 0.05 + Math.random() * 0.04;
        if (this.gun) {
          const lb = this.gun.getObjectByName('vm:lightningBlade');
          if (lb) {
            lb.traverse((child) => {
              if (!(child instanceof THREE.Mesh) || !child.userData['isArcLine']) return;
              const base = this._kokuraiteiMode ? 0.35 : 0.38;
              const flicker = base + Math.random() * 0.25;
              (child.material as THREE.MeshBasicMaterial).opacity = Math.min(1, flicker);
            });
          }
        }
      }
    }
    // 雷帝: 電気アークの個別フリッカー(R51: ジオメトリ再構築なし。各アークが独立タイマーで
    // 8-15Hz感の周期(1/(8+rand*7)秒)ごとに visible/opacity をトグルし、5本が同期点滅する
    // 「静止した線」に見えないようにする)。
    if (this._lightningMode && !this._darkMode && this._lightningArcMeshes.length > 0) {
      for (let i = 0; i < this._lightningArcMeshes.length; i += 1) {
        const arc = this._lightningArcMeshes[i];
        if (!arc) continue;
        let t = this._lightningArcFlickerT[i] ?? 0;
        t -= dt;
        if (t <= 0) {
          t = 1 / (8 + Math.random() * 7); // 周期: 8-15Hz相当
          arc.visible = Math.random() < 0.82; // まれに完全消灯(電光の途切れ感)
          if (arc.material instanceof THREE.MeshBasicMaterial) {
            arc.material.opacity = 0.35 + Math.random() * 0.65;
          }
        }
        this._lightningArcFlickerT[i] = t;
      }
    }
  }

  // ── R33 特殊武器 公開セッター ────────────────────────────────────────────────
  setBowCharge(charge01: number): void {
    this._bowCharge01 = Math.max(0, Math.min(1, charge01));
    if (!this.gun) return;
    const pull = this._bowCharge01;
    // 弓弦・弓身・矢をcharge01に応じて変形(viewmodel内完結)
    // vm:strT/vm:strB: 弦を後方(カメラ方向)へ引く
    // vm:limbT/vm:limbB: 弓アームをチャージ方向へ撓ませる(rotation.x増幅)
    // vm:arrowShaft/vm:arrowTip: 矢を弦とともに引き戻す
    this.gun.traverse((child) => {
      if (child.name === 'vm:strT') {
        child.position.z = -0.18 - pull * 0.08;
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat?.emissive) mat.emissiveIntensity = pull * 0.75;
        }
      } else if (child.name === 'vm:strB') {
        child.position.z = -0.18 - pull * 0.08;
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat?.emissive) mat.emissiveIntensity = pull * 0.75;
        }
      } else if (child.name === 'vm:limbT') {
        // 上アームを前方(カメラ寄り)へ撓ませる: rotation.x 0.22→0.34
        child.rotation.x = 0.22 + pull * 0.12;
      } else if (child.name === 'vm:limbB') {
        // 下アームを前方(カメラ寄り)へ撓ませる: rotation.x -0.22→-0.34
        child.rotation.x = -0.22 - pull * 0.12;
      } else if (child.name === 'vm:arrowShaft') {
        child.position.z = -0.25 - pull * 0.08;
      } else if (child.name === 'vm:arrowTip') {
        child.position.z = -0.47 - pull * 0.08;
      }
    });
  }

  setStaffCharge(charge01: number): void {
    this._staffCharge01 = Math.max(0, Math.min(1, charge01));
    // 水晶先端 emissive をチャージに比例させる (vm:crystal ノードがあれば)
    if (this.gun) {
      this.gun.traverse((child) => {
        if (child.name === 'vm:crystal' && (child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.emissive) mat.emissiveIntensity = 0.1 + this._staffCharge01 * 0.75;
        }
      });
    }
  }

  setMinigunSpin(spin01: number): void {
    this._minigunSpin01 = Math.max(0, Math.min(1, spin01));
  }

  /**
   * R53-W2: Pack-a-Punch改造演出。match が改造購入時に呼ぶ契約。
   * 約2.5秒: 武器が沈む→(非reduceMotion時のみ)アクセント材の火花的発光パルス→戻る。
   * reduceMotion=true時は0.5秒へ短縮しパルスは省略(沈み込み+復帰のみ)。
   * fire/reload可動ノード契約(rig.*ノードのrest=identity)には一切触れず、root一時
   * オフセット(update内のpapDip)とアクセント材emissiveIntensityの操作のみで完結する。
   * 呼び出し時点でタイマーが残っていても即座に上書き(再購入で演出をやり直す)。
   */
  playPapUpgradeAnim(reduceMotion = false): void {
    this._papAnimDuration = reduceMotion ? 0.5 : 2.5;
    this._papAnimTimer = this._papAnimDuration;
    this._papAnimReduced = reduceMotion;
  }

  /**
   * 特殊武器7種の溜め視覚を統一APIで制御する。
   * 'gekkou-bow'      → setBowCharge (vm:strT/B, vm:limbT/B, vm:arrowShaft/Tip)
   * 'tenrai-staff'    → setStaffCharge (vm:crystal emissiveIntensity)
   * 'shura-lmg'       → setMinigunSpin
   * 'fujin-fan'       → vm:fanRib の fan spread を広げる + emissive
   * 'banjin-smg'      → vm:shurikenBlade の emissive + Z 浮上
   * 'gouen-musket'    → 非黒 emissive 材を全輝度引き上げ (tracerColor 0xff4400)
   * 'shinkirou-sniper'→ 非黒 emissive 材を全輝度引き上げ (tracerColor 0x00eecc)
   */
  setExoticCharge(weaponId: string, charge01: number): void {
    const c = Math.max(0, Math.min(1, charge01));
    switch (weaponId) {
      case 'gekkou-bow':
        this.setBowCharge(c);
        return;
      case 'tenrai-staff':
        this.setStaffCharge(c);
        return;
      case 'shura-lmg':
        this.setMinigunSpin(c);
        return;
      default:
        break;
    }
    if (!this.gun) return;
    // fan: vm:fanRib の spread + emissive
    if (weaponId === 'fujin-fan') {
      this.gun.traverse((child) => {
        if (child.name !== 'vm:fanRib' || !(child instanceof THREE.Mesh)) return;
        const base = child.userData.fanBaseAngle as number | undefined;
        if (base !== undefined) child.rotation.z = base * (1 + c * 0.35);
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissiveIntensity = 0.5 + c * 0.35;
      });
      return;
    }
    // banjin: vm:shurikenBlade の emissive を更新。Z は update() で ads01+charge 統合制御(Fix-5)
    if (weaponId === 'banjin-smg') {
      this._banjinCharge01 = c; // update() の ADS-z lerp で使用
      this.gun.traverse((child) => {
        if (child.name !== 'vm:shurikenBlade' || !(child instanceof THREE.Mesh)) return;
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissiveIntensity = 0.5 + c * 0.42;
      });
      return;
    }
    // gouen-musket / shinkirou-sniper: accent材(非黒 emissive)を輝度引き上げ
    this.gun.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material as THREE.MeshStandardMaterial;
      if (!(mat instanceof THREE.MeshStandardMaterial)) return;
      if (mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0) return;
      if (child.userData.exoticEmissiveBase === undefined) {
        child.userData.exoticEmissiveBase = mat.emissiveIntensity;
      }
      const base = child.userData.exoticEmissiveBase as number;
      mat.emissiveIntensity = base + c * 0.4;
    });
  }

  // ── 黒帝モード API ─────────────────────────────────────────────────────────
  // 公開メソッド: match.ts 側から呼ぶ(Schwarzwald 発動時 active=true)。
  // active 時: 暗黒の煙オーラ + 刃紋を深紫 emissive へ切替 + 暗紫リムオーバーレイ。
  // 非 active 時: 即時通常へ復帰。武器切替を跨いでも _darkMode 状態を保持し、
  // fists 再装備で自動再適用する(setWeapon が担当)。dispose 完全。
  setKunaiDarkMode(active: boolean): void {
    if (this._darkMode === active) return;
    this._darkMode = active;
    // 黒雷帝: dark + lightning 同時発動時はコンバインドビジュアルへ
    if (active && this._lightningMode) {
      this._removeLightningOverlay();
      if (this.gun) {
        const kunai = this.gun.getObjectByName(FIST_KUNAI);
        if (kunai && !kunai.getObjectByName('vm:lightningBlade')) {
          this._buildLightningBladeMeshes(kunai, true);
        }
      }
    }
    if (active) {
      this._applyDarkModeVisuals();
    } else {
      this._removeDarkRimOverlay();
      this._restoreKunaiGlow();
    }
  }

  // 雷帝モード API: match.ts 側から呼ぶ(raiteiMode 発動時 active=true)。
  // kokuraitei=true のとき黒刀 + 紫/青縁の黒雷帝ビジュアル。
  setKunaiLightningMode(active: boolean, kokuraitei = false): void {
    if (this._lightningMode === active && this._kokuraiteiMode === kokuraitei) return;
    this._lightningMode = active;
    this._kokuraiteiMode = kokuraitei;
    if (active) {
      this._applyLightningModeVisuals();
    } else {
      this._removeLightningOverlay();
      this._restoreKunaiGlowLightning();
    }
  }

  private _applyLightningModeVisuals(): void {
    if (!this.gun) return;
    const kunai = this.gun.getObjectByName(FIST_KUNAI);
    if (!kunai) return;
    const isKokuraitei = this._kokuraiteiMode;
    if (!isKokuraitei && !this._darkMode) {
      kunai.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !node.userData.kunaiGlow) return;
        if (node.userData.lightningOrigMat) return;
        const origMat = node.material as THREE.MeshStandardMaterial;
        const lm = origMat.clone();
        lm.emissive.setHex(0x55bbff);
        lm.emissiveIntensity = 0.8;
        lm.color.setHex(0x002244);
        lm.userData.shared = false;
        node.userData.lightningOrigMat = origMat;
        node.userData.lightningMat = lm;
        node.material = lm;
      });
    }
    if (!kunai.getObjectByName('vm:lightningBlade')) {
      this._buildLightningBladeMeshes(kunai, isKokuraitei);
    }
    // TubeGeometry アーク: 毎回再構築(武器切替を跨いで正しく再配置するため)
    this._buildLightningArcMeshes(kunai);
    // darkMode 中はアーク非表示(黒帝ビジュアル優先)
    const arcOn = !this._darkMode;
    this._lightningArcMeshes.forEach(m => { m.visible = arcOn; });
    if (isKokuraitei) {
      for (const tr of this._trailPool) {
        (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x6600bb);
      }
    } else {
      for (const tr of this._trailPool) {
        (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x55bbff);
      }
    }
  }

  // ── RE-1 雷帝スパーク雨: スポーン ─────────────────────────────────────────
  // 頭(カメラ)周囲1.5m球内のランダム位置へスポーン。velY -1.5〜-3.5 m/s で落下。
  // root-local における頭座標 ≈ -HIP_POSITION = (-0.24, 0.22, 0.5)
  private _spawnLightningSparkParticle(): void {
    const slot = this._lightningSparkPool.find((s) => s.life <= 0);
    if (!slot) return;
    // 頭位置 (root-local) = カメラの root-local 座標 ≈ -HIP_POSITION
    // HIP_POSITION = (0.24, -0.22, -0.5). root.position = HIP_POSITION in camera-local.
    // camera in root-local = -HIP_POSITION = (-0.24, 0.22, 0.5)
    const headX = -HIP_POSITION.x;  // -0.24
    const headY = -HIP_POSITION.y;  //  0.22
    const headZ = -HIP_POSITION.z;  //  0.5
    // 1.5m 球内ランダム: 簡易 box-sample (ほぼ球として十分)
    slot.mesh.position.set(
      headX + (Math.random() - 0.5) * 3.0,
      headY + (Math.random() - 0.5) * 3.0,
      headZ + (Math.random() - 0.5) * 3.0,
    );
    slot.velY = -(1.5 + Math.random() * 2.0); // -1.5〜-3.5 m/s 落下
    slot.life = 0.4 + Math.random() * 0.3;    // 0.4-0.7s
    slot.maxLife = slot.life;
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  // ── RE-1 雷帝スパーク雨: 毎フレーム更新 ─────────────────────────────────
  // _kokuraiteiMode=false かつ _lightningMode=true の時のみスポーン継続。
  // モード解除後は新規スポーン停止 → 生存粒子は三角エンベロープで自然消滅。
  private _updateLightningSparkRain(dt: number): void {
    // 生存パーティクルの移動・フェード(モード問わず自然消滅)
    for (const s of this._lightningSparkPool) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.position.y += s.velY * dt; // 直積分 m/s
        // 三角エンベロープ opacity(0→0.52→0)
        const ratio = s.life / s.maxLife;
        (s.mesh.material as THREE.MeshBasicMaterial).opacity =
          0.52 * Math.sin(Math.PI * (1 - ratio));
        if (s.life <= 0) {
          (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
          s.mesh.visible = false;
        }
      }
    }
    // スポーン: kokuraitei=false かつ lightningMode=true の時のみ
    if (!this._kokuraiteiMode && this._lightningMode) {
      this._lightningSparkSpawnTimer -= dt;
      if (this._lightningSparkSpawnTimer <= 0) {
        // 0.08s毎に1-2粒スポーン
        const count = Math.random() < 0.5 ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
          this._spawnLightningSparkParticle();
        }
        this._lightningSparkSpawnTimer = LIGHTNING_SPARK_SPAWN_INTERVAL;
      }
    }
  }

  // ── R53 帝王溜め段 API(M3配線: 溜め時間 0.5/1.2/2.2s の閾値跨ぎで 1|2|3、
  // リリース/中断/死亡で 0。音は sounds.emperorChargeStage(stage) を同じ跨ぎで1回)──
  setEmperorChargeStage(stage: 0 | 1 | 2 | 3): void {
    if (stage === this._emperorChargeStage) return;
    this._emperorChargeStage = stage;
    if (stage > 0 && this._chargeGlowMats.length === 0 && this.gun) {
      // 段3域の発光ブースト対象を1回だけ収集: 黒刀エッジ/コア+雷刀ビルボードライン。
      // R52のTubeアークは専用フリッカーが opacity を書くため対象外(二重書き込み禁止)。
      for (const name of ['vm:darkBlade', 'vm:lightningBlade']) {
        const g = this.gun.getObjectByName(name);
        if (!g) continue;
        g.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const mat = node.material as THREE.Material;
          if (!(mat instanceof THREE.MeshBasicMaterial) || !mat.transparent) return;
          if (node.parent?.name === 'vm:katanaVeins') return; // 雷脈は常時一定輝度
          if (this._lightningArcMeshes.includes(node as THREE.Mesh)) return;
          this._chargeGlowMats.push({ mat, base: mat.opacity });
        });
      }
    }
    if (stage === 0 && this._chargeGlowMats.length) {
      for (const { mat, base } of this._chargeGlowMats) mat.opacity = base;
      this._chargeGlowMats = [];
    }
  }

  // ── R53 恒久報酬: 刀身の白芯雷脈(kokurai-100 キル達成で progression/M3 が呼ぶ)──
  // 黒刀(vm:darkBlade)/雷刀(vm:lightningBlade)の構築時に反映され、後から on にした場合も
  // 既存ブレードへ即時追加する。off で除去(共有マテリアルは dispose しない)。
  setKatanaVeins(on: boolean): void {
    if (this._katanaVeinsOn === on) return;
    this._katanaVeinsOn = on;
    if (!this.gun) return;
    for (const name of ['vm:darkBlade', 'vm:lightningBlade']) {
      const g = this.gun.getObjectByName(name);
      if (!g) continue;
      const existing = g.getObjectByName('vm:katanaVeins');
      if (on && !existing) {
        this._addKatanaVeins(g as THREE.Group, name === 'vm:darkBlade');
      } else if (!on && existing) {
        existing.traverse((node) => {
          if (node instanceof THREE.Mesh) node.geometry.dispose();
        });
        g.remove(existing);
      }
    }
  }

  // 白芯雷脈本体: 刀身に沿う極細の白青ライン2本(僅かな傾き差で「脈」の揺らぎを示す)。
  // 共有マテリアル(userData.shared=true)なので個体/オーバーレイのdispose経路で保護される。
  private _addKatanaVeins(bladeGroup: THREE.Group, isDark: boolean): void {
    const veins = new THREE.Group();
    veins.name = 'vm:katanaVeins';
    // 黒刀は全長1.4m(z -0.19..-1.59)、雷刀(クナイ)は z -0.175..-0.504
    const len = isDark ? 0.86 : 0.30;
    const cz = isDark ? -0.62 : -0.34;
    const y = isDark ? 0.012 : 0.008;
    for (let i = 0; i < 2; i += 1) {
      const vein = new THREE.Mesh(
        new THREE.BoxGeometry(0.0035, 0.0015, len * (1 - i * 0.18)),
        getKatanaVeinMat(),
      );
      vein.position.set((i === 0 ? 0.006 : -0.005), y + i * 0.006, cz + i * 0.03);
      vein.rotation.x = (i === 0 ? 1 : -1) * 0.015; // 微傾差=雷脈の揺らぎ
      vein.renderOrder = 9;
      veins.add(vein);
    }
    bladeGroup.add(veins);
  }

  private _buildLightningBladeMeshes(kunai: THREE.Object3D, isKokuraitei: boolean): void {
    const group = new THREE.Group();
    group.name = 'vm:lightningBlade';
    const makeArcLine = (color: number, opacity: number, posY: number, _h: number): THREE.Mesh => {
      // PlaneGeometry + onBeforeRender ビルボードで棒状ノイズを根治する
      const geo = new THREE.PlaneGeometry(0.90, 0.005);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mat.userData.shared = false;
      mat.userData.isArcLine = true;
      const arcMesh = new THREE.Mesh(geo, mat);
      arcMesh.position.set(0, posY, -0.63);
      arcMesh.renderOrder = 8;
      arcMesh.onBeforeRender = (_r2, _s2, cam): void => {
        cam.getWorldQuaternion(_bbCamQ);
        if (arcMesh.parent) {
          arcMesh.parent.getWorldQuaternion(_bbParentQ);
          _bbParentQ.invert();
          arcMesh.quaternion.copy(_bbCamQ).premultiply(_bbParentQ);
        } else {
          arcMesh.quaternion.copy(_bbCamQ);
        }
      };
      return arcMesh;
    };
    if (isKokuraitei) {
      group.add(makeArcLine(0x7700cc, 0.55, -0.028, 0.003));
      group.add(makeArcLine(0x5500aa, 0.40, -0.027, 0.004));
      group.add(makeArcLine(0x88aaff, 0.35, 0.034, 0.003));
    } else {
      group.add(makeArcLine(0x88ddff, 0.60, -0.028, 0.003));
      group.add(makeArcLine(0xaaeeff, 0.45, -0.027, 0.002));
      group.add(makeArcLine(0x66ccff, 0.35, 0.034, 0.003));
    }
    // R53 恒久報酬: 雷脈が解放済みなら雷刀にも白芯ラインを乗せる
    if (this._katanaVeinsOn) this._addKatanaVeins(group, false);
    kunai.add(group);
    this._lightningOverlayMeshes.push(group);
  }

  // 刃(APEX WRAITHクナイ)に沿って5本の TubeGeometry 電気アーク(稲妻ジグザグ)を追加する。
  // _applyLightningModeVisuals から呼ばれる(雷帝発動時・武器再装備時)。
  // 既存アークを解放してから再構築し、kunai の子として追加。
  //
  // R51根治(ユーザー報告「剣から出るださい謎の二本線」):
  //  1) z範囲を刃の実寸(ローカルZ: 鍔前端≈-0.175〜切先≈-0.504。1042-1066行の
  //     APEX WRAITHクナイ実ジオメトリ実測値)に収めるよう BLADE_Z_NEAR/FAR でクランプ。
  //     旧実装は zEnd が最大 -0.83 まで伸び、刃の実寸(切先-0.504)を大きく超えて
  //     空中に突き出していた。
  //  2) 5本を刃の断面上の異なるレーン(上縁/下縁/峰/側面)へ分散し、かつ各アークが
  //     覆う区間(spanRatio)もランダム化 — 旧実装は5本が3種類のzStartしか持たず
  //     xOffも{-1,0,+1}の3値のみだったため、2本が同一zStart・同一xOffで重なり
  //     「まっすぐな細線2本」に見えていた。
  //  3) セグメント数8→12-14、直線(LineCurve3)を連結した CurvePath で TubeGeometry を
  //     生成し、CatmullRomの滑らかな補間ではなく折れの効いた稲妻ジグザグにする。
  //     振幅はアーク長の8-15%に比例させ、端(付け根/切先)ではテーパーで振れを抑え
  //     「刃に付いている」感を保つ。
  private _buildLightningArcMeshes(kunai: THREE.Object3D): void {
    // 既存アーク解放
    this._lightningArcMeshes.forEach(m => {
      kunai.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this._lightningArcMeshes = [];
    this._lightningArcFlickerT = [];

    const arcColor = this._kokuraiteiMode ? 0x8800ff : 0x88ddff;
    const arcCount = 5;
    // 刃の実測ローカルZ範囲。多少の余白(≤0.02)は許容しつつ、これを超えて突き出さないよう
    // 全アークをこの範囲内(startOffset/spanRatioの構成上、常に範囲内に収まる)にクランプする。
    const BLADE_Z_NEAR = -0.17; // 鍔前端(-0.175)のわずかに内側
    const BLADE_Z_FAR = -0.51;  // 切先(-0.504)からわずかに外側(≤0.02の許容内)
    const bladeLen = BLADE_Z_NEAR - BLADE_Z_FAR; // 0.34
    // 5本を刃の断面上の異なるレーン(上縁/下縁/峰/側面)へ分散配置し、
    // 「2本の平行な棒」に見えないようにする(刃に巻き付く/走るような分布)。
    const LANES: ReadonlyArray<{ x: number; y: number }> = [
      { x: -0.013, y: -0.006 }, // 左側面
      { x: 0.013, y: 0.018 },   // 右・上縁寄り
      { x: -0.009, y: 0.030 },  // 左・峰寄り(セグメント1上縁)
      { x: 0.010, y: -0.035 },  // 右・セグメント2下縁寄り
      { x: 0.000, y: 0.006 },   // 中央・峰
    ];
    for (let i = 0; i < arcCount; i += 1) {
      const lane = LANES[i % LANES.length];
      if (!lane) continue;
      // 各アークが覆う長さの割合をランダム化(刃全長の50-95%)し、
      // 5本が刃の異なる区間を走るようにする(起点/終点ともに常に刃の実寸内)。
      const spanRatio = 0.5 + Math.random() * 0.45;
      const maxOffset = bladeLen * (1 - spanRatio);
      const startOffset = Math.random() * maxOffset;
      const zStart = BLADE_Z_NEAR - startOffset;
      const zEnd = zStart - bladeLen * spanRatio;
      const segLen = zStart - zEnd;
      const amp = segLen * (0.08 + Math.random() * 0.07); // 振幅=アーク長の8-15%

      const segs = 12 + Math.floor(Math.random() * 3); // 12-14分割の折れ線(稲妻ジグザグ)
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= segs; s += 1) {
        const t = s / segs;
        // 端(刃の付け根/切先)ではブレを抑え、「刃に付いている」感を保つ
        const edgeTaper = 0.3 + 0.7 * Math.sin(Math.PI * t);
        const zig = (s % 2 === 0 ? 1 : -1) * amp * (0.5 + Math.random() * 0.5) * edgeTaper;
        pts.push(new THREE.Vector3(
          lane.x + zig * 0.7 + (Math.random() - 0.5) * amp * 0.25,
          lane.y + zig + (Math.random() - 0.5) * amp * 0.3,
          THREE.MathUtils.lerp(zStart, zEnd, t),
        ));
      }
      // 直線セグメント(LineCurve3)を連結した CurvePath で TubeGeometry を生成する。
      // CatmullRomの滑らかな補間ではなく、折れの効いた稲妻らしい鋭角パスにするため。
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let s = 0; s < segs; s += 1) {
        const a = pts[s];
        const b = pts[s + 1];
        if (a && b) path.add(new THREE.LineCurve3(a, b));
      }
      const geo = new THREE.TubeGeometry(path, segs, 0.0006, 3, false);
      const mat = new THREE.MeshBasicMaterial({
        color: arcColor,
        transparent: true,
        opacity: 0.35 + Math.random() * 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mat.userData.shared = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      kunai.add(mesh);
      this._lightningArcMeshes.push(mesh);
      this._lightningArcFlickerT.push(0);
    }
  }

  private _removeLightningOverlay(): void {
    for (const obj of this._lightningOverlayMeshes) {
      obj.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const mat = node.material as THREE.Material;
        if (mat.userData.shared !== true) mat.dispose();
      });
      obj.parent?.remove(obj);
    }
    this._lightningOverlayMeshes = [];
    // TubeGeometry アーク解放
    this._lightningArcMeshes.forEach(m => {
      m.parent?.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this._lightningArcMeshes = [];
    this._lightningArcFlickerT = []; // R51: 個別フリッカータイマーも解放(配列インデックス対応の解消)
  }

  // 雷モード刃紋 material を通常へ戻す + トレイルカラー復帰。
  // R24イディオム(_restoreKunaiGlow と同型): セカンダリを構えたまま雷帝表示を解除すると
  // キャッシュ内のクナイが雷マテリアルのまま残るため、現在の gun だけでなく
  // 武器キャッシュ全体を走査して復元する(冪等)。
  private _restoreKunaiGlowLightning(): void {
    const targets: THREE.Object3D[] = [];
    if (this.gun) {
      const held = this.gun.getObjectByName(FIST_KUNAI);
      if (held) targets.push(held);
    }
    for (const entry of this.cache.values()) {
      const cached = entry.gun.getObjectByName(FIST_KUNAI);
      if (cached && !targets.includes(cached)) targets.push(cached);
    }
    for (const kunai of targets) {
      kunai.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !node.userData.kunaiGlow) return;
        if (!node.userData.lightningOrigMat) return;
        const lm = node.userData.lightningMat as THREE.Material | undefined;
        if (lm) lm.dispose();
        node.material = node.userData.lightningOrigMat as THREE.Material;
        node.userData.lightningOrigMat = undefined;
        node.userData.lightningMat = undefined;
      });
    }
    for (const tr of this._trailPool) {
      if (!this._darkMode) {
        (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x8ab4ff);
      }
    }
  }

  // 刃紋を深紫 emissive へ切替 + 元刃非表示 + 超長黒刀メッシュ追加 + トレイルカラー変更
  private _applyDarkModeVisuals(): void {
    if (!this.gun) return;
    const kunai = this.gun.getObjectByName(FIST_KUNAI);
    if (!kunai) return;
    // 刃紋(userData.kunaiGlow=true)の material をクローンして深紫 emissive に(復元用に origMat を保存)
    kunai.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.userData.kunaiGlow) return;
      if (node.userData.origMat) return; // 既に切替済み(重複適用防止)
      const origMat = node.material as THREE.MeshStandardMaterial;
      const dm = origMat.clone();
      dm.emissive.setHex(0x6a00b0);
      dm.emissiveIntensity = 0.9;
      dm.color.setHex(0x2a0040);
      dm.userData.shared = false; // clone は個別 dispose が必要
      node.userData.origMat = origMat;
      node.userData.darkMat = dm;
      node.material = dm;
    });
    // 刀身コアメッシュ(kunaiBladeCore=true / kunaiGlow=true)を非表示にして黒刀に差し替える
    kunai.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (!node.userData.kunaiBladeCore && !node.userData.kunaiGlow) return;
      if (node.userData.darkHidden) return; // 既に非表示(重複防止)
      node.visible = false;
      node.userData.darkHidden = true;
    });
    // 超長黒刀メッシュを追加(既に追加済みの場合はスキップ)
    if (!kunai.getObjectByName('vm:darkBlade')) {
      this._buildDarkBladeMeshes(kunai);
    }
    // トレイルカラーを黒紫へ
    for (const tr of this._trailPool) {
      (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x6a00b0);
    }
  }

  // 大型黒刀メッシュ群を 'vm:darkBlade' Group として kunai に追加する。
  // 刀身(0x0a0812/低metalness高rough/NormalBlending)+深紫エミシブエッジ+暗紫リムオーバーレイ。
  // 刃先は約1.4m(大太刀)・幅1.2倍。Group ごと _darkOverlayMeshes へ積んで一括 dispose。
  private _buildDarkBladeMeshes(kunai: THREE.Object3D): void {
    const group = new THREE.Group();
    group.name = 'vm:darkBlade';

    // 漆黒刀身(主板): 0x0a0812, 低metalness, 高roughness, NormalBlending(MeshStandardMaterial既定)
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x0a0812,
      metalness: 0.05,
      roughness: 0.9,
      envMapIntensity: 0.08,
    });
    darkSteelMat.userData.shared = false;

    // 峰(芯板): より暗色で微細な厚み差
    const darkSpineMat = new THREE.MeshStandardMaterial({
      color: 0x060408,
      metalness: 0.03,
      roughness: 0.95,
      envMapIntensity: 0.05,
    });
    darkSpineMat.userData.shared = false;

    // 刀身板: 幅 0.026×高 0.058×長 0.90m(大型化: 1.4m大太刀, 幅1.2倍)
    // ガード直後(-0.19)から始まり -1.09 まで。center = -0.19 - 0.45 = -0.64
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.058, 0.90), darkSteelMat);
    body.position.set(0, 0.006, -0.64); // center = -0.19 - 0.45
    group.add(body);

    // 峰板: やや細い。center = -0.19 - 0.41 = -0.60
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.065, 0.82), darkSpineMat);
    spine.position.set(0, 0.006, -0.60); // center = -0.19 - 0.41
    group.add(spine);

    // 切先(漆黒四角錐): 刃先z≈-1.59 → 全長1.4m大太刀
    // center = -1.09 - 0.25 = -1.34。tip apex = -1.59
    const tipMat = darkSteelMat.clone();
    tipMat.userData.shared = false;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.50, 4), tipMat);
    tip.position.set(0, 0.006, -1.34); // center = -1.09 - 0.25
    tip.rotation.set(Math.PI / 2, Math.PI / 4, 0);
    group.add(tip);

    // 深紫エミシブエッジ(下縁): 幅を狭め・輝度を上げて1本のネオンラインとして読める
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x6a00b0,
      transparent: true,
      opacity: 0.90,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    edgeMat.userData.shared = false;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.004, 0.90), edgeMat);
    edge.position.set(0, -0.026, -0.63);
    edge.renderOrder = 6;
    group.add(edge);

    // コアライン(最輝点): さらに細く明るい紫白で「1本のネオン線」を強調
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xb430ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    coreMat.userData.shared = false;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 0.90), coreMat);
    core.position.set(0, -0.027, -0.63);
    core.renderOrder = 7;
    group.add(core);

    // 上縁エッジ(Apex 両縁発光): 上端にも薄い発光を追加してシンメトリック
    const topEdgeMat = new THREE.MeshBasicMaterial({
      color: 0x5500cc,
      transparent: true,
      opacity: 0.50,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    topEdgeMat.userData.shared = false;
    const topEdge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.88), topEdgeMat);
    topEdge.position.set(0, 0.033, -0.63);
    topEdge.renderOrder = 6;
    group.add(topEdge);

    // 暗紫リムオーバーレイ(上縁・下縁): opacity 引き上げでシャープに
    const rimY = [0.035, -0.019] as const;
    for (const py of rimY) {
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0x5500aa,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      rimMat.userData.shared = false;
      const rimMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.90), rimMat);
      rimMesh.position.set(0, py, -0.64);
      rimMesh.rotation.set(Math.PI / 2, 0, 0);
      rimMesh.renderOrder = 6;
      group.add(rimMesh);
    }

    // R53 恒久報酬: 雷脈が解放済みなら黒刀にも白芯ラインを乗せる
    if (this._katanaVeinsOn) this._addKatanaVeins(group, true);
    kunai.add(group);
    this._darkOverlayMeshes.push(group);
  }

  // 刃紋 material を通常色へ戻す + 刀身コアメッシュを再表示 + トレイルカラー復帰。
  // V24修正: 黒帝終了時にセカンダリを構えているとキャッシュ内のクナイが紫のまま残るため、
  // 現在の gun だけでなく武器キャッシュ全体を走査して復元する(冪等)。
  private _restoreKunaiGlow(): void {
    const targets: THREE.Object3D[] = [];
    if (this.gun) {
      const held = this.gun.getObjectByName(FIST_KUNAI);
      if (held) targets.push(held);
    }
    for (const entry of this.cache.values()) {
      const cached = entry.gun.getObjectByName(FIST_KUNAI);
      if (cached && !targets.includes(cached)) targets.push(cached);
    }
    for (const kunai of targets) {
      // 刃紋マテリアル復元
      kunai.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !node.userData.kunaiGlow) return;
        if (!node.userData.origMat) return;
        const dm = node.userData.darkMat as THREE.Material | undefined;
        if (dm) dm.dispose();
        node.material = node.userData.origMat as THREE.Material;
        node.userData.origMat = undefined;
        node.userData.darkMat = undefined;
      });
      // 刀身コアメッシュの可視性を復元(kunaiBladeCore または kunaiGlow で非表示にしたもの)
      kunai.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        if (!node.userData.darkHidden) return;
        node.visible = true;
        node.userData.darkHidden = undefined;
      });
    }
    // トレイルカラー: 雷帝モードが残っていれば雷帝色へ、そうでなければ通常色へ
    const trailColor = this._kokuraiteiMode ? 0x6600bb : this._lightningMode ? 0x55bbff : 0x8ab4ff;
    for (const tr of this._trailPool) {
      (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(trailColor);
    }
    // 黒帝解除後も雷帝が継続する場合: 雷帝ビジュアルを再適用
    if (this._lightningMode && this.gun) {
      const kunai = this.gun.getObjectByName(FIST_KUNAI);
      if (kunai && !kunai.getObjectByName('vm:lightningBlade')) {
        this._applyLightningModeVisuals();
      }
    }
  }

  // 黒刀グループ(_darkOverlayMeshes)を全削除して GPU 資源を解放。
  // _darkOverlayMeshes は THREE.Object3D(Group 含む)なので traverse して Mesh を dispose する。
  private _removeDarkRimOverlay(): void {
    for (const obj of this._darkOverlayMeshes) {
      obj.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const mat = node.material as THREE.Material;
        if (mat.userData.shared !== true) mat.dispose();
      });
      obj.parent?.remove(obj);
    }
    this._darkOverlayMeshes = [];
  }
}
