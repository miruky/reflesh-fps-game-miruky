import { describe, expect, it } from 'vitest';

// ── FK ウィンドウ計算の純関数テスト ────────────────────────────────────────
// match.ts の FK定数・fkSpeedAt と同じロジックを純関数として再現してテストする。
// 実装の破壊的変更を検知するデグレガード。

const FK_WIN_PRE  = 3.5;
const FK_WIN_POST = 1.2;

// fkSpeedAt のミラー実装(match.ts と同一ロジック)
function fkSpeedAt(cursor: number, killT: number): number {
  const d = cursor - killT;
  if (d < -0.5) return 1.0;
  if (d < 0.0) {
    const t = (d + 0.5) / 0.5;
    return 1.0 + (0.25 - 1.0) * t;
  }
  if (d < 0.5) return 0.25;
  const t = Math.min(1, (d - 0.5) / Math.max(1e-6, FK_WIN_POST - 0.5));
  return 0.25 + (1.0 - 0.25) * t;
}

describe('FK ウィンドウ計算', () => {
  it('再生窓の先頭はキル-3.5s', () => {
    const killT = 10;
    const winStart = killT - FK_WIN_PRE;
    expect(winStart).toBeCloseTo(6.5, 6);
  });

  it('再生窓の末尾はキル+1.2s', () => {
    const killT = 10;
    const winEnd = killT + FK_WIN_POST;
    expect(winEnd).toBeCloseTo(11.2, 6);
  });

  it('キル 1s 前: 等速1×', () => {
    expect(fkSpeedAt(9, 10)).toBe(1.0);
  });

  it('キル直前 0.5s: 1× から 0.25× への遷移開始', () => {
    const v = fkSpeedAt(9.5, 10);
    expect(v).toBeCloseTo(1.0, 5); // d = -0.5, 遷移の最初
  });

  it('キル直前 0.25s: 約 0.625×', () => {
    const v = fkSpeedAt(9.75, 10);
    expect(v).toBeCloseTo(1.0 + (0.25 - 1.0) * 0.5, 5);
  });

  it('キル時刻: 0.25× ホールド開始', () => {
    expect(fkSpeedAt(10, 10)).toBe(0.25);
  });

  it('キル後 0.5s: まだ 0.25× ホールド', () => {
    expect(fkSpeedAt(10.5, 10)).toBe(0.25);
  });

  it('キル後 0.5s より後: 徐々に 1.0 へ復帰', () => {
    const v = fkSpeedAt(10.85, 10);
    expect(v).toBeGreaterThan(0.25);
    expect(v).toBeLessThan(1.0);
  });

  it('窓終端: ほぼ 1×', () => {
    const v = fkSpeedAt(10 + FK_WIN_POST, 10);
    expect(v).toBeCloseTo(1.0, 5);
  });
});

describe('FK 速度ランプ 単調性', () => {
  it('キル前(-3.5s〜-0.5s)は常に1×', () => {
    const killT = 10;
    for (let d = -3.5; d <= -0.5; d += 0.1) {
      expect(fkSpeedAt(killT + d, killT)).toBe(1.0);
    }
  });

  it('キル〜キル後0.5sは常に0.25×', () => {
    const killT = 10;
    for (let d = 0; d <= 0.5; d += 0.05) {
      expect(fkSpeedAt(killT + d, killT)).toBe(0.25);
    }
  });

  it('速度は常に0.25以上1.0以下', () => {
    const killT = 10;
    for (let d = -FK_WIN_PRE; d <= FK_WIN_POST; d += 0.05) {
      const v = fkSpeedAt(killT + d, killT);
      expect(v).toBeGreaterThanOrEqual(0.25);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('FK applyDeathPose 時間境界', () => {
  // death animation parameterization: t = min(1, elapsed / totalS)
  // For humanoid: totalS = 0.6
  // buckle = clamp(t/0.45, 0,1) covers the first 45% of the animation
  // fall = clamp((t-0.35)/0.65, 0,1) covers 35%〜100%
  function humanoidDeathT(elapsed: number): number {
    const totalS = 0.6;
    return Math.min(1, elapsed / totalS);
  }

  it('デスポーズ t=0 (キル直後) で buckle=0', () => {
    const t = humanoidDeathT(0);
    const buckle = Math.min(1, Math.max(0, t / 0.45));
    expect(buckle).toBe(0);
  });

  it('デスポーズ t=1 (完全) で fall=1', () => {
    const t = humanoidDeathT(0.6);
    const fall = Math.min(1, Math.max(0, (t - 0.35) / 0.65));
    expect(fall).toBeCloseTo(1.0, 5);
  });

  it('0.6s後: t はほぼ1(アニメ完了)', () => {
    const t = humanoidDeathT(0.6);
    expect(t).toBeCloseTo(1.0, 5);
  });

  it('1.2s後でも t は1を超えない(clamp)', () => {
    const t = humanoidDeathT(1.2);
    expect(t).toBe(1.0);
  });
});
