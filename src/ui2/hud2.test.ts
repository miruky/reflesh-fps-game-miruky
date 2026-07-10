// W-ENZA2 F5: 戦闘HUD(hud2)の契約テスト — jsdom不使用(純関数+ソース/CSSピンのみ)
import { describe, expect, it } from 'vitest';
import src from './hud2.ts?raw';

import {
  Hud2,
  chargeArcDashoffset,
  crosshairAdsFade,
  deriveEmperorState,
  emperorThemeAttr,
  MK3_CHARGE_ARC_LEN,
  sndPipStates,
  splitDamageNumbersForFrame,
  DAMAGE_NUMBER_FRAME_CAP,
  toKanjiNumeral,
  type Mk3Snapshot,
} from './hud2';

describe('Hud2 公開面(旧Hudミラー — main.ts無改修で差し替わる契約)', () => {
  it('main.tsが呼ぶ全メソッドがprototypeに存在する', () => {
    for (const m of [
      'setupMinimap',
      'show',
      'hide',
      'reset',
      'update',
      'showFinalKillcam',
      'updateFinalKillcam',
      'hideFinalKillcam',
    ] as const) {
      expect(typeof (Hud2.prototype as unknown as Record<string, unknown>)[m], m).toBe('function');
    }
  });
});

describe('帝王転調テーマ属性(enza-core契約: kotei/raitei/kokurai)', () => {
  it('emperorThemeAttr の写像', () => {
    expect(emperorThemeAttr('dark')).toBe('kotei');
    expect(emperorThemeAttr('raitei')).toBe('raitei');
    expect(emperorThemeAttr('kokuraitei')).toBe('kokurai');
  });
  it('deriveEmperorState の優先度: 黒雷帝 > 黒帝 > 雷帝', () => {
    const base = { kokuraiteiMode: false, darkEmperorS: 0, raiteiMode: false } as Mk3Snapshot;
    expect(deriveEmperorState({ ...base, kokuraiteiMode: true, raiteiMode: true })).toBe('kokuraitei');
    expect(deriveEmperorState({ ...base, darkEmperorS: 10, raiteiMode: true })).toBe('dark');
    expect(deriveEmperorState({ ...base, raiteiMode: true })).toBe('raitei');
    expect(deriveEmperorState(base)).toBeNull();
  });
  it('三重保証: reset/hide/状態変化点の全てで data-emperor を解除するコードがある', () => {
    expect(src.match(/delete document\.documentElement\.dataset\.emperor/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('純関数ピン(旧hud相当の挙動維持)', () => {
  it('toKanjiNumeral', () => {
    expect(toKanjiNumeral(14)).toBe('十四');
    expect(toKanjiNumeral(100)).toBe('百');
  });
  it('chargeArcDashoffset: 0で全隠し/1で全表示', () => {
    expect(chargeArcDashoffset(0)).toBeCloseTo(MK3_CHARGE_ARC_LEN, 5);
    expect(chargeArcDashoffset(1)).toBe(0);
  });
  it('sndPipStates: 先取4', () => {
    expect(sndPipStates(2)).toEqual([true, true, false, false]);
  });
  it('splitDamageNumbersForFrame: フレーム上限で集約', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ amount: i + 1, kind: 'hit' }));
    const split = splitDamageNumbersForFrame(items);
    expect(split.shown.length).toBeLessThanOrEqual(DAMAGE_NUMBER_FRAME_CAP);
  });
  it('crosshairAdsFade: ADSが深いほどバーが薄い/keeps時は常時1', () => {
    expect(crosshairAdsFade(0.9, false).barOpacity).toBeLessThanOrEqual(
      crosshairAdsFade(0.1, false).barOpacity,
    );
    expect(crosshairAdsFade(0.9, true).barOpacity).toBe(1);
  });
});

describe('焔座クロームのソース/CSS契約', () => {
  // 注: vitest環境ではCSSがスタブ化され内容検査ができない(?raw/?inlineとも)。
  // CSS実値の鉄則(filter禁止/帝王実測値/省モーション)はF10実ブラウザハーネス+FQA波が検証する。
  // ここではTS源泉で検証可能な等価契約をピンする。
  it('hud2.cssを自モジュールでimportしている(スタイルペアの自己完結)', () => {
    expect(src.includes("import './hud2.css'")).toBe(true);
  });
  it('省モーションのJSゲート(snap.reduceMotion)が広く残っている(台帳: 16箇所)', () => {
    expect((src.match(/reduceMotion/g) ?? []).length).toBeGreaterThanOrEqual(14);
  });
  it('帝王フレームはdata-stateで3態切替される(CSS側変種のフック)', () => {
    expect(src.includes('frame.dataset.state = empKey')).toBe(true);
    expect(src.includes("emperorThemeAttr(empKey as EmperorState)")).toBe(true);
  });
  it('死亡幕は明朝儀式「戦死」', () => {
    expect(src.includes('<div class="hud-death-title">戦死</div>')).toBe(true);
  });
  it('全ライタ参照data-idがコンストラクタDOMに存在する(退行網)', () => {
    const ids = [
      // スコア/モード/コンパス
      'modename', 'kills', 'deaths', 'streak', 'compass', 'hdg', 'timer', 'teamscore',
      'scoremine', 'scoretarget', 'scoreenemy', 'announce',
      // 目標系
      'zones', 'mission', 'obj-text', 'obj-bar', 'obj-wave', 'boss', 'boss-name', 'boss-bar',
      'bossphases', 'detect', 'detectarc', 'training', 'tr-dps', 'tr-acc', 'tr-hs', 'tr-streak',
      'hpindicator', 'hparrowwrap', 'hparrowshape', 'hpchip', 'hptime', 'kcevent',
      // S&D
      'snd', 'sndpipsmine', 'sndphase', 'sndpipsenemy', 'sndbomb', 'sndbombtime',
      'sndprogress', 'sndprogresslabel', 'sndprogressfill', 'sndcarrier',
      // ゾンビ
      'zombie', 'zround', 'zkills', 'zpoints', 'zpointsplate', 'zpointsbig', 'zperks', 'zbuy',
      'rogue-badge', 'rogue-cards-n', 'rogue-pick', 'rogue-options', 'rogue-remain', 'powerups',
      'specialbanner', 'zreviveflash', 'zbossflash',
      // 帝王/状態
      'hell', 'darkemperor', 'detimer', 'raitei', 'kokuraitei', 'chargegauge', 'chargefill',
      'spingauge', 'spinfill', 'mk3emperor', 'mk3arc', 'mk3arcfill',
      'mk3moment', 'mk3momentmark', 'mk3momenttitle', 'mk3momentsub',
      // フィード/演出
      'feed', 'crosshair', 'cht', 'chb', 'chl', 'chr', 'hitmarker', 'dmg', 'incoming',
      'xpribbon', 'vignette', 'poisonvign', 'flash', 'ultflash', 'whiteout', 'speedlines',
      'move', 'movestate', 'speedfill', 'banner', 'mkbanner', 'mklabel', 'mkpips',
      'radio', 'radiospeaker', 'radiotext', 'medalstack', 'badgestack',
      // 武器/弾/ウルト
      'weapon', 'weaponslot', 'pappips', 'ammo', 'reserve', 'mode', 'ammopips',
      'gname', 'gcount', 'reload', 'reloadfill', 'cook', 'cookfill',
      'ult', 'ultring', 'ultpct', 'ultlabel',
      // HP/ミニマップ/ストリーク
      'hp', 'hpmax', 'hpbarfill', 'minimap', 'mmsize', 'mmuav', 'radar', 'radarblips',
      'bo2ssnext', 'bo2cauav', 'bo2cauavt', 'rcxdoverlay', 'rcxdtimer',
      // スコープ/キルカム/死亡/スコアボード/GG
      'scope', 'scopeglint', 'scoperange', 'scopezoom', 'scopebreath',
      'death', 'respawn', 'kcveil', 'kcflash', 'kcvign', 'kccard', 'kcname', 'kcweapon',
      'kcdist', 'kctimer', 'scoreboard', 'scoremode', 'scoregoal', 'scorerows',
      'gg', 'ggrank', 'ggweapon', 'ggtop3',
    ];
    const missing = ids.filter((id) => !src.includes(`data-id="${id}"`));
    expect(missing).toEqual([]);
    for (let i = 0; i < 7; i += 1) {
      expect(src.includes(`bo2slot${'${i}'}`) || src.includes('bo2slot${i}')).toBe(true);
    }
  });
});
