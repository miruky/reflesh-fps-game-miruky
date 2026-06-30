import { describe, expect, it } from 'vitest';
import {
  BO3_DEFAULT,
  PRESETS,
  applyCurve,
  sanitizeGamepadBindings,
  scaledRadialDeadzone,
  type GamepadBinding,
  type PadAction,
} from './gamepad';

describe('scaledRadialDeadzone', () => {
  it('デッドゾーン未満は完全に0', () => {
    const r = scaledRadialDeadzone(0.05, 0.05, 0.2);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('最大入力は大きさ1へ正規化し向きを保つ', () => {
    const r = scaledRadialDeadzone(1, 0, 0.1);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 5);
    expect(r.y).toBe(0);
  });

  it('出力の大きさは常に0..1に収まる', () => {
    for (const [x, y] of [
      [0.3, 0.4],
      [0.7, 0.7],
      [1, 1],
      [-0.5, 0.2],
    ] as const) {
      const r = scaledRadialDeadzone(x, y, 0.15);
      expect(Math.hypot(r.x, r.y)).toBeLessThanOrEqual(1.0001);
    }
  });

  it('デッドゾーン直上から滑らかに立ち上がる(0付近)', () => {
    const r = scaledRadialDeadzone(0.2001, 0, 0.2);
    expect(Math.hypot(r.x, r.y)).toBeGreaterThan(0);
    expect(Math.hypot(r.x, r.y)).toBeLessThan(0.01);
  });
});

describe('applyCurve', () => {
  for (const curve of ['linear', 'exponential', 'dynamic'] as const) {
    it(`${curve}: 0→0 / 1→1 / 符号保持`, () => {
      expect(applyCurve(0, curve, 1.5)).toBe(0);
      expect(applyCurve(1, curve, 1.5)).toBeCloseTo(1, 6);
      expect(applyCurve(-1, curve, 1.5)).toBeCloseTo(-1, 6);
    });

    it(`${curve}: 単調増加かつ[0,1]に収まる`, () => {
      let prev = -1;
      for (let v = 0; v <= 1.0001; v += 0.1) {
        const out = applyCurve(v, curve, 1.5);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(1.0001);
        expect(out).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = out;
      }
    });
  }

  it('exponential は中央付近を線形より弱める(精密射撃)', () => {
    expect(applyCurve(0.5, 'exponential', 2)).toBeLessThan(applyCurve(0.5, 'linear', 2));
  });
});

describe('sanitizeGamepadBindings', () => {
  it('全PadActionキーを必ず埋める', () => {
    const out = sanitizeGamepadBindings({});
    for (const key of Object.keys(BO3_DEFAULT) as PadAction[]) {
      expect(out[key]).toBeDefined();
    }
  });

  it('不正な束ねは捨て、範囲外indexも除外する', () => {
    const out = sanitizeGamepadBindings({
      jump: [{ kind: 'button', index: 99 }],
      crouch: [{ kind: 'trigger', index: 6, threshold: 5 }],
      reload: 'garbage',
    });
    expect(out.jump).toEqual([]); // index 99 は範囲外で除外
    expect(out.crouch).toEqual([]); // threshold>1 は不正
    expect(out.reload).toEqual(BO3_DEFAULT.reload); // 配列でない→既定で補完
  });

  it('正当な束ねは保持する', () => {
    const valid: GamepadBinding[] = [{ kind: 'button', index: 3 }];
    const out = sanitizeGamepadBindings({ jump: valid });
    expect(out.jump).toEqual(valid);
  });
});

describe('PRESETS は競合フリー(sprint/holdBreath の意図的共有を除く)', () => {
  const allowedShare = new Set<PadAction>(['sprint', 'holdBreath']);
  for (const [name, bindings] of Object.entries(PRESETS)) {
    it(name, () => {
      const byIndex = new Map<number, PadAction[]>();
      for (const key of Object.keys(bindings) as PadAction[]) {
        for (const b of bindings[key]) {
          const list = byIndex.get(b.index) ?? [];
          list.push(key);
          byIndex.set(b.index, list);
        }
      }
      for (const [, actions] of byIndex) {
        if (actions.length > 1) {
          // 重複が許されるのは sprint/holdBreath の組だけ
          expect(actions.every((a) => allowedShare.has(a))).toBe(true);
        }
      }
    });
  }
});
