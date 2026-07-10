import { describe, expect, it } from 'vitest';
import { WEAPON_DEFS } from './weapons';
import {
  type ZombiePerkId,
  type PapTier,
  type PowerUpKind,
  type CharmId,
  type ZombieVariant,
  BOX_MOVES_CHANCE,
  MYSTERY_BOX_COST,
  MYSTERY_BOX_POOL,
  PERKS,
  POINTS,
  WALL_BUYS,
  applyExtMagCapacity,
  buyResult,
  canBuy,
  generateShopLayout,
  getPerkEffect,
  purchasePerk,
  rollMysteryBox,
  composeZombieWeaponDef,
  PAP_DMG_MUL,
  PAP_COST,
  PAP_REFILL_COST,
  rollPowerUp,
  rollPowerUpAt,
  POWERUP_DROP_CHANCE,
  POWERUP_DESPAWN_S,
  POWERUP_ROUND_CAP,
  POWERUP_DURATION_S,
  NUKE_BONUS_PT,
  CARPENTER_BONUS_PT,
  DOOR_COST,
  CHARMS,
  getCharmEffect,
  rollZombieVariant,
  BLAST_RADIUS_M,
  BLAST_DMG,
  MIASMA_RADIUS_M,
  MIASMA_DURATION_S,
  MIASMA_DPS,
  SHELL_FRONT_REDUCTION,
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

  it('ext-mag: 価格1000・magCapacityBonusPerStack=0.5', () => {
    const p = PERKS['ext-mag'];
    expect(p.price).toBe(1000);
    expect(p.effect.magCapacityBonusPerStack).toBe(0.5);
  });

  // PERK_LIMIT(旧: 所持上限4)はR53-W2で撤廃。quick-revive以外は無限スタックが正式仕様。
  // purchasePerk のスタック無限購入テストで代替担保する(下記 describe('purchasePerk') 参照)。
});

// ─── applyExtMagCapacity ────────────────────────────────────────────────────

