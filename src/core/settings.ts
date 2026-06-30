import {
  GP_LAYOUTS,
  PRESETS,
  sanitizeGamepadBindings,
  type GamepadBindings,
  type GamepadLayoutId,
} from './gamepad';

// 画質ティア。low は EffectComposer を作らず素のレンダラ(WebGL1自動フォールバック先)
export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];

// 実効画質ティア。WebGL2非対応環境は EffectComposer/HalfFloat RT が不安定なため low へ落とす。
// main.ts(レンダラ生成)と Match(Composer構築)が同じ結論に至るための単一の関数。
export function resolveGraphicsTier(quality: GraphicsQuality, hasWebGL2: boolean): GraphicsQuality {
  return hasWebGL2 ? quality : 'low';
}
const GAMEPAD_CURVES = ['linear', 'exponential', 'dynamic'] as const;
export type GamepadResponseCurve = (typeof GAMEPAD_CURVES)[number];

export interface Settings {
  sensitivity: number;
  fov: number;
  volMaster: number;
  volSfx: number;
  volUi: number;
  adsToggle: boolean;
  crouchToggle: boolean;
  // 上下の視点操作を反転する(マウスを上へ動かすと下を向く)
  invertY: boolean;
  // 画面揺れ軽減: 武器のスウェイ・ボブを抑える
  reduceMotion: boolean;
  uiScale: number;
  // UIのアクセント色。style.cssの data-accent バリアントID
  uiAccent: string;
  // 色覚サポート: teamcolors.tsのパレットID
  teamPaletteId: string;
  // 試合の制限時間(秒)。先取スコアに届かなければこの時間で決着する
  matchLengthS: number;
  // エイムアシスト(主にスナイパー)。視認できる敵が照準錐内にいると微妙に吸着する
  aimAssist: boolean;
  // エイムアシストの強さ。スローダウン/吸着/弾道補正の倍率(0で実質無効)
  aimAssistStrength: number;
  // ADS(覗き込み)時のマウス感度倍率。高倍率スコープが速すぎる問題の調整用
  adsSensMul: number;
  // レティクル(照準)の形状。RETICLE_STYLESのID
  reticleStyle: string;
  // レティクルの色。RETICLE_COLORSのID
  reticleColor: string;
  // 画面の揺れ(カメラシェイク)の倍率。0で無効、1で既定
  screenShake: number;
  // 簡易レーダー(ミニマップ)を表示する。視認済みの敵をスイープで点灯する
  radarEnabled: boolean;
  // ストリークのアナウンサー音声(SpeechSynthesis)の音量。0で無音
  announcerVolume: number;
  // ── R5 リアル化: 画質ティア(low/medium/high) ──
  graphicsQuality: GraphicsQuality;
  // ── R5 ゲームパッド(PS4 DualShock 等) ──
  gamepadSensX: number; // 横感度
  gamepadSensY: number; // 縦感度
  gamepadDeadzone: number; // スティックのデッドゾーン
  gamepadResponseExp: number; // 応答カーブの指数
  gamepadResponseCurve: GamepadResponseCurve;
  gamepadInvertY: boolean; // ゲームパッドのY軸反転(マウスとは独立)
  gamepadVibration: boolean; // 振動(対応環境のみ)
  gamepadLayout: GamepadLayoutId; // プリセット or custom
  gamepadBindings: GamepadBindings; // 実バインド(custom時のみ独自値)
}

// UIのアクセント色の選択肢。idはstyle.cssの :root[data-accent='…'] と対応し、
// 既定の ember は素の :root なので data-accent 属性を付けない
export const UI_ACCENTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'ember', name: '火花(既定)' },
  { id: 'cyan', name: '水' },
  { id: 'amber', name: '琥珀' },
  { id: 'violet', name: '菫' },
];

// レティクル形状の選択肢。最初の値を既定とする
export const RETICLE_STYLES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'cross', name: 'クロス' },
  { id: 'dot', name: 'ドット' },
  { id: 'chevron', name: 'シェブロン' },
  { id: 'circle', name: 'サークル' },
];

