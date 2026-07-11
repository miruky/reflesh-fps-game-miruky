import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { PainterCtx, ShapePainter } from './toolkit';

// ── 拳銃/リボルバー系 シルエット ─────────────────────────────────────────
// R58 Phase C: shape共有解消を実在武器の固有シルエットへ改修。
//   pistol-glock  ← Glock 17/19        (角ポリマー枠 + 四角トリガーガード + ハンマー無平坦後端)
//   pistol-cz75   ← CZ 75              (スライドがフレーム内側を走る段差=lowbore + 露出スパーハンマー)
//   pistol-93r    ← Beretta 93R(機関拳銃)(45度折フォアグリップ + コンペ段差 + 着脱スケルトンストック)
//   revolver      ← Ruger GP100        (円筒シリンダー + バレル下フルアンダーラグ + ゴムグリップ + 高ブレードサイト)
// サイト系(前後サイト/浮遊マイクロドット/耳)は buildGunBody 本体が描く(契約Y=IRON_POST_Y 0.075)。
// ここでは Silhouette の決定フィールドを立て、固有外装は PISTOL_PAINTERS が buckets へ +0DC で足す。
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
    // GP100: バレル下面の太いフルアンダーラグ(painter が鋼材塊を描く)
    revolverUnderlug: 'full',
    // GP100: 露出ハンマー(revolver shape の既定 true を明示)
    hammer: true,
    // GP100: 黒ゴムグリップ(既定の wood → rubber/pistol へ。painter が指溝を上乗せ)
    gripStyle: 'pistol',
  },
  // ── R58 固有キー(実在シルエット) ──
  // suzume / Glock 17系: 角型ポリマーフレーム + 四角トリガーガード前端張り出し + 外部ハンマー無し平坦後端
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
    // Glock: 角低背スライド + 後方セレーション + 外部ハンマー無し(平坦後端)
    slideProfile: 'glock',
    hammer: false,
    // グリップ内弾倉(15/17連)。protruding mag無し=feed:'none'。
    magInGrip: true,
  },
  // kawasemi-pistol / CZ 75系: スライドがフレーム内側を走り一段細く見える段差 + 露出スパーハンマー
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
    // CZ 75: 低ボア=スライドが外側フレームレールの内側を走る(painter がレールで段差を描く)
    slideProfile: 'lowbore',
    // 露出外部ハンマーがスライド後端から突出(det.hammer 経路 + painter のスパー)
    hammer: true,
    magInGrip: true,
  },
  // misago-pistol / Beretta 93R系(機関拳銃): 45度折フォアグリップ + コンペ段差 + 着脱スケルトンストック
  'pistol-93r': {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.034,
    barrelLen: 0.24,
    feed: 'none',
    handguard: 'none',
    // スケルトンストック(グリップ後方へ着脱)=buildGunBody の skeleton 枝
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    // コンペンセイター段差(muzzle brake 枝の一体コンペ)
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 0.65,
    // APS との決定差: トリガーガード前方から展開する折りたたみフォアグリップ(painter が描く)
    foldingForegrip: true,
    magInGrip: true,
  },
} satisfies Partial<Record<ModelKey, Silhouette>>;

// ── 固有外装 painter ───────────────────────────────────────────────────
// 各 painter は ctx(bake系/chamferBox/PAL/寸法/buckets)だけで描く。サイト系(前後サイト/
// ドット/耳)は buildGunBody 本体が所有するので触らない。全ジオメトリは metalParts/polishParts/
// polyParts へ merge されるため +0DC。camo は metal/poly バケツにのみ乗る(polish/研磨は素のまま)。

