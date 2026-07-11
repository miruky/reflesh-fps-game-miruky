// W-ENZA2 F7: オプション(mock07 1:1移植)+ポーズ。
// - 宣言的 OPTIONS_TABS が単一の真実(タブ分類/範囲/説明) — テストはこれをピンする
// - 実挙動は旧 src/ui/menu.ts の renderSettings/buildGamepadSettings/startCapture を正典として移植
// - 操作: ▲▼=行移動(リスト側keydown) / ◀▶=値変更(range native or 循環) / クリック・ドラッグ可
// - opts.section === 'controls' で「操作 / パッド」タブを開く(タイトルの操作ガイド契約)
import '../options.css';
import {
  GP_LAYOUTS,
  PRESETS,
  glyphFor,
  type GamepadBinding,
  type GamepadBindings,
  type PadAction,
} from '../../core/gamepad';
import {
  DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  MATCH_LENGTHS,
  RETICLE_COLORS,
  RETICLE_STYLES,
  SETTING_BOUNDS,
  UI_ACCENTS,
  saveSettings,
  type GamepadResponseCurve,
  type GraphicsQuality,
} from '../../core/settings';
import { levelFromXp, rankNameFor } from '../../game/progression';
import { TEAM_PALETTES } from '../../game/teamcolors';
import type { Screen2Handle, ScreenMount, Settings, Ui2Host } from '../types';

// ── 宣言的スペック ──
export interface SliderRow {
  kind: 'slider';
  label: string;
  en: string;
  desc: string;
  notes?: readonly string[];
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  get: (s: Settings) => number;
  set: (s: Settings, v: number) => void;
}
export interface SelectRow {
  kind: 'select';
  label: string;
  en: string;
  desc: string;
  notes?: readonly string[];
  options: ReadonlyArray<{ value: string; label: string }>;
  get: (s: Settings) => string;
  set: (s: Settings, v: string) => void;
}
export interface CheckRow {
  kind: 'check';
  label: string;
  en: string;
  desc: string;
  notes?: readonly string[];
  get: (s: Settings) => boolean;
  set: (s: Settings, v: boolean) => void;
}
export interface ActionRow {
  kind: 'action';
  label: string;
  en: string;
  desc: string;
  notes?: readonly string[];
  button: string;
  action: 'reset';
}
export interface RebindRow {
  kind: 'rebind';
  label: string;
  en: string;
  desc: string;
  notes?: readonly string[];
}
export type RowSpec = SliderRow | SelectRow | CheckRow | ActionRow | RebindRow;
export interface TabSpec {
  id: string;
  label: string;
  rows: readonly RowSpec[];
}

// セグメント数(0-10)。モックの10ピップゲージ
export function seg10(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const r = (value - min) / (max - min);
  return Math.max(0, Math.min(10, Math.round(r * 10)));
}
export const fmtVol = (v: number): string => String(Math.round(v * 10));
export const fmtNum = (v: number): string => String(Number(v.toFixed(2)));

// 旧menu.tsのprivate定数を移植(正典コピー)
export const PAD_ACTION_ROWS_U2: ReadonlyArray<[PadAction, string]> = [
  ['fire', '射撃'],
  ['ads', 'ADS(覗き込み)'],
  ['jump', 'ジャンプ'],
  ['crouch', 'しゃがみ / スライド'],
  ['sprint', 'スプリント'],
  ['reload', 'リロード'],
  ['melee', '近接攻撃'],
  ['weaponswitch', '武器切替'],
  ['grenade', 'グレネード'],
  ['grenadeswitch', '投擲物切替'],
  ['ultimate', 'アルティメット'],
  ['holdBreath', '息止め'],
  ['leanleft', '左リーン'],
  ['leanright', '右リーン'],
  ['scoreboard', 'スコアボード'],
];
const GRAPHICS_LABELS: Record<GraphicsQuality, string> = {
  low: '低(軽量・ポスト処理なし)',
  medium: '中(既定)',
  high: '高(高負荷・高解像度)',
};
const CURVE_LABELS: Record<GamepadResponseCurve, string> = {
  linear: 'リニア(等速)',
  exponential: '指数(中央が精密)',
  dynamic: 'ダイナミック(精密+機敏)',
};
function cloneBindings(b: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const key of Object.keys(b) as PadAction[]) out[key] = b[key].map((x) => ({ ...x }));
  return out;
}

const vol = (
  label: string,
  en: string,
  desc: string,
  get: (s: Settings) => number,
  set: (s: Settings, v: number) => void,
): SliderRow => ({
  kind: 'slider',
  label,
  en,
  desc,
  min: 0,
  max: 1,
  step: 0.05,
  fmt: fmtVol,
  get,
  set,
});

