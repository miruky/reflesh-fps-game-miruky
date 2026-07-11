import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── 狙撃/DMR/対物系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const SNIPER_SHAPES = {
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
  // ── R58 固有キー(逐語コピー・Phase Cが改修) ──
  // shirasagi-mk / SVD-16(Phase C: 木サムホール+側面スコープ)
  'dmr-svd': {
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
  // hibari-mk / WA2200(Phase C: bullpup+前方バレルシュラウド)
  'dmr-wa2000': {
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
  // raicho-sniper / AWR-338(Phase C: 太シャーシ+大型多ポートブレーキ)
  'sniper-awm': {
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
  // shirayuki-sniper / TRG-44(Phase C: 多軸バットプレート+細身)
  'sniper-trg': {
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
  // shinkirou-sniper / 蜃気楼(exotic: 実在ボルト銃と分離。Phase C: ビーム砲身)
  'sniper-beam': {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const SNIPER_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {};
