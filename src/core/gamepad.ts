import type { Action } from './input';
import type { Settings } from './settings';

// ── 標準マッピング(W3C Standard Gamepad)のボタン/軸インデックス。DualShock4 もこの配列に乗る ──
export const GP = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SHARE: 8,
  OPTIONS: 9,
  L3: 10,
  R3: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
  PS: 16,
} as const;

// スティック軸。LY/RY は上方向が負
export const AX = { LX: 0, LY: 1, RX: 2, RY: 3 } as const;

// トリガーのアナログ判定しきい値(L2/R2 は value 0..1)
export const TRIGGER_FIRE = 0.1;
export const TRIGGER_ADS = 0.05;

// Chrome 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)' と
// Safari/FF '54c-9cc-Wireless Controller' の両形式を許容する
export function isDualShock4(id: string): boolean {
  const s = id.toLowerCase();
  return /054c|54c-/.test(s) && /(09cc|05c4|9cc|5c4)/.test(s);
}

// 移動(左スティック固定)を除いた全アクション + ゲームパッド専用の射撃/ADS/武器巡回
export type PadAction =
  | Exclude<Action, 'forward' | 'back' | 'left' | 'right'>
  | 'fire'
  | 'ads'
  | 'weaponswitch';

export type GamepadBinding =
  | { kind: 'button'; index: number }
  | { kind: 'trigger'; index: number; threshold: number };

export type GamepadBindings = Record<PadAction, GamepadBinding[]>;

export interface GamepadCfg {
  sensX: number;
  sensY: number;
  deadzone: number;
  exp: number;
  curve: 'linear' | 'exponential' | 'dynamic';
  invertY: boolean;
}

const btn = (index: number): GamepadBinding[] => [{ kind: 'button', index }];

// BO3 標準(Default / PS4)配置。射撃=R2 / ADS=L2 / ジャンプ=× / しゃがみ=○ / 近接=R3 /
// リロード=□ / 武器切替=△(巡回) / アルティメット=L1 / グレネード=R1 / スプリント=L3。
// weapon1/weapon2(数字直選択)はキーボード専用なので空。
export const BO3_DEFAULT: GamepadBindings = {
  jump: btn(GP.CROSS),
  crouch: btn(GP.CIRCLE),
  sprint: btn(GP.L3),
  reload: btn(GP.SQUARE),
  melee: btn(GP.R3),
  weapon1: [],
  weapon2: [],
  grenade: btn(GP.R1),
  grenadeswitch: btn(GP.DDOWN),
  leanleft: btn(GP.DLEFT),
  leanright: btn(GP.DRIGHT),
  ultimate: btn(GP.L1),
  ult2: [], // 風神・極大手裏剣(ゲームパッド未割当・キーボード専用)
  ult3: [], // 雷帝・神獣降臨(ゲームパッド未割当・キーボード専用)
  ult4: [], // 黒技・シュヴァルツヴァルト(ゲームパッド未割当)
  holdBreath: btn(GP.L3), // スプリントと共有(ADS中=息止め / 非ADS=スプリント)
  scoreboard: btn(GP.SHARE),
  // BO2 スコアストリーク発動キー: ゲームパッドは未割当(キーボード専用)
  streak1: [],
  streak2: [],
  streak3: [],
  streak4: [],
  streak5: [],
  streak6: [],
  streak7: [],
  interact: [],
  fire: [{ kind: 'trigger', index: GP.R2, threshold: TRIGGER_FIRE }],
  ads: [{ kind: 'trigger', index: GP.L2, threshold: TRIGGER_ADS }],
  weaponswitch: btn(GP.TRIANGLE),
};

// Default からの差分プリセット(いずれも競合フリー)
export const PRESETS = {
  default: BO3_DEFAULT,
  tactical: { ...BO3_DEFAULT, crouch: btn(GP.R3), melee: btn(GP.CIRCLE) },
  bumperJumper: {
    ...BO3_DEFAULT,
    jump: btn(GP.L1),
    ultimate: btn(GP.CROSS),
    melee: btn(GP.CIRCLE),
    crouch: btn(GP.R3),
  },
  stickAndMove: { ...BO3_DEFAULT, jump: btn(GP.R3), melee: btn(GP.CROSS) },
} as const satisfies Record<string, GamepadBindings>;