// タブ分類の単一真実。旧renderSettings/buildGamepadSettingsの全項目を欠落ゼロで収容(テストが全数ピン)
export const OPTIONS_TABS: readonly TabSpec[] = [
  {
    id: 'general',
    label: '一般',
    rows: [
      {
        kind: 'select',
        label: '試合時間',
        en: 'MATCH LENGTH',
        desc: '1試合の制限時間を設定します。チーム戦・個人戦の全モードに適用されます。',
        notes: ['◆ 次の試合開始時に適用されます'],
        options: MATCH_LENGTHS.map((m) => ({ value: String(m.value), label: m.label })),
        get: (s) => String(s.matchLengthS),
        set: (s, v) => {
          s.matchLengthS = Number(v);
        },
      },
      {
        kind: 'action',
        label: '設定を既定に戻す',
        en: 'RESET TO DEFAULT',
        desc: '全ての設定を初期値へ戻します。感度・音量・映像・パッド設定が対象です。',
        notes: ['◆ 操作のリバインドと配置プリセットも既定へ戻ります'],
        button: '実行',
        action: 'reset',
      },
    ],
  },
  {
    id: 'video',
    label: '映像',
    rows: [
      {
        kind: 'slider',
        label: '視野角(FOV)',
        en: 'FIELD OF VIEW',
        desc: '腰だめ時の標準視野角。ADS中は照準器ごとの倍率が優先されます。',
        min: 60,
        max: 110,
        step: 1,
        fmt: fmtNum,
        get: (s) => s.fov,
        set: (s, v) => {
          s.fov = v;
        },
      },
      {
        kind: 'select',
        label: '画質',
        en: 'GRAPHICS QUALITY',
        desc: 'レンダラとポスト処理の品質ティア。低=軽量、高=高負荷・高解像度。',
        notes: ['◆ 変更はページの再読み込みで完全に反映されます'],
        options: GRAPHICS_QUALITIES.map((q) => ({ value: q, label: GRAPHICS_LABELS[q] })),
        get: (s) => s.graphicsQuality,
        set: (s, v) => {
          s.graphicsQuality = v as GraphicsQuality;
        },
      },
      {
        kind: 'slider',
        label: 'UIの大きさ',
        en: 'UI SCALE',
        desc: 'HUDとメニューの表示倍率。',
        min: 0.8,
        max: 1.3,
        step: 0.05,
        fmt: fmtNum,
        get: (s) => s.uiScale,
        set: (s, v) => {
          s.uiScale = v;
        },
      },
      {
        kind: 'select',
        label: 'UIのアクセント',
        en: 'UI ACCENT',
        desc: 'UIの基調アクセント色。',
        notes: ['◆ 即時反映されます'],
        options: UI_ACCENTS.map((a) => ({ value: a.id, label: a.name })),
        get: (s) => s.uiAccent,
        set: (s, v) => {
          s.uiAccent = v;
        },
      },
      {
        kind: 'select',
        label: '敵味方の配色',
        en: 'TEAM COLORS',
        desc: '敵と味方の識別色パレット。色覚多様性向けのプリセットを含みます。',
        notes: ['◆ 次の試合開始時に適用されます'],
        options: TEAM_PALETTES.map((p) => ({ value: p.id, label: p.name })),
        get: (s) => s.teamPaletteId,
        set: (s, v) => {
          s.teamPaletteId = v;
        },
      },
      {
        kind: 'select',
        label: 'レティクル形状',
        en: 'RETICLE STYLE',
        desc: '照準レティクルの形状。',
        notes: ['◆ 即時反映されます'],
        options: RETICLE_STYLES.map((r) => ({ value: r.id, label: r.name })),
        get: (s) => s.reticleStyle,
        set: (s, v) => {
          s.reticleStyle = v;
        },
      },
      {
        kind: 'select',
        label: 'レティクル色',
        en: 'RETICLE COLOR',
        desc: '照準レティクルの色。',
        notes: ['◆ 即時反映されます'],
        options: RETICLE_COLORS.map((r) => ({ value: r.id, label: r.name })),
        get: (s) => s.reticleColor,
        set: (s, v) => {
          s.reticleColor = v;
        },
      },
      {
        kind: 'check',
        label: '簡易レーダーを表示',
        en: 'RADAR',
        desc: '画面隅の簡易レーダー表示を切り替えます。',
        get: (s) => s.radarEnabled,
        set: (s, v) => {
          s.radarEnabled = v;
        },
      },
      {
        kind: 'slider',
        label: '画面の揺れ',
        en: 'SCREEN SHAKE',
        desc: '被弾・爆発などによる画面の揺れの強さ。',
        min: 0,
        max: 1,
        step: 0.05,
        fmt: fmtVol,
        get: (s) => s.screenShake,
        set: (s, v) => {
          s.screenShake = v;
        },
      },
    ],
  },
  {
    id: 'audio',
    label: 'オーディオ',
    rows: [
      vol(
        '全体音量',
        'MASTER VOLUME',
        '全ての音に乗る最終音量。',
        (s) => s.volMaster,
        (s, v) => {
          s.volMaster = v;
        },
      ),
      vol(
        'BGM音量',
        'MUSIC VOLUME',
        '戦闘BGMとメニュー音楽の音量。',
        (s) => s.musicVolume,
        (s, v) => {
          s.musicVolume = v;
        },
      ),
      vol(
        '音声音量',
        'VOICE VOLUME',
        'アナウンスと無線劇の音声全体の音量。',
        (s) => s.voVolume,
        (s, v) => {
          s.voVolume = v;
        },
      ),
      vol(
        '効果音量',
        'SFX VOLUME',
        '射撃・足音・環境音などの効果音の音量。',
        (s) => s.volSfx,
        (s, v) => {
          s.volSfx = v;
        },
      ),
      vol(
        'UI音量',
        'UI VOLUME',
        'メニュー操作音・通知音の音量。',
        (s) => s.volUi,
        (s, v) => {
          s.volUi = v;
        },
      ),
      vol(
        'アナウンサー音量',
        'ANNOUNCER',
        'スコアストリーク等の実況アナウンスの音量。',
        (s) => s.announcerVolume,
        (s, v) => {
          s.announcerVolume = v;
        },
      ),
      {
        kind: 'check',
        label: '戦闘BGM(動的)',
        en: 'DYNAMIC MUSIC',
        desc: '戦況に応じて変化する戦闘BGMを有効にします。',
        get: (s) => s.musicEnabled,
        set: (s, v) => {
          s.musicEnabled = v;
        },
      },
    ],
  },
  {
    id: 'controls',
    label: '操作 / パッド',
    rows: [
      {
        kind: 'slider',
        label: 'マウス感度',
        en: 'MOUSE SENSITIVITY',
        desc: 'マウスの視点感度。',
        min: 0.2,
        max: 3,
        step: 0.05,
        fmt: fmtNum,
        get: (s) => s.sensitivity,
        set: (s, v) => {
          s.sensitivity = v;
        },
      },
      {
        kind: 'slider',
        label: 'ADS感度倍率',
        en: 'ADS MULTIPLIER',
        desc: '覗き込み(ADS)中の感度倍率。',
        min: 0.3,
        max: 1.5,
        step: 0.05,
        fmt: fmtNum,
        get: (s) => s.adsSensMul,
        set: (s, v) => {
          s.adsSensMul = v;
        },
      },
      {
        kind: 'check',
        label: 'Y軸を反転する',
        en: 'INVERT Y',
        desc: 'マウスの上下操作を反転します。',
        get: (s) => s.invertY,
        set: (s, v) => {
          s.invertY = v;
        },
      },
      {
        kind: 'check',
        label: 'ADSをトグルにする',
        en: 'ADS TOGGLE',
        desc: 'ADSを押し続けずに切替式にします。',
        get: (s) => s.adsToggle,
        set: (s, v) => {
          s.adsToggle = v;
        },
      },
      {
        kind: 'check',
        label: 'しゃがみをトグルにする',
        en: 'CROUCH TOGGLE',
        desc: 'しゃがみを押し続けずに切替式にします。',
        get: (s) => s.crouchToggle,
        set: (s, v) => {
          s.crouchToggle = v;
        },
      },
      {
        kind: 'check',
        label: 'エイムアシスト',
        en: 'AIM ASSIST',
        desc: 'ゲームパッド使用時のエイムアシスト。',
        get: (s) => s.aimAssist,
        set: (s, v) => {
          s.aimAssist = v;
        },
      },
      {
        kind: 'slider',
        label: 'エイムアシスト強度',
        en: 'ASSIST STRENGTH',
        desc: 'エイムアシストの効きの強さ。',
        min: 0,
        max: 1,
        step: 0.05,
        fmt: fmtVol,
        get: (s) => s.aimAssistStrength,
        set: (s, v) => {
          s.aimAssistStrength = v;
        },
      },
      {
        kind: 'slider',
        label: '横感度',
        en: 'PAD SENS X',
        desc: 'ゲームパッド右スティックの横感度。',
        min: SETTING_BOUNDS.gamepadSensX.min,
        max: SETTING_BOUNDS.gamepadSensX.max,
        step: 0.1,
        fmt: fmtNum,
        get: (s) => s.gamepadSensX,
        set: (s, v) => {
          s.gamepadSensX = v;
        },
      },
      {
        kind: 'slider',
        label: '縦感度',
        en: 'PAD SENS Y',
        desc: 'ゲームパッド右スティックの縦感度。',
        min: SETTING_BOUNDS.gamepadSensY.min,
        max: SETTING_BOUNDS.gamepadSensY.max,
        step: 0.1,
        fmt: fmtNum,
        get: (s) => s.gamepadSensY,
        set: (s, v) => {
          s.gamepadSensY = v;
        },
      },
      {
        kind: 'slider',
        label: 'デッドゾーン',
        en: 'DEADZONE',
        desc: 'スティック入力を無視する中央領域の大きさ。',
        min: SETTING_BOUNDS.gamepadDeadzone.min,
        max: SETTING_BOUNDS.gamepadDeadzone.max,
        step: 0.01,
        fmt: fmtNum,
        get: (s) => s.gamepadDeadzone,
        set: (s, v) => {
          s.gamepadDeadzone = v;
        },
      },
      {
        kind: 'slider',
        label: '応答カーブ指数',
        en: 'RESPONSE EXPONENT',
        desc: 'スティック応答カーブの指数。大きいほど中央が精密になります。',
        min: SETTING_BOUNDS.gamepadResponseExp.min,
        max: SETTING_BOUNDS.gamepadResponseExp.max,
        step: 0.05,
        fmt: fmtNum,
        get: (s) => s.gamepadResponseExp,
        set: (s, v) => {
          s.gamepadResponseExp = v;
        },
      },
      {
        kind: 'select',
        label: '応答カーブ',
        en: 'RESPONSE CURVE',
        desc: 'スティック入力から視点速度への変換カーブ。',
        options: (Object.keys(CURVE_LABELS) as GamepadResponseCurve[]).map((c) => ({
          value: c,
          label: CURVE_LABELS[c],
        })),
        get: (s) => s.gamepadResponseCurve,
        set: (s, v) => {
          s.gamepadResponseCurve = v as GamepadResponseCurve;
        },
      },
      {
        kind: 'check',
        label: 'Y軸を反転する(パッド)',
        en: 'PAD INVERT Y',
        desc: 'ゲームパッドの上下操作を反転します。',
        get: (s) => s.gamepadInvertY,
        set: (s, v) => {
          s.gamepadInvertY = v;
        },
      },
      {
        kind: 'check',
        label: '振動(対応環境のみ)',
        en: 'VIBRATION',
        desc: '被弾・射撃時のゲームパッド振動。',
        get: (s) => s.gamepadVibration,
        set: (s, v) => {
          s.gamepadVibration = v;
        },
      },
      {
        kind: 'rebind',
        label: '配置プリセット / リバインド',
        en: 'BUTTON LAYOUT',
        desc: 'PS4 DualShock などの標準ゲームパッドに対応。既定はBO3標準配置。各アクションのボタンは個別に変更できます。',
        notes: [
          '◆ 変更の取込中はEscで取消できます',
          '◆ プリセットを編集すると自動的にカスタムへ移行します',
        ],
      },
    ],
  },
  {
    id: 'access',
    label: 'アクセシビリティ',
    rows: [
      {
        kind: 'check',
        label: '画面の揺れを軽減する',
        en: 'REDUCED MOTION',
        desc: '点滅・振動・大きな演出を抑えます。',
        notes: ['◆ OSの prefers-reduced-motion 設定も常に尊重されます'],
        get: (s) => s.reduceMotion,
        set: (s, v) => {
          s.reduceMotion = v;
        },
      },
    ],
  },
];

