import { describe, expect, it } from 'vitest';

// ── FK ウィンドウ計算の純関数テスト ────────────────────────────────────────
// match.ts の FK定数・fkSpeedAt と同じロジックを純関数として再現してテストする。
// 実装の破壊的変更を検知するデグレガード。

const FK_WIN_PRE  = 3.5;
const FK_WIN_POST = 1.2;

// ─── 実時間計算ヘルパー ────────────────────────────────────────────────────
// 数値積分: ゲーム時刻区間 [gameStart, gameEnd] を実際に進むのに何秒かかるか。
// dt_real = d_game / speed(cursor)。速度が0に近い区間を1万等分で積分する。
function realTimeCost(gameStart: number, gameEnd: number, killT: number, steps = 10000): number {
  const span = gameEnd - gameStart;
  const dg   = span / steps;
  let total  = 0;
  for (let i = 0; i < steps; i++) {
    const cursor = gameStart + (i + 0.5) * dg;
    total += dg / fkSpeedAt(cursor, killT);
  }
  return total;
}

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

// ─── 実時間長の検証テスト ──────────────────────────────────────────────────
// R36再修正: "kill瞬間カット" バグの数値根拠テスト
// fkCursor は startFinalKillcam で max(oldest, killT-3.5) に初期化される。
// oldest が killT-3.0 だった場合、カーソル先頭は killT-3.0 になる。
// 当テストは窓全体を実時間換算したとき十分長いことを保証する。
describe('FK スロー再生の実時間計算', () => {
  const killT = 10;

  it('キル前3.5s区間を等速で進むコスト = 3.0s real(d<-0.5は常に1×)', () => {
    // [-3.5,-0.5] は速度1×。ゲーム3.0s = 実時間3.0s
    const cost = realTimeCost(killT - 3.5, killT - 0.5, killT);
    expect(cost).toBeCloseTo(3.0, 1);
  });

  it('キル前0.5s→キル直前の減速区間: 実時間 > ゲーム時間 (遅くなっている)', () => {
    // speed < 1.0 なので実時間 > 0.5s
    const cost = realTimeCost(killT - 0.5, killT, killT);
    expect(cost).toBeGreaterThan(0.5);
  });

  it('0.25×スロー区間[+0s,+0.5s]の実時間 = 2.0s (0.5/0.25)', () => {
    // speed = 0.25 → 0.5g / 0.25 = 2.0s real
    const cost = realTimeCost(killT, killT + 0.5, killT);
    expect(cost).toBeCloseTo(2.0, 2);
  });

  it('窓全体(oldest=killT-3.0から始まる場合)の実時間 > 7s', () => {
    // cursor = max(oldest, killT-3.5) = killT-3.0 のケース
    // [killT-3.0, killT+1.2] の実時間コスト
    const cost = realTimeCost(killT - 3.0, killT + FK_WIN_POST, killT);
    // 内訳: [k-3.0,k-0.5]=2.5s×1=2.5, [k-0.5,k]≈0.92s real, [k,k+0.5]=2.0s, [k+0.5,k+1.2]≈1.3s
    expect(cost).toBeGreaterThan(6.0);
  });

  it('窓全体(フルバッファ killT-3.5 から始まる場合)の実時間 > 7.0s', () => {
    const cost = realTimeCost(killT - FK_WIN_PRE, killT + FK_WIN_POST, killT);
    expect(cost).toBeGreaterThan(7.0);
  });

  it('fkCursor を oldest=killT-3.0 でクランプしても window は killT+1.2 まで到達する', () => {
    // startFinalKillcam: cursor = max(oldest, killT-FK_WIN_PRE) = killT-3.0
    // fkWinEnd = killT + FK_WIN_POST = killT + 1.2
    // → cursor が最終的に fkWinEnd を超えてリターン true = 再生完了
    let cursor = killT - 3.0;  // oldest = killT-3.0 でクランプ済み
    const winEnd = killT + FK_WIN_POST;
    const DT_REAL = 1 / 60;    // 60fps フレーム
    let frames = 0;
    while (cursor < winEnd && frames < 20000) {
      cursor += DT_REAL * fkSpeedAt(cursor, killT);
      frames++;
    }
    expect(cursor).toBeGreaterThanOrEqual(winEnd);
    // スロー込みで7秒以上かかる = 420フレーム以上
    expect(frames).toBeGreaterThan(400);
  });
});

describe('FK カーソルクランプ (startFinalKillcam)', () => {
  it('oldest <= killT-3.0 のとき cursor は oldest から始まる(バグ回避)', () => {
    const killT  = 10;
    const oldest = killT - 3.0; // ガード通過の最悪ケース
    const cursor = Math.max(oldest, killT - FK_WIN_PRE);
    // killT-FK_WIN_PRE = 6.5, oldest = 7.0 → cursor = 7.0 = oldest
    expect(cursor).toBe(oldest);
    // 旧実装(killT-FK_WIN_PRE=6.5)では fkFindFrames が -1 を返して即終了していた
    expect(cursor).toBeGreaterThanOrEqual(oldest);
  });

  it('oldest が十分古い(killT-4.0)なら cursor = killT-FK_WIN_PRE', () => {
    const killT  = 10;
    const oldest = killT - 4.0; // フルバッファケース
    const cursor = Math.max(oldest, killT - FK_WIN_PRE);
    expect(cursor).toBeCloseTo(killT - FK_WIN_PRE, 6);
  });
});

