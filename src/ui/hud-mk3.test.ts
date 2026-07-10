import { describe, expect, it } from 'vitest';
import {
  chargeArcDashoffset,
  deriveEmperorState,
  emptyMomentQueue,
  MK3_CALM_DELAY_S,
  MK3_CHARGE_ARC_LEN,
  MOMENT_GAP_S,
  MOMENT_QUEUE_MAX,
  MOMENT_SHOW_S,
  momentTone,
  momentWatermark,
  stepCalmLatch,
  stepMomentQueue,
  toKanjiNumeral,
  type CalmLatchState,
  type Mk3Snapshot,
  type MomentEvent,
  type MomentQueueState,
} from './hud';

// R53-W3 MK.III「LIVING INSTRUMENT」の純関数群。
// DOM描画はテストせず、状態機械/分類/変換のロジックだけを固定する(既存hudテストの方針)。

const CALM0: CalmLatchState = { calm: false, quietS: 0 };

function runLatch(
  state: CalmLatchState,
  heat: number | undefined,
  seconds: number,
  step = 0.1,
  hpRatio = 1,
  alive = true,
): CalmLatchState {
  let s = state;
  for (let t = 0; t < seconds - 1e-9; t += step) {
    s = stepCalmLatch(s, heat, hpRatio, alive, step);
  }
  return s;
}

describe('MK.III stepCalmLatch(Adaptive Presenceラッチ)', () => {
  it('uiHeat未供給(M3配線前)は常に非calm=完全非回帰', () => {
    const s = runLatch(CALM0, undefined, 10);
    expect(s.calm).toBe(false);
    expect(s.quietS).toBe(0);
  });

  it('低heatがMK3_CALM_DELAY_S継続して初めてcalmに入る(手前では入らない)', () => {
    const before = runLatch(CALM0, 0.05, MK3_CALM_DELAY_S - 0.3);
    expect(before.calm).toBe(false);
    const after = runLatch(before, 0.05, 0.5);
    expect(after.calm).toBe(true);
  });

  it('heat>0.3で即解除+無音タイマーもリセット', () => {
    const calm = runLatch(CALM0, 0.0, MK3_CALM_DELAY_S + 1);
    expect(calm.calm).toBe(true);
    const s = stepCalmLatch(calm, 0.31, 1, true, 0.016);
    expect(s.calm).toBe(false);
    expect(s.quietS).toBe(0);
  });

  it('中間帯(0.15..0.3)はヒステリシス: 状態維持・タイマー凍結', () => {
    // calm側から中間帯 → calmのまま
    const calm = runLatch(CALM0, 0.0, MK3_CALM_DELAY_S + 1);
    const heldCalm = runLatch(calm, 0.2, 5);
    expect(heldCalm.calm).toBe(true);
    // 非calm側から中間帯 → 非calmのまま(蓄積も進まない)
    const partial = runLatch(CALM0, 0.05, 1); // 1s蓄積(未達)
    const heldOff = runLatch(partial, 0.2, 10);
    expect(heldOff.calm).toBe(false);
    expect(heldOff.quietS).toBeCloseTo(partial.quietS, 6);
  });

  it('HP40%未満は即・全計器復帰(非calm)', () => {
    const calm = runLatch(CALM0, 0.0, MK3_CALM_DELAY_S + 1);
    const s = stepCalmLatch(calm, 0.0, 0.39, true, 0.016);
    expect(s.calm).toBe(false);
  });

  it('死亡中は非calm', () => {
    const calm = runLatch(CALM0, 0.0, MK3_CALM_DELAY_S + 1);
    const s = stepCalmLatch(calm, 0.0, 1, false, 0.016);
    expect(s.calm).toBe(false);
  });
});

