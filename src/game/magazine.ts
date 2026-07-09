// マガジンと所持弾の状態機械。リロード時間の判定だけを担い、
// タイマー進行は武器側が持つ。
export class Magazine {
  rounds: number;
  // R-ext-mag: パーク「拡張マガジン」で購入直後・新規武器取得時に書き換えるため可変にする。
  // 通常のリロード/発射経路は capacity を読むだけで変更しない。
  capacity: number;
  reserve: number;

  constructor(capacity: number, initialReserve: number) {
    this.capacity = capacity;
    this.rounds = capacity;
    this.reserve = initialReserve;
  }

  /**
   * 容量を変更する(拡張マガジンパーク用)。
   * refill=true のとき、増えた分だけ即座に rounds を補充する(reserve は全武器∞なので必ず満たせる)。
   * refill=false のとき rounds は新容量を超えないようclampのみ行う(縮小時の安全弁。現状未使用)。
   */
  setCapacity(newCapacity: number, refill: boolean): void {
    this.capacity = newCapacity;
    if (refill) {
      const need = Math.max(0, newCapacity - this.rounds);
      const take = Math.min(need, this.reserve);
      this.rounds += take;
    } else if (this.rounds > newCapacity) {
      this.rounds = newCapacity;
    }
  }

  get isEmpty(): boolean {
    return this.rounds === 0;
  }

  get isFull(): boolean {
    return this.rounds >= this.capacity;
  }

  get canReload(): boolean {
    return !this.isFull && this.reserve > 0;
  }

  // 1発消費。撃てなければfalse
  fire(): boolean {
    if (this.rounds <= 0) return false;
    this.rounds -= 1;
    return true;
  }

  // タクティカルリロード(残弾あり)は速く、空リロードは遅い
  reloadKind(): 'tactical' | 'empty' {
    return this.rounds > 0 ? 'tactical' : 'empty';
  }

  finishReload(): void {
    const need = this.capacity - this.rounds;
    const take = Math.min(need, this.reserve);
    this.rounds += take;
    this.reserve -= take;
  }
}
