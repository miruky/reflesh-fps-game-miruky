// 音声アセットを一切持たず、Web Audio APIで全効果音を合成する。
// AudioContextはブラウザの自動再生制限のため最初の操作時に生成する。
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
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

  shot(): void {
    this.noiseBurst({ durationS: 0.09, filterHz: 2400, filterType: 'lowpass', gain: 0.5 });
    this.tone({ freq: 130, endFreq: 55, durationS: 0.08, type: 'triangle', gain: 0.45 });
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

  hit(): void {
    this.tone({
      freq: 1150,
      durationS: 0.05,
      type: 'square',
      gain: 0.18,
      bus: this.uiBus ?? undefined,
    });
  }

  headshot(): void {
    this.tone({
      freq: 1500,
      durationS: 0.06,
      type: 'square',
      gain: 0.2,
      bus: this.uiBus ?? undefined,
    });
  }

  kill(): void {
    this.tone({
      freq: 880,
      durationS: 0.08,
      type: 'sine',
      gain: 0.25,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 1320,
      durationS: 0.12,
      type: 'sine',
      gain: 0.22,
      delayS: 0.07,
      bus: this.uiBus ?? undefined,
    });
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
}
