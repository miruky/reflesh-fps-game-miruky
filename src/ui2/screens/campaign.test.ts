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

  it('fmtPar: 端数秒の丸め繰り上げは分側へ反映される(「m:60」を出力しない)', () => {
    // R55 W-C5[14]: 旧実装は分離後に秒を丸めており、59.6のような値が
    // 「1:60」になるバグがあった。先に全体を丸めてから分解する。
    expect(fmtPar(119.6)).toBe('2:00');
    expect(fmtPar(59.6)).toBe('1:00');
    expect(fmtPar(0.4)).toBe('0:00');
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