describe('MK.III momentTone(kind別トーン+tone上書き)', () => {
  it('kind既定: round/ggrank=ember, rankup=gold, perk=signal, special=threat, emperor=violet', () => {
    expect(momentTone({ kind: 'round', title: '12' })).toBe('ember');
    expect(momentTone({ kind: 'ggrank', title: 'RANK 5' })).toBe('ember');
    expect(momentTone({ kind: 'rankup', title: '宇宙開闢' })).toBe('gold');
    expect(momentTone({ kind: 'perk', title: '拡張マガジン' })).toBe('signal');
    expect(momentTone({ kind: 'special', title: '餓鬼の大群' })).toBe('threat');
    expect(momentTone({ kind: 'emperor', title: '黒雷帝' })).toBe('violet');
  });

  it('tone指定は既定を上書き(雷帝=ice等。sub文言による判別はしない契約)', () => {
    expect(momentTone({ kind: 'emperor', title: '雷帝', tone: 'ice' })).toBe('ice');
    expect(momentTone({ kind: 'emperor', title: '黒雷帝', tone: 'violet' })).toBe('violet');
    expect(momentTone({ kind: 'perk', title: 'x', tone: 'ember' })).toBe('ember');
  });
});

describe('MK.III stepMomentQueue(1ノード+キュー)', () => {
  const ev = (title: string): MomentEvent => ({ kind: 'round', title });

  it('投入で即show、SHOW_S経過でhide、GAP_S経過で次がshow(FIFO順)', () => {
    let st: MomentQueueState = emptyMomentQueue();
    let r = stepMomentQueue(st, [ev('1'), ev('2')], false, 0.016);
    expect(r.change).toBe('show');
    expect(r.state.current?.title).toBe('1');
    st = r.state;
    r = stepMomentQueue(st, undefined, false, MOMENT_SHOW_S + 0.01);
    expect(r.change).toBe('hide');
    st = r.state;
    r = stepMomentQueue(st, undefined, false, MOMENT_GAP_S + 0.01);
    expect(r.change).toBe('show'); // gap明けの同フレームで次を開始('end'より優先)
    expect(r.state.current?.title).toBe('2');
  });

  it('W4C C-1: 試合リセット契約 — 蓄積済みキューを emptyMomentQueue() へ戻すと次stepで何も出ない', () => {
    // hud.reset() は mk3Moments を emptyMomentQueue() で置き換える(前試合の
    // 終了間際モーメントの次試合流出を根治)。node環境ではHud実体を構築できないため、
    // reset()が依存するキュー初期化の意味論をここで固定する
    const r1 = stepMomentQueue(emptyMomentQueue(), [ev('黒雷帝'), ev('ROUND 12')], true, 0.016);
    expect(r1.state.queue.length + (r1.state.current ? 1 : 0)).toBeGreaterThan(0);
    const afterReset = emptyMomentQueue();
    const r2 = stepMomentQueue(afterReset, undefined, false, 0.016);
    expect(r2.change).toBeNull();
    expect(r2.state.current).toBeNull();
    expect(r2.state.queue).toEqual([]);
  });

  it('キュー上限は古い方を残す(時系列保持)', () => {
    const incoming = [ev('1'), ev('2'), ev('3'), ev('4'), ev('5'), ev('6')];
    const r = stepMomentQueue(emptyMomentQueue(), incoming, true, 0.016);
    expect(r.state.queue.map((m) => m.title)).toEqual(['1', '2', '3', '4']);
    expect(r.state.queue.length).toBe(MOMENT_QUEUE_MAX);
  });

  it('suppressed中は新規開始を止める(キュー保持)が、表示中のものは完走する', () => {
    // 抑制中に投入 → 開始しない
    let r = stepMomentQueue(emptyMomentQueue(), [ev('1')], true, 0.016);
    expect(r.change).toBe(null);
    expect(r.state.queue.length).toBe(1);
    // 抑制解除 → 開始
    r = stepMomentQueue(r.state, undefined, false, 0.016);
    expect(r.change).toBe('show');
    // 表示中に抑制がかかっても current は維持(完走方針)
    const held = stepMomentQueue(r.state, undefined, true, 0.5);
    expect(held.state.current?.title).toBe('1');
    expect(held.change).toBe(null);
  });

  it('キューが空になったらendで閉じてidleへ', () => {
    let r = stepMomentQueue(emptyMomentQueue(), [ev('1')], false, 0.016);
    r = stepMomentQueue(r.state, undefined, false, MOMENT_SHOW_S + 0.01);
    expect(r.change).toBe('hide');
    r = stepMomentQueue(r.state, undefined, false, MOMENT_GAP_S + 0.01);
    expect(r.change).toBe('end');
    expect(r.state.phase).toBe('idle');
    expect(r.state.current).toBe(null);
  });
});

