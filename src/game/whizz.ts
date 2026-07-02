// 弾丸のヒュン音(whizz)は「弾道が耳のどれだけ近くを通ったか」で決まる。
// audio層はTHREEに依存しないため、Vector3を要求せず構造的に互換な
// プレーンオブジェクトを受ける純関数として切り出している。
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// 弾道線分 origin + dir*t (t∈[0, segLen], dirは正規化済み前提) と耳 ear の最近接。
// along: 最近接点の弾道上パラメータ(手前停弾・背後発射でも線分内にクランプする。
//        クランプしないと壁で止まった弾が「延長線上の耳」に鳴ってしまうため)
// dist:  最近接点から耳までの距離
export function closestApproach(
  origin: Vec3Like,
  dir: Vec3Like,
  segLen: number,
  ear: Vec3Like,
): { dist: number; along: number } {
  const t = (ear.x - origin.x) * dir.x + (ear.y - origin.y) * dir.y + (ear.z - origin.z) * dir.z;
  const along = Math.min(segLen, Math.max(0, t));
  const cx = origin.x + dir.x * along;
  const cy = origin.y + dir.y * along;
  const cz = origin.z + dir.z * along;
  const dist = Math.hypot(ear.x - cx, ear.y - cy, ear.z - cz);
  return { dist, along };
}
