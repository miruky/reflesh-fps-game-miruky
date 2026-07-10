// W-ENZA FB10: オプション+ポーズ — 焔座「システム SETTINGS」様式。
// 5タブ(一般/映像/オーディオ/操作・パッド/アクセシビリティ)+右詳細カード+セグメントゲージ行。
// タブ分類は宣言的データ(TAB_SPECS)が単一の真実 — eoptItemLabels/eoptDetailFor で純関数テスト可能。
// 契約: export名/シグネチャはFA2分割時と不変(menu-golden.test.tsピン)。設定の読み書きロジックは不変。
import '../enza-opt.css';
import {
  GP_LAYOUTS,
  PRESETS,
  glyphFor,
  type GamepadBinding,
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
import { TEAM_PALETTES } from '../../game/teamcolors';
import { levelFromXp, rankNameFor } from '../../game/progression';
import type { MenuScreenHost } from './host';
import {
  CONTROLS,
  PAD_ACTION_ROWS,
  GRAPHICS_LABELS,
  CURVE_LABELS,
  cloneBindings,
  rankStampChar,
} from './shared';

// ── 焔座タブ定義(純データ、settings-enza.test.tsでピン) ────────────
export type EoptTabId = 'general' | 'video' | 'audio' | 'input' | 'access';

export const EOPT_TABS: ReadonlyArray<{ id: EoptTabId; label: string; en: string }> = [
  { id: 'general', label: '一般', en: 'GENERAL' },
  { id: 'video', label: '映像', en: 'VIDEO' },
  { id: 'audio', label: 'オーディオ', en: 'AUDIO' },
  { id: 'input', label: '操作 / パッド', en: 'CONTROLS' },
  { id: 'access', label: 'アクセシビリティ', en: 'ACCESSIBILITY' },
];

// 行仕様: label=表示名(詳細カードのキー)、en=英kicker、desc=詳細説明(実挙動に即す)、
// note=◆注記(反映タイミング等)、build=行DOM生成(import時は実行されない=node環境テスト安全)
interface RowSpec {
  label: string;
  en: string;
  desc: string;
  note?: string;
  build: (mnu: MenuScreenHost) => HTMLElement | HTMLElement[];
}

interface RowGroup {
  head?: [label: string, code: string];
  rows: RowSpec[];
}

// パッド系統(操作タブとbuildGamepadSettingsの双方が同一配列を参照 — 乖離構造なし)
const PAD_GROUP_SPECS: RowSpec[] = [
  {
    label: '横感度',
    en: 'PAD SENS X',
    desc: 'ゲームパッド右スティックの水平方向の視点感度です。',
    build: (mnu) =>
      slider(
        mnu,
        '横感度',
        SETTING_BOUNDS.gamepadSensX.min,
        SETTING_BOUNDS.gamepadSensX.max,
        0.1,
        mnu.settings.gamepadSensX,
        (v) => {
          mnu.settings.gamepadSensX = v;
        },
      ),
  },
  {
    label: '縦感度',
    en: 'PAD SENS Y',
    desc: 'ゲームパッド右スティックの垂直方向の視点感度です。',
    build: (mnu) =>
      slider(
        mnu,
        '縦感度',
        SETTING_BOUNDS.gamepadSensY.min,
        SETTING_BOUNDS.gamepadSensY.max,
        0.1,
        mnu.settings.gamepadSensY,
        (v) => {
          mnu.settings.gamepadSensY = v;
        },
      ),
  },
  {
    label: 'デッドゾーン',
    en: 'DEADZONE',
    desc: 'スティックの入力を無視する中央の遊び幅です。視点が勝手に流れる(ドリフト)場合は上げてください。',
    build: (mnu) =>
      slider(
        mnu,
        'デッドゾーン',
        SETTING_BOUNDS.gamepadDeadzone.min,
        SETTING_BOUNDS.gamepadDeadzone.max,
        0.01,
        mnu.settings.gamepadDeadzone,
        (v) => {
          mnu.settings.gamepadDeadzone = v;
        },
      ),
  },
  {
    label: '応答カーブ指数',
    en: 'RESPONSE EXPONENT',
    desc: 'スティックの倒し量を視点速度へ変換する曲線の強さです。高いほど微調整域が細かくなります。',
    build: (mnu) =>
      slider(
        mnu,
        '応答カーブ指数',
        SETTING_BOUNDS.gamepadResponseExp.min,
        SETTING_BOUNDS.gamepadResponseExp.max,
        0.05,
        mnu.settings.gamepadResponseExp,
        (v) => {
          mnu.settings.gamepadResponseExp = v;
        },
      ),
  },
  {
    label: '応答カーブ',
    en: 'RESPONSE CURVE',
    desc: 'スティック応答の種類を選びます。デュアルゾーンはBO系標準の二段階応答です。',
    build: (mnu) =>
      select(
        mnu,
        '応答カーブ',
        (Object.keys(CURVE_LABELS) as GamepadResponseCurve[]).map((c) => ({
          value: c,
          label: CURVE_LABELS[c],
        })),
        mnu.settings.gamepadResponseCurve,
        (v) => {
          mnu.settings.gamepadResponseCurve = v as GamepadResponseCurve;
        },
      ),
  },
  {
    label: 'Y軸を反転する(パッド)',
    en: 'INVERT Y (PAD)',
    desc: 'ゲームパッドの上下視点入力を反転します。',
    build: (mnu) =>
      checkbox(mnu, 'Y軸を反転する(パッド)', mnu.settings.gamepadInvertY, (v) => {
        mnu.settings.gamepadInvertY = v;
      }),
  },
  {
    label: '振動(対応環境のみ)',
    en: 'VIBRATION',
    desc: '射撃や被弾でゲームパッドを振動させます。ブラウザとパッドが対応している場合のみ有効です。',
    build: (mnu) =>
      checkbox(mnu, '振動(対応環境のみ)', mnu.settings.gamepadVibration, (v) => {
        mnu.settings.gamepadVibration = v;
      }),
  },
  {
    label: '配置プリセット',
    en: 'BUTTON LAYOUT',
    desc: 'ボタン配置のプリセットを選びます。下の一覧の「変更」から個別に割り当てるとカスタム配置へ移行します。',
    note: 'PS4 DualShock などの標準ゲームパッドに対応。既定はBO3標準配置',
    build: (mnu) => buildPresetAndRebind(mnu),
  },
];

const TAB_SPECS: Record<EoptTabId, RowGroup[]> = {
  general: [
    {
      rows: [
        {
          label: '試合時間',
          en: 'MATCH LENGTH',
          desc: '対戦モードの1試合の長さを設定します。',
          note: '次の試合開始時に反映されます',
          build: (mnu) =>
            select(
              mnu,
              '試合時間',
              MATCH_LENGTHS.map((m) => ({ value: String(m.value), label: m.label })),
              String(mnu.settings.matchLengthS),
              (v) => {
                mnu.settings.matchLengthS = Number(v);
              },
            ),
        },
        {
          label: '設定を既定に戻す',
          en: 'RESET TO DEFAULT',
          desc: 'すべての設定を初期値へ戻します。ゲームパッドのボタン割り当ても既定へ戻ります。',
          note: 'この操作は取り消せません',
          build: (mnu) => buildResetRow(mnu),
        },
      ],
    },
  ],
  video: [
    {
      rows: [
        {
          label: '視野角(FOV)',
          en: 'FIELD OF VIEW',
          desc: '腰だめ時の垂直視野角です。広いほど周辺が見えますが、遠くの敵は小さく表示されます。',
          build: (mnu) =>
            slider(mnu, '視野角(FOV)', 60, 110, 1, mnu.settings.fov, (v) => {
              mnu.settings.fov = v;
            }),
        },
        {
          label: '画質',
          en: 'GRAPHICS QUALITY',
          desc: '影・ポスト処理・解像度スケールの品質ティアを切り替えます。',
          note: '変更はページの再読み込みで完全に反映されます',
          build: (mnu) =>
            select(
              mnu,
              '画質',
              GRAPHICS_QUALITIES.map((q) => ({ value: q, label: GRAPHICS_LABELS[q] })),
              mnu.settings.graphicsQuality,
              (v) => {
                mnu.settings.graphicsQuality = v as GraphicsQuality;
              },
            ),
        },
        {
          label: 'UIの大きさ',
          en: 'UI SCALE',
          desc: 'HUDとメニューの表示倍率です。',
          build: (mnu) =>
            slider(mnu, 'UIの大きさ', 0.8, 1.3, 0.05, mnu.settings.uiScale, (v) => {
              mnu.settings.uiScale = v;
            }),
        },
        {
          label: 'UIのアクセント',
          en: 'UI ACCENT',
          desc: 'UIの強調色テーマを切り替えます。即時反映されます。',
          build: (mnu) =>
            select(
              mnu,
              'UIのアクセント',
              UI_ACCENTS.map((a) => ({ value: a.id, label: a.name })),
              mnu.settings.uiAccent,
              (v) => {
                mnu.settings.uiAccent = v;
              },
            ),
        },
        {
          label: '敵味方の配色',
          en: 'TEAM COLORS',
          desc: '敵と味方の識別色パレットです。色覚多様性に配慮した配色を含みます。',
          note: '次の試合開始時に反映されます',
          build: (mnu) =>
            select(
              mnu,
              '敵味方の配色',
              TEAM_PALETTES.map((p) => ({ value: p.id, label: p.name })),
              mnu.settings.teamPaletteId,
              (v) => {
                mnu.settings.teamPaletteId = v;
              },
            ),
        },
        {
          label: 'レティクル形状',
          en: 'RETICLE STYLE',
          desc: '照準レティクルの形状です。即時反映されます。',
          build: (mnu) =>
            select(
              mnu,
              'レティクル形状',
              RETICLE_STYLES.map((r) => ({ value: r.id, label: r.name })),
              mnu.settings.reticleStyle,
              (v) => {
                mnu.settings.reticleStyle = v;
              },
            ),
        },
        {
          label: 'レティクル色',
          en: 'RETICLE COLOR',
          desc: '照準レティクルの色です。即時反映されます。',
          build: (mnu) =>
            select(
              mnu,
              'レティクル色',
              RETICLE_COLORS.map((r) => ({ value: r.id, label: r.name })),
              mnu.settings.reticleColor,
              (v) => {
                mnu.settings.reticleColor = v;
              },
            ),
        },
        {
          label: '簡易レーダーを表示',
          en: 'RADAR',
          desc: '画面隅の簡易レーダー表示を切り替えます。',
          build: (mnu) =>
            checkbox(mnu, '簡易レーダーを表示', mnu.settings.radarEnabled, (v) => {
              mnu.settings.radarEnabled = v;
            }),
        },
        {
          label: '画面の揺れ',
          en: 'SCREEN SHAKE',
          desc: '着弾や爆発によるカメラの揺れの強さです。0で無効になります。',
          build: (mnu) =>
            slider(mnu, '画面の揺れ', 0, 1, 0.05, mnu.settings.screenShake, (v) => {
              mnu.settings.screenShake = v;
            }),
        },
      ],
    },
  ],
  audio: [
    {
      rows: [
        {
          label: '全体音量',
          en: 'MASTER VOLUME',
          desc: 'すべての音の主音量です。',
          build: (mnu) =>
            slider(mnu, '全体音量', 0, 1, 0.05, mnu.settings.volMaster, (v) => {
              mnu.settings.volMaster = v;
            }),
        },
        {
          label: 'BGM音量',
          en: 'MUSIC VOLUME',
          desc: '戦闘BGM・帝王転調・メニュー音楽など、音楽全体の音量です。効果音とは独立して調整できます。',
          build: (mnu) =>
            slider(
              mnu,
              'BGM音量',
              SETTING_BOUNDS.musicVolume.min,
              SETTING_BOUNDS.musicVolume.max,
              0.05,
              mnu.settings.musicVolume,
              (v) => {
                mnu.settings.musicVolume = v;
              },
            ),
        },
        {
          label: '音声音量',
          en: 'VOICE VOLUME',
          desc: 'アナウンスと無線劇の音声(合成音声)全体の音量です。',
          build: (mnu) =>
            slider(
              mnu,
              '音声音量',
              SETTING_BOUNDS.voVolume.min,
              SETTING_BOUNDS.voVolume.max,
              0.05,
              mnu.settings.voVolume,
              (v) => {
                mnu.settings.voVolume = v;
              },
            ),
        },
        {
          label: '効果音量',
          en: 'SFX VOLUME',
          desc: '射撃・足音・被弾などの効果音の音量です。',
          build: (mnu) =>
            slider(mnu, '効果音量', 0, 1, 0.05, mnu.settings.volSfx, (v) => {
              mnu.settings.volSfx = v;
            }),
        },
        {
          label: 'UI音量',
          en: 'UI VOLUME',
          desc: 'メニュー操作音の音量です。',
          build: (mnu) =>
            slider(mnu, 'UI音量', 0, 1, 0.05, mnu.settings.volUi, (v) => {
              mnu.settings.volUi = v;
            }),
        },
        {
          label: 'アナウンサー音量',
          en: 'ANNOUNCER VOLUME',
          desc: '試合内アナウンス(連続キル・目標状況など)の音量です。',
          build: (mnu) =>
            slider(mnu, 'アナウンサー音量', 0, 1, 0.05, mnu.settings.announcerVolume, (v) => {
              mnu.settings.announcerVolume = v;
            }),
        },
        {
          label: '戦闘BGM(動的)',
          en: 'DYNAMIC COMBAT BGM',
          desc: '戦況の熱に応じて変化する動的BGMのオン/オフです。オフでも効果音は再生されます。',
          build: (mnu) =>
            checkbox(mnu, '戦闘BGM(動的)', mnu.settings.musicEnabled, (v) => {
              mnu.settings.musicEnabled = v;
            }),
        },
      ],
    },
  ],
  input: [
    {
      head: ['照準 / AIM', 'F01'],
      rows: [
        {
          label: 'マウス感度',
          en: 'MOUSE SENSITIVITY',
          desc: '腰だめ時のマウス視点感度です。',
          build: (mnu) =>
            slider(mnu, 'マウス感度', 0.2, 3, 0.05, mnu.settings.sensitivity, (v) => {
              mnu.settings.sensitivity = v;
            }),
        },
        {
          label: 'ADS感度倍率',
          en: 'ADS SENS MULTIPLIER',
          desc: 'エイム(ADS)中の感度倍率です。低いほど精密に狙えます。',
          build: (mnu) =>
            slider(mnu, 'ADS感度倍率', 0.3, 1.5, 0.05, mnu.settings.adsSensMul, (v) => {
              mnu.settings.adsSensMul = v;
            }),
        },
        {
          label: 'Y軸を反転する',
          en: 'INVERT Y',
          desc: 'マウスの上下視点入力を反転します。',
          build: (mnu) =>
            checkbox(mnu, 'Y軸を反転する', mnu.settings.invertY, (v) => {
              mnu.settings.invertY = v;
            }),
        },
        {
          label: 'ADSをトグルにする',
          en: 'TOGGLE ADS',
          desc: 'エイムを押すたびに切り替える方式にします。オフの場合は押している間だけエイムします。',
          build: (mnu) =>
            checkbox(mnu, 'ADSをトグルにする', mnu.settings.adsToggle, (v) => {
              mnu.settings.adsToggle = v;
            }),
        },
        {
          label: 'しゃがみをトグルにする',
          en: 'TOGGLE CROUCH',
          desc: 'しゃがみを押すたびに切り替える方式にします。',
          build: (mnu) =>
            checkbox(mnu, 'しゃがみをトグルにする', mnu.settings.crouchToggle, (v) => {
              mnu.settings.crouchToggle = v;
            }),
        },
      ],
    },
    {
      head: ['支援 / ASSIST', 'F02'],
      rows: [
        {
          label: 'エイムアシスト',
          en: 'AIM ASSIST',
          desc: 'ゲームパッド向けの照準補助(敵付近での減速と追従)を有効にします。',
          build: (mnu) =>
            checkbox(mnu, 'エイムアシスト', mnu.settings.aimAssist, (v) => {
              mnu.settings.aimAssist = v;
            }),
        },
        {
          label: 'エイムアシスト強度',
          en: 'ASSIST STRENGTH',
          desc: '照準補助の効きの強さです。',
          build: (mnu) =>
            slider(mnu, 'エイムアシスト強度', 0, 1, 0.05, mnu.settings.aimAssistStrength, (v) => {
              mnu.settings.aimAssistStrength = v;
            }),
        },
      ],
    },
    {
      head: ['操縦系統 / GAMEPAD', 'F03'],
      rows: PAD_GROUP_SPECS,
    },
  ],
  access: [
    {
      rows: [
        {
          label: '画面の揺れを軽減する',
          en: 'REDUCE MOTION',
          desc: 'UIの点滅・振動・アニメーション演出を抑制します。OSの「視差効果を減らす」設定にも追従します。',
          note: '有効時は演出が簡略化されます',
          build: (mnu) =>
            checkbox(mnu, '画面の揺れを軽減する', mnu.settings.reduceMotion, (v) => {
              mnu.settings.reduceMotion = v;
            }),
        },
      ],
    },
  ],
};

// タブ内の全項目ラベル(純関数 — 分類の完全性テスト用)
export function eoptItemLabels(tab: EoptTabId): string[] {
  return TAB_SPECS[tab].flatMap((g) => g.rows.map((r) => r.label));
}

// ラベル→詳細カード内容(純関数)。リバインド表の行はここに載らない(配置プリセットに帰属)
export function eoptDetailFor(
  label: string,
): { en: string; desc: string; note?: string } | null {
  for (const tab of EOPT_TABS) {
    for (const g of TAB_SPECS[tab.id]) {
      const hit = g.rows.find((r) => r.label === label);
      if (hit) return { en: hit.en, desc: hit.desc, note: hit.note };
    }
  }
  return null;
}

// ポーズ画面ナビ(id契約: resume/photo/quit — gamepadBack互換。純データでピン)
export const PAUSE_NAV: ReadonlyArray<[id: string, label: string]> = [
  ['resume', '作戦に復帰'],
  ['photo', 'フォトモード'],
  ['quit', 'メニューに戻る'],
];

// 選択中タブ(モジュール状態: 画面を跨いで最後のタブを記憶する)
let activeTab: EoptTabId = 'general';

// ── 画面本体 ─────────────────────────────────────────────
export function renderSettings(mnu: MenuScreenHost, container: HTMLElement): void {
  container.className = 'eopt-panel';
  // 画面差し替えで捕捉中だったリバインドは無効化する(コールバック・keydownリスナを残さない)
  mnu.endCapture();
  container.innerHTML = '';

  // 画面題(菱アイコン角枠+kicker+特大題=選択中タブ名)
  const head = document.createElement('header');
  head.className = 'enza-page-head eopt-head';
  head.innerHTML = `
    <span class="enza-page-head__icon" aria-hidden="true"><i class="enza-diamond enza-diamond--outline"></i></span>
    <span class="eopt-head__text">
      <span class="enza-page-head__kicker enza-kicker">システム&nbsp;&nbsp;SETTINGS</span>
      <span class="enza-page-head__title eopt-head__title"></span>
    </span>
  `;
  container.appendChild(head);
  const titleEl = head.querySelector<HTMLElement>('.eopt-head__title');

  // タブ帯
  const tabbar = document.createElement('nav');
  tabbar.className = 'enza-tabbar eopt-tabs';
  tabbar.setAttribute('role', 'tablist');
  container.appendChild(tabbar);

  // 本体: 左=設定行 右=詳細カード
  const body = document.createElement('div');
  body.className = 'eopt-body';
  const rowsHost = document.createElement('div');
  rowsHost.className = 'eopt-rows';
  rowsHost.setAttribute('role', 'tabpanel');
  const detail = document.createElement('aside');
  detail.className = 'eopt-detail enza-plate';
  body.append(rowsHost, detail);
  container.appendChild(body);

  const foot = document.createElement('p');
  foot.className = 'eopt-foot enza-kicker';
  foot.textContent = '設定はブラウザに自動保存されます';
  container.appendChild(foot);

  const showDetail = (label: string): void => {
    const d = eoptDetailFor(label);
    if (!d) return;
    detail.innerHTML = `
      <span class="eopt-detail__icon" aria-hidden="true"><i class="enza-diamond enza-diamond--filled"></i></span>
      <h3 class="eopt-detail__title">${label}</h3>
      <span class="eopt-detail__en enza-kicker">${d.en}</span>
      <p class="eopt-detail__desc">${d.desc}</p>
      ${d.note ? `<p class="eopt-detail__note">◆ ${d.note}</p>` : ''}
      <p class="eopt-detail__note">◆ 設定はブラウザに自動保存されます</p>
    `;
  };

  const renderTab = (tab: EoptTabId): void => {
    activeTab = tab;
    const def = EOPT_TABS.find((t) => t.id === tab);
    if (titleEl && def) titleEl.textContent = def.label;
    for (const btn of Array.from(tabbar.children) as HTMLElement[]) {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    rowsHost.innerHTML = '';
    for (const group of TAB_SPECS[tab]) {
      if (group.head) rowsHost.appendChild(subhead(mnu, group.head[0], group.head[1]));
      for (const spec of group.rows) {
        const built = spec.build(mnu);
        for (const el of Array.isArray(built) ? built : [built]) rowsHost.appendChild(el);
      }
    }
    const first = TAB_SPECS[tab][0]?.rows[0];
    if (first) showDetail(first.label);
  };

  for (const t of EOPT_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'enza-tab eopt-tab';
    btn.dataset.tab = t.id;
    btn.setAttribute('role', 'tab');
    btn.textContent = t.label;
    btn.addEventListener('click', () => renderTab(t.id));
    tabbar.appendChild(btn);
  }

  // フォーカス/ホバーで詳細カードを追従させる(行のdata-eopt-labelを拾う)
  const followDetail = (e: Event): void => {
    const row = (e.target as HTMLElement | null)?.closest?.('[data-eopt-label]');
    const label = row instanceof HTMLElement ? row.dataset.eoptLabel : undefined;
    if (label) showDetail(label);
  };
  rowsHost.addEventListener('focusin', followDetail);
  rowsHost.addEventListener('pointerover', followDetail);

  renderTab(activeTab);
}

// 「設定を既定に戻す」行
function buildResetRow(mnu: MenuScreenHost): HTMLElement {
  const row = document.createElement('div');
  row.className = 'eopt-row eopt-row--action';
  row.dataset.eoptLabel = '設定を既定に戻す';
  const label = document.createElement('span');
  label.className = 'eopt-row__label';
  label.textContent = '設定を既定に戻す';
  const ctl = document.createElement('span');
  ctl.className = 'eopt-row__ctl';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'eopt-action';
  btn.textContent = '既定に戻す';
  btn.addEventListener('click', () => {
    mnu.endCapture();
    mnu.bindNote = '';
    Object.assign(mnu.settings, DEFAULT_SETTINGS);
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
    const panel = row.closest('.eopt-panel');
    if (panel instanceof HTMLElement) mnu.renderSettings(panel);
  });
  ctl.appendChild(btn);
  row.append(label, ctl);
  return row;
}

// ── ゲームパッド設定セクション ────────────────────────────────────
// 契約export(menu-golden.test.tsピン)。renderSettingsの操作タブと同一のspec配列から組む
export function buildGamepadSettings(mnu: MenuScreenHost): HTMLElement {
  const section = document.createElement('section');
  section.className = 'eopt-pad-section';
  section.appendChild(subhead(mnu, '操縦系統 / GAMEPAD', 'F05'));
  for (const spec of PAD_GROUP_SPECS) {
    const built = spec.build(mnu);
    for (const el of Array.isArray(built) ? built : [built]) section.appendChild(el);
  }
  return section;
}

// 配置プリセット行+リバインド表(binding表と相互参照するため手組み)
function buildPresetAndRebind(mnu: MenuScreenHost): HTMLElement[] {
  const layoutRow = document.createElement('label');
  layoutRow.className = 'eopt-row';
  layoutRow.dataset.eoptLabel = '配置プリセット';
  const layoutText = document.createElement('span');
  layoutText.className = 'eopt-row__label';
  layoutText.textContent = '配置プリセット';
  const ctl = document.createElement('span');
  ctl.className = 'eopt-row__ctl';
  const layoutSelect = document.createElement('select');
  layoutSelect.className = 'eopt-select';
  for (const layout of GP_LAYOUTS) {
    const opt = document.createElement('option');
    opt.value = layout.id;
    opt.textContent = layout.name;
    layoutSelect.appendChild(opt);
  }
  layoutSelect.value = mnu.settings.gamepadLayout;
  ctl.append(stepper(-1, layoutSelect), layoutSelect, stepper(1, layoutSelect));
  layoutRow.append(layoutText, ctl);

  const host = document.createElement('div');
  host.className = 'eopt-rebind';
  host.dataset.eoptLabel = '配置プリセット';

  layoutSelect.addEventListener('change', () => {
    const id = layoutSelect.value as (typeof GP_LAYOUTS)[number]['id'];
    mnu.settings.gamepadLayout = id;
    // プリセットへ切替: そのプリセットを複製して実バインドへ反映。customは現状維持(複製)
    mnu.settings.gamepadBindings =
      id === 'custom' ? cloneBindings(mnu.settings.gamepadBindings) : cloneBindings(PRESETS[id]);
    mnu.bindNote = '';
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
    mnu.renderGamepadBindings(host, layoutSelect);
  });

  mnu.renderGamepadBindings(host, layoutSelect);
  return [layoutRow, host];
}

// リバインド表を(再)描画する。各行=アクション名+現在のグリフ+「変更」ボタン
export function renderGamepadBindings(
  mnu: MenuScreenHost,
  host: HTMLElement,
  layoutSelect: HTMLSelectElement,
): void {
  host.innerHTML = '';
  for (const [action, label] of PAD_ACTION_ROWS) {
    const row = document.createElement('div');
    row.className = 'eopt-rebind-row';
    const name = document.createElement('span');
    name.className = 'eopt-rebind-name';
    name.textContent = label;
    const glyphs = document.createElement('span');
    glyphs.className = 'eopt-rebind-glyph enza-num';
    const binds = mnu.settings.gamepadBindings[action];
    glyphs.textContent = binds.length > 0 ? binds.map(glyphFor).join(' / ') : '(なし)';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eopt-rebind-btn';
    const capturing = mnu.capturingAction === action;
    btn.textContent = capturing ? '…ボタンを押す(Escで取消)' : '変更';
    if (capturing) btn.classList.add('capturing');
    btn.addEventListener('click', () => mnu.startCapture(action, host, layoutSelect));
    row.append(name, glyphs, btn);
    host.appendChild(row);
  }
  if (mnu.bindNote) {
    const note = document.createElement('p');
    note.className = 'eopt-note eopt-rebind-note';
    note.textContent = mnu.bindNote;
    host.appendChild(note);
  }
}

// 次に押されたパッドボタンを当該アクションへ割り当てる。プリセット中ならcustomへ移行する
export function startCapture(
  mnu: MenuScreenHost,
  action: PadAction,
  host: HTMLElement,
  layoutSelect: HTMLSelectElement,
): void {
  // 別の捕捉が走っていたら確実に畳む(前回の keydown リスナも除去)
  mnu.endCapture();
  // プリセットは共有オブジェクト。編集前にcustomへ移行して複製する
  if (mnu.settings.gamepadLayout !== 'custom') {
    mnu.settings.gamepadLayout = 'custom';
    mnu.settings.gamepadBindings = cloneBindings(mnu.settings.gamepadBindings);
    layoutSelect.value = 'custom';
  }
  mnu.capturingAction = action;
  mnu.bindNote = '';

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    mnu.endCapture();
    mnu.renderGamepadBindings(host, layoutSelect);
  };
  document.addEventListener('keydown', onKey, true);
  // endCapture から呼ばれる後始末(Input側コールバック解除は endCapture が担う)
  mnu.captureCleanup = () => document.removeEventListener('keydown', onKey, true);
  mnu.renderGamepadBindings(host, layoutSelect);

  mnu.input.captureNextButton((binding) => {
    mnu.endCapture();
    mnu.assignBinding(action, binding);
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
    mnu.renderGamepadBindings(host, layoutSelect);
  });
}

// 物理ボタンは1アクションに対応させる。重複は他アクションから外し、通知文に残す
export function assignBinding(
  mnu: MenuScreenHost,
  action: PadAction,
  binding: GamepadBinding,
): void {
  const bindings = mnu.settings.gamepadBindings;
  const moved: string[] = [];
  for (const [other, label] of PAD_ACTION_ROWS) {
    if (other === action) continue;
    if (bindings[other].some((x) => x.index === binding.index)) {
      bindings[other] = bindings[other].filter((x) => x.index !== binding.index);
      moved.push(label);
    }
  }
  bindings[action] = [binding];
  mnu.bindNote = moved.length
    ? `${glyphFor(binding)} を「${moved.join('、')}」から移動しました`
    : '';
}

// SYSTEM設定のグループ見出し。data-codeはCSSのattr()で右端に描く装飾コード
export function subhead(_mnu: MenuScreenHost, label: string, code: string): HTMLElement {
  const h = document.createElement('h3');
  h.className = 'eopt-subhead';
  h.dataset.code = code;
  h.textContent = label;
  return h;
}

// ◀▶ステッパー(装飾+マウス用。フォーカス巡回は汚さないよう<span>で作りtabindexを与えない)
function stepper(dir: -1 | 1, input: HTMLInputElement | HTMLSelectElement): HTMLElement {
  const s = document.createElement('span');
  s.className = 'eopt-step';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = dir < 0 ? '◀' : '▶';
  s.addEventListener('click', (e) => {
    // チェック行はlabel既定動作(クリックでトグル)に任せる — preventDefaultすると殺してしまう
    if (input instanceof HTMLInputElement && input.type === 'checkbox') return;
    e.preventDefault();
    if (input instanceof HTMLInputElement) {
      if (dir < 0) input.stepDown();
      else input.stepUp();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const n = input.options.length;
      if (n === 0) return;
      const next = (input.selectedIndex + dir + n) % n;
      input.selectedIndex = next;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  return s;
}

export function slider(
  mnu: MenuScreenHost,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  apply: (v: number) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'eopt-row';
  row.dataset.eoptLabel = label;
  const text = document.createElement('span');
  text.className = 'eopt-row__label';
  text.textContent = label;
  const ctl = document.createElement('span');
  ctl.className = 'eopt-row__ctl';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'eopt-range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  // セグメントゲージ(10刻み)+数値。実入力は透明なrangeがゲージ上に重なり、
  // ネイティブの←→/ドラッグ/クリックをそのまま受ける(focusables互換)
  const track = document.createElement('span');
  track.className = 'eopt-track';
  const gauge = document.createElement('span');
  gauge.className = 'enza-seg eopt-gauge';
  gauge.setAttribute('aria-hidden', 'true');
  const segs: HTMLElement[] = [];
  for (let i = 0; i < 10; i += 1) {
    const seg = document.createElement('i');
    segs.push(seg);
    gauge.appendChild(seg);
  }
  track.append(gauge, input);

  const display = document.createElement('span');
  display.className = 'eopt-val enza-num';
  const fmt = (v: number): string => String(Math.round(v * 100) / 100);
  display.textContent = fmt(value);

  const syncFill = (): void => {
    const v = Number(input.value);
    const ratio = max > min ? (v - min) / (max - min) : 0;
    const on = Math.round(ratio * 10);
    segs.forEach((seg, i) => seg.classList.toggle('on', i < on));
  };
  syncFill();

  input.addEventListener('input', () => {
    const v = Number(input.value);
    apply(v);
    display.textContent = fmt(v);
    syncFill();
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
  });

  ctl.append(stepper(-1, input), track, display, stepper(1, input));
  row.append(text, ctl);
  return row;
}

// 汎用セレクト。反映タイミングは項目による(配色/試合時間は次の試合開始時、
// アクセント色やレティクルは即時)
export function select(
  mnu: MenuScreenHost,
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  apply: (v: string) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'eopt-row';
  row.dataset.eoptLabel = label;
  const text = document.createElement('span');
  text.className = 'eopt-row__label';
  text.textContent = label;
  const ctl = document.createElement('span');
  ctl.className = 'eopt-row__ctl';
  const input = document.createElement('select');
  input.className = 'eopt-select';
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    input.appendChild(node);
  }
  input.value = value;
  input.addEventListener('change', () => {
    apply(input.value);
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
  });
  ctl.append(stepper(-1, input), input, stepper(1, input));
  row.append(text, ctl);
  return row;
}

export function checkbox(
  mnu: MenuScreenHost,
  label: string,
  value: boolean,
  apply: (v: boolean) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'eopt-row eopt-row--check';
  row.dataset.eoptLabel = label;
  const text = document.createElement('span');
  text.className = 'eopt-row__label';
  text.textContent = label;
  const ctl = document.createElement('span');
  ctl.className = 'eopt-row__ctl';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'eopt-check';
  input.checked = value;
  const state = document.createElement('span');
  state.className = 'eopt-toggle enza-num';
  const syncState = (): void => {
    state.textContent = input.checked ? 'オン' : 'オフ';
    state.classList.toggle('on', input.checked);
  };
  syncState();
  input.addEventListener('change', () => {
    apply(input.checked);
    syncState();
    saveSettings(mnu.settings);
    mnu.callbacks.onSettingsChanged();
  });
  const track = document.createElement('span');
  track.className = 'eopt-track eopt-track--toggle';
  track.append(state, input);
  // チェック行の◀▶は装飾(クリックはlabel既定動作でトグルされる)
  ctl.append(stepper(-1, input), track, stepper(1, input));
  row.append(text, ctl);
  return row;
}

export function renderControls(mnu: MenuScreenHost): void {
  const grid = mnu.query('controls');
  grid.classList.add('eopt-ctl');
  for (const [label, keys] of CONTROLS) {
    // keys==='' はセクションヘッダー行: 両カラムをまたぐ見出しセルとして描画
    if (keys === '') {
      const hdr = document.createElement('span');
      hdr.className = 'eopt-ctl-head enza-kicker';
      hdr.textContent = label;
      grid.append(hdr);
      continue;
    }
    const action = document.createElement('span');
    action.className = 'eopt-ctl-action';
    action.textContent = label;
    const key = document.createElement('span');
    key.className = 'eopt-ctl-key enza-num';
    key.textContent = keys;
    grid.append(action, key);
  }
}

export function showPause(mnu: MenuScreenHost): void {
  mnu.clearBgTransition();
  mnu.teardownPreview();
  mnu.root.hidden = false;
  const lv = mnu.playerLevel();
  const rank = rankNameFor(lv);
  const ls = levelFromXp(mnu.profile.xp);
  const xpPct =
    ls.toNext > 0 ? Math.max(0, Math.min(100, (ls.intoLevel / ls.toNext) * 100)) : 100;
  const navHtml = PAUSE_NAV.map(
    ([id, label], i) =>
      `<button class="${i === 0 ? 'enza-cta' : 'enza-btn'} eopt-pause__navbtn" data-id="${id}">${label}</button>`,
  ).join('');
  mnu.root.innerHTML = `
    <div class="menu-screen eopt-pause">
      <div class="eopt-pause__panel" role="dialog" aria-modal="true" aria-label="一時停止">
        <div class="eopt-pause__left">
          <p class="enza-kicker eopt-pause__kicker">戦術一時停止&nbsp;&nbsp;TACTICAL PAUSE</p>
          <h1 class="enza-ritual eopt-pause__title">作戦中断</h1>
          <div class="eopt-pause__nav">${navHtml}</div>
          <div class="eopt-pause__status enza-plate enza-plate--sm">
            <span class="eopt-pause__stamp" aria-hidden="true">${rankStampChar(rank.name)}</span>
            <span class="eopt-pause__rank">
              <b>${rank.name}</b>
              <span class="enza-num">Lv ${lv.toLocaleString('ja-JP')}</span>
            </span>
            <span class="eopt-pause__stats enza-num">
              <span>撃破 ${mnu.profile.stats.kills.toLocaleString('ja-JP')}</span>
              <span>最高連勝 ${mnu.profile.records.bestWinStreak}</span>
            </span>
            <span class="eopt-pause__xp" aria-hidden="true"><i style="width:${xpPct.toFixed(1)}%"></i></span>
          </div>
        </div>
        <div class="eopt-pause__right">
          <div data-id="settings"></div>
        </div>
      </div>
      <div class="enza-hintbar eopt-pause__hints" aria-hidden="true">
        <span><kbd>Esc</kbd> 再開</span><span><kbd>Tab</kbd> 項目移動</span><span class="accent"><kbd>◀▶</kbd> 変更</span>
      </div>
    </div>
  `;
  mnu.renderSettings(mnu.query('settings'));
  mnu.query('resume').addEventListener('click', () => mnu.callbacks.onResume());
  mnu.query('photo').addEventListener('click', () => mnu.callbacks.onPhoto());
  mnu.query('quit').addEventListener('click', () => mnu.callbacks.onQuit());
  mnu.query('resume').focus({ preventScroll: true });
}
