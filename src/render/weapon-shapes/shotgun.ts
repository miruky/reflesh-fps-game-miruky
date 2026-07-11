import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import { hasMuzzleAttachment, type ShapePainter } from './toolkit';

// ── 散弾系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase C(R58): 4挺を実在シルエットへ再モデリング。
//   sg-870(hiiragi)    ← Remington 870  : バレル下チューブマグ二段 + 側面排莢口 + 縦溝ポンプ(vm:forend)
//   sg-ithaca(aoshigi) ← Ithaca 37       : 側面のっぺり(底面ポートのみ) + 木製家具 + ベンテッドリブ銃身
//   shotgun-auto(fukurou) ← AA-12        : ドラム給弾 + スラブ角箱ボディ + 低平ロングハンドル + 太丸放熱シュラウド
//   shotgun-double(raijin)← USAS-12      : AR/M16A2化(細身長銃身+丸リブハンドガード+三角キャリングハンドル+誇張バードケージ)
// sg-870/sg-ithaca のシルエットは shotgun-pump の逐語コピーのまま据え置き、実在化は painter が担う
// (サイト契約=bead 0.060 と feed:'tube'(=vm:forend可動)を一切変えず、寸法起因のドリフトを構造排除)。
// R58 Phase E2: raijin(USAS)/fukurou(AA-14) が双子化していた相互差別化を根治 —
//   USAS を M16 ライフルへ寄せ(handguard:'none'=painter が丸リブを前方だけに巻く+長銃身露出、
//   barrelLen 0.30→0.44=滑らか長銃身+バードケージ強調、三角高ハンドル)、AA-14 を角箱ボディへ一段
//   ゴツく(handguard:'none'=painter が太丸放熱シュラウド、スラブ増厚ボディ+低平ロングハンドル+大型ドラム)。
//   両者とも barrelGauge(bead 契約)は不変。一目で別物になる。
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
  // AA-12(fukurou / AA-14): 角箱ボディを一段ゴツく。ドラム給弾+固定ストック。
  // handguard:'none'=基礎はハンドガードを描かず、painter が「太丸放熱シュラウド+スラブ増厚ボディ+
  // 低平ロングハンドル+大型ドラム」を足す(=USAS の細身ライフルと質量感を分離)。
  // barrelGauge=0.04(bead 契約)不変。ventSlots=6 は painter の放熱スリット環に流用。
  'shotgun-auto': {
    receiver: { w: 0.08, h: 0.1, d: 0.36 },
    barrelGauge: 0.04,
    barrelLen: 0.26,
    feed: 'drum',
    handguard: 'none',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.08,
    ventSlots: 6,
  },
  // USAS-12(raijin / USAS-14): AR/M16A2 ライフルへ寄せる。単バレル+ドラム+バードケージ。
  // handguard:'none'=基礎はハンドガードを描かず、painter が「丸リブハンドガード(後半)+ガスブロック+
  // 三角高キャリングハンドル+誇張バードケージ+A2ストック」を足す。barrelLen 0.30→0.44=前方に滑らかな
  // 長銃身を露出(=AA-14 の太短シュラウドと分離)。barrelGauge=0.038(resolveSightY 契約)不変。
  'shotgun-double': {
    receiver: { w: 0.085, h: 0.105, d: 0.3 },
    barrelGauge: 0.038,
    barrelLen: 0.44,
    feed: 'drum',
    handguard: 'none',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'stock',
    bodyScale: 1.05,
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
  // aoshigi-sg / ITH-39(Ithaca 37): painter がベンテッドリブ+木製家具+底面ポート(側面のっぺり)を足す。
  // R58 Phase E2: 決定差「側面のっぺり(底面ポートのみ)」を達成 — feed:'tube' の既定は
  // ejectionPort=true で右面インセット排莢ポートを描くため、ejectionPort:false で明示抑止する
  // (paintIthaca の底面ポートが唯一の排莢示唆になる)。サイト/寸法に無影響(feed/gauge/len 不変)。
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
    ejectionPort: false,
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

// AA-14(AA-12): 角箱ボディを一段ゴツく = USAS の細身ライフルと質量感を分離する外装。
//   ① スラブ状の増厚ボディ(レシーバを一回り大きい箱で包む=アルミ角箱の塊感)+ 側面補強リブ、
//   ② 低平ロングトップハンドル(AA-12 の低い運搬ハンドル。USAS の三角高ハンドルと対比)、
//   ③ 太丸放熱シュラウド(短銃身を根元から太く覆う。USAS の細長露出銃身と対比)、
//   ④ 大型ドラム(基礎ドラムへ外周リム+太い本体面を重ねて大容量に見せる)。
// ゴースト照準の耳/ドットは本体が描く(このシュラウド前端の上に前照星として収まる=AR/散弾サイト)。
const paintAA12: ShapePainter = (ctx) => {
  const { metalParts, polishParts, boxP, tubeZ, bakeAt, chamferBox, C, r, recD, gauge, barLen, barCenterZ, BARREL_Y, sil } = ctx;

  // ① スラブ状の増厚ボディ(角箱の塊感)+ 側面補強リブ。
  const slabH = r.h + 0.028;
  const slabTop = 0.006 + slabH / 2;
  bakeAt(metalParts, chamferBox(r.w + 0.022, slabH, recD * 0.86, 0.006), C.BASE, 0, 0.006, -recD * 0.03, 0, 0, 0, 'machined');
  for (const sx of [-1, 1] as const) {
    for (let i = 0; i < 2; i += 1) {
      boxP(metalParts, C.GROOVE, 0.006, r.h * 0.7, 0.01, sx * (r.w / 2 + 0.012), 0.004, -recD * 0.16 + i * recD * 0.28, 0, 0, 0, 'flat');
    }
  }

  // ② 低平ロングトップハンドル(AA-12 の低い運搬ハンドル/レール)。
  const topY = slabTop + 0.028;
  const zc = -recD * 0.04;
  const hLen = recD * 0.6;
  boxP(metalParts, C.DARK, 0.02, 0.014, hLen, 0, topY, zc, 0, 0, 0, 'flat');
  // R58 A3: 前/後支柱を x=±0.012 のサイドポスト対に分割し、ゴースト照準線(y≈0.075)の中央 x±0.0085 を
  // 貫通させる(旧・中央中実支柱 y0.070-0.098 が前照星の射線を跨いでいた)。
  for (const dz of [-hLen * 0.4, hLen * 0.4] as const) {
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.DARK, 0.007, topY - slabTop, 0.014, sx * 0.012, (slabTop + topY) / 2, zc + dz, 0, 0, 0, 'flat');
    }
  }

  // ③ 太丸放熱シュラウド(短銃身を太く覆う)+ 放熱スリット環。
  const shR = gauge + 0.026;
  tubeZ(metalParts, C.DARK, shR, barLen * 0.82, 0, BARREL_Y, barCenterZ, true);
  const vn = Math.max(4, sil.ventSlots ?? 6);
  for (let i = 0; i < vn; i += 1) {
    const zz = barCenterZ - barLen * 0.34 + (i * (barLen * 0.68)) / (vn - 1);
    tubeZ(metalParts, C.GROOVE, shR + 0.003, 0.006, 0, BARREL_Y, zz, true);
  }

  // ④ 大型ドラム(基礎ドラム r0.07 へ外周リム+太い本体面+中心ハブを重ねて大容量に見せる)。
  // R58-F: ドラム本体面は metalParts(=カモ対象)へ。polish だと基礎ドラム(カモ対象)を完全に
  // 覆ってしまい、gold/diamond 装備時に「クリスタル銃体+黒鋼ドラム」で浮く(乗り漏れ)。
  // 中心ハブのみ研磨(POLISH_HI)で DP-29 パンマグ(本体=camo/ハブ=研磨)と方針統一。
  const dz2 = sil.feedZ ?? -0.02;
  tubeZ(metalParts, C.POLISH, 0.086, 0.056, 0, -0.13, dz2, true);
  tubeZ(metalParts, C.RIM, 0.092, 0.012, 0, -0.13, dz2 - 0.03, true);
  tubeZ(polishParts, C.POLISH_HI, 0.02, 0.062, 0, -0.13, dz2, true);
};

