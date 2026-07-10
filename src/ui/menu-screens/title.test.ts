// W-ENZA FB5: タイトル画面の純ロジック(プロジェクト規約: jsdomなし=DOM描画はテストしない)。
import { describe, expect, it } from 'vitest';
import { BUILD_LABEL } from '../../version';
import { TITLE_NAV, nextTitleIndex, titleActionTarget, titleMetaLines } from './title';

describe('title(焔座タイトル画面)', () => {
  it('ナビは4項目・先頭がゲームスタート・末尾のクレジットのみ減光', () => {
    expect(TITLE_NAV.map((n) => n.id)).toEqual(['start', 'options', 'guide', 'credits']);
    expect(TITLE_NAV[0]?.label).toBe('ゲームスタート');
    expect(TITLE_NAV.map((n) => n.dim)).toEqual([false, false, false, true]);
  });

  it('nextTitleIndex は両端で折り返す', () => {
    expect(nextTitleIndex(0, -1, 4)).toBe(3);
    expect(nextTitleIndex(3, 1, 4)).toBe(0);
    expect(nextTitleIndex(1, 1, 4)).toBe(2);
    expect(nextTitleIndex(2, -1, 4)).toBe(1);
  });

  it('メタ表記は BUILD_LABEL を含み日付を焼き込まない', () => {
    const [a, b] = titleMetaLines(BUILD_LABEL);
    expect(b).toContain(`BUILD ${BUILD_LABEL}`);
    // 「2026.07.10」のような日付の焼き込み禁止(BUILD_LABELが単一の真実)
    expect(`${a} ${b}`).not.toMatch(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
  });

  it('遷移対応: オプション/操作ガイドはシステム頁、クレジットはモーダル', () => {
    expect(titleActionTarget('start')).toBe('start');
    expect(titleActionTarget('options')).toBe('system');
    expect(titleActionTarget('guide')).toBe('system-controls');
    expect(titleActionTarget('credits')).toBe('credits');
  });
});
