// W-ENZA FB9: リザルト(戦闘詳報)の焔座様式 — 文字列を返す純関数ビルダーの検証。
// vitestはnode環境(jsdomなし=プロジェクト方針)のため、DOM描画のshowResult本体ではなく
// HTML生成の実データバインド(最多使用/確保/メダル帯/帝王銘)をピンする。
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../game/match';
import type { MatchProgress } from '../../game/progression';
import type { MenuScreenHost } from './host';
import { matchStoryHtml, medalStripHtml, progressHtml, statCardsHtml } from './result';

function fixtureResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    rows: [],
    won: true,
    accuracy: 0.41,
    headshots: 6,
    modeName: 'ハードポイント',
    teamScores: null,
    summary: {
      won: true,
      rated: true,
      kills: 32,
      deaths: 11,
      headshots: 6,
      shotsFired: 200,
      shotsHit: 82,
      captures: 0,
      bestStreak: 9,
      weaponKills: {},
      unlockedMedals: [],
      medalCounts: {},
      medalXp: 0,
    } as MatchResult['summary'],
    ...overrides,
  };
}

function fixtureProgress(overrides: Partial<MatchProgress> = {}): MatchProgress {
  return {
    xpBreakdown: [
      { label: '撃破×32', xp: 4700 },
      { label: 'デイリー達成！ 業火RLで三連撃', xp: 800 },
    ],
    xpTotal: 5500,
    levelBefore: { level: 12, intoLevel: 10, toNext: 100 },
    levelAfter: { level: 13, intoLevel: 20, toNext: 100 },
    newUnlocks: [],
    completedChallenges: [],
    ratingBefore: 1000,
    ratingAfter: 1000,
    rankBefore: { name: 'ブロンズ' },
    rankAfter: { name: 'ブロンズ' },
    newRecords: [],
    newCamos: [],
    ...overrides,
  } as MatchProgress;
}

const hostStub = { profile: { titles: [] } } as unknown as MenuScreenHost;

describe('statCardsHtml (統計カードの実データバインド)', () => {
  it('最多使用は weaponKills の最大値の武器名+撃破数(実データ)', () => {
    const html = statCardsHtml(
      fixtureResult({
        summary: {
          ...fixtureResult().summary,
          weaponKills: { カエデAR: 21, クナイ: 7 },
        },
      }),
      32,
      11,
    );
    expect(html).toContain('最多使用');
    expect(html).toContain('カエデAR');
    expect(html).toContain('21撃破');
    expect(html).not.toContain('クナイ</span>'); // 2位は出さない(カード1枚)
  });

  it('確保カードは captures>0 のときだけ出る', () => {
    expect(statCardsHtml(fixtureResult(), 32, 11)).not.toContain('確保');
    const withCaps = fixtureResult({
      summary: { ...fixtureResult().summary, captures: 4 },
    });
    expect(statCardsHtml(withCaps, 32, 11)).toContain('確保');
  });

  it('撃破比は0デスでキル数そのまま・emberカード', () => {
    const html = statCardsHtml(fixtureResult(), 5, 0);
    expect(html).toContain('5.00');
    expect(html).toContain('ersl-stat--ember');
  });

  it('ゾンビ固有カード(到達ラウンド/獲得PTS/鍛神/特異体/輪廻)が実データで出る', () => {
    const html = statCardsHtml(
      fixtureResult({
        zombieRound: 18,
        zombiePoints: 12345,
        papTierMax: 2,
        specialZombieKills: 3,
        rogue: { round: 18, cards: ['業火の輪'] },
      }),
      32,
      11,
    );
    expect(html).toContain('到達ラウンド');
    expect(html).toContain('12,345');
    expect(html).toContain('改二');
    expect(html).toContain('特異体討伐');
    expect(html).toContain('輪廻・供物');
  });
});

