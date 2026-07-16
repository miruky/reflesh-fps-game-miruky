// R53-W2: プロップ/床の材質質感GLSLキット(超リアル化 Layer B)。
//
// 現状(R52まで)は全プロップが roughness0.72/metalness0 均一で、鋼=木=石が同じ反射特性
// だった(match.ts の applyMacroProp は ±5% の汚れ変調のみで質感差を作らない)。本モジュールは
// 材質種別ごとに (a) roughness/metalness の基準値 (b) onBeforeCompile で挿すマクロ質感GLSL
// を切り替える「1シェーダ5バリアント」キットを提供する。実際にどのプロップへどのキットを
// 割り当てるかの配線(match.ts側)は本ラウンドの後続M2cが行う(このファイルは単体で完結)。
//
// ## 設計
// - 5キット共通の GLSL テンプレート1本を持ち、`#define SK_METAL` 等の切替でコンパイル時に
//   不要な分岐を消す(THREE.Material.customProgramCacheKey でキットごとにプログラムを分離)。
//   これは R25 のカモ材(render/viewmodel.ts の CamoStandardMaterial)や R20 の
//   applyMacroFloor/applyMacroProp(game/match.ts)と同じ流儀。
// - 変調は必ず乗算 0.85..1.05 域(白飛び安全)。各キットの色シフトは「特定色へ mix」ではなく
//   チャンネルごとの比率(例: 錆=赤UP/青DOWN)を 0.85..1.05 域に収めることで色味の変化を
//   表現しつつ、最後に元色に対する ±5%(暗側最大15%)の安全クランプを必ずかける二重防御。
// - emissive 追加なし。per-frame で更新する uniform も持たない(すべて静的 = ワールド座標
//   から決定論的に導出するfbmのみ。時刻uniformを足すとマテリアル間で不要な再bind/GCが
//   発生し、R9/R22 のオーディオ・PostFXパイプラインで踏んだのと同種の性能罠になる)。
// - 関数名は match.ts の MACRO_NOISE_GLSL(macroHash/macroVnoise/macroFbm)と衝突しない
//   よう `sk_` 接頭辞に統一。floorDetailGlsl() は applyMacroFloor の同一フラグメント
//   スコープへ文字列合成される前提のため、さらに独立した `fd_` 接頭辞の関数を持つ
//   (macroFbm 側やこのファイルの sk_* のどちらとも衝突しない完全自己完結)。
//
// ## M2c 配線メモ(プリウォーム注意 — R11 dissolve教訓)
// R11 でボット崩落ディゾルブ(game/bot.ts の applyDissolve)は #ifdef USE_DISSOLVE 切替の
// 別シェーダ変種を「初撃破の瞬間に初めてコンパイル」してしまい、キル演出中に可視のスタッター
// を起こした。対策は prewarmDissolve() で試合開始時に一時的に define を立てて
// renderer.compile() を通し、両変種を先にコンパイルしてから define を戻す、というもの。
// SurfaceKit も customProgramCacheKey がキットごとに異なる = 5本の独立シェーダプログラムで
// あり、同じ罠を踏みうる(あるステージで「稀にしか出ないキット」のプロップに最初に近づいた
// 瞬間だけ絵が止まる)。SURFACE_KIT_IDS を export しているのはこのため。buildStageScene 側は
// ステージに実際使うキットの有無に関わらず、5キット全てについて最低1メッシュ
// (何でもよい、使い捨てのユニットボックス等)を一時的にシーンへ追加した状態で
// renderer.compile(scene, camera) を呼び、その後シーンから外す(または実プロップ生成後に
// 呼ぶだけでもよい)ことで初回描画前に5プログラムすべてを暖機できる。

import * as THREE from 'three';

/** 材質キット種別。プロップ/床マテリアルに割り当てる質感プリセット。 */
export type SurfaceKitId = 'metal' | 'wood' | 'stone' | 'paint' | 'foliage';

/** 網羅リスト。M2c のプリウォーム(renderer.compile 5variant分)やテストの反復に使う。 */
export const SURFACE_KIT_IDS: readonly SurfaceKitId[] = [
  'metal',
  'wood',
  'stone',
  'paint',
  'foliage',
];

