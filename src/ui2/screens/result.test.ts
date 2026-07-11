// W-ENZA2 F8: リザルト純関数のピン(DOM非依存・日付seed非依存)
import { describe, expect, it } from 'vitest';
import {
  medalChips,
  nextRankInfo,
  progressRows,
  resultStageHtml,
  resultStoryMarkers,
  scoreLine,
  statCards,
  storyLabelDrop,
  xpFootnotes,
} from './result';
import { MEDAL_TOTAL } from '../../game/medals';
import {
  emptyProfile,
  levelFromXp,
  rankFromRating,
  rankNameFor,
  type ChallengeDef,
  type MatchProgress,
  type MatchSummary,
} from '../../game/progression';
import type { MatchResult } from '../../game/match-types';

function mkSummary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    won: true,
    rated: true,
    kills: 32,
    deaths: 11,
    headshots: 6,
    shotsFired: 100,
    shotsHit: 41,
    captures: 4,
    bestStreak: 9,
    weaponKills: { 'kaede-ar': 21, suzume: 3 },
    unlockedMedals: [],
    medalCounts: {},
    medalXp: 0,
    ...over,
  };
}

function mkResult(over: Partial<MatchResult> = {}): MatchResult {
  return {
    rows: [
      { name: 'あなた', kills: 32, deaths: 11, isPlayer: true, isAlly: true },
      { name: 'ボット・ツキミ', kills: 21, deaths: 14, isPlayer: false, isAlly: true },
      { name: 'ボット・アカギ', kills: 18, deaths: 16, isPlayer: false, isAlly: false },
    ],
    won: true,
    accuracy: 0.41,
    headshots: 6,
    modeName: 'ハードポイント',
    teamScores: { mine: 75, enemy: 60 },
    summary: mkSummary(),
    ...over,
  };
}

const lvl1 = levelFromXp(0);
function mkProgress(over: Partial<MatchProgress> = {}): MatchProgress {
  return {
    xpBreakdown: [],
    xpTotal: 0,
    levelBefore: lvl1,
    levelAfter: lvl1,
    newUnlocks: [],
    completedChallenges: [],
    ratingBefore: 1000,
    ratingAfter: 1000,
    rankBefore: rankFromRating(1000),
    rankAfter: rankFromRating(1000),
    newRecords: [],
    newCamos: [],
    ...over,
  };
}

describe('scoreLine', () => {
  it('チーム戦はチームスコア2値', () => {
    expect(scoreLine(mkResult())).toEqual({ a: 75, b: 60, kind: 'team' });
  });
  it('S&Dはラウンドスコア', () => {
    expect(scoreLine(mkResult({ teamScores: null, sndScore: [4, 2] }))).toEqual({
      a: 4,
      b: 2,
      kind: 'snd',
    });
  });
  it('個人戦は自分の撃破数のみ(bはnull)', () => {
    expect(scoreLine(mkResult({ teamScores: null }))).toEqual({ a: 32, b: null, kind: 'solo' });
  });
});

describe('statCards', () => {
  it('基本4枚+確保+最多使用(チーム戦)。撃破比はember変種', () => {
    const cards = statCards(mkResult(), mkProgress());
    const labels = cards.map((c) => c.label);
    expect(labels).toEqual(['撃破', '戦死', '撃破比', '命中率', '確保', '最多使用']);
    expect(cards[2]?.variant).toBe('ember');
    expect(cards[2]?.value).toBe('2.91');
    expect(cards[5]?.weaponStyle).toBe(true);
    expect(cards[5]?.sub).toBe('21撃破');
  });
  it('0デスは撃破数をそのまま比とする', () => {
    const r = mkResult();
    r.rows[0] = { ...r.rows[0]!, deaths: 0 };
    const cards = statCards(r, mkProgress());
    expect(cards[2]?.value).toBe('32.00');
  });
  it('自己ベスト更新がある時だけ撃破比カードに▲を出す', () => {
    expect(statCards(mkResult(), mkProgress())[2]?.sub).toBeUndefined();
    expect(statCards(mkResult(), mkProgress({ newRecords: ['K/D 2.91'] }))[2]?.sub).toBe(
      '▲ 自己ベスト更新',
    );
  });
  it('輪廻(ローグ)は供物カードを出し、カード名をsubに刻む', () => {
    const cards = statCards(
      mkResult({
        teamScores: null,
        rogue: { round: 8, cards: ['血の誓約', '鉄の心臓', '風の加護'] },
      }),
      mkProgress(),
    );
    const rogue = cards.find((c) => c.label === '輪廻・供物');
    expect(rogue?.value).toBe('3');
    expect(rogue?.sub).toBe('血の誓約・鉄の心臓 他');
  });
  it('ハイライトはカード列に合流する(上限7枚)', () => {
    const cards = statCards(
      mkResult({
        highlights: [
          { kind: 'longshot', label: '最長距離キル', value: '342m' },
          { kind: 'multikill', label: '五連撃', value: '5連続' },
        ],
      }),
      mkProgress(),
    );
    expect(cards.some((c) => c.label === 'LONGSHOT' && c.value === '342m')).toBe(true);
    expect(cards.length).toBeLessThanOrEqual(7);
  });
  it('ゾンビ戦はラウンド/PTS/鍛神/特異体を出し、確保は出さない(上限7枚)', () => {
    const cards = statCards(
      mkResult({
        teamScores: null,
        zombieRound: 24,
        zombiePoints: 51230,
        papTierMax: 2,
        specialZombieKills: 7,
      }),
      mkProgress(),
    );
    const labels = cards.map((c) => c.label);
    expect(labels).toContain('到達ラウンド');
    expect(labels).toContain('獲得PTS');
    expect(labels).toContain('鍛神改造');
    expect(labels).toContain('特異体討伐');
    expect(labels).not.toContain('確保');
    expect(cards.length).toBeLessThanOrEqual(7);
    expect(cards.find((c) => c.label === '鍛神改造')?.value).toBe('改二');
  });
});

