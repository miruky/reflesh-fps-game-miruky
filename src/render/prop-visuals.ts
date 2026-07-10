// R53-W2 (B-ENV1+B-ENV2): プロップ超リアル化の基盤モジュール + 全36種(stage.ts PropKind全網羅)。
//
// 現状(match.ts側)は stage.ts の buildProp() が返す BoxSpec(軸整列の色付き箱1〜3個)を
// そのまま描画している。本モジュールはその「箱」を、プリミティブ語彙(幹/コーン積層/変位アイコサ/
// 旋盤断面/格子/面取り箱/車輪アーチ/接地スカート/接地影)から組んだ実物寄りシルエットへ置き換える
// ためのジオメトリ生成器。当たり判定(コライダー/BoxSpec)には一切関与しない — 視覚のみ。
//
// ── M2c 配線ポイント(matchオーナー向け) ─────────────────────────────────
// 1. stage.ts の generateThemeObjects() 相当のループで各プロップの (kind, cx, cz, rot, palette) が
//    確定した時点で buildPropVisual(kind, cx, cz, baseY, rotRadians, scale, rand, palette) を呼ぶ。
//    - rot は「ヨー回転(ラジアン)」。stage.ts の buildProp() が使う 0-3 の quarter-step とは別物。
//      呼び出し側で `propRot * Math.PI / 2` 等に変換してから渡すこと。
//    - scale は ±12% ジッタ済みの値を呼び出し側で用意する(本モジュールは追加のスケールジッタをしない)。
//    - rand は決定論 RNG (mulberry32 系)。本モジュールは内部で複数回 rand() を消費する
//      (呼び出し順は固定・純関数なので同じ rand 系列なら常に同じ結果=決定論)。
// 2. 戻り値が null の場合(未実装 kind。PROP_VISUAL_KINDS に含まれない)は、既存の箱ビジュアル
//    (buildProp() の BoxSpec 描画)へフォールバックすること。
// 3. 戻り値の各ジオメトリは既に「ワールド座標へ焼き込み済み」(回転/傾き/スケール/平行移動/色相ジッタ/
//    頂点AO 全て頂点へ焼き込み済み)。追加の position/rotation/scale 適用は不要。
// 4. family (PropMatFamily) ごとに全プロップ・全ステージ分のジオメトリを集約し、
//    mergeGeometries() で1メッシュへ畳むこと(既存 match.ts buildPropDecor と同じ流儀)。
//    'shadow' ファミリだけ頂点色 itemSize=4 (RGBA)。他ファミリ(itemSize=3)と絶対に混ぜてマージしないこと
//    — 属性不一致の mergeGeometries() は null を返し全消失する(R51 教訓)。本モジュールは全ジオメトリを
//    非インデックス化して返すため、family 内でのマージは常に安全(indexed/non-indexed混在なし)。
// 5. マテリアル例:
//    metal/wood/stone/foliage/paint/accent → new THREE.MeshStandardMaterial({ vertexColors: true, ... })
//    shadow → new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
//      (itemSize=4 の color 属性は three.js r152+ が自動的に vertexAlphas 扱いにする)
// 6. B-ENV2 にて残り18種(sakura/bamboo/towercrane/portalkrane/smokestack/gastank/watertower/
//    transformer/antenna/forklift/watchpost/tankhull/scaffold/pallet/torii/well/utilitypole/
//    supplycrate)を同ファイルの BUILDERS へ追記済み。計36種で PropKind を全網羅。
//    データ形式: BUILDERS: Partial<Record<string, PropBuilder>> — 1 kind = 1 関数(下記参照)。
//
// ── 座標規約 ────────────────────────────────────────────────────────────
// 全 buildXxx() はプロップのローカル座標(中心 x=0,z=0 / 接地 y=0)でジオメトリを作る。
// finalize() が rot(Y) + 微小チルト(±4°上限、ただし高さから逆算し視覚オーバーハングが0.15mを
// 超えないようクランプ) + scale + 平行移動 (cx, baseY, cz) を1つの行列にまとめて焼き込む。

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rand } from '../core/rng';
import type { StagePalette } from '../game/stage';

export type PropMatFamily = 'metal' | 'wood' | 'stone' | 'foliage' | 'paint' | 'accent' | 'shadow';

/** stage.ts の StagePalette をそのまま使う(実型はstage.ts由来)。 */
export type PropVisualPalette = StagePalette;

export type PropVisualResult = Partial<Record<PropMatFamily, THREE.BufferGeometry[]>>;

type PropBuilder = (
  cx: number,
  cz: number,
  baseY: number,
  rot: number,
  scale: number,
  rand: Rand,
  palette: PropVisualPalette,
) => PropVisualResult;

const DEG = Math.PI / 180;

// ── 色まわり共通ユーティリティ ──────────────────────────────────────────
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** hex色をHSLへ落として色相/彩度/明度をずらす(match.ts の derive() と同じ流儀)。 */
function hueShift(hex: string, dHue: number, dL = 0, dS = 0): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  let h = hsl.h + dHue;
  h -= Math.floor(h);
  c.setHSL(h, clamp01(hsl.s + dS), clamp01(hsl.l + dL));
  return c;
}

function floorRim(palette: PropVisualPalette): THREE.Color {
  return new THREE.Color(palette.floor);
}

// レガシー固定色(stage.ts の buildProp() が使う定数と同じ値。パレット非依存の樹木/石材の識別色)。
const BROWN = '#5a3a1a';
const D_GREEN = '#2a5220';
const GREEN = '#3a7a2a';
const STONE = '#8a8278';
// R53-W2 (B-ENV2) 追加: stage.ts buildProp() のローカル定数と同じ値(桜/竹はパレット非依存の固定色)。
const PINK = '#e8b4c8';
const BAMBOO = '#6a9a4a';
// 鳥居専用の朱色(パレット非依存 — テーマが変わっても鳥居は朱色で識別できることを優先)。
const VERMILLION = '#c23b22';

// ── プリミティブ語彙ヘルパー ────────────────────────────────────────────

/** 底面 y=0、先端 y=height の円柱/円錐台(幹・電柱・ドラム胴等)。 */
function cylinderY(rTop: number, rBot: number, height: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(Math.max(0.001, rTop), Math.max(0.001, rBot), height, seg, 1);
  g.translate(0, height / 2, 0);
  return g;
}

/** 針葉樹の段積みコーン(3〜5段、下段ほど太く上へ重なるよう配置)。base=y方向の開始オフセット。 */
function coneStack(baseRadius: number, height: number, tiers: number, base: number, seg = 6): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.max(1, tiers);
  const step = height / n;
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1);
    const r = baseRadius * (1 - t * 0.72);
    const h = step * 1.55;
    const y = base + i * step * 0.82;
    const cone = new THREE.ConeGeometry(r, h, seg);
    cone.translate(0, y + h / 2, 0);
    parts.push(cone);
  }
  return parts;
}

/**
 * 頂点法線方向へ乱数変位させたアイコサヘドロン(岩/瓦礫/広葉樹冠)。
 * mergeVertices() で先に溶接してから変位させることで、変位後も面同士の継ぎ目が割れない
 * (アイコサヘドロン生成直後は non-indexed = UVシーム用に頂点が複製されており、
 * 複製ごとに別々の乱数変位を与えると亀裂が生じるため)。
 */
function icosaDisplace(radius: number, detail: number, amount: number, rand: Rand, flattenY = 1): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, detail);
  const welded = mergeVertices(raw, 1e-4) as THREE.BufferGeometry;
  raw.dispose();
  const pos = welded.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const disp = 1 + (rand() - 0.5) * 2 * amount;
    pos.setXYZ(i, (x / len) * len * disp, (y / len) * len * disp * flattenY, (z / len) * len * disp);
  }
  pos.needsUpdate = true;
  welded.computeVertexNormals();
  return welded;
}

/** (半径,高さ)の断面プロファイルをY軸まわりに旋盤(灯籠/給水塔/街灯の傘等)。 */
function latheProfile(points: Array<[number, number]>, seg = 8): THREE.BufferGeometry {
  const pts = points.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  return new THREE.LatheGeometry(pts, seg);
}

/** width×height の矩形内に縦横バーを格子状に(フェンス網目/換気グリル等)。原点中心・底辺y=0。 */
function boxLattice(width: number, height: number, depth: number, barsX: number, barsY: number, barThickness: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < barsX; i += 1) {
    const t = barsX === 1 ? 0.5 : i / (barsX - 1);
    const x = (t - 0.5) * width;
    const bar = new THREE.BoxGeometry(barThickness, height, depth);
    bar.translate(x, height / 2, 0);
    parts.push(bar);
  }
  for (let j = 0; j < barsY; j += 1) {
    const t = barsY === 1 ? 0.5 : j / (barsY - 1);
    const y = t * height;
    const bar = new THREE.BoxGeometry(width, barThickness, depth);
    bar.translate(0, y, 0);
    parts.push(bar);
  }
  return parts;
}

/** 角を落とした箱(ExtrudeGeometry + ベベル)。bot.ts の chamferBox と同じ技法の本モジュール専用実装。 */
function chamferBox(w: number, h: number, d: number, ch = 0.03): THREE.BufferGeometry {
  const r = Math.min(ch, w / 2 - 1e-3, h / 2 - 1e-3);
  const hw = w / 2;
  const hh = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const depth = Math.max(1e-3, d - r * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 車両の車輪一式(前後2〜3軸×左右)。axis='x' は車体の長手がX(車幅がZ)、
 * axis='z' は長手がZ(車幅がX)の車体レイアウトに対応。
 */
function wheelArch(halfTrack: number, wheelR: number, wheelW: number, along: number[], axis: 'x' | 'z' = 'x', seg = 8): THREE.BufferGeometry[] {
  const wheels: THREE.BufferGeometry[] = [];
  for (const p of along) {
    for (const side of [-1, 1] as const) {
      const wheel = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, seg);
      wheel.rotateZ(Math.PI / 2); // 既定: 車軸をX方向に
      if (axis === 'x') {
        wheel.translate(p, wheelR, side * halfTrack);
      } else {
        wheel.rotateY(Math.PI / 2); // 車軸をZ方向へ切り替え
        wheel.translate(side * halfTrack, wheelR, p);
      }
      wheels.push(wheel);
    }
  }
  return wheels;
}

/** 楕円/円形の接地スカート(床色→プロップ色の8角形ブレンド)。itemSize=3。 */
function groundSkirt(rx: number, rz: number, colorCenter: THREE.Color, colorRim: THREE.Color, sides = 8): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(1, sides);
  geo.rotateX(-Math.PI / 2);
  geo.scale(Math.max(0.01, rx), 1, Math.max(0.01, rz));
  geo.translate(0, 0.012, 0);
  const ni = geo.index ? (geo.toNonIndexed() as THREE.BufferGeometry) : geo;
  if (ni !== geo) geo.dispose();
  const pos = ni.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const carr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i) / Math.max(1e-4, rx);
    const z = pos.getZ(i) / Math.max(1e-4, rz);
    const t = clamp01(Math.hypot(x, z));
    carr[i * 3] = THREE.MathUtils.lerp(colorCenter.r, colorRim.r, t);
    carr[i * 3 + 1] = THREE.MathUtils.lerp(colorCenter.g, colorRim.g, t);
    carr[i * 3 + 2] = THREE.MathUtils.lerp(colorCenter.b, colorRim.b, t);
  }
  ni.setAttribute('color', new THREE.BufferAttribute(carr, 3));
  return ni;
}

