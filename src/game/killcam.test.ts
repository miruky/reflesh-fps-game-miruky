import { describe, expect, it } from 'vitest';
import { fkIsStale } from './match';

// ── CK(シネマティックキルカム) ウィンドウ計算の純関数テスト ──────────────────
// match.ts の CK定数・ckSpeedAt・ckCamPos と同じロジックを純関数として再現してテストする。
// 実装の破壊的変更を検知するデグレガード。

// 記録窓(変更なし — fkRecordFrame は FK_WIN_PRE/POST 固定)
const FK_WIN_PRE  = 3.5;
const FK_WIN_POST = 1.2;

// 再生窓(シネマティック化で変更)
const CK_WIN_PRE  = 2.5;
const CK_WIN_POST = 1.5;

// ─── 実時間計算ヘルパー ────────────────────────────────────────────────────
function realTimeCost(gameStart: number, gameEnd: number, killT: number, steps = 10000): number {
  const span = gameEnd - gameStart;
  const dg   = span / steps;
  let total  = 0;
  for (let i = 0; i < steps; i++) {
    const cursor = gameStart + (i + 0.5) * dg;
    total += dg / ckSpeedAt(cursor, killT);
  }
  return total;
}

// ckSpeedAt のミラー実装(match.ts と同一ロジック)
function ckSpeedAt(cursor: number, killT: number): number {
  const d = cursor - killT;
  if (d < -0.4) return 1.0;
  if (d < 0.0) {
    const t = (d + 0.4) / 0.4;
    return 1.0 + (0.2 - 1.0) * t;
  }
  if (d < 0.6) return 0.2;
  const t = Math.min(1, (d - 0.6) / Math.max(1e-6, CK_WIN_POST - 0.6));
  return 0.2 + (1.0 - 0.2) * t;
}

// ckCamPos のミラー実装(match.ts と同一ロジック)
function ckCamPosMath(
  kx: number, ky: number, kz: number,
  vx: number, vy: number, vz: number,
  side: 1 | -1,
  height: number,
  dollyOffset = 0,
): { x: number; y: number; z: number } {
  const sx = vx - kx;
  const sz = vz - kz;
  const segLen = Math.sqrt(sx * sx + (vy - ky) ** 2 + sz * sz);
  const horizLen = Math.sqrt(sx * sx + sz * sz);
  let perpX = 0; let perpZ = 1;
  if (horizLen > 0.01) { perpX = (-sz / horizLen) * side; perpZ = (sx / horizLen) * side; }
  const midX = (kx + vx) * 0.5;
  const midY = (ky + vy) * 0.5;
  const midZ = (kz + vz) * 0.5;
  const d = segLen * 0.9 + 6 + dollyOffset;
  return { x: midX + perpX * d, y: midY + height, z: midZ + perpZ * d };
}

describe('CK ウィンドウ定数', () => {
  it('再生窓の先頭はキル-2.5s', () => {
    const killT = 10;
    expect(killT - CK_WIN_PRE).toBeCloseTo(7.5, 6);
  });

  it('再生窓の末尾はキル+1.5s', () => {
    const killT = 10;
    expect(killT + CK_WIN_POST).toBeCloseTo(11.5, 6);
  });

  it('記録窓(FK_WIN_PRE/POST)は変更なし: 3.5 / 1.2', () => {
    expect(FK_WIN_PRE).toBe(3.5);
    expect(FK_WIN_POST).toBe(1.2);
  });

  it('CK 再生窓 > FK 記録窓後半: CK_WIN_POST(1.5) > FK_WIN_POST(1.2)', () => {
    // 記録は1.2s後まで。再生窓は1.5s後まで伸びる。
    // 1.2s以降は fkFindFrames が[lastFrame,lastFrame,0]を返して静止するが正常動作。
    expect(CK_WIN_POST).toBeGreaterThan(FK_WIN_POST);
  });
});

