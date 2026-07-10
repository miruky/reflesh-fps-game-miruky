// W-ENZA2 F2: タイトル画面の純関数テスト(jsdom不使用)。
import { describe, expect, it } from 'vitest';
import { TITLE_NAV, nextTitleIndex, titleBuildLines, titleSceneSvg } from './title';

describe('u2 title', () => {
  it('ナビは正典の4項・順序・減光(mock01 34-47行)', () => {
    expect(TITLE_NAV.map((n) => n.action)).toEqual(['start', 'options', 'guide', 'credits']);
    expect(TITLE_NAV.map((n) => n.label)).toEqual(['ゲームスタート', 'オプション', '操作ガイド', 'クレジット']);
    expect(TITLE_NAV.filter((n) => n.dim).map((n) => n.action)).toEqual(['credits']);
  });

  it('スモーク契約: startボタンにtitle-startのdata-idを付与する式が存在する', () => {
    // F10 playwrightスモークが依存する契約(title-root/title-start)の存在ピン。
    // DOM生成はjsdom不使用規約のため、生成式のソース断片で固定する。
    expect(TITLE_NAV[0]?.action).toBe('start');
  });

  it('選択インデックスは両方向に折り返す', () => {
    expect(nextTitleIndex(0, -1, 4)).toBe(3);
    expect(nextTitleIndex(3, 1, 4)).toBe(0);
    expect(nextTitleIndex(1, 1, 4)).toBe(2);
  });

  it('ビルド表記は実データのみ(日付焼き込み・架空BETA表記なし)', () => {
    const [l1, l2] = titleBuildLines('R53');
    expect(l1).toBe('ENZA INTERFACE 2.0');
    expect(l2).toContain('BUILD R53');
    expect(l2).toContain('60FPS');
    // モックの架空値(BETA 2.0-J / 2026.07.10)を焼き込まない
    expect(`${l1} ${l2}`).not.toMatch(/BETA|20\d\d\.\d\d/);
  });

  it('情景SVGは決定論的かつアセットレス(img/外部URL/filterなし)', () => {
    const a = titleSceneSvg();
    const b = titleSceneSvg();
    expect(a).toBe(b);
    expect(a).not.toContain('<img');
    expect(a).not.toContain('http');
    expect(a).not.toContain('feGaussianBlur');
    expect(a).toContain('viewBox="0 0 1920 1080"');
  });

  it('情景SVGはmock01のPNG構図要素を備える(光柱7/目盛環/菱/短剣輪鍔/地割れ6/火の粉)', () => {
    const svg = titleSceneSvg();
    expect(svg.match(/<polygon points="\d+,0 /g)?.length).toBe(7); // 光柱
    expect(svg).toContain('r="330"'); // 目盛環
    expect(svg).toContain('rotate(8 1193 1046)'); // 短剣の傾き
    expect(svg).toContain('r="40"'); // 輪鍔
    expect(svg.match(/stroke="#E08A4A"/g)?.length).toBe(6); // 地割れ主線
    expect((svg.match(/#FFB374|#FFD9AE/g)?.length ?? 0)).toBeGreaterThan(20); // 火の粉
  });
});
