import type { StagePalette } from './stage';

// 表面材質の7分類。着弾音・足音・被弾エフェクトの分岐に使う。
// hibanaはアセットレスなので材質メタデータを持たず、パレット色から
// ヒューリスティックで導出する(ステージ追加時のデータ二重管理を避けるため)。
export type SurfaceMaterial = 'concrete' | 'metal' | 'sand' | 'dirt' | 'snow' | 'grass' | 'wood';

export interface SurfaceSet {
  floor: SurfaceMaterial;
  wall: SurfaceMaterial;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

// '#rrggbb' 1色から材質を推定する純関数。
// 判定は上から先勝ち。無彩色系(snow/metal/concrete)を先に確定させないと、
// ほぼ灰色の床でも僅かな色相差で grass/sand に吸われてしまうため、
// 彩度の低い順 → 色相優勢の順に並べている。
function classifyColor(hex: string): SurfaceMaterial {
  // 短縮hex('#fff')や不正文字列はゲームを止めず concrete に落とす。
  // 材質は演出差分でしかないので、落ちるより無難な既定が正しい。
  if (!HEX6.test(hex)) return 'concrete';
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;

  // Rec.601 の輝度と、HSV系の彩度 (max-min)/max。真っ黒(max=0)は彩度0扱い。
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;

  if (sat < 0.1 && luma > 0.78) return 'snow'; // ほぼ白の無彩色=雪面
  if (sat < 0.12 && luma < 0.45) return 'metal'; // 暗い無彩色=鉄板・鉄骨
  if (sat < 0.14) return 'concrete'; // 中明度の無彩色=打ちっぱなし
  if (g >= r && g >= b) return 'grass'; // 緑優勢=芝・植生
  if (r > g && g > b && luma > 0.55) return 'sand'; // 明るい暖色勾配=砂
  if (r > g && g > b) return 'dirt'; // 暗い暖色勾配=土
  return 'wood'; // 残り(青紫寄りの有彩色など)は木材扱い
}

// パレットから床・壁の材質セットを導出する。
// wall には外周壁色(palette.wall)ではなく palette.obstacle を使う。
// 戦闘中に被弾するのはほぼ遮蔽物の箱であり、音の材質はそちらに合わせたいため。
export function deriveSurfaceMaterials(palette: StagePalette): SurfaceSet {
  return {
    floor: classifyColor(palette.floor),
    wall: classifyColor(palette.obstacle),
  };
}
