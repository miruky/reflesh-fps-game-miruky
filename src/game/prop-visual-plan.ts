// プロップ超リアル化v2の配線ロジック(R54-W1 F1でmatch.tsから分割抽出。移動のみ・挙動不変)。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rand } from '../core/rng';
import type { GraphicsQuality } from '../core/settings';
import { buildPropVisual, PROP_VISUAL_KINDS, type PropMatFamily } from '../render/prop-visuals';
import { applySurfaceKit, SURFACE_KIT_IDS } from '../render/surface-kit';
import { buildProp, type BoxSpec, type PropPlacement, type StagePalette } from './stage';

// ── R53-W2 M2c: プロップ超リアル化v2の配線ロジック(純関数群・テスト可能) ──────────
//
// buildStageScene() は stage.ts の layout.propPlacements(kind/cx/cz/rotRad/scaleJitter)を
// render/prop-visuals.buildPropVisual() へ渡して実物寄りジオメトリを得るが、layout.boxes
// (buildProp()由来のBoxSpec)は「どのpropPlacementに属するか」を示すidを持たない。
// そこで、buildProp()がrand非使用の純関数である性質を利用し、propPlacementsを辿りながら
// 同じ(kind,cx,cz,rot)でbuildProp()を再呼び出しして得られる箱「個数」だけ、boxesの中の
// prop:trueな箱列(生成順=propPlacementsの生成順と厳密に一致。stage.tsのgenerateThemeObjects
// はbox列とplacements列を同一ループ内で常に同時にpushするため)から連続して切り出す
// 2ポインタ走査でbox↔placementの対応を復元する。stage.tsは変更しない(消費のみ)。

/**
 * propPlacements と実際に生成された boxes を突き合わせ、
 * (a) v2ビジュアル(buildPropVisual)を適用するインスタンス一覧
 * (b) 旧箱ビジュアル(マージ/個別/shadowCaster全経路)の描画をスキップすべき BoxSpec の集合
 * を決定する。コライダー/tags/breakable/minimapの生成には一切関与しない(視覚生成の
 * 分岐にのみ使う値を返すだけの純関数)。
 *
 * 除外基準:
 * - kind が PROP_VISUAL_KINDS に含まれない(未実装kind) → v2対象外。
 * - インスタンスを構成する箱のうち1つでも breakable が付与されている → v2対象外
 *   (破壊時にそのメッシュだけを個別除去する必要があるため、現行の個別メッシュ経路の
 *   ままにする。判断済み — このインスタンスは丸ごと旧経路で描画される)。
 */
export function planPropVisualsV2(
  placements: readonly PropPlacement[],
  boxes: readonly BoxSpec[],
  palette: StagePalette,
): { v2Placements: PropPlacement[]; skipBoxes: Set<BoxSpec> } {
  const propBoxesInOrder = boxes.filter((b) => b.prop === true);
  let cursor = 0;
  const v2Placements: PropPlacement[] = [];
  const skipBoxes = new Set<BoxSpec>();
  for (const placement of placements) {
    // rotRad は quantSteps*(π/2) ± 0.45rad のジッタ済み値(stage.ts jitterRotRad)。
    // ジッタ振幅(最大0.45rad)は90°の半分(0.785rad)未満なので四捨五入で必ず元のquantStepsへ戻る。
    const rotSteps = Math.round(placement.rotRad / (Math.PI / 2)) & 3;
    const regenerated = buildProp(placement.kind, placement.cx, placement.cz, rotSteps, () => 0, palette);
    const group = propBoxesInOrder.slice(cursor, cursor + regenerated.length);
    cursor += regenerated.length;
    const kindSupported = PROP_VISUAL_KINDS.includes(placement.kind);
    const hasBreakable = group.some((b) => b.breakable !== undefined);
    if (kindSupported && !hasBreakable) {
      v2Placements.push(placement);
      for (const b of group) skipBoxes.add(b);
    }
  }
  return { v2Placements, skipBoxes };
}

/**
 * v2対象のインスタンス一覧から PropMatFamily 別に1メッシュ分のマージ済みジオメトリを作る
 * (mergeGeometries、既存 match.ts buildPropDecor/propMerge と同じ流儀)。中間ジオメトリは
 * マージ後に破棄する(試合ごとdispose契約に沿い、マージに使った一時分を残さない)。
 * 戻り値は最大7キー(metal/wood/stone/foliage/paint/accent/shadow) — DC予算の直接的な上限。
 */
export function buildPropVisualFamilyGeometries(
  placements: readonly PropPlacement[],
  palette: StagePalette,
  rand: Rand,
): Partial<Record<PropMatFamily, THREE.BufferGeometry>> {
  const acc = new Map<PropMatFamily, THREE.BufferGeometry[]>();
  for (const placement of placements) {
    const visual = buildPropVisual(
      placement.kind,
      placement.cx,
      placement.cz,
      0, // baseY: 全プロップ地面設置(M2c配線メモどおり常に0)
      placement.rotRad,
      placement.scaleJitter,
      rand,
      palette,
    );
    if (!visual) continue;
    for (const key of Object.keys(visual) as PropMatFamily[]) {
      const geos = visual[key];
      if (!geos || geos.length === 0) continue;
      let arr = acc.get(key);
      if (!arr) {
        arr = [];
        acc.set(key, arr);
      }
      arr.push(...geos);
    }
  }
  const merged: Partial<Record<PropMatFamily, THREE.BufferGeometry>> = {};
  for (const [family, geos] of acc) {
    const m = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (m) merged[family] = m;
  }
  return merged;
}

