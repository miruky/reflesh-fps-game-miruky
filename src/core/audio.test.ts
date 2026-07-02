import { describe, expect, it } from 'vitest';
import {
  BGM_PROGRESSION,
  bgmNoteHz,
  COMPRESSOR_PARAMS,
  dbToGain,
  deriveReverbPreset,
  enemyShotParams,
  healthCutoffHz,
  layerGains,
  makeAsymCurveData,
  makeTanhCurveData,
  normalizeTts,
  pickBestVoice,
  planShot,
  prosodyBase,
  prosodyFor,
  renderImpulse,
  REVERB_PRESETS,
  scoreVoice,
  SHOT_PROFILES,
  type VoiceLike,
} from './audio';
import { STAGES } from '../game/stages';
import { generateStageDef, BIOMES } from '../game/biomes';

// 決定的な擬似乱数(rng注入用)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = (name: string, lang: string, localService: boolean): VoiceLike => ({
  name,
  lang,
  localService,
});

describe('アナウンサー音声の選定(純ロジック)', () => {
  it('ローカル良声(Samantha)がロボット声・クラウド声より優先される', () => {
    const voices = [
      V('Google US English', 'en-US', false),
      V('eSpeak English', 'en-US', true),
      V('Samantha', 'en-US', true),
    ];
    expect(pickBestVoice(voices)?.name).toBe('Samantha');
  });

  it('空配列はnull。en-US不在ならen-GBが非英語より選ばれる', () => {
    expect(pickBestVoice([])).toBeNull();
    const voices = [V('Kyoko', 'ja-JP', true), V('Daniel', 'en-GB', true)];
    expect(pickBestVoice(voices)?.name).toBe('Daniel');
  });

  it('scoreVoice: ローカルはクラウド同名より高得点、ロボット/クラウドは減点', () => {
    expect(scoreVoice(V('Samantha', 'en-US', true))).toBeGreaterThan(
      scoreVoice(V('Samantha', 'en-US', false)),
    );
    // クラウド/ロボット名は -60 が効いて非常に低い
    expect(scoreVoice(V('Google US English', 'en-US', false))).toBeLessThan(0);
    expect(scoreVoice(V('eSpeak', 'en-US', true))).toBeLessThan(
      scoreVoice(V('Alex', 'en-US', true)),
    );
    // 非英語は減点
    expect(scoreVoice(V('Kyoko', 'ja-JP', true))).toBeLessThan(scoreVoice(V('Kyoko', 'en-US', true)));
  });

  it('normalizeTts: 既知ラベルはカンマ区切り、未知は小文字化', () => {
    expect(normalizeTts('TRIPLE KILL', true)).toBe('triple, kill');
    expect(normalizeTts('GODLIKE', false)).toBe('god, like');
    expect(normalizeTts('NUCLEAR', false)).toBe('nuclear');
    expect(normalizeTts('NUCLEAR', true)).toBe('nuclear');
  });

  it('prosodyBase: 既知ラベルは基準テーブル、未知は既定', () => {
    expect(prosodyBase('GODLIKE')).toEqual({ pitch: 0.66, rate: 0.95 });
    expect(prosodyBase('TRIPLE KILL')).toEqual({ pitch: 0.92, rate: 1.2 });
    expect(prosodyBase('NUCLEAR')).toEqual({ pitch: 0.78, rate: 1.05 });
  });

  it('prosodyFor: 基準±微ジッタ内かつpitch[0,2]/rate[0.1,10]に必ず収まる', () => {
    for (const label of ['TRIPLE KILL', 'RAMPAGE', 'GODLIKE', 'NUCLEAR']) {
      for (let i = 0; i < 50; i += 1) {
        const p = prosodyFor(label);
        const b = prosodyBase(label);
        expect(p.pitch).toBeGreaterThanOrEqual(0);
        expect(p.pitch).toBeLessThanOrEqual(2);
        expect(p.rate).toBeGreaterThanOrEqual(0.1);
        expect(p.rate).toBeLessThanOrEqual(10);
        expect(Math.abs(p.pitch - b.pitch)).toBeLessThanOrEqual(0.031);
        expect(Math.abs(p.rate - b.rate)).toBeLessThanOrEqual(0.041);
      }
    }
  });
});

