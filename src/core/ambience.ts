import type { Rand } from './rng';
import type { StagePalette } from '../game/stage';

// ── ステージ環境音(アンビエンス) ─────────────────────────────────────
// 音声アセットを一切持たず、Web Audio APIのリアルタイム合成だけで
// 風・ハム・群衆・水・散発イベント(鳥/虫/蒸気/きしみ)を鳴らす。
// パレット→音響プロファイルの導出は副作用ゼロの純関数に切り出してテスト可能にする。
// AudioContextの生成・ループバッファの確保は呼び出し側(SoundKit)の責務。

// ステージごとの環境音プロファイル。rateS系は「イベントの平均間隔秒」で 0=無効。
export interface AmbientProfile {
  windGain: number;
  windHz: number;
  windLfoHz: number;
  humGain: number;
  humHz: number;
  crowdGain: number;
  waterGain: number;
  birdRateS: number;
  cricketRateS: number;
  steamRateS: number;
  creakRateS: number;
  isIndoor: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// #rrggbb が「青・シアン優勢」かのヒューリスティック。水辺(港湾の床や青アクセント)の検出用。
// b>r だけだと訓練場の床(#b8bcc4)のような微青グレーまで拾ってしまうため、
// Rに対して +12/255 の明確な優勢を要求してほぼ無彩色を弾く。
function isBluishDominant(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return b > r + 12 && b > g * 0.9;
}

// StagePalette から環境音プロファイルを決定論的に導出する。
// 同じパレットなら必ず同じ音になる(乱数はエンジン側の再生時にのみ使う)。
export function deriveAmbientProfile(
  palette: StagePalette,
  size: number,
  obstacleCount: number,
): AmbientProfile {
  // size/obstacleCount は正準シグネチャ上の予約引数(反響・イベント密度の空間連動は統合側の
  // 将来拡張)。現行仕様の値には影響させないが、noUnusedParameters を満たすため明示的に読む。
  void size;
  void obstacleCount;

  const fog = palette.fogDensity;
  const turbidity = palette.turbidity ?? 3;
  const elevation = palette.elevation ?? 50;
  // 発光アクセント+低い太陽=屋内/夜間型ステージ(工廠・夜市・neonバイオーム)とみなす
  const isIndoor = palette.emissiveAccent === true && elevation < 20;

  // 風: 霧が濃いほど太く(ゲイン増)・帯域を上げる。屋内は空調程度の定常流のみ
  // V9実測: 旧0.04-0.12はBP(Q0.5)+ambBus通過後に-48〜-56dBFSで事実上無音だった。
  // 約7倍へ引き上げ、ベッド実効RMSを-32〜-36dBFS(常時聞こえる「世界の空気」)に置く
  const windGain = isIndoor ? 0.14 : clamp(0.28 + fog * 17.5, 0.28, 0.84);
  const windHz = clamp(200 + fog * 20000, 250, 900);
  // うねりの周期も霧量で補間(0.03=全ステージ実測の濃霧上限、雪原0.028基準)
  const windLfoHz = 0.08 + clamp(fog / 0.03, 0, 1) * (0.25 - 0.08);

  // 電気ハム: 屋内は照明・機械のハムを常時。屋外でも濁った空(工業地帯)は遠くの低周波を薄く
  const humGain = isIndoor ? 0.06 : turbidity >= 9 ? 0.02 : 0;
  // 強い濁り=夜市系は80Hz基準(米国系電源の緊張感)、それ以外は60Hz
  const humHz = turbidity >= 14 ? 80 : 60;

  // 群衆: ネオン+濃い濁り=夜市の雑踏だけに乗せる
  const crowdGain = palette.emissiveAccent === true && turbidity >= 14 ? 0.05 : 0;

  // 水面: 床かアクセントが青・シアン優勢なら水辺ステージとみなす
  const waterGain = isBluishDominant(palette.floor) || isBluishDominant(palette.accent) ? 0.05 : 0;

  // 散発イベント: 鳥は明るい昼の屋外のみ、虫は薄暮〜夜の屋外のみ。
  // 蒸気は屋内または濁った工業空、金属きしみは屋内のみ
  const birdRateS = !isIndoor && elevation >= 35 ? 7 : 0;
  const cricketRateS = !isIndoor && (elevation < 20 || palette.emissiveAccent) ? 5 : 0;
  const steamRateS = isIndoor || turbidity >= 12 ? 11 : 0;
  const creakRateS = isIndoor ? 13 : 0;

  return {
    windGain,
    windHz,
    windLfoHz,
    humGain,
    humHz,
    crowdGain,
    waterGain,
    birdRateS,
    cricketRateS,
    steamRateS,
    creakRateS,
    isIndoor,
  };
}

// イベントの次回遅延。平均間隔baseSに対し0.6〜1.5倍へ散らし、等間隔の機械感を消す
export function eventDelayS(baseS: number, rand: number): number {
  return baseS * (0.6 + rand * 0.9);
}

// ブラウンノイズを書き込む。白色ノイズのリーキー積分で低域偏重の「風の胴体」を作る。
// 完全積分だとDCが溜まって発散するため、1.02で割る漏れ付き積分にする。
export function fillBrownNoise(data: Float32Array, rng: Rand = Math.random): void {
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    const w = rng() * 2 - 1;
    b = (b + 0.02 * w) / 1.02;
    // 低域の胴体(積分成分)+ 白色の空気感を薄く混ぜる
    data[i] = b * 3.5 * 0.6 + w * 0.15;
  }
}

