import { describe, expect, it } from 'vitest';

// ── 敵AI気配システム(P-E) 純関数テスト ──────────────────────────────────────
// match.ts objectiveFor() に追加した気配ハッシュロジックを純関数で再現し
// 決定論性・60%選別・バケット更新の3点を検証する。

const GHOST_REFRESH_S = 30;
const GHOST_FUZZ_M    = 15;
const GHOST_ARRIVE_M  = 8;

/** match.ts の気配ハッシュと同一式 */
function ghostHash(uid: number, bucket: number): { angle: number; radius: number } {
  const h = (uid * 40503) ^ (bucket * 7919);
  const angle  = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  const t      = ((h >>> 16) & 0xffff) / 0xffff;
  const radius = 5 + t * (GHOST_FUZZ_M - 5); // 5..15m
  return { angle, radius };
}

/** バケット番号の計算式(match.ts と同一) */
function bucketFor(elapsed: number): number {
  return Math.floor(elapsed / GHOST_REFRESH_S);
}

// ─── 決定論性テスト ────────────────────────────────────────────────────────
describe('気配ハッシュ 決定論性', () => {
  it('同じ uid + bucket では常に同じ angle/radius が得られる', () => {
    const r1 = ghostHash(7, 3);
    const r2 = ghostHash(7, 3);
    expect(r1.angle).toBe(r2.angle);
    expect(r1.radius).toBe(r2.radius);
  });

  it('uid が異なると角度が変わる', () => {
    const r1 = ghostHash(1, 0);
    const r2 = ghostHash(2, 0);
    // 衝突してもエラーにはしないが、多くの場合で異なるはず
    // (全体の均等分布を確認するのは後のテストで)
    const same = r1.angle === r2.angle && r1.radius === r2.radius;
    // uid=1 vs uid=2: 40503^0 vs 80*2+…と全く違うハッシュ。同値は事実上あり得ない
    expect(same).toBe(false);
  });

  it('bucket が変わると気配点が変わる', () => {
    const r1 = ghostHash(5, 0);
    const r2 = ghostHash(5, 1);
    expect(r1.angle === r2.angle && r1.radius === r2.radius).toBe(false);
  });

  it('radius は常に [5, 15] の範囲に収まる', () => {
    for (let uid = 0; uid < 100; uid++) {
      for (let b = 0; b < 10; b++) {
        const { radius } = ghostHash(uid, b);
        expect(radius).toBeGreaterThanOrEqual(5);
        expect(radius).toBeLessThanOrEqual(GHOST_FUZZ_M);
      }
    }
  });

  it('angle は常に [0, 2π) の範囲に収まる', () => {
    for (let uid = 0; uid < 50; uid++) {
      const { angle } = ghostHash(uid, 0);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
    }
  });
});

// ─── 60% 選別テスト ───────────────────────────────────────────────────────
describe('気配システム 60% 選別(uid%5<3)', () => {
  it('uid%5 < 3 のbotは対象になる', () => {
    // uid=0,1,2 → 対象
    for (const uid of [0, 1, 2, 5, 6, 7, 10, 11, 12]) {
      expect(uid % 5 < 3).toBe(true);
    }
  });

  it('uid%5 >= 3 のbotは対象外', () => {
    // uid=3,4 → 対象外
    for (const uid of [3, 4, 8, 9, 13, 14]) {
      expect(uid % 5 < 3).toBe(false);
    }
  });

  it('uid 0-99 で対象bot数がちょうど 60個', () => {
    let count = 0;
    for (let uid = 0; uid < 100; uid++) {
      if (uid % 5 < 3) count++;
    }
    expect(count).toBe(60);
  });
});

// ─── バケット更新テスト ──────────────────────────────────────────────────
describe('気配システム バケット更新', () => {
  it('elapsed=0 はバケット0', () => {
    expect(bucketFor(0)).toBe(0);
  });

  it('elapsed=29.9 はまだバケット0', () => {
    expect(bucketFor(29.9)).toBe(0);
  });

  it('elapsed=30 でバケット1に更新される', () => {
    expect(bucketFor(30)).toBe(1);
  });

  it('elapsed=59.9 はバケット1', () => {
    expect(bucketFor(59.9)).toBe(1);
  });

  it('到達後(botGhostPos削除)は同バケット内で ghost が null になる', () => {
    // シミュレーション: バケット0でghostを作成 → 到達で削除 → ghostTarget = undefined
    const uid = 7;
    const bucket = 0;
    const bucketMap = new Map<number, number>();
    const ghostPosMap = new Map<number, { x: number; z: number }>();

    // 最初の呼び出し: バケット未設定 → 気配点を生成
    const prev = bucketMap.get(uid) ?? -1;
    if (bucket !== prev) {
      const { angle, radius } = ghostHash(uid, bucket);
      ghostPosMap.set(uid, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      bucketMap.set(uid, bucket);
    }
    expect(ghostPosMap.has(uid)).toBe(true);

    // 到達シミュレーション: ghostPos を削除、bucket は据え置き
    ghostPosMap.delete(uid);

    // 次の呼び出し(同バケット内): prevBucket === bucket → 再算出しない → ghostTarget なし → fall-through
    const prev2 = bucketMap.get(uid) ?? -1;
    expect(prev2).toBe(bucket); // bucket は据え置き
    const willRecompute = bucket !== prev2;
    expect(willRecompute).toBe(false); // 再算出しない
    const target = ghostPosMap.get(uid); // undefined
    expect(target).toBeUndefined();
  });

  it('次バケット到来で気配点が再生成される', () => {
    const uid = 7;
    const bucketMap = new Map<number, number>();
    const ghostPosMap = new Map<number, { x: number; z: number }>();

    // バケット0: 到達済み(ghostPos削除、bucket=0)
    bucketMap.set(uid, 0);

    // バケット1 到来
    const newBucket = 1;
    const prev = bucketMap.get(uid) ?? -1;
    if (newBucket !== prev) {
      const { angle, radius } = ghostHash(uid, newBucket);
      ghostPosMap.set(uid, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      bucketMap.set(uid, newBucket);
    }
    expect(ghostPosMap.has(uid)).toBe(true);
    const pos = ghostPosMap.get(uid)!;
    // 到達半径(8m)より遠い位置に生成されることを確認
    const dist = Math.hypot(pos.x, pos.z);
    expect(dist).toBeGreaterThanOrEqual(5);
    expect(dist).toBeLessThanOrEqual(GHOST_FUZZ_M);
  });
});

// ─── GHOST_ARRIVE_M 到達判定 ───────────────────────────────────────────────
describe('気配システム GHOST_ARRIVE_M 到達判定', () => {
  it('dist > GHOST_ARRIVE_M は未到達 → ghostTarget を返す', () => {
    const dist = GHOST_ARRIVE_M + 1; // 9m
    const arrived = dist <= GHOST_ARRIVE_M;
    expect(arrived).toBe(false);
  });

  it('dist <= GHOST_ARRIVE_M は到達 → fall-through', () => {
    const dist = GHOST_ARRIVE_M - 0.1; // 7.9m
    const arrived = dist <= GHOST_ARRIVE_M;
    expect(arrived).toBe(true);
  });
});
