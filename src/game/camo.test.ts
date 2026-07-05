import { describe, expect, it } from 'vitest';
import {
  CAMO_CLASSES,
  CAMO_IDS,
  CAMO_TIERS,
  CAMO_VISUALS,
  CAMO_WEAPON_IDS,
  camoClassOf,
  camoName,
  camoProgress,
  camoTierFor,
  camoWeaponsOfClass,
  DARK_MATTER_CAMO,
  DIAMOND_CAMO,
  darkMatterFor,
  diamondFor,
  equippedCamoFor,
  goldFor,
  isCamoId,
  isCamoUnlocked,
  weaponIdByName,
  weaponNameOf,
  type WeaponCamoStats,
} from './camo';
import { WEAPON_DEFS } from './weapons';

// 全カモ対象武器をゴールド化した統計を作るヘルパ
function allGoldStats(exclude: readonly string[] = []): Record<string, WeaponCamoStats> {
  const all: Record<string, WeaponCamoStats> = {};
  for (const id of CAMO_WEAPON_IDS) {
    if (exclude.includes(id)) continue;
    all[id] = { kills: 500, headshots: 100 };
  }
  return all;
}

describe('カモ段階表', () => {
  it('9段のキル階段は 25/50/75/100/150/200/300/400/500', () => {
    expect(CAMO_TIERS.map((t) => t.kills)).toEqual([25, 50, 75, 100, 150, 200, 300, 400, 500]);
  });

  it('ゴールドのみHS100条件を持つ', () => {
    for (const tier of CAMO_TIERS) {
      expect(tier.headshots, tier.id).toBe(tier.id === 'gold' ? 100 : 0);
    }
  });

  it('IDは11種で重複しない(9段+ダイヤ+ダークマター)', () => {
    expect(CAMO_IDS).toHaveLength(11);
    expect(new Set(CAMO_IDS).size).toBe(11);
    expect(CAMO_IDS).toContain('diamond');
    expect(CAMO_IDS).toContain('dark-matter');
  });

  it('isCamoId は既知IDのみ真', () => {
    expect(isCamoId('gold')).toBe(true);
    expect(isCamoId('dark-matter')).toBe(true);
    expect(isCamoId('rainbow')).toBe(false);
    expect(isCamoId('')).toBe(false);
  });

  it('camoName は日本語名を返す', () => {
    expect(camoName('dirt')).toBe('汚れ迷彩');
    expect(camoName('gold')).toBe('ゴールド');
    expect(camoName('diamond')).toBe(DIAMOND_CAMO.name);
    expect(camoName('dark-matter')).toBe(DARK_MATTER_CAMO.name);
  });

  it('全カモに見た目定義があり、発光は0.5以下(白飛び再発禁止)', () => {
    for (const id of CAMO_IDS) {
      const v = CAMO_VISUALS[id];
      expect(v, id).toBeDefined();
      expect(v.id).toBe(id);
      expect(v.emissiveIntensity, id).toBeLessThanOrEqual(0.5);
      expect(v.metalness, id).toBeGreaterThanOrEqual(0);
      expect(v.metalness, id).toBeLessThanOrEqual(1);
    }
    // 仕様の要: gold=金属金, diamond=強スペキュラ, dark-matter=脈動
    expect(CAMO_VISUALS.gold.metalness).toBe(1.0);
    expect(CAMO_VISUALS.diamond.roughness).toBeLessThanOrEqual(0.2);
    expect(CAMO_VISUALS['dark-matter'].pattern).toBe('pulse');
  });
});

