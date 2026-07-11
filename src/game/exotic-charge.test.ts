import { describe, it, expect } from 'vitest';
import { WEAPON_DEFS } from './weapons';
import { MINIGUN_HOLD_GRACE_S, minigunNextRpm } from './match-helpers';

describe('exotic weapon damage values', () => {
  it('banjin-smg damage is 45', () => {
    expect(WEAPON_DEFS['banjin-smg']?.damage).toBe(45);
  });
  it('gekkou-bow damage is 200', () => {
    expect(WEAPON_DEFS['gekkou-bow']?.damage).toBe(200);
  });
  it('fujin-fan damage is 35', () => {
    expect(WEAPON_DEFS['fujin-fan']?.damage).toBe(35);
  });
  it('gouen-musket damage is 260', () => {
    expect(WEAPON_DEFS['gouen-musket']?.damage).toBe(260);
  });
  it('tenrai-staff damage is 160', () => {
    expect(WEAPON_DEFS['tenrai-staff']?.damage).toBe(160);
  });
  it('shinkirou-sniper damage is 90', () => {
    expect(WEAPON_DEFS['shinkirou-sniper']?.damage).toBe(90);
  });
  it('shura-lmg damage is 28', () => {
    expect(WEAPON_DEFS['shura-lmg']?.damage).toBe(28);
  });
  it('all 7 exotic weapons have class exotic', () => {
    const exoticIds = ['banjin-smg', 'gekkou-bow', 'fujin-fan', 'gouen-musket', 'tenrai-staff', 'shinkirou-sniper', 'shura-lmg'] as const;
    for (const id of exoticIds) {
      expect(WEAPON_DEFS[id]?.class).toBe('exotic');
    }
  });
});

// ── R59①: 修羅ミニガン化(制圧射程+長押しスピンアップ) ──────────────────
describe('R59① 修羅の制圧射程(falloff)', () => {
  const shura = WEAPON_DEFS['shura-lmg']!;

  it('falloffはミニガン級の 38/90/0.5', () => {
    expect(shura.falloff).toEqual({ start: 38, end: 90, minFactor: 0.5 });
  });

  it('全LMG(M251/RPK-14/DP-29)のfalloff start/end を明確に上回る', () => {
    for (const id of ['kumagera-lmg', 'tsuchigumo-lmg', 'raitei-lmg'] as const) {
      const lmg = WEAPON_DEFS[id]!;
      expect(shura.falloff.start, id).toBeGreaterThan(lmg.falloff.start);
      expect(shura.falloff.end, id).toBeGreaterThan(lmg.falloff.end);
    }
  });

  it('遠距離(フォールオフ終端以降)の持続DPSも全LMGの1.4倍以上=遠くまで弾幕が届く', () => {
    const shuraFarDps = shura.damage * shura.falloff.minFactor * (shura.rpm / 60); // 420
    for (const id of ['kumagera-lmg', 'tsuchigumo-lmg', 'raitei-lmg'] as const) {
      const lmg = WEAPON_DEFS[id]!;
      const lmgFarDps = lmg.damage * lmg.falloff.minFactor * (lmg.rpm / 60);
      expect(shuraFarDps, id).toBeGreaterThan(lmgFarDps * 1.4);
    }
  });

  it('強化してもOSKにはならない(頭ヒットでも 28×1.4=39.2 < 100)', () => {
    expect(shura.damage * shura.headshotMultiplier).toBeLessThan(100);
  });
});

describe('R59① 修羅スピンアップ状態遷移(長押し)', () => {
  const DT = 1 / 60;
  const FIRE_RPM = 400; // match.ts の発射ゲート閾値(minigunCurrentRpm >= 400)
  const MAX_RPM = 1800;

  it('押下→約0.43sで発射閾値(400rpm)→2.0s以内に最大回転(1800rpm)', () => {
    let rpm = 0;
    let t = 0;
    let fireStartT = -1;
    while (t < 3 && rpm < MAX_RPM) {
      rpm = minigunNextRpm(rpm, DT, true);
      t += DT;
      if (fireStartT < 0 && rpm >= FIRE_RPM) fireStartT = t;
    }
    expect(fireStartT).toBeGreaterThan(0.35); // 撃ち始めの「重さ」がある
    expect(fireStartT).toBeLessThan(0.5); // だが0.5sは超えない(指示レンジ0.4-0.5s)
    expect(rpm).toBe(MAX_RPM);
    expect(t).toBeLessThan(2.1);
  });

  it('離しても猶予(0.8s)未満は回転維持=再押下で即発射できる', () => {
    expect(MINIGUN_HOLD_GRACE_S).toBe(0.8);
    let rpm = MAX_RPM;
    let sinceReleased = 0;
    // match.ts 配線と同じ更新: sinceReleased += dt → minigunNextRpm(…, sinceReleased)
    for (let i = 0; i < 45; i += 1) {
      // 0.75s < 0.8s
      sinceReleased += DT;
      rpm = minigunNextRpm(rpm, DT, false, sinceReleased);
    }
    expect(rpm).toBe(MAX_RPM); // 猶予中は1rpmも落ちない
  });

  it('猶予を超えたら減衰し、0.5s強で完全停止する', () => {
    let rpm = MAX_RPM;
    let sinceReleased = MINIGUN_HOLD_GRACE_S; // 猶予ちょうど=減衰開始
    let t = 0;
    while (rpm > 0 && t < 2) {
      rpm = minigunNextRpm(rpm, DT, false, sinceReleased);
      sinceReleased += DT;
      t += DT;
    }
    expect(rpm).toBe(0);
    expect(t).toBeLessThanOrEqual(0.55); // 1800/(3600rpm/s)=0.5s(離散化の1tick誤差込み)
  });

  it('第4引数省略(武器切替経路)は従来どおり即減衰=互換維持', () => {
    const next = minigunNextRpm(MAX_RPM, 0.25, false);
    expect(next).toBeCloseTo(MAX_RPM - 3600 * 0.25, 6);
  });
});
