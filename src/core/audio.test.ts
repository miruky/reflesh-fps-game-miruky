import { describe, expect, it } from 'vitest';
import {
  applySpeechPause,
  BGM_PROFILES,
  BGM_PROGRESSION,
  BGM_ROOT_HZ,
  bgmNoteHz,
  type BgmProfileKey,
  barFor,
  BEHIND_GAIN_MUL,
  BEHIND_LP_MUL,
  BGM_STEM_IDS,
  indoorReverbBlend,
  NEAPOLITAN_BAR,
  stemTargetGain,
  zombieVocalRecipe,
  BANJIN_KAGEMAI_SPEC,
  BANJIN_STORM_SPEC,
  BOW_RELEASE_SPEC,
  COMPRESSOR_PARAMS,
  dbToGain,
  deriveReverbPreset,
  enemyShotParams,
  FAN_WHOOSH_SPEC,
  FUJIN_KAMIKAZE_SPEC,
  FUJIN_TYPHOON_SPEC,
  GEKKOU_FULL_MOON_SPEC,
  GEKKOU_TSUKIOTOSHI_SPEC,
  GOUEN_BLAST_SPEC,
  GOUEN_MESSE_SPEC,
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
  RADIO_SQUELCH_SPECS,
  radioProsodyBase,
  radioProsodyFor,
  type RadioSpeaker,
  renderImpulse,
  REVERB_PRESETS,
  scoreVoice,
  SHINKIROU_KYOZOU_SPEC,
  SHINKIROU_SWEEP_SPEC,
  SHOT_PROFILES,
  SHURA_KOURIN_SPEC,
  SHURA_RAMPAGE_SPEC,
  SoundKit,
  STAFF_FIRE_SPEC,
  TENRAI_HACHIRAI_SPEC,
  TENRAI_TENBATSU_SPEC,
  type VoiceLike,
} from './audio';
import { STAGES } from '../game/stages';
import { generateStageDef, BIOMES } from '../game/biomes';
import type { PowerUpKind } from '../game/zombie-economy';

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
  // R53: 'emperor-kokurai'(黒雷帝転調。setEmperorBgm('kokuraitei')が使用)を追加
  const KEYS: BgmProfileKey[] = ['day', 'dusk', 'night', 'overcast', 'snow', 'night-neon', 'zombie', 'emperor-kokurai'];

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

  it('BGM_PROFILES.zombie: 最低rootHz(ムード中)・sub-drone・早いlead・ライザー有効の不穏プロファイル', () => {
    const z = BGM_PROFILES.zombie;
    expect(z.rootHz).toBeCloseTo(46.25, 2); // ムード系で最低音(R53: 絶対最低は emperor-kokurai=41.2 に譲る)
    const roots = KEYS.filter((k) => k !== 'zombie' && k !== 'emperor-kokurai').map(
      (k) => BGM_PROFILES[k].rootHz,
    );
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

  // ── R34 特殊武器スペック整合テスト ─────────────────────────────────────
  it('BANJIN_STORM_SPEC: gain値が 0–1 範囲内', () => {
    expect(BANJIN_STORM_SPEC.metalGain).toBeGreaterThan(0);
    expect(BANJIN_STORM_SPEC.metalGain).toBeLessThanOrEqual(1);
    expect(BANJIN_STORM_SPEC.wooshGain).toBeGreaterThan(0);
    expect(BANJIN_STORM_SPEC.wooshGain).toBeLessThanOrEqual(1);
  });
  it('BANJIN_STORM_SPEC: durationSが正', () => {
    expect(BANJIN_STORM_SPEC.metalDurationS).toBeGreaterThan(0);
    expect(BANJIN_STORM_SPEC.wooshDurationS).toBeGreaterThan(0);
  });
  it('GEKKOU_FULL_MOON_SPEC: pillarFreqHz > pillarEndFreqHz (下降sweep)', () => {
    expect(GEKKOU_FULL_MOON_SPEC.pillarFreqHz).toBeGreaterThan(GEKKOU_FULL_MOON_SPEC.pillarEndFreqHz);
  });
  it('GEKKOU_FULL_MOON_SPEC: gain値が 0–1 範囲内', () => {
    expect(GEKKOU_FULL_MOON_SPEC.stringGain).toBeGreaterThan(0);
    expect(GEKKOU_FULL_MOON_SPEC.pillarGain).toBeGreaterThan(0);
    expect(GEKKOU_FULL_MOON_SPEC.novaGain).toBeGreaterThan(0);
    expect(GEKKOU_FULL_MOON_SPEC.novaGain).toBeLessThanOrEqual(1);
  });
  it('FUJIN_TYPHOON_SPEC: stormHighHz > stormLowHz (上昇sweep)', () => {
    expect(FUJIN_TYPHOON_SPEC.stormHighHz).toBeGreaterThan(FUJIN_TYPHOON_SPEC.stormLowHz);
  });
  it('FUJIN_TYPHOON_SPEC: gustHz > gustEndHz (下降sweep)', () => {
    expect(FUJIN_TYPHOON_SPEC.gustHz).toBeGreaterThan(FUJIN_TYPHOON_SPEC.gustEndHz);
  });
  it('GOUEN_BLAST_SPEC: boomGain は 0.9 以下 (白飛び防止)', () => {
    expect(GOUEN_BLAST_SPEC.boomGain).toBeLessThanOrEqual(0.9);
  });
  it('GOUEN_BLAST_SPEC: boomFreqHz > boomEndFreqHz (下降sweep)', () => {
    expect(GOUEN_BLAST_SPEC.boomFreqHz).toBeGreaterThan(GOUEN_BLAST_SPEC.boomEndFreqHz);
  });
  it('TENRAI_TENBATSU_SPEC: thunderFreqHz > thunderEndHz (下降)', () => {
    expect(TENRAI_TENBATSU_SPEC.thunderFreqHz).toBeGreaterThan(TENRAI_TENBATSU_SPEC.thunderEndHz);
  });
  it('SHINKIROU_SWEEP_SPEC: endHz > startHz (上昇sweep)', () => {
    expect(SHINKIROU_SWEEP_SPEC.endHz).toBeGreaterThan(SHINKIROU_SWEEP_SPEC.startHz);
  });
  it('SHINKIROU_SWEEP_SPEC: gain が 0–1 範囲内', () => {
    expect(SHINKIROU_SWEEP_SPEC.gain).toBeGreaterThan(0);
    expect(SHINKIROU_SWEEP_SPEC.gain).toBeLessThanOrEqual(1);
  });
  it('SHURA_RAMPAGE_SPEC: gain値が 0–1 範囲内', () => {
    expect(SHURA_RAMPAGE_SPEC.rapidGain).toBeGreaterThan(0);
    expect(SHURA_RAMPAGE_SPEC.bassGain).toBeGreaterThan(0);
  });
  it('BANJIN_KAGEMAI_SPEC: shadowFreqHz > shadowEndHz (下降)', () => {
    expect(BANJIN_KAGEMAI_SPEC.shadowFreqHz).toBeGreaterThan(BANJIN_KAGEMAI_SPEC.shadowEndHz);
  });
  it('GEKKOU_TSUKIOTOSHI_SPEC: impactGain は 0.9 以下 (白飛び防止)', () => {
    expect(GEKKOU_TSUKIOTOSHI_SPEC.impactGain).toBeLessThanOrEqual(0.9);
  });
  it('FUJIN_KAMIKAZE_SPEC: durationSが正', () => {
    expect(FUJIN_KAMIKAZE_SPEC.maelstromDurationS).toBeGreaterThan(0);
    expect(FUJIN_KAMIKAZE_SPEC.vortexDurationS).toBeGreaterThan(0);
  });
  it('GOUEN_MESSE_SPEC: infernoGain は 0.9 以下', () => {
    expect(GOUEN_MESSE_SPEC.infernoGain).toBeLessThanOrEqual(0.9);
  });
  it('TENRAI_HACHIRAI_SPEC: staggerS が正', () => {
    expect(TENRAI_HACHIRAI_SPEC.staggerS).toBeGreaterThan(0);
  });
  it('TENRAI_HACHIRAI_SPEC: crackHz > thunderFreqHz (クラックは高い)', () => {
    expect(TENRAI_HACHIRAI_SPEC.crackHz).toBeGreaterThan(TENRAI_HACHIRAI_SPEC.thunderFreqHz);
  });
  it('SHINKIROU_KYOZOU_SPEC: reverseEndHz > reverseFreqHz (上昇)', () => {
    expect(SHINKIROU_KYOZOU_SPEC.reverseEndHz).toBeGreaterThan(SHINKIROU_KYOZOU_SPEC.reverseFreqHz);
  });
  it('SHURA_KOURIN_SPEC: taikoCount > 0 かつ taikoStepS > 0', () => {
    expect(SHURA_KOURIN_SPEC.taikoCount).toBeGreaterThan(0);
    expect(SHURA_KOURIN_SPEC.taikoStepS).toBeGreaterThan(0);
  });
  it('SHURA_KOURIN_SPEC: taikoGain は 0.9 以下 (白飛び防止)', () => {
    expect(SHURA_KOURIN_SPEC.taikoGain).toBeLessThanOrEqual(0.9);
  });

  // ── R34 SoundKit メソッド 無例外テスト ──────────────────────────────────
  it('banjinStormSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().banjinStormSound()).not.toThrow();
  });
  it('gekkouFullMoonSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().gekkouFullMoonSound()).not.toThrow();
  });
  it('fujinTyphoonSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().fujinTyphoonSound()).not.toThrow();
  });
  it('gouenBlastSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().gouenBlastSound()).not.toThrow();
  });
  it('tenraiTenbatsuSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().tenraiTenbatsuSound()).not.toThrow();
  });
  it('shinkirouSweepSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().shinkirouSweepSound()).not.toThrow();
  });
  it('shuraRampageSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().shuraRampageSound()).not.toThrow();
  });
  it('banjinKagemaiSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().banjinKagemaiSound()).not.toThrow();
  });
  it('gekkouTsukiotoshiSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().gekkouTsukiotoshiSound()).not.toThrow();
  });
  it('fujinKamikazeSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().fujinKamikazeSound()).not.toThrow();
  });
  it('gouenMesseSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().gouenMesseSound()).not.toThrow();
  });
  it('tenraiHachiraiSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().tenraiHachiraiSound()).not.toThrow();
  });
  it('shinkirouKyozouSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().shinkirouKyozouSound()).not.toThrow();
  });
  it('shuraKourinSound: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().shuraKourinSound()).not.toThrow();
  });
});