describe('対象武器とクラス', () => {
  it('カモ対象はfists除く25本のプライマリ', () => {
    expect(CAMO_WEAPON_IDS).toHaveLength(25);
    expect(CAMO_WEAPON_IDS).not.toContain('fists');
    for (const id of CAMO_WEAPON_IDS) expect(WEAPON_DEFS[id], id).toBeDefined();
  });

  it('クラス集合は対象武器のクラスを網羅し、全武器がいずれかのクラスに属する', () => {
    const covered = new Set<string>();
    for (const cls of CAMO_CLASSES) {
      for (const id of camoWeaponsOfClass(cls)) covered.add(id);
    }
    expect(covered.size).toBe(CAMO_WEAPON_IDS.length);
  });

  it('camoClassOf は対象外・未知IDで null', () => {
    expect(camoClassOf('kaede-ar')).toBe('ar');
    expect(camoClassOf('fists')).toBeNull();
    expect(camoClassOf('suzume')).toBeNull(); // 副武器は対象外
    expect(camoClassOf('nope')).toBeNull();
  });

  it('weaponIdByName は表示名から逆引きし、近接/投擲名は null', () => {
    expect(weaponIdByName('カエデAR')).toBe('kaede-ar');
    expect(weaponIdByName('DSR')).toBe('yamasemi-dmr');
    expect(weaponIdByName('近接')).toBeNull();
    expect(weaponIdByName('フラグ')).toBeNull();
    expect(weaponNameOf('kaede-ar')).toBe('カエデAR');
    expect(weaponNameOf('unknown-id')).toBe('unknown-id');
  });
});

describe('camoTierFor / goldFor', () => {
  it('未使用・undefined は0段', () => {
    expect(camoTierFor(undefined)).toBe(0);
    expect(camoTierFor({ kills: 0, headshots: 0 })).toBe(0);
    expect(camoTierFor({ kills: 24, headshots: 0 })).toBe(0);
  });

  it('キル階段のしきい値ちょうどで段が進む', () => {
    expect(camoTierFor({ kills: 25, headshots: 0 })).toBe(1);
    expect(camoTierFor({ kills: 74, headshots: 0 })).toBe(2);
    expect(camoTierFor({ kills: 75, headshots: 0 })).toBe(3);
    expect(camoTierFor({ kills: 400, headshots: 0 })).toBe(8);
  });

  it('500キルでもHS100未満ならゴールドは開かない', () => {
    expect(camoTierFor({ kills: 500, headshots: 99 })).toBe(8);
    expect(goldFor({ kills: 500, headshots: 99 })).toBe(false);
    expect(camoTierFor({ kills: 500, headshots: 100 })).toBe(9);
    expect(goldFor({ kills: 500, headshots: 100 })).toBe(true);
    expect(goldFor({ kills: 9999, headshots: 100 })).toBe(true);
  });
});

describe('diamondFor / darkMatterFor', () => {
  it('同クラス全武器ゴールドでダイヤ解除、1本欠けると未解除', () => {
    const arIds = camoWeaponsOfClass('ar');
    expect(arIds.length).toBeGreaterThan(1);
    const all = allGoldStats();
    expect(diamondFor('ar', all)).toBe(true);
    // 1本だけゴールド未達にする
    const firstAr = arIds[0]!;
    all[firstAr] = { kills: 500, headshots: 99 };
    expect(diamondFor('ar', all)).toBe(false);
    // 他クラスには影響しない
    expect(diamondFor('smg', all)).toBe(true);
  });

  it('単独武器クラス(launcher)はその1本のゴールドでダイヤ', () => {
    const all: Record<string, WeaponCamoStats> = { 'gouka-rl': { kills: 500, headshots: 100 } };
    expect(diamondFor('launcher', all)).toBe(true);
  });

  it('全クラスダイヤでダークマター解除、1クラス欠けると未解除', () => {
    expect(darkMatterFor(allGoldStats())).toBe(true);
    expect(darkMatterFor(allGoldStats(['gouka-rl']))).toBe(false);
    expect(darkMatterFor({})).toBe(false);
  });
});

