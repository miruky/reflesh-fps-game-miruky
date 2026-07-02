import type { SoundProfile } from '../game/weapons';
import type { StagePalette } from '../game/stage';
import type { SurfaceMaterial, SurfaceSet } from '../game/materials';
import { AmbienceEngine, deriveAmbientProfile } from './ambience';
import { fillBrownNoise, makeSeamlessLoop } from './ambience';

// ── 人間ライクなアナウンサー音声(③) ─────────────────────────────────
// アセット禁止のため SpeechSynthesis を使うが、OS既定のロボット声任せをやめ、
// 端末ローカルの高品位音声を選び、コール内容ごとに自然なプロソディを与える。
// 声選定/テキスト正規化/プロソディは副作用ゼロの純関数に切り出してテスト可能にする。

// SpeechSynthesisVoice を構造的に受ける最小形(テスト用に組み立てやすく)
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

export interface Prosody {
  pitch: number;
  rate: number;
}

// 人間ぽい既知良声(macOS/Windows同梱の自然合成)を加点する名前パターン
const KNOWN_GOOD =
  /siri|samantha|alex|enhanced|premium|natural|aria|jenny|guy|daniel|allison|ava|tom|serena|karen|moira/i;
// espeak/compact等のロボット声、google/*online*等のクラウド声(静的制約に反する)を減点
const ROBOTIC_OR_CLOUD = /espeak|compact|google|online|robosoft|android|festival/i;

// 声の良さを採点する。加点: 既知良声+50 / 端末ローカル+40 / en-US+20・en-*+10。
// 減点: 英語以外-30 / ロボット・クラウド-60。
export function scoreVoice(v: VoiceLike): number {
  let s = 0;
  if (KNOWN_GOOD.test(v.name)) s += 50;
  if (v.localService) s += 40;
  if (v.lang === 'en-US') s += 20;
  else if (v.lang.startsWith('en')) s += 10;
  else s -= 30;
  if (ROBOTIC_OR_CLOUD.test(v.name)) s -= 60;
  return s;
}

// 最高得点の声を返す。同点は先勝ち(安定)。空なら null。
// ジェネリクスで元の SpeechSynthesisVoice 参照をそのまま返せるようにする。
export function pickBestVoice<T extends VoiceLike>(voices: ReadonlyArray<T>): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const sc = scoreVoice(v);
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return best;
}

// 読み上げテキストの正規化。既知ラベルは語間カンマで“間”を作り、未知は小文字化。
const TTS_OVERRIDE: Record<string, string> = {
  'DOUBLE KILL': 'double, kill',
  'TRIPLE KILL': 'triple, kill',
  'MULTI KILL': 'multi, kill',
  'KILL CHAIN': 'kill, chain',
  'POINT BLANK': 'point, blank',
  GODLIKE: 'god, like',
  RAMPAGE: 'rampage',
  UNSTOPPABLE: 'unstoppable',
};
export function normalizeTts(label: string, emphasize: boolean): string {
  const override = TTS_OVERRIDE[label];
  if (override !== undefined) return override;
  const lower = label.toLowerCase();
  // emphasizeでも既にカンマを含むものはそのまま。未知ラベルは素直に小文字読み
  return emphasize ? lower : lower;
}

// コール内容ごとの基準ピッチ/レート(ジッタ無し・テスト可能)
const STREAK_PROSODY: Record<string, Prosody> = {
  'DOUBLE KILL': { pitch: 0.95, rate: 1.22 },
  'TRIPLE KILL': { pitch: 0.92, rate: 1.2 },
  'MULTI KILL': { pitch: 0.9, rate: 1.25 },
  RAMPAGE: { pitch: 0.85, rate: 1.3 },
  UNSTOPPABLE: { pitch: 0.78, rate: 1.12 },
  GODLIKE: { pitch: 0.66, rate: 0.95 },
};
export function prosodyBase(label: string): Prosody {
  return STREAK_PROSODY[label] ?? { pitch: 0.78, rate: 1.05 };
}
// 基準に毎回±数%の微ジッタを乗せて機械反復感を消す。pitch∈[0,2]/rate∈[0.1,10]にクランプ。
export function prosodyFor(label: string): Prosody {
  const b = prosodyBase(label);
  const pitch = Math.min(2, Math.max(0, b.pitch + (Math.random() - 0.5) * 0.06));
  const rate = Math.min(10, Math.max(0.1, b.rate + (Math.random() - 0.5) * 0.08));
  return { pitch, rate };
}

// ═══════════════════════════════════════════════════════════════════
// R9 サウンドv2: ミキシング/リバーブ/銃声レイヤリングの純関数・定数群。
// 全て副作用ゼロでvitest対象。実数値はラウドネスバランス表(設計書)で一度だけ調律。
// ═══════════════════════════════════════════════════════════════════

// コンプレッサーの唯一の正準値(ミキシングv2の専権。他所からの変更禁止)
export const COMPRESSOR_PARAMS = {
  threshold: -10,
  knee: 6,
  ratio: 8,
  attack: 0.003,
  release: 0.15,
} as const;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

// WaveShaper用の共有カーブ(曲線データのみ共有し、ノードはボイス毎に生成する。
// ノード自体を共有すると同時発音がシェイパー内で混ざり相互変調してしまう)
export function makeTanhCurveData(k: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

// 非対称カーブ: 正側は軟圧縮、負側は強くtanh。非対称性が偶数次倍音を生み、
// サブベースの「見えない基音」を小型スピーカーでも知覚させる(missing fundamental)
export function makeAsymCurveData(n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(3.5);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = x >= 0 ? 1 - Math.pow(1 - x, 1.5) : -Math.tanh(-3.5 * x) / norm;
  }
  return c;
}

// ── プロシージャル・リバーブ(ConvolverNode用IRの合成) ──────────────
export type ReverbPreset = 'outdoor' | 'canyon' | 'indoor' | 'dead';

export const REVERB_PRESETS: Record<
  ReverbPreset,
  { durationS: number; t60: number; preDelayS: number; wet: number; ret: number }
> = {
  outdoor: { durationS: 1.5, t60: 0.8, preDelayS: 0.012, wet: 0.2, ret: 0.6 },
  canyon: { durationS: 1.8, t60: 1.8, preDelayS: 0.045, wet: 0.4, ret: 0.7 },
  indoor: { durationS: 0.7, t60: 0.28, preDelayS: 0.003, wet: 0.32, ret: 0.65 },
  dead: { durationS: 0.35, t60: 0.12, preDelayS: 0.002, wet: 0.08, ret: 0.5 },
};

// インパルス応答の合成: プリディレイ(先頭ゼロ埋め=DelayNode不要)→初期反射タップ→
// 指数減衰ノイズテール(250Hz実LPのbassMix+時変ダンピング8k→1.2kで空気吸収を再現)→
// エネルギー正規化(Σx²=1)。rng注入で決定的テストが可能。
export function renderImpulse(
  sr: number,
  durationS: number,
  t60: number,
  preDelayS: number,
  bassMix = 0.18,
  rng: () => number = Math.random,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const len = Math.max(8, Math.floor(sr * durationS));
  const pre = Math.min(len - 4, Math.floor(sr * preDelayS));
  const tauHi = t60 / 6.908; // t60 = 減衰-60dBの時間
  const tauLo = tauHi * 1.7;
  const a250 = 1 - Math.exp((-2 * Math.PI * 250) / sr);
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(len),
    new Float32Array(len),
  ];
  for (let ci = 0; ci < 2; ci += 1) {
    const ch = out[ci]!;
    let lp = 0;
    let damp = 0;
    for (let i = pre; i < len; i += 1) {
      const t = (i - pre) / sr;
      const w = rng() * 2 - 1;
      lp += a250 * (w - lp);
      const s = w * Math.exp(-t / tauHi) + bassMix * lp * Math.exp(-t / tauLo) * 3;
      // 時変ダンピング: テールほど暗く(8kHz→1.2kHz)
      const cutoff = 8000 - 6800 * Math.min(1, t / durationS);
      const ad = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      damp += ad * (s - damp);
      ch[i] = damp;
    }
    // スパース初期反射(5〜80ms、L/Rで位置をずらし広がりを作る)
    const taps = 6;
    for (let k = 0; k < taps; k += 1) {
      const tt = 0.005 + (0.075 * (k + (ci === 1 ? 0.5 : 0))) / taps + rng() * 0.004;
      const idx = pre + Math.floor(tt * sr);
      if (idx < len) ch[idx]! += (0.5 - (0.35 * k) / taps) * (rng() < 0.5 ? -1 : 1);
    }
    // エネルギー正規化(convolver.normalize=trueと併用でクリップ余地を断つ)
    let e = 0;
    for (let i = 0; i < len; i += 1) e += ch[i]! * ch[i]!;
    const norm = e > 0 ? 1 / Math.sqrt(e) : 1;
    for (let i = 0; i < len; i += 1) ch[i]! *= norm;
  }
  return out;
}

// ステージ→空間プリセットの導出。手書きIDマップ優先、生成ステージはパレットの
// 霧/太陽/夜市属性から推定(snowバイオームはfog>=0.022で全域dead=雪の吸音)
const STAGE_REVERB: Record<string, ReverbPreset> = {
  kyokoku: 'canyon',
  saisekiba: 'canyon',
  koushou: 'indoor',
  kairou: 'indoor',
  haieki: 'indoor',
  setsugen: 'dead',
};