/** 楕円/円形の接地コンタクトシャドウ。頂点色 itemSize=4(RGBA)、中心が濃く外周でアルファ0へフェード。 */
function radialShadow(rx: number, rz: number, maxAlpha = 0.4, sides = 10): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(1, sides);
  geo.rotateX(-Math.PI / 2);
  geo.scale(Math.max(0.01, rx), 1, Math.max(0.01, rz));
  geo.translate(0, 0.02, 0);
  const ni = geo.index ? (geo.toNonIndexed() as THREE.BufferGeometry) : geo;
  if (ni !== geo) geo.dispose();
  const pos = ni.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const carr = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i) / Math.max(1e-4, rx);
    const z = pos.getZ(i) / Math.max(1e-4, rz);
    const t = clamp01(Math.hypot(x, z));
    const a = maxAlpha * (1 - t) ** 1.6;
    carr[i * 4] = 0;
    carr[i * 4 + 1] = 0;
    carr[i * 4 + 2] = 0;
    carr[i * 4 + 3] = a;
  }
  ni.setAttribute('color', new THREE.BufferAttribute(carr, 4));
  return ni;
}

/** Y方向に沿って徐々にX/Zへずらす簡易ベンド(枯れ木の幹/枝の自然な曲がり)。 */
function bendY(geo: THREE.BufferGeometry, bendX: number, bendZ: number, height: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  for (let i = 0; i < n; i += 1) {
    const y = pos.getY(i);
    const t = clamp01(y / Math.max(1e-4, height));
    pos.setX(i, pos.getX(i) + bendX * t * t);
    pos.setZ(i, pos.getZ(i) + bendZ * t * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// R53-W2 (B-ENV2) 追加ヘルパー ───────────────────────────────────────────

/**
 * X方向に沿った梁を中央基準で弓なりに反らせる(鳥居の笠木/島木等)。原点(x=0)を頂点として
 * 両端(x=±halfLen)が amount だけ Y方向へ持ち上がる二次カーブ。bendY(高さ方向の湾曲)とは
 * 直交する用途のため別関数として用意。
 */
function archBendX(geo: THREE.BufferGeometry, halfLen: number, amount: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i);
    const t = clamp01(Math.abs(x) / Math.max(1e-4, halfLen));
    pos.setY(i, pos.getY(i) + amount * t * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * 直交する2枚の平面ラティス(boxLatticeを中心で交差させた「十字断面」)で構成した
 * 見せかけの立体格子マスト(タワークレーン/門型クレーン/足場等)。真の4隅柱ボックスにすると
 * 2面の柱が同一頂点に重なり z-fighting するため、あえて中心交差の2面構成にしている。
 * 底面 y=0、頂部 y=height。
 */
function latticeMastFaces(width: number, depth: number, height: number, barsY: number, barThickness: number): THREE.BufferGeometry[] {
  const faceA = boxLattice(width, height, barThickness, 2, barsY, barThickness);
  const faceB = boxLattice(depth, height, barThickness, 2, barsY, barThickness);
  for (const g of faceB) g.rotateY(Math.PI / 2);
  return [...faceA, ...faceB];
}

// ── ローカルパート → ベイク済みジオメトリのパイプライン ───────────────────

interface LocalPart {
  family: PropMatFamily;
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  /** [yMin, yMax] ローカル空間。天面(法線Y>0.5)は明るく、底面(法線Y<-0.5)はaoFloor、側面は高さで階調。 */
  aoY?: [number, number];
  aoFloor?: number;
}

type FamilyAcc = Map<PropMatFamily, THREE.BufferGeometry[]>;

function bakeColor3(g: THREE.BufferGeometry, color: THREE.Color, aoY?: [number, number], aoFloor = 0.55): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const yMin = aoY ? aoY[0] : 0;
  const yMax = aoY ? aoY[1] : 0;
  const range = Math.max(1e-4, yMax - yMin);
  for (let i = 0; i < n; i += 1) {
    let ao = 1;
    if (aoY) {
      const ny = nor ? nor.getY(i) : 0;
      if (ny > 0.5) ao = 1.0;
      else if (ny < -0.5) ao = aoFloor;
      else ao = aoFloor + (1 - aoFloor) * clamp01((pos.getY(i) - yMin) / range);
    }
    arr[i * 3] = color.r * ao;
    arr[i * 3 + 1] = color.g * ao;
    arr[i * 3 + 2] = color.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function normalizeNonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;
  const ni = geo.toNonIndexed();
  geo.dispose();
  return ni;
}

/** 通常パート(未着色)をfamilyバケットへ: 非インデックス化→頂点色(AO込み)焼き込み。 */
function pushBaked(acc: FamilyAcc, part: LocalPart): void {
  const g = normalizeNonIndexed(part.geo);
  bakeColor3(g, part.color, part.aoY, part.aoFloor ?? 0.55);
  let arr = acc.get(part.family);
  if (!arr) {
    arr = [];
    acc.set(part.family, arr);
  }
  arr.push(g);
}

/** groundSkirt/radialShadow 等、既に頂点色を持つジオメトリをfamilyバケットへ: 非インデックス化のみ。 */
function pushPrecolored(acc: FamilyAcc, family: PropMatFamily, geo: THREE.BufferGeometry): void {
  const g = normalizeNonIndexed(geo);
  let arr = acc.get(family);
  if (!arr) {
    arr = [];
    acc.set(family, arr);
  }
  arr.push(g);
}

/**
 * ワールド変換の焼き込み: yaw(rot) → 微小チルト(±4°上限、高さから逆算し視覚オーバーハング
 * 0.15m以内へクランプ) → scale → 平行移動(cx, baseY, cz)。rand() を2回消費(tiltX, tiltZ)。
 */
function finalize(acc: FamilyAcc, cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, maxHeight: number): PropVisualResult {
  const tiltCap = Math.min(4 * DEG, Math.atan2(0.15, Math.max(0.5, maxHeight)));
  const tiltX = (rand() - 0.5) * 2 * tiltCap * 0.7;
  const tiltZ = (rand() - 0.5) * 2 * tiltCap * 0.7;
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const qTiltX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltX);
  const qTiltZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tiltZ);
  const q = qYaw.multiply(qTiltX).multiply(qTiltZ);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, baseY, cz), q, new THREE.Vector3(scale, scale, scale));
  const out: PropVisualResult = {};
  for (const [family, arr] of acc) {
    for (const g of arr) g.applyMatrix4(m);
    out[family] = arr;
  }
  return out;
}

// ── 前半18種(配置数の多い順)実装 ─────────────────────────────────────

// 1. rock (64箇所) — 変位アイコサ岩塊 + 小岩2〜3
function buildRock(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.06;
  const main = icosaDisplace(1.15, 1, 0.22, rand, 0.62);
  pushBaked(acc, { family: 'stone', geo: main, color: hueShift(STONE, dh, -0.03), aoY: [-0.72, 0.72], aoFloor: 0.5 });
  const pebbleCount = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < pebbleCount; i += 1) {
    const r = 0.28 + rand() * 0.22;
    const ang = rand() * Math.PI * 2;
    const dist = 0.7 + rand() * 0.5;
    const pebble = icosaDisplace(r, 0, 0.25, rand, 0.7);
    pebble.translate(Math.cos(ang) * dist, r * 0.5 - 0.1, Math.sin(ang) * dist);
    pushBaked(acc, { family: 'stone', geo: pebble, color: hueShift(STONE, dh + (rand() - 0.5) * 0.03, -0.02), aoY: [-r, r], aoFloor: 0.55 });
  }
  pushPrecolored(acc, 'stone', groundSkirt(1.6, 1.6, hueShift(STONE, dh, -0.08, -0.05), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.7, 1.7, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.4);
}

