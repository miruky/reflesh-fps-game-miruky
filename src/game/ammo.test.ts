import { describe, expect, it } from 'vitest';
import { Weapon, WEAPON_DEFS } from './weapons';

const CTX = { moveFactor: 0, airborne: false, crouched: false };

describe('無限リザーブ弾', () => {
  it('全武器のリザーブが無限で、リロードしても減らない', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      const weapon = new Weapon(def);
      expect(weapon.magazine.reserve).toBe(Infinity);
      expect(Number.isFinite(weapon.magazine.reserve)).toBe(false);
      weapon.magazine.rounds = 0;
      weapon.magazine.finishReload();
      expect(weapon.magazine.rounds).toBe(def.magazineSize);
      expect(weapon.magazine.reserve).toBe(Infinity);
    }
  });

  it('満タンでなければ常にリロードできる', () => {
    const weapon = new Weapon(WEAPON_DEFS['kaede-ar']!);
    weapon.magazine.rounds = 1;
    expect(weapon.magazine.canReload).toBe(true);
    weapon.magazine.rounds = weapon.def.magazineSize;
    expect(weapon.magazine.canReload).toBe(false);
  });
});

describe('Weapon.resupply', () => {
  it('弾倉を満タンへ戻し、リロード・ブルームを初期化する', () => {
    const weapon = new Weapon(WEAPON_DEFS['kaede-ar']!);
    weapon.update(1000, { trigger: false, ads: false, reloadPressed: false }, CTX); // 構え完了
    for (let i = 0; i < 5; i += 1) {
      weapon.update(200, { trigger: true, ads: false, reloadPressed: false }, CTX);
    }
    expect(weapon.magazine.rounds).toBeLessThan(weapon.def.magazineSize);
    expect(weapon.bloomDeg).toBeGreaterThan(0);

    weapon.resupply();
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize);
    expect(weapon.reloading).toBe(false);
    expect(weapon.bloomDeg).toBe(0);
  });
});