// ループバッファの終端fadeSamples区間を先頭へcos²等パワークロスフェードし、
// loop=true 全長再生時の繋ぎ目の段差(クリックノイズ)を除去する(in-place)。
// 先頭を書き換えるだけでは末尾→先頭の段差が残るため、末尾側も先頭開始値(anchor)へ
// 収束させ、両端を同一値で縫い合わせて連続性を構造的に保証する。
export function makeSeamlessLoop(data: Float32Array, fadeSamples: number): void {
  const len = data.length;
  const fade = Math.floor(fadeSamples);
  // 頭尾の交差区間が重なる長さでは意味を成さないので何もしない
  if (fade < 2 || len < fade * 2) return;

  // 末尾区間は先頭ブレンドの素材として書き換え前に退避する
  const tail = new Float32Array(fade);
  for (let i = 0; i < fade; i += 1) tail[i] = data[len - fade + i] ?? 0;
  const anchor = tail[0] ?? 0;

  for (let i = 0; i < fade; i += 1) {
    // 先頭: 末尾素材(cos)から本来の先頭内容(sin)へ等パワーで開く。data[0]はanchorに一致
    const t = i / fade;
    const gIn = Math.sin((t * Math.PI) / 2);
    const gOut = Math.cos((t * Math.PI) / 2);
    data[i] = (data[i] ?? 0) * gIn + (tail[i] ?? 0) * gOut;
    // 末尾: 素材(cos)からanchor(sin)へ収束させ、最終サンプルをdata[0]と一致させる
    const t2 = (i + 1) / fade;
    const hIn = Math.sin((t2 * Math.PI) / 2);
    const hOut = Math.cos((t2 * Math.PI) / 2);
    data[len - fade + i] = (tail[i] ?? 0) * hOut + anchor * hIn;
  }
}

// ── 環境音エンジン ───────────────────────────────────────────────
// beds(風/ハム/群衆/水)→bedMix→duckGain→out のグラフを所有し、
// tick(nowS) で突風・帯域漂い・散発イベントを進める。
// ノード生成は必ず makeOsc()/makeSrc()/track() 経由にし、風LFO/水LFO/ハム3oscの
// stop漏れ・disconnect漏れを所有権台帳(liveSources/liveNodes)で構造的に排除する。
// ctx.currentTime には依存せず、時刻は常に tick の nowS 引数を使う(テスト容易性)。
export class AmbienceEngine {
  private readonly ctx: AudioContext;
  private readonly out: AudioNode;
  private readonly loopBuffer: AudioBuffer;
  private readonly rng: Rand;