describe('R9 リバーブIR合成とプリセット導出', () => {
  it('renderImpulse: プリディレイ区間ゼロ・直後に非ゼロ・エネルギー正規化(Σx²≈1)', () => {
    const sr = 48000;
    const [l, r] = renderImpulse(sr, 0.5, 0.4, 0.02, 0.18, mulberry32(7));
    const pre = Math.floor(sr * 0.02);
    for (let i = 0; i < pre; i += 1) expect(l[i]).toBe(0);
    // プリディレイ直後の数msに信号が立つ
    let peak = 0;
    for (let i = pre; i < pre + sr * 0.01; i += 1) peak = Math.max(peak, Math.abs(l[i]!));
    expect(peak).toBeGreaterThan(0.001);
    for (const ch of [l, r]) {
      let e = 0;
      for (let i = 0; i < ch.length; i += 1) e += ch[i]! * ch[i]!;
      expect(e).toBeCloseTo(1, 3);
    }
    // L/Rは独立(同一波形のモノラルではない)
    let diff = 0;
    for (let i = pre; i < l.length; i += 1) diff += Math.abs(l[i]! - r[i]!);
    expect(diff).toBeGreaterThan(1);
  });

  it('deriveReverbPreset: 手書きIDマップと20ステージ+8バイオームの決定性', () => {
    const byId = new Map(STAGES.map((s) => [s.id, s]));
    expect(deriveReverbPreset(byId.get('kyokoku')!)).toBe('canyon');
    expect(deriveReverbPreset(byId.get('koushou')!)).toBe('indoor');
    expect(deriveReverbPreset(byId.get('setsugen')!)).toBe('dead');
    for (const s of STAGES) {
      expect(['outdoor', 'canyon', 'indoor', 'dead']).toContain(deriveReverbPreset(s));
    }
    for (const biome of BIOMES) {
      for (const seed of [1, 42, 999]) {
        const def = generateStageDef(seed, biome);
        expect(['outdoor', 'canyon', 'indoor', 'dead']).toContain(deriveReverbPreset(def));
      }
    }
  });

  it('REVERB_PRESETSのwet/retは0..1、canyonが最長', () => {
    for (const p of Object.values(REVERB_PRESETS)) {
      expect(p.wet).toBeGreaterThan(0);
      expect(p.wet).toBeLessThanOrEqual(1);
      expect(p.ret).toBeGreaterThan(0);
      expect(p.ret).toBeLessThanOrEqual(1);
    }
    expect(REVERB_PRESETS.canyon.t60).toBeGreaterThan(REVERB_PRESETS.outdoor.t60);
    expect(REVERB_PRESETS.dead.t60).toBeLessThan(REVERB_PRESETS.indoor.t60);
  });
});

