import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MATCH_LENGTHS,
  SETTING_BOUNDS,
  UI_ACCENTS,
  sanitizeSettings,
  type Settings,
} from './settings';

// 改ざんや旧バージョンの値を模すため、型を外して渡す
const dirty = (raw: unknown): Settings => sanitizeSettings(raw as Partial<Settings>);

describe('sanitizeSettings', () => {
  it('空オブジェクトは既定値で埋める', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('範囲を超えた数値を上下限へ丸める', () => {
    const s = dirty({
      sensitivity: 999,
      fov: 9999,
      volMaster: 5,
      volSfx: -1,
      uiScale: 0.1,
    });
    expect(s.sensitivity).toBe(SETTING_BOUNDS.sensitivity.max);
    expect(s.fov).toBe(SETTING_BOUNDS.fov.max);
    expect(s.volMaster).toBe(1);
    expect(s.volSfx).toBe(0);
    expect(s.uiScale).toBe(SETTING_BOUNDS.uiScale.min);
  });

  it('数値でない値は既定へ戻す', () => {
    const s = dirty({ sensitivity: 'fast', fov: null, uiScale: undefined });
    expect(s.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(s.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });

  it('FOVは整数へ丸める', () => {
    expect(dirty({ fov: 78.7 }).fov).toBe(79);
  });

  it('真偽値は型を問わず論理値へ変換する', () => {
    const truthy = dirty({ adsToggle: 1, crouchToggle: 'yes', reduceMotion: {}, invertY: 1 });
    expect(truthy.adsToggle).toBe(true);
    expect(truthy.crouchToggle).toBe(true);
    expect(truthy.reduceMotion).toBe(true);
    expect(truthy.invertY).toBe(true);
    const falsy = dirty({ adsToggle: 0, crouchToggle: '', reduceMotion: null, invertY: 0 });
    expect(falsy.adsToggle).toBe(false);
    expect(falsy.crouchToggle).toBe(false);
    expect(falsy.reduceMotion).toBe(false);
    expect(falsy.invertY).toBe(false);
  });

  it('Y軸反転は既定でオフ', () => {
    expect(DEFAULT_SETTINGS.invertY).toBe(false);
  });

  it('UIアクセントは既知のIDだけ受け入れ、それ以外は既定へ戻す', () => {
    for (const accent of UI_ACCENTS) {
      expect(dirty({ uiAccent: accent.id }).uiAccent).toBe(accent.id);
    }
    expect(dirty({ uiAccent: 'neon' }).uiAccent).toBe(DEFAULT_SETTINGS.uiAccent);
    expect(dirty({ uiAccent: 123 }).uiAccent).toBe(DEFAULT_SETTINGS.uiAccent);
    expect(dirty({ uiAccent: '' }).uiAccent).toBe(DEFAULT_SETTINGS.uiAccent);
  });

  it('既定のUIアクセントは選択肢に含まれる', () => {
    expect(UI_ACCENTS.some((a) => a.id === DEFAULT_SETTINGS.uiAccent)).toBe(true);
  });

  it('試合時間は候補の中で一番近い値へ寄せる', () => {
    expect(dirty({ matchLengthS: 200 }).matchLengthS).toBe(180);
    expect(dirty({ matchLengthS: 250 }).matchLengthS).toBe(300);
    expect(dirty({ matchLengthS: 400 }).matchLengthS).toBe(480);
    expect(dirty({ matchLengthS: 99999 }).matchLengthS).toBe(480);
    expect(dirty({ matchLengthS: 'long' }).matchLengthS).toBe(DEFAULT_SETTINGS.matchLengthS);
  });

  it('試合時間の選択肢は既定値を含む', () => {
    expect(MATCH_LENGTHS.some((m) => m.value === DEFAULT_SETTINGS.matchLengthS)).toBe(true);
  });

  it('配色IDは空文字や非文字列を弾く', () => {
    expect(dirty({ teamPaletteId: '' }).teamPaletteId).toBe(DEFAULT_SETTINGS.teamPaletteId);
    expect(dirty({ teamPaletteId: 42 }).teamPaletteId).toBe(DEFAULT_SETTINGS.teamPaletteId);
    expect(dirty({ teamPaletteId: 'magenta-green' }).teamPaletteId).toBe('magenta-green');
  });

  it('未知のキーは結果に持ち越さない', () => {
    const s = dirty({ legacyOption: true, sensitivity: 1.5 });
    expect(s).not.toHaveProperty('legacyOption');
    expect(s.sensitivity).toBe(1.5);
  });
});
