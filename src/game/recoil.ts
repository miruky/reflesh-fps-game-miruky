export interface RecoilStep {
  // ラジアン。yawは正で右、pitchは正で上に跳ねる
  yaw: number;
  pitch: number;
}

// 連射中はパターンに沿って進み、射撃が止まるとresetで先頭へ戻る。
// パターン末尾に達したら末尾のステップを繰り返す。
export class RecoilTracker {
  private index = 0;
  private offsetYaw = 0;
  private offsetPitch = 0;

  constructor(
    private readonly pattern: readonly RecoilStep[],
    private readonly recoveryPerSecond: number,
  ) {
    if (pattern.length === 0) throw new Error('recoil pattern must not be empty');
  }

  kick(): RecoilStep {
    const step = this.pattern[Math.min(this.index, this.pattern.length - 1)]!;
    this.index += 1;
    this.offsetYaw += step.yaw;
    this.offsetPitch += step.pitch;
    return step;
  }

  reset(): void {
    this.index = 0;
  }

  // 武器切替/リスポーン時: パターン位置に加え、未回復の蓄積オフセットも0へ。
  // (reset()はindexのみ=射撃小休止の回復用。切替時にこれを使うと反動がplayer.pitchに
  //  焼き付いたまま繰り越し、再選択時に下方向の視点ガクつきを起こすため hardReset を用意)
  hardReset(): void {
    this.index = 0;
    this.offsetYaw = 0;
    this.offsetPitch = 0;
  }

  // 蓄積した反動オフセットを毎フレーム0へ戻す。戻した量を返すので
  // カメラ側は差分だけ視点を下げられる。
  recover(dt: number): RecoilStep {
    const decay = Math.min(1, this.recoveryPerSecond * dt);
    const yawBack = this.offsetYaw * decay;
    const pitchBack = this.offsetPitch * decay;
    this.offsetYaw -= yawBack;
    this.offsetPitch -= pitchBack;
    return { yaw: yawBack, pitch: pitchBack };
  }

  get stepIndex(): number {
    return this.index;
  }

  get accumulatedPitch(): number {
    return this.offsetPitch;
  }
}
