import { describe, expect, it } from 'vitest';
import {
  ACQUIRE_CONE_DEG,
  adsSensScale,
  aimAssistDelta,
  angleFactor,
  bulletBendFraction,
  BULLET_MAG_CONE_DEG,
  BULLET_MAG_CONE_SCOPED_DEG,
  BULLET_MAG_MAX_DEG,
  BULLET_MAG_MAX_SCOPED_DEG,
  distanceFactor,
  slowdownFactor,
  snapPulse,
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
    const maxStep = (30 * DEG) / 60; // MAX_PULL_DEG_PER_S * dt
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
});
