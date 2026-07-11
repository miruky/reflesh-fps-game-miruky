import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import { hasMuzzleAttachment, type ShapePainter } from './toolkit';

// AWM のオリーブ樹脂ストックシェル(頂点カラー・アセットレス。メタル/ポリの頂点色なので
// arm hex 制約=glass 材の話とは無関係)。寒色パレットの中で唯一の暖緑=一目で AWM と分かる。
// R58 E2 nit: 旧 0x3a4726 はやや黄緑(G−R=13)→ 沈んだオリーブ寄り(G−R≈4/低彩度)へ寄せる。
const AWM_GREEN = 0x3d4129;
const AWM_GREEN_HI = 0x4e5334;

// ── 狙撃/DMR/対物系 シルエット ─────────────────────────────────────────
// R58 shape共有解消: 汎用エントリ + 実在武器ごとの固有 ModelKey。
// Phase C: 5挺(dmr-svd/dmr-wa2000/sniper-awm/sniper-trg/sniper-semi)を実在シルエットへ改修。
// 据え置き3挺(antimateriel=黒鷲/dsr-bp=DSR/sniper-beam=蜃気楼)は逐語コピーのまま=painter無し。
// 各 scope.y は不変(=OPTIC_SPECS.sightY と一致=ADS照準ずれ防止)。改修は scope.r/len と
// 非サイト外装(painter)のみ。
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
  // ── R33 新shape ─────────────────────────────────────────────────────
  // sniper-semi: R58 Phase C で KAC SR-25(sigi-sniper)専用の実在シルエットへ。
  // 元「SVD系」の含意は dmr-svd(shirasagi)へ移譲済み。
  'sniper-semi': {
    receiver: { w: 0.078, h: 0.096, d: 0.36 },
    barrelGauge: 0.033,
    barrelLen: 0.31,
    feed: 'mag-curved', // 太く短い 7.62 カーブドマグ
    handguard: 'slim', // 太いフリーフロート丸筒は painter が被せる
    stock: 'fixed', // 固定 M16A2 ストック(A2形状は painter)
    scope: { r: 0.026, len: 0.16, y: 0.086 }, // y 不変(scope-sniper-semi=0.086)
    boltHandle: false,
    muzzle: 'flash', // A2 バードケージ
    accentBand: 'receiver',
    bodyScale: 1.22,
    railTop: 'full', // 固定ハンドルなしフラットトップ
    chargingHandle: 'rear', // AR の T字後端チャージング
    barrelProfile: 'heavy', // 610mm ヘビーバレル
  },
  // antimateriel: Barrett系対物ライフル(黒鷲=据え置き。painter無し)
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
  // ── R58 固有キー(Phase C=実在シルエットへ改修済み) ──
  // shirasagi-mk / SVD-16 ← Dragunov SVD
  // 決定的特徴: 木製サムホール・スケルトンストック(頬当て)+ベンチレーテッド木製ハンドガード
  //           + 左側面オフセットのサイドマウントスコープ + 620mm露出銃身 + スリットフラッシュハイダー。
  'dmr-svd': {
    receiver: { w: 0.075, h: 0.095, d: 0.36 },
    barrelGauge: 0.030,
    barrelLen: 0.42, // 620mm 露出銃身(長い)
    feed: 'mag-curved', // 湾曲10連
    handguard: 'wood', // 下部木製ハンドガード(上部+通気スリットは painter)
    stock: 'thumbhole', // 木サムホール(本体 no-op → painter)
    scope: { r: 0.025, len: 0.16, y: 0.085 }, // y 不変(scope-dmr=0.085)。PSO-1風に細め
    boltHandle: false, // チャージングハンドルは painter(右)
    muzzle: 'none', // スリットフラッシュハイダーは painter
    accentBand: 'receiver',
    bodyScale: 1.18,
    furniture: 'wood',
    gripStyle: 'wood', // 木製グリップ
    barrelProfile: 'plain', // SVD 銃身は滑らか(fluted 上書き)
    muzzleExtend: 0.04, // F4: スリットハイダー前端まで muzzleZ を前進(実測≈4cm 埋没)
  },
  // hibari-mk / WA2200 ← Walther WA2000
  // 決定的特徴: ブルパップ + 前方に太く長大なバレルシュラウド(頭でっかち・質量前方)
  //           + アイアン無し + 一体スコープブリッジ + フルーテッド銃身 + グリップ直後6連太マグ + 前方バイポッド。
  'dmr-wa2000': {
    receiver: { w: 0.08, h: 0.10, d: 0.34 },
    barrelGauge: 0.032,
    barrelLen: 0.34,
    feed: 'mag-curved',
    feedZ: 0.14, // ブルパップ: 弾倉をグリップ後方へ
    handguard: 'none', // 前方の巨大シュラウドは painter
    stock: 'none', // 肩当ては painter(ブルパップ後端)
    scope: { r: 0.028, len: 0.18, y: 0.085 }, // y 不変(scope-dmr=0.085)
    boltHandle: false,
    muzzle: 'brake',
    accentBand: 'receiver',
    bodyScale: 1.18,
    barrelProfile: 'fluted', // フルーテッド銃身
  },
  // raicho-sniper / AWR-338 ← AI AWM/AWP
  // 決定的特徴: 太く角ばったアルミシャーシ + グリーン/黒樹脂ストックシェル(箱型塊感)
  //           + 先端大型多ポートマズルブレーキ + フルーテッド露出銃身 + 右ボルト + 前方バイポッド。
  'sniper-awm': {
    receiver: { w: 0.082, h: 0.10, d: 0.36 },
    barrelGauge: 0.036,
    barrelLen: 0.30,
    feed: 'mag-curved', // シングルスタック5連
    handguard: 'none', // フラットボトム緑フォアエンドは painter
    stock: 'fixed', // 緑樹脂シェルは painter が被せる
    scope: { r: 0.032, len: 0.19, y: 0.08 }, // y 不変(scope-sniper=0.08)。大型
    boltHandle: true, // 右ボルトハンドル(本体 vm:bolt)
    muzzle: 'none', // 大型多ポートブレーキは painter
    accentBand: 'receiver',
    bodyScale: 1.25,
    barrelProfile: 'fluted', // フルーテッド露出ステンレス銃身
    muzzleExtend: 0.06, // F4: 多ポートブレーキ前端まで muzzleZ を前進(実測≈6cm 埋没)
  },
  // shirayuki-sniper / TRG-44 ← Sako TRG-42
  // 決定的特徴: 多軸調整バットプレート(直方体突起の集合)がストック後端輪郭
  //           + AWMより細身・控えめマズルブレーキ + 角型ポリマーフォアエンド + 着脱バイポッド。
  'sniper-trg': {
    receiver: { w: 0.072, h: 0.092, d: 0.35 }, // AWMより細身
    barrelGauge: 0.033,
    barrelLen: 0.30,
    feed: 'mag-curved',
    handguard: 'none', // 角型ポリマーフォアエンドは painter
    stock: 'fixed', // 多軸調整バットは painter
    scope: { r: 0.030, len: 0.17, y: 0.08 }, // y 不変(scope-sniper=0.08)
    boltHandle: true, // 右ボルト
    muzzle: 'brake', // 控えめブレーキ(本体描画=AWMより小)
    accentBand: 'receiver',
    bodyScale: 1.22,
    barrelProfile: 'plain', // AWM(fluted)と対比=素直
  },
  // shinkirou-sniper / 蜃気楼(exotic=据え置き。painter無し)
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

