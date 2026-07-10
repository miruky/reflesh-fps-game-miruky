import { describe, expect, it } from 'vitest';
import {
  EMPEROR_ATMOS,
  KAGEGA_DELAY_S,
  KAGEGA_MUL,
  MINIGUN_HOLD_GRACE_S,
  minigunNextRpm,
  RAIKIN_DIRS,
  RAIKIN_DMG,
  RAIKIN_RANGE_M,
  RAIKIN_SPREAD_RAD,
  SHURA_PHASE_HITS,
  SHURA_PHASE_MOVE_PENALTY_MUL,
  SHURA_PHASE_RPM_CAP_MUL,
  SHURA_PHASE_SPREAD_MUL,
  shuraPhaseFor,
} from './match-helpers';

// ── R54-F8' E2: 修羅の相(連続ヒット段階) ────────────────────────────────
describe('R54 帝王2: shuraPhaseFor', () => {
  it('閾値境界: 0-19=相0 / 20-59=相1 / 60-119=相2 / 120+=相3', () => {
    expect(shuraPhaseFor(0)).toBe(0);
    expect(shuraPhaseFor(19)).toBe(0);
    expect(shuraPhaseFor(20)).toBe(1);
    expect(shuraPhaseFor(59)).toBe(1);
    expect(shuraPhaseFor(60)).toBe(2);
    expect(shuraPhaseFor(119)).toBe(2);
    expect(shuraPhaseFor(120)).toBe(3);
    expect(shuraPhaseFor(99999)).toBe(3);
  });

  it('SHURA_PHASE_HITS は凍結契約 [20, 60, 120]', () => {
    expect(SHURA_PHASE_HITS).toEqual([20, 60, 120]);
  });

  it('補正テーブルは4段そろい、相0は全て等倍', () => {
    for (const table of [
      SHURA_PHASE_SPREAD_MUL,
      SHURA_PHASE_RPM_CAP_MUL,
      SHURA_PHASE_MOVE_PENALTY_MUL,
    ]) {
      expect(table).toHaveLength(4);
      expect(table[0]).toBe(1);
    }
    // 相1+: 集弾強化 / 相2+: RPM上限強化 / 相3: 移動ペナルティ半減
    expect(SHURA_PHASE_SPREAD_MUL[1]).toBeLessThan(1);
    expect(SHURA_PHASE_RPM_CAP_MUL[2]).toBeGreaterThan(1);
    expect(SHURA_PHASE_MOVE_PENALTY_MUL[3]).toBeLessThan(1);
  });
});

// ── R54-F8' E1: ミニガン保持猶予(スピン維持) ────────────────────────────
describe('R54 帝王2: minigunNextRpm 保持猶予', () => {
  it('離してから猶予内(<0.8s)は rpm を保持する', () => {
    expect(minigunNextRpm(1800, 0.1, false, 0)).toBe(1800);
    expect(minigunNextRpm(1200, 0.1, false, 0.79)).toBe(1200);
  });

  it('猶予を超えたら従来どおり減衰する(1800→0 が 0.5s)', () => {
    let rpm = 1800;
    rpm = minigunNextRpm(rpm, 0.25, false, MINIGUN_HOLD_GRACE_S);
    rpm = minigunNextRpm(rpm, 0.25, false, MINIGUN_HOLD_GRACE_S + 0.25);
    expect(rpm).toBeCloseTo(0, 1);
  });

  it('3引数呼び出し(後方互換)は即時減衰=旧挙動', () => {
    const legacy = minigunNextRpm(1800, 0.25, false);
    expect(legacy).toBeCloseTo(900, 1);
  });

  it('spinning=true では sinceReleasedS に関係なく上昇する', () => {
    expect(minigunNextRpm(400, 0.1, true, 0)).toBeGreaterThan(400);
  });

  it('MINIGUN_HOLD_GRACE_S は凍結契約 0.8', () => {
    expect(MINIGUN_HOLD_GRACE_S).toBe(0.8);
  });
});

// ── R54-F8' E1: 雷禽・影牙(溜め段2.5派生)の凍結定数 ─────────────────────
describe('R54 帝王2: 雷禽/影牙 定数', () => {
  it('雷禽: 120dmg × 3方向 / 扇0.5rad / 射程14m', () => {
    expect(RAIKIN_DMG).toBe(120);
    expect(RAIKIN_DIRS).toBe(3);
    expect(RAIKIN_SPREAD_RAD).toBe(0.5);
    expect(RAIKIN_RANGE_M).toBe(14);
  });

  it('影牙: 0.5倍の遅延追撃が0.4s後', () => {
    expect(KAGEGA_MUL).toBe(0.5);
    expect(KAGEGA_DELAY_S).toBe(0.4);
  });
});

// ── R54-F8' E1: EMPEROR_ATMOS(帝王アトモスのパリティ契約) ────────────────
describe('R54 帝王2: EMPEROR_ATMOS', () => {
  it('3モードそろい、必須フィールドを持つ', () => {
    for (const key of ['raitei', 'dark', 'kokuraitei'] as const) {
      const spec = EMPEROR_ATMOS[key];
      expect(spec).toBeDefined();
      expect(typeof spec.fogTint).toBe('number');
      expect(spec.fogTintMix).toBeGreaterThan(0);
      expect(spec.fogDensityMul).toBeGreaterThanOrEqual(1);
    }
  });

  it('雷帝: 可視空 scale 0.14 / clamp 0.46(R53実測の黒転より明るい嵐)', () => {
    expect(EMPEROR_ATMOS.raitei.skyScale).toBe(0.14);
    expect(EMPEROR_ATMOS.raitei.skyClamp).toBe(0.46);
  });

  it('黒帝: 空は触らず(null)フォグのみ=既存黒帝ビジュアル不変', () => {
    expect(EMPEROR_ATMOS.dark.skyScale).toBeNull();
    expect(EMPEROR_ATMOS.dark.skyClamp).toBeNull();
  });

  it('黒雷帝: 最暗(0.06/0.3)かつ fogTintMix 全量=既存黒転と同値', () => {
    expect(EMPEROR_ATMOS.kokuraitei.skyScale).toBe(0.06);
    expect(EMPEROR_ATMOS.kokuraitei.skyClamp).toBe(0.3);
    expect(EMPEROR_ATMOS.kokuraitei.fogTintMix).toBe(1.0);
  });

  it('暗さの序列: 黒雷帝 < 雷帝(排他優先 kokuraitei>dark>raitei の視覚根拠)', () => {
    const k = EMPEROR_ATMOS.kokuraitei;
    const r = EMPEROR_ATMOS.raitei;
    expect(k.skyScale!).toBeLessThan(r.skyScale!);
    expect(k.skyClamp!).toBeLessThan(r.skyClamp!);
  });
});