describe('applyExtMagCapacity', () => {
  it('基礎容量×(1+0.5×スタック数)で線形にスタックする(切り上げ)', () => {
    expect(applyExtMagCapacity(30, 1)).toBe(45);  // ×1.5
    expect(applyExtMagCapacity(30, 2)).toBe(60);  // ×2.0
    expect(applyExtMagCapacity(30, 3)).toBe(75);  // ×2.5
  });

  it('切り上げが効く(奇数マガジンの端数ケース)', () => {
    expect(applyExtMagCapacity(7, 1)).toBe(11); // ceil(10.5)
    expect(applyExtMagCapacity(7, 2)).toBe(14); // ceil(14.0)
    expect(applyExtMagCapacity(7, 3)).toBe(18); // ceil(17.5)
  });

  it('複利ではなく毎回ベース容量からの再計算である(speed-colaと異なる)', () => {
    // 2スタック目の結果を「1スタック目の結果に再度掛ける」のではなく、
    // 常に元の基礎容量から計算し直すことを保証する
    const base = 30;
    const stack1 = applyExtMagCapacity(base, 1); // 45
    const stack2FromBase = applyExtMagCapacity(base, 2); // 60
    const stack2FromCompound = Math.ceil(stack1 * 1.5); // 68 (複利なら誤ってこうなる)
    expect(stack2FromBase).toBe(60);
    expect(stack2FromBase).not.toBe(stack2FromCompound);
  });

  it('stackCount<=0 は基礎容量のまま', () => {
    expect(applyExtMagCapacity(30, 0)).toBe(30);
    expect(applyExtMagCapacity(30, -1)).toBe(30);
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

  it('ext-mag は無限スタック購入可能: 1000ptで1回目 stackCount=1', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = {};
    const res = purchasePerk(stacks, 'ext-mag', 1000);
    expect(res.ok).toBe(true);
    expect(res.remainingPoints).toBe(0);
    expect(res.stackCount).toBe(1);
  });

  it('ext-mag は既存スタックから+1でstackCount=3', () => {
    const stacks: Partial<Record<ZombiePerkId, number>> = { 'ext-mag': 2 };
    const res = purchasePerk(stacks, 'ext-mag', 9999);
    expect(res.ok).toBe(true);
    expect(res.stackCount).toBe(3);
    expect(res.remainingPoints).toBe(9999 - 1000);
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

  it('ext-mag(拡張マガジン)も選出対象に含まれる(十分な数のseedを走査すれば出現する)', () => {
    let seen = false;
    for (let seed = 0; seed < 200; seed += 1) {
      const perkIds = generateShopLayout(seed).slots
        .filter((s) => s.kind === 'perk-machine')
        .map((s) => s.perkId);
      if (perkIds.includes('ext-mag')) { seen = true; break; }
    }
    expect(seen).toBe(true);
  });
});

// ─── generateShopLayout: Pack-a-Punch/ドア追加(R53-W2)─────────────────────────

describe('DOOR_COST', () => {
  it('1750', () => {
    expect(DOOR_COST).toBe(1750);
  });
});

describe('generateShopLayout: pack-a-punch/door 追加後も既存スロットはビット不変', () => {
  // R53-W1時点(本ラウンド着手直前)の generateShopLayout(seed) の実出力をキャプチャした
  // 回帰スナップショット。壁武器/パーク自販機/ミステリーボックスの内容・順序が
  // 一切変化していないことを保証する(「rand消費列の末尾に追加」の実証)。
  const PRE_R53W2_SNAPSHOT: Record<
    string,
    Array<{ kind: string; slotIndex: number; weaponId?: string; perkId?: string; cost: number }>
  > = JSON.parse(
    '{"163":[{"kind":"wall-buy","slotIndex":0,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":1,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":2,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":3,"weaponId":"gekkou-bow","cost":2200},{"kind":"wall-buy","slotIndex":4,"weaponId":"hiiragi-sg","cost":500},{"kind":"wall-buy","slotIndex":5,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":6,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":7,"weaponId":"gouka-rl","cost":2500},{"kind":"perk-machine","slotIndex":8,"perkId":"ext-mag","cost":1000},{"kind":"perk-machine","slotIndex":9,"perkId":"double-tap","cost":2000},{"kind":"perk-machine","slotIndex":10,"perkId":"speed-cola","cost":3000},{"kind":"mystery-box","slotIndex":11,"cost":950}],"167":[{"kind":"wall-buy","slotIndex":0,"weaponId":"ginyanma-ar","cost":1200},{"kind":"wall-buy","slotIndex":1,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":2,"weaponId":"gekkou-bow","cost":2200},{"kind":"wall-buy","slotIndex":3,"weaponId":"kasasagi-ar","cost":1500},{"kind":"wall-buy","slotIndex":4,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":5,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":6,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":7,"weaponId":"shura-lmg","cost":3000},{"kind":"perk-machine","slotIndex":8,"perkId":"ext-mag","cost":1000},{"kind":"perk-machine","slotIndex":9,"perkId":"stamin-up","cost":2000},{"kind":"perk-machine","slotIndex":10,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":11,"perkId":"quick-revive","cost":500},{"kind":"mystery-box","slotIndex":12,"cost":950}],"173":[{"kind":"wall-buy","slotIndex":0,"weaponId":"gekkou-bow","cost":2200},{"kind":"wall-buy","slotIndex":1,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":2,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":3,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":4,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":5,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":6,"weaponId":"ginyanma-ar","cost":1200},{"kind":"wall-buy","slotIndex":7,"weaponId":"tsubaki-smg","cost":500},{"kind":"perk-machine","slotIndex":8,"perkId":"quick-revive","cost":500},{"kind":"perk-machine","slotIndex":9,"perkId":"double-tap","cost":2000},{"kind":"perk-machine","slotIndex":10,"perkId":"speed-cola","cost":3000},{"kind":"mystery-box","slotIndex":11,"cost":950}],"179":[{"kind":"wall-buy","slotIndex":0,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":1,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":2,"weaponId":"hiiragi-sg","cost":500},{"kind":"wall-buy","slotIndex":3,"weaponId":"kasasagi-ar","cost":1500},{"kind":"wall-buy","slotIndex":4,"weaponId":"kaede-ar","cost":1200},{"kind":"wall-buy","slotIndex":5,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":6,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":7,"weaponId":"gekkou-bow","cost":2200},{"kind":"perk-machine","slotIndex":8,"perkId":"speed-cola","cost":3000},{"kind":"perk-machine","slotIndex":9,"perkId":"quick-revive","cost":500},{"kind":"perk-machine","slotIndex":10,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":11,"perkId":"stamin-up","cost":2000},{"kind":"mystery-box","slotIndex":12,"cost":950}],"181":[{"kind":"wall-buy","slotIndex":0,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":1,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":2,"weaponId":"kasasagi-ar","cost":1500},{"kind":"wall-buy","slotIndex":3,"weaponId":"ginyanma-ar","cost":1200},{"kind":"wall-buy","slotIndex":4,"weaponId":"gouka-rl","cost":2500},{"kind":"wall-buy","slotIndex":5,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":6,"weaponId":"tsubaki-smg","cost":500},{"kind":"perk-machine","slotIndex":7,"perkId":"speed-cola","cost":3000},{"kind":"perk-machine","slotIndex":8,"perkId":"ext-mag","cost":1000},{"kind":"perk-machine","slotIndex":9,"perkId":"stamin-up","cost":2000},{"kind":"mystery-box","slotIndex":10,"cost":950}],"191":[{"kind":"wall-buy","slotIndex":0,"weaponId":"gouka-rl","cost":2500},{"kind":"wall-buy","slotIndex":1,"weaponId":"ginyanma-ar","cost":1200},{"kind":"wall-buy","slotIndex":2,"weaponId":"gekkou-bow","cost":2200},{"kind":"wall-buy","slotIndex":3,"weaponId":"tsubaki-smg","cost":500},{"kind":"wall-buy","slotIndex":4,"weaponId":"hiiragi-sg","cost":500},{"kind":"wall-buy","slotIndex":5,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":6,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":7,"weaponId":"fists","cost":3500},{"kind":"perk-machine","slotIndex":8,"perkId":"double-tap","cost":2000},{"kind":"perk-machine","slotIndex":9,"perkId":"stamin-up","cost":2000},{"kind":"perk-machine","slotIndex":10,"perkId":"juggernog","cost":2500},{"kind":"mystery-box","slotIndex":11,"cost":950}],"193":[{"kind":"wall-buy","slotIndex":0,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":1,"weaponId":"kaede-ar","cost":1200},{"kind":"wall-buy","slotIndex":2,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":3,"weaponId":"tsubaki-smg","cost":500},{"kind":"wall-buy","slotIndex":4,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":5,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"perk-machine","slotIndex":6,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":7,"perkId":"quick-revive","cost":500},{"kind":"perk-machine","slotIndex":8,"perkId":"double-tap","cost":2000},{"kind":"perk-machine","slotIndex":9,"perkId":"stamin-up","cost":2000},{"kind":"mystery-box","slotIndex":10,"cost":950}],"197":[{"kind":"wall-buy","slotIndex":0,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":1,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":2,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":3,"weaponId":"kasasagi-ar","cost":1500},{"kind":"wall-buy","slotIndex":4,"weaponId":"kaede-ar","cost":1200},{"kind":"wall-buy","slotIndex":5,"weaponId":"gouka-rl","cost":2500},{"kind":"perk-machine","slotIndex":6,"perkId":"speed-cola","cost":3000},{"kind":"perk-machine","slotIndex":7,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":8,"perkId":"double-tap","cost":2000},{"kind":"mystery-box","slotIndex":9,"cost":950}],"199":[{"kind":"wall-buy","slotIndex":0,"weaponId":"hiiragi-sg","cost":500},{"kind":"wall-buy","slotIndex":1,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":2,"weaponId":"tsubaki-smg","cost":500},{"kind":"wall-buy","slotIndex":3,"weaponId":"tenrai-staff","cost":2800},{"kind":"wall-buy","slotIndex":4,"weaponId":"gekkou-bow","cost":2200},{"kind":"wall-buy","slotIndex":5,"weaponId":"miyama-br","cost":1500},{"kind":"wall-buy","slotIndex":6,"weaponId":"fists","cost":3500},{"kind":"perk-machine","slotIndex":7,"perkId":"stamin-up","cost":2000},{"kind":"perk-machine","slotIndex":8,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":9,"perkId":"quick-revive","cost":500},{"kind":"perk-machine","slotIndex":10,"perkId":"ext-mag","cost":1000},{"kind":"mystery-box","slotIndex":11,"cost":950}],"211":[{"kind":"wall-buy","slotIndex":0,"weaponId":"yamasemi-dmr","cost":2500},{"kind":"wall-buy","slotIndex":1,"weaponId":"shura-lmg","cost":3000},{"kind":"wall-buy","slotIndex":2,"weaponId":"gouka-rl","cost":2500},{"kind":"wall-buy","slotIndex":3,"weaponId":"ginyanma-ar","cost":1200},{"kind":"wall-buy","slotIndex":4,"weaponId":"kaede-ar","cost":1200},{"kind":"wall-buy","slotIndex":5,"weaponId":"fists","cost":3500},{"kind":"wall-buy","slotIndex":6,"weaponId":"hiiragi-sg","cost":500},{"kind":"perk-machine","slotIndex":7,"perkId":"ext-mag","cost":1000},{"kind":"perk-machine","slotIndex":8,"perkId":"juggernog","cost":2500},{"kind":"perk-machine","slotIndex":9,"perkId":"quick-revive","cost":500},{"kind":"mystery-box","slotIndex":10,"cost":950}]}',
  );

  it('壁武器/パーク自販機/ミステリーボックスの内容・順序はR53-W2着手前と完全一致', () => {
    for (const seedStr of Object.keys(PRE_R53W2_SNAPSHOT)) {
      const seed = Number(seedStr);
      const before = PRE_R53W2_SNAPSHOT[seedStr];
      const after = generateShopLayout(seed).slots.filter(
        (s) => s.kind !== 'pack-a-punch' && s.kind !== 'door',
      );
      expect(after).toEqual(before);
    }
  });

  it('pack-a-punchスロットが常にちょうど1個、無条件で存在する', () => {
    for (const seed of [163, 167, 173, 179, 181, 191, 193, 197, 199, 211]) {
      const count = generateShopLayout(seed).slots.filter((s) => s.kind === 'pack-a-punch').length;
      expect(count).toBe(1);
    }
  });

  it('doorスロットが常にちょうど1個・コストはDOOR_COST', () => {
    for (const seed of [163, 167, 173, 179, 181, 191]) {
      const doorSlots = generateShopLayout(seed).slots.filter((s) => s.kind === 'door');
      expect(doorSlots).toHaveLength(1);
      expect(doorSlots[0]?.cost).toBe(DOOR_COST);
    }
  });

  it('pack-a-punch/doorはrand消費列の末尾(既存スロットより後ろのslotIndex)に位置する', () => {
    for (const seed of [163, 167, 173, 179]) {
      const slots = generateShopLayout(seed).slots;
      const mbIdx = slots.findIndex((s) => s.kind === 'mystery-box');
      const papIdx = slots.findIndex((s) => s.kind === 'pack-a-punch');
      const doorIdx = slots.findIndex((s) => s.kind === 'door');
      expect(papIdx).toBeGreaterThan(mbIdx);
      expect(doorIdx).toBeGreaterThan(papIdx);
    }
  });

  it('slotIndexは新規2種を含めても0始まりの連番のまま', () => {
    generateShopLayout(163).slots.forEach((slot, i) => {
      expect(slot.slotIndex).toBe(i);
    });
  });
});

// ─── composeZombieWeaponDef(R53-W2)────────────────────────────────────────────

describe('composeZombieWeaponDef', () => {
  const base = WEAPON_DEFS['kaede-ar']!; // damage40/mag30/rpm700/reloadTac1700/reloadEmpty2300
  const zeroOpts = { extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: 0 } as const;

  it('全opts=0/tier0なら基礎値のまま(名前も不変)', () => {
    const def = composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts });
    expect(def.damage).toBe(base.damage);
    expect(def.magazineSize).toBe(base.magazineSize);
    expect(def.rpm).toBe(base.rpm);
    expect(def.reloadTacticalMs).toBe(base.reloadTacticalMs);
    expect(def.reloadEmptyMs).toBe(base.reloadEmptyMs);
    expect(def.name).toBe(base.name);
  });

  it('PAPダメージ倍率が単独で乗る(tier1=2.5x/tier2=5x/tier3=8x)', () => {
    expect(composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts }).damage).toBe(Math.round(40 * 2.5));
    expect(composeZombieWeaponDef(base, { papTier: 2, ...zeroOpts }).damage).toBe(Math.round(40 * 5));
    expect(composeZombieWeaponDef(base, { papTier: 3, ...zeroOpts }).damage).toBe(Math.round(40 * 8));
  });

  it('PAP tierに応じた名称接尾辞が付与される', () => {
    expect(composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts }).name).toBe('カエデAR');
    expect(composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts }).name).toBe('カエデAR・改');
    expect(composeZombieWeaponDef(base, { papTier: 2, ...zeroOpts }).name).toBe('カエデAR・改二');
    expect(composeZombieWeaponDef(base, { papTier: 3, ...zeroOpts }).name).toBe('カエデAR・改三');
  });

  it('PAP tier1以上でマガジン容量が1.5倍(tier2/3も同率)', () => {
    expect(composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts }).magazineSize).toBe(30);
    expect(composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts }).magazineSize).toBe(Math.ceil(30 * 1.5));
    expect(composeZombieWeaponDef(base, { papTier: 2, ...zeroOpts }).magazineSize).toBe(Math.ceil(30 * 1.5));
    expect(composeZombieWeaponDef(base, { papTier: 3, ...zeroOpts }).magazineSize).toBe(Math.ceil(30 * 1.5));
  });

  it('ext-magスタックは線形加算でマガジンに乗り、PAPと合成される(複利なし)', () => {
    const mag = (extMagStacks: number, papTier: PapTier) =>
      composeZombieWeaponDef(base, { papTier, extMagStacks, doubleTapStacks: 0, speedColaStacks: 0 })
        .magazineSize;
    expect(mag(1, 0)).toBe(Math.ceil(30 * 1.5)); // 45
    expect(mag(2, 0)).toBe(Math.ceil(30 * 2.0)); // 60
    expect(mag(1, 1)).toBe(Math.ceil(30 * 1.5 * 1.5)); // 68 (PAP tier1 × ext-mag1)
  });

  it('double-tapスタックはダメージに加算式(1+0.3n)で乗る', () => {
    const dmg = (n: number) =>
      composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: n, speedColaStacks: 0 })
        .damage;
    expect(dmg(0)).toBe(40);
    expect(dmg(1)).toBe(Math.round(40 * 1.3));
    expect(dmg(2)).toBe(Math.round(40 * 1.6));
  });

  it('double-tapとPAPは複利せず単純乗算合成される', () => {
    const d = composeZombieWeaponDef(base, {
      papTier: 2,
      extMagStacks: 0,
      doubleTapStacks: 1,
      speedColaStacks: 0,
    }).damage;
    expect(d).toBe(Math.round(40 * 5 * 1.3));
  });

  it('double-tapスタック>=1でrpmが1.33倍、0なら不変(スタック数に関わらず一律)', () => {
    const rpm = (n: number) =>
      composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: n, speedColaStacks: 0 })
        .rpm;
    expect(rpm(0)).toBe(700);
    expect(rpm(1)).toBe(Math.round(700 * 1.33));
    expect(rpm(2)).toBe(Math.round(700 * 1.33));
  });

  it('speed-colaスタックはリロード系に0.85^nで乗る', () => {
    const reload = (n: number) =>
      composeZombieWeaponDef(base, { papTier: 0, extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: n });
    expect(reload(0).reloadTacticalMs).toBe(1700);
    expect(reload(1).reloadTacticalMs).toBe(Math.round(1700 * 0.85));
    expect(reload(2).reloadTacticalMs).toBe(Math.round(1700 * 0.85 * 0.85));
    expect(reload(1).reloadEmptyMs).toBe(Math.round(2300 * 0.85));
  });

  it('speed-colaは下限0.25でクランプされる(既存speed-cola実装と同値の床)', () => {
    const r20 = composeZombieWeaponDef(base, {
      papTier: 0,
      extMagStacks: 0,
      doubleTapStacks: 0,
      speedColaStacks: 20,
    });
    expect(r20.reloadTacticalMs).toBe(Math.round(1700 * 0.25));
    expect(r20.reloadEmptyMs).toBe(Math.round(2300 * 0.25));
    const r30 = composeZombieWeaponDef(base, {
      papTier: 0,
      extMagStacks: 0,
      doubleTapStacks: 0,
      speedColaStacks: 30,
    });
    expect(r30.reloadTacticalMs).toBe(r20.reloadTacticalMs); // 床に張り付いたまま変化しない
  });

  it('毎回ベース値からの再計算であり複利ではない(同一opts→同一結果、baseは非破壊)', () => {
    const a = composeZombieWeaponDef(base, { papTier: 1, extMagStacks: 2, doubleTapStacks: 1, speedColaStacks: 2 });
    const b = composeZombieWeaponDef(base, { papTier: 1, extMagStacks: 2, doubleTapStacks: 1, speedColaStacks: 2 });
    expect(a).toEqual(b);
    expect(base.damage).toBe(40); // base自体は変更されていない
    expect(base.magazineSize).toBe(30);
    expect(base.name).toBe('カエデAR');
  });

  it('fistsはガードされ、opts に関わらず base をそのまま返す(参照同一)', () => {
    const fistsBase = WEAPON_DEFS['fists']!;
    const composed = composeZombieWeaponDef(fistsBase, {
      papTier: 3,
      extMagStacks: 5,
      doubleTapStacks: 5,
      speedColaStacks: 5,
    });
    expect(composed).toBe(fistsBase);
  });

  it('非fistsの返り値はbaseと異なるオブジェクト(非破壊コピー)', () => {
    const composed = composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts });
    expect(composed).not.toBe(base);
  });
});