describe('medalChips', () => {
  it('帝王系IDは紫電変種、未知IDはID大文字化+steel', () => {
    const { chips } = medalChips({ 'kokurai-kill': 1, 'unknown-medal': 2 });
    const violet = chips.find((c) => c.variant === 'violet');
    expect(violet).toBeDefined();
    const unknown = chips.find((c) => c.name === 'UNKNOWN MEDAL');
    expect(unknown?.variant).toBe('steel');
    expect(unknown?.xpLabel).toBe('×2');
  });
  it('上位8枚+超過数を返す', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 11; i += 1) counts[`m-${i}`] = i + 1;
    const { chips, overflow } = medalChips(counts);
    expect(chips.length).toBe(8);
    expect(overflow).toBe(3);
    // xp未知(=0)同士はcount降順
    expect(chips[0]?.xpLabel).toBe('×11');
  });
  it('空なら空配列', () => {
    expect(medalChips({})).toEqual({ chips: [], overflow: 0 });
  });
});

describe('nextRankInfo', () => {
  it('L50→次はL100(足軽)まで50', () => {
    const n = nextRankInfo(50);
    expect(n.nextName).toBe(rankNameFor(100).name);
    expect(n.remain).toBe(50);
    expect(n.progress01).toBeGreaterThanOrEqual(0);
    expect(n.progress01).toBeLessThanOrEqual(1);
  });
  it('L312,849→次の十万位階(L400,000)まで87,151', () => {
    const n = nextRankInfo(312849);
    expect(n.remain).toBe(87151);
    expect(n.nextName).toBe(rankNameFor(400000).name);
    expect(n.progress01).toBeCloseTo(0.12849, 4);
  });
  it('L99,999→次はL100,000(超越階級)', () => {
    const n = nextRankInfo(99999);
    expect(n.remain).toBe(1);
    expect(n.nextName).toBe(rankNameFor(100000).name);
  });
});

describe('progressRows', () => {
  it('デイリー未設定日でもメダル図鑑行は必ず出る(分母=MEDAL_TOTAL)', () => {
    const profile = emptyProfile();
    profile.daily.currentDate = '';
    const rows = progressRows(profile, mkProgress());
    expect(rows.length).toBe(1);
    expect(rows[0]?.label).toBe('メダル図鑑');
    expect(rows[0]?.value).toBe(`0/${MEDAL_TOTAL}`);
  });
  it('デイリー設定日は本日の試練3行+達成状態を反映する', () => {
    const profile = emptyProfile();
    profile.daily.currentDate = '20260710';
    profile.daily.progress = [999, 0, 0];
    profile.daily.claimed = [false, true, false];
    const rows = progressRows(profile, mkProgress());
    const daily = rows.filter((r) => r.label.startsWith('本日の試練'));
    expect(daily.length).toBe(3);
    expect(daily[0]?.value).toBe('達成済'); // progress>=target
    expect(daily[1]?.value).toBe('達成済'); // claimed
    expect(daily[2]?.tone).toBe('ember');
    expect(daily[2]?.value).toMatch(/^0\/\d+$/);
  });
  it('生涯挑戦とカモ解除は達成済(ok)行として並ぶ', () => {
    const profile = emptyProfile();
    profile.daily.currentDate = '';
    const rows = progressRows(
      profile,
      mkProgress({
        completedChallenges: [{ name: '合計100キル' } as unknown as ChallengeDef],
        newCamos: [{ label: '楓・金' }] as MatchProgress['newCamos'],
      }),
    );
    expect(rows.some((r) => r.label === '生涯挑戦: 合計100キル' && r.tone === 'ok')).toBe(true);
    expect(rows.some((r) => r.label === 'カモ解除: 楓・金' && r.tone === 'ok')).toBe(true);
  });
});

describe('xpFootnotes', () => {
  it('解放/自己ベスト/SR変動を実データからだけ生成する', () => {
    expect(xpFootnotes(mkProgress())).toEqual([]);
    const notes = xpFootnotes(
      mkProgress({
        newUnlocks: [{ kind: 'weapon', name: 'シラサギAR' }] as MatchProgress['newUnlocks'],
        newRecords: ['最多キル 32'],
        ratingBefore: 1000,
        ratingAfter: 1050,
      }),
    );
    expect(notes.some((n) => n.label === '武器解放: シラサギAR')).toBe(true);
    expect(notes.some((n) => n.label === '自己ベスト: 最多キル 32')).toBe(true);
    expect(notes.some((n) => n.label.startsWith('SR 1000 +50 → 1050'))).toBe(true);
  });
});

