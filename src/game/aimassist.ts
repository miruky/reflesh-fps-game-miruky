// エイムアシストの純粋ロジック。THREEやゲーム状態に依存せず、角度・距離・dtだけで
// 「どれだけ照準を寄せるか」を決める。ハードロックにならないよう全て上限付き。
// match.ts がスコープ覗き込み中にだけ呼び出す。

const DEG = Math.PI / 180;

// 索敵円錐(この外なら一切作用しない)と全効果円錐(この内なら最大)
export const ACQUIRE_CONE_DEG = 6.0;
export const FULL_CONE_DEG = 1.2;
// 吸着の最大角速度(度/秒)。これ以上は決して動かさない
export const MAX_PULL_DEG_PER_S = 30;
// 距離減衰: この距離まで満額、DIST_FLOOR_MでDIST_FLOORまで線形に落ちる
export const DIST_FULL_M = 40;
export const DIST_FLOOR_M = 140;
export const DIST_FLOOR = 0.4;
// 弾道補正(バレットマグネティズム)の円錐と最大曲げ角(度)。
// 距離減衰(distanceFactor)と併用して遠距離でアイムボット化しないよう控えめにする
export const BULLET_MAG_CONE_DEG = 0.9;
export const BULLET_MAG_MAX_DEG = 0.5;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// 角度が小さいほど1へ。fullRad以下で1、acquireRad以上で0、間はなめらかに補間
export function angleFactor(angleRad: number, acquireRad: number, fullRad: number): number {
  return 1 - smoothstep(fullRad, acquireRad, angleRad);
}

// 近いほど1。DIST_FULL_M以下で1、DIST_FLOOR_MでDIST_FLOOR、maxRangeMを超えると0
export function distanceFactor(distM: number, maxRangeM: number): number {
  if (distM > maxRangeM) return 0;
  if (distM <= DIST_FULL_M) return 1;
  if (distM >= DIST_FLOOR_M) return DIST_FLOOR;
  const t = (distM - DIST_FULL_M) / (DIST_FLOOR_M - DIST_FULL_M);
  return 1 - t * (1 - DIST_FLOOR);
}

// ターゲット付近でマウス感度を落とす「スローダウン」。円錐中心で最大maxSlow減衰
export function slowdownFactor(angleRad: number, coneRad: number, maxSlow: number): number {
  if (coneRad <= 0) return 1;
  const f = clamp(1 - angleRad / coneRad, 0, 1);
  return 1 - maxSlow * f;
}

// 角度を[-PI,PI]へ畳む。yawの差分が一周分ずれて暴れないようにする
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
}

export interface AimAssistArgs {
  curYaw: number;
  curPitch: number;
  tgtYaw: number;
  tgtPitch: number;
  angleRad: number; // 現在の照準とターゲットの間の角度
  distanceM: number;
  dtS: number;
  strength: number; // 0..1(設定値×各種ゲート)
  maxRangeM: number;
}

// 各軸を「不足分」と「rate*dt」の小さい方だけ動かす。決して行き過ぎない＝ロックしない
export function aimAssistDelta(args: AimAssistArgs): { dYaw: number; dPitch: number } {
  const { curYaw, curPitch, tgtYaw, tgtPitch, angleRad, distanceM, dtS, strength, maxRangeM } = args;
  const aF = angleFactor(angleRad, ACQUIRE_CONE_DEG * DEG, FULL_CONE_DEG * DEG);
  const dF = distanceFactor(distanceM, maxRangeM);
  const rate = MAX_PULL_DEG_PER_S * DEG * strength * aF * dF;
  if (rate <= 0) return { dYaw: 0, dPitch: 0 };
  const maxStep = rate * dtS;
  const dYawRaw = wrapAngle(tgtYaw - curYaw);
  const dPitchRaw = tgtPitch - curPitch;
  const dYaw = Math.sign(dYawRaw) * Math.min(Math.abs(dYawRaw), maxStep);
  const dPitch = Math.sign(dPitchRaw) * Math.min(Math.abs(dPitchRaw), maxStep);
  return { dYaw, dPitch };
}

// 弾道を何割ターゲットへ寄せるか(0..1)。最大maxBendRadだけ曲げ、近ければ全部寄せる
export function bulletBendFraction(angleRad: number, maxBendRad: number): number {
  if (maxBendRad <= 0) return 0;
  if (angleRad <= 1e-6) return 1;
  return clamp(maxBendRad / angleRad, 0, 1);
}

// ADS感度の焦点距離パリティ。ズーム倍率に応じて感度を落とし、mulで微調整する。
// progress=0で1倍、=1で (tan(adsFov/2)/tan(baseFov/2))*mul
export function adsSensScale(
  baseFovDeg: number,
  adsFovScale: number,
  mul: number,
  progress: number,
): number {
  const baseFov = baseFovDeg * DEG;
  const adsFov = baseFovDeg * adsFovScale * DEG;
  const full = (Math.tan(adsFov / 2) / Math.tan(baseFov / 2)) * mul;
  return 1 + (full - 1) * clamp(progress, 0, 1);
}
