import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import { hasMuzzleAttachment, type PainterCtx, type ShapePainter } from './toolkit';

// ── AR系(ライフル/カービン/ブルパップ) シルエット ─────────────────────────────────────────
// R58 Phase C: 各 ModelKey を「名前の元ネタ実在銃」の決定的シルエットへ再モデリング。
// 汎用エントリ(rifle/carbine/bullpup)は据置(=modelKey 無し武器のフォールバック+契約テスト基準)。
// 固有 ar-* は実在寸法へ、AR_PAINTERS[key] が各銃の「非サイト外装」(キャリーハンドル/ガスブロック/
// FAパドル/モノリシック2トーン/バイポッド/折りたたみ骨組み等)を ctx の baker/PAL/buckets で足す。
// サイト系ジオメトリ(ドット/レンズ/耳)は buildGunBody 本体が描く(painter は一切触らない)。
// carryHandle を立てた機は viewmodel の sightYOverride/CARRY_HANDLE_SIGHT_Y が 3 点整合(内蔵サイトを
// ハンドル内 0.116 へ持ち上げ、本体パスが耳を抑止)。painter はハンドルの外装のみを描く。
export const AR_SHAPES = {
  // ── 汎用(modelKey 無し武器のフォールバック / resolveSightY 契約テスト基準)。据置。 ──
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
  // bullpup = akatsuki-ar(TAR-23 / IWI Tavor)。coarse だが専有(他に shape:'bullpup' 無し)。
  // 全長半分を後部の巨大角樹脂ボディが占める + 全長貫通フラットレール + 前方コッキングハンドル + 中央湾曲マグ。
  bullpup: {
    receiver: { w: 0.078, h: 0.11, d: 0.44 },
    barrelGauge: 0.028,
    barrelLen: 0.15,
    feed: 'mag-curved',
    handguard: 'slim',
    stock: 'none', // bullpup: 後部樹脂ボディが肩当てを兼ねる(painter が箱型肩当てを描く)
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.98,
    feedZ: 0.13, // グリップ後方=中央寄りの湾曲マグ
    chargingHandle: 'top',
    railTop: 'full',
    ironSight: 'flip',
  },

  // ── kaede-ar / FAMAS-G4(FAMAS F1/G2)── bullpup + 全長貫通の逆U字キャリーハンドル(内蔵サイト)
  //    + ハンドガード上バイポッド常設 + 細長い一体フラッシュハイダー + 三角バットプレート。
  'ar-famas': {
    receiver: { w: 0.066, h: 0.104, d: 0.42 },
    barrelGauge: 0.024, // 細い前部銃身
    barrelLen: 0.155,
    feed: 'mag-straight', // FAMAS 直箱マグ
    handguard: 'slim',
    stock: 'none', // bullpup
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.0,
    feedZ: 0.16, // グリップ後方の直マグ(bullpup)
    carryHandle: 'famas', // 逆U字トンネル → sightY 0.116(内蔵サイト)
    railTop: 'none',
    ironSight: 'flip',
    muzzleExtend: 0.045, // F4: 細長一体ハイダー前端まで muzzleZ を前進(実測≈4.5cm 埋没)
  },
  // ── miyama-br / FAL-53(FN FAL)── 在来式 + 折りたたみキャリーハンドルが寝た状態
  //    + 木製ハンドガード/ストック(他ARと異質)+ ラッパ状スリットフラッシュハイダー + 直線的20連。
  'ar-fal': {
    receiver: { w: 0.072, h: 0.098, d: 0.36 },
    barrelGauge: 0.03,
    barrelLen: 0.27, // 長め中細銃身
    feed: 'mag-curved', // FAL 20連はやや湾曲
    handguard: 'wood', // 木製(generic が木製ハンドガードを描く)
    stock: 'wood', // 木製固定ストック(painter が描く)
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'stock',
    bodyScale: 1.0,
    feedZ: -0.03,
    gripStyle: 'wood',
    furniture: 'wood',
    railTop: 'none', // ピカティニー無し=寝たハンドルのみ
    ironSight: 'fixed',
  },
  // ── kasasagi-ar / SCAR-18S(FN SCAR-H 17S)── 右側面後方に張り出すFAパドル(台形)
  //    + 左折りたたみ+伸縮スケルトンストック + 太め7.62銃身 + 角押出アルミアッパー。18Sは一回り大/太。
  'ar-scar-h': {
    receiver: { w: 0.08, h: 0.098, d: 0.35 },
    barrelGauge: 0.036, // 太い7.62
    barrelLen: 0.24,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.05,
    feedZ: -0.03,
    railTop: 'full',
    ironSight: 'flip',
  },
  // ── tobikuma-ar / HK415(HK416)── 素M4に酷似 + ガスブロック(ピストン)がハンドガード中程で角膨らみ
  //    + M4伸縮スケルトンストック + バードケージ + フラットトップ。
  'ar-hk416': {
    receiver: { w: 0.072, h: 0.092, d: 0.32 },
    barrelGauge: 0.03,
    barrelLen: 0.24,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.0,
    feedZ: -0.03,
    railTop: 'full',
    ironSight: 'flip',
  },
  // ── ginyanma-ar / MCX-9(SIG MCX)── バッファーチューブ無しで後端が極端に短い + 側方完全折り畳みストック
  //    + ハンドガードとマズルが連続した円筒 + スリム箱型レシーバ + STANAG垂直。
  'ar-mcx': {
    receiver: { w: 0.068, h: 0.088, d: 0.26 },
    barrelGauge: 0.026,
    barrelLen: 0.25, // 長い連続円筒(ハンドガード〜マズル)
    feed: 'mag-curved',
    handguard: 'slim',
    stock: 'none', // 後端極短(バッファーチューブ無し)。painter が側方折り畳みストックを描く
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.95,
    feedZ: -0.02,
    railTop: 'full',
    ironSight: 'flip',
  },
  // ── shinonome-ar / ARX-170(Beretta ARX-160)── 丸みポリマー多面ボディ + アンビ45度排莢口
  //    + 4段折りたたみ伸縮ストック + クイックチェンジバレルナット + 角型レール。
  'ar-arx': {
    receiver: { w: 0.074, h: 0.094, d: 0.29 },
    barrelGauge: 0.028,
    barrelLen: 0.19,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'folding',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.97,
    feedZ: -0.03,
    receiverStyle: 'mono', // 丸み一体ポリマー
    ejectionPort: false, // 45度アンビポートを painter が描く(縦ポート二重回避)
    railTop: 'full',
    ironSight: 'flip',
  },
  // ── kagerou-br / SG-512(SIG SG550/551)── レシーバ上部一体型の大型キャリーハンドル(内蔵ダイヤル丸窓サイト)
  //    + AK的プレス鋼板レシーバ + 半透明湾曲マグ + 側面折りたたみ三角スケルトン + 段付き大型フラッシュハイダー。
  'ar-sg550': {
    receiver: { w: 0.072, h: 0.094, d: 0.32 },
    barrelGauge: 0.028,
    barrelLen: 0.22,
    feed: 'mag-curved',
    handguard: 'vented',
    stock: 'none', // 三角スケルトンを painter が描く
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.0,
    feedZ: -0.03,
    carryHandle: 'ar15', // 大型ハンドル+ダイヤルサイト → sightY 0.116
    railTop: 'none',
    ironSight: 'fixed',
  },
  // ── mukudori-br / SCAR-14S(FN SCAR-L 16S)── モノリシック一体アッパー+ハンドガード + 上下2トーン色分割
  //    + 伸縮+側面折りたたみ + 18Sより小型/細銃身 + フリップサイト。
  'ar-scar-l': {
    receiver: { w: 0.07, h: 0.09, d: 0.3 },
    barrelGauge: 0.028, // 細い5.56
    barrelLen: 0.2,
    feed: 'mag-curved',
    handguard: 'rail',
    stock: 'skeleton',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 0.98,
    feedZ: -0.03,
    railTop: 'full',
    ironSight: 'flip',
  },
} satisfies Partial<Record<ModelKey, Silhouette>>;

