import { describe, expect, it } from 'vitest';
import src from './armory.ts?raw';
import { CLASS_ORDER } from './armory';
import { PRIMARY_IDS, WEAPON_DEFS } from '../../game/weapons';
import { weaponHasIntegralSuppressor } from '../../render/viewmodel';

// W-C4[0]回帰防止: 武器庫のクラスタブ集合(CLASS_ORDER)が、主武器(PRIMARY_IDS)に実在する
// 全クラスを網羅していること。'pistol'脱落でクナイ(fists=黒帝/雷帝の格闘キット)が
// 恒久的に選択不能になった移植漏れの再発を防ぐ。
describe('armory CLASS_ORDER カバレッジ', () => {
  it('PRIMARY_IDS の全 class が CLASS_ORDER に含まれる', () => {
    const primaryClasses = new Set(PRIMARY_IDS.map((id) => WEAPON_DEFS[id]?.class).filter(Boolean));
    const missing = [...primaryClasses].filter((c) => !CLASS_ORDER.includes(c as never));
    expect(missing).toEqual([]);
  });

  it("'pistol'(クナイ)がタブ集合に含まれる", () => {
    expect(CLASS_ORDER).toContain('pistol');
  });
});

// R58 F1: 一体型サプレッサ機(MP5SD 等)の muzzle スロットゲート(jsdom不使用=ソースピン規約)。
// ensureAttachmentGates が既存選択を静かに外し、選択ポップアップも選択肢自体を隠す(sight の
// opticFits と同型)。装着効果ゼロで射程-15%だけ食らうトラップ + 描画二重化の再発を防ぐ。
describe('armory 一体型サプレッサ機 muzzle スロットゲート(R58 F1)', () => {
  it('weaponHasIntegralSuppressor は MP5SD で true、非一体機で false', () => {
    expect(weaponHasIntegralSuppressor(WEAPON_DEFS['sasameki-smg']!)).toBe(true);
    expect(weaponHasIntegralSuppressor(WEAPON_DEFS['kaede-ar']!)).toBe(false);
  });

  it('ensureAttachmentGates が muzzle スロットで weaponHasIntegralSuppressor を参照する', () => {
    const gateFn = src.match(/const ensureAttachmentGates[\s\S]*?\n {2}\};/);
    expect(gateFn, 'ensureAttachmentGates 本体が見つかる').not.toBeNull();
    expect(gateFn![0]).toContain('noMuzzle');
    expect(gateFn![0]).toContain("slot === 'muzzle' && noMuzzle");
  });

  it('アタッチメント選択ポップアップが muzzle スロットで weaponHasIntegralSuppressor を参照する', () => {
    expect(src).toContain("slot !== 'muzzle' || !weaponHasIntegralSuppressor(base)");
  });
});
