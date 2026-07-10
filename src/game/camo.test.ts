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
  isKnownCamoId,
  isKunaiCamoId,
  isKunaiCamoUnlocked,
  isPapCamoId,
  isRewardCamoId,
  kunaiCamoProgress,
  KUNAI_CAMO_IDS,
  PAP_CAMO_IDS,
  PAP_CAMO_NAMES,
  REWARD_CAMO_CHAPTER,
  REWARD_CAMO_IDS,
  TOKOYAMI_CAMO,
  weaponIdByName,
  weaponNameOf,
  type CamoId,
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

  it('IDは13種で重複しない(9段+ダイヤ+ダークマター+報酬カモ2種)', () => {
    // R53-W2: jingai/shinrai(報酬カモ)がCAMO_IDSへ自然に追加された(既存11種+2)
    expect(CAMO_IDS).toHaveLength(13);
    expect(new Set(CAMO_IDS).size).toBe(13);
    expect(CAMO_IDS).toContain('diamond');
    expect(CAMO_IDS).toContain('dark-matter');
    expect(CAMO_IDS).toContain('jingai');
    expect(CAMO_IDS).toContain('shinrai');
    // PaP鍛神(システム付与)はCAMO_IDS対象外
    expect(CAMO_IDS).not.toContain('pap1');
    expect(CAMO_IDS).not.toContain('pap2');
    expect(CAMO_IDS).not.toContain('pap3');
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

  // R55 W-C3根治(LOW[27]): diamondのsparkle/envMapIntensityに機械検査が無かった。
  // 白飛び再発禁止(bloom閾値0.9)の実務上限として sparkle<=0.6 / envMapIntensity<=1.0 を
  // 全カモ(CAMO_VISUALS走査=CAMO_IDS+pap1-3+tokoyami+報酬カモを含む全定義)で機械検査する。
  it('sparkle/envMapIntensity は指定時のみ、白飛び回避の上限内(sparkle<=0.6, envMapIntensity<=1.0)', () => {
    for (const id of Object.keys(CAMO_VISUALS) as CamoId[]) {
      const v = CAMO_VISUALS[id];
      if (v.sparkle !== undefined) {
        expect(v.sparkle, id).toBeGreaterThanOrEqual(0);
        expect(v.sparkle, id).toBeLessThanOrEqual(0.6);
      }
      if (v.envMapIntensity !== undefined) {
        expect(v.envMapIntensity, id).toBeGreaterThanOrEqual(0);
        expect(v.envMapIntensity, id).toBeLessThanOrEqual(1.0);
      }
    }
    // 現状 diamond のみが両フィールドを定義している(このテストが実際に判定していることの保証)
    expect(CAMO_VISUALS.diamond.sparkle).toBeDefined();
    expect(CAMO_VISUALS.diamond.envMapIntensity).toBeDefined();
  });
});

