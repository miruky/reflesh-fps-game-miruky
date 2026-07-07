import { describe, expect, it } from 'vitest';
import {
  BGM_PROFILES,
  BGM_PROGRESSION,
  BGM_ROOT_HZ,
  bgmNoteHz,
  type BgmProfileKey,
  BOW_RELEASE_SPEC,
  COMPRESSOR_PARAMS,
  dbToGain,
  deriveReverbPreset,
  enemyShotParams,
  FAN_WHOOSH_SPEC,
  healthCutoffHz,
  layerGains,
  makeAsymCurveData,
  makeTanhCurveData,
  MINIGUN_SPIN_SPEC,
  normalizeTts,
  pickBestVoice,
  planShot,
  prosodyBase,
  prosodyFor,
  renderImpulse,
  REVERB_PRESETS,
  scoreVoice,
  SHOT_PROFILES,
  SoundKit,
  STAFF_FIRE_SPEC,
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

  it('layerGains: heatに対し単調・全て0..1、heat=0で完成した駆動トラック、sub層追加、leadは前倒し', () => {
    let prev = layerGains(0);
    // R16: heat=0 で既に完成した駆動トラック(ヒーリング脱却)。パッドは 0.18 のベッドへ更に降格。
    expect(prev.pad).toBeCloseTo(0.18, 5);
    expect(prev.bass).toBeGreaterThanOrEqual(0.5); // 駆動ベースは heat=0 から芯がある
    expect(prev.perc).toBeGreaterThanOrEqual(0.5); // 3層キック/スネアも heat=0 から
    expect(prev.hat).toBeGreaterThanOrEqual(0.4); // ハットは早く立つ
    expect(prev.arp).toBeGreaterThanOrEqual(0.5); // アルペジオも常時
    expect(prev.sub).toBeGreaterThanOrEqual(0.5); // sub-drone 層は heat=0 から地響き
    expect(prev.lead).toBe(0); // heat=0 では歪みリード指標は無音
    for (const h of [0.2, 0.4, 0.6, 0.8, 1]) {
      const g = layerGains(h);
      for (const k of ['pad', 'bass', 'perc', 'hat', 'arp', 'sub', 'lead'] as const) {
        expect(g[k]).toBeGreaterThanOrEqual(prev[k]);
        expect(g[k]).toBeGreaterThanOrEqual(0);
        expect(g[k]).toBeLessThanOrEqual(1);
      }
      prev = g;
    }
    expect(layerGains(1).arp).toBe(1);
    expect(layerGains(1).sub).toBe(1);
    expect(layerGains(1).lead).toBe(1);
    // lead 指標は heat>0.3 で立ち上がり(前倒し)、0.55 で満杯
    expect(layerGains(0.3).lead).toBe(0);
    expect(layerGains(0.55).lead).toBeCloseTo(1, 5);
    expect(layerGains(0.6).lead).toBe(1);
  });

  it('BGM_PROGRESSION: 4小節×3和音、bgmNoteHzはD2基準のオクターブ倍', () => {
    expect(BGM_PROGRESSION.length).toBe(4);
    for (const chord of BGM_PROGRESSION) expect(chord.length).toBe(3);
    expect(bgmNoteHz(0)).toBeCloseTo(73.42, 2);
    expect(bgmNoteHz(0, 1)).toBeCloseTo(146.84, 2);
    expect(bgmNoteHz(12)).toBeCloseTo(146.84, 2);
  });

  it('bgmNoteHz: 第3引数 rootHz で調を移す(既定は D2、指定でその周波数基準)', () => {
    // 既定は BGM_ROOT_HZ(D2)基準で従来と一致
    expect(bgmNoteHz(0)).toBeCloseTo(BGM_ROOT_HZ, 5);
    expect(bgmNoteHz(0, 0, BGM_ROOT_HZ)).toBeCloseTo(BGM_ROOT_HZ, 5);
    // rootHz を渡すとその周波数が基準(semitone/octave の倍率は不変)
    expect(bgmNoteHz(0, 0, 100)).toBeCloseTo(100, 5);
    expect(bgmNoteHz(12, 0, 100)).toBeCloseTo(200, 5);
    expect(bgmNoteHz(0, 1, 100)).toBeCloseTo(200, 5);
    expect(bgmNoteHz(7, 0, 100)).toBeCloseTo(100 * Math.pow(2, 7 / 12), 5);
  });
});

