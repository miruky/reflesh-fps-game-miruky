import { describe, expect, it } from 'vitest';
import {
  campaignTotals,
  charmChipStatus,
  latestTitle,
  LAST_ZOMBIE_PERK_KEY,
  missionRewardLabel,
  readLastZombiePerk,
  resolveCarriedPerk,
} from './menu';
import { CAMPAIGN } from '../game/campaign';
import { MODE_IDS } from '../game/modes';
import { stagesForMode } from '../game/stages';

// R53-W2 MN2: menu.ts はDOM描画中心のクラスのため(vitestはenvironment:'node'、
// jsdom等は導入しない=既存プロジェクト方針)、フル描画のテストはせず、抽出した
// 純関数のみをここで検証する(hud.tsの既存テスト群と同じ流儀)。

describe('campaignTotals (R53-W2: 48/144ハードコード根治のregression)', () => {
  it('CAMPAIGN実データで61ミッション/★183点(帝王編+R54-F6隠し章chB歴戦の間を含む)', () => {
    expect(campaignTotals(CAMPAIGN)).toEqual({ missions: 61, starsMax: 183 });
  });

  it('章数に依らず自動追従する(章0/1/2件で算出)', () => {
    expect(campaignTotals([])).toEqual({ missions: 0, starsMax: 0 });
    expect(campaignTotals([{ missions: [1, 2, 3] }])).toEqual({ missions: 3, starsMax: 9 });
    expect(campaignTotals([{ missions: [1] }, { missions: [1, 2] }])).toEqual({
      missions: 3,
      starsMax: 9,
    });
  });
});

describe('missionRewardLabel', () => {
  it('rewardId未指定/不正IDはnull(バッジを出さない)', () => {
    expect(missionRewardLabel(undefined)).toBeNull();
    expect(missionRewardLabel('not-a-camo')).toBeNull();
  });

  it('既知の報酬カモIDは表示名を返す(ch9=燼骸/ch10=神雷)', () => {
    expect(missionRewardLabel('jingai')).toBe('燼骸');
    expect(missionRewardLabel('shinrai')).toBe('神雷');
  });

  it('CAMPAIGNのch10最終決戦(c10m6)にrewardId=shinraiが設定されている', () => {
    const c10 = CAMPAIGN.find((c) => c.id === 'ch10');
    const finalMission = c10?.missions.find((m) => m.id === 'c10m6-kurogane-throne');
    expect(missionRewardLabel(finalMission?.rewardId)).toBe('神雷');
  });
});

describe('charmChipStatus', () => {
  it('charms未設定(旧プロフィール)は常にlocked', () => {
    expect(charmChipStatus(undefined, 'startpt')).toBe('locked');
  });

  it('未解放IDはlocked', () => {
    expect(charmChipStatus({ unlocked: [], equipped: null }, 'startpt')).toBe('locked');
  });

  it('解放済み・未装備はunlocked', () => {
    expect(charmChipStatus({ unlocked: ['startpt'], equipped: null }, 'startpt')).toBe('unlocked');
  });

  it('解放済み・装備中はequipped', () => {
    expect(charmChipStatus({ unlocked: ['startpt'], equipped: 'startpt' }, 'startpt')).toBe(
      'equipped',
    );
  });

  it('他charmを装備中でも、問い合わせ対象自身が未解放ならlocked', () => {
    expect(charmChipStatus({ unlocked: ['startpt'], equipped: 'startpt' }, 'revive')).toBe(
      'locked',
    );
  });
});

describe('resolveCarriedPerk (継承の守り札)', () => {
  it('perkcarry未装備なら常にundefined(保存値があっても無視)', () => {
    expect(resolveCarriedPerk(undefined, 'juggernog')).toBeUndefined();
    expect(resolveCarriedPerk('startpt', 'juggernog')).toBeUndefined();
  });

  it('perkcarry装備中は保存されたパークをそのまま返す', () => {
    expect(resolveCarriedPerk('perkcarry', 'juggernog')).toBe('juggernog');
  });

  it('perkcarry装備中でも保存値が無ければundefined(無害なノーオペ)', () => {
    expect(resolveCarriedPerk('perkcarry', null)).toBeUndefined();
  });
});