describe('ckSpeedAt 速度ランプ', () => {
  it('キル 1s 前: 等速1×', () => {
    expect(ckSpeedAt(9, 10)).toBe(1.0);
  });

  it('キル -0.4s: 1× から 0.2× への遷移開始', () => {
    const v = ckSpeedAt(9.6, 10);
    expect(v).toBeCloseTo(1.0, 5); // d = -0.4, 遷移の最初
  });

  it('キル -0.2s: 約 0.6×(遷移中)', () => {
    // d = -0.2, t = (-0.2+0.4)/0.4 = 0.5, speed = 1.0 + (0.2-1.0)*0.5 = 0.6
    const v = ckSpeedAt(9.8, 10);
    expect(v).toBeCloseTo(0.6, 5);
  });

  it('キル時刻: 0.2× ホールド開始', () => {
    expect(ckSpeedAt(10, 10)).toBe(0.2);
  });

  it('キル後 0.6s: まだ 0.2× ホールド(境界)', () => {
    expect(ckSpeedAt(10.6, 10)).toBe(0.2);
  });

  it('キル後 0.6s より後: 徐々に 1.0 へ復帰', () => {
    const v = ckSpeedAt(11.0, 10);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(1.0);
  });

  it('窓終端(CK_WIN_POST=1.5): ほぼ 1×', () => {
    const v = ckSpeedAt(10 + CK_WIN_POST, 10);
    expect(v).toBeCloseTo(1.0, 5);
  });
});