describe('isCamoUnlocked / camoProgress', () => {
  it('段階カモは自武器の統計だけで判定される', () => {
    const all: Record<string, WeaponCamoStats> = { 'kaede-ar': { kills: 100, headshots: 5 } };
    expect(isCamoUnlocked('dirt', 'kaede-ar', all)).toBe(true);
    expect(isCamoUnlocked('blue', 'kaede-ar', all)).toBe(true);
    expect(isCamoUnlocked('red', 'kaede-ar', all)).toBe(false);
    expect(isCamoUnlocked('dirt', 'tsubaki-smg', all)).toBe(false);
  });

  it('対象外武器(fists/副武器)は常に未解除', () => {
    const all = allGoldStats();
    expect(isCamoUnlocked('dirt', 'fists', all)).toBe(false);
    expect(isCamoUnlocked('diamond', 'suzume', all)).toBe(false);
  });

  it('diamond は武器のクラスで、dark-matter は全体で判定', () => {
    const all = allGoldStats();
    expect(isCamoUnlocked('diamond', 'kaede-ar', all)).toBe(true);
    expect(isCamoUnlocked('dark-matter', 'kaede-ar', all)).toBe(true);
    const partial = allGoldStats(['gouka-rl']);
    expect(isCamoUnlocked('diamond', 'kaede-ar', partial)).toBe(true);
    expect(isCamoUnlocked('diamond', 'gouka-rl', partial)).toBe(false);
    expect(isCamoUnlocked('dark-matter', 'kaede-ar', partial)).toBe(false);
  });

  it('進捗は目標を超えず、ラベルに条件が入る', () => {
    const all: Record<string, WeaponCamoStats> = { 'kaede-ar': { kills: 9999, headshots: 3 } };
    const p = camoProgress('woodland', 'kaede-ar', all);
    expect(p.current).toBe(50);
    expect(p.target).toBe(50);
    expect(p.label).toContain('50');
    // ゴールド: キル満了後はHS進捗へ切り替わる
    const g = camoProgress('gold', 'kaede-ar', all);
    expect(g.current).toBe(3);
    expect(g.target).toBe(100);
    expect(g.label).toContain('HS');
    // ゴールド: キル未満はキル進捗
    const g2 = camoProgress('gold', 'tsubaki-smg', { 'tsubaki-smg': { kills: 120, headshots: 0 } });
    expect(g2.current).toBe(120);
    expect(g2.target).toBe(500);
  });

  it('diamond/dark-matter の進捗はゴールド武器数/ダイヤクラス数', () => {
    const partial = allGoldStats(['gouka-rl']);
    const d = camoProgress('diamond', 'gouka-rl', partial);
    expect(d.current).toBe(0);
    expect(d.target).toBe(1);
    const dm = camoProgress('dark-matter', 'kaede-ar', partial);
    expect(dm.current).toBe(CAMO_CLASSES.length - 1);
    expect(dm.target).toBe(CAMO_CLASSES.length);
  });
});

describe('equippedCamoFor', () => {
  it('解除済みの選択のみ返し、未解除・不正・未選択は null', () => {
    const weaponStats: Record<string, WeaponCamoStats> = {
      'kaede-ar': { kills: 60, headshots: 0 },
    };
    expect(
      equippedCamoFor('kaede-ar', { selectedCamos: { 'kaede-ar': 'woodland' }, weaponStats }),
    ).toBe('woodland');
    expect(
      equippedCamoFor('kaede-ar', { selectedCamos: { 'kaede-ar': 'gold' }, weaponStats }),
    ).toBeNull();
    expect(
      equippedCamoFor('kaede-ar', { selectedCamos: { 'kaede-ar': 'rainbow' }, weaponStats }),
    ).toBeNull();
    expect(equippedCamoFor('kaede-ar', { selectedCamos: {}, weaponStats })).toBeNull();
  });

  it('ダークマター解除後は全カモ対象武器に装備できる', () => {
    const all = allGoldStats();
    for (const id of CAMO_WEAPON_IDS) {
      expect(
        equippedCamoFor(id, { selectedCamos: { [id]: 'dark-matter' }, weaponStats: all }),
        id,
      ).toBe('dark-matter');
    }
  });
});
