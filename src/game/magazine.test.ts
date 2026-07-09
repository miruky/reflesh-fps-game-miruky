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

  // ─── setCapacity(拡張マガジンパーク用) ────────────────────────────────────

  it('setCapacity(refill=true): 容量を増やし差分を即座にreserveから補充する', () => {
    const mag = new Magazine(30, Infinity);
    mag.fire();
    mag.fire(); // rounds=28
    mag.setCapacity(45, true);
    expect(mag.capacity).toBe(45);
    expect(mag.rounds).toBe(45); // 満タンまで即補充(気持ちよさ要件)
  });

  it('setCapacity(refill=true): reserveが有限で不足していれば埋まる分だけ補充する', () => {
    const mag = new Magazine(30, 5);
    for (let i = 0; i < 30; i += 1) mag.fire(); // rounds=0
    mag.setCapacity(45, true);
    expect(mag.capacity).toBe(45);
    expect(mag.rounds).toBe(5); // reserveの5発しか補充できない
    expect(mag.reserve).toBe(5); // finishReloadと異なりreserveは消費しない(拡張自体は無償)
  });

  it('setCapacity(refill=false): roundsは変更せず容量だけ増える', () => {
    const mag = new Magazine(30, Infinity);
    mag.fire(); // rounds=29
    mag.setCapacity(45, false);
    expect(mag.capacity).toBe(45);
    expect(mag.rounds).toBe(29);
  });

  it('setCapacity(refill=false): 容量を下げた場合roundsを新容量までclampする', () => {
    const mag = new Magazine(30, Infinity);
    mag.setCapacity(10, false);
    expect(mag.capacity).toBe(10);
    expect(mag.rounds).toBe(10);
  });
});