  // 所有権台帳。start()で積み、finalize()で必ず空にする
  private readonly liveSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  private readonly liveNodes: AudioNode[] = [];

  private bedMix: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private windGainNode: GainNode | null = null;
  private crowdBP: BiquadFilterNode | null = null;
  private profile: AmbientProfile | null = null;
  private pendingStopTimer: ReturnType<typeof setTimeout> | null = null;

  private lastNowS = 0;
  private lastHeat = -1; // 初回のsetHeatが必ずε差分ガードを通るよう範囲外で初期化
  private paused = false;

  // スケジュール時刻(秒)。-1=未初期化で、初回tickで未来へ予約される
  private nextGustT = -1;
  private nextCrowdT = -1;
  private nextBirdT = -1;
  private nextCricketT = -1;
  private nextSteamT = -1;
  private nextCreakT = -1;

  // loopBuffer は呼び出し側が一度だけ生成した4秒モノラルのブラウンノイズ・シームレスループ。
  // エンジン内でバッファを再確保しない(GC負荷とメモリの二重持ちを避ける)
  constructor(ctx: AudioContext, out: AudioNode, loopBuffer: AudioBuffer, rng: Rand = Math.random) {
    this.ctx = ctx;
    this.out = out;
    this.loopBuffer = loopBuffer;
    this.rng = rng;
  }

  // 生成した中間ノードを台帳へ載せる。finalize()での切断漏れを構造的に防ぐ
  private track<T extends AudioNode>(node: T): T {
    this.liveNodes.push(node);
    return node;
  }

  private makeOsc(type: OscillatorType, freq: number): OscillatorNode {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    this.liveSources.push(osc);
    return osc;
  }