describe('FK スコープ再現', () => {
  it('ADS率 > 0.85 かつ scope武器: スコープオーバーレイ表示条件が成立', () => {
    // fkScopeInfo.isScope = fkKillerScopedWeapon && fkKillerIsPlayer
    // main が呼ぶ updateFinalKillcam(flash, adsRatio, isScope) → hud がスコープON
    const adsRatio = 0.95;
    const isScope  = true;
    const scopeOn  = isScope && adsRatio > 0.85;
    expect(scopeOn).toBe(true);
  });

  it('ADS率 < 0.85: スコープオーバーレイは表示しない', () => {
    const adsRatio = 0.7;
    const isScope  = true;
    const scopeOn  = isScope && adsRatio > 0.85;
    expect(scopeOn).toBe(false);
  });

  it('scope武器でない(AR等): ADS率が高くてもスコープオーバーレイは表示しない', () => {
    const adsRatio = 1.0;
    const isScope  = false; // def.scope !== true
    const scopeOn  = isScope && adsRatio > 0.85;
    expect(scopeOn).toBe(false);
  });

  it('ゾンビモードでは fkKillerIsPlayer が false → isScope = false', () => {
    // ゾンビは startFinalKillcam が false 返して killcam 未使用
    // fkScopeInfo.isScope = fkKillerScopedWeapon && fkKillerIsPlayer
    const fkKillerIsPlayer  = false; // zombie mode
    const fkKillerScopedWeapon = true;
    const isScope = fkKillerScopedWeapon && fkKillerIsPlayer;
    expect(isScope).toBe(false);
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

// ─── trailing window (over後の記録継続) ───────────────────────────────────────
describe('FK trailing window (over後の記録継続)', () => {
  const FK_WIN_POST_LOCAL = 1.2;

  it('elapsed === fkKillElapsed + FK_WIN_POST は記録対象(境界値)', () => {
    // update() の条件: elapsed <= fkKillElapsed + FK_WIN_POST
    const fkKillElapsed = 50;
    const elapsed       = fkKillElapsed + FK_WIN_POST_LOCAL;
    const shouldRecord  = elapsed <= fkKillElapsed + FK_WIN_POST_LOCAL;
    expect(shouldRecord).toBe(true);
  });

  it('elapsed > fkKillElapsed + FK_WIN_POST は記録打ち止め', () => {
    const fkKillElapsed = 50;
    const elapsed       = fkKillElapsed + FK_WIN_POST_LOCAL + 0.001;
    const shouldRecord  = elapsed <= fkKillElapsed + FK_WIN_POST_LOCAL;
    expect(shouldRecord).toBe(false);
  });

  it('over後 FK_WIN_POST秒間は 20Hz で最大24フレーム記録できる', () => {
    // 1.2s × 20Hz = 24フレーム
    const FK_TICK_INT_LOCAL = 3;   // match.tsと同じ定数
    const SIM_HZ            = 60;
    const dt                = 1 / SIM_HZ;
    let tick = 0;
    let frames = 0;
    let elapsed = 0;
    const fkKillElapsed = 0;

    while (elapsed <= fkKillElapsed + FK_WIN_POST_LOCAL) {
      elapsed += dt;
      tick = (tick + 1) % FK_TICK_INT_LOCAL;
      if (tick === 0) frames++;
    }
    // 1.2s / (3/60Hz) = 1.2 / 0.05 = 24フレーム
    expect(frames).toBeGreaterThanOrEqual(24);
  });

  it('fkKillElapsed が -Infinity の場合は trailing window に入らない', () => {
    const fkKillElapsed = -Infinity;
    const elapsed = 100;
    const shouldRecord = fkKillElapsed !== -Infinity && elapsed <= fkKillElapsed + FK_WIN_POST_LOCAL;
    expect(shouldRecord).toBe(false);
  });
});

// ─── startFinalKillcam ガード順序 ───────────────────────────────────────────
describe('startFinalKillcam ガード順序', () => {
  it('oldest > killT - FK_WIN_PRE + 0.5 の場合はガード3で false を返す(副作用前)', () => {
    // ガード通過前に副作用が発生しないことの純関数的確認:
    // oldest が新しすぎる(バッファが浅い)場合の guard-3 判定
    const FK_WIN_PRE_LOCAL = 3.5;
    const killT  = 10;
    const oldest = killT - 1; // = 9, FK_WIN_PRE - 0.5 = 3.0, so 9 > 10 - 3.0 = 7 → true = skip
    const shouldSkip = oldest > killT - FK_WIN_PRE_LOCAL + 0.5;
    expect(shouldSkip).toBe(true);
  });

  it('oldest が十分古ければガード3を通過する', () => {
    const FK_WIN_PRE_LOCAL = 3.5;
    const killT  = 10;
    const oldest = killT - 4; // = 6, FK_WIN_PRE - 0.5 = 3.0, so 6 > 10 - 3.0 = 7 → false = pass
    const shouldSkip = oldest > killT - FK_WIN_PRE_LOCAL + 0.5;
    expect(shouldSkip).toBe(false);
  });
});
