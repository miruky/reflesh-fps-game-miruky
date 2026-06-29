// スコープ演出の純粋ロジック。覗き込み中の微小な揺れ(リサージュ)と、
// 息止め(ホールドブレス)メーターの増減を扱う。THREE非依存・確定的・無確保。

export const BREATH_MAX_S = 1.5;
export const BREATH_DRAIN = 1.0; // 息を止めている間の消費(/秒)
export const BREATH_REFILL = 0.6; // 離している間の回復(/秒)
// 通常の覗き込み揺れ幅(度)。息止め中は0へ寄せる
export const SWAY_AMP_DEG = 0.35;

// 2つの非整数比の正弦で8の字状に漂わせる。ampDeg<=0なら無振動
export function lissajousSway(elapsedS: number, ampDeg: number): { x: number; y: number } {
  if (ampDeg <= 0) return { x: 0, y: 0 };
  return {
    x: ampDeg * Math.sin(elapsedS * 0.9),
    y: ampDeg * 0.7 * Math.sin(elapsedS * 1.3 + 1.1),
  };
}

export interface BreathOpts {
  max?: number;
  drain?: number;
  refill?: number;
}

// 息止め中はメーターを消費、離すと回復。steadyは「止めていて、かつ息が残っている」間だけ真
export function breathStep(
  meter: number,
  dtS: number,
  holding: boolean,
  opts?: BreathOpts,
): { meter: number; steady: boolean } {
  const max = opts?.max ?? BREATH_MAX_S;
  const drain = opts?.drain ?? BREATH_DRAIN;
  const refill = opts?.refill ?? BREATH_REFILL;
  let m = meter + (holding ? -drain : refill) * dtS;
  if (m < 0) m = 0;
  else if (m > max) m = max;
  return { meter: m, steady: holding && m > 0 };
}
