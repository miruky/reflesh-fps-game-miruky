import { describe, expect, it } from 'vitest';
import { TrainingStats } from './modes';
import { stagesForMode, TRAINING_STAGE_ID } from './stages';
import { MODE_DEFS, MODE_IDS } from './modes';

// ── TrainingStats ─────────────────────────────────────────────────────────────

describe('TrainingStats', () => {
  it('初期状態は全ゼロ', () => {
    const ts = new TrainingStats();
    expect(ts.shotsFired).toBe(0);
    expect(ts.shotsHit).toBe(0);
    expect(ts.headshots).toBe(0);
    expect(ts.consecutiveHits).toBe(0);
    expect(ts.accuracy()).toBe(0);
    expect(ts.hsRate()).toBe(0);
    expect(ts.dps(0)).toBe(0);
  });

  it('accuracy は shotsFired/shotsHit の比', () => {
    const ts = new TrainingStats();
    ts.shotsFired = 10;
    ts.shotsHit = 7;
    expect(ts.accuracy()).toBeCloseTo(0.7);
  });

  it('shotsFired = 0 のとき accuracy = 0(ゼロ除算なし)', () => {
    const ts = new TrainingStats();
    expect(ts.accuracy()).toBe(0);
  });

  it('hsRate は shotsHit/headshots の比', () => {
    const ts = new TrainingStats();
    ts.shotsHit = 5;
    ts.headshots = 2;
    expect(ts.hsRate()).toBeCloseTo(0.4);
  });

  it('shotsHit = 0 のとき hsRate = 0', () => {
    const ts = new TrainingStats();
    expect(ts.hsRate()).toBe(0);
  });

  it('addDamage が直近3秒ウィンドウで DPS を計算する', () => {
    const ts = new TrainingStats();
    ts.addDamage(1, 60); // elapsed=1 でダメージ60
    ts.addDamage(2, 60); // elapsed=2 でダメージ60
    // elapsed=5 で参照: cutoff=2, elapsed=1 は除外, elapsed=2 はギリギリ残る
    // total = 60, dps = 60/3 = 20
    expect(ts.dps(5)).toBeCloseTo(20);
  });

  it('古いエントリはウィンドウから除去される', () => {
    const ts = new TrainingStats();
    ts.addDamage(0, 100);
    // elapsed=10 で参照: cutoff=7, elapsed=0は除外 → dps=0
    expect(ts.dps(10)).toBe(0);
  });

  it('addMiss で consecutiveHits がリセットされる', () => {
    const ts = new TrainingStats();
    ts.consecutiveHits = 5;
    ts.addMiss();
    expect(ts.consecutiveHits).toBe(0);
  });
});

// ── stagesForMode('training') ─────────────────────────────────────────────────

describe('stagesForMode training', () => {
  it("'training' モードは renshujo ステージだけを返す", () => {
    const stages = stagesForMode('training');
    expect(stages).toHaveLength(1);
    expect(stages[0]?.id).toBe(TRAINING_STAGE_ID);
  });

  it('renshujo は botCount 0', () => {
    const stages = stagesForMode('training');
    expect(stages[0]?.botCount).toBe(0);
  });

  it("通常モードは renshujo を含まない", () => {
    const stages = stagesForMode('ffa');
    expect(stages.every((s) => s.id !== TRAINING_STAGE_ID)).toBe(true);
  });
});

// ── MODE_DEFS / MODE_IDS ──────────────────────────────────────────────────────

describe('training mode definition', () => {
  it("MODE_DEFS に 'training' が存在する", () => {
    expect(MODE_DEFS.training).toBeDefined();
    expect(MODE_DEFS.training.name).toBe('訓練場');
    expect(MODE_DEFS.training.scoreTarget).toBe(Infinity);
    expect(MODE_DEFS.training.teamBased).toBe(false);
  });

  it("MODE_IDS に 'training' が含まれる", () => {
    expect(MODE_IDS).toContain('training');
  });
});