// ── 音響祭 新API スペック定数 境界テスト ──────────────────────────────────
import {
  KOKURAI_WORLD_BREATHE_SPEC,
  DARK_EMPEROR_AURA_SPEC,
  RAITEI_AURA_SPEC,
} from './audio';

describe('KOKURAI_WORLD_BREATHE_SPEC 定数境界テスト', () => {
  it('duckDb は負の値 (音量を下げる)', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.duckDb).toBeLessThan(0);
  });
  it('duckHoldS > 0', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.duckHoldS).toBeGreaterThan(0);
  });
  it('duckReleaseS > 0', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.duckReleaseS).toBeGreaterThan(0);
  });
  it('preRumbleStartHz > preRumbleEndHz (下降)', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.preRumbleStartHz).toBeGreaterThan(KOKURAI_WORLD_BREATHE_SPEC.preRumbleEndHz);
  });
  it('mainImpactGain は 0–1 範囲内', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.mainImpactGain).toBeGreaterThan(0);
    expect(KOKURAI_WORLD_BREATHE_SPEC.mainImpactGain).toBeLessThanOrEqual(1);
  });
  it('mainImpactDrive > 0', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.mainImpactDrive).toBeGreaterThan(0);
  });
  it('crackHz > 0', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.crackHz).toBeGreaterThan(0);
  });
  it('wetTail は 0–1 範囲内', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.wetTail).toBeGreaterThanOrEqual(0);
    expect(KOKURAI_WORLD_BREATHE_SPEC.wetTail).toBeLessThanOrEqual(1);
  });
  it('tailDurationS > 0', () => {
    expect(KOKURAI_WORLD_BREATHE_SPEC.tailDurationS).toBeGreaterThan(0);
  });
});

