// W-ENZA FA3: 帝王転調のテーマ翻訳(EmperorState → :root[data-emperor] 属性値)。
// enza-core.css のトークン契約(kotei/raitei/kokurai)と、ゲーム内部状態名
// (dark/raitei/kokuraitei)の対応はこの1点が唯一の翻訳点 — ここをピンで固定する。
import { describe, expect, it } from 'vitest';
import { deriveEmperorState, emperorThemeAttr, type Mk3Snapshot } from './hud';

describe('emperorThemeAttr(帝王転調のテーマ翻訳)', () => {
  it('dark(黒帝) → kotei', () => {
    expect(emperorThemeAttr('dark')).toBe('kotei');
  });
  it('raitei(雷帝) → raitei', () => {
    expect(emperorThemeAttr('raitei')).toBe('raitei');
  });
  it('kokuraitei(黒雷帝) → kokurai', () => {
    expect(emperorThemeAttr('kokuraitei')).toBe('kokurai');
  });
  it('非帝王(null) → null(属性除去=既定の熾火へ復帰)', () => {
    expect(emperorThemeAttr(null)).toBeNull();
  });

  it('deriveEmperorState との合成: 黒雷帝は kokurai、平時は null', () => {
    const base = { kokuraiteiMode: false, darkEmperorS: 0, raiteiMode: false } as Mk3Snapshot;
    expect(emperorThemeAttr(deriveEmperorState(base))).toBeNull();
    expect(
      emperorThemeAttr(deriveEmperorState({ ...base, kokuraiteiMode: true } as Mk3Snapshot)),
    ).toBe('kokurai');
    expect(
      emperorThemeAttr(deriveEmperorState({ ...base, darkEmperorS: 12 } as Mk3Snapshot)),
    ).toBe('kotei');
    expect(
      emperorThemeAttr(deriveEmperorState({ ...base, raiteiMode: true } as Mk3Snapshot)),
    ).toBe('raitei');
  });
});
