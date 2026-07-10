import { describe, expect, it } from 'vitest';
import { crosshairAdsFade } from './hud';

// R53 T6: adsKeepsCrosshair(minigun/beam等)はADS中も腰だめクロスヘアをフェードさせない。
// 通常武器(keepsCrosshair=false)は既存のR12挙動(--ads=adsProgress、barOpacityは
// 係数2.5でads≈0.4で消灯)をビット単位で変えない。
describe('crosshairAdsFade (R53 T6: adsKeepsCrosshairの消費)', () => {
  it('keepsCrosshair=false は従来どおりadsProgressに追従してフェードする', () => {
    expect(crosshairAdsFade(0, false)).toEqual({ adsVar: 0, barOpacity: 1 });
    expect(crosshairAdsFade(0.4, false)).toEqual({ adsVar: 0.4, barOpacity: 0 });
    expect(crosshairAdsFade(1, false)).toEqual({ adsVar: 1, barOpacity: 0 });
  });

  it('keepsCrosshair=true はadsProgressに関わらずフェードせずフル表示を維持する', () => {
    expect(crosshairAdsFade(0, true)).toEqual({ adsVar: 0, barOpacity: 1 });
    expect(crosshairAdsFade(0.5, true)).toEqual({ adsVar: 0, barOpacity: 1 });
    expect(crosshairAdsFade(1, true)).toEqual({ adsVar: 0, barOpacity: 1 });
  });
});
