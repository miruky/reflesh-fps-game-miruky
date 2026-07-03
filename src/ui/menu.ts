import { easeOutCubic } from '../core/easing';
import {
  GP_LAYOUTS,
  PRESETS,
  glyphFor,
  type GamepadBinding,
  type GamepadBindings,
  type PadAction,
} from '../core/gamepad';
import type { Input, UiNav } from '../core/input';
import { exportProfile, importProfile, saveProfile } from '../core/profile';
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
  type Settings,
} from '../core/settings';
import {
  applyAttachments,
  ATTACHMENT_DEFS,
  ATTACHMENT_SLOTS,
  attachmentsForSlot,
  type AttachmentSlot,
} from '../game/attachments';
import { OPTIC_SPECS } from '../game/optics';
import type { Difficulty } from '../game/bot';
import { GRENADE_KINDS, GRENADE_SPECS, type GrenadeKind } from '../game/grenades';
import type { MatchResult } from '../game/match';
import { MODE_DEFS, MODE_IDS, type GameMode } from '../game/modes';
import { CAMPAIGN, missionById, nextMissionId, type MissionDef } from '../game/campaign';
import {
  CHALLENGES,
  isMissionUnlocked,
  isUnlocked,
  levelFromXp,
  rankFromRating,
  unlockLevelOf,
  type CampaignProgress,
  type MatchProgress,
  type Profile,
} from '../game/progression';
import { generateStage } from '../game/stage';
import { STAGES } from '../game/stages';
import { TEAM_PALETTES } from '../game/teamcolors';
import type { SpaceBg } from './menu-bg';
import { WeaponPreview } from '../render/weapon-preview';
import {
  computeWeaponBars,
  PRIMARY_IDS,
  SECONDARY_IDS,
  WEAPON_DEFS,
  type ViewModelShape,
  type WeaponClass,
  type WeaponDef,
} from '../game/weapons';

export interface MenuSelection {
  stageId: string;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
  secondaryId: string;
}

export interface MenuCallbacks {
  onStart: (selection: MenuSelection) => void;
  // primaryId 省略時はミッションの支給武器で出撃する
  onStartMission: (missionId: string, primaryId?: string) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChanged: () => void;
}

// 6軸ステータスバーの表示順とラベル(値は computeWeaponBars で WeaponDef から導出)
const BAR_AXES: ReadonlyArray<[keyof ReturnType<typeof computeWeaponBars>, string]> = [
  ['power', '威力'],
  ['rate', '連射'],
  ['control', '制御'],
  ['range', '射程'],
  ['mobility', '機動'],
  ['handling', '取回'],
];

// クラスの表示名(ARMORYのグループ見出し)
const CLASS_LABELS: Record<WeaponClass, string> = {
  ar: 'アサルトライフル',
  smg: 'サブマシンガン',
  marksman: 'マークスマン',
  sniper: 'スナイパー',
  shotgun: 'ショットガン',
  br: 'バトルライフル',
  lmg: 'ライトマシンガン',
  pistol: 'ハンドガン',
};
const CLASS_ORDER: readonly WeaponClass[] = [
  'ar',
  'smg',
  'br',
  'marksman',
  'sniper',
  'shotgun',
  'lmg',
  'pistol',
];

const GRENADE_DESCS: Record<GrenadeKind, string> = {
  frag: '長押しでクッキング。爆発範囲ダメージ',
  smoke: '視線を遮る煙幕を張る',
  flash: '視界を白く焼く。正面で食らうと長い',
  incendiary: '着弾点に燃え続ける火災を残す',
};

const LOADOUT_KEY = 'hibana.loadout.v1';

const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: '新兵', desc: '反応が遅く、よく外す' },
  { id: 'normal', label: '兵士', desc: '標準的な腕前' },
  { id: 'hard', label: '精鋭', desc: '反応が速く、正確に当てる' },
];

const CONTROLS: Array<[string, string]> = [
  ['移動', 'W A S D'],
  ['視点', 'マウス'],
  ['射撃', '左クリック'],
  ['ADS(覗き込み)', '右クリック'],
  ['ジャンプ / よじ登り', 'Space(空中で前進)'],
  ['スラスト二段ジャンプ', '空中で Space'],
  ['しゃがみ', 'C / 左Ctrl'],
  ['スプリント', '左Shift'],
  ['スライディング', 'スプリント中に C'],
  ['スライドジャンプ', 'スライド中に Space'],
  ['ウォールラン', '壁沿いを空中で前進(自動)'],
  ['ウォールジャンプ', 'ウォールラン中に Space'],
  ['リーン', 'Q / E'],
  ['リロード', 'R'],
  ['武器切替', '1 / 2 / ホイール'],
  ['グレネード', 'G 長押しで構え、離して投擲'],
  ['投擲物切替', '3'],
  ['近接攻撃', 'V'],
  ['アルティメット', 'F(ゲージ満タンで発動)'],
  ['息止め(スコープ)', 'Shift(覗き込み中に揺れを止める)'],
  ['スコアボード', 'Tab'],
  ['ポーズ', 'Esc'],
  ['ゲームパッド', 'PS4等に対応 / 下の「設定」で配置変更'],
  ['ポーズ(パッド)', 'OPTIONS'],
];

// リバインド表に出すパッドアクションの順序と日本語名。weapon1/weapon2(数字直選択)は
// キーボード専用なので割愛。fire/ads はトリガー、それ以外はボタン既定。
const PAD_ACTION_ROWS: ReadonlyArray<[PadAction, string]> = [
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

// バインドの深いコピー。プリセットは共有オブジェクトなので、カスタム編集前に必ず複製する
function cloneBindings(b: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const key of Object.keys(b) as PadAction[]) out[key] = b[key].map((x) => ({ ...x }));
  return out;
}

// ── ステージプレビュー: generateStage() の実BoxSpecを等角投影して本物のサムネを描く ──
const ISO = { CX: 80, CY: 34, SX: 38, SY: 20, H: 3.4, VH: 92 } as const;

// 床平面の正規化座標(nx,nz∈[-1,1])とスクリーン高さ hScreen をSVG座標へ等角投影
function projectIso(nx: number, nz: number, hScreen: number): { x: number; y: number } {
  const x = ISO.CX + (nx - nz) * ISO.SX;
  let y = ISO.CY + (nx + nz) * ISO.SY - hScreen;
  if (y < 2) y = 2;
  else if (y > ISO.VH - 2) y = ISO.VH - 2;
  return { x, y };
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// HSLの明度を dL だけシフトした #rrggbb を返す(立体の陰影づけ用)
function shadeHex(hex: string, dL: number): string {
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) hue = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) hue = (bn - rn) / d + 2;
    else hue = (rn - gn) / d + 4;
    hue /= 6;
  }
  const nl = Math.min(1, Math.max(0, l + dL));
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
  const p = 2 * nl - q;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const to2 = (v: number): string =>
    Math.round((s === 0 ? nl : v) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + to2(hue2rgb(hue + 1 / 3)) + to2(hue2rgb(hue)) + to2(hue2rgb(hue - 1 / 3));
}

// id→SVG文字列のメモ化(generateStageは決定論)。LRU上限でlocalStorage非依存に肥大を防ぐ
const stageSvgCache = new Map<string, string>();

// R10 IGNITION FRAME: 盾型ベゼル2層+十字計器+発光スパークの多層エンブレム。
// viewBox / role / aria-label / .spark クラスは旧ロゴと同一に保ち、CSSフックを壊さない
const LOGO_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="FPS-reFlesh Play Style- のロゴ">
  <title>FPS-reFlesh Play Style-</title>
  <defs>
    <linearGradient id="lg-ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#8a9299" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="lg-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M32 3 55 12v20c0 13-9 24-23 29C18 56 9 45 9 32V12z" fill="none" stroke="url(#lg-ring)" stroke-width="2" opacity="0.85"/>
  <path d="M32 8 50 15v16c0 10-7 19-18 23-11-4-18-13-18-23V15z" fill="rgba(255,255,255,0.04)" stroke="currentColor" stroke-width="1" opacity="0.5"/>
  <path d="M32 14v8M32 42v8M18 32h8M38 32h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
  <path class="spark" filter="url(#lg-glow)" d="M32 20l3.6 7.6L43 32l-7.4 3.4L32 44l-3.6-8.6L21 32l7.4-4.4z"/>
