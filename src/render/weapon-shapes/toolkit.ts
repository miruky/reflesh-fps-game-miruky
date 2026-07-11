// R58 ジオメトリ toolkit(頂点カラーを焼く低レベル関数 + painter 公開API)。
// 旧 viewmodel.ts の chamferBox/col/setColor と生成パス内クロージャ(bake/boxP/tubeZ/coneZ/
// bakeAt/buildRailTop/accentLine)を PainterCtx として公開する。Phase C の painter は
// ctx だけで固有外装を描ける(サイト系ジオメトリは buildGunBody 本体が描くので触らない)。
import * as THREE from 'three';
import type { CamoId } from '../../game/camo';
import type { WeaponDef } from '../../game/weapons';
import type { DetailSpec, ShadeMode, Silhouette } from './types';

// gun ローカル座標系: -Z が前方、BARREL_Y が銃身中心高さ。
const _colCache = new Map<number, THREE.Color>();
export function col(hex: number): THREE.Color {
  let c = _colCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    _colCache.set(hex, c);
  }
  return c;
}

// 頂点カラーを焼く。flat 以外は gun ローカルYの上明下暗で擬似AO(エッジ・面の陰影)を作る。
export function setColor(g: THREE.BufferGeometry, color: THREE.Color, shade: ShadeMode): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  if (shade === 'flat') {
    for (let i = 0; i < n; i += 1) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
  } else {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(1e-5, maxY - minY);
    for (let i = 0; i < n; i += 1) {
      const t = (pos.getY(i) - minY) / span;
      let f: number;
      if (shade === 'gradY') {
        f = 0.8 + 0.24 * t; // 下=0.80 / 上=1.04(軽い立体感)
      } else if (shade === 'machined') {
        // 削り出し鋼: 下暗→上明の急勾配 + 上稜(t>0.86)にベベルハイライト。
        // 面内の微細縞(sin)は cyl16/ExtrudeGeometry の頂点密度では塗れず2トーンの
        // artifact になるため入れない(勾配 + 稜線ベベルで削り出し感を出す)。
        f = 0.72 + 0.3 * t + (t > 0.86 ? 0.22 : 0);
      } else {
        // edgeHi: 研磨リム。上端へ向け二次で持ち上げてエッジを強く光らせる
        f = 0.68 + 0.52 * t * t;
      }
      arr[i * 3] = color.r * f;
      arr[i * 3 + 1] = color.g * f;
      arr[i * 3 + 2] = color.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// 面取りボックス(丸角矩形をZ押し出し+前後ベベル)。箱っぽさを消すヒーロー面用。
// 実寸で生成し bakeAt でスケール1配置する(ベベル幅を歪ませないため)。非indexed。
export function chamferBox(w: number, h: number, d: number, bevel: number): THREE.BufferGeometry {
  const b = Math.max(0.0008, Math.min(bevel, w * 0.5 - 1e-3, h * 0.5 - 1e-3, d * 0.5 - 1e-3));
  const hw = w / 2;
  const hh = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + b, -hh);
  s.lineTo(hw - b, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + b);
  s.lineTo(hw, hh - b);
  s.quadraticCurveTo(hw, hh, hw - b, hh);
  s.lineTo(-hw + b, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - b);
  s.lineTo(-hw, -hh + b);
  s.quadraticCurveTo(-hw, -hh, -hw + b, -hh);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, d - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb) {
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  }
  return geo;
}

// ⑤ BO3寒色化パレット(旧 buildGunBody ローカル C_*)。painter/generic-pass 共通の単一真実源。
// どれも arm hex 0x2b2e34/0x161820 と不一致(監査済み)。WOOD/BRASS は暖寒コントラスト維持で据置。
export const PAL = {
  BASE: 0x2c3340,
  DARK: 0x20242c,
  BARREL: 0x181b22,
  RAIL: 0x14171e,
  RIM: 0x515f74,
  GROOVE: 0x101319,
  POLISH: 0x424b58,
  POLISH_HI: 0x5a6a80,
  POLY: 0x191c22,
  GRIP: 0x21242b,
  WOOD: 0x5b3d24,
  WOOD_HI: 0x6d4a2c,
  BRASS: 0x8a6a2c,
} as const;

// 可動ノード(name='vm:*', rest=identity)。系統バケツを持ち最後に merge して Group へ。
export interface Movable {
  group: THREE.Group;
  metal: THREE.BufferGeometry[];
  polish: THREE.BufferGeometry[];
  poly: THREE.BufferGeometry[];
}

type Family = THREE.BufferGeometry[];
// 単位テンプレ(box/cyl)をスケール・回転で焼く
export type BakeFn = (
  family: Family, tpl: THREE.BufferGeometry, color: number,
  px: number, py: number, pz: number, sx: number, sy: number, sz: number,
  rx?: number, ry?: number, rz?: number, shade?: ShadeMode,
) => void;
// 実寸ジオメトリ(chamferBox/cone/torus/sphere)を所有・配置(スケール1)
export type BakeAtFn = (
  family: Family, geo: THREE.BufferGeometry, color: number,
  px: number, py: number, pz: number,
  rx?: number, ry?: number, rz?: number, shade?: ShadeMode,
) => void;
export type BoxPFn = (
  family: Family, color: number, w: number, h: number, d: number,
  px: number, py: number, pz: number,
  rx?: number, ry?: number, rz?: number, shade?: ShadeMode,
) => void;
export type TubeZFn = (
  family: Family, color: number, radius: number, len: number,
  px: number, py: number, pz: number, round?: boolean, shade?: ShadeMode,
) => void;
export type ConeZFn = (
  family: Family, color: number, rBack: number, rFront: number, len: number,
  px: number, py: number, pz: number, shade?: ShadeMode,
) => void;

// buildGunBody 汎用パスが merge 直前に呼ぶ painter。ctx だけで固有外装を描く。
export interface PainterCtx {
  // 系統バケツ(merge先)。painter はここへ外装 geo を bake する。
  metalParts: Family;
  polishParts: Family;
  polyParts: Family;
  accentParts: Family;
  // det.accentEmissive ? accentParts : metalParts(発光帯の行き先)
  accentFam: Family;
  // 焼き込み一時 geo の破棄リスト(baker が push 済み。直接 geo を作る場合はここへ push)
  temps: Family;
  // ── baker(現行 buildGunBody クロージャ) ──
  bake: BakeFn;
  bakeAt: BakeAtFn;
  boxP: BoxPFn;
  tubeZ: TubeZFn;
  coneZ: ConeZFn;
  buildRailTop: (len: number, z0: number, yTop: number, width: number) => void;
  accentLine: (w: number, h: number, d: number, x: number, y: number, z: number) => void;
  // 可動ノード生成(vm:* / rest=identity)
  newMovable: (name: string) => Movable;
  // ── pure helper ──
  chamferBox: typeof chamferBox;
  col: typeof col;
  // ── パレット ──
  C: typeof PAL;
  // ── 寸法(per-call) ──
  bs: number;
  gauge: number;
  barR: number;
  barLen: number;
  recD: number;
  recHalf: number;
  barCenterZ: number;
  barFrontZ: number;
  BARREL_Y: number;
  r: { w: number; h: number; d: number };
  // ── 文脈 ──
  gun: THREE.Group;
  def: WeaponDef;
  sil: Silhouette;
  det: DetailSpec;
  camoId: CamoId | null;
}

export type ShapePainter = (ctx: PainterCtx) => void;
