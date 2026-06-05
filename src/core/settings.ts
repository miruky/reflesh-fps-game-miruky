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
}

// UIのアクセント色の選択肢。idはstyle.cssの :root[data-accent='…'] と対応し、
// 既定の ember は素の :root なので data-accent 属性を付けない
export const UI_ACCENTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'ember', name: '火花(既定)' },
  { id: 'cyan', name: '水' },
  { id: 'amber', name: '琥珀' },
  { id: 'violet', name: '菫' },
];

// 設定UIのスライダーと読み込み時の検証で同じ範囲を使う
export const SETTING_BOUNDS = {
  sensitivity: { min: 0.2, max: 3 },
  fov: { min: 60, max: 110 },
  volMaster: { min: 0, max: 1 },
  volSfx: { min: 0, max: 1 },
  volUi: { min: 0, max: 1 },
  uiScale: { min: 0.8, max: 1.3 },
} as const;

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
