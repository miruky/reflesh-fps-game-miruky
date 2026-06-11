// mulberry32: シード付き32bit PRNG。ステージ生成の決定論性を保証するため
// Math.randomは生成系では使わない。
export type Rand = () => number;

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rangeInt(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function range(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min);
}

export function pick<T>(rand: Rand, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
}
