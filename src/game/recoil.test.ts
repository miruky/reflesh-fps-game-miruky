import { describe, expect, it } from 'vitest';
import { RecoilTracker } from './recoil';

const pattern = [
  { yaw: 0, pitch: 0.01 },
  { yaw: 0.002, pitch: 0.008 },
  { yaw: 0.004, pitch: 0.006 },
];

describe('RecoilTracker', () => {
  it('パターンに沿って進み、末尾以降は末尾を繰り返す', () => {
    const tracker = new RecoilTracker(pattern, 5);
    expect(tracker.kick()).toEqual(pattern[0]);
    expect(tracker.kick()).toEqual(pattern[1]);
    expect(tracker.kick()).toEqual(pattern[2]);
    expect(tracker.kick()).toEqual(pattern[2]);
  });

  it('resetで先頭に戻る', () => {
    const tracker = new RecoilTracker(pattern, 5);
    tracker.kick();
    tracker.kick();
    tracker.reset();
    expect(tracker.kick()).toEqual(pattern[0]);
  });

  it('recoverは蓄積した反動を返し、合計すると打ち消される', () => {
    const tracker = new RecoilTracker(pattern, 5);
    tracker.kick();
    tracker.kick();
    const accumulated = tracker.accumulatedPitch;
    let recovered = 0;
    for (let i = 0; i < 200; i += 1) {
      recovered += tracker.recover(1 / 60).pitch;
    }
    expect(recovered).toBeCloseTo(accumulated, 5);
    expect(tracker.accumulatedPitch).toBeCloseTo(0, 5);
  });

  it('空のパターンは拒否する', () => {
    expect(() => new RecoilTracker([], 5)).toThrow();
  });
});
