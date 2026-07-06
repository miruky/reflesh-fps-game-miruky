import type { SoundProfile } from '../game/weapons';
import type { MoodId, StagePalette } from '../game/stage';
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
  // DSR/スナイパー: 「ドゥーン!」の重厚な衝撃。R14でさらに重量化 —
  // 重ボディ2層(基音+深いブーム)+非対称歪みサブ(深度UP)+鋭いクラック→巨大ロングテール。
  // ※sub層はgain<=0.45規律(小型スピーカー保護)を守り、重さはbody-tone/tailで稼ぐ。
  dmr: {
    duckDb: -11, // より深くダック=一撃の存在感を増す
    duckHoldS: 0.1,
    layers: [
      { kind: 'mech', durationS: 0.004, filterHz: 2800, filterType: 'bandpass', q: 14, gain: 0.54, attackS: 0.001 },
      { kind: 'body-noise', durationS: 0.2, filterHz: 1050, filterType: 'lowpass', gain: 0.8, drive: 12 },
      { kind: 'body-tone', durationS: 0.3, freq: 95, endFreq: 38, oscType: 'sine', gain: 0.82, drive: 8, curve: 'asym' },
      // 追加: 更に低い基音のブーム(谷を転がる重い余韻。subでなくbody-toneなので厚みを出せる)
      { kind: 'body-tone', durationS: 0.36, freq: 60, endFreq: 24, oscType: 'sine', gain: 0.6, drive: 6, curve: 'asym', detuneRangeCents: 12 },
      { kind: 'sub', durationS: 0.14, freq: 40, endFreq: 16, oscType: 'sine', gain: 0.45, drive: 6, curve: 'asym' },
      { kind: 'crack', durationS: 0.026, filterHz: 1200, filterType: 'bandpass', q: 13, gain: 0.68, attackS: 0.001 },
      { kind: 'tail', durationS: 1.35, filterHz: 520, filterType: 'lowpass', gain: 0.36, delayS: 0.015, wet: 0.36, wetLong: 0.66 },
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

// 第3引数 rootHz でムード毎の調(基準周波数)を切替。既存の2引数呼び出しは D2 基準で無影響。
export function bgmNoteHz(semitone: number, octave = 0, rootHz = BGM_ROOT_HZ): number {
  return rootHz * Math.pow(2, semitone / 12 + octave);
}

// combat-heatに応じた各レイヤーの音量(0..1)。
// R16: 「ヒーリング脱却」の抜本改訂。heat=0 で既に“完成された駆動トラック”が鳴り、
// heat は密度/攻撃性のみを増やす設計へ。
//  - pad は 0.18 起点の薄いベッドに更に降格(主張させない)。
//  - bass/perc は 0.55 起点で heat=0 から芯のあるグルーヴ。
//  - hat/arp は起点を上げて早く立つ(0.4/0.5 起点)=探索中も推進力。
//  - sub は新設の sub-drone 層のスケール(0.55→1.0 単調)。低heatから軍事的な地響き。
//  - lead は歪みリードの全体指標(閾値を h-0.6/0.2 → h-0.3/0.25 へ前倒し)。実際の
//    立ち上がり heat は profile.leadStartHeat が個別に決める(tickBgm 参照)。
export function layerGains(heat: number): {
  pad: number;
  bass: number;
  perc: number;
  hat: number;
  arp: number;
  sub: number;
  lead: number;
} {
  const c = (x: number): number => Math.max(0, Math.min(1, x));
  const h = c(heat);
  return {
    pad: 0.18 + 0.28 * h, // ベッド(更に降格)。0.18→0.46
    bass: 0.55 + 0.45 * h, // 駆動ベースは常時。0.55→1.0
    perc: 0.55 + 0.45 * h, // 3層パンチキック/スネアも常時。0.55→1.0
    hat: c(0.4 + h * 0.6), // 早く立つ。0.4→1.0
    arp: c(0.5 + h * 0.5), // クールな旋律のアルペジオを常時。0.5→1.0
    sub: 0.55 + 0.45 * h, // sub-drone 層。0.55→1.0(単調)
    lead: c((h - 0.3) / 0.25), // 歪みリード指標(heat>0.3で立ち上がり、0.55で満杯)
  };
}

// ═══════════════════════════════════════════════════════════════════
// ステージ/ムード別 BGM プロファイル(BO3系の軍事エレクトロニカ)。
// 「移調だけ」に潰れないよう {rootHz, padType, arpType, bpm帯} を各ムードで違えて
// 音色/リズムで識別させる。全キー(MoodId + 'night-neon')網羅で tsc が漏れを検出する。
// ═══════════════════════════════════════════════════════════════════
export type BgmProfileKey = MoodId | 'night-neon' | 'zombie';

export interface BgmProfile {
  progression: readonly (readonly number[])[]; // rootからの半音オフセット3和音×4小節
  rootHz: number;
  bpmBase: number; // 静(heat=0)のBPM
  bpmRange: number; // 交戦(heat=1)で bpmBase+bpmRange まで加速
  padType: OscillatorType;
  bassType: OscillatorType;
  arpType: OscillatorType;
  leadType: OscillatorType;
  leadDrive: number; // 0=リード無効。>0で歪みリード層を高heat時に鳴らす
  hatBrightHz: number; // ハイハットのHPF中心(明るさ)
  padWet: number; // パッド→リバーブ手動sendの量(0=無し、≤0.09)
  halfTimeKickBelowHeat?: number; // この heat 未満で kick を half-time(beatInBar===0のみ)化
  sparse?: boolean; // snow: kick/hat/arpを半減し half-time の冷たい間合いに
  bassMode?: 'root' | 'drive'; // drive=chord[0]の8分連打(低heatからグルーヴを出す)
  lpQ?: number; // パッドLPのレゾナンス(ムード音色識別)
  // ── R16 攻撃的音色設計(ヒーリング脱却) ──
  kickDrive: number; // 3層パンチキックのボディ tanh 飽和量(パンチの芯)
  subMode: 'drone' | 'off'; // 'drone'=oct0 saw×2→LPF→tanh の sub-drone 層を鳴らす
  subDrive: number; // sub-drone の tanh 歪み量(倍音を生み小型スピーカーでも地響きを知覚)
  leadStartHeat: number; // 歪みリードが立ち上がり始める heat(profile 個別の攻撃性)
  riserEnabled: boolean; // 戦況/ラウンドの高揚エッジでライザーを鳴らすか
  snareSnap: number; // スネア上の超高域トランジェント量(0=無し..1=鋭い)
}

// 進行(rootからの半音オフセット)。ムード毎に和声色を変え、移調のみの反復を避ける。
const PROG_DAY: readonly (readonly number[])[] = [
  [0, 4, 7], // I(長三和音の明るい持ち上げ)
  [5, 9, 12], // IV
  [7, 11, 14], // V
  [2, 5, 9], // ii → 解決感
];
const PROG_NIGHT: readonly (readonly number[])[] = [
  [0, 3, 7], // i
  [10, 13, 17], // ♭VII
  [5, 8, 12], // iv
  [7, 10, 14], // v
];
const PROG_OVERCAST: readonly (readonly number[])[] = [
  [0, 3, 7], // i(灰色の停滞)
  [5, 8, 12], // iv
  [0, 3, 7], // i
  [8, 12, 15], // VI
];
const PROG_SNOW: readonly (readonly number[])[] = [
  [0, 7, 12], // 開離した5度+オクターブ=冷たい空白
  [3, 10, 15],
  [5, 12, 17],
  [7, 14, 19],
];
const PROG_NEON: readonly (readonly number[])[] = [
  [0, 3, 7], // i(催眠的に反復するネオンのドライブ)
  [0, 3, 7], // i
  [8, 11, 15], // VI
  [10, 13, 17], // VII
];
// ゾンビ: 半音クラスタ(0,1)と三全音(6)を含む不協和で不穏さを作る。解決させず、
// heat上昇でグルーヴ/リードが露出しても和声は終始「病んだ」ままにする。
const PROG_ZOMBIE: readonly (readonly number[])[] = [
  [0, 1, 6], // 短2度クラスタ + 増4度(悪魔の音程)
  [11, 0, 5], // 半音でぶつける
  [8, 11, 3], // 増和音めいた宙吊り
  [7, 10, 2], // 沈み込む(解決しない)
];

export const BGM_PROFILES: Record<BgmProfileKey, BgmProfile> = {
  // 昼: 明るい長調リフト(E2)でも sub-drone とパンチキックで「爽やか止まり」を回避。
  day: {
    progression: PROG_DAY,
    rootHz: 82.41, // E2
    bpmBase: 84,
    bpmRange: 52,
    padType: 'sawtooth',
    bassType: 'triangle',
    arpType: 'square',
    leadType: 'square',
    leadDrive: 0.8,
    hatBrightHz: 7000,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 0.8,
    kickDrive: 2.6,
    subMode: 'drone',
    subDrive: 1.8,
    leadStartHeat: 0.35,
    riserEnabled: true,
    snareSnap: 0.55,
  },
  // 夕: 物悲しい進行(D2)でも駆動ベース+sub-droneで推進力を持たせ、湿っぽさを断つ。
  dusk: {
    progression: BGM_PROGRESSION,
    rootHz: 73.42, // D2
    bpmBase: 78,
    bpmRange: 54,
    padType: 'sawtooth',
    bassType: 'triangle',
    arpType: 'sine',
    leadType: 'sawtooth',
    leadDrive: 1.1,
    hatBrightHz: 6400,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 1.0,
    kickDrive: 2.4,
    subMode: 'drone',
    subDrive: 1.9,
    leadStartHeat: 0.35,
    riserEnabled: true,
    snareSnap: 0.45,
  },
  // 夜: 緊迫。C2の暗い進行+drive bass(8分連打)+square arp+歪みリードで攻撃的。
  night: {
    progression: PROG_NIGHT,
    rootHz: 65.41, // C2
    bpmBase: 94,
    bpmRange: 50,
    padType: 'sawtooth',
    bassType: 'sawtooth',
    arpType: 'square',
    leadType: 'sawtooth',
    leadDrive: 1.4,
    hatBrightHz: 8200,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 1.7,
    kickDrive: 3.2,
    subMode: 'drone',
    subDrive: 2.4,
    leadStartHeat: 0.28,
    riserEnabled: true,
    snareSnap: 0.7,
  },
  // 曇: 沈鬱(B1)だが sawパッド+sub-drone+高heatリードで「暗く重い推進」へ尖らせる。
  overcast: {
    progression: PROG_OVERCAST,
    rootHz: 61.74, // B1
    bpmBase: 78,
    bpmRange: 48,
    padType: 'sawtooth',
    bassType: 'sawtooth',
    arpType: 'triangle',
    leadType: 'sawtooth',
    leadDrive: 0.9,
    hatBrightHz: 5200,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 0.6,
    kickDrive: 2.8,
    subMode: 'drone',
    subDrive: 2.1,
    leadStartHeat: 0.42,
    riserEnabled: true,
    snareSnap: 0.5,
  },
  // 雪: 疎(G2・開離和音・half-time)の冷たい個性は保つが、パンチキックと鋭いスネアで
  // 「治癒」感を断つ。sub-drone は空白を埋めないよう off にして austere な間合いを守る。
  snow: {
    progression: PROG_SNOW,
    rootHz: 98.0, // G2
    bpmBase: 68,
    bpmRange: 42,
    padType: 'triangle',
    bassType: 'sine',
    arpType: 'triangle',
    leadType: 'sawtooth',
    leadDrive: 0.7,
    hatBrightHz: 9000,
    padWet: 0.09,
    sparse: true,
    bassMode: 'drive',
    lpQ: 0.6,
    kickDrive: 2.2,
    subMode: 'off',
    subDrive: 1.5,
    leadStartHeat: 0.4,
    riserEnabled: false,
    snareSnap: 0.35,
  },
  // 夜市(ネオン): 最も攻撃的。A1の深い基準+反復進行+drive bass+高leadDrive+高hat。
  'night-neon': {
    progression: PROG_NEON,
    rootHz: 55.0, // A1
    bpmBase: 100,
    bpmRange: 54,
    padType: 'sawtooth',
    bassType: 'sawtooth',
    arpType: 'sawtooth',
    leadType: 'sawtooth',
    leadDrive: 1.7,
    hatBrightHz: 9500,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 2.1,
    kickDrive: 3.6,
    subMode: 'drone',
    subDrive: 2.6,
    leadStartHeat: 0.24,
    riserEnabled: true,
    snareSnap: 0.85,
  },
  // ゾンビ: 地を這う超低音(46.25Hz)の sub-drone を土台に、半音クラスタの不穏なベッド。
  // heat(=ラウンド進行)が上がるほど groove が露出→ホラー→高揚(早いリード+ライザー)。
  zombie: {
    progression: PROG_ZOMBIE,
    rootHz: 46.25, // ≈F#1: 不穏な地響き
    bpmBase: 64, // 低heatは重く遅い間合い
    bpmRange: 44, // 64→108(ラウンド進行で加速)
    padType: 'sawtooth',
    bassType: 'sawtooth',
    arpType: 'square',
    leadType: 'sawtooth',
    leadDrive: 2.4,
    hatBrightHz: 5800,
    padWet: 0.09,
    bassMode: 'drive',
    lpQ: 1.8,
    kickDrive: 3.8,
    subMode: 'drone',
    subDrive: 2.6,
    leadStartHeat: 0.15, // 早い段階から歪みリードで高揚へ
    riserEnabled: true,
    snareSnap: 0.75,
    halfTimeKickBelowHeat: 0.2, // A4-F17: heat<0.2は1拍目のみキック(half-time)
  },
};

// 音声アセットを一切持たず、Web Audio APIで全効果音を合成する。
// AudioContextはブラウザの自動再生制限のため最初の操作時に生成する。
// ── R33 Sランク武器サウンドスペック(純データ・テスト可能) ──────────────────
// 弓の発射音: 弦の解放ブリオン(hi-pass)+矢の風切り(sweep down)の2層構成。
export const BOW_RELEASE_SPEC = {
  stringSlapHz: 2400,      // 弦が前腕を弾く高域成分(hi-pass)
  slapGain: 0.28,
  slapDurationS: 0.032,
  windStartHz: 4800,       // 矢が空気を切り裂く風切り開始Hz
  windEndHz: 900,          // sweep先の低域(遠ざかり感)
  windGain: 0.18,
  windDurationS: 0.14,
} as const;

// 扇の風切り音: 水平スイング時の広域ホワイトノイズ帯域sweep。
export const FAN_WHOOSH_SPEC = {
  startHz: 1200,            // sweep開始(高)
  endHz: 380,               // sweep先(低)
  gain: 0.34,
  durationS: 0.22,
  filterType: 'bandpass' as BiquadFilterType,
  q: 0.7,
} as const;

// ミニガンスピン音: スピンアップ(up=true)とスピンダウン(up=false)の2フェーズ。
// toneはsawtooth低域ドローン。noiseBurstは機械ブレード風ハイパスノイズ。
export const MINIGUN_SPIN_SPEC = {
  droneStartHz: 55,         // スピンアップ開始Hz
  droneEndHz: 220,          // スピンアップ最高Hz
  droneDownStartHz: 220,    // スピンダウン開始Hz
  droneDownEndHz: 30,       // スピンダウン終了Hz
  droneDurationS: 0.9,
  bladeHz: 3600,
  bladeGain: 0.18,
  bladeDurationS: 0.8,
  droneGain: 0.38,
} as const;

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
  private lastDarkSlashS = 0; // 黒帝斬撃波の連打スロットル(~0.06s)
  private _lastLightningStrikeS = 0; // 雷帝AoEの連打スロットル(~0.1s)
  private _lightningHumOsc: OscillatorNode | null = null;
  private _lightningHumGain: GainNode | null = null;
  private lastEnemyFootstepS = 0; // 敵足音の全体スロットル(~0.03s)
  private lastBulletCrackS = 0;   // bulletCrack スロットル(0.05s)
  private lastSuppressionS = 0;   // suppressionWhoosh スロットル(0.15s)
  private distantBattleActive = false;
  private distantBattleTimer = 0; // scheduleDistantBoom の setTimeout ハンドル
  private _kokuraiThunderActive = false; // 黒雷帝遠雷アンビエンスの動作フラグ
  private _kokuraiThunderTimer = 0;      // scheduleKokuraiThunder の setTimeout ハンドル
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
  private bgmComp: DynamicsCompressorNode | null = null; // BGM専用グルーコンプ(duckBus前)
  private readonly bgmBusGain = 1.4; // V16: SFXの-8〜-10dB下に定位する実効レベル(専用コンプで纏める)
  private combatHeat = 0; // 0(静)..1(交戦)
  private musicEnabled = true;
  private nextBeatTime = 0; // look-aheadスケジューラの次拍時刻(ctx基準)
  private beatIndex = 0;
  private bgmStopped = true; // stopBgm()の冪等ガード
  private prevHeat = 0; // ライザーのエッジ検出用(tick末で1回だけ更新)
  private lastRiserS = 0; // ライザーのクールダウン(連発防止)
  private profileKey: BgmProfileKey = 'day'; // 現在のステージ/ムード別プロファイル
  private profile: BgmProfile = BGM_PROFILES.day;

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
    // BGM: bgmBus → bgmComp(専用グルーコンプ) → duckBus(発砲で沈むサイドチェイン風) → master。
    // 専用コンプは共有マスターリミッターの手前で BGM のピークだけを纏め、銃声トランジェントを
    // マスターで潰さない(SFXの抜けを保ちつつ、BGMを一段大きく前へ出す)。
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = this.bgmBusGain;
    this.bgmComp = this.ctx.createDynamicsCompressor();
    this.bgmComp.threshold.value = -12;
    this.bgmComp.knee.value = 6;
    this.bgmComp.ratio.value = 4;
    this.bgmComp.attack.value = 0.005;
    this.bgmComp.release.value = 0.14;
    this.duckBus = this.ctx.createGain();
    this.duckBus.gain.value = 1;
    this.bgmBus.connect(this.bgmComp);
    this.bgmComp.connect(this.duckBus);
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
      // R14: 前の予約を必ず解除してから上書き(360ms以内の連続アンロックで孤児タイマが
      // quiesce後に発火し、メニューでアンロック名を喋る事故を防ぐ)
      if (this.speakTimer) clearTimeout(this.speakTimer);
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

  // BF5式弾クラック: 敵弾がプレイヤー至近(~1.5m)を通過した時のクラック/スナップ音。
  // bulletWhizz(ドップラー「ヒューン」)と役割を分け、こちらは超音速衝撃波の「バンッ/スナップ」を担当。
  // L1: 鋭い高域トランジェント(2-6kHz bandpass, ~15ms) — closeness高→帯域を絞りピーキーに。
  // L2: 低域プレッシャーバースト(~80-120Hz lowpass, ~12ms) — 弾道衝撃波の空気圧縮。
  // スロットル0.05s + ボイス予算ガード。wet:0(至近音=残響なし)。
  bulletCrack(pan: number, closeness01: number): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastBulletCrackS < 0.05 || this.liveVoices() > 240) return;
    this.lastBulletCrackS = now;
    const c = Math.max(0, Math.min(1, closeness01));
    // L1: 高域クラック/スナップ(closeness高→中心Hzを上げ帯域を絞って鋭さを増す)
    this.noiseBurst({
      durationS: 0.015,
      filterHz: 2000 + c * 4000,
      filterType: 'bandpass',
      q: 3 + c * 4,
      gain: 0.25 + c * 0.40,
      pan,
      attackS: 0.0008,
      wet: 0,
    });
    // L2: 低域プレッシャー(超短・控えめ)
    this.noiseBurst({
      durationS: 0.012,
      filterHz: 80 + c * 40,
      filterType: 'lowpass',
      gain: 0.08 + c * 0.12,
      pan,
      attackS: 0.001,
      wet: 0,
    });
  }

  // 制圧射撃(近弾連続時)の圧迫音: こもった風圧(lowpassノイズのうねり)。短く控えめ。
  // スロットル0.15s + ボイス予算ガード。wet:0(体感音=残響なし)。
  suppressionWhoosh(intensity01: number): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastSuppressionS < 0.15 || this.liveVoices() > 230) return;
    this.lastSuppressionS = now;
    const i = Math.max(0, Math.min(1, intensity01));
    // こもった低域ノイズのうねり(圧力の風感)
    this.noiseBurst({
      durationS: 0.28 + i * 0.12,
      filterHz: 180 + i * 140,
      filterType: 'lowpass',
      gain: 0.11 + i * 0.09,
      attackS: 0.025,
      wet: 0,
    });
    // 低域トーンの圧力感(衝撃波の輪郭)
    this.tone({
      freq: 70 + i * 30,
      endFreq: 55,
      durationS: 0.22 + i * 0.08,
      type: 'sine',
      gain: 0.05 + i * 0.06,
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

  // ヒット確認: BO2スタイルの乾いた"tic"。
  // square の倍音成分が銃声ボディ帯域(≤1.9kHz)を抜けてuiBusコンプ後も残る。
  // 1200→400Hz の急降下がホチキス由来の「押しつぶし」トランジェント感を作る(~60ms)。
  hit(pitch = 1): void {
    this.tone({
      freq: 1200 * pitch,
      endFreq: 400 * pitch,
      durationS: 0.060,
      type: 'square',
      gain: 0.28,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
    // 4.8kHz エアクリック(uiBus・ドライ): 戦場騒音を切り裂くトランジェントの芯
    this.noiseBurst({
      durationS: 0.008,
      filterHz: 4800,
      filterType: 'bandpass',
      q: 8,
      gain: 0.22,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
  }

  // ヘッドショット: 高い"ping"(1800Hz開始)+ 倍音リング + 低い確認thump。
  // hit()の square tic と明確に聴き分けられるよう sine/高周波スタートで「澄んだリング」感。
  headshot(): void {
    this.tone({ freq: 1800, endFreq: 900, durationS: 0.07, type: 'sine', gain: 0.55, attackS: 0.001, bus: this.uiBus ?? undefined });
    this.tone({ freq: 2700, durationS: 0.05, type: 'sine', gain: 0.3, delayS: 0.022, bus: this.uiBus ?? undefined });
    this.noiseBurst({ durationS: 0.008, filterHz: 6500, filterType: 'highpass', gain: 0.28, attackS: 0.001, bus: this.uiBus ?? undefined });
    this.tone({ freq: 240, endFreq: 120, durationS: 0.06, type: 'sine', gain: 0.35, delayS: 0.01, bus: this.uiBus ?? undefined });
  }

  // キル確認: BO2スタイル — 低いトーン(~220Hzベル) + 上昇スイープ(~80ms)。
  // hit()の高tic・headshot()の高pingと明確に異なる「低→リフト」の確定感。
  kill(pitch = 1): void {
    // 低いベル(220Hz降下100ms): 「重い確定」の骨格
    this.tone({
      freq: 220 * pitch,
      endFreq: 110 * pitch,
      durationS: 0.10,
      type: 'sine',
      gain: 0.44,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
    // 上昇スイープ(440→1320Hz, 80ms, delay25ms): 「確定リフト」
    this.tone({
      freq: 440 * pitch,
      endFreq: 1320 * pitch,
      durationS: 0.08,
      type: 'sine',
      gain: 0.30,
      delayS: 0.025,
      attackS: 0.001,
      bus: this.uiBus ?? undefined,
    });
    // 極短エアトランジェント(uiBus・ドライ)
    this.noiseBurst({ durationS: 0.012, filterHz: 5500, filterType: 'highpass', gain: 0.12, delayS: 0.04, attackS: 0.001, bus: this.uiBus ?? undefined });
  }

  // Valorant式連続キルピッチラダー: tier(0-4)で半音ずつ(2^(tier/12))ピッチが上昇。
  // tier>=5はエースの和音ファンファーレ(aceChord)へフォールバック。kill()後方互換。
  killPitchTier(tier: number): void {
    const t = Math.max(0, Math.min(5, Math.floor(tier)));
    if (t >= 5) {
      this.aceChord();
      return;
    }
    // 半音等比スケール: tier0→1.000, 1→1.059, 2→1.122, 3→1.189, 4→1.260
    this.kill(Math.pow(2, t / 12));
  }

  // エース(5キル連続)のC5-E5-G5-C6 上昇アルペジオファンファーレ
  private aceChord(): void {
    const freqs = [523, 659, 784, 1047]; // C5-E5-G5-C6
    for (let i = 0; i < freqs.length; i += 1) {
      this.tone({
        freq: freqs[i]!,
        durationS: 0.20 - i * 0.02,
        type: 'sine',
        gain: 0.38 - i * 0.05,
        delayS: i * 0.055,
        attackS: 0.001,
        bus: this.uiBus ?? undefined,
      });
    }
    // 低音サポート C3→E3(確定感の骨格)
    this.tone({
      freq: 130.81,
      endFreq: 164.81,
      durationS: 0.35,
      type: 'sine',
      gain: 0.30,
      attackS: 0.002,
      bus: this.uiBus ?? undefined,
    });
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

  // 5/10/15/20/25キルストリーク到達時の短いスティンガー和音。
  // level 1→5 で段階的に豪華になる(音数・持続・装飾が増える)。
  // 既存 announceStreak(TTS) と非衝突(uiBus経由・cancel呼ばず)。
  streakStinger(level: number): void {
    const lv = Math.max(1, Math.min(5, Math.floor(level)));
    const vol = 0.22 + lv * 0.04;
    // A5-C#6-E6-A6 の上昇アルペジオ(段階的に音数を増やす)
    const seqs: number[][] = [
      [880, 1109],                    // lv1: 2音
      [880, 1109, 1319],              // lv2: 3音
      [880, 1109, 1319, 1760],        // lv3: 4音(A6でオクターブ到達)
      [659, 880, 1109, 1319, 1760],   // lv4: 5音(E5 先頭追加)
      [659, 880, 1109, 1319, 1760],   // lv5: 同音列 + ファンファーレ装飾
    ];
    const seq = seqs[lv - 1]!;
    const durPerNote = 0.07 + lv * 0.014;
    for (let i = 0; i < seq.length; i += 1) {
      this.tone({
        freq: seq[i]!,
        durationS: durPerNote,
        type: 'sine',
        gain: vol * (1 - i * 0.08),
        delayS: i * 0.048,
        attackS: 0.001,
        bus: this.uiBus ?? undefined,
      });
    }
    // lv3+: 低音の支えで厚み(A2→E3)
    if (lv >= 3) {
      this.tone({
        freq: 220,
        endFreq: 330,
        durationS: 0.20 + lv * 0.04,
        type: 'sine',
        gain: 0.16 + lv * 0.02,
        attackS: 0.003,
        bus: this.uiBus ?? undefined,
      });
    }
    // lv5: ノイズシマー + 低音リリース(フルファンファーレ)
    if (lv >= 5) {
      this.noiseBurst({
        durationS: 0.30,
        filterHz: 6500,
        filterType: 'highpass',
        gain: 0.13,
        attackS: 0.012,
        bus: this.uiBus ?? undefined,
      });
      this.tone({
        freq: 110,
        endFreq: 138.59,
        durationS: 0.50,
        type: 'sine',
        gain: 0.28,
        delayS: 0.12,
        bus: this.uiBus ?? undefined,
      });
    }
  }

  // ── 動的BGM ──
  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) this.stopBgm();
  }

  // ステージ/ムード別のBGMプロファイルへ切替(試合開始時に main から配線)。
  // 同一キーは早期return。再生中に変わった場合のみ stopBgm() で拍/鳴り残しを畳み、
  // 次の tickBgm で新プロファイルのイントロから立ち上げ直す(launch時は通常bgmStopped=true)。
  setMusicProfile(key: BgmProfileKey): void {
    if (key === this.profileKey) return;
    this.profileKey = key;
    this.profile = BGM_PROFILES[key];
    if (!this.bgmStopped) this.stopBgm();
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
    this.prevHeat = 0; // ライザーのエッジ検出をリセット(再開直後の誤発火防止)
    this.lastRiserS = 0;
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
      this.prevHeat = this.combatHeat; // 再開直後の立ち上がりをライザー誤発火にしない
      this.bgmBus.gain.cancelScheduledValues(now);
      this.bgmBus.gain.setTargetAtTime(this.bgmBusGain, now, 0.05);
    }
    // 初回/取り残し時は現在時刻へ寄せ直す(過去拍の取り戻しによるノード洪水を防ぐ)
    if (this.nextBeatTime === 0 || this.nextBeatTime < now) this.nextBeatTime = now + 0.1;
    const p = this.profile;
    const heat = this.combatHeat;
    const bpm = p.bpmBase + heat * p.bpmRange;
    const beatDur = 60 / bpm;
    const g = layerGains(heat);
    const sparse = p.sparse === true;
    // 歪みリードの実効ゲインは profile.leadStartHeat から立ち上がる(g.lead は全体指標)。
    // これで zombie/night-neon は早く、day/overcast は交戦ピークでのみリードが尖る。
    const leadGain =
      p.leadDrive > 0 ? Math.max(0, Math.min(1, (heat - p.leadStartHeat) / 0.25)) : 0;
    // ライザー: 戦況/ラウンドの高揚(heat上昇エッジ)を beatループの外=tickレベルで一度検出。
    // ほとんどのフレームは0拍しか予約しないため、拍ループ内でエッジを見ると取りこぼす。
    if (p.riserEnabled && heat - this.prevHeat > 0.22) this.fireRiser();
    let made = 0;
    while (this.nextBeatTime < now + 0.2 && made < 8) {
      const delay = this.nextBeatTime - now;
      const beatInBar = this.beatIndex % 4;
      const bar = Math.floor(this.beatIndex / 4) % p.progression.length;
      const chord = p.progression[bar]!;
      // ステレオ幅: hats/arp/lead を拍パリティで ±0.3 に振る。キック/ベース/sub基音はセンター。
      const wide = this.beatIndex % 2 === 0 ? -0.3 : 0.3;
      // 3層パンチキック(全拍・percレイヤー。sparseは1拍目のみでhalf-time化)
      // A4-F17: ゾンビBGMは heat<halfTimeKickBelowHeat でも 1拍目(beatInBar===0)のみ
      const halfTimeKick = p.halfTimeKickBelowHeat !== undefined && heat < p.halfTimeKickBelowHeat;
      if (g.perc > 0.01 && (!sparse || beatInBar === 0) && (!halfTimeKick || beatInBar === 0)) {
        this.bgmKick(delay, g.perc);
      }
      // スネア(通常は2・4拍、sparseは3拍目のみ=half-time)+ snareSnap の超高域トランジェント
      const snareHit = sparse ? beatInBar === 2 : beatInBar === 1 || beatInBar === 3;
      if (snareHit && g.perc > 0.01) {
        this.noiseBurst({ durationS: 0.05, filterHz: 1800, filterType: 'bandpass', q: 4, gain: 0.22 * g.perc, delayS: delay, bus: this.bgmBus });
        this.noiseBurst({ durationS: 0.012, filterHz: 3000, filterType: 'highpass', gain: 0.09 * g.perc, delayS: delay, attackS: 0.001, bus: this.bgmBus });
        if (p.snareSnap > 0.01) {
          this.noiseBurst({ durationS: 0.006, filterHz: 5400, filterType: 'highpass', gain: 0.07 * g.perc * p.snareSnap, delayS: delay, attackS: 0.0005, bus: this.bgmBus });
        }
      }
      // ハット(8分×2。sparseは表拍のみに半減)。明るさは profile.hatBrightHz、L/Rで拍パリティ
      if (g.hat > 0.01) {
        this.noiseBurst({ durationS: 0.02, filterHz: p.hatBrightHz, filterType: 'highpass', gain: 0.018 * g.hat, delayS: delay, pan: wide, bus: this.bgmBus });
        if (!sparse) {
          this.noiseBurst({ durationS: 0.016, filterHz: p.hatBrightHz, filterType: 'highpass', gain: 0.012 * g.hat, delayS: delay + beatDur / 2, pan: -wide, bus: this.bgmBus });
        }
      }
      // ベース: drive=chord[0]の8分連打(低heatからグルーヴ)、root=1・3拍のルート。センター維持
      if (g.bass > 0.01) {
        if (p.bassMode === 'drive') {
          for (let k = 0; k < 2; k += 1) {
            this.tone({ freq: bgmNoteHz(chord[0]!, 0, p.rootHz), durationS: beatDur * 0.45, type: p.bassType, gain: 0.055 * g.bass, delayS: delay + (k * beatDur) / 2, bus: this.bgmBus });
          }
        } else if (beatInBar === 0 || beatInBar === 2) {
          this.tone({ freq: bgmNoteHz(chord[0]!, 0, p.rootHz), durationS: beatDur * 0.9, type: p.bassType, gain: 0.06 * g.bass, delayS: delay, bus: this.bgmBus });
        }
      }
      // アルペジオ(8分でコードトーン巡回。sparseは1音/拍・高オクターブ短音のFM風で冷たく)。
      // 音ごとに L/R を交互に振ってステレオの動きを作る。
      if (g.arp > 0.01) {
        const arpN = sparse ? 1 : 2;
        const arpOct = sparse ? 3 : 2;
        const arpDur = sparse ? 0.06 : 0.09;
        for (let k = 0; k < arpN; k += 1) {
          const idx = (this.beatIndex * 2 + k) % 3;
          this.tone({ freq: bgmNoteHz(chord[idx]!, arpOct, p.rootHz), durationS: arpDur, type: p.arpType, gain: 0.03 * g.arp, delayS: delay + (k * beatDur) / 2, detuneCents: sparse ? 8 : undefined, pan: (this.beatIndex + k) % 2 === 0 ? -0.3 : 0.3, bus: this.bgmBus });
        }
      }
      // 歪みリード(driveプロファイル・leadGain時、1・3拍。arp直下)。chord[2]の上オクターブ
      // (=パッドoct1の1オクターブ上)を使い協和させ、持続和音との短2度衝突を避ける。
      if (leadGain > 0.01 && (beatInBar === 0 || beatInBar === 2)) {
        this.tone({ freq: bgmNoteHz(chord[2]!, 2, p.rootHz), durationS: beatDur * 0.85, type: p.leadType, gain: 0.032 * leadGain, delayS: delay, attackS: 0.006, drive: 2 + p.leadDrive * 3, curve: 'tanh', detuneCents: (this.rng() * 2 - 1) * 6, pan: beatInBar === 0 ? -0.22 : 0.22, bus: this.bgmBus });
      }
      // パッド(小節頭で3和音)+ sub-drone(小節頭で地響きの持続層)。
      // 低heat(<0.4)非sparseは半小節頭にもパッドを重ねidleの空白を埋める
      if (beatInBar === 0) {
        this.padVoice(chord, beatDur * 4, g.pad, delay);
        this.subDroneVoice(chord, beatDur * 4, g.sub, delay);
      } else if (beatInBar === 2 && heat < 0.4 && !sparse) {
        this.padVoice(chord, beatDur * 2, g.pad * 0.85, delay);
      }
      this.nextBeatTime += beatDur;
      this.beatIndex += 1;
      made += 1;
    }
    // prevHeat は tick 末で1回だけ更新(次tickのエッジ検出の基準)
    this.prevHeat = heat;
  }

  // 3層パンチキック: ビーター(アタックの芯)+ ボディ(tanh飽和のパンチ)+ サブ(重量)。
  // すべてセンター定位。profile.kickDrive がパンチの飽和量を決める。
  private bgmKick(delayS: number, perc: number): void {
    const bus = this.bgmBus ?? undefined;
    this.noiseBurst({ durationS: 0.01, filterHz: 3200, filterType: 'bandpass', q: 2, gain: 0.05 * perc, delayS, attackS: 0.0005, bus });
    this.tone({ freq: 125, endFreq: 46, durationS: 0.09, type: 'triangle', gain: 0.09 * perc, delayS, drive: this.profile.kickDrive, curve: 'tanh', bus });
    this.tone({ freq: 52, endFreq: 26, durationS: 0.14, type: 'sine', gain: 0.075 * perc, delayS, bus });
  }

  // ライザー: 上昇するノイズスイープ + 上昇サブトーン → 到達で軽いブーム。戦況の高揚を橋渡し。
  // tickBgm のエッジ検出から呼ばれ、クールダウンで連発を防ぐ。全ノードは onended/長尺登録で回収。
  private fireRiser(): void {
    if (!this.ctx || !this.bgmBus) return;
    const now = this.ctx.currentTime;
    if (now - this.lastRiserS < 3) return;
    this.lastRiserS = now;
    const p = this.profile;
    this.noiseBurst({ durationS: 1.6, filterHz: 400, filterEndHz: 6000, filterType: 'bandpass', q: 1.2, gain: 0.12, attackS: 0.8, bus: this.bgmBus });
    this.tone({ freq: bgmNoteHz(0, 0, p.rootHz), endFreq: bgmNoteHz(0, 1, p.rootHz), durationS: 1.6, type: 'sawtooth', gain: 0.05, attackS: 0.9, drive: 2, curve: 'tanh', bus: this.bgmBus });
    this.tone({ freq: 60, endFreq: 30, durationS: 0.4, type: 'sine', gain: 0.14, delayS: 1.55, drive: 3, curve: 'asym', bus: this.bgmBus });
    this.noiseBurst({ durationS: 0.5, filterHz: 2000, filterType: 'highpass', gain: 0.1, delayS: 1.55, bus: this.bgmBus });
    // A4-BGM: bgmBus 経路は routeOut が wet を無視するため、padVoice と同パターンで手動 send
    if (this.reverbInput && p.padWet > 0.001 && this.noiseBuffer) {
      const ctx = this.ctx;
      const ri = this.reverbInput;
      const t0 = now;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(400, t0);
      filt.frequency.exponentialRampToValueAtTime(6000, t0 + 1.6);
      filt.Q.value = 1.2;
      const env = ctx.createGain();
      this.applyEnv(env, 0.12 * p.padWet, t0, 1.6, 0.8);
      src.connect(filt);
      filt.connect(env);
      env.connect(ri);
      src.start(t0, this.rng() * 0.9);
      src.stop(t0 + 1.65);
      src.onended = () => {
        try { src.disconnect(); filt.disconnect(); env.disconnect(); } catch { /* already disconnected */ } finally { src.onended = null; }
      };
    }
  }

  // パッド: コード3音×デチューン2osc。デチューン -6 を左・+6 を右の独立LPへ分けて
  // ±0.35 のステレオ幅(「広いデチューンパッド」)を作り、env/pump は L/R 共通で纏める。
  // 0.4sで立ち上げ小節末で解放。heatが上がるとLPが開いて明るくなる(戦闘の高揚)。音色/残響は
  // profile 依存: triangleパッドは低cutoffで籠らせ、lpQでレゾナンスを識別、padWetで手動send。
  private padVoice(chord: readonly number[], barDurS: number, padGain: number, delayS: number): void {
    if (!this.ctx || !this.bgmBus) return;
    const p = this.profile;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delayS;
    const beatDur = barDurS / 4;
    const triPad = p.padType === 'triangle';
    const lpFreq = (triPad ? 600 : 900) + this.combatHeat * (triPad ? 900 : 1400);
    const lpQ = p.lpQ ?? 0.4;
    // L/R 独立のLP→パンで検波前にデコリレーションを保ち、広いステレオ像を得る
    const lpL = ctx.createBiquadFilter();
    lpL.type = 'lowpass';
    lpL.frequency.value = lpFreq;
    lpL.Q.value = lpQ;
    const lpR = ctx.createBiquadFilter();
    lpR.type = 'lowpass';
    lpR.frequency.value = lpFreq;
    lpR.Q.value = lpQ;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.35;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.35;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.016 * padGain, t0 + 0.4);
    env.gain.setTargetAtTime(0.0001, t0 + barDurS - 0.15, 0.27);
    // 擬似サイドチェイン: kick拍(0/2)でパッドを瞬間的に凹ませポンプ感を出す(低heatの
    // 「padのみ=ヒーラー」問題への対処)。sparse(雪)は平滑に保ち冷たい間合いを壊さない。
    const pump = ctx.createGain();
    if (p.sparse === true) {
      pump.gain.value = 1;
    } else {
      const depth = 0.62;
      pump.gain.setValueAtTime(depth, t0);
      pump.gain.linearRampToValueAtTime(1, t0 + beatDur * 0.6);
      pump.gain.setValueAtTime(depth, t0 + beatDur * 2);
      pump.gain.linearRampToValueAtTime(1, t0 + beatDur * 2 + beatDur * 0.6);
    }
    lpL.connect(panL);
    lpR.connect(panR);
    panL.connect(env);
    panR.connect(env);
    env.connect(pump);
    pump.connect(this.bgmBus);
    // リバーブは手動send。bgmBus経路では routeOut の wet: が捨てられ無効なため、
    // env(ポンプ前の平滑な信号)→ send(gain=padWet)→ reverbInput を張り、onendedで
    // send.disconnect()して reverbInput への残留(音楽オフ後の残響)を断つ。
    let send: GainNode | null = null;
    if (this.reverbInput && p.padWet > 0.001) {
      send = ctx.createGain();
      send.gain.value = p.padWet;
      env.connect(send);
      send.connect(this.reverbInput);
    }
    const oscs: OscillatorNode[] = [];
    for (const semi of chord) {
      for (const det of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = p.padType;
        osc.frequency.value = bgmNoteHz(semi, 1, p.rootHz);
        osc.detune.value = det;
        osc.connect(det < 0 ? lpL : lpR);
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
          lpL.disconnect();
          lpR.disconnect();
          panL.disconnect();
          panR.disconnect();
          env.disconnect();
          pump.disconnect();
          if (send) send.disconnect();
        } catch {
          /* already disconnected */
        } finally {
          last.onended = null;
        }
      };
    }
  }

  // sub-drone: oct0 の saw×2 → HPF(subsonic除去/スピーカー保護) → LPF(heatで開く) →
  // tanh 歪み(subDriveで倍音を作り小型スピーカーでも地響きを知覚)→ 擬似サイドチェイン(DRY)。
  // 基音はセンター定位(低域は絶対に振らない)。軍事エレクトロニカの「攻撃的な床」を作る中核。
  // profile.subMode==='off'(雪の疎な間合い)では鳴らさない。全ノードは onended で確実に切断する。
  private subDroneVoice(chord: readonly number[], barDurS: number, subGain: number, delayS: number): void {
    if (!this.ctx || !this.bgmBus) return;
    const p = this.profile;
    if (p.subMode !== 'drone' || subGain <= 0.01) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delayS;
    const beatDur = barDurS / 4;
    // HPF ~42Hz: DC/超低域の暴れを断ち、スピーカーを保護(zombie 46.25Hz の基音はほぼ通す)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 42;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170 + this.combatHeat * 300; // heatで開いて攻撃的に
    lp.Q.value = 0.9;
    // tanh 歪み段(preGain=subDrive → 共有tanhカーブ)。onendedで pre/shaper を切断
    if (!this.tanhCurve) this.tanhCurve = makeTanhCurveData(3);
    const pre = ctx.createGain();
    pre.gain.value = p.subDrive;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.tanhCurve;
    shaper.oversample = 'none';
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.085 * subGain, t0 + 0.25); // A4-F05: 0.05→0.085
    env.gain.setTargetAtTime(0.0001, t0 + barDurS - 0.12, 0.3);
    // 擬似サイドチェイン(DRY): kick拍(0/2)で沈めてポンプ感=推進力。sparseは平滑
    const pump = ctx.createGain();
    if (p.sparse === true) {
      pump.gain.value = 1;
    } else {
      const depth = 0.55;
      pump.gain.setValueAtTime(depth, t0);
      pump.gain.linearRampToValueAtTime(1, t0 + beatDur * 0.55);
      pump.gain.setValueAtTime(depth, t0 + beatDur * 2);
      pump.gain.linearRampToValueAtTime(1, t0 + beatDur * 2 + beatDur * 0.55);
    }
    hp.connect(lp);
    lp.connect(pre);
    pre.connect(shaper);
    shaper.connect(env);
    env.connect(pump);
    pump.connect(this.bgmBus);
    const base = bgmNoteHz(chord[0]!, 0, p.rootHz);
    const oscs: OscillatorNode[] = [];
    for (const det of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = base;
      osc.detune.value = det; // わずかなデチューンで唸りの厚み(定位はセンター)
      osc.connect(hp);
      osc.start(t0);
      osc.stop(t0 + barDurS + 0.5);
      oscs.push(osc);
    }
    this.voiceLog.push(t0 + barDurS + 0.55);
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        try {
          for (const o of oscs) o.disconnect();
          hp.disconnect();
          lp.disconnect();
          pre.disconnect();
          shaper.disconnect();
          env.disconnect();
          pump.disconnect();
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

  // 素手: ダイブスラム着地の衝撃波(強化サブベース+土煙ノイズ+地面クラック)
  groundPound(): void {
    this.duck(-8, 0.1); // A4-F03
    this.tone({ freq: 58, endFreq: 20, durationS: 0.55, type: 'sine', gain: 0.72, drive: 5, curve: 'asym' });
    this.tone({ freq: 35, endFreq: 15, durationS: 0.4, type: 'sine', gain: 0.5, delayS: 0.04 });
    this.noiseBurst({ durationS: 0.35, filterHz: 280, filterType: 'lowpass', gain: 0.6 });
    this.noiseBurst({
      durationS: 0.1,
      filterHz: 2600,
      filterType: 'bandpass',
      gain: 0.3,
      bus: this.uiBus ?? undefined,
    });
    // 地面クラック: 高域のバースト
    this.noiseBurst({ durationS: 0.06, filterHz: 5000, filterType: 'bandpass', q: 2, gain: 0.25 });
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

  // クナイ斬撃(3バリエーション): 金属抜き音+風切り+刃鳴り"シン"
  kunaiSlash(variation: number): void {
    const v = ((variation % 3) + 3) % 3;
    if (v === 0) {
      // 右薙ぎ: 高い金属音+鋭い上昇スウィープ
      this.noiseBurst({ durationS: 0.07, filterHz: 4200, filterType: 'bandpass', q: 3, gain: 0.35 });
      this.noiseBurst({
        durationS: 0.12,
        filterHz: 2800,
        filterType: 'bandpass',
        filterEndHz: 5500,
        gain: 0.28,
      });
      this.tone({ freq: 1800, endFreq: 3200, durationS: 0.06, type: 'sine', gain: 0.18, attackS: 0.001 });
    } else if (v === 1) {
      // 左薙ぎ: 低めの重い抜き音
      this.noiseBurst({ durationS: 0.08, filterHz: 3000, filterType: 'bandpass', q: 4, gain: 0.38 });
      this.noiseBurst({
        durationS: 0.14,
        filterHz: 1800,
        filterType: 'bandpass',
        filterEndHz: 4000,
        gain: 0.3,
      });
      this.tone({ freq: 1200, endFreq: 2600, durationS: 0.07, type: 'sine', gain: 0.2, attackS: 0.001 });
    } else {
      // 突き: 鋭い金属音+刃鳴りの余韻
      this.noiseBurst({ durationS: 0.05, filterHz: 5500, filterType: 'bandpass', q: 5, gain: 0.32 });
      this.noiseBurst({
        durationS: 0.1,
        filterHz: 3500,
        filterType: 'bandpass',
        filterEndHz: 7000,
        gain: 0.25,
      });
      this.tone({ freq: 2400, endFreq: 4800, durationS: 0.09, type: 'sine', gain: 0.22, attackS: 0.001 });
      this.tone({ freq: 3600, durationS: 0.25, type: 'sine', gain: 0.08, delayS: 0.07, attackS: 0.01 });
    }
  }

  // クナイ命中: 肉/金属で差を付ける
  kunaiHit(material: 'flesh' | 'metal'): void {
    if (material === 'metal') {
      this.tone({ freq: 480, endFreq: 220, durationS: 0.08, type: 'triangle', gain: 0.35 });
      this.noiseBurst({ durationS: 0.05, filterHz: 3800, filterType: 'bandpass', gain: 0.25 });
    } else {
      this.tone({ freq: 280, endFreq: 130, durationS: 0.07, type: 'triangle', gain: 0.3 });
      this.noiseBurst({ durationS: 0.06, filterHz: 900, filterType: 'bandpass', gain: 0.22 });
    }
  }

  // B ウルト: 風神・極大手裏剣(風の轟音+高速回転音+低い発射音)
  kunaiWindShuriken(): void {
    this.duck(-8, 0.1); // A4-F03: ウルト発動時のコンプポンプ抑制
    this.noiseBurst({
      durationS: 0.6,
      filterHz: 1200,
      filterType: 'bandpass',
      filterEndHz: 400,
      gain: 0.55,
    });
    this.noiseBurst({ durationS: 0.8, filterHz: 600, filterType: 'lowpass', gain: 0.4, delayS: 0.1 });
    // 回転ヒュンヒュン(交互スウィープで高速スピン感)
    this.tone({ freq: 380, endFreq: 820, durationS: 0.15, type: 'sawtooth', gain: 0.28 });
    this.tone({ freq: 820, endFreq: 380, durationS: 0.15, type: 'sawtooth', gain: 0.28, delayS: 0.15 });
    this.tone({ freq: 380, endFreq: 820, durationS: 0.15, type: 'sawtooth', gain: 0.28, delayS: 0.3 });
    this.tone({ freq: 90, endFreq: 35, durationS: 0.4, type: 'sine', gain: 0.4, drive: 4 });
  }

  // N ウルト: 雷帝・神獣降臨(雷鳴連打+神獣の咆哮サブベース)
  kunaiLightningBeast(): void {
    this.duck(-8, 0.1); // A4-F03
    this.tone({ freq: 55, endFreq: 18, durationS: 0.8, type: 'sine', gain: 0.7, drive: 8, curve: 'asym' });
    this.noiseBurst({ durationS: 0.12, filterHz: 4800, filterType: 'bandpass', gain: 0.6, attackS: 0.001 });
    this.noiseBurst({ durationS: 0.5, filterHz: 650, filterType: 'lowpass', gain: 0.55, delayS: 0.05 });
    // 連続雷鳴(2発目・3発目)
    this.tone({ freq: 70, endFreq: 25, durationS: 0.6, type: 'sine', gain: 0.5, drive: 6, delayS: 0.6 });
    this.noiseBurst({
      durationS: 0.1,
      filterHz: 5200,
      filterType: 'bandpass',
      gain: 0.5,
      attackS: 0.001,
      delayS: 0.6,
    });
    this.tone({ freq: 60, endFreq: 20, durationS: 0.5, type: 'sine', gain: 0.45, drive: 6, delayS: 1.4 });
    this.noiseBurst({
      durationS: 0.1,
      filterHz: 4200,
      filterType: 'bandpass',
      gain: 0.4,
      attackS: 0.001,
      delayS: 1.4,
    });
    // 神獣の咆哮(サブベース持続)
    this.tone({ freq: 45, endFreq: 28, durationS: 1.8, type: 'sawtooth', gain: 0.35, drive: 5, delayS: 0.3 });
  }

  // M ウルト: 黒技・シュヴァルツヴァルト(超低域ブーム+逆再生風スウィープ+暗いコーラス風パッド)
  schwarzwald(): void {
    this.duck(-8, 0.1); // A4-F03
    // 超低域ブーム(非対称歪みで小型スピーカーにも芯を残す)
    this.tone({ freq: 42, endFreq: 14, durationS: 0.9, type: 'sine', gain: 0.68, drive: 8, curve: 'asym' });
    this.tone({ freq: 28, endFreq: 10, durationS: 0.7, type: 'sine', gain: 0.48, drive: 6, delayS: 0.1 });
    // 逆再生風の高域スウィープ(下降で「収束」感)
    this.noiseBurst({ durationS: 0.5, filterHz: 4800, filterType: 'bandpass', filterEndHz: 180, gain: 0.38 });
    this.noiseBurst({ durationS: 0.8, filterHz: 320, filterType: 'lowpass', gain: 0.55, delayS: 0.12 });
    // 暗いコーラス風パッド(のこぎり波の遅いスウィープ=合唱の倍音)
    this.tone({ freq: 55, endFreq: 62, durationS: 1.6, type: 'sawtooth', gain: 0.28, drive: 3, delayS: 0.2 });
    this.tone({ freq: 82, endFreq: 68, durationS: 1.4, type: 'sawtooth', gain: 0.22, drive: 2, delayS: 0.35 });
    // 金属共鳴の余韻(「黒」の質感)
    this.tone({ freq: 210, endFreq: 130, durationS: 0.6, type: 'triangle', gain: 0.18, delayS: 0.08 });
  }

  // 黒帝通常攻撃: 超低域ブーム + 重い風切りスウィープ + 金属残響尾
  // 連打破綻防止のスロットル(~0.06s)とボイス予算ガード
  darkSlash(): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastDarkSlashS < 0.06 || this.liveVoices() > 230) return;
    this.lastDarkSlashS = now;
    // 超低域ブーム(小型スピーカー向け非対称歪み)
    this.tone({ freq: 50, endFreq: 20, durationS: 0.32, type: 'sine', gain: 0.52, drive: 6, curve: 'asym' });
    // 重い風切りノイズスウィープ(高域→低域で「斬り抜け」感)
    this.noiseBurst({ durationS: 0.28, filterHz: 3200, filterType: 'bandpass', filterEndHz: 280, gain: 0.38 });
    // 金属残響尾(「ズン」と空気を切る)
    this.tone({ freq: 180, endFreq: 60, durationS: 0.35, type: 'triangle', gain: 0.22, delayS: 0.04 });
  }

  // 真月: 溜め音(低い唸り 0.4s)
  shingetsuCharge(): void {
    this.tone({ freq: 38, endFreq: 28, durationS: 0.5, type: 'sine', gain: 0.62, drive: 7, curve: 'asym' });
    this.noiseBurst({ durationS: 0.4, filterHz: 180, filterType: 'lowpass', gain: 0.35 });
    this.tone({ freq: 66, endFreq: 44, durationS: 0.4, type: 'sawtooth', gain: 0.28, drive: 4, delayS: 0.05 });
  }

  // 真月: 解放轟音(シュヴァルツヴァルト超強化版 + 余韻)
  shingetsuRelease(): void {
    this.duck(-10, 0.15); // A4-F03/F01: コンプポンプ抑制 + ×0.7 gain でポンピング防止
    // 超低域ブーム連打(全方位を断裂させる感覚)
    this.tone({ freq: 45, endFreq: 12, durationS: 1.1, type: 'sine', gain: 0.50, drive: 10, curve: 'asym' });
    this.tone({ freq: 30, endFreq: 9,  durationS: 0.9, type: 'sine', gain: 0.36, drive: 8,  curve: 'asym', delayS: 0.05 });
    // 全域スウィープ(下降=収束の轟音)
    this.noiseBurst({ durationS: 0.7, filterHz: 6000, filterType: 'bandpass', filterEndHz: 120, gain: 0.39 });
    this.noiseBurst({ durationS: 1.1, filterHz: 380, filterType: 'lowpass', gain: 0.46, delayS: 0.08 });
    // 金属共鳴+暗黒コーラスパッド(余韻 ~1.5s)
    this.tone({ freq: 55, endFreq: 72, durationS: 1.8, type: 'sawtooth', gain: 0.21, drive: 4, delayS: 0.15 });
    this.tone({ freq: 88, endFreq: 66, durationS: 1.5, type: 'sawtooth', gain: 0.17, drive: 3, delayS: 0.3 });
    this.tone({ freq: 220, endFreq: 110, durationS: 0.8, type: 'triangle', gain: 0.14, delayS: 0.1 });
    // 金属の高域余韻「斬」
    this.noiseBurst({ durationS: 0.12, filterHz: 5500, filterType: 'bandpass', q: 6, gain: 0.22, attackS: 0.001 });
  }

  // 雷帝モード: 常時電気ヒム・ティック(フレーム毎に呼ぶ想定ではなく periodic tick 用)
  raiteiHumTick(): void {
    if (this.liveVoices() > 220) return;
    this.noiseBurst({ durationS: 0.06, filterHz: 3200, filterType: 'bandpass', q: 4, gain: 0.08, attackS: 0.002 });
    this.tone({ freq: 180, endFreq: 260, durationS: 0.05, type: 'sine', gain: 0.06 });
  }

  // 雷帝/黒雷帝の常時帯電ハム(active=trueで開始・false/切替で停止)
  setLightningHum(active: boolean): void {
    if (!this.ctx) return;
    // 既存ハムを停止
    try { this._lightningHumOsc?.stop(); } catch { /* already stopped */ }
    this._lightningHumOsc?.disconnect();
    this._lightningHumGain?.disconnect();
    this._lightningHumOsc = null;
    this._lightningHumGain = null;
    if (!active || !this.sfxBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 58;
    gain.gain.value = 0.04; // 低音量: SFX の下に沈める
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start();
    this._lightningHumOsc = osc;
    this._lightningHumGain = gain;
  }

  // 雷帝AoE雷撃音: large=trueで溜め最大(22m)版
  lightningStrikeAoE(large = false): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this._lastLightningStrikeS < 0.1 || this.liveVoices() > 230) return;
    this._lastLightningStrikeS = now;
    const g = large ? 1.0 : 0.65;
    // 雷撃クラック(超短バンドパスノイズ)
    this.noiseBurst({ durationS: 0.025, filterHz: 5500, filterType: 'bandpass', q: 2, gain: g * 0.6, attackS: 0.001 });
    // 空気の裂け目(高域ローパス)
    this.noiseBurst({ durationS: large ? 0.55 : 0.32, filterHz: large ? 3800 : 2800, filterType: 'lowpass', gain: g * 0.5 });
    // サブ衝撃(低域 sine)
    this.tone({ freq: large ? 55 : 75, endFreq: large ? 18 : 28, durationS: large ? 0.55 : 0.35, type: 'sine', gain: g * 0.45, drive: large ? 7 : 5, curve: 'asym' });
    if (large) {
      // 遠雷の余韻
      this.noiseBurst({ durationS: 0.9, filterHz: 420, filterType: 'lowpass', gain: 0.38, delayS: 0.06 });
      this.tone({ freq: 42, endFreq: 15, durationS: 0.7, type: 'triangle', gain: 0.3, drive: 5, delayS: 0.08 });
    }
  }

  // N ウルト(雷帝中): 月花雷轟 — 4s マップ全域嵐 天の裁き(リズミカルな5連波)
  geppaRaigou(): void {
    this.duck(-8, 0.1); // A4-F03
    // 天の裁き: 5連の律動落雷(0 / 0.5 / 1.1 / 1.9 / 3.0s)
    const strikes = [0, 0.5, 1.1, 1.9, 3.0];
    for (const d of strikes) {
      this.noiseBurst({ durationS: 0.022, filterHz: 6000, filterType: 'bandpass', q: 2.5, gain: 0.65, attackS: 0.001, delayS: d });
      this.noiseBurst({ durationS: 0.7, filterHz: 2600, filterType: 'lowpass', gain: 0.58, delayS: d });
      this.tone({ freq: 50, endFreq: 16, durationS: 0.8, type: 'sine', gain: 0.60, drive: 9, curve: 'asym', delayS: d });
    }
    // 氷青ハーモニックパッド(嵐のうなり)
    this.tone({ freq: 55, endFreq: 70, durationS: 3.5, type: 'sawtooth', gain: 0.20, drive: 2.5 });
    this.tone({ freq: 82, endFreq: 65, durationS: 3.0, type: 'sawtooth', gain: 0.16, drive: 2, delayS: 0.2 });
  }

  // M ウルト(黒雷帝中): 極雷絶滅 — 4s 終焉/虚無(沈黙→超低域一撃→長残響)
  gokuraiZetsumetsu(): void {
    this.duck(-10, 0.15); // A4-F03/F01: コンプポンプ抑制 + ×0.7 gain
    // 一拍の無音後に暗黒超低域パルス
    this.tone({ freq: 22, endFreq: 8,  durationS: 2.0, type: 'sine', gain: 0.56, drive: 14, curve: 'asym', delayS: 0.3 });
    this.tone({ freq: 15, endFreq: 6,  durationS: 1.8, type: 'sine', gain: 0.42, drive: 12, curve: 'asym', delayS: 0.5 });
    // 5本の巨大落雷柱(重く遅くゆっくり落ちる)
    const boltTimes = [0.8, 1.4, 2.0, 2.8, 3.5];
    for (const d of boltTimes) {
      this.noiseBurst({ durationS: 0.04, filterHz: 3800, filterType: 'bandpass', q: 1.5, gain: 0.39, attackS: 0.002, delayS: d });
      this.tone({ freq: 35, endFreq: 10, durationS: 1.0, type: 'sine', gain: 0.34, drive: 8, curve: 'asym', delayS: d });
    }
    // 長い残響(~3.8s 以降)
    this.noiseBurst({ durationS: 1.5, filterHz: 180, filterType: 'lowpass', gain: 0.28, delayS: 3.8, attackS: 0.3 });
  }

  // ── R33 黒雷帝 ambient pack ──────────────────────────────────────────────

  // 黒雷帝ブリンク転移音: バチッ(高域クラック)+変位音+遠雷ゴロ
  kokuraiBlinkTeleport(): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.liveVoices() > 228) return;
    // バチッ: 鋭い高域クラック
    this.noiseBurst({ durationS: 0.018, filterHz: 6800, filterType: 'bandpass', q: 3, gain: 0.55, attackS: 0.001 });
    // 変位音: ミッドの帯域スウィープ
    this.noiseBurst({ durationS: 0.12, filterHz: 2200, filterEndHz: 800, filterType: 'bandpass', q: 2, gain: 0.35 });
    // ゴロ小: 遠雷の低域尾
    this.tone({ freq: 65, endFreq: 28, durationS: 0.28, type: 'sine', gain: 0.30, drive: 5, curve: 'asym', delayS: 0.04 });
  }

  // 雷帝ブリンク転移音: 氷青版の鋭いクラック + 軽スウィープ + 短ゴロ
  raiteiBlinkTeleport(): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.liveVoices() > 228) return;
    // 高域クラック(氷青・黒雷帝より明るい音)
    this.noiseBurst({ durationS: 0.015, filterHz: 7200, filterType: 'bandpass', q: 4, gain: 0.42, attackS: 0.001 });
    // 変位スウィープ(明るめ)
    this.noiseBurst({ durationS: 0.10, filterHz: 2800, filterEndHz: 1200, filterType: 'bandpass', q: 2, gain: 0.28 });
    // 短ゴロ
    this.tone({ freq: 80, endFreq: 40, durationS: 0.20, type: 'sine', gain: 0.22, drive: 4, curve: 'asym', delayS: 0.03 });
  }

  // 黒雷帝発動の雷鳴3連: 近→近→遠(三連撃)
  kokuraiActivateThunder(): void {
    if (!this.ctx || !this.sfxBus) return;
    this.duck(-8, 0.1); // A4-F03
    // 1撃目: 即時・近距離クラック
    this.noiseBurst({ durationS: 0.025, filterHz: 5800, filterType: 'bandpass', q: 2, gain: 0.62, attackS: 0.001 });
    this.tone({ freq: 48, endFreq: 15, durationS: 0.55, type: 'sine', gain: 0.58, drive: 9, curve: 'asym' });
    // 2撃目: 0.22s後・近距離
    this.noiseBurst({ durationS: 0.022, filterHz: 5200, filterType: 'bandpass', q: 2, gain: 0.55, attackS: 0.001, delayS: 0.22 });
    this.tone({ freq: 52, endFreq: 18, durationS: 0.50, type: 'sine', gain: 0.50, drive: 8, curve: 'asym', delayS: 0.22 });
    // 3撃目: 0.55s後・遠雷ロール
    this.noiseBurst({ durationS: 0.8, filterHz: 200, filterType: 'lowpass', gain: 0.38, delayS: 0.55, attackS: 0.06 });
    this.tone({ freq: 38, endFreq: 14, durationS: 0.9, type: 'sine', gain: 0.32, drive: 5, curve: 'asym', delayS: 0.60 });
  }

  // 黒雷帝キル音レイヤー: 高域紫電クラック。3キル以上でace chord 雷版
  kokuraiKillLayer(streak: number): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.liveVoices() > 228) return;
    // 高域クラック(紫電の細い亀裂音) A4-F09: L1にdelayS:0.03を追加(タイミング整合)
    this.noiseBurst({ durationS: 0.015, filterHz: 7500, filterType: 'bandpass', q: 4, gain: 0.22, attackS: 0.001, delayS: 0.03, bus: this.uiBus ?? undefined });
    if (streak >= 3) {
      // マルチキル: 遠雷轟音を重ねる。A4-F10: L2にbusをuiBusへ変更
      this.noiseBurst({ durationS: 0.025, filterHz: 4800, filterType: 'bandpass', q: 2, gain: 0.45, attackS: 0.001, delayS: 0.04, bus: this.uiBus ?? undefined });
      this.tone({ freq: 58, endFreq: 22, durationS: 0.45, type: 'sine', gain: 0.42, drive: 7, curve: 'asym', delayS: 0.04, bus: this.uiBus ?? undefined });
      // 黒雷版上昇アルペジオ(暗い和声で轟く)
      const freqs = [220, 277, 330, 440];
      for (let i = 0; i < freqs.length; i += 1) {
        this.tone({
          freq: freqs[i]!,
          endFreq: freqs[i]! * 0.70,
          durationS: 0.22 - i * 0.02,
          type: 'sawtooth',
          gain: 0.12 - i * 0.015,
          drive: 3,
          delayS: 0.06 + i * 0.045,
          bus: this.uiBus ?? undefined,
        });
      }
    }
  }

  // 黒雷帝常時遠雷: 距離減衰した遠雷ランブル(pan=方位、0=中央)
  rumbleDistantThunder(pan: number): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.liveVoices() > 225) return;
    const g = 0.10 + this.rng() * 0.06;
    // 落雷クラック(遠距離=高域減衰)
    this.noiseBurst({ durationS: 0.022, filterHz: 2800, filterType: 'bandpass', q: 2, gain: g * 0.50, pan });
    // 低域ランブル
    this.noiseBurst({ durationS: 0.8, filterHz: 120, filterType: 'lowpass', gain: g * 0.80, pan, attackS: 0.05, wet: 0.3 });
    this.tone({ freq: 50, endFreq: 20, durationS: 0.7, type: 'sine', gain: g * 0.70, drive: 6, curve: 'asym', delayS: 0.03 });
  }

  // 黒雷帝の遠雷アンビエンス開始(3-7s 間欠スケジューラ。trial=true なら即時1発再生)
  startKokuraiThunder(): void {
    if (this._kokuraiThunderActive) return;
    this._kokuraiThunderActive = true;
    this._scheduleKokuraiThunder();
  }

  // 黒雷帝の遠雷アンビエンス停止
  stopKokuraiThunder(): void {
    this._kokuraiThunderActive = false;
    if (this._kokuraiThunderTimer) {
      clearTimeout(this._kokuraiThunderTimer);
      this._kokuraiThunderTimer = 0;
    }
  }

  // ポーズ時タイマー一時停止(フラグはそのまま)
  pauseKokuraiThunder(): void {
    if (this._kokuraiThunderTimer) {
      clearTimeout(this._kokuraiThunderTimer);
      this._kokuraiThunderTimer = 0;
    }
  }

  // ポーズ解除後タイマー再開
  resumeKokuraiThunder(): void {
    if (this._kokuraiThunderActive && !this._kokuraiThunderTimer) {
      this._scheduleKokuraiThunder();
    }
  }

  private _scheduleKokuraiThunder(): void {
    if (!this._kokuraiThunderActive || typeof window === 'undefined') return;
    const delayMs = (3 + this.rng() * 4) * 1000; // 3-7s
    this._kokuraiThunderTimer = window.setTimeout(() => {
      this._kokuraiThunderTimer = 0;
      this._fireKokuraiThunderTick();
      this._scheduleKokuraiThunder();
    }, delayMs);
  }

  private _fireKokuraiThunderTick(): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.liveVoices() > 225) return;
    const pan = (this.rng() * 2 - 1) * 0.75;
    this.noiseBurst({ durationS: 0.6, filterHz: 180, filterType: 'lowpass', gain: 0.06, pan, attackS: 0.08, wet: 0.25 });
    this.tone({ freq: 52, endFreq: 22, durationS: 0.55, type: 'sine', gain: 0.05, drive: 3, curve: 'asym', delayS: 0.02 });
  }

  // ── R33 黒雷帝 ambient pack ここまで ──────────────────────────────────────

  // ── R33 Sランク武器サウンド ───────────────────────────────────────────────
  // 月光弓 発射音: 弦解放スラップ(hi-pass噪音) + 矢風切りsweep の2層。
  // BOW_RELEASE_SPEC の値と一致させること。
  bowRelease(): void {
    if (this.liveVoices() > 225) return;
    // 弦スラップ(hi-pass)
    this.noiseBurst({
      durationS: BOW_RELEASE_SPEC.slapDurationS,
      filterHz: BOW_RELEASE_SPEC.stringSlapHz,
      filterType: 'highpass',
      gain: BOW_RELEASE_SPEC.slapGain,
      attackS: 0.001,
    });
    // 矢風切りsweep
    this.noiseBurst({
      durationS: BOW_RELEASE_SPEC.windDurationS,
      filterHz: BOW_RELEASE_SPEC.windStartHz,
      filterEndHz: BOW_RELEASE_SPEC.windEndHz,
      filterType: 'bandpass',
      q: 1.2,
      gain: BOW_RELEASE_SPEC.windGain,
      delayS: 0.008,
    });
  }

  // 風神扇 スイング音: 広域bandpass+ノイズsweep。FAN_WHOOSH_SPEC の値と一致させること。
  fanWhoosh(): void {
    if (this.liveVoices() > 225) return;
    this.noiseBurst({
      durationS: FAN_WHOOSH_SPEC.durationS,
      filterHz: FAN_WHOOSH_SPEC.startHz,
      filterEndHz: FAN_WHOOSH_SPEC.endHz,
      filterType: FAN_WHOOSH_SPEC.filterType,
      q: FAN_WHOOSH_SPEC.q,
      gain: FAN_WHOOSH_SPEC.gain,
      attackS: 0.004,
    });
    // 低域エア補強
    this.noiseBurst({
      durationS: FAN_WHOOSH_SPEC.durationS * 0.7,
      filterHz: 200,
      filterType: 'lowpass',
      gain: 0.12,
      delayS: 0.02,
    });
  }

  // 修羅 ミニガン スピンアップ/ダウン。up=true でスピンアップ、up=false でスピンダウン。
  // MINIGUN_SPIN_SPEC の値と一致させること。
  minigunSpin(up: boolean): void {
    if (this.liveVoices() > 225) return;
    const startHz = up ? MINIGUN_SPIN_SPEC.droneStartHz : MINIGUN_SPIN_SPEC.droneDownStartHz;
    const endHz = up ? MINIGUN_SPIN_SPEC.droneEndHz : MINIGUN_SPIN_SPEC.droneDownEndHz;
    // sawtoothドローン: 回転数を模倣
    this.tone({
      freq: startHz,
      endFreq: endHz,
      durationS: MINIGUN_SPIN_SPEC.droneDurationS,
      type: 'sawtooth',
      gain: MINIGUN_SPIN_SPEC.droneGain,
      drive: 3,
      curve: 'asym',
      attackS: 0.05,
    });
    // ブレードノイズ(hi-pass): 金属バレル摩擦感
    this.noiseBurst({
      durationS: MINIGUN_SPIN_SPEC.bladeDurationS,
      filterHz: MINIGUN_SPIN_SPEC.bladeHz,
      filterType: 'highpass',
      gain: MINIGUN_SPIN_SPEC.bladeGain,
      attackS: 0.04,
    });
  }

  // 溜め攻撃チック: charge01(0..1)に応じて上昇するパルス
  chargeAttackTick(charge01: number): void {
    if (this.liveVoices() > 225) return;
    const f = 80 + charge01 * 320;
    const g = 0.08 + charge01 * 0.18;
    this.tone({ freq: f, endFreq: f * 1.4, durationS: 0.12, type: 'sine', gain: g, drive: 2 + charge01 * 4 });
    if (charge01 > 0.5) {
      this.noiseBurst({ durationS: 0.08, filterHz: 1200 + charge01 * 2800, filterType: 'bandpass', q: 3, gain: g * 0.5, attackS: 0.002 });
    }
  }

  // 溜め攻撃解放: 超横斬り放出音(darkSlash の3倍スケール)
  chargeAttackRelease(): void {
    this.duck(-8, 0.1); // A4-F03
    // 超低域ブーム
    this.tone({ freq: 35, endFreq: 10, durationS: 0.55, type: 'sine', gain: 0.72, drive: 9, curve: 'asym' });
    // 横斬りの巨大な風切り(下降スウィープ)
    this.noiseBurst({ durationS: 0.5, filterHz: 4500, filterType: 'bandpass', filterEndHz: 180, gain: 0.62 });
    this.noiseBurst({ durationS: 0.7, filterHz: 280,  filterType: 'lowpass',                  gain: 0.55, delayS: 0.06 });
    // 金属共鳴余韻
    this.tone({ freq: 160, endFreq: 50, durationS: 0.5, type: 'triangle', gain: 0.28, delayS: 0.05 });
    // 暗帝気配(低い唸り)
    this.tone({ freq: 48, endFreq: 28, durationS: 0.8, type: 'sawtooth', gain: 0.2, drive: 3, delayS: 0.1 });
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

  // ロケット発射: バックブラスト風の低音ドンッ + 排気シューッ(2層)
  rocketLaunch(): void {
    // L1 バックブラスト衝撃体(低い爆発的ドンッ)
    this.noiseBurst({ durationS: 0.28, filterHz: 180, filterType: 'lowpass', gain: 0.72, drive: 7, attackS: 0.002 });
    // L2 排気噴射(シューッという高域噴出)
    this.noiseBurst({ durationS: 0.32, filterHz: 1800, filterType: 'bandpass', q: 1.8, gain: 0.38, attackS: 0.005 });
    // L3 低域サブ(発射の重さを感じさせる)
    this.tone({ freq: 80, endFreq: 32, durationS: 0.38, type: 'triangle', gain: 0.4, drive: 4 });
    this.duck(-8, 0.06);
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
    // A4-F20: airLpHz で遠距離のデブリ高域を減衰(空気吸収モデルに合わせる)
    const debris = distance < 25 ? 6 : 3;
    for (let i = 0; i < debris; i += 1) {
      this.noiseBurst({
        durationS: 0.03 + this.rng() * 0.03,
        filterHz: Math.min(this.jit(900 + this.rng() * 1700, 0.1), p.airLpHz),
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

  // ロケット着弾の至近低域サブブーム(explosion()に重ねる1層。25m以内のみ発火)。
  // 超低域(42→18Hz)の非対称歪みトーンで小型スピーカーにも胴体の圧を届ける。
  rocketSubBoom(pan: number, distance: number): void {
    if (distance > 25) return;
    const att = 1 / (1 + distance * 0.06);
    this.tone({ freq: 44, endFreq: 18, durationS: 0.6, type: 'sine', gain: 0.52 * att, pan, drive: 8, curve: 'asym' });
    this.noiseBurst({ durationS: 0.38, filterHz: 68, filterType: 'lowpass', gain: 0.35 * att, pan, drive: 5 });
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

  // ── 空間化された敵足音 ────────────────────────────────────────────
  // pan(-1..1): 敵の方向、distance(m): 距離、mat: 床材質、intensity(0..1): 強度
  // (歩き0.5/走り1.0想定)、occluded: 壁越しのこもり。
  // BO2/Valorant級の索敵情報。自分の足音と聴き分けられるよう pitch ~0.9(重め/低め)。
  // 26m超スキップ / liveVoices>200スキップ / 全体スロットル0.03s。
  // sfxBus → 既存リバーブsendバスグラフに乗せるので「峡谷では足音も反響」が自動で成立する。
  enemyFootstep(
    pan: number,
    distance: number,
    mat: SurfaceMaterial,
    intensity: number,
    occluded: boolean,
  ): void {
    // 距離カリング
    if (distance > 26) return;
    // 予算ガード + スロットル
    const now = this.ctx?.currentTime ?? 0;
    if (this.liveVoices() > 200 || now - this.lastEnemyFootstepS < 0.03) return;
    this.lastEnemyFootstepS = now;

    // 距離減衰(仕様値: att = 1/(1 + distance*0.11))
    let att = 1 / (1 + distance * 0.11);
    // 空気吸収: enemyShotParams の airLpHz カーブを足音帯域(〜3.5kHz)に調整して流用
    //   d=0 → 3500Hz / d=10 → ~2120Hz / d=26 → ~952Hz
    let airLpHz = Math.max(600, 3500 * Math.exp(-0.05 * distance));
    // 遮蔽: 追加LPF(~1200Hz) + att 半減
    if (occluded) {
      airLpHz = Math.min(airLpHz, 1200);
      att *= 0.5;
    }
    const vol = Math.max(0, Math.min(1, intensity)) * att;
    if (vol < 0.001) return;

    // sfxBus 経由でリバーブバスグラフに乗せる(ステージプリセット自動適用)
    const wet = this.presetWet;
    // 敵用: pitch ~0.9 → 全周波数を10%落として「重め/低め」に
    const hzMul = 0.9;
    // intensity>0.8(走り/着地/ゾンビ)は踏み込みの低域をわずかに増厚
    const bassBoost = intensity > 0.8 ? 1.25 : 1.0;

    // ヒール(かかとの低い芯): 自分用 82Hz の 0.9× ≈ 74Hz
    this.tone({
      freq: this.jit(74, 0.15),
      endFreq: 43,
      durationS: 0.05,
      type: 'sine',
      gain: 0.18 * vol * bassBoost,
      pan,
      attackS: 0.002,
      wet,
    });
    // 材質テクスチャ(ヒール)
    this.enemyFootstepTexture(mat, vol, 0, hzMul, airLpHz, pan, wet, bassBoost);
    // トゥ(つま先): 少し遅れて軽く(自分用と同じ遅延規約)
    const toeDelay = 0.05 + this.rng() * 0.02;
    this.enemyFootstepTexture(mat, vol * 0.5, toeDelay, hzMul * 1.3, airLpHz, pan, wet, 1.0);
  }

  // 敵用材質テクスチャ: footstepTexture を air LPF / pan / wet 対応に拡張。
  // filterHz を airLpHz でキャップして空気吸収を表現(帯域幅=距離の質感)。
  private enemyFootstepTexture(
    mat: SurfaceMaterial,
    intensity: number,
    delayS: number,
    hzMul: number,
    airLpHz: number,
    pan: number,
    wet: number,
    bassBoost: number,
  ): void {
    // bandpass / lowpass の中心周波数を airLpHz でキャップ(遠距離・遮蔽の空気吸収)
    const lpCap = (hz: number): number => Math.min(hz, airLpHz);
    switch (mat) {
      case 'metal':
        this.noiseBurst({ durationS: 0.04, filterHz: lpCap(this.jit(1900 * hzMul, 0.12)), filterType: 'bandpass', q: 3, gain: 0.12 * intensity, delayS, pan, wet });
        this.tone({ freq: this.jit(620 * hzMul, 0.1), durationS: 0.05, type: 'sine', gain: 0.06 * intensity * bassBoost, delayS, pan, wet });
        break;
      case 'snow':
        this.noiseBurst({ durationS: 0.035, filterHz: lpCap(this.jit(1200 * hzMul, 0.15)), filterType: 'bandpass', q: 0.8, gain: 0.14 * intensity, delayS, pan, wet });
        this.noiseBurst({ durationS: 0.02, filterHz: lpCap(this.jit(1500 * hzMul, 0.15)), filterType: 'bandpass', q: 1, gain: 0.08 * intensity, delayS: delayS + 0.015, pan, wet });
        break;
      case 'grass':
      case 'dirt':
        this.noiseBurst({ durationS: 0.05, filterHz: lpCap(this.jit(520 * hzMul, 0.15)), filterType: 'lowpass', gain: 0.16 * intensity * bassBoost, delayS, pan, wet });
        break;
      case 'sand':
        this.noiseBurst({ durationS: 0.06, filterHz: lpCap(this.jit(650 * hzMul, 0.15)), filterType: 'lowpass', gain: 0.15 * intensity, delayS, pan, wet });
        break;
      case 'wood':
        this.tone({ freq: this.jit(240 * hzMul, 0.12), endFreq: 126, durationS: 0.04, type: 'triangle', gain: 0.1 * intensity * bassBoost, delayS, pan, wet });
        this.noiseBurst({ durationS: 0.03, filterHz: lpCap(this.jit(900 * hzMul, 0.12)), filterType: 'bandpass', gain: 0.08 * intensity, delayS, pan, wet });
        break;
      case 'concrete':
        this.noiseBurst({ durationS: 0.03, filterHz: lpCap(this.jit(1400 * hzMul, 0.12)), filterType: 'bandpass', q: 1.5, gain: 0.12 * intensity, delayS, pan, attackS: 0.001, wet });
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

  pauseCombatLoops(paused: boolean): void {
    if (this._lightningHumGain && this.ctx) {
      const now = this.ctx.currentTime;
      this._lightningHumGain.gain.cancelScheduledValues(now);
      this._lightningHumGain.gain.setValueAtTime(paused ? 0 : 0.04, now);
    }
    if (paused) {
      if (this.distantBattleTimer) {
        clearTimeout(this.distantBattleTimer);
        this.distantBattleTimer = 0;
      }
      // 黒雷帝遠雷タイマーをポーズ時に一時停止(フラグは維持)
      if (this._kokuraiThunderTimer) {
        clearTimeout(this._kokuraiThunderTimer);
        this._kokuraiThunderTimer = 0;
      }
    } else if (this.distantBattleActive && !this.distantBattleTimer) {
      this.scheduleDistantBoom();
    }
    // 黒雷帝遠雷: ポーズ解除後にスケジューラ再開(フラグがまだ立っている場合)
    if (!paused && this._kokuraiThunderActive && !this._kokuraiThunderTimer) {
      this._scheduleKokuraiThunder();
    }
  }

  // ── 遠方戦場アンビエンス(BF5式 distant battle) ─────────────────────────
  // 4-12sのランダム間欠で砲声/爆発を合成: 低域ランブル(40-80Hz)+サブトーン+確率的クラック。
  // 音量控えめ(没入の背景=戦場感の底上げ)。対戦/ゾンビモード中のみ流す想定。
  // quiesce()で自動停止するため後始末は不要。

  startDistantBattle(): void {
    if (this.distantBattleActive) return;
    this.distantBattleActive = true;
    this.scheduleDistantBoom();
  }

  stopDistantBattle(): void {
    this.distantBattleActive = false;
    if (this.distantBattleTimer) {
      clearTimeout(this.distantBattleTimer);
      this.distantBattleTimer = 0;
    }
  }

  private scheduleDistantBoom(): void {
    if (!this.distantBattleActive || typeof window === 'undefined') return;
    const delayMs = (4 + this.rng() * 8) * 1000; // 4-12s
    this.distantBattleTimer = window.setTimeout(() => {
      this.fireDistantBoom();
      this.scheduleDistantBoom(); // 次イベントをチェーン
    }, delayMs);
  }

  // 砲声1発を合成: 低域ランブル(40-80Hz)+サブトーン+確率的クラックトランジェント
  private fireDistantBoom(): void {
    if (!this.ctx || !this.sfxBus) return;
    const pan = (this.rng() * 2 - 1) * 0.85;   // ランダムな方向(-0.85..0.85)
    const gain = 0.05 + this.rng() * 0.035;     // 0.05-0.085 (控えめな背景音)
    const rumbleHz = 40 + this.rng() * 40;      // 40-80Hz ランブル基音
    const dur = 0.5 + this.rng() * 0.4;         // 0.5-0.9s
    // 低域ランブル体(砲声のボディ)。wet:0.3で微かな残響尾を乗せる
    this.noiseBurst({
      durationS: dur,
      filterHz: rumbleHz * 2,
      filterType: 'lowpass',
      gain,
      pan,
      attackS: 0.04,
      wet: 0.3,
    });
    // サブトーン(衝撃波の低音芯。asymで小型スピーカーにも芯を残す)
    this.tone({
      freq: rumbleHz,
      endFreq: rumbleHz * 0.6,
      durationS: dur * 0.8,
      type: 'sine',
      gain: gain * 0.5,
      pan,
      drive: 3,
      curve: 'asym',
      wet: 0.25,
    });
    // 確率的クラックトランジェント(砲声のアタック感。~55%の確率で加える)
    if (this.rng() > 0.45) {
      this.noiseBurst({
        durationS: 0.02,
        filterHz: 1200,
        filterType: 'bandpass',
        q: 3,
        gain: gain * 0.55,
        pan,
        attackS: 0.001,
        wet: 0.2,
      });
    }
  }

  // quit/試合遷移の後始末を単一路に集約。メニュー往復でオーディオ状態を完全初期化する
  quiesce(): void {
    this.stopBgm();
    this.stopAmbience();
    this.stopDistantBattle(); // 遠方戦場アンビエンスの setTimeout を確実に解除
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
    // 雷帝帯電ハムを確実に停止
    this.setLightningHum(false);
    // 黒雷帝遠雷スケジューラを確実に停止
    this.stopKokuraiThunder();
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
