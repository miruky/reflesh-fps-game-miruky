import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── 拳銃/リボルバー系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const PISTOL_SHAPES = {
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
  // ── R58 固有キー(逐語コピー・Phase Cが改修) ──
  // suzume / G16(Phase C: 角ポリマー+ハンマー無平坦後端)
  'pistol-glock': {
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
  // kawasemi-pistol / CZ76(Phase C: スライド内側段差+露出ハンマー)
  'pistol-cz75': {
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
  // misago-pistol / 95R(Phase C: 45度折フォアグリップ+着脱ストック)
  'pistol-93r': {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const PISTOL_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {};