// ── R59 重なり根治の契約: 0×0アンカー群(u2r-g*)直下の絶対配置子は明示width/nowrap必須。
// containing block幅0のshrink-to-fitでmin-content幅へ潰れ、CJK折返しで「勝利」が縦積みになり
// マッチストーリー帯・スコアへ食い込んでいた(全アスペクト共通の実測バグ)。
describe('resultStageHtml (R59 アンカー内レイアウト契約)', () => {
  const NOW = new Date(2026, 6, 11);
  const html = (): string => resultStageHtml(mkResult(), mkProgress(), emptyProfile(), NOW);

  it('題字レーンは明示幅1310px+nowrap(min-content潰れ→縦積み再発の禁止)', () => {
    expect(html()).toContain(
      'left:56px;top:104px;width:1310px;white-space:nowrap;display:flex;align-items:flex-end;gap:44px;',
    );
    expect(html()).toContain('勝利');
  });
  it('左上AARヘッダはnowrap(4行折返しの禁止)', () => {
    expect(html()).toContain(
      'left:56px;top:34px;display:flex;align-items:center;gap:14px;white-space:nowrap;',
    );
  });
  it('下部メダル帯はメダルありの時のみ出て、明示幅1310px(max-width不可=幅が確保されない)', () => {
    expect(html()).not.toContain('u2r-medalstrip'); // 既定mkResultはメダル0
    const withMedals = resultStageHtml(
      mkResult({ summary: mkSummary({ medalCounts: { 'kokurai-kill': 2, 'unknown-a': 1 } }) }),
      mkProgress(),
      emptyProfile(),
      NOW,
    );
    expect(withMedals).toContain('u2r-medalstrip');
    expect(withMedals).toContain(
      'left:56px;bottom:56px;display:flex;flex-direction:column;gap:12px;width:1310px;',
    );
    expect(withMedals).not.toContain('max-width:1310px');
  });
  it('縦レーンの回帰ピン: 題字104/ストーリー342/statカード492/スコアボード668', () => {
    const h = resultStageHtml(
      mkResult({ summary: mkSummary({ medalCounts: { 'm-a': 1 } }) }), // markers>2でストーリー帯が出る
      mkProgress(),
      emptyProfile(),
      NOW,
    );
    for (const lane of ['top:104px', 'top:342px', 'top:492px', 'top:668px'])
      expect(h).toContain(lane);
  });
  it('日時は引数から決定論で刻まれる', () => {
    expect(html()).toContain('2026.07.11');
  });
  it('マーカー7個以下はラベル段下げなし、8個以上で交互2段(隣接ラベル衝突の回避)', () => {
    const few = html(); // DROP+VICTORY=2個
    expect(few).not.toContain('margin-top:17px;');
    const counts: Record<string, number> = {};
    for (let i = 0; i < 7; i += 1) counts[`medal-${i}`] = 1; // 6表示+超過1+DROP+VICTORY=9マーカー
    const dense = resultStageHtml(
      mkResult({ summary: mkSummary({ medalCounts: counts }) }),
      mkProgress(),
      emptyProfile(),
      NOW,
    );
    expect(dense).toContain('margin-top:17px;');
  });
});

describe('storyLabelDrop', () => {
  it('合計7以下は常にfalse(16:9従来デザイン完全一致)', () => {
    for (let total = 0; total <= 7; total += 1)
      for (let i = 0; i < total; i += 1) expect(storyLabelDrop(i, total)).toBe(false);
  });
  it('合計8以上は奇数indexのみtrue(交互2段)', () => {
    expect(storyLabelDrop(0, 8)).toBe(false);
    expect(storyLabelDrop(1, 8)).toBe(true);
    expect(storyLabelDrop(2, 8)).toBe(false);
    expect(storyLabelDrop(11, 12)).toBe(true);
  });
});

describe('resultStoryMarkers', () => {
  it('DROPで始まり勝利はgoldのVICTORYで終わる', () => {
    const m = resultStoryMarkers(mkResult(), mkProgress());
    expect(m[0]).toEqual({ kind: 'start', label: 'DROP', tone: 'steel' });
    expect(m[m.length - 1]).toEqual({ kind: 'end', label: 'VICTORY', tone: 'gold' });
  });
  it('帝王メダルはvioletトーン、ゾンビはROUNDマーカーが立つ', () => {
    const m = resultStoryMarkers(
      mkResult({
        zombieRound: 12,
        summary: mkSummary({ medalCounts: { 'kokurai-kill': 3 } }),
      }),
      mkProgress(),
    );
    expect(m.some((x) => x.tone === 'violet' && x.kind === 'medal')).toBe(true);
    expect(m.some((x) => x.kind === 'round' && x.label === 'ROUND 12')).toBe(true);
  });
});
