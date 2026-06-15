// UIモーション用のイージング。0..1の進捗tを受けて0..1を返す純粋関数。
// 範囲外のtは端でクランプし、アニメーションが破綻しないようにする。

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// 終端でゆるやかに減速する。数値のカウントアップなどに使う
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

// より強い減速。入場の余韻を長く見せたいときに
export function easeOutQuint(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
}

// fromからtoへ進捗pで補間する
export function lerp(from: number, to: number, p: number): number {
  return from + (to - from) * clamp01(p);
}
