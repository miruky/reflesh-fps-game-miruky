import * as THREE from 'three';
import type { ModelKey } from '../../game/weapons';
import type { Silhouette } from './types';
import type { PainterCtx, ShapePainter } from './toolkit';

// ── LMG系 シルエット(R58 Phase C: 実在銃へ再モデリング) ─────────────────────────
// gun ローカル座標: -Z=前方(銃口)/ +Z=後方(射手)/ BARREL_Y=0.012=銃身中心高さ。
// weapon-preview は PROFILE_YAW=-π/2 の横シルエット(銃口=画面右)で表示するので、
// 各挺は「側面プロファイルで実銃と判る」ことを最優先に造形する。
// ★サイト系(浮遊マイクロドット y=IRON_POST_Y=0.075 @z=0.14 / 前照星の耳)は buildGunBody 本体が
//   描き、resolveSightY 契約はここでは一切動かさない(carryHandle/ironSight を立てない)。painter は
//   非サイト外装のみを足し、サイト射線(y=0.075 を -Z へ)を塞がない高さ/位置に収める。
//
// - lmg-m249  (kumagera / M251←M249 SAW): 上部ベルト給弾カバー + 円筒パンチングバレルジャケット +
//                                          一体キャリングハンドル(=装飾。サイトは持ち上げない) +
//                                          左側面弾薬箱ポーチ + ヘビーバレル + 固定ストック + バイポッド。
// - lmg-rpk   (tsuchigumo / RPK-14←RPK-16): 長銃身 + AK湾曲マグ + 角型ポリマーハンドガード +
//                                            側面折りたたみ骨組みストック(ヒンジ) + AKダストカバー/リベット +
//                                            ガスブロック + 着脱バイポッド。
// - lmg-drum  (raitei / DP-29←DP-27/28): 唯一無二の「上部円盤(レコード盤)パンマグ 47発」(水平・vm:magazine
//                                         可動) + 木製ストック/グリップ + 通気孔金属バレルジャケット +
//                                         マズル付近固定バイポッド + 頭でっかちシルエット。
export const LMG_SHAPES = {
  // 汎用ベルトLMG(型網羅の filler。実武器の resolveModelKey はこのキーへ落ちない)。
  'lmg-belt': {
    receiver: { w: 0.075, h: 0.095, d: 0.34 },
    barrelGauge: 0.036,
    barrelLen: 0.24,
    feed: 'belt',
    handguard: 'shroud',
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'flash',
    accentBand: 'receiver',
    bodyScale: 1.15,
  },
  // raitei-lmg / DP-29(←DP-27/28)。shape='lmg-drum' 直参照(modelKey 無し)。
  // 上部円盤パンマグ(topMag:'pan' → resolveDetail が railTop='none' 強制)+ 木製家具 + 通気孔ジャケット。
  'lmg-drum': {
    receiver: { w: 0.084, h: 0.1, d: 0.34 },
    barrelGauge: 0.032,
    barrelLen: 0.34,
    feed: 'none', // ボトム弾倉なし。唯一の給弾は上部パンマグ(painter が vm:magazine を描く)。
    handguard: 'none', // 通気孔金属バレルジャケットは painter が描く。
    stock: 'wood',
    scope: null,
    boltHandle: false,
    muzzle: 'none',
    accentBand: 'receiver',
    bodyScale: 1.12,
    topMag: 'pan',
    furniture: 'wood',
    gripStyle: 'wood', // 木床一体グリップ(AR装甲リブ/マグウェルを抑止=WWII 清潔シルエット)。
    barrelProfile: 'plain',
  },
  // kumagera-lmg / M251(←M249 SAW)。modelKey='lmg-m249'。
  'lmg-m249': {
    receiver: { w: 0.076, h: 0.095, d: 0.34 },
    barrelGauge: 0.038,
    barrelLen: 0.28,
    feed: 'belt', // ベルト給弾(基礎パスがボトム弾薬箱+真鍮リンクを描く)。
    handguard: 'none', // 円筒パンチングバレルジャケットは painter が描く。
    stock: 'fixed',
    scope: null,
    boltHandle: false,
    muzzle: 'flash', // コーン型フラッシュハイダー。
    accentBand: 'receiver',
    bodyScale: 1.15,
    barrelProfile: 'heavy',
    heatShield: true, // マーカ(実ジオメトリは painter)。
    beltBox: true, // マーカ(左側面弾薬箱ポーチは painter)。
  },
  // tsuchigumo-lmg / RPK-14(←RPK-16)。modelKey='lmg-rpk'。
  'lmg-rpk': {
    receiver: { w: 0.074, h: 0.093, d: 0.34 },
    barrelGauge: 0.03,
    barrelLen: 0.34, // 長い銃身(550mm 相当)。
    feed: 'mag-curved', // AK湾曲ボックスマグ(基礎パスが vm:magazine を描く)。
    handguard: 'none', // 角型ポリマーハンドガードは painter(前方に長銃身を露出させる)。
    stock: 'skeleton', // 側面折りたたみ骨組み(基礎スケルトン+painter でヒンジ)。
    scope: null,
    boltHandle: false,
    muzzle: 'flash', // AK-12系 多孔フラッシュハイダー。
    accentBand: 'receiver',
    bodyScale: 1.15,
    barrelProfile: 'heavy',
  },
} satisfies Partial<Record<ModelKey, Silhouette>>;