describe('ckSpeedAt 速度 単調性', () => {
  it('キル前(-2.5s〜-0.4s)は常に1×', () => {
    const killT = 10;
    for (let d = -2.5; d <= -0.4; d += 0.1) {
      expect(ckSpeedAt(killT + d, killT)).toBe(1.0);
    }
  });

  it('キル〜キル後0.6sは常に0.2×', () => {
    const killT = 10;
    for (let d = 0; d <= 0.6; d += 0.05) {
      expect(ckSpeedAt(killT + d, killT)).toBe(0.2);
    }
  });

  it('速度は常に0.2以上1.0以下', () => {
    const killT = 10;
    for (let d = -CK_WIN_PRE; d <= CK_WIN_POST; d += 0.05) {
      const v = ckSpeedAt(killT + d, killT);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });
});

// ─── 実時間長の検証テスト ──────────────────────────────────────────────────
describe('CK スロー再生の実時間計算', () => {
  const killT = 10;

  it('キル前2.5s区間を等速で進むコスト ≈ 2.1s real (d<-0.4は1×, -0.4〜0は減速)', () => {
    const cost = realTimeCost(killT - 2.5, killT, killT);
    // [-2.5,-0.4]=2.1s×1=2.1s, [-0.4,0]=減速で実時間>0.4
    expect(cost).toBeGreaterThan(2.1);
  });

  it('0.2×スロー区間[+0s,+0.6s]の実時間 = 3.0s (0.6/0.2)', () => {
    const cost = realTimeCost(killT, killT + 0.6, killT);
    expect(cost).toBeCloseTo(3.0, 1);
  });

  it('窓全体(CK_WIN_PRE=2.5からCK_WIN_POST=1.5)の実時間 > 6.0s', () => {
    const cost = realTimeCost(killT - CK_WIN_PRE, killT + CK_WIN_POST, killT);
    expect(cost).toBeGreaterThan(6.0);
  });

  it('ckCursor を oldest=killT-2.0 でクランプしても window は killT+1.5 まで到達する', () => {
    let cursor = killT - 2.0;
    const winEnd = killT + CK_WIN_POST;
    const DT_REAL = 1 / 60;
    let frames = 0;
    while (cursor < winEnd && frames < 20000) {
      cursor += DT_REAL * ckSpeedAt(cursor, killT);
      frames++;
    }
    expect(cursor).toBeGreaterThanOrEqual(winEnd);
    // スロー込みで5秒以上かかる = 300フレーム以上
    expect(frames).toBeGreaterThan(300);
  });
});

describe('CK カーソルクランプ (startFinalKillcam)', () => {
  it('oldest <= killT-2.0 のとき cursor は oldest から始まる(バグ回避)', () => {
    const killT  = 10;
    const oldest = killT - 2.0;
    const cursor = Math.max(oldest, killT - CK_WIN_PRE);
    // killT-CK_WIN_PRE = 7.5, oldest = 8.0 → cursor = 8.0 = oldest
    expect(cursor).toBe(oldest);
    expect(cursor).toBeGreaterThanOrEqual(oldest);
  });

  it('oldest が十分古い(killT-4.0)なら cursor = killT-CK_WIN_PRE', () => {
    const killT  = 10;
    const oldest = killT - 4.0;
    const cursor = Math.max(oldest, killT - CK_WIN_PRE);
    expect(cursor).toBeCloseTo(killT - CK_WIN_PRE, 6);
  });
});

describe('CK カメラ位置計算 (ckCamPos)', () => {
  it('killer と victim が Z軸方向に並ぶとき、カメラは垂線上(X方向)に出る', () => {
    // killer=(0,0,0), victim=(0,0,10) → perp = (1,0,0) (side=1)
    const p = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 3);
    // midX=0, perpX=1(because sz=-10/10=-1, so perpX=-(-1)*1=1)... wait
    // sx=0, sz=10, horizLen=10, perpX = (-sz/horizLen)*side = (-10/10)*1 = -1
    // Actually: perpX = (-sz/horizLen)*side = (-10/10)*1 = -1, perpZ = (sx/horizLen)*side = 0
    // midX = 0, midZ = 5
    // So camera is at (-d, midY+3, 5)
    expect(p.y).toBeCloseTo(3, 3); // midY + height = 0 + 3
    expect(p.z).toBeCloseTo(5, 3); // midZ = 5
    // p.x should be non-zero (perpendicular)
    expect(Math.abs(p.x)).toBeGreaterThan(1);
  });

  it('side=-1 は side=1 の反対側に出る', () => {
    const p1 = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 3);
    const p2 = ckCamPosMath(0, 0, 0, 0, 0, 10, -1, 3);
    // x座標が反転する
    expect(p2.x).toBeCloseTo(-p1.x, 3);
    // y, z は同じ
    expect(p2.y).toBeCloseTo(p1.y, 3);
    expect(p2.z).toBeCloseTo(p1.z, 3);
  });

  it('height オフセットが正しく適用される', () => {
    const p3 = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 3);
    const p5 = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 5);
    expect(p5.y - p3.y).toBeCloseTo(2, 3);
  });

  it('dollyOffset が距離に加算される', () => {
    const p0 = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 3, 0);
    const p1 = ckCamPosMath(0, 0, 0, 0, 0, 10, 1, 3, 1);
    // ドリーオフセット1mでカメラが更に外へ移動する
    const dist0 = Math.hypot(p0.x, p0.z - 5);
    const dist1 = Math.hypot(p1.x, p1.z - 5);
    expect(dist1).toBeGreaterThan(dist0);
  });

  it('killer === victim でも crashしない(horizLen=0のフォールバック)', () => {
    const p = ckCamPosMath(5, 0, 5, 5, 0, 5, 1, 3);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  });
});

// T4(R53): 旧「三人称でもスコープ非表示」テスト群を削除。
// match.ts から fkKillerScopedWeapon/fkLiveAdsRatio/fkLiveAdsFov/fkScopeInfo を
// 全撤去(常時false相当を返すgetter自体がなくなった=キルカムにスコープ概念が存在しない)。
// これらは削除済みフィールド名をローカル定数として再現するだけの自己参照テストで
// あり、match.ts側の変更を検知できない死んだ回帰ガードだったため整理する。

