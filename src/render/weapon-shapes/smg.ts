import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { PainterCtx, ShapePainter } from './toolkit';

// ── SMG/PDW/機関拳銃系 シルエット ─────────────────────────────────────────
// R58 Phase C: shape共有解消を実在武器へ。汎用エントリ(smg/pdw/machine-pistol)+ 固有 ModelKey。
// 固有キーは buildGunBody の共有スイッチ(receiver/barrel/handguard/feed/stock/muzzle)を
// Silhouette で操舵し、決定的な固有外装だけを SMG_PAINTERS が足す(サイト系は本体所有=不干渉)。
//
// サイト不変契約: どの武器も carryHandle / ironSight:'bead' / scope を立てないので
// resolveSightY = IRON_POST_Y(0.075) のまま=ADS収束Yは据置(単ドット/二重無し)。
// painter は SphereGeometry/PlaneGeometry/CircleGeometry を一切作らない(照準ドット汚染ゼロ)。
export const SMG_SHAPES = {
  // 汎用SMG(shipping武器はいずれも固有 modelKey へ解決するため、これは classDefault('smg')
  // フォールバック=ALL_SHAPES ビルドテスト専用。逐語のまま据置=視覚不変)。
  smg: {
    receiver: { w: 0.07, h: 0.088, d: 0.3 },
    barrelGauge: 0.03,
    barrelLen: 0.18,
    feed: 'mag-straight',
    handguard: 'slim',
    stock: 'folding',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
  },
  // enaga-pdw / MP8A1(HK MP7): AR系を縮小した超コンパクトなレールPF + skeleton伸縮ストック +
  // レール前端の折りたたみ垂直フォアグリップ(painter)+ 細4.6mmストレートマグ(グリップ内)。
  pdw: {
    receiver: { w: 0.062, h: 0.082, d: 0.24 },
    barrelGauge: 0.024,
    barrelLen: 0.14,
    feed: 'mag-straight',
    handguard: 'rail', // 四方レール角箱ハンドガード(本体 rail 枝)
    stock: 'skeleton', // 伸縮スケルトンストック(本体 skeleton 枝)
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'handguard',
    bodyScale: 0.85,
    feedZ: 0.1, // 弾倉はグリップ内(MP7)
    magInGrip: true,
    foldingForegrip: true, // 折りたたみ垂直フォアグリップ(painter)
    foregripStyle: 'vertical-fixed',
  },
  // kogarashi / APS-74(Stechkin APS): 中空ホルスターストックが本体後方へ(painter)+
  // リアサイト偏心回転ドラム(painter)+ フォアグリップ無 + マカロフ系角スライド(本体 slide)+
  // グリップ内複列20発。
  'machine-pistol': {
    receiver: { w: 0.062, h: 0.088, d: 0.2 },
    barrelGauge: 0.026,
    barrelLen: 0.1,
    feed: 'mag-straight',
    handguard: 'none',
    stock: 'none',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'slide',
    bodyScale: 0.8,
    feedZ: 0.1, // 複列マグはグリップ内(APS)
    magInGrip: true,
    foregripStyle: 'none', // フォアグリップ無=93R との決定差
  },
  // ── R58 Phase C 固有キー ──
  // tsubaki-smg / PM14(Beretta PM12): 穴あき鋼板ハンドガード(painter)+ サイド折りたたみ
  // ワイヤーストック(painter)+ 細い鋼管状レシーバ(receiverStyle:'tube')+ 直箱マグ(グリップ前方独立)。
  'smg-pm12': {
    receiver: { w: 0.06, h: 0.078, d: 0.26 },
    barrelGauge: 0.026,
    barrelLen: 0.11,
    feed: 'mag-straight', // 直箱マグ、feedZ 既定 -0.02=グリップ前方独立
    handguard: 'none', // 穴あき鋼板ハンドガードは painter
    stock: 'wire', // ワイヤーストック(本体 no-op → painter)
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
    receiverStyle: 'tube', // 鋼管状レシーバ(本体角箱を抑止→painter が円筒)
  },
  // hayabusa-smg / TMP-2(Steyr TMP): 上下ポリマー一体成形の丸い卵型レシーバ(painter)拳銃的・
  // ストック無 + グリップ内直マグ + 短銃身レシーバ内収。
  'smg-tmp': {
    receiver: { w: 0.066, h: 0.092, d: 0.2 },
    barrelGauge: 0.026,
    barrelLen: 0.08,
    feed: 'mag-straight',
    handguard: 'none',
    stock: 'none', // ストック無
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 0.9,
    feedZ: 0.1, // グリップ内直マグ
    magInGrip: true,
    receiverStyle: 'tube', // 角箱レシーバを抑止→painter が卵型ポリマー塊
  },
  // sasameki-smg / MP6SD(HK MP5SD): 銃身〜マズルまで一定太さの寸胴円筒(一体型サプレッサ=painter,
  // パンチ穴列)+ 湾曲9mmマグ + 固定ストック + アイアン(フードフロント+ドラムリアは本体アイアン)。
  'smg-mp5sd': {
    receiver: { w: 0.066, h: 0.086, d: 0.3 },
    barrelGauge: 0.03,
    barrelLen: 0.18,
    feed: 'mag-curved', // MP5 湾曲9mmマグ
    handguard: 'none', // 一体サプが銃身前部を覆う=slim溝は出さない
    stock: 'fixed', // 固定ストック(MP5 A2)
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
    integralSuppressor: true, // 寸胴一体サプは painter が描く(muzzle アタッチと排他扱い)
  },
  // mozu-smg / UZI-10(IWI Uzi): グリップ自体がマガジンウェルを兼ねる角型太グリップ(feedZ=グリップ内
  // + painter で肥厚)+ 箱型プレス鋼レシーバ上面トンネル(painter)+ 上面ノブコッキング(painter)+
  // ワイヤー折りたたみストック(painter)+ 短露出銃身。
  'smg-uzi': {
    receiver: { w: 0.072, h: 0.09, d: 0.26 },
    barrelGauge: 0.026,
    barrelLen: 0.09, // 短露出銃身
    feed: 'mag-straight',
    handguard: 'none',
    stock: 'wire', // ワイヤー折りたたみ(本体 no-op → painter)
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.0,
    feedZ: 0.1, // グリップ=マガジンウェル
    magInGrip: true,
    chargingHandle: 'top', // 上面ノブ(本体スイッチは top を no-op 化→painter)
  },
} satisfies Partial<Record<ModelKey, Silhouette>>;

