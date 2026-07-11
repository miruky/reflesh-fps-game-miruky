import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// ── 散弾系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase C(R58): 4挺を実在シルエットへ再モデリング。
//   sg-870(hiiragi)    ← Remington 870  : バレル下チューブマグ二段 + 側面排莢口 + 縦溝ポンプ(vm:forend)
//   sg-ithaca(aoshigi) ← Ithaca 37       : 側面のっぺり(底面ポートのみ) + 木製家具 + ベンテッドリブ銃身
//   shotgun-auto(fukurou) ← AA-12        : ドラム給弾 + AR角レシーバ + キャリングハンドル + 放熱シュラウド
//   shotgun-double(raijin)← USAS-12      : 二連解除しAR拡大化(ドラム+角レシーバ+ハンドル+バードケージ)
// sg-870/sg-ithaca のシルエットは shotgun-pump の逐語コピーのまま据え置き、実在化は painter が担う
// (サイト契約=bead 0.060 と feed:'tube'(=vm:forend可動)を一切変えず、寸法起因のドリフトを構造排除)。
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
  // AA-12(fukurou): ドラム給弾+放熱シュラウド+固定チューブストック。角レシーバ/ハンドルは painter。
  'shotgun-auto': {
    receiver: { w: 0.08, h: 0.1, d: 0.36 },
    barrelGauge: 0.04,
    barrelLen: 0.26,
    feed: 'drum',
    handguard: 'shroud',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.08,
    ventSlots: 6,
  },
  // USAS-12(raijin): 二連(twinBarrel)を解除しAR拡大化。単バレル+ドラム+シュラウド+バードケージ。
  // barrelGauge=0.038 と bead 照準は据え置き(resolveSightY 契約 shotgun-double を不変に保つ)。
  'shotgun-double': {
    receiver: { w: 0.085, h: 0.105, d: 0.3 },
    barrelGauge: 0.038,
    barrelLen: 0.3,
    feed: 'drum',
    handguard: 'shroud',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'stock',
    bodyScale: 1.05,
    ventSlots: 6,
  },
  // ── R58 固有キー(shotgun-pump の逐語コピー=寸法同一。実在化は SHOTGUN_PAINTERS が担う) ──
  // hiiragi-sg / M875(Remington 870): painter がバレル下チューブ延長+マグキャップ+側面排莢口を足す
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
  // aoshigi-sg / ITH-39(Ithaca 37): painter がベンテッドリブ+木製家具+底面ポート(側面のっぺり)を足す
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

// ── Phase C 固有外装 painter(merge直前に呼ばれる。ctx だけで固有外装を描く) ─────────────
// サイト系ジオメトリ(bead マイクロドット/耳)は buildGunBody 本体が描く=painter は触らない
// (SphereGeometry r≤0.0022 も PlaneGeometry も作らない=二重ドット/齟齬を構造的に回避)。
// 全パーツは metalParts/polyParts/polishParts へ merge=+0DC。木/金属はカモ対象・研磨は据置。

// Remington 870: バレル真下のチューブマガジンを前方へ延長しマグキャップで締め、
// 吊り金具+バレルバンドで「バレル上/チューブ下」の二段レイアウトを明示。側面に大きめの排莢口。
const paint870: ShapePainter = (ctx) => {
  const { metalParts, polishParts, boxP, tubeZ, coneZ, C, barR, barCenterZ, recD, r, BARREL_Y } = ctx;
  const tubeY = -0.025; // 汎用 feed:'tube' が敷くマガジンチューブ中心Y(バレル下)
  // マガジンキャップ(チューブ前端の丸い蓋)
  coneZ(polishParts, C.POLISH, 0.021, 0.012, 0.024, 0, tubeY, -0.397);
  // マグ吊り金具(バレル⇄チューブを前方で繋ぐ=二段の視認性)
  boxP(metalParts, C.DARK, 0.013, 0.05, 0.02, 0, (BARREL_Y + tubeY) / 2, -0.365);
  // バレルバンド(中間の締め金)
  tubeZ(metalParts, C.RIM, barR + 0.005, 0.01, 0, BARREL_Y, barCenterZ - 0.013, true);
  // 側面排莢口(870の決定的特徴): 右面の切り欠き凹み+上リップ+研磨ボルト面
  const px = r.w / 2;
  const pz = -recD * 0.13;
  boxP(metalParts, C.GROOVE, 0.01, 0.042, 0.08, px + 0.001, 0.006, pz, 0, 0, 0, 'flat');
  boxP(metalParts, C.RIM, 0.012, 0.006, 0.086, px + 0.002, 0.03, pz, 0, 0, 0, 'flat');
  boxP(polishParts, C.POLISH_HI, 0.006, 0.03, 0.052, px + 0.005, 0.008, pz, 0, 0, 0, 'flat');
};

