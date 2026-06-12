import { describe, expect, it } from 'vitest';
import { Weapon, WEAPON_DEFS } from './weapons';

const CTX = { moveFactor: 0, airborne: false, crouched: false };

function makeWeapon(id: string): Weapon {
  const def = WEAPON_DEFS[id];
  if (!def) throw new Error(`unknown weapon: ${id}`);
  return new Weapon(def);
}

function settle(weapon: Weapon, ms: number): void {
  weapon.update(ms, { trigger: false, ads: false, reloadPressed: false }, CTX);
}

describe('Weapon 発射制御', () => {
  it('フルオートは発射間隔がRPMに従う', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000); // 構え完了
    const interval = 60000 / weapon.def.rpm;
    let fired = 0;
    // 10発分の時間+少しだけトリガーを引き続ける
    const steps = Math.ceil((interval * 9.5) / 5);
    for (let i = 0; i < steps; i += 1) {
      const events = weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(10);
  });

  it('単発はトリガーを引き直すまで次弾が出ない', () => {
    const weapon = makeWeapon('suzume');
    settle(weapon, 1000);
    let fired = 0;
    for (let i = 0; i < 100; i += 1) {
      const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(1);
    settle(weapon, 500);
    const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(events.some((e) => e.type === 'fired')).toBe(true);
  });

  it('構え直し中は撃てない', () => {
    const weapon = makeWeapon('kaede-ar');
    const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(events.some((e) => e.type === 'fired')).toBe(false);
  });

  it('マガジンが空になると自動で空リロードが始まる', () => {
    const weapon = makeWeapon('suzume');
    settle(weapon, 1000);
    let sawAutoReload = false;
    for (let i = 0; i < 12; i += 1) {
      // 単発なのでトリガーを離してから引き直す
      settle(weapon, 200);
      const events = weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
      if (events.some((e) => e.type === 'reload-start' && e.kind === 'empty')) {
        sawAutoReload = true;
        break;
      }
    }
    expect(sawAutoReload).toBe(true);
    expect(weapon.reloading).toBe(true);
  });

  it('リロード完了で弾が戻る', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    weapon.update(5, { trigger: true, ads: false, reloadPressed: false }, CTX);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize - 1);
    weapon.update(5, { trigger: false, ads: false, reloadPressed: true }, CTX);
    expect(weapon.reloading).toBe(true);
    settle(weapon, weapon.def.reloadTacticalMs + 50);
    expect(weapon.reloading).toBe(false);
    expect(weapon.magazine.rounds).toBe(weapon.def.magazineSize);
  });

  it('ADSはスプレッドを腰だめより狭める', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    const hip = weapon.currentSpreadRad(CTX);
    for (let i = 0; i < 100; i += 1) {
      weapon.update(10, { trigger: false, ads: true, reloadPressed: false }, CTX);
    }
    const ads = weapon.currentSpreadRad(CTX);
    expect(ads).toBeLessThan(hip);
    expect(weapon.adsProgress).toBe(1);
  });

  it('連射でブルームが乗り、時間経過で回復する', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    const before = weapon.currentSpreadRad(CTX);
    for (let i = 0; i < 60; i += 1) {
      weapon.update(10, { trigger: true, ads: false, reloadPressed: false }, CTX);
    }
    const during = weapon.currentSpreadRad(CTX);
    expect(during).toBeGreaterThan(before);
    settle(weapon, 3000);
    expect(weapon.currentSpreadRad(CTX)).toBeCloseTo(before, 5);
  });
});
