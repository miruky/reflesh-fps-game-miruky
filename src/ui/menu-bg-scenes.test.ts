// W-ENZA FA4: 焔座 情景レイヤ(title/lobby/result)の構造不変条件
// - 粒子上限(火の粉≦80/星≦200)と規約(画像/外部参照/filter不使用)をピンする
// - ビルダーは純関数(DOM不要)なので文字列レベルで検証する
import { describe, expect, it } from 'vitest';
import { lobbySceneHtml, resultSceneHtml, titleSceneHtml } from './menu-bg';

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('焔座情景レイヤ', () => {
  const title = titleSceneHtml();
  const lobby = lobbySceneHtml();
  const result = resultSceneHtml();

  it('タイトル: 光柱6+目盛環+円環鍔の短剣+火の粉48(上限80以内)', () => {
    expect(count(title, 'ebg-t-shaft')).toBe(6);
    expect(title).toContain('ebg-t-dial');
    expect(title).toContain('ebg-t-dagger');
    // 短剣の要素: 環(鍔)・刃のグラデ・床フレア
    expect(title).toContain('stroke-width="8.5"');
    expect(title).toContain('url(#ebgTBlade)');
    expect(count(title, 'ebg-t-flare')).toBe(1);
    expect(count(title, 'ebg-ember')).toBe(48);
    expect(count(title, 'ebg-ember')).toBeLessThanOrEqual(80);
  });

  it('ロビー: 雲3+星40(上限200以内)+都市+幟2(菱紋)+塵26+地面', () => {
    expect(count(lobby, 'ebg-l-cloud')).toBe(3);
    expect(count(lobby, '<circle')).toBeGreaterThanOrEqual(40); // 星40+紋の環1
    expect(count(lobby, '<circle')).toBeLessThanOrEqual(200);
    expect(lobby).toContain('ebg-l-city');
    expect(count(lobby, 'ebg-l-banner ')).toBe(2);
    // 菱紋: 45°回転の正方形(外菱+内菱)が幟ごとに2つ
    expect(count(lobby, 'rotate(45 46 118)')).toBe(4);
    expect(count(lobby, 'ebg-ember')).toBe(26);
    expect(lobby).toContain('ebg-l-ground');
  });

  it('リザルト: 走査光1+火の粉30(控えめ・上限80以内)', () => {
    expect(count(result, 'ebg-r-sweep')).toBe(1);
    expect(count(result, 'ebg-ember')).toBe(30);
    expect(count(result, 'ebg-ember')).toBeLessThanOrEqual(80);
  });

  it('規約: 画像/外部参照/filterを一切含まない(アセットレス+鉄則)', () => {
    for (const html of [title, lobby, result]) {
      expect(html).not.toContain('<img');
      // SVG名前空間(xmlns)は外部fetchではないので除外して判定する
      expect(html.replaceAll('http://www.w3.org/2000/svg', '')).not.toContain('http');
      expect(html).not.toContain('filter');
      expect(html).not.toContain('@font-face');
    }
  });

  it('粒子はCSS変数駆動(負のdelayで場が満ちた状態から始まる)', () => {
    expect(title).toContain('--delay:-');
    expect(title).toContain('--ty:-58vh');
    expect(lobby).toContain('--ty:-70vh');
    expect(result).toContain('--ty:-80vh');
  });
});
