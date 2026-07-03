import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmbienceEngine,
  deriveAmbientProfile,
  eventDelayS,
  fillBrownNoise,
  makeSeamlessLoop,
  type AmbientProfile,
} from './ambience';
import { mulberry32 } from './rng';
import { stageById } from '../game/stages';
import { BIOMES, generateStageDef } from '../game/biomes';

// ステージ定義からそのままプロファイルを引くヘルパ(size/obstacleCountも実値を渡す)
function profileOf(id: string): AmbientProfile {
  const def = stageById(id);
  return deriveAmbientProfile(def.palette, def.size, def.obstacleCount);
}

describe('deriveAmbientProfile(パレット→環境音の決定的導出)', () => {
  it('setsugen: 濃霧の屋外。風が太く高帯域、ハム/群衆/イベント無し', () => {
    const p = profileOf('setsugen');
    expect(p.isIndoor).toBe(false);
    // R13: setsugen fogDensity 0.028→0.018(霧の白飛び緩和)に伴い風音も追従(fogDensity由来)
    expect(p.windGain).toBeCloseTo(0.595, 5); // 0.28 + 0.018*17.5
    expect(p.windHz).toBeCloseTo(560, 5); // 200 + 0.018*20000
    expect(p.windLfoHz).toBeCloseTo(0.08 + (0.018 / 0.03) * 0.17, 5);
    expect(p.humGain).toBe(0); // turbidity 1.5 < 9
    expect(p.crowdGain).toBe(0);
    expect(p.waterGain).toBe(0.05); // accent #4a7dbf が青優勢
    expect(p.birdRateS).toBe(0); // elevation 22 < 35
    expect(p.cricketRateS).toBe(0); // elevation 22 >= 20 かつ非発光
    expect(p.steamRateS).toBe(0);
    expect(p.creakRateS).toBe(0);
  });

  it('yoichi: 夜市=屋内扱い。ハム80Hz・群衆・蒸気・きしみが乗り、鳥/虫は無し', () => {
    const p = profileOf('yoichi');
    expect(p.isIndoor).toBe(true); // emissive && elevation 12 < 20
    expect(p.windGain).toBe(0.14);
    expect(p.humGain).toBe(0.06);
    expect(p.humHz).toBe(80); // turbidity 16 >= 14
    expect(p.crowdGain).toBe(0.05); // emissive && turbidity >= 14
    expect(p.waterGain).toBe(0);
    expect(p.birdRateS).toBe(0);
    expect(p.cricketRateS).toBe(0);
    expect(p.steamRateS).toBe(11);
    expect(p.creakRateS).toBe(13);
  });

  it('kunren: 明るい昼の屋外。鳥だけが鳴き、床の微青グレーは水と誤検出しない', () => {
    const p = profileOf('kunren');
    expect(p.isIndoor).toBe(false);
    expect(p.windGain).toBeCloseTo(0.455, 5); // 0.28 + 0.01*17.5
    expect(p.windHz).toBeCloseTo(400, 5);
    expect(p.humGain).toBe(0);
    expect(p.waterGain).toBe(0); // 床 #b8bcc4 はほぼ無彩色なので弾く
    expect(p.birdRateS).toBe(7); // elevation 45 >= 35
    expect(p.cricketRateS).toBe(0);
    expect(p.steamRateS).toBe(0);
    expect(p.creakRateS).toBe(0);
  });

  it('kouwan: 青系の床(港湾)で水音が乗る', () => {
    const p = profileOf('kouwan');
    expect(p.isIndoor).toBe(false);
    expect(p.waterGain).toBe(0.05); // 床 #9aa1a8 が青優勢
    expect(p.humGain).toBe(0); // turbidity 4
    expect(p.birdRateS).toBe(0); // elevation 20
    expect(p.cricketRateS).toBe(0);
  });

  it('koushou: 工廠=屋内扱い。ハム60Hz・蒸気・きしみ、群衆は無し', () => {
    const p = profileOf('koushou');
    expect(p.isIndoor).toBe(true); // emissive && elevation 12
    expect(p.humGain).toBe(0.06);
    expect(p.humHz).toBe(60); // turbidity 12 < 14
    expect(p.crowdGain).toBe(0); // turbidity 12 < 14
    expect(p.steamRateS).toBe(11);
    expect(p.creakRateS).toBe(13);
  });

  it('takadai: 薄暮の屋外。虫が鳴き、濁った空で薄いハムが乗る', () => {
    const p = profileOf('takadai');
    expect(p.isIndoor).toBe(false); // 非発光なので低elevationでも屋外
    expect(p.cricketRateS).toBe(5); // elevation 12 < 20
    expect(p.birdRateS).toBe(0);
    expect(p.humGain).toBe(0.02); // turbidity 9 >= 9
    expect(p.humHz).toBe(60);
    expect(p.steamRateS).toBe(0); // turbidity 9 < 12
    expect(p.creakRateS).toBe(0);
  });

  it('8バイオーム×generateStageDef: 決定性と値域が常に守られる', () => {
    for (const biome of BIOMES) {
      for (const seed of [3, 17, 91]) {
        const def = generateStageDef(seed, biome);
        const a = deriveAmbientProfile(def.palette, def.size, def.obstacleCount);
        const b = deriveAmbientProfile(def.palette, def.size, def.obstacleCount);
        expect(b).toEqual(a); // 純関数=同入力同出力
        expect(a.windGain).toBeGreaterThanOrEqual(0.14);
        expect(a.windGain).toBeLessThanOrEqual(0.84);
        expect(a.windHz).toBeGreaterThanOrEqual(250);
        expect(a.windHz).toBeLessThanOrEqual(900);
        expect(a.windLfoHz).toBeGreaterThanOrEqual(0.08);
        expect(a.windLfoHz).toBeLessThanOrEqual(0.25);
        expect([0, 0.02, 0.06]).toContain(a.humGain);
        expect([60, 80]).toContain(a.humHz);
        expect([0, 0.05]).toContain(a.crowdGain);
        expect([0, 0.05]).toContain(a.waterGain);
        expect([0, 7]).toContain(a.birdRateS);
        expect([0, 5]).toContain(a.cricketRateS);
        expect([0, 11]).toContain(a.steamRateS);
        expect([0, 13]).toContain(a.creakRateS);
        if (a.isIndoor) {
          // 屋内なら鳥/虫は構造的に無効
          expect(a.birdRateS).toBe(0);
          expect(a.cricketRateS).toBe(0);
        }
      }
    }
  });

  it('neonバイオームは常に屋内扱い、urbanは常に屋外扱い', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const neon = generateStageDef(seed, 'neon');
      const urban = generateStageDef(seed, 'urban');
      expect(deriveAmbientProfile(neon.palette, neon.size, neon.obstacleCount).isIndoor).toBe(true);
      expect(deriveAmbientProfile(urban.palette, urban.size, urban.obstacleCount).isIndoor).toBe(
        false,
      );
    }
  });
});