describe('R12 ステージ/ムード別 BGMプロファイル', () => {
  const KEYS: BgmProfileKey[] = ['day', 'dusk', 'night', 'overcast', 'snow', 'night-neon', 'zombie'];

  it('BGM_PROFILES: 全キー(MoodId + night-neon)が存在し、各progressionは4小節×3和音', () => {
    for (const key of KEYS) {
      const prof = BGM_PROFILES[key];
      expect(prof).toBeDefined();
      expect(prof.progression.length).toBe(4);
      for (const chord of prof.progression) expect(chord.length).toBe(3);
      // 各パラメータの健全性
      expect(prof.rootHz).toBeGreaterThan(0);
      expect(prof.bpmBase).toBeGreaterThan(0);
      expect(prof.bpmRange).toBeGreaterThanOrEqual(0);
      expect(prof.leadDrive).toBeGreaterThanOrEqual(0);
      expect(prof.padWet).toBeGreaterThanOrEqual(0);
      expect(prof.padWet).toBeLessThanOrEqual(0.09); // A4-BGM: padWet上限を0.05→0.09へ更新
      expect(prof.hatBrightHz).toBeGreaterThan(0);
    }
    // Record網羅: 余計なキーが無い
    expect(Object.keys(BGM_PROFILES).sort()).toEqual([...KEYS].sort());
  });

  it('BGM_PROFILES: 隣接ムードが「移調だけ」に潰れない({rootHz,padType,arpType,bpm帯}が不一致)', () => {
    const sig = (k: BgmProfileKey): string => {
      const p = BGM_PROFILES[k];
      return `${p.rootHz}|${p.padType}|${p.arpType}|${p.bpmBase}`;
    };
    const sigs = KEYS.map(sig);
    expect(new Set(sigs).size).toBe(KEYS.length); // 全て相異なる識別子
    // rootHz は全ムードで相異なる(単なる移調反復の回避)
    const roots = KEYS.map((k) => BGM_PROFILES[k].rootHz);
    expect(new Set(roots).size).toBe(KEYS.length);
  });

  it('BGM_PROFILES: 設計上の音色/リズム識別(R14: 全ムードdrive bass、overcastもエッジ、snow=sparse維持)', () => {
    // R14: ヒーリング化回避で overcast は triangle→sawtooth + 交戦ピークにリード
    expect(BGM_PROFILES.overcast.padType).toBe('sawtooth');
    expect(BGM_PROFILES.overcast.leadDrive).toBeGreaterThan(0);
    expect(BGM_PROFILES.night.padType).toBe('sawtooth');
    expect(BGM_PROFILES.night.leadDrive).toBeGreaterThan(0);
    expect(BGM_PROFILES['night-neon'].leadDrive).toBeGreaterThan(BGM_PROFILES.night.leadDrive);
    // snow は疎(half-time)の冷たい個性を保ちつつ、駆動ベース+交戦リードでヒーリング脱却
    expect(BGM_PROFILES.snow.sparse).toBe(true);
    expect(BGM_PROFILES.snow.leadDrive).toBeGreaterThan(0);
    // R14: 全ムードのベースを駆動(root廃止)で、探索中もグルーヴが出る
    for (const k of KEYS) expect(BGM_PROFILES[k].bassMode).toBe('drive');
  });

  it('BGM_PROFILES: R16攻撃的音色フィールド(kickDrive/subMode/subDrive/leadStartHeat/riserEnabled/snareSnap)が健全', () => {
    for (const key of KEYS) {
      const p = BGM_PROFILES[key];
      expect(p.kickDrive).toBeGreaterThan(0); // 3層パンチキックの飽和量
      expect(['drone', 'off']).toContain(p.subMode);
      expect(p.subDrive).toBeGreaterThan(0);
      expect(p.leadStartHeat).toBeGreaterThanOrEqual(0);
      expect(p.leadStartHeat).toBeLessThanOrEqual(1);
      expect(typeof p.riserEnabled).toBe('boolean');
      expect(p.snareSnap).toBeGreaterThanOrEqual(0);
      expect(p.snareSnap).toBeLessThanOrEqual(1);
    }
    // 攻撃性の順序: night-neon が最も歪み・鋭く、雪は sub-drone off で疎な間合いを守る
    expect(BGM_PROFILES['night-neon'].kickDrive).toBeGreaterThan(BGM_PROFILES.day.kickDrive);
    expect(BGM_PROFILES.snow.subMode).toBe('off');
    expect(BGM_PROFILES.snow.riserEnabled).toBe(false);
  });

  it('BGM_PROFILES.zombie: 最低rootHz・sub-drone・早いlead・ライザー有効の不穏プロファイル', () => {
    const z = BGM_PROFILES.zombie;
    expect(z.rootHz).toBeCloseTo(46.25, 2); // 全ムード中で最低音
    const roots = KEYS.filter((k) => k !== 'zombie').map((k) => BGM_PROFILES[k].rootHz);
    expect(Math.min(...roots)).toBeGreaterThan(z.rootHz);
    expect(z.subMode).toBe('drone');
    expect(z.subDrive).toBeGreaterThan(0);
    expect(z.leadStartHeat).toBeLessThan(0.3); // 早い段階から高揚のリード
    expect(z.riserEnabled).toBe(true);
    expect(z.bassMode).toBe('drive');
    // 半音クラスタ(短2度)を含む不協和な進行
    expect(z.progression[0]).toEqual([0, 1, 6]);
  });

  it('setMusicProfile: 全キーで例外なく切替でき、同一キー/未再生では安全(AudioContext不要)', () => {
    const kit = new SoundKit();
    for (const key of KEYS) {
      expect(() => kit.setMusicProfile(key)).not.toThrow();
      expect(() => kit.setMusicProfile(key)).not.toThrow(); // 同一キーの早期return経路
    }
    // 再生前(bgmStopped=true)は stopBgm() を呼ばないので AudioContext 未生成でも安全
    expect(() => kit.setMusicProfile('day')).not.toThrow();
  });
});

