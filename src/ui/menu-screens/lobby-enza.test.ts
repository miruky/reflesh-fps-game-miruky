// W-ENZA FB7: 出撃ロビー焔座様式の純関数ピン(node環境 — DOM不要のHTML文字列生成を検証)
import { describe, expect, it } from 'vitest';
import { modeCardHtml, parLabel, squadCardHtml, stageBandHtml } from './lobby';

describe('parLabel (規定時間の計器表示)', () => {
  it('m:ss 形式で秒をゼロ詰めする', () => {
    expect(parLabel(90)).toBe('1:30');
    expect(parLabel(300)).toBe('5:00');
    expect(parLabel(61)).toBe('1:01');
    expect(parLabel(45)).toBe('0:45');
  });
});

describe('modeCardHtml (祭壇ナビの行)', () => {
  it('菱マーカー+大項目+説明sublineの焔座構造を持つ', () => {
    const html = modeCardHtml('個人戦', '全員が敵。上位を狙え');
    expect(html).toContain('elby-mode-mark');
    expect(html).toContain('elby-mode-name');
    expect(html).toContain('elby-mode-desc');
    expect(html).toContain('個人戦');
    expect(html).toContain('全員が敵。上位を狙え');
  });
});

describe('squadCardHtml (分隊カード=実データのみ)', () => {
  it('定員=ボット+1、階級とLvと分隊長を表示する', () => {
    const html = squadCardHtml('森羅万象・参', 312847, 11, false);
    expect(html).toContain('最大12人');
    expect(html).toContain('森羅万象・参');
    expect(html).toContain('Lv 312,847');
    expect(html).toContain('分隊長');
    expect(html).toContain('AIボット <b>11体</b>');
    expect(html).toContain('参戦準備完了');
  });
  it('訓練場は単独出撃表記になる', () => {
    const html = squadCardHtml('新兵', 1, 12, true);
    expect(html).toContain('訓練場 — 単独出撃');
    expect(html).not.toContain('参戦準備完了');
  });
});

describe('stageBandHtml (次のステージ帯)', () => {
  it('実ステージ名/モード名+出撃準備完了を表示し、架空の開始カウントを出さない', () => {
    const html = stageBandHtml('夜市', 'ハードポイント');
    expect(html).toContain('次のステージ');
    expect(html).toContain('夜市');
    expect(html).toContain('ハードポイント');
    expect(html).toContain('出撃準備完了');
    expect(html).not.toContain('00:12'); // モックのダミーカウントは移植しない
  });
});
