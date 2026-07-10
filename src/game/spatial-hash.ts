// R54-W1(B1) 物理ライト化: 密集ゾンビの空間ハッシュによる個体間分離。
//
// 背景: hordeRank>=ZOMBIE_HORDE_THIN_RANK(群衆後方)の個体は bot.ts 側で
// computeColliderMovement のfilterPredicateにより「他ゾンビコライダー」を衝突解決の
// 対象から除外する(密集時のKCC負荷を30〜50%削減する狙い)。これにより対ゾンビ衝突が
// 効かなくなった個体同士は互いにすり抜けて重なり得るため、代わりにこの軽量な空間ハッシュ
// (物理エンジンを介さない2D XZ平面の格子)で「近すぎる個体からの反発ベクトル」を計算し、
// bot.ts 側が updateZombie の wish(移動意思)へ加算する形で見た目の重なりを緩和する。
//
// 純粋モジュール: THREE/RAPIERに依存しない({uid,x,z}のプレーンなタプルのみを扱う)。
// アロケゼロ設計: rebuild()は固定型付き配列(Int32Array/Float32Array)を必要時のみ倍々に
// 拡張して再利用し、格子バケットはMap<cellKey, number[]>を保持したまま配列を
// length=0でクリアして使い回す(定常状態ではGCを起こさない)。
//
// 呼び出し契約(申し送り): rebuild()は誰かが定期的(目安0.25s間隔。matchのhordeRank
// 再計算と同じ周期)に全ゾンビの{uid,x,z}を渡して呼ぶ必要があるが、本ラウンドの担当範囲
// (bot.ts + このファイルのみ)では配線先が未確定のため、呼び出し配線は行わない。
// rebuild()が一度も呼ばれない間は内部の格子が空のままなので、separation()は常に
// {x:0, z:0}を返す = 呼び出し側(bot.ts)から見て完全非回帰(分離量ゼロ)が保証される。

/** 格子セルの一辺(m)。反発判定距離(1.2m)より大きく取り、自セル+8近傍の走査だけで
 * 距離1.2m以内の全ペアを漏れなく検出できるようにする(標準的な空間ハッシュの保証)。*/
export const ZOMBIE_SEP_CELL_M = 1.5;
/** この距離未満の他個体から反発を受ける(重なり回避の判定半径)。*/
export const ZOMBIE_SEP_RANGE_M = 1.2;
/** 反発ベクトルの最大値(m/s相当)。重なりが深いほど比例して増え、この値で頭打ちになる。*/
export const ZOMBIE_SEP_MAX_MPS = 0.5;

/** rebuild() に渡す1個体分のエントリ。*/
export interface ZombieSeparationEntry {
  uid: number;
  x: number;
  z: number;
}

function cellKey(cx: number, cz: number): number {
  // 座標をオフセットして非負化し1本のintへパック。±32768セル(1.5m格子で±49km相当)
  // まで衝突なく扱え、本プロジェクトの最大ステージ(360m四方)に十分な余裕がある。
  return (cx + 32768) * 65536 + (cz + 32768);
}

/**
 * 密集ゾンビの重なり回避用・軽量空間ハッシュ。
 *
 * rebuild(entries) で全個体のXZ位置を格子へ登録し、separation(uid, x, z, out) で
 * 「その位置から見て1.2m以内にいる他個体からの反発ベクトル合算」を out へ書き込む。
 * 60Hzの毎フレーム呼び出しを想定し、separation() 自体はアロケーションを行わない。
 */
export class ZombieSeparationGrid {
  private count = 0;
  private uidArr = new Int32Array(0);
  private xArr = new Float32Array(0);
  private zArr = new Float32Array(0);
  // セルキー→登録エントリのindex配列。配列自体は再利用し、rebuild毎に length=0 でクリアする
  // (V8的には一度確保した配列の内部capacityは維持されるため、定常状態では再アロケが起きない)。
  private readonly buckets = new Map<number, number[]>();

  private ensureCapacity(n: number): void {
    if (n <= this.uidArr.length) return;
    const cap = Math.max(n, this.uidArr.length * 2, 64);
    const newUid = new Int32Array(cap);
    const newX = new Float32Array(cap);
    const newZ = new Float32Array(cap);
    newUid.set(this.uidArr);
    newX.set(this.xArr);
    newZ.set(this.zArr);
    this.uidArr = newUid;
    this.xArr = newX;
    this.zArr = newZ;
  }

  /** 全個体のXZ位置で格子を再構築する。既存バケット配列はクリアして再利用する。 */
  rebuild(entries: readonly ZombieSeparationEntry[]): void {
    this.ensureCapacity(entries.length);
    this.count = entries.length;
    for (const bucket of this.buckets.values()) bucket.length = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i]!;
      this.uidArr[i] = e.uid;
      this.xArr[i] = e.x;
      this.zArr[i] = e.z;
      const cx = Math.floor(e.x / ZOMBIE_SEP_CELL_M);
      const cz = Math.floor(e.z / ZOMBIE_SEP_CELL_M);
      const key = cellKey(cx, cz);
      let bucket = this.buckets.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  /** 格子を空にする(次回のseparation()は常にゼロを返す)。試合終了時の後始末用。 */
  clear(): void {
    this.count = 0;
    for (const bucket of this.buckets.values()) bucket.length = 0;
  }

  /** 現在rebuild()で登録済みのエントリ数(テスト/計測用)。 */
  get size(): number {
    return this.count;
  }

  /**
   * (x, z) にいる uid の個体へ働く反発ベクトルを out へ書き込む(加算ではなく上書き)。
   * 自セル+8近傍のみを走査するため、格子内の総数によらず密集時も一定コストに近い。
   * rebuild()が一度も呼ばれていない(=格子が空)場合は常に {x:0, z:0}。
   */
  separation(uid: number, x: number, z: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    if (this.buckets.size === 0) return;
    const cx = Math.floor(x / ZOMBIE_SEP_CELL_M);
    const cz = Math.floor(z / ZOMBIE_SEP_CELL_M);
    const rangeSq = ZOMBIE_SEP_RANGE_M * ZOMBIE_SEP_RANGE_M;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = this.buckets.get(cellKey(cx + dx, cz + dz));
        if (bucket === undefined) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          const idx = bucket[k]!;
          if (this.uidArr[idx] === uid) continue;
          const ox = this.xArr[idx]!;
          const oz = this.zArr[idx]!;
          const ddx = x - ox;
          const ddz = z - oz;
          const distSq = ddx * ddx + ddz * ddz;
          if (distSq >= rangeSq) continue;
          const dist = Math.sqrt(distSq);
          if (dist < 1e-4) continue; // 完全同座標は方向不定なので無視(実際はほぼ発生しない)
          const overlap = ZOMBIE_SEP_RANGE_M - dist; // 0..range
          const mag = (overlap / ZOMBIE_SEP_RANGE_M) * ZOMBIE_SEP_MAX_MPS; // 0..max、重なり比例
          const invDist = 1 / dist;
          out.x += ddx * invDist * mag;
          out.z += ddz * invDist * mag;
        }
      }
    }
  }
}