// レティクル色の選択肢。valueはstyle.cssへ渡すCSS色(accentはテーマ変数に追従)
export const RETICLE_COLORS: ReadonlyArray<{ id: string; name: string; value: string }> = [
  { id: 'accent', name: 'アクセント', value: 'var(--accent)' },
  { id: 'white', name: '白', value: '#ffffff' },
  { id: 'cyan', name: 'シアン', value: '#19e6ff' },
  { id: 'lime', name: 'ライム', value: '#7cfc00' },
  { id: 'magenta', name: 'マゼンタ', value: '#ff3df0' },
  { id: 'amber', name: '琥珀', value: '#ffb020' },
];

// 設定UIのスライダーと読み込み時の検証で同じ範囲を使う
export const SETTING_BOUNDS = {
  sensitivity: { min: 0.2, max: 3 },
  fov: { min: 60, max: 110 },
  volMaster: { min: 0, max: 1 },
  volSfx: { min: 0, max: 1 },
  volUi: { min: 0, max: 1 },
  uiScale: { min: 0.8, max: 1.3 },
  aimAssistStrength: { min: 0, max: 1 },
  adsSensMul: { min: 0.3, max: 1.5 },
  screenShake: { min: 0, max: 1 },
  announcerVolume: { min: 0, max: 1 },
  gamepadSensX: { min: 0.2, max: 5 },
  gamepadSensY: { min: 0.2, max: 5 },
  gamepadDeadzone: { min: 0.05, max: 0.3 },
  gamepadResponseExp: { min: 1.0, max: 2.5 },
} as const;

// 簡易レーダーの検知半径(m)。外周=検知限界。match(方位算出)とHUD(描画スケール)で共有
export const RADAR_RANGE_M = 55;

// 試合時間の選択肢(秒)。最初の値を既定とする
export const MATCH_LENGTHS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 180, label: '短期戦 3分' },
  { value: 300, label: '標準 5分' },
  { value: 480, label: '長期戦 8分' },
];

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 78,
  volMaster: 0.8,
  volSfx: 0.8,
  volUi: 0.6,
  adsToggle: false,
  crouchToggle: false,
  invertY: false,
  reduceMotion: false,
  uiScale: 1,
  uiAccent: 'ember',
  teamPaletteId: 'standard',
  matchLengthS: 300,
  aimAssist: true,
  aimAssistStrength: 0.6,
  adsSensMul: 1.0,
  reticleStyle: 'cross',
  reticleColor: 'accent',
  screenShake: 1.0,
  radarEnabled: true,
  announcerVolume: 0.65,
  graphicsQuality: 'medium',
  gamepadSensX: 2.5,
  gamepadSensY: 2.0,
  gamepadDeadzone: 0.1,
  gamepadResponseExp: 1.5,
  gamepadResponseCurve: 'exponential',
  gamepadInvertY: false,
  gamepadVibration: true,
  gamepadLayout: 'default',
  gamepadBindings: PRESETS.default,
};

const KEY = 'hibana.settings.v1';

// 有限な数値だけを受け入れて上下限へ丸める。null・文字列・NaNなどは無効とみなし既定へ。
// JSON.parseの結果で数値はnumber型なので、型を緩めるとnull→0のような取りこぼしを招く
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// 候補の中で一番近い値へ寄せる。範囲外・型違いは既定へ
function nearestMatchLength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.matchLengthS;
  let best = MATCH_LENGTHS[0]!.value;
  let bestDist = Infinity;
  for (const option of MATCH_LENGTHS) {
    const dist = Math.abs(option.value - value);
    if (dist < bestDist) {
      best = option.value;
      bestDist = dist;
    }
  }
  return best;
}

