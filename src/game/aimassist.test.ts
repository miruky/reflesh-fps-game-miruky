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
  distanceFactor,
  PART_PULL_SCALE,
  RAA_FOLLOW,
  rankAimPoints,
  rotationalAssist,
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

  it('distanceFactorは近距離で1、140mで0.40、最大射程超で0', () => {
    expect(distanceFactor(10, 300)).toBe(1);
    expect(distanceFactor(40, 300)).toBe(1);
    expect(distanceFactor(140, 300)).toBeCloseTo(0.4, 5);
    expect(distanceFactor(90, 300)).toBeGreaterThan(0.4);
    expect(distanceFactor(90, 300)).toBeLessThan(1);
    expect(distanceFactor(400, 300)).toBe(0);
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
    const maxStep = (24 * DEG) / 60; // MAX_PULL_DEG_PER_S * dt
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

  it('snapPulseは誤差の15%・上限1.5°、強度0で0、決して誤差を超えない', () => {
    // 小さな誤差では誤差の15%
    expect(snapPulse(2 * DEG, 1)).toBeCloseTo(2 * DEG * 0.15, 9);
    // 大きな誤差では1.5°で頭打ち
    expect(snapPulse(40 * DEG, 1)).toBeCloseTo(1.5 * DEG, 9);
    // 強度0で完全停止
    expect(snapPulse(5 * DEG, 0)).toBe(0);
    // どんな誤差でも誤差自体を超えない(=オーバーシュート/エイムボット化しない)
    for (let e = 0.1; e < 30; e += 0.7) {
      expect(snapPulse(e * DEG, 1)).toBeLessThanOrEqual(e * DEG + 1e-9);
    }
  });

  it('スコープ用バレットマグネティズム定数は通常より広く強い', () => {
    expect(BULLET_MAG_CONE_SCOPED_DEG).toBeGreaterThanOrEqual(BULLET_MAG_CONE_DEG);
    expect(BULLET_MAG_MAX_SCOPED_DEG).toBeGreaterThanOrEqual(BULLET_MAG_MAX_DEG);
  });

  it('rotationalAssist: デッドゾーン以下のスティックでは作動しない', () => {
    expect(rotationalAssist(1.0, 0.05, 1, 1 / 60, 0.1)).toBe(0);
  });

  it('rotationalAssist: スティックを倒すと対象角速度の一定割合を返す', () => {
    const dt = 1 / 60;
    const out = rotationalAssist(2.0, 0.8, 1, dt, 0.1);
    expect(out).toBeCloseTo(2.0 * RAA_FOLLOW * 1 * dt, 6);
    expect(out).toBeGreaterThan(0);
  });

  it('rotationalAssist: strengthは0..1にクランプされる', () => {
    const dt = 1 / 60;
    expect(rotationalAssist(1.0, 1, 5, dt, 0.1)).toBeCloseTo(1.0 * RAA_FOLLOW * 1 * dt, 6);
    expect(rotationalAssist(1.0, 1, -1, dt, 0.1)).toBe(0);
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