describe('対象武器とクラス', () => {
  it('カモ対象はfists除く35本のプライマリ', () => {
    expect(CAMO_WEAPON_IDS).toHaveLength(35);
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

describe('クナイ専用カモ(常闇ラダー)', () => {
  it('KUNAI_CAMO_IDS は9段+常闇の10種', () => {
    expect(KUNAI_CAMO_IDS).toHaveLength(10);
    expect(KUNAI_CAMO_IDS).toContain('tokoyami');
    expect(KUNAI_CAMO_IDS).not.toContain('diamond');
    expect(KUNAI_CAMO_IDS).not.toContain('dark-matter');
  });

  it('isKunaiCamoId は常闇を含むクナイラダーIDのみ真', () => {
    expect(isKunaiCamoId('dirt')).toBe(true);
    expect(isKunaiCamoId('gold')).toBe(true);
    expect(isKunaiCamoId('tokoyami')).toBe(true);
    expect(isKunaiCamoId('diamond')).toBe(false);
    expect(isKunaiCamoId('dark-matter')).toBe(false);
    expect(isKunaiCamoId('rainbow')).toBe(false);
  });

  it('常闇は近接キル1000で解除', () => {
    expect(isKunaiCamoUnlocked('tokoyami', { kills: 999, headshots: 0 })).toBe(false);
    expect(isKunaiCamoUnlocked('tokoyami', { kills: 1000, headshots: 0 })).toBe(true);
    expect(isKunaiCamoUnlocked('tokoyami', undefined)).toBe(false);
  });

  it('ゴールドはブリンク斬撃キル100(headshots代用)条件を要求', () => {
    expect(isKunaiCamoUnlocked('gold', { kills: 500, headshots: 99 })).toBe(false);
    expect(isKunaiCamoUnlocked('gold', { kills: 500, headshots: 100 })).toBe(true);
    expect(isKunaiCamoUnlocked('gold', { kills: 499, headshots: 200 })).toBe(false);
  });

  it('段階カモはキル閾値を下回ると解除しない', () => {
    expect(isKunaiCamoUnlocked('dirt', { kills: 24, headshots: 0 })).toBe(false);
    expect(isKunaiCamoUnlocked('dirt', { kills: 25, headshots: 0 })).toBe(true);
    expect(isKunaiCamoUnlocked('neon', { kills: 399, headshots: 0 })).toBe(false);
    expect(isKunaiCamoUnlocked('neon', { kills: 400, headshots: 0 })).toBe(true);
  });

  it('kunaiCamoProgress: 常闇の進捗は近接キル/1000', () => {
    const p = kunaiCamoProgress('tokoyami', { kills: 320, headshots: 0 });
    expect(p.current).toBe(320);
    expect(p.target).toBe(1000);
    expect(p.label).toContain('1000');
    const capped = kunaiCamoProgress('tokoyami', { kills: 9999, headshots: 0 });
    expect(capped.current).toBe(1000);
  });

  it('kunaiCamoProgress: ゴールドのキル満了後はブリンク斬撃進捗へ', () => {
    const g = kunaiCamoProgress('gold', { kills: 9999, headshots: 42 });
    expect(g.current).toBe(42);
    expect(g.target).toBe(100);
    expect(g.label).toContain('ブリンク');
  });

  it('equippedCamoFor: fists は常闇ラダーで解除判定', () => {
    expect(
      equippedCamoFor('fists', {
        selectedCamos: { fists: 'dirt' },
        weaponStats: { fists: { kills: 25, headshots: 0 } },
      }),
    ).toBe('dirt');
    expect(
      equippedCamoFor('fists', {
        selectedCamos: { fists: 'tokoyami' },
        weaponStats: { fists: { kills: 1000, headshots: 0 } },
      }),
    ).toBe('tokoyami');
    expect(
      equippedCamoFor('fists', {
        selectedCamos: { fists: 'tokoyami' },
        weaponStats: { fists: { kills: 999, headshots: 0 } },
      }),
    ).toBeNull();
    expect(
      equippedCamoFor('fists', {
        selectedCamos: { fists: 'diamond' },
        weaponStats: { fists: { kills: 9999, headshots: 9999 } },
      }),
    ).toBeNull();
  });

  it('camoName は常闇を日本語名で返す', () => {
    expect(camoName('tokoyami')).toBe('常闇');
    expect(TOKOYAMI_CAMO.name).toBe('常闇');
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

// ── R53-W2: Pack-a-Punch「鍛神」3段(pap1-3・システム付与カモ) ──────────────
describe('PaP鍛神カモ(pap1-3)', () => {
  it('PAP_CAMO_IDSは3種で、CAMO_IDS(通常ラダー)には含まれない', () => {
    expect(PAP_CAMO_IDS).toEqual(['pap1', 'pap2', 'pap3']);
    for (const id of PAP_CAMO_IDS) expect(CAMO_IDS, id).not.toContain(id);
  });

  it('isPapCamoId は pap1-3 のみ真', () => {
    expect(isPapCamoId('pap1')).toBe(true);
    expect(isPapCamoId('pap2')).toBe(true);
    expect(isPapCamoId('pap3')).toBe(true);
    expect(isPapCamoId('gold')).toBe(false);
    expect(isPapCamoId('jingai')).toBe(false);
    expect(isPapCamoId('')).toBe(false);
  });

  it('isKnownCamoId は CAMO_IDS 非対象の pap1-3/tokoyami も真、未知IDは偽', () => {
    for (const id of PAP_CAMO_IDS) expect(isKnownCamoId(id), id).toBe(true);
    expect(isKnownCamoId('tokoyami')).toBe(true);
    expect(isKnownCamoId('rainbow')).toBe(false);
    expect(isKnownCamoId('')).toBe(false);
    // isCamoId(解放ゲート用)は pap1-3/tokoyami を対象外のまま維持する(非回帰)
    expect(isCamoId('pap1')).toBe(false);
    expect(isCamoId('tokoyami')).toBe(false);
  });

  it('PAP_CAMO_NAMESは3段とも「鍛神」を含む日本語名を持つ', () => {
    for (const id of PAP_CAMO_IDS) {
      const name = PAP_CAMO_NAMES[id as 'pap1' | 'pap2' | 'pap3'];
      expect(name, id).toContain('鍛神');
    }
    expect(camoName('pap1')).toBe(PAP_CAMO_NAMES.pap1);
    expect(camoName('pap2')).toBe(PAP_CAMO_NAMES.pap2);
    expect(camoName('pap3')).toBe(PAP_CAMO_NAMES.pap3);
  });

  it('CAMO_VISUALS: pap1-3全てシェーダ生成に必要な値が例外なく揃い、発光は0.55以下', () => {
    for (const id of PAP_CAMO_IDS) {
      const v = CAMO_VISUALS[id];
      expect(v, id).toBeDefined();
      expect(v.id).toBe(id);
      expect(v.emissiveIntensity, id).toBeLessThanOrEqual(0.55);
      expect(v.metalness, id).toBeGreaterThanOrEqual(0);
      expect(v.metalness, id).toBeLessThanOrEqual(1);
      expect(v.roughness, id).toBeGreaterThanOrEqual(0);
      expect(v.roughness, id).toBeLessThanOrEqual(1);
      expect(v.scale, id).toBeGreaterThan(0);
    }
    // pap1=静的回路脈、pap2=時間uniformを使うpulse(微パルス)、pap3=高密度(scaleが最大)
    expect(CAMO_VISUALS.pap1.pattern).toBe('circuit');
    expect(CAMO_VISUALS.pap2.pattern).toBe('pulse');
    expect(CAMO_VISUALS.pap3.pattern).toBe('circuit');
    expect(CAMO_VISUALS.pap3.scale).toBeGreaterThan(CAMO_VISUALS.pap1.scale);
  });

  it('isCamoUnlocked/camoProgress は pap1-3 を通常ラダーの対象にしない(常に false/idx<0)', () => {
    const stats: Record<string, WeaponCamoStats> = { 'kaede-ar': { kills: 99999, headshots: 999 } };
    for (const id of PAP_CAMO_IDS) {
      expect(isCamoUnlocked(id, 'kaede-ar', stats), id).toBe(false);
    }
  });
});

// ── R53-W2: 報酬カモ(jingai/shinrai・章クリア報酬) ───────────────────────
describe('報酬カモ(jingai/shinrai)', () => {
  it('REWARD_CAMO_IDSは2種で、CAMO_IDSに自然に含まれる(ARMORY選択UI互換)', () => {
    expect(REWARD_CAMO_IDS).toEqual(['jingai', 'shinrai']);
    for (const id of REWARD_CAMO_IDS) expect(CAMO_IDS, id).toContain(id);
  });

  it('isRewardCamoId は jingai/shinrai のみ真', () => {
    expect(isRewardCamoId('jingai')).toBe(true);
    expect(isRewardCamoId('shinrai')).toBe(true);
    expect(isRewardCamoId('gold')).toBe(false);
    expect(isRewardCamoId('pap1')).toBe(false);
  });

  it('REWARD_CAMO_CHAPTER: jingai=ch9報酬、shinrai=ch10報酬', () => {
    expect(REWARD_CAMO_CHAPTER.jingai).toBe('ch9');
    expect(REWARD_CAMO_CHAPTER.shinrai).toBe('ch10');
  });

  it('camoName/CAMO_VISUALS: 燼骸/神雷の名前と見た目が例外なく揃う', () => {
    expect(camoName('jingai')).toBe('燼骸');
    expect(camoName('shinrai')).toBe('神雷');
    for (const id of REWARD_CAMO_IDS) {
      const v = CAMO_VISUALS[id];
      expect(v, id).toBeDefined();
      expect(v.emissiveIntensity, id).toBeLessThanOrEqual(0.5);
    }
  });

  it('isCamoUnlocked: rewardUnlocked未指定/空は未解放、指定(配列/Set)で解放される', () => {
    const stats: Record<string, WeaponCamoStats> = {};
    expect(isCamoUnlocked('jingai', 'kaede-ar', stats)).toBe(false);
    expect(isCamoUnlocked('jingai', 'kaede-ar', stats, [])).toBe(false);
    expect(isCamoUnlocked('jingai', 'kaede-ar', stats, ['jingai'])).toBe(true);
    expect(isCamoUnlocked('shinrai', 'kaede-ar', stats, ['jingai'])).toBe(false);
    const asSet = new Set<CamoId>(['shinrai']);
    expect(isCamoUnlocked('shinrai', 'kaede-ar', stats, asSet)).toBe(true);
    expect(isCamoUnlocked('jingai', 'kaede-ar', stats, asSet)).toBe(false);
    // 対象外武器(fists)は報酬カモ集合を渡しても常にfalse
    expect(isCamoUnlocked('jingai', 'fists', stats, ['jingai'])).toBe(false);
  });

  it('camoProgress: 未解放時は章クリア文言のラベルを返す', () => {
    const p1 = camoProgress('jingai', 'kaede-ar', {});
    expect(p1.label).toContain('第9章');
    const p2 = camoProgress('shinrai', 'kaede-ar', {});
    expect(p2.label).toContain('第10章');
  });

  it('equippedCamoFor: unlockedRewardCamosを渡すと報酬カモが装備解決される', () => {
    expect(
      equippedCamoFor('kaede-ar', {
        selectedCamos: { 'kaede-ar': 'jingai' },
        weaponStats: {},
        unlockedRewardCamos: ['jingai'],
      }),
    ).toBe('jingai');
    // 未解放(unlockedRewardCamos省略)は null
    expect(
      equippedCamoFor('kaede-ar', { selectedCamos: { 'kaede-ar': 'jingai' }, weaponStats: {} }),
    ).toBeNull();
    // shinraiはクナイ映え狙いだが、equippedCamoForの通常経路(fists以外)にも普通に載る
    expect(
      equippedCamoFor('tsubaki-smg', {
        selectedCamos: { 'tsubaki-smg': 'shinrai' },
        weaponStats: {},
        unlockedRewardCamos: new Set<CamoId>(['shinrai']),
      }),
    ).toBe('shinrai');
  });
});