// ── 共有 painter ヘルパ(全て非サイト外装。metal/poly バケツへ merge=+0DC・camo追従は正しい) ──

// ワイヤー折りたたみストック: 細枠2本 + 天面コネクタ + 縦バット板(PM12/Uzi)。
// 本体 stock:'wire' 枝は no-op なのでここが唯一の描画。metalParts へ merge。
function paintWireStock(ctx: PainterCtx, len: number): void {
  const { boxP, metalParts, C, recHalf } = ctx;
  const z0 = recHalf + 0.01;
  for (const sx of [-1, 1] as const) {
    boxP(metalParts, C.DARK, 0.006, 0.006, len, sx * 0.028, -0.006, z0 + len / 2, 0, 0, 0, 'flat');
  }
  // 天面コネクタ(左右枠を後端で繋ぐ)+ 縦バット板
  boxP(metalParts, C.DARK, 0.062, 0.006, 0.008, 0, -0.006, z0 + len, 0, 0, 0, 'flat');
  boxP(metalParts, C.RIM, 0.056, 0.052, 0.008, 0, -0.006, z0 + len + 0.006, 0, 0, 0, 'flat');
}

// ── SMG_PAINTERS: 各 ModelKey の固有外装 ──────────────────────────────────
export const SMG_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  // MP5SD: 寸胴一体サプレッサ。銃身〜マズルまで一定太さの太い有孔円筒(決定的特徴)。
  'smg-mp5sd': (ctx) => {
    const { tubeZ, boxP, metalParts, polishParts, C, BARREL_Y, barR, barFrontZ, recHalf } = ctx;
    const suppR = barR + 0.026; // 太い寸胴(barR 0.015→0.041)
    const front = barFrontZ - 0.05; // マズルを僅かに越えて前進
    const back = -recHalf + 0.02; // レシーバ前面から前方一体
    const len = back - front;
    const midZ = (back + front) / 2;
    // 寸胴サプレッサ本体(一定太さ)
    tubeZ(metalParts, C.BARREL, suppR, len, 0, BARREL_Y, midZ, true, 'gradY');
    // 前端キャップ + 研磨クラウン(edgeHi で銃口を縁取る)
    tubeZ(metalParts, C.DARK, suppR + 0.002, 0.02, 0, BARREL_Y, front + 0.006, true, 'gradY');
    tubeZ(polishParts, C.POLISH_HI, suppR * 0.5, 0.01, 0, BARREL_Y, front - 0.004, false, 'edgeHi');
    // パンチ穴列(前半に4リング×6穴。小さな暗インセット=merge・+0DC)
    for (let ring = 0; ring < 4; ring += 1) {
      const zz = front + 0.03 + ring * 0.035;
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2 + 0.4; // 底面(真下)は避ける向きへ回す
        boxP(
          metalParts, C.GROOVE, 0.006, 0.006, 0.006,
          Math.cos(a) * suppR, BARREL_Y + Math.sin(a) * suppR, zz, 0, 0, 0, 'flat',
        );
      }
    }
    // HK 特有の前方コッキングチューブ(上面左を前方へ走る細管)
    boxP(metalParts, C.DARK, 0.008, 0.012, 0.16, -0.028, BARREL_Y + 0.032, -0.2, 0, 0, 0, 'flat');
  },

  // Uzi: 箱型レシーバ上面トンネル(丸リブ)+ 上面コッキングノブ + グリップ=マグウェル肥厚 +
  // ワイヤー折りたたみストック + 短銃身の銃口ナット。
  'smg-uzi': (ctx) => {
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polishParts, polyParts, C, r, recD, BARREL_Y, barR, barFrontZ } = ctx;
    // 上面トンネル(受け皿状の丸リブ。ボルト/コッキング路)。machined 削り出し感。
    tubeZ(metalParts, C.BASE, 0.016, recD * 0.86, 0, r.h / 2 - 0.002, 0, true, 'machined');
    // 上面コッキングノブ(前方寄り。ベース + 研磨ノブ)
    boxP(metalParts, C.POLISH, 0.02, 0.012, 0.028, 0, r.h / 2 + 0.008, -0.05, 0, 0, 0, 'flat');
    boxP(polishParts, C.POLISH_HI, 0.016, 0.016, 0.016, 0, r.h / 2 + 0.02, -0.05, 0, 0, 0, 'flat');
    // グリップ=マガジンウェル(角型太グリップの肥厚シェル。マグ feedZ=0.10 がここへ収まる)
    bakeAt(polyParts, chamferBox(0.062, 0.1, 0.072, 0.006), C.GRIP, 0, -0.06, 0.1, 0, 0, 0, 'gradY');
    // 短露出銃身の銃口ナット
    tubeZ(metalParts, C.DARK, barR + 0.006, 0.02, 0, BARREL_Y, barFrontZ + 0.008, true, 'gradY');
    // ワイヤー折りたたみストック(後方展開)
    paintWireStock(ctx, 0.13);
  },

  // PM12: 鋼管状レシーバ(receiverStyle:'tube'で本体角箱を抑止→円筒)+ 穴あき鋼板ハンドガード +
  // サイド折りたたみワイヤーストック + グリップセーフティ。
  'smg-pm12': (ctx) => {
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, recD, gauge, BARREL_Y, barCenterZ, barLen } = ctx;
    // 細い鋼管レシーバ(円筒アッパー)。バレル射線に同軸。
    tubeZ(metalParts, C.BASE, r.h * 0.44, recD * 0.9, 0, BARREL_Y + 0.008, 0, true, 'machined');
    // 穴あき鋼板ハンドガード(前部シェル + パンチング穴グリッド)
    const hgZ = barCenterZ + barLen * 0.1;
    bakeAt(metalParts, chamferBox(gauge + 0.02, gauge + 0.018, barLen * 0.68, 0.003), C.DARK, 0, BARREL_Y, hgZ, 0, 0, 0, 'gradY');
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          boxP(
            metalParts, C.GROOVE, 0.004, 0.008, 0.008,
            sx * (gauge * 0.5 + 0.014), BARREL_Y + (j ? 0.008 : -0.008), hgZ + (i - 1) * 0.022, 0, 0, 0, 'flat',
          );
        }
      }
    }
    // グリップセーフティ(グリップ背面の可動タブ様。ポリマー)
    boxP(polyParts, C.GRIP, 0.012, 0.05, 0.018, 0, -0.09, 0.128, 0.2, 0, 0, 'gradY');
    // サイド折りたたみワイヤーストック(後方展開で読ませる)
    paintWireStock(ctx, 0.12);
  },

  // TMP: 上下ポリマー一体成形の丸い卵型レシーバ(拳銃的・ストック無)+ 前方垂直グリップ +
  // 短銃身の突出。receiverStyle:'tube'で本体角箱は抑止済み。
  'smg-tmp': (ctx) => {
    const { tubeZ, bakeAt, chamferBox, metalParts, polyParts, C, r, recD, gauge, BARREL_Y, barCenterZ, barFrontZ } = ctx;
    // 卵型ポリマー塊(大ベベルで丸める=上下一体成形の胴)
    bakeAt(polyParts, chamferBox(r.w + 0.006, r.h + 0.004, recD * 1.06, 0.03), C.POLY, 0, 0.004, -0.008, 0, 0, 0, 'gradY');
    // 前方の丸い銃身シュラウド膨らみ(卵の鼻先)
    bakeAt(polyParts, chamferBox(0.05, 0.05, 0.11, 0.022), C.POLY, 0, BARREL_Y + 0.008, barCenterZ + 0.03, 0, 0, 0, 'gradY');
    // 短銃身の突出チップ(レシーバ内収=僅かに出る)
    tubeZ(metalParts, C.BARREL, gauge * 0.5 + 0.003, 0.05, 0, BARREL_Y, barFrontZ + 0.012, true, 'gradY');
    // 前方垂直グリップ(TMP 特有のハンドストップ)
    bakeAt(polyParts, chamferBox(0.03, 0.058, 0.03, 0.006), C.POLY, 0, -0.05, barCenterZ + 0.02, 0.12, 0, 0, 'gradY');
  },

  // MP7(PDW): 折りたたみ垂直フォアグリップ(レール前端)+ 上面コッキングノブ + 銃口ナット。
  // レール角箱ハンドガード / full天面レール / skeletonストック / グリップ内マグは本体が描く。
  pdw: (ctx) => {
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, BARREL_Y, barR, barCenterZ, barFrontZ, recHalf } = ctx;
    // 折りたたみ垂直フォアグリップ(レール前端下・僅かに前傾=折りたたみ機構)
    bakeAt(polyParts, chamferBox(0.028, 0.055, 0.028, 0.005), C.POLY, 0, BARREL_Y - 0.042, barCenterZ - 0.028, 0.32, 0, 0, 'gradY');
    // 上面の非往復コッキングノブ(ミニARらしさ)
    boxP(metalParts, C.POLISH, 0.014, 0.01, 0.02, 0, r.h / 2 + 0.012, recHalf * 0.5, 0, 0, 0, 'flat');
    // 細銃身の銃口ナット
    tubeZ(metalParts, C.DARK, barR + 0.004, 0.016, 0, BARREL_Y, barFrontZ + 0.006, true, 'gradY');
  },

  // APS(機関拳銃): 中空ホルスターストックが本体後方へ(決定的特徴)+ リアサイト偏心回転ドラム +
  // 露出ハンマー。角スライド / グリップ内複列マグは本体が描く(フォアグリップ無)。
  'machine-pistol': (ctx) => {
    const { tubeZ, boxP, metalParts, polyParts, C, r, recHalf } = ctx;
    // 中空ホルスターストック(グリップ後方の角い箱枠=4壁で「中空」を表現・下へ傾ぐ)
    const cz = recHalf + 0.16; // グリップ(z=0.1)後方
    const top = 0.02;
    const bot = -0.1;
    const hy = (top + bot) / 2;
    const hh = top - bot;
    boxP(polyParts, C.GRIP, 0.05, 0.008, 0.2, 0, top, cz, 0, 0, 0, 'gradY'); // 天板
    boxP(polyParts, C.GRIP, 0.05, 0.008, 0.2, 0, bot, cz, 0, 0, 0, 'gradY'); // 底板
    for (const sx of [-1, 1] as const) {
      boxP(polyParts, C.GRIP, 0.008, hh, 0.2, sx * 0.021, hy, cz, 0, 0, 0, 'gradY'); // 側板
    }
    boxP(polyParts, C.DARK, 0.05, hh, 0.008, 0, hy, cz + 0.1, 0, 0, 0, 'gradY'); // バット板(後端)
    // リアサイト偏心回転ドラム(スライド後端上・短横シリンダ。※照準ドットではない cosmetic)
    tubeZ(metalParts, C.POLISH, 0.011, 0.02, 0, r.h / 2 + 0.008, recHalf * 0.62, true, 'flat');
    // 露出ハンマー(後端の小突起)
    boxP(metalParts, C.DARK, 0.008, 0.016, 0.01, 0, r.h / 2 + 0.006, recHalf + 0.008, 0, 0, 0, 'flat');
  },
};