// ── painters(非サイト外装のみ。Box/Cylinder/Cone/Extrude 系のみ=Plane/Circle/Sphere は足さない
//    → サイト契約「最初の PlaneGeometry=reflexドット / 最初の CircleGeometry=レンズ / iron Sphere」を保つ) ──

// FAMAS: 全長貫通の逆U字キャリーハンドル(内蔵サイト)+ ハンドガード上バイポッド + 細長い一体ハイダー
// + 三角バットプレート。内蔵サイトのドットは本体パスが 0.116 に描く(carryHandle)ので、
// painter はトンネル外装のみ(ドットは floor 0.10 と top bar 0.128 の隙間で視認される)。
const paintFamas: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, tubeZ, metalParts, C, r, recHalf, barCenterZ, barFrontZ, barLen, gauge, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  // 逆U字ハンドル: 厚い天面バー + 前/中/後の3脚 + トラフ床(内蔵サイトは 0.116=床0.104と天0.132の間)。
  const barY = 0.134;
  const hFrontZ = barCenterZ + barLen * 0.42; // ハンドル前端(銃身付け根の上)
  const hBackZ = recHalf - 0.02; // ハンドル後端
  const hMidZ = (hFrontZ + hBackZ) / 2;
  const hLen = hBackZ - hFrontZ;
  const legY = (barY + recTop) / 2;
  const legH = barY - recTop;
  boxP(metalParts, C.RAIL, 0.028, 0.02, hLen, 0, barY, hMidZ, 0, 0, 0, 'gradY'); // 厚い天面バー(窓の上=底0.124)
  boxP(metalParts, C.DARK, 0.022, 0.008, hLen * 0.96, 0, 0.104, hMidZ, 0, 0, 0, 'flat'); // トラフ床(窓の下=上端0.108)
  // R58 A1: 中央支柱を x=±0.014 のサイドポスト対に分割し、内蔵サイト(0.116)の貫通視界窓(中央 x±0.0095)を
  // 構造的に確保する(ADS で「ドットだけ見えて標的が見えない」を根治。天面バー↔レシーバは左右脚が支える)。
  for (const sx of [-1, 1] as const) {
    boxP(metalParts, C.DARK, 0.009, legH, 0.026, sx * 0.014, legY, hFrontZ + 0.012); // 前脚(前照星フード)左右
    boxP(metalParts, C.DARK, 0.008, legH, 0.016, sx * 0.013, legY, hMidZ); // 中脚 左右
    boxP(metalParts, C.DARK, 0.010, legH, 0.032, sx * 0.015, legY, hBackZ - 0.02); // 後脚(アパーチャ座)左右
    tubeZ(metalParts, C.POLISH, 0.008, 0.014, sx * 0.017, 0.113, hBackZ + 0.004, false, 'flat'); // 後照星ドラム(ドット両脇=射線外)
  }
  // ハンドガード上に折り畳みバイポッド(常設): ヒンジ + 前方へ寝た2脚。
  const hgTopY = BARREL_Y + gauge * 0.5 + 0.006;
  boxP(metalParts, C.DARK, 0.02, 0.012, 0.016, 0, hgTopY, barCenterZ - barLen * 0.12);
  for (const sx of [-1, 1] as const) {
    boxP(metalParts, C.POLISH, 0.005, 0.006, 0.11, sx * 0.008, hgTopY + 0.006, barCenterZ - barLen * 0.36, 0.34, 0, 0);
  }
  // 細長い一体フラッシュハイダー(FAMAS の特徴的な長い筒)。R58 F3: マズルアタッチメント(サプ/コンペ)
  // 装着時は generic-pass が銃口デバイスを描くため skip(ハイダーがコンペ箱を貫通/二重造形を防ぐ)。
  if (!hasMuzzleAttachment(ctx)) {
    tubeZ(metalParts, C.BARREL, gauge * 0.5, 0.1, 0, BARREL_Y, barFrontZ - 0.05, true);
    tubeZ(metalParts, C.RIM, gauge * 0.56, 0.012, 0, BARREL_Y, barFrontZ - 0.095, false, 'flat');
  }
  // 三角バットプレート(stock:'none' の後端)。頬当てリッジ + 傾斜バットパッド。
  boxP(metalParts, C.DARK, 0.05, 0.014, 0.03, 0, recTop - 0.006, recHalf + 0.006, 0, 0, 0, 'flat'); // 頬当てリッジ
  ctx.bakeAt(metalParts, ctx.chamferBox(0.05, 0.088, 0.02, 0.006), C.DARK, 0, -0.006, recHalf + 0.018, -0.22, 0, 0); // 傾斜バットパッド
};

