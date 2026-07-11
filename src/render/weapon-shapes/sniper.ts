import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { ShapePainter } from './toolkit';

// AWM のオリーブ樹脂ストックシェル(頂点カラー・アセットレス。メタル/ポリの頂点色なので
// arm hex 制約=glass 材の話とは無関係)。寒色パレットの中で唯一の暖緑=一目で AWM と分かる。
const AWM_GREEN = 0x3a4726;
const AWM_GREEN_HI = 0x4a5a30;

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
    const mz = -recD * 0.06;
    boxP(metalParts, C.RAIL, 0.012, 0.03, recD * 0.5, -(r.w / 2 + 0.008), 0.012, mz, 0, 0, 0, 'flat'); // ドブテイル・レール
    for (let i = 0; i < 3; i += 1) {
      boxP(metalParts, C.GROOVE, 0.014, 0.004, 0.01, -(r.w / 2 + 0.012), 0.012, mz - 0.05 + i * 0.05, 0, 0, 0, 'flat');
    }
    bakeAt(metalParts, chamferBox(0.016, 0.06, 0.05, 0.004), C.DARK, -(r.w / 2 + 0.004), 0.045, mz); // 縦アーム
    boxP(metalParts, C.DARK, 0.035, 0.014, 0.04, -(r.w / 2 - 0.012), 0.07, mz, 0, 0, 0, 'flat'); // 中央スコープへ寄る水平アーム
    boxP(polishParts, C.POLISH, 0.01, 0.022, 0.014, -(r.w / 2 + 0.016), 0.03, mz, 0, 0, 0, 'flat'); // QDレバー
    // 右チャージングハンドル(静的ノブ)
    boxP(polishParts, C.POLISH, 0.012, 0.012, 0.03, r.w / 2 + 0.012, 0.02, -recD * 0.06, 0, 0, 0, 'flat');
    // スリット・フラッシュハイダー(開口スロット筒)
    const fhZ = barFrontZ - 0.028;
    tubeZ(metalParts, C.DARK, barR + 0.007, 0.05, 0, BARREL_Y, fhZ, true);
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      boxP(metalParts, C.GROOVE, 0.004, 0.004, 0.036,
        Math.cos(a) * (barR + 0.005), BARREL_Y + Math.sin(a) * (barR + 0.005), fhZ, 0, 0, 0, 'flat');
    }
  },

  // ── WA2000: ブルパップ + 前方巨大バレルシュラウド + 一体スコープブリッジ + 前方バイポッド ──
  'dmr-wa2000': (ctx) => {
    const {
      boxP, bakeAt, tubeZ, chamferBox, C, metalParts, polishParts, polyParts,
      gauge, barLen, recD, recHalf, barCenterZ, barFrontZ, BARREL_Y, r,
    } = ctx;
    // 前方の太く長大なバレルシュラウド(頭でっかち・質量前方)= WA2000決定的特徴
    const shroudZ = barCenterZ - barLen * 0.08;
    bakeAt(metalParts, chamferBox(gauge * 2.7, gauge * 2.5, barLen * 0.72, 0.006), C.DARK, 0, BARREL_Y, shroudZ);
    boxP(metalParts, C.RIM, 0.012, 0.008, barLen * 0.6, 0, BARREL_Y + gauge * 1.28, shroudZ, 0, 0, 0, 'flat'); // 上リブ
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 4; i += 1) {
        const zz = shroudZ - barLen * 0.26 + i * (barLen * 0.17);
        boxP(metalParts, C.GROOVE, 0.005, gauge * 1.6, 0.05, sx * gauge * 1.28, BARREL_Y, zz, 0, 0, 0, 'flat'); // 側面フルート溝
      }
    }
    tubeZ(metalParts, C.BARREL, gauge * 0.6, 0.05, 0, BARREL_Y, barFrontZ + 0.02, true); // 前端露出銃身
    // 一体スコープブリッジ(アイアン無し・レンズは本体が s.y に描く)
    const brZ = -recD * 0.05;
    boxP(metalParts, C.RAIL, 0.03, 0.016, recD * 0.66, 0, r.h / 2 + 0.012, brZ, 0, 0, 0, 'flat');
    for (const zz of [-recD * 0.22, recD * 0.18] as const) {
      boxP(metalParts, C.DARK, 0.026, 0.03, 0.024, 0, r.h / 2 + 0.03, zz, 0, 0, 0, 'flat'); // ブリッジ支柱
    }
    // 前方バイポッド
    const bpZ = shroudZ - barLen * 0.28;
    boxP(metalParts, C.DARK, 0.022, 0.02, 0.03, 0, BARREL_Y - gauge * 1.5, bpZ, 0, 0, 0, 'flat');
    for (const sx of [-1, 1] as const) {
      bakeAt(metalParts, chamferBox(0.008, 0.10, 0.01, 0.002), C.DARK, sx * 0.03, BARREL_Y - gauge * 1.5 - 0.05, bpZ, 0, 0, sx * 0.42);
      boxP(polishParts, C.POLISH, 0.014, 0.006, 0.014, sx * 0.052, BARREL_Y - gauge * 1.5 - 0.10, bpZ, 0, 0, 0, 'flat'); // 脚先
    }
    // ブルパップ頬当てコム + 角ばった肩当て(後端)
    boxP(polyParts, C.POLY, 0.042, 0.022, 0.13, 0, r.h / 2 + 0.006, recHalf - 0.03, 0, 0, 0, 'gradY'); // 頬当てコム
    bakeAt(polyParts, chamferBox(0.05, 0.115, 0.032, 0.006), C.POLY, 0, -0.008, recHalf + 0.03); // 角ばった肩当て
    boxP(metalParts, C.DARK, 0.052, 0.10, 0.016, 0, -0.008, recHalf + 0.052, 0, 0, 0, 'flat'); // バットプレート
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
    // 先端・大型多ポートマズルブレーキ
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
    // 多軸調整バットプレート(直方体突起の集合)= TRG決定的特徴
    const bZ = stockZ + 0.06;
    boxP(polyParts, C.POLY, 0.034, 0.024, 0.085, 0, 0.05, bZ - 0.05, 0, 0, 0, 'gradY'); // 調整式チークピース(縦ポストで持ち上がる直方体)
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.RIM, 0.006, 0.032, 0.006, sx * 0.012, 0.028, bZ - 0.06, 0, 0, 0, 'flat'); // 縦調整ポスト
    }
    for (let i = 0; i < 3; i += 1) {
      boxP(metalParts, C.RIM, 0.046, 0.016, 0.014, 0, -0.03 + i * 0.024, bZ + 0.04, 0, 0, 0, 'flat'); // スペーサー塊(突起の集合)
    }
    for (const sy of [-1, 1] as const) {
      tubeZ(polishParts, C.POLISH, 0.005, 0.05, 0, -0.01 + sy * 0.035, bZ + 0.05, true, 'flat'); // 水平調整ロッド
    }
    bakeAt(metalParts, chamferBox(0.05, 0.12, 0.02, 0.004), C.DARK, 0, -0.008, bZ + 0.085); // バットプレート本体
    boxP(metalParts, C.RIM, 0.03, 0.03, 0.016, 0, -0.06, bZ + 0.06, 0, 0, 0, 'flat'); // フックド・トウ(下端突起)
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