describe('MK.III toKanjiNumeral / momentWatermark', () => {
  it('漢数字変換(1..9999)', () => {
    expect(toKanjiNumeral(1)).toBe('一');
    expect(toKanjiNumeral(10)).toBe('十');
    expect(toKanjiNumeral(25)).toBe('二十五');
    expect(toKanjiNumeral(110)).toBe('百十');
    expect(toKanjiNumeral(999)).toBe('九百九十九');
    expect(toKanjiNumeral(2026)).toBe('二千二十六');
  });

  it('0以下/非有限は「零」、万超は防御でアラビア数字のまま', () => {
    expect(toKanjiNumeral(0)).toBe('零');
    expect(toKanjiNumeral(-3)).toBe('零');
    expect(toKanjiNumeral(Number.NaN)).toBe('零');
    expect(toKanjiNumeral(12345)).toBe('12345');
  });

  it('watermark: roundは数値タイトルを漢数字化、他は先頭字、空は「刻」', () => {
    expect(momentWatermark({ kind: 'round', title: '37' })).toBe('三十七');
    expect(momentWatermark({ kind: 'rankup', title: '宇宙開闢' })).toBe('宇');
    expect(momentWatermark({ kind: 'perk', title: '' })).toBe('刻');
  });
});

describe('MK.III deriveEmperorState(供給優先+既存フィールド導出)', () => {
  const base = {} as Mk3Snapshot;

  it('emperorState供給があればそのまま(nullも尊重=導出しない)', () => {
    expect(deriveEmperorState({ ...base, emperorState: 'raitei', kokuraiteiMode: true })).toBe('raitei');
    expect(deriveEmperorState({ ...base, emperorState: null, kokuraiteiMode: true })).toBe(null);
  });

  it('未供給時は既存フィールドから優先順に導出: kokuraitei > dark > raitei > null', () => {
    expect(deriveEmperorState({ ...base, kokuraiteiMode: true, darkEmperorS: 10, raiteiMode: true })).toBe('kokuraitei');
    expect(deriveEmperorState({ ...base, darkEmperorS: 10, raiteiMode: true })).toBe('dark');
    expect(deriveEmperorState({ ...base, raiteiMode: true })).toBe('raitei');
    expect(deriveEmperorState({ ...base })).toBe(null);
  });
});

describe('MK.III chargeArcDashoffset', () => {
  it('0=全欠(弧長)、1=満(0)、範囲外はクランプ', () => {
    expect(chargeArcDashoffset(0)).toBeCloseTo(MK3_CHARGE_ARC_LEN, 6);
    expect(chargeArcDashoffset(1)).toBeCloseTo(0, 6);
    expect(chargeArcDashoffset(0.5)).toBeCloseTo(MK3_CHARGE_ARC_LEN * 0.5, 6);
    expect(chargeArcDashoffset(-1)).toBeCloseTo(MK3_CHARGE_ARC_LEN, 6);
    expect(chargeArcDashoffset(2)).toBeCloseTo(0, 6);
  });

  it('CSSのstroke-dasharray(87.96)とMK3_CHARGE_ARC_LENが一致している', () => {
    expect(MK3_CHARGE_ARC_LEN).toBeCloseTo(87.96, 1);
  });
});