describe('readLastZombiePerk (書き込み側はmatch.ts担当・読み取りのみ検証)', () => {
  function fakeStorage(value: string | null): Pick<Storage, 'getItem'> {
    return { getItem: () => value };
  }

  it('キー未設定はnull', () => {
    expect(readLastZombiePerk(fakeStorage(null))).toBeNull();
  });

  it('壊れたJSONはnull(例外を握りつぶす)', () => {
    expect(readLastZombiePerk(fakeStorage('{not-json'))).toBeNull();
  });

  it('未知のパークIDはnull', () => {
    expect(readLastZombiePerk(fakeStorage(JSON.stringify('not-a-perk')))).toBeNull();
  });

  it('既知のZombiePerkIdはそのまま返す', () => {
    expect(readLastZombiePerk(fakeStorage(JSON.stringify('juggernog')))).toBe('juggernog');
  });

  it('キー名は凍結された契約文字列', () => {
    expect(LAST_ZOMBIE_PERK_KEY).toBe('hibana.zombie.lastPerk.v1');
  });
});

describe('latestTitle (profile.titles)', () => {
  it('未設定/空配列はnull', () => {
    expect(latestTitle(undefined)).toBeNull();
    expect(latestTitle([])).toBeNull();
  });

  it('配列末尾(最新の解放)を返す', () => {
    expect(latestTitle(['称号A', '称号B'])).toBe('称号B');
  });
});

describe('S&Dモードのメニュー導線(データ駆動の確認・task3)', () => {
  it('MODE_IDSに snd が含まれ、メニューのモード一覧に自動で出る', () => {
    expect(MODE_IDS).toContain('snd');
  });

  it('stagesForMode("snd") は他のチーム系モードと同じステージ集合(ゾンビ/トレーニング除外)', () => {
    const snd = stagesForMode('snd');
    const tdm = stagesForMode('tdm');
    expect(snd.map((s) => s.id)).toEqual(tdm.map((s) => s.id));
    expect(snd.length).toBeGreaterThan(0);
  });
});

// ── R53 MK.III (Fable#4): メニュー/ARMORY層の純関数 ─────────────────────
import { EXOTIC_LORE, matchStoryMarkers, rankStampChar, weaponDiffChips } from './menu';
import { WEAPON_DEFS, PRIMARY_IDS, SECONDARY_IDS } from '../game/weapons';
import type { MatchResult } from '../game/match';
import type { MatchProgress } from '../game/progression';

describe('rankStampChar (ワードマーク判子)', () => {
  it('階級名の先頭1文字を返す(サロゲート安全)', () => {
    expect(rankStampChar('森羅万象')).toBe('森');
    expect(rankStampChar('新兵')).toBe('新');
  });
  it('空文字はフォールバック「兵」', () => {
    expect(rankStampChar('')).toBe('兵');
  });
});

describe('weaponDiffChips (ARMORY装備差分)', () => {
  it('同一武器は空配列', () => {
    const def = WEAPON_DEFS['kaede-ar']!;
    expect(weaponDiffChips(def, def)).toEqual([]);
  });
  it('TTKは低いほど良い(lowerIsBetter)、DPS/RPM/装弾は高いほど良い', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    const faster = { ...base, id: 'x-test', rpm: base.rpm * 2, magazineSize: base.magazineSize + 10 };
    const chips = weaponDiffChips(faster, base);
    const byLabel = Object.fromEntries(chips.map((c) => [c.label, c]));
    expect(byLabel['DPS']!.better).toBe(true);
    expect(byLabel['RPM']!.better).toBe(true);
    expect(byLabel['装弾']!.better).toBe(true);
    // rpm2倍でTTK(ms)は下がる=better
    if (byLabel['TTK']) expect(byLabel['TTK']!.better).toBe(byLabel['TTK']!.delta < 0);
  });
  it('差が0の軸はチップを出さない', () => {
    const base = WEAPON_DEFS['kaede-ar']!;
    const clone = { ...base, id: 'y-test' };
    expect(weaponDiffChips(clone, base)).toEqual([]);
  });
});

