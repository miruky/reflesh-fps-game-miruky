import { describe, expect, it } from 'vitest';
import {
  type ZombiePerkId,
  BOX_MOVES_CHANCE,
  MYSTERY_BOX_COST,
  MYSTERY_BOX_POOL,
  PERK_LIMIT,
  PERKS,
  POINTS,
  WALL_BUYS,
  buyResult,
  canBuy,
  generateShopLayout,
  getPerkEffect,
  purchasePerk,
  rollMysteryBox,
} from './zombie-economy';

// ─── POINTS定数 ───────────────────────────────────────────────────────────────

describe('POINTS定数', () => {
  it('BO2仕様値と一致する', () => {
    expect(POINTS.hit).toBe(10);
    expect(POINTS.kill).toBe(60);
    expect(POINTS.hskill).toBe(110);
    expect(POINTS.melee).toBe(130);
  });
});

// ─── MYSTERY_BOX_COST ─────────────────────────────────────────────────────────

describe('MYSTERY_BOX_COST', () => {
  it('950', () => {
    expect(MYSTERY_BOX_COST).toBe(950);
  });
});

// ─── PERKS ────────────────────────────────────────────────────────────────────

describe('PERKS', () => {
  it('juggernog: 価格2500・maxHpMultiplier=2.5', () => {
    const p = PERKS['juggernog'];
    expect(p.price).toBe(2500);
    expect(p.effect.maxHpMultiplier).toBe(2.5);
  });

  it('speed-cola: 価格3000・reloadMultiplier=0.5', () => {
    const p = PERKS['speed-cola'];
    expect(p.price).toBe(3000);
    expect(p.effect.reloadMultiplier).toBe(0.5);
  });

  it('double-tap: 価格2000・fireRateMultiplier≈1.33・damageMultiplier=1.6', () => {
    const p = PERKS['double-tap'];
    expect(p.price).toBe(2000);
    expect(p.effect.fireRateMultiplier).toBeCloseTo(1.33, 5);
    expect(p.effect.damageMultiplier).toBe(1.6);
  });

  it('stamin-up: 価格2000・moveMultiplier≈1.07', () => {
    const p = PERKS['stamin-up'];
    expect(p.price).toBe(2000);
    expect(p.effect.moveMultiplier).toBeCloseTo(1.07, 5);
  });

  it('quick-revive: 価格500・selfReviveCharges=1', () => {
    const p = PERKS['quick-revive'];
    expect(p.price).toBe(500);
    expect(p.effect.selfReviveCharges).toBe(1);
  });

  it('PERK_LIMIT は 4', () => {
    expect(PERK_LIMIT).toBe(4);
  });
});

// ─── WALL_BUYS ────────────────────────────────────────────────────────────────

describe('WALL_BUYS', () => {
  it('ちょうど12本ある(標準8 + 特殊兵装4)', () => {
    expect(WALL_BUYS).toHaveLength(12);
  });

  it('入門500が2本', () => {
    expect(WALL_BUYS.filter((w) => w.price === 500)).toHaveLength(2);
  });

  it('AR級1200が2本', () => {
    expect(WALL_BUYS.filter((w) => w.price === 1200)).toHaveLength(2);
  });

  it('強武器1500が2本', () => {
    expect(WALL_BUYS.filter((w) => w.price === 1500)).toHaveLength(2);
  });

  it('fists 3500が1本(クナイ価格改定)', () => {
    expect(WALL_BUYS.filter((w) => w.weaponId === 'fists')).toHaveLength(1);
    expect(WALL_BUYS.find((w) => w.weaponId === 'fists')?.price).toBe(3500);
  });

  it('yamasemi-dmr 2500が1本', () => {
    expect(WALL_BUYS.filter((w) => w.weaponId === 'yamasemi-dmr')).toHaveLength(1);
    expect(WALL_BUYS.find((w) => w.weaponId === 'yamasemi-dmr')?.price).toBe(2500);
  });

  it('特殊兵装4本の価格が正しい', () => {
    expect(WALL_BUYS.find((w) => w.weaponId === 'gouka-rl')?.price).toBe(2500);
    expect(WALL_BUYS.find((w) => w.weaponId === 'shura-lmg')?.price).toBe(3000);
    expect(WALL_BUYS.find((w) => w.weaponId === 'gekkou-bow')?.price).toBe(2200);
    expect(WALL_BUYS.find((w) => w.weaponId === 'tenrai-staff')?.price).toBe(2800);
  });

  it('全 weaponId が weapons.ts の実在武器', () => {
    const knownIds = new Set([
      'hiiragi-sg',
      'tsubaki-smg',
      'kaede-ar',
      'ginyanma-ar',
      'miyama-br',
      'kasasagi-ar',
      'fists',
      'yamasemi-dmr',
      'gouka-rl',
      'shura-lmg',
      'gekkou-bow',
      'tenrai-staff',
    ]);
    for (const wb of WALL_BUYS) {
      expect(knownIds.has(wb.weaponId)).toBe(true);
    }
  });
});