// ポーズのナビ(data-id契約: resume/photo/quit は旧UIと同じ意味)
export const PAUSE_NAV: ReadonlyArray<readonly [string, string]> = [
  ['resume', '作戦に復帰'],
  ['options', 'オプション'],
  ['photo', 'フォトモード'],
  ['quit', '作戦を離脱'],
];

// ── DOMヘルパ ──
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// モック07のプロファイルアイコン(戻るボタン)
const BACK_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.4" r="3.6" fill="none" stroke="#C4C9CF" stroke-width="1.7"></circle><rect x="10.9" y="12.6" width="2.2" height="6.4" fill="#C4C9CF"></rect><path d="M5.5 21 C7 16.8 17 16.8 18.5 21" fill="none" stroke="#C4C9CF" stroke-width="1.7"></path></svg>';

// モジュール状態: 再入場時に同じタブへ戻る
let lastTabId = 'general';

// 内部実装(ポーズ内オーバーレイは onBack を差し込む)
function mountOptionsImpl(
  host: Ui2Host,
  root: HTMLElement,
  init: { section?: string; onBack?: () => void },
): Screen2Handle {
  const { settings, profile, callbacks } = host;
  root.classList.add('u2-options');
  if (host.reducedMotion()) root.classList.add('u2-reduce');
  if (init.section === 'controls') lastTabId = 'controls';

  const stage = el('div', 'u2o-stage');
  const scan = el('div', 'u2o-scan');
  const topglow = el('div', 'u2o-topglow');
  const accent = el('div', 'u2o-accent');
  // R56 W2: フルード端アンカー(0-sizeラッパー)。groupTL=見出し/タブ/一覧(左上原点)、
  // groupTR=説明パネル(右上原点)。フルード祖先(.u2-stage--fluid)配下でのみ
  // options.css側が個別にtransform:scale(var(--u2s,1))する(pause内オーバーレイ=legacy祖先
  // では外側.u2-stageが既に1回scale-to-fit済みのため無変換のまま=二重スケール回避)。
  const groupTL = el('div', 'u2o-group-tl');
  const groupTR = el('div', 'u2o-group-tr');

  // ヘッダー
  const head = el('div', 'u2o-head');
  const back = el('button', 'u2o-back');
  back.type = 'button';
  back.dataset.id = 'back-to-hub';
  back.title = '戻る';
  back.setAttribute('aria-label', '戻る');
  back.innerHTML = BACK_SVG;
  back.addEventListener('click', () => {
    if (init.onBack) init.onBack();
    else host.back();
  });
  const headTxt = el('div', 'u2o-headtxt');
  const kicker = el('span', 'u2o-kicker', 'システム　SETTINGS');
  const title = el('h1', 'u2o-title');
  title.style.margin = '0';
  headTxt.append(kicker, title);
  head.append(back, headTxt);

  // タブ
  const tabs = el('div', 'u2o-tabs');
  const tabButtons = new Map<string, HTMLButtonElement>();
  for (const tab of OPTIONS_TABS) {
    const b = el('button', 'u2o-tab', tab.label);
    b.type = 'button';
    b.addEventListener('click', () => setTab(tab.id));
    tabButtons.set(tab.id, b);
    tabs.appendChild(b);
  }

  const list = el('div', 'u2o-list');
  const detail = el('div', 'u2o-detail');
  const foot = el('div', 'u2o-foot');
  const rank = rankNameFor(levelFromXp(profile.xp).level).name;
  foot.appendChild(el('span', 'u2o-foot-save', `設定はブラウザに自動保存されます · 階級: ${rank}`));
  const hints = el('div', 'u2o-hints');
  hints.innerHTML =
    '<span>▲▼ 選択</span><span>◀▶ 変更</span><span><span class="a">Ⓐ</span> 決定</span><span><span class="a">Ⓑ</span> 戻る</span>';
  foot.appendChild(hints);

  groupTL.append(accent, head, tabs, list);
  groupTR.append(detail);
  stage.append(scan, topglow, groupTL, groupTR, foot);
  root.appendChild(stage);

  // 変更の適用(旧sliderと同じ: apply→save→onSettingsChanged)
  const commit = (): void => {
    saveSettings(settings);
    callbacks.onSettingsChanged();
  };

  // ── リバインド状態(旧startCapture/endCapture/assignBindingの移植) ──
  let capturingAction: PadAction | null = null;
  let bindNote = '';
  let captureCleanup: (() => void) | null = null;
  const endCapture = (): void => {
    host.input.cancelCapture();
    if (captureCleanup) {
      captureCleanup();
      captureCleanup = null;
    }
    capturingAction = null;
  };
  const assignBinding = (action: PadAction, binding: GamepadBinding): void => {
    const bindings = settings.gamepadBindings;
    const moved: string[] = [];
    for (const [other, label] of PAD_ACTION_ROWS_U2) {
      if (other === action) continue;
      if (bindings[other].some((x) => x.index === binding.index)) {
        bindings[other] = bindings[other].filter((x) => x.index !== binding.index);
        moved.push(label);
      }
    }
    bindings[action] = [binding];
    bindNote = moved.length ? `${glyphFor(binding)} を「${moved.join('、')}」から移動しました` : '';
  };

  // ── 詳細パネル(フォーカス項目に追従) ──
  const renderDetail = (spec: RowSpec): void => {
    detail.innerHTML = '';
    const dhead = el('div', 'u2o-dhead');
    const dicon = el('span', 'u2o-dicon');
    dicon.append(el('span', 'dia'), el('span', 'dot'));
    const dtxt = el('div', 'u2o-dtxt');
    dtxt.append(el('span', 'u2o-dtitle', spec.label), el('span', 'u2o-den', spec.en));
    dhead.append(dicon, dtxt);
    detail.append(dhead, el('p', 'u2o-ddesc', spec.desc));
    if (spec.notes?.length) {
      const dn = el('div', 'u2o-dnotes');
      for (const n of spec.notes) dn.appendChild(el('span', undefined, n));
      detail.appendChild(dn);
    }
  };

  const selectRow = (wrap: HTMLElement, spec: RowSpec): void => {
    for (const other of list.querySelectorAll('.u2o-row.sel')) other.classList.remove('sel');
    wrap.classList.add('sel');
    renderDetail(spec);
  };

  const buildSteppers = (
    ctl: HTMLElement,
    mid: HTMLElement,
    onStep: (dir: -1 | 1) => void,
  ): void => {
    const mk = (txt: string, dir: -1 | 1): HTMLButtonElement => {
      const b = el('button', 'u2o-step', txt);
      b.type = 'button';
      b.tabIndex = -1; // マウス専用(フォーカス巡回を汚さない)
      b.setAttribute('aria-hidden', 'true');
      b.addEventListener('click', () => onStep(dir));
      return b;
    };
    ctl.append(mk('◀', -1), mid, mk('▶', 1));
  };

  // eslint-disable-next-line prefer-const
  let renderTab: () => void;

  const buildRow = (spec: RowSpec): HTMLElement => {
    if (spec.kind === 'rebind') return buildRebindBlock(spec);
    const wrap = el('div', 'u2o-row');
    wrap.appendChild(el('span', 'u2o-label', spec.label));

    if (spec.kind === 'action') {
      const btn = el('button', 'u2o-action', spec.button);
      btn.type = 'button';
      btn.setAttribute('aria-label', spec.label);
      btn.addEventListener('click', () => {
        endCapture();
        bindNote = '';
        Object.assign(settings, DEFAULT_SETTINGS);
        commit();
        renderTab(); // 全行を初期値で再描画
      });
      btn.addEventListener('focus', () => selectRow(wrap, spec));
      wrap.appendChild(btn);
      wrap.addEventListener('pointerover', () => selectRow(wrap, spec));
      return wrap;
    }

    const ctl = el('span', 'u2o-ctl');
    const mid = el('span', 'u2o-mid');

    if (spec.kind === 'slider') {
      const segs = el('span', 'u2o-segs');
      const cells: HTMLElement[] = [];
      for (let i = 0; i < 10; i++) {
        const c = el('i');
        cells.push(c);
        segs.appendChild(c);
      }
      const val = el('span', 'u2o-val');
      const range = el('input', 'u2o-range');
      range.type = 'range';
      range.min = String(spec.min);
      range.max = String(spec.max);
      range.step = String(spec.step);
      range.value = String(spec.get(settings));
      range.setAttribute('aria-label', spec.label);
      const update = (): void => {
        const v = spec.get(settings);
        const on = seg10(v, spec.min, spec.max);
        cells.forEach((c, i) => c.classList.toggle('on', i < on));
        val.textContent = spec.fmt(v);
      };
      const applyValue = (v: number): void => {
        const clamped = Math.min(spec.max, Math.max(spec.min, v));
        spec.set(settings, clamped);
        range.value = String(clamped);
        commit();
        update();
      };
      range.addEventListener('input', () => applyValue(Number(range.value)));
      range.addEventListener('focus', () => selectRow(wrap, spec));
      mid.append(segs, val, range);
      buildSteppers(ctl, mid, (dir) => {
        applyValue(Number(range.value) + dir * spec.step);
        range.focus({ preventScroll: true });
      });
      update();
    } else {
      const isCheck = spec.kind === 'check';
      const options = isCheck
        ? [
            { value: 'false', label: 'オフ' },
            { value: 'true', label: 'オン' },
          ]
        : spec.options;
      const optLabel = el('span', 'u2o-opt');
      const cycle = el('button', 'u2o-cycle');
      cycle.type = 'button';
      cycle.setAttribute('aria-label', spec.label);
      if (isCheck) cycle.setAttribute('role', 'switch');
      const current = (): number => {
        const v = isCheck ? String(spec.get(settings)) : spec.get(settings);
        const i = options.findIndex((o) => o.value === v);
        return i < 0 ? 0 : i;
      };
      const update = (): void => {
        const i = current();
        optLabel.textContent = options[i]?.label ?? '';
        if (isCheck) cycle.setAttribute('aria-checked', String(spec.get(settings)));
        // R55 W-C3[22]: aria-labelを行ラベル固定から現在値込みへ動的化
        // (スクリーンリーダーがフォーカス時点の実際の選択値を読み上げられるように)
        cycle.setAttribute('aria-label', `${spec.label}: ${options[i]?.label ?? ''}`);
      };
      const applyIndex = (i: number): void => {
        const n = options.length;
        const idx = ((i % n) + n) % n;
        const value = options[idx]?.value ?? '';
        if (isCheck) (spec as CheckRow).set(settings, value === 'true');
        else (spec as SelectRow).set(settings, value);
        commit();
        update();
      };
      cycle.addEventListener('click', () => applyIndex(current() + 1));
      cycle.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          applyIndex(current() - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          applyIndex(current() + 1);
        }
      });
      cycle.addEventListener('focus', () => selectRow(wrap, spec));
      mid.append(optLabel, cycle);
      buildSteppers(ctl, mid, (dir) => {
        applyIndex(current() + dir);
        cycle.focus({ preventScroll: true });
      });
      update();
    }

    wrap.appendChild(ctl);
    wrap.addEventListener('pointerover', () => selectRow(wrap, spec));
    return wrap;
  };

  // リバインドブロック(配置プリセット+アクション表)。旧buildGamepadSettings後半の移植
  const buildRebindBlock = (spec: RebindRow): HTMLElement => {
    const block = el('div');
    block.style.display = 'contents';

    const presetWrap = el('div', 'u2o-row');
    presetWrap.appendChild(el('span', 'u2o-label', '配置プリセット'));
    const ctl = el('span', 'u2o-ctl');
    const mid = el('span', 'u2o-mid');
    const optLabel = el('span', 'u2o-opt');
    const cycle = el('button', 'u2o-cycle');
    cycle.type = 'button';
    cycle.setAttribute('aria-label', '配置プリセット');
    const layouts = GP_LAYOUTS.map((l) => ({ value: l.id, label: l.name }));
    const current = (): number => {
      const i = layouts.findIndex((o) => o.value === settings.gamepadLayout);
      return i < 0 ? 0 : i;
    };
    const table = el('div', 'u2o-rebind');
    // O3: リバインド完了/取消のたびtable.innerHTMLが全消去され、フォーカスが失われて
    // ▲▼移動が先頭行へ巻き戻る。直近に触れたアクションを覚えておき、再描画後に同じ
    // ボタンへフォーカスを戻す(capturingActionが優先=取込中の表示ボタン)。
    let lastRebindAction: PadAction | null = null;

    const renderBindings = (): void => {
      table.innerHTML = '';
      for (const [action, label] of PAD_ACTION_ROWS_U2) {
        const row = el('div', 'u2o-rebind-row');
        const binds = settings.gamepadBindings[action];
        const glyph = binds.length > 0 ? binds.map(glyphFor).join(' / ') : '(なし)';
        const btn = el(
          'button',
          'u2o-rebind-btn',
          capturingAction === action ? '…ボタンを押す(Escで取消)' : '変更',
        );
        btn.type = 'button';
        btn.dataset.action = action;
        btn.setAttribute('aria-label', `${label}を変更`);
        if (capturingAction === action) btn.classList.add('capturing');
        btn.addEventListener('click', () => startCapture(action));
        btn.addEventListener('focus', () => selectRow(presetWrap, spec));
        row.append(
          el('span', 'u2o-rebind-name', label),
          el('span', 'u2o-rebind-glyph', glyph),
          btn,
        );
        table.appendChild(row);
      }
      if (bindNote) table.appendChild(el('p', 'u2o-note', bindNote));
      // 配置プリセット(cycle)を▲▼/クリックで操作中はそちらのフォーカスを奪わない
      const focusAction = capturingAction ?? lastRebindAction;
      if (focusAction && document.activeElement !== cycle) {
        table
          .querySelector<HTMLElement>(`[data-action="${focusAction}"]`)
          ?.focus({ preventScroll: true });
      }
    };
    const updatePreset = (): void => {
      const label = layouts[current()]?.label ?? '';
      optLabel.textContent = label;
      // R55 W-C4[7]: cycleボタンのaria-labelが固定文字列のままで現在値を読まなかった
      // (822-829の設定行と同じく現在値込みへ動的化)
      cycle.setAttribute('aria-label', `配置プリセット: ${label}`);
    };
    const applyLayout = (i: number): void => {
      const n = layouts.length;
      const id = layouts[((i % n) + n) % n]!.value as (typeof GP_LAYOUTS)[number]['id'];
      settings.gamepadLayout = id;
      // プリセットへ切替: 複製して実バインドへ反映。customは現状維持(複製) — 旧実装と同一
      settings.gamepadBindings =
        id === 'custom' ? cloneBindings(settings.gamepadBindings) : cloneBindings(PRESETS[id]);
      bindNote = '';
      commit();
      updatePreset();
      renderBindings();
    };
    cycle.addEventListener('click', () => applyLayout(current() + 1));
    cycle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        applyLayout(current() - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        applyLayout(current() + 1);
      }
    });
    cycle.addEventListener('focus', () => selectRow(presetWrap, spec));
    mid.append(optLabel, cycle);
    buildSteppers(ctl, mid, (dir) => {
      applyLayout(current() + dir);
      cycle.focus({ preventScroll: true });
    });
    presetWrap.appendChild(ctl);
    presetWrap.addEventListener('pointerover', () => selectRow(presetWrap, spec));

    const startCapture = (action: PadAction): void => {
      endCapture();
      // O-LOW: プリセット→カスタムへの切替+clone は「実際にボタンが確定した時」まで遅延する。
      // ここで即時切替すると、Escで取消した際に settings.gamepadLayout/gamepadBindings が
      // custom のまま残留し、無関係な次回commit()でlocalStorageへ誤永続化されてしまう。
      capturingAction = action;
      lastRebindAction = action;
      bindNote = '';
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        endCapture();
        renderBindings();
      };
      document.addEventListener('keydown', onKey, true);
      captureCleanup = () => document.removeEventListener('keydown', onKey, true);
      renderBindings();
      host.input.captureNextButton((binding) => {
        endCapture();
        if (settings.gamepadLayout !== 'custom') {
          settings.gamepadLayout = 'custom';
          settings.gamepadBindings = cloneBindings(settings.gamepadBindings);
          updatePreset();
        }
        assignBinding(action, binding);
        commit();
        renderBindings();
      });
    };

    updatePreset();
    renderBindings();
    block.append(presetWrap, table);
    return block;
  };

  // ── タブ描画 ──
  const activeTabSpec = (): TabSpec =>
    OPTIONS_TABS.find((t) => t.id === lastTabId) ?? OPTIONS_TABS[0]!;
  renderTab = (): void => {
    endCapture();
    const tab = activeTabSpec();
    title.textContent = tab.label;
    for (const [id, b] of tabButtons) b.classList.toggle('active', id === tab.id);
    list.innerHTML = '';
    // O-MED: 先頭行は詳細パネルにバインドされるだけでなく、リスト側の橙ハイライト(.sel)も
    // 同時に付ける(selectRow経由)。rebindスペックはblock(display:contents)を返すため、
    // 実際の選択対象は内部の`.u2o-row`(presetWrap)を辿って探す。
    let firstWrap: HTMLElement | null = null;
    for (const row of tab.rows) {
      const node = buildRow(row);
      list.appendChild(node);
      if (!firstWrap) {
        firstWrap = node.classList.contains('u2o-row')
          ? node
          : node.querySelector<HTMLElement>('.u2o-row');
      }
    }
    const first = tab.rows[0];
    if (first && firstWrap) {
      selectRow(firstWrap, first);
      // O-MED: menu2.open()は[data-autofocus]を最優先で拾う(既存画面フォーカス尊重の次点)。
      // 未宣言だと汎用フォールバック(focusables()[0])が先頭に置かれた「戻る」ボタンを
      // 拾ってしまう(armory等と同型の再発)ため、先頭行の実コントロールへ宣言的に付与する。
      firstWrap
        .querySelector<HTMLElement>('input.u2o-range, button.u2o-cycle, button.u2o-action')
        ?.setAttribute('data-autofocus', '');
    } else if (first) renderDetail(first);
  };
  const setTab = (id: string): void => {
    lastTabId = id;
    renderTab();
  };

  // ▲▼で行間フォーカス移動(range/cycleの上下キー値変更は抑止)。◀▶は各コントロールが処理
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const focusables = Array.from(
      list.querySelectorAll<HTMLElement>(
        'input.u2o-range, button.u2o-cycle, button.u2o-action, button.u2o-rebind-btn',
      ),
    );
    const i = focusables.indexOf(document.activeElement as HTMLElement);
    const next = focusables[i + (e.key === 'ArrowDown' ? 1 : -1)];
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest' });
  });

  renderTab();

  return {
    dispose(): void {
      endCapture();
      root.classList.remove('u2-options', 'u2-reduce');
      root.innerHTML = '';
    },
  };
}

