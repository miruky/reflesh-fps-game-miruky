// マガジンと所持弾の状態機械。リロード時間の判定だけを担い、
// タイマー進行は武器側が持つ。
export class Magazine {
  rounds: number;
  reserve: number;

  constructor(
    readonly capacity: number,
    initialReserve: number,
  ) {
    this.rounds = capacity;
    this.reserve = initialReserve;
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
