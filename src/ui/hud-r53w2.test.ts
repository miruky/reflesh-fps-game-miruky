import { describe, expect, it } from 'vitest';
import {
  clampPapTier,
  isPowerUpBlinking,
  POWERUP_CHIP_SPECS,
  radioSpeakerColor,
  RADIO_SPEAKER_COLORS,
  detectMeterTier,
  detectMeterBlinking,
  bossPhasePipStates,
  sndPipStates,
  sndProgressLabel,
  sndPhaseLabel,
  isSpecialRoundEntering,
  SND_WIN_TARGET,
} from './hud';

// R53-W2: match.ts(M2a/M2b)配線待ちの拡張HUD要素の純関数群。
// snapshot契約は全optionalで凍結済み。ここではDOM非依存の計算ロジックのみを検証する。

describe('clampPapTier (R53-W2: PaP段数ピップの表示本数)', () => {
  it('undefined/0/負値は0本(非表示)', () => {
    expect(clampPapTier(undefined)).toBe(0);
    expect(clampPapTier(0)).toBe(0);
    expect(clampPapTier(-1)).toBe(0);
  });
  it('1〜3はそのまま', () => {
    expect(clampPapTier(1)).toBe(1);
    expect(clampPapTier(2)).toBe(2);
    expect(clampPapTier(3)).toBe(3);
  });
  it('PapTierの上限3を超える値は3にクランプする(zombie-economy.tsのPapTier=0|1|2|3と整合)', () => {
    expect(clampPapTier(4)).toBe(3);
    expect(clampPapTier(99)).toBe(3);
  });
  it('非整数はroundする', () => {
    expect(clampPapTier(1.6)).toBe(2);
  });
});

describe('isPowerUpBlinking (R53-W2: パワーアップチップの点滅判定)', () => {
  it('残り3s未満かつreduceMotion=falseで点滅する', () => {
    expect(isPowerUpBlinking(2.9, false)).toBe(true);
    expect(isPowerUpBlinking(0.1, false)).toBe(true);
  });
  it('残り3s以上は点滅しない', () => {
    expect(isPowerUpBlinking(3, false)).toBe(false);
    expect(isPowerUpBlinking(10, false)).toBe(false);
  });
  it('残り0以下は点滅しない(消費済み/非表示想定)', () => {
    expect(isPowerUpBlinking(0, false)).toBe(false);
    expect(isPowerUpBlinking(-1, false)).toBe(false);
  });
  it('reduceMotion=trueは残秒に関わらず点滅しない(JS側の二重ゲート)', () => {
    expect(isPowerUpBlinking(1, true)).toBe(false);
    expect(isPowerUpBlinking(2.9, true)).toBe(false);
  });
});

