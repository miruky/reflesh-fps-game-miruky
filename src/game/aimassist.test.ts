import { describe, expect, it } from 'vitest';
import {
  ACQUIRE_CONE_DEG,
  adsSensScale,
  aimAssistDelta,
  AIM_PARTS,
  angleFactor,
  bulletBendFraction,
  BULLET_MAG_CONE_DEG,
  BULLET_MAG_CONE_SCOPED_DEG,
  BULLET_MAG_MAX_DEG,
  BULLET_MAG_MAX_SCOPED_DEG,
  CLASS_AA_MUL,
  distanceFactor,
  DIST_FLOOR,
  DIST_FLOOR_M,
  DIST_FULL_M,
  PART_PULL_SCALE,
  rankAimPoints,
  SLOWDOWN_CONE_DEG,
  slowdownFactor,
  snapPulse,
  type Vec3,
} from './aimassist';

const DEG = Math.PI / 180;

describe('aimassist 純粋ロジック', () => {
  it('angleFactorは全効果円錐内で1、索敵円錐外で0、近づくほど増加', () => {
    const acquire = ACQUIRE_CONE_DEG * DEG;
    const full = 1.2 * DEG;
    expect(angleFactor(0, acquire, full)).toBe(1);
    expect(angleFactor(0.5 * DEG, acquire, full)).toBe(1);
    expect(angleFactor(7 * DEG, acquire, full)).toBe(0);
    const near = angleFactor(2 * DEG, acquire, full);
    const far = angleFactor(4 * DEG, acquire, full);
    expect(near).toBeGreaterThan(far);
  });

  it('distanceFactorは近距離で1、床距離で床値、最大射程超で0(BO2: 遠距離は腕で当てる)', () => {
    expect(distanceFactor(10, 300)).toBe(1);
    expect(distanceFactor(DIST_FULL_M, 300)).toBe(1);
    expect(distanceFactor(DIST_FLOOR_M, 300)).toBeCloseTo(DIST_FLOOR, 5);
    const mid = (DIST_FULL_M + DIST_FLOOR_M) / 2;
    expect(distanceFactor(mid, 300)).toBeGreaterThan(DIST_FLOOR);
    expect(distanceFactor(mid, 300)).toBeLessThan(1);
    expect(distanceFactor(400, 300)).toBe(0);
    // R8: BO2準拠で近接寄り(満額25m/床80m/床値0.12)
    expect(DIST_FULL_M).toBe(25);
    expect(DIST_FLOOR_M).toBe(80);
    expect(DIST_FLOOR).toBeCloseTo(0.12, 5);
  });

  it('スローダウン円錐はプル円錐より広い(先にブレーキ、中心で微引き)', () => {
    expect(SLOWDOWN_CONE_DEG).toBeGreaterThan(ACQUIRE_CONE_DEG);
  });

  it('CLASS_AA_MULはスナイパー満額・拡散武器ほど弱い', () => {
    expect(CLASS_AA_MUL.sniper).toBe(1.0);
    expect(CLASS_AA_MUL.shotgun).toBeLessThan(CLASS_AA_MUL.smg);
    for (const v of Object.values(CLASS_AA_MUL)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('slowdownFactorは中心で最大減衰、円錐外で1', () => {
    expect(slowdownFactor(0, 6 * DEG, 0.4)).toBeCloseTo(0.6, 5);
    expect(slowdownFactor(10 * DEG, 6 * DEG, 0.4)).toBe(1);
  });

  it('aimAssistDeltaは不足分を超えず、円錐外/強度0/射程外で0', () => {
    const base = {
      curYaw: 0,
      curPitch: 0,
      tgtYaw: 0.5 * DEG,
      tgtPitch: 0,
      angleRad: 0.5 * DEG,
      distanceM: 20,
      dtS: 1, // 大きなdtでも不足分でクランプされる
      strength: 1,
      maxRangeM: 300,
    };
    const d = aimAssistDelta(base);
    expect(Math.abs(d.dYaw)).toBeLessThanOrEqual(0.5 * DEG + 1e-9);
    expect(Math.sign(d.dYaw)).toBe(1);
    // 索敵円錐外
    expect(aimAssistDelta({ ...base, angleRad: 9 * DEG }).dYaw).toBe(0);
    // 強度0
    expect(aimAssistDelta({ ...base, strength: 0 }).dYaw).toBe(0);
    // 射程外
    expect(aimAssistDelta({ ...base, distanceM: 500 }).dYaw).toBe(0);
  });

  it('aimAssistDeltaは小dtで角速度上限を超えない', () => {
    const d = aimAssistDelta({
      curYaw: 0,
      curPitch: 0,
      tgtYaw: 5 * DEG, // 遠い目標
      tgtPitch: 0,
      angleRad: 0.3 * DEG, // 円錐の中心付近(係数最大)に見立てる
      distanceM: 10,
      dtS: 1 / 60,
      strength: 1,
      maxRangeM: 300,
    });
    const maxStep = (10 * DEG) / 60; // MAX_PULL_DEG_PER_S(R8: BO2準拠で10°/s) * dt
    expect(Math.abs(d.dYaw)).toBeLessThanOrEqual(maxStep + 1e-9);
  });

  it('bulletBendFractionは最大1、角度が大きいほど割合は減る', () => {
    expect(bulletBendFraction(0.5 * DEG, 1 * DEG)).toBe(1);
    expect(bulletBendFraction(2 * DEG, 1 * DEG)).toBeCloseTo(0.5, 5);
    expect(bulletBendFraction(1 * DEG, 0)).toBe(0);
  });

  it('adsSensScaleはprogress0で等倍、満ADSでズーム比×倍率', () => {
    expect(adsSensScale(78, 0.32, 1.0, 0)).toBe(1);
    expect(adsSensScale(78, 0.32, 1.0, 1)).toBeCloseTo(0.27, 2);
    expect(adsSensScale(78, 0.32, 1.5, 1)).toBeGreaterThan(adsSensScale(78, 0.32, 1.0, 1));
  });

  it('snapPulseは誤差の22%・上限2.2°、強度0で0、決して誤差を超えない', () => {
    // 小さな誤差では誤差の22%(QS支援。スコープ専用)
    expect(snapPulse(2 * DEG, 1)).toBeCloseTo(2 * DEG * 0.22, 9);
    // 大きな誤差では2.2°で頭打ち
    expect(snapPulse(40 * DEG, 1)).toBeCloseTo(2.2 * DEG, 9);
    // 強度0で完全停止
    expect(snapPulse(5 * DEG, 0)).toBe(0);
    // どんな誤差でも誤差自体を超えない(=オーバーシュート/エイムボット化しない)
    for (let e = 0.1; e < 30; e += 0.7) {
      expect(snapPulse(e * DEG, 1)).toBeLessThanOrEqual(e * DEG + 1e-9);
    }
  });

  it('スコープ用バレットマグネティズム定数は通常より広く強い(それでも救済の域)', () => {
    expect(BULLET_MAG_CONE_SCOPED_DEG).toBeGreaterThanOrEqual(BULLET_MAG_CONE_DEG);
    expect(BULLET_MAG_MAX_SCOPED_DEG).toBeGreaterThanOrEqual(BULLET_MAG_MAX_DEG);
    // R8: BO2準拠の縮小値(最大曲げは0.25°以下=ほぼ当たっている弾だけを救う)
    expect(BULLET_MAG_MAX_SCOPED_DEG).toBeLessThanOrEqual(0.25);
  });

  // ── 最近接部位エイムアシスト (rankAimPoints) ─────────────────────
  const normalize = (v: Vec3): Vec3 => {
    const m = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / m, y: v.y / m, z: v.z / m };
  };
  const EYE: Vec3 = { x: 0, y: 0, z: 0 };
  const BASE: Vec3 = { x: 0, y: 0, z: 10 };
  const pointFor = (dy: number): Vec3 => ({ x: BASE.x, y: BASE.y + dy, z: BASE.z });

  it('rankAimPoints: forwardを各部位の高さへ向けると先頭がその部位', () => {
    expect(rankAimPoints(EYE, normalize(pointFor(0.88)), BASE, AIM_PARTS, 300)[0]?.part).toBe(
      'head',
    );
    expect(rankAimPoints(EYE, normalize(pointFor(0.15)), BASE, AIM_PARTS, 300)[0]?.part).toBe(
      'chest',
    );
    expect(rankAimPoints(EYE, normalize(pointFor(-0.1)), BASE, AIM_PARTS, 300)[0]?.part).toBe(
      'waist',
    );
    expect(rankAimPoints(EYE, normalize(pointFor(-0.5)), BASE, AIM_PARTS, 300)[0]?.part).toBe(
      'limb',
    );
  });

  it('rankAimPoints: 各 dir はノルム≈1、angle≈acos(forward·dir)', () => {
    const forward = normalize({ x: 0.05, y: 0.2, z: 10 });
    const out = rankAimPoints(EYE, forward, BASE, AIM_PARTS, 300);
    expect(out).toHaveLength(4);
    for (const r of out) {
      expect(Math.hypot(r.dir.x, r.dir.y, r.dir.z)).toBeCloseTo(1, 9);
      const dot = forward.x * r.dir.x + forward.y * r.dir.y + forward.z * r.dir.z;
      expect(r.angle).toBeCloseTo(Math.acos(Math.min(1, Math.max(-1, dot))), 9);
    }
  });

  it('rankAimPoints: 頭と胸がほぼ等角(差<0.4°)でも biasDeg=0.4 で head が先頭', () => {
    // 頭(dy0.88)と胸(dy0.15)の中点方向 → 両者の角度差は 0.4° 未満になる
    const forward = normalize(pointFor((0.88 + 0.15) / 2));
    const out = rankAimPoints(EYE, forward, BASE, AIM_PARTS, 300);
    const head = out.find((r) => r.part === 'head');
    const chest = out.find((r) => r.part === 'chest');
    if (!head || !chest) throw new Error('head/chest が見つからない');
    expect(Math.abs((head.angle - chest.angle) / DEG)).toBeLessThan(0.4);
    expect(out[0]?.part).toBe('head');
  });

  it('rankAimPoints: 射程外候補は除外し、全候補が範囲外なら空配列', () => {
    const out = rankAimPoints(EYE, normalize({ x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 500 }, AIM_PARTS, 100);
    expect(out).toEqual([]);
  });

  it('rankAimPoints: dist≈0(base/eye がほぼ同一)でも例外を投げず除外', () => {
    expect(() => rankAimPoints(EYE, { x: 0, y: 0, z: 1 }, EYE, AIM_PARTS, 300)).not.toThrow();
    // dy=0 の候補は eye と一致 → dist≈0 で除外され空配列
    expect(rankAimPoints(EYE, { x: 0, y: 0, z: 1 }, EYE, [{ part: 'chest', dy: 0 }], 300)).toEqual(
      [],
    );
  });

  it('AIM_PARTS は4部位、dy は規定値、head のみ biasDeg を持つ', () => {
    expect(AIM_PARTS).toHaveLength(4);
    expect(AIM_PARTS.map((p) => p.part)).toEqual(['head', 'chest', 'waist', 'limb']);
    expect(AIM_PARTS.map((p) => p.dy)).toEqual([0.88, 0.15, -0.1, -0.5]);
    expect(AIM_PARTS.map((p) => p.biasDeg)).toEqual([0.4, undefined, undefined, undefined]);
  });

  it('PART_PULL_SCALE は head<chest かつ limb<waist<chest', () => {
    expect(PART_PULL_SCALE.head).toBeLessThan(PART_PULL_SCALE.chest);
    expect(PART_PULL_SCALE.limb).toBeLessThan(PART_PULL_SCALE.waist);
    expect(PART_PULL_SCALE.waist).toBeLessThan(PART_PULL_SCALE.chest);
  });
});