describe('eventDelayS', () => {
  it('rand=0で0.6倍、rand=1で1.5倍、中間は線形', () => {
    expect(eventDelayS(10, 0)).toBeCloseTo(6, 10);
    expect(eventDelayS(10, 1)).toBeCloseTo(15, 10);
    expect(eventDelayS(7, 0.5)).toBeCloseTo(7 * 1.05, 10);
  });

  it('任意のrand∈[0,1)で必ず[0.6b, 1.5b]に収まる', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i += 1) {
      const d = eventDelayS(11, rng());
      expect(d).toBeGreaterThanOrEqual(11 * 0.6);
      expect(d).toBeLessThanOrEqual(11 * 1.5);
    }
  });
});

describe('fillBrownNoise', () => {
  it('同じrngなら同じ波形(決定的)', () => {
    const a = new Float32Array(2048);
    const b = new Float32Array(2048);
    fillBrownNoise(a, mulberry32(7));
    fillBrownNoise(b, mulberry32(7));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('白色ノイズより低域偏重(RMS比の隣接サンプル差が小さい)で、振幅は±1未満', () => {
    const n = 8192;
    const brown = new Float32Array(n);
    fillBrownNoise(brown, mulberry32(11));
    const white = new Float32Array(n);
    const rng = mulberry32(11);
    for (let i = 0; i < n; i += 1) white[i] = rng() * 2 - 1;

    // 隣接差の平均をRMSで正規化して比較する(絶対値だと音量差の影響を受けるため)
    const diffOverRms = (x: Float32Array): number => {
      let diff = 0;
      let sq = 0;
      for (let i = 0; i < x.length; i += 1) {
        const cur = x[i] ?? 0;
        sq += cur * cur;
        if (i > 0) diff += Math.abs(cur - (x[i - 1] ?? 0));
      }
      const rms = Math.sqrt(sq / x.length);
      return diff / (x.length - 1) / rms;
    };
    expect(diffOverRms(brown)).toBeLessThan(diffOverRms(white));

    let maxAbs = 0;
    for (const v of brown) maxAbs = Math.max(maxAbs, Math.abs(v));
    expect(maxAbs).toBeLessThan(1);
  });
});

describe('makeSeamlessLoop', () => {
  it('ループ点が連続する(末尾サンプルと先頭サンプルの差 < 0.05)', () => {
    const data = new Float32Array(4096);
    fillBrownNoise(data, mulberry32(13));
    makeSeamlessLoop(data, 256);
    expect(Math.abs((data[0] ?? 0) - (data[data.length - 1] ?? 0))).toBeLessThan(0.05);
  });

  it('フェード区間の外(中央部)は無改変', () => {
    const data = new Float32Array(4096);
    fillBrownNoise(data, mulberry32(17));
    const before = Array.from(data);
    makeSeamlessLoop(data, 256);
    for (let i = 256; i < 4096 - 256; i += 1) {
      expect(data[i]).toBe(before[i] ?? 0);
    }
  });

  it('フェード境界も滑らか(元波形との差がフェード端でほぼゼロ)', () => {
    const data = new Float32Array(4096);
    fillBrownNoise(data, mulberry32(19));
    const before = Array.from(data);
    makeSeamlessLoop(data, 256);
    // 先頭フェードの終端は元の内容へほぼ戻っている(等パワーのsinが1に漸近)
    expect(Math.abs((data[255] ?? 0) - (before[255] ?? 0))).toBeLessThan(0.02);
  });

  it('短すぎる配列や不正なfadeSamplesでは何もしない', () => {
    const data = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const before = Array.from(data);
    makeSeamlessLoop(data, 3); // len < fade*2
    expect(Array.from(data)).toEqual(before);
    makeSeamlessLoop(data, 0);
    expect(Array.from(data)).toEqual(before);
  });
});

// ── WebAudioモック(node環境にはAudioContextが無いため手書きの最小スタブ) ──

class FakeParam {
  value = 0;
  calls: Array<{ method: string; args: number[] }> = [];
  setValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'setValueAtTime', args: [v, t] });
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'exponentialRampToValueAtTime', args: [v, t] });
  }
  setTargetAtTime(v: number, t: number, tau: number): void {
    this.calls.push({ method: 'setTargetAtTime', args: [v, t, tau] });
  }
  lastTarget(): number[] | null {
    for (let i = this.calls.length - 1; i >= 0; i -= 1) {
      const c = this.calls[i];
      if (c && c.method === 'setTargetAtTime') return c.args;
    }
    return null;
  }
}

