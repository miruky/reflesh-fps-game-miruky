// R54-F7: リザルト・ハイライト選定(selectHighlights)のテスト。
import { describe, expect, it } from 'vitest';
import { LONGSHOT_MIN_M, selectHighlights } from './highlights';

const base = {
  bestStreak: 0,
  maxKillDistM: 0,
  headshots: 0,
  kills: 0,
  accuracy: 0,
  medalCounts: {} as Record<string, number>,
};

describe('selectHighlights', () => {
  it('何も達成していない試合は0枚(帯なし)', () => {
    expect(selectHighlights(base)).toEqual([]);
  });

  it('マルチキルは最上位1枚のみ(frenzy > triple > double)', () => {
    const cards = selectHighlights({
      ...base,
      medalCounts: { 'double-kill': 3, 'triple-kill': 1, 'frenzy-kill': 1 },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({ kind: 'multikill', label: 'フレンジキル', value: '達成' });
  });

  it('同一段位の複数回は ×n 表記', () => {
    const cards = selectHighlights({ ...base, medalCounts: { 'double-kill': 4 } });
    expect(cards[0]).toEqual({ kind: 'multikill', label: 'ダブルキル', value: '×4' });
  });

  it('ロングショットは閾値以上のみ・m表記', () => {
    expect(selectHighlights({ ...base, maxKillDistM: LONGSHOT_MIN_M - 1 })).toEqual([]);
    const cards = selectHighlights({ ...base, maxKillDistM: 127 });
    expect(cards).toEqual([{ kind: 'longshot', label: 'ロングショット', value: '127m' }]);
  });

  it('モーメントは連鎖>HS>精密>殲滅の優先順で1枚だけ', () => {
    const streak = selectHighlights({ ...base, bestStreak: 9, headshots: 10, kills: 30 });
    expect(streak).toEqual([{ kind: 'moment', label: '連続撃破', value: '9連続' }]);
    const hs = selectHighlights({ ...base, headshots: 6 });
    expect(hs).toEqual([{ kind: 'moment', label: 'ヘッドハンター', value: '6 HS' }]);
    const acc = selectHighlights({ ...base, accuracy: 0.62, kills: 8 });
    expect(acc).toEqual([{ kind: 'moment', label: '精密射撃', value: '62%' }]);
    const kills = selectHighlights({ ...base, kills: 25 });
    expect(kills).toEqual([{ kind: 'moment', label: '殲滅', value: '25キル' }]);
  });

  it('最大3枚・[multikill, longshot, moment] の順で並ぶ', () => {
    const cards = selectHighlights({
      ...base,
      medalCounts: { 'triple-kill': 2 },
      maxKillDistM: 88,
      bestStreak: 12,
      headshots: 9,
      kills: 40,
      accuracy: 0.7,
    });
    expect(cards.map((c) => c.kind)).toEqual(['multikill', 'longshot', 'moment']);
    expect(cards).toHaveLength(3);
  });
});
