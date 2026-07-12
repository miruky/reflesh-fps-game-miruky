// W-ENZA2 F7: オプションのタブ分類・全項目収容・実フィールド配線をピンする(jsdom不使用の純データ検証)
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTING_BOUNDS, type Settings } from '../../core/settings';
import {
  OPTIONS_TABS,
  PAD_ACTION_ROWS_U2,
  PAUSE_NAV,
  fmtNum,
  fmtVol,
  seg10,
  type CheckRow,
  type SelectRow,
  type SliderRow,
} from './options';

const freshSettings = (): Settings => structuredClone(DEFAULT_SETTINGS) as Settings;
const allRows = OPTIONS_TABS.flatMap((t) => t.rows);

describe('OPTIONS_TABS 分類', () => {
  it('タブは5枚・順序固定', () => {
    expect(OPTIONS_TABS.map((t) => t.label)).toEqual([
      '一般',
      '映像',
      'オーディオ',
      '操作 / パッド',
      'アクセシビリティ',
    ]);
  });

  it('全項目の行き先(旧renderSettings+buildGamepadSettings全数+新規2本、欠落ゼロ)', () => {
    const byTab = Object.fromEntries(
      OPTIONS_TABS.map((t) => [t.label, t.rows.map((r) => r.label)]),
    );
    expect(byTab['一般']).toEqual(['試合時間', '設定を既定に戻す']);
    expect(byTab['映像']).toEqual([
      '視野角(FOV)',
      '画質',
      'UIの大きさ',
      'UIのアクセント',
      '敵味方の配色',
      'レティクル形状',
      'レティクル色',
      '簡易レーダーを表示',
      '画面の揺れ',
    ]);
    expect(byTab['オーディオ']).toEqual([
      '全体音量',
      'BGM音量',
      '音声音量',
      '効果音量',
      'UI音量',
      'アナウンサー音量',
      '戦闘BGM(動的)',
    ]);
    expect(byTab['操作 / パッド']).toEqual([
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
      '配置プリセット / リバインド',
    ]);
    expect(byTab['アクセシビリティ']).toEqual(['画面の揺れを軽減する']);
  });

  it('ラベル重複なし', () => {
    const labels = allRows.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('実機能のないモック項目(ハリボテ)を置かない', () => {
    const labels = new Set(allRows.map((r) => r.label));
    for (const fake of [
      '言語選択',
      '字幕',
      'サウンドテスト',
      'オーディオプリセット',
      '無線劇の音声',
      '帝王降臨のBGM転調',
    ]) {
      expect(labels.has(fake)).toBe(false);
    }
  });

  it('全行に説明と英kickerがある(詳細カードの材料)', () => {
    for (const row of allRows) {
      expect(row.desc.length, row.label).toBeGreaterThan(5);
      expect(row.en, row.label).toMatch(/^[A-Z0-9 /()]+$/);
    }
  });
});

describe('実フィールド配線(set→getラウンドトリップ)', () => {
  it('スライダー: 最小値/最大値が正しいフィールドへ書き込まれる', () => {
    for (const row of allRows.filter((r): r is SliderRow => r.kind === 'slider')) {
      const s = freshSettings();
      row.set(s, row.min);
      expect(row.get(s), row.label).toBe(row.min);
      row.set(s, row.max);
      expect(row.get(s), row.label).toBe(row.max);
    }
  });

  it('セレクト: 全選択肢がラウンドトリップする', () => {
    for (const row of allRows.filter((r): r is SelectRow => r.kind === 'select')) {
      const s = freshSettings();
      expect(row.options.length, row.label).toBeGreaterThan(0);
      for (const opt of row.options) {
        row.set(s, opt.value);
        expect(row.get(s), `${row.label}=${opt.value}`).toBe(opt.value);
      }
    }
  });

  it('トグル: true/falseがラウンドトリップする', () => {
    for (const row of allRows.filter((r): r is CheckRow => r.kind === 'check')) {
      const s = freshSettings();
      row.set(s, true);
      expect(row.get(s), row.label).toBe(true);
      row.set(s, false);
      expect(row.get(s), row.label).toBe(false);
    }
  });

  it('新規2本(BGM音量/音声音量)はmusicVolume/voVolumeへ配線される', () => {
    const audio = OPTIONS_TABS.find((t) => t.id === 'audio')!;
    const music = audio.rows.find((r) => r.label === 'BGM音量') as SliderRow;
    const vo = audio.rows.find((r) => r.label === '音声音量') as SliderRow;
    const s = freshSettings();
    music.set(s, 0.25);
    vo.set(s, 0.35);
    expect(s.musicVolume).toBe(0.25);
    expect(s.voVolume).toBe(0.35);
    expect(music.get(s)).toBe(0.25);
    expect(vo.get(s)).toBe(0.35);
  });

  it('パッド系スライダーの範囲はSETTING_BOUNDSと一致する(旧実装と同じ範囲)', () => {
    const controls = OPTIONS_TABS.find((t) => t.id === 'controls')!;
    const byLabel = new Map(controls.rows.map((r) => [r.label, r]));
    const pairs: Array<[string, { min: number; max: number }]> = [
      ['横感度', SETTING_BOUNDS.gamepadSensX],
      ['縦感度', SETTING_BOUNDS.gamepadSensY],
      ['デッドゾーン', SETTING_BOUNDS.gamepadDeadzone],
      ['応答カーブ指数', SETTING_BOUNDS.gamepadResponseExp],
    ];
    for (const [label, bounds] of pairs) {
      const row = byLabel.get(label) as SliderRow;
      expect(row.min, label).toBe(bounds.min);
      expect(row.max, label).toBe(bounds.max);
    }
  });
});

describe('計器表示', () => {
  it('seg10: 10ピップゲージの点灯数', () => {
    expect(seg10(0, 0, 1)).toBe(0);
    expect(seg10(1, 0, 1)).toBe(10);
    expect(seg10(0.5, 0, 1)).toBe(5);
    expect(seg10(0.8, 0, 1)).toBe(8);
    expect(seg10(85, 60, 110)).toBe(5);
    expect(seg10(-5, 0, 1)).toBe(0);
    expect(seg10(99, 0, 1)).toBe(10);
    expect(seg10(1, 1, 1)).toBe(0); // 退化範囲は0
  });

  it('fmtVol/fmtNum: モックの整数表示(音量0-10)と実数表示', () => {
    expect(fmtVol(0.8)).toBe('8');
    expect(fmtVol(1)).toBe('10');
    expect(fmtVol(0)).toBe('0');
    expect(fmtNum(90)).toBe('90');
    expect(fmtNum(1.25)).toBe('1.25');
    expect(fmtNum(0.30000000000000004)).toBe('0.3');
  });
});

describe('リバインド/ポーズ契約', () => {
  it('リバインド表は16アクション(R60④でinteractを追加)・重複なし', () => {
    expect(PAD_ACTION_ROWS_U2.length).toBe(16); // 旧15 + R60④ interact
    expect(PAD_ACTION_ROWS_U2[0]).toEqual(['fire', '射撃']);
    expect(PAD_ACTION_ROWS_U2[15]).toEqual(['scoreboard', 'スコアボード']);
    const actions = PAD_ACTION_ROWS_U2.map(([a]) => a);
    expect(actions).toContain('interact'); // R60④: リバインド可能に
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('ポーズナビのdata-id契約(resume/options/photo/quit)', () => {
    expect(PAUSE_NAV.map(([id]) => id)).toEqual(['resume', 'options', 'photo', 'quit']);
    expect(PAUSE_NAV.map(([, label]) => label)).toEqual([
      '作戦に復帰',
      'オプション',
      'フォトモード',
      '作戦を離脱',
    ]);
  });
});
