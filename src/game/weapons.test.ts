import { describe, expect, it } from 'vitest';
import { BODY, HEAD, LIMB, partMultiplier } from './ballistics';
import { PRIMARY_IDS, Weapon, WEAPON_DEFS } from './weapons';

const DEG = Math.PI / 180;
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

  it('構え直しでADSとブルームを持ち越さない', () => {
    const weapon = makeWeapon('kaede-ar');
    settle(weapon, 1000);
    for (let i = 0; i < 100; i += 1) {
      weapon.update(10, { trigger: true, ads: true, reloadPressed: false }, CTX);
    }
    expect(weapon.adsProgress).toBe(1);
    expect(weapon.bloomDeg).toBeGreaterThan(0);
    weapon.raise();
    expect(weapon.adsProgress).toBe(0);
    expect(weapon.bloomDeg).toBe(0);
    expect(weapon.recoil.stepIndex).toBe(0);
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

  it('バーストは1トリガーでburstCount発まとめて出る', () => {
    const weapon = makeWeapon('miyama-br');
    settle(weapon, 1000);
    let fired = 0;
    // 最初の1フレームだけトリガーを引き、あとは離して待つ
    for (let i = 0; i < 200; i += 1) {
      const events = weapon.update(5, { trigger: i === 0, ads: false, reloadPressed: false }, CTX);
      fired += events.filter((e) => e.type === 'fired').length;
    }
    expect(fired).toBe(weapon.def.burstCount);
  });
});

describe('武器定義の整合性', () => {
  it('全プライマリが定義表に存在しスロットが正しい', () => {
    for (const id of PRIMARY_IDS) {
      const def = WEAPON_DEFS[id];
      expect(def).toBeDefined();
      expect(def!.slot).toBe('primary');
      expect(def!.id).toBe(id);
    }
  });

  it('ショットガンだけが複数ペレットを持つ', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.id === 'hiiragi-sg') {
        expect(def.pellets).toBeGreaterThan(1);
        expect(def.pelletSpreadDeg).toBeGreaterThan(0);
      } else {
        expect(def.pellets).toBe(1);
      }
    }
  });

  it('貫通力は負にならない', () => {
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(def.penetrationM).toBeGreaterThanOrEqual(0);
    }
  });

  it('全武器が音プロファイルと拡散抑制/空中拡散を持つ', () => {
    const profiles = ['ar', 'smg', 'dmr', 'shotgun', 'lmg', 'pistol', 'br'];
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(profiles).toContain(def.soundProfile);
      expect(def.adsMoveSuppression).toBeGreaterThanOrEqual(0);
      expect(def.adsMoveSuppression).toBeLessThanOrEqual(1);
      expect(def.airSpreadDeg).toBeGreaterThanOrEqual(0);
    }
  });

  it('スコープ/エイムアシストはヤマセミDMRだけが持つ', () => {
    expect(WEAPON_DEFS['yamasemi-dmr']!.scope).toBe(true);
    expect(WEAPON_DEFS['yamasemi-dmr']!.aimAssist).toBe(true);
    for (const def of Object.values(WEAPON_DEFS)) {
      if (def.id === 'yamasemi-dmr') continue;
      expect(def.scope).not.toBe(true);
      expect(def.aimAssist).not.toBe(true);
    }
  });

  it('DMRは胴・頭で一撃、脚だけ生存する', () => {
    const def = WEAPON_DEFS['yamasemi-dmr']!;
    expect(def.damage * partMultiplier(BODY, def.headshotMultiplier)).toBeGreaterThanOrEqual(100);
    expect(def.damage * partMultiplier(HEAD, def.headshotMultiplier)).toBeGreaterThanOrEqual(100);
    expect(def.damage * partMultiplier(LIMB, def.headshotMultiplier)).toBeLessThan(100);
  });

  it('DSRは表示名がDSRで、ボルトのリズム(低RPM)を持つ', () => {
    const def = WEAPON_DEFS['yamasemi-dmr']!;
    expect(def.id).toBe('yamasemi-dmr'); // 内部IDは不変
    expect(def.name).toBe('DSR');
    expect(def.rpm).toBeLessThanOrEqual(90); // ボルトアクション級の重い連射間隔
    expect(60000 / def.rpm).toBeGreaterThanOrEqual(600); // 1発あたり>=600ms
  });
});

describe('スコープ精度', () => {
  it('覗いて移動・空中でもDMRはほぼ無拡散、腰だめは大きく開く', () => {
    const weapon = new Weapon(WEAPON_DEFS['yamasemi-dmr']!);
    const ctx = { moveFactor: 1, airborne: true, crouched: false };
    weapon.adsProgress = 0; // 腰だめ
    expect(weapon.currentSpreadRad(ctx)).toBeGreaterThan(5 * DEG);
    weapon.adsProgress = 1; // 完全に覗いた状態
    expect(weapon.currentSpreadRad(ctx)).toBeLessThan(0.3 * DEG);
  });

  it('クイックスコープ: 85%覗けば完全ADSと同じ拡散になる', () => {
    const weapon = new Weapon(WEAPON_DEFS['yamasemi-dmr']!);
    const ctx = { moveFactor: 0.5, airborne: false, crouched: false };
    weapon.adsProgress = 0.85;
    const quick = weapon.currentSpreadRad(ctx);
    weapon.adsProgress = 1;
    const full = weapon.currentSpreadRad(ctx);
    expect(quick).toBeCloseTo(full, 6);
  });

  it('非スコープ武器はクイックスコープ・スナップを受けない', () => {
    const weapon = new Weapon(WEAPON_DEFS['kaede-ar']!);
    const ctx = { moveFactor: 0.5, airborne: false, crouched: false };
    weapon.adsProgress = 0.85;
    const partial = weapon.currentSpreadRad(ctx);
    weapon.adsProgress = 1;
    const full = weapon.currentSpreadRad(ctx);
    expect(partial).toBeGreaterThan(full); // 85%ではまだ完全ADSより拡散が大きい
  });
});
