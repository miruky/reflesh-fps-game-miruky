import { describe, expect, it } from 'vitest';
import {
  normalizeTts,
  pickBestVoice,
  prosodyBase,
  prosodyFor,
  scoreVoice,
  type VoiceLike,
} from './audio';

const V = (name: string, lang: string, localService: boolean): VoiceLike => ({
  name,
  lang,
  localService,
});

describe('アナウンサー音声の選定(純ロジック)', () => {
  it('ローカル良声(Samantha)がロボット声・クラウド声より優先される', () => {
    const voices = [
      V('Google US English', 'en-US', false),
      V('eSpeak English', 'en-US', true),
      V('Samantha', 'en-US', true),
    ];
    expect(pickBestVoice(voices)?.name).toBe('Samantha');
  });

  it('空配列はnull。en-US不在ならen-GBが非英語より選ばれる', () => {
    expect(pickBestVoice([])).toBeNull();
    const voices = [V('Kyoko', 'ja-JP', true), V('Daniel', 'en-GB', true)];
    expect(pickBestVoice(voices)?.name).toBe('Daniel');
  });

  it('scoreVoice: ローカルはクラウド同名より高得点、ロボット/クラウドは減点', () => {
    expect(scoreVoice(V('Samantha', 'en-US', true))).toBeGreaterThan(
      scoreVoice(V('Samantha', 'en-US', false)),
    );
    // クラウド/ロボット名は -60 が効いて非常に低い
    expect(scoreVoice(V('Google US English', 'en-US', false))).toBeLessThan(0);
    expect(scoreVoice(V('eSpeak', 'en-US', true))).toBeLessThan(
      scoreVoice(V('Alex', 'en-US', true)),
    );
    // 非英語は減点
    expect(scoreVoice(V('Kyoko', 'ja-JP', true))).toBeLessThan(scoreVoice(V('Kyoko', 'en-US', true)));
  });

  it('normalizeTts: 既知ラベルはカンマ区切り、未知は小文字化', () => {
    expect(normalizeTts('TRIPLE KILL', true)).toBe('triple, kill');
    expect(normalizeTts('GODLIKE', false)).toBe('god, like');
    expect(normalizeTts('NUCLEAR', false)).toBe('nuclear');
    expect(normalizeTts('NUCLEAR', true)).toBe('nuclear');
  });

  it('prosodyBase: 既知ラベルは基準テーブル、未知は既定', () => {
    expect(prosodyBase('GODLIKE')).toEqual({ pitch: 0.66, rate: 0.95 });
    expect(prosodyBase('TRIPLE KILL')).toEqual({ pitch: 0.92, rate: 1.2 });
    expect(prosodyBase('NUCLEAR')).toEqual({ pitch: 0.78, rate: 1.05 });
  });

  it('prosodyFor: 基準±微ジッタ内かつpitch[0,2]/rate[0.1,10]に必ず収まる', () => {
    for (const label of ['TRIPLE KILL', 'RAMPAGE', 'GODLIKE', 'NUCLEAR']) {
      for (let i = 0; i < 50; i += 1) {
        const p = prosodyFor(label);
        const b = prosodyBase(label);
        expect(p.pitch).toBeGreaterThanOrEqual(0);
        expect(p.pitch).toBeLessThanOrEqual(2);
        expect(p.rate).toBeGreaterThanOrEqual(0.1);
        expect(p.rate).toBeLessThanOrEqual(10);
        expect(Math.abs(p.pitch - b.pitch)).toBeLessThanOrEqual(0.031);
        expect(Math.abs(p.rate - b.rate)).toBeLessThanOrEqual(0.041);
      }
    }
  });
});
