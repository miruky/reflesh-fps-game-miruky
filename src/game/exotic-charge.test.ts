import { describe, it, expect } from 'vitest';
import { WEAPON_DEFS } from './weapons';

describe('exotic weapon damage values', () => {
  it('banjin-smg damage is 45', () => {
    expect(WEAPON_DEFS['banjin-smg']?.damage).toBe(45);
  });
  it('gekkou-bow damage is 200', () => {
    expect(WEAPON_DEFS['gekkou-bow']?.damage).toBe(200);
  });
  it('fujin-fan damage is 35', () => {
    expect(WEAPON_DEFS['fujin-fan']?.damage).toBe(35);
  });
  it('gouen-musket damage is 260', () => {
    expect(WEAPON_DEFS['gouen-musket']?.damage).toBe(260);
  });
  it('tenrai-staff damage is 160', () => {
    expect(WEAPON_DEFS['tenrai-staff']?.damage).toBe(160);
  });
  it('shinkirou-sniper damage is 90', () => {
    expect(WEAPON_DEFS['shinkirou-sniper']?.damage).toBe(90);
  });
  it('shura-lmg damage is 28', () => {
    expect(WEAPON_DEFS['shura-lmg']?.damage).toBe(28);
  });
  it('all 7 exotic weapons have class exotic', () => {
    const exoticIds = ['banjin-smg', 'gekkou-bow', 'fujin-fan', 'gouen-musket', 'tenrai-staff', 'shinkirou-sniper', 'shura-lmg'] as const;
    for (const id of exoticIds) {
      expect(WEAPON_DEFS[id]?.class).toBe('exotic');
    }
  });
});