/**
 * PropMatFamily → マテリアル。metal/wood/stone/paint/foliage は applySurfaceKit で質感キット
 * (roughness/metalness基準値+onBeforeCompileのマクロ質感GLSL)を適用する。accent はキット無し
 * (素のemissive系。palette.emissiveAccent時のみ発光。0.45はbloom閾値0.9未満の既存踏襲値)。
 * shadow は接地コンタクトシャドウ専用(頂点色RGBA・itemSize4・MeshBasicMaterial)。
 * R54-W1 Q6: tier==='low'は onBeforeCompile GLSLパッチ(applySurfaceKit)を適用せず、
 * 素のMeshStandardMaterial既定roughness/metalnessのまま返す(低スペック機のフラグメント
 * ALU削減。tier省略時は既定'high'=従来どおりキット適用、既存呼び出しは非回帰)。
 */
export function buildPropFamilyMaterial(
  family: PropMatFamily,
  palette: StagePalette,
  tier: GraphicsQuality = 'high',
): THREE.Material {
  if (family === 'shadow') {
    return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  }
  if (family === 'accent') {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0 });
    if (palette.emissiveAccent) {
      mat.emissive = new THREE.Color(palette.accent);
      mat.emissiveIntensity = 0.45;
      mat.envMapIntensity = 0.35;
    }
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  if (tier !== 'low') applySurfaceKit(mat, family);
  return mat;
}

/**
 * PropMatFamily別のシャドウフラグ。metal/wood/stone/paint/foliage は個別shadowCasterメッシュ
 * 経路(旧: h>3の箱を個別castShadow=trueメッシュで描画)をv2が完全に肩代わりするため
 * castShadow=trueに統一(family1本で全個体分をまとめて落とすためdraw call増ゼロ)。
 * accent(薄い発光帯)はcastShadow=false(旧mergedPropMeshと同じ扱い)。
 * shadow(接地コンタクトシャドウのデカール)はcast/receiveとも false(旧buildPropDecorの
 * 接地シャドウメッシュと同じ扱い。MeshBasicMaterialは光の影響を受けない)。
 */
export function propFamilyShadowFlags(family: PropMatFamily): { castShadow: boolean; receiveShadow: boolean } {
  if (family === 'shadow') return { castShadow: false, receiveShadow: false };
  if (family === 'accent') return { castShadow: false, receiveShadow: true };
  return { castShadow: true, receiveShadow: true };
}

/** renderer.compile() の scene/camera 引数だけを要求する最小インタフェース(テスト用にモック可能)。 */
export interface PrewarmRenderer {
  compile: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null) => unknown;
}

/**
 * SurfaceKit 5バリアント(metal/wood/stone/paint/foliage)を、このステージで実際に使われて
 * いるかどうかに関わらず一時メッシュとして scene へ追加した状態で renderer.compile() へ通し、
 * 直後に scene から除去+dispose する(R11 dissolve教訓: あるステージで「稀にしか出ないキット」
 * のプロップに初めて近づいた瞬間だけ絵が止まる、を試合開始時の1回のcompileで潰す)。
 * このステージが実際に使う v2 家族メッシュ/マテリアルは、この呼び出し時点で既に scene に
 * 追加済みであれば同じ renderer.compile() 呼び出しで一緒に事前コンパイルされる(呼び出し側は
 * v2家族メッシュの追加後にこの関数を呼ぶこと)。DC実測は ?perfhud=1 で確認できる。
 * R54-W1 Q6: tier==='low'はSurfaceKitを一切使わない(buildPropFamilyMaterial側で不使用)ため、
 * 5variant分の一時メッシュ生成/コンパイルは完全に無駄仕事。ループのみ省略し、実メッシュが
 * 既にscene追加済みならその分のcompileは維持する(tier省略時は既定'high'=従来どおり)。
 */
export function prewarmSurfaceKitVariants(
  scene: THREE.Scene,
  renderer: PrewarmRenderer,
  camera: THREE.Camera,
  tier: GraphicsQuality = 'high',
): void {
  const tempGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const tempMeshes: THREE.Mesh[] = [];
  if (tier !== 'low') {
    for (const kit of SURFACE_KIT_IDS) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
      applySurfaceKit(mat, kit);
      const mesh = new THREE.Mesh(tempGeo, mat);
      scene.add(mesh);
      tempMeshes.push(mesh);
    }
  }
  renderer.compile(scene, camera);
  for (const mesh of tempMeshes) {
    scene.remove(mesh);
    (mesh.material as THREE.Material).dispose();
  }
  tempGeo.dispose();
}

// R54-W1 Q6: 床のfloorDetailGlsl(亀裂/オイル染み/タイヤ痕。3x3セルラー+複数fbm合成)を
// 合成してよいtierか(純関数)。low tierはmacroWear(applyMacroFloor既存の基礎汚れ変調、
// 低コスト)のみに留め、この重量級パスは外す("素のroughness基準+床はmacroWearまで")。
export function floorDetailEligible(tier: GraphicsQuality): boolean {
  return tier !== 'low';
}
