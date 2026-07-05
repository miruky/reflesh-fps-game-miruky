/**
 * BO2式スコアストリークシステム ── 純ロジック層
 * ──────────────────────────────────────────────────────────────
 * キル +100pts / ヘッドショットキル +125pts で progress が進む。
 * 各コスト閾値を「初通過」するとそのストリークがバンクされる。
 * progress は 800 到達でループ (タレット取得と同時にリセット)。
 * 死亡で progress=0 (バンク済みは保持)。
 * 発動はバンクを消費するだけ。副作用は Match 側で実装する。
 * ゾンビモードでは Match が addScore を呼ばないことで無効化する。
 */

export const STREAK_DEFS = [
  { id: 'rc-xd',         name: 'RC-XD',            cost: 325, key: 3 },
  { id: 'uav',           name: 'UAV',              cost: 425, key: 4 },
  { id: 'hk',            name: 'HUNTER KILLER',    cost: 525, key: 5 },
  { id: 'care-package',  name: 'CARE PACKAGE',      cost: 550, key: 6 },
  { id: 'counter-uav',   name: 'COUNTER UAV',       cost: 600, key: 7 },
  { id: 'lightning',     name: 'LIGHTNING STRIKE',  cost: 750, key: 8 },
  { id: 'sensor-turret', name: 'SENSOR TURRET',     cost: 800, key: 9 },
] as const satisfies ReadonlyArray<{ id: string; name: string; cost: number; key: number }>;

export type StreakIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export class StreakManager {
  private _progress = 0;
  private readonly _banked: boolean[] = [false, false, false, false, false, false, false];

  /**
   * キルスコアを加算し、新たにバンクされたストリークの配列インデックスを返す。
   * BO2 GSC 仕様: progress が各 cost 閾値を越えたら bank; 800 到達でループ。
   */
  addScore(pts: number): StreakIndex[] {
    const prev = this._progress;
    const rawNew = prev + pts;
    // 800 到達でラップ (ex: 700+200=900 → progress=100)
    this._progress = rawNew >= 800 ? rawNew % 800 : rawNew;
    const newly: StreakIndex[] = [];
    for (let i = 0; i < STREAK_DEFS.length; i += 1) {
      if (this._banked[i]) continue; // 既バンク済みは再バンクしない
      const cost = STREAK_DEFS[i]!.cost;
      if (prev < cost && rawNew >= cost) {
        this._banked[i] = true;
        newly.push(i as StreakIndex);
      }
    }
    return newly;
  }

  /** 死亡: progress をリセット (バンク済みストリークは保持) */
  onDeath(): void {
    this._progress = 0;
  }

  /**
   * ストリーク発動: バンク済みなら消費して true を返す。
   * 未バンクまたはゾンビモードなら false (Match 側でゾンビガードを行う)。
   */
  tryConsume(idx: StreakIndex): boolean {
    if (!this._banked[idx]) return false;
    this._banked[idx] = false;
    return true;
  }

  /** 指定インデックスのストリークを強制バンク(ケアパッケージの報酬付与に使う) */
  forceBankOne(preferIdx: StreakIndex): StreakIndex {
    // 未バンクのものを優先してバンク。preferIdx が既バンクなら次の未バンクへ
    for (let pass = 0; pass < 2; pass += 1) {
      const start = pass === 0 ? (preferIdx as number) : 0;
      for (let i = start; i < STREAK_DEFS.length; i += 1) {
        if (!this._banked[i]) {
          this._banked[i] = true;
          return i as StreakIndex;
        }
      }
    }
    // 全てバンク済みの場合: 最後のものを上書き(稀ケース)
    this._banked[STREAK_DEFS.length - 1] = true;
    return (STREAK_DEFS.length - 1) as StreakIndex;
  }

  get state(): { progress: number; banked: readonly boolean[] } {
    return { progress: this._progress, banked: this._banked };
  }
}
