// 物理・ゲームロジックは固定60Hz、描画はリフレッシュレート任せ。
// タブ復帰時のスパイクは0.25秒でクランプする。
export class GameLoop {
  readonly fixedDt = 1 / 60;

  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private running = false;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (dt: number) => void,
    // 固定更新ドレインの前に毎フレーム1回だけ走る(ゲームパッドのポーリング用)。
    // ボタンの立ち上がりを同フレームの update に確実に届けるため。
    private readonly preTick?: (dt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const frame = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.accumulator += frame;
    this.preTick?.(frame);
    while (this.accumulator >= this.fixedDt) {
      this.update(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
    this.render(frame);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