describe('PAP定数', () => {
  it('PAP_DMG_MUL = [1, 2.5, 5, 8]', () => {
    expect(PAP_DMG_MUL).toEqual([1, 2.5, 5, 8]);
  });

  it('PAP_COST = [0, 5000, 20000, 45000](W4B改定)', () => {
    expect(PAP_COST).toEqual([0, 5000, 20000, 45000]);
  });

  it('PAP_REFILL_COST = 2000', () => {
    expect(PAP_REFILL_COST).toBe(2000);
  });
});

// ─── パワーアップ(R53-W2)──────────────────────────────────────────────────────

describe('PowerUp定数', () => {
  it('despawn30s / ラウンド上限4 / 効果30s / nuke400pt / carpenter200pt', () => {
    expect(POWERUP_DESPAWN_S).toBe(30);
    expect(POWERUP_ROUND_CAP).toBe(4);
    expect(POWERUP_DURATION_S).toBe(30);
    expect(NUKE_BONUS_PT).toBe(400);
    expect(CARPENTER_BONUS_PT).toBe(200);
  });
});

describe('rollPowerUp', () => {
  it('rand=常に0 → ドロップ成立・種別はプール先頭(insta)', () => {
    expect(rollPowerUp(() => 0)).toBe('insta');
  });

  it('rand=常に0.99 → ドロップ不成立でnull', () => {
    expect(rollPowerUp(() => 0.99)).toBeNull();
  });

  it('非ドロップ時はrand()を1回しか消費しない', () => {
    let calls = 0;
    const rand = () => { calls += 1; return 0.5; }; // 0.5 >= 2.5% → 非ドロップ
    rollPowerUp(rand);
    expect(calls).toBe(1);
  });

  it('出現率は約2.5%(LCGシード固定)', () => {
    let seed = 123;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let drops = 0;
    const N = 20000;
    for (let n = 0; n < N; n += 1) {
      if (rollPowerUp(rand) !== null) drops += 1;
    }
    const rate = drops / N;
    expect(rate).toBeGreaterThan(0.015);
    expect(rate).toBeLessThan(0.035);
  });

  it('ドロップ成立時は5種すべてが出現しうる', () => {
    let seed = 55;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const kinds = new Set<PowerUpKind>();
    for (let n = 0; n < 50000; n += 1) {
      const v = rollPowerUp(rand);
      if (v) kinds.add(v);
    }
    expect(kinds.size).toBe(5);
  });
});