// FAL: 寝た折りたたみキャリーハンドル + 木製ハンドガード(generic)/木製ストック(painter)
// + ラッパ状フラッシュハイダー + ガスブロック。
const paintFal: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, coneZ, chamferBox, metalParts, polyParts, C, r, recHalf, barCenterZ, barFrontZ, barLen, gauge, bs, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  const stockZ = recHalf + 0.05 * bs;
  // 寝た折りたたみキャリーハンドル(レシーバ上部に横たわる)。低い平バー + 前ヒンジ + 寝た掴みバー。
  boxP(metalParts, C.POLISH, 0.014, 0.008, 0.15, 0, recTop + 0.008, 0.0, 0, 0, 0, 'gradY');
  boxP(metalParts, C.DARK, 0.016, 0.014, 0.018, 0, recTop + 0.006, -recHalf * 0.55); // 前ヒンジ
  boxP(metalParts, C.POLISH, 0.02, 0.006, 0.05, 0, recTop + 0.014, 0.03, 0, 0, 0, 'flat'); // 掴みバー(寝た状態)
  // 木製固定ストック(stock:'wood' は generic no-op)。バット + 頬当てコム + バットパッド。
  bakeAt(polyParts, chamferBox(0.052, 0.092, 0.16, 0.01), C.WOOD, 0, -0.008, stockZ + 0.055);
  boxP(polyParts, C.WOOD_HI, 0.05, 0.01, 0.14, 0, 0.035, stockZ + 0.05, 0, 0, 0, 'flat'); // 上コム
  boxP(metalParts, C.DARK, 0.05, 0.086, 0.012, 0, -0.006, stockZ + 0.132, 0, 0, 0, 'flat'); // バットプレート
  // ガスブロック + フロントサイト座(銃身前方)。
  bakeAt(metalParts, chamferBox(gauge + 0.012, 0.03, 0.03, 0.004), C.DARK, 0, BARREL_Y + 0.008, barCenterZ - barLen * 0.28);
  // ラッパ状スリットフラッシュハイダー(前方へ開く bell)。
  coneZ(metalParts, C.DARK, gauge * 0.55, gauge * 0.98, 0.05, 0, BARREL_Y, barFrontZ - 0.03);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    boxP(metalParts, C.GROOVE, 0.003, gauge * 0.7, 0.03, Math.cos(a) * gauge * 0.62, BARREL_Y + Math.sin(a) * gauge * 0.62, barFrontZ - 0.03, 0, 0, 0, 'flat');
  }
};