</svg>`;

// ── ARMORY 兵装カードの2D武器シルエット(アセットレス・純関数+メモ化) ──
// 本体は currentColor(CSSの --ink 系)、銃口/光学の発光アクセントのみ tracerColor を焼く。
// メモ化キーは `${shape}|${tracerColor}`(shape単独だとトレーサ色を無視するバグになる)。
const silCache = new Map<string, string>();

// shape 未指定の武器(=一部の副武器)用のクラス既定シルエット。
const CLASS_SHAPE: Record<WeaponClass, ViewModelShape> = {
  ar: 'rifle',
  smg: 'smg',
  marksman: 'dmr',
  sniper: 'sniper-bolt',
  shotgun: 'shotgun-pump',
  br: 'rifle',
  lmg: 'lmg-belt',
  pistol: 'pistol',
};

interface SilSpec {
  arch: 'ar' | 'bullpup' | 'smg' | 'dmr' | 'sniper' | 'shotgun' | 'lmg' | 'pistol' | 'revolver' | 'fists';
  barrel?: number; // 銃口X(viewBox 0..128)
  mag?: 'curved' | 'straight' | 'box' | 'drum' | 'tube' | 'twin' | 'none';
  optic?: 'iron' | 'red' | 'scope' | 'long';
  stock?: 'full' | 'skel' | 'none' | 'bull';
}

const SHAPE_SIL: Record<ViewModelShape, SilSpec> = {
  rifle: { arch: 'ar', barrel: 118, mag: 'curved', optic: 'red', stock: 'full' },
  carbine: { arch: 'ar', barrel: 106, mag: 'curved', optic: 'red', stock: 'skel' },
  bullpup: { arch: 'bullpup', barrel: 116, mag: 'curved', optic: 'red', stock: 'full' },
  smg: { arch: 'smg', barrel: 98, mag: 'straight', optic: 'red', stock: 'skel' },
  pdw: { arch: 'smg', barrel: 92, mag: 'straight', optic: 'iron', stock: 'skel' },
  'machine-pistol': { arch: 'smg', barrel: 82, mag: 'straight', optic: 'iron', stock: 'none' },
  dmr: { arch: 'dmr', barrel: 120, mag: 'straight', optic: 'scope', stock: 'full' },
  'sniper-bolt': { arch: 'sniper', barrel: 124, mag: 'straight', optic: 'long', stock: 'full' },
  'dsr-bp': { arch: 'sniper', barrel: 126, mag: 'box', optic: 'long', stock: 'bull' },
  fists: { arch: 'fists' },
  'shotgun-pump': { arch: 'shotgun', barrel: 116, mag: 'tube', optic: 'iron', stock: 'full' },
  'shotgun-auto': { arch: 'shotgun', barrel: 112, mag: 'box', optic: 'iron', stock: 'full' },
  'shotgun-double': { arch: 'shotgun', barrel: 120, mag: 'twin', optic: 'iron', stock: 'full' },
  'lmg-belt': { arch: 'lmg', barrel: 122, mag: 'box', optic: 'red', stock: 'full' },
  'lmg-drum': { arch: 'lmg', barrel: 118, mag: 'drum', optic: 'red', stock: 'full' },
  pistol: { arch: 'pistol' },
  revolver: { arch: 'revolver' },
};

function tracerHex(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}

const rc = (x: number, y: number, w: number, h: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const pg = (pts: string): string => `<polygon points="${pts}"/>`;
const ci = (x: number, y: number, r: number): string => `<circle cx="${x}" cy="${y}" r="${r}"/>`;

// 光学(照準器)を上面へ。iron/red/scope/long で長さと発光レンズが変わる
function silOptic(kind: string | undefined, barrel: number, b: string[], a: string[]): void {
  if (kind === 'red') {
    b.push(rc(44, 10, 15, 6));
    a.push(`<rect x="46" y="11" width="4.5" height="4" fill="__T__"/>`);
  } else if (kind === 'scope') {
    b.push(rc(40, 9, 28, 6), rc(44, 15, 2, 2), rc(60, 15, 2, 2));
    a.push(`<rect x="64" y="9.5" width="3.4" height="5" fill="__T__"/>`);
  } else if (kind === 'long') {
    b.push(rc(34, 7, 42, 6), pg('76,7 82,9 82,11 76,13'), rc(44, 13, 2, 3), rc(64, 13, 2, 3));
    a.push(`<rect x="79.5" y="8.6" width="3" height="4.8" fill="__T__"/>`);
  } else {
    // iron: 前後サイトポスト
    b.push(rc(barrel - 14, 13.5, 2, 4), rc(41, 13, 2, 4));
  }
}

// 弾倉(受け下)。curved/straight/box/drum、tube/twin は銃身系(別処理)
function silMag(kind: string | undefined, b: string[]): void {
  if (kind === 'curved') b.push(pg('53,27 64,27 68,43 57,43'));
  else if (kind === 'straight') b.push(pg('53,27 63,27 64,42 55,42'));
  else if (kind === 'box') b.push(rc(52, 27, 13, 15));
  else if (kind === 'drum') b.push(rc(54, 27, 8, 4), ci(58, 35, 8.5));
}

function silInner(spec: SilSpec, tracer: string): string {
  const b: string[] = [];
  const a: string[] = [];
  const barrel = spec.barrel ?? 116;

  if (spec.arch === 'fists') {
    b.push(
      pg('46,16 70,16 76,20 76,32 70,36 46,36 42,32 42,20'),
      rc(50, 12, 4, 6),
      rc(57, 11, 4, 7),
      rc(64, 12, 4, 6),
      pg('42,24 36,28 40,34 46,32'),
    );
    a.push(`<rect x="70" y="22" width="6" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'pistol') {
    b.push(
      rc(44, 17, 40, 8),
      pg('48,25 62,25 58,42 44,41'),
      rc(60, 15, 3, 2),
      rc(46, 15, 3, 2),
      rc(60, 25, 10, 3),
    );
    a.push(`<rect x="82" y="18.5" width="4" height="4" fill="${tracer}"/>`);
  } else if (spec.arch === 'revolver') {
    b.push(
      rc(48, 17, 22, 9),
      rc(70, 19, 22, 3),
      ci(58, 24, 7.2),
      pg('48,26 60,26 55,42 45,40'),
      pg('46,15 52,14 52,18 46,18'),
    );
    a.push(`<rect x="89" y="19" width="3.5" height="3.4" fill="${tracer}"/>`, `<circle cx="58" cy="24" r="2.4" fill="${tracer}"/>`);
  } else {
    // ── 長物: 受け / 銃身 / ハンドガード / ストック / グリップ / 弾倉 / 光学 ──
    const bull = spec.arch === 'bullpup' || spec.stock === 'bull';
    b.push(bull ? rc(8, 16, 64, 11) : rc(34, 16, 36, 11));
    b.push(rc(64, 17, 10, 9)); // チャンバーブロック
    b.push(rc(72, 18.5, Math.max(4, barrel - 82), 6.5)); // ハンドガード
    b.push(rc(74, 20.2, barrel - 74, 2.6)); // 銃身
    // ストック
    if (!bull) {
      if (spec.stock === 'full') b.push(pg('8,17 22,15 34,16 34,27 8,28'));
      else if (spec.stock === 'skel') b.push(pg('10,16 34,16 34,18.5 16,19 16,24 34,24 34,27 10,27'));
    }
    // グリップ+トリガーガード
    b.push(pg('42,27 51,27 48,41 40,41'), rc(50, 27.5, 11, 3));
    // 弾倉
    if (spec.mag === 'tube') {
      b.push(rc(74, 24.4, barrel - 82, 2.6)); // 銃身下チューブ弾倉(ポンプ/オート散弾)
      b.push(rc(78, 22.6, 12, 2.2)); // ポンプフォアグリップ
    } else if (spec.mag === 'twin') {
      b.push(rc(74, 24.2, barrel - 74, 2.6)); // 二連の下銃身
    } else if (bull) {
      b.push(pg('20,27 31,27 33,42 22,42')); // ブルパップ弾倉(グリップ後方)
    } else {
      silMag(spec.mag, b);
    }
    // 光学
    silOptic(spec.optic, barrel, b, a);
    // 銃口アクセント(+短いマズルフラッシュ)
    a.push(
      `<rect x="${barrel - 5}" y="19.4" width="5" height="3.4" fill="${tracer}"/>`,
      `<polygon points="${barrel},20.4 ${barrel + 4},21.6 ${barrel},22.8" fill="${tracer}" opacity="0.75"/>`,
    );
  }

  const body = b.join('');
  const accent = a.join('').replace(/__T__/g, tracer);
  return `<g fill="currentColor">${body}</g><g>${accent}</g>`;
}

// 武器シルエットSVG(メモ化)。shape 別+tracer色別にキャッシュする。
function weaponSilSVG(shape: ViewModelShape, tracerColor: number): string {
  const key = `${shape}|${tracerColor}`;
  const hit = silCache.get(key);
  if (hit !== undefined) return hit;
  const spec = SHAPE_SIL[shape] ?? SHAPE_SIL.rifle;
  const svg = `<svg class="wsil" viewBox="0 0 128 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${silInner(spec, tracerHex(tracerColor))}</svg>`;
  silCache.set(key, svg);
  return svg;
}

// 兵装カードの派生スタット(横バーの副次表示)。DPS/確殺弾数/実効RPM/TTKを WeaponDef から導出。
function computeDerivedStats(def: WeaponDef): {
  dps: number;
  shotsToKill: number;
  effRpm: number;
  ttk: number;
} {
  const perShot = def.damage * def.pellets;
  const rps = def.rpm / 60;
  const dps = Math.round(perShot * rps);
  const shotsToKill = Math.max(1, Math.ceil(100 / Math.max(1, perShot)));
  const ttk = Math.round(((shotsToKill - 1) * 60000) / Math.max(1, def.rpm));
  return { dps, shotsToKill, effRpm: def.rpm, ttk };
}