// ─── お守り(charm)(R53-W2)────────────────────────────────────────────────────

describe('CHARMS', () => {
  it('startpt: 開幕+1000ポイント', () => {
    expect(CHARMS.startpt.effect.bonusStartPoints).toBe(1000);
  });

  it('revive: 初回ダウン自動復活1回', () => {
    expect(CHARMS.revive.effect.autoReviveCharges).toBe(1);
  });

  it('bossdmg: ボスダメ+20%(倍率1.2)', () => {
    expect(CHARMS.bossdmg.effect.bossDamageMultiplier).toBe(1.2);
  });

  it('perkcarry: 前試合のパーク1種引継ぎ', () => {
    expect(CHARMS.perkcarry.effect.perkCarryCount).toBe(1);
  });

  it('全charmがname/description/unlockConditionを持つ', () => {
    const ids: CharmId[] = ['startpt', 'revive', 'bossdmg', 'perkcarry'];
    for (const id of ids) {
      const c = CHARMS[id];
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.unlockCondition.length).toBeGreaterThan(0);
    }
  });

  it('getCharmEffect は CHARMS[id].effect と一致する', () => {
    expect(getCharmEffect('bossdmg')).toEqual(CHARMS.bossdmg.effect);
  });
});

// ─── ゾンビ特殊バリアント(R53-W2)──────────────────────────────────────────────
// 識別子はこのファイル(zombie-economy.ts)が単一の真実。bot.ts が ZombieVariant 型を
// 直接輸入しているため、他ファイルへ移動しないこと。