// ─── MYSTERY_BOX_POOL ─────────────────────────────────────────────────────────

describe('MYSTERY_BOX_POOL', () => {
  it('fists を含まない', () => {
    expect(MYSTERY_BOX_POOL).not.toContain('fists');
  });

  it('スナイパー・LMG が含まれる', () => {
    expect(MYSTERY_BOX_POOL).toContain('yamasemi-dmr');
    expect(MYSTERY_BOX_POOL).toContain('raicho-sniper');
    expect(MYSTERY_BOX_POOL).toContain('kumagera-lmg');
  });

  it('セカンダリexotic(banjin-smg/misago-pistol)が追加されている', () => {
    expect(MYSTERY_BOX_POOL).toContain('banjin-smg');
    expect(MYSTERY_BOX_POOL).toContain('misago-pistol');
  });

  it('24武器以上が在庫される', () => {
    expect(MYSTERY_BOX_POOL.length).toBeGreaterThanOrEqual(24);
  });
});

// ─── canBuy ───────────────────────────────────────────────────────────────────

describe('canBuy', () => {
  it('残高 >= cost → true', () => {
    expect(canBuy(500, 500)).toBe(true);
    expect(canBuy(1000, 500)).toBe(true);
  });

  it('残高 < cost → false', () => {
    expect(canBuy(499, 500)).toBe(false);
    expect(canBuy(0, 1)).toBe(false);
  });
});

// ─── buyResult ────────────────────────────────────────────────────────────────

describe('buyResult', () => {
  it('差し引き残高を返す', () => {
    expect(buyResult(1000, 500)).toBe(500);
    expect(buyResult(950, 950)).toBe(0);
    expect(buyResult(2500, 2500)).toBe(0);
  });

  it('残高不足で例外を投げる', () => {
    expect(() => buyResult(499, 500)).toThrow();
    expect(() => buyResult(0, 1)).toThrow();
  });
});

// ─── rollMysteryBox ───────────────────────────────────────────────────────────