interface KitBase {
  roughness: number;
  metalness: number;
}

// 各キットの基準 roughness/metalness。プロップの用途本文で指定された値をそのまま採用。
const KIT_BASE: Record<SurfaceKitId, KitBase> = {
  metal: { roughness: 0.45, metalness: 0.6 },
  wood: { roughness: 0.7, metalness: 0.0 },
  stone: { roughness: 0.85, metalness: 0.0 },
  paint: { roughness: 0.6, metalness: 0.15 },
  foliage: { roughness: 0.9, metalness: 0.0 },
};

// #define 名(1シェーダ5バリアントの切替スイッチ)
const KIT_DEFINE: Record<SurfaceKitId, string> = {
  metal: 'SK_METAL',
  wood: 'SK_WOOD',
  stone: 'SK_STONE',
  paint: 'SK_PAINT',
  foliage: 'SK_FOLIAGE',
};

// R20 MACRO_NOISE_GLSL と同型の決定論的値ノイズ(3オクターブfbm)。関数名は sk_ 接頭辞で
// match.ts 側と衝突しない。追加DC/ジオメトリはゼロ、フラグメントALUのみ。
const SK_NOISE_GLSL = /* glsl */ `
  float sk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float sk_vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = sk_hash(i);
    float b = sk_hash(i + vec2(1.0, 0.0));
    float c = sk_hash(i + vec2(0.0, 1.0));
    float d = sk_hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float sk_fbm(vec2 p) {
    float s = 0.0;
    float amp = 0.5;
    float tot = 0.0;
    for (int oct = 0; oct < 3; oct++) {
      s += amp * sk_vnoise(p);
      tot += amp;
      p = p * 2.03 + 11.0;
      amp *= 0.5;
    }
    return s / tot;
  }
`;

