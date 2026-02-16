import { describe, expect, it } from 'vitest';
import { Magazine } from './magazine';

describe('Magazine', () => {
  it('発射で残弾が減り、空では撃てない', () => {
    const mag = new Magazine(3, 10);
    expect(mag.fire()).toBe(true);
    expect(mag.fire()).toBe(true);
    expect(mag.fire()).toBe(true);
    expect(mag.fire()).toBe(false);
    expect(mag.isEmpty).toBe(true);
  });

  it('残弾ありはタクティカル、空は空リロード', () => {
    const mag = new Magazine(3, 10);
    mag.fire();
    expect(mag.reloadKind()).toBe('tactical');
    mag.fire();
    mag.fire();
    expect(mag.reloadKind()).toBe('empty');
  });

  it('リロードは所持弾から補充する', () => {
    const mag = new Magazine(30, 40);
    for (let i = 0; i < 25; i += 1) mag.fire();
    mag.finishReload();
    expect(mag.rounds).toBe(30);
    expect(mag.reserve).toBe(15);
  });

  it('所持弾が足りなければあるだけ込める', () => {
    const mag = new Magazine(30, 5);
    for (let i = 0; i < 30; i += 1) mag.fire();
    mag.finishReload();
    expect(mag.rounds).toBe(5);
    expect(mag.reserve).toBe(0);
    expect(mag.canReload).toBe(false);
  });

  it('満タンではリロードできない', () => {
    const mag = new Magazine(30, 90);
    expect(mag.canReload).toBe(false);
  });
});