  private makeSrc(playbackRate: number, loop: boolean): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.loopBuffer;
    src.playbackRate.value = playbackRate;
    src.loop = loop;
    this.liveSources.push(src);
    return src;
  }

  // イベント音の終了時に台帳から外す(finalizeの全停止と二重解放になっても安全)
  private untrack(node: AudioNode): void {
    const i = this.liveNodes.indexOf(node);
    if (i >= 0) this.liveNodes.splice(i, 1);
    const j = this.liveSources.indexOf(node as OscillatorNode | AudioBufferSourceNode);
    if (j >= 0) this.liveSources.splice(j, 1);
  }

  // イベント音の一時ノード一式を台帳から外して切断する。onendedから呼ぶ
  private releaseEvent(nodes: AudioNode[]): void {
    for (const n of nodes) {
      this.untrack(n);
      try {
        n.disconnect();
      } catch {
        // 切断済み・未接続は無視してよい
      }
    }
  }

  // 環境音ベッドを構築して鳴らし始める。
  start(profile: AmbientProfile): void {
    // 停止フェード待ちの最中に再開すると、残っていたタイマーのfinalizeが後から走って
    // 新しいベッドを殺すため、冒頭でタイマーを破棄し同期的に全ノードを畳む(二重起動防止)
    if (this.pendingStopTimer !== null) {
      clearTimeout(this.pendingStopTimer);
      this.pendingStopTimer = null;
    }
    this.finalize();

    this.profile = profile;
    this.paused = false;
    this.lastHeat = -1;
    this.nextGustT = -1;
    this.nextCrowdT = -1;
    this.nextBirdT = -1;
    this.nextCricketT = -1;
    this.nextSteamT = -1;
    this.nextCreakT = -1;

    // beds→bedMix→duckGain→out。bedMixは一時停止/停止フェード、duckGainは交戦ダック担当
    const bedMix = this.track(this.ctx.createGain());
    bedMix.gain.value = 1;
    const duck = this.track(this.ctx.createGain());
    duck.gain.value = 1.0;
    bedMix.connect(duck);
    duck.connect(this.out);
    this.bedMix = bedMix;
    this.duckGain = duck;

    // ── 風ベッド(全ステージ共通の土台)。同一ループを2本、僅かな速度差(0.97/1.03)で重ねて
    // 4秒ループの周期感を打ち消し、bandpassで霧量由来の帯域だけ通す
    const windFilter = this.track(this.ctx.createBiquadFilter());
    windFilter.type = 'bandpass';
    windFilter.frequency.value = profile.windHz;
    windFilter.Q.value = 0.5;
    const windGainNode = this.track(this.ctx.createGain());
    windGainNode.gain.value = profile.windGain;
    const windA = this.makeSrc(0.97, true);
    const windB = this.makeSrc(1.03, true);
    windA.connect(windFilter);
    windB.connect(windFilter);
    windFilter.connect(windGainNode);
    windGainNode.connect(bedMix);
    // うねりLFO。深さは基準ゲインの0.8倍以下に抑え、合成ゲインが負へ振れないようにする
    const windLfo = this.makeOsc('sine', profile.windLfoHz);
    const windLfoDepth = this.track(this.ctx.createGain());
    windLfoDepth.gain.value = profile.windGain * 0.8;
    windLfo.connect(windLfoDepth);
    windLfoDepth.connect(windGainNode.gain);
    windA.start();
    windB.start();
    windLfo.start();
    this.windGainNode = windGainNode;

    // ── 電気ハム(屋内/濁った空)。基音+2倍+3倍を±8セントずらし、単一正弦の機械臭を消す
    if (profile.humGain > 0) {
      const humGainNode = this.track(this.ctx.createGain());
      humGainNode.gain.value = profile.humGain;
      humGainNode.connect(bedMix);
      const detunes = [-8, 0, 8];
      for (let k = 0; k < detunes.length; k += 1) {
        const osc = this.makeOsc('sine', profile.humHz * (k + 1));
        osc.detune.value = detunes[k] ?? 0;
        osc.connect(humGainNode);
        osc.start();
      }
    }

    // ── 群衆(夜市系)。ループを半速再生して声帯域(BP400→LP1200)だけ残し、
    // 低速AMでざわめきの満ち引きを作る
    if (profile.crowdGain > 0) {
      const bp = this.track(this.ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 1;
      const lp = this.track(this.ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const crowdGainNode = this.track(this.ctx.createGain());
      crowdGainNode.gain.value = profile.crowdGain;
      const src = this.makeSrc(0.55, true);
      src.connect(bp);
      bp.connect(lp);
      lp.connect(crowdGainNode);
      crowdGainNode.connect(bedMix);
      const am = this.makeOsc('sine', 0.13);
      const amDepth = this.track(this.ctx.createGain());
      amDepth.gain.value = profile.crowdGain * 0.5;
      am.connect(amDepth);
      amDepth.connect(crowdGainNode.gain);
      src.start();
      am.start();
      this.crowdBP = bp;
    }

    // ── 水面(青系パレット)。500Hz以下に丸めたノイズを0.1HzのLFOでゆっくり寄せては返す
    if (profile.waterGain > 0) {
      const lp = this.track(this.ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const waterGainNode = this.track(this.ctx.createGain());
      waterGainNode.gain.value = profile.waterGain;
      const src = this.makeSrc(1, true);
      src.connect(lp);
      lp.connect(waterGainNode);
      waterGainNode.connect(bedMix);
      const lfo = this.makeOsc('sine', 0.1);
      const lfoDepth = this.track(this.ctx.createGain());
      lfoDepth.gain.value = profile.waterGain * 0.5;
      lfo.connect(lfoDepth);
      lfoDepth.connect(waterGainNode.gain);
      src.start();
      lfo.start();
    }
  }

  // 散発スケジュールの共通処理。初回は未来へ予約のみ、発火後は必ず nowS 起点で再予約する。
  // タブ非表示などで nowS が大きく飛んでも「過去時刻の取り戻し」で連打しないためのガード
  private stepEvent(nextT: number, baseS: number, nowS: number, fire: () => void): number {
    if (baseS <= 0) return -1;
    if (nextT < 0) return nowS + eventDelayS(baseS, this.rng());
    if (nowS < nextT) return nextT;
    fire();
    return nowS + eventDelayS(baseS, this.rng());
  }

  // 毎フレーム呼ぶ。nowS は ctx.currentTime を呼び出し側が渡す(エンジンはctx時計に触れない)
  tick(nowS: number): void {
    const p = this.profile;
    const bed = this.bedMix;
    if (!p || !bed) return;
    this.lastNowS = nowS;

    // (1) 突風: 4〜9秒毎に基準ゲイン×0.7〜1.6へ緩慢に追従するランダムウォーク
    if (this.windGainNode) {
      if (this.nextGustT < 0) {
        this.nextGustT = nowS + 4 + this.rng() * 5;
      } else if (nowS >= this.nextGustT) {
        this.windGainNode.gain.setTargetAtTime(p.windGain * (0.7 + this.rng() * 0.9), nowS, 1.2);
        this.nextGustT = nowS + 4 + this.rng() * 5;
      }
    }

    // (2) 群衆の帯域漂い: 3〜7秒毎にBP中心を350〜600Hzへ流し、ざわめきの表情を変える
    if (this.crowdBP) {
      if (this.nextCrowdT < 0) {
        this.nextCrowdT = nowS + 3 + this.rng() * 4;
      } else if (nowS >= this.nextCrowdT) {
        this.crowdBP.frequency.setTargetAtTime(350 + this.rng() * 250, nowS, 1.5);
        this.nextCrowdT = nowS + 3 + this.rng() * 4;
      }
    }

    // (3) 散発イベント。nextTは必ず未来へ再設定される(stepEvent内のガード)
    this.nextBirdT = this.stepEvent(this.nextBirdT, p.birdRateS, nowS, () =>
      this.playBird(nowS, bed),
    );
    this.nextCricketT = this.stepEvent(this.nextCricketT, p.cricketRateS, nowS, () =>
      this.playCricket(nowS, bed),
    );
    this.nextSteamT = this.stepEvent(this.nextSteamT, p.steamRateS, nowS, () =>
      this.playSteam(nowS, bed),
    );
    this.nextCreakT = this.stepEvent(this.nextCreakT, p.creakRateS, nowS, () =>
      this.playCreak(nowS, bed),
    );
  }

  // 鳥の3連ピップ。80ms間隔で音程を僅かに散らし、機械的な等間隔感を薄める
  private playBird(t0: number, bed: GainNode): void {
    const base = 2800 + this.rng() * 1400;
    for (let k = 0; k < 3; k += 1) {
      const f = base * (1 + (this.rng() - 0.5) * 0.06);
      const osc = this.makeOsc('triangle', f);
      const g = this.track(this.ctx.createGain());
      const t = t0 + k * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g);
      g.connect(bed);
      osc.start(t);
      osc.stop(t + 0.06);
      osc.onended = () => this.releaseEvent([osc, g]);
    }
  }

  // 虫のトレモロ。4200Hzの正弦に40HzのAMを掛け、羽音の粒立ちを作る
  private playCricket(t0: number, bed: GainNode): void {
    const osc = this.makeOsc('sine', 4200);
    const g = this.track(this.ctx.createGain());
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    const am = this.makeOsc('sine', 40);
    const amDepth = this.track(this.ctx.createGain());
    amDepth.gain.value = 0.028; // 深めのトレモロ(基準0.035の8割)で明滅を強調
    am.connect(amDepth);
    amDepth.connect(g.gain);
    osc.connect(g);
    g.connect(bed);
    osc.start(t0);
    am.start(t0);
    osc.stop(t0 + 0.4);
    am.stop(t0 + 0.4);
    osc.onended = () => this.releaseEvent([osc, am, amDepth, g]);
  }

  // 蒸気の噴出。loopBufferの任意位置を0.9〜1.4秒だけ切り出し、800〜1200Hzの帯域を通す
  private playSteam(t0: number, bed: GainNode): void {
    const dur = 0.9 + this.rng() * 0.5;
    const src = this.makeSrc(1, false);
    const bp = this.track(this.ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = 800 + this.rng() * 400;
    bp.Q.value = 1.5;
    const g = this.track(this.ctx.createGain());
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(bed);
    // 4秒素材の前半2.4秒以内から開始し、最長1.4秒再生でも末尾を踏み越えないようにする
    src.start(t0, this.rng() * 2.4, dur + 0.05);
    src.onended = () => this.releaseEvent([src, bp, g]);
  }

  // 金属のきしみ。saw 240〜320Hzを×0.85まで撓ませ、Q8の鋭い共鳴で金属の鳴きにする
  private playCreak(t0: number, bed: GainNode): void {
    const f = 240 + this.rng() * 80;
    const osc = this.makeOsc('sawtooth', f);
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.85, t0 + 0.5);
    const bp = this.track(this.ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 8;
    const g = this.track(this.ctx.createGain());
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(bp);
    bp.connect(g);
    g.connect(bed);
    osc.start(t0);
    osc.stop(t0 + 0.5);
    osc.onended = () => this.releaseEvent([osc, bp, g]);
  }

  // 交戦度(0..1)で環境音をダッキングする。銃声・索敵キューの帯域を空けるのが目的。
  // 毎フレーム呼ばれるため、ε=0.02未満の微変化ではオートメーションを積まない
  setHeat(v: number): void {
    const duck = this.duckGain;
    if (!duck) return;
    const heat = clamp(v, 0, 1);
    if (Math.abs(heat - this.lastHeat) < 0.02) return;
    this.lastHeat = heat;
    // 完全な静寂(heat=0)では1.15へ逆ダックし、世界の実在感を前に出す。
    // 復帰目標は定数計算値(直前値への乗算にすると呼ばれるたびに複利で増幅が溜まる)
    const target = heat <= 0 ? 1.15 : 1 - 0.65 * heat;
    duck.gain.setTargetAtTime(target, this.lastNowS, 0.4);
  }

  // ポーズ中は完全消音にせず0.25へ落とす(メニューの奥で世界が続いている感を残す)
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.bedMix?.gain.setTargetAtTime(p ? 0.25 : 1.0, this.lastNowS, 0.15);
  }

  // フェードアウトしてから破棄する。即finalizeするとブツ切りのクリックが出る
  stop(): void {
    const bed = this.bedMix;
    if (!bed) return;
    bed.gain.setTargetAtTime(0.0001, this.lastNowS, 0.2);
    // τ0.2が十分沈む0.8秒後に破棄。この間にstart()が来たらstart側がタイマーを破棄する
    if (this.pendingStopTimer !== null) clearTimeout(this.pendingStopTimer);
    this.pendingStopTimer = setTimeout(() => this.finalize(), 800);
  }

  // 全ノードを停止・切断して台帳を空にする。冪等(何度呼んでも安全)
  finalize(): void {
    for (const src of this.liveSources) {
      try {
        src.stop();
      } catch {
        // 未start/停止済みのInvalidStateErrorは無視してよい
      }
      src.onended = null;
      src.disconnect();
    }
    for (const node of this.liveNodes) node.disconnect();
    this.liveSources.length = 0;
    this.liveNodes.length = 0;
    if (this.pendingStopTimer !== null) {
      clearTimeout(this.pendingStopTimer);
      this.pendingStopTimer = null;
    }
    this.bedMix = null;
    this.duckGain = null;
    this.windGainNode = null;
    this.crowdBP = null;
    this.profile = null;
  }
}