export const mountOptions: ScreenMount = (host, root, opts) =>
  mountOptionsImpl(host, root, { section: opts?.section });

// ══ ポーズ(canvas直上: filter禁止・面0.82+) ══
export const mountPause: ScreenMount = (host, root) => {
  const { profile, callbacks } = host;
  root.classList.add('u2-pause');
  if (host.reducedMotion()) root.classList.add('u2-reduce');

  root.append(el('div', 'u2p-veil'), el('div', 'u2p-accent'));
  const wrap = el('div', 'u2p-wrap');

  // 左: 儀式見出し+ナビ
  const left = el('div', 'u2p-left');
  left.append(el('span', 'u2p-kicker', '一時停止　PAUSED'), el('div', 'u2p-title', '作戦中断'));
  const nav = el('div', 'u2p-nav');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [id, label] of PAUSE_NAV) {
    const b = el('button', 'u2p-btn', label);
    b.type = 'button';
    b.dataset.id = id;
    if (id === 'resume') b.classList.add('primary');
    nav.appendChild(b);
    buttons.set(id, b);
  }
  left.appendChild(nav);

  // 右: 実プロファイル統計(撃破/勝利/最高連勝+XP — 全て実データ)
  const lv = levelFromXp(profile.xp);
  const rank = rankNameFor(lv.level);
  const card = el('div', 'u2p-card');
  const idrow = el('div', 'u2p-idrow');
  const stamp = el('span', 'u2p-stamp');
  stamp.append(el('span', 'dia'), el('span', 'ch', rank.name.charAt(0)));
  const rankBox = el('div', 'u2p-rank');
  rankBox.append(
    el('span', 'u2p-rankname', rank.name),
    el('span', 'u2p-lv', `LV ${lv.level.toLocaleString('ja-JP')}`),
  );
  idrow.append(stamp, rankBox);
  const stats = el('div', 'u2p-stats');
  const stat = (k: string, v: number): HTMLElement => {
    const s = el('div', 'u2p-stat');
    s.append(el('span', 'k', k), el('span', 'v', v.toLocaleString('ja-JP')));
    return s;
  };
  stats.append(
    stat('撃破', profile.stats.kills),
    stat('勝利', profile.stats.wins),
    stat('最高連勝', profile.records.bestWinStreak),
  );
  const xp = el('div', 'u2p-xp');
  const bar = el('div', 'u2p-xpbar');
  const fill = el('i');
  const total = lv.intoLevel + lv.toNext;
  fill.style.width = '100%';
  fill.style.transform = `scaleX(${total > 0 ? Math.min(1, lv.intoLevel / total) : 0})`;
  bar.appendChild(fill);
  xp.append(bar, el('span', 'u2p-xplabel', `次の階級まで ${lv.toNext.toLocaleString('ja-JP')} XP`));
  card.append(idrow, stats, xp);

  wrap.append(left, card);
  const hints = el('div', 'u2p-hints');
  hints.innerHTML =
    '<span>▲▼ 選択</span><span><span class="a">Ⓐ</span> 決定</span><span><span class="a">Ⓑ</span> 再開</span>';
  root.append(wrap, hints);

  // ポーズ内オプション: 画面遷移せずオーバーレイに本物のオプションをマウント
  // (host.open('options')だと試合中にhubスタックへ移ってしまうため、ポーズ文脈を保持する)
  let optLayer: HTMLElement | null = null;
  let optHandle: Screen2Handle | null = null;
  const closeOptions = (): void => {
    optHandle?.dispose();
    optLayer?.remove();
    optHandle = null;
    optLayer = null;
    // 背後ナビ/ヒントを操作可能へ復元(O1: Esc/Ⓑがoptions越しにresumeを誤爆する不具合の対)
    wrap.hidden = false;
    hints.hidden = false;
    buttons.get('options')?.focus({ preventScroll: true });
  };
  const openOptions = (): void => {
    if (optLayer) return;
    // O1: backAction()は[data-id="resume"]の可視性(offsetParent)だけでEsc/Ⓑの宛先を決める。
    // options表示中も背後のresumeボタンが可視のままだと、Escが試合再開へ横取りされてしまう。
    // wrap/hintsを非表示にしてoffsetParentをnullへ落とし、backAction()の対象からresumeを除外する。
    wrap.hidden = true;
    hints.hidden = true;
    optLayer = el('div', 'u2p-options-layer');
    root.appendChild(optLayer);
    optHandle = mountOptionsImpl(host, optLayer, { onBack: closeOptions });
    // ポーズ内オーバーレイはmenu2.open()を経由しない(オーバーレイ直接マウント)ため、
    // 同等のフォールバックが無い。renderTab()が宣言した先頭コントロールへ明示フォーカスする。
    optLayer.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  };

  buttons.get('resume')?.addEventListener('click', () => callbacks.onResume());
  buttons.get('photo')?.addEventListener('click', () => callbacks.onPhoto());
  buttons.get('quit')?.addEventListener('click', () => callbacks.onQuit());
  buttons.get('options')?.addEventListener('click', openOptions);
  buttons.get('resume')?.focus({ preventScroll: true });

  return {
    dispose(): void {
      closeOptions();
      root.classList.remove('u2-pause', 'u2-reduce');
      root.innerHTML = '';
    },
  };
};