describe('medalStripHtml (獲得メダル帯)', () => {
  it('medalCountsが空なら帯ごと出さない', () => {
    expect(medalStripHtml(fixtureResult(), 100)).toBe('');
  });

  it('最大8チップ+超過は+N集約、×Nは2個以上のみ', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10; i += 1) counts[`medal-${i}`] = i + 1;
    const html = medalStripHtml(
      fixtureResult({ summary: { ...fixtureResult().summary, medalCounts: counts, medalXp: 2250 } }),
      148,
    );
    expect(html.match(/ersl-medal-chip[" ]/g)!.length).toBe(9); // 8+集約1
    expect(html).toContain('+2</span>'); // 10-8=2件の集約
    expect(html).toContain('×10');
    expect(html).toContain('+2,250 XP'); // medalXp実数
    expect(html).toContain('図鑑 148種');
    expect(html).toContain('10種'); // 取得種数
  });

  it('帝王系=紫電縁、ALWAYS_BADGE級=金縁', () => {
    const html = medalStripHtml(
      fixtureResult({
        summary: {
          ...fixtureResult().summary,
          medalCounts: { 'kokurai-50': 1, nuclear: 1, 'double-kill': 2 },
        },
      }),
      10,
    );
    expect(html).toContain('ersl-medal-chip--emperor');
    expect(html).toContain('KOKURAI 50');
    expect(html).toContain('ersl-medal-chip--gold');
    expect(html).toContain('NUCLEAR');
  });
});

describe('matchStoryHtml (菱ノードのマッチストーリー帯)', () => {
  it('DROP/勝敗のみ(マーカー2件)なら帯を出さない', () => {
    expect(matchStoryHtml(hostStub, fixtureResult(), fixtureProgress({ levelAfter: { level: 12, intoLevel: 0, toNext: 100 } as MatchProgress['levelAfter'], levelBefore: { level: 12, intoLevel: 0, toNext: 100 } as MatchProgress['levelBefore'] }))).toBe('');
  });

  it('帝王系メダルは紫電の大菱+emperor銘になる', () => {
    const html = matchStoryHtml(
      hostStub,
      fixtureResult({
        summary: {
          ...fixtureResult().summary,
          medalCounts: { 'kokurai-descent': 1, 'double-kill': 2 },
        },
      }),
      fixtureProgress(),
    );
    expect(html).toContain('ersl-tl--emperor');
    expect(html).toContain('enza-diamond--emperor');
    expect(html).toContain('KOKURAI DESCENT');
    // 非帝王メダルは通常菱
    expect(html).toContain('ersl-tl--ember');
  });

  it('ノードは3%..97%の等間隔配置で勝利ノードは金菱', () => {
    const html = matchStoryHtml(
      hostStub,
      fixtureResult({
        summary: { ...fixtureResult().summary, medalCounts: { 'double-kill': 1 } },
      }),
      fixtureProgress(),
    );
    expect(html).toContain('left:3.0%');
    expect(html).toContain('left:97.0%');
    expect(html).toContain('enza-diamond--gold'); // VICTORY
    expect(html).toContain('確保回数'); // 実データメタ(捏造の時刻レンジは出さない)
  });
});

describe('progressHtml (経験カード+超越階級)', () => {
  it('XP合計data-id/内訳/デイリー行/レベルアップ/位階注記が出る', () => {
    const html = progressHtml(hostStub, fixtureProgress());
    expect(html).toContain('data-id="xptotal"');
    expect(html).toContain('result-xp-list'); // staggerXpList契約クラス
    expect(html).toContain('xp-daily');
    expect(html).toContain('レベルアップ LV.12 → LV.13');
    expect(html).toContain('位階 '); // 10万未満は位階番号
    expect(html).toContain('profile-xpbar');
  });

  it('10万位階(超越)では伝承注記に切り替わる', () => {
    const html = progressHtml(
      hostStub,
      fixtureProgress({
        levelBefore: { level: 312840, intoLevel: 0, toNext: 100 } as MatchProgress['levelBefore'],
        levelAfter: { level: 312849, intoLevel: 20, toNext: 100 } as MatchProgress['levelAfter'],
      }),
    );
    expect(html).toContain('十万位階の伝承');
    expect(html).toContain('Lv 312,849');
  });

  it('自己ベスト更新は金の注記で出る', () => {
    const html = progressHtml(
      hostStub,
      fixtureProgress({ newRecords: ['最多キル 32'] }),
    );
    expect(html).toContain('自己ベスト更新 最多キル 32');
  });
});