export function deriveReverbPreset(def: {
  id: string;
  maxHeight: number;
  palette: StagePalette;
}): ReverbPreset {
  const mapped = STAGE_REVERB[def.id];
  if (mapped) return mapped;
  const p = def.palette;
  if (p.emissiveAccent === true && (p.elevation ?? 50) < 20) return 'indoor';
  if (p.fogDensity >= 0.022 && (p.turbidity ?? 3) < 3) return 'dead';
  if (p.fogDensity <= 0.011 && (p.elevation ?? 0) >= 50 && def.maxHeight >= 5) return 'canyon';
  return 'outdoor';
}

// ── 銃声4層エンジン(SHOT_PROFILESデータ駆動) ────────────────────────
// L1メカ(ボルト/ガスの金属トランジェント) → L2ボディ(爆圧。WaveShaperで圧) →
// L3クラック(超音速衝撃波) → L4テール(残響へ流す余韻)。プロファイル追加時は
// Record網羅でtscが漏れを検出する。サブ層(kind:'sub')は基音<=0.45+asym必須の規律。
export interface ShotLayerSpec {
  kind: 'mech' | 'body-noise' | 'body-tone' | 'sub' | 'crack' | 'tail';
  durationS: number;
  gain: number;
  // tone系(body-tone/sub)
  freq?: number;
  endFreq?: number;
  oscType?: OscillatorType;
  detuneRangeCents?: number;
  // noise系(mech/body-noise/crack/tail)
  filterHz?: number;
  filterType?: BiquadFilterType;
  q?: number;
  delayS?: number;
  attackS?: number;
  drive?: number;
  curve?: 'tanh' | 'asym';
  wet?: number;
  wetLong?: number;
  optional?: boolean; // 連射間引き/ノード予算超過時に落とす層
}

export interface ShotProfileSpec {
  layers: ShotLayerSpec[];
  duckDb: number; // 発砲時にBGM/環境音を沈める深さ
  duckHoldS: number;
}

export const SHOT_PROFILES: Record<SoundProfile, ShotProfileSpec> = {
  ar: {
    duckDb: -6,
    duckHoldS: 0.04,
    layers: [
      { kind: 'mech', durationS: 0.004, filterHz: 3400, filterType: 'bandpass', q: 10, gain: 0.3, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.09, filterHz: 1900, filterType: 'lowpass', gain: 0.5, drive: 6 },
      { kind: 'body-tone', durationS: 0.08, freq: 140, endFreq: 58, oscType: 'triangle', gain: 0.42, drive: 4, detuneRangeCents: 25 },
      { kind: 'crack', durationS: 0.02, filterHz: 1600, filterType: 'bandpass', q: 10, gain: 0.4, attackS: 0.001 },
      { kind: 'tail', durationS: 0.35, filterHz: 800, filterType: 'lowpass', gain: 0.2, delayS: 0.01, wet: 0.25, optional: true },
    ],
  },
  smg: {
    duckDb: -5,
    duckHoldS: 0.03,
    layers: [
      { kind: 'mech', durationS: 0.003, filterHz: 4200, filterType: 'bandpass', q: 10, gain: 0.26, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.055, filterHz: 2400, filterType: 'lowpass', gain: 0.42, drive: 5 },
      { kind: 'body-tone', durationS: 0.05, freq: 175, endFreq: 75, oscType: 'triangle', gain: 0.34, detuneRangeCents: 30 },
      { kind: 'tail', durationS: 0.22, filterHz: 900, filterType: 'lowpass', gain: 0.14, wet: 0.2, optional: true },
    ],
  },
  br: {
    duckDb: -6,
    duckHoldS: 0.04,
    layers: [
      { kind: 'mech', durationS: 0.004, filterHz: 3200, filterType: 'bandpass', q: 10, gain: 0.32, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.085, filterHz: 2000, filterType: 'lowpass', gain: 0.5, drive: 6 },
      { kind: 'body-tone', durationS: 0.075, freq: 150, endFreq: 62, oscType: 'triangle', gain: 0.42, detuneRangeCents: 25 },
      { kind: 'crack', durationS: 0.02, filterHz: 1500, filterType: 'bandpass', q: 9, gain: 0.42, attackS: 0.001 },
      { kind: 'tail', durationS: 0.4, filterHz: 800, filterType: 'lowpass', gain: 0.2, delayS: 0.01, wet: 0.28, optional: true },
    ],
  },
  lmg: {
    duckDb: -6,
    duckHoldS: 0.05,
    layers: [
      { kind: 'mech', durationS: 0.005, filterHz: 2900, filterType: 'bandpass', q: 8, gain: 0.32, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.11, filterHz: 1700, filterType: 'lowpass', gain: 0.56, drive: 8 },
      { kind: 'body-tone', durationS: 0.1, freq: 120, endFreq: 46, oscType: 'sawtooth', gain: 0.42, drive: 5, detuneRangeCents: 20 },
      { kind: 'crack', durationS: 0.022, filterHz: 1400, filterType: 'bandpass', q: 8, gain: 0.4, attackS: 0.001 },
      { kind: 'tail', durationS: 0.5, filterHz: 700, filterType: 'lowpass', gain: 0.24, delayS: 0.012, wet: 0.3, optional: true },
    ],
  },
  shotgun: {
    duckDb: -6,
    duckHoldS: 0.06,
    layers: [
      { kind: 'mech', durationS: 0.005, filterHz: 3000, filterType: 'bandpass', q: 6, gain: 0.34, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.16, filterHz: 1500, filterType: 'lowpass', gain: 0.6, drive: 8 },
      { kind: 'sub', durationS: 0.16, freq: 95, endFreq: 38, oscType: 'sine', gain: 0.45, drive: 6, curve: 'asym' },
      // 散弾スプレー: クラックの代わりに微小ノイズ3連(散らばる「バラッ」)
      { kind: 'crack', durationS: 0.015, filterHz: 2400, filterType: 'bandpass', q: 4, gain: 0.16, delayS: 0.012, optional: true },
      { kind: 'crack', durationS: 0.015, filterHz: 2800, filterType: 'bandpass', q: 4, gain: 0.13, delayS: 0.028, optional: true },
      { kind: 'tail', durationS: 0.55, filterHz: 650, filterType: 'lowpass', gain: 0.26, delayS: 0.015, wet: 0.3 },
    ],
  },
  pistol: {
    duckDb: -5,
    duckHoldS: 0.03,
    layers: [
      { kind: 'mech', durationS: 0.003, filterHz: 4200, filterType: 'bandpass', q: 12, gain: 0.3, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.06, filterHz: 2300, filterType: 'lowpass', gain: 0.4, drive: 5 },
      { kind: 'body-tone', durationS: 0.055, freq: 190, endFreq: 85, oscType: 'triangle', gain: 0.34, detuneRangeCents: 30 },
      { kind: 'tail', durationS: 0.25, filterHz: 900, filterType: 'lowpass', gain: 0.15, wet: 0.22, optional: true },
    ],
  },
  marksman: {
    duckDb: -6,
    duckHoldS: 0.05,
    layers: [
      { kind: 'mech', durationS: 0.004, filterHz: 3000, filterType: 'bandpass', q: 12, gain: 0.36, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.1, filterHz: 1600, filterType: 'lowpass', gain: 0.55, drive: 8 },
      { kind: 'body-tone', durationS: 0.1, freq: 125, endFreq: 50, oscType: 'triangle', gain: 0.45, drive: 5, detuneRangeCents: 20 },
      { kind: 'crack', durationS: 0.022, filterHz: 1450, filterType: 'bandpass', q: 10, gain: 0.5, attackS: 0.001 },
      { kind: 'tail', durationS: 0.55, filterHz: 700, filterType: 'lowpass', gain: 0.24, delayS: 0.012, wet: 0.3, optional: true },
    ],
  },
  // DSR: 「バン!」の衝撃。メカ→重ボディ+非対称歪みサブ→クラック→ロングテール(専用コンボルバ)
  dmr: {
    duckDb: -9,
    duckHoldS: 0.08,
    layers: [
      { kind: 'mech', durationS: 0.004, filterHz: 2800, filterType: 'bandpass', q: 14, gain: 0.5, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.16, filterHz: 1100, filterType: 'lowpass', gain: 0.72, drive: 10 },
      { kind: 'body-tone', durationS: 0.22, freq: 95, endFreq: 40, oscType: 'sine', gain: 0.7, drive: 6, curve: 'asym' },
      { kind: 'sub', durationS: 0.09, freq: 45, endFreq: 20, oscType: 'sine', gain: 0.45, drive: 5, curve: 'asym' },
      { kind: 'crack', durationS: 0.024, filterHz: 1200, filterType: 'bandpass', q: 12, gain: 0.58, attackS: 0.001 },
      { kind: 'tail', durationS: 0.9, filterHz: 550, filterType: 'lowpass', gain: 0.26, delayS: 0.015, wet: 0.3, wetLong: 0.5 },
    ],
  },
};

// 発砲プラン: 連射(前発<0.08s)の奇数発とノード予算超過時にoptional層を間引く。
// 乱数を持たない決定的関数(変奏はSoundKit側のjitterに限定)なのでテスト可能。
export function planShot(
  spec: ShotProfileSpec,
  rapid: boolean,
  evenShot: boolean,
  voiceCount: number,
): ShotLayerSpec[] {
  const dropOptional = (rapid && !evenShot) || voiceCount > 300;
  return dropOptional ? spec.layers.filter((l) => l.optional !== true) : spec.layers;
}