class FakeNode {
  connections: unknown[] = [];
  disconnectCount = 0;
  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnectCount += 1;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
  constructor() {
    super();
    this.gain.value = 1;
  }
}

class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(_when?: number): void {
    this.started = true;
  }
  stop(_when?: number): void {
    this.stopped = true;
  }
}

class FakeSrc extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam();
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(_when?: number, _offset?: number, _duration?: number): void {
    this.started = true;
  }
  stop(_when?: number): void {
    this.stopped = true;
  }
}

class FakeCtx {
  currentTime = 0;
  sampleRate = 48000;
  gains: FakeGain[] = [];
  filters: FakeBiquad[] = [];
  oscs: FakeOsc[] = [];
  srcs: FakeSrc[] = [];
  createGain(): FakeGain {
    const n = new FakeGain();
    this.gains.push(n);
    return n;
  }
  createBiquadFilter(): FakeBiquad {
    const n = new FakeBiquad();
    this.filters.push(n);
    return n;
  }
  createOscillator(): FakeOsc {
    const n = new FakeOsc();
    this.oscs.push(n);
    return n;
  }
  createBufferSource(): FakeSrc {
    const n = new FakeSrc();
    this.srcs.push(n);
    return n;
  }
  allSources(): Array<FakeOsc | FakeSrc> {
    return [...this.oscs, ...this.srcs];
  }
}