// Phase C: 各 ModelKey の「非サイト外装」painter。ctx(bake系/chamferBox/PAL/寸法/buckets)だけで
// 固有外装を描く。サイト系ジオメトリ(スコープレンズ CircleGeometry/浮遊ドット/耳)は
// buildGunBody 本体が所有=painter からは触らない(契約テストが本体の順序に依存)。
// 全 geo は metalParts/polishParts/polyParts へ merge=+0 DC。
export const SNIPER_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  // ── SVD: 木サムホール・スケルトンストック + 左側面オフセットスコープマウント ──
  'dmr-svd': (ctx) => {
    const {
      boxP, bakeAt, tubeZ, chamferBox, C, metalParts, polishParts, polyParts,
      gauge, barR, barLen, recD, recHalf, barCenterZ, barFrontZ, BARREL_Y, r,
    } = ctx;
    const stockZ = recHalf;
    // 木製サムホール・スケルトンストック(上コム=頬当て/下スパー/前後ウェブで囲い中央を親指穴に)
    bakeAt(polyParts, chamferBox(0.044, 0.026, 0.19, 0.006), C.WOOD_HI, 0, 0.036, stockZ + 0.085); // 上コム(頬当て)
    bakeAt(polyParts, chamferBox(0.044, 0.03, 0.15, 0.006), C.WOOD, 0, -0.052, stockZ + 0.06); // 下スパー
    bakeAt(polyParts, chamferBox(0.04, 0.075, 0.028, 0.006), C.WOOD, 0, -0.006, stockZ + 0.005); // 前ウェブ(手首)
    bakeAt(polyParts, chamferBox(0.04, 0.10, 0.03, 0.006), C.WOOD, 0, 0.0, stockZ + 0.145); // 後ウェブ(親指後方)
    bakeAt(metalParts, chamferBox(0.05, 0.125, 0.026, 0.006), C.DARK, 0, -0.004, stockZ + 0.168); // 黒ラバー・バットプレート
    // ベンチレーテッド木製アッパーハンドガード(下部は本体 handguard:'wood')+通気スリット
    const hgZ = barCenterZ + barLen * 0.16;
    bakeAt(polyParts, chamferBox(gauge + 0.03, 0.026, barLen * 0.4, 0.005), C.WOOD, 0, BARREL_Y + gauge * 0.85, hgZ);
    for (let i = 0; i < 4; i += 1) {
      const zz = hgZ - barLen * 0.13 + i * (barLen * 0.086);
      boxP(metalParts, C.GROOVE, gauge + 0.018, 0.005, 0.01, 0, BARREL_Y + gauge * 0.85 + 0.014, zz, 0, 0, 0, 'flat');
    }
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        boxP(metalParts, C.GROOVE, 0.004, gauge * 0.7, 0.02,
          sx * (gauge * 0.5 + 0.016), BARREL_Y - 0.004, barCenterZ + barLen * 0.05 + (i - 1) * 0.03, 0, 0, 0, 'flat');
      }
    }
    // 左側面オフセット・サイドマウントスコープ基部(SVD特徴)。レンズ本体は buildGunBody が
    // 中央 s.y に描く=painter は「左から生えるマウント」でオフセット感を出す(scope.y 不変=ADS契約)。
    // R58 E2 nit: 左オフセット感をやや強調(基部外装のみ厚く/左へ張り出す。レンズ中央 s.y は不変=ADS契約)。
    const mz = -recD * 0.06;
    const mx = r.w / 2;
    boxP(metalParts, C.RAIL, 0.016, 0.034, recD * 0.54, -(mx + 0.012), 0.012, mz, 0, 0, 0, 'flat'); // ドブテイル・レール(厚く長く)
    for (let i = 0; i < 4; i += 1) {
      boxP(metalParts, C.GROOVE, 0.018, 0.004, 0.01, -(mx + 0.017), 0.012, mz - 0.06 + i * 0.04, 0, 0, 0, 'flat'); // レール刻み
    }
    bakeAt(metalParts, chamferBox(0.02, 0.072, 0.056, 0.004), C.DARK, -(mx + 0.008), 0.05, mz); // 縦アーム(太く高く=オフセット強調)
    boxP(metalParts, C.RIM, 0.016, 0.02, 0.03, -(mx + 0.006), 0.028, mz, 0, 0, 0, 'flat'); // 基部ナックル(左張り出し)
    boxP(metalParts, C.DARK, 0.04, 0.016, 0.042, -(mx - 0.014), 0.078, mz, 0, 0, 0, 'flat'); // 中央スコープへ寄る水平アーム
    boxP(polishParts, C.POLISH, 0.012, 0.026, 0.016, -(mx + 0.02), 0.032, mz, 0, 0, 0, 'flat'); // QDレバー(大)
    // 右チャージングハンドル(静的ノブ)
    boxP(polishParts, C.POLISH, 0.012, 0.012, 0.03, r.w / 2 + 0.012, 0.02, -recD * 0.06, 0, 0, 0, 'flat');
    // スリット・フラッシュハイダー(開口スロット筒)。R58 F2: マズルアタッチメント(サプ/コンペ)
    // 装着時は skip(generic-pass の銃口デバイスとハイダーの二重造形・串刺しを防ぐ)。
    if (!hasMuzzleAttachment(ctx)) {
      const fhZ = barFrontZ - 0.028;
      tubeZ(metalParts, C.DARK, barR + 0.007, 0.05, 0, BARREL_Y, fhZ, true);
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2;
        boxP(metalParts, C.GROOVE, 0.004, 0.004, 0.036,
          Math.cos(a) * (barR + 0.005), BARREL_Y + Math.sin(a) * (barR + 0.005), fhZ, 0, 0, 0, 'flat');
      }
    }
  },

  // ── WA2000: 低く長いスレンダーな一直線シルエット + 露出フルーテッド銃身 + 一体スコープ + 前方バイポッド ──
  // 頭でっかちの箱を廃し、低い前方フォアエンドの上に生きたフルーテッド銃身を露出させ、
  // 受け上に一体スコープを低いレール一枚で載せる。WA2000特有の「低・長・細」を側面/俯瞰の両方で立てる。
  'dmr-wa2000': (ctx) => {
    const {
      boxP, bakeAt, chamferBox, C, metalParts, polishParts, polyParts,
      gauge, barR, barLen, recD, recHalf, barCenterZ, BARREL_Y, r,
    } = ctx;
    // 低く長い前方フォアエンド(銃身の下半分だけを抱え、上半分の銃身を露出)。上端≒銃身中心=細身の一直線。
    const feZ = barCenterZ - barLen * 0.04;
    const feH = gauge * 1.5;
    const feY = BARREL_Y - gauge * 0.7; // 銃身より下へオフセット=上面に銃身を残す(上端≒銃身中心)
    const feBot = feY - feH * 0.5;
    bakeAt(metalParts, chamferBox(gauge * 2.0, feH, barLen * 0.94, 0.004), C.DARK, 0, feY, feZ);
    boxP(metalParts, C.RAIL, gauge * 1.4, 0.006, barLen * 0.86, 0, feBot, feZ, 0, 0, 0, 'flat'); // 底面レール(長い一直線で低長を締める)
    // ベンチレーテッド・ハンドガードの側面スロット(抜き)
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 5; i += 1) {
        const zz = feZ - barLen * 0.34 + i * (barLen * 0.16);
        boxP(metalParts, C.GROOVE, 0.004, feH * 0.5, 0.042, sx * gauge, feY, zz, 0, 0, 0, 'flat');
      }
    }
    // 露出フルーテッド銃身の上面フルート(上から見える縦溝 = WA2000決定的特徴)+ 稜のハイライト
    for (const dx of [-0.009, 0, 0.009] as const) {
      boxP(metalParts, C.GROOVE, 0.0032, 0.004, barLen * 0.72, dx, BARREL_Y + barR * 0.92, feZ, 0, 0, 0, 'flat');
    }
    boxP(polishParts, C.POLISH, 0.006, 0.004, barLen * 0.7, barR * 0.5, BARREL_Y + barR * 0.95, feZ, 0, 0, 0, 'flat');
    // 一体スコープの低い連続レール(受け天板に一枚。旧2支柱=第二リザー誤読を廃す)。レンズは本体が s.y=0.085 に描く。
    const brZ = -recD * 0.03;
    bakeAt(metalParts, chamferBox(0.03, 0.016, recD * 0.62, 0.003), C.RAIL, 0, r.h / 2 + 0.006, brZ);
    boxP(metalParts, C.RIM, 0.03, 0.004, recD * 0.58, 0, r.h / 2 + 0.015, brZ, 0, 0, 0, 'flat'); // レール上稜
    // 前方バイポッド(フォアエンド先端の下)
    const bpZ = feZ - barLen * 0.34;
    boxP(metalParts, C.DARK, 0.022, 0.02, 0.03, 0, feBot - 0.006, bpZ, 0, 0, 0, 'flat');
    for (const sx of [-1, 1] as const) {
      bakeAt(metalParts, chamferBox(0.008, 0.10, 0.01, 0.002), C.DARK, sx * 0.03, feBot - 0.06, bpZ, 0, 0, sx * 0.42);
      boxP(polishParts, C.POLISH, 0.014, 0.006, 0.014, sx * 0.052, feBot - 0.11, bpZ, 0, 0, 0, 'flat'); // 脚先
    }
    // ブルパップ後端: 一続きの低いウェッジ・ストック(締まった連続輪郭)。旧・分離した頬当て/肩当て箱を統合。
    const stZ = recHalf + 0.03;
    bakeAt(polyParts, chamferBox(0.05, 0.088, 0.20, 0.008), C.POLY, 0, 0.004, stZ); // 主ストック塊(低く一続き)
    boxP(polyParts, C.POLY, 0.042, 0.016, 0.15, 0, 0.05, stZ - 0.02, -0.05, 0, 0, 'gradY'); // 低い頬当てコム(わずかに前傾)
    bakeAt(metalParts, chamferBox(0.052, 0.092, 0.014, 0.004), C.DARK, 0, 0.004, stZ + 0.108); // バットプレート
    boxP(metalParts, C.RIM, 0.03, 0.026, 0.012, 0, -0.05, stZ + 0.09, 0, 0, 0, 'flat'); // 低い下端フック(締めた輪郭の底)
  },

  // ── AWM: 太角アルミシャーシ + 緑樹脂ストックシェル + 先端大型多ポートブレーキ + 前方バイポッド ──
  'sniper-awm': (ctx) => {
    const {
      boxP, bakeAt, tubeZ, chamferBox, C, metalParts, polishParts, polyParts,
      bs, gauge, barR, barLen, recD, recHalf, barCenterZ, barFrontZ, BARREL_Y, r,
    } = ctx;
    const stockZ = recHalf + 0.05 * bs;
    // 太く角ばったアルミシャーシ(受け下の箱型塊感)
    bakeAt(metalParts, chamferBox(r.w + 0.014, 0.03, recD * 0.5, 0.004), C.DARK, 0, -r.h / 2 - 0.006, -recD * 0.05);
    // グリーン樹脂ストックシェル(側面パネル/本体/チークピース/前ウェブ=サムホール)
    for (const sx of [-1, 1] as const) {
      boxP(polyParts, AWM_GREEN, 0.008, 0.085, 0.16, sx * 0.03, -0.008, stockZ + 0.02, 0, 0, 0, 'gradY');
    }
    bakeAt(polyParts, chamferBox(0.05, 0.055, 0.17, 0.006), AWM_GREEN, 0, -0.006, stockZ + 0.02);
    boxP(polyParts, AWM_GREEN_HI, 0.032, 0.022, 0.10, 0, 0.04, stockZ, 0, 0, 0, 'gradY'); // 調整式チークピース
    boxP(polyParts, AWM_GREEN, 0.03, 0.05, 0.026, 0, 0.006, stockZ - 0.03, 0, 0, 0, 'gradY'); // 前ウェブ(サムホール前縁)
    boxP(metalParts, C.DARK, 0.05, 0.10, 0.018, 0, -0.006, stockZ + 0.11, 0, 0, 0, 'flat'); // バットプレート
    // 幅広フラットボトム・グリーンフォアエンド
    const feZ = barCenterZ + barLen * 0.12;
    bakeAt(polyParts, chamferBox(gauge + 0.05, 0.03, barLen * 0.5, 0.005), AWM_GREEN, 0, BARREL_Y - gauge * 0.95, feZ);
    boxP(metalParts, C.RAIL, gauge + 0.03, 0.006, barLen * 0.44, 0, BARREL_Y - gauge * 1.7, feZ, 0, 0, 0, 'flat'); // 底面レール
    // 先端・大型多ポートマズルブレーキ。R58 F2: マズルアタッチメント(サプ/コンペ)装着時は skip
    // (サプ管に多ポートブレーキが串刺し浮遊するのを防ぐ)。
    if (!hasMuzzleAttachment(ctx)) {
      const mbZ = barFrontZ - 0.03;
      bakeAt(metalParts, chamferBox(gauge * 2.9, gauge * 2.6, 0.085, 0.004), C.DARK, 0, BARREL_Y, mbZ);
      for (let i = 0; i < 4; i += 1) {
        const zz = mbZ - 0.03 + i * 0.02;
        boxP(metalParts, C.GROOVE, gauge * 2.0, 0.006, 0.012, 0, BARREL_Y + gauge * 1.35, zz, 0, 0, 0, 'flat');
        boxP(metalParts, C.GROOVE, gauge * 2.0, 0.006, 0.012, 0, BARREL_Y - gauge * 1.35, zz, 0, 0, 0, 'flat');
      }
      for (const sx of [-1, 1] as const) {
        boxP(metalParts, C.GROOVE, 0.006, gauge * 1.6, 0.05, sx * gauge * 1.4, BARREL_Y, mbZ, 0, 0, 0, 'flat');
      }
      tubeZ(polishParts, C.POLISH_HI, barR * 1.05, 0.012, 0, BARREL_Y, mbZ - 0.05, false, 'edgeHi'); // クラウン
    }
    // 前方バイポッド(フォアエンド先端)
    const bpZ = feZ - barLen * 0.2;
    boxP(metalParts, C.DARK, 0.022, 0.02, 0.03, 0, BARREL_Y - gauge * 1.9, bpZ, 0, 0, 0, 'flat');
    for (const sx of [-1, 1] as const) {
      bakeAt(metalParts, chamferBox(0.008, 0.11, 0.01, 0.002), C.DARK, sx * 0.03, BARREL_Y - gauge * 1.9 - 0.055, bpZ, 0, 0, sx * 0.42);
    }
  },

  // ── TRG: 多軸調整バットプレート(直方体突起の集合)+ 角型ポリマーフォアエンド + 着脱バイポッド ──
  'sniper-trg': (ctx) => {
    const {
      boxP, bakeAt, tubeZ, chamferBox, C, metalParts, polishParts, polyParts,
      bs, gauge, barLen, recHalf, barCenterZ, BARREL_Y,
    } = ctx;
    const stockZ = recHalf + 0.05 * bs;
    // 角型ポリマーフォアエンド + 側面ファセット溝
    const feZ = barCenterZ + barLen * 0.14;
    bakeAt(polyParts, chamferBox(gauge + 0.04, 0.036, barLen * 0.5, 0.004), C.POLY, 0, BARREL_Y - gauge * 0.85, feZ);
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.GROOVE, 0.004, 0.02, barLen * 0.4, sx * (gauge * 0.5 + 0.026), BARREL_Y - gauge * 0.85, feZ, 0, 0, 0, 'flat');
    }
    // 着脱バイポッド(フォアエンド前端)
    const bpZ = feZ - barLen * 0.2;
    boxP(metalParts, C.DARK, 0.02, 0.018, 0.028, 0, BARREL_Y - gauge * 1.6, bpZ, 0, 0, 0, 'flat');
    for (const sx of [-1, 1] as const) {
      bakeAt(metalParts, chamferBox(0.007, 0.095, 0.009, 0.002), C.DARK, sx * 0.028, BARREL_Y - gauge * 1.6 - 0.05, bpZ, 0, 0, sx * 0.4);
    }
    // ── 多軸調整バットプレート(直方体突起の集合)= TRG最大の識別子(誇張版) ──
    // AWMの滑らかな樹脂シェルと明確に差別化するため、可調チーク/段積みスペーサー/貫通ロッド/
    // 鉤状トウを「分節した直方体の塊」として立てる。
    const bZ = stockZ + 0.055;
    // 可調式チークピース: 2本の縦ポストで持ち上げた直方体(浮遊=調整感を誇張)
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.RIM, 0.008, 0.05, 0.008, sx * 0.014, 0.03, bZ - 0.06, 0, 0, 0, 'flat'); // 縦調整ポスト(長く)
    }
    boxP(polyParts, C.POLY, 0.038, 0.026, 0.11, 0, 0.062, bZ - 0.05, 0, 0, 0, 'gradY'); // 持ち上がったチーク直方体
    // 長さ調整スペーサー・スタック(段積み直方体群)を明暗交互+段間スリットで分節明確化
    const stkZ = bZ + 0.05;
    for (let i = 0; i < 5; i += 1) {
      const yy = -0.05 + i * 0.028;
      boxP(metalParts, i % 2 === 0 ? C.RIM : C.POLISH, 0.052, 0.022, 0.028, 0, yy, stkZ, 0, 0, 0, 'flat'); // 段スペーサー
      boxP(metalParts, C.GROOVE, 0.054, 0.005, 0.03, 0, yy + 0.014, stkZ, 0, 0, 0, 'flat'); // 段間スリット(境界を彫る)
    }
    // 多軸調整ロッド(バットプレートを前後に貫く水平2本=可動の示唆)
    for (const sy of [-1, 1] as const) {
      tubeZ(polishParts, C.POLISH_HI, 0.006, 0.075, 0, sy * 0.042, stkZ + 0.012, true, 'flat');
    }
    // バットプレート面(縦長プレート)
    bakeAt(metalParts, chamferBox(0.05, 0.14, 0.02, 0.004), C.DARK, 0, 0.004, stkZ + 0.05);
    // 誇張フックド・トウ(下端が下へ長く垂れ、前へ鉤状に張り出すL字=標的銃の識別子)
    boxP(metalParts, C.RIM, 0.038, 0.05, 0.02, 0, -0.08, stkZ + 0.042, 0, 0, 0, 'flat'); // トウ縦(下へ垂れる)
    boxP(metalParts, C.RIM, 0.038, 0.022, 0.048, 0, -0.093, stkZ + 0.012, 0.18, 0, 0, 'flat'); // トウ前フック(前へ張り出す)
  },

  // ── SR-25: AR全体形状 + フラットトップ + 太いフリーフロートハンドガード + A2固定ストック ──
  'sniper-semi': (ctx) => {
    const {
      boxP, bakeAt, tubeZ, chamferBox, C, metalParts, polyParts,
      bs, gauge, barLen, recD, recHalf, barCenterZ, BARREL_Y, r,
    } = ctx;
    const stockZ = recHalf + 0.05 * bs;
    // 太いフリーフロート・ハンドガード(M-LOK丸筒。一回り大M4系DMRの識別子)
    const hgZ = barCenterZ + barLen * 0.06;
    tubeZ(metalParts, C.DARK, gauge + 0.016, barLen * 0.62, 0, BARREL_Y, hgZ, true);
    boxP(metalParts, C.RAIL, 0.03, 0.008, barLen * 0.58, 0, r.h / 2 + 0.006, hgZ, 0, 0, 0, 'flat'); // 上面連続レール(フラットトップ延長)
    for (let i = 0; i < 5; i += 1) {
      const zz = hgZ - barLen * 0.22 + i * (barLen * 0.11);
      for (const sx of [-1, 1] as const) {
        boxP(metalParts, C.GROOVE, 0.006, 0.018, 0.03, sx * (gauge + 0.012), BARREL_Y, zz, 0, 0, 0, 'flat'); // M-LOKスロット
      }
    }
    // AR固定ストック(M16A2型・スロープコム+バッファチューブ包含)
    bakeAt(polyParts, chamferBox(0.046, 0.10, 0.17, 0.008), C.POLY, 0, -0.004, stockZ + 0.02);
    boxP(polyParts, C.POLY, 0.04, 0.03, 0.10, 0, 0.03, stockZ - 0.01, -0.12, 0, 0, 'gradY'); // A2スロープコム(前傾ウェッジ)
    boxP(metalParts, C.DARK, 0.05, 0.105, 0.018, 0, -0.004, stockZ + 0.105, 0, 0, 0, 'flat'); // バットプレート
    boxP(metalParts, C.RIM, 0.012, 0.018, 0.01, 0, -0.055, stockZ + 0.06, 0, 0, 0, 'flat'); // 底面スイベル
    // フォワードアシスト(右)
    boxP(metalParts, C.DARK, 0.012, 0.016, 0.016, r.w / 2 + 0.006, 0.004, recD * 0.12, 0, 0, 0, 'flat');
    // 太い7.62給弾部リップ強調
    boxP(metalParts, C.RIM, 0.05, 0.012, 0.066, 0, -r.h / 2 - 0.004, -0.04, -0.15, 0, 0, 'flat');
  },
};