// color_fragment 直後に挿す本体。5キット全ての分岐を1本のテンプレートに持ち、
// #define でコンパイル時に不要な分岐が消える(1シェーダ5バリアント)。
// 各キット固有の色シフトは skOrig(挿入前のdiffuseColor)に対する比率変調に留め、
// 最後に必ず skOrig*0.85..skOrig*1.05 域へクランプする(白飛び安全の絶対防衛線)。
const SK_COLOR_GLSL = /* glsl */ `
  {
    vec3 skOrig = diffuseColor.rgb;
    vec2 skXZ = vSkWorldPos.xz;
    float skY = vSkWorldPos.y;

    #ifdef SK_METAL
      // 錆: 大きめのfbmで斑を作り、閾値超で暖色寄り(赤UP/青DOWN)へ帯域内シフト
      // (0x6a3a22 系の錆色を「乗算比率」で近似)。同じ量を sk_rustAmt に保持し、
      // roughnessmap_fragment 側で錆部分だけラフネスを 0.9 へ寄せる。
      float skRustMask = sk_fbm(skXZ * 0.32 + 3.0);
      sk_rustAmt = smoothstep(0.56, 0.8, skRustMask);
      vec3 skRustTint = vec3(1.05, 0.90, 0.82);
      diffuseColor.rgb *= mix(vec3(1.0), skRustTint, sk_rustAmt);
    #endif

    #ifdef SK_WOOD
      // 木目: 一軸(ローカルZ相当のワールドZ)を強く引き伸ばしたfbmで年輪状の縞を作り、
      // ノイズ値0.5近傍だけを細い暗色ラインとして抜く。
      float skGrainN = sk_fbm(vec2(skXZ.x * 0.08, skXZ.y * 2.6) + 5.0);
      float skGrainLine = 1.0 - smoothstep(0.0, 0.05, abs(skGrainN - 0.5));
      diffuseColor.rgb *= mix(1.0, 0.87, skGrainLine);
    #endif

    #ifdef SK_STONE
      // 苔: worldY<0.6 の低所ほど緑寄りへ帯域内シフト(苔むしは地表付近に限定)。
      float skMossMask = sk_fbm(skXZ * 0.4 + 9.0);
      float skMossLow = 1.0 - smoothstep(-0.4, 0.6, skY);
      float skMossAmt = smoothstep(0.5, 0.75, skMossMask) * skMossLow;
      vec3 skMossTint = vec3(0.88, 1.05, 0.90);
      diffuseColor.rgb *= mix(vec3(1.0), skMossTint, skMossAmt);
    #endif

    #ifdef SK_PAINT
      // エッジ摩耗: 頂点color.aが「エッジ距離」(1=中央健全, 0=エッジ)として焼かれている
      // 前提を USE_COLOR_ALPHA で検出して使う。焼き込みが無いジオメトリでは無効化し、
      // fbmベースの欠け表現(斑状の摩耗)へフォールバックすることで単体でも成立させる。
      float skWearFbm = sk_fbm(skXZ * 0.55 + 13.0);
      #ifdef USE_COLOR_ALPHA
        float skWear = (1.0 - clamp(vColor.a, 0.0, 1.0)) * smoothstep(0.35, 0.75, skWearFbm);
      #else
        float skWear = smoothstep(0.62, 0.84, skWearFbm);
      #endif
      vec3 skWearTint = vec3(1.05, 1.03, 0.97);
      diffuseColor.rgb *= mix(vec3(1.0), skWearTint, skWear);
    #endif

    #ifdef SK_FOLIAGE
      // 彩度ジッタのみ: 色相/明度は変えず、局所的に彩度を ±15% 程度揺らす。
      float skLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      float skJit = sk_fbm(skXZ * 0.7 + 21.0) - 0.5;
      diffuseColor.rgb = mix(vec3(skLum), diffuseColor.rgb, 1.0 + skJit * 0.3);
    #endif

    // 全キット共通: 雨だれ縦筋。列位置(XZ)はY非依存のfbm(3オクターブ)で決め、流れの
    // 途切れは軽量な単オクターブ値ノイズ(sk_vnoise)で足す(ALU節約: フル3オクターブを
    // 2回重ねない)。地面に近いほど(skYGrad)濃く、上方ほど乾いて薄い。
    float skStreakCol = sk_fbm(skXZ * 2.6 + 31.0);
    float skStreakFlow = sk_vnoise(vec2(skXZ.x * 0.5, skY * 0.6) + 41.0);
    float skYGrad = 1.0 - smoothstep(-0.4, 2.6, skY);
    float skStreak = smoothstep(0.58, 0.8, skStreakCol) * smoothstep(0.4, 0.85, skStreakFlow) * skYGrad;
    diffuseColor.rgb *= mix(1.0, 0.9, skStreak);

    // 白飛び安全弁(絶対): 上記すべての変調を合成した結果を、挿入前の色に対する
    // ±5%(暗側最大15%)域へ強制クランプする。
    diffuseColor.rgb = clamp(diffuseColor.rgb, skOrig * 0.85, skOrig * 1.05);
  }
`;

// roughnessmap_fragment 直後に挿す本体。錆部分だけラフネスを0.9へ寄せる(metal限定)。
const SK_ROUGHNESS_GLSL = /* glsl */ `
  #ifdef SK_METAL
    roughnessFactor = mix(roughnessFactor, 0.9, sk_rustAmt);
  #endif
  #ifdef SK_WOOD
    roughnessFactor = clamp(roughnessFactor + (sk_fbm(vSkWorldPos.xz * 3.4) - 0.5) * 0.16, 0.46, 0.92);
  #endif
  #ifdef SK_STONE
    roughnessFactor = clamp(roughnessFactor + (sk_fbm(vSkWorldPos.xz * 7.0) - 0.5) * 0.12, 0.72, 1.0);
  #endif
  #ifdef SK_PAINT
    roughnessFactor = clamp(roughnessFactor + (sk_fbm(vSkWorldPos.xz * 10.0) - 0.5) * 0.1, 0.38, 0.82);
  #endif
`;