describe('ゾンビ特殊バリアント定数', () => {
  it('blast定数: 半径3m・ダメージ40', () => {
    expect(BLAST_RADIUS_M).toBe(3);
    expect(BLAST_DMG).toBe(40);
  });

  it('miasma定数: 半径4m・持続6秒・DPS8', () => {
    expect(MIASMA_RADIUS_M).toBe(4);
    expect(MIASMA_DURATION_S).toBe(6);
    expect(MIASMA_DPS).toBe(8);
  });

  it('shell定数: 正面軽減0.7(HSは貫通=軽減なし、という仕様は呼び出し側で担保)', () => {
    expect(SHELL_FRONT_REDUCTION).toBe(0.7);
  });

  it('ZombieVariant型は3種を表す', () => {
    const all: ZombieVariant[] = ['blast', 'miasma', 'shell'];
    expect(all).toHaveLength(3);
  });
});

describe('rollZombieVariant', () => {
  function makeLcg(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it('round<8は乱数に関わらず常にnull', () => {
    expect(rollZombieVariant(1, () => 0, 0)).toBeNull();
    expect(rollZombieVariant(7, () => 0, 0)).toBeNull();
  });

  it('round=8以上でblastが約8%の確率で出現する(LCG)', () => {
    const rand = makeLcg(7);
    let blastCount = 0;
    const N = 20000;
    for (let i = 0; i < N; i += 1) {
      if (rollZombieVariant(8, rand, 0) === 'blast') blastCount += 1;
    }
    const rate = blastCount / N;
    expect(rate).toBeGreaterThan(0.06);
    expect(rate).toBeLessThan(0.10);
  });

  it('round=8では blast か null のみ(miasma/shellはまだ出ない)', () => {
    const rand = makeLcg(3);
    for (let i = 0; i < 2000; i += 1) {
      const v = rollZombieVariant(8, rand, 0);
      expect(v === null || v === 'blast').toBe(true);
    }
  });

  it('round<12ではmiasma/shellが出ない(round=11)', () => {
    const rand = makeLcg(5);
    for (let i = 0; i < 3000; i += 1) {
      const v = rollZombieVariant(11, rand, 0);
      expect(v).not.toBe('miasma');
      expect(v).not.toBe('shell');
    }
  });

  it('round=12以上・aliveMiasma=0ならmiasmaが出現しうる', () => {
    const rand = makeLcg(11);
    let seen = false;
    for (let i = 0; i < 5000; i += 1) {
      if (rollZombieVariant(12, rand, 0) === 'miasma') { seen = true; break; }
    }
    expect(seen).toBe(true);
  });

  it('aliveMiasma>=6のときmiasmaは抽選から除外される(round=12〜14)', () => {
    const rand = makeLcg(99);
    for (let i = 0; i < 5000; i += 1) {
      expect(rollZombieVariant(13, rand, 6)).not.toBe('miasma');
    }
  });

  it('round<15ではshellが出ない(round=14)', () => {
    const rand = makeLcg(41);
    for (let i = 0; i < 3000; i += 1) {
      expect(rollZombieVariant(14, rand, 0)).not.toBe('shell');
    }
  });

  it('round=15以上でshellが出現しうる', () => {
    const rand = makeLcg(21);
    let seen = false;
    for (let i = 0; i < 5000; i += 1) {
      if (rollZombieVariant(15, rand, 0) === 'shell') { seen = true; break; }
    }
    expect(seen).toBe(true);
  });

  it('重複時は先勝ち: blast成立ならmiasma/shellは判定されない(rand()は1回のみ消費)', () => {
    let calls = 0;
    const rand = () => { calls += 1; return 0; }; // 常に0 → blast閾値0.08未満で即成立
    const v = rollZombieVariant(15, rand, 0);
    expect(v).toBe('blast');
    expect(calls).toBe(1);
  });

  it('blast不成立・miasma成立ならmiasmaで確定しshellは判定されない(rand()は2回のみ消費)', () => {
    let call = 0;
    const rand = () => { call += 1; return call === 1 ? 0.5 : 0; };
    const v = rollZombieVariant(15, rand, 0);
    expect(v).toBe('miasma');
    expect(call).toBe(2);
  });

  it('blast/miasma不成立・shell成立ならshellで確定する(rand()は3回消費)', () => {
    let call = 0;
    const rand = () => { call += 1; return call <= 2 ? 0.5 : 0; };
    const v = rollZombieVariant(15, rand, 0);
    expect(v).toBe('shell');
    expect(call).toBe(3);
  });
});

// ─── R54-F5 輪廻(ローグラン): compose の rogue 漏斗+汎用パワーアップ抽選 ──────

describe('composeZombieWeaponDef × rogue(輪廻カードの単一漏斗)', () => {
  const base = WEAPON_DEFS['kaede-ar']!; // damage40/mag30/reloadTac1700/reloadEmpty2300
  const zeroOpts = { extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: 0 } as const;

  it('rogue未指定(undefined)は完全に無効=基礎値のまま', () => {
    const plain = composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts });
    const off = composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts, rogue: undefined });
    expect(off).toEqual(plain);
  });

  it('dmgMulはPAP/double-tapと基礎値から一括合成される(複利なし)', () => {
    const rogue = { dmgMul: 1.15, magMul: 1, reloadMul: 1 };
    expect(composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts, rogue }).damage).toBe(Math.round(40 * 1.15));
    expect(composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts, rogue }).damage).toBe(Math.round(40 * 2.5 * 1.15));
    expect(
      composeZombieWeaponDef(base, { papTier: 1, extMagStacks: 0, doubleTapStacks: 1, speedColaStacks: 0, rogue })
        .damage,
    ).toBe(Math.round(40 * 2.5 * 1.3 * 1.15));
  });

  it('magMulはPAP1.5×/ext-magと乗算合成される', () => {
    const rogue = { dmgMul: 1, magMul: 1.25, reloadMul: 1 };
    expect(composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts, rogue }).magazineSize).toBe(Math.ceil(30 * 1.25));
    expect(composeZombieWeaponDef(base, { papTier: 1, ...zeroOpts, rogue }).magazineSize).toBe(
      Math.ceil(30 * 1.5 * 1.25),
    );
  });

  it('reloadMulはspeed-colaと合算後も床0.25を維持する', () => {
    const rogue = { dmgMul: 1, magMul: 1, reloadMul: 0.5 };
    const light = composeZombieWeaponDef(base, { papTier: 0, ...zeroOpts, rogue });
    expect(light.reloadTacticalMs).toBe(Math.round(1700 * 0.5));
    // speed-cola 8スタック(0.85^8≈0.272)×0.5=0.136 → 床0.25でクランプ
    const heavy = composeZombieWeaponDef(base, {
      papTier: 0, extMagStacks: 0, doubleTapStacks: 0, speedColaStacks: 8, rogue,
    });
    expect(heavy.reloadTacticalMs).toBe(Math.round(1700 * 0.25));
    expect(heavy.reloadEmptyMs).toBe(Math.round(2300 * 0.25));
  });

  it('再計算は常に基礎値から=同じoptsを何度composeしても同値(複利が構造的に不可能)', () => {
    const rogue = { dmgMul: 1.45, magMul: 1.5, reloadMul: 0.7 };
    const opts = { papTier: 2 as PapTier, extMagStacks: 1, doubleTapStacks: 1, speedColaStacks: 2, rogue };
    const a = composeZombieWeaponDef(base, opts);
    const b = composeZombieWeaponDef(base, opts);
    expect(b).toEqual(a);
  });
});

describe('rollPowerUpAt(汎用確率のパワーアップ抽選=輪廻「幸運」の補充漏斗)', () => {
  it('chance<=0は常にnull(randも消費しない)', () => {
    let calls = 0;
    expect(rollPowerUpAt(() => { calls += 1; return 0; }, 0)).toBeNull();
    expect(calls).toBe(0);
  });

  it('rand>=chanceはnull、rand<chanceでkindを返す', () => {
    expect(rollPowerUpAt(seqRand([0.5, 0]), 0.5)).toBeNull();
    expect(rollPowerUpAt(seqRand([0.49, 0]), 0.5)).not.toBeNull();
  });

  it('基本チャンス(POWERUP_DROP_CHANCE)×倍率でrollPowerUpと同じ判定線になる', () => {
    const chance = POWERUP_DROP_CHANCE * 1.5;
    expect(rollPowerUpAt(seqRand([chance - 0.001, 0.9]), chance)).not.toBeNull();
    expect(rollPowerUpAt(seqRand([chance + 0.001, 0.9]), chance)).toBeNull();
  });
});

function seqRand(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}