describe('R33 黒雷帝 ambient pack — 音APIの健全性(AudioContext不要)', () => {
  it('rumbleDistantThunder: pan値 0 / ±0.7 で例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.rumbleDistantThunder(0)).not.toThrow();
    expect(() => kit.rumbleDistantThunder(-0.7)).not.toThrow();
    expect(() => kit.rumbleDistantThunder(0.7)).not.toThrow();
  });

  it('kokuraiBlinkTeleport: AudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.kokuraiBlinkTeleport()).not.toThrow();
  });

  it('kokuraiActivateThunder: AudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.kokuraiActivateThunder()).not.toThrow();
  });

  it('kokuraiKillLayer: streak 0 / 3 / 5 で例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.kokuraiKillLayer(0)).not.toThrow();
    expect(() => kit.kokuraiKillLayer(3)).not.toThrow();
    expect(() => kit.kokuraiKillLayer(5)).not.toThrow();
  });

  it('startKokuraiThunder / stopKokuraiThunder: 冪等かつ例外なし', () => {
    const kit = new SoundKit();
    expect(() => kit.startKokuraiThunder()).not.toThrow();
    expect(() => kit.startKokuraiThunder()).not.toThrow(); // 冪等: 2回目は no-op
    expect(() => kit.stopKokuraiThunder()).not.toThrow();
    expect(() => kit.stopKokuraiThunder()).not.toThrow(); // 冪等: 2回目も安全
  });

  it('pauseKokuraiThunder / resumeKokuraiThunder: 例外なし', () => {
    const kit = new SoundKit();
    expect(() => kit.pauseKokuraiThunder()).not.toThrow();
    expect(() => kit.resumeKokuraiThunder()).not.toThrow();
  });
});