// テクスチャを追加せず、微細な凹凸法線を画面空間微分から復元する。
// normal mapと同じ段階(normal_fragment_maps後)へ適用するため、照明・IBL・SSAOのすべてが
// 凹凸を正しく拾う。強度は材質ごとに抑え、遠距離のモアレや鏡面ちらつきを避ける。
const SK_NORMAL_COMMON_GLSL = /* glsl */ `
  vec3 sk_perturbNormal(vec3 surfPos, vec3 surfNormal, float height, float strength) {
    vec3 sigmaX = dFdx(surfPos);
    vec3 sigmaY = dFdy(surfPos);
    vec3 r1 = cross(sigmaY, surfNormal);
    vec3 r2 = cross(surfNormal, sigmaX);
    float det = dot(sigmaX, r1);
    vec2 grad = vec2(dFdx(height), dFdy(height));
    return normalize(abs(det) * surfNormal - sign(det) * (grad.x * r1 + grad.y * r2) * strength);
  }
`;

const SK_NORMAL_GLSL = /* glsl */ `
  {
    float skHeight = 0.5;
    float skNormalStrength = 0.0;
    #ifdef SK_METAL
      skHeight = sk_fbm(vSkWorldPos.xz * 18.0 + 71.0);
      skNormalStrength = 0.055;
    #endif
    #ifdef SK_WOOD
      float skWoodBase = sk_fbm(vec2(vSkWorldPos.x * 0.55, vSkWorldPos.z * 18.0) + 19.0);
      skHeight = skWoodBase * 0.72 + sk_fbm(vSkWorldPos.xz * 5.0) * 0.28;
      skNormalStrength = 0.085;
    #endif
    #ifdef SK_STONE
      skHeight = sk_fbm(vSkWorldPos.xz * 9.0 + 43.0);
      skNormalStrength = 0.15;
    #endif
    #ifdef SK_PAINT
      skHeight = sk_fbm(vSkWorldPos.xz * 22.0 + 17.0);
      skNormalStrength = 0.045;
    #endif
    #ifdef SK_FOLIAGE
      skHeight = sk_fbm(vSkWorldPos.xz * 14.0 + 29.0);
      skNormalStrength = 0.035;
    #endif
    normal = sk_perturbNormal(vSkWorldPos, normal, skHeight, skNormalStrength);
  }
`;

/**
 * MeshStandardMaterial へ材質キットを適用する。
 * - roughness/metalness の基準値をキットごとに上書き(JSプロパティ、テクスチャ非依存)。
 * - onBeforeCompile でマクロ質感GLSLを挿す(頂点でワールド座標を拾い、フラグメントで
 *   diffuseColor/roughnessFactor を静的fbmベースで変調)。
 * - customProgramCacheKey にキット名を含め、5キットが互いのプログラムを共有しないよう
 *   分離する(R20 applyMacroFloor と同じ流儀)。
 *
 * 副作用は mat のみ。color/vertexColors/emissive など他のプロパティは呼び出し側が
 * 決める(このキットは質感=roughness系のみを担当する)。
 */
export function applySurfaceKit(mat: THREE.MeshStandardMaterial, kit: SurfaceKitId): void {
  const base = KIT_BASE[kit];
  mat.roughness = base.roughness;
  mat.metalness = base.metalness;

  const defineName = KIT_DEFINE[kit];
  mat.customProgramCacheKey = () => `hibana-surfacekit-${kit}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkWorldPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n#define ${defineName}\nvarying vec3 vSkWorldPos;\nfloat sk_rustAmt = 0.0;\n${SK_NOISE_GLSL}\n${SK_NORMAL_COMMON_GLSL}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SK_COLOR_GLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${SK_ROUGHNESS_GLSL}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${SK_NORMAL_GLSL}`,
      );
  };
}