describe('rollMysteryBox', () => {
  it('rand=常に0 → プール先頭の武器・boxMoves=true', () => {
    // 1回目(武器選択): floor(0 * poolLen) = 0 → pool[0]
    // 2回目(boxMoves): 0 < 0.08 → true
    const result = rollMysteryBox(() => 0);
    expect(result.weaponId).toBe(MYSTERY_BOX_POOL[0] ?? '');
    expect(result.boxMoves).toBe(true);
  });

  it('rand=常に0.99 → プール末尾近くの武器・boxMoves=false', () => {
    // 2回目(boxMoves): 0.99 < 0.08 → false
    const pool = MYSTERY_BOX_POOL;
    const expectedIdx = Math.floor(0.99 * pool.length);
    const result = rollMysteryBox(() => 0.99);
    expect(result.weaponId).toBe(pool[expectedIdx] ?? '');
    expect(result.boxMoves).toBe(false);
  });

  it('返された weaponId は常に MYSTERY_BOX_POOL 内', () => {
    const poolSet = new Set(MYSTERY_BOX_POOL);
    let state = 12345;
    const lcg = () => {
      state = (state * 48271 + 1) % 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let n = 0; n < 300; n += 1) {
      expect(poolSet.has(rollMysteryBox(lcg).weaponId)).toBe(true);
    }
  });

  it('BOX_MOVES_CHANCE の境界: ちょうど threshold は false', () => {
    const threshold = BOX_MOVES_CHANCE;
    // rand() の 1回目=武器選択(0.5)、2回目=boxMoves判定
    let c1 = 0;
    // threshold - ε → boxMoves=true
    const justBelow = () => (c1++ % 2 === 0 ? 0.5 : threshold - 0.001);
    expect(rollMysteryBox(justBelow).boxMoves).toBe(true);

    let c2 = 0;
    // threshold ちょうど → strict less-than なので false
    const exactThreshold = () => (c2++ % 2 === 0 ? 0.5 : threshold);
    expect(rollMysteryBox(exactThreshold).boxMoves).toBe(false);
  });

  it('boxMoves の出現率は約 8%(LCGシード固定)', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let moves = 0;
    const N = 10000;
    for (let n = 0; n < N; n += 1) {
      if (rollMysteryBox(rand).boxMoves) moves += 1;
    }
    // 8% ± 3% の範囲内を期待
    const rate = moves / N;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.11);
  });
});

// ─── getPerkEffect ────────────────────────────────────────────────────────────

describe('getPerkEffect', () => {
  it('juggernog の maxHpMultiplier が 2.5', () => {
    expect(getPerkEffect('juggernog').maxHpMultiplier).toBe(2.5);
  });

  it('speed-cola の reloadMultiplier が 0.5', () => {
    expect(getPerkEffect('speed-cola').reloadMultiplier).toBe(0.5);
  });
});

// ─── purchasePerk ─────────────────────────────────────────────────────────────

describe('purchasePerk', () => {
  it('正常購入: ok=true で残高が減り stackCount=1', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    const res = purchasePerk(stacks, 'juggernog', 3000);
    expect(res.ok).toBe(true);
    expect(res.remainingPoints).toBe(500); // 3000 - 2500
    expect(res.stackCount).toBe(1);
  });

  it('��タック購入: juggernog 2回目購入で stackCount=2', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = { juggernog: 1 };
    const res = purchasePerk(stacks, 'juggernog', 9999);
    expect(res.ok).toBe(true);
    expect(res.stackCount).toBe(2);
    expect(res.remainingPoints).toBe(9999 - 2500);
  });

  it('quick-revive (500) を200ポイントで失敗', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    const res = purchasePerk(stacks, 'quick-revive', 200);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('insufficient-points');
    expect(res.remainingPoints).toBe(200); // 残高不変
  });

  it('quick-revive は charges>0 のとき拒否', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    const res = purchasePerk(stacks, 'quick-revive', 9999, 1);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('quick-revive-charged');
  });

  it('quick-revive は charges=0 のとき ok', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    const res = purchasePerk(stacks, 'quick-revive', 9999, 0);
    expect(res.ok).toBe(true);
    expect(res.stackCount).toBe(1);
  });

  it('残高不足: insufficient-points エラー', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = { 'stamin-up': 5 };
    const res = purchasePerk(stacks, 'stamin-up', 100);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('insufficient-points');
  });

  it('purchasePerk は stacks を変更しない(純関数)', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    purchasePerk(stacks, 'juggernog', 9999);
    expect(Object.keys(stacks)).toHaveLength(0); // stacks は変更されていない
  });
});

// ─── generateShopLayout ───────────────────────────────────────────────────────

