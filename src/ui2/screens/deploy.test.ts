// W-ENZA2 F3: 出撃ロビーの構造不変条件(jsdom不使用=純文字列検証の規約)
import { describe, expect, it } from 'vitest';
import { deployBgHtml } from './deploy';

describe('u2 deploy 背景情景(手続き再現)', () => {
  it('シード固定で決定論(同シード=同一HTML、別シード=別内容)', () => {
    expect(deployBgHtml()).toBe(deployBgHtml());
    expect(deployBgHtml(1)).not.toBe(deployBgHtml(2));
  });

  it('構成レイヤ全数: 空グラデ地+雲3+星+都市+幟2+火の粉26+接地+もや', () => {
    const html = deployBgHtml();
    expect(html).toContain('u2d-bg');
    expect(html.match(/u2d-bg-cloud/g)).toHaveLength(3);
    expect(html).toContain('u2d-bg-stars');
    expect(html).toContain('u2d-bg-city');
    expect(html.match(/u2d-bg-banner-[ab]/g)).toHaveLength(2);
    expect(html.match(/u2d-ember/g)).toHaveLength(26);
    expect(html).toContain('u2d-bg-ground');
    expect(html).toContain('u2d-bg-fog');
  });

  it('アセットレス: img/データURI/外部URLを含まない(モックのPNG背景は手続き再現)', () => {
    const html = deployBgHtml();
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('https://'); // xmlns(http://www.w3.org/…)は名前空間識別子で通信しないため許容
    expect(html).not.toContain('url(http');
  });

  it('SVGグラデidはu2d-接頭で一意(他画面のdefsと衝突しない)', () => {
    const html = deployBgHtml();
    expect(html).toContain('u2dLbRimA');
    expect(html).toContain('u2dLbRimB');
    expect(html.match(/id="u2dLbRimA"/g)).toHaveLength(1);
  });
});
