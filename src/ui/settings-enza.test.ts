// W-ENZA FB10: オプション焔座化の純関数ピン(vitestはnode環境=DOM描画テストはしない方針。
// タブ分類はTAB_SPECSが単一の真実なので、ここで完全性を固定する)
import { describe, expect, it } from 'vitest';
import {
  EOPT_TABS,
  PAUSE_NAV,
  eoptDetailFor,
  eoptItemLabels,
  type EoptTabId,
} from './menu-screens/settings';

const ALL_TABS = EOPT_TABS.map((t) => t.id);

describe('EOPT_TABS(焔座オプションのタブ帯)', () => {
  it('5タブ(一般/映像/オーディオ/操作・パッド/アクセシビリティ)', () => {
    expect(EOPT_TABS.map((t) => t.label)).toEqual([
      '一般',
      '映像',
      'オーディオ',
      '操作 / パッド',
      'アクセシビリティ',
    ]);
  });
});

describe('eoptItemLabels(タブ分類の完全性)', () => {
  it('既存の全設定項目+新規2項目が漏れなくどこかのタブに載る', () => {
    const all = ALL_TABS.flatMap((t) => eoptItemLabels(t));
    // 旧settings-panelが描画していた全項目(R54時点)+BGM音量/音声音量(F9で追加)
    expect(all.sort()).toEqual(
      [
        // 一般
        '試合時間',
        '設定を既定に戻す',
        // 映像
        '視野角(FOV)',
        '画質',
        'UIの大きさ',
        'UIのアクセント',
        '敵味方の配色',
        'レティクル形状',
        'レティクル色',
        '簡易レーダーを表示',
        '画面の揺れ',
        // オーディオ
        '全体音量',
        'BGM音量',
        '音声音量',
        '効果音量',
        'UI音量',
        'アナウンサー音量',
        '戦闘BGM(動的)',
        // 操作/パッド
        'マウス感度',
        'ADS感度倍率',
        'Y軸を反転する',
        'ADSをトグルにする',
        'しゃがみをトグルにする',
        'エイムアシスト',
        'エイムアシスト強度',
        '横感度',
        '縦感度',
        'デッドゾーン',
        '応答カーブ指数',
        '応答カーブ',
        'Y軸を反転する(パッド)',
        '振動(対応環境のみ)',
        '配置プリセット',
        // アクセシビリティ
        '画面の揺れを軽減する',
      ].sort(),
    );
  });

  it('重複分類はない', () => {
    const all = ALL_TABS.flatMap((t) => eoptItemLabels(t));
    expect(new Set(all).size).toBe(all.length);
  });

  it('新規スライダー2本はオーディオタブに載る', () => {
    const audio = eoptItemLabels('audio');
    expect(audio).toContain('BGM音量');
    expect(audio).toContain('音声音量');
  });
});

describe('eoptDetailFor(詳細カード辞書)', () => {
  it('全項目に説明(desc)と英kickerがある', () => {
    for (const tab of ALL_TABS as EoptTabId[]) {
      for (const label of eoptItemLabels(tab)) {
        const d = eoptDetailFor(label);
        expect(d, label).not.toBeNull();
        expect(d?.desc.length ?? 0, label).toBeGreaterThan(8);
        expect(d?.en ?? '', label).toMatch(/^[A-Z0-9 ()/]+$/);
      }
    }
  });

  it('未知ラベルはnull', () => {
    expect(eoptDetailFor('存在しない項目')).toBeNull();
  });

  it('反映タイミング注記: 画質=再読み込み・配色/試合時間=次の試合', () => {
    expect(eoptDetailFor('画質')?.note).toContain('再読み込み');
    expect(eoptDetailFor('敵味方の配色')?.note).toContain('次の試合');
    expect(eoptDetailFor('試合時間')?.note).toContain('次の試合');
  });
});

describe('PAUSE_NAV(ポーズ画面のid契約)', () => {
  it('gamepadBack互換のid(resume/quit)とフォトモード(photo)を保持する', () => {
    expect(PAUSE_NAV.map(([id]) => id)).toEqual(['resume', 'photo', 'quit']);
  });

  it('先頭=再開(復帰CTA)がフォーカス初期位置', () => {
    expect(PAUSE_NAV[0]?.[1]).toBe('作戦に復帰');
  });
});
