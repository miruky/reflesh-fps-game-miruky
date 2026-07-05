/**
 * AutoExposure のユニットテスト。
 *
 * DOM / renderer に依存せず、純粋な数値計算のみを検証する。
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AutoExposure } from './exposure';

// 収束定数: exp(-60/tau) ≈ 0 なので「完全収束」とみなせる
const CONVERGE_DT = 60;

// テスト用カメラ前方ベクトル(正規化済み)
const UP_VEC = new Vector3(0, 1, 0);     // 真上  → up=1.0, skyF=1.0
const HORIZ_VEC = new Vector3(0, 0, -1); // 水平  → up=0.5, skyF≈0.043
const DOWN_VEC = new Vector3(0, -1, 0);  // 真下  → up=0.0, skyF=0.0

/**
 * dt=0 で update() を呼ぶと alpha=0 になり状態を変えずに現在の exposure を返す。
 * 状態スナップショット用ヘルパー。
 */
function sample(ae: AutoExposure, fwd: Vector3, indoor01: number): number {
  return ae.update(0, fwd, indoor01);
}

describe('AutoExposure', () => {
  it('空を見上げると exposure が下がる(skyEV = -0.75)', () => {
    // 屋外・真上 → targetEV = skyEV = -0.75 に収束 → exposure < 1
    const aeUp = new AutoExposure();
    aeUp.update(CONVERGE_DT, UP_VEC, 0);
    const expUp = sample(aeUp, UP_VEC, 0);

    // 屋外・真下 → targetEV = outdoorEV = 0 に収束 → exposure = 1
    const aeDown = new AutoExposure();
    aeDown.update(CONVERGE_DT, DOWN_VEC, 0);
    const expDown = sample(aeDown, DOWN_VEC, 0);

    expect(expUp).toBeLessThan(expDown);
    expect(expUp).toBeCloseTo(Math.pow(2, -0.75), 3); // 1 * 2^-0.75 ≈ 0.595
  });

  it('屋内で exposure が上がる(indoorEV = +0.55)', () => {
    // 真下向き: skyF=0 なので sky の寄与なし → zoneEV だけが効く

    const aeOut = new AutoExposure();
    aeOut.update(CONVERGE_DT, DOWN_VEC, 0); // 屋外収束
    const expOut = sample(aeOut, DOWN_VEC, 0);

    const aeIn = new AutoExposure();
    aeIn.update(CONVERGE_DT, DOWN_VEC, 1); // 屋内収束
    const expIn = sample(aeIn, DOWN_VEC, 1);

    expect(expIn).toBeGreaterThan(expOut);
    expect(expIn).toBeCloseTo(Math.pow(2, 0.55), 3); // 1 * 2^0.55 ≈ 1.464
    expect(expOut).toBeCloseTo(1.0, 4);              // 1 * 2^0 = 1.0
  });

  it('非対称時定数: 暗方向(tau=2.5)のほうが明方向(tau=0.8)より収束が遅い', () => {
    const dt = 0.5;

    // 理論値の確認
    const alphaDark = 1 - Math.exp(-dt / 2.5);   // ≈ 0.181
    const alphaBright = 1 - Math.exp(-dt / 0.8); // ≈ 0.464
    expect(alphaBright).toBeGreaterThan(alphaDark);

    // 実測: 初期 EV=0, 真上向き(targetEV = skyEV = -0.75) → 暗方向 → tau=2.5
    const ae = new AutoExposure();
    ae.update(dt, UP_VEC, 0);
    const expDark = sample(ae, UP_VEC, 0);
    const expectedEV = alphaDark * (-0.75); // currentEV = 0 + alphaDark * (-0.75)
    expect(expDark).toBeCloseTo(Math.pow(2, expectedEV), 3);
  });

  it('十分な時間後に targetEV へ収束する(屋外・真下)', () => {
    // targetEV = outdoorEV = 0 → exposure = baseExposure * 2^0 = 1.0
    const ae = new AutoExposure();
    ae.update(CONVERGE_DT, DOWN_VEC, 0);
    const exp = sample(ae, DOWN_VEC, 0);
    expect(exp).toBeCloseTo(1.0, 4);
  });

  it('reset 後に currentEV が 0.0 に戻り exposure = baseExposure', () => {
    const ae = new AutoExposure();
    ae.update(CONVERGE_DT, UP_VEC, 0); // 暗い方向へ収束
    ae.reset();
    // dt=0 で状態変化なし → currentEV=0 → exposure = 1.0
    const expAfterReset = sample(ae, HORIZ_VEC, 0);
    expect(expAfterReset).toBeCloseTo(1.0, 5);
  });

  it('configure で baseExposure を変更できる', () => {
    const ae = new AutoExposure();
    ae.configure({ baseExposure: 2.0 });
    ae.update(CONVERGE_DT, DOWN_VEC, 0); // outdoorEV=0 へ収束
    const exp = sample(ae, DOWN_VEC, 0);
    expect(exp).toBeCloseTo(2.0, 4); // 2.0 * 2^0 = 2.0
  });

  it('configure で EV レンジを変更できる(outdoorEV/indoorEV)', () => {
    const ae = new AutoExposure();
    // outdoorEV=1.0, indoorEV=2.0 に変更
    ae.configure({ baseExposure: 1.0, outdoorEV: 1.0, indoorEV: 2.0 });
    // 真下・屋内 → skyF=0, indoor01=1 → targetEV=indoorEV=2.0
    ae.update(CONVERGE_DT, DOWN_VEC, 1);
    const exp = sample(ae, DOWN_VEC, 1);
    expect(exp).toBeCloseTo(Math.pow(2, 2.0), 3); // 4.0
  });

  it('真下を向くと skyF=0 なので targetEV = zoneEV のみ(sky の影響なし)', () => {
    const ae = new AutoExposure();
    ae.update(CONVERGE_DT, DOWN_VEC, 0); // skyF=0, outdoorEV=0 → EV=0
    const exp = sample(ae, DOWN_VEC, 0);
    // skyEV(-0.75) の影響を受けていない
    expect(exp).toBeCloseTo(1.0, 4);
  });
});