// SCAR-H: 右側面後方の大型トラペゾイドFAパドル + 誇張した角押出アッパー(角ハンプ) + 箱型マズルブレーキ
// + 折りたたみ伸縮スケルトン + 太銃身。HK416(角ハンプ無し・handguardガスブロック持ち)との決定的相互差。
const paintScarH: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, polyParts, C, r, recD, recHalf, barCenterZ, barFrontZ, barLen, gauge, bs, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  const stockZ = recHalf + 0.05 * bs;
  // 角押出アルミアッパー(SCAR の決定的な角ハンプ)を誇張: 背高の隆起 + 明色ピーク稜 + 前方の傾斜面。
  bakeAt(metalParts, chamferBox(r.w * 0.82, 0.04, recD * 0.56, 0.004), C.BASE, 0, recTop + 0.016, recD * 0.03, 0, 0, 0); // 背高ハンプ本体
  bakeAt(metalParts, chamferBox(r.w * 0.5, 0.022, recD * 0.44, 0.004), C.RIM, 0, recTop + 0.04, recD * 0.03, 0, 0, 0); // 明色ピーク稜(角押出天面)
  bakeAt(metalParts, chamferBox(r.w * 0.72, 0.03, 0.036, 0.004), C.DARK, 0, recTop + 0.02, -recD * 0.24, -0.55, 0, 0); // 前方の傾斜面(角ばり)
  // 右側面後方の大型トラペゾイド・フォワードアシストパドル(+X=カメラ側)。台形=背高後部+短前部、+Xへ大きく張り出す。
  bakeAt(metalParts, chamferBox(0.026, 0.058, 0.055, 0.004), C.DARK, r.w / 2 + 0.016, 0.006, recD * 0.24); // パドル基部(背高後部)
  bakeAt(metalParts, chamferBox(0.024, 0.036, 0.032, 0.003), C.DARK, r.w / 2 + 0.018, -0.006, recD * 0.315); // 前方テーパ(台形の短い前部)
  boxP(metalParts, C.POLISH_HI, 0.005, 0.05, 0.058, r.w / 2 + 0.03, 0.008, recD * 0.25, 0, 0, 0, 'gradY'); // 外面の明色リップ(パドルを立たせる)
  boxP(metalParts, C.RIM, 0.028, 0.006, 0.05, r.w / 2 + 0.016, 0.035, recD * 0.24, 0, 0, 0, 'flat'); // 上稜ハイライト
  // 太銃身のガスブロック(ヘビーバレル座)。
  tubeZ(metalParts, C.DARK, gauge * 0.62, 0.04, 0, BARREL_Y, barCenterZ - barLen * 0.24, true);
  // 箱型マズルブレーキを明示: generic brake 前方に一回り大きい角ブロック + 上稜 + 側面ポートで「箱」を強調。
  // R58 F2: マズルアタッチメント(サプ/コンペ)装着時は skip(サプ管に箱ブレーキが串刺し浮遊するのを防ぐ)。
  if (!hasMuzzleAttachment(ctx)) {
    const mbZ = barFrontZ - 0.086;
    bakeAt(metalParts, chamferBox(gauge * 2.7, gauge * 2.3, 0.028, 0.003), C.DARK, 0, BARREL_Y, mbZ);
    boxP(metalParts, C.RIM, gauge * 2.4, 0.005, 0.026, 0, BARREL_Y + gauge * 1.12, mbZ, 0, 0, 0, 'flat'); // 上稜ハイライト
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.GROOVE, 0.006, gauge * 1.6, 0.016, sx * gauge * 1.32, BARREL_Y, mbZ, 0, 0, 0, 'flat'); // 側面ポート
    }
  }
  // 折りたたみヒンジ + 伸縮スケルトンストック(ポリマー角/調整コム/バットパッド)。
  boxP(metalParts, C.DARK, 0.03, 0.05, 0.028, 0, 0.004, recHalf + 0.012); // ヒンジ
  tubeZ(metalParts, C.POLISH, 0.012, 0.1, 0, 0.006, stockZ + 0.04, false); // 伸縮チューブ
  bakeAt(polyParts, chamferBox(0.046, 0.078, 0.09, 0.006), C.POLY, 0, 0.006, stockZ + 0.09); // ストック本体
  boxP(polyParts, C.GROOVE, 0.048, 0.014, 0.07, 0, 0.05, stockZ + 0.085, 0, 0, 0, 'flat'); // 調整コム
  boxP(metalParts, C.DARK, 0.05, 0.088, 0.012, 0, 0.004, stockZ + 0.14, 0, 0, 0, 'flat'); // バットパッド
};