interface EngineInternals {
  liveSources: unknown[];
  liveNodes: unknown[];
}

// 全ベッドが立つプロファイル(engine系テスト用)
const FULL_PROFILE: AmbientProfile = {
  windGain: 0.1,
  windHz: 400,
  windLfoHz: 0.1,
  humGain: 0.06,
  humHz: 60,
  crowdGain: 0.05,
  waterGain: 0.05,
  birdRateS: 7,
  cricketRateS: 5,
  steamRateS: 11,
  creakRateS: 13,
  isIndoor: false,
};

function makeEngine(): { engine: AmbienceEngine; ctx: FakeCtx; out: FakeNode } {
  const ctx = new FakeCtx();
  const out = new FakeNode();
  const engine = new AmbienceEngine(
    ctx as unknown as AudioContext,
    out as unknown as AudioNode,
    {} as unknown as AudioBuffer,
    mulberry32(42),
  );
  return { engine, ctx, out };
}

function internals(engine: AmbienceEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

describe('AmbienceEngine(WebAudioモック)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start: beds→bedMix→duckGain→out のグラフが組まれ、全sourceが起動する', () => {
    const { engine, ctx, out } = makeEngine();
    engine.start(FULL_PROFILE);
    // 生成順: gains[0]=bedMix, gains[1]=duckGain(グラフの根)
    const bedMix = ctx.gains[0];
    const duck = ctx.gains[1];
    expect(bedMix?.connections).toContain(duck);
    expect(duck?.connections).toContain(out);
    // 風2+群衆1+水1のバッファソース、風LFO+ハム3+群衆AM+水LFOのosc
    expect(ctx.srcs).toHaveLength(4);
    expect(ctx.oscs).toHaveLength(6);
    expect(ctx.allSources().every((s) => s.started)).toBe(true);
    expect(internals(engine).liveSources).toHaveLength(10);
    expect(internals(engine).liveNodes.length).toBeGreaterThan(0);
  });

  it('stop: フェード後のタイマーfinalizeで両台帳が空になり全sourceがstop済み', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    engine.stop();
    // フェード指示(bedMixのgainに0.0001へのsetTargetAtTime)が積まれている
    expect(ctx.gains[0]?.gain.lastTarget()?.[0]).toBeCloseTo(0.0001, 10);
    // タイマー発火前はまだ生きている
    expect(internals(engine).liveSources.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(850);
    expect(internals(engine).liveSources).toHaveLength(0);
    expect(internals(engine).liveNodes).toHaveLength(0);
    expect(ctx.allSources().every((s) => s.stopped)).toBe(true);
  });

  it('start×2: 二重起動せず、先代のsourceは同期finalizeで全てstop済みになる', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    const firstGen = ctx.allSources();
    engine.start(FULL_PROFILE);
    expect(firstGen.every((s) => s.stopped)).toBe(true);
    // 台帳は2代目の分だけ(1代分=10)しか残らない
    expect(internals(engine).liveSources).toHaveLength(10);
  });

  it('stop直後のstart: 停止タイマーが破棄され、遅延finalizeが新ベッドを殺さない', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    engine.stop();
    const firstGen = new Set(ctx.allSources());
    engine.start(FULL_PROFILE);
    vi.advanceTimersByTime(1000); // 破棄済みタイマーの発火時刻を過ぎても…
    expect(internals(engine).liveSources).toHaveLength(10); // 2代目は生きている
    const secondGen = ctx.allSources().filter((s) => !firstGen.has(s));
    expect(secondGen).toHaveLength(10);
    expect(secondGen.every((s) => !s.stopped)).toBe(true);
  });

  it('finalizeは冪等(直接2回呼んでも安全)', () => {
    const { engine } = makeEngine();
    engine.start(FULL_PROFILE);
    engine.finalize();
    engine.finalize();
    expect(internals(engine).liveSources).toHaveLength(0);
    expect(internals(engine).liveNodes).toHaveLength(0);
  });

  it('tick: 散発イベントは初回tickで未来へ予約され、発火後は必ず未来へ再設定される', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    const bedCount = ctx.allSources().length;
    engine.tick(5); // 予約のみ(即発火しない)
    expect(ctx.allSources()).toHaveLength(bedCount);
    // 最長の遅延でも 5 + 13*1.5 = 24.5s なので、t=40 で全イベント種が一度は発火する
    engine.tick(40);
    const afterFire = ctx.allSources().length;
    expect(afterFire).toBeGreaterThan(bedCount);
    // 同時刻の再tickで連打しない(nextTが未来へ再設定されているガードの検証)
    engine.tick(40);
    expect(ctx.allSources()).toHaveLength(afterFire);
    // 突風: 風ゲイン(生成順でgains[2]=windGainNode)へランダムウォークが積まれている
    const gust = ctx.gains[2]?.gain.lastTarget();
    expect(gust).not.toBeNull();
    expect(gust?.[0]).toBeGreaterThanOrEqual(0.1 * 0.7);
    expect(gust?.[0]).toBeLessThanOrEqual(0.1 * 1.6);
  });

  it('tickでイベントが鳴っていてもstop→finalizeで台帳が空になり全source停止', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    engine.tick(5);
    engine.tick(40); // イベントの一時ノードが台帳に載っている状態
    engine.stop();
    vi.advanceTimersByTime(850);
    expect(internals(engine).liveSources).toHaveLength(0);
    expect(internals(engine).liveNodes).toHaveLength(0);
    expect(ctx.allSources().every((s) => s.stopped)).toBe(true);
  });

  it('イベント音はonendedで自ら台帳から抜けて切断される', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    const bedSources = internals(engine).liveSources.length;
    const bedNodes = internals(engine).liveNodes.length;
    engine.tick(5);
    engine.tick(40);
    expect(internals(engine).liveSources.length).toBeGreaterThan(bedSources);
    // 実ブラウザでのonended発火を模して全イベントの終了を通知する
    for (const s of ctx.allSources()) s.onended?.();
    expect(internals(engine).liveSources).toHaveLength(bedSources);
    expect(internals(engine).liveNodes).toHaveLength(bedNodes);
  });

  it('setHeat: ε差分ガード付きでduckGainへ反映。heat=0は1.15の逆ダック', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    const duck = ctx.gains[1];
    engine.setHeat(0.5);
    expect(duck?.gain.lastTarget()?.[0]).toBeCloseTo(1 - 0.65 * 0.5, 10);
    expect(duck?.gain.lastTarget()?.[2]).toBeCloseTo(0.4, 10);
    const callCount = duck?.gain.calls.length ?? 0;
    engine.setHeat(0.51); // Δ0.01 < ε0.02 → 積まない
    expect(duck?.gain.calls.length).toBe(callCount);
    engine.setHeat(0);
    expect(duck?.gain.lastTarget()?.[0]).toBeCloseTo(1.15, 10);
  });

  it('setPaused: boolean変化時のみbedMixを0.25⇔1.0へ動かす', () => {
    const { engine, ctx } = makeEngine();
    engine.start(FULL_PROFILE);
    const bedMix = ctx.gains[0];
    engine.setPaused(true);
    expect(bedMix?.gain.lastTarget()?.[0]).toBeCloseTo(0.25, 10);
    const callCount = bedMix?.gain.calls.length ?? 0;
    engine.setPaused(true); // 同値は無視
    expect(bedMix?.gain.calls.length).toBe(callCount);
    engine.setPaused(false);
    expect(bedMix?.gain.lastTarget()?.[0]).toBeCloseTo(1.0, 10);
  });
});