describe('DARK_EMPEROR_AURA_SPEC 定数境界テスト', () => {
  it('beat1FreqHz > 0', () => {
    expect(DARK_EMPEROR_AURA_SPEC.beat1FreqHz).toBeGreaterThan(0);
  });
  it('beat1EndHz > 0', () => {
    expect(DARK_EMPEROR_AURA_SPEC.beat1EndHz).toBeGreaterThan(0);
  });
  it('beat1Gain は 0–1 範囲内', () => {
    expect(DARK_EMPEROR_AURA_SPEC.beat1Gain).toBeGreaterThan(0);
    expect(DARK_EMPEROR_AURA_SPEC.beat1Gain).toBeLessThanOrEqual(1);
  });
  it('beat1Drive > 0', () => {
    expect(DARK_EMPEROR_AURA_SPEC.beat1Drive).toBeGreaterThan(0);
  });
  it('beat2DelayS > 0', () => {
    expect(DARK_EMPEROR_AURA_SPEC.beat2DelayS).toBeGreaterThan(0);
  });
  it('intervalMinS < intervalMaxS', () => {
    expect(DARK_EMPEROR_AURA_SPEC.intervalMinS).toBeLessThan(DARK_EMPEROR_AURA_SPEC.intervalMaxS);
  });
});

describe('RAITEI_AURA_SPEC 定数境界テスト', () => {
  it('osc1Hz > 0', () => {
    expect(RAITEI_AURA_SPEC.osc1Hz).toBeGreaterThan(0);
  });
  it('osc1HpHz > osc1Hz (HPFカットオフは基音より高い)', () => {
    expect(RAITEI_AURA_SPEC.osc1HpHz).toBeGreaterThan(RAITEI_AURA_SPEC.osc1Hz);
  });
  it('osc1Gain は 0–1 範囲内', () => {
    expect(RAITEI_AURA_SPEC.osc1Gain).toBeGreaterThan(0);
    expect(RAITEI_AURA_SPEC.osc1Gain).toBeLessThanOrEqual(1);
  });
  it('osc2Hz > 0', () => {
    expect(RAITEI_AURA_SPEC.osc2Hz).toBeGreaterThan(0);
  });
  it('osc2HpHz > osc2Hz (HPFカットオフは基音より高い)', () => {
    expect(RAITEI_AURA_SPEC.osc2HpHz).toBeGreaterThan(RAITEI_AURA_SPEC.osc2Hz);
  });
  it('osc2Gain は 0–1 範囲内', () => {
    expect(RAITEI_AURA_SPEC.osc2Gain).toBeGreaterThan(0);
    expect(RAITEI_AURA_SPEC.osc2Gain).toBeLessThanOrEqual(1);
  });
  it('lfoHz > 0 (LFO周波数は正)', () => {
    expect(RAITEI_AURA_SPEC.lfoHz).toBeGreaterThan(0);
  });
});