// Glock 17: 角ポリマー下部フレーム + 四角トリガーガード + 平坦スライド後端(ハンマー無し)。
function paintGlock(ctx: PainterCtx): void {
  const { boxP, bakeAt, chamferBox, C, r, recHalf, BARREL_Y } = ctx;
  // 角型ポリマー・ダストカバー(スライド前方下・アクセサリレール一体)。Glock の角ばった下部枠。
  bakeAt(ctx.polyParts, chamferBox(r.w + 0.004, 0.03, 0.115, 0.004), C.POLY, 0, -0.015, -0.165);
  // ダストカバー底面のアクセサリレール溝(2条)
  boxP(ctx.polyParts, C.GROOVE, 0.05, 0.006, 0.008, 0, -0.03, -0.145, 0, 0, 0, 'flat');
  boxP(ctx.polyParts, C.GROOVE, 0.05, 0.006, 0.008, 0, -0.03, -0.185, 0, 0, 0, 'flat');
  // 四角いトリガーガード(前端の四角い張り出し=Glockの識別点)。前縦柱+底桟+前上ノブで角ループを閉じる。
  boxP(ctx.polyParts, C.POLY, 0.013, 0.05, 0.013, 0, -0.05, -0.02); // 前縦柱
  boxP(ctx.polyParts, C.POLY, 0.013, 0.013, 0.07, 0, -0.075, 0.012); // 底桟
  boxP(ctx.polyParts, C.POLY, 0.016, 0.016, 0.018, 0, -0.03, -0.026); // 前端の四角い張り出し
  // 外部ハンマー無し=平坦なスライド後端(角い striker プレートでフラットに締める)。
  boxP(ctx.metalParts, C.DARK, r.w + 0.002, 0.026, 0.008, 0, r.h / 2 - 0.008, recHalf * 0.9, 0, 0, 0, 'machined');
  // 直立気味グリップのビーバーテイル(後端上)
  boxP(ctx.polyParts, C.POLY, 0.03, 0.012, 0.02, 0, -0.028, 0.112);
  // スライド上面前方の低いフロントセレーション(Glockの角い連続溝)
  for (let i = 0; i < 3; i += 1) {
    boxP(ctx.metalParts, C.GROOVE, r.w + 0.006, 0.016, 0.004, 0, BARREL_Y + 0.024, -0.07 - i * 0.01, 0, 0, 0, 'flat');
  }
}

// CZ 75: スライドが外側フレームレールの内側を走る段差(lowbore) + 露出スパーハンマー + オールスチール。
function paintCz75(ctx: PainterCtx): void {
  const { boxP, bakeAt, chamferBox, C, r, recHalf, BARREL_Y } = ctx;
  // 外側フレームレール(スライドより外・上端がスライド下半分を覆う)= CZ75 の決定的な「一段細いスライド」。
  for (const sx of [-1, 1] as const) {
    boxP(ctx.metalParts, C.BASE, 0.006, 0.02, 0.2, sx * 0.0435, 0.031, -0.006, 0, 0, 0, 'machined');
  }
  // フレーム上面のレッジ(スライドより幅広=フレームが外側を走る証拠の水平線)
  boxP(ctx.metalParts, C.RIM, r.w + 0.016, 0.004, 0.2, 0, 0.021, -0.006, 0, 0, 0, 'flat');
  // オールスチールのダストカバー(バレル前方下の鋼材)
  bakeAt(ctx.metalParts, chamferBox(0.05, 0.022, 0.09, 0.004), C.BASE, 0, -0.006, -0.16, 0, 0, 0, 'machined');
  // 露出スパーハンマー(スライド後端から突出)。det.hammer のベース塊 + 上後方へ伸びるスパー。
  boxP(ctx.metalParts, C.DARK, 0.011, 0.014, 0.012, 0, r.h / 2 + 0.002, recHalf - 0.006); // ピボット基部
  boxP(ctx.metalParts, C.POLISH, 0.008, 0.022, 0.007, 0, r.h / 2 + 0.02, recHalf + 0.002, 0.62, 0, 0); // スパー(上後方)
  // オールスチールのラップアラウンド・グリップパネル(側面・チェッカリング溝)
  for (const sx of [-1, 1] as const) {
    bakeAt(ctx.polyParts, chamferBox(0.008, 0.108, 0.05, 0.004), C.GRIP, sx * 0.028, -0.1, 0.1, 0.3, 0, 0);
  }
  // 前方フレームのトリガーガード下面バー(スチールの角い前端)
  boxP(ctx.metalParts, C.DARK, 0.012, 0.012, 0.05, 0, -0.072, 0.008, 0, 0, 0, 'flat');
  // 参考: BARREL_Y は溝高さ基準に使わないが、lowbore の段差は上のレールで表現済み。
  void BARREL_Y;
}