// SCAR-L: モノリシック一体アッパー+ハンドガード + 上下2トーン色分割 + 折りたたみ伸縮 + 小型/細銃身。
const paintScarL: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, polyParts, C, r, recD, recHalf, barCenterZ, barLen, gauge, bs, BARREL_Y } = ctx;
  const stockZ = recHalf + 0.05 * bs;
  // モノリシック一体アッパー+ハンドガード(レシーバ前端〜銃身前方まで連続する上部塊)。
  const monoZ0 = recD * 0.44; // アッパー後端
  const monoZ1 = barCenterZ - barLen * 0.36; // ハンドガード前端
  const monoLen = monoZ0 - monoZ1;
  bakeAt(metalParts, chamferBox(gauge + 0.03, gauge + 0.026, monoLen, 0.004), C.RIM, 0, BARREL_Y + 0.006, (monoZ0 + monoZ1) / 2, 0, 0, 0); // 一体上部(明色=2トーン上)
  boxP(metalParts, C.POLISH, r.w * 0.42, 0.008, monoLen * 0.98, 0, BARREL_Y + gauge * 0.6 + 0.012, (monoZ0 + monoZ1) / 2, 0, 0, 0, 'flat'); // 連続天面レール
  // 2トーン: 上=明色(POLISH_HI)アッパークラムシェル / 下=既存の暗レシーバ。上下コントラストを一段強化。
  bakeAt(metalParts, chamferBox(r.w + 0.004, r.h * 0.46, recD * 0.9, 0.004), C.POLISH_HI, 0, r.h * 0.24, 0, 0, 0, 0);
  // 小型FAパドル(SCAR-L も右側面に持つ)。
  bakeAt(metalParts, chamferBox(0.04, 0.03, 0.022, 0.003), C.DARK, r.w / 2 + 0.01, 0.006, recD * 0.22, 0, 0.32, 0);
  // 折りたたみ伸縮スケルトンストック(SCAR-H より小型)。
  boxP(metalParts, C.DARK, 0.028, 0.046, 0.026, 0, 0.004, recHalf + 0.01);
  tubeZ(metalParts, C.POLISH, 0.011, 0.09, 0, 0.006, stockZ + 0.035, false);
  bakeAt(polyParts, chamferBox(0.042, 0.07, 0.08, 0.006), C.POLY, 0, 0.006, stockZ + 0.08);
  boxP(metalParts, C.DARK, 0.045, 0.08, 0.012, 0, 0.004, stockZ + 0.124, 0, 0, 0, 'flat');
};