describe('POWERUP_CHIP_SPECS (R53-W2: パワーアップ5種の色/アイコン定義)', () => {
  it('5種すべてを持ち、色が重複しない(視認性の色分け要件)', () => {
    const kinds = ['insta', 'double', 'nuke', 'maxammo', 'carpenter'] as const;
    for (const k of kinds) {
      expect(POWERUP_CHIP_SPECS[k]).toBeDefined();
      expect(POWERUP_CHIP_SPECS[k].icon).toContain('<svg');
    }
    const colors = kinds.map((k) => POWERUP_CHIP_SPECS[k].color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('radioSpeakerColor (R53-W2: 無線字幕の話者色)', () => {
  it('4話者すべてに固有色を割り当てる(kagerou=steel/homura=cyan/hibana=ember/kurogane=violet)', () => {
    const speakers = ['kagerou', 'homura', 'hibana', 'kurogane'] as const;
    const colors = speakers.map((s) => radioSpeakerColor(s));
    expect(new Set(colors).size).toBe(4);
    expect(radioSpeakerColor('kagerou')).toBe(RADIO_SPEAKER_COLORS.kagerou);
  });
  it('テーマ切替で変動する--ember本体を使わない固定hex値である', () => {
    // --ember はdata-accentで変わるためhibanaの色は独立した固定hexでなければならない
    expect(RADIO_SPEAKER_COLORS.hibana.startsWith('#')).toBe(true);
  });
});

describe('detectMeterTier / detectMeterBlinking (R53-W2: 潜入検知メーター)', () => {
  it('0〜<0.5はcalm(白)', () => {
    expect(detectMeterTier(0)).toBe('calm');
    expect(detectMeterTier(0.49)).toBe('calm');
  });
  it('0.5〜<0.9はwary(黄)', () => {
    expect(detectMeterTier(0.5)).toBe('wary');
    expect(detectMeterTier(0.89)).toBe('wary');
  });
  it('0.9以上はalert(赤)', () => {
    expect(detectMeterTier(0.9)).toBe('alert');
    expect(detectMeterTier(1)).toBe('alert');
  });
  it('alert域(≥0.9)のみ点滅、reduceMotion=trueは常に点滅しない', () => {
    expect(detectMeterBlinking(0.9, false)).toBe(true);
    expect(detectMeterBlinking(0.89, false)).toBe(false);
    expect(detectMeterBlinking(0.95, true)).toBe(false);
  });
});

describe('bossPhasePipStates (R53-W2: ボスフェーズ菱形pips)', () => {
  it('idx=1/total=4: 先頭がactive、残りpending', () => {
    expect(bossPhasePipStates(1, 4)).toEqual(['active', 'pending', 'pending', 'pending']);
  });
  it('idx=3/total=4: 1-2がdone、3がactive、4がpending', () => {
    expect(bossPhasePipStates(3, 4)).toEqual(['done', 'done', 'active', 'pending']);
  });
  it('idx=total: 最終フェーズがactive、それ以前は全てdone', () => {
    expect(bossPhasePipStates(4, 4)).toEqual(['done', 'done', 'done', 'active']);
  });
  it('total=0/負値は1にクランプ(DOM破綻防止)', () => {
    expect(bossPhasePipStates(1, 0)).toEqual(['active']);
  });
  it('totalが安全上限12を超える場合は12にクランプする', () => {
    expect(bossPhasePipStates(1, 999)).toHaveLength(12);
  });
  it('idxが範囲外(0や total超過)でもクランプして破綻しない', () => {
    expect(bossPhasePipStates(0, 3)).toEqual(['active', 'pending', 'pending']);
    expect(bossPhasePipStates(99, 3)).toEqual(['done', 'done', 'active']);
  });
});

describe('sndPipStates (R53-W2: S&Dラウンドピップ、先取4)', () => {
  it('デフォルトtarget=4', () => {
    expect(SND_WIN_TARGET).toBe(4);
  });
  it('wins=0は全消灯', () => {
    expect(sndPipStates(0)).toEqual([false, false, false, false]);
  });
  it('wins=2は先頭2つが点灯', () => {
    expect(sndPipStates(2)).toEqual([true, true, false, false]);
  });
  it('wins=targetで全点灯(勝利確定)', () => {
    expect(sndPipStates(4)).toEqual([true, true, true, true]);
  });
  it('target超過のwinsはクランプする(全点灯のまま破綻しない)', () => {
    expect(sndPipStates(9)).toEqual([true, true, true, true]);
  });
});

describe('sndProgressLabel / sndPhaseLabel (R53-W2: S&D設置解除ラベル/フェーズ表記)', () => {
  it('plant/defuseで日本語ラベルを返す', () => {
    expect(sndProgressLabel('plant')).toBe('設置中…');
    expect(sndProgressLabel('defuse')).toBe('解除中…');
  });
  it('undefinedは空文字', () => {
    expect(sndProgressLabel(undefined)).toBe('');
  });
  it('sndPhaseLabelは4フェーズすべてにラベルを持つ', () => {
    expect(sndPhaseLabel('buy')).toBe('BUY');
    expect(sndPhaseLabel('live')).toBe('LIVE');
    expect(sndPhaseLabel('planted')).toBe('PLANTED');
    expect(sndPhaseLabel('roundEnd')).toBe('ROUND END');
    expect(sndPhaseLabel(undefined)).toBe('');
  });
});

describe('isSpecialRoundEntering (R53-W2: 特殊ラウンド「餓鬼の大群」突入エッジ検出)', () => {
  it('非rush→rushの瞬間だけtrue(バナー一発トリガ)', () => {
    expect(isSpecialRoundEntering(null, 'rush')).toBe(true);
    expect(isSpecialRoundEntering(undefined, 'rush')).toBe(true);
  });
  it('rush継続中はfalse(毎フレーム再表示しない)', () => {
    expect(isSpecialRoundEntering('rush', 'rush')).toBe(false);
  });
  it('rush→非rush、非rush→非rushはfalse', () => {
    expect(isSpecialRoundEntering('rush', null)).toBe(false);
    expect(isSpecialRoundEntering(null, null)).toBe(false);
  });
});