describe('R9 銃声プロファイルとプランナ', () => {
  it('SHOT_PROFILES: サブ層は基音<=0.45かつasym歪み必須(小型スピーカー規律)', () => {
    for (const spec of Object.values(SHOT_PROFILES)) {
      for (const l of spec.layers) {
        if (l.kind === 'sub') {
          expect(l.gain).toBeLessThanOrEqual(0.45);
          expect(l.curve).toBe('asym');
          expect(l.drive ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it('SHOT_PROFILES: 全プロファイルがメカ+ボディを持ち、duckDbは負値', () => {
    for (const spec of Object.values(SHOT_PROFILES)) {
      const kinds = new Set(spec.layers.map((l) => l.kind));
      expect(kinds.has('mech')).toBe(true);
      expect(kinds.has('body-noise')).toBe(true);
      expect(spec.duckDb).toBeLessThan(0);
    }
    // DSRはロングテールを持つ(専用コンボルバ経路)
    expect(SHOT_PROFILES.dmr.layers.some((l) => (l.wetLong ?? 0) > 0)).toBe(true);
  });

  it('planShot: 連射の奇数発とノード予算超過でoptional層を間引く(決定的)', () => {
    const spec = SHOT_PROFILES.ar;
    const total = spec.layers.length;
    const optional = spec.layers.filter((l) => l.optional === true).length;
    expect(optional).toBeGreaterThan(0);
    expect(planShot(spec, false, false, 0).length).toBe(total);
    expect(planShot(spec, true, true, 0).length).toBe(total); // 偶数発はフル
    expect(planShot(spec, true, false, 0).length).toBe(total - optional); // 奇数発は間引き
    expect(planShot(spec, false, true, 301).length).toBe(total - optional); // 予算超過
  });

  it('enemyShotParams: 距離単調減衰+床0.15、遮蔽でこもり、到達遅延は音速風', () => {
    const near = enemyShotParams(5);
    const mid = enemyShotParams(30);
    const far = enemyShotParams(60);
    expect(near.att).toBeGreaterThan(mid.att);
    expect(mid.att).toBeGreaterThan(far.att);
    expect(far.att).toBeGreaterThanOrEqual(0.15);
    expect(enemyShotParams(500).att).toBeCloseTo(0.15, 5);
    expect(near.airLpHz).toBeGreaterThan(far.airLpHz);
    expect(far.airLpHz).toBeGreaterThanOrEqual(300);
    expect(mid.arrivalDelayS).toBeCloseTo(30 * 0.0029, 5);
    expect(enemyShotParams(200).arrivalDelayS).toBe(0.25);
    const occ = enemyShotParams(30, true);
    expect(occ.airLpHz).toBeLessThan(mid.airLpHz);
    expect(occ.att).toBeLessThan(mid.att);
  });

  it('WaveShaperカーブ: tanhは奇対称、asymは非対称(偶数次倍音の源)', () => {
    const t = makeTanhCurveData(3, 512);
    expect(t[0]).toBeCloseTo(-1, 5);
    expect(t[511]).toBeCloseTo(1, 5);
    expect(t[255]! + t[256]!).toBeCloseTo(0, 2); // ほぼ奇対称
    const a = makeAsymCurveData(512);
    // 非対称: 正側と負側の応答が異なる
    expect(Math.abs(a[128]!)).not.toBeCloseTo(Math.abs(a[383]!), 2);
  });
});

describe('R9 ミキシング/BGM理論', () => {
  it('COMPRESSOR_PARAMSは正準値(-10/6/8/3ms/150ms)から動かさない', () => {
    expect(COMPRESSOR_PARAMS).toEqual({
      threshold: -10,
      knee: 6,
      ratio: 8,
      attack: 0.003,
      release: 0.15,
    });
  });

  it('dbToGain: 0dB=1, -6dB≈0.5, -20dB=0.1', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 5);
  });

  it('healthCutoffHz: 30%以上で全開20kHz、瀕死で単調に閉じる', () => {
    expect(healthCutoffHz(1)).toBe(20000);
    expect(healthCutoffHz(0.3)).toBe(20000);
    const h15 = healthCutoffHz(0.15);
    const h05 = healthCutoffHz(0.05);
    expect(h15).toBeLessThan(20000);
    expect(h05).toBeLessThan(h15);
    expect(h05).toBeGreaterThanOrEqual(800);
  });

  it('layerGains: heatに対し単調・全て0..1、パッドは常時>=0.5', () => {
    let prev = layerGains(0);
    expect(prev.pad).toBeCloseTo(0.5, 5);
    for (const h of [0.2, 0.4, 0.6, 0.8, 1]) {
      const g = layerGains(h);
      for (const k of ['pad', 'bass', 'perc', 'hat', 'arp'] as const) {
        expect(g[k]).toBeGreaterThanOrEqual(prev[k]);
        expect(g[k]).toBeGreaterThanOrEqual(0);
        expect(g[k]).toBeLessThanOrEqual(1);
      }
      prev = g;
    }
    expect(layerGains(1).arp).toBe(1);
  });

  it('BGM_PROGRESSION: 4小節×3和音、bgmNoteHzはD2基準のオクターブ倍', () => {
    expect(BGM_PROGRESSION.length).toBe(4);
    for (const chord of BGM_PROGRESSION) expect(chord.length).toBe(3);
    expect(bgmNoteHz(0)).toBeCloseTo(73.42, 2);
    expect(bgmNoteHz(0, 1)).toBeCloseTo(146.84, 2);
    expect(bgmNoteHz(12)).toBeCloseTo(146.84, 2);
  });
});