// HK416: 素M4 + ハンドガード中程の角ばったガスブロック(ピストン)膨らみ + M4伸縮スケルトン + バードケージ。
const paintHk416: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, polyParts, C, recHalf, barCenterZ, barFrontZ, barLen, gauge, bs, BARREL_Y } = ctx;
  const stockZ = recHalf + 0.05 * bs;
  // 決定的特徴: ハンドガード中程で角ばった大型ガスブロック膨らみ(ピストン)。一段大型化し SCAR-H(角ハンプ持ち)との相互差を付ける。
  const gbY = BARREL_Y + gauge * 0.5 + 0.02;
  const gbZ = barCenterZ + barLen * 0.06;
  bakeAt(metalParts, chamferBox(gauge + 0.016, 0.04, 0.072, 0.004), C.DARK, 0, gbY, gbZ); // 大型ガスブロック本体
  boxP(metalParts, C.RIM, gauge + 0.014, 0.005, 0.06, 0, gbY + 0.021, gbZ, 0, 0, 0, 'flat'); // 上稜ハイライト
  boxP(metalParts, C.GROOVE, gauge + 0.02, 0.006, 0.01, 0, gbY + 0.019, gbZ - 0.024, 0, 0, 0, 'flat'); // ガス調整ノブ座
  bakeAt(metalParts, chamferBox(gauge + 0.012, 0.026, 0.02, 0.003), C.DARK, 0, gbY - 0.008, gbZ - 0.046, -0.5, 0, 0); // 前方の傾斜ステップ(角ばり)
  // M4 バッファーチューブ + 伸縮スケルトンストック(castle nut + 傾斜バット)。
  tubeZ(metalParts, C.DARK, 0.017, 0.15, 0, 0.008, stockZ + 0.05, true); // バッファーチューブ
  tubeZ(metalParts, C.RIM, 0.021, 0.01, 0, 0.008, recHalf + 0.014, false, 'flat'); // castle nut
  bakeAt(polyParts, chamferBox(0.046, 0.078, 0.1, 0.006), C.POLY, 0, 0.0, stockZ + 0.07);
  boxP(polyParts, C.GROOVE, 0.048, 0.06, 0.014, 0, -0.006, stockZ + 0.118, 0, 0, 0, 'flat'); // バットパッド
  // バードケージフラッシュハイダー(スリット付き短ケージ)。
  tubeZ(metalParts, C.DARK, gauge * 0.62, 0.03, 0, BARREL_Y, barFrontZ - 0.016, true);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    boxP(metalParts, C.GROOVE, 0.0025, gauge * 0.5, 0.016, Math.cos(a) * gauge * 0.5, BARREL_Y + Math.sin(a) * gauge * 0.5, barFrontZ - 0.016, 0, 0, 0, 'flat');
  }
};

// MCX: 後端極短(バッファーチューブ無し)+ 側方完全折り畳みストック + ハンドガード〜マズル連続円筒。
const paintMcx: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, polyParts, C, r, recHalf, barCenterZ, barLen, gauge, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  // ハンドガードとマズルが連続した円筒(スリム M-LOK チューブ、銃身前方まで一続き)。
  tubeZ(metalParts, C.DARK, gauge + 0.006, barLen * 0.86, 0, BARREL_Y, barCenterZ - barLen * 0.02, true);
  for (let i = 0; i < 5; i += 1) {
    const zz = barCenterZ - barLen * 0.3 + i * (barLen * 0.14);
    boxP(metalParts, C.GROOVE, gauge + 0.014, 0.004, 0.01, 0, BARREL_Y + gauge * 0.5 + 0.006, zz, 0, 0, 0, 'flat'); // 天面 M-LOK
  }
  // 後端極短(バッファーチューブ無し)+ 側方へ完全に折り畳んだストック(レシーバ脇の短いスタブ)。
  boxP(metalParts, C.DARK, 0.026, 0.048, 0.024, 0, 0.006, recHalf + 0.006); // ヒンジ(後端すぐ)
  boxP(metalParts, C.DARK, 0.016, 0.02, 0.1, r.w / 2 + 0.012, 0.014, recHalf - 0.04); // 畳んだ骨組み(側方・短)
  boxP(polyParts, C.POLY, 0.018, 0.044, 0.016, r.w / 2 + 0.012, 0.014, recHalf - 0.092); // 畳んだバットパッド
  // スリム箱型レシーバ上部の薄いアッパー。
  bakeAt(metalParts, chamferBox(r.w * 0.86, 0.02, r.d * 0.86, 0.003), C.BASE, 0, recTop + 0.004, 0, 0, 0, 0);
};