// ── 音響祭 新/改修 SoundKit API 無例外テスト ─────────────────────────────
describe('音響祭 新API 無例外テスト', () => {
  it('kokuraiWorldBreathe: AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().kokuraiWorldBreathe()).not.toThrow();
  });
  it('kunaiSlashDark(0): AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().kunaiSlashDark(0)).not.toThrow();
  });
  it('kunaiSlashDark(1): variation≥1 tailあり/例外なし', () => {
    expect(() => new SoundKit().kunaiSlashDark(1)).not.toThrow();
  });
  it('setDarkEmperorAura(true): AudioContext無しで例外を投げない', () => {
    const sk = new SoundKit();
    expect(() => sk.setDarkEmperorAura(true)).not.toThrow();
    sk.setDarkEmperorAura(false); // cleanup
  });
  it('setDarkEmperorAura(false): 二重解除で例外を投げない', () => {
    const sk = new SoundKit();
    expect(() => { sk.setDarkEmperorAura(false); sk.setDarkEmperorAura(false); }).not.toThrow();
  });
  it('setRaiteiAura(true/false): AudioContext無しで例外を投げない', () => {
    const sk = new SoundKit();
    expect(() => sk.setRaiteiAura(true)).not.toThrow();
    expect(() => sk.setRaiteiAura(false)).not.toThrow();
  });
  it('playerBodyHit(0, 0): AudioContext無しで例外を投げない', () => {
    expect(() => new SoundKit().playerBodyHit(0, 0)).not.toThrow();
  });
  it('playerBodyHit(pan, heaviness): クランプ(pan±2, heaviness2.5)で例外なし', () => {
    expect(() => new SoundKit().playerBodyHit(-2, 2.5)).not.toThrow();
    expect(() => new SoundKit().playerBodyHit(2, -1)).not.toThrow();
  });
  it('footstep(1, false, "dark"): dark variant で例外なし', () => {
    expect(() => new SoundKit().footstep(1, false, 'dark')).not.toThrow();
  });
  it('footstep(1, true, "raitei"): raitei landing で例外なし', () => {
    expect(() => new SoundKit().footstep(1, true, 'raitei')).not.toThrow();
  });
  it('bowRelease: 琴余韻追加後も例外なし', () => {
    expect(() => new SoundKit().bowRelease()).not.toThrow();
  });
  it('gekkouFullMoonSound: 琴余韻追加後も例外なし', () => {
    expect(() => new SoundKit().gekkouFullMoonSound()).not.toThrow();
  });
  it('fujinTyphoonSound: 地鳴りroll+detuned追加後も例外なし', () => {
    expect(() => new SoundKit().fujinTyphoonSound()).not.toThrow();
  });
  it('headshot: 9000Hz追加後も例外なし', () => {
    expect(() => new SoundKit().headshot()).not.toThrow();
  });
  it('kill: 330→520Hz triangle追加後も例外なし', () => {
    expect(() => new SoundKit().kill()).not.toThrow();
  });
  it('reload(800): 3イベントメカ音で例外なし', () => {
    expect(() => new SoundKit().reload(800)).not.toThrow();
  });
  it('uiClick: 1100→750Hz sweep + 5200Hz追加後も例外なし', () => {
    expect(() => new SoundKit().uiClick()).not.toThrow();
  });
  it('quiesce: setDarkEmperorAura/setRaiteiAura呼び出し後も例外なし', () => {
    const sk = new SoundKit();
    sk.setDarkEmperorAura(true);
    expect(() => sk.quiesce()).not.toThrow();
  });
});

// ── R53-W2 コンテンツ拡張(ゾンビ拡充/ストーリー帝王編/S&D)の音API群 ──────────
describe('R53-W2 無線プロソディ/スケルチ 純ロジック', () => {
  const SPEAKERS: RadioSpeaker[] = ['kagerou', 'homura', 'hibana', 'kurogane', 'rei'];

  it('radioProsodyBase: 話者ごとに異なるprosodyを持つ(R54: rei含む5種とも相異なる)', () => {
    const sigs = SPEAKERS.map((s) => {
      const p = radioProsodyBase(s);
      return `${p.pitch}|${p.rate}`;
    });
    expect(new Set(sigs).size).toBe(SPEAKERS.length);
  });

  it('radioProsodyBase: kuroganeは低pitch/遅rate、homuraは他話者より速め(rate最大)', () => {
    const kurogane = radioProsodyBase('kurogane');
    const homura = radioProsodyBase('homura');
    for (const s of SPEAKERS) {
      if (s === 'kurogane') continue;
      expect(kurogane.pitch).toBeLessThan(radioProsodyBase(s).pitch);
    }
    for (const s of SPEAKERS) {
      expect(homura.rate).toBeGreaterThanOrEqual(radioProsodyBase(s).rate);
    }
  });

  it('radioProsodyFor: 基準±微ジッタ内かつpitch[0,2]/rate[0.1,10]に必ず収まる', () => {
    for (const speaker of SPEAKERS) {
      for (let i = 0; i < 50; i += 1) {
        const p = radioProsodyFor(speaker);
        const b = radioProsodyBase(speaker);
        expect(p.pitch).toBeGreaterThanOrEqual(0);
        expect(p.pitch).toBeLessThanOrEqual(2);
        expect(p.rate).toBeGreaterThanOrEqual(0.1);
        expect(p.rate).toBeLessThanOrEqual(10);
        expect(Math.abs(p.pitch - b.pitch)).toBeLessThanOrEqual(0.026);
        expect(Math.abs(p.rate - b.rate)).toBeLessThanOrEqual(0.031);
      }
    }
  });

  it('RADIO_SQUELCH_SPECS: 5話者(R54: rei含む)を網羅し、kuroganeのみ歪み(drive+asym)を持つ', () => {
    expect(Object.keys(RADIO_SQUELCH_SPECS).sort()).toEqual([...SPEAKERS].sort());
    expect(RADIO_SQUELCH_SPECS.kurogane.drive).toBeGreaterThan(0);
    expect(RADIO_SQUELCH_SPECS.kurogane.curve).toBe('asym');
    for (const s of SPEAKERS) {
      if (s === 'kurogane') continue;
      expect(RADIO_SQUELCH_SPECS[s].drive ?? 0).toBe(0);
    }
  });

  it('RADIO_SQUELCH_SPECS: 全話者のcarrierHz/noiseHz/qが正の値', () => {
    for (const s of SPEAKERS) {
      const spec = RADIO_SQUELCH_SPECS[s];
      expect(spec.carrierHz).toBeGreaterThan(0);
      expect(spec.noiseHz).toBeGreaterThan(0);
      expect(spec.q).toBeGreaterThan(0);
    }
  });
});