// localStorageの値はユーザーが書き換えられ、旧バージョンの形が残ることもある。
// 範囲外・型違い・欠落が紛れてもUIや挙動が壊れないよう、読み込み時に必ず正規化する
export function sanitizeSettings(raw: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  const b = SETTING_BOUNDS;
  const layout: GamepadLayoutId = GP_LAYOUTS.some((l) => l.id === merged.gamepadLayout)
    ? merged.gamepadLayout
    : DEFAULT_SETTINGS.gamepadLayout;
  return {
    sensitivity: clamp(
      merged.sensitivity,
      b.sensitivity.min,
      b.sensitivity.max,
      DEFAULT_SETTINGS.sensitivity,
    ),
    fov: Math.round(clamp(merged.fov, b.fov.min, b.fov.max, DEFAULT_SETTINGS.fov)),
    volMaster: clamp(
      merged.volMaster,
      b.volMaster.min,
      b.volMaster.max,
      DEFAULT_SETTINGS.volMaster,
    ),
    volSfx: clamp(merged.volSfx, b.volSfx.min, b.volSfx.max, DEFAULT_SETTINGS.volSfx),
    volUi: clamp(merged.volUi, b.volUi.min, b.volUi.max, DEFAULT_SETTINGS.volUi),
    adsToggle: Boolean(merged.adsToggle),
    crouchToggle: Boolean(merged.crouchToggle),
    invertY: Boolean(merged.invertY),
    reduceMotion: Boolean(merged.reduceMotion),
    uiScale: clamp(merged.uiScale, b.uiScale.min, b.uiScale.max, DEFAULT_SETTINGS.uiScale),
    uiAccent: UI_ACCENTS.some((a) => a.id === merged.uiAccent)
      ? merged.uiAccent
      : DEFAULT_SETTINGS.uiAccent,
    teamPaletteId:
      typeof merged.teamPaletteId === 'string' && merged.teamPaletteId.length > 0
        ? merged.teamPaletteId
        : DEFAULT_SETTINGS.teamPaletteId,
    matchLengthS: nearestMatchLength(merged.matchLengthS),
    aimAssist: Boolean(merged.aimAssist),
    aimAssistStrength: clamp(
      merged.aimAssistStrength,
      b.aimAssistStrength.min,
      b.aimAssistStrength.max,
      DEFAULT_SETTINGS.aimAssistStrength,
    ),
    adsSensMul: clamp(
      merged.adsSensMul,
      b.adsSensMul.min,
      b.adsSensMul.max,
      DEFAULT_SETTINGS.adsSensMul,
    ),
    reticleStyle: RETICLE_STYLES.some((r) => r.id === merged.reticleStyle)
      ? merged.reticleStyle
      : DEFAULT_SETTINGS.reticleStyle,
    reticleColor: RETICLE_COLORS.some((r) => r.id === merged.reticleColor)
      ? merged.reticleColor
      : DEFAULT_SETTINGS.reticleColor,
    screenShake: clamp(
      merged.screenShake,
      b.screenShake.min,
      b.screenShake.max,
      DEFAULT_SETTINGS.screenShake,
    ),
    radarEnabled: Boolean(merged.radarEnabled),
    announcerVolume: clamp(
      merged.announcerVolume,
      b.announcerVolume.min,
      b.announcerVolume.max,
      DEFAULT_SETTINGS.announcerVolume,
    ),
    graphicsQuality: GRAPHICS_QUALITIES.includes(merged.graphicsQuality)
      ? merged.graphicsQuality
      : DEFAULT_SETTINGS.graphicsQuality,
    gamepadSensX: clamp(
      merged.gamepadSensX,
      b.gamepadSensX.min,
      b.gamepadSensX.max,
      DEFAULT_SETTINGS.gamepadSensX,
    ),
    gamepadSensY: clamp(
      merged.gamepadSensY,
      b.gamepadSensY.min,
      b.gamepadSensY.max,
      DEFAULT_SETTINGS.gamepadSensY,
    ),
    gamepadDeadzone: clamp(
      merged.gamepadDeadzone,
      b.gamepadDeadzone.min,
      b.gamepadDeadzone.max,
      DEFAULT_SETTINGS.gamepadDeadzone,
    ),
    gamepadResponseExp: clamp(
      merged.gamepadResponseExp,
      b.gamepadResponseExp.min,
      b.gamepadResponseExp.max,
      DEFAULT_SETTINGS.gamepadResponseExp,
    ),
    gamepadResponseCurve: GAMEPAD_CURVES.includes(merged.gamepadResponseCurve)
      ? merged.gamepadResponseCurve
      : DEFAULT_SETTINGS.gamepadResponseCurve,
    gamepadInvertY: Boolean(merged.gamepadInvertY),
    gamepadVibration: Boolean(merged.gamepadVibration),
    gamepadLayout: layout,
    gamepadBindings:
      layout === 'custom' ? sanitizeGamepadBindings(merged.gamepadBindings) : PRESETS[layout],
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