// ARX-160: 丸みポリマー多面ボディ + アンビ45度排莢口 + 4段折りたたみ伸縮 + クイックチェンジバレルナット。
const paintArx: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, polyParts, C, r, recD, recHalf, barCenterZ, barLen, gauge, bs, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  const stockZ = recHalf + 0.05 * bs;
  // 丸みを帯びたポリマー多面ボディ(大ベベル=丸みのクラムシェルでレシーバを覆う)。
  bakeAt(polyParts, chamferBox(r.w + 0.008, r.h + 0.008, recD * 0.94, 0.016), C.POLY, 0, 0, 0);
  bakeAt(polyParts, chamferBox(r.w * 0.7, 0.03, recD * 0.6, 0.012), C.GRIP, 0, recTop - 0.004, recD * 0.04); // 上面ファセット
  // 角ファセットの稜線(ベベルエッジのハイライト)= 丸ボディを"多面ポリマー"に見せる明色チャイン。
  //   +X=カメラ側の上下チャイン + 中段の面割りシーム(細帯=ブロブ化しない)。
  boxP(metalParts, C.POLISH_HI, 0.007, 0.006, recD * 0.82, r.w / 2 + 0.004, r.h * 0.3, -recD * 0.02, 0, 0, 0.34, 'gradY'); // 上チャイン
  boxP(metalParts, C.POLISH_HI, 0.007, 0.006, recD * 0.82, r.w / 2 + 0.004, -r.h * 0.3, -recD * 0.02, 0, 0, -0.34, 'gradY'); // 下チャイン
  boxP(metalParts, C.RIM, 0.005, 0.004, recD * 0.74, r.w / 2 + 0.008, r.h * 0.02, -recD * 0.02, 0, 0, 0, 'flat'); // 中段の面割りシーム
  // アンビ45度排莢口/デフレクタを大型・明色で側面に明示。+X=カメラ側、X軸まわりに傾け斜めスロットに。
  const portZ = -recD * 0.1;
  bakeAt(metalParts, chamferBox(0.013, 0.024, 0.072, 0.004), C.POLISH, r.w / 2 + 0.016, 0.016, portZ, 0.7, 0, 0); // 明色ポート枠(斜め・張り出し)
  boxP(metalParts, C.GROOVE, 0.01, 0.014, 0.06, r.w / 2 + 0.022, 0.016, portZ, 0.7, 0, 0, 'flat'); // 暗色スロット(開口)
  bakeAt(metalParts, chamferBox(0.018, 0.03, 0.024, 0.003), C.RIM, r.w / 2 + 0.02, -0.006, portZ - recD * 0.12, 0.5, 0, 0); // 大型台形デフレクタ(明色)
  // クイックチェンジバレルナット(銃身付け根の太リング)を強調: 太径 + 内段 + 6面ノッチの締めリング。
  const nutZ = barCenterZ + barLen * 0.42;
  tubeZ(metalParts, C.RIM, gauge + 0.02, 0.032, 0, BARREL_Y, nutZ, true, 'gradY'); // 太リング
  tubeZ(metalParts, C.POLISH, gauge + 0.006, 0.036, 0, BARREL_Y, nutZ, true, 'flat'); // 内段
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    boxP(metalParts, C.GROOVE, 0.004, 0.012, 0.034, Math.cos(a) * (gauge + 0.02), BARREL_Y + Math.sin(a) * (gauge + 0.02), nutZ, 0, 0, a, 'flat'); // ノッチ
  }
  // 4段折りたたみ伸縮ストック(ポリマー角、位置ノッチ)。
  boxP(metalParts, C.DARK, 0.028, 0.048, 0.024, 0, 0.004, recHalf + 0.01);
  bakeAt(polyParts, chamferBox(0.044, 0.072, 0.11, 0.008), C.POLY, 0, 0.004, stockZ + 0.08);
  for (let i = 0; i < 4; i += 1) {
    boxP(polyParts, C.GROOVE, 0.046, 0.006, 0.006, 0, 0.03, stockZ + 0.045 + i * 0.02, 0, 0, 0, 'flat'); // 段ノッチ
  }
};

// SG550: 大型キャリーハンドル(内蔵ダイヤル丸窓サイト)+ AK的プレス鋼板レシーバ + 側面折りたたみ三角スケルトン
// + 段付き大型フラッシュハイダー。内蔵サイトドットは本体パスが 0.116 に描く(carryHandle)。
const paintSg550: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, tubeZ, chamferBox, metalParts, C, r, recD, recHalf, barFrontZ, gauge, BARREL_Y } = ctx;
  // R58 A1: 大型キャリーハンドルを「天面バー(内蔵サイト窓の上=底 y0.126>0.124)+左右サイドレール(中央に
  // 貫通視界窓 x±0.013)」へ再構成。旧・中実ブロック(y0.072-0.124)は狙点0.116の射線を塞いでいた。
  boxP(metalParts, C.DARK, 0.03, 0.018, 0.17, 0, 0.135, 0.01, 0, 0, 0, 'gradY'); // 天面バー(底0.126)
  for (const sx of [-1, 1] as const) {
    boxP(metalParts, C.DARK, 0.008, 0.09, 0.17, sx * 0.017, 0.081, 0.01, 0, 0, 0, 'gradY'); // サイドレール(中央窓を開ける)
    boxP(metalParts, C.DARK, 0.008, 0.05, 0.018, sx * 0.016, 0.086, -0.06); // 前支柱 左右(中央を塞がない)
  }
  // 内蔵ダイヤル丸窓サイト(回転ドラム=SG550 の決定的丸窓)。ハンドル左側面へ寄せ射線外へ。
  tubeZ(metalParts, C.POLISH, 0.02, 0.02, -0.032, 0.104, 0.085, true, 'gradY');
  tubeZ(metalParts, C.GROOVE, 0.011, 0.024, -0.032, 0.104, 0.085, false, 'flat'); // ダイヤル丸窓インセット
  // AK的プレス鋼板レシーバ(丸みダストカバー天面 + リベット列)。
  bakeAt(metalParts, chamferBox(r.w + 0.003, r.h * 0.42, recD * 0.86, 0.008), C.BASE, 0, r.h * 0.26, 0);
  for (let i = 0; i < 4; i += 1) {
    boxP(metalParts, C.RIM, 0.005, 0.005, 0.005, r.w / 2 + 0.001, -0.006, -recD * 0.2 + i * 0.06, 0, 0, 0, 'flat'); // リベット
  }
  // 側面折りたたみ三角スケルトンストック(展開=開いた台形/三角枠)。上枠を長く・下枠を短くしてテーパ。
  const s0 = recHalf;
  boxP(metalParts, C.DARK, 0.016, 0.012, 0.05, 0, 0.004, s0 + 0.02); // ヒンジ基部
  boxP(metalParts, C.DARK, 0.018, 0.01, 0.14, 0, 0.04, s0 + 0.078); // 上枠(水平・長)
  boxP(metalParts, C.DARK, 0.018, 0.01, 0.1, 0, -0.03, s0 + 0.058); // 下枠(水平・短)
  boxP(metalParts, C.DARK, 0.022, 0.078, 0.012, 0, 0.006, s0 + 0.142); // バットプレート(縦)
  // 段付き大型フラッシュハイダー(2径ステップ)。
  tubeZ(metalParts, C.DARK, gauge * 0.8, 0.026, 0, BARREL_Y, barFrontZ - 0.012, true);
  tubeZ(metalParts, C.BARREL, gauge * 0.62, 0.03, 0, BARREL_Y, barFrontZ - 0.04, true);
};

