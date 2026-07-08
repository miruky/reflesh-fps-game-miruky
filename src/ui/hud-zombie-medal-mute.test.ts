import { describe, expect, it } from 'vitest';
import { isZombieRepeatBadgeMuted } from './hud';

// ゾンビモード中は再達成(firstUnlock=false)のバッジ通知(中央カード)を抑止し、
// 左フィード(pushMedalText)の軽量表示だけを残す。初取得は常にフル演出のまま。
// 非ゾンビモードは既存挙動をビット単位で変えない(常にfalse=抑止しない)。
describe('isZombieRepeatBadgeMuted (R: ゾンビ実績通知の抑止)', () => {
  it('非ゾンビモードでは firstUnlock の真偽に関わらず抑止しない(既存挙動を変えない)', () => {
    expect(isZombieRepeatBadgeMuted(true, false)).toBe(false);
    expect(isZombieRepeatBadgeMuted(false, false)).toBe(false);
  });

  it('ゾンビモードで firstUnlock=true(初取得)は抑止しない(バッジ+実績解放演出をフル表示)', () => {
    expect(isZombieRepeatBadgeMuted(true, true)).toBe(false);
  });

  it('ゾンビモードで firstUnlock=false(再達成)はバッジ通知を抑止する(左フィードのみ)', () => {
    expect(isZombieRepeatBadgeMuted(false, true)).toBe(true);
  });
});