// ── painter 共有ヘルパ ─────────────────────────────────────────
// バイポッド(前方下・V字2脚+接地フット)。全て metalParts へ merge=+0DC。
function bipod(ctx: PainterCtx, mountZ: number, legLen: number): void {
  const { C, barR, BARREL_Y, boxP, metalParts } = ctx;
  const y0 = BARREL_Y - barR - 0.006;
  boxP(metalParts, C.DARK, 0.024, 0.02, 0.026, 0, y0 + 0.008, mountZ, 0, 0, 0, 'flat'); // マウント基部
  for (const sx of [-1, 1] as const) {
    const splay = 0.34;
    boxP(metalParts, C.DARK, 0.006, legLen, 0.006, sx * 0.02, y0 - legLen / 2, mountZ - 0.006, 0.16, 0, sx * splay, 'flat');
    const footX = sx * (0.02 + Math.sin(splay) * legLen);
    boxP(metalParts, C.RIM, 0.006, 0.006, 0.032, footX, y0 - legLen * 0.98, mountZ - 0.02, 0, 0, 0, 'flat'); // 接地フット
  }
}

// ── painter レジストリ ─────────────────────────────────────────
export const LMG_PAINTERS: Partial<Record<ModelKey, ShapePainter>> = {
  // ═══ M249 SAW ═══ 上部ベルトカバー + 円筒パンチングジャケット + 弾薬箱 + キャリングハンドル + バイポッド。
  'lmg-m249': (ctx) => {
    const { C, r, recD, barR, barLen, barCenterZ, barFrontZ, BARREL_Y, boxP, tubeZ, bakeAt, chamferBox, metalParts, polyParts, polishParts, accentFam, def } = ctx;

    // 上部ベルト給弾カバー(ヒンジ付き): レシーバ天面を厚くする箱型デッキ。天面レール直下=射線(y=0.075)を
    // 塞がない高さ(top≒0.068)に収め、後方の照星ドット(z=0.14)へ掛からないよう z を前方側に置く。
    const coverZ = -recD * 0.05;
    const coverLen = recD * 0.52;
    const coverTop = r.h / 2 + 0.02;
    bakeAt(metalParts, chamferBox(r.w * 0.96, 0.03, coverLen, 0.005), C.DARK, 0, r.h / 2 + 0.006, coverZ, 0, 0, 0, 'machined');
    // 前方の傾斜フィードランプ(ベルトが左から入る口)。
    boxP(metalParts, C.RIM, r.w * 0.7, 0.008, 0.04, 0, coverTop - 0.004, coverZ - coverLen * 0.42, -0.35, 0, 0, 'flat');
    // 右側面(=カメラ側)ヒンジ軸 + 後方ラッチ。
    boxP(polishParts, C.POLISH, 0.006, 0.008, coverLen * 0.9, r.w * 0.5, r.h / 2 + 0.012, coverZ, 0, 0, 0, 'flat');
    boxP(metalParts, C.RIM, r.w * 0.6, 0.008, 0.014, 0, coverTop, coverZ + coverLen * 0.44, 0, 0, 0, 'flat');
    // 一体キャリングハンドル(装飾: サイトは持ち上げない=carryHandle 未設定)。カバー前方に低い握り橋。
    const chZ = coverZ - coverLen * 0.12;
    for (const sx of [-1, 1] as const) {
      boxP(metalParts, C.DARK, 0.008, 0.028, 0.01, sx * 0.018, coverTop + 0.012, chZ, 0, 0, 0, 'flat');
    }
    boxP(metalParts, C.RIM, 0.012, 0.009, 0.07, 0, coverTop + 0.026, chZ, 0, 0, 0, 'flat');

    // 円筒パンチングホール・バレルジャケット(heatShield): 前部バレルを覆う有孔金属筒。
    const jz = barCenterZ - barLen * 0.02;
    const jLen = barLen * 0.62;
    const jr = barR + 0.012;
    tubeZ(metalParts, C.DARK, jr, jLen, 0, BARREL_Y, jz, true);
    const holeN = 7;
    for (let i = 0; i < holeN; i += 1) {
      const zz = jz - jLen * 0.42 + (i * (jLen * 0.84)) / (holeN - 1);
      // 上下エッジのパンチ穴列(横プロファイルで有孔が読める)。
      boxP(metalParts, C.GROOVE, 0.008, 0.008, 0.008, 0, BARREL_Y + jr, zz, 0, 0, 0, 'flat');
      boxP(metalParts, C.GROOVE, 0.008, 0.008, 0.008, 0, BARREL_Y - jr, zz, 0, 0, 0, 'flat');
      // 側面(カメラ側)の穴。
      boxP(metalParts, C.GROOVE, 0.006, 0.008, 0.008, jr * 0.86, BARREL_Y + jr * 0.5, zz, 0, 0, 0, 'flat');
    }

    // 左側面弾薬箱ポーチ(beltBox): レシーバ左下に吊るす角箱(給弾ベルト源)。
    bakeAt(polyParts, chamferBox(0.058, 0.088, 0.11, 0.006), C.POLY, -r.w * 0.55, -r.h / 2 - 0.05, -0.01);
    boxP(accentFam, def.tracerColor, 0.05, 0.004, 0.05, -r.w * 0.55, -r.h / 2 - 0.004, -0.01, 0, 0, 0, 'flat');
    // ベルト源から給弾口へ立ち上がる真鍮リンク(数枚)。
    for (let i = 0; i < 3; i += 1) {
      boxP(polishParts, C.BRASS, 0.01, 0.014, 0.01, -r.w * 0.4 + i * 0.01, -r.h / 2 - 0.01 + i * 0.012, -0.03, 0, 0, 0.25, 'flat');
    }

    // バイポッド(バレル前方下)。
    bipod(ctx, barFrontZ + barLen * 0.16, 0.1);
  },

  // ═══ RPK-16 ═══ 長銃身 + 角型ポリマーハンドガード + 折りたたみ骨組みストック + AKレシーバ + バイポッド。
  'lmg-rpk': (ctx) => {
    const { C, r, recD, recHalf, gauge, barLen, barCenterZ, barFrontZ, BARREL_Y, bs, boxP, bakeAt, chamferBox, metalParts, polyParts, polishParts } = ctx;
    const stockZ = recHalf + 0.05 * bs;

    // AK系プレスレシーバ: 天面ダストカバー稜 + 右側面リベット列。
    boxP(metalParts, C.RIM, r.w * 0.58, 0.006, recD * 0.68, 0, r.h / 2 + 0.006, -recD * 0.04, 0, 0, 0, 'flat');
    for (let i = 0; i < 4; i += 1) {
      boxP(polishParts, C.POLISH_HI, 0.005, 0.005, 0.005, r.w / 2 + 0.002, -0.012, -recD * 0.22 + i * 0.06, 0, 0, 0, 'flat');
    }
    // AK チャージングハンドル(右側面ノブ・レシプロ)。
    boxP(polishParts, C.POLISH, 0.022, 0.01, 0.012, r.w * 0.44, 0.012, recHalf * 0.24, 0, 0, 0, 'flat');

    // 角型ポリマーハンドガード(バレル後部を覆う。前方に長銃身を露出)。
    bakeAt(polyParts, chamferBox(gauge + 0.028, gauge + 0.026, barLen * 0.42, 0.005), C.POLY, 0, BARREL_Y, barCenterZ + barLen * 0.1);
    for (let i = 0; i < 3; i += 1) {
      boxP(polyParts, C.GROOVE, gauge + 0.032, 0.004, 0.01, 0, BARREL_Y + gauge * 0.55, barCenterZ + barLen * 0.1 + (i - 1) * 0.05, 0, 0, 0, 'flat');
    }
    // ガスブロック + 前方サイトタワー基部(AK の識別子。前照星の耳の直後)。
    boxP(metalParts, C.DARK, gauge + 0.01, gauge + 0.02, 0.03, 0, BARREL_Y + 0.006, barCenterZ - barLen * 0.28, 0, 0, 0, 'flat');

    // 側面折りたたみ骨組みストック: 基礎スケルトン(buildGunBody)へヒンジ + 補強チューブを足す。
    // ヒンジ軸(レシーバ後端左=折りたたみ支点)。
    bakeAt(metalParts, new THREE.CylinderGeometry(0.013, 0.013, 0.03, 12), C.POLISH, -r.w * 0.34, 0, recHalf + 0.006, 0, 0, Math.PI / 2, 'flat');
    // スケルトン骨(斜めステー)で「骨組み」を強調。
    boxP(metalParts, C.DARK, 0.006, 0.006, 0.12, 0, -0.01, stockZ + 0.05, 0.5, 0, 0, 'flat');

    // バイポッド(着脱式・バレル前方下)。
    bipod(ctx, barFrontZ + barLen * 0.12, 0.1);
  },

  // ═══ DP-27/28 ═══ 上部円盤(レコード盤)パンマグ + 木製家具 + 通気孔金属ジャケット + 固定バイポッド。
  'lmg-drum': (ctx) => {
    const { C, r, recHalf, barR, barLen, barCenterZ, barFrontZ, BARREL_Y, bs, gauge, boxP, tubeZ, bakeAt, chamferBox, newMovable, metalParts, polyParts } = ctx;
    const stockZ = recHalf + 0.05 * bs;

    // 木製ストック(furniture:'wood')。stock='wood' は本体 no-op なので painter が固定木床を描く。
    bakeAt(polyParts, chamferBox(0.05, 0.08, 0.16, 0.008), C.WOOD, 0, -0.024, stockZ + 0.055);
    boxP(polyParts, C.WOOD_HI, 0.03, 0.006, 0.11, 0, 0.02, stockZ + 0.045, 0, 0, 0, 'flat');
    // 木製フォアエンド(バレル後部下の握り。ジャケットより細い木握り)。
    bakeAt(polyParts, chamferBox(gauge + 0.02, 0.05, barLen * 0.24, 0.006), C.WOOD, 0, BARREL_Y - barR - 0.01, barCenterZ + barLen * 0.28);

    // 通気孔金属バレルジャケット(heatShield): 前部バレルを長く覆う有孔筒(DP-28 の頭でっかちの前部)。
    const jz = barCenterZ - barLen * 0.02;
    const jLen = barLen * 0.72;
    const jr = barR + 0.011;
    tubeZ(metalParts, C.DARK, jr, jLen, 0, BARREL_Y, jz, true);
    const vN = 8;
    for (let i = 0; i < vN; i += 1) {
      const zz = jz - jLen * 0.42 + (i * (jLen * 0.84)) / (vN - 1);
      boxP(metalParts, C.GROOVE, 0.008, 0.008, 0.008, 0, BARREL_Y + jr, zz, 0, 0, 0, 'flat');
      boxP(metalParts, C.GROOVE, 0.008, 0.008, 0.008, 0, BARREL_Y - jr, zz, 0, 0, 0, 'flat');
      boxP(metalParts, C.GROOVE, 0.006, 0.008, 0.008, jr * 0.86, BARREL_Y + jr * 0.5, zz, 0, 0, 0, 'flat');
    }

    // マズル付近固定バイポッド。
    bipod(ctx, barFrontZ + barLen * 0.08, 0.11);

    // ── 上部円盤(レコード盤)パンマグ 47発 = 唯一無二(水平・vm:magazine 可動) ──
    // ARCH 指定: 天面 Cylinder(r0.09, 厚0.018)水平 @y = r.h/2 + 0.05。前後サイト(耳 z=-recD-0.006 /
    // 照星ドット z=0.14, y=0.075)と非干渉になる z を選ぶ(パン底 y=0.091 > 射線 0.075 で ADS 射線も通る)。
    const panR = 0.09;
    const panT = 0.018;
    const panY = r.h / 2 + 0.05;
    const panZ = -0.03;
    // 中央ハブ(静的: レシーバ天面 → パン底を繋ぐ支柱。マグ着脱でも残る=可動側に入れない)。
    const hubTop = panY - panT / 2;
    bakeAt(metalParts, new THREE.CylinderGeometry(0.02, 0.024, hubTop - r.h / 2 + 0.004, 16), C.DARK, 0, (r.h / 2 + hubTop) / 2, panZ);
    // パン本体(可動・ポリ暗色)。
    const mv = newMovable('vm:magazine');
    bakeAt(mv.poly, new THREE.CylinderGeometry(panR, panR, panT, 28), C.POLY, 0, panY, panZ);
    // 上面プレート + 同心リング(レコード盤: 回転で円盤と判る)。
    bakeAt(mv.metal, new THREE.CylinderGeometry(panR * 0.99, panR * 0.99, 0.004, 28), C.RIM, 0, panY + panT / 2 + 0.002, panZ, 0, 0, 0, 'flat');
    for (const rr of [0.032, 0.052, 0.072] as const) {
      bakeAt(mv.metal, new THREE.TorusGeometry(rr, 0.0025, 6, 24), C.GROOVE, 0, panY + panT / 2 + 0.004, panZ, Math.PI / 2, 0, 0, 'flat');
    }
    // 中央ハブキャップ(研磨=素のまま/カモ非対象)。
    bakeAt(mv.polish, new THREE.CylinderGeometry(0.015, 0.015, panT + 0.012, 12), C.POLISH, 0, panY, panZ);
  },
};