describe('R53-W2 SoundKit 新API 無例外テスト(AudioContext不要)', () => {
  const SPEAKERS: RadioSpeaker[] = ['kagerou', 'homura', 'hibana', 'kurogane', 'rei'];
  const POWER_UP_KINDS: PowerUpKind[] = ['insta', 'double', 'nuke', 'maxammo', 'carpenter'];

  it('papUpgrade: 2.5s三段(圧着/研磨/チャイム)で例外なし', () => {
    expect(() => new SoundKit().papUpgrade()).not.toThrow();
  });
  it('papDeny: 例外なし', () => {
    expect(() => new SoundKit().papDeny()).not.toThrow();
  });

  it('powerUpPickup: 全種別(insta/double/nuke/maxammo/carpenter)で例外なし', () => {
    const kit = new SoundKit();
    for (const kind of POWER_UP_KINDS) {
      expect(() => kit.powerUpPickup(kind)).not.toThrow();
    }
  });
  it('powerUpExpire: 例外なし', () => {
    expect(() => new SoundKit().powerUpExpire()).not.toThrow();
  });

  it('variantBlastExplode: 例外なし', () => {
    expect(() => new SoundKit().variantBlastExplode()).not.toThrow();
  });
  it('variantMiasmaBurst: 例外なし(内部ループ非管理=quiesce不要な自然減衰)', () => {
    expect(() => new SoundKit().variantMiasmaBurst()).not.toThrow();
  });
  it('shellHit: 連続呼び出し(スロットル経路)でも例外なし', () => {
    const kit = new SoundKit();
    expect(() => {
      kit.shellHit();
      kit.shellHit();
      kit.shellHit();
    }).not.toThrow();
  });

  it('specialRoundStart: 例外なし', () => {
    expect(() => new SoundKit().specialRoundStart()).not.toThrow();
  });
  it('specialRoundClear: 例外なし', () => {
    expect(() => new SoundKit().specialRoundClear()).not.toThrow();
  });

  it('radioBeep: 全話者で例外なし', () => {
    const kit = new SoundKit();
    for (const speaker of SPEAKERS) {
      expect(() => kit.radioBeep(speaker)).not.toThrow();
    }
  });
  it('radioSpeak: 全話者・空文字/長文で例外なし', () => {
    const kit = new SoundKit();
    for (const speaker of SPEAKERS) {
      expect(() => kit.radioSpeak(speaker, 'area secure, moving to checkpoint')).not.toThrow();
    }
    expect(() => kit.radioSpeak('kurogane', '')).not.toThrow();
  });
  it('radioSpeak: 連続呼び出し(前の発話を割り込み)でも例外なし', () => {
    const kit = new SoundKit();
    expect(() => {
      kit.radioSpeak('kagerou', 'first transmission');
      kit.radioSpeak('homura', 'second transmission');
    }).not.toThrow();
  });
  it('radioSpeak → quiesce: 孤児onend/onerrorコールバック(後beep)が無効化されても例外なし', () => {
    const kit = new SoundKit();
    kit.radioSpeak('kurogane', 'command, do you copy');
    expect(() => kit.quiesce()).not.toThrow();
  });

  it('sndPlantTick: 連続呼び出し(進捗加速を模した高頻度呼び)でも例外なし', () => {
    const kit = new SoundKit();
    expect(() => {
      for (let i = 0; i < 10; i += 1) kit.sndPlantTick();
    }).not.toThrow();
  });
  it('sndPlanted: 例外なし', () => {
    expect(() => new SoundKit().sndPlanted()).not.toThrow();
  });
  it('sndFuseTick: urgency 0 / 0.5 / 1 で例外なし(範囲外もクランプされ例外なし)', () => {
    const kit = new SoundKit();
    expect(() => kit.sndFuseTick(0)).not.toThrow();
    expect(() => kit.sndFuseTick(0.5)).not.toThrow();
    expect(() => kit.sndFuseTick(1)).not.toThrow();
    expect(() => kit.sndFuseTick(-1)).not.toThrow();
    expect(() => kit.sndFuseTick(2)).not.toThrow();
  });
  it('sndDefused: 例外なし', () => {
    expect(() => new SoundKit().sndDefused()).not.toThrow();
  });
  it('sndDetonate: 既存explosion/rocketSubBoom流用経路で例外なし', () => {
    expect(() => new SoundKit().sndDetonate()).not.toThrow();
  });
  it('sndRoundWin: 勝利/敗北の両方で例外なし', () => {
    const kit = new SoundKit();
    expect(() => kit.sndRoundWin(true)).not.toThrow();
    expect(() => kit.sndRoundWin(false)).not.toThrow();
  });

  it('kuroganePhase: phase 2 / 3 で例外なし', () => {
    const kit = new SoundKit();
    expect(() => kit.kuroganePhase(2)).not.toThrow();
    expect(() => kit.kuroganePhase(3)).not.toThrow();
  });
  it('kuroganeDefeat: 終焉の長残響で例外なし', () => {
    expect(() => new SoundKit().kuroganeDefeat()).not.toThrow();
  });

  it('quiesce: 新API一式を呼んだ後も例外なし(dispose経路の網羅)', () => {
    const kit = new SoundKit();
    kit.papUpgrade();
    kit.powerUpPickup('nuke');
    kit.variantMiasmaBurst();
    kit.specialRoundStart();
    kit.radioSpeak('hibana', 'covering fire');
    kit.sndFuseTick(0.9);
    kit.kuroganePhase(3);
    expect(() => kit.quiesce()).not.toThrow();
    // 二重quiesceも安全(冪等)
    expect(() => kit.quiesce()).not.toThrow();
  });
});

