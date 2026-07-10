// W-ENZA2 F6: キャンペーン画面群の純関数ピン(DOM非依存・日付非依存)
import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../../game/campaign';
import { RADIO_SPEAKER_COLORS } from '../../ui/hud';
import {
  SPEAKERS,
  campaignTotals,
  fmtPar,
  missionCode,
  missionRewardLabel,
  radioCast,
  starRow,
} from './campaign';

describe('u2 campaign 純関数', () => {
  it('missionCode: 章ID大文字+1始まり', () => {
    expect(missionCode({ chapterId: 'ch1', index: 0 })).toBe('CH1-1');
    expect(missionCode({ chapterId: 'ch10', index: 5 })).toBe('CH10-6');
  });

  it('fmtPar: m:ss 形式(ゼロ詰め)', () => {
    expect(fmtPar(300)).toBe('5:00');
    expect(fmtPar(95)).toBe('1:35');
    expect(fmtPar(59)).toBe('0:59');
  });

  it('campaignTotals: 実CAMPAIGNに追従(星=ミッション×3)', () => {
    const { missions, starsMax } = campaignTotals(CAMPAIGN);
    expect(missions).toBeGreaterThanOrEqual(60);
    expect(starsMax).toBe(missions * 3);
  });

  it('starRow: 0..3', () => {
    expect(starRow(0)).toEqual([false, false, false]);
    expect(starRow(2)).toEqual([true, true, false]);
    expect(starRow(3)).toEqual([true, true, true]);
  });

  it('missionRewardLabel: 実カモidは表示名、未知/未設定はnull(非表示)', () => {
    expect(missionRewardLabel('shinrai')).not.toBeNull();
    expect(missionRewardLabel('no-such-reward')).toBeNull();
    expect(missionRewardLabel(undefined)).toBeNull();
  });

  it('radioCast: 出現順の重複除去', () => {
    expect(
      radioCast([
        { speaker: 'kagerou' },
        { speaker: 'homura' },
        { speaker: 'kagerou' },
        { speaker: 'kurogane' },
      ]),
    ).toEqual(['kagerou', 'homura', 'kurogane']);
    expect(radioCast(undefined)).toEqual([]);
  });

  it('話者識別色は試合内無線(hud RADIO_SPEAKER_COLORS)と同値を保つ', () => {
    for (const key of Object.keys(SPEAKERS) as Array<keyof typeof SPEAKERS>) {
      expect(SPEAKERS[key].color).toBe(RADIO_SPEAKER_COLORS[key]);
    }
  });
});
