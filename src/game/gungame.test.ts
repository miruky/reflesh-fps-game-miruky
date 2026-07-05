import { describe, expect, it } from 'vitest';
import { GG_LADDER, GunGameState } from './modes';

// ─── GG_LADDER ─────────────────────────────────────────────────────────────────

describe('GG_LADDER', () => {
  it('ちょうど20段ある', () => {
    expect(GG_LADDER.length).toBe(20);
  });

  it('最後がfists(ナイフ)', () => {
    expect(GG_LADDER[19]).toBe('fists');
  });

  it('重複エントリがない', () => {
    const unique = new Set(GG_LADDER);
    expect(unique.size).toBe(GG_LADDER.length);
  });
});

// ─── GunGameState ──────────────────────────────────────────────────────────────

describe('GunGameState', () => {
  // プレイヤー側

  it('初期ランクは1', () => {
    const gg = new GunGameState();
    expect(gg.getPlayerRank()).toBe(1);
  });

  it('1キルでランク2になる', () => {
    const gg = new GunGameState();
    const { newRank, isWin } = gg.playerRankUp();
    expect(newRank).toBe(2);
    expect(isWin).toBe(false);
  });

  it('ランク19→20でまだ勝利ではない(ランク20に到達しただけ)', () => {
    const gg = new GunGameState();
    for (let i = 0; i < 18; i++) gg.playerRankUp();
    const { newRank, isWin } = gg.playerRankUp(); // 19→20
    expect(newRank).toBe(20);
    expect(isWin).toBe(false);
  });

  it('ランク20でキルすると isWin = true', () => {
    const gg = new GunGameState();
    for (let i = 0; i < 19; i++) gg.playerRankUp(); // → rank 20
    expect(gg.getPlayerRank()).toBe(20);
    const { isWin } = gg.playerRankUp(); // rank 20でのキル = 勝利
    expect(isWin).toBe(true);
  });

  it('ランクは20を超えない', () => {
    const gg = new GunGameState();
    for (let i = 0; i < 25; i++) gg.playerRankUp();
    expect(gg.getPlayerRank()).toBe(20);
  });

  it('ランクダウンは1未満にならない', () => {
    const gg = new GunGameState();
    const rank = gg.playerRankDown();
    expect(rank).toBe(1);
    expect(gg.getPlayerRank()).toBe(1);
  });

  it('ランクアップしてからダウンすると1段戻る', () => {
    const gg = new GunGameState();
    gg.playerRankUp();   // → 2
    gg.playerRankUp();   // → 3
    const rank = gg.playerRankDown(); // → 2
    expect(rank).toBe(2);
    expect(gg.getPlayerRank()).toBe(2);
  });

  // Bot側

  it('初期ボットランクは1', () => {
    const gg = new GunGameState();
    expect(gg.getBotRank(42)).toBe(1);
  });

  it('botRankUpでランクが上がる', () => {
    const gg = new GunGameState();
    const { newRank, isWin } = gg.botRankUp(42);
    expect(newRank).toBe(2);
    expect(isWin).toBe(false);
  });

  it('ボットもランク20でキルすると isWin = true', () => {
    const gg = new GunGameState();
    for (let i = 0; i < 19; i++) gg.botRankUp(99); // → rank 20
    const { isWin } = gg.botRankUp(99);
    expect(isWin).toBe(true);
  });

  it('botRankDownでランクが下がる', () => {
    const gg = new GunGameState();
    gg.botRankUp(1);
    gg.botRankUp(1);
    const rank = gg.botRankDown(1);
    expect(rank).toBe(2);
  });

  it('botRankDownは1未満にならない', () => {
    const gg = new GunGameState();
    expect(gg.botRankDown(1)).toBe(1);
  });

  // topBotRank

  it('topBotRankは最も高いボットランクを返す', () => {
    const gg = new GunGameState();
    gg.botRankUp(1);
    gg.botRankUp(1);
    gg.botRankUp(2);
    gg.botRankUp(3);
    gg.botRankUp(3);
    gg.botRankUp(3);
    expect(gg.topBotRank([1, 2, 3])).toBe(4);
  });

  it('ボットが1体もいない場合は0', () => {
    const gg = new GunGameState();
    expect(gg.topBotRank([])).toBe(0);
  });

  // getWeaponIdAt

  it('getWeaponIdAtはラダーIDを返す', () => {
    const gg = new GunGameState();
    expect(gg.getWeaponIdAt(1)).toBe(GG_LADDER[0]);
    expect(gg.getWeaponIdAt(20)).toBe('fists');
  });

  it('getWeaponIdAtは範囲外でもクランプする', () => {
    const gg = new GunGameState();
    expect(gg.getWeaponIdAt(0)).toBe(GG_LADDER[0]);
    expect(gg.getWeaponIdAt(21)).toBe('fists');
  });

  // UID独立性

  it('異なるボットUIDのランクは独立している', () => {
    const gg = new GunGameState();
    gg.botRankUp(10);
    gg.botRankUp(10);
    gg.botRankUp(20);
    expect(gg.getBotRank(10)).toBe(3);
    expect(gg.getBotRank(20)).toBe(2);
    expect(gg.getBotRank(30)).toBe(1);
  });
});