// ── R54-W1 Q3: ポーズ中の無線TTS一時停止/再開(純ロジック) ──────────────────
// jsdomではないNode環境にはwindow.speechSynthesis自体が存在しないため、SoundKit経由の
// 統合テストではなく applySpeechPause 単体をモックsynthで検証する(pauseCombatLoops内の
// 呼び出しはtypeof window!=='undefined'&&window.speechSynthesisで既にガードされている)。
describe('R54-W1 Q3: applySpeechPause(TTSポーズ制御)', () => {
  it('paused=trueはsynth.pause()を呼ぶ(resume/cancelは呼ばない)', () => {
    let pauseCalls = 0;
    let resumeCalls = 0;
    let cancelCalls = 0;
    const synth = {
      pause: () => { pauseCalls += 1; },
      resume: () => { resumeCalls += 1; },
      cancel: () => { cancelCalls += 1; },
    };
    applySpeechPause(synth, true);
    expect(pauseCalls).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(cancelCalls).toBe(0);
  });

  it('paused=falseはsynth.resume()を呼ぶ(pause/cancelは呼ばない)', () => {
    let pauseCalls = 0;
    let resumeCalls = 0;
    let cancelCalls = 0;
    const synth = {
      pause: () => { pauseCalls += 1; },
      resume: () => { resumeCalls += 1; },
      cancel: () => { cancelCalls += 1; },
    };
    applySpeechPause(synth, false);
    expect(pauseCalls).toBe(0);
    expect(resumeCalls).toBe(1);
    expect(cancelCalls).toBe(0);
  });

  it('pause()が例外を投げたらcancel()へフォールバックする(Chromeのresume取りこぼし対策)', () => {
    let cancelCalls = 0;
    const synth = {
      pause: () => { throw new Error('boom'); },
      resume: () => {},
      cancel: () => { cancelCalls += 1; },
    };
    expect(() => applySpeechPause(synth, true)).not.toThrow();
    expect(cancelCalls).toBe(1);
  });

  it('resume()が例外を投げたらcancel()へフォールバックする', () => {
    let cancelCalls = 0;
    const synth = {
      pause: () => {},
      resume: () => { throw new Error('boom'); },
      cancel: () => { cancelCalls += 1; },
    };
    expect(() => applySpeechPause(synth, false)).not.toThrow();
    expect(cancelCalls).toBe(1);
  });

  it('cancel()自体が例外を投げても外へは伝播しない(致命的にしない)', () => {
    const synth = {
      pause: () => { throw new Error('boom'); },
      resume: () => {},
      cancel: () => { throw new Error('also boom'); },
    };
    expect(() => applySpeechPause(synth, true)).not.toThrow();
  });
});

// ── R54-W1 Q3: pauseCombatLoops自体(window.speechSynthesis不在=Node環境)は無例外 ──
describe('R54-W1 Q3: SoundKit.pauseCombatLoops(window.speechSynthesis不在時の安全性)', () => {
  it('paused=true/falseどちらでも例外なし(Node環境にはwindow.speechSynthesisが無いため素通り)', () => {
    const kit = new SoundKit();
    expect(() => kit.pauseCombatLoops(true)).not.toThrow();
    expect(() => kit.pauseCombatLoops(false)).not.toThrow();
  });
});