describe('EXOTIC_LORE (神殿解説データ)', () => {
  it('EXOTIC全機種(class===exotic、主武器+副武器=万刃)を網羅している', () => {
    const exoticIds = [...PRIMARY_IDS, ...SECONDARY_IDS].filter(
      (id) => WEAPON_DEFS[id]?.class === 'exotic',
    );
    expect(exoticIds.length).toBeGreaterThanOrEqual(7);
    for (const id of exoticIds) {
      expect(EXOTIC_LORE[id], id).toBeDefined();
      expect(EXOTIC_LORE[id]!.charge.length).toBeGreaterThan(0);
      expect(EXOTIC_LORE[id]!.ult.length).toBeGreaterThan(0);
    }
  });
});

function storyResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    rows: [],
    won: true,
    accuracy: 0.3,
    headshots: 2,
    modeName: 'チームデスマッチ',
    teamScores: null,
    summary: {
      won: true, rated: true, kills: 5, deaths: 1, headshots: 2, shotsFired: 50, shotsHit: 15,
      captures: 0, bestStreak: 3, weaponKills: {}, unlockedMedals: [],
      medalCounts: { 'double-kill': 2, 'triple-kill': 1 }, medalXp: 0,
    } as MatchResult['summary'],
    ...overrides,
  };
}
function storyProgress(levelBefore = 5, levelAfter = 5): MatchProgress {
  return {
    levelBefore: { level: levelBefore, intoLevel: 0, toNext: 100 },
    levelAfter: { level: levelAfter, intoLevel: 0, toNext: 100 },
  } as MatchProgress;
}

describe('matchStoryMarkers (リザルトのマッチストーリー帯)', () => {
  it('DROPで始まり勝敗で終わる', () => {
    const m = matchStoryMarkers(storyResult(), storyProgress());
    expect(m[0]!.kind).toBe('start');
    expect(m[m.length - 1]!.kind).toBe('end');
    expect(m[m.length - 1]!.label).toBe('VICTORY');
    expect(m[m.length - 1]!.tone).toBe('gold');
  });
  it('敗北はsteelのDEFEAT', () => {
    const m = matchStoryMarkers(storyResult({ won: false }), storyProgress());
    expect(m[m.length - 1]!.label).toBe('DEFEAT');
    expect(m[m.length - 1]!.tone).toBe('steel');
  });
  it('メダルは件数降順で最大6件+超過は+N MEDALS集約', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 9; i += 1) counts[`medal-${i}`] = i + 1;
    const m = matchStoryMarkers(
      storyResult({ summary: { ...storyResult().summary, medalCounts: counts } }),
      storyProgress(),
    );
    const medals = m.filter((x) => x.kind === 'medal');
    expect(medals.length).toBe(7); // 6 + 集約1
    expect(medals[medals.length - 1]!.label).toBe('+3 MEDALS');
    expect(medals[0]!.label).toContain('×9'); // 最多が先頭
  });
  it('PaP/到達ラウンド/レベルアップのマーカーが出る', () => {
    const m = matchStoryMarkers(
      storyResult({ papTierMax: 2, zombieRound: 18 }),
      storyProgress(5, 7),
    );
    expect(m.some((x) => x.kind === 'pap' && x.label.includes('弐'))).toBe(true);
    expect(m.some((x) => x.kind === 'round' && x.label === 'ROUND 18')).toBe(true);
    expect(m.some((x) => x.kind === 'levelup' && x.label === 'LV.7')).toBe(true);
  });
});