export type GamepadLayoutId = keyof typeof PRESETS | 'custom';

export const GP_LAYOUTS: ReadonlyArray<{ id: GamepadLayoutId; name: string }> = [
  { id: 'default', name: '標準(BO3)' },
  { id: 'tactical', name: 'タクティカル' },
  { id: 'bumperJumper', name: 'バンパージャンパー' },
  { id: 'stickAndMove', name: 'スティック&ムーブ' },
  { id: 'custom', name: 'カスタム' },
];

// スケール付きラジアルデッドゾーン。中立(<dz)は0、外周(>=1)は1、向きを保ったまま0..1へ再正規化する
export function scaledRadialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= dz || mag <= 1e-6) return { x: 0, y: 0 };
  const scaled = Math.min((mag - dz) / (1 - dz), 1);
  const f = scaled / mag;
  return { x: x * f, y: y * f };
}

// 応答カーブ。入力 v(-1..1)の絶対値に曲線を当て、符号は保つ。0→0 / 1→1 を全カーブで満たす
export function applyCurve(v: number, curve: GamepadCfg['curve'], exp: number): number {
  const s = Math.sign(v);
  const a = Math.min(Math.abs(v), 1);
  let out: number;
  if (curve === 'linear') out = a;
  else if (curve === 'exponential') out = Math.pow(a, exp);
  // dynamic: 中央付近は指数(精密)・外周は線形寄り(機敏)へブレンド
  else out = Math.pow(a, exp) * (1 - a) + a * a;
  return s * out;
}

// localStorage 由来の壊れたバインドを矯正する。全キーを走査し、不正な束ねは
// BO3_DEFAULT の該当値で補完する(旧バージョンのセーブでも壊れない)
export function sanitizeGamepadBindings(raw: unknown): GamepadBindings {
  const out = {} as GamepadBindings;
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  for (const key of Object.keys(BO3_DEFAULT) as PadAction[]) {
    const list = src[key];
    if (!Array.isArray(list)) {
      out[key] = BO3_DEFAULT[key].map((b) => ({ ...b }));
      continue;
    }
    const cleaned: GamepadBinding[] = [];
    for (const item of list) {
      const b = item as Partial<GamepadBinding> & Record<string, unknown>;
      const index = typeof b.index === 'number' ? Math.round(b.index) : -1;
      if (index < 0 || index > 16) continue;
      if (b.kind === 'button') {
        cleaned.push({ kind: 'button', index });
      } else if (b.kind === 'trigger') {
        const t = typeof b.threshold === 'number' ? b.threshold : NaN;
        if (Number.isFinite(t) && t > 0 && t <= 1) cleaned.push({ kind: 'trigger', index, threshold: t });
      }
    }
    out[key] = cleaned;
  }
  return out;
}

const BUTTON_GLYPHS: Record<number, string> = {
  [GP.CROSS]: '✕',
  [GP.CIRCLE]: '○',
  [GP.SQUARE]: '□',
  [GP.TRIANGLE]: '△',
  [GP.L1]: 'L1',
  [GP.R1]: 'R1',
  [GP.L2]: 'L2',
  [GP.R2]: 'R2',
  [GP.SHARE]: 'SHARE',
  [GP.OPTIONS]: 'OPTIONS',
  [GP.L3]: 'L3',
  [GP.R3]: 'R3',
  [GP.DUP]: '↑',
  [GP.DDOWN]: '↓',
  [GP.DLEFT]: '←',
  [GP.DRIGHT]: '→',
  [GP.PS]: 'PS',
};

// バインドを画面表示用のグリフ文字列にする(SVG/フォント不要)
export function glyphFor(b: GamepadBinding): string {
  return BUTTON_GLYPHS[b.index] ?? `#${b.index}`;
}

// 設定から毎フレームの解釈用 cfg を取り出す
export function gamepadCfg(s: Settings): GamepadCfg {
  return {
    sensX: s.gamepadSensX,
    sensY: s.gamepadSensY,
    deadzone: s.gamepadDeadzone,
    exp: s.gamepadResponseExp,
    curve: s.gamepadResponseCurve,
    invertY: s.gamepadInvertY,
  };
}
