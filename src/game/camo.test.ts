import { describe, expect, it } from 'vitest';
import {
  applyCamoStats,
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
  EXOTIC_GOLD_HS,
  EXOTIC_GOLD_KILLS,
  goldConditionFor,
  goldFor,
  goldForWeapon,
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

// exoticクラスの代表武器(HSが非現実的な弓/ビーム。gold緩和=HS100→50の検証に使う)
const EXOTIC_ID = 'gekkou-bow';
const EXOTIC_ID2 = 'shinkirou-sniper';

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

  // R57-⑤: ダイヤは反復タイル(facet=floor格子)を廃し「継ぎ目のない一面クリスタル」pattern
  // 'crystal' へ再設計した。facet は jingai 専用に残る(ダイヤは crystal を使う)ことを固定する。
  it('diamond は crystal パターン(タイル格子の facet を使わない)/ facet は jingai が使う', () => {
    expect(CAMO_VISUALS.diamond.pattern).toBe('crystal');
    expect(CAMO_VISUALS.jingai.pattern).toBe('facet');
    // 鏡面ギラつきレバーは白飛び根治済みの安全値を維持(不可侵)
    expect(CAMO_VISUALS.diamond.metalness).toBe(0.95);
    expect(CAMO_VISUALS.diamond.envMapIntensity).toBe(0.7);
    expect(CAMO_VISUALS.diamond.emissiveIntensity).toBeLessThanOrEqual(0.3);
  });

  // R55 W-C3根治(LOW[27]): diamondのsparkle/envMapIntensityに機械検査が無かった。
  // 白飛び再発禁止(bloom閾値0.9)の実務上限として sparkle<=0.6 / envMapIntensity<=1.0 を
  // 全カモ(CAMO_VISUALS走査=CAMO_IDS+pap1-3+tokoyami+報酬カモを含む全定義)で機械検査する。
  // R56④: 「更にギラギラ」要望でdiamond.sparkleを0.55→0.62へ引き上げた(viewmodel.ts側は
  // glitAmt/iridAmt係数を絞り直し、密度は上げつつ1点あたりの加算量は減らしたため合計
  // エネルギーはむしろ抑制側)。実務上限を0.6→0.7へ緩和(依然として0.62に余裕を持たせた
  // 保守的な値)。実WebGL(SwiftShader・worst-caseな明るいステージ相当の光源+IBLで検証)で
  // 飽和ピクセル(R/G/B いずれか255)比率=0を確認した上での緩和(検証スクリプトは確認後削除)。
  it('sparkle/envMapIntensity は指定時のみ、白飛び回避の上限内(sparkle<=0.7, envMapIntensity<=1.0)', () => {
    for (const id of Object.keys(CAMO_VISUALS) as CamoId[]) {
      const v = CAMO_VISUALS[id];
      if (v.sparkle !== undefined) {
        expect(v.sparkle, id).toBeGreaterThanOrEqual(0);
        expect(v.sparkle, id).toBeLessThanOrEqual(0.7);
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
    expect(weaponIdByName('FAMAS-G4')).toBe('kaede-ar');
    expect(weaponIdByName('DSR')).toBe('yamasemi-dmr');
    expect(weaponIdByName('近接')).toBeNull();
    expect(weaponIdByName('フラグ')).toBeNull();
    expect(weaponNameOf('kaede-ar')).toBe('FAMAS-G4');
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

// ── R57-⑤ C: exotic金の解除閾値・3経路の単一真実源(逆転解消) ──────────────
describe('exotic金の解除条件統一(goldForWeapon / camoProgress / camoTierForが一致)', () => {
  it('exoticクラスと判定が前提どおり(gekkou-bow/shinkirou-sniperはexotic)', () => {
    expect(WEAPON_DEFS[EXOTIC_ID]?.class).toBe('exotic');
    expect(WEAPON_DEFS[EXOTIC_ID2]?.class).toBe('exotic');
    expect(camoClassOf('kaede-ar')).toBe('ar');
  });

  it('緩和ポリシーはHSのみ(500kills / HS100→50)。定数と goldConditionFor が単一真実源', () => {
    expect(EXOTIC_GOLD_KILLS).toBe(500); // キルは標準goldと同じ500(ラダー単調性を維持)
    expect(EXOTIC_GOLD_HS).toBe(50); // HSのみ緩和
    expect(goldConditionFor(EXOTIC_ID)).toEqual({ kills: 500, headshots: 50 });
    expect(goldConditionFor(EXOTIC_ID2)).toEqual({ kills: 500, headshots: 50 });
    // 非exoticは標準(500/100)のまま
    expect(goldConditionFor('kaede-ar')).toEqual({ kills: 500, headshots: 100 });
  });

  // 3経路(装備ゲート=goldForWeapon / 進捗表示=camoProgress / 解除通知=camoTierFor(weaponId付))が
  // 常に同じ結論を出すことを、しきい値境界で機械照合する
  const goldByProgress = (id: string, s: WeaponCamoStats): boolean => {
    const p = camoProgress('gold', id, { [id]: s });
    return p.current >= p.target;
  };
  const goldByTier = (id: string, s: WeaponCamoStats): boolean =>
    camoTierFor(s, id) >= CAMO_TIERS.length;

  it('exotic金: 3経路が境界(500/50)で完全一致する', () => {
    for (const s of [
      { kills: 499, headshots: 50 },
      { kills: 500, headshots: 49 },
      { kills: 500, headshots: 50 }, // ← ここで解除
      { kills: 700, headshots: 80 },
      { kills: 250, headshots: 50 }, // 旧250緩和の名残では解除されないこと
      { kills: 400, headshots: 50 }, // 旧400ループバグでは解除されていた点=今は未解除
    ] as WeaponCamoStats[]) {
      const gate = goldForWeapon(EXOTIC_ID, s);
      expect(goldByProgress(EXOTIC_ID, s), `progress@${s.kills}/${s.headshots}`).toBe(gate);
      expect(goldByTier(EXOTIC_ID, s), `tier@${s.kills}/${s.headshots}`).toBe(gate);
    }
    // 具体値: 500/50 で解除、500/49 と 400/50 と 250/50 は未解除
    expect(goldForWeapon(EXOTIC_ID, { kills: 500, headshots: 50 })).toBe(true);
    expect(goldForWeapon(EXOTIC_ID, { kills: 500, headshots: 49 })).toBe(false);
    expect(goldForWeapon(EXOTIC_ID, { kills: 400, headshots: 50 })).toBe(false);
    expect(goldForWeapon(EXOTIC_ID, { kills: 250, headshots: 50 })).toBe(false);
  });

  it('camoProgress(exotic gold): キル満了後のHS目標は50(旧250表示ではない)', () => {
    // キル未満はキル進捗(target=500)
    const pk = camoProgress('gold', EXOTIC_ID, { [EXOTIC_ID]: { kills: 300, headshots: 0 } });
    expect(pk.target).toBe(500);
    expect(pk.current).toBe(300);
    // キル満了後はHS進捗(target=50)
    const ph = camoProgress('gold', EXOTIC_ID, { [EXOTIC_ID]: { kills: 999, headshots: 20 } });
    expect(ph.target).toBe(50);
    expect(ph.current).toBe(20);
    expect(ph.label).toContain('HS');
  });

  it('camoTierFor: weaponId省略は従来どおり標準500/100(後方互換・非exotic影響なし)', () => {
    // exotic を 500/50 にしても、weaponId省略(標準)では gold未達(8段)
    expect(camoTierFor({ kills: 500, headshots: 50 })).toBe(8);
    expect(camoTierFor({ kills: 500, headshots: 100 })).toBe(9);
    // weaponId=exotic を渡すと 500/50 で9段
    expect(camoTierFor({ kills: 500, headshots: 50 }, EXOTIC_ID)).toBe(9);
    // 非exotic weaponId は標準500/100
    expect(camoTierFor({ kills: 500, headshots: 50 }, 'kaede-ar')).toBe(8);
    expect(camoTierFor({ kills: 500, headshots: 100 }, 'kaede-ar')).toBe(9);
  });

  it('非exotic武器の金判定は不変(500/100)。3経路も一致', () => {
    const s99 = { kills: 500, headshots: 99 };
    const s100 = { kills: 500, headshots: 100 };
    expect(goldForWeapon('kaede-ar', s99)).toBe(false);
    expect(goldByTier('kaede-ar', s99)).toBe(false);
    expect(goldByProgress('kaede-ar', s99)).toBe(false);
    expect(goldForWeapon('kaede-ar', s100)).toBe(true);
    expect(goldByTier('kaede-ar', s100)).toBe(true);
    expect(goldByProgress('kaede-ar', s100)).toBe(true);
  });

  it('解放順の逆転なし: exoticはダイヤより先or同時に金が解ける(金≤ダイヤ)', () => {
    const exoticIds = camoWeaponsOfClass('exotic');
    expect(exoticIds.length).toBeGreaterThan(1);
    // 全exoticを金ちょうど(500/50)にするとダイヤ成立、かつ各武器の金も成立(=同時)
    const allExoticGold: Record<string, WeaponCamoStats> = {};
    for (const id of exoticIds) allExoticGold[id] = { kills: 500, headshots: 50 };
    expect(diamondFor('exotic', allExoticGold)).toBe(true);
    for (const id of exoticIds) expect(goldForWeapon(id, allExoticGold[id]), id).toBe(true);
    // 1本だけ金未達(HS49)にするとダイヤは崩れるが、金到達済みの他武器の金は保持される
    // (=金がダイヤより先に立つ=逆転しない)
    const oneShort = { ...allExoticGold };
    const first = exoticIds[0]!;
    oneShort[first] = { kills: 500, headshots: 49 };
    expect(diamondFor('exotic', oneShort)).toBe(false);
    expect(goldForWeapon(first, oneShort[first])).toBe(false);
    const other = exoticIds[1]!;
    expect(goldForWeapon(other, oneShort[other])).toBe(true); // 金は先に解けている
    // isCamoUnlocked(装備ゲート)も同じ結論(単一真実源)
    expect(isCamoUnlocked('gold', other, oneShort)).toBe(true);
    expect(isCamoUnlocked('diamond', other, oneShort)).toBe(false);
    expect(isCamoUnlocked('gold', first, oneShort)).toBe(false);
  });
});

// ── R57-⑤ B: カモ性能ボーナス(applyCamoStats) ─────────────────────────────
describe('applyCamoStats(カモ性能ボーナス)', () => {
  const base = WEAPON_DEFS['kaede-ar']!;

  it('通常カモ/未装備/未知IDは素通し(同一参照・非破壊)', () => {
    expect(applyCamoStats(base, 'red')).toBe(base);
    expect(applyCamoStats(base, 'neon')).toBe(base);
    expect(applyCamoStats(base, 'dirt')).toBe(base);
    expect(applyCamoStats(base, '')).toBe(base);
    expect(applyCamoStats(base, 'rainbow')).toBe(base);
    // 報酬/PaPカモは性能ボーナス対象外(素通し)
    expect(applyCamoStats(base, 'jingai')).toBe(base);
    expect(applyCamoStats(base, 'pap3')).toBe(base);
    expect(applyCamoStats(base, 'tokoyami')).toBe(base);
  });

  it('gold: リロード/ADS/持ち替えが8%高速化。火力・射程・弾数・移動精度・反動は不変', () => {
    const g = applyCamoStats(base, 'gold');
    expect(g).not.toBe(base);
    expect(g.reloadTacticalMs).toBeCloseTo(base.reloadTacticalMs * 0.92, 6);
    expect(g.reloadEmptyMs).toBeCloseTo(base.reloadEmptyMs * 0.92, 6);
    expect(g.adsTimeMs).toBeCloseTo(base.adsTimeMs * 0.92, 6);
    expect(g.switchMs).toBeCloseTo(base.switchMs * 0.92, 6);
    // ハンドリング以外(バランス直結)は一切変えない
    expect(g.damage).toBe(base.damage);
    expect(g.rpm).toBe(base.rpm);
    expect(g.range).toBe(base.range);
    expect(g.magazineSize).toBe(base.magazineSize);
    expect(g.falloff).toEqual(base.falloff);
    // goldは移動精度/反動には手を付けない
    expect(g.movementSpreadDeg).toBe(base.movementSpreadDeg);
    expect(g.recoilRecoveryPerS).toBe(base.recoilRecoveryPerS);
    expect(g.recoilPattern[0]!.pitch).toBe(base.recoilPattern[0]!.pitch);
  });

  it('diamond: gold相当 + 移動精度/反動-10% + 反動収束+10%', () => {
    const d = applyCamoStats(base, 'diamond');
    expect(d.reloadTacticalMs).toBeCloseTo(base.reloadTacticalMs * 0.92, 6);
    expect(d.adsTimeMs).toBeCloseTo(base.adsTimeMs * 0.92, 6);
    expect(d.switchMs).toBeCloseTo(base.switchMs * 0.92, 6);
    expect(d.movementSpreadDeg).toBeCloseTo(base.movementSpreadDeg * 0.9, 6);
    expect(d.recoilRecoveryPerS).toBeCloseTo(base.recoilRecoveryPerS * 1.1, 6);
    // recoilPattern は要素ごとに0.9スケール(配列は別参照=元defを汚さない)
    expect(d.recoilPattern).not.toBe(base.recoilPattern);
    for (let i = 0; i < base.recoilPattern.length; i += 1) {
      expect(d.recoilPattern[i]!.pitch).toBeCloseTo(base.recoilPattern[i]!.pitch * 0.9, 9);
      expect(d.recoilPattern[i]!.yaw).toBeCloseTo(base.recoilPattern[i]!.yaw * 0.9, 9);
    }
    // 火力系は不変
    expect(d.damage).toBe(base.damage);
    expect(d.rpm).toBe(base.rpm);
  });

  it('dark-matter: diamondより更に上(-12% / 移動精度・反動-15% / 収束+15%)', () => {
    const dm = applyCamoStats(base, 'dark-matter');
    const d = applyCamoStats(base, 'diamond');
    expect(dm.reloadTacticalMs).toBeCloseTo(base.reloadTacticalMs * 0.88, 6);
    expect(dm.adsTimeMs).toBeCloseTo(base.adsTimeMs * 0.88, 6);
    expect(dm.movementSpreadDeg).toBeCloseTo(base.movementSpreadDeg * 0.85, 6);
    expect(dm.recoilRecoveryPerS).toBeCloseTo(base.recoilRecoveryPerS * 1.15, 6);
    // 段階性: dark-matter は diamond より速い/精密(数値が更に良い)
    expect(dm.adsTimeMs).toBeLessThan(d.adsTimeMs);
    expect(dm.reloadTacticalMs).toBeLessThan(d.reloadTacticalMs);
    expect(dm.movementSpreadDeg).toBeLessThan(d.movementSpreadDeg);
    expect(dm.recoilPattern[0]!.pitch).toBeLessThan(d.recoilPattern[0]!.pitch);
  });

  it('元defを一切変更しない(純関数・全カモで検証)', () => {
    const snap = {
      reloadTacticalMs: base.reloadTacticalMs,
      reloadEmptyMs: base.reloadEmptyMs,
      adsTimeMs: base.adsTimeMs,
      switchMs: base.switchMs,
      movementSpreadDeg: base.movementSpreadDeg,
      recoilRecoveryPerS: base.recoilRecoveryPerS,
      recoilPattern0Pitch: base.recoilPattern[0]!.pitch,
      recoilPattern0Yaw: base.recoilPattern[0]!.yaw,
    };
    for (const camo of ['gold', 'diamond', 'dark-matter', 'red', ''] as const) {
      applyCamoStats(base, camo);
    }
    expect(base.reloadTacticalMs).toBe(snap.reloadTacticalMs);
    expect(base.reloadEmptyMs).toBe(snap.reloadEmptyMs);
    expect(base.adsTimeMs).toBe(snap.adsTimeMs);
    expect(base.switchMs).toBe(snap.switchMs);
    expect(base.movementSpreadDeg).toBe(snap.movementSpreadDeg);
    expect(base.recoilRecoveryPerS).toBe(snap.recoilRecoveryPerS);
    expect(base.recoilPattern[0]!.pitch).toBe(snap.recoilPattern0Pitch);
    expect(base.recoilPattern[0]!.yaw).toBe(snap.recoilPattern0Yaw);
  });

  it('exotic武器にも適用できる(idではなくcamoIdで分岐)', () => {
    const ex = WEAPON_DEFS[EXOTIC_ID]!;
    const g = applyCamoStats(ex, 'gold');
    expect(g.adsTimeMs).toBeCloseTo(ex.adsTimeMs * 0.92, 6);
    expect(g.damage).toBe(ex.damage);
  });
});