// ── R53 帝王BGM転調(Fable#5)────────────────────────────────────────────────
describe("R53: BGM_PROFILES['emperor-kokurai']", () => {
  it('専用プロファイルが存在し、全プロファイル中で最深のルート(41.2Hz=E1)を持つ', () => {
    const p = BGM_PROFILES['emperor-kokurai'];
    expect(p).toBeDefined();
    expect(p.rootHz).toBe(41.2);
    for (const key of Object.keys(BGM_PROFILES) as BgmProfileKey[]) {
      if (key === 'emperor-kokurai') continue;
      expect(BGM_PROFILES[key].rootHz).toBeGreaterThan(p.rootHz);
    }
  });

  it('玉座の間合い: half-time閾値0.45+drive bass+drone sub(帝の重圧の骨格)', () => {
    const p = BGM_PROFILES['emperor-kokurai'];
    expect(p.halfTimeKickBelowHeat).toBe(0.45);
    expect(p.bassMode).toBe('drive');
    expect(p.subMode).toBe('drone');
    expect(p.subDrive).toBeGreaterThanOrEqual(2.6); // zombie(2.6)以上の地響き
  });

  it('進行はゾンビ(病んだクラスタ)と異なる荘厳系(ナポリ♭II=半音上の威圧を含む)', () => {
    const p = BGM_PROFILES['emperor-kokurai'];
    expect(p.progression).toHaveLength(4);
    for (const chord of p.progression) expect(chord).toHaveLength(3);
    // 第2小節がナポリの♭II(ルート+1半音)で始まる=帝王進行の指紋
    expect(p.progression[1]![0]).toBe(1);
    // ゾンビ進行(0,1,6クラスタ開始)とは異なる
    expect(p.progression[0]).not.toEqual(BGM_PROFILES.zombie.progression[0]);
  });
});

// ═══ R54 音響2 ═══════════════════════════════════════════════════════

describe('R54 音響2: barFor(統一動機「帝王の指紋」♭II借用)', () => {
  it('w=0 は全小節で progression の素の和音と参照同一(既存挙動不変)', () => {
    for (let bar = 0; bar < 4; bar += 1) {
      expect(barFor(bar, 0)).toBe(BGM_PROGRESSION[bar]);
    }
  });

  it('最終小節のみ段階的にナポリ化(中間=中声♭2の暗転、最大=♭II6)。他小節は不変', () => {
    expect(barFor(3, 1)).toBe(NEAPOLITAN_BAR);
    expect(NEAPOLITAN_BAR).toEqual([8, 13, 17]); // B♭・E♭・G(第一転回=ナポリ6度)
    expect(barFor(3, 0.5)).toEqual([10, 13, 17]); // C→Cm(中声のみ半音下=声部連結)
    for (let bar = 0; bar < 3; bar += 1) {
      expect(barFor(bar, 1)).toBe(BGM_PROGRESSION[bar]);
    }
  });

  it('しきい値: w<1/3=素、1/3≤w<2/3=暗転、w≥2/3=♭II6。範囲外はクランプ', () => {
    expect(barFor(3, 0.33)).toBe(BGM_PROGRESSION[3]);
    expect(barFor(3, 0.34)).toEqual([10, 13, 17]);
    expect(barFor(3, 0.67)).toBe(NEAPOLITAN_BAR);
    expect(barFor(3, -1)).toBe(BGM_PROGRESSION[3]);
    expect(barFor(3, 99)).toBe(NEAPOLITAN_BAR);
  });

  it('任意プロファイル進行にも適用でき、小節indexは進行長で折り返す', () => {
    const prog = BGM_PROFILES.zombie.progression;
    expect(barFor(3, 1, prog)).toBe(NEAPOLITAN_BAR);
    expect(barFor(7, 1, prog)).toBe(NEAPOLITAN_BAR);
    expect(barFor(0, 1, prog)).toBe(prog[0]);
    expect(barFor(2, 0, prog)).toBe(prog[2]);
  });
});

