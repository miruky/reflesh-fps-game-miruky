import type { SoundProfile } from '../game/weapons';

// 音声アセットを一切持たず、Web Audio APIで全効果音を合成する。
// AudioContextはブラウザの自動再生制限のため最初の操作時に生成する。
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVol = 0.8;
  private sfxVol = 0.8;
  private uiVol = 0.6;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(this.ctx.destination);
    // ブリックウォール・リミッターは「世界の音(SFX)」だけに掛ける。UIのヒット/
    // キル音まで通すと、発砲音の重低音でフィードバックがダッキングして潰れるため、
    // sfxBus→compressor→master、uiBus→master(圧縮を迂回)とする
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -6;
    this.compressor.knee.value = 0;
    this.compressor.ratio.value = 16;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.12;
    this.compressor.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.compressor);
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = this.uiVol;
    this.uiBus.connect(this.master);

    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }

  setVolumes(master: number, sfx: number, ui: number): void {
    this.masterVol = master;
    this.sfxVol = sfx;
    this.uiVol = ui;
    if (this.master) this.master.gain.value = master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.uiBus) this.uiBus.gain.value = ui;
  }

  private noiseBurst(opts: {
    durationS: number;
    filterHz: number;
    filterType: BiquadFilterType;
    gain: number;
    pan?: number;
    delayS?: number;
    bus?: GainNode;
  }): void {
    if (!this.ctx || !this.noiseBuffer || !this.sfxBus) return;
    const t0 = this.ctx.currentTime + (opts.delayS ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = opts.filterHz;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.durationS);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src
      .connect(filter)
      .connect(gain)
      .connect(pan)
      .connect(opts.bus ?? this.sfxBus);
    src.start(t0);
    src.stop(t0 + opts.durationS + 0.05);
  }

  private tone(opts: {
    freq: number;
    endFreq?: number;
    durationS: number;
    type: OscillatorType;
    gain: number;
    pan?: number;
    delayS?: number;
    bus?: GainNode;
  }): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.ctx.currentTime + (opts.delayS ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.durationS);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.durationS);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    osc
      .connect(gain)
      .connect(pan)
      .connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.durationS + 0.05);
  }

  // 武器クラスごとに異なる発砲音。スナイパーは専用の重厚な5層ブーム
  shot(profile: SoundProfile = 'ar'): void {
    switch (profile) {
      case 'dmr':
        this.sniperShot();
        return;
      case 'smg':
        this.noiseBurst({ durationS: 0.06, filterHz: 2800, filterType: 'lowpass', gain: 0.42 });
        this.tone({ freq: 160, endFreq: 70, durationS: 0.05, type: 'triangle', gain: 0.34 });
        return;
      case 'shotgun':
        this.noiseBurst({ durationS: 0.16, filterHz: 1600, filterType: 'lowpass', gain: 0.6 });
        this.tone({ freq: 110, endFreq: 45, durationS: 0.14, type: 'triangle', gain: 0.5 });
        return;
      case 'lmg':
        this.noiseBurst({ durationS: 0.11, filterHz: 2000, filterType: 'lowpass', gain: 0.55 });
        this.tone({ freq: 120, endFreq: 48, durationS: 0.1, type: 'sawtooth', gain: 0.45 });
        return;
      case 'pistol':
        this.noiseBurst({ durationS: 0.07, filterHz: 2600, filterType: 'lowpass', gain: 0.42 });
        this.tone({ freq: 180, endFreq: 80, durationS: 0.06, type: 'triangle', gain: 0.34 });
        return;
      case 'br':
        this.noiseBurst({ durationS: 0.08, filterHz: 2500, filterType: 'lowpass', gain: 0.46 });
        this.tone({ freq: 150, endFreq: 64, durationS: 0.07, type: 'triangle', gain: 0.4 });
        return;
      case 'ar':
      default:
        this.noiseBurst({ durationS: 0.09, filterHz: 2400, filterType: 'lowpass', gain: 0.5 });
        this.tone({ freq: 130, endFreq: 55, durationS: 0.08, type: 'triangle', gain: 0.45 });
        return;
    }
  }

  // スナイパーの一撃を演出する重厚な5層: オンセット/超音速クラック/ボディ/サブ/テイル
  private sniperShot(): void {
    this.noiseBurst({ durationS: 0.03, filterHz: 3500, filterType: 'bandpass', gain: 0.4 });
    this.noiseBurst({ durationS: 0.05, filterHz: 1400, filterType: 'highpass', gain: 0.5 });
    this.noiseBurst({ durationS: 0.16, filterHz: 1100, filterType: 'lowpass', gain: 0.72 });
    this.tone({ freq: 95, endFreq: 40, durationS: 0.22, type: 'sine', gain: 0.7 });
    this.noiseBurst({
      durationS: 0.45,
      filterHz: 600,
      filterType: 'lowpass',
      gain: 0.28,
      delayS: 0.04,
    });
  }

  // サプレッサー装着時のくぐもった発砲音
  shotSuppressed(): void {
    this.noiseBurst({ durationS: 0.06, filterHz: 900, filterType: 'lowpass', gain: 0.3 });
    this.tone({ freq: 90, endFreq: 50, durationS: 0.05, type: 'sine', gain: 0.25 });
  }

  // 距離と方向を持つ他者の発砲音
  enemyShot(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.06);
    this.noiseBurst({
      durationS: 0.12,
      filterHz: Math.max(500, 2000 - distance * 18),
      filterType: 'lowpass',
      gain: 0.4 * att,
      pan,
    });
    this.tone({ freq: 110, endFreq: 50, durationS: 0.1, type: 'triangle', gain: 0.3 * att, pan });
  }

  // ダメージ量に応じてピッチを上げ、手応えを段階的に伝える
  hit(pitch = 1): void {
    this.tone({
      freq: 1000 * pitch,
      durationS: 0.05,
      type: 'square',
      gain: 0.18,
      bus: this.uiBus ?? undefined,
    });
  }

  // 「ティッ・ディン」の2音でヘッドショットを明確に区別する
  headshot(): void {
    this.tone({
      freq: 1500,
      durationS: 0.05,
      type: 'square',
      gain: 0.2,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 2100,
      durationS: 0.07,
      type: 'square',
      gain: 0.18,
      delayS: 0.03,
      bus: this.uiBus ?? undefined,
    });
  }

  // 連続キルでピッチを少し上げ、勢いを表現する
  kill(pitch = 1): void {
    this.tone({
      freq: 880 * pitch,
      durationS: 0.08,
      type: 'sine',
      gain: 0.25,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 1320 * pitch,
      durationS: 0.12,
      type: 'sine',
      gain: 0.22,
      delayS: 0.07,
      bus: this.uiBus ?? undefined,
    });
  }

  // スナイパーで仕留めた時の専用キル音(低い余韻 + 高いピン)
  snipeKill(): void {
    this.tone({
      freq: 180,
      endFreq: 90,
      durationS: 0.18,
      type: 'sine',
      gain: 0.3,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 1600,
      durationS: 0.1,
      type: 'square',
      gain: 0.2,
      delayS: 0.04,
      bus: this.uiBus ?? undefined,
    });
  }

  // スコープを覗き込んだ瞬間のレンズ音(上昇する「シンッ」)
  scopeIn(): void {
    this.noiseBurst({
      durationS: 0.05,
      filterHz: 1800,
      filterType: 'bandpass',
      gain: 0.22,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 520,
      endFreq: 880,
      durationS: 0.12,
      type: 'sine',
      gain: 0.16,
      bus: this.uiBus ?? undefined,
    });
  }

  // 息を止めた合図(息を吸う柔らかいノイズ + 小さなクリック)
  holdBreath(): void {
    this.noiseBurst({
      durationS: 0.18,
      filterHz: 600,
      filterType: 'lowpass',
      gain: 0.12,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 1200,
      durationS: 0.03,
      type: 'sine',
      gain: 0.06,
      bus: this.uiBus ?? undefined,
    });
  }

  // 瀕死の心音(2拍の低い鼓動)
  heartbeat(): void {
    this.tone({ freq: 70, endFreq: 45, durationS: 0.12, type: 'sine', gain: 0.18 });
    this.tone({ freq: 70, endFreq: 45, durationS: 0.12, type: 'sine', gain: 0.18, delayS: 0.18 });
  }

  reload(durationMs: number): void {
    this.noiseBurst({ durationS: 0.05, filterHz: 3000, filterType: 'bandpass', gain: 0.3 });
    this.noiseBurst({
      durationS: 0.05,
      filterHz: 2200,
      filterType: 'bandpass',
      gain: 0.3,
      delayS: durationMs / 2000,
    });
    this.noiseBurst({
      durationS: 0.06,
      filterHz: 3600,
      filterType: 'bandpass',
      gain: 0.35,
      delayS: durationMs / 1000 - 0.08,
    });
  }

  dryfire(): void {
    this.noiseBurst({ durationS: 0.03, filterHz: 3200, filterType: 'bandpass', gain: 0.2 });
  }

  melee(): void {
    this.noiseBurst({ durationS: 0.09, filterHz: 600, filterType: 'bandpass', gain: 0.3 });
  }

  slide(): void {
    this.noiseBurst({ durationS: 0.35, filterHz: 420, filterType: 'lowpass', gain: 0.25 });
  }

  mantle(): void {
    this.noiseBurst({ durationS: 0.12, filterHz: 500, filterType: 'bandpass', gain: 0.22 });
    this.noiseBurst({
      durationS: 0.08,
      filterHz: 350,
      filterType: 'lowpass',
      gain: 0.2,
      delayS: 0.18,
    });
  }

  // スラスト(二段)ジャンプ: ブースターの噴射音
  thrust(): void {
    this.noiseBurst({ durationS: 0.2, filterHz: 1400, filterType: 'bandpass', gain: 0.28 });
    this.tone({ freq: 220, endFreq: 540, durationS: 0.16, type: 'sawtooth', gain: 0.16 });
  }

  // ウォールラン取り付き: 壁を擦る低い摩擦音
  wallRun(): void {
    this.noiseBurst({ durationS: 0.3, filterHz: 700, filterType: 'lowpass', gain: 0.18 });
  }

  // ウォールジャンプ: 壁を蹴る打撃音
  wallJump(): void {
    this.tone({ freq: 320, endFreq: 140, durationS: 0.12, type: 'triangle', gain: 0.26 });
    this.noiseBurst({ durationS: 0.12, filterHz: 900, filterType: 'bandpass', gain: 0.22 });
  }

  // アルティメット充填完了の上昇チャイム
  ultReady(): void {
    this.tone({ freq: 660, durationS: 0.1, type: 'sine', gain: 0.2, bus: this.uiBus ?? undefined });
    this.tone({
      freq: 990,
      durationS: 0.18,
      type: 'sine',
      gain: 0.2,
      delayS: 0.1,
      bus: this.uiBus ?? undefined,
    });
  }

  // アルティメット発動(オーバードライブ + スラム)の重低音
  ultActivate(): void {
    this.tone({ freq: 150, endFreq: 620, durationS: 0.4, type: 'sawtooth', gain: 0.3 });
    this.noiseBurst({ durationS: 0.5, filterHz: 820, filterType: 'lowpass', gain: 0.5 });
  }

  // ピンを抜いてクッキングを始めた合図
  pinPull(): void {
    this.tone({ freq: 1900, durationS: 0.04, type: 'square', gain: 0.12 });
    this.noiseBurst({ durationS: 0.04, filterHz: 4200, filterType: 'bandpass', gain: 0.15 });
  }

  throwWhoosh(): void {
    this.noiseBurst({ durationS: 0.18, filterHz: 1100, filterType: 'bandpass', gain: 0.2 });
  }

  bounce(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.1);
    this.tone({ freq: 380, endFreq: 240, durationS: 0.06, type: 'triangle', gain: 0.2 * att, pan });
  }

  explosion(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.04);
    this.noiseBurst({
      durationS: 0.5,
      filterHz: 700,
      filterType: 'lowpass',
      gain: 0.85 * att,
      pan,
    });
    this.tone({ freq: 70, endFreq: 28, durationS: 0.45, type: 'sine', gain: 0.7 * att, pan });
    this.noiseBurst({
      durationS: 0.7,
      filterHz: 240,
      filterType: 'lowpass',
      gain: 0.4 * att,
      pan,
      delayS: 0.08,
    });
  }

  smokePop(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.08);
    this.tone({ freq: 240, endFreq: 160, durationS: 0.1, type: 'triangle', gain: 0.25 * att, pan });
    this.noiseBurst({
      durationS: 1.4,
      filterHz: 2400,
      filterType: 'highpass',
      gain: 0.08 * att,
      pan,
      delayS: 0.05,
    });
  }

  // フラッシュ被弾時の耳鳴り。強度で長さと音量が変わる
  flashRing(intensity: number): void {
    if (intensity <= 0) return;
    this.tone({
      freq: 3400,
      durationS: 0.8 + intensity * 1.4,
      type: 'sine',
      gain: 0.1 + intensity * 0.12,
    });
    this.noiseBurst({
      durationS: 0.15,
      filterHz: 5000,
      filterType: 'highpass',
      gain: 0.3 * intensity,
    });
  }

  fireCrackle(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.12);
    this.noiseBurst({
      durationS: 0.1,
      filterHz: 1800 + Math.random() * 1600,
      filterType: 'bandpass',
      gain: 0.07 * att,
      pan,
    });
  }

  footstep(intensity: number): void {
    this.noiseBurst({
      durationS: 0.06,
      filterHz: 320,
      filterType: 'lowpass',
      gain: 0.22 * intensity,
    });
  }

  hurt(): void {
    this.tone({ freq: 150, endFreq: 70, durationS: 0.15, type: 'sine', gain: 0.4 });
  }

  death(): void {
    this.tone({ freq: 220, endFreq: 60, durationS: 0.5, type: 'sawtooth', gain: 0.25 });
  }

  uiClick(): void {
    this.tone({
      freq: 700,
      durationS: 0.04,
      type: 'sine',
      gain: 0.15,
      bus: this.uiBus ?? undefined,
    });
  }

  // 拠点を制圧した時の上昇音
  capture(): void {
    this.tone({ freq: 520, durationS: 0.1, type: 'sine', gain: 0.2, bus: this.uiBus ?? undefined });
    this.tone({
      freq: 780,
      durationS: 0.16,
      type: 'sine',
      gain: 0.2,
      delayS: 0.09,
      bus: this.uiBus ?? undefined,
    });
  }

  // 拠点を失った・中立化された時の下降音
  zoneLost(): void {
    this.tone({
      freq: 520,
      durationS: 0.1,
      type: 'sine',
      gain: 0.18,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 350,
      durationS: 0.18,
      type: 'sine',
      gain: 0.18,
      delayS: 0.09,
      bus: this.uiBus ?? undefined,
    });
  }
}
