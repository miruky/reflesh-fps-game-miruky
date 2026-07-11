import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── 特殊/据置(素手/ランチャー/exotic world系) シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase B の固有キーは汎用エントリの逐語コピー(=視覚不変)。Phase C が実在シルエットへ改修する。
export const SPECIAL_SHAPES = {
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
} satisfies Partial<Record<ModelKey, Silhouette>>;

// Phase C: 各 ModelKey の「非サイト外装」painter をここへ登録する。
// painter は ctx(bake/boxP/tubeZ/coneZ/bakeAt/chamferBox/palette/寸法/buckets)だけで固有外装を描ける。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter からは触らない)。
export const SPECIAL_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  // ── 業火RL(launcher): R59 FLOAT 接続 painter ──
  // (1) 前部assy(シュラウド/砲身/ブレーキ=18パーツ)が発射筒レシーバ前面から 28mm 浮いていた →
  //     カップリングリング(発射筒の継手)を受け前面〜シュラウド後端に渡して接続。
  // (2) generic スケルトンストックのバー群+スリングループが受け後端から 50mm 浮いていた →
  //     幅広の肩当てフレームを受け後端に渡し、バー群/ループをまとめて接続。
  // どちらも y は受け高(±0.06)の帯内=ゴーストリング狙点(0.088)の射線は塞がない。
  launcher: (ctx) => {
    const { tubeZ, boxP, C, metalParts, recHalf, BARREL_Y } = ctx;
    tubeZ(metalParts, C.DARK, 0.056, 0.09, 0, BARREL_Y, -(recHalf + 0.028), true, 'machined');
    boxP(metalParts, C.DARK, 0.112, 0.1, 0.085, 0, -0.012, recHalf + 0.032, 0, 0, 0, 'gradY');
  },
};