// 2. concretebarrier (46箇所) — ジャージバリア断面の段積み
function buildConcreteBarrier(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const base = hueShift(palette.obstacle, dh, 0, -0.1);
  const len = 2.2 + rand() * 0.2;
  const segs: Array<[number, number, number]> = [
    [0.58, 0, 0.32],
    [0.42, 0.32, 0.66],
    [0.3, 0.66, 0.92],
  ];
  for (const seg of segs) {
    const w = seg[0];
    const y0 = seg[1];
    const y1 = seg[2];
    const h = y1 - y0;
    const box = new THREE.BoxGeometry(w, h, len);
    box.translate(0, y0 + h / 2, 0);
    pushBaked(acc, { family: 'stone', geo: box, color: base, aoY: [0, 0.92], aoFloor: 0.55 });
  }
  const cap = new THREE.BoxGeometry(0.34, 0.06, len - 0.06);
  cap.translate(0, 0.95, 0);
  pushBaked(acc, { family: 'stone', geo: cap, color: hueShift(palette.obstacle, dh, 0.05), aoY: [0, 1], aoFloor: 0.8 });
  for (const ry of [0.15, 0.5]) {
    const rib = new THREE.BoxGeometry(0.62, 0.03, len + 0.02);
    rib.translate(0, ry, 0);
    pushBaked(acc, { family: 'stone', geo: rib, color: hueShift(palette.obstacle, dh, -0.08), aoY: [0, 1], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'stone', groundSkirt(0.5, len * 0.5 + 0.2, hueShift(palette.obstacle, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.65, len * 0.55 + 0.25, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.0);
}

// 3. rubble (46箇所) — 瓦礫の山(変位アイコサ複数)
function buildRubble(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const col = hueShift(palette.obstacle, dh, 0, -0.08);
  const mound = icosaDisplace(1.05, 0, 0.32, rand, 0.42);
  mound.translate(0, 0.05, 0);
  pushBaked(acc, { family: 'stone', geo: mound, color: col, aoY: [-0.4, 0.5], aoFloor: 0.5 });
  const shardCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < shardCount; i += 1) {
    const r = 0.22 + rand() * 0.28;
    const ang = rand() * Math.PI * 2;
    const dist = rand() * 0.85;
    const shard = icosaDisplace(r, 0, 0.3, rand, 0.55);
    shard.rotateY(rand() * Math.PI * 2);
    shard.translate(Math.cos(ang) * dist, r * 0.4, Math.sin(ang) * dist);
    pushBaked(acc, { family: 'stone', geo: shard, color: hueShift(palette.obstacle, dh + (rand() - 0.5) * 0.04, 0, -0.05), aoY: [-r * 0.5, r * 0.8], aoFloor: 0.55 });
  }
  pushPrecolored(acc, 'stone', groundSkirt(1.5, 1.5, hueShift(palette.obstacle, dh, -0.05), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.6, 1.6, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.1);
}

// 4. fence (30箇所) — 支柱2本+上下レール+格子網
function buildFence(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, 0, -0.15);
  const postH = 1.55;
  for (const px of [-1.9, 1.9]) {
    const post = cylinderY(0.05, 0.06, postH, 6);
    post.translate(px, 0, 0);
    pushBaked(acc, { family: 'metal', geo: post, color: metalCol, aoY: [0, postH], aoFloor: 0.55 });
  }
  const topRail = new THREE.BoxGeometry(4.0, 0.05, 0.05);
  topRail.translate(0, postH - 0.05, 0);
  pushBaked(acc, { family: 'metal', geo: topRail, color: metalCol, aoY: [0, postH], aoFloor: 0.7 });
  const botRail = new THREE.BoxGeometry(4.0, 0.05, 0.05);
  botRail.translate(0, 0.1, 0);
  pushBaked(acc, { family: 'metal', geo: botRail, color: metalCol, aoY: [0, postH], aoFloor: 0.55 });
  const mesh = boxLattice(3.9, postH - 0.25, 0.03, 6, 2, 0.02);
  for (const bar of mesh) {
    bar.translate(0, 0.13, 0);
    pushBaked(acc, { family: 'metal', geo: bar, color: hueShift(palette.obstacle, dh, 0.03, -0.1), aoY: [0, postH], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(2.1, 0.3, hueShift(palette.obstacle, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(2.1, 0.35, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, postH);
}

// 5. stonelantern (28箇所) — 旋盤断面の灯籠 + 宝珠
function buildStoneLantern(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const col = hueShift(STONE, dh, -0.02);
  const body = latheProfile(
    [
      [0.3, 0],
      [0.14, 0.08],
      [0.16, 0.48],
      [0.36, 0.58],
      [0.44, 0.66],
      [0.18, 0.72],
      [0.16, 0.82],
      [0.0, 0.92],
    ],
    6,
  );
  pushBaked(acc, { family: 'stone', geo: body, color: col, aoY: [0, 0.92], aoFloor: 0.5 });
  const finial = icosaDisplace(0.06, 0, 0.15, rand, 1);
  finial.translate(0, 0.98, 0);
  pushBaked(acc, { family: 'stone', geo: finial, color: hueShift(STONE, dh, 0.05), aoY: [0.9, 1.05], aoFloor: 0.8 });
  pushPrecolored(acc, 'stone', groundSkirt(0.5, 0.5, hueShift(STONE, dh, -0.08), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.55, 0.55, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.0);
}

// 6. bench (24箇所) — 面取り座面+背もたれ低リップ+脚2
function buildBench(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const woodCol = hueShift(BROWN, dh, 0.08);
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const seat = chamferBox(1.5, 0.08, 0.5, 0.02);
  seat.translate(0, 0.42, 0);
  pushBaked(acc, { family: 'wood', geo: seat, color: woodCol, aoY: [0.38, 0.46], aoFloor: 0.7 });
  const back = chamferBox(1.5, 0.14, 0.06, 0.02);
  back.translate(0, 0.5, -0.2);
  pushBaked(acc, { family: 'wood', geo: back, color: woodCol, aoY: [0.43, 0.57], aoFloor: 0.75 });
  for (const lx of [-0.6, 0.6]) {
    const leg = new THREE.BoxGeometry(0.06, 0.42, 0.42);
    leg.translate(lx, 0.21, 0);
    pushBaked(acc, { family: 'metal', geo: leg, color: metalCol, aoY: [0, 0.42], aoFloor: 0.5 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(0.9, 0.4, hueShift(palette.obstacle, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.95, 0.45, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 0.6);
}

// 7. streetlight (22箇所) — テーパ支柱+アーム+旋盤ランプ傘+発光
function buildStreetlight(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const poleH = 4.9 + rand() * 0.15;
  const pole = cylinderY(0.06, 0.09, poleH, 7);
  pushBaked(acc, { family: 'metal', geo: pole, color: metalCol, aoY: [0, poleH], aoFloor: 0.5 });
  const armLen = 0.55;
  const arm = new THREE.BoxGeometry(armLen, 0.05, 0.05);
  arm.translate(armLen / 2, poleH - 0.05, 0);
  pushBaked(acc, { family: 'metal', geo: arm, color: metalCol, aoY: [0, poleH], aoFloor: 0.65 });
  const head = latheProfile(
    [
      [0.05, 0],
      [0.22, 0.02],
      [0.24, 0.1],
      [0.14, 0.16],
      [0.0, 0.18],
    ],
    6,
  );
  head.rotateX(Math.PI);
  head.translate(armLen, poleH - 0.02, 0);
  pushBaked(acc, { family: 'metal', geo: head, color: hueShift(palette.obstacle, dh, -0.1), aoY: [poleH - 0.2, poleH], aoFloor: 0.6 });
  const glow = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 8);
  glow.translate(armLen, poleH - 0.16, 0);
  pushBaked(acc, { family: 'accent', geo: glow, color: new THREE.Color(palette.accent), aoY: [0, 1], aoFloor: 1 });
  pushPrecolored(acc, 'metal', groundSkirt(0.3, 0.3, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 6));
  pushPrecolored(acc, 'shadow', radialShadow(0.5, 0.5, 0.28, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, poleH);
}

// 8. deadtree (22箇所) — 曲がった裸幹+枝3〜5
function buildDeadTree(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const col = hueShift(BROWN, dh, -0.08, -0.15);
  const trunkH = 4.3 + rand() * 0.4;
  const trunk = cylinderY(0.08, 0.2, trunkH, 6);
  bendY(trunk, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5, trunkH);
  pushBaked(acc, { family: 'wood', geo: trunk, color: col, aoY: [0, trunkH], aoFloor: 0.5 });
  const branchCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < branchCount; i += 1) {
    const bh = trunkH * (0.45 + rand() * 0.45);
    const len = 0.8 + rand() * 1.1;
    const branch = cylinderY(0.015, 0.05, len, 5);
    branch.rotateZ((Math.PI / 2) * (rand() > 0.5 ? 1 : -1) * (0.55 + rand() * 0.35));
    branch.rotateY(rand() * Math.PI * 2);
    branch.translate(0, bh, 0);
    pushBaked(acc, { family: 'wood', geo: branch, color: hueShift(BROWN, dh - 0.1 + rand() * 0.05, 0, -0.1), aoY: [0, trunkH], aoFloor: 0.55 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(0.7, 0.7, hueShift(BROWN, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.0, 1.0, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, trunkH);
}

// 車体パーツ共通(derelictcar/barricadecar共用)。長手はZ、車幅はX。
// chamfered=false は頂点予算の厳しい複数台配置(barricadecar)向けの軽量版(面取りなし箱)。
function carPartsLocal(dh: number, palette: PropVisualPalette, rusty: boolean, chamfered: boolean): LocalPart[] {
  const parts: LocalPart[] = [];
  const paintBase = rusty ? hueShift(palette.obstacle, dh, -0.1, -0.35) : hueShift(palette.obstacle, dh, 0, -0.05);
  const chassis = chamfered ? chamferBox(1.8, 0.5, 3.8, 0.06) : new THREE.BoxGeometry(1.8, 0.5, 3.8);
  chassis.translate(0, 0.35, 0);
  parts.push({ family: 'paint', geo: chassis, color: paintBase, aoY: [0.1, 0.8], aoFloor: 0.55 });
  const cabin = chamfered ? chamferBox(1.5, 0.42, 1.7, 0.08) : new THREE.BoxGeometry(1.5, 0.42, 1.7);
  cabin.translate(0, 0.85, -0.3);
  parts.push({ family: 'paint', geo: cabin, color: paintBase, aoY: [0.6, 1.1], aoFloor: 0.7 });
  const glass = new THREE.BoxGeometry(1.42, 0.22, 1.6);
  glass.translate(0, 0.92, -0.3);
  parts.push({ family: 'metal', geo: glass, color: hueShift('#101418', dh), aoY: [0, 1], aoFloor: 0.9 });
  for (const bz of [1.85, -1.85]) {
    const bumper = new THREE.BoxGeometry(1.7, 0.16, 0.14);
    bumper.translate(0, 0.28, bz);
    parts.push({ family: 'metal', geo: bumper, color: hueShift(palette.obstacle, dh, -0.15, -0.2), aoY: [0, 0.5], aoFloor: 0.6 });
  }
  return parts;
}

// 9. derelictcar (22箇所) — 放置車1台
function buildDerelictCar(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  for (const part of carPartsLocal(dh, palette, true, true)) pushBaked(acc, part);
  const wheels = wheelArch(0.85, 0.32, 0.22, [1.35, -1.35], 'z');
  for (const w of wheels) pushBaked(acc, { family: 'metal', geo: w, color: hueShift('#26221e', dh, -0.1), aoY: [0, 0.64], aoFloor: 0.6 });
  pushPrecolored(acc, 'paint', groundSkirt(1.1, 2.1, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.2, 2.2, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.3);
}

// 10. truck (20箇所) — キャブ+荷台+リブ+車輪3軸
function buildTruck(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const paintCol = hueShift(palette.obstacle, dh);
  const cabW = 2.0;
  const cabH = 2.2;
  const cabD = 2.3;
  const cabCx = -2.3;
  const cab = chamferBox(cabW, cabH, cabD, 0.08);
  cab.translate(cabCx, cabH / 2 + 0.1, 0);
  pushBaked(acc, { family: 'paint', geo: cab, color: paintCol, aoY: [0.1, cabH + 0.1], aoFloor: 0.55 });
  const glass = new THREE.BoxGeometry(0.06, 0.65, cabD - 0.3);
  glass.rotateZ(-0.18);
  glass.translate(cabCx - cabW / 2, cabH * 0.78, 0);
  pushBaked(acc, { family: 'metal', geo: glass, color: hueShift('#141a1e', dh), aoY: [0, 1], aoFloor: 0.85 });
  const cargoW = 4.6;
  const cargoH = 2.1;
  const cargoD = 2.35;
  const cargoCx = 1.6;
  const cargo = new THREE.BoxGeometry(cargoW, cargoH, cargoD);
  cargo.translate(cargoCx, cargoH / 2 + 0.15, 0);
  pushBaked(acc, { family: 'paint', geo: cargo, color: hueShift(palette.obstacle, dh, 0.04), aoY: [0.1, cargoH + 0.15], aoFloor: 0.6 });
  for (let i = 0; i < 4; i += 1) {
    const t = i / 3;
    const rx = cargoCx - cargoW / 2 + 0.1 + t * (cargoW - 0.2);
    const rib = new THREE.BoxGeometry(0.05, cargoH - 0.15, 0.06);
    rib.translate(rx, cargoH / 2 + 0.15, cargoD / 2 + 0.02);
    pushBaked(acc, { family: 'metal', geo: rib, color: hueShift(palette.obstacle, dh, -0.08), aoY: [0.2, cargoH], aoFloor: 0.6 });
  }
  const wheels = wheelArch(1.25, 0.42, 0.32, [-2.3, 1.0, 2.6], 'x', 6);
  for (const w of wheels) pushBaked(acc, { family: 'metal', geo: w, color: hueShift('#221e1a', dh, -0.1), aoY: [0, 0.84], aoFloor: 0.6 });
  pushPrecolored(acc, 'paint', groundSkirt(3.6, 1.5, hueShift(palette.obstacle, dh, -0.12), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(3.7, 1.6, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, cargoH + 0.4);
}

// 11. signboard (18箇所) — 支柱+面取りパネル+発光帯
function buildSignboard(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const postH = 2.75 + rand() * 0.15;
  const post = cylinderY(0.06, 0.08, postH, 6);
  pushBaked(acc, { family: 'metal', geo: post, color: metalCol, aoY: [0, postH], aoFloor: 0.5 });
  const panel = chamferBox(2.3, 0.95, 0.08, 0.04);
  panel.translate(0, postH + 0.05, 0);
  pushBaked(acc, { family: 'paint', geo: panel, color: hueShift(palette.obstacle, dh, 0.06, -0.05), aoY: [0, 1], aoFloor: 0.75 });
  const stripe = new THREE.BoxGeometry(2.0, 0.14, 0.02);
  stripe.translate(0, postH + 0.05, 0.05);
  pushBaked(acc, { family: 'accent', geo: stripe, color: new THREE.Color(palette.accent), aoY: [0, 1], aoFloor: 1 });
  pushPrecolored(acc, 'metal', groundSkirt(0.3, 0.3, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 6));
  pushPrecolored(acc, 'shadow', radialShadow(0.5, 0.5, 0.28, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, postH + 0.5);
}

// 12. conifer (16箇所) — テーパ幹+段積みコーン4〜5段
function buildConifer(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const trunkH = 3.4 + rand() * 0.4;
  const trunk = cylinderY(0.12, 0.22, trunkH, 7);
  pushBaked(acc, { family: 'wood', geo: trunk, color: hueShift(BROWN, dh), aoY: [0, trunkH], aoFloor: 0.5 });
  const canopyBase = trunkH * 0.35;
  const canopyH = 6.0 - canopyBase;
  const tiers = 4 + Math.floor(rand() * 2);
  const cones = coneStack(1.35, canopyH, tiers, canopyBase, 6);
  for (const cone of cones) {
    pushBaked(acc, { family: 'foliage', geo: cone, color: hueShift(D_GREEN, dh), aoY: [canopyBase, canopyBase + canopyH], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(1.3, 1.3, hueShift(BROWN, dh, -0.05), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.6, 1.6, 0.35, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 6.0);
}

// 13. drumgroup (14箇所) — ドラム缶3(リング2本+天面キャップ)
function buildDrumGroup(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const positions: Array<[number, number, number]> = [
    [-0.5, 0, 0],
    [0.5, 0, 0],
    [0, 0.62, 0],
  ];
  for (const p of positions) {
    const lx = p[0];
    const ly = p[1];
    const lz = p[2];
    const dh = (rand() - 0.5) * 0.08;
    const col = hueShift(palette.obstacle, dh, -0.05, -0.05);
    const body = cylinderY(0.28, 0.3, 0.86, 8);
    body.translate(lx, ly, lz);
    pushBaked(acc, { family: 'metal', geo: body, color: col, aoY: [ly, ly + 0.86], aoFloor: 0.55 });
    for (const ry of [0.18, 0.62]) {
      const ring = cylinderY(0.305, 0.305, 0.04, 8);
      ring.translate(lx, ly + ry, lz);
      pushBaked(acc, { family: 'metal', geo: ring, color: hueShift(palette.obstacle, dh, -0.12), aoY: [ly, ly + 0.86], aoFloor: 0.7 });
    }
    const capTop = new THREE.CircleGeometry(0.27, 8);
    capTop.rotateX(-Math.PI / 2);
    capTop.translate(lx, ly + 0.86, lz);
    pushBaked(acc, { family: 'metal', geo: capTop, color: hueShift(palette.obstacle, dh, 0.03), aoY: [0, 1], aoFloor: 1 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(1.0, 0.75, hueShift(palette.obstacle, 0, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.1, 0.85, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.5);
}

// 14. broadleaf (14箇所) — 曲がった幹+変位アイコサ樹冠
function buildBroadleaf(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const trunkH = 2.4 + rand() * 0.3;
  const trunk = cylinderY(0.14, 0.24, trunkH, 7);
  bendY(trunk, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3, trunkH);
  pushBaked(acc, { family: 'wood', geo: trunk, color: hueShift(BROWN, dh), aoY: [0, trunkH], aoFloor: 0.5 });
  const canopyR = 2.1 + rand() * 0.3;
  const canopyCy = trunkH + canopyR * 0.55;
  const canopy = icosaDisplace(canopyR, 1, 0.24, rand, 0.68);
  canopy.translate(0, canopyCy, 0);
  pushBaked(acc, { family: 'foliage', geo: canopy, color: hueShift(GREEN, dh), aoY: [canopyCy - canopyR * 0.6, canopyCy + canopyR * 0.6], aoFloor: 0.6 });
  pushPrecolored(acc, 'wood', groundSkirt(1.4, 1.4, hueShift(BROWN, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(2.3, 2.3, 0.35, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, canopyCy + canopyR * 0.6);
}

// 15. barricadecar (14箇所) — 放置車2台を並べたバリケード
function buildBarricadeCar(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  for (const dx of [-1.5, 1.5]) {
    const carDh = dh + (rand() - 0.5) * 0.02;
    for (const part of carPartsLocal(carDh, palette, true, false)) {
      part.geo.translate(dx, 0, 0);
      pushBaked(acc, part);
    }
    const wheels = wheelArch(0.85, 0.3, 0.2, [1.35, -1.35], 'z');
    for (const w of wheels) {
      w.translate(dx, 0, 0);
      pushBaked(acc, { family: 'metal', geo: w, color: hueShift('#26221e', dh, -0.1), aoY: [0, 0.6], aoFloor: 0.6 });
    }
  }
  pushPrecolored(acc, 'paint', groundSkirt(1.9, 2.2, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(2.0, 2.3, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.2);
}

// 16. gasbottlegroup (14箇所) — ガスボンベ3(キャップ+バルブ)
function buildGasBottleGroup(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const positions: Array<[number, number, number]> = [
    [-0.4, 0, 0],
    [0.4, 0, 0],
    [0, 0.42, 0],
  ];
  for (const p of positions) {
    const lx = p[0];
    const ly = p[1];
    const lz = p[2];
    const dh = (rand() - 0.5) * 0.1;
    const col = hueShift(palette.accent, dh, 0, -0.1);
    const body = cylinderY(0.15, 0.15, 0.82, 8);
    body.translate(lx, ly, lz);
    pushBaked(acc, { family: 'paint', geo: body, color: col, aoY: [ly, ly + 0.82], aoFloor: 0.55 });
    const cap = cylinderY(0.02, 0.15, 0.14, 8);
    cap.translate(lx, ly + 0.82, lz);
    pushBaked(acc, { family: 'paint', geo: cap, color: hueShift(palette.accent, dh, -0.08), aoY: [0, 1], aoFloor: 0.8 });
    const valve = cylinderY(0.02, 0.03, 0.08, 6);
    valve.translate(lx, ly + 0.96, lz);
    pushBaked(acc, { family: 'metal', geo: valve, color: hueShift('#787878', dh), aoY: [0, 1], aoFloor: 0.9 });
  }
  pushPrecolored(acc, 'paint', groundSkirt(0.65, 0.5, hueShift(palette.obstacle, 0, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.75, 0.6, 0.32, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.4);
}

// 17. pier (12箇所) — 杭2本+板張りデッキ
function buildPier(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const posts: Array<[number, number]> = [
    [-2.6, 0],
    [2.6, 0],
  ];
  for (const p of posts) {
    const lx = p[0];
    const lz = p[1];
    const post = cylinderY(0.14, 0.16, 0.75, 6);
    post.translate(lx, 0, lz);
    pushBaked(acc, { family: 'wood', geo: post, color: hueShift(BROWN, dh, -0.12, -0.1), aoY: [0, 0.75], aoFloor: 0.45 });
  }
  const plankCount = 7;
  for (let i = 0; i < plankCount; i += 1) {
    const t = i / (plankCount - 1);
    const px = -2.85 + t * 5.7;
    const plank = new THREE.BoxGeometry(0.75, 0.12, 1.9);
    plank.translate(px, 0.7, 0);
    pushBaked(acc, { family: 'wood', geo: plank, color: hueShift(BROWN, dh + (rand() - 0.5) * 0.02, 0.02 + (i % 2) * 0.03), aoY: [0.5, 0.85], aoFloor: 0.65 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(3.2, 1.2, hueShift(BROWN, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(3.3, 1.3, 0.3, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 0.85);
}

// 18. vendingmachine (10箇所) — 面取り筐体+発光スクリーン+グリル
function buildVendingMachine(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const body = chamferBox(0.72, 1.78, 0.42, 0.03);
  body.translate(0, 0.89, 0);
  pushBaked(acc, { family: 'paint', geo: body, color: hueShift(palette.obstacle, dh, 0.05), aoY: [0, 1.78], aoFloor: 0.55 });
  const screen = new THREE.BoxGeometry(0.5, 0.85, 0.02);
  screen.translate(0, 1.05, 0.22);
  pushBaked(acc, { family: 'accent', geo: screen, color: new THREE.Color(palette.accent), aoY: [0, 1], aoFloor: 1 });
  const grille = boxLattice(0.5, 0.5, 0.015, 3, 3, 0.015);
  for (const bar of grille) {
    bar.translate(0, 0.35, 0.22);
    pushBaked(acc, { family: 'metal', geo: bar, color: hueShift('#1c1c1c', dh), aoY: [0, 1], aoFloor: 0.8 });
  }
  const base = new THREE.BoxGeometry(0.78, 0.06, 0.48);
  base.translate(0, 0.03, 0);
  pushBaked(acc, { family: 'metal', geo: base, color: hueShift(palette.obstacle, dh, -0.15), aoY: [0, 0.1], aoFloor: 0.6 });
  pushPrecolored(acc, 'paint', groundSkirt(0.55, 0.35, hueShift(palette.obstacle, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.6, 0.4, 0.32, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 1.8);
}

// ── 後半18種(R53-W2 B-ENV2)実装 ─────────────────────────────────────

// 19. sakura (4箇所) — 曲がった幹+桜色変位クラスタ冠(桃色頂点カラー)
function buildSakura(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const trunkH = 3.3 + rand() * 0.3;
  const trunk = cylinderY(0.13, 0.22, trunkH, 7);
  bendY(trunk, (rand() - 0.5) * 0.35, (rand() - 0.5) * 0.35, trunkH);
  pushBaked(acc, { family: 'wood', geo: trunk, color: hueShift(BROWN, dh, -0.05), aoY: [0, trunkH], aoFloor: 0.5 });
  const canopyCy = trunkH + 0.85;
  const canopyR = 1.85 + rand() * 0.25;
  const main = icosaDisplace(canopyR, 1, 0.24, rand, 0.6);
  main.translate(0, canopyCy, 0);
  pushBaked(acc, { family: 'foliage', geo: main, color: hueShift(PINK, dh), aoY: [canopyCy - canopyR * 0.6, canopyCy + canopyR * 0.6], aoFloor: 0.65 });
  const clusterCount = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < clusterCount; i += 1) {
    const r = 0.5 + rand() * 0.35;
    const ang = rand() * Math.PI * 2;
    const dist = canopyR * (0.55 + rand() * 0.35);
    const cluster = icosaDisplace(r, 0, 0.3, rand, 0.7);
    cluster.translate(Math.cos(ang) * dist, canopyCy + (rand() - 0.5) * canopyR * 0.5, Math.sin(ang) * dist);
    pushBaked(acc, { family: 'foliage', geo: cluster, color: hueShift(PINK, dh + (rand() - 0.5) * 0.02, (rand() - 0.5) * 0.04), aoY: [canopyCy - canopyR, canopyCy + canopyR], aoFloor: 0.7 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(1.0, 1.0, hueShift(BROWN, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(2.0, 2.0, 0.35, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, canopyCy + canopyR);
}

// 20. bamboo (10箇所) — 細cylinder束+節リング+葉少量
function buildBamboo(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const stalkCount = 4 + Math.floor(rand() * 2);
  let maxH = 0;
  const stalkPos: Array<[number, number, number]> = [];
  for (let i = 0; i < stalkCount; i += 1) {
    const h = 4.6 + rand() * 1.6;
    maxH = Math.max(maxH, h);
    const r = 0.05 + rand() * 0.02;
    const ang = rand() * Math.PI * 2;
    const dist = rand() * 0.45;
    const lx = Math.cos(ang) * dist;
    const lz = Math.sin(ang) * dist;
    stalkPos.push([lx, lz, h]);
    const stalk = cylinderY(r * 0.85, r, h, 6);
    bendY(stalk, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.2, h);
    stalk.translate(lx, 0, lz);
    pushBaked(acc, { family: 'foliage', geo: stalk, color: hueShift(BAMBOO, dh), aoY: [0, h], aoFloor: 0.5 });
    const ringCount = 2;
    for (let j = 1; j <= ringCount; j += 1) {
      const ny = (h * j) / (ringCount + 1);
      const ring = cylinderY(r * 1.2, r * 1.2, 0.035, 5);
      ring.translate(lx, ny, lz);
      pushBaked(acc, { family: 'foliage', geo: ring, color: hueShift(BAMBOO, dh, -0.1), aoY: [0, h], aoFloor: 0.75 });
    }
  }
  const leafCount = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < leafCount; i += 1) {
    const base = stalkPos[i % stalkPos.length];
    if (!base) continue;
    const [lx, lz, h] = base;
    const ly = h * (0.65 + rand() * 0.3);
    const leaf = new THREE.ConeGeometry(0.06, 0.5 + rand() * 0.3, 4);
    leaf.rotateX(Math.PI / 2);
    leaf.rotateZ(rand() * Math.PI * 2);
    leaf.translate(lx + (rand() - 0.5) * 0.15, ly, lz + (rand() - 0.5) * 0.15);
    pushBaked(acc, { family: 'foliage', geo: leaf, color: hueShift(BAMBOO, dh + 0.04, 0.05), aoY: [0, maxH], aoFloor: 0.7 });
  }
  pushPrecolored(acc, 'foliage', groundSkirt(0.7, 0.7, hueShift(BAMBOO, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.85, 0.85, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, maxH);
}

// 21. towercrane (2箇所) — 格子マスト18m+運転室+ジブ/カウンタージブ+トロリー+吊りフック
function buildTowerCrane(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const mastH = 17.2 + rand() * 0.7;
  const mast = latticeMastFaces(0.9, 0.9, mastH, 5, 0.05);
  for (const g of mast) pushBaked(acc, { family: 'metal', geo: g, color: metalCol, aoY: [0, mastH], aoFloor: 0.4 });
  const cab = chamferBox(0.9, 0.7, 0.9, 0.05);
  cab.translate(0, mastH + 0.35, 0);
  pushBaked(acc, { family: 'metal', geo: cab, color: hueShift(palette.obstacle, dh, 0.04), aoY: [mastH, mastH + 0.7], aoFloor: 0.7 });
  const jibLen = 9.4;
  const jib = new THREE.BoxGeometry(jibLen, 0.35, 0.35);
  jib.translate(jibLen / 2 + 0.6, mastH + 0.75, 0);
  pushBaked(acc, { family: 'metal', geo: jib, color: metalCol, aoY: [mastH, mastH + 1], aoFloor: 0.6 });
  const counterLen = 3.8;
  const counterJib = new THREE.BoxGeometry(counterLen, 0.35, 0.35);
  counterJib.translate(-counterLen / 2 - 0.6, mastH + 0.75, 0);
  pushBaked(acc, { family: 'metal', geo: counterJib, color: metalCol, aoY: [mastH, mastH + 1], aoFloor: 0.6 });
  const counterweight = new THREE.BoxGeometry(1.1, 0.9, 0.9);
  counterweight.translate(-counterLen - 0.9, mastH + 0.55, 0);
  pushBaked(acc, { family: 'metal', geo: counterweight, color: hueShift(palette.obstacle, dh, -0.1, -0.1), aoY: [mastH, mastH + 1], aoFloor: 0.55 });
  const trolleyX = jibLen * (0.4 + rand() * 0.35) + 0.6;
  const trolley = new THREE.BoxGeometry(0.3, 0.2, 0.3);
  trolley.translate(trolleyX, mastH + 0.6, 0);
  pushBaked(acc, { family: 'metal', geo: trolley, color: hueShift(palette.obstacle, dh, 0.05), aoY: [mastH, mastH + 1], aoFloor: 0.65 });
  const cableLen = 2.4 + rand() * 1.2;
  const cable = cylinderY(0.015, 0.015, cableLen, 4);
  cable.translate(trolleyX, mastH + 0.55 - cableLen, 0);
  pushBaked(acc, { family: 'metal', geo: cable, color: hueShift('#1a1a1a', dh), aoY: [0, mastH + 1], aoFloor: 0.9 });
  const hook = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  hook.translate(trolleyX, mastH + 0.55 - cableLen, 0);
  pushBaked(acc, { family: 'metal', geo: hook, color: hueShift('#1a1a1a', dh, 0.05), aoY: [0, mastH], aoFloor: 0.8 });
  pushPrecolored(acc, 'metal', groundSkirt(1.1, 1.1, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.3, 1.3, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, mastH + 1.3);
}

// 22. portalkrane (4箇所) — 門型格子脚2+横梁+レール+トロリー+吊りフック
function buildPortalKrane(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const legH = 7.6 + rand() * 0.5;
  const span = 8.2;
  for (const lx of [-span / 2, span / 2]) {
    const leg = latticeMastFaces(0.55, 0.55, legH, 3, 0.045);
    for (const g of leg) {
      g.translate(lx, 0, 0);
      pushBaked(acc, { family: 'metal', geo: g, color: metalCol, aoY: [0, legH], aoFloor: 0.45 });
    }
  }
  const beam = new THREE.BoxGeometry(span + 1.0, 0.5, 0.5);
  beam.translate(0, legH + 0.25, 0);
  pushBaked(acc, { family: 'metal', geo: beam, color: metalCol, aoY: [legH, legH + 0.5], aoFloor: 0.6 });
  for (const bz of [0.22, -0.22]) {
    const rail = new THREE.BoxGeometry(span + 1.0, 0.06, 0.06);
    rail.translate(0, legH + 0.55, bz);
    pushBaked(acc, { family: 'metal', geo: rail, color: hueShift(palette.obstacle, dh, -0.1), aoY: [legH, legH + 1], aoFloor: 0.7 });
  }
  const trolleyX = (rand() - 0.5) * span * 0.7;
  const trolley = new THREE.BoxGeometry(0.6, 0.35, 0.6);
  trolley.translate(trolleyX, legH + 0.05, 0);
  pushBaked(acc, { family: 'metal', geo: trolley, color: hueShift(palette.obstacle, dh, 0.05), aoY: [legH, legH + 1], aoFloor: 0.65 });
  const hookLen = 1.2 + rand() * 0.6;
  const cable = cylinderY(0.02, 0.02, hookLen, 4);
  cable.translate(trolleyX, legH - hookLen + 0.05, 0);
  pushBaked(acc, { family: 'metal', geo: cable, color: hueShift('#1a1a1a', dh), aoY: [0, legH], aoFloor: 0.85 });
  const hook = new THREE.BoxGeometry(0.2, 0.16, 0.2);
  hook.translate(trolleyX, legH - hookLen, 0);
  pushBaked(acc, { family: 'metal', geo: hook, color: hueShift('#1a1a1a', dh, 0.05), aoY: [0, legH], aoFloor: 0.8 });
  pushPrecolored(acc, 'metal', groundSkirt(span / 2 + 0.6, 1.0, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(span / 2 + 0.8, 1.2, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, legH + 1.0);
}

// 23. smokestack (2箇所) — テーパー煙突16m+頂部リング3本+はしご示唆
function buildSmokestack(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const col = hueShift(palette.obstacle, dh, -0.05, -0.05);
  const h = 15.6 + rand() * 0.8;
  const rTop = 0.55;
  const rBot = 0.9;
  const stack = cylinderY(rTop, rBot, h, 10);
  pushBaked(acc, { family: 'metal', geo: stack, color: col, aoY: [0, h], aoFloor: 0.4 });
  const ringTs = [0.28, 0.6, 0.9];
  for (const t of ringTs) {
    const ry = t * h;
    const r = THREE.MathUtils.lerp(rBot, rTop, t) + 0.04;
    const ring = cylinderY(r, r, 0.08, 10);
    ring.translate(0, ry, 0);
    pushBaked(acc, { family: 'metal', geo: ring, color: hueShift(palette.obstacle, dh, -0.1), aoY: [0, h], aoFloor: 0.7 });
  }
  const railX = rBot + 0.12;
  const ladderRail = new THREE.BoxGeometry(0.04, h * 0.82, 0.04);
  ladderRail.translate(railX, h * 0.42, 0);
  pushBaked(acc, { family: 'metal', geo: ladderRail, color: hueShift('#1e1e1e', dh), aoY: [0, h], aoFloor: 0.55 });
  const rungCount = 6;
  for (let i = 0; i < rungCount; i += 1) {
    const t = i / (rungCount - 1);
    const ry = 0.3 + t * h * 0.78;
    const rStack = THREE.MathUtils.lerp(rBot, rTop, ry / h);
    const rung = new THREE.BoxGeometry(railX - rStack + 0.05, 0.03, 0.03);
    rung.translate((railX + rStack) / 2, ry, 0);
    pushBaked(acc, { family: 'metal', geo: rung, color: hueShift('#1e1e1e', dh, 0.03), aoY: [0, h], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(1.05, 1.05, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.15, 1.15, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, h);
}

// 24. gastank (4箇所) — 変位アイコサ球形タンク+架台4脚+配管+バルブ
function buildGasTank(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const col = hueShift(palette.obstacle, dh, 0, -0.1);
  const r = 1.95 + rand() * 0.2;
  const legH = 1.15;
  const sphereCy = legH + r * 0.92;
  const sphere = icosaDisplace(r, 1, 0.03, rand, 1);
  sphere.translate(0, sphereCy, 0);
  pushBaked(acc, { family: 'metal', geo: sphere, color: col, aoY: [sphereCy - r, sphereCy + r], aoFloor: 0.55 });
  const equator = cylinderY(r + 0.03, r + 0.03, 0.1, 10);
  equator.translate(0, sphereCy, 0);
  pushBaked(acc, { family: 'metal', geo: equator, color: hueShift(palette.obstacle, dh, -0.1), aoY: [0, sphereCy * 2], aoFloor: 0.65 });
  const legCount = 4;
  for (let i = 0; i < legCount; i += 1) {
    const ang = (i / legCount) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.cos(ang) * r * 0.6;
    const lz = Math.sin(ang) * r * 0.6;
    const leg = cylinderY(0.06, 0.08, legH, 6);
    leg.translate(lx, 0, lz);
    pushBaked(acc, { family: 'metal', geo: leg, color: hueShift(palette.obstacle, dh, -0.08), aoY: [0, legH], aoFloor: 0.5 });
  }
  const pipe = cylinderY(0.09, 0.09, 1.1, 6);
  pipe.rotateZ(Math.PI / 2);
  pipe.translate(-r - 0.4, sphereCy, 0);
  pushBaked(acc, { family: 'metal', geo: pipe, color: hueShift('#4a5258', dh), aoY: [0, sphereCy * 2], aoFloor: 0.6 });
  const valve = cylinderY(0.03, 0.1, 0.22, 6);
  valve.translate(0, sphereCy + r + 0.02, 0);
  pushBaked(acc, { family: 'metal', geo: valve, color: hueShift('#787878', dh), aoY: [0, 1], aoFloor: 0.9 });
  pushPrecolored(acc, 'metal', groundSkirt(r + 0.4, r + 0.4, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(r + 0.5, r + 0.5, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, sphereCy + r + 0.25);
}

// 25. watertower (type予約/未配置) — 旋盤断面タンク+4脚+Xブレース+はしご
function buildWaterTower(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const legH = 5.0 + rand() * 0.4;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.1);
  const legSpread = 1.5;
  const legXZ: Array<[number, number]> = [];
  for (let i = 0; i < 4; i += 1) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.cos(ang) * legSpread;
    const lz = Math.sin(ang) * legSpread;
    legXZ.push([lx, lz]);
    const leg = cylinderY(0.07, 0.1, legH, 6);
    leg.translate(lx, 0, lz);
    pushBaked(acc, { family: 'metal', geo: leg, color: metalCol, aoY: [0, legH], aoFloor: 0.45 });
  }
  for (let i = 0; i < 4; i += 1) {
    const a = legXZ[i];
    const b = legXZ[(i + 1) % 4];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const brace = new THREE.BoxGeometry(len, 0.05, 0.05);
    brace.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
    brace.translate((a[0] + b[0]) / 2, legH * 0.42, (a[1] + b[1]) / 2);
    pushBaked(acc, { family: 'metal', geo: brace, color: hueShift(palette.obstacle, dh, -0.1), aoY: [0, legH], aoFloor: 0.55 });
  }
  const tankR = 1.7 + rand() * 0.2;
  const tank = latheProfile(
    [
      [0.0, 0],
      [0.7, 0.05],
      [tankR, 0.25],
      [tankR, 0.85],
      [0.7, 1.05],
      [0.0, 1.15],
    ],
    10,
  );
  tank.translate(0, legH, 0);
  pushBaked(acc, { family: 'metal', geo: tank, color: hueShift(palette.obstacle, dh, 0.03), aoY: [legH, legH + 1.15], aoFloor: 0.5 });
  const ladderRail = new THREE.BoxGeometry(0.03, legH * 0.9, 0.03);
  ladderRail.translate(legSpread * 0.4, legH * 0.45, 0);
  pushBaked(acc, { family: 'metal', geo: ladderRail, color: hueShift('#1e1e1e', dh), aoY: [0, legH], aoFloor: 0.55 });
  pushPrecolored(acc, 'metal', groundSkirt(legSpread + 0.4, legSpread + 0.4, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(legSpread + 0.5, legSpread + 0.5, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, legH + 1.2);
}

// 26. transformer (4箇所) — 面取り変圧器箱+放熱フィン5枚+碍子3本
function buildTransformer(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const col = hueShift(palette.obstacle, dh, -0.02, -0.1);
  const body = chamferBox(1.9, 1.5, 1.3, 0.04);
  body.translate(0, 0.85, 0);
  pushBaked(acc, { family: 'metal', geo: body, color: col, aoY: [0.1, 1.6], aoFloor: 0.5 });
  const finCount = 5;
  for (let i = 0; i < finCount; i += 1) {
    const t = i / (finCount - 1);
    const fz = (t - 0.5) * 1.1;
    const fin = new THREE.BoxGeometry(0.35, 1.1, 0.08);
    fin.translate(-1.15, 0.75, fz);
    pushBaked(acc, { family: 'metal', geo: fin, color: hueShift(palette.obstacle, dh, -0.08), aoY: [0.2, 1.3], aoFloor: 0.55 });
  }
  const insulatorXs = [-0.5, 0.1, 0.7];
  for (const ix of insulatorXs) {
    const insulator = cylinderY(0.05, 0.13, 0.28, 6);
    insulator.translate(ix, 1.6, 0);
    pushBaked(acc, { family: 'metal', geo: insulator, color: hueShift('#c8c8b8', dh), aoY: [1.6, 1.9], aoFloor: 0.75 });
    const tip = cylinderY(0.02, 0.02, 0.08, 5);
    tip.translate(ix, 1.88, 0);
    pushBaked(acc, { family: 'metal', geo: tip, color: hueShift('#3a3a3a', dh), aoY: [1.6, 2.0], aoFloor: 0.85 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(1.5, 1.1, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.6, 1.2, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 2.05);
}

// 27. antenna (8箇所) — 細マスト12m+ガイワイヤー3本+パラボラ皿+フィード
function buildAntenna(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.15);
  const mastH = 11.2 + rand() * 0.9;
  const mast = cylinderY(0.05, 0.1, mastH, 6);
  pushBaked(acc, { family: 'metal', geo: mast, color: metalCol, aoY: [0, mastH], aoFloor: 0.4 });
  const guyH = mastH * 0.5;
  const guyR = 1.6;
  const upAxis = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 3; i += 1) {
    const ang = (i / 3) * Math.PI * 2;
    const top = new THREE.Vector3(0, guyH, 0);
    const bottom = new THREE.Vector3(Math.cos(ang) * guyR, 0, Math.sin(ang) * guyR);
    const dir = new THREE.Vector3().subVectors(bottom, top);
    const len = dir.length();
    const guy = cylinderY(0.012, 0.012, len, 4);
    const quat = new THREE.Quaternion().setFromUnitVectors(upAxis, dir.clone().normalize());
    guy.applyQuaternion(quat);
    guy.translate(top.x, top.y, top.z);
    pushBaked(acc, { family: 'metal', geo: guy, color: hueShift('#4a4a4a', dh), aoY: [0, guyH], aoFloor: 0.75 });
  }
  const dishR = 0.42 + rand() * 0.1;
  const dishSign = rand() > 0.5 ? 1 : -1;
  const dish = new THREE.ConeGeometry(dishR, 0.2, 8);
  dish.rotateZ((Math.PI / 2) * dishSign);
  dish.translate(0, mastH * 0.86, 0);
  pushBaked(acc, { family: 'metal', geo: dish, color: hueShift(palette.obstacle, dh, 0.04, -0.1), aoY: [mastH * 0.6, mastH], aoFloor: 0.6 });
  const feed = cylinderY(0.015, 0.02, 0.32, 5);
  feed.rotateZ((Math.PI / 2) * dishSign);
  feed.translate(dishSign * 0.28, mastH * 0.86, 0);
  pushBaked(acc, { family: 'metal', geo: feed, color: hueShift('#333333', dh), aoY: [mastH * 0.6, mastH], aoFloor: 0.7 });
  pushPrecolored(acc, 'metal', groundSkirt(1.7, 1.7, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.8, 1.8, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, mastH);
}

// 28. forklift (2箇所) — 面取り車体+ROPS格子+オーバーヘッドガード+マスト格子+フォーク2+車輪4
function buildForklift(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const paintCol = hueShift(palette.accent, dh, 0, -0.05);
  const body = chamferBox(1.3, 1.1, 1.9, 0.05);
  body.translate(0, 0.75, -0.15);
  pushBaked(acc, { family: 'paint', geo: body, color: paintCol, aoY: [0.2, 1.3], aoFloor: 0.55 });
  const rops = boxLattice(0.9, 1.0, 0.06, 2, 3, 0.04);
  for (const bar of rops) {
    bar.translate(0, 1.3, -0.85);
    pushBaked(acc, { family: 'metal', geo: bar, color: hueShift(palette.obstacle, dh, -0.1), aoY: [1.3, 2.3], aoFloor: 0.6 });
  }
  const roof = new THREE.BoxGeometry(1.0, 0.06, 1.0);
  roof.translate(0, 2.33, -0.8);
  pushBaked(acc, { family: 'metal', geo: roof, color: hueShift(palette.obstacle, dh, -0.05), aoY: [2.1, 2.4], aoFloor: 0.85 });
  const mast = boxLattice(0.72, 2.25, 0.12, 2, 3, 0.05);
  for (const bar of mast) {
    bar.translate(0, 0, 0.85);
    pushBaked(acc, { family: 'metal', geo: bar, color: hueShift(palette.obstacle, dh, -0.05), aoY: [0, 2.25], aoFloor: 0.5 });
  }
  for (const fx of [-0.22, 0.22]) {
    const fork = new THREE.BoxGeometry(0.1, 0.06, 1.0);
    fork.translate(fx, 0.15, 1.4);
    pushBaked(acc, { family: 'metal', geo: fork, color: hueShift('#3a3a3a', dh), aoY: [0, 0.3], aoFloor: 0.6 });
  }
  const wheels = wheelArch(0.62, 0.28, 0.2, [-0.5, 0.55], 'z', 6);
  for (const w of wheels) pushBaked(acc, { family: 'metal', geo: w, color: hueShift('#1e1e1e', dh, -0.1), aoY: [0, 0.56], aoFloor: 0.6 });
  pushPrecolored(acc, 'paint', groundSkirt(0.95, 1.55, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.05, 1.65, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 2.5);
}

// 29. watchpost (type予約/未配置) — 高床小屋(4脚+水平ブレース+切妻屋根+はしご)
function buildWatchpost(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const woodCol = hueShift(BROWN, dh, -0.05);
  const legH = 3.7 + rand() * 0.3;
  const legSpread = 1.3;
  const legXZ: Array<[number, number]> = [
    [-legSpread, -legSpread],
    [legSpread, -legSpread],
    [legSpread, legSpread],
    [-legSpread, legSpread],
  ];
  for (const [lx, lz] of legXZ) {
    const leg = cylinderY(0.09, 0.12, legH, 6);
    leg.translate(lx, 0, lz);
    pushBaked(acc, { family: 'wood', geo: leg, color: woodCol, aoY: [0, legH], aoFloor: 0.45 });
  }
  for (let i = 0; i < 4; i += 1) {
    const a = legXZ[i];
    const b = legXZ[(i + 1) % 4];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const brace = new THREE.BoxGeometry(len, 0.05, 0.05);
    brace.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
    brace.translate((a[0] + b[0]) / 2, legH * 0.5, (a[1] + b[1]) / 2);
    pushBaked(acc, { family: 'wood', geo: brace, color: hueShift(BROWN, dh, -0.1), aoY: [0, legH], aoFloor: 0.55 });
  }
  const platform = new THREE.BoxGeometry(legSpread * 2 + 0.4, 0.14, legSpread * 2 + 0.4);
  platform.translate(0, legH, 0);
  pushBaked(acc, { family: 'wood', geo: platform, color: hueShift(BROWN, dh, 0.03), aoY: [legH - 0.1, legH + 0.1], aoFloor: 0.7 });
  const wallH = 1.1;
  for (const [wx, wz] of [
    [0, -legSpread],
    [0, legSpread],
  ] as const) {
    const wall = new THREE.BoxGeometry(legSpread * 1.8, wallH, 0.06);
    wall.translate(wx, legH + wallH / 2 + 0.1, wz);
    pushBaked(acc, { family: 'wood', geo: wall, color: hueShift(BROWN, dh, -0.02), aoY: [legH, legH + wallH], aoFloor: 0.6 });
  }
  for (const side of [-1, 1] as const) {
    const roof = new THREE.BoxGeometry(legSpread * 2.3, 0.06, 1.6);
    roof.rotateZ(side * 0.5);
    roof.translate(side * 0.55, legH + wallH + 0.55, 0);
    pushBaked(acc, { family: 'wood', geo: roof, color: hueShift(BROWN, dh, -0.15), aoY: [legH + wallH, legH + wallH + 1.2], aoFloor: 0.75 });
  }
  const ladderRailZ = -legSpread - 0.05;
  for (const rx of [-0.25, 0.25]) {
    const rail = new THREE.BoxGeometry(0.04, legH * 0.95, 0.04);
    rail.translate(rx, legH * 0.48, ladderRailZ);
    pushBaked(acc, { family: 'wood', geo: rail, color: hueShift(BROWN, dh, -0.08), aoY: [0, legH], aoFloor: 0.55 });
  }
  const rungCount = 6;
  for (let i = 0; i < rungCount; i += 1) {
    const ry = 0.3 + (i / (rungCount - 1)) * legH * 0.75;
    const rung = new THREE.BoxGeometry(0.55, 0.03, 0.03);
    rung.translate(0, ry, ladderRailZ);
    pushBaked(acc, { family: 'wood', geo: rung, color: hueShift(BROWN, dh, -0.05), aoY: [0, legH], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(legSpread + 0.5, legSpread + 0.5, hueShift(BROWN, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(legSpread + 0.6, legSpread + 0.6, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, legH + wallH + 1.3);
}

// 30. tankhull (4箇所) — 面取り装甲車体+前面グラシス+機関室デッキ+履帯2+転輪(砲塔なし)
function buildTankHull(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const armorCol = hueShift(palette.obstacle, dh, -0.02, -0.05);
  const hull = chamferBox(3.6, 1.3, 6.2, 0.12);
  hull.translate(0, 0.85, 0);
  pushBaked(acc, { family: 'paint', geo: hull, color: armorCol, aoY: [0.3, 1.5], aoFloor: 0.5 });
  const deck = chamferBox(1.9, 0.6, 2.4, 0.06);
  deck.translate(0, 1.6, -0.6);
  pushBaked(acc, { family: 'paint', geo: deck, color: hueShift(palette.obstacle, dh, -0.05), aoY: [1.3, 1.9], aoFloor: 0.65 });
  const glacis = new THREE.BoxGeometry(3.3, 0.9, 0.1);
  glacis.rotateX(-0.55);
  glacis.translate(0, 0.9, 3.05);
  pushBaked(acc, { family: 'paint', geo: glacis, color: hueShift(palette.obstacle, dh, 0.03), aoY: [0.4, 1.3], aoFloor: 0.65 });
  const wheelCount = 4;
  for (const side of [-1, 1] as const) {
    const track = new THREE.BoxGeometry(0.6, 0.75, 6.6);
    track.translate(side * 1.85, 0.4, 0);
    pushBaked(acc, { family: 'metal', geo: track, color: hueShift('#26241f', dh, -0.15), aoY: [0, 0.75], aoFloor: 0.5 });
    for (let i = 0; i < wheelCount; i += 1) {
      const t = i / (wheelCount - 1);
      const wz = -2.9 + t * 5.8;
      const wheel = cylinderY(0.32, 0.32, 0.5, 5);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(side * 1.85, 0.36, wz);
      pushBaked(acc, { family: 'metal', geo: wheel, color: hueShift('#1e1e1e', dh, -0.1), aoY: [0, 0.7], aoFloor: 0.55 });
    }
  }
  pushPrecolored(acc, 'paint', groundSkirt(2.4, 3.5, hueShift(palette.obstacle, dh, -0.12), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(2.5, 3.6, 0.4, 10));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 2.0);
}

// 31. scaffold (type予約/未配置) — boxLattice足場2面+足場板2段+斜めブレース
function buildScaffold(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const metalCol = hueShift(palette.obstacle, dh, -0.05, -0.15);
  const h = 3.6 + rand() * 0.3;
  const frame = latticeMastFaces(2.8, 1.8, h, 4, 0.045);
  for (const g of frame) pushBaked(acc, { family: 'metal', geo: g, color: metalCol, aoY: [0, h], aoFloor: 0.45 });
  const plankLevels = [h * 0.5, h];
  for (const py of plankLevels) {
    const plank = new THREE.BoxGeometry(2.6, 0.05, 1.6);
    plank.translate(0, py, 0);
    pushBaked(acc, { family: 'wood', geo: plank, color: hueShift(BROWN, dh, 0.02), aoY: [py - 0.1, py + 0.1], aoFloor: 0.7 });
  }
  for (const side of [-1, 1] as const) {
    const brace = new THREE.BoxGeometry(0.04, Math.hypot(2.8, h), 0.04);
    brace.rotateZ(side * Math.atan2(2.8, h));
    brace.translate(0, h / 2, side * 0.9);
    pushBaked(acc, { family: 'metal', geo: brace, color: hueShift(palette.obstacle, dh, -0.1), aoY: [0, h], aoFloor: 0.6 });
  }
  pushPrecolored(acc, 'metal', groundSkirt(1.6, 1.1, hueShift(palette.obstacle, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.7, 1.2, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, h + 0.2);
}

// 32. pallet (6箇所) — 支持ブロック6+桟板積層6
function buildPallet(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const blockH = 0.12;
  for (const bx of [-0.55, 0, 0.55]) {
    for (const bz of [-0.35, 0.35]) {
      const block = new THREE.BoxGeometry(0.14, blockH, 0.14);
      block.translate(bx, blockH / 2, bz);
      pushBaked(acc, { family: 'wood', geo: block, color: hueShift(BROWN, dh, -0.05), aoY: [0, blockH], aoFloor: 0.5 });
    }
  }
  const deckY = blockH + 0.02;
  const slatCount = 6;
  for (let i = 0; i < slatCount; i += 1) {
    const t = i / (slatCount - 1);
    const sx = -0.6 + t * 1.2;
    const slat = new THREE.BoxGeometry(0.16, 0.03, 0.85);
    slat.translate(sx, deckY, 0);
    pushBaked(acc, { family: 'wood', geo: slat, color: hueShift(BROWN, dh + (rand() - 0.5) * 0.03, i % 2 === 0 ? 0.02 : -0.02), aoY: [deckY - 0.02, deckY + 0.05], aoFloor: 0.65 });
  }
  pushPrecolored(acc, 'wood', groundSkirt(0.7, 0.5, hueShift(BROWN, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.75, 0.55, 0.28, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 0.25);
}

// 33. torii (6箇所) — 笠木/島木反り(archBendX)+2柱+石台+貫+額束、朱色固定
function buildTorii(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const red = hueShift(VERMILLION, dh, 0, -0.02);
  const pillarH = 3.6 + rand() * 0.2;
  const pillarSpread = 1.55;
  for (const px of [-pillarSpread, pillarSpread]) {
    const pillar = cylinderY(0.16, 0.19, pillarH, 8);
    pillar.translate(px, 0, 0);
    pushBaked(acc, { family: 'paint', geo: pillar, color: red, aoY: [0, pillarH], aoFloor: 0.5 });
    const base = cylinderY(0.22, 0.22, 0.12, 8);
    base.translate(px, 0, 0);
    pushBaked(acc, { family: 'stone', geo: base, color: hueShift(STONE, dh), aoY: [0, 0.15], aoFloor: 0.6 });
  }
  const nuki = new THREE.BoxGeometry((pillarSpread + 0.25) * 2, 0.22, 0.22);
  nuki.translate(0, pillarH * 0.72, 0);
  pushBaked(acc, { family: 'paint', geo: nuki, color: red, aoY: [0, pillarH], aoFloor: 0.6 });
  const gakuzuka = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  gakuzuka.translate(0, pillarH * 0.72 + 0.35, 0);
  pushBaked(acc, { family: 'paint', geo: gakuzuka, color: red, aoY: [0, pillarH], aoFloor: 0.65 });
  const kasagiLen = (pillarSpread + 0.55) * 2;
  const kasagi = new THREE.BoxGeometry(kasagiLen, 0.28, 0.5);
  archBendX(kasagi, kasagiLen / 2, 0.3);
  kasagi.translate(0, pillarH + 0.14, 0);
  pushBaked(acc, { family: 'paint', geo: kasagi, color: red, aoY: [0, pillarH + 0.5], aoFloor: 0.65 });
  const shimakiLen = kasagiLen + 0.3;
  const shimaki = new THREE.BoxGeometry(shimakiLen, 0.12, 0.62);
  archBendX(shimaki, shimakiLen / 2, 0.32);
  shimaki.translate(0, pillarH + 0.36, 0);
  pushBaked(acc, { family: 'paint', geo: shimaki, color: hueShift(VERMILLION, dh, 0, 0.05), aoY: [0, pillarH + 0.5], aoFloor: 0.7 });
  pushPrecolored(acc, 'paint', groundSkirt(pillarSpread + 0.6, 0.6, hueShift(VERMILLION, dh, -0.1, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(pillarSpread + 0.7, 0.7, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, pillarH + 0.6);
}

// 34. well (8箇所) — 石積みリング2段+屋形(2柱+梁+切妻屋根)+滑車+釣瓶
function buildWell(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.04;
  const stoneCol = hueShift(STONE, dh);
  const ringR = 0.75 + rand() * 0.1;
  const ringH = 0.55;
  const ringOuter = cylinderY(ringR + 0.08, ringR + 0.1, ringH, 10);
  pushBaked(acc, { family: 'stone', geo: ringOuter, color: stoneCol, aoY: [0, ringH], aoFloor: 0.5 });
  const ringInner = cylinderY(ringR, ringR, ringH + 0.02, 10);
  pushBaked(acc, { family: 'stone', geo: ringInner, color: hueShift(STONE, dh, -0.08), aoY: [0, ringH], aoFloor: 0.4 });
  const postH = 1.5;
  for (const side of [-1, 1] as const) {
    const post = cylinderY(0.05, 0.06, postH, 6);
    post.translate(side * (ringR + 0.15), ringH, 0);
    pushBaked(acc, { family: 'wood', geo: post, color: hueShift(BROWN, dh, -0.05), aoY: [ringH, ringH + postH], aoFloor: 0.5 });
  }
  const beam = new THREE.BoxGeometry((ringR + 0.15) * 2 + 0.15, 0.08, 0.08);
  beam.translate(0, ringH + postH, 0);
  pushBaked(acc, { family: 'wood', geo: beam, color: hueShift(BROWN, dh, -0.02), aoY: [0, ringH + postH], aoFloor: 0.65 });
  for (const side of [-1, 1] as const) {
    const roof = new THREE.BoxGeometry(ringR * 2 + 0.5, 0.05, 0.85);
    roof.rotateZ(side * 0.5);
    roof.translate(side * 0.35, ringH + postH + 0.35, 0);
    pushBaked(acc, { family: 'wood', geo: roof, color: hueShift(BROWN, dh, -0.15), aoY: [ringH + postH, ringH + postH + 0.7], aoFloor: 0.75 });
  }
  const pulley = cylinderY(0.09, 0.09, 0.06, 8);
  pulley.rotateZ(Math.PI / 2);
  pulley.translate(0, ringH + postH - 0.05, 0);
  pushBaked(acc, { family: 'metal', geo: pulley, color: hueShift('#5a5a5a', dh), aoY: [0, ringH + postH], aoFloor: 0.7 });
  const rope = cylinderY(0.012, 0.012, postH * 0.55, 4);
  rope.translate(0, ringH + postH * 0.45, 0);
  pushBaked(acc, { family: 'wood', geo: rope, color: hueShift('#c8b078', dh), aoY: [0, ringH + postH], aoFloor: 0.6 });
  const bucket = cylinderY(0.14, 0.11, 0.18, 8);
  bucket.translate(0, ringH + 0.05, 0);
  pushBaked(acc, { family: 'wood', geo: bucket, color: hueShift(BROWN, dh, -0.1), aoY: [ringH, ringH + 0.2], aoFloor: 0.55 });
  pushPrecolored(acc, 'stone', groundSkirt(ringR + 0.4, ringR + 0.4, hueShift(STONE, dh, -0.1), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(ringR + 0.5, ringR + 0.5, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, ringH + postH + 0.75);
}

// 35. utilitypole (type予約/未配置) — 電柱+腕金2段+碍子4+ケーブル垂れ2+柱上変圧器
function buildUtilityPole(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.03;
  const woodCol = hueShift(BROWN, dh, -0.1, -0.1);
  const poleH = 8.2 + rand() * 0.5;
  const pole = cylinderY(0.11, 0.17, poleH, 8);
  pushBaked(acc, { family: 'wood', geo: pole, color: woodCol, aoY: [0, poleH], aoFloor: 0.4 });
  const armY = poleH * 0.92;
  const arm = new THREE.BoxGeometry(1.9, 0.09, 0.09);
  arm.translate(0, armY, 0);
  pushBaked(acc, { family: 'wood', geo: arm, color: hueShift(BROWN, dh, -0.05), aoY: [armY - 0.2, armY + 0.2], aoFloor: 0.65 });
  const arm2Y = poleH * 0.8;
  const arm2 = new THREE.BoxGeometry(1.3, 0.08, 0.08);
  arm2.translate(0, arm2Y, 0);
  pushBaked(acc, { family: 'wood', geo: arm2, color: hueShift(BROWN, dh, -0.05), aoY: [arm2Y - 0.2, arm2Y + 0.2], aoFloor: 0.65 });
  const insulatorXs = [-0.85, -0.3, 0.3, 0.85];
  for (const ix of insulatorXs) {
    const ins = cylinderY(0.04, 0.09, 0.16, 6);
    ins.translate(ix, armY + 0.09, 0);
    pushBaked(acc, { family: 'metal', geo: ins, color: hueShift('#c8c8b8', dh), aoY: [armY, armY + 0.3], aoFloor: 0.8 });
    if (Math.abs(ix) > 0.5) {
      const cableLen = 1.1 + rand() * 0.4;
      const cable = cylinderY(0.012, 0.012, cableLen, 4);
      cable.translate(ix, armY - cableLen + 0.08, 0.12);
      pushBaked(acc, { family: 'metal', geo: cable, color: hueShift('#222222', dh), aoY: [0, poleH], aoFloor: 0.85 });
    }
  }
  const transformerBox = new THREE.BoxGeometry(0.4, 0.55, 0.32);
  transformerBox.translate(0.28, poleH * 0.55, 0);
  pushBaked(acc, { family: 'metal', geo: transformerBox, color: hueShift(palette.obstacle, dh, -0.05), aoY: [0, poleH], aoFloor: 0.55 });
  pushPrecolored(acc, 'wood', groundSkirt(0.35, 0.35, hueShift(BROWN, dh, -0.15), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(0.6, 0.6, 0.3, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, poleH);
}

// 36. supplycrate (2箇所) — 面取り木箱+帯金2+ステンシル風アクセント+小箱1
function buildSupplyCrate(cx: number, cz: number, baseY: number, rot: number, scale: number, rand: Rand, palette: PropVisualPalette): PropVisualResult {
  const acc: FamilyAcc = new Map();
  const dh = (rand() - 0.5) * 0.05;
  const woodCol = hueShift(BROWN, dh, 0.06);
  const crate = chamferBox(1.05, 0.85, 1.05, 0.03);
  crate.translate(0, 0.45, 0);
  pushBaked(acc, { family: 'wood', geo: crate, color: woodCol, aoY: [0.05, 0.85], aoFloor: 0.55 });
  const strapX = new THREE.BoxGeometry(1.12, 0.9, 0.09);
  strapX.translate(0, 0.45, 0.46);
  pushBaked(acc, { family: 'metal', geo: strapX, color: hueShift('#4a3a24', dh, -0.15), aoY: [0.05, 0.85], aoFloor: 0.6 });
  const strapZ = new THREE.BoxGeometry(0.09, 0.9, 1.12);
  strapZ.translate(0.46, 0.45, 0);
  pushBaked(acc, { family: 'metal', geo: strapZ, color: hueShift('#4a3a24', dh, -0.15), aoY: [0.05, 0.85], aoFloor: 0.6 });
  const stencil = new THREE.BoxGeometry(0.4, 0.24, 0.02);
  stencil.translate(0, 0.55, 0.535);
  pushBaked(acc, { family: 'accent', geo: stencil, color: new THREE.Color(palette.accent), aoY: [0, 1], aoFloor: 1 });
  const secondCrate = chamferBox(0.7, 0.6, 0.7, 0.025);
  secondCrate.translate(0.62, 0.3, 0.55);
  pushBaked(acc, { family: 'wood', geo: secondCrate, color: hueShift(BROWN, dh, -0.03), aoY: [0.05, 0.6], aoFloor: 0.6 });
  pushPrecolored(acc, 'wood', groundSkirt(1.05, 1.05, hueShift(BROWN, dh, -0.12), floorRim(palette), 8));
  pushPrecolored(acc, 'shadow', radialShadow(1.15, 1.15, 0.35, 8));
  return finalize(acc, cx, cz, baseY, rot, scale, rand, 0.95);
}

// ── データ駆動レジストリ: 1 kind = 1 関数。(R53-W2: B-ENV1が前半18種、B-ENV2が後半18種を実装、計36種=全PropKind網羅) ──
const BUILDERS: Partial<Record<string, PropBuilder>> = {
  rock: buildRock,
  concretebarrier: buildConcreteBarrier,
  rubble: buildRubble,
  fence: buildFence,
  stonelantern: buildStoneLantern,
  bench: buildBench,
  streetlight: buildStreetlight,
  deadtree: buildDeadTree,
  derelictcar: buildDerelictCar,
  truck: buildTruck,
  signboard: buildSignboard,
  conifer: buildConifer,
  drumgroup: buildDrumGroup,
  broadleaf: buildBroadleaf,
  barricadecar: buildBarricadeCar,
  gasbottlegroup: buildGasBottleGroup,
  pier: buildPier,
  vendingmachine: buildVendingMachine,
  sakura: buildSakura,
  bamboo: buildBamboo,
  towercrane: buildTowerCrane,
  portalkrane: buildPortalKrane,
  smokestack: buildSmokestack,
  gastank: buildGasTank,
  watertower: buildWaterTower,
  transformer: buildTransformer,
  antenna: buildAntenna,
  forklift: buildForklift,
  watchpost: buildWatchpost,
  tankhull: buildTankHull,
  scaffold: buildScaffold,
  pallet: buildPallet,
  torii: buildTorii,
  well: buildWell,
  utilitypole: buildUtilityPole,
  supplycrate: buildSupplyCrate,
};

/** 実装済み kind 一覧(全36種 = stage.ts PropKind 全網羅)。未実装kindは存在しないが、
 * 将来 PropKind が増えた場合はこれに含まれない kind を既存の箱ビジュアルへフォールバックする。 */
export const PROP_VISUAL_KINDS: readonly string[] = Object.keys(BUILDERS);

/**
 * プロップ超リアル化ビジュアルを生成する。未実装 kind は null(呼び出し側は既存の箱ビジュアルへ
 * フォールバックすること)。戻り値の各ジオメトリはワールド座標へ焼き込み済み。
 */
export function buildPropVisual(
  kind: string,
  cx: number,
  cz: number,
  baseY: number,
  rot: number,
  scale: number,
  rand: Rand,
  palette: PropVisualPalette,
): PropVisualResult | null {
  const fn = BUILDERS[kind];
  if (!fn) return null;
  return fn(cx, cz, baseY, rot, scale, rand, palette);
}