// USAS-14(USAS-12): AR/M16A2 ライフルへ寄せる = AA-14 の角箱と一目で描き分ける外装。
//   ① AR拡大レシーバ(フラットトップ)、② 三角「こぶ」型キャリングハンドル(後高→前低。M16A2)、
//   ③ 丸リブハンドガード(バレル後半を巻き、前方は滑らかな長銃身を露出)+ デルタリング、
//   ④ ガスブロック/前照星ウイング、⑤ 誇張バードケージ(A2フラッシュハイダー)、
//   ⑥ マグウェル・シュラウド(ドラムを AR 的マグ位置に締める)、⑦ A2固定ストック(コム+バットプレート)。
// bead 照準はバレル前方に単一で残る(handguard:'none'=耳無し天面クリーン)。木製家具は基礎が描く。
const paintUSAS: ShapePainter = (ctx) => {
  const { metalParts, polishParts, boxP, bakeAt, chamferBox, tubeZ, C, r, recD, recHalf, bs, gauge, barR, barLen, barCenterZ, barFrontZ, BARREL_Y, sil } = ctx;
  const hy = r.h / 2;

  // ① AR拡大レシーバ(フラットトップ・アッパー)。
  bakeAt(metalParts, chamferBox(r.w + 0.008, 0.028, recD * 0.74, 0.004), C.BASE, 0, hy - 0.004, -recD * 0.05, 0, 0, 0, 'machined');

  // ② 三角「こぶ」型キャリングハンドル(後照星側=高い / 前照星側=低い。斜辺の天梁で三角シルエット)。
  const yb = hy + 0.01; // フラットトップ上端
  const rearY = yb + 0.072;
  const frontY = yb + 0.046;
  const chZ = -recD * 0.04;
  const zr = chZ + recD * 0.19;
  const zf = chZ - recD * 0.19;
  boxP(metalParts, C.DARK, 0.015, rearY - yb, 0.016, 0, (yb + rearY) / 2, zr, 0, 0, 0, 'flat'); // 後脚(高)
  boxP(metalParts, C.DARK, 0.015, frontY - yb, 0.016, 0, (yb + frontY) / 2, zf, 0, 0, 0, 'flat'); // 前脚(低)
  const beamLen = Math.hypot(zr - zf, rearY - frontY);
  const beamRx = -Math.atan2(rearY - frontY, zr - zf);
  boxP(metalParts, C.DARK, 0.016, 0.014, beamLen, 0, (rearY + frontY) / 2, (zr + zf) / 2, beamRx, 0, 0, 'flat'); // 斜辺天梁
  boxP(polishParts, C.POLISH, 0.014, 0.012, 0.02, 0, rearY + 0.004, zr, 0, 0, 0, 'flat'); // 後照星アパーチャ塊

  // ③ 丸リブハンドガード(バレル後半)+ リブ環 + デルタリング。前方は長銃身を露出。
  const hgZ = barCenterZ + barLen * 0.16;
  const hgLen = barLen * 0.44;
  const hgR = barR + 0.02;
  tubeZ(metalParts, C.POLY, hgR, hgLen, 0, BARREL_Y, hgZ, true);
  for (let i = 0; i < 5; i += 1) {
    const zz = hgZ - hgLen * 0.4 + (i * (hgLen * 0.8)) / 4;
    tubeZ(metalParts, C.GROOVE, hgR + 0.003, 0.006, 0, BARREL_Y, zz, true);
  }
  tubeZ(polishParts, C.RIM, hgR + 0.004, 0.01, 0, BARREL_Y, hgZ + hgLen * 0.5, true); // デルタリング

  // ④ ガスブロック(ハンドガード前端)+ 前照星ウイング(細い縦。銃口 bead とは別=構造物)。
  const fsZ = hgZ - hgLen * 0.5 - 0.008;
  boxP(metalParts, C.DARK, gauge + 0.008, gauge + 0.028, 0.028, 0, BARREL_Y + 0.01, fsZ, 0, 0, 0, 'flat');
  boxP(metalParts, C.DARK, 0.007, gauge + 0.046, 0.011, 0, BARREL_Y + 0.026, fsZ, 0, 0, 0, 'flat');

  // ⑤ 誇張バードケージ(A2フラッシュハイダー): 基礎の小コーンへスロット入り籠+研磨クラウンを重ねる。
  // R58 F2: マズルアタッチメント(サプ/コンペ)装着時は skip(サプ管にバードケージが串刺し浮遊するのを防ぐ)。
  if (!hasMuzzleAttachment(ctx)) {
    const bcZ = barFrontZ - 0.028;
    tubeZ(metalParts, C.DARK, gauge * 0.95, 0.05, 0, BARREL_Y, bcZ, true);
    for (let i = 0; i < 4; i += 1) {
      const zz = bcZ - 0.016 + (i * 0.032) / 3;
      boxP(metalParts, C.GROOVE, gauge * 2.0, 0.005, 0.004, 0, BARREL_Y + gauge * 0.9, zz, 0, 0, 0, 'flat'); // 上面スロット
      boxP(metalParts, C.GROOVE, 0.004, gauge * 1.4, 0.004, gauge * 0.9, BARREL_Y, zz, 0, 0, 0, 'flat'); // 側面スロット
    }
    tubeZ(polishParts, C.POLISH_HI, gauge * 0.98, 0.008, 0, BARREL_Y, bcZ - 0.028, false, 'edgeHi'); // 銃口クラウン
  }

  // ⑥ マグウェル・シュラウド(ドラムを AR 的マグ位置=レシーバ下に締める)。
  const dz2 = sil.feedZ ?? -0.02;
  bakeAt(metalParts, chamferBox(0.058, 0.05, 0.08, 0.004), C.DARK, 0, -r.h / 2 - 0.012, dz2);

  // ⑦ A2固定ストック(基礎の木製fixedへ黒コム+バットプレートを足す)。
  const stockZ = recHalf + 0.05 * bs;
  boxP(metalParts, C.DARK, 0.036, 0.022, 0.12, 0, 0.03, stockZ + 0.02, 0, 0, 0, 'gradY'); // コム(かさ上げ)
  boxP(metalParts, C.RIM, 0.044, 0.07, 0.012, 0, -0.008, stockZ + 0.085, 0, 0, 0, 'flat'); // バットプレート
};

// Phase C: 各 ModelKey の「非サイト外装」painter を登録する。
export const SHOTGUN_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  'sg-870': paint870,
  'sg-ithaca': paintIthaca,
  'shotgun-auto': paintAA12,
  'shotgun-double': paintUSAS,
};