// ── 敵弾の統一距離モデル ────────────────────────────────────────────
// att: 緩い減衰+床0.15(遠距離でも索敵キューを残す) / airLpHz: 空気吸収 /
// arrivalDelayS: 音速遅延(距離感の主役) / wetMul: 遠いほど残響優勢
export function enemyShotParams(
  distance: number,
  occluded = false,
): { att: number; airLpHz: number; arrivalDelayS: number; wetMul: number } {
  const d = Math.max(0, distance);
  let att = Math.max(0.15, Math.pow(10 / Math.max(10, d), 0.8));
  let airLpHz = Math.max(300, 6500 * Math.exp(-0.03 * d));
  if (occluded) {
    airLpHz *= 0.35;
    att *= 0.6;
  }
  return {
    att,
    airLpHz,
    arrivalDelayS: Math.min(0.25, d * 0.0029),
    wetMul: Math.min(0.5 + d * 0.05, 2.5),
  };
}

// ── 低HPの聴覚演出(ローパス閾値)と動的BGM理論 ──────────────────────
export function healthCutoffHz(hpRatio: number): number {
  const r = Math.max(0, Math.min(1, hpRatio));
  return r >= 0.3 ? 20000 : 800 + Math.pow(r / 0.3, 1.6) * 19200;
}

// Dm–B♭–F–C進行(D2=73.42Hz基準、半音オフセット)。物悲しくも推進力のある王道
export const BGM_PROGRESSION: readonly (readonly number[])[] = [
  [0, 3, 7],
  [8, 12, 15],
  [3, 7, 10],
  [10, 14, 17],
];
export const BGM_ROOT_HZ = 73.42; // D2

export function bgmNoteHz(semitone: number, octave = 0): number {
  return BGM_ROOT_HZ * Math.pow(2, semitone / 12 + octave);
}

// combat-heatに応じた各レイヤーの音量(0..1)。パッドは常時、他はheat閾値で立ち上がる
export function layerGains(heat: number): {
  pad: number;
  bass: number;
  perc: number;
  hat: number;
  arp: number;
} {
  const c = (x: number): number => Math.max(0, Math.min(1, x));
  const h = c(heat);
  return {
    pad: 0.5 + 0.5 * h,
    bass: c((h - 0.15) / 0.2),
    perc: c((h - 0.3) / 0.2),
    hat: c((h - 0.5) / 0.2),
    arp: c((h - 0.55) / 0.2),
  };
}