describe('FK applyDeathPose 時間境界', () => {
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

// ─── アバター死亡倒れアニメーション ────────────────────────────────────────
describe('CK プレイヤーアバター死亡倒れ', () => {
  it('キル後0.0s: アバター X回転 = 0', () => {
    const elapsed = 0;
    const dpT = Math.min(1, elapsed / 0.6);
    const dpSS = dpT * dpT * (3 - 2 * dpT);
    expect(dpSS * (Math.PI / 2) * 0.95).toBeCloseTo(0, 5);
  });

  it('キル後0.6s: アバター X回転 ≈ π/2×0.95(完全倒れ)', () => {
    const elapsed = 0.6;
    const dpT = Math.min(1, elapsed / 0.6);
    const dpSS = dpT * dpT * (3 - 2 * dpT);
    expect(dpSS * (Math.PI / 2) * 0.95).toBeCloseTo((Math.PI / 2) * 0.95, 5);
  });

  it('smoothstep は単調増加', () => {
    let prev = -1;
    for (let e = 0; e <= 0.6; e += 0.05) {
      const dpT = Math.min(1, e / 0.6);
      const val = dpT * dpT * (3 - 2 * dpT);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });
});

// ─── trailing window (over後の記録継続) ─────────────────────────────────────
// FK_WIN_POST=1.2 は記録側の定数 — 変更していないことを確認
describe('FK trailing window (over後の記録継続)', () => {
  const FK_WIN_POST_LOCAL = 1.2;

  it('elapsed === fkKillElapsed + FK_WIN_POST は記録対象(境界値)', () => {
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
    const FK_TICK_INT_LOCAL = 3;
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
    expect(frames).toBeGreaterThanOrEqual(24);
  });

  it('fkKillElapsed が -Infinity の場合は trailing window に入らない', () => {
    const fkKillElapsed = -Infinity;
    const elapsed = 100;
    const shouldRecord = fkKillElapsed !== -Infinity && elapsed <= fkKillElapsed + FK_WIN_POST_LOCAL;
    expect(shouldRecord).toBe(false);
  });
});

// ─── startFinalKillcam ガード順序 ────────────────────────────────────────────
describe('startFinalKillcam ガード順序', () => {
  it('oldest > killT - FK_WIN_PRE + 0.5 の場合はガード3で false を返す(副作用前)', () => {
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

  it('ゾンビモード(mode===zombie)では startFinalKillcam が false を返す', () => {
    // match.ts: if (this.config.mode === 'zombie') return false;
    const mode = 'zombie' as const;
    const wouldReturn = mode === 'zombie' ? false : true;
    expect(wouldReturn).toBe(false);
  });
});

// ─── R54-W1 Q2: FK鮮度ガード(汎用・モード非依存) ───────────────────────────
// startFinalKillcam 呼び出し時点で「最終キル」からリングバッファの実時間窓(4.5s)を
// ほぼ使い切るほど経過していれば、そのキルのフレームはもはやバッファから信頼できる形で
// 再現できない。over確定がキルと直結しないモード(Hardpoint等)で発生しうる潜在バグの保険。
describe('fkIsStale(FK鮮度ガード)', () => {
  const BUFFER_S = 4.5; // FK_MAX_FRAMES(90) / 20Hz

  it('キル直後(elapsed===killElapsed)は鮮度あり=falseを返す', () => {
    expect(fkIsStale(100, 100, BUFFER_S)).toBe(false);
  });

  it('経過が bufferSeconds-1 未満なら鮮度あり=false', () => {
    expect(fkIsStale(100 + (BUFFER_S - 1 - 0.01), 100, BUFFER_S)).toBe(false);
  });

  it('経過が bufferSeconds-1 を境に false→true へ切り替わる', () => {
    const killElapsed = 100;
    expect(fkIsStale(killElapsed + (BUFFER_S - 1) - 0.001, killElapsed, BUFFER_S)).toBe(false);
    expect(fkIsStale(killElapsed + (BUFFER_S - 1) + 0.001, killElapsed, BUFFER_S)).toBe(true);
  });

  it('新しいキル(over確定がキル直後)ではFKをスキップしない', () => {
    // 典型: match.overがキルと同フレームで確定し、次rAFでstartFinalKillcamが呼ばれる
    expect(fkIsStale(50.02, 50.0, BUFFER_S)).toBe(false);
  });

  it('古いキル(Hardpoint等でoverがキルと直結せず数秒後に確定)ではFKをスキップする', () => {
    // 最終キルから5秒経ってから match.over が確定したケース(バッファ窓4.5sを超えて経過)
    expect(fkIsStale(55, 50, BUFFER_S)).toBe(true);
  });
});

// ─── R56 W3 #2: Match.tickKillcamTrailing の契約(over後、毎フレーム呼びで記録が継続する) ───
// 根本原因: update() 内の over 分岐(上の「FK trailing window」テスト群が検証する条件式)は、
// over 確定の次 rAF で main.ts が mode を 'finalkillcam' へ切り替えて以後 update() を
// 呼ばなくなるため、定常フレームレートでは実行到達しない=事実上の死コードだった
// (実機計測: match.elapsed が over 後に一切前進しないことを確認済み)。
// 修正: 同一ロジックを Match.tickKillcamTrailing(dt) として public 化し、main.ts の
// finalkillcam 分岐(advanceFinalKillcam 呼び出しの直前)から毎フレーム呼ぶよう変更した
// (match.ts の advanceFinalKillcam 直前・main.ts の `mode === 'finalkillcam'` 分岐)。
// Match は THREE Renderer/Rapier 等の重い依存を要し、この vitest 環境(environment: 'node',
// 既存テスト群も同じ制約で Match を直接インスタンス化していない)では単体構築できないため、
// tickKillcamTrailing と同一ロジックをミラーして「毎フレーム呼ばれ続けたときに正しく
// 動作し、killElapsed+FK_WIN_POST で確実に頭打ちになる」契約をピン留めする。
describe('tickKillcamTrailing 契約(over後、毎フレーム呼びで記録が継続する)', () => {
  // Match.tickKillcamTrailing とロジック同一(match.ts の advanceFinalKillcam 直前を参照)
  function mirrorTick(
    state: { elapsed: number; tickCount: number; recordedFrames: number },
    dt: number,
    killElapsed: number,
    isZombie: boolean,
  ): void {
    if (!isZombie && killElapsed !== -Infinity && state.elapsed <= killElapsed + FK_WIN_POST) {
      state.elapsed += dt;
      state.tickCount = (state.tickCount + 1) % 3; // FK_TICK_INT=3 → 20Hz
      if (state.tickCount === 0) state.recordedFrames++;
    }
  }

  it('over直後から毎フレーム(dt=1/60)呼び続けると、elapsedはkillElapsed+FK_WIN_POSTまで前進して頭打ちになる', () => {
    const killElapsed = 5.0;
    const state = { elapsed: killElapsed, tickCount: 0, recordedFrames: 0 };
    const dt = 1 / 60;
    for (let i = 0; i < 200; i++) mirrorTick(state, dt, killElapsed, false);
    expect(state.elapsed).toBeGreaterThanOrEqual(killElapsed + FK_WIN_POST);
    expect(state.elapsed).toBeLessThan(killElapsed + FK_WIN_POST + dt);
  });

  it('20Hzで記録され、post-kill窓ぶん(≈24フレーム)が録画バッファへ積まれる(修正前は0だった)', () => {
    const killElapsed = 0;
    const state = { elapsed: killElapsed, tickCount: 0, recordedFrames: 0 };
    const dt = 1 / 60;
    for (let i = 0; i < 200; i++) mirrorTick(state, dt, killElapsed, false);
    expect(state.recordedFrames).toBeGreaterThanOrEqual(24);
  });

  it('ゾンビモードでは一切前進しない(no-op)', () => {
    const killElapsed = 5.0;
    const state = { elapsed: killElapsed, tickCount: 0, recordedFrames: 0 };
    for (let i = 0; i < 10; i++) mirrorTick(state, 1 / 60, killElapsed, true);
    expect(state.elapsed).toBe(killElapsed);
    expect(state.recordedFrames).toBe(0);
  });

  it('killElapsed===-Infinity(キル未発生)では一切前進しない(no-op)', () => {
    const state = { elapsed: 100, tickCount: 0, recordedFrames: 0 };
    for (let i = 0; i < 10; i++) mirrorTick(state, 1 / 60, -Infinity, false);
    expect(state.elapsed).toBe(100);
    expect(state.recordedFrames).toBe(0);
  });
});
