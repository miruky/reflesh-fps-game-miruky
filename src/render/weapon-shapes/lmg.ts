import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── LMG系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const LMG_SHAPES = {
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
  // ── R58 固有キー(逐語コピー・Phase Cが改修) ──
  // kumagera-lmg / M251(Phase C: 上部ベルトカバー+側面弾薬箱+バレルジャケット)
  'lmg-m249': {
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
  // tsuchigumo-lmg / RPK-14(Phase C: 長銃身+AKプレス+95連ドラム)
  'lmg-rpk': {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const LMG_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {};