// 音声アセットを一切持たず、Web Audio APIで全効果音を合成する。
// AudioContextはブラウザの自動再生制限のため最初の操作時に生成する。
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVol = 0.8;
  private sfxVol = 0.8;
  private uiVol = 0.6;

  // ── R9 ミキシングv2のノード群 ──
  private tinnitusDuck: GainNode | null = null; // 至近爆発の一時的な世界ダッキング
  private healthLp: BiquadFilterNode | null = null; // 瀕死時のこもり(SFXのみ)
  private duckBus: GainNode | null = null; // 発砲/爆発でBGMを沈めるサイドチェイン風
  private ambBus: GainNode | null = null; // アンビエンス(コンプ迂回)
  // リバーブ: 量子化wetバス3本 → convolverStage(ステージプリセット) と
  // longSend → convolverLong(DSR専用ロングテール) の2系統のみ(CPU上限)
  private wetLow: GainNode | null = null;
  private wetMid: GainNode | null = null;
  private wetHigh: GainNode | null = null;
  private reverbInput: GainNode | null = null;
  private convolverStage: ConvolverNode | null = null;
  private reverbLpf: BiquadFilterNode | null = null;
  private reverbReturn: GainNode | null = null;
  private longSend: GainNode | null = null;
  private convolverLong: ConvolverNode | null = null;
  private longReturn: GainNode | null = null;
  private wetMaster: GainNode | null = null;
  private irCache = new Map<ReverbPreset, AudioBuffer>();
  private presetWet = REVERB_PRESETS.outdoor.wet; // 未指定ボイスの自動ウェット量
  private currentPreset: ReverbPreset = 'outdoor';
  private lowSpec = false; // 低スペック省電力(ロングテール無効・短IR)

  // 発音台帳(時刻ベース。onended非依存でノード予算の縮退判定に使う)
  private voiceLog: number[] = [];
  // 変奏用の乱数(テストで注入可能)
  private rng: () => number = Math.random;
  private tanhCurve: Float32Array<ArrayBuffer> | null = null;
  private asymCurve: Float32Array<ArrayBuffer> | null = null;
  private lastShotS = 0; // 連射判定(0.08s)
  private shotParity = false; // 連射間引きの偶奇トグル
  private lastExplosionS = 0; // 爆発の0.08sスロットル
  private lastWhizzS = 0;
  private lastImpactS = 0;
  private tinnitusUntilS = 0;
  private duckRecoverTarget = 1; // 低HP時はBGM復帰を抑える
  private lastHealthCutoff = 20000;
  // 長尺ボイス(>0.5s)の登録簿。quiesce()で確実に止める(耳鳴り/フラッシュ等の鳴り残り防止)
  private longVoices = new Set<AudioScheduledSourceNode>();
  private surface: SurfaceSet = { floor: 'concrete', wall: 'concrete' };

  // ── アンビエンス ──
  private ambience: AmbienceEngine | null = null;
  private ambLoopBuffer: AudioBuffer | null = null;

  // 選定済みアナウンサー音声(端末ローカルの高品位声)。無ければ読み上げせずジングルへ
  private announcerVoice: SpeechSynthesisVoice | null = null;
  private voiceListenerBound = false;
  private speakTimer = 0; // 遅延読み上げのタイマ(quiesceで破棄)

  // ── 動的BGM(combat-heat連動のアダプティブ・レイヤー。音源ファイル不要) ──
  private bgmBus: GainNode | null = null;
  private combatHeat = 0; // 0(静)..1(交戦)
  private musicEnabled = true;
  private nextBeatTime = 0; // look-aheadスケジューラの次拍時刻(ctx基準)
  private beatIndex = 0;
  private bgmStopped = true; // stopBgm()の冪等ガード

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.voiceLog.length = 0;
      this.bindVoices();
      return;
    }
    this.ctx = new AudioContext();
    this.lowSpec =
      typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
    // マスター段: master(音量) → limiter(貼り付き防止のブリックウォール) → 出力。
    // リミッターがあるので各所のゲインは「潰れない範囲で大胆に」振れる
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    // 世界の音: sfxBus → tinnitusDuck(至近爆発の一時減衰) → healthLp(瀕死こもり)
    // → compressor(正準値・変更禁止) → master。UI音はこの経路を迂回して常に明瞭
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = COMPRESSOR_PARAMS.threshold;
    this.compressor.knee.value = COMPRESSOR_PARAMS.knee;
    this.compressor.ratio.value = COMPRESSOR_PARAMS.ratio;
    this.compressor.attack.value = COMPRESSOR_PARAMS.attack;
    this.compressor.release.value = COMPRESSOR_PARAMS.release;
    this.compressor.connect(this.master);
    this.healthLp = this.ctx.createBiquadFilter();
    this.healthLp.type = 'lowpass';
    this.healthLp.frequency.value = 20000;
    this.healthLp.Q.value = 0.5;
    this.healthLp.connect(this.compressor);
    this.tinnitusDuck = this.ctx.createGain();
    this.tinnitusDuck.gain.value = 1;
    this.tinnitusDuck.connect(this.healthLp);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.tinnitusDuck);
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = this.uiVol;
    this.uiBus.connect(this.master);
    // BGM: bgmBus → duckBus(発砲で沈むサイドチェイン風) → master
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = 1.25; // V9: SFX比-15dB程度の実効レベル(0.5では装飾未満だった)
    this.duckBus = this.ctx.createGain();
    this.duckBus.gain.value = 1;
    this.bgmBus.connect(this.duckBus);
    this.duckBus.connect(this.master);
    // アンビエンス: コンプを迂回(銃声で戦場の空気がポンピングしないように)
    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = 0.5 * this.sfxVol;
    this.ambBus.connect(this.master);

    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

    // ── リバーブ系(send/return)。量子化wetバス3本でper-voiceノード増ゼロ ──
    this.wetMaster = this.ctx.createGain();
    this.wetMaster.gain.value = this.sfxVol;
    this.wetMaster.connect(this.master); // コンプ迂回(テールのポンピング防止)
    this.reverbInput = this.ctx.createGain();
    this.reverbInput.gain.value = 1;
    this.wetLow = this.ctx.createGain();
    this.wetLow.gain.value = 0.1;
    this.wetMid = this.ctx.createGain();
    this.wetMid.gain.value = 0.3;
    this.wetHigh = this.ctx.createGain();
    this.wetHigh.gain.value = 0.6;
    this.wetLow.connect(this.reverbInput);
    this.wetMid.connect(this.reverbInput);
    this.wetHigh.connect(this.reverbInput);
    this.convolverStage = this.ctx.createConvolver();
    this.convolverStage.normalize = true; // buffer代入前に設定(クリップ防止)
    this.reverbLpf = this.ctx.createBiquadFilter();
    this.reverbLpf.type = 'lowpass';
    this.reverbLpf.frequency.value = 5200;
    this.reverbLpf.Q.value = 0.5;
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = REVERB_PRESETS.outdoor.ret;
    this.reverbInput.connect(this.convolverStage);
    this.convolverStage.connect(this.reverbLpf);
    this.reverbLpf.connect(this.reverbReturn);
    this.reverbReturn.connect(this.wetMaster);
    this.convolverStage.buffer = this.buildIr('outdoor');
    // DSR専用ロングテール(モノIR+片ch遅延でステレオ幅偽装)。低スペックでは省略
    if (!this.lowSpec) {
      this.longSend = this.ctx.createGain();
      this.longSend.gain.value = 0.5;
      this.convolverLong = this.ctx.createConvolver();
      this.convolverLong.normalize = true;
      const longLen = Math.floor(this.ctx.sampleRate * 1.8);
      const longBuf = this.ctx.createBuffer(1, longLen, this.ctx.sampleRate);
      const [longIr] = renderImpulse(this.ctx.sampleRate, 1.8, 1.4, 0.03, 0.22);
      longBuf.copyToChannel(longIr.subarray(0, longLen), 0);
      this.convolverLong.buffer = longBuf;
      const widthDelay = this.ctx.createDelay(0.05);
      widthDelay.delayTime.value = 0.012;
      const widthPanL = this.ctx.createStereoPanner();
      widthPanL.pan.value = -0.5;
      const widthPanR = this.ctx.createStereoPanner();
      widthPanR.pan.value = 0.5;
      this.longReturn = this.ctx.createGain();
      this.longReturn.gain.value = 0.7;
      this.longSend.connect(this.convolverLong);
      this.convolverLong.connect(widthPanL);
      this.convolverLong.connect(widthDelay);
      widthDelay.connect(widthPanR);
      widthPanL.connect(this.longReturn);
      widthPanR.connect(this.longReturn);
      this.longReturn.connect(this.wetMaster);
    }

    this.bindVoices();
  }

  // IR生成(プリセット毎に1回だけ。低スペックはcanyonを1.2sへ短縮)
  private buildIr(p: ReverbPreset): AudioBuffer {
    const cached = this.irCache.get(p);
    if (cached) return cached;
    const ctx = this.ctx!;
    const spec = REVERB_PRESETS[p];
    const dur = this.lowSpec && p === 'canyon' ? 1.2 : spec.durationS;
    const [l, r] = renderImpulse(ctx.sampleRate, dur, spec.t60, spec.preDelayS);
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    this.irCache.set(p, buf);
    return buf;
  }

  // ステージの空間プリセットを切り替える(試合開始時)。WebKitのbuffer差替グリッチを
  // 避けるため、returnを一瞬絞ってから差し替えて戻す
  setReverb(p: ReverbPreset): void {
    this.currentPreset = p;
    this.presetWet = REVERB_PRESETS[p].wet;
    if (!this.ctx || !this.convolverStage || !this.reverbReturn) return;
    const now = this.ctx.currentTime;
    const ret = this.reverbReturn.gain;
    ret.cancelScheduledValues(now);
    ret.setTargetAtTime(0.0001, now, 0.02);
    const target = REVERB_PRESETS[p].ret;
    setTimeout(() => {
      if (!this.ctx || !this.convolverStage || !this.reverbReturn) return;
      this.convolverStage.buffer = this.buildIr(p);
      const t = this.ctx.currentTime;
      this.reverbReturn.gain.cancelScheduledValues(t);
      this.reverbReturn.gain.setTargetAtTime(target, t, 0.05);
      // 雪原/屋内でスナイパーだけ数秒響く矛盾を防ぐ(ロングテールも空間に従う)
      if (this.longReturn) {
        this.longReturn.gain.setValueAtTime(
          p === 'dead' || p === 'indoor' ? 0.7 * 0.4 : 0.7,
          t,
        );
      }
    }, 60);
  }

  // 端末ローカルの高品位音声を選んでキャッシュする。Chromeは初回getVoices()が空のため
  // voiceschanged で再選定する(リスナは一度だけ登録)。クラウド声は静的制約で除外。
  private bindVoices(): void {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof synth.getVoices !== 'function') return;
    const pick = (): void => {
      const local = synth.getVoices().filter((v) => v.localService === true);
      const best = pickBestVoice(local);
      if (best) this.announcerVoice = best;
    };
    pick();
    if (!this.voiceListenerBound && typeof synth.addEventListener === 'function') {
      this.voiceListenerBound = true;
      synth.addEventListener('voiceschanged', pick);
    }
  }

  // アナウンサー発話の共通経路。良いローカル声が無ければ読み上げず(ロボット声を避ける)、
  // fallbackJingle 指定時のみ合成ジングルへ退避する。
  private speakAnnounce(
    label: string,
    vol: number,
    opts: { cancel?: boolean; delayMs?: number; emphasize?: boolean; fallbackJingle?: boolean } = {},
  ): void {
    const volume = Math.max(0, Math.min(1, vol));
    if (volume <= 0) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !this.announcerVoice) {
      if (opts.fallbackJingle) this.streakJingle(volume);
      return;
    }
    const u = new SpeechSynthesisUtterance(normalizeTts(label, opts.emphasize ?? false));
    u.lang = 'en-US';
    u.voice = this.announcerVoice;
    const { pitch, rate } = prosodyFor(label);
    u.pitch = pitch;
    u.rate = rate;
    u.volume = volume * this.masterVol;
    if (opts.cancel) synth.cancel();
    if (opts.delayMs) {
      const delay = opts.delayMs;
      this.speakTimer = window.setTimeout(() => synth.speak(u), delay);
    } else {
      synth.speak(u);
    }
  }

  // 音量設定は常に cancel+setValueAtTime(ダッキング等の自動化イベント残留で
  // スライダーが恒久破壊されるのを防ぐ規約)。ensure()前の呼び出しに備え全nullガード
  setVolumes(master: number, sfx: number, ui: number): void {
    this.masterVol = master;
    this.sfxVol = sfx;
    this.uiVol = ui;
    const now = this.ctx?.currentTime ?? 0;
    const setNow = (node: GainNode | null, v: number): void => {
      if (!node) return;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(v, now);
    };
    setNow(this.master, master);
    setNow(this.sfxBus, sfx);
    setNow(this.uiBus, ui);
    setNow(this.wetMaster, sfx);
    setNow(this.ambBus, 0.5 * sfx);
  }

  // 発音台帳: 現在鳴っている(+予約済みの)ボイス数。縮退梯子の判定に使う。
  // onendedに依存せず終了予定時刻で数える(コールバック喪失で恒久縮退しない)
  private liveVoices(): number {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    if (this.voiceLog.length > 0) this.voiceLog = this.voiceLog.filter((e) => e > now);
    return this.voiceLog.length;
  }

  // 変奏: v±(r*100)%のジッタ。毎発同一波形の「機械くささ」を消す要
  private jit(v: number, r: number): number {
    return v * (1 + (this.rng() - 0.5) * r);
  }

  // 発音の共通終端: (pan) → bus。sfxBus宛は量子化wetバスへも分岐(残響send)。
  // wet未指定=ステージ既定(自動ウェット)、wet:0=強制ドライ(近接ハンドリング音)
  private routeOut(
    tail: AudioNode,
    t0: number,
    durationS: number,
    opts: { pan?: number; bus?: GainNode; wet?: number; wetLong?: number },
    extras: AudioNode[],
  ): void {
    const ctx = this.ctx!;
    let out: AudioNode = tail;
    // pan=0/未指定はStereoPanner自体を省略(連射時のノード数を確実に削る)
    if (opts.pan !== undefined && opts.pan !== 0) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = opts.pan;
      out = tail.connect(pan);
      extras.push(pan); // onendedで確実に切断
    }
    const bus = opts.bus ?? this.sfxBus!;
    out.connect(bus);
    if (bus === this.sfxBus) {
      const wet = opts.wet ?? this.presetWet;
      if (wet > 0.001 && this.wetLow && this.wetMid && this.wetHigh) {
        out.connect(wet < 0.2 ? this.wetLow : wet < 0.45 ? this.wetMid : this.wetHigh);
      }
      if ((opts.wetLong ?? 0) > 0.001 && this.longSend) out.connect(this.longSend);
    }
    this.voiceLog.push(t0 + durationS + 0.05);
    if (this.voiceLog.length > 600) this.voiceLog.splice(0, 200); // 暴走時の保険
  }

  // エンベロープ: attackS指定時は 0.0001→(linear)peak→(exp)0.001 の3点式。
  // 未指定は従来同様の即時立ち上がり(既存呼び出しと等価)
  private applyEnv(gain: GainNode, peak: number, t0: number, durationS: number, attackS?: number): void {
    if (attackS && attackS > 0) {
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + attackS);
    } else {
      gain.gain.setValueAtTime(peak, t0);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationS);
  }

  // drive指定時のサチュレーション段: preGain(=drive) → WaveShaper(共有カーブ)。
  // カーブデータのみ共有しノードは毎回生成(共有ノードだと同時発音が相互変調する)
  private buildDrive(
    input: AudioNode,
    drive: number,
    curve: 'tanh' | 'asym',
    extras: AudioNode[],
  ): AudioNode {
    const ctx = this.ctx!;
    if (!this.tanhCurve) this.tanhCurve = makeTanhCurveData(3);
    if (!this.asymCurve) this.asymCurve = makeAsymCurveData();
    const pre = ctx.createGain();
    pre.gain.value = drive;
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve === 'asym' ? this.asymCurve : this.tanhCurve;
    shaper.oversample = 'none'; // 規約: CPU優先。折返しは低域中心の用途で実害なし
    input.connect(pre);
    pre.connect(shaper);
    extras.push(pre, shaper); // onendedで確実に切断する(ゾンビノード防止)
    return shaper;
  }

  private noiseBurst(opts: {
    durationS: number;
    filterHz: number;
    filterType: BiquadFilterType;
    gain: number;
    pan?: number;
    delayS?: number;
    bus?: GainNode;
    q?: number;
    attackS?: number;
    filterEndHz?: number; // フィルタ中心のスイープ(whizz等)
    drive?: number;
    curve?: 'tanh' | 'asym';
    playbackJitter?: number; // 再生レートの±ジッタ(短いメカ/クラック層限定)
    wet?: number;
    wetLong?: number;
  }): void {
    if (!this.ctx || !this.noiseBuffer || !this.sfxBus) return;
    const t0 = this.ctx.currentTime + (opts.delayS ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    if (opts.playbackJitter) src.playbackRate.value = 1 + (this.rng() - 0.5) * opts.playbackJitter;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.filterHz, t0);
    if (opts.filterEndHz) {
      filter.frequency.exponentialRampToValueAtTime(opts.filterEndHz, t0 + opts.durationS);
    }
    if (opts.q !== undefined) filter.Q.value = opts.q;
    const gain = this.ctx.createGain();
    this.applyEnv(gain, opts.gain, t0, opts.durationS, opts.attackS);
    src.connect(filter);
    const extras: AudioNode[] = [];
    let tail: AudioNode = filter;
    if (opts.drive) tail = this.buildDrive(filter, opts.drive, opts.curve ?? 'tanh', extras);
    tail.connect(gain);
    this.routeOut(gain, t0, opts.durationS, opts, extras);
    // 開始オフセットをランダム化: 同じノイズ波形の繰り返し感を無料で消す
    src.start(t0, this.rng() * 0.9);
    src.stop(t0 + opts.durationS + 0.05);
    if (opts.durationS > 0.5) this.longVoices.add(src);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
        for (const n of extras) n.disconnect();
      } catch {
        /* already disconnected */
      } finally {
        this.longVoices.delete(src);
        src.onended = null; // クロージャ解放
      }
    };
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
    attackS?: number;
    detuneCents?: number;
    drive?: number;
    curve?: 'tanh' | 'asym';
    wet?: number;
    wetLong?: number;
  }): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.ctx.currentTime + (opts.delayS ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.durationS);
    if (opts.detuneCents) osc.detune.value = opts.detuneCents;
    const gain = this.ctx.createGain();
    this.applyEnv(gain, opts.gain, t0, opts.durationS, opts.attackS);
    const extras: AudioNode[] = [];
    let tail: AudioNode = osc;
    if (opts.drive) tail = this.buildDrive(osc, opts.drive, opts.curve ?? 'tanh', extras);
    tail.connect(gain);
    this.routeOut(gain, t0, opts.durationS, opts, extras);
    osc.start(t0);
    osc.stop(t0 + opts.durationS + 0.05);
    if (opts.durationS > 0.5) this.longVoices.add(osc);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
        for (const n of extras) n.disconnect();
      } catch {
        /* already disconnected */
      } finally {
        this.longVoices.delete(osc);
        osc.onended = null;
      }
    };
  }

  // サイドチェイン風ダッキング: 発砲/爆発の瞬間だけBGMを沈め、SFXの抜けを作る。
  // 自動化はduckBus専用(音量設定と構造的に直交)。復帰目標は低HP時のみ下がる
  private duck(db: number, holdS = 0.04): void {
    if (!this.ctx || !this.duckBus) return;
    const g = this.duckBus.gain;
    const now = this.ctx.currentTime;
    const cur = Math.min(g.value, 1);
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur, now);
    g.linearRampToValueAtTime(dbToGain(db), now + 0.012);
    g.setTargetAtTime(this.duckRecoverTarget, now + 0.012 + holdS, 0.1);
  }

  // 武器クラスごとの発砲音(SHOT_PROFILESデータ駆動の4層+毎発変奏)。
  // 連射時は奇数発でoptional層を間引き、ノード予算を守る
  shot(profile: SoundProfile = 'ar'): void {
    const spec = SHOT_PROFILES[profile];
    const now = this.ctx?.currentTime ?? 0;
    const rapid = now - this.lastShotS < 0.08;
    this.lastShotS = now;
    this.shotParity = !this.shotParity;
    const layers = planShot(spec, rapid, this.shotParity, this.liveVoices());
    for (const l of layers) this.playShotLayer(l);
    this.duck(spec.duckDb, spec.duckHoldS);
  }

  // 1層の再生: 仕様値に±ジッタを乗せ「毎発同じ音」を消す。
  // メカ/クラックの超短層のみplaybackJitterで質感も揺らす
  private playShotLayer(l: ShotLayerSpec): void {
    const delay = (l.delayS ?? 0) + this.rng() * 0.003;
    const drive = l.drive !== undefined ? this.jit(l.drive, 0.25) : undefined;
    if (l.kind === 'body-tone' || l.kind === 'sub') {
      this.tone({
        freq: this.jit(l.freq ?? 100, 0.12),
        endFreq: l.endFreq,
        durationS: this.jit(l.durationS, 0.07),
        type: l.oscType ?? 'triangle',
        gain: this.jit(l.gain, 0.1),
        delayS: delay,
        attackS: l.attackS,
        drive,
        curve: l.curve,
        detuneCents: l.detuneRangeCents ? (this.rng() * 2 - 1) * l.detuneRangeCents : undefined,
        wet: l.wet,
        wetLong: l.wetLong,
      });
    } else {
      this.noiseBurst({
        durationS: this.jit(l.durationS, 0.07),
        filterHz: this.jit(l.filterHz ?? 1500, 0.12),
        filterType: l.filterType ?? 'lowpass',
        q: l.q !== undefined ? this.jit(l.q, 0.2) : undefined,
        gain: this.jit(l.gain, 0.1),
        delayS: delay,
        attackS: l.attackS,
        drive,
        curve: l.curve,
        playbackJitter: l.durationS < 0.05 ? 0.15 : undefined,
        wet: l.wet,
        wetLong: l.wetLong,
      });
    }
  }

  // サプレッサー装着時: くぐもった4層ミニチュア(残響へもほぼ送らない=隠密)
  shotSuppressed(): void {
    this.noiseBurst({ durationS: 0.02, filterHz: 3600, filterType: 'bandpass', q: 8, gain: 0.22, attackS: 0.001, wet: 0.06 });
    this.noiseBurst({ durationS: 0.06, filterHz: 750, filterType: 'lowpass', gain: 0.3, wet: 0.06 });
    this.tone({ freq: 100, endFreq: 45, durationS: 0.06, type: 'sine', gain: 0.26, wet: 0.06 });
    this.duck(-3, 0.02);
  }

  // 距離と方向を持つ他者の発砲音。統一距離モデル: 緩い減衰(床0.15=索敵キュー保持)
  // +空気吸収LPF+音速到達遅延+距離連動の残響比+壁遮蔽のこもり
  enemyShot(pan: number, distance: number, occluded = false): void {
    const p = enemyShotParams(distance, occluded);
    const wet = Math.min(0.85, Math.max(this.presetWet * 0.5, this.presetWet * p.wetMul));
    // 最近接数体はフル3層、混雑時はボディ+トーンの2層へ縮退
    const full = this.liveVoices() < 250;
    if (full) {
      this.noiseBurst({
        durationS: 0.02,
        filterHz: Math.min(1500, p.airLpHz),
        filterType: 'bandpass',
        q: 8,
        gain: 0.5 * p.att,
        pan,
        delayS: p.arrivalDelayS,
        attackS: 0.001,
        wet,
      });
    }
    this.noiseBurst({
      durationS: 0.12,
      filterHz: p.airLpHz,
      filterType: 'lowpass',
      gain: 0.45 * p.att,
      pan,
      delayS: p.arrivalDelayS,
      drive: 5,
      wet,
    });
    this.tone({
      freq: 110,
      endFreq: 50,
      durationS: 0.1,
      type: 'triangle',
      gain: 0.32 * p.att,
      pan,
      delayS: p.arrivalDelayS,
      detuneCents: (this.rng() * 2 - 1) * 40,
      wet,
    });
  }

  // 弾のwhizz: 頭部至近を通過した弾のドップラー風下降スイープ(0.07sスロットル)
  bulletWhizz(pan: number, closeness: number): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastWhizzS < 0.07 || this.liveVoices() > 240) return;
    this.lastWhizzS = now;
    const c = Math.max(0, Math.min(1, closeness));
    this.noiseBurst({
      durationS: 0.11,
      filterHz: 5200,
      filterEndHz: 1400,
      filterType: 'bandpass',
      q: 2.5,
      gain: 0.1 + 0.16 * c,
      pan,
      attackS: 0.004,
      wet: 0,
    });
    this.tone({
      freq: 900,
      endFreq: 280,
      durationS: 0.08,
      type: 'sine',
      gain: 0.05 * c,
      pan,
      detuneCents: (this.rng() * 2 - 1) * 60,
      wet: 0,
    });
  }

  // 着弾の材質音(0.03sスロットル=ショットガン10ペレット対策)。45m超は省略
  setSurfaceMaterial(set: SurfaceSet): void {
    this.surface = set;
  }

  impactSurface(kind: 'floor' | 'wall', pan: number, distance: number): void {
    const now = this.ctx?.currentTime ?? 0;
    if (distance > 45 || now - this.lastImpactS < 0.03 || this.liveVoices() > 220) return;
    this.lastImpactS = now;
    const att = 1 / (1 + distance * 0.09);
    const mat: SurfaceMaterial = kind === 'floor' ? this.surface.floor : this.surface.wall;
    switch (mat) {
      case 'metal':
        // 非整数倍の2音リング=金属の共鳴
        this.tone({ freq: this.jit(1250, 0.1), durationS: 0.09, type: 'sine', gain: 0.14 * att, pan, attackS: 0.001 });
        this.tone({ freq: this.jit(1870, 0.1), durationS: 0.07, type: 'sine', gain: 0.1 * att, pan, delayS: 0.004 });
        this.noiseBurst({ durationS: 0.012, filterHz: 3000, filterType: 'highpass', gain: 0.12 * att, pan, attackS: 0.001 });
        break;
      case 'sand':
      case 'dirt':
        this.noiseBurst({ durationS: this.jit(0.05, 0.1), filterHz: this.jit(700, 0.1), filterType: 'lowpass', gain: 0.2 * att, pan });
        break;
      case 'snow':
        this.noiseBurst({ durationS: 0.06, filterHz: this.jit(1200, 0.1), filterType: 'bandpass', q: 0.8, gain: 0.16 * att, pan });
        break;
      case 'grass':
      case 'wood':
        this.tone({ freq: this.jit(480, 0.1), endFreq: 220, durationS: 0.04, type: 'triangle', gain: 0.13 * att, pan });
        this.noiseBurst({ durationS: 0.03, filterHz: 1600, filterType: 'bandpass', gain: 0.1 * att, pan });
        break;
      case 'concrete':
        this.noiseBurst({ durationS: this.jit(0.03, 0.15), filterHz: this.jit(2200, 0.12), filterType: 'bandpass', q: 2, gain: 0.16 * att, pan, attackS: 0.001 });
        this.tone({ freq: 320, endFreq: 180, durationS: 0.035, type: 'triangle', gain: 0.1 * att, pan });
        break;
      default: {
        const _exhaustive: never = mat;
        return _exhaustive;
      }
    }
  }

  // ヒット確認: squareの「ピコッ」をやめ、正弦+極短クリックの「タッ」へ(BO2系の質感)
  hit(pitch = 1): void {
    // V9: 発砲4層(コンプのメイクアップ込み)にマスクされない音量へ。クリック(3.8kHz)を
    // 主役にしてボディ/クラック帯域(<=1.9kHz)のマスキングを回避する
    this.tone({
      freq: 950 * pitch,
      durationS: 0.045,
      type: 'sine',
      gain: 0.45,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
    this.noiseBurst({
      durationS: 0.01,
      filterHz: 3800,
      filterType: 'bandpass',
      q: 6,
      gain: 0.34,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
  }

  // ヘッドショット: C7+G7の非調和ペア+高域クリック+低い確認thump(「カキンッ」)
  headshot(): void {
    this.tone({ freq: 2093, durationS: 0.05, type: 'sine', gain: 0.5, attackS: 0.001, bus: this.uiBus ?? undefined });
    this.tone({ freq: 3136, durationS: 0.07, type: 'sine', gain: 0.4, delayS: 0.02, bus: this.uiBus ?? undefined });
    this.noiseBurst({ durationS: 0.01, filterHz: 6000, filterType: 'highpass', gain: 0.3, attackS: 0.001, bus: this.uiBus ?? undefined });
    this.tone({ freq: 240, endFreq: 120, durationS: 0.06, type: 'sine', gain: 0.35, delayS: 0.01, bus: this.uiBus ?? undefined });
  }

  // キル確認: 既存2音+サブthump+きらめきで「重い確定感」
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
    this.tone({ freq: 160, endFreq: 55, durationS: 0.12, type: 'sine', gain: 0.22, bus: this.uiBus ?? undefined });
    this.noiseBurst({ durationS: 0.04, filterHz: 7000, filterType: 'highpass', gain: 0.08, delayS: 0.05, bus: this.uiBus ?? undefined });
  }

  // 連続キルのアナウンサー音声。音声ファイルを持たずSpeechSynthesisで読み上げる。
  // 非対応・無音設定時は合成トーンのジングルにフォールバックする。volは0..1の設定値。
  announceStreak(label: string, vol: number): void {
    // 良い声があれば人間ライクに読み上げ、無ければ上昇ジングルへ退避する
    this.speakAnnounce(label, vol, { cancel: true, emphasize: true, fallbackJingle: true });
  }

  // アナウンサー音声が使えない時の上昇ジングル(長三度の3音チェーン)
  private streakJingle(vol: number): void {
    const freqs = [1000, 1250, 1562];
    for (let i = 0; i < freqs.length; i += 1) {
      this.tone({
        freq: freqs[i]!,
        durationS: 0.1,
        type: 'sine',
        gain: 0.18 * vol,
        delayS: i * 0.08,
        bus: this.uiBus ?? undefined,
      });
    }
  }

  // ── 動的BGM ──
  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) this.stopBgm();
  }

  setCombatHeat(v: number): void {
    this.combatHeat = Math.max(0, Math.min(1, v));
    // アンビエンスは交戦中に自動で沈む(エンジン側に差分ガードあり)
    this.ambience?.setHeat(this.combatHeat);
  }

  // 試合終了/離脱時に拍カウンタをリセット(再開時のノード洪水を防ぐ)。冪等
  stopBgm(): void {
    if (this.bgmStopped) return;
    this.bgmStopped = true;
    this.nextBeatTime = 0;
    this.beatIndex = 0;
    if (this.ctx && this.bgmBus && this.duckBus) {
      const now = this.ctx.currentTime;
      // パッドの鳴り残りを畳み、ダッキング残留もリセット
      this.bgmBus.gain.setTargetAtTime(0.0001, now, 0.05);
      this.duckBus.gain.cancelScheduledValues(now);
      this.duckBus.gain.setValueAtTime(1, now);
    }
  }

  // 描画フレームごとに呼ぶ look-ahead スケジューラ(BGM v2)。
  // Dm–B♭–F–C進行の上に pad/bass/perc/hat/arp が combat-heat で積み上がる
  tickBgm(): void {
    if (!this.ctx || !this.bgmBus || !this.musicEnabled) return;
    const now = this.ctx.currentTime;
    if (this.bgmStopped) {
      // 再開: ミュートを解く
      this.bgmStopped = false;
      this.bgmBus.gain.cancelScheduledValues(now);
      this.bgmBus.gain.setTargetAtTime(1.25, now, 0.05);
    }
    // 初回/取り残し時は現在時刻へ寄せ直す(過去拍の取り戻しによるノード洪水を防ぐ)
    if (this.nextBeatTime === 0 || this.nextBeatTime < now) this.nextBeatTime = now + 0.1;
    const bpm = 82 + this.combatHeat * 58; // 82(静)→140(交戦)
    const beatDur = 60 / bpm;
    const g = layerGains(this.combatHeat);
    let made = 0;
    while (this.nextBeatTime < now + 0.2 && made < 8) {
      const delay = this.nextBeatTime - now;
      const beatInBar = this.beatIndex % 4;
      const bar = Math.floor(this.beatIndex / 4) % BGM_PROGRESSION.length;
      const chord = BGM_PROGRESSION[bar]!;
      // キック(全拍・percレイヤー)
      if (g.perc > 0.01) {
        this.tone({ freq: 58, endFreq: 30, durationS: 0.12, type: 'sine', gain: 0.085 * g.perc, delayS: delay, bus: this.bgmBus });
      }
      // スネア(2・4拍)
      if ((beatInBar === 1 || beatInBar === 3) && g.perc > 0.01) {
        this.noiseBurst({ durationS: 0.05, filterHz: 1800, filterType: 'bandpass', q: 4, gain: 0.2 * g.perc, delayS: delay, bus: this.bgmBus });
        this.noiseBurst({ durationS: 0.012, filterHz: 3000, filterType: 'highpass', gain: 0.08 * g.perc, delayS: delay, attackS: 0.001, bus: this.bgmBus });
      }
      // ハット(8分×2)
      if (g.hat > 0.01) {
        this.noiseBurst({ durationS: 0.02, filterHz: 6500, filterType: 'highpass', gain: 0.018 * g.hat, delayS: delay, bus: this.bgmBus });
        this.noiseBurst({ durationS: 0.016, filterHz: 6500, filterType: 'highpass', gain: 0.012 * g.hat, delayS: delay + beatDur / 2, bus: this.bgmBus });
      }
      // ベース(1・3拍にルート)
      if ((beatInBar === 0 || beatInBar === 2) && g.bass > 0.01) {
        this.tone({ freq: bgmNoteHz(chord[0]!), durationS: beatDur * 0.9, type: 'triangle', gain: 0.055 * g.bass, delayS: delay, bus: this.bgmBus });
      }
      // アルペジオ(8分でコードトーン巡回)
      if (g.arp > 0.01) {
        for (let k = 0; k < 2; k += 1) {
          const idx = (this.beatIndex * 2 + k) % 3;
          this.tone({ freq: bgmNoteHz(chord[idx]!, 2), durationS: 0.09, type: 'triangle', gain: 0.03 * g.arp, delayS: delay + (k * beatDur) / 2, bus: this.bgmBus });
        }
      }
      // パッド(小節頭で3和音×2osc、ゆっくり立ち上がる)
      if (beatInBar === 0) {
        this.padVoice(chord, beatDur * 4, g.pad, delay);
      }
      this.nextBeatTime += beatDur;
      this.beatIndex += 1;
      made += 1;
    }
  }

  // パッド: コード3音×デチューン2oscを共有LPへ通し、0.4sで立ち上げ小節末で解放。
  // heatが上がるとLPが開いて明るくなる(戦闘の高揚)
  private padVoice(chord: readonly number[], barDurS: number, padGain: number, delayS: number): void {
    if (!this.ctx || !this.bgmBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delayS;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + this.combatHeat * 1400;
    lp.Q.value = 0.4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.016 * padGain, t0 + 0.4);
    env.gain.setTargetAtTime(0.0001, t0 + barDurS - 0.15, 0.27);
    lp.connect(env);
    env.connect(this.bgmBus);
    const oscs: OscillatorNode[] = [];
    for (const semi of chord) {
      for (const det of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = bgmNoteHz(semi, 1);
        osc.detune.value = det;
        osc.connect(lp);
        osc.start(t0);
        osc.stop(t0 + barDurS + 0.6);
        oscs.push(osc);
      }
    }
    this.voiceLog.push(t0 + barDurS + 0.65);
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        try {
          for (const o of oscs) o.disconnect();
          lp.disconnect();
          env.disconnect();
        } catch {
          /* already disconnected */
        } finally {
          last.onended = null;
        }
      };
    }
  }

  // メダル取得スティング(WebAudioのみ・synth.cancelを呼ばないので announceStreak と共存する)。
  // level 1..4(bronze/silver/gold/platinum)でピッチ段数が増え、4は低音の余韻を重ねる。
  announceMedal(level: number, vol: number): void {
    const volume = Math.max(0, Math.min(1, vol));
    if (volume <= 0) return;
    const ladders: Record<number, number[]> = {
      1: [660, 880],
      2: [660, 880, 1047],
      3: [660, 880, 1047, 1319],
      4: [660, 880, 1047, 1319],
    };
    const seq = ladders[level] ?? ladders[2]!;
    for (let i = 0; i < seq.length; i += 1) {
      this.tone({
        freq: seq[i]!,
        durationS: 0.07,
        type: 'sine',
        gain: 0.4 * volume,
        delayS: i * 0.075,
        bus: this.uiBus ?? undefined,
      });
    }
    if (level >= 4) {
      this.tone({
        freq: 90,
        endFreq: 60,
        durationS: 0.6,
        type: 'sine',
        gain: 0.35 * volume,
        delayS: 0.05,
        bus: this.uiBus ?? undefined,
      });
    }
  }

  // メダル初解放のファンファーレ(上昇4音)+ 名称読み上げ。読み上げは cancel せずキューに積む。
  announceUnlock(name: string, vol: number): void {
    const volume = Math.max(0, Math.min(1, vol));
    if (volume <= 0) return;
    const fanfare = [523, 659, 784, 1047];
    for (let i = 0; i < fanfare.length; i += 1) {
      this.tone({
        freq: fanfare[i]!,
        durationS: 0.12,
        type: 'triangle',
        gain: 0.32 * volume,
        delayS: i * 0.09,
        bus: this.uiBus ?? undefined,
      });
    }
    // 名称読み上げは cancel せずキューへ。良いローカル声が無ければファンファーレのみ。
    this.speakAnnounce(name, volume, { cancel: false, delayMs: 360 });
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

  // ボルトアクションの2段操作音(発砲直後に呼ぶ)。ラック(後退)→閉鎖(前進)の「ガチャン」
  bolt(): void {
    // ラック: ボルトを引く金属のこすれ + 高めのクリック(+200ms)
    this.noiseBurst({
      durationS: 0.06,
      filterHz: 2600,
      filterType: 'bandpass',
      gain: 0.16,
      delayS: 0.2,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 1500,
      durationS: 0.03,
      type: 'square',
      gain: 0.07,
      delayS: 0.2,
      bus: this.uiBus ?? undefined,
    });
    // 閉鎖: 薬室にかみ合う重いクランク(+500ms)
    this.noiseBurst({
      durationS: 0.05,
      filterHz: 1200,
      filterType: 'lowpass',
      gain: 0.2,
      delayS: 0.5,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 360,
      endFreq: 180,
      durationS: 0.05,
      type: 'triangle',
      gain: 0.1,
      delayS: 0.5,
      bus: this.uiBus ?? undefined,
    });
  }

  // スコープ中の非キル胴ヒット専用マーカー音(高く澄んだ「キンッ」)
  scopeBodyHit(): void {
    this.tone({
      freq: 2200,
      endFreq: 2600,
      durationS: 0.06,
      type: 'square',
      gain: 0.4, // V9: DSR轟音にマスクされない音量へ
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

  // 素手: パンチの空振り(短い風切り)
  punchWhoosh(): void {
    this.noiseBurst({
      durationS: 0.06,
      filterHz: 900,
      filterType: 'bandpass',
      gain: 0.18,
      bus: this.sfxBus ?? undefined,
    });
  }

  // 素手: パンチ命中。step(1..3)で重くなる(3段目は低音の芯を足す)
  punchHit(step: number): void {
    this.tone({
      freq: 340 - step * 40,
      endFreq: 160,
      durationS: 0.07,
      type: 'triangle',
      gain: 0.3,
      bus: this.sfxBus ?? undefined,
    });
    if (step >= 3) {
      this.tone({ freq: 120, endFreq: 55, durationS: 0.14, type: 'sine', gain: 0.4 });
    }
  }

  // 素手: ダイブスラム着地の衝撃波(サブベース+土煙ノイズ)
  groundPound(): void {
    this.tone({ freq: 55, endFreq: 22, durationS: 0.5, type: 'sine', gain: 0.6 });
    this.noiseBurst({ durationS: 0.3, filterHz: 320, filterType: 'lowpass', gain: 0.55 });
    this.noiseBurst({
      durationS: 0.08,
      filterHz: 2200,
      filterType: 'bandpass',
      gain: 0.25,
      bus: this.uiBus ?? undefined,
    });
  }

  // スコープを目に押し当てる瞬間のスナップ音(scope-in 85%)。BO2 DSRの接眼の所作
  lensSnap(): void {
    this.noiseBurst({
      durationS: 0.03,
      filterHz: 3800,
      filterType: 'bandpass',
      gain: 0.2,
      bus: this.uiBus ?? undefined,
    });
    this.tone({
      freq: 240,
      endFreq: 110,
      durationS: 0.07,
      type: 'sine',
      gain: 0.18,
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

  // 瀕死の心音v2: 実際の心音に近いlub-dub(強い低い一拍+弱く高い二拍目)。
  // UIバス経由=瀕死こもり(healthLp)を迂回して「体内の音」として常に明瞭
  heartbeat(): void {
    this.tone({ freq: 62, endFreq: 38, durationS: 0.14, type: 'sine', gain: 0.45, drive: 5, curve: 'asym', bus: this.uiBus ?? undefined });
    this.tone({ freq: 130, endFreq: 80, durationS: 0.1, type: 'sine', gain: 0.15, bus: this.uiBus ?? undefined });
    this.tone({ freq: 92, endFreq: 55, durationS: 0.09, type: 'sine', gain: 0.28, delayS: 0.22, bus: this.uiBus ?? undefined });
  }

  // 低HPの聴覚演出: SFXをこもらせ(healthLp)、残響も同時に暗くし、BGM復帰目標を
  // 下げて心音の空間を空ける。差分ガードで通常時はイベントを発行しない
  setHealthState(hpRatio: number): void {
    const cutoff = healthCutoffHz(hpRatio);
    if (Math.abs(cutoff - this.lastHealthCutoff) < 1) return;
    this.lastHealthCutoff = cutoff;
    const prevTarget = this.duckRecoverTarget;
    this.duckRecoverTarget = hpRatio < 0.25 ? Math.min(1, 0.63 + hpRatio * 1.5) : 1;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.healthLp?.frequency.setTargetAtTime(cutoff, now, 0.08);
    this.reverbLpf?.frequency.setTargetAtTime(Math.min(5200, cutoff), now, 0.08);
    // 回復したら沈めていたBGMも戻す(直近発砲のダッキングとは競合させない)
    if (this.duckRecoverTarget > prevTarget && this.duckBus && now > this.lastShotS + 0.5) {
      this.duckBus.gain.setTargetAtTime(this.duckRecoverTarget, now, 0.3);
    }
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

  // 爆発v2: 体+サブ(非対称歪みで小型スピーカーにも芯)+クラック+デブリ散布+テール。
  // 0.08s内の連続爆発は簡易版(同時爆発はマスキングされるので品質損なし)
  explosion(pan: number, distance: number): void {
    const att = 1 / (1 + distance * 0.04);
    const now = this.ctx?.currentTime ?? 0;
    const simple = now - this.lastExplosionS < 0.08;
    this.lastExplosionS = now;
    const p = enemyShotParams(distance);
    // L1 体
    this.noiseBurst({
      durationS: 0.5,
      filterHz: Math.min(700, p.airLpHz),
      filterType: 'lowpass',
      gain: 0.85 * att,
      pan,
      drive: 6,
    });
    // L2 サブ(基音は0.45上限+asym歪みで倍音を作る規律)+120Hz補助+90Hz帯ノイズ
    this.tone({ freq: 60, endFreq: 24, durationS: 0.6, type: 'sine', gain: 0.45 * att, pan, drive: 5, curve: 'asym' });
    this.tone({ freq: 120, endFreq: 60, durationS: 0.5, type: 'sine', gain: 0.3 * att, pan });
    if (simple) return;
    this.noiseBurst({ durationS: 0.2, filterHz: 90, filterType: 'bandpass', q: 1.2, gain: 0.25 * att, pan });
    // L3 クラック(近距離のみ=空気の「バリッ」)
    if (distance < 40) {
      this.noiseBurst({ durationS: 0.025, filterHz: 2500, filterType: 'highpass', gain: 0.5 * att, pan, attackS: 0.001 });
    }
    // L4 デブリ散布(近いほど多く、パンを散らす)
    const debris = distance < 25 ? 6 : 3;
    for (let i = 0; i < debris; i += 1) {
      this.noiseBurst({
        durationS: 0.03 + this.rng() * 0.03,
        filterHz: this.jit(900 + this.rng() * 1700, 0.1),
        filterType: 'bandpass',
        q: 3,
        gain: (0.11 - 0.012 * i) * att,
        pan: Math.max(-1, Math.min(1, pan + (this.rng() - 0.5) * 0.7)),
        delayS: 0.12 + 0.09 * i + this.rng() * 0.07,
      });
    }
    // L5 テール(残響へ多めに送って戦場の「跡」を残す)
    this.noiseBurst({
      durationS: 0.7,
      filterHz: 240,
      filterType: 'lowpass',
      gain: 0.4 * att,
      pan,
      delayS: 0.08,
      wet: Math.min(0.85, this.presetWet * p.wetMul),
    });
    this.duck(-9, 0.08);
  }

  // 至近爆発の耳鳴り(tinnitus)。専用duckノードに掛けるので音量設定と競合しない
  tinnitus(strength: number): void {
    if (!this.ctx || !this.tinnitusDuck) return;
    const now = this.ctx.currentTime;
    if (now < this.tinnitusUntilS) return; // 二重発火ガード
    const s = Math.max(0, Math.min(1, strength));
    const dur = 1.2 + 1.6 * s;
    this.tinnitusUntilS = now + dur * 0.6;
    // リング音+ハイの残滓(UIバス=こもりを迂回して「耳の中」で鳴る)
    this.tone({ freq: 3600, durationS: dur, type: 'sine', gain: 0.1 + 0.1 * s, bus: this.uiBus ?? undefined });
    this.noiseBurst({ durationS: 0.12, filterHz: 5500, filterType: 'highpass', gain: 0.25 * s, bus: this.uiBus ?? undefined });
    // 世界の音を一瞬遠ざけ、0.4s後から回復
    const g = this.tinnitusDuck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.min(g.value, 1), now);
    g.setTargetAtTime(0.25, now, 0.05);
    g.setTargetAtTime(1.0, now + 0.4, 0.35);
    // 残響だけ大きく残る破綻を防ぐ(wetMasterにも同じ息継ぎ)
    if (this.wetMaster) {
      const w = this.wetMaster.gain;
      w.cancelScheduledValues(now);
      w.setValueAtTime(Math.min(w.value, this.sfxVol), now);
      w.setTargetAtTime(this.sfxVol * 0.25, now, 0.05);
      w.setTargetAtTime(this.sfxVol, now + 0.4, 0.35);
    }
    // 環境音も同じ息継ぎ(世界が遠のくのに風だけ素通しの破綻を防ぐ)
    if (this.ambBus) {
      const a = this.ambBus.gain;
      const base = 0.5 * this.sfxVol;
      a.cancelScheduledValues(now);
      a.setValueAtTime(Math.min(a.value, base), now);
      a.setTargetAtTime(base * 0.25, now, 0.05);
      a.setTargetAtTime(base, now + 0.4, 0.35);
    }
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

  // 足音v2: 材質(ステージパレット由来)×ヒール・トゥの2打。歩行の「コツ、コ」が
  // 出ると空間の実在感が跳ねる。intensity>=0.8は着地系(単打+低域増厚)として分岐
  footstep(intensity: number, landing = false): void {
    // V9修正: 着地は暗黙のintensity閾値でなく明示引数(スプリント歩行=1が着地音に化けていた)
    const mat = this.surface.floor;
    // ヒール(かかと): 低い芯
    this.tone({
      freq: this.jit(82, 0.15),
      endFreq: 48,
      durationS: landing ? 0.07 : 0.045,
      type: 'sine',
      gain: (landing ? 0.3 : 0.2) * intensity,
      attackS: 0.002,
      wet: 0,
    });
    this.footstepTexture(mat, intensity, 0, 1);
    if (landing) {
      // 着地: 低域を厚く(ドスッ)
      this.noiseBurst({ durationS: 0.09, filterHz: 260, filterType: 'lowpass', gain: 0.22 * intensity, wet: 0 });
      return;
    }
    // トゥ(つま先): 少し遅れて軽く
    const toeDelay = 0.05 + this.rng() * 0.02;
    this.footstepTexture(mat, intensity * 0.55, toeDelay, 1.3);
  }

  // 材質ごとの足音テクスチャ1打分
  private footstepTexture(mat: SurfaceMaterial, intensity: number, delayS: number, hzMul: number): void {
    switch (mat) {
      case 'metal':
        this.noiseBurst({ durationS: 0.04, filterHz: this.jit(1900 * hzMul, 0.12), filterType: 'bandpass', q: 3, gain: 0.12 * intensity, delayS, wet: 0 });
        this.tone({ freq: this.jit(620 * hzMul, 0.1), durationS: 0.05, type: 'sine', gain: 0.06 * intensity, delayS, wet: 0 });
        break;
      case 'snow':
        // 圧雪の「キュッ」: 短いBPを2粒
        this.noiseBurst({ durationS: 0.035, filterHz: this.jit(1200 * hzMul, 0.15), filterType: 'bandpass', q: 0.8, gain: 0.14 * intensity, delayS, wet: 0 });
        this.noiseBurst({ durationS: 0.02, filterHz: this.jit(1500 * hzMul, 0.15), filterType: 'bandpass', q: 1, gain: 0.08 * intensity, delayS: delayS + 0.015, wet: 0 });
        break;
      case 'grass':
      case 'dirt':
        this.noiseBurst({ durationS: 0.05, filterHz: this.jit(520 * hzMul, 0.15), filterType: 'lowpass', gain: 0.16 * intensity, delayS, wet: 0 });
        break;
      case 'sand':
        this.noiseBurst({ durationS: 0.06, filterHz: this.jit(650 * hzMul, 0.15), filterType: 'lowpass', gain: 0.15 * intensity, delayS, wet: 0 });
        break;
      case 'wood':
        this.tone({ freq: this.jit(240 * hzMul, 0.12), endFreq: 140, durationS: 0.04, type: 'triangle', gain: 0.1 * intensity, delayS, wet: 0 });
        this.noiseBurst({ durationS: 0.03, filterHz: this.jit(900 * hzMul, 0.12), filterType: 'bandpass', gain: 0.08 * intensity, delayS, wet: 0 });
        break;
      case 'concrete':
        this.noiseBurst({ durationS: 0.03, filterHz: this.jit(1400 * hzMul, 0.12), filterType: 'bandpass', q: 1.5, gain: 0.12 * intensity, delayS, attackS: 0.001, wet: 0 });
        break;
      default: {
        const _exhaustive: never = mat;
        return _exhaustive;
      }
    }
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

  // ── アンビエンス(プロシージャル環境音)のファサード ──────────────────
  // 4秒のブラウンノイズ・シームレスループを1回だけ生成してエンジンへ渡す
  startAmbience(stage: { palette: StagePalette; size: number; obstacleCount: number }): void {
    if (!this.ctx || !this.ambBus) return;
    if (!this.ambLoopBuffer) {
      const sr = this.ctx.sampleRate;
      this.ambLoopBuffer = this.ctx.createBuffer(1, sr * 4, sr);
      const data = this.ambLoopBuffer.getChannelData(0);
      fillBrownNoise(data);
      makeSeamlessLoop(data, Math.floor(sr * 0.1));
    }
    if (!this.ambience) {
      this.ambience = new AmbienceEngine(this.ctx, this.ambBus, this.ambLoopBuffer);
    }
    this.ambience.start(deriveAmbientProfile(stage.palette, stage.size, stage.obstacleCount));
  }

  stopAmbience(): void {
    // ポーズ放置後のstaleなエンジン時計を現在へ進めてからフェード開始する
    if (this.ctx && this.ambience) this.ambience.tick(this.ctx.currentTime);
    this.ambience?.stop();
  }

  tickAmbience(): void {
    if (this.ctx && this.ambience) this.ambience.tick(this.ctx.currentTime);
  }

  pauseAmbience(paused: boolean): void {
    if (paused && this.ctx && this.ambience) this.ambience.tick(this.ctx.currentTime);
    this.ambience?.setPaused(paused);
  }

  // quit/試合遷移の後始末を単一路に集約。メニュー往復でオーディオ状態を完全初期化する
  quiesce(): void {
    this.stopBgm();
    this.stopAmbience();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      // dmrロングテール/パッドのメニュー漏れ防止(300ms後に設定値へ復帰)
      for (const node of [this.reverbReturn, this.longReturn]) {
        node?.gain.setTargetAtTime(0.0001, now, 0.05);
      }
      setTimeout(() => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        if (this.reverbReturn) {
          this.reverbReturn.gain.cancelScheduledValues(t);
          this.reverbReturn.gain.setValueAtTime(REVERB_PRESETS[this.currentPreset].ret, t);
        }
        if (this.longReturn) {
          this.longReturn.gain.cancelScheduledValues(t);
          this.longReturn.gain.setValueAtTime(
            this.currentPreset === 'dead' || this.currentPreset === 'indoor' ? 0.7 * 0.4 : 0.7,
            t,
          );
        }
      }, 300);
      if (this.tinnitusDuck) {
        this.tinnitusDuck.gain.cancelScheduledValues(now);
        this.tinnitusDuck.gain.setValueAtTime(1, now);
      }
      if (this.wetMaster) {
        this.wetMaster.gain.cancelScheduledValues(now);
        this.wetMaster.gain.setValueAtTime(this.sfxVol, now);
      }
      this.healthLp?.frequency.setValueAtTime(20000, now);
      // 瀕死こもりの残響側も必ず復元(差分ガードが次回の復元を弾くため、ここが唯一の機会)
      if (this.reverbLpf) {
        this.reverbLpf.frequency.cancelScheduledValues(now);
        this.reverbLpf.frequency.setValueAtTime(5200, now);
      }
    }
    // 長尺ボイス(耳鳴り/フラッシュリング等)を止め、読み上げも破棄する
    for (const v of this.longVoices) {
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
    }
    this.longVoices.clear();
    if (this.speakTimer) {
      clearTimeout(this.speakTimer);
      this.speakTimer = 0;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    this.tinnitusUntilS = 0;
    this.lastHealthCutoff = 20000;
    this.duckRecoverTarget = 1;
    this.voiceLog.length = 0;
  }
}
