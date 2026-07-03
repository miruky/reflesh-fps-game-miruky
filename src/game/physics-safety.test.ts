import { describe, expect, it } from 'vitest';
import { applyGravityStep, MAX_FALL_SPEED } from './player';

const DT = 1 / 60;
const GRAVITY = 18; // player.ts のモジュール内定数と同値(回帰防止)

describe('applyGravityStep(終端速度クランプ)', () => {
  it('長時間落下しても終端速度を超えない', () => {
    let v = 0;
    for (let i = 0; i < 600; i += 1) v = applyGravityStep(v, 1, DT);
    expect(v).toBe(-MAX_FALL_SPEED);
    expect(v).toBeGreaterThanOrEqual(-MAX_FALL_SPEED);
  });

  it('終端未満では重力ぶんだけ減速する', () => {
    expect(applyGravityStep(0, 1, DT)).toBeCloseTo(-GRAVITY * DT, 6);
  });

  it('既に終端以下なら終端へ丸める', () => {
    expect(applyGravityStep(-100, 1, DT)).toBe(-MAX_FALL_SPEED);
  });

  it('ウォールラン係数(0.18)ではほぼ落ちない', () => {
    expect(applyGravityStep(0, 0.18, DT)).toBeCloseTo(-(GRAVITY * 0.18) * DT, 6);
  });

  it('上昇中の速度には触れない(正方向は素通し)', () => {
    // ジャンプ直後など正のvelYは重力ぶん減るだけでクランプされない
    expect(applyGravityStep(6.4, 1, DT)).toBeCloseTo(6.4 - GRAVITY * DT, 6);
  });
});

describe('終端速度と床/snap の不変条件(値の回帰防止)', () => {
  it('1フレーム変位が snapToGround(0.4) と床コライダー半厚(1.0)を超えない', () => {
    // 床コライダーは match.buildStageScene で cuboid(_, 1.0, _) @ y=-1(下面-2)。半厚は 0.5 ではなく 1.0。
    // 終端変位 24/60=0.4m << 1.0 なので純垂直トンネリングは物理的に不可能(床抜けはKCC由来=安全網で救済)
    const disp = MAX_FALL_SPEED * DT;
    expect(disp).toBeLessThanOrEqual(0.4);
    expect(disp).toBeLessThan(1.0);
  });

  it('終端速度はウォールラン落下上限(2)より大きい(競合しない)', () => {
    expect(MAX_FALL_SPEED).toBeGreaterThan(2);
  });
});