export class Menu {
  private selection: MenuSelection = {
    stageId: STAGES[0]?.id ?? 'kunren',
    mode: 'ffa',
    primaryId: 'kaede-ar',
    attachments: [],
    grenade: 'frag',
    difficulty: 'normal',
    secondaryId: 'suzume',
  };
  private weaponPreview: WeaponPreview | null = null; // ARMORYの3Dプレビュー(遅延生成)
  private readonly attachmentBySlot: Record<AttachmentSlot, string | null> = {
    sight: null,
    muzzle: null,
    grip: null,
    mag: null,
  };
  private activePage = 'deploy'; // 現在表示中のMFDページ
  private capturingAction: PadAction | null = null; // リバインド捕捉中のアクション
  private bindNote = ''; // 競合解消などの通知文(リバインド表の下に表示)
  private captureCleanup: (() => void) | null = null; // 捕捉中の keydown リスナ等の後始末
  private bg: SpaceBg | null = null; // メニュー背景の宇宙(ページ連動カメラ)。attachBgで注入
  private wipeTimer = 0; // 画面遷移ワイプのフォールバックタイマ(animationend不発でも畳む)
  private mfdWiped = false; // 初回マウントはワイプ抑止(ベゼル入場と二重演出にしない)

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly profile: Profile,
    private readonly callbacks: MenuCallbacks,
    private readonly input: Input,
  ) {
    this.loadLoadout();
    this.showMain();
  }

  private playerLevel(): number {
    return levelFromXp(this.profile.xp).level;
  }

  // 前回のロードアウトを復元する。存在しないIDは黙って捨てる
  private loadLoadout(): void {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MenuSelection>;
      if (saved.stageId && STAGES.some((s) => s.id === saved.stageId)) {
        this.selection.stageId = saved.stageId;
      }
      if (saved.primaryId && PRIMARY_IDS.includes(saved.primaryId)) {
        this.selection.primaryId = saved.primaryId;
      }
      if (saved.secondaryId && SECONDARY_IDS.includes(saved.secondaryId)) {
        this.selection.secondaryId = saved.secondaryId;
      }
      if (saved.mode && MODE_IDS.includes(saved.mode)) {
        this.selection.mode = saved.mode;
      }
      if (saved.grenade && GRENADE_KINDS.includes(saved.grenade)) {
        this.selection.grenade = saved.grenade;
      }
      if (saved.difficulty && ['easy', 'normal', 'hard'].includes(saved.difficulty)) {
        this.selection.difficulty = saved.difficulty;
      }
      for (const id of saved.attachments ?? []) {
        const def = ATTACHMENT_DEFS[id];
        if (def) this.attachmentBySlot[def.slot] = id;
      }
    } catch {
      // 壊れた保存値は初期値で開く
    }
  }

  private syncAttachments(): void {
    this.selection.attachments = Object.values(this.attachmentBySlot).filter(
      (id): id is string => id !== null,
    );
  }

  private saveLoadout(): void {
    this.syncAttachments();
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.selection));
  }

  // main.ts から宇宙背景を注入する。初回フォーカスを即送出して画角を現在ページへ一致させる
  attachBg(bg: SpaceBg): void {
    this.bg = bg;
    bg.setFocus(this.activePage);
  }

  // 背景の遷移状態(recede/soft/killcam)を一括で解除し、宇宙背景のDoFも戻す。
  // hide()とshowMain()冒頭で呼び、モーダル由来の暗転やワイプがメニューに残らないようにする
  private clearBgTransition(): void {
    document.body.classList.remove('bg-recede', 'bg-soft', 'killcam-active');
    this.bg?.setModalDim(0);
    if (this.wipeTimer !== 0) {
      window.clearTimeout(this.wipeTimer);
      this.wipeTimer = 0;
    }
  }

  hide(): void {
    // メニューを隠す瞬間に必ずリバインド捕捉を畳む。捕捉中のまま試合へ復帰すると
    // 最初のパッド入力がリバインドに食われ、設定が静かに書き換わるのを防ぐ
    this.endCapture();
    this.teardownPreview();
    this.clearBgTransition();
    this.root.hidden = true;
  }

  // ── コントローラだけでのメニュー操作(トップページ含む全画面) ──
  // D-pad/左スティック=フォーカス移動, ×=決定, ○=戻る, L1/R1=MFDタブ切替,
  // セレクト/スライダーに合わせている時は左右で値を増減する。
  handleGamepad(nav: UiNav): void {
    if (this.root.hidden || this.capturingAction) return; // リバインド捕捉中は介入しない
    const list = this.focusables();
    if (list.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    // まだ何も選んでいなければ最初の要素を選ぶだけ(初回の方向入力でハイライト)
    if (idx < 0) {
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm) {
        list[0]?.focus();
        list[0]?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    if (nav.tabPrev || nav.tabNext) {
      this.cycleMfdPage(nav.tabNext ? 1 : -1);
      return;
    }

    // セレクト/スライダーは左右で値を変える(上下はフォーカス移動)
    const cur = list[idx];
    if (cur instanceof HTMLSelectElement && (nav.left || nav.right)) {
      const n = cur.options.length;
      cur.selectedIndex = Math.max(0, Math.min(n - 1, cur.selectedIndex + (nav.right ? 1 : -1)));
      cur.dispatchEvent(new Event('change'));
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range' && (nav.left || nav.right)) {
      const step = Number(cur.step) || 1;
      const v = Number(cur.value) + (nav.right ? step : -step);
      cur.value = String(Math.max(Number(cur.min), Math.min(Number(cur.max), v)));
      cur.dispatchEvent(new Event('input'));
      return;
    }

    if (nav.up || (nav.left && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx - 1);
      return;
    }
    if (nav.down || (nav.right && !(cur instanceof HTMLSelectElement))) {
      this.focusAt(list, idx + 1);
      return;
    }
    if (nav.confirm) {
      const el = list[idx];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.click();
      else el?.click();
      return;
    }
    if (nav.back) this.gamepadBack();
  }

  // 現在の画面で見えている操作可能要素(ボタン/セレクト/入力)
  private focusables(): HTMLElement[] {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input:not([type="hidden"]), [tabindex="0"]',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  private focusAt(list: HTMLElement[], i: number): void {
    const n = list.length;
    const idx = ((i % n) + n) % n;
    const el = list[idx];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  private cycleMfdPage(dir: number): void {
    const tabs = ['campaign', 'deploy', 'armory', 'intel', 'system'];
    const i = tabs.indexOf(this.activePage);
    if (i < 0) return; // メインMFD以外(ポーズ/結果)ではタブ切替しない
    const next = tabs[(i + dir + tabs.length) % tabs.length] ?? 'deploy';
    this.setMfdPage(next);
    this.focusables()[0]?.focus({ preventScroll: true });
  }

  // ○ボタン: 画面ごとの「戻る/再開」相当を押す
  private gamepadBack(): void {
    for (const id of ['brief-back', 'to-campaign', 'menu', 'quit', 'resume', 'retry-mission']) {
      const el = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el && el.offsetParent !== null) {
        el.click();
        return;
      }
    }
  }

  // リバインド捕捉の後始末を一箇所に集約する。Input側のコールバック解除・
  // keydownリスナ除去・捕捉状態クリアを冪等に行う
  private endCapture(): void {
    this.input.cancelCapture();
    if (this.captureCleanup) {
      this.captureCleanup();
      this.captureCleanup = null;
    }
    this.capturingAction = null;
  }

  showMain(): void {
    this.clearBgTransition();
    this.mfdWiped = false; // 再マウント: 最初の setMfdPage はワイプせず即時
    this.teardownPreview();
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-main">
        <div class="console-bezel">
          <i class="bezel-grain" aria-hidden="true"></i>
          <header class="menu-header telemetry-rail">
            <span class="sys-lamps" aria-hidden="true">
              <i data-sys="O2"><b></b>O2</i><i data-sys="PWR"><b></b>PWR</i>
              <i data-sys="NAV"><b></b>NAV</i><i data-sys="LINK"><b></b>LINK</i>
            </span>
            <span class="menu-logo">${LOGO_SVG}</span>
            <div class="wordmark">
              <h1 class="brand-wm" aria-label="FPS-reFlesh Play Style-">
                <span class="wm-kicker" aria-hidden="true">FPS-</span>
                <span class="wm-hero" aria-hidden="true">re<em>F</em>lesh</span>
                <span class="wm-style" aria-hidden="true">Play Style-</span>
              </h1>
              <p class="menu-tagline"><span lang="en">Orbital Dropdeck</span><span lang="ja">軌道降下管制盤</span></p>
            </div>
            <div class="nav-readout" aria-hidden="true">
              <span class="nav-opr">OPR <b>LV.${this.playerLevel()}</b></span><span>ALT <b>408</b>KM</span><span>VEL <b>7.62</b>KM·S⁻¹</span><span class="nav-eta">DROP WINDOW <b>T-00:43</b></span>
            </div>
          </header>
          <p class="menu-touchnote">この作品はキーボードとマウスで操作します。スマートフォンやタブレットでは遊べません。PCで開いてください。</p>
          <section class="deployment-briefing ig-scan" aria-label="出撃構成">
            <div class="briefing-heading">
              <span>Deployment briefing</span>
              <strong>出撃構成</strong>
            </div>
            <dl class="briefing-loadout">
              <div><dt>Stage</dt><dd data-id="brief-stage"></dd></div>
              <div><dt>Mode</dt><dd data-id="brief-mode"></dd></div>
              <div><dt>Primary</dt><dd data-id="brief-weapon"></dd></div>
              <div><dt>Utility</dt><dd data-id="brief-grenade"></dd></div>
              <div><dt>Threat</dt><dd data-id="brief-difficulty"></dd></div>
            </dl>
            <div class="deploy-lever">
              <span class="lever-beacon" aria-hidden="true"></span>
              <button class="menu-start" data-id="start">
                <span>出撃する</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h13m-5-5 5 5-5 5M19 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span class="lever-eta" aria-hidden="true">降下軌道 LOCKED · 1G</span>
            </div>
          </section>
          <div class="console-body">
            <nav class="mfd-rail" role="tablist" aria-label="管制ページ">
              <button class="mfd-tab mfd-tab-campaign" type="button" role="tab" data-page="campaign" id="mfd-tab-campaign" aria-controls="mfd-panel-campaign"><b>★</b><span>CAMPAIGN</span><small>戦役</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="deploy" id="mfd-tab-deploy" aria-controls="mfd-panel-deploy"><b>01</b><span>DEPLOY</span><small>降下管制</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="armory" id="mfd-tab-armory" aria-controls="mfd-panel-armory"><b>02</b><span>ARMORY</span><small>兵装</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="intel" id="mfd-tab-intel" aria-controls="mfd-panel-intel"><b>03</b><span>INTEL</span><small>戦況</small></button>
              <button class="mfd-tab" type="button" role="tab" data-page="system" id="mfd-tab-system" aria-controls="mfd-panel-system"><b>04</b><span>SYSTEM</span><small>系統</small></button>
              <i class="mfd-ink" aria-hidden="true"></i>
            </nav>
            <div class="mfd-deck">
              <section class="mfd-page" data-page="campaign" role="tabpanel" id="mfd-panel-campaign" aria-labelledby="mfd-tab-campaign" hidden>
                <div class="campaign-screen" data-id="campaign"></div>
              </section>
              <section class="mfd-page" data-page="deploy" role="tabpanel" id="mfd-panel-deploy" aria-labelledby="mfd-tab-deploy">
                <div class="mfd-hero ig-scan--live" aria-hidden="true">
                  <div class="hero-limb"></div>
                  <div class="hero-readout"><span>ORBIT <b>412</b>KM</span><span>ATMO <b>1.0</b>G</span><span>LZ <b>SECURE</b></span></div>
                  <div class="hero-grid"></div>
                </div>
                <div class="mfd-cols mfd-cols--deploy">
                  <section class="menu-section">
                    <h2>降下目標</h2>
                    <div class="stage-grid" data-id="stages"></div>
                  </section>
                  <section class="menu-section">
                    <h2>交戦規定</h2>
                    <div class="mode-list" data-id="modes"></div>
                  </section>
                  <section class="menu-section">
                    <h2>脅威レベル</h2>
                    <div class="difficulty-list" data-id="difficulties"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="armory" role="tabpanel" id="mfd-panel-armory" aria-labelledby="mfd-tab-armory" hidden>
                <div class="armory-layout">
                  <div class="armory-list">
                    <section class="menu-section">
                      <h2>メイン武器</h2>
                      <div class="wclass-tabs" data-id="wclass-tabs" role="tablist" aria-label="武器クラス"></div>
                      <div class="weapon-grid" data-id="weapons"></div>
                    </section>
                    <section class="menu-section">
                      <h2>副武器</h2>
                      <div class="weapon-grid weapon-grid--sec" data-id="secondaries"></div>
                    </section>
                    <section class="menu-section">
                      <h2>アタッチメント</h2>
                      <div class="attach-panel" data-id="attachments"></div>
                    </section>
                    <section class="menu-section">
                      <h2>投擲物</h2>
                      <div class="grenade-list" data-id="grenades"></div>
                    </section>
                  </div>
                  <aside class="armory-preview ig-panel ig-scan">
                    <canvas class="weapon-canvas" data-id="weapon-canvas"></canvas>
                    <div class="armory-readout">
                      <div class="armory-wname" data-id="armory-wname"></div>
                      <div class="armory-bars" data-id="armory-bars"></div>
                      <div class="armory-stats" data-id="armory-stats"></div>
                      <p class="armory-hint">ドラッグで回転・武器をクリックで選択</p>
                    </div>
                  </aside>
                </div>
              </section>
              <section class="mfd-page" data-page="intel" role="tabpanel" id="mfd-panel-intel" aria-labelledby="mfd-tab-intel" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>戦績</h2>
                    <div class="menu-profile" data-id="profile"></div>
                  </section>
                  <section class="menu-section">
                    <h2>任務</h2>
                    <div class="challenge-list" data-id="challenges"></div>
                  </section>
                </div>
              </section>
              <section class="mfd-page" data-page="system" role="tabpanel" id="mfd-panel-system" aria-labelledby="mfd-tab-system" hidden>
                <div class="mfd-cols">
                  <section class="menu-section">
                    <h2>設定</h2>
                    <div data-id="settings"></div>
                  </section>
                  <section class="menu-section menu-controls">
                    <h2>操作</h2>
                    <div class="controls-grid" data-id="controls"></div>
                  </section>
                </div>
              </section>
            </div>
          </div>
          <footer class="console-status" aria-hidden="true">
            <span class="status-dot"></span><span>SYS NOMINAL</span><span class="status-fill"></span><span class="status-opr">OPR <b>LV.${this.playerLevel()}</b></span><span class="status-fill"></span><span>reFlesh // tactical sim · BUILD R13</span>
          </footer>
        </div>
      </div>
    `;
    this.renderProfile();
    this.renderChallenges();
    this.renderStages();
    this.renderModes();
    this.renderWeapons();
    this.renderSecondaries();
    this.renderAttachments();
    this.renderGrenades();
    this.renderDifficulties();
    this.renderSettings(this.query('settings'));
    this.renderControls();
    this.renderCampaign();
    this.renderBriefing();
    this.wireMfd();
    this.query('start').addEventListener('click', () => {
      this.saveLoadout();
      this.callbacks.onStart(this.selection);
    });
  }

  // ── キャンペーン(戦役)画面 ────────────────────────────────────
  private renderCampaign(): void {
    const host = this.query('campaign');
    const camp = this.profile.campaign;
    const totalStars = Object.values(camp.missionBests).reduce((s, b) => s + b.stars, 0);
    const cleared = camp.clearedMissions.length;
    host.innerHTML = `
      <div class="campaign-head">
        <div class="campaign-title"><em class="campaign-op">OPERATION <i>//</i> CINDER</em><strong>軌道に灯る火種</strong><span>CINDER 鎮圧作戦</span></div>
        <div class="campaign-stat">制圧 <b>${cleared}</b>/48 ・ ★<b>${totalStars}</b>/144<span class="campaign-bar ig-bar" aria-hidden="true"><i style="transform:scaleX(${(cleared / 48).toFixed(3)})"></i></span></div>
      </div>
      <div class="chapter-list" data-id="chapter-list"></div>
    `;
    const list = host.querySelector<HTMLElement>('[data-id="chapter-list"]');
    if (!list) return;
    for (const chapter of CAMPAIGN) {
      const unlocked = this.profile.campaign.unlockedChapters.includes(chapter.id);
      const chClear = chapter.missions.filter((m) => camp.clearedMissions.includes(m.id)).length;
      const card = document.createElement('div');
      card.className = unlocked ? 'chapter-card' : 'chapter-card locked';
      const head = document.createElement('div');
      head.className = 'chapter-card-head';
      head.innerHTML = `
        <span class="chapter-no">${chapter.title}</span>
        <span class="chapter-sub">${unlocked ? chapter.subtitle : '機密 — 前章の制圧で解放'}</span>
        <span class="chapter-prog"><b>${chClear}</b>/${chapter.missions.length}<span class="chapter-prog-bar" aria-hidden="true"><i style="transform:scaleX(${(chClear / chapter.missions.length).toFixed(3)})"></i></span></span>
      `;
      card.appendChild(head);
      if (unlocked) {
        const grid = document.createElement('div');
        grid.className = 'mission-grid';
        for (const mission of chapter.missions) {
          grid.appendChild(this.missionChip(mission));
        }
        this.stagger(grid); // チップ入場(listitem-in)の--i付与
        card.appendChild(grid);
      }
      list.appendChild(card);
    }
  }

  private missionChip(mission: MissionDef): HTMLElement {
    const camp = this.profile.campaign;
    const unlocked = isMissionUnlocked(this.profile, mission.id);
    const best = camp.missionBests[mission.id];
    const stars = best ? best.stars : 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = unlocked ? 'mission-chip' : 'mission-chip locked';
    btn.disabled = !unlocked;
    const starHtml = unlocked
      ? `<span class="mission-stars"><b>${'★'.repeat(stars)}</b>${'☆'.repeat(3 - stars)}</span>`
      : '<span class="mission-lock">LOCKED</span>';
    btn.innerHTML = `
      <span class="mission-idx">${mission.chapterId.toUpperCase()}-${mission.index + 1}</span>
      <span class="mission-name">${mission.title}</span>
      <span class="mission-sub">${mission.subtitle}</span>
      ${starHtml}
    `;
    if (unlocked) btn.addEventListener('click', () => this.showBriefing(mission));
    return btn;
  }

  // ミッション・ブリーフィング。出撃で onStartMission を呼ぶ
  showBriefing(mission: MissionDef): void {
    this.endCapture(); // 画面差し替え前にリバインド捕捉を畳む(孤立リスナ防止)
    this.teardownPreview();
    // モーダル: 背景を後退させ、宇宙背景をDoFで沈めてブリーフィングを前面へ立てる
    // (menu-briefingは透過のため星野が見える)。showMain/hide が解除する
    document.body.classList.add('bg-recede');
    this.bg?.setModalDim(1);
    this.root.hidden = false;
    const modLabels: Record<string, string> = {
      'one-life': '一機限り',
      'low-gravity': '低重力',
      'no-regen': '自然回復なし',
      'dense-fog': '濃霧',
      'elite-swarm': '精鋭過多',
    };
    const mods = mission.modifiers.map((m) => modLabels[m] ?? m).join(' / ') || 'なし';
    // --i はタイプライター(brief-type)のstagger用。reduce-motion時はCSS側で即着地する
    const briefLines = mission.brief.map((b, i) => `<p style="--i:${i}">${b}</p>`).join('');
    const intel = mission.intel?.length
      ? `<div class="brief-intel"><h3>インテル</h3>${mission.intel.map((i) => `<p>${i}</p>`).join('')}</div>`
      : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-briefing">
        <div class="brief-frame">
          <div class="brief-panel" role="dialog" aria-modal="true" aria-label="ミッションブリーフィング">
            <p class="brief-chapter">${mission.chapterId.toUpperCase()}-${mission.index + 1} // SORTIE ORDER</p>
            <h1>${mission.title}</h1>
            <p class="brief-subtitle">${mission.subtitle}</p>
            <div class="brief-map" aria-hidden="true"></div>
            <div class="brief-body">${briefLines}</div>
            <dl class="brief-meta">
              <div><dt>目的</dt><dd>${mission.objective.label}</dd></div>
              <div><dt>武器</dt><dd><select class="brief-weapon-select" data-id="brief-weapon-select" aria-label="出撃武器の選択"></select></dd></div>
              <div><dt>特殊条件</dt><dd>${mods}</dd></div>
            </dl>
            ${intel}
            <div class="brief-buttons">
              <button class="menu-start" data-id="deploy-mission"><span>出撃する</span></button>
              <button class="menu-quiet" data-id="brief-back">戦役へ戻る</button>
            </div>
          </div>
        </div>
      </div>
    `;
    // 武器は自由選択(既定=支給武器)。解放済みの主武器から選べる
    const weaponSelect = this.query('brief-weapon-select') as HTMLSelectElement;
    const level = this.playerLevel();
    const supplied = document.createElement('option');
    supplied.value = mission.primaryId;
    supplied.textContent = `${WEAPON_DEFS[mission.primaryId]?.name ?? mission.primaryId}(支給)`;
    weaponSelect.appendChild(supplied);
    for (const id of PRIMARY_IDS) {
      if (id === mission.primaryId || !isUnlocked('weapon', id, level)) continue;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = WEAPON_DEFS[id]?.name ?? id;
      weaponSelect.appendChild(opt);
    }
    this.query('deploy-mission').addEventListener('click', () => {
      this.callbacks.onStartMission(mission.id, weaponSelect.value);
    });
    this.query('brief-back').addEventListener('click', () => {
      this.showMain();
      this.setMfdPage('campaign');
    });
    this.query('deploy-mission').focus({ preventScroll: true });
  }

  // ミッション結果。星評価・章解放・次ミッション導線を出す
  showMissionResult(result: MatchResult, progress: CampaignProgress): void {
    this.endCapture();
    this.teardownPreview();
    this.root.hidden = false;
    const mission = missionById(progress.missionId);
    const won = result.won;
    const stars = progress.stars;
    // 星は1個ずつspan分割し--iを付与(star-popの捺印stagger用)。読み上げはrole=imgに集約
    const starHtml = won
      ? `<div class="result-stars" role="img" aria-label="評価 ${stars} / 3">${[0, 1, 2]
          .map(
            (i) =>
              `<span class="${i < stars ? 'on' : 'off'}" style="--i:${i}" aria-hidden="true">${i < stars ? '★' : '☆'}</span>`,
          )
          .join('')}</div>`
      : '';
    const unlockNote = progress.chapterUnlocked
      ? `<p class="result-chapter-unlock">新章解放: ${CAMPAIGN.find((c) => c.id === progress.chapterUnlocked)?.title ?? ''}</p>`
      : '';
    const firstNote = progress.firstClear
      ? '<p class="result-firstclear">初制圧ボーナス +800 XP</p>'
      : '';
    const nextId = mission && won ? nextMissionId(mission.id) : null;
    const nextUnlocked = nextId ? isMissionUnlocked(this.profile, nextId) : false;
    const nextBtn =
      nextId && nextUnlocked
        ? '<button class="menu-start" data-id="next-mission">次のミッション</button>'
        : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-result${won ? ' result-won' : ''}">
        <div class="result-panel" role="dialog" aria-modal="true" aria-label="ミッション結果">
          <p class="result-mode">${mission?.title ?? 'ミッション'}</p>
          <h1 data-en="${won ? 'MISSION COMPLETE' : 'MISSION FAILED'}">${won ? 'ミッション達成' : 'ミッション失敗'}</h1>
          ${starHtml}
          ${unlockNote}
          ${firstNote}
          <p class="result-stats">
            <span class="stat-cell">BEST<b>${Math.floor(progress.missionBest?.bestTimeS ?? 0)}s</b></span>
            <span class="stat-cell">ACC<b>${(result.accuracy * 100).toFixed(1)}%</b></span>
            <span class="stat-cell">HS<b>${result.headshots}</b></span>
          </p>
          ${this.progressHtml(progress)}
          <div class="result-buttons">
            ${nextBtn}
            <button class="menu-quiet" data-id="retry-mission">もう一度</button>
            <button class="menu-quiet" data-id="to-campaign">戦役へ戻る</button>
          </div>
        </div>
      </div>
    `;
    this.countUp(this.query('xptotal'), progress.xpTotal);
    this.staggerXpList();
    if (nextId && nextUnlocked) {
      this.query('next-mission').addEventListener('click', () =>
        this.callbacks.onStartMission(nextId),
      );
    }
    this.query('retry-mission').addEventListener('click', () => this.callbacks.onRestart());
    this.query('to-campaign').addEventListener('click', () => {
      // onQuit経由でmatch破棄+音の後始末(quiesce)を必ず通す(直接showMainだと鳴り残る)
      this.callbacks.onQuit();
      this.setMfdPage('campaign');
    });
    this.query(nextId && nextUnlocked ? 'next-mission' : 'to-campaign').focus({
      preventScroll: true,
    });
  }

  // MFDのタブ切替を結線する。クリック+矢印キー(roving tabindex)でページを行き来する
  private wireMfd(): void {
    const rail = this.root.querySelector<HTMLElement>('.mfd-rail');
    if (!rail) return;
    const tabs = Array.from(rail.querySelectorAll<HTMLButtonElement>('.mfd-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.setMfdPage(tab.dataset.page ?? 'deploy'));
    });
    rail.addEventListener('keydown', (e) => {
      const dir =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (dir === 0) return;
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.dataset.page === this.activePage);
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      if (next) {
        this.setMfdPage(next.dataset.page ?? 'deploy');
        next.focus();
      }
    });
    this.setMfdPage(this.activePage);
  }

  private setMfdPage(page: string): void {
    // 初回マウント(wireMfd末の同一ページ呼び)はワイプ無しで即時。以降はワイプ演出。
    // ワイプは swap を同期実行するためフォーカス/プレビュー/aria の挙動は従来どおり。
    if (!this.mfdWiped) {
      this.mfdWiped = true;
      this.applyMfdPage(page);
      return;
    }
    this.wipe(() => this.applyMfdPage(page));
  }

  // 実際のページ差し替え。ページ連動の宇宙背景フォーカスとMFDインク移動もここで駆動する
  private applyMfdPage(page: string): void {
    this.activePage = page;
    this.root.querySelectorAll<HTMLElement>('.mfd-page').forEach((p) => {
      const on = p.dataset.page === page;
      p.hidden = !on;
      p.classList.toggle('active', on);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.mfd-tab').forEach((t) => {
      const on = t.dataset.page === page;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    // ARMORY表示時のみ3Dプレビューを起動(遅延生成)。他ページでは止める
    if (page === 'armory') this.mountWeaponPreview();
    else this.weaponPreview?.suspend();
    // ページに応じて宇宙背景の画角を寄せ、MFDインクを現在タブへ滑らせる
    this.bg?.setFocus(page);
    this.updateMfdInk();
  }

  // MFDインク(選択タブへ滑るインジケータ)を現在タブの座標へ移す。
  // レイアウト確定後(rAF)に offset 系を読み、縦横どちらの表現にも使えるCSS変数で渡す
  private updateMfdInk(): void {
    const ink = this.root.querySelector<HTMLElement>('.mfd-ink');
    if (!ink) return;
    const page = this.activePage;
    requestAnimationFrame(() => {
      const tab = this.root.querySelector<HTMLElement>(`.mfd-tab[data-page="${page}"]`);
      if (!ink.isConnected || !tab) return;
      ink.style.setProperty('--ink-x', `${tab.offsetLeft}px`);
      ink.style.setProperty('--ink-y', `${tab.offsetTop}px`);
      ink.style.setProperty('--ink-w', `${tab.offsetWidth}px`);
      ink.style.setProperty('--ink-h', `${tab.offsetHeight}px`);
    });
  }

  // 画面遷移ワイプ。swap は同期実行(フォーカス/プレビュー/aria を既存どおり保つ)し、
  // 直後にデッキへ .wipe を一瞬載せて掃引で見せる。省モーションは swap のみで演出なし。
  // animationend 不発(タブ休止/GPU/CSS未適用)でも setTimeout フォールバックで確実に畳む。
  private wipe(swap: () => void): void {
    swap();
    if (this.prefersReducedMotion) return;
    const deck = this.root.querySelector<HTMLElement>('.mfd-deck');
    if (!deck) return;
    if (this.wipeTimer !== 0) window.clearTimeout(this.wipeTimer);
    deck.classList.remove('wipe');
    deck.getBoundingClientRect(); // reflowを強制し .wipe アニメを確実に再発火させる
    deck.classList.add('wipe');
    const clear = (): void => {
      if (this.wipeTimer !== 0) {
        window.clearTimeout(this.wipeTimer);
        this.wipeTimer = 0;
      }
      deck.classList.remove('wipe');
    };
    const onEnd = (e: AnimationEvent): void => {
      if (e.target !== deck) return; // 子ページの入場アニメのバブルは無視
      deck.removeEventListener('animationend', onEnd);
      clear();
    };
    deck.addEventListener('animationend', onEnd);
    // フォールバックは掃引アニメ長(mfd-wipe 0.36s)より確実に長く。短いとanimationend
    // 前に毎回打ち切ってしまい主経路が死ぬ。真の不発時のみ畳む保険にする
    this.wipeTimer = window.setTimeout(() => {
      deck.removeEventListener('animationend', onEnd);
      clear();
    }, 480);
  }

  // ARMORYの3D武器プレビューを必要時に生成・再開する
  private mountWeaponPreview(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-id="weapon-canvas"]');
    if (!canvas) return;
    if (!this.weaponPreview) {
      try {
        this.weaponPreview = new WeaponPreview(canvas);
        this.weaponPreview.setReduceMotion(this.prefersReducedMotion);
      } catch {
        // WebGLが使えない環境ではプレビュー無し(リスト/ステータスは従来通り出る)
        this.weaponPreview = null;
        return;
      }
    }
    this.weaponPreview.start();
    this.weaponPreview.resume();
    this.weaponPreview.resize();
    // 3Dとステータス読み出しを同じ武器へ同期(setWeaponだけだと読み出しが取り残される)
    this.previewWeapon(this.currentPrimaryDef());
  }

  // root.innerHTML を差し替える前に必ず呼ぶ。プレビューのGLコンテキストを確実に破棄する
  private teardownPreview(): void {
    if (this.weaponPreview) {
      this.weaponPreview.dispose();
      this.weaponPreview = null;
    }
  }

  showPause(): void {
    this.teardownPreview();
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="menu-screen menu-pause">
        <div class="pause-panel" role="dialog" aria-modal="true" aria-label="一時停止">
          <h1>一時停止</h1>
          <button class="menu-start" data-id="resume">再開する</button>
          <section class="menu-section">
            <h2>設定</h2>
            <div data-id="settings"></div>
          </section>
          <button class="menu-quiet" data-id="quit">メニューに戻る</button>
        </div>
      </div>
    `;
    this.renderSettings(this.query('settings'));
    this.query('resume').addEventListener('click', () => this.callbacks.onResume());
    this.query('quit').addEventListener('click', () => this.callbacks.onQuit());
    this.query('resume').focus({ preventScroll: true });
  }

  showResult(result: MatchResult, progress: MatchProgress): void {
    this.endCapture();
    this.teardownPreview();
    this.root.hidden = false;
    const mvp = result.rows[0];
    const rowsHtml = result.rows
      .map(
        (row) => `
        <tr class="${row.isPlayer ? 'score-you' : result.teamScores && row.isAlly ? 'score-ally' : ''}">
          <td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td>
        </tr>`,
      )
      .join('');
    const teamScoreHtml = result.teamScores
      ? `<p class="result-teamscore"><span class="ts-mine" data-id="tsmine">0</span> - <span class="ts-enemy" data-id="tsenemy">0</span></p>`
      : '';
    this.root.innerHTML = `
      <div class="menu-screen menu-result${result.won ? ' result-won' : ''}">
        <div class="result-panel" role="dialog" aria-modal="true" aria-label="試合結果">
          <p class="result-mode">${result.modeName}</p>
          <h1 data-en="${result.won ? 'VICTORY' : 'DEFEAT'}">${result.won ? '勝利' : '敗北'}</h1>
          ${teamScoreHtml}
          <p class="result-mvp">MVP: ${mvp ? mvp.name : '-'}</p>
          <p class="result-stats">
            <span class="stat-cell">ACC<b>${(result.accuracy * 100).toFixed(1)}%</b></span>
            <span class="stat-cell">HS<b>${result.headshots}</b></span>
          </p>
          <table class="result-table">
            <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${this.progressHtml(progress)}
          <div class="result-buttons">
            <button class="menu-start" data-id="restart">もう一度</button>
            <button class="menu-quiet" data-id="menu">メニューに戻る</button>
          </div>
        </div>
      </div>
    `;
    this.query('restart').addEventListener('click', () => this.callbacks.onRestart());
    this.query('menu').addEventListener('click', () => this.callbacks.onQuit());
    this.countUp(this.query('xptotal'), progress.xpTotal);
    this.staggerXpList();
    if (result.teamScores) {
      this.countUp(this.query('tsmine'), result.teamScores.mine, 650);
      this.countUp(this.query('tsenemy'), result.teamScores.enemy, 650);
    }
    this.query('restart').focus({ preventScroll: true });
  }

  // リザルト下部の獲得XP・レベル・レート変動の表示
  private progressHtml(progress: MatchProgress): string {
    const xpRows = progress.xpBreakdown
      .map(
        (entry) =>
          `<li><span class="xp-label">${entry.label}</span><span class="xp-value">+${entry.xp}</span></li>`,
      )
      .join('');
    const level = progress.levelAfter;
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const levelUp =
      level.level > progress.levelBefore.level
        ? `<p class="result-levelup">レベルアップ Lv ${progress.levelBefore.level} から Lv ${level.level} へ</p>`
        : '';
    const unlocks = progress.newUnlocks.length
      ? `<ul class="result-unlocks">${progress.newUnlocks
          .map((u) => `<li>${u.kind === 'weapon' ? '武器' : 'アタッチメント'}解放: ${u.name}</li>`)
          .join('')}</ul>`
      : '';
    const delta = progress.ratingAfter - progress.ratingBefore;
    const rankNote =
      progress.rankAfter.name === progress.rankBefore.name
        ? `階級 ${progress.rankAfter.name}`
        : delta > 0
          ? `${progress.rankAfter.name} へ昇格`
          : `${progress.rankAfter.name} へ降格`;
    const rating =
      delta === 0
        ? `<p class="result-rating">レート ${progress.ratingAfter} / ${rankNote}</p>`
        : `<p class="result-rating">レート ${progress.ratingBefore} <span class="${delta > 0 ? 'rating-up' : 'rating-down'}">${delta > 0 ? '+' : ''}${delta}</span> / ${rankNote}</p>`;
    const recordsHtml = progress.newRecords.length
      ? `<p class="result-record">自己ベスト更新 ${progress.newRecords.join(' / ')}</p>`
      : '';
    return `
      <section class="result-progress">
        <ul class="result-xp-list">${xpRows}</ul>
        <p class="result-xp-total">獲得 <span data-id="xptotal">0</span> XP</p>
        <div class="result-levelrow">
          <span class="result-level">Lv ${level.level}</span>
          <span class="profile-xpbar"><i style="width:${xpRatio}%"></i></span>
        </div>
        ${levelUp}
        ${unlocks}
        ${recordsHtml}
        ${rating}
      </section>
    `;
  }

  private query(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!node) throw new Error(`menu element not found: ${id}`);
    return node;
  }

  // prefers-reduced-motionの利用者には演出を飛ばして即値を見せる
  private get prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  // 0から目標値まで数字を駆け上がらせる。画面差し替えで要素が外れたら止める
  private countUp(el: HTMLElement, to: number, durationMs = 750): void {
    if (this.prefersReducedMotion || to <= 0) {
      el.textContent = String(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - start) / durationMs);
      el.textContent = String(Math.round(easeOutCubic(p) * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // 一覧の各行へ入場の段差(--i)を与える。CSS側でanimation-delayに使う
  private stagger(container: HTMLElement): void {
    Array.from(container.children).forEach((child, i) => {
      (child as HTMLElement).style.setProperty('--i', String(i));
    });
  }

  // リザルトのXP内訳行に入場staggerを与える(listitem-inのanimation-delayが--iを参照)
  private staggerXpList(): void {
    const xpList = this.root.querySelector<HTMLElement>('.result-xp-list');
    if (xpList) this.stagger(xpList);
  }

  private renderStages(): void {
    const grid = this.query('stages');
    STAGES.forEach((stage, idx) => {
      const card = document.createElement('button');
      card.className = 'stage-card';
      card.dataset.stage = stage.id;
      const palette = stage.palette;
      card.innerHTML = `
        <span class="stage-preview">${this.stagePreview(stage)}<span class="stage-no" aria-hidden="true">LZ ${String(idx + 1).padStart(2, '0')}</span></span>
        <span class="stage-card-body">
          <span class="stage-swatch" aria-hidden="true">
            <i style="background:${palette.floor}"></i><i style="background:${palette.wall}"></i>
            <i style="background:${palette.obstacle}"></i><i style="background:${palette.accent}"></i>
          </span>
          <span class="stage-name">${stage.name}</span>
          <span class="stage-sub">${stage.subtitle}</span>
          <span class="stage-meta"><span class="stage-seed">SEED ${stage.seed}</span>${stage.size}m 四方 / BOT ${stage.botCount}体 / 障害物 ${stage.obstacleCount}</span>
        </span>
      `;
      card.addEventListener('click', () => {
        this.selection.stageId = stage.id;
        this.markSelected(grid, 'stage', stage.id);
        this.renderBriefing();
      });
      grid.appendChild(card);
    });
    this.stagger(grid);
    this.markSelected(grid, 'stage', this.selection.stageId);
  }

  // 実レイアウト(generateStageのBoxSpec)を等角投影した本物のミニチュア。
  // 外周壁を除外し、奥→手前のpainter順で各箱を上面/右面/左面の3polygonで立体描画する。
  private stagePreview(stage: (typeof STAGES)[number]): string {
    const cached = stageSvgCache.get(stage.id);
    if (cached !== undefined) return cached;
    const palette = stage.palette;
    const half = stage.size / 2;
    const boxes = generateStage(stage).boxes;
    // 外周壁は w または d が size+2 になる。両辺が size 以内の箱だけ=障害物
    const obst = boxes.filter((b) => b.w <= stage.size && b.d <= stage.size);
    obst.sort((a, b) => a.x + a.z - (b.x + b.z));

    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const floorPts = corners
      .map(([u, v]) => {
        const p = projectIso(u, v, 0);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');

    const fid = `g${stage.id.replace(/[^a-z0-9]/gi, '')}`;
    const pp = (pts: Array<{ x: number; y: number }>): string =>
      pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let shadows = '';
    let polys = '';
    let anyGlow = false;
    for (const b of obst) {
      const nx = b.x / half;
      const nz = b.z / half;
      const hw = b.w / 2 / half;
      const hd = b.d / 2 / half;
      const hTop = b.h * ISO.H;
      const t0 = projectIso(nx - hw, nz - hd, hTop);
      const t1 = projectIso(nx + hw, nz - hd, hTop);
      const t2 = projectIso(nx + hw, nz + hd, hTop);
      const t3 = projectIso(nx - hw, nz + hd, hTop);
      const bR = projectIso(nx + hw, nz + hd, 0);
      const bF = projectIso(nx + hw, nz - hd, 0);
      const bL = projectIso(nx - hw, nz + hd, 0);
      const b0 = projectIso(nx - hw, nz - hd, 0);
      const glow = b.emissive ? ` filter="url(#${fid})"` : '';
      if (b.emissive) anyGlow = true;
      // 落ち影: 接地矩形を太陽と逆側(左下)へ高さぶん伸ばした平行四辺形。立体感が跳ねる
      const sdx = 3 + b.h * 1.6;
      const sdy = 1.5 + b.h * 0.8;
      shadows += `<polygon points="${pp([b0, bF, { x: bF.x - sdx, y: bF.y + sdy }, { x: b0.x - sdx, y: b0.y + sdy }])}" fill="#000" opacity="0.16"/>`;
      // 右面(暗め基準) / 左面(さらに暗) / 上面(明るめ)で陰影をつける
      polys +=
        `<polygon points="${pp([t1, t2, bR, bF])}" fill="${b.color}"${glow}/>` +
        `<polygon points="${pp([t2, t3, bL, bR])}" fill="${shadeHex(b.color, -0.22)}"${glow}/>` +
        `<polygon points="${pp([t0, t1, t2, t3])}" fill="${shadeHex(b.color, 0.18)}"${glow}/>`;
    }
    // 空グラデ(天頂→地平で明るく)・太陽グロー・ビネットで「キーアート」感を出す
    const glowFilter = anyGlow
      ? `<filter id="${fid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6"/><feComponentTransfer><feFuncA type="linear" slope="1.6"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      : '';
    const defs =
      `<defs>${glowFilter}` +
      `<linearGradient id="sky${fid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shadeHex(palette.sky, -0.06)}"/><stop offset="1" stop-color="${shadeHex(palette.sky, 0.12)}"/></linearGradient>` +
      `<radialGradient id="vg${fid}" cx="0.5" cy="0.45" r="0.75"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></radialGradient>` +
      `</defs>`;
    const svg =
      `<svg viewBox="0 0 160 92" role="img" aria-label="${stage.name}の戦域プレビュー">` +
      `<title>${stage.name}の戦域</title>${defs}` +
      `<rect width="160" height="92" fill="url(#sky${fid})"/>` +
      `<circle cx="126" cy="12" r="16" fill="${shadeHex(palette.sky, 0.28)}" opacity="0.55"/>` +
      `<circle cx="126" cy="12" r="6" fill="${shadeHex(palette.sky, 0.4)}" opacity="0.85"/>` +
      `<polygon points="${floorPts}" fill="${palette.floor}" opacity="0.92"/>` +
      `${shadows}${polys}` +
      `<rect width="160" height="92" fill="url(#vg${fid})"/></svg>`;

    if (stageSvgCache.size >= 64) {
      const oldest = stageSvgCache.keys().next().value;
      if (oldest !== undefined) stageSvgCache.delete(oldest);
    }
    stageSvgCache.set(stage.id, svg);
    return svg;
  }

  private renderWeapons(): void {
    const list = this.query('weapons');
    const tabsHost = this.query('wclass-tabs');
    list.innerHTML = '';
    tabsHost.innerHTML = '';
    const level = this.playerLevel();
    // 保存されていた選択がロック中(記録の読み込み直後など)なら初期武器へ戻す
    if (!isUnlocked('weapon', this.selection.primaryId, level)) {
      this.selection.primaryId = 'kaede-ar';
    }
    // 武器を持つクラスだけタブ化(空クラスは出さない)
    const classes = CLASS_ORDER.filter((cls) =>
      PRIMARY_IDS.some((id) => WEAPON_DEFS[id]?.class === cls),
    );
    // 全28枚を1グリッドへ入れておき、タブで表示クラスだけ display させる
    // (data-cls=絞り込み用 / data-weapon=選択用。タブには data-weapon を付けない)
    for (const cls of classes) {
      for (const id of PRIMARY_IDS.filter((id) => WEAPON_DEFS[id]?.class === cls)) {
        list.appendChild(this.weaponCard(id, 'primary'));
      }
    }
    this.stagger(list); // 入場アニメ(listitem-in)の--i付与
    for (const cls of classes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'wcls-tab';
      tab.dataset.cls = cls;
      tab.setAttribute('role', 'tab');
      tab.textContent = CLASS_LABELS[cls];
      tab.addEventListener('click', () => this.showWeaponClass(cls));
      tabsHost.appendChild(tab);
    }
    // 既定タブ=選択中の主武器のクラス(初期は数枚のみペイント=28枚一括より軽い)
    const activeCls = WEAPON_DEFS[this.selection.primaryId]?.class ?? classes[0] ?? 'ar';
    this.showWeaponClass(activeCls);
    this.markSelected(list, 'weapon', this.selection.primaryId);
    this.previewWeapon(this.currentPrimaryDef());
  }

  // 表示クラスの切替。該当クラス以外のカードを display:none(.off)にし、タブの選択状態を更新する
  private showWeaponClass(cls: WeaponClass): void {
    const list = this.query('weapons');
    list.querySelectorAll<HTMLElement>('.weapon-card').forEach((card) => {
      card.classList.toggle('off', card.dataset.cls !== cls);
    });
    const tabs = this.query('wclass-tabs');
    tabs.querySelectorAll<HTMLElement>('.wcls-tab').forEach((tab) => {
      const on = tab.dataset.cls === cls;
      tab.classList.toggle('selected', on);
      tab.setAttribute('aria-selected', String(on));
    });
  }

  private renderSecondaries(): void {
    const list = this.query('secondaries');
    list.innerHTML = '';
    const level = this.playerLevel();
    if (!isUnlocked('weapon', this.selection.secondaryId, level))
      this.selection.secondaryId = 'suzume';
    // 副武器はハンドガン1クラスのためタブ無しでグリッド直描画
    for (const id of SECONDARY_IDS) list.appendChild(this.weaponCard(id, 'secondary'));
    this.stagger(list);
    this.markSelected(list, 'weapon2', this.selection.secondaryId);
  }

  // 主/副共通の武器カード。クリックで選択し3Dプレビュー+ステータスを更新する
  private weaponCard(id: string, slot: 'primary' | 'secondary'): HTMLButtonElement {
    const def = WEAPON_DEFS[id] ?? WEAPON_DEFS['kaede-ar']!;
    const level = this.playerLevel();
    const unlocked = isUnlocked('weapon', id, level);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = unlocked ? 'weapon-card' : 'weapon-card locked';
    const key = slot === 'primary' ? 'weapon' : 'weapon2';
    card.dataset[key] = id;
    card.dataset.cls = def.class; // タブ絞り込み用(副武器グリッドでは未使用=無害)
    const mode =
      def.mode === 'auto'
        ? 'フルオート'
        : def.mode === 'burst'
          ? `バースト${def.burstCount}`
          : '単発';
    const lockNote = unlocked
      ? ''
      : `<span class="locked-note">Lv ${unlockLevelOf('weapon', id)} で解放</span>`;
    const shape = def.shape ?? CLASS_SHAPE[def.class] ?? 'rifle';
    card.innerHTML =
      `<span class="weapon-sil" aria-hidden="true">${weaponSilSVG(shape, def.tracerColor)}</span>` +
      `<span class="weapon-name">${def.name}</span>` +
      `<span class="weapon-mode">${mode} / 装弾 ${def.magazineSize}</span>${lockNote}`;
    if (!unlocked) {
      card.disabled = true;
      return card;
    }
    card.addEventListener('click', () => {
      if (slot === 'primary') {
        this.selection.primaryId = id;
        this.markSelected(this.query('weapons'), 'weapon', id);
        this.previewWeapon(this.currentPrimaryDef());
        this.renderBriefing();
      } else {
        this.selection.secondaryId = id;
        this.markSelected(this.query('secondaries'), 'weapon2', id);
        this.previewWeapon(def);
      }
    });
    return card;
  }

  // 選択中の主武器(アタッチメント適用済み)
  private currentPrimaryDef(): WeaponDef {
    const base = WEAPON_DEFS[this.selection.primaryId] ?? WEAPON_DEFS['kaede-ar']!;
    return applyAttachments(base, this.selection.attachments);
  }

  // 3Dプレビューとステータス読み出しを更新する(プレビュー未生成なら読み出しのみ)
  private previewWeapon(def: WeaponDef): void {
    this.weaponPreview?.setWeapon(def);
    this.renderArmoryReadout(def);
  }

  private renderArmoryReadout(def: WeaponDef): void {
    const name = this.root.querySelector<HTMLElement>('[data-id="armory-wname"]');
    const barsEl = this.root.querySelector<HTMLElement>('[data-id="armory-bars"]');
    const statsEl = this.root.querySelector<HTMLElement>('[data-id="armory-stats"]');
    if (!name || !barsEl || !statsEl) return;
    name.textContent = def.name;
    // 主ステータスはBO3語彙の横バー(10分割セグメント点火バー)を維持する
    const bars = computeWeaponBars(def);
    barsEl.innerHTML = BAR_AXES.map(([k, label]) => this.bar(label, bars[k])).join('');
    // 派生スタットは副次表示(DPS / 確殺弾数 / TTK / RPM)
    const d = computeDerivedStats(def);
    statsEl.innerHTML =
      `<span>DPS <b>${d.dps}</b></span><span>確殺 <b>${d.shotsToKill}</b></span>` +
      `<span>TTK <b>${d.ttk}</b><em>ms</em></span><span>RPM <b>${d.effRpm}</b></span>`;
  }

  // 10分割セグメント点火バー(0..10)。左から value 個を点灯。box-shadow glow は使わない。
  private bar(label: string, value: number): string {
    const v = Math.max(0, Math.min(10, Math.round(value)));
    let segs = '';
    for (let i = 0; i < 10; i += 1) segs += i < v ? '<i class="on"></i>' : '<i></i>';
    return (
      `<span class="stat-seg-row"><span class="stat-seg-label">${label}</span>` +
      `<span class="stat-bar--seg">${segs}</span>` +
      `<span class="stat-seg-num">${v}</span></span>`
    );
  }

  private renderProfile(): void {
    const panel = this.query('profile');
    const level = levelFromXp(this.profile.xp);
    const rank = rankFromRating(this.profile.rating);
    const stats = this.profile.stats;
    const winRate = stats.matches > 0 ? ((stats.wins / stats.matches) * 100).toFixed(0) : '-';
    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
    const accuracy =
      stats.shotsFired > 0 ? ((stats.shotsHit / stats.shotsFired) * 100).toFixed(1) : '-';
    const xpRatio = level.toNext > 0 ? (level.intoLevel / level.toNext) * 100 : 100;
    const records = this.profile.records;
    const streakNow =
      records.currentWinStreak >= 2
        ? ` <span class="profile-streak">${records.currentWinStreak}連勝中</span>`
        : '';
    const recordsLine =
      records.mostKills > 0 || records.bestWinStreak > 0
        ? `<div class="profile-records">自己ベスト 最多キル <b>${records.mostKills}</b> / 最長連勝 <b>${records.bestWinStreak}</b>${streakNow}</div>`
        : '';
    panel.innerHTML = `
      <div class="profile-top">
        <span class="profile-rank">${rank.name}</span>
        <span class="profile-rating">レート ${this.profile.rating}</span>
        <span class="profile-level">Lv ${level.level}</span>
      </div>
      <div class="profile-xpbar"><i style="width:${xpRatio}%"></i></div>
      <div class="profile-stats">${stats.matches}戦 / 勝率 ${winRate}% / K/D ${kd} / 命中 ${accuracy}%</div>
      ${recordsLine}
      <div class="profile-actions">
        <button class="profile-btn" data-id="export">記録を書き出す</button>
        <button class="profile-btn" data-id="import">記録を読み込む</button>
      </div>
    `;
    this.query('export').addEventListener('click', () => exportProfile(this.profile));
    this.query('import').addEventListener('click', () => {
      importProfile((imported) => {
        Object.assign(this.profile, imported);
        saveProfile(this.profile);
        this.showMain();
      });
    });
  }

  private renderChallenges(): void {
    const list = this.query('challenges');
    for (const challenge of CHALLENGES) {
      const done = this.profile.completedChallenges.includes(challenge.id);
      const [current, goal] = challenge.progress(this.profile.stats, this.profile.weaponKills);
      const row = document.createElement('div');
      row.className = done ? 'challenge-row challenge-done' : 'challenge-row';
      row.innerHTML = `
        <span class="challenge-name">${challenge.name}</span>
        <span class="challenge-desc">${challenge.desc}</span>
        <span class="challenge-bar"><i style="width:${done ? 100 : (current / goal) * 100}%"></i></span>
        <span class="challenge-xp">${done ? '達成' : `${challenge.xp} XP`}</span>
      `;
      list.appendChild(row);
    }
    this.stagger(list);
  }

  private renderModes(): void {
    const list = this.query('modes');
    for (const id of MODE_IDS) {
      const def = MODE_DEFS[id];
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.dataset.mode = id;
      card.innerHTML = `
        <span class="mode-name">${def.name}</span>
        <span class="mode-desc">${def.desc}</span>
      `;
      card.addEventListener('click', () => {
        this.selection.mode = id;
        this.markSelected(list, 'mode', id);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'mode', this.selection.mode);
  }

  private renderAttachments(): void {
    const panel = this.query('attachments');
    const level = this.playerLevel();
    // R13: 光学の武器適合ゲート。内蔵スコープ機(狙撃/DMR)や拳銃系に倍率光学を出さない
    // (装着すると視覚はネイティブのまま・ズームだけ静かに書き換わる split-brain を防ぐ)。
    const primaryDef = this.currentPrimaryDef();
    const opticFits = (id: string): boolean => {
      const spec = OPTIC_SPECS[id];
      return !spec?.fits || spec.fits(primaryDef);
    };
    for (const { slot, label } of ATTACHMENT_SLOTS) {
      // ロック中/この武器に適合しないアタッチメントが選択に残っていたら外す
      const selected = this.attachmentBySlot[slot];
      if (
        selected &&
        (!isUnlocked('attachment', selected, level) ||
          (slot === 'sight' && !opticFits(selected)))
      ) {
        this.attachmentBySlot[slot] = null;
      }
      const row = document.createElement('div');
      row.className = 'attach-row';
      const name = document.createElement('span');
      name.className = 'attach-slot';
      name.textContent = label;
      row.appendChild(name);

      const buttons = document.createElement('div');
      buttons.className = 'attach-options';
      const choices: Array<{ id: string | null; text: string; title: string }> = [
        { id: null, text: 'なし', title: '' },
        ...attachmentsForSlot(slot)
          .filter((a) => slot !== 'sight' || opticFits(a.id))
          .map((a) => ({
            id: a.id,
            text: a.name,
            title: a.cons === 'なし' ? a.pros : `${a.pros} / ${a.cons}`,
          })),
      ];
      for (const choice of choices) {
        const btn = document.createElement('button');
        btn.className = 'attach-btn';
        btn.textContent = choice.text;
        if (choice.title) btn.title = choice.title;
        btn.dataset.attach = choice.id ?? 'none';
        if (choice.id && !isUnlocked('attachment', choice.id, level)) {
          btn.classList.add('locked');
          btn.disabled = true;
          btn.title = `Lv ${unlockLevelOf('attachment', choice.id)} で解放`;
          buttons.appendChild(btn);
          continue;
        }
        btn.addEventListener('click', () => {
          this.attachmentBySlot[slot] = choice.id;
          this.syncAttachments();
          buttons.querySelectorAll('.attach-btn').forEach((node) => {
            const on = (node as HTMLElement).dataset.attach === (choice.id ?? 'none');
            node.classList.toggle('selected', on);
            node.setAttribute('aria-pressed', String(on));
          });
          // アタッチメント変更を3Dプレビュー/ステータスへ即反映
          this.previewWeapon(this.currentPrimaryDef());
          this.renderBriefing();
        });
        const active = (this.attachmentBySlot[slot] ?? 'none') === (choice.id ?? 'none');
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', String(active));
        buttons.appendChild(btn);
      }
      row.appendChild(buttons);
      panel.appendChild(row);
    }
    this.syncAttachments();
  }

  private renderGrenades(): void {
    const list = this.query('grenades');
    for (const kind of GRENADE_KINDS) {
      const spec = GRENADE_SPECS[kind];
      const card = document.createElement('button');
      card.className = 'grenade-card';
      card.dataset.grenade = kind;
      card.innerHTML = `
        <span class="grenade-name">${spec.name} <span class="grenade-carry">x ${spec.carry}</span></span>
        <span class="grenade-desc">${GRENADE_DESCS[kind]}</span>
      `;
      card.addEventListener('click', () => {
        this.selection.grenade = kind;
        this.markSelected(list, 'grenade', kind);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'grenade', this.selection.grenade);
  }

  private renderDifficulties(): void {
    const list = this.query('difficulties');
    for (const item of DIFFICULTIES) {
      const card = document.createElement('button');
      card.className = 'difficulty-card';
      card.dataset.difficulty = item.id;
      card.innerHTML = `<span class="difficulty-name">${item.label}</span><span class="difficulty-desc">${item.desc}</span>`;
      card.addEventListener('click', () => {
        this.selection.difficulty = item.id;
        this.markSelected(list, 'difficulty', item.id);
        this.renderBriefing();
      });
      list.appendChild(card);
    }
    this.stagger(list);
    this.markSelected(list, 'difficulty', this.selection.difficulty);
  }

  private renderBriefing(): void {
    const stage = STAGES.find((item) => item.id === this.selection.stageId) ?? STAGES[0];
    const mode = MODE_DEFS[this.selection.mode];
    const weapon = WEAPON_DEFS[this.selection.primaryId];
    const grenade = GRENADE_SPECS[this.selection.grenade];
    const difficulty = DIFFICULTIES.find((item) => item.id === this.selection.difficulty);
    this.query('brief-stage').textContent = stage?.name ?? '-';
    this.query('brief-mode').textContent = mode.name;
    this.query('brief-weapon').textContent = weapon?.name ?? '-';
    this.query('brief-grenade').textContent =
      this.selection.attachments.length > 0
        ? `${grenade.name} / Attach ${this.selection.attachments.length}`
        : grenade.name;
    this.query('brief-difficulty').textContent = difficulty?.label ?? '-';
  }

  private markSelected(container: HTMLElement, key: string, value: string): void {
    container.querySelectorAll<HTMLElement>('[data-' + key + ']').forEach((node) => {
      const on = node.dataset[key] === value;
      node.classList.toggle('selected', on);
      // 選択トグルであることと現在の状態を支援技術へ伝える
      node.setAttribute('aria-pressed', String(on));
    });
  }

  private renderControls(): void {
    const grid = this.query('controls');
    for (const [label, keys] of CONTROLS) {
      const action = document.createElement('span');
      action.className = 'control-action';
      action.textContent = label;
      const key = document.createElement('span');
      key.className = 'control-key';
      key.textContent = keys;
      grid.append(action, key);
    }
  }

  private renderSettings(container: HTMLElement): void {
    container.className = 'settings-panel';
    // 画面差し替えで捕捉中だったリバインドは無効化する(コールバック・keydownリスナを残さない)
    this.endCapture();
    container.innerHTML = '';
    // R10: 設定を系統別(F01照準/F02音響/F03表示/F04交戦規定/F05操縦)に分節する。
    // 見出しh3は非focusableなのでゲームパッドのフォーカス巡回順には影響しない
    container.append(
      this.subhead('照準 / AIM', 'F01'),
      this.slider('マウス感度', 0.2, 3, 0.05, this.settings.sensitivity, (v) => {
        this.settings.sensitivity = v;
      }),
      this.slider('ADS感度倍率', 0.3, 1.5, 0.05, this.settings.adsSensMul, (v) => {
        this.settings.adsSensMul = v;
      }),
      this.slider('視野角(FOV)', 60, 110, 1, this.settings.fov, (v) => {
        this.settings.fov = v;
      }),
      this.checkbox('Y軸を反転する', this.settings.invertY, (v) => {
        this.settings.invertY = v;
      }),
      this.checkbox('ADSをトグルにする', this.settings.adsToggle, (v) => {
        this.settings.adsToggle = v;
      }),
      this.checkbox('しゃがみをトグルにする', this.settings.crouchToggle, (v) => {
        this.settings.crouchToggle = v;
      }),
      this.checkbox('エイムアシスト', this.settings.aimAssist, (v) => {
        this.settings.aimAssist = v;
      }),
      this.slider('エイムアシスト強度', 0, 1, 0.05, this.settings.aimAssistStrength, (v) => {
        this.settings.aimAssistStrength = v;
      }),
      this.subhead('音響 / AUDIO', 'F02'),
      this.slider('全体音量', 0, 1, 0.05, this.settings.volMaster, (v) => {
        this.settings.volMaster = v;
      }),
      this.slider('効果音量', 0, 1, 0.05, this.settings.volSfx, (v) => {
        this.settings.volSfx = v;
      }),
      this.slider('UI音量', 0, 1, 0.05, this.settings.volUi, (v) => {
        this.settings.volUi = v;
      }),
      this.slider('アナウンサー音量', 0, 1, 0.05, this.settings.announcerVolume, (v) => {
        this.settings.announcerVolume = v;
      }),
      this.checkbox('戦闘BGM(動的)', this.settings.musicEnabled, (v) => {
        this.settings.musicEnabled = v;
      }),
      this.subhead('表示 / INTERFACE', 'F03'),
      this.slider('UIの大きさ', 0.8, 1.3, 0.05, this.settings.uiScale, (v) => {
        this.settings.uiScale = v;
      }),
      this.select(
        'UIのアクセント',
        UI_ACCENTS.map((a) => ({ value: a.id, label: a.name })),
        this.settings.uiAccent,
        (v) => {
          this.settings.uiAccent = v;
        },
      ),
      this.select(
        '敵味方の配色',
        TEAM_PALETTES.map((p) => ({ value: p.id, label: p.name })),
        this.settings.teamPaletteId,
        (v) => {
          this.settings.teamPaletteId = v;
        },
      ),
      this.select(
        'レティクル形状',
        RETICLE_STYLES.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleStyle,
        (v) => {
          this.settings.reticleStyle = v;
        },
      ),
      this.select(
        'レティクル色',
        RETICLE_COLORS.map((r) => ({ value: r.id, label: r.name })),
        this.settings.reticleColor,
        (v) => {
          this.settings.reticleColor = v;
        },
      ),
      this.checkbox('簡易レーダーを表示', this.settings.radarEnabled, (v) => {
        this.settings.radarEnabled = v;
      }),
      this.slider('画面の揺れ', 0, 1, 0.05, this.settings.screenShake, (v) => {
        this.settings.screenShake = v;
      }),
      this.checkbox('画面の揺れを軽減する', this.settings.reduceMotion, (v) => {
        this.settings.reduceMotion = v;
      }),
      this.subhead('交戦規定 / MATCH', 'F04'),
      this.select(
        '試合時間',
        MATCH_LENGTHS.map((m) => ({ value: String(m.value), label: m.label })),
        String(this.settings.matchLengthS),
        (v) => {
          this.settings.matchLengthS = Number(v);
        },
      ),
    );

    // 画質ティア(再読み込みで完全反映)。レンダラ/ポスト処理は起動時に確定するため注記を添える
    const gfx = this.select(
      '画質',
      GRAPHICS_QUALITIES.map((q) => ({ value: q, label: GRAPHICS_LABELS[q] })),
      this.settings.graphicsQuality,
      (v) => {
        this.settings.graphicsQuality = v as GraphicsQuality;
      },
    );
    const gfxNote = document.createElement('p');
    gfxNote.className = 'setting-note';
    gfxNote.textContent = '※ 画質の変更はページの再読み込みで完全に反映されます';
    container.append(gfx, gfxNote);

    // ゲームパッド設定一式(感度/デッドゾーン/応答カーブ/反転/振動/プリセット/リバインド)
    container.appendChild(this.buildGamepadSettings());

    // 設定を既定へ戻すボタン
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'setting-reset';
    reset.textContent = '設定を既定に戻す';
    reset.addEventListener('click', () => {
      this.endCapture();
      this.bindNote = '';
      Object.assign(this.settings, DEFAULT_SETTINGS);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderSettings(container);
    });
    container.appendChild(reset);
  }

  // ── ゲームパッド設定セクション ────────────────────────────────────
  private buildGamepadSettings(): HTMLElement {
    const sb = SETTING_BOUNDS;
    const b = {
      sensX: sb.gamepadSensX,
      sensY: sb.gamepadSensY,
      deadzone: sb.gamepadDeadzone,
      exp: sb.gamepadResponseExp,
    };
    const section = document.createElement('section');
    section.className = 'gamepad-settings';
    const heading = document.createElement('h3');
    heading.className = 'settings-subhead';
    heading.textContent = '操縦系統 / GAMEPAD';
    heading.dataset.code = 'F05'; // 見出し右端の系統コード(CSSのattr()で描画)
    section.appendChild(heading);
    const intro = document.createElement('p');
    intro.className = 'setting-note';
    intro.textContent =
      'PS4 DualShock などの標準ゲームパッドに対応。既定はBO3標準配置。OPTIONSで一時停止。';
    section.appendChild(intro);

    section.append(
      this.slider('横感度', b.sensX.min, b.sensX.max, 0.1, this.settings.gamepadSensX, (v) => {
        this.settings.gamepadSensX = v;
      }),
      this.slider('縦感度', b.sensY.min, b.sensY.max, 0.1, this.settings.gamepadSensY, (v) => {
        this.settings.gamepadSensY = v;
      }),
      this.slider(
        'デッドゾーン',
        b.deadzone.min,
        b.deadzone.max,
        0.01,
        this.settings.gamepadDeadzone,
        (v) => {
          this.settings.gamepadDeadzone = v;
        },
      ),
      this.slider(
        '応答カーブ指数',
        b.exp.min,
        b.exp.max,
        0.05,
        this.settings.gamepadResponseExp,
        (v) => {
          this.settings.gamepadResponseExp = v;
        },
      ),
      this.select(
        '応答カーブ',
        (Object.keys(CURVE_LABELS) as GamepadResponseCurve[]).map((c) => ({
          value: c,
          label: CURVE_LABELS[c],
        })),
        this.settings.gamepadResponseCurve,
        (v) => {
          this.settings.gamepadResponseCurve = v as GamepadResponseCurve;
        },
      ),
      this.checkbox('Y軸を反転する(パッド)', this.settings.gamepadInvertY, (v) => {
        this.settings.gamepadInvertY = v;
      }),
      this.checkbox('振動(対応環境のみ)', this.settings.gamepadVibration, (v) => {
        this.settings.gamepadVibration = v;
      }),
    );

    // プリセット選択。binding表と相互参照するため手組みする
    const layoutRow = document.createElement('label');
    layoutRow.className = 'setting-row';
    const layoutText = document.createElement('span');
    layoutText.textContent = '配置プリセット';
    const layoutSelect = document.createElement('select');
    for (const layout of GP_LAYOUTS) {
      const opt = document.createElement('option');
      opt.value = layout.id;
      opt.textContent = layout.name;
      layoutSelect.appendChild(opt);
    }
    layoutSelect.value = this.settings.gamepadLayout;
    layoutRow.append(layoutText, layoutSelect);
    section.appendChild(layoutRow);

    const host = document.createElement('div');
    host.className = 'rebind-table';
    section.appendChild(host);

    layoutSelect.addEventListener('change', () => {
      const id = layoutSelect.value as (typeof GP_LAYOUTS)[number]['id'];
      this.settings.gamepadLayout = id;
      // プリセットへ切替: そのプリセットを複製して実バインドへ反映。customは現状維持(複製)
      this.settings.gamepadBindings =
        id === 'custom' ? cloneBindings(this.settings.gamepadBindings) : cloneBindings(PRESETS[id]);
      this.bindNote = '';
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderGamepadBindings(host, layoutSelect);
    });

    this.renderGamepadBindings(host, layoutSelect);
    return section;
  }

  // リバインド表を(再)描画する。各行=アクション名+現在のグリフ+「変更」ボタン
  private renderGamepadBindings(host: HTMLElement, layoutSelect: HTMLSelectElement): void {
    host.innerHTML = '';
    for (const [action, label] of PAD_ACTION_ROWS) {
      const row = document.createElement('div');
      row.className = 'rebind-row';
      const name = document.createElement('span');
      name.className = 'rebind-name';
      name.textContent = label;
      const glyphs = document.createElement('span');
      glyphs.className = 'rebind-glyph';
      const binds = this.settings.gamepadBindings[action];
      glyphs.textContent = binds.length > 0 ? binds.map(glyphFor).join(' / ') : '(なし)';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rebind-btn';
      const capturing = this.capturingAction === action;
      btn.textContent = capturing ? '…ボタンを押す(Escで取消)' : '変更';
      if (capturing) btn.classList.add('capturing');
      btn.addEventListener('click', () => this.startCapture(action, host, layoutSelect));
      row.append(name, glyphs, btn);
      host.appendChild(row);
    }
    if (this.bindNote) {
      const note = document.createElement('p');
      note.className = 'setting-note rebind-note';
      note.textContent = this.bindNote;
      host.appendChild(note);
    }
  }

  // 次に押されたパッドボタンを当該アクションへ割り当てる。プリセット中ならcustomへ移行する
  private startCapture(
    action: PadAction,
    host: HTMLElement,
    layoutSelect: HTMLSelectElement,
  ): void {
    // 別の捕捉が走っていたら確実に畳む(前回の keydown リスナも除去)
    this.endCapture();
    // プリセットは共有オブジェクト。編集前にcustomへ移行して複製する
    if (this.settings.gamepadLayout !== 'custom') {
      this.settings.gamepadLayout = 'custom';
      this.settings.gamepadBindings = cloneBindings(this.settings.gamepadBindings);
      layoutSelect.value = 'custom';
    }
    this.capturingAction = action;
    this.bindNote = '';

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.endCapture();
      this.renderGamepadBindings(host, layoutSelect);
    };
    document.addEventListener('keydown', onKey, true);
    // endCapture から呼ばれる後始末(Input側コールバック解除は endCapture が担う)
    this.captureCleanup = () => document.removeEventListener('keydown', onKey, true);
    this.renderGamepadBindings(host, layoutSelect);

    this.input.captureNextButton((binding) => {
      this.endCapture();
      this.assignBinding(action, binding);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
      this.renderGamepadBindings(host, layoutSelect);
    });
  }

  // 物理ボタンは1アクションに対応させる。重複は他アクションから外し、通知文に残す
  private assignBinding(action: PadAction, binding: GamepadBinding): void {
    const bindings = this.settings.gamepadBindings;
    const moved: string[] = [];
    for (const [other, label] of PAD_ACTION_ROWS) {
      if (other === action) continue;
      if (bindings[other].some((x) => x.index === binding.index)) {
        bindings[other] = bindings[other].filter((x) => x.index !== binding.index);
        moved.push(label);
      }
    }
    bindings[action] = [binding];
    this.bindNote = moved.length
      ? `${glyphFor(binding)} を「${moved.join('、')}」から移動しました`
      : '';
  }

  // SYSTEM設定のグループ見出し。data-codeはCSSのattr()で右端に描く装飾コード
  private subhead(label: string, code: string): HTMLElement {
    const h = document.createElement('h3');
    h.className = 'settings-subhead';
    h.dataset.code = code;
    h.textContent = label;
    return h;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    // カスタムトラックの塗り比率(--fill)。CSS側はlinear-gradientの境界に使う
    const syncFill = (): void => {
      const ratio = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--fill', `${ratio.toFixed(1)}%`);
    };
    syncFill();
    const display = document.createElement('span');
    display.className = 'setting-value';
    display.textContent = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      apply(v);
      display.textContent = String(v);
      syncFill();
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input, display);
    return row;
  }

  // 汎用セレクト。反映タイミングは項目による(配色/試合時間は次の試合開始時、
  // アクセント色やレティクルは即時)
  private select(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    apply: (v: string) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      input.appendChild(node);
    }
    input.value = value;
    input.addEventListener('change', () => {
      apply(input.value);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(text, input);
    return row;
  }

  private checkbox(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting-row setting-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    const text = document.createElement('span');
    text.textContent = label;
    input.addEventListener('change', () => {
      apply(input.checked);
      saveSettings(this.settings);
      this.callbacks.onSettingsChanged();
    });
    row.append(input, text);
    return row;
  }
}