// TAR(bullpup): 後部の巨大角樹脂ボディ + 全長貫通フラットレール + 前方コッキングハンドル + 中央湾曲マグ
// + 角箱型肩当て。
const paintTavor: ShapePainter = (ctx: PainterCtx): void => {
  const { boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, recD, recHalf, barCenterZ, barFrontZ, barLen, gauge, BARREL_Y } = ctx;
  const recTop = r.h / 2;
  // 後部の巨大角樹脂ボディ(全長半分を占める角ばったシェル)。
  bakeAt(polyParts, chamferBox(r.w + 0.006, r.h + 0.012, recD * 0.56, 0.007), C.POLY, 0, 0.006, recD * 0.2);
  bakeAt(polyParts, chamferBox(r.w * 0.7, 0.028, recD * 0.4, 0.006), C.GRIP, 0, recTop + 0.006, recD * 0.24); // 角ハンプ天面
  // 角箱型肩当て(後端)+ バットパッド。
  bakeAt(polyParts, chamferBox(r.w + 0.008, r.h * 0.92, 0.05, 0.007), C.POLY, 0, -0.006, recHalf + 0.012);
  boxP(metalParts, C.DARK, r.w, 0.09, 0.012, 0, -0.006, recHalf + 0.04, 0, 0, 0, 'flat');
  // 全長貫通フラットレール(後端〜銃身前方まで一続きの低いレール)。
  const railFrontZ = barFrontZ + 0.01;
  const railBackZ = recHalf - 0.02;
  const railLen = railBackZ - railFrontZ;
  boxP(metalParts, C.RAIL, r.w * 0.38, 0.006, railLen, 0, recTop + 0.008, (railFrontZ + railBackZ) / 2, 0, 0, 0, 'flat');
  const n = Math.max(8, Math.floor(railLen / 0.016));
  for (let i = 0; i < n; i += 1) {
    boxP(metalParts, C.RIM, r.w * 0.32, 0.004, 0.006, 0, recTop + 0.013, railFrontZ + (i + 0.5) * (railLen / n), 0, 0, 0, 'flat');
  }
  // 前方コッキングハンドル(銃身付け根前方、+X=カメラ側)。
  boxP(metalParts, C.POLISH, 0.012, 0.012, 0.028, r.w / 2 + 0.008, BARREL_Y + 0.012, barCenterZ + barLen * 0.34);
  // スリムなポリマー前部ハンドガード。
  bakeAt(polyParts, chamferBox(gauge + 0.016, gauge + 0.016, barLen * 0.6, 0.005), C.GRIP, 0, BARREL_Y, barCenterZ + barLen * 0.05);
  // 前方バーティカル握りの土台(TAR らしい前部の下方張り出し)。
  boxP(polyParts, C.POLY, 0.03, 0.03, 0.05, 0, -0.03, barCenterZ + barLen * 0.2, 0, 0, 0);
};

// Phase C: 実在シルエット painter を登録。
export const AR_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  'ar-famas': paintFamas,
  'ar-fal': paintFal,
  'ar-scar-h': paintScarH,
  'ar-scar-l': paintScarL,
  'ar-hk416': paintHk416,
  'ar-mcx': paintMcx,
  'ar-arx': paintArx,
  'ar-sg550': paintSg550,
  bullpup: paintTavor,
};