describe('R33 Sランク武器サウンドスペック', () => {
  // ── BOW_RELEASE_SPEC 定数整合テスト ──────────────────────────────────────
  it('BOW_RELEASE_SPEC: 弦スラップHz > 風切りEndHz (高→低sweep)', () => {
    expect(BOW_RELEASE_SPEC.stringSlapHz).toBeGreaterThan(BOW_RELEASE_SPEC.windEndHz);
  });
  it('BOW_RELEASE_SPEC: 風切りstartHz > 風切りendHz (sweep down)', () => {
    expect(BOW_RELEASE_SPEC.windStartHz).toBeGreaterThan(BOW_RELEASE_SPEC.windEndHz);
  });
  it('BOW_RELEASE_SPEC: slapDurationS < windDurationS (矢風切りは弦より長い)', () => {
    expect(BOW_RELEASE_SPEC.slapDurationS).toBeLessThan(BOW_RELEASE_SPEC.windDurationS);
  });
  it('BOW_RELEASE_SPEC: gain値が0–1範囲内', () => {
    expect(BOW_RELEASE_SPEC.slapGain).toBeGreaterThan(0);
    expect(BOW_RELEASE_SPEC.slapGain).toBeLessThanOrEqual(1);
    expect(BOW_RELEASE_SPEC.windGain).toBeGreaterThan(0);
    expect(BOW_RELEASE_SPEC.windGain).toBeLessThanOrEqual(1);
  });

  // ── FAN_WHOOSH_SPEC 定数整合テスト ──────────────────────────────────────
  it('FAN_WHOOSH_SPEC: startHz > endHz (sweep down)', () => {
    expect(FAN_WHOOSH_SPEC.startHz).toBeGreaterThan(FAN_WHOOSH_SPEC.endHz);
  });
  it('FAN_WHOOSH_SPEC: filterTypeはbandpass', () => {
    expect(FAN_WHOOSH_SPEC.filterType).toBe('bandpass');
  });
  it('FAN_WHOOSH_SPEC: durationSは正の数', () => {
    expect(FAN_WHOOSH_SPEC.durationS).toBeGreaterThan(0);
  });

  // ── MINIGUN_SPIN_SPEC 定数整合テスト ────────────────────────────────────
  it('MINIGUN_SPIN_SPEC: スピンアップ後Hz > 開始Hz', () => {
    expect(MINIGUN_SPIN_SPEC.droneEndHz).toBeGreaterThan(MINIGUN_SPIN_SPEC.droneStartHz);
  });
  it('MINIGUN_SPIN_SPEC: スピンダウン後Hz < 開始Hz', () => {
    expect(MINIGUN_SPIN_SPEC.droneDownEndHz).toBeLessThan(MINIGUN_SPIN_SPEC.droneDownStartHz);
  });
  it('MINIGUN_SPIN_SPEC: スピンアップ終了HzとスピンダウンHzは対称', () => {
    expect(MINIGUN_SPIN_SPEC.droneEndHz).toBe(MINIGUN_SPIN_SPEC.droneDownStartHz);
  });
  it('MINIGUN_SPIN_SPEC: droneGainは0–1範囲内', () => {
    expect(MINIGUN_SPIN_SPEC.droneGain).toBeGreaterThan(0);
    expect(MINIGUN_SPIN_SPEC.droneGain).toBeLessThanOrEqual(1);
  });

  // ── SoundKit メソッドの無例外テスト(AudioContext不要) ────────────────────
  it('bowRelease: AudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.bowRelease()).not.toThrow();
  });
  it('fanWhoosh: AudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.fanWhoosh()).not.toThrow();
  });
  it('minigunSpin(true): スピンアップでAudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.minigunSpin(true)).not.toThrow();
  });
  it('minigunSpin(false): スピンダウンでAudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.minigunSpin(false)).not.toThrow();
  });
  it('minigunSpin: 連続呼び出し(スピンアップ→ダウン→アップ)で例外なし', () => {
    const kit = new SoundKit();
    expect(() => {
      kit.minigunSpin(true);
      kit.minigunSpin(false);
      kit.minigunSpin(true);
    }).not.toThrow();
  });

  // ── STAFF_FIRE_SPEC 定数整合テスト(F3) ─────────────────────────────────
  it('STAFF_FIRE_SPEC: crackFreqHz > chargeFreqHz (放電クラックはチャージより高い)', () => {
    expect(STAFF_FIRE_SPEC.crackFreqHz).toBeGreaterThan(STAFF_FIRE_SPEC.chargeFreqHz);
  });
  it('STAFF_FIRE_SPEC: chargeFreqHz > chargeSweepHz (チャージは高→低sweep)', () => {
    expect(STAFF_FIRE_SPEC.chargeFreqHz).toBeGreaterThan(STAFF_FIRE_SPEC.chargeSweepHz);
  });
  it('STAFF_FIRE_SPEC: rumbleFreqHz > rumbleEndFreqHz (残響も下降)', () => {
    expect(STAFF_FIRE_SPEC.rumbleFreqHz).toBeGreaterThan(STAFF_FIRE_SPEC.rumbleEndFreqHz);
  });
  it('STAFF_FIRE_SPEC: 全gain値が 0–1 範囲内', () => {
    expect(STAFF_FIRE_SPEC.chargeGain).toBeGreaterThan(0);
    expect(STAFF_FIRE_SPEC.chargeGain).toBeLessThanOrEqual(1);
    expect(STAFF_FIRE_SPEC.crackGain).toBeGreaterThan(0);
    expect(STAFF_FIRE_SPEC.crackGain).toBeLessThanOrEqual(1);
    expect(STAFF_FIRE_SPEC.rumbleGain).toBeGreaterThan(0);
    expect(STAFF_FIRE_SPEC.rumbleGain).toBeLessThanOrEqual(1);
  });
  it('STAFF_FIRE_SPEC: 全durationSが正', () => {
    expect(STAFF_FIRE_SPEC.chargeDurationS).toBeGreaterThan(0);
    expect(STAFF_FIRE_SPEC.crackDurationS).toBeGreaterThan(0);
    expect(STAFF_FIRE_SPEC.rumbleDurationS).toBeGreaterThan(0);
  });
  it('staffFire: AudioContext無しで例外を投げない', () => {
    const kit = new SoundKit();
    expect(() => kit.staffFire()).not.toThrow();
  });
});
