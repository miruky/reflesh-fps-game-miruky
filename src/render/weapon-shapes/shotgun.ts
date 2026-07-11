import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── 散弾系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const SHOTGUN_SHAPES = {
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
  // ── R58 固有キー(逐語コピー・Phase Cが改修) ──
  // hiiragi-sg / M875(Phase C: バレル下チューブマグ+側面排莢切欠)
  'sg-870': {
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
  // aoshigi-sg / ITH-39(Phase C: 側面のっぺり+底面ポートのみ+木床)
  'sg-ithaca': {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const SHOTGUN_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {};
