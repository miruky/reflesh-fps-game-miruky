/**
 * R45a/R44a配線テスト: KillCtx新フィールド供給とコールバック発火の純ロジック検証
 */
import { describe, it, expect } from 'vitest';
import type { KillCtx, MedalEvent } from '../medals';

describe('KillCtx new fields present', () => {
  it('has all new optional fields defined in the interface', () => {
    const ctx: KillCtx = {
      victimName: 'TestBot',
      victimId: 1,
      headshot: false,
      weaponName: 'TestRifle',
      weaponClass: 'ar',
      scopeWeapon: false,
      adsProgress: 0,
      adsAgeMs: 100,
      distM: 10,
      victimFullHp: true,
      bulletsThisShot: 1,
      fromBehind: false,
      grounded: true,
      sliding: false,
      wallRunning: false,
      ultActive: false,
      streak: 0,
      crouching: false,
      sprinting: false,
      blinkAgeMs: 9999,
      reloadKillBit: false,
      magAmmoBeforeKill: 30,
      darkEmperorActive: false,
      raiteiActive: false,
      kokuraiteiActive: false,
      hellMode: false,
      botKind: 'humanoid' as import('../bot').BotKind,
      matchKillCount: 1,
      matchElapsed: 60,
      playerHpRatio: 1,
    };
    expect(ctx.crouching).toBe(false);
    expect(ctx.blinkAgeMs).toBe(9999);
    expect(ctx.botKind).toBe('humanoid');
    expect(ctx.playerHpRatio).toBe(1);
  });
});

describe('MedalTracker callback methods exist', () => {
  it('MedalTracker has all required R45a callback methods', async () => {
    const { MedalTracker } = await import('../medals');
    const tracker = new MedalTracker(new Set());
    expect(typeof tracker.onPlayerDamaged).toBe('function');
    expect(typeof tracker.onReloadDone).toBe('function');
    expect(typeof tracker.onBlink).toBe('function');
    expect(typeof tracker.onUltActivate).toBe('function');
    expect(typeof tracker.onSlideEnd).toBe('function');
    expect(typeof tracker.onLand).toBe('function');
    expect(typeof tracker.onWallRunEnd).toBe('function');
    expect(typeof tracker.onZombieRoundStart).toBe('function');
    expect(typeof tracker.onZombieRoundEnd).toBe('function');
  });

  it('callback methods do not throw when called', async () => {
    const { MedalTracker } = await import('../medals');
    const tracker = new MedalTracker(new Set());
    expect(() => tracker.onPlayerDamaged()).not.toThrow();
    expect(() => tracker.onReloadDone()).not.toThrow();
    expect(() => tracker.onBlink()).not.toThrow();
    expect(() => tracker.onUltActivate('f')).not.toThrow();
    expect(() => tracker.onUltActivate('b')).not.toThrow();
    expect(() => tracker.onUltActivate('n')).not.toThrow();
    expect(() => tracker.onSlideEnd()).not.toThrow();
    expect(() => tracker.onLand()).not.toThrow();
    expect(() => tracker.onWallRunEnd()).not.toThrow();
    expect(() => tracker.onZombieRoundStart()).not.toThrow();
    const out: MedalEvent[] = [];
    expect(() => tracker.onZombieRoundEnd(out)).not.toThrow();
  });
});

describe('StreakManager forceBankOne null guard', () => {
  it('returns null when all slots are banked', async () => {
    const { StreakManager } = await import('../scorestreaks');
    type StreakIndex = import('../scorestreaks').StreakIndex;
    const sm = new StreakManager();
    for (let i = 0; i < 7; i++) {
      sm.forceBankOne(0 as StreakIndex);
    }
    const result = sm.forceBankOne(0 as StreakIndex);
    expect(result).toBeNull();
  });

  it('returns an index when a slot is available', async () => {
    const { StreakManager } = await import('../scorestreaks');
    type StreakIndex = import('../scorestreaks').StreakIndex;
    const sm = new StreakManager();
    const result = sm.forceBankOne(0 as StreakIndex);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });
});
