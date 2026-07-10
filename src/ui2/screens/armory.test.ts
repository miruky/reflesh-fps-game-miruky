import { describe, expect, it } from 'vitest';
import { CLASS_ORDER } from './armory';
import { PRIMARY_IDS, WEAPON_DEFS } from '../../game/weapons';

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