describe('generateShopLayout', () => {
  it('同じ seed は全く同じスロット列を返す(決定論)', () => {
    expect(generateShopLayout(163).slots).toEqual(generateShopLayout(163).slots);
    expect(generateShopLayout(211).slots).toEqual(generateShopLayout(211).slots);
  });

  it('異なる seed は異なるレイアウトを返す', () => {
    const a = generateShopLayout(163);
    const b = generateShopLayout(167);
    expect(a.slots).not.toEqual(b.slots);
  });

  it('壁武器スポットが 6〜8 個', () => {
    for (const seed of [163, 167, 173, 179, 181, 191, 193, 197, 199, 211]) {
      const count = generateShopLayout(seed).slots.filter((s) => s.kind === 'wall-buy').length;
      expect(count).toBeGreaterThanOrEqual(6);
      expect(count).toBeLessThanOrEqual(8);
    }
  });

  it('fists と yamasemi-dmr は常に含まれる', () => {
    for (const seed of [163, 167, 173, 179, 181, 191]) {
      const wallIds = generateShopLayout(seed).slots
        .filter((s) => s.kind === 'wall-buy')
        .map((s) => s.weaponId);
      expect(wallIds).toContain('fists');
      expect(wallIds).toContain('yamasemi-dmr');
    }
  });

  it('パーク自販機が 3〜4 台', () => {
    for (const seed of [163, 167, 173, 179, 181, 191, 193, 197, 199, 211]) {
      const count = generateShopLayout(seed).slots.filter(
        (s) => s.kind === 'perk-machine',
      ).length;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    }
  });

  it('ミステリーボックスがちょうど1個', () => {
    for (const seed of [163, 167, 173]) {
      const count = generateShopLayout(seed).slots.filter(
        (s) => s.kind === 'mystery-box',
      ).length;
      expect(count).toBe(1);
    }
  });

  it('ミステリーボックスのコストは MYSTERY_BOX_COST', () => {
    const box = generateShopLayout(163).slots.find((s) => s.kind === 'mystery-box');
    expect(box?.cost).toBe(MYSTERY_BOX_COST);
  });

  it('slotIndex が 0 始まりの連番', () => {
    generateShopLayout(163).slots.forEach((slot, i) => {
      expect(slot.slotIndex).toBe(i);
    });
  });

  it('壁武器スポットの weaponId は全て WALL_BUYS 内', () => {
    const validIds = new Set(WALL_BUYS.map((w) => w.weaponId));
    for (const slot of generateShopLayout(163).slots) {
      if (slot.kind === 'wall-buy') {
        expect(slot.weaponId).toBeDefined();
        expect(validIds.has(slot.weaponId!)).toBe(true);
      }
    }
  });

  it('パーク自販機の perkId は全て有効な ZombiePerkId', () => {
    const validPerkIds = new Set<string>(Object.keys(PERKS));
    for (const slot of generateShopLayout(163).slots) {
      if (slot.kind === 'perk-machine') {
        expect(slot.perkId).toBeDefined();
        expect(validPerkIds.has(slot.perkId!)).toBe(true);
      }
    }
  });

  it('パーク自販機のコストは PERKS の価格と一致', () => {
    for (const slot of generateShopLayout(163).slots) {
      if (slot.kind === 'perk-machine' && slot.perkId) {
        expect(slot.cost).toBe(PERKS[slot.perkId].price);
      }
    }
  });

  it('同一レイアウト内に重複する壁武器がない', () => {
    for (const seed of [163, 167, 173, 179, 181]) {
      const wallSlots = generateShopLayout(seed).slots.filter((s) => s.kind === 'wall-buy');
      const weaponIds = wallSlots.map((s) => s.weaponId);
      const unique = new Set(weaponIds);
      expect(unique.size).toBe(weaponIds.length);
    }
  });

  it('同一レイアウト内に重複するパーク自販機がない', () => {
    for (const seed of [163, 167, 173, 179, 181]) {
      const perkSlots = generateShopLayout(seed).slots.filter(
        (s) => s.kind === 'perk-machine',
      );
      const perkIds = perkSlots.map((s) => s.perkId);
      const unique = new Set(perkIds);
      expect(unique.size).toBe(perkIds.length);
    }
  });
});
