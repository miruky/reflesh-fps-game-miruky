import { describe, expect, it } from 'vitest';
import { mulberry32, pick, range, rangeInt } from './rng';

describe('mulberry32', () => {
  it('同じシードから同じ系列を生む', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('値は[0, 1)に収まる', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 1000; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('補助関数', () => {
  it('rangeIntは両端を含む', () => {
    const rand = mulberry32(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(rangeInt(rand, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('rangeは区間内', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 100; i += 1) {
      const v = range(rand, 2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(4);
    }
  });

  it('pickは空配列を拒否する', () => {
    const rand = mulberry32(1);
    expect(() => pick(rand, [])).toThrow();
    expect(pick(rand, ['a'])).toBe('a');
  });
});
