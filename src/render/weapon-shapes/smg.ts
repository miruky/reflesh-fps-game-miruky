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
  // hayabusa-smg / TMP-2(Steyr TMP): 上下ポリマー一体成形の角ばった樹脂胴(painter)拳銃的・
  // ストック無 + グリップ内直マグ + 短銃身レシーバ内収 + 長めバレルシュラウド。
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
    // R58 E2: 発光帯を非発光化(metalParts へ)。短い樹脂胴の後方へ約4cm貫通・露出した
    // ピンク発光旗を抑止(TMPは発光を増やさず抑える方針)。加えて painter が樹脂胴を後方へ
    // 延ばし帯を内包=露出そのものを根絶する(二重の保険)。
    accentEmissive: false,
    bodyScale: 0.9,
    feedZ: 0.1, // グリップ内直マグ
    magInGrip: true,
    receiverStyle: 'tube', // 角箱レシーバを抑止→painter が角ポリマー塊
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
    muzzleExtend: 0.05, // F4: 一体サプ前端まで muzzleZ を前進(実測≈4-5cm 埋没)
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
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, recD, gauge, BARREL_Y, barCenterZ, barLen, recHalf } = ctx;
    // 細い鋼管レシーバ(円筒アッパー)。バレル射線に同軸。前面 z≈-recHalf*0.9(≈-0.117)。
    tubeZ(metalParts, C.BASE, r.h * 0.44, recD * 0.9, 0, BARREL_Y + 0.008, 0, true, 'machined');
    // R58 E2: 連結バレルスリーブ(太く明るい削り出し鋼)。レシーバ前面〜ハンドガード後端の
    // 細暗バレル区間を太い明るい筒で覆い、side profile で連結を消さない(浮遊ブロック根治の芯)。
    const recFront = -recHalf * 0.9;
    tubeZ(metalParts, C.RIM, gauge * 0.5 + 0.012, (recFront - barCenterZ) + barLen * 0.1, 0, BARREL_Y, (recFront + barCenterZ) / 2 - barLen * 0.05, true, 'machined');
    // 穴あき鋼板ハンドガード。R58 E2: 後方へ延ばし後端をレシーバ前面へ接続(hgBack≈-0.115=
    // レシーバ前面 -0.117 と重畳)+ 明るい C.BASE で「連結した鋼の塊」として読ませる。
    const hgLen = barLen * 1.36;
    const hgBack = recFront + 0.002;
    const hgZ = hgBack - hgLen / 2;
    bakeAt(metalParts, chamferBox(gauge + 0.022, gauge + 0.02, hgLen, 0.004), C.BASE, 0, BARREL_Y, hgZ, 0, 0, 0, 'gradY');
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          boxP(
            metalParts, C.GROOVE, 0.004, 0.008, 0.008,
            sx * (gauge * 0.5 + 0.015), BARREL_Y + (j ? 0.008 : -0.008), hgZ + (i - 1.5) * 0.028, 0, 0, 0, 'flat',
          );
        }
      }
    }
    // グリップセーフティ(グリップ背面の可動タブ様。ポリマー)
    boxP(polyParts, C.GRIP, 0.012, 0.05, 0.018, 0, -0.09, 0.128, 0.2, 0, 0, 'gradY');
    // サイド折りたたみワイヤーストック(後方展開で読ませる)
    paintWireStock(ctx, 0.12);
  },

  // TMP: 上下ポリマー一体成形の角ばった樹脂胴(拳銃的・ストック無)+ 長めバレルシュラウド +
  // 前方垂直グリップ。receiverStyle:'tube'で本体角箱は抑止済み。
  // R58 E2: (1)胴を小ベベルの角ポリマー塊にして「じゃがいも卵」感を解消し TMP 識別性を上げる、
  // (2)胴を後方へ延ばして receiver 発光帯(非発光化済み・z≈0.03〜0.13)を内包し後方貫通露出を根絶、
  // (3)シュラウドを長く角ばらせバレルシュラウド寄りに。サイト(耳/浮遊ドット)は本体所有=不干渉。
  'smg-tmp': (ctx) => {
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, recD, gauge, BARREL_Y, barCenterZ, barFrontZ } = ctx;
    // 角ポリマー胴。幅 r.w+0.02(半 0.043)で発光帯(半 0.0345)を余裕を持って包み、depth を
    // recD*1.4 に延ばし center を +0.026 後退させ後端 z≈0.152 で帯後端(z≈0.13)をベベル外で内包
    // (不透明ポリマーが帯を全周遮蔽=+X面貫通/後方露出ともゼロ)。小ベベル 0.014 で角い樹脂塊に。
    bakeAt(polyParts, chamferBox(r.w + 0.02, r.h + 0.006, recD * 1.4, 0.014), C.POLY, 0, 0.004, 0.026, 0, 0, 0, 'gradY');
    // 上面の角い機械リブ(非発光アクセント。ポリマー一体成形の稜線)
    boxP(metalParts, C.DARK, 0.028, 0.008, recD * 0.72, 0, r.h / 2 + 0.002, 0.01, 0, 0, 0, 'flat');
    // 長めの角バレルシュラウド(前方ハンドガード=TMP の決定的前部)。角ばらせて樹脂胴と連続。
    // center を barCenterZ+0.025 へ後退させ後端(z≈-0.09)を胴前面(z≈-0.10)へ重ね、分断ギャップを消す。
    bakeAt(polyParts, chamferBox(0.05, 0.052, 0.13, 0.012), C.POLY, 0, BARREL_Y + 0.004, barCenterZ + 0.025, 0, 0, 0, 'gradY');
    // シュラウド側面の放熱スリット(角い機械ディテール・両側3列)
    for (let i = 0; i < 3; i += 1) {
      const zz = barCenterZ - 0.01 + i * 0.026;
      for (const sx of [-1, 1] as const) {
        boxP(metalParts, C.GROOVE, 0.004, 0.022, 0.01, sx * 0.026, BARREL_Y + 0.004, zz, 0, 0, 0, 'flat');
      }
    }
    // 短銃身の突出チップ + 暗マズルキャップ(シュラウド前端から僅かに出る=短銃身レシーバ内収)
    tubeZ(metalParts, C.BARREL, gauge * 0.5 + 0.004, 0.05, 0, BARREL_Y, barFrontZ - 0.004, true, 'gradY');
    tubeZ(metalParts, C.DARK, gauge * 0.5 + 0.008, 0.014, 0, BARREL_Y, barFrontZ - 0.026, true, 'gradY');
    // 前方垂直グリップ(TMP 特有のハンドストップ)
    bakeAt(polyParts, chamferBox(0.03, 0.06, 0.03, 0.006), C.POLY, 0, -0.052, barCenterZ + 0.02, 0.1, 0, 0, 'gradY');
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

  // APS(機関拳銃): 中空ホルスターストック(Mauser C96 風)+ リアサイト偏心回転ドラム +
  // 露出ハンマー。角スライド / グリップ内複列マグは本体が描く(フォアグリップ無)。
  // R58 E2: 旧「幅広の平板スラブ」を全面刷新 — 幅を絞り縦長化し、下後方へ傾いだ薄壁フレームで
  // 開口面をカメラ側(+X=PROFILE_YAW視点)へ向け、内部を暗く落として「中空ホルスター」を露出。
  // 後端は大ベベルの丸いバットプレート + 前下フックで C96 の湾曲 butt を読ませる。
  'machine-pistol': (ctx) => {
    const { tubeZ, boxP, bakeAt, chamferBox, metalParts, polyParts, C, r, recHalf } = ctx;
    // ホルスターは下後方へ傾ぐ。ローカル(ly=上, lz=後)→ gun ローカル [y, z] へ回転写像。
    const a = 0.26;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const PY = -0.015;
    const PZ = 0.095;
    const hy = (ly: number, lz: number): number => PY + ly * ca - lz * sa;
    const hz = (ly: number, lz: number): number => PZ + ly * sa + lz * ca;
    // ホルスターローカル空間で薄壁ボックスを焼く(全て樹脂/ベークライト=polyParts へ merge)
    const hbox = (color: number, wX: number, hYl: number, dZl: number, ly: number, lz: number, xOff: number): void =>
      boxP(polyParts, color, wX, hYl, dZl, xOff, hy(ly, lz), hz(ly, lz), a, 0, 0, 'gradY');
    // グリップ後方の首(レシーバ後端へ連結=浮かせない)
    boxP(polyParts, C.GRIP, 0.034, 0.05, 0.07, 0, -0.005, 0.09, 0, 0, 0, 'gradY');
    // 薄い背板(中空の底=暗く落として奥行きを出す=カメラ側からの中空露出)
    hbox(C.GROOVE, 0.006, 0.135, 0.17, -0.0175, 0.085, -0.011);
    // リムフレーム4辺(カメラ側へ立てる薄壁=中空トレイの縁)
    hbox(C.GRIP, 0.024, 0.014, 0.17, 0.05, 0.085, 0.001); // 天リム
    hbox(C.GRIP, 0.024, 0.014, 0.17, -0.085, 0.085, 0.001); // 底リム
    hbox(C.GRIP, 0.024, 0.135, 0.014, -0.0175, 0.006, 0.001); // 前リム
    hbox(C.GRIP, 0.024, 0.135, 0.016, -0.0175, 0.164, 0.001); // 後リム(butt 基部)
    // 丸いバットプレート(大ベベル=C96 の湾曲した尻)
    bakeAt(polyParts, chamferBox(0.026, 0.16, 0.024, 0.024), C.GRIP, 0.001, hy(-0.006, 0.178), hz(-0.006, 0.178), a, 0, 0, 'gradY');
    // C96 の湾曲 butt-hook: 底後端から前下へ弧を描く2節トゥ(角度を段階的に立て湾曲を読ませる)
    for (let i = 0; i < 3; i += 1) {
      const t = i / 2;
      const ang = a + 0.35 + t * 0.55;
      const lly = -0.09 - t * 0.016;
      const llz = 0.158 - t * 0.032;
      boxP(polyParts, C.GRIP, 0.024, 0.034, 0.02, 0.001, hy(lly, llz), hz(lly, llz), ang, 0, 0, 'gradY');
    }
    // リアサイト偏心回転ドラム(スライド後端上・短横シリンダ。※照準ドットではない cosmetic)
    tubeZ(metalParts, C.POLISH, 0.011, 0.02, 0, r.h / 2 + 0.008, recHalf * 0.62, true, 'flat');
    // 露出ハンマー(後端の小突起)
    boxP(metalParts, C.DARK, 0.008, 0.016, 0.01, 0, r.h / 2 + 0.006, recHalf + 0.008, 0, 0, 0, 'flat');
  },
};