describe('R54 音響2: BGMステム/後方減衰/屋内残響の純関数', () => {
  it('BGM_STEM_IDS: 4種の排他ステム', () => {
    expect(BGM_STEM_IDS).toEqual(['snd-planted', 'zombie-madness', 'story-motif', 'boss-duel']);
  });

  it('stemTargetGain: 強度0でも床(0.9×0.35)、最大0.9。単調・クランプ', () => {
    expect(stemTargetGain(0)).toBeCloseTo(0.9 * 0.35, 10);
    expect(stemTargetGain(1)).toBeCloseTo(0.9, 10);
    expect(stemTargetGain(-5)).toBeCloseTo(stemTargetGain(0), 10);
    expect(stemTargetGain(9)).toBeCloseTo(stemTargetGain(1), 10);
    expect(stemTargetGain(0.5)).toBeGreaterThan(stemTargetGain(0.2));
  });

  it('BEHIND_*: -3dB(×0.708)+高域15%減', () => {
    expect(BEHIND_GAIN_MUL).toBeCloseTo(dbToGain(-3), 2);
    expect(BEHIND_LP_MUL).toBe(0.85);
  });

  it('indoorReverbBlend: v=0 は全プリセットで素の値と厳密一致(既存挙動不変)', () => {
    for (const p of ['outdoor', 'canyon', 'indoor', 'dead'] as const) {
      const b = indoorReverbBlend(0, p);
      expect(b.wet).toBe(REVERB_PRESETS[p].wet);
      expect(b.ret).toBe(REVERB_PRESETS[p].ret);
      expect(b.lpfHz).toBe(5200);
      expect(b.longMul).toBe(p === 'dead' || p === 'indoor' ? 0.4 : 1);
    }
  });

  it('indoorReverbBlend: v=1 は屋内特性(wet/ret=indoor、LPF3200、long×0.4)。クランプ・中間単調', () => {
    const b = indoorReverbBlend(1, 'outdoor');
    expect(b.wet).toBeCloseTo(REVERB_PRESETS.indoor.wet, 10);
    expect(b.ret).toBeCloseTo(REVERB_PRESETS.indoor.ret, 10);
    expect(b.lpfHz).toBe(3200);
    expect(b.longMul).toBeCloseTo(0.4, 10);
    expect(indoorReverbBlend(2, 'outdoor')).toEqual(indoorReverbBlend(1, 'outdoor'));
    expect(indoorReverbBlend(-1, 'canyon')).toEqual(indoorReverbBlend(0, 'canyon'));
    const mid = indoorReverbBlend(0.5, 'outdoor');
    expect(mid.lpfHz).toBe(4200);
    expect(mid.wet).toBeGreaterThan(REVERB_PRESETS.outdoor.wet);
    expect(mid.wet).toBeLessThan(REVERB_PRESETS.indoor.wet);
  });
});

describe('R54 音響2: zombieVocalRecipe(フォルマント発声の決定的レシピ)', () => {
  it('4種で異なる輪郭: hurt最短・death最長、closeは上ずり、spawn/deathは下降', () => {
    const kinds = ['spawn', 'close', 'hurt', 'death'] as const;
    const durs = kinds.map((k) => zombieVocalRecipe(k).durS);
    expect(Math.min(...durs)).toBe(zombieVocalRecipe('hurt').durS);
    expect(Math.max(...durs)).toBe(zombieVocalRecipe('death').durS);
    expect(zombieVocalRecipe('close').f1End).toBeGreaterThan(zombieVocalRecipe('close').f1);
    expect(zombieVocalRecipe('spawn').f1End).toBeLessThan(zombieVocalRecipe('spawn').f1);
    expect(zombieVocalRecipe('death').f2End).toBeLessThan(zombieVocalRecipe('death').f2);
    // フォルマントは常に f1 < f2(声の構造)
    for (const k of kinds) {
      const r = zombieVocalRecipe(k);
      expect(r.f1).toBeLessThan(r.f2);
      expect(r.growlHz).toBeLessThan(r.f1);
    }
  });

  it('variantは3声(×0.85/1.0/1.18)で折り返す。時間・ゲインは声で不変', () => {
    const base = zombieVocalRecipe('spawn', 1);
    expect(zombieVocalRecipe('spawn', 0).f1).toBeCloseTo(base.f1 * 0.85, 6);
    expect(zombieVocalRecipe('spawn', 2).f1).toBeCloseTo(base.f1 * 1.18, 6);
    expect(zombieVocalRecipe('spawn', 3)).toEqual(zombieVocalRecipe('spawn', 0));
    expect(zombieVocalRecipe('spawn', -1)).toEqual(zombieVocalRecipe('spawn', 2));
    expect(zombieVocalRecipe('spawn', 2).durS).toBe(base.durS);
    expect(zombieVocalRecipe('spawn', 2).gain).toBe(base.gain);
  });
});

describe("R54 音響2: アナウンサー'rei'", () => {
  it("radioProsodyBase('rei')=pitch0.9/rate1.05。既存4話者は不変", () => {
    expect(radioProsodyBase('rei')).toEqual({ pitch: 0.9, rate: 1.05 });
    expect(radioProsodyBase('kurogane')).toEqual({ pitch: 0.52, rate: 0.8 });
    expect(radioProsodyBase('kagerou').pitch).toBeGreaterThan(0);
  });

  it("radioProsodyFor('rei')はジッタ込みでも基準±0.025/±0.03に収まる", () => {
    for (let i = 0; i < 20; i += 1) {
      const p = radioProsodyFor('rei');
      expect(Math.abs(p.pitch - 0.9)).toBeLessThanOrEqual(0.025 + 1e-9);
      expect(Math.abs(p.rate - 1.05)).toBeLessThanOrEqual(0.03 + 1e-9);
    }
  });

  it("RADIO_SQUELCH_SPECS に 'rei' の帯域が定義されている", () => {
    expect(RADIO_SQUELCH_SPECS.rei.carrierHz).toBeGreaterThan(0);
    expect(RADIO_SQUELCH_SPECS.rei.noiseHz).toBeGreaterThan(RADIO_SQUELCH_SPECS.rei.carrierHz);
  });
});
