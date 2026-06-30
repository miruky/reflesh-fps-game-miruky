// エイムアシストの純粋ロジック。THREEやゲーム状態に依存せず、角度・距離・dtだけで
// 「どれだけ照準を寄せるか」を決める。ハードロックにならないよう全て上限付き。
// match.ts がスコープ覗き込み中にだけ呼び出す。

const DEG = Math.PI / 180;

// 索敵円錐(この外なら一切作用しない)と全効果円錐(この内なら最大)
export const ACQUIRE_CONE_DEG = 6.0;
export const FULL_CONE_DEG = 1.2;
// 吸着の最大角速度(度/秒)。これ以上は決して動かさない
export const MAX_PULL_DEG_PER_S = 24;
// 距離減衰: この距離まで満額、DIST_FLOOR_MでDIST_FLOORまで線形に落ちる
export const DIST_FULL_M = 40;
export const DIST_FLOOR_M = 140;
export const DIST_FLOOR = 0.4;
// 弾道補正(バレットマグネティズム)の円錐と最大曲げ角(度)。
// 距離減衰(distanceFactor)と併用して遠距離でアイムボット化しないよう控えめにする
export const BULLET_MAG_CONE_DEG = 0.9;
export const BULLET_MAG_MAX_DEG = 0.5;
// スコープ覗き込み中(クイックスコープ成立後)はやや広く強く曲げる。
// それでも距離減衰込みで「ほぼ当たっている弾」だけを吸い込む量に留める
export const BULLET_MAG_CONE_SCOPED_DEG = 1.5;
export const BULLET_MAG_MAX_SCOPED_DEG = 0.8;

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

// 覗き込んだ瞬間(scope-in立ち上がり)の1回限りのスナップ補正量(ラジアン)。
// BO2の「ADS中オートエイム」の正体。誤差の15%だけ・上限1.5°・strength=0で0。
// 誤差より小さい量しか返さない＝オーバーシュート(エイムボット化)しない。
export function snapPulse(errorRad: number, strength: number): number {
  const s = clamp(strength, 0, 1);
  return Math.min(Math.abs(errorRad) * 0.15, 1.5 * DEG) * s;
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

// ── ゲームパッド: 回転エイムアシスト(RAA)─────────────────────────
// スティックを倒している間だけ、ターゲットの画面横角速度の一定割合をカメラに追従させる。
// 静止狙撃中(stickMag<=deadzone)は一切干渉しない。中心吸着(magnetism)とは別の層。
export const RAA_FOLLOW = 0.7; // ターゲット角速度の追従率(0.65-0.80)

export function rotationalAssist(
  targetYawRateRad: number,
  stickMag: number,
  strength: number,
  dt: number,
  deadzone: number,
): number {
  if (stickMag <= deadzone) return 0;
  return targetYawRateRad * RAA_FOLLOW * clamp(strength, 0, 1) * dt;
}

// ── 最近接部位エイムアシスト ─────────────────────────────────────
// 敵1体につき頭/胸/腰/脚の複数候補点を生成し、照準(forward)に角度的に最も近い点を
// 選べるようランク付けする純関数。可視判定は match.ts 側に残すので、ここでは幾何のみ。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type AimPart = 'head' | 'chest' | 'waist' | 'limb';

// 敵の中心(bot.position)からの高さオフセット dy。
// biasDeg は選択時の角度前倒し量(度)。head のみ近接タイ時に頭を選ばせる +0.4°。
export interface PartOffset {
  part: AimPart;
  dy: number;
  biasDeg?: number;
}

export const AIM_PARTS: readonly PartOffset[] = [
  { part: 'head', dy: 0.88, biasDeg: 0.4 },
  { part: 'chest', dy: 0.15 },
  { part: 'waist', dy: -0.1 },
  { part: 'limb', dy: -0.5 },
];

// 部位ごとの磁力スケール。脚ほど弱く、胴がもっとも強い。
export const PART_PULL_SCALE: Record<AimPart, number> = {
  head: 0.9,
  chest: 1.0,
  waist: 0.8,
  limb: 0.6,
};

// 各候補点について、視点(eye)→点 の方向 dir・照準との角度 angle・距離 dist を求め、
// 選択用の実効角(eff = angle - biasDeg)で昇順ソートして返す。
// angle は引き寄せ用の真の角度、eff はソート専用で戻り値には含めない。
export function rankAimPoints(
  eye: Vec3,
  forward: Vec3,
  base: Vec3,
  parts: readonly PartOffset[],
  maxRangeM: number,
): Array<{ part: AimPart; point: Vec3; dir: Vec3; angle: number; dist: number }> {
  const scored: Array<{
    item: { part: AimPart; point: Vec3; dir: Vec3; angle: number; dist: number };
    eff: number;
  }> = [];
  for (const p of parts) {
    const point: Vec3 = { x: base.x, y: base.y + p.dy, z: base.z };
    const tx = point.x - eye.x;
    const ty = point.y - eye.y;
    const tz = point.z - eye.z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > maxRangeM || dist < 1e-3) continue;
    const inv = 1 / dist;
    const dir: Vec3 = { x: tx * inv, y: ty * inv, z: tz * inv };
    const d = clamp(forward.x * dir.x + forward.y * dir.y + forward.z * dir.z, -1, 1);
    const angle = Math.acos(d); // 真の角度(引き寄せ用)
    const eff = angle - (p.biasDeg ?? 0) * DEG; // 選択用(head のみ前倒し)
    scored.push({ item: { part: p.part, point, dir, angle, dist }, eff });
  }
  scored.sort((a, b) => a.eff - b.eff); // 角度昇順(head 微優先)
  return scored.map((s) => s.item);
}
