// R54-F7: キルカム・シネマ強化の純関数テスト(ckFovAt / ckCursorStep / CK_FREEZE_S)。
// killcam.ts から直接import(match.ts の re-export 面=GOLDEN_EXPORTS は変更しない)。
import { describe, expect, it } from 'vitest';
import { CK_FREEZE_S, ckCursorStep, ckFovAt, ckSpeedAt } from './killcam';

describe('ckFovAt FOVランプ(52→46→50)', () => {
  it('キル-0.5s以前は52で一定', () => {
    expect(ckFovAt(0, 10)).toBe(52);
    expect(ckFovAt(9.5, 10)).toBe(52);
  });

  it('キル瞬間は46(ズームインの底)', () => {
    expect(ckFovAt(10, 10)).toBeCloseTo(46, 6);
  });

  it('キル+0.3s以降は50(CK基準)へ復帰して一定', () => {
    expect(ckFovAt(10.3, 10)).toBeCloseTo(50, 6);
    expect(ckFovAt(20, 10)).toBe(50);
  });

  it('絞り区間は単調減少・復帰区間は単調増加(smoothstepの単調性)', () => {
    let prev = ckFovAt(9.5, 10);
    for (let t = 9.55; t <= 10.0001; t += 0.05) {
      const v = ckFovAt(t, 10);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    prev = ckFovAt(10, 10);
    for (let t = 10.05; t <= 10.3001; t += 0.05) {
      const v = ckFovAt(t, 10);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('中点(smoothstep 0.5)で区間の中央値になる', () => {
    expect(ckFovAt(9.75, 10)).toBeCloseTo(49, 6); // 52→46 の中央
    expect(ckFovAt(10.15, 10)).toBeCloseTo(48, 6); // 46→50 の中央
  });
});

describe('ckCursorStep マイクロフリーズ', () => {
  it('キル瞬間を跨ぐステップは killT へ正確に着地し freeze=CK_FREEZE_S を開始する', () => {
    // cursor=9.95, killT=10。speed=1 で dt=0.1 なら通常 10.05 だが、跨ぎで 10 へ着地
    const r = ckCursorStep(9.95, 0.1, 1.0, 10, 0, false);
    expect(r.cursor).toBe(10);
    expect(r.freezeLeft).toBe(CK_FREEZE_S);
  });

  it('フリーズ中はカーソルが進まず、実時間だけ残量が減る', () => {
    const r = ckCursorStep(10, 1 / 60, 0.2, 10, CK_FREEZE_S, false);
    expect(r.cursor).toBe(10);
    expect(r.freezeLeft).toBeCloseTo(CK_FREEZE_S - 1 / 60, 9);
  });

  it('フリーズ明けは通常前進へ復帰し、再フリーズしない(cursor>=killT)', () => {
    const r = ckCursorStep(10, 1 / 60, 0.2, 10, 0, false);
    expect(r.cursor).toBeCloseTo(10 + (1 / 60) * 0.2, 9);
    expect(r.freezeLeft).toBe(0);
  });

  it('reduceMotion時はフリーズせず連続前進(既存挙動と同一)', () => {
    const r = ckCursorStep(9.95, 0.1, 1.0, 10, 0, true);
    expect(r.cursor).toBeCloseTo(10.05, 9);
    expect(r.freezeLeft).toBe(0);
  });

  it('キル前の通常ステップはそのまま前進する', () => {
    const r = ckCursorStep(8, 0.1, 1.0, 10, 0, false);
    expect(r.cursor).toBeCloseTo(8.1, 9);
    expect(r.freezeLeft).toBe(0);
  });
});

describe('ckSpeedAt 互換(マイクロフリーズ導入後もランプ本体は不変)', () => {
  it('既存ピン: 遠方1.0 / キル直後0.2', () => {
    expect(ckSpeedAt(-1, 0)).toBeCloseTo(1.0, 6);
    expect(ckSpeedAt(0.3, 0)).toBeCloseTo(0.2, 6);
    expect(ckSpeedAt(-0.2, 0)).toBeCloseTo(0.6, 6);
  });
});