// Ithaca 37: ベンテッドリブ銃身(バレル上の連続リブ+隙間) + 伝統的な木製家具(コム/リスト/側板) +
// 底面ポートのみ(側面には排莢口を足さず「のっぺり」を保つ)。870 と決定的に描き分ける。
const paintIthaca: ShapePainter = (ctx) => {
  const { metalParts, polyParts, boxP, bakeAt, chamferBox, C, barR, barLen, barCenterZ, recD, recHalf, r, BARREL_Y, bs } = ctx;
  // ベンテッドリブ: リブ天板 + 6本の支柱(支柱間の隙間が vent)
  boxP(metalParts, C.DARK, 0.009, 0.006, barLen * 0.82, 0, BARREL_Y + barR + 0.007, barCenterZ, 0, 0, 0, 'flat');
  const posts = 6;
  for (let i = 0; i < posts; i += 1) {
    const zz = barCenterZ - barLen * 0.36 + (i * (barLen * 0.72)) / (posts - 1);
    boxP(metalParts, C.DARK, 0.006, 0.008, 0.007, 0, BARREL_Y + barR + 0.001, zz, 0, 0, 0, 'flat');
  }
  // 木製家具: バットストックのコム(頬付け) + リスト(握り後方) + 前方レシーバ側板(のっぺり側面)
  const stockZ = recHalf + 0.05 * bs;
  bakeAt(polyParts, chamferBox(0.05, 0.045, 0.15, 0.006), C.WOOD, 0, 0.012, stockZ + 0.03);
  bakeAt(polyParts, chamferBox(0.05, 0.075, 0.09, 0.006), C.WOOD, 0, -0.028, recHalf + 0.03);
  for (const sx of [-1, 1] as const) {
    bakeAt(polyParts, chamferBox(0.006, 0.06, recD * 0.3, 0.003), C.WOOD_HI, sx * (r.w / 2 + 0.001), -0.006, -recD * 0.34);
  }
  // 底面ポート(Ithaca の底面排莢を示唆する薄い切り欠き)
  boxP(metalParts, C.GROOVE, 0.03, 0.007, 0.05, 0, -r.h / 2 - 0.001, -recD * 0.08, 0, 0, 0, 'flat');
};

// AA-12: 汎用 feed:'drum'/handguard:'shroud' の上へ、AR的な角レシーバ(フラットトップ) +
// キャリングハンドルのブリッジ + ドラムの中心ハブ/前面リムを重ねる。ゴースト照準の耳は本体が描き、
// このハンドルの内側に前照星ポストとして収まる(AR的サイト構成)。
const paintAA12: ShapePainter = (ctx) => {
  const { metalParts, polishParts, boxP, tubeZ, bakeAt, chamferBox, C, r, recD, sil } = ctx;
  // AR角レシーバ(フラットトップ・アッパー)
  bakeAt(metalParts, chamferBox(r.w + 0.008, 0.028, recD * 0.7, 0.004), C.BASE, 0, r.h / 2 - 0.004, -recD * 0.04, 0, 0, 0, 'machined');
  // ARキャリングハンドル: 天板 + 前後ポスト(ブリッジ)
  const hy = r.h / 2;
  const topY = hy + 0.062;
  const zc = -recD * 0.05;
  boxP(metalParts, C.DARK, 0.016, 0.012, recD * 0.44, 0, topY, zc, 0, 0, 0, 'flat');
  const span = recD * 0.19;
  for (const dz of [-span, span] as const) {
    boxP(metalParts, C.DARK, 0.016, topY - hy, 0.016, 0, (topY + hy) / 2, zc + dz, 0, 0, 0, 'flat');
  }
  // ドラム中心ハブ + 前面リム(汎用 drum の円盤に巻上げハブを足す)
  const dz2 = sil.feedZ ?? -0.02;
  tubeZ(polishParts, C.POLISH, 0.022, 0.056, 0, -0.12, dz2, true);
  tubeZ(metalParts, C.RIM, 0.072, 0.012, 0, -0.12, dz2 - 0.028, true);
};

// USAS-12: 二連解除済み単バレル+ドラム+シュラウド+バードケージ(muzzle:'flash')の上へ、
// AR拡大レシーバ + キャリングハンドル + マグウェル・シュラウド + A2ストック・コムを重ねて
// 「大型化したアサルトライフル」の外装にする(bead 照準はバレル前方に残り AR的に見える)。
const paintUSAS: ShapePainter = (ctx) => {
  const { metalParts, boxP, bakeAt, chamferBox, C, r, recD, recHalf, bs, sil } = ctx;
  // AR拡大レシーバ(フラットトップ)
  bakeAt(metalParts, chamferBox(r.w + 0.008, 0.028, recD * 0.74, 0.004), C.BASE, 0, r.h / 2 - 0.004, -recD * 0.05, 0, 0, 0, 'machined');
  // ARキャリングハンドル(bead機=耳無しなので天面はクリーン)
  const hy = r.h / 2;
  const topY = hy + 0.058;
  const zc = -recD * 0.06;
  boxP(metalParts, C.DARK, 0.016, 0.012, recD * 0.46, 0, topY, zc, 0, 0, 0, 'flat');
  const span = recD * 0.2;
  for (const dz of [-span, span] as const) {
    boxP(metalParts, C.DARK, 0.016, topY - hy, 0.016, 0, (topY + hy) / 2, zc + dz, 0, 0, 0, 'flat');
  }
  // マグウェル・シュラウド(ドラムがAR的マグ位置=レシーバ下に付く)
  const dz2 = sil.feedZ ?? -0.02;
  bakeAt(metalParts, chamferBox(0.058, 0.045, 0.075, 0.004), C.DARK, 0, -r.h / 2 - 0.012, dz2);
  // A2ストック・コム(かさ上げ)
  const stockZ = recHalf + 0.05 * bs;
  boxP(metalParts, C.DARK, 0.038, 0.02, 0.11, 0, 0.032, stockZ + 0.02, 0, 0, 0, 'gradY');
};

// Phase C: 各 ModelKey の「非サイト外装」painter を登録する。
export const SHOTGUN_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  'sg-870': paint870,
  'sg-ithaca': paintIthaca,
  'shotgun-auto': paintAA12,
  'shotgun-double': paintUSAS,
};