// ── 床v2用の追加GLSL断片(floorDetailGlsl) ──────────────────────────────────
//
// game/match.ts の applyMacroFloor(private, 変更禁止・読み取りのみ)へ M2c が文字列合成する
// 前提の断片。applyMacroFloor は `#include <color_fragment>` 挿入点で既に
// `vWorldXZ`(vec2, ワールドXZ)と `macroFbm`(match.ts の MACRO_NOISE_GLSL)を定義済みなので、
// この断片はその両方が同一フラグメントスコープに既に存在することを前提として `vWorldXZ` を
// 直接参照する。ただし内部ヘルパー関数は macroFbm/macroHash/macroVnoise とも
// このファイルの sk_* とも衝突しない `fd_` 接頭辞で完全に独立させてあるため、
// どちらの命名空間とも安全に共存する。
//
// 合成箇所の目安(match.ts:2210-2217, applyMacroFloor 内の既存 macroWear ブロック直後):
//   .replace(
//     '#include <color_fragment>',
//     `#include <color_fragment>
//     { ...既存の macroWear ブロック... }
//     ${floorDetailGlsl()}`,
//   )
//
// 効果は 亀裂(2重fbmのabs折り返し) / オイル染み(3x3セルラー暗斑) / タイヤ痕(一軸に
// 引き伸ばしたfbmの周期帯) の3種を合成した diffuseColor 乗算変調。輝度規律は
// 既存 applyMacroFloor と同域の 0.90..1.045 に収める。
// ★V-W2W3レビューC(CRITICAL)修正: GLSL ES 3.00 は main() 内の関数定義(ネスト関数)を
// 許可しない。fd_* ヘルパは必ずグローバルスコープ(#include <common> 挿入点)へ入れること。
// 消費側(match.ts applyMacroFloor)は floorDetailGlslCommon() を common 側へ、
// floorDetailGlsl() を color_fragment 側へ、対で挿入する。
export function floorDetailGlslCommon(): string {
  return /* glsl */ `
  float fd_hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 24634.6345123); }
  float fd_vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fd_hash(i);
    float b = fd_hash(i + vec2(1.0, 0.0));
    float c = fd_hash(i + vec2(0.0, 1.0));
    float d = fd_hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fd_fbm(vec2 p) {
    float s = 0.0;
    float amp = 0.5;
    float tot = 0.0;
    for (int oct = 0; oct < 3; oct++) {
      s += amp * fd_vnoise(p);
      tot += amp;
      p = p * 2.11 + 7.0;
      amp *= 0.5;
    }
    return s / tot;
  }
  `;
}

export function floorDetailGlsl(): string {
  return /* glsl */ `
  {
    // 亀裂: 2重fbmのabs折り返し。差分が0近傍になる細い帯だけを割れ目として抜く。
    float fdCrackA = fd_fbm(vWorldXZ * 0.9);
    float fdCrackB = fd_fbm(vWorldXZ * 0.9 + 4.7);
    float fdCrack = abs(fdCrackA - fdCrackB);
    float fdCrackLine = 1.0 - smoothstep(0.0, 0.035, fdCrack);

    // オイル染み: 3x3セルラー(Worley風)最短距離。距離が近いほど暗い染みの中心。
    vec2 fdCellP = vWorldXZ * 0.22;
    vec2 fdCellI = floor(fdCellP);
    vec2 fdCellF = fract(fdCellP);
    float fdCellMinD = 1.0;
    for (int fy = -1; fy <= 1; fy++) {
      for (int fx = -1; fx <= 1; fx++) {
        vec2 fdNb = vec2(float(fx), float(fy));
        vec2 fdPt = fdNb + vec2(fd_hash(fdCellI + fdNb), fd_hash(fdCellI + fdNb + 17.0)) - fdCellF;
        fdCellMinD = min(fdCellMinD, dot(fdPt, fdPt));
      }
    }
    float fdOil = 1.0 - smoothstep(0.02, 0.09, fdCellMinD);

    // タイヤ痕: 一軸(Z)に強く引き伸ばしたfbmの周期帯。fractで等間隔の2本筋を作り、
    // 別fbmで濃淡・途切れを与える。
    float fdTireX = fract(vWorldXZ.x * 0.24 + 0.5) - 0.5;
    float fdTireMask = 1.0 - smoothstep(0.03, 0.09, abs(fdTireX));
    float fdTireFlow = fd_fbm(vec2(vWorldXZ.x * 0.5, vWorldXZ.y * 3.4) + 51.0);
    float fdTire = fdTireMask * smoothstep(0.3, 0.72, fdTireFlow);

    float fdMask = clamp(fdCrackLine * 0.55 + fdOil * 0.5 + fdTire * 0.45, 0.0, 1.0);
    diffuseColor.rgb *= clamp(mix(1.045, 0.90, fdMask), 0.90, 1.045);
  }
  `;
}
