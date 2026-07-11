import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── AR系(ライフル/カービン/ブルパップ) シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const AR_SHAPES = {
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
  // ── R58 固有キー(逐語コピー・Phase Cが改修) ──
  // kaede-ar / FAMAS-G4(Phase C: bullpup化+逆U字キャリーハンドル+バイポッド)
  'ar-famas': {
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
  // miyama-br / FAL-53(Phase C: 寝たキャリーハンドル+木製ハンドガード)
  'ar-fal': {
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
  // kasasagi-ar / SCAR-18S(Phase C: FAパドル+二重可動スケルトン)
  'ar-scar-h': {
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
  // tobikuma-ar / HK415(Phase C: 素M4+ガスブロック膨らみ)
  'ar-hk416': {
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
  // ginyanma-ar / MCX-9(Phase C: 後端短+側方折スケルトン+円筒M-LOK)
  'ar-mcx': {
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
  // shinonome-ar / ARX-170(Phase C: 丸ポリマー多面+45度排莢)
  'ar-arx': {
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
  // kagerou-br / SG-512(Phase C: 一体大型ハンドル+AKプレス+三角スケルトン)
  'ar-sg550': {
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
  // mukudori-br / SCAR-14S(Phase C: モノリシック+2トーン、18Sより小型)
  'ar-scar-l': {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const AR_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {};