// Beretta 93R(機関拳銃): 折りたたみフォアグリップ + コンペ段差(muzzle) + スケルトンストック(body) + セレクタ + 延長弾倉。
function paint93r(ctx: PainterCtx): void {
  const { boxP, bakeAt, chamferBox, tubeZ, C, gauge, BARREL_Y, barFrontZ, barCenterZ } = ctx;
  // 折りたたみフォアグリップ(APSとの決定差)= トリガーガード前方から前下45度へ展開する支持グリップ。
  // rotation.x=+0.75 で先端が -Z(前方)かつ下へ倒れる=折り畳み展開ポーズ。
  boxP(ctx.metalParts, C.DARK, 0.024, 0.016, 0.024, 0, -0.02, -0.115); // ヒンジブロック
  bakeAt(ctx.polyParts, chamferBox(0.02, 0.085, 0.024, 0.004), C.POLY, 0, -0.06, -0.128, 0.75, 0, 0); // 折フォアグリップ
  boxP(ctx.polyParts, C.GROOVE, 0.022, 0.004, 0.05, 0, -0.06, -0.128, 0.75, 0, 0, 'flat'); // 滑り止め溝
  // Beretta オープンスライド: 上面から覗く露出バレル(92/93系の識別点)
  tubeZ(ctx.metalParts, C.BARREL, gauge * 0.5, 0.09, 0, BARREL_Y + 0.026, barCenterZ + 0.01, true);
  // コンペ段差の上面ポート(brake本体前=一体コンペの追加ベント)
  boxP(ctx.metalParts, C.GROOVE, gauge * 1.1, 0.005, 0.01, 0, BARREL_Y + gauge * 0.75, barFrontZ + 0.028, 0, 0, 0, 'flat');
  // 3点バースト・セレクタレバー(左側面後方)
  boxP(ctx.metalParts, C.POLISH, 0.007, 0.014, 0.022, -0.041, 0.016, 0.055, 0, 0, 0);
  // グリップ底から突出する延長弾倉(20連。機関拳銃の張り出しマグ)
  bakeAt(ctx.polyParts, chamferBox(0.042, 0.055, 0.05, 0.004), C.POLY, 0, -0.188, 0.095);
  boxP(ctx.metalParts, C.RIM, 0.046, 0.008, 0.054, 0, -0.212, 0.095, 0, 0, 0, 'flat'); // 底板
}

// Ruger GP100: フルアンダーラグ(バレル下の一体鋼材塊) + 黒ゴムグリップ + 高ブレードフロントサイト + 露出ハンマースパー。
function paintGp100(ctx: PainterCtx): void {
  const { boxP, bakeAt, chamferBox, C, gauge, barR, BARREL_Y, barCenterZ, barFrontZ, recHalf, r } = ctx;
  // フルアンダーラグ: 銃口までバレル下面と一体の太い鋼材塊(エジェクターロッドを内包)。GP100の決定点。
  bakeAt(ctx.metalParts, chamferBox(gauge * 1.55, 0.03, 0.14, 0.004), C.DARK, 0, -0.013, barCenterZ + 0.014, 0, 0, 0, 'machined');
  // アンダーラグ先端のエジェクターロッド収納突起
  boxP(ctx.metalParts, C.POLISH, gauge * 1.1, 0.012, 0.02, 0, -0.02, barFrontZ + 0.03);
  // バレル上面の平トップリブ(GP100の角ばったバレルシュラウド)
  boxP(ctx.metalParts, C.RIM, 0.01, 0.005, 0.11, 0, BARREL_Y + barR + 0.001, barCenterZ, 0, 0, 0, 'flat');
  // 高めブレードフロントサイト(銃口上・ソリッド鋼のランプ刃。狙点ドットは本体が描く=二重にしない)
  boxP(ctx.metalParts, C.DARK, 0.006, 0.02, 0.012, 0, BARREL_Y + barR + 0.011, barFrontZ + 0.024);
  // 露出ハンマースパー(GP100の広いチェッカードスパー)。本体 det.hammer のベース塊
  // (y=r.h/2+0.004, z=recHalf-0.01)の上端へ接続して上後方へ伸ばす(浮かせない)。
  boxP(ctx.metalParts, C.POLISH, 0.009, 0.018, 0.007, 0, r.h / 2 + 0.014, recHalf + 0.002, 0.6, 0, 0);
  // シリンダー左のサムピース(スイングアウト・ラッチ)
  boxP(ctx.metalParts, C.POLISH, 0.006, 0.012, 0.022, -0.03, 0.002, 0.024);
  // 黒ゴムグリップの底キャップ(Hogue風ラップアラウンド)
  boxP(ctx.polyParts, C.GRIP, 0.052, 0.02, 0.058, 0, -0.165, 0.1, 0.3, 0, 0);
}

// Phase C: 各 ModelKey の「非サイト外装」painter を登録する。
export const PISTOL_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  'pistol-glock': paintGlock,
  'pistol-cz75': paintCz75,
  'pistol-93r': paint93r,
  revolver: paintGp100,
};
