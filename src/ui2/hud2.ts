import './hud2.css'; // W-ENZA2: 焔座HUDクローム(mock05正典)
import '../ui/rogue.css'; // 輪廻HUD(計器サブシステムは旧CSSペアを温存)
import '../mk3-phase2.css'; // キルカム武器バナー/フォト(同上)
import { RADAR_RANGE_M, RETICLE_COLORS } from '../core/settings';
import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match';
import { MOVE_SPEEDS } from '../game/player';
import { SUPPRESS_BADGE, ALWAYS_BADGE, medalRank, starPoints, type MedalEvent, type MedalId } from '../game/medals';
import type { PowerUpKind } from '../game/zombie-economy';
import type { RadioSpeaker } from '../game/campaign';
import { GG_LADDER } from '../game/modes';

const SVG_NS = 'http://www.w3.org/2000/svg';

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// レティクル色IDをCSS色へ。未知IDはアクセント色に追従
function reticleColorValue(id: string): string {
  return RETICLE_COLORS.find((c) => c.id === id)?.value ?? 'var(--accent)';
}

// ゾンビモード中は同じ実績を何度も再達成するため、目立つバッジ通知(中央カード)が煩わしくなる。
// 再達成(firstUnlock=false)のみ抑止し、左フィード(pushMedalText)の軽量表示は残す。
// 初取得(firstUnlock=true)は非ゾンビと同じフル演出のまま。非ゾンビモード(inZombieMode=false)は常にfalseで既存挙動を変えない。
export function isZombieRepeatBadgeMuted(firstUnlock: boolean, inZombieMode: boolean): boolean {
  return inZombieMode && !firstUnlock;
}

// R53 T6: adsKeepsCrosshair=true の武器(minigun=修羅/fan=風神扇)はADS中も腰だめクロスヘアを
// フル表示のまま維持する(R12由来の消し込み経路=擬似要素レティクル用--ads / 4本バーの
// barOpacityの両方を凍結する)。updateCrosshairから呼ぶ純関数として切り出しテスト容易化。
export function crosshairAdsFade(
  adsProgress: number,
  keepsCrosshair: boolean,
): { adsVar: number; barOpacity: number } {
  if (keepsCrosshair) return { adsVar: 0, barOpacity: 1 };
  return { adsVar: adsProgress, barOpacity: Math.max(0, 1 - adsProgress * 2.5) };
}

// 軽量化監査#8: 1フレームに生成するダメージ数値DOMノードの上限。
// 全滅ウルト等で100体超同時キル→同数のspan+rAF+setTimeoutが同一フレームに積まれ、
// 死亡FXスパイクと重なって重量化するのを防ぐ。超過分は個別ノードを作らず、
// 1個の集約バッジ(「+N KILLS」or「+合計ダメージ」)にまとめる(情報は消さず集約する)。
export const DAMAGE_NUMBER_FRAME_CAP = 24;

export interface DamageNumberOverflow<T> {
  /** 上限を超えて集約された件数 */
  count: number;
  /** 集約対象の合計ダメージ量 */
  totalAmount: number;
  /** 集約対象にキル種別が1件でも含まれるか(バッジ文言の切り替えに使う) */
  hasKill: boolean;
  /** 集約バッジの投影位置に使う代表エントリ(新規Vector3を作らず既存の1件を再利用する) */
  anchor: T;
}

export interface DamageNumberSplit<T> {
  /** 個別ノードとして表示する分(上限まで。上限以下なら元配列そのまま) */
  shown: T[];
  /** 上限を超えた分の集約情報。超過が無ければ null(≤24件時の挙動をビット単位で変えない) */
  overflow: DamageNumberOverflow<T> | null;
}

// 1フレーム分の damageNumbers を「個別表示分」と「集約分」に分割する純関数。
// DOM/THREE非依存でユニットテストしやすい形にしてある(pushDamageNumbers から呼ばれる)。
export function splitDamageNumbersForFrame<T extends { amount: number; kind: string }>(
  list: readonly T[],
  cap: number = DAMAGE_NUMBER_FRAME_CAP,
): DamageNumberSplit<T> {
  // ≤cap は参照をそのまま返す(毎描画フレーム呼ばれるためコピーのアロケーションを避ける。読み取り専用利用)
  if (list.length <= cap) return { shown: list as T[], overflow: null };
  const shown = list.slice(0, cap);
  const rest = list.slice(cap);
  const totalAmount = rest.reduce((sum, dn) => sum + dn.amount, 0);
  const hasKill = rest.some((dn) => dn.kind === 'kill');
  // rest は list.length > cap の分岐にのみ入るため必ず1件以上ある(non-null安全)
  return { shown, overflow: { count: rest.length, totalAmount, hasKill, anchor: rest[0]! } };
}

type Project = (world: THREE.Vector3) => { x: number; y: number; behind: boolean };

// ダメージ数値ノードのクラス名(kind別の色/サイズ段階)。個別ノード・集約ノード両方で共有する
function dmgNumClass(kind: string): string {
  return kind === 'kill'
    ? 'hud-dmg-num hud-dmg-num--kill'
    : kind === 'head'
      ? 'hud-dmg-num hud-dmg-num--head'
      : 'hud-dmg-num';
}

// 正多角形(頂点を真上に向ける)のSVG points文字列。バッジの六角/八角に使う
function ngonPoints(cx: number, cy: number, n: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// バッジ中央のアイコン(階級ごと)。crosshair/chevron/star/bolt
function badgeIcon(tier: MedalEvent['tier']): string {
  if (tier === 'bronze') {
    return '<circle cx="60" cy="60" r="15"/><line x1="60" y1="37" x2="60" y2="83"/><line x1="37" y1="60" x2="83" y2="60"/>';
  }
  if (tier === 'silver') {
    return '<polyline points="44,66 60,52 76,66"/><polyline points="44,80 60,66 76,80"/>';
  }
  if (tier === 'gold') {
    return `<polygon points="${starPoints(60, 60, 5, 17, 7)}" fill="#fff" stroke="none"/>`;
  }
  return '<polyline points="65,36 49,62 60,62 55,84 75,56 64,56 65,36"/>';
}

const DIRECTIONS: Array<[number, string]> = [
  [0, '北'],
  [45, '北東'],
  [90, '東'],
  [135, '南東'],
  [180, '南'],
  [225, '南西'],
  [270, '西'],
  [315, '北西'],
];

const FEED_LIFETIME_MS = 4200;
const PX_PER_DEG = 2.2;
// ハードポイント/KC ミニマップ描画: ゾーン半径(match.tsの ZONE_RADIUS=3.5 と合わせる)
const ZONE_R = 3.5;

// ── R21 マルチキルバナー ──────────────────────────────────────────────────────────────────
// マルチキル系メダルID(これらはバナーへルーティングし、pushMedalText/pushBadgeを出さない)
// 既存8 + チェーン拡張8 = 16件
const MULTI_KILL_IDS: ReadonlySet<MedalId> = new Set<MedalId>([
  'double-kill', 'triple-kill', 'fury-kill', 'frenzy-kill',
  'super-kill', 'mega-kill', 'ultra-kill', 'kill-chain',
  'chain-10', 'chain-12', 'chain-15', 'chain-18',
  'chain-20', 'chain-25', 'chain-30', 'chain-35',
]);

type MkCfg = {
  pips: number;
  color: string;
  slamScale: number; // スラムインの強度(scale 値, 大きいほど強い)
  chromaPx: number;  // クロマ収差のtext-shadowずれ幅(px)
  lifetimeMs: number; // バナー表示時間(ms)
};

// 段ごとの迫力設定: white→blue→orange→red→gold へ段階的に色/強度が上がる
const MK_CFG: Partial<Record<MedalId, MkCfg>> = {
  'double-kill':  { pips: 2, color: '#eef2f6', slamScale: 1.20, chromaPx: 0,   lifetimeMs: 2200 },
  'triple-kill':  { pips: 3, color: '#4ea8ff', slamScale: 1.25, chromaPx: 0.8, lifetimeMs: 2200 },
  'fury-kill':    { pips: 4, color: '#ff9a3c', slamScale: 1.30, chromaPx: 1.4, lifetimeMs: 2400 },
  'frenzy-kill':  { pips: 5, color: '#ff5a3c', slamScale: 1.35, chromaPx: 2.0, lifetimeMs: 2600 },
  'super-kill':   { pips: 6, color: '#ff3a2c', slamScale: 1.38, chromaPx: 2.3, lifetimeMs: 2800 },
  'mega-kill':    { pips: 7, color: '#ffcf4d', slamScale: 1.40, chromaPx: 2.5, lifetimeMs: 3000 },
  'ultra-kill':   { pips: 8, color: '#ffcf4d', slamScale: 1.40, chromaPx: 2.5, lifetimeMs: 3200 },
  'kill-chain':   { pips: 9,  color: '#ffd700', slamScale: 1.40, chromaPx: 3.0, lifetimeMs: 3600 },
  // L: チェーン拡張(chain-10~chain-35 はバナーへ)
  'chain-10': { pips: 10, color: '#ffd700', slamScale: 1.42, chromaPx: 3.0, lifetimeMs: 3800 },
  'chain-12': { pips: 12, color: '#ffd700', slamScale: 1.43, chromaPx: 3.2, lifetimeMs: 4000 },
  'chain-15': { pips: 15, color: '#e0c0ff', slamScale: 1.44, chromaPx: 3.5, lifetimeMs: 4200 },
  'chain-18': { pips: 18, color: '#e0c0ff', slamScale: 1.45, chromaPx: 3.8, lifetimeMs: 4500 },
  'chain-20': { pips: 20, color: '#c0a0ff', slamScale: 1.46, chromaPx: 4.0, lifetimeMs: 4800 },
  'chain-25': { pips: 25, color: '#c0a0ff', slamScale: 1.47, chromaPx: 4.2, lifetimeMs: 5000 },
  'chain-30': { pips: 30, color: '#ff80ff', slamScale: 1.48, chromaPx: 4.5, lifetimeMs: 5200 },
  'chain-35': { pips: 35, color: '#ff80ff', slamScale: 1.48, chromaPx: 4.8, lifetimeMs: 5500 },
};

// 円形HPリングの可視弧長。r=38 の円周(2π·38≈238.76)の 240°/360°=2/3 が見える弧。
// stroke-dasharray '159.17 238.76' と対で使い、offset=ARC*(1-hp比) で満欠を描く。
// (旧HPリング弧長 159.17 はセグメントバー化で撤去 — mock05)

// ══════════════════════════════════════════════════════════════════════════
// R53-W2: match.ts(M2a/M2b)が今後供給する拡張スナップショットフィールド(契約凍結済み)。
// hud.ts は match.ts を編集しないため、ローカルの交差型で先行実装する。全フィールドoptionalで、
// undefined時は各UI要素が自然に非表示(非ゾンビ/非ストーリー/非S&Dで消える)。
// M2a/M2b が MatchSnapshot 本体へ同名・同型で追加した時点でこの交差は無害な重複となり、
// そのまま削除して MatchSnapshot 直接参照に戻せる(型不一致があればここでコンパイルエラーになる)。
// ══════════════════════════════════════════════════════════════════════════
export interface SndSnapshotFields {
  sndPhase?: 'buy' | 'live' | 'planted' | 'roundEnd';
  sndScore?: [number, number]; // [mine, enemy] 先取4
  sndBombTimer?: number;
  sndProgress01?: number;
  sndProgressKind?: 'plant' | 'defuse';
  sndCarrierIsPlayer?: boolean;
}
export type R53W2Snapshot = MatchSnapshot &
  SndSnapshotFields & {
    papTier?: number;
    zombiePowerUps?: ReadonlyArray<{ kind: PowerUpKind; x: number; y: number; z: number }>;
    activePowerUps?: ReadonlyArray<{ kind: PowerUpKind; remainS: number }>;
    specialRound?: 'rush' | null;
    poison01?: number;
    radioLine?: { speaker: RadioSpeaker; text: string } | null;
    detect01?: number;
    bossPhase?: { idx: number; total: number } | null;
  };

// ── PaP(Pack-a-Punch)段数ピップ ─────────────────────────────────────────
// zombie-economy.ts の PapTier(0-3)に合わせて上限3。0/undefinedは非表示。
export function clampPapTier(tier: number | undefined): number {
  if (tier === undefined || !Number.isFinite(tier) || tier <= 0) return 0;
  return Math.min(3, Math.round(tier));
}

// ── パワーアップチップ(5種: insta/double/nuke/maxammo/carpenter) ──────────
interface PowerUpChipSpec {
  label: string;
  color: string;
  icon: string;
}
const PU_ICON_INSTA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M13 2 L5 14 H11 L9 22 L19 9 H13 Z" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const PU_ICON_DOUBLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7 v6 c0 1.6 3.1 3 7 3 s7 -1.4 7 -3 V7"/><path d="M5 13 v6 c0 1.6 3.1 3 7 3 s7 -1.4 7 -3 v-6"/></svg>';
const PU_ICON_NUKE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>';
const PU_ICON_MAXAMMO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="9" y="10" width="6" height="12" rx="1"/><path d="M9 10 L10.5 3 H13.5 L15 10 Z"/></svg>';
const PU_ICON_CARPENTER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="14" width="18" height="4" rx="1"/><path d="M6 14 L6 9 L10 9 L10 14"/><path d="M18 6 L14 10 M15.2 5.4 L18.6 8.8 L20 7.4 L16.6 4 Z" stroke-linecap="round"/></svg>';

export const POWERUP_CHIP_SPECS: Record<PowerUpKind, PowerUpChipSpec> = {
  insta: { label: 'インスタキル', color: '#ff3b2f', icon: PU_ICON_INSTA },
  double: { label: 'ダブルポイント', color: '#ffcf4d', icon: PU_ICON_DOUBLE },
  nuke: { label: 'ニューク', color: '#c8ffb0', icon: PU_ICON_NUKE },
  maxammo: { label: '弾薬満タン', color: '#4ea8ff', icon: PU_ICON_MAXAMMO },
  carpenter: { label: 'カーペンター', color: '#c9915a', icon: PU_ICON_CARPENTER },
};

// 残秒<3sのみ点滅。reduceMotion時はJS側でも常にfalse(CSSアニメ側の@mediaゲートと二重に止める)
export function isPowerUpBlinking(remainS: number, reduceMotion: boolean): boolean {
  return !reduceMotion && remainS > 0 && remainS < 3;
}

// ── 無線字幕: 話者色 ────────────────────────────────────────────────────
// テーマ切替(data-accent)で変動する --ember 本体は使わず、固定hexで話者を一意に保つ。
export const RADIO_SPEAKER_COLORS: Record<RadioSpeaker, string> = {
  kagerou: '#9fb8c9', // steel
  homura: '#19e6ff', // cyan (--medal-cyan と同値)
  hibana: '#ff817b', // ember (--ember-ink と同値。テーマ非連動)
  kurogane: '#b07cff', // violet (--medal-violet と同値)
};
export const RADIO_SPEAKER_NAMES: Record<RadioSpeaker, string> = {
  kagerou: 'カゲロウ',
  homura: 'ホムラ',
  hibana: 'ヒバナ',
  kurogane: 'クロガネ',
};
export function radioSpeakerColor(speaker: RadioSpeaker): string {
  return RADIO_SPEAKER_COLORS[speaker];
}

// ── 潜入検知メーター ────────────────────────────────────────────────────
export type DetectTier = 'calm' | 'wary' | 'alert';
export function detectMeterTier(detect01: number): DetectTier {
  if (detect01 >= 0.9) return 'alert';
  if (detect01 >= 0.5) return 'wary';
  return 'calm';
}
// alert域(≥0.9)のみ点滅。reduceMotion時はJS側でも常にfalse
export function detectMeterBlinking(detect01: number, reduceMotion: boolean): boolean {
  return !reduceMotion && detect01 >= 0.9;
}
// 半円弧(r=18の半周 ≈ 56.55)の可視長。stroke-dashoffset = arc*(1-detect01) で満欠を描く
export const DETECT_ARC_LEN = Math.PI * 18;

// ── ボスフェーズpips ────────────────────────────────────────────────────
export type BossPhasePipState = 'done' | 'active' | 'pending';
// idx=現在フェーズ(1始まり)。1..idx-1=done、idx=active、以降=pending。
// total は DOM 安全上限12でクランプ(ボス設計上あり得ない値が来ても暴走させない)。
export function bossPhasePipStates(idx: number, total: number): BossPhasePipState[] {
  const n = clampN(Math.round(total), 1, 12);
  const cur = clampN(Math.round(idx), 1, n);
  return Array.from({ length: n }, (_, i) => {
    const pos = i + 1;
    if (pos < cur) return 'done';
    if (pos === cur) return 'active';
    return 'pending';
  });
}

// ── S&D HUD ─────────────────────────────────────────────────────────────
export const SND_WIN_TARGET = 4; // 先取4
export function sndPipStates(wins: number, target: number = SND_WIN_TARGET): boolean[] {
  const w = clampN(Math.round(wins), 0, target);
  return Array.from({ length: target }, (_, i) => i < w);
}
export function sndProgressLabel(kind: 'plant' | 'defuse' | undefined): string {
  if (kind === 'plant') return '設置中…';
  if (kind === 'defuse') return '解除中…';
  return '';
}
const SND_PHASE_LABELS: Record<NonNullable<SndSnapshotFields['sndPhase']>, string> = {
  buy: 'BUY',
  live: 'LIVE',
  planted: 'PLANTED',
  roundEnd: 'ROUND END',
};
export function sndPhaseLabel(phase: SndSnapshotFields['sndPhase']): string {
  return phase ? SND_PHASE_LABELS[phase] : '';
}

// ── 特殊ラウンド(餓鬼の大群) ────────────────────────────────────────────
// 'rush' へ遷移した瞬間(前フレーム非rush→今フレームrush)だけ true。バナー一発トリガ用
export function isSpecialRoundEntering(
  prev: 'rush' | null | undefined,
  next: 'rush' | null | undefined,
): boolean {
  return prev !== 'rush' && next === 'rush';
}

// ══════════════════════════════════════════════════════════════════════════
// R53-W3 MK.III「LIVING INSTRUMENT」— Adaptive Presence / モーメント / 帝王プレゼンス
// uiHeat / moments / emperorState は M3(match側)の供給待ちの optional 契約。
// 未供給時は完全に不活性(=非回帰)。emperorState のみ既存フィールドからの導出
// フォールバックを持つため、配線前から帝王枠は機能する。
// ══════════════════════════════════════════════════════════════════════════
export type EmperorState = 'dark' | 'raitei' | 'kokuraitei';
export interface MomentEvent {
  kind: 'round' | 'rankup' | 'perk' | 'emperor' | 'ggrank' | 'special';
  title: string;
  sub?: string;
  tone?: 'ember' | 'ice' | 'violet';
}
export type Mk3Snapshot = R53W2Snapshot & {
  uiHeat?: number; // 0..1(既存combat heatの露出)
  moments?: ReadonlyArray<MomentEvent>; // 1回性イベント(medalsと同じドレイン方式)
  emperorState?: EmperorState | null;
};

// ── P0-1 Adaptive Presence: calmラッチ(ヒステリシス付き状態機械、純関数) ──
// heat<ENTERがDELAY秒継続→calm。heat>EXITで即解除。中間帯は状態維持(タイマー凍結)。
// uiHeat未供給/死亡/HP40%未満は常に非calm(計器全復帰の安全域)。
export const MK3_CALM_ENTER_HEAT = 0.15;
export const MK3_CALM_EXIT_HEAT = 0.3;
export const MK3_CALM_DELAY_S = 2.5;
export interface CalmLatchState {
  calm: boolean;
  quietS: number;
}
export function stepCalmLatch(
  state: CalmLatchState,
  uiHeat: number | undefined,
  hpRatio: number,
  alive: boolean,
  dt: number,
): CalmLatchState {
  if (uiHeat === undefined || !alive || hpRatio < 0.4) return { calm: false, quietS: 0 };
  if (uiHeat > MK3_CALM_EXIT_HEAT) return { calm: false, quietS: 0 };
  if (uiHeat < MK3_CALM_ENTER_HEAT) {
    const quietS = Math.min(state.quietS + dt, MK3_CALM_DELAY_S);
    return { calm: state.calm || quietS >= MK3_CALM_DELAY_S, quietS };
  }
  return state;
}

// ── P0-2 モーメント・システム(1ノード+キュー、純関数ステップ) ──
// suppressed(ADS/キルカム/死亡)中は新規開始のみ止める(表示中の帯は下1/3で照準を
// 塞がないため完走させる — 途中で消すとrankup等を取り逃す)。キュー超過は古い方を
// 残す(時系列保持。rankupの順序が意味を持つため)。
export const MOMENT_QUEUE_MAX = 4;
export const MOMENT_SHOW_S = 2.6;
export const MOMENT_GAP_S = 0.6;
export type MomentTone = 'ember' | 'gold' | 'signal' | 'ice' | 'violet' | 'threat';
export function momentTone(m: MomentEvent): MomentTone {
  if (m.tone === 'ice' || m.tone === 'violet' || m.tone === 'ember') return m.tone;
  switch (m.kind) {
    case 'rankup':
      return 'gold';
    case 'perk':
      return 'signal';
    case 'special':
      return 'threat';
    case 'emperor':
      return 'violet'; // tone未指定の帝王イベントは黒系既定(雷帝はtone:'ice'指定で来る契約)
    default:
      return 'ember'; // round / ggrank
  }
}
export interface MomentQueueState {
  queue: MomentEvent[];
  current: MomentEvent | null;
  phase: 'idle' | 'show' | 'gap';
  t: number;
}
export function emptyMomentQueue(): MomentQueueState {
  return { queue: [], current: null, phase: 'idle', t: 0 };
}
export type MomentChange = 'show' | 'hide' | 'end' | null;
export function stepMomentQueue(
  st: MomentQueueState,
  incoming: ReadonlyArray<MomentEvent> | undefined,
  suppressed: boolean,
  dt: number,
): { state: MomentQueueState; change: MomentChange } {
  const queue = st.queue.slice();
  if (incoming) {
    for (const m of incoming) {
      if (queue.length < MOMENT_QUEUE_MAX) {
        queue.push(m);
      } else if (m.kind === 'emperor' || m.kind === 'rankup') {
        // R54-W1 Q5: 満杯時は高価値(emperor/rankup)イベントを守るため、最古の非高価値枠を
        // 明け渡してから末尾へ追加する(FIFO順序は維持)。全枠が既に高価値なら明け渡さず据え置く
        const idx = queue.findIndex((q) => q.kind !== 'emperor' && q.kind !== 'rankup');
        if (idx >= 0) {
          queue.splice(idx, 1);
          queue.push(m);
        }
      }
    }
  }
  let { current, phase, t } = st;
  let change: MomentChange = null;
  t += dt;
  if (phase === 'show' && t >= MOMENT_SHOW_S) {
    phase = 'gap';
    t = 0;
    current = null;
    change = 'hide';
  } else if (phase === 'gap' && t >= MOMENT_GAP_S) {
    phase = 'idle';
    t = 0;
    change = 'end';
  }
  if (phase === 'idle' && !suppressed && queue.length > 0) {
    current = queue.shift() ?? null;
    phase = 'show';
    t = 0;
    change = 'show'; // 'end'と同フレームの場合は'show'が優先(DOMは再充填で自然に上書き)
  }
  return { state: { queue, current, phase, t }, change };
}

// ── 漢数字ウォーターマーク(1..9999。0以下/非有限は「零」、万超は防御でそのまま) ──
const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const KANJI_UNITS = ['', '十', '百', '千'];
export function toKanjiNumeral(n: number): string {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) return '零';
  if (v >= 10000) return String(v);
  let out = '';
  const s = String(v);
  for (let i = 0; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - 48;
    const unit = s.length - 1 - i;
    if (d === 0) continue;
    out += (d === 1 && unit > 0 ? '' : (KANJI_DIGITS[d] ?? '')) + (KANJI_UNITS[unit] ?? '');
  }
  return out;
}
// kind='round' は数値タイトルを漢数字化、それ以外はタイトル先頭字(空なら「刻」)
export function momentWatermark(m: MomentEvent): string {
  if (m.kind === 'round') {
    const n = Number(m.title);
    if (Number.isFinite(n) && n > 0) return toKanjiNumeral(n);
  }
  return m.title.trim().charAt(0) || '刻';
}

// ── P1-1 帝王プレゼンス: 状態導出(供給があれば優先、なければ既存フィールドから) ──
export function deriveEmperorState(snap: Mk3Snapshot): EmperorState | null {
  if (snap.emperorState !== undefined) return snap.emperorState;
  if (snap.kokuraiteiMode) return 'kokuraitei';
  if ((snap.darkEmperorS ?? 0) > 0) return 'dark';
  if (snap.raiteiMode) return 'raitei';
  return null;
}

// ── チャージ弧(クロスヘア直下90°、r=56。旧hud-charge-gaugeと同一データの新表示) ──
// 帝王状態→UI全転調テーマ属性(:root[data-emperor]、enza-core.css契約: kotei/raitei/kokurai)
export function emperorThemeAttr(state: EmperorState): string {
  return state === 'dark' ? 'kotei' : state === 'raitei' ? 'raitei' : 'kokurai';
}

export const MK3_CHARGE_ARC_LEN = (Math.PI / 2) * 56; // ≈ 87.96
export function chargeArcDashoffset(ratio01: number): number {
  const r = Math.min(1, Math.max(0, ratio01));
  return MK3_CHARGE_ARC_LEN * (1 - r);
}

export class Hud2 {
  private readonly el: Record<string, HTMLElement> = {};
  private compassMarks: Array<{ bearing: number; el: HTMLElement }> = [];
  private lastStreak = 0;
  private lastMoveState = '';
  private lastUltActive = false; // オーバードライブ発動の立ち上がり検出用
  private scopeOn = false; // スコープ表示の立ち上がり検出用
  private wasSteady = false; // 息止め成立の立ち上がり検出用(集中グリント再発火)
  // R55 W-C3 [24]: ガンゲームのランクアップ/セットバック・フラッシュ用タイマーハンドル。
  // 連続発火時に個別ハンドルで管理し、他イベントのタイマーに巻き込まれて早期消灯しないようにする
  private ggFlashTimerId = 0;
  private ggSetbackTimerId = 0;
  private badgeSeq = 0; // バッジSVGの一意ID用カウンタ(gradient/filterのid衝突回避)
  private readonly badgeQueue: MedalEvent[] = []; // ALWAYS_BADGE複数同時→500ms間隔キュー
  private badgeQueueTimer = 0;
  private lastHpOff = ''; // HPリングの stroke-dashoffset 直近書込み値(無変化フレームの書込み抑止)
  private lastPipMag = -1; // 弾ピップの生成済み本数(=装弾数)。変化時のみ作り直す
  private lastPipAmmo = -1; // 弾ピップの点灯本数(=残弾)。変化時のみ点灯を更新
  private lastZombiePerks: string = '';
  // ── R21 マルチキルバナー ──
  private mkBannerMs = 0;   // Date.now() at last multi-kill banner show(upgrade window 判定用)
  private mkTimerId = 0;    // setTimeout handle(自動消去・中断再設定用)
  // R55 W-C6 [9]: キルコンファーム CONFIRMED/DENIED バナー(単一要素使い回し)の消去タイマー。
  // mkTimerId と同じ流儀で個別ハンドル管理し、連続発火時の早期消灯/状態漏れを防ぐ
  private kcEventTimerId = 0;
  private kcEventOutTimerId = 0;
  // ── BO2 ミニマップ ──
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapStageSize = 60;
  private minimapBoxes: Array<{ x: number; z: number; w: number; d: number; handle?: number }> = [];
  // ── ファイナルキルカム: body 直下の独立オーバーレイ(hud.hide() の影響を受けない) ──
  private readonly fkcRoot: HTMLElement;
  private readonly fkcFlashEl: HTMLElement;
  private readonly fkcWeaponEl: HTMLElement; // R54-F7: シネマ帯下部の「武器名 — 距離m」バナー
  // ── R53-W2: PaP pips / パワーアップ / 特殊ラウンド / 無線字幕 / 検知 / ボスpips / S&D ──
  private lastPapTier = -1; // PaPピップの生成済み段数(変化時のみ作り直す)
  private lastPowerUpKey = ''; // アクティブなkind集合のキー(変化時のみDOM再構築)
  private readonly powerUpEls = new Map<PowerUpKind, { root: HTMLElement; timeEl: HTMLElement }>();
  private lastSpecialRound: 'rush' | null | undefined; // 前フレームのspecialRound(rush突入エッジ検出用)
  private lastRadioLine: string | null = null; // 話者+本文のキー(変化検出、null=非表示)
  private lastBossPhaseTotal = -1; // ボスフェーズpipsの生成済み総数(変化時のみ作り直す)
  private lastSndPipTarget = -1; // S&D先取ピップの生成済み本数(変化時のみ作り直す)
  // ── R53-W3 MK.III: Adaptive Presence / モーメント / 帝王プレゼンス / チャージ弧 ──
  private mk3Calm: CalmLatchState = { calm: false, quietS: 0 };
  private mk3CalmApplied = false; // data-calm の直近書込み状態(変化フレームのみdataset書換)
  private mk3PrevT: number | null = null; // hud.updateはdtを受け取らないため実時間で刻む
  private mk3Moments: MomentQueueState = emptyMomentQueue();
  private mk3CountUpTarget: number | null = null; // 数値タイトルのカウントアップ対象(表示前半0.5s)
  private mk3EmperorApplied = ''; // 帝王枠 data-state の直近値(変化時のみ書換)
  private mk3ArcVisible = false;
  private mk3LastArcOffset = ''; // チャージ弧 dashoffset の直近書込み(無変化スキップ)

  constructor(private readonly root: HTMLElement) {
    root.classList.add('u2-hud');
    root.innerHTML = `
      <!-- ════ 焔座HUD(mock05正典) クローム層 ════ -->
      <!-- 上中央: コンパス帯(万線目盛+漢字方位)+針+度数 -->
      <div class="u2h-compass-wrap" aria-hidden="true">
        <div class="u2h-compass"><div class="u2h-compass-strip" data-id="compass"></div></div>
        <i class="u2h-compass-needle"></i>
        <span class="u2h-hdg"><span data-id="hdg">000</span>°</span>
      </div>
      <!-- 上中央下: モードプレート(味方|モード名+残時間|敵)。
           R55 W-C2: 先取ラベル(u2h-mp-target)は u2h-modeplate の clip-path 描画対象に
           含まれると top:calc(100%+4px) の位置が丸ごと切り抜かれ不可視になるため、
           clip-pathの掛からないwrapの直下(modeplateの兄弟)へ退避する -->
      <div class="u2h-modeplate-wrap">
        <div class="u2h-modeplate">
          <div class="u2h-teamscore" data-id="teamscore">
            <span class="u2h-mp-cell u2h-mp-mine"><i class="u2h-dia u2h-dia--mine"></i><span data-id="scoremine">0</span></span>
            <span class="u2h-mp-cell u2h-mp-enemy"><span data-id="scoreenemy">0</span><i class="u2h-dia u2h-dia--enemy"></i></span>
          </div>
          <div class="u2h-mp-mid"><span class="u2h-mp-mode" data-id="modename">フリーフォーオール</span><strong class="u2h-mp-timer" data-id="timer">5:00</strong></div>
        </div>
        <span class="u2h-mp-target" data-id="scoretarget"></span>
      </div>
      <div class="u2h-announce" data-id="announce"></div>
      <!-- 左上: ミニマップ+主目標カード+戦績行 -->
      <div class="u2h-topleft">
        <div class="u2h-mmframe">
          <canvas class="u2h-minimap" data-id="minimap" width="236" height="236" aria-hidden="true"></canvas>
          <span class="u2h-mm-size" data-id="mmsize"></span>
          <span class="u2h-mm-uav" data-id="mmuav" hidden>UAV稼働</span>
        </div>
        <div class="u2h-objcard">
          <div class="u2h-obj-head"><span class="u2h-obj-kicker">主目標</span></div>
          <div class="u2h-mission" data-id="mission" hidden>
            <div class="u2h-obj-text" data-id="obj-text"></div>
            <div class="u2h-obj-bar"><i data-id="obj-bar"></i></div>
            <div class="u2h-obj-wave" data-id="obj-wave"></div>
          </div>
          <div class="u2h-zones" data-id="zones" hidden></div>
          ${'<!-- boss/detect/snd/training: 計器サブシステム(旧様式ペア温存) -->'}
        </div>
        <div class="u2h-kdrow">
          <span class="u2h-kd"><b data-id="kills">0</b><small>撃破</small></span>
          <span class="u2h-kd"><b data-id="deaths">0</b><small>戦死</small></span>
          <span class="u2h-streakchip" data-id="streak" hidden></span>
        </div>
        <div class="hud-boss" data-id="boss" hidden>
            <div class="hud-boss-name" data-id="boss-name">BOSS</div>
            <div class="hud-boss-bar"><i data-id="boss-bar"></i></div>
            <!-- R53-W2: ボスフェーズ菱形pips(bossPhase定義時のみ表示) -->
            <div class="w2-boss-phases" data-id="bossphases" hidden aria-hidden="true"></div>
          </div>
        <!-- R53-W2: 潜入検知メーター(detect01定義時のみ表示。目アイコン+半円弧ゲージ) -->
          <div class="w2-detect" data-id="detect" hidden aria-hidden="true">
            <svg class="w2-detect-eye" viewBox="0 0 24 14" aria-hidden="true">
              <path d="M1 7 C5 1 19 1 23 7 C19 13 5 13 1 7 Z"></path>
              <circle cx="12" cy="7" r="2.6"></circle>
            </svg>
            <svg class="w2-detect-arc" viewBox="-20 -20 40 22" aria-hidden="true">
              <path class="w2-detect-arc-track" d="M -18 0 A 18 18 0 0 1 18 0"></path>
              <path class="w2-detect-arc-fill" data-id="detectarc" d="M -18 0 A 18 18 0 0 1 18 0"></path>
            </svg>
          </div>
        <div class="w2-snd" data-id="snd" hidden>
            <div class="w2-snd-pips">
              <div class="w2-snd-pip-row w2-snd-pip-row--mine" data-id="sndpipsmine"></div>
              <div class="w2-snd-phase" data-id="sndphase"></div>
              <div class="w2-snd-pip-row w2-snd-pip-row--enemy" data-id="sndpipsenemy"></div>
            </div>
            <div class="w2-snd-bomb" data-id="sndbomb" hidden><span data-id="sndbombtime">0.0</span></div>
            <div class="w2-snd-progress" data-id="sndprogress" hidden>
              <div class="w2-snd-progress-label" data-id="sndprogresslabel"></div>
              <div class="w2-snd-progress-bar"><i data-id="sndprogressfill"></i></div>
            </div>
            <div class="w2-snd-carrier" data-id="sndcarrier" hidden>爆弾所持中</div>
          </div>
        <div class="hud-training" data-id="training" hidden>
            <div class="hud-training-row"><small>DPS</small><strong data-id="tr-dps">0.0</strong></div>
            <div class="hud-training-row"><small>命中率</small><strong data-id="tr-acc">0%</strong></div>
            <div class="hud-training-row"><small>HS率</small><strong data-id="tr-hs">0%</strong></div>
            <div class="hud-training-row"><small>連続HIT</small><strong data-id="tr-streak">0</strong></div>
          </div>
      </div>
      <!-- ゾンビ: ラウンド大数字+実績(左中) -->
      <div class="u2h-zround" data-id="zombie" hidden>
        <span class="u2h-zround-big" data-id="zround">1</span>
        <span class="u2h-zround-col">
          <span class="u2h-zround-line"><span data-id="zkills">0</span> 撃破</span>
          <span class="u2h-zround-line u2h-zround-pts"><span data-id="zpoints">0</span> pt</span>
          <span class="u2h-rogue-badge" data-id="rogue-badge" hidden>輪廻 <b data-id="rogue-cards-n">0</b> 供物</span>
        </span>
        <span class="w2-powerups" data-id="powerups" aria-hidden="true"></span>
      </div>
      <!-- R54-F5 輪廻: 供物の3-4択パネル(roguePickPending中のみ)。操作は台座へのE(照準UI) -->
          <div class="hud-rogue-pick" data-id="rogue-pick" hidden aria-hidden="true">
            <div class="rogue-pick-title">供物を選べ <span class="rogue-pick-remain"><b data-id="rogue-remain">30</b>s</span></div>
            <div class="rogue-options" data-id="rogue-options"></div>
            <div class="rogue-pick-hint">台座に近づいて <b>E</b> で受領 — 時間切れで見送り</div>
          </div>
      <!-- 右上: キルフィード -->
      <div class="u2h-feed" data-id="feed"></div>
      <!-- 状態バッジ(超鬼畜/帝王顕現バナー/チャージ・スピンゲージ) -->
      <div class="u2h-statebar" aria-hidden="true">
        <div class="hud-hell" data-id="hell" hidden>
          <span class="hud-hell-badge">超鬼畜</span>
        </div>
        <div class="hud-dark-emperor" data-id="darkemperor" hidden>
          <span class="hud-de-badge">黒帝</span>
          <span class="hud-de-timer" data-id="detimer">5:00</span>
        </div>
        <div class="hud-raitei" data-id="raitei" hidden>
          <span class="hud-raitei-badge">雷帝</span>
        </div>
        <div class="hud-kokuraitei" data-id="kokuraitei" hidden>
          <span class="hud-kokuraitei-badge">黒雷帝</span>
        </div>
        <div class="hud-charge-gauge" data-id="chargegauge" hidden>
          <div class="hud-charge-fill" data-id="chargefill"></div>
        </div>
        <div class="hud-spin-gauge" data-id="spingauge" hidden>
          <div class="hud-spin-fill" data-id="spinfill"></div>
        </div>
      </div>
      <div class="hud-crosshair" data-id="crosshair">
        <span class="ch-dot"></span>
        <span class="ch-bar ch-t" data-id="cht"></span>
        <span class="ch-bar ch-b" data-id="chb"></span>
        <span class="ch-bar ch-l" data-id="chl"></span>
        <span class="ch-bar ch-r" data-id="chr"></span>
      </div>
      <!-- R53-W3 MK.III: チャージ弧(クロスヘア直下90°。旧hud-charge-gauge棒と同一データの新表示。
           照準補助の一部として聖域内に置くが r=56px の細線のみ=クロスヘアを塞がない) -->
      <div class="mk3-charge-arc" data-id="mk3arc" hidden aria-hidden="true">
        <svg viewBox="-64 -64 128 128" aria-hidden="true">
          <path class="mk3-arc-track" d="M -39.6 39.6 A 56 56 0 0 0 39.6 39.6"></path>
          <path class="mk3-arc-fill" data-id="mk3arcfill" d="M -39.6 39.6 A 56 56 0 0 0 39.6 39.6"></path>
        </svg>
      </div>
      <!-- R53-W3 MK.III: モーメント帯(下1/3、1ノード+キュー。ラウンド/超越昇格/パーク/帝王/GGの統一演出。
           無線字幕(bottom:24%)と非衝突の bottom:31%。ADS/キルカム中は新規開始をサプレス) -->
      <div class="mk3-moment" data-id="mk3moment" hidden data-tone="ember">
        <span class="mk3-moment-mark" data-id="mk3momentmark" aria-hidden="true"></span>
        <div class="mk3-moment-title" data-id="mk3momenttitle"></div>
        <div class="mk3-moment-sub" data-id="mk3momentsub" hidden></div>
      </div>
      <div class="hud-scope" data-id="scope" hidden>
        <div class="sc-back"></div>
        <div class="sc-mask"></div>
        <div class="sc-frame">
          <div class="sc-glass"><i class="sc-grid"></i></div>
          <svg class="sc-frame-svg" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <circle class="sc-ring" r="95"></circle>
            <circle class="sc-chroma sc-c" r="95"></circle>
            <circle class="sc-chroma sc-m" r="95"></circle>
            <g class="sc-brackets">
              <polyline points="-40,-26 -40,-40 -26,-40"></polyline>
              <polyline points="40,-26 40,-40 26,-40"></polyline>
              <polyline points="-40,26 -40,40 -26,40"></polyline>
              <polyline points="40,26 40,40 26,40"></polyline>
            </g>
            <g class="sc-cardinals">
              <line x1="0" y1="-95" x2="0" y2="-88"></line>
              <line x1="0" y1="95" x2="0" y2="88"></line>
              <line x1="-95" y1="0" x2="-88" y2="0"></line>
              <line x1="95" y1="0" x2="88" y2="0"></line>
            </g>
          </svg>
          <div class="sc-glint" data-id="scopeglint"></div>
          <div class="sc-readout"><span data-id="scoperange">0</span><i>M</i> · <span data-id="scopezoom">3.1</span><i>X</i></div>
          <div class="sc-breath"><i data-id="scopebreath"></i></div>
        </div>
        <svg class="sc-cross" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <g id="sc-marks">
              <line x1="-92" y1="0" x2="-2.5" y2="0"></line>
              <line x1="2.5" y1="0" x2="92" y2="0"></line>
              <line x1="0" y1="-92" x2="0" y2="-2.5"></line>
              <line x1="0" y1="2.5" x2="0" y2="92"></line>
              <line x1="-3" y1="20" x2="3" y2="20"></line>
              <line x1="-5" y1="34" x2="5" y2="34"></line>
              <line x1="-7" y1="48" x2="7" y2="48"></line>
            </g>
          </defs>
          <!-- R13: レティクルは data-reticle で厳密に1種のみ可視。既存ミルドット十字を rk-mildot に内包 -->
          <g class="rk rk-mildot">
            <circle class="sc-refring-halo" r="60"></circle>
            <circle class="sc-refring" r="60"></circle>
            <use href="#sc-marks" class="sc-halo"></use>
            <use href="#sc-marks" class="sc-core"></use>
            <circle class="sc-dot-halo" r="1.6"></circle>
            <circle class="sc-dot" r="0.7"></circle>
          </g>
          <!-- ACOG: 中央シェブロン(▲)+下方スタジア線 -->
          <g class="rk rk-chevron">
            <path class="sc-halo" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <path class="sc-core" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <line class="sc-core" x1="0" y1="22" x2="0" y2="30"></line>
            <line class="sc-core" x1="0" y1="40" x2="0" y2="46"></line>
          </g>
          <!-- ハイブリッド: 外リング+中央ドット(CQB) -->
          <g class="rk rk-circle-dot">
            <circle class="sc-refring-halo" r="34" fill="none"></circle>
            <circle class="sc-refring" r="34" fill="none"></circle>
            <line class="sc-core" x1="-46" y1="0" x2="-40" y2="0"></line>
            <line class="sc-core" x1="46" y1="0" x2="40" y2="0"></line>
            <line class="sc-core" x1="0" y1="-46" x2="0" y2="-40"></line>
            <line class="sc-core" x1="0" y1="46" x2="0" y2="40"></line>
            <circle class="sc-dot-halo" r="1.8"></circle>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- サーマル: 琥珀十字+アパーチャ(色はCSSの data-reticle='thermal' で暖色化) -->
          <g class="rk rk-thermal">
            <line class="sc-halo" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-halo" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-halo" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-halo" x1="0" y1="6" x2="0" y2="30"></line>
            <line class="sc-core" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-core" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-core" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-core" x1="0" y1="6" x2="0" y2="30"></line>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- DSR精密レティクル: BO2 DSR-50風極細十字(native スナイパー専用) -->
          <g class="rk rk-dsr">
            <!-- メイン十字アーム(ハロー/薄影) -->
            <line class="sc-dsr-halo" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-halo" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-halo" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-halo" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- メイン十字アーム(白0.85) -->
            <line class="sc-dsr-line" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-line" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-line" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-line" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- ミル目盛り 水平左: マイナー(±10,30,50,70)・メジャー(±20,40,60) -->
            <line class="sc-dsr-tick" x1="-10" y1="-1.5" x2="-10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-20" y1="-3" x2="-20" y2="3"></line>
            <line class="sc-dsr-tick" x1="-30" y1="-1.5" x2="-30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-40" y1="-3" x2="-40" y2="3"></line>
            <line class="sc-dsr-tick" x1="-50" y1="-1.5" x2="-50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-60" y1="-3" x2="-60" y2="3"></line>
            <line class="sc-dsr-tick" x1="-70" y1="-1.5" x2="-70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-80" y1="-2" x2="-80" y2="2"></line>
            <!-- ミル目盛り 水平右(左の鏡) -->
            <line class="sc-dsr-tick" x1="10" y1="-1.5" x2="10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="20" y1="-3" x2="20" y2="3"></line>
            <line class="sc-dsr-tick" x1="30" y1="-1.5" x2="30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="40" y1="-3" x2="40" y2="3"></line>
            <line class="sc-dsr-tick" x1="50" y1="-1.5" x2="50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="60" y1="-3" x2="60" y2="3"></line>
            <line class="sc-dsr-tick" x1="70" y1="-1.5" x2="70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="80" y1="-2" x2="80" y2="2"></line>
            <!-- ホールドオーバーマーク(垂直下方・距離推定) -->
            <line class="sc-dsr-hold" x1="-4" y1="20" x2="4" y2="20"></line>
            <line class="sc-dsr-hold" x1="-6" y1="34" x2="6" y2="34"></line>
            <line class="sc-dsr-hold" x1="-8" y1="48" x2="8" y2="48"></line>
            <!-- 中央アンバー照準点(ハロー+コア) -->
            <circle class="sc-dsr-center-halo" r="2"></circle>
            <circle class="sc-dsr-center" r="1"></circle>
          </g>
          <circle class="sc-lock" r="5"></circle>
        </svg>
      </div>
      <div class="hud-hitmarker" data-id="hitmarker"><span></span><span></span><span></span><span></span><span class="hm-diamond"></span></div>
      <div class="hud-reload" data-id="reload" hidden>
        <div class="hud-reload-bar"><div data-id="reloadfill"></div></div>
        <span>リロード中</span>
      </div>
      <div class="hud-cook" data-id="cook" hidden>
        <div class="hud-cook-bar"><div data-id="cookfill"></div></div>
      </div>
      <!-- 左下: 生命(数値+セグメントバー) -->
      <div class="u2h-vitals">
        <div class="u2h-vitals-zrow" data-id="zpointsplate" hidden>
          <span class="u2h-zpp-num" data-id="zpointsbig">0</span><span class="u2h-zpp-label">ポイント</span>
        </div>
        <div class="u2h-vitals-num">
          <span class="u2h-hp" data-id="hp">100</span>
          <span class="u2h-hp-label">生命</span>
          <small class="u2h-hpmax" data-id="hpmax">/ 100</small>
        </div>
        <div class="u2h-hpbar"><i class="u2h-hpbar-fill" data-id="hpbarfill"></i><i class="u2h-hpbar-segs"></i></div>
      </div>
      <div class="hud-zperks u2h-zperks" data-id="zperks" hidden></div>
      <!-- 右下: 兵装カード -->
      <div class="u2h-weapon">
        <div class="u2h-w-title">
          <span class="u2h-w-kicker" data-id="weaponslot">主武装</span>
          <strong class="u2h-w-name" data-id="weapon"></strong>
          <span class="w2-pap-pips" data-id="pappips" aria-hidden="true"></span>
        </div>
        <div class="u2h-w-plate">
          <div class="u2h-w-modecell">
            <span class="u2h-w-pips" data-id="ammopips" aria-hidden="true"></span>
            <span class="u2h-w-mode" data-id="mode"></span>
          </div>
          <div class="u2h-w-ammocell">
            <span class="u2h-ammo" data-id="ammo">30</span>
            <span class="u2h-reserve" data-id="reserve">/ ∞</span>
          </div>
        </div>
        <div class="u2h-w-underrow">
          <span class="u2h-grenade"><i class="u2h-dia u2h-dia--util"></i><b data-id="gname"></b><span class="u2h-gcount" data-id="gcount"></span></span>
          <span class="u2h-ult" data-id="ult">
            <svg viewBox="0 0 26 26" aria-hidden="true">
              <circle class="u2h-ult-track" r="10.5" cx="13" cy="13"></circle>
              <circle class="u2h-ult-fill" data-id="ultring" r="10.5" cx="13" cy="13" stroke-dasharray="65.97" stroke-dashoffset="65.97" transform="rotate(-90 13 13)"></circle>
              <rect class="u2h-ult-dia" x="10.5" y="10.5" width="5" height="5"></rect>
            </svg>
            <span class="u2h-ult-txt"><b data-id="ultlabel">ULT</b><small data-id="ultpct">0%</small></span>
          </span>
        </div>
      </div>
      <!-- 対戦: ストリークチップ(下中央左) -->
      <div class="u2h-streaks" aria-hidden="true">
        <div class="u2h-ss-next" data-id="bo2ssnext"></div>
        <div class="u2h-ss-cauav" data-id="bo2cauav" hidden>COUNTER UAV <span data-id="bo2cauavt">30</span>s</div>
        ${[0,1,2,3,4,5,6].map((i) => `
        <div class="u2h-ss-slot" data-id="bo2slot${i}">
          <span class="u2h-ss-key">${3+i}</span>
          <span class="u2h-ss-icon" data-id="bo2icon${i}"></span>
          <span class="u2h-ss-name" data-id="bo2name${i}"></span>
        </div>`).join('')}
      </div>
      <div class="hud-rcxd-overlay" data-id="rcxdoverlay" hidden>
        <div class="hud-rcxd-label">RC-XD</div>
        <div class="hud-rcxd-hint">[LClick] 起爆 · [RClick/ESC] キャンセル</div>
        <div class="hud-rcxd-timer"><span data-id="rcxdtimer">30</span>s</div>
      </div>
      <div class="hud-radar" data-id="radar" hidden>
        <div class="radar-sweep"></div>
        <svg class="radar-svg" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="radar-ring" r="46"></circle>
          <circle class="radar-ring radar-ring-inner" r="23"></circle>
          <line class="radar-ax" x1="0" y1="-46" x2="0" y2="46"></line>
          <line class="radar-ax" x1="-46" y1="0" x2="46" y2="0"></line>
          <g data-id="radarblips"></g>
          <path class="radar-self" d="M0,-5 L4,4 L0,1.5 L-4,4 Z"></path>
        </svg>
      </div>
      <!-- ハードポイント方向インジケータ: プレイヤーヨー基準の矢印+状態チップ+カウントダウ��� -->
      <div class="hud-hp-indicator" data-id="hpindicator" hidden>
        <div class="hud-hp-arrow-wrap" data-id="hparrowwrap">
          <svg class="hud-hp-arrow-svg" viewBox="-12 -12 24 24" aria-hidden="true">
            <polygon class="hud-hp-arrow-shape" points="0,-10 6,6 0,2 -6,6" data-id="hparrowshape"/>
          </svg>
        </div>
        <div class="hud-hp-chip" data-id="hpchip">HP</div>
        <div class="hud-hp-time" data-id="hptime">60</div>
      </div>
      <!-- キルコンファーム演出バナー(CONFIRMED / DENIED) -->
      <div class="hud-kc-event" data-id="kcevent" hidden></div>
      <div class="hud-dmg-layer" data-id="dmg"></div>
      <div class="hud-incoming" data-id="incoming"></div>
      <div class="u2h-scorepops" data-id="xpribbon" aria-live="polite" aria-atomic="false"></div>
      <div class="hud-vignette" data-id="vignette"></div>
      <!-- R53-W2: 毒霧ビネット(poison01定義時のみ。既存の被弾ビネットとは別要素/別色で重畳しても破綻しない) -->
      <div class="w2-poison-vignette" data-id="poisonvign"></div>
      <div class="hud-flash" data-id="flash"></div>
      <div class="hud-ultflash" data-id="ultflash"></div>
      <div class="hud-whiteout" data-id="whiteout"></div>
      <!-- R53-W3 MK.III: 帝王プレゼンス枠(1px内枠グロー+四隅ノッチ。box-shadow insetのみ=
           backdrop-filter不使用/GPU安価。emperorState(なければ既存フィールド導出)で常灯) -->
      <div class="u2h-emp-frame" data-id="mk3emperor" hidden aria-hidden="true">
        <i class="u2h-ef-vign"></i><i class="u2h-ef-veil"></i><i class="u2h-ef-ring"></i>
        <b class="u2h-ef-c u2h-ef-tl"></b><b class="u2h-ef-c u2h-ef-tr"></b><b class="u2h-ef-c u2h-ef-bl"></b><b class="u2h-ef-c u2h-ef-br"></b>
        <span class="u2h-ef-wm" aria-hidden="true"></span>
      </div>
      <div class="hud-speedlines" data-id="speedlines"></div>
      <div class="hud-move" data-id="move" hidden>
        <span class="hud-move-state" data-id="movestate"></span>
        <div class="hud-move-bar"><div data-id="speedfill"></div></div>
      </div>
      <div class="hud-banner" data-id="banner"></div>
      <!-- R21 マルチキルバナー: 画面中央上寄り。single要素再利用・スカルピップ計数器付き -->
      <div class="hud-multikill-banner" data-id="mkbanner" hidden>
        <div class="mk-inner">
          <div class="mk-label" data-id="mklabel"></div>
          <div class="mk-pips" data-id="mkpips" aria-hidden="true"></div>
        </div>
      </div>
      <!-- R53-W2: 特殊ラウンド(餓鬼の大群)突入バナー。specialRound==='rush'突入の瞬間だけ一発表示 -->
      <div class="w2-special-banner" data-id="specialbanner" hidden>
        <div class="w2-special-banner-label">餓鬼の大群</div>
      </div>
      <!-- R53-W2: 無線字幕(radioLine非null時。クロスヘア聖域外・キルフィードと非衝突の下部) -->
      <div class="w2-radio" data-id="radio" hidden>
        <span class="w2-radio-speaker" data-id="radiospeaker"></span>
        <span class="w2-radio-text" data-id="radiotext"></span>
      </div>
      <div class="hud-medal-stack" data-id="medalstack"></div>
      <div class="hud-badge-stack" data-id="badgestack"></div>
      <div class="u2h-zbuy" data-id="zbuy" hidden></div>
      <!-- ガンゲーム: 右上にランク + 武器名 + トップ3リーダーボード -->
      <div class="hud-gg" data-id="gg" hidden>
        <div class="hud-gg-rank" data-id="ggrank">1/${GG_LADDER.length}</div>
        <div class="hud-gg-weapon" data-id="ggweapon"></div>
        <div class="hud-gg-top3" data-id="ggtop3"></div>
      </div>
      <div class="hud-death" data-id="death" hidden>
        <div class="hud-death-title">戦死</div>
        <div class="hud-death-sub">リスポーンまで <span data-id="respawn">0.0</span> 秒</div>
      </div>
      <!-- R11 キルカメラ・シネマ: #hud直下(生存時は.hud-death暗幕の外)。
           opacity と body.killcam-active のみで駆動。fixed inset:0 がビューポート解決 -->
      <div class="kc-veil" data-id="kcveil" aria-hidden="true"></div>
      <div class="kc-flash" data-id="kcflash" aria-hidden="true"></div>
      <div class="kc-vign" data-id="kcvign" aria-hidden="true"></div>
      <div class="kc-bars" aria-hidden="true"><i class="kc-bar kc-bar-t"></i><i class="kc-bar kc-bar-b"></i></div>
      <div class="kc-card" data-id="kccard" aria-hidden="true">
        <div class="kc-banner">KILLED BY</div>
        <div class="kc-name" data-id="kcname"></div>
        <div class="kc-weapon" data-id="kcweapon"></div>
        <div class="kc-dist"><span data-id="kcdist">0</span><i>M</i></div>
        <div class="kc-timer"><i data-id="kctimer"></i></div>
      </div>
      <div class="hud-scoreboard" data-id="scoreboard" hidden>
        <header><span data-id="scoremode"></span><strong data-id="scoregoal"></strong></header>
        <table>
          <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
          <tbody data-id="scorerows"></tbody>
        </table>
      </div>
      <div class="hud-zrevive-flash" data-id="zreviveflash"></div>
      <div class="hud-zboss-flash" data-id="zbossflash"></div>
    `;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((node) => {
      this.el[node.dataset.id ?? ''] = node;
    });
    this.buildCompass();
    this.buildScope();
    this.buildRadar();
    // スコープの暗い周辺マスクが上のスコア/キルフィードを暗く沈めないよう、
    // スコープを最前(=描画最背面)へ移し、他のHUDがマスクの上に描かれるようにする
    const scopeEl = this.el['scope'];
    if (scopeEl) this.root.insertBefore(scopeEl, this.root.firstChild);

    // ── ファイナルキルカム オーバーレイ: body 直下へ追加(hud.hide() に影響されない) ──
    this.fkcRoot = document.createElement('div');
    this.fkcRoot.className = 'hud-fkc';
    this.fkcRoot.setAttribute('aria-hidden', 'true');
    this.fkcRoot.innerHTML = `
      <div class="hud-fkc-flash"></div>
      <div class="hud-fkc-bar hud-fkc-bar-t"></div>
      <div class="hud-fkc-bar hud-fkc-bar-b"></div>
      <div class="hud-fkc-banner">
        <span class="hud-fkc-hairline"></span>
        <span class="hud-fkc-label"><span class="hud-fkc-scan"></span>FINAL KILLCAM</span>
        <span class="hud-fkc-hairline"></span>
      </div>
      <div class="hud-fkc-skip">SKIP : SPACE / Ⓐ</div>
      <div class="p2-fkc-weapon" hidden></div>
    `;
    document.body.appendChild(this.fkcRoot);
    this.fkcFlashEl = this.fkcRoot.querySelector('.hud-fkc-flash') as HTMLElement;
    this.fkcWeaponEl = this.fkcRoot.querySelector('.p2-fkc-weapon') as HTMLElement;
  }

  /**
   * ミニマップを一度だけセットアップする(試合開始時に main.ts から呼ぶ)。
   * ステージのボックスデータを保持し、毎フレーム drawMinimap() で直接描画する。
   */
  setupMinimap(
    boxes: ReadonlyArray<{ x: number; z: number; w: number; d: number }>,
    stageSize: number,
  ): void {
    this.minimapStageSize = stageSize;
    this.minimapBoxes = Array.from(boxes);
    const sizeEl = this.el['mmsize'];
    if (sizeEl) sizeEl.textContent = `${Math.round(stageSize)}m四方`;
    // minimap canvas の 2D コンテキストを取得(ボックスは毎フレーム直接描画するためoffscreenは不要)
    const canvas = this.el['minimap'] as HTMLCanvasElement | undefined;
    if (canvas) {
      this.minimapCtx = canvas.getContext('2d');
    }
  }

  // スコープのミルティックを #sc-marks に追加する。<use>が2回参照するので
  // ハロー(暗縁)とコア(白)の両方へ自動的に描かれる
  private buildScope(): void {
    const marks = this.root.querySelector('#sc-marks');
    if (!marks) return;
    const TICKS: ReadonlyArray<[number, number]> = [
      [16, 2.4],
      [32, 1.8],
      [48, 1.2],
    ];
    const line = (x1: number, y1: number, x2: number, y2: number): void => {
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(x1));
      el.setAttribute('y1', String(y1));
      el.setAttribute('x2', String(x2));
      el.setAttribute('y2', String(y2));
      marks.appendChild(el);
    };
    for (const [r, h] of TICKS) {
      line(r, -h, r, h); // 右腕
      line(-r, -h, -r, h); // 左腕
      line(-h, r, h, r); // 下腕
      line(-h, -r, h, -r); // 上腕
    }
  }

  private buildCompass(): void {
    const strip = this.el['compass'];
    if (!strip) return;
    this.compassMarks = DIRECTIONS.map(([bearing, label]) => {
      const mark = document.createElement('span');
      mark.className = bearing % 90 === 0 ? 'u2h-cm-major' : 'u2h-cm-minor';
      mark.textContent = label;
      strip.appendChild(mark);
      return { bearing, el: mark };
    });
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    // 帝王転調テーマの解除(三重保証その2)
    delete document.documentElement.dataset.emperor;
  }

  reset(): void {
    const feed = this.el['feed'];
    if (feed) feed.innerHTML = '';
    const dmg = this.el['dmg'];
    if (dmg) dmg.innerHTML = '';
    this.lastStreak = 0;
    this.lastMoveState = '';
    this.lastUltActive = false;
    this.scopeOn = false;
    this.wasSteady = false;
    this.lastZombiePerks = '';
    // ガンゲームのランクアップ/セットバック・フラッシュタイマーも前試合から持ち越さない
    if (this.ggFlashTimerId) { window.clearTimeout(this.ggFlashTimerId); this.ggFlashTimerId = 0; }
    if (this.ggSetbackTimerId) { window.clearTimeout(this.ggSetbackTimerId); this.ggSetbackTimerId = 0; }
    // ★W4C C-1: MK.III状態の完全リセット。前試合の終了間際に発行されたモーメント
    // (キュー上限4件)が次試合の開幕へ流出するのを根治する
    this.mk3Moments = emptyMomentQueue();
    this.mk3Calm = { calm: false, quietS: 0 };
    this.mk3CalmApplied = false;
    delete this.root.dataset.calm;
    this.mk3PrevT = null;
    this.mk3CountUpTarget = null;
    this.mk3EmperorApplied = '';
    this.mk3ArcVisible = false;
    const mk3moment = this.el['mk3moment'];
    if (mk3moment) {
      mk3moment.hidden = true;
      mk3moment.classList.remove('mk3-show', 'mk3-leave');
    }
    const mk3emperor = this.el['mk3emperor'];
    if (mk3emperor) mk3emperor.hidden = true;
    const mk3arc = this.el['mk3arc'];
    if (mk3arc) mk3arc.hidden = true;
    const zperks = this.el['zperks'];
    if (zperks) { zperks.innerHTML = ''; zperks.hidden = true; }
    const zbuy = this.el['zbuy'];
    if (zbuy) { zbuy.hidden = true; zbuy.textContent = ''; }
    const deEl = this.el['darkemperor'];
    if (deEl) deEl.hidden = true;
    const raiteiEl = this.el['raitei'];
    if (raiteiEl) raiteiEl.hidden = true;
    const kokuraiteiEl = this.el['kokuraitei'];
    if (kokuraiteiEl) kokuraiteiEl.hidden = true;
    const chargeEl = this.el['chargegauge'];
    if (chargeEl) chargeEl.hidden = true;
    const spinEl = this.el['spingauge'];
    if (spinEl) spinEl.hidden = true;
    // R21 マルチキルバナーのリセット(前試合の残表示・タイマーを完全クリア)
    if (this.mkTimerId) { window.clearTimeout(this.mkTimerId); this.mkTimerId = 0; }
    this.mkBannerMs = 0;
    const mkbanner = this.el['mkbanner'];
    if (mkbanner) {
      mkbanner.hidden = true;
      mkbanner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
    }
    // R55 W-C6 [9]: キルコンファームバナーのリセット(前試合の残表示・タイマーを完全クリア)
    if (this.kcEventTimerId) { window.clearTimeout(this.kcEventTimerId); this.kcEventTimerId = 0; }
    if (this.kcEventOutTimerId) { window.clearTimeout(this.kcEventOutTimerId); this.kcEventOutTimerId = 0; }
    const kcEventEl = this.el['kcevent'];
    if (kcEventEl) {
      kcEventEl.hidden = true;
      kcEventEl.classList.remove('kc-show', 'kc-out');
    }
    // R11 キルカメラ状態の完全クリア(試合開始/離脱で黒幕やビネットを残さない)
    document.body.classList.remove('killcam-active');
    // ファイナルキルカム オーバーレイもクリア
    this.fkcRoot.classList.remove('fkc-active');
    for (const id of ['kcveil', 'kcflash'] as const) {
      const n = this.el[id];
      if (n) n.style.opacity = '0';
    }
    const vign = this.el['kcvign'];
    if (vign) vign.classList.remove('final');
    // R30: スコアイベントはXPリボン(右下)へ一本化。試合ごとに残留行をクリア
    const ribbon = this.el['xpribbon'];
    if (ribbon) ribbon.innerHTML = '';
    const badges = this.el['badgestack'];
    if (badges) badges.innerHTML = '';
    const medalStack = this.el['medalstack'];
    if (medalStack) medalStack.innerHTML = '';
    // バッジキューリセット
    this.badgeQueue.length = 0;
    if (this.badgeQueueTimer) { window.clearInterval(this.badgeQueueTimer); this.badgeQueueTimer = 0; }
    // ミニマップ: 試合ごとにクリア(前試合のキャッシュを持ち越さない)
    if (this.minimapCtx) {
      const c = this.el['minimap'] as HTMLCanvasElement | undefined;
      this.minimapCtx.clearRect(0, 0, c?.width ?? 236, c?.height ?? 236);
    }
    // 帝王転調テーマの解除(三重保証: reset/hide/状態消滅)
    delete document.documentElement.dataset.emperor;
    // ── R53-W2: 新規状態の完全クリア(前試合の残表示・キャッシュキーを持ち越さない) ──
    this.lastPapTier = -1;
    const pappips = this.el['pappips'];
    if (pappips) pappips.innerHTML = '';
    this.lastPowerUpKey = '';
    this.powerUpEls.clear();
    const powerups = this.el['powerups'];
    if (powerups) powerups.innerHTML = '';
    this.lastSpecialRound = undefined;
    const specialbanner = this.el['specialbanner'];
    if (specialbanner) {
      specialbanner.hidden = true;
      specialbanner.classList.remove('w2-show', 'w2-out');
    }
    const zroundEl = this.el['zround'];
    if (zroundEl) zroundEl.classList.remove('w2-round-special', 'w2-round-pulse');
    this.lastRadioLine = null;
    const radio = this.el['radio'];
    if (radio) radio.hidden = true;
    const detect = this.el['detect'];
    if (detect) detect.hidden = true;
    this.lastBossPhaseTotal = -1;
    const bossphases = this.el['bossphases'];
    if (bossphases) { bossphases.innerHTML = ''; bossphases.hidden = true; }
    this.lastSndPipTarget = -1;
    const snd = this.el['snd'];
    if (snd) snd.hidden = true;
  }

  update(
    snap: MatchSnapshot,
    width: number,
    height: number,
    project: Project,
    showScoreboard: boolean,
  ): void {
    this.text('kills', String(snap.kills));
    this.text('deaths', String(snap.deaths));
    this.text('modename', snap.modeName);

    const streak = this.el['streak'];
    if (streak) {
      streak.hidden = snap.streak < 2;
      streak.textContent = `連続キル ${snap.streak}`;
    }

    // R16: ゾンビモードはタイマー/チームスコアを隠し、ラウンド/キル/ポイントを表示する
    const zombie = this.el['zombie'];
    const inZombie = snap.zombieRound !== undefined;
    if (zombie) zombie.hidden = !inZombie;
    // 焔座クロームのモード出し分け(CSSが参照: modeplate/streaks/金経済プレート)
    if (inZombie) this.root.dataset.zombie = '';
    else delete this.root.dataset.zombie;
    if (inZombie) {
      this.setTeamscoreHidden(true);
    }

    // 訓練場: タイマー/チームスコア/ミニマップを隠し、計測HUDを表示する
    const inTraining = snap.trainingStats !== undefined;
    const trainingEl = this.el['training'];
    if (trainingEl) trainingEl.hidden = !inTraining;
    if (inTraining) this.root.dataset.training = '';
    else delete this.root.dataset.training;
    if (inTraining && snap.trainingStats) {
      const ts = snap.trainingStats;
      this.text('tr-dps', ts.dps.toFixed(1));
      this.text('tr-acc', `${Math.round(ts.accuracy * 100)}%`);
      this.text('tr-hs', `${Math.round(ts.hsRate * 100)}%`);
      this.text('tr-streak', String(ts.streak));
      this.setTeamscoreHidden(true);
    }

    // ミニマップ: ゾンビ/訓練場モードでは非表示にしてK/Dパネルとの重なりを解消する。
    // 非表示時、CSS側の .u2h-mmframe:has(> canvas[hidden]) がフレームごと畳む(主目標カードが上に詰まる)。
    const minimapEl = this.el['minimap'];
    if (minimapEl) minimapEl.hidden = inZombie || inTraining;
    const timerEl = this.el['timer'];
    if (timerEl && timerEl.parentElement) {
      (timerEl.parentElement as HTMLElement).style.display = (inZombie || inTraining) ? 'none' : '';
    }
    const zplate = this.el['zpointsplate'];
    if (zplate) zplate.hidden = !inZombie;
    if (inZombie) {
      this.text('zround', String(snap.zombieRound ?? 1));
      this.text('zkills', String(snap.zombieKills ?? 0));
      const pts = (snap.zombiePoints ?? 0).toLocaleString('en-US');
      this.text('zpoints', pts);
      this.text('zpointsbig', pts);
    } else if (!inTraining) {
      const minutes = Math.floor(snap.timeLeft / 60);
      const seconds = Math.floor(snap.timeLeft % 60);
      this.text('timer', `${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    this.updateRogue(inZombie ? snap.rogue : undefined);
    this.updateCompass(snap.yaw, width);
    this.updateCrosshair(snap, height);
    this.updateScope(snap, width, height);
    this.updateAmmo(snap);
    this.updateGrenade(snap);
    this.updateObjective(snap);
    this.updateHp(snap);
    this.pushFeed(snap);
    this.pushHits(snap);
    this.pushDamageNumbers(snap, project);
    this.pushXpRibbon(snap);
    this.pushMedals(snap);
    this.updateRadar(snap);
    this.pushIncoming(snap);
    this.updateDeath(snap);
    this.updateMovement(snap);
    this.updateBanner(snap);
    this.updateUlt(snap);
    this.updateBO2Streaks(snap);
    this.updateZombieShopHud(snap);
    this.pushZombiePointFloats(snap, project);
    this.updateZombieReviveFlash(snap);
    this.updateZombieBossFlash(snap);
    this.updateDarkEmperorHud(snap);
    this.updateRaiteiHud(snap);
    this.updateKokuraiteiHud(snap);
    const hellEl = this.el['hell'];
    if (hellEl) hellEl.hidden = !snap.hellMode;
    this.updateChargeGauge(snap);
    this.updateSpinGauge(snap);
    this.drawMinimap(snap);
    this.updateGunGameHud(snap);

    // ── R53-W2: M2a/M2b配線待ちの拡張フィールド(全optional。ローカル交差型で先行消費) ──
    const snapW2 = snap as R53W2Snapshot;
    this.updatePapPips(snapW2);
    this.updatePowerUps(snapW2);
    this.updatePoisonVignette(snapW2);
    this.updateSpecialRound(snapW2);
    this.updateRadioLine(snapW2);
    this.updateDetectMeter(snapW2);
    this.updateBossPhases(snapW2);
    this.updateSndHud(snapW2);

    // ── R53-W3 MK.III: Adaptive Presence / モーメント / 帝王枠 / チャージ弧 ──
    this.updateMk3(snap as Mk3Snapshot);

    const scoreboard = this.el['scoreboard'];
    if (scoreboard) {
      scoreboard.hidden = !showScoreboard;
      if (showScoreboard) this.renderScoreboard(snap);
    }
  }

  // ── R54-F5 輪廻: バッジ+供物選択パネル(snap.rogue消費。undefined=完全非表示) ──
  private rogueOptionsSig = ''; // 選択肢の再構築判定(毎フレームのinnerHTML再構築を避ける)
  private updateRogue(rogue: MatchSnapshot['rogue']): void {
    const badge = this.el['rogue-badge'];
    if (badge) {
      badge.hidden = rogue === undefined;
      if (rogue) this.text('rogue-cards-n', String(rogue.cards.length));
    }
    const panel = this.el['rogue-pick'];
    if (!panel) return;
    const pick = rogue?.pick;
    panel.hidden = pick === undefined;
    if (!pick) {
      this.rogueOptionsSig = '';
      return;
    }
    const sig = pick.options.map((o) => o.id).join(',');
    if (sig !== this.rogueOptionsSig) {
      this.rogueOptionsSig = sig;
      const wrap = this.el['rogue-options'];
      if (wrap) {
        const rarityJa = { common: '常', rare: '稀', epic: '極' } as Record<string, string>;
        wrap.innerHTML = pick.options
          .map(
            (o) => `
          <div class="rogue-card rogue-card--${o.rarity}">
            <span class="rogue-card-rarity">${rarityJa[o.rarity] ?? '常'}</span>
            <strong>${o.name}</strong>
            <small>${o.desc}</small>
          </div>`,
          )
          .join('');
      }
    }
    this.text('rogue-remain', String(Math.max(0, Math.ceil(pick.remainS))));
  }

  private text(id: string, value: string): void {
    const node = this.el[id];
    if (node && node.textContent !== value) node.textContent = value;
  }

  // 先取スコアラベルの共通整形。無限先取(zombie等)では target が Infinity のため
  // 生文字列化すると '先取 Infinity' の壊れ表示になる — 有限のときだけ出す。
  private formatScoreGoal(scoreTarget: number): string {
    return Number.isFinite(scoreTarget) ? `先取 ${scoreTarget}` : '';
  }

  // R55 W-C2: teamscore(mine/enemy診断セル)とscoretarget(先取ラベル)はDOM上は
  // 兄弟の別要素(clip-path回避でwrap直下へ分離済み)だが、常に同じ条件で出し分けるため
  // hidden切替を一箇所へ集約する(呼び出し漏れによる「片方だけ残る」退行を防ぐ)。
  private setTeamscoreHidden(hidden: boolean): void {
    const teamscore = this.el['teamscore'];
    if (teamscore) teamscore.hidden = hidden;
    const target = this.el['scoretarget'];
    if (target) target.hidden = hidden;
  }

  private updateCompass(yaw: number, _width: number): void {
    const headingDeg = ((-yaw * 180) / Math.PI + 360 * 4) % 360;
    // コンパス帯のmask外に置いた数値方位(3桁ゼロ詰め・360°は0°へ丸め込む)
    this.text('hdg', String(Math.round(headingDeg) % 360).padStart(3, '0'));
    for (const mark of this.compassMarks) {
      const relative = ((mark.bearing - headingDeg + 540) % 360) - 180;
      const visible = Math.abs(relative) <= 65;
      mark.el.style.opacity = visible ? '1' : '0';
      if (visible) {
        // ラベル自身の幅の半分を引いて文字の中心を目盛り位置に合わせる
        mark.el.style.transform = `translateX(${relative * PX_PER_DEG}px) translateX(-50%)`;
      }
    }
  }

  private updateCrosshair(snap: MatchSnapshot, height: number): void {
    const crosshair = this.el['crosshair'];
    if (!crosshair) return;
    // 形状・色はユーザー設定に追従(腰だめクロスヘア)
    if (crosshair.dataset.reticle !== snap.reticleStyle) {
      crosshair.dataset.reticle = snap.reticleStyle;
    }
    crosshair.style.setProperty('--reticle-color', reticleColorValue(snap.reticleColor));
    // R53 T6: adsKeepsCrosshair=true の武器はADS中も腰だめクロスヘアをフルで維持する
    // (擬似要素レティクル消し込み用の--adsと、4本バーのbarOpacityの両方を凍結する。
    // スコープ/倍率光学の全消し=下のscopedWeapon分岐は対象外・従来どおり)
    const fade = crosshairAdsFade(snap.adsProgress, snap.adsKeepsCrosshair === true);
    // 覗き込み量を毎フレーム公開。CSS側で circle/chevron 擬似要素レティクルを
    // ADS進行に応じて消し込む(barはJSのopacityで消えるが擬似要素は非対象なため)。
    crosshair.style.setProperty('--ads', String(fade.adsVar));
    if (!snap.alive) {
      crosshair.style.opacity = '0';
      return;
    }
    // スコープ/倍率光学の覗き込み中はDOMスコープに任せ、通常クロスヘアは丸ごと消す
    // (.ch-dotはバー不透明度の影響を受けないため、コンテナごと0にする)
    if ((snap.scopedWeapon || snap.adsOpticActive) && snap.adsProgress > 0.5) {
      crosshair.style.opacity = '0';
      return;
    }
    crosshair.style.opacity = '1';
    const fovRad = (snap.fov * Math.PI) / 180;
    const gap = 4 + (Math.tan(snap.spreadRad) / Math.tan(fovRad / 2)) * (height / 2);
    // ADS序盤で4本バーを素早く消す(係数2.5=ads≈0.4で消灯)。keepsCrosshairの武器は消さない。
    const barOpacity = String(fade.barOpacity);
    const set = (id: string, transform: string) => {
      const bar = this.el[id];
      if (bar) {
        bar.style.transform = transform;
        bar.style.opacity = barOpacity;
      }
    };
    set('cht', `translate(-50%, ${-gap - 9}px)`);
    set('chb', `translate(-50%, ${gap}px)`);
    set('chl', `translate(${-gap - 9}px, -50%)`);
    set('chr', `translate(${gap}px, -50%)`);
  }

  // DSR風スコープ。adsProgress 0.5→1で開き、ピン留めの照準点は常に中央=弾着点。
  // 揺れはフレーム/グラスの視差にのみ使う(reduceMotion時は無効)
  private updateScope(snap: MatchSnapshot, width: number, height: number): void {
    const scope = this.el['scope'];
    if (!scope) return;
    const t = clampN((snap.adsProgress - 0.5) / 0.5, 0, 1);
    // R13: ネイティブ狙撃(scopedWeapon)に加え、後付け倍率光学(adsOpticActive)でもオーバーレイを開く
    const on = snap.alive && (snap.scopedWeapon || snap.adsOpticActive) && t > 0;
    scope.hidden = !on;
    if (!on) {
      this.scopeOn = false;
      this.wasSteady = false;
      return;
    }
    // レティクル種別と光学クラス(native=全画面暗転 / magnified=後付け光学は軽量オーバーレイで
    // ビューモデルを残す)を data属性で公開。CSSが厳密に1レティクルだけ可視化+暗転量を切替
    if (scope.dataset.reticle !== snap.sightStyle) scope.dataset.reticle = snap.sightStyle;
    const opticClass = snap.scopedWeapon ? 'native' : 'magnified';
    if (scope.dataset.opticClass !== opticClass) scope.dataset.opticClass = opticClass;
    scope.style.opacity = String(t);
    scope.style.setProperty('--in', String(t));
    scope.style.setProperty('--conv', String(1 - t));
    scope.style.setProperty('--scope-reticle', reticleColorValue(snap.reticleColor));
    scope.style.setProperty('--breath', String(snap.scope.breath01));

    const lens = Math.min(width, height);
    const fovRad = (snap.fov * Math.PI) / 180;
    const pxPerDeg = ((lens / 2) * (Math.PI / 180)) / Math.tan(fovRad / 2);
    const cap = lens * 0.025;
    const swx = snap.reduceMotion ? 0 : clampN(snap.scope.sway.x * pxPerDeg, -cap, cap);
    const swy = snap.reduceMotion ? 0 : clampN(snap.scope.sway.y * pxPerDeg, -cap, cap);
    scope.style.setProperty('--swx', `${swx}px`);
    scope.style.setProperty('--swy', `${swy}px`);

    scope.classList.toggle('steady', snap.scope.steady);
    scope.classList.toggle('engaged', snap.aimAssistEngaged);
    scope.classList.toggle('reduced', snap.reduceMotion);

    // 立ち上がり(覗き込み開始)でレンズグリント
    if (!this.scopeOn) {
      if (!snap.reduceMotion) this.restartAnimation('scopeglint', 'show');
      this.scopeOn = true;
    }
    // 息止め成立の瞬間にもグリントを再発火し「集中した」手応えを返す
    if (snap.scope.steady && !this.wasSteady && !snap.reduceMotion) {
      this.restartAnimation('scopeglint', 'show');
    }
    this.wasSteady = snap.scope.steady;
    this.text('scoperange', snap.rangeM > 0 ? String(Math.round(snap.rangeM)) : '--');
    this.text('scopezoom', snap.zoomX.toFixed(1));
  }

  private updateAmmo(snap: MatchSnapshot): void {
    this.text('weapon', snap.weaponName);
    // W-ENZA2 U3: match.ts(共有)は 'PRIMARY'/'SECONDARY' のまま(変更不可)。
    // 表示直前にHud2側だけ明朝儀式命名へ置換する
    this.text('weaponslot', snap.weaponSlot === 'PRIMARY' ? '主武装' : '副武装');
    this.text('ammo', String(snap.ammo));
    // リザーブ弾は無限。有限値が来た場合のみ数値を表示する
    this.text('reserve', Number.isFinite(snap.reserve) ? `/ ${snap.reserve}` : '/ ∞');
    this.text('mode', snap.fireMode);
    const ammoEl = this.el['ammo'];
    if (ammoEl) ammoEl.classList.toggle('hud-ammo-low', snap.ammo <= 5);
    this.updateAmmoPips(snap);

    const reload = this.el['reload'];
    if (reload) reload.hidden = !snap.reloading;
    const fill = this.el['reloadfill'];
    if (fill && snap.reloading) fill.style.width = `${snap.reloadRatio * 100}%`;
  }

  // 現在武器の装弾数。match.ts が snap.magSize を供給すればそれを採用し、
  // 無い間は「装備直後の残弾=満タン=装弾数」を利用した最大残弾トラッカでフォールバックする。
  private magSizeOf(snap: MatchSnapshot): number {
    // magSize は MatchSnapshot の必須フィールド(match.tsが weapon.magazine.capacity を供給)
    return Math.max(1, Math.floor(snap.magSize));
  }

  // 弾ピップ列。装弾数ぶんのセルを一度だけ生成し、残弾に応じて先頭から点灯する。
  // ピップ本数は snap.magSize(=装弾数)基準で正規化(/30 の固定スケール誤りを回避)。
  private updateAmmoPips(snap: MatchSnapshot): void {
    const host = this.el['ammopips'];
    if (!host) return;
    const mag = this.magSizeOf(snap);
    // 大容量/無限(素手 magSize 999 等)はピップ列を出さず数値表示のみに退避する。
    // 上限を設けないとDOMノードが弾倉容量ぶん無制限に増えHUDが崩れヒッチする
    if (mag > 60) {
      if (this.lastPipMag !== 0) {
        host.replaceChildren();
        this.lastPipMag = 0;
        this.lastPipAmmo = -1;
      }
      return;
    }
    if (mag !== this.lastPipMag) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < mag; i += 1) frag.appendChild(document.createElement('i'));
      host.replaceChildren(frag);
      this.lastPipMag = mag;
      this.lastPipAmmo = -1; // セル再生成後は必ず点灯を貼り直す
    }
    if (snap.ammo !== this.lastPipAmmo) {
      const pips = host.children;
      for (let i = 0; i < pips.length; i += 1) {
        (pips[i] as HTMLElement).classList.toggle('spent', i >= snap.ammo);
      }
      this.lastPipAmmo = snap.ammo;
    }
  }

  // ── BO2 スコアストリークパネル ────────────────────────────────────────────────────────
  // 7スロット縦積みパネル。バンク済み=lit、非バンク=dim。次のストリークまでの残pts上部表示。
  // idx:  0=RC-XD / 1=UAV / 2=HK / 3=CarePackage / 4=CounterUAV / 5=Lightning / 6=SensorTurret
  private readonly BO2_SVG_ICONS = [
    // RC-XD: ラジコン車 (車体+アンテナ)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="13" width="16" height="6" rx="1"/><circle cx="8" cy="20" r="1.8"/><circle cx="16" cy="20" r="1.8"/><line x1="15" y1="13" x2="17" y2="8"/><line x1="17" y1="8" x2="17" y2="5"/></svg>`,
    // UAV: レーダーディッシュ (円 + 放射線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="14" r="3"/><path d="M5 20 C5 12 19 12 19 20"/><line x1="12" y1="11" x2="12" y2="4"/><line x1="12" y1="4" x2="7" y2="8"/><line x1="12" y1="4" x2="17" y2="8"/></svg>`,
    // Hunter-Killer: ドローン (六角 + 線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polygon points="12,4 19,8 19,16 12,20 5,16 5,8"/><line x1="5" y1="8" x2="1" y2="6"/><line x1="19" y1="8" x2="23" y2="6"/><line x1="5" y1="16" x2="1" y2="18"/><line x1="19" y1="16" x2="23" y2="18"/></svg>`,
    // Care Package: 落下クレート (箱+降下線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="6" y="13" width="12" height="8" rx="1"/><line x1="12" y1="2" x2="12" y2="13"/><line x1="8" y1="6" x2="12" y2="2"/><line x1="16" y1="6" x2="12" y2="2"/><line x1="6" y1="17" x2="18" y2="17"/></svg>`,
    // Counter UAV: 妨害アンテナ (電波遮断)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="20"/><path d="M6 8 C6 4 18 4 18 8"/><path d="M4 12 C4 6 20 6 20 12"/><line x1="4" y1="4" x2="20" y2="20"/></svg>`,
    // Lightning Strike: 稲妻ボルト
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polyline points="13,2 7,13 12,13 11,22 17,11 12,11 13,2"/></svg>`,
    // Sensor Turret: 砲台
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="14" width="10" height="6" rx="1"/><rect x="9" y="10" width="6" height="4"/><line x1="12" y1="10" x2="12" y2="4"/><line x1="12" y1="4" x2="17" y2="7"/></svg>`,
  ];

  // W-ENZA2 U3: 英語ゲーム用語を明朝儀式命名へローカライズ(表示はHud2内で完結、match.ts非変更)
  // 火車=RC-XD(遣いの業火車) / 天眼=UAV(千里の眼) / 羅刹=HKミサイル(誅殺の魔) / 天賜=補給箱(降臨の匣)
  // 結界=カウンターUAV(隠形の術) / 雷撃=雷撃ストライク / 番人=センサー砲台
  private readonly BO2_NAMES = ['火車', '天眼', '羅刹', '天賜', '結界', '雷撃', '番人'];
  private readonly BO2_COSTS = [325, 425, 525, 550, 600, 750, 800];
  private readonly BO2_SLOT_COUNT = 7;

  private updateBO2Streaks(snap: MatchSnapshot): void {
    // ゾンビモードではパネルを隠す
    const panel = this.root.querySelector<HTMLElement>('.u2h-streaks');
    // V31修正: ガンゲームでもストリークパネルを隠す(ストリーク無効モード)
    const ssHidden = snap.zombieRound !== undefined || snap.ggRank !== undefined;
    if (panel) panel.hidden = ssHidden;
    // F-01: BO3縦3段パネルは BO2 7スロットと排他。どちらのモードでも非表示
    const ssPanel = this.root.querySelector<HTMLElement>('.hud-ss-panel');
    if (ssPanel) ssPanel.hidden = true;
    if (ssHidden) return;

    // 各スロットのリット状態更新
    for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
      const slot = this.el[`bo2slot${i}`];
      if (!slot) continue;
      const banked = snap.streakBanked[i] ?? false;
      slot.classList.toggle('bo2-banked', banked);
      // アイコン: 初回のみ設定
      const iconEl = this.el[`bo2icon${i}`];
      if (iconEl && !iconEl.firstChild) {
        iconEl.innerHTML = this.BO2_SVG_ICONS[i] ?? '';
      }
      const nameEl = this.el[`bo2name${i}`];
      if (nameEl && !nameEl.textContent) {
        nameEl.textContent = this.BO2_NAMES[i] ?? '';
      }
    }
    // 次の未バンクストリークまでの残り pts
    const nextEl = this.el['bo2ssnext'];
    if (nextEl) {
      let nextLabel = '';
      for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
        if (!(snap.streakBanked[i] ?? false)) {
          const cost = this.BO2_COSTS[i] ?? 0;
          const rem = Math.max(0, cost - snap.streakProgress);
          nextLabel = rem === 0 ? '' : `${rem} 点`;
          break;
        }
      }
      if (nextEl.textContent !== nextLabel) nextEl.textContent = nextLabel;
    }
    // Counter UAV アクティブ表示
    const cauavEl = this.el['bo2cauav'];
    if (cauavEl) {
      cauavEl.hidden = !snap.streakCauavActive;
      if (snap.streakCauavActive) {
        const tEl = this.el['bo2cauavt'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakCauavTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
    // RC-XD 操縦オーバーレイ
    const rcxdOverlay = this.el['rcxdoverlay'];
    if (rcxdOverlay) {
      rcxdOverlay.hidden = !snap.streakRcxdActive;
      if (snap.streakRcxdActive) {
        const tEl = this.el['rcxdtimer'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakRcxdTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
  }

  // ── BO2 方形ミニマップ描画 ────────────────────────────────────────────────────────────
  private drawMinimap(snap: MatchSnapshot): void {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const MAP = (this.el['minimap'] as HTMLCanvasElement | undefined)?.width ?? 236;
    const CX = MAP / 2;
    const CY = MAP / 2;
    const scale = (MAP * 0.82) / this.minimapStageSize;
    const yaw = snap.yaw;

    ctx.clearRect(0, 0, MAP, MAP);

    // 地(mock05: 漆黒プレート。枠/罫はフレーム側DOMが持つ)
    ctx.fillStyle = 'rgba(7,8,11,0.9)';
    ctx.fillRect(0, 0, MAP, MAP);
    // 方眼(38px周期)
    ctx.strokeStyle = 'rgba(232,227,216,0.055)';
    ctx.lineWidth = 1;
    for (let g = 38; g < MAP; g += 38) {
      ctx.beginPath(); ctx.moveTo(g + 0.5, 0); ctx.lineTo(g + 0.5, MAP); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g + 0.5); ctx.lineTo(MAP, g + 0.5); ctx.stroke();
    }
    // 距離リング(mock: 内=橙0.2/外=白鋼0.08)+視界コーン(自機は常に上向き)
    ctx.strokeStyle = 'rgba(255,107,43,0.2)';
    ctx.beginPath(); ctx.arc(CX, CY, MAP * 0.246, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(232,227,216,0.08)';
    ctx.beginPath(); ctx.arc(CX, CY, MAP * 0.44, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,150,80,0.12)';
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX - MAP * 0.144, CY - MAP * 0.314);
    ctx.lineTo(CX + MAP * 0.144, CY - MAP * 0.314);
    ctx.closePath();
    ctx.fill();

    // ── 回転コンテキスト: プレイヤー中心・ヨー回転 ──
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-yaw);

    // 障害物ボックス
    ctx.strokeStyle = 'rgba(232,227,216,0.14)';
    ctx.lineWidth = 0.7;
    for (const b of this.minimapBoxes) {
      // V31: 破壊済みプロップはミニマップからも消す
      if (b.handle !== undefined && snap.destroyedPropHandles?.has(b.handle)) continue;
      ctx.strokeRect(b.x * scale - b.w * scale / 2, b.z * scale - b.d * scale / 2, b.w * scale, b.d * scale);
    }

    // 味方ドット(装甲青=sofu)
    ctx.fillStyle = '#8FDBFF';
    for (const ally of snap.minimapAllies) {
      ctx.beginPath();
      ctx.arc(ally.relX * scale, ally.relZ * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 敵ドット (赤, UAV スナップ, opacity フェード)
    for (const enemy of snap.minimapEnemies) {
      ctx.globalAlpha = enemy.opacity;
      ctx.fillStyle = '#D24545';
      ctx.beginPath();
      ctx.arc(enemy.relX * scale, enemy.relZ * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── ハードポイントゾーン(回転コンテキスト内) ──
    if (snap.hardpointZoneRelX !== undefined && snap.hardpointZoneRelZ !== undefined) {
      const zx = snap.hardpointZoneRelX * scale;
      const zz = snap.hardpointZoneRelZ * scale;
      const zr = ZONE_R * scale;
      const hpColor = snap.hardpointOwner === 'mine'
        ? 'rgba(255,107,43,0.9)'
        : snap.hardpointOwner === 'enemy'
          ? 'rgba(210,69,69,0.9)'
          : 'rgba(245,208,107,0.9)';
      ctx.strokeStyle = hpColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zx, zz, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hpColor;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HP', zx, zz);
    }

    // ── キルコンファーム ドッグタグ(回転コンテキスト内) ──
    if (snap.kcTagPositions) {
      for (const tag of snap.kcTagPositions) {
        ctx.fillStyle = tag.isEnemy ? 'rgba(245,208,107,0.9)' : 'rgba(210,69,69,0.9)';
        ctx.beginPath();
        ctx.arc(tag.relX * scale, tag.relZ * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 発砲ブリップ(BO2本物仕様: 敵発砲位置を1秒間赤点表示。UAV赤点とは別レイヤ)
    if (snap.fireBlips) {
      for (const blip of snap.fireBlips) {
        const alpha = (1 - blip.age01) * 0.9;
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#D24545';
        ctx.beginPath();
        ctx.arc(blip.relX * scale, blip.relZ * scale, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // プレイヤーアロー(中心固定・常に上向き。mock=熾火)
    ctx.fillStyle = '#FFA061';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(CX, CY - 6);
    ctx.lineTo(CX + 4, CY + 4);
    ctx.lineTo(CX, CY + 1);
    ctx.lineTo(CX - 4, CY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // UAVアクティブ表示はDOMラベル(mock05: 右下「UAV稼働」緑)
    const uavEl = this.el['mmuav'];
    if (uavEl) {
      uavEl.hidden = !snap.streakUavActive;
      if (snap.streakUavActive) {
        const t = `UAV稼働 ${Math.floor(snap.streakUavTimeLeft)}s`;
        if (uavEl.textContent !== t) uavEl.textContent = t;
      }
    }
  }

  private updateObjective(snap: MatchSnapshot): void {
    // ── ハードポイント方向インジケータ ──
    const hpInd = this.el['hpindicator'];
    if (hpInd) {
      const hasHp = snap.hardpointTimeLeft !== undefined;
      hpInd.hidden = !hasHp;
      if (hasHp) {
        // 矢印の回転(0=前方)
        const wrap = this.el['hparrowwrap'];
        if (wrap && snap.hardpointZoneAngle !== undefined) {
          wrap.style.transform = `rotate(${(snap.hardpointZoneAngle * 180) / Math.PI}deg)`;
        }
        // 占拠チップの色クラス
        const chip = this.el['hpchip'];
        if (chip) {
          chip.classList.toggle('hp-mine', snap.hardpointOwner === 'mine');
          chip.classList.toggle('hp-enemy', snap.hardpointOwner === 'enemy');
          chip.classList.toggle('hp-contested', snap.hardpointContested === true);
          const label = snap.hardpointContested ? 'CONTEST' : snap.hardpointOwner === 'mine' ? 'SECURE' : snap.hardpointOwner === 'enemy' ? 'LOSING' : 'EMPTY';
          if (chip.textContent !== label) chip.textContent = label;
        }
        // カウントダウン
        const timeEl = this.el['hptime'];
        if (timeEl) {
          const t = Math.ceil(snap.hardpointTimeLeft ?? 60);
          const txt = String(t);
          if (timeEl.textContent !== txt) timeEl.textContent = txt;
          timeEl.classList.toggle('hp-time-warn', (snap.hardpointTimeLeft ?? 60) <= 10);
        }
        // 矢印形状の色(SVG fill は style 経由でも効く)
        const shape = this.el['hparrowshape'];
        if (shape) {
          const col = snap.hardpointContested ? '#ffffff' : snap.hardpointOwner === 'mine' ? 'var(--accent)' : snap.hardpointOwner === 'enemy' ? '#ff4040' : '#ffd700';
          shape.style.fill = col;
        }
      }
    }

    // ── キルコンファーム演出 ──
    if (snap.kcEvent) this.pushKcEvent(snap.kcEvent);

    const isMission = snap.missionId !== undefined;
    // ストーリーは先取スコアを隠し、目的・進捗・波・ボスHPを出す
    this.setTeamscoreHidden(isMission);
    this.text('scoremine', String(snap.scoreMine));
    this.text('scoreenemy', String(snap.scoreEnemy));
    // 先取ラベルは有限のときだけ('先取 Infinity'の壊れ表示を防ぐ)
    this.text('scoretarget', this.formatScoreGoal(snap.scoreTarget));

    const mission = this.el['mission'];
    if (mission) {
      mission.hidden = !isMission;
      if (isMission) {
        this.text('obj-text', snap.objectiveText ?? '');
        const bar = this.el['obj-bar'];
        if (bar)
          bar.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.objectiveProgress01 ?? 0))})`;
        const total = snap.waveTotal ?? 0;
        this.text('obj-wave', total > 1 ? `WAVE ${snap.waveIndex ?? 0}/${total}` : '');
      }
    }
    const boss = this.el['boss'];
    if (boss) {
      const showBoss = snap.bossHp01 !== undefined;
      boss.hidden = !showBoss;
      if (showBoss) {
        const bb = this.el['boss-bar'];
        if (bb) bb.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.bossHp01 ?? 0))})`;
        const nameEl = this.el['boss-name'];
        if (nameEl) {
          const label = snap.zombieRound !== undefined ? '巨躯' : 'BOSS';
          if (nameEl.textContent !== label) nameEl.textContent = label;
        }
        if (snap.zombieRound !== undefined) {
          boss.classList.add('hud-boss--zombie');
        } else {
          boss.classList.remove('hud-boss--zombie');
        }
      }
    }

    const zones = this.el['zones'];
    if (zones) {
      zones.hidden = snap.zones.length === 0;
      if (snap.zones.length > 0) {
        // 拠点ピルは数が固定なので毎フレーム作り直さず属性だけ更新する
        if (zones.childElementCount !== snap.zones.length) {
          zones.innerHTML = '';
          for (const zone of snap.zones) {
            const pill = document.createElement('span');
            pill.className = 'hud-zone-pill';
            pill.textContent = zone.id;
            zones.appendChild(pill);
          }
        }
        snap.zones.forEach((zone, i) => {
          const pill = zones.children[i] as HTMLElement;
          pill.classList.toggle('zone-mine', zone.owner === 'mine');
          pill.classList.toggle('zone-enemy', zone.owner === 'enemy');
          pill.classList.toggle('zone-contested', zone.contested || zone.capturing !== null);
        });
      }
    }

    const announce = this.el['announce'];
    if (announce) {
      for (const message of snap.announcements) {
        const node = document.createElement('div');
        node.className = 'hud-announce-row';
        node.textContent = message;
        announce.appendChild(node);
        window.setTimeout(() => {
          node.classList.add('announce-out');
          window.setTimeout(() => node.remove(), 400);
        }, 2600);
      }
      while (announce.childElementCount > 3) announce.firstElementChild?.remove();
    }
  }

  private updateGrenade(snap: MatchSnapshot): void {
    this.text('gname', snap.grenadeName);
    this.text('gcount', `x ${snap.grenadeCount}`);
    const grenade = this.el['gcount'];
    if (grenade) grenade.classList.toggle('hud-gcount-empty', snap.grenadeCount === 0);

    const cook = this.el['cook'];
    if (cook) cook.hidden = snap.cookRatio <= 0;
    const fill = this.el['cookfill'];
    if (fill && snap.cookRatio > 0) {
      fill.style.width = `${snap.cookRatio * 100}%`;
      fill.classList.toggle('cook-danger', snap.cookRatio > 0.7);
    }

    const whiteout = this.el['whiteout'];
    if (whiteout) whiteout.style.opacity = String(Math.min(1, snap.whiteout * 1.15));
  }

  private updateHp(snap: MatchSnapshot): void {
    this.text('hp', String(snap.hp));
    this.text('hpmax', `/ ${snap.maxHp}`);
    const fill = this.el['hpbarfill'];
    if (fill) {
      const ratio = clampN(snap.hp / snap.maxHp, 0, 1);
      // mock05: 360×9px 片刃バー。scaleXのみ(transform規約)。書込みは変化フレームのみ
      const sx = ratio.toFixed(3);
      if (sx !== this.lastHpOff) {
        fill.style.transform = `scaleX(${sx})`;
        this.lastHpOff = sx;
      }
      fill.classList.toggle('hp-low', ratio < 0.35);
    }
    const vignette = this.el['vignette'];
    if (vignette) {
      const ratio = snap.hp / snap.maxHp;
      // 瀕死(25%未満)は赤いビネットを脈動させる。脈動中はopacityをCSSアニメに委ねる
      const lowPulse = snap.alive && ratio < 0.25 && !snap.reduceMotion;
      vignette.classList.toggle('low', lowPulse);
      if (lowPulse) vignette.style.removeProperty('opacity');
      // V18修正: 絶対HP40固定だと maxHp=300(ニンジャ)で13%まで警告が出ない(reduceMotion層は特に)。
      // maxHp比率(40%窓)へ較正して maxHp に追従させる
      else {
        const dmgWindow = snap.maxHp * 0.4;
        vignette.style.opacity = String(
          Math.min(0.85, Math.max(0, (dmgWindow - snap.hp) / dmgWindow)),
        );
      }
    }
    if (snap.tookDamage) this.restartAnimation('flash', 'show');
  }

  private pushFeed(snap: MatchSnapshot): void {
    const feed = this.el['feed'];
    if (!feed) return;
    // 帝王状態は行生成時に固定(mock05: 帝王キル=状態色の銘行)
    const emp = deriveEmperorState(snap as Mk3Snapshot);
    for (const entry of snap.feed) {
      const row = document.createElement('div');
      const youKill = entry.killer === 'あなた';
      row.className = 'u2h-feed-row';
      if (youKill) row.classList.add('u2h-feed-row--you');
      if (youKill && emp) {
        row.classList.add('u2h-feed-row--emp');
        row.dataset.emp = emperorThemeAttr(emp);
      }
      row.dataset.kind = entry.headshot ? 'hs' : entry.weapon === '近接' ? 'melee' : '';
      const killer = document.createElement('span');
      killer.className = youKill ? 'u2h-feed-you' : 'u2h-feed-name';
      killer.textContent = entry.killer;
      const weapon = document.createElement('span');
      weapon.className = 'u2h-feed-weapon';
      if (youKill && emp) {
        weapon.classList.add('u2h-feed-weapon--emp');
        weapon.textContent = `〔${entry.weapon}${entry.headshot ? ' · 頭部' : ''}〕`;
      } else {
        weapon.textContent = `[${entry.weapon}${entry.headshot ? ' · 頭部' : ''}]`;
      }
      const victim = document.createElement('span');
      victim.className = entry.victim === 'あなた' ? 'u2h-feed-you' : 'u2h-feed-name';
      victim.textContent = entry.victim;
      row.append(killer, weapon, victim);
      feed.appendChild(row);
      window.setTimeout(() => {
        row.classList.add('feed-out');
        window.setTimeout(() => row.remove(), 400);
      }, FEED_LIFETIME_MS);
    }
    while (feed.childElementCount > 6) feed.firstElementChild?.remove();
  }

  private pushHits(snap: MatchSnapshot): void {
    const marker = this.el['hitmarker'];
    if (!marker || snap.hits.length === 0) return;
    // R20 ティア言語: snipe > kill > head > hit > limb(最弱)を1段だけ選ぶ。
    // 'limb'はmatch.ts側の配線待ちだが、HUDのティア対応(クラス/CSS)は先に用意しておく
    // (MatchSnapshot.hits の型は既に 'limb' を含む)。
    const strongest = snap.hits.includes('snipe')
      ? 'hm-snipe'
      : snap.hits.includes('kill')
        ? 'hm-kill'
        : snap.hits.includes('head')
          ? 'hm-head'
          : snap.hits.includes('hit')
            ? 'hm-hit'
            : 'hm-limb';
    marker.classList.remove('hm-hit', 'hm-head', 'hm-kill', 'hm-snipe', 'hm-limb', 'show');
    void marker.offsetWidth;
    marker.classList.add(strongest, 'show');

    // キル確定時、画面中心から広がる光輪(省モーション時はスキップ)。
    // スコープ覗き込み中はクロスヘアが opacity:0 になるため、隠れない #hud 直下へ付ける
    if ((strongest === 'hm-kill' || strongest === 'hm-snipe') && !snap.reduceMotion) {
      const ring = document.createElement('span');
      ring.className =
        strongest === 'hm-snipe' ? 'hud-kill-ring hud-kill-ring--snipe' : 'hud-kill-ring';
      this.root.appendChild(ring);
      window.setTimeout(() => ring.remove(), 220);
    }
    // R20 hm-kill: 6本の細針が中心から弾ける高速な放射スパーク(kill-ringと同型のDOM+寿命)。
    // reduceMotion時はスキーム全体を出さない(spawnゲート=CSSアニメも走らない)
    if (strongest === 'hm-kill' && !snap.reduceMotion) {
      const spark = document.createElement('span');
      spark.className = 'hud-hit-spark';
      spark.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
      this.root.appendChild(spark);
      window.setTimeout(() => spark.remove(), 200);
    }
  }

  private pushDamageNumbers(snap: MatchSnapshot, project: Project): void {
    const layer = this.el['dmg'];
    if (!layer) return;
    // ノード生成の唯一の入口。個別分・集約分どちらもここを通す(寿命管理を一本化しリーク差異を無くす)
    const spawnAt = (x: number, y: number, className: string, text: string): void => {
      const node = document.createElement('span');
      node.className = className;
      node.textContent = text;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      layer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('rise'));
      window.setTimeout(() => node.remove(), 750);
    };
    const spawn = (world: THREE.Vector3, className: string, text: string): void => {
      const point = project(world);
      if (point.behind) return;
      spawnAt(point.x, point.y, className, text);
    };
    // 軽量化監査#8: 1フレームに生成するノード数を DAMAGE_NUMBER_FRAME_CAP に頭打ちし、
    // 超過分は1個の集約バッジへまとめる(≤上限時は従来どおり全件個別表示・挙動不変)
    const { shown, overflow } = splitDamageNumbersForFrame(snap.damageNumbers);
    for (const dn of shown) {
      spawn(dn.world, dmgNumClass(dn.kind), String(dn.amount));
    }
    if (overflow) {
      // キルを1件でも含む超過分は件数を強調(「+N KILLS」)、それ以外は合計ダメージ量を表示。
      // 既存のダメージ数値クラスを流用するため見た目は浮かない。
      // V51-B: 代表点がカメラ後方でもバッジ自体は消さない(画面中央下へフォールバック表示)
      const label = overflow.hasKill ? `+${overflow.count} KILLS` : `+${overflow.totalAmount}`;
      const cls = dmgNumClass(overflow.hasKill ? 'kill' : 'body');
      const point = project(overflow.anchor.world);
      if (point.behind) {
        spawnAt(layer.clientWidth / 2, layer.clientHeight * 0.62, cls, label);
      } else {
        spawnAt(point.x, point.y, cls, label);
      }
    }
  }

  // メダル表示: 初取得=中央のバッジ解放カード / 2回目以降=左の大文字。HSは抑止(フィードのみ)
  // R21: マルチキル系はバナーへルーティングし、従来のテキスト行/バッジには出さない
  // 同一キルで複数バッジ: medalRank最上位を即時表示、残りは500ms間隔キューへ
  private pushMedals(snap: MatchSnapshot): void {
    // medalRank降順にソートして最上位バッジを即時に出す
    const sorted = [...snap.medals].sort((a, b) => medalRank(b.id) - medalRank(a.id));
    const inZombieMode = snap.zombieRound !== undefined;
    let topBadgeFired = false;
    for (const m of sorted) {
      if (SUPPRESS_BADGE.has(m.id)) {
        // V48修正: 抑止=中央バッジのみ。左のテキスト行では通知する(完全不可視化の回帰を修正)
        this.pushMedalText(m);
        continue;
      }
      if (MULTI_KILL_IDS.has(m.id)) {
        this.pushMultiKillBanner(m, snap.reduceMotion);
        continue;
      }
      if (isZombieRepeatBadgeMuted(m.firstUnlock, inZombieMode)) {
        // ゾンビモードの再達成: バッジ/キューを一切使わず、左フィードの軽量表示のみ残す
        this.pushMedalText(m);
        continue;
      }
      if (m.firstUnlock || ALWAYS_BADGE.has(m.id)) {
        if (!topBadgeFired) {
          this.renderBadge(m);
          topBadgeFired = true;
        } else if (this.badgeQueue.length < 2) {
          // キュー上限2: 溢れた分はテキストフィードへ降格
          this.badgeQueue.push(m);
          if (!this.badgeQueueTimer) {
            this.badgeQueueTimer = window.setInterval(() => { this.flushBadgeQueue(); }, 500);
          }
        } else {
          this.pushMedalText(m);
        }
      } else {
        this.pushMedalText(m);
      }
    }
  }

  private flushBadgeQueue(): void {
    const m = this.badgeQueue.shift();
    if (!m) {
      window.clearInterval(this.badgeQueueTimer);
      this.badgeQueueTimer = 0;
      return;
    }
    this.renderBadge(m);
  }

  // R21 マルチキルバナー: 画面中央上寄りに段階エスカレーション演出で表示する。
  // 連続段更新(1.5秒以内)はバナー昇格更新(スケールパンチ+ピップ追加)。単一バナー要素を再利用。
  private pushMultiKillBanner(m: MedalEvent, reduceMotion: boolean): void {
    const cfg = MK_CFG[m.id];
    if (!cfg) return;

    const banner = this.el['mkbanner'];
    if (!banner) return;
    const label = this.el['mklabel'];
    const pips = this.el['mkpips'];

    const now = Date.now();
    // 1.5秒以内に既バナーが表示中ならアップグレード(パンチ)。それ以外はスラムイン
    const upgrading = !banner.hidden && (now - this.mkBannerMs) < 1500;

    // 既存の消去タイマーをキャンセル
    if (this.mkTimerId) {
      window.clearTimeout(this.mkTimerId);
      this.mkTimerId = 0;
    }

    // ── ラベル更新 ──
    if (label) {
      if (label.textContent !== m.name) label.textContent = m.name;
      label.style.color = cfg.color;
      // クロマ収差: 赤/青をずらした二重残像(段が上がるほど増幅)
      if (cfg.chromaPx > 0) {
        label.style.textShadow = [
          `${cfg.chromaPx}px 0 0 rgba(255,30,30,0.55)`,
          `${-cfg.chromaPx}px 0 0 rgba(30,80,255,0.50)`,
          `0 0 26px ${cfg.color}`,
          `0 2px 8px rgba(0,0,0,0.92)`,
        ].join(', ');
      } else {
        label.style.textShadow = `0 0 26px ${cfg.color}, 0 2px 8px rgba(0,0,0,0.92)`;
      }
    }

    // ── スカルピップ列: アセットレス inline SVG 菱形。キル数ぶん全点灯 ──
    if (pips) {
      const pipSvg =
        `<svg class="mk-pip" viewBox="0 0 10 10" aria-hidden="true">` +
        `<polygon points="5,0.5 9.5,5 5,9.5 0.5,5"` +
        ` fill="currentColor" stroke="currentColor" stroke-width="1"/></svg>`;
      let pipHtml = '';
      for (let i = 0; i < cfg.pips; i += 1) pipHtml += pipSvg;
      pips.innerHTML = pipHtml;
      pips.style.color = cfg.color;
    }

    // スラム強度を CSS 変数で公開(keyframe が参照)
    banner.style.setProperty('--mk-scale', String(cfg.slamScale));

    if (reduceMotion) {
      // 省モーション: アニメなし即時表示
      banner.hidden = false;
      banner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
    } else if (upgrading) {
      // アップグレード: 既存バナーをスケールパンチ
      banner.classList.remove('mk-enter', 'mk-exit');
      void banner.offsetWidth; // reflow でアニメ再起動
      banner.classList.add('mk-punch');
      banner.hidden = false;
    } else {
      // 新規: スラムイン
      banner.classList.remove('mk-punch', 'mk-exit');
      banner.hidden = false;
      void banner.offsetWidth;
      banner.classList.add('mk-enter');
    }

    this.mkBannerMs = now;

    // 表示時間経過後に消去
    this.mkTimerId = window.setTimeout(() => {
      this.mkTimerId = 0;
      if (!banner.hidden) {
        if (reduceMotion) {
          banner.hidden = true;
          banner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
        } else {
          banner.classList.remove('mk-enter', 'mk-punch');
          void banner.offsetWidth;
          banner.classList.add('mk-exit');
          window.setTimeout(() => {
            banner.hidden = true;
            banner.classList.remove('mk-exit');
          }, 300);
        }
      }
    }, cfg.lifetimeMs);
  }

  private renderBadge(m: MedalEvent): void {
    const stack = this.el['badgestack'];
    if (!stack) return;
    const card = document.createElement('div');
    card.className = 'hud-badge';
    card.style.color = m.color;
    const tag = m.firstUnlock ? '実績解放' : '達成';
    card.innerHTML = `${this.makeBadgeSvg(m)}<div class="badge-name">${m.name}</div><div class="badge-tag">${tag}</div>`;
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));
    window.setTimeout(() => {
      card.classList.add('out');
      window.setTimeout(() => card.remove(), 500);
    }, 3200);
    // cap 2
    while (stack.childElementCount > 2) stack.firstElementChild?.remove();
  }

  private pushMedalText(m: MedalEvent): void {
    const stack = this.el['medalstack'];
    if (!stack) return;
    const row = document.createElement('div');
    row.className = 'hud-medal';
    row.style.color = m.color;
    const combo = m.combo >= 2 ? `<i>×${m.combo}</i>` : '';
    row.innerHTML = `<span>${m.name}</span>${combo}`;
    stack.appendChild(row);
    requestAnimationFrame(() => row.classList.add('show'));
    window.setTimeout(() => {
      row.classList.add('out');
      window.setTimeout(() => row.remove(), 400);
    }, 1800);
    while (stack.childElementCount > 6) stack.firstElementChild?.remove();
  }

  // 階級ごとに形の違うエンブレムをSVGで生成(盾/六角/星/八角 + 金属グラデ + グロー + 中央アイコン)
  private makeBadgeSvg(m: MedalEvent): string {
    const id = `bdg${this.badgeSeq++}`;
    const shape =
      m.tier === 'bronze'
        ? '<path d="M60 8 L106 24 V62 C106 90 86 106 60 116 C34 106 14 90 14 62 V24 Z"/>'
        : m.tier === 'gold'
          ? `<polygon points="${starPoints(60, 60, 5, 52, 23)}"/>`
          : `<polygon points="${ngonPoints(60, 60, m.tier === 'silver' ? 6 : 8, 52)}"/>`;
    return `<svg viewBox="0 0 120 120" class="badge-svg" aria-hidden="true">
      <defs>
        <radialGradient id="${id}g" cx="50%" cy="36%" r="68%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
          <stop offset="0.4" stop-color="currentColor" stop-opacity="0.92"/>
          <stop offset="1" stop-color="#080a0e" stop-opacity="0.96"/>
        </radialGradient>
        <filter id="${id}f" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="currentColor" flood-opacity="0.9"/>
        </filter>
      </defs>
      <g filter="url(#${id}f)" fill="url(#${id}g)" stroke="currentColor" stroke-width="3" stroke-linejoin="round">${shape}</g>
      <g class="badge-icon" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${badgeIcon(m.tier)}</g>
    </svg>`;
  }

  // レーダーのブリップ(敵マーカー)を上限数だけプールしておく。毎フレーム属性更新のみ
  private buildRadar(): void {
    const group = this.el['radarblips'];
    if (!group) return;
    for (let i = 0; i < 12; i += 1) {
      const blip = document.createElementNS(SVG_NS, 'circle');
      blip.setAttribute('class', 'radar-blip');
      blip.setAttribute('r', '2.6');
      blip.setAttribute('cx', '0');
      blip.setAttribute('cy', '0');
      (blip as unknown as HTMLElement).style.display = 'none';
      group.appendChild(blip);
    }
  }

  // 視認できている敵を相対方位で円形レーダーに描く。透視防止のため可視判定済みのみ来る
  private updateRadar(snap: MatchSnapshot): void {
    const radar = this.el['radar'];
    const group = this.el['radarblips'];
    if (!radar || !group) return;
    const on = snap.radarEnabled && snap.alive;
    radar.hidden = !on;
    if (!on) return;
    const blips = group.children;
    for (let i = 0; i < blips.length; i += 1) {
      const blip = blips[i] as unknown as {
        setAttribute: (k: string, v: string) => void;
        style: CSSStyleDeclaration;
      };
      const bearing = snap.enemyBearings[i];
      if (!bearing) {
        blip.style.display = 'none';
        continue;
      }
      const rr = Math.min(44, (bearing.dist / RADAR_RANGE_M) * 44);
      blip.setAttribute('cx', (Math.sin(bearing.angle) * rr).toFixed(1));
      blip.setAttribute('cy', (-Math.cos(bearing.angle) * rr).toFixed(1));
      blip.style.display = '';
    }
  }

  // R30 ダメージ方向アーク: 画面中央周りの赤い弧セグメント(被弾方向に幅40°、0.6sフェード)。
  // PostFXの方向ヴィネット(uHitDir)と2チャンネル併走=シェーダは面の赤み、DOMは輪郭の方位。
  // reduceMotion時はグロー無しの簡略描画(CSSの .rm)。
  private pushIncoming(snap: MatchSnapshot): void {
    const layer = this.el['incoming'];
    if (!layer) return;
    for (const angle of snap.incoming) {
      const DEG = 40;
      const R = 82;
      const halfRad = (DEG / 2) * (Math.PI / 180);
      const a0 = angle - halfRad;
      const a1 = angle + halfRad;
      const x0 = Math.sin(a0) * R;
      const y0 = -Math.cos(a0) * R;
      const x1 = Math.sin(a1) * R;
      const y1 = -Math.cos(a1) * R;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', snap.reduceMotion ? 'hud-incoming-arc rm' : 'hud-incoming-arc');
      svg.setAttribute('viewBox', '-100 -100 200 200');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
      path.setAttribute('class', 'hud-incoming-arc-path');
      svg.appendChild(path);
      layer.appendChild(svg);
      window.setTimeout(() => svg.remove(), 620);
    }
  }

  // R30 スコアイベントリボン: 右下(ストリークUI付近)に「+100 キル」等が上へ積み上がる。
  // snap.scoreEvents(消費型・キル/HS/確保/メダルXP)を単一コンテナへ append、
  // 2.5sフェード(2150ms表示+350ms退場)・最大4行。旧中央トーストはR30で本リボンへ一本化。
  private pushXpRibbon(snap: MatchSnapshot): void {
    const layer = this.el['xpribbon'];
    if (!layer || snap.scoreEvents.length === 0) return;
    for (const ev of snap.scoreEvents) {
      const row = document.createElement('div');
      row.className = /頭部|ヘッド/.test(ev.label) ? 'u2h-pop u2h-pop--sub' : 'u2h-pop';
      row.innerHTML = `<b>+${ev.xp}</b><span>${ev.label}</span>`;
      layer.appendChild(row);
      requestAnimationFrame(() => row.classList.add('show'));
      window.setTimeout(() => {
        row.classList.add('out');
        window.setTimeout(() => row.remove(), 350);
      }, 2150);
    }
    while (layer.childElementCount > 4) layer.firstElementChild?.remove();
  }

  private updateDeath(snap: MatchSnapshot): void {
    const death = this.el['death'];
    if (!death) return;
    death.hidden = snap.alive;
    if (!snap.alive) this.text('respawn', snap.respawnIn.toFixed(1));

    // ── R11 キルカメラ・シネマ(#hud直下・opacity/body classで駆動) ──
    // シネマ枠はカメラの真実(killcamCamActive)に連動=bailで観戦へ切替時も乖離しない
    const kcActive = snap.killcamCamActive && snap.killcamWeapon !== null;
    document.body.classList.toggle('killcam-active', kcActive);
    if (kcActive) {
      if (snap.killcam !== null) this.text('kcname', snap.killcam);
      if (snap.killcamWeapon !== null) this.text('kcweapon', snap.killcamWeapon);
      this.text('kcdist', String(snap.killcamDistM));
      const timer = this.el['kctimer'];
      if (timer) timer.style.width = `${Math.max(0, Math.min(1, snap.killcamRatio)) * 100}%`;
    }
    // 黒幕/フラッシュ/終盤ビネットは opacity のみ(遷移で常時滑らかに減衰)
    const veil = this.el['kcveil'];
    if (veil) veil.style.opacity = String(Math.max(0, Math.min(1, snap.deathVeil)));
    const flash = this.el['kcflash'];
    if (flash) flash.style.opacity = String(Math.max(0, Math.min(1, snap.killcamFlash)));
    const vign = this.el['kcvign'];
    if (vign) vign.classList.toggle('final', snap.killcamFinal);
  }

  private updateMovement(snap: MatchSnapshot): void {
    // スピードライン: スプリント速度を超えた量に応じて画面の縁を締める
    const speedlines = this.el['speedlines'];
    if (speedlines) {
      const over = (snap.speed - MOVE_SPEEDS.sprint) / (MOVE_SPEEDS.airMax - MOVE_SPEEDS.sprint);
      // 画面揺れ軽減(アクセシビリティ)時はスピードラインを出さない
      speedlines.style.opacity =
        snap.alive && !snap.reduceMotion ? String(Math.min(0.55, Math.max(0, over) * 0.6)) : '0';
    }

    const move = this.el['move'];
    let state = '';
    if (snap.wallRunning) state = 'WALL RUN';
    else if (snap.sliding) state = 'SLIDE';
    else if (snap.airborne) state = 'AIR';
    if (move) {
      move.hidden = state === '' || !snap.alive;
      // 状態が切り替わった瞬間だけラベルを更新してパルスさせる
      if (state !== this.lastMoveState && state !== '') {
        this.text('movestate', state);
        move.classList.remove('show');
        void move.offsetWidth;
        move.classList.add('show');
      }
      const fill = this.el['speedfill'];
      if (fill) fill.style.width = `${Math.min(100, (snap.speed / MOVE_SPEEDS.airMax) * 100)}%`;
    }
    this.lastMoveState = state;
  }

  // アルティメットの充填メーター。満タンで点灯、発動中はオーバードライブ表示
  private updateUlt(snap: MatchSnapshot): void {
    const ring = this.el['ultring'];
    const c01 = Math.min(1, snap.ultCharge);
    if (ring) ring.setAttribute('stroke-dashoffset', (65.97 * (1 - c01)).toFixed(2));
    this.text('ultpct', `${Math.floor(c01 * 100)}%`);
    const ult = this.el['ult'];
    if (ult) {
      ult.hidden = !snap.alive;
      ult.classList.toggle('ult-ready', snap.ultCharge >= 1 && !snap.ultActive);
      ult.classList.toggle('ult-active', snap.ultActive);
    }
    const label = this.el['ultlabel'];
    if (label) {
      const text = snap.ultActive ? 'OVERDRIVE' : snap.ultCharge >= 1 ? 'ULT 準備完了 [F]' : 'ULT';
      if (label.textContent !== text) label.textContent = text;
    }
    // 発動の瞬間に画面側の閃光を一度だけ出す(ワールド側の炸裂はカメラ内側で
    // 見えないため)。単発のソフトパルスでreduceMotion時は出さない
    if (snap.ultActive && !this.lastUltActive && !snap.reduceMotion) {
      this.restartAnimation('ultflash', 'show');
    }
    this.lastUltActive = snap.ultActive;
  }

  // 連続キルの節目で中央上にバナーを出す
  private updateBanner(snap: MatchSnapshot): void {
    const banner = this.el['banner'];
    if (!banner) return;
    if (snap.streak > this.lastStreak && snap.streak >= 3) {
      const labels: Record<number, string> = {
        3: 'TRIPLE KILL',
        4: 'MULTI KILL',
        5: 'RAMPAGE',
        7: 'UNSTOPPABLE',
        10: 'GODLIKE',
      };
      const label = labels[snap.streak] ?? `KILLSTREAK ×${snap.streak}`;
      const node = document.createElement('div');
      node.className = 'hud-banner-row';
      node.textContent = label;
      banner.appendChild(node);
      window.setTimeout(() => {
        node.classList.add('banner-out');
        window.setTimeout(() => node.remove(), 400);
      }, 1400);
      while (banner.childElementCount > 2) banner.firstElementChild?.remove();
    }
    this.lastStreak = snap.streak;
  }

  private renderScoreboard(snap: MatchSnapshot): void {
    const body = this.el['scorerows'];
    if (!body) return;
    this.text('scoremode', snap.modeName);
    // 無限先取(zombie等)では target が Infinity のため生文字列化しない(scoretargetと同じガード)
    this.text('scoregoal', this.formatScoreGoal(snap.scoreTarget));
    body.innerHTML = '';
    for (const row of snap.scoreboard) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'score-you';
      else if (snap.teamBased && row.isAlly) tr.className = 'score-ally';
      const name = document.createElement('td');
      name.textContent = row.name;
      const kills = document.createElement('td');
      kills.textContent = String(row.kills);
      const deaths = document.createElement('td');
      deaths.textContent = String(row.deaths);
      tr.append(name, kills, deaths);
      body.appendChild(tr);
    }
  }

  /** キルコンファーム CONFIRMED / DENIED バナーを一時表示する */
  private pushKcEvent(ev: 'confirmed' | 'denied'): void {
    const el = this.el['kcevent'];
    if (!el) return;
    // R55 W-C6 [9]: 単一要素使い回しのため、直前の消去タイマー(out遷移/hidden化とも)を
    // 必ずキャンセルしてから再スケジュールする(mkTimerId方式に統一)
    if (this.kcEventTimerId) { window.clearTimeout(this.kcEventTimerId); this.kcEventTimerId = 0; }
    if (this.kcEventOutTimerId) { window.clearTimeout(this.kcEventOutTimerId); this.kcEventOutTimerId = 0; }
    el.textContent = ev === 'confirmed' ? 'CONFIRMED' : 'DENIED';
    el.dataset.kind = ev;
    el.hidden = false;
    el.classList.remove('kc-show', 'kc-out');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('kc-show');
    this.kcEventTimerId = window.setTimeout(() => {
      this.kcEventTimerId = 0;
      el.classList.add('kc-out');
      this.kcEventOutTimerId = window.setTimeout(() => {
        this.kcEventOutTimerId = 0;
        el.hidden = true;
        el.classList.remove('kc-show', 'kc-out');
      }, 350);
    }, 900);
  }

  private restartAnimation(id: string, className: string): void {
    const node = this.el[id];
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  // ── ファイナルキルカム ──────────────────────────────────────────────

  /** ファイナルキルカム開始: シネマバー + バナーを表示する */
  showFinalKillcam(weaponName?: string | null, distM?: number): void {
    this.fkcRoot.classList.add('fkc-active');
    // R54-F7: シネマ帯下部の武器バナー(mono)。武器名未供給(旧試合互換/素手系)は非表示
    if (weaponName) {
      this.fkcWeaponEl.textContent =
        distM && distM > 0 ? `${weaponName} — ${distM}m` : weaponName;
      this.fkcWeaponEl.hidden = false;
    } else {
      this.fkcWeaponEl.hidden = true;
    }
    // R55 W-C3 [14]: killcam中は hud.update() が呼ばれない(main.ts)ため、直前の
    // 'playing' フレームでスコープが開いていた場合、DOMスコープオーバーレイ(倍率/開度)が
    // 再生映像に同期せず凍結表示され続ける。一人称killcamはADS/スコープFOVを再生カメラ側で
    // 再現するため、DOM側の古いオーバーレイと二重表示になり「広角→超望遠へ説明なくジャンプ」
    // する画になる。hideFinalKillcam() と対称に、killcam開始時点で強制クローズし、
    // killcam再生中は常に素の画(オーバーレイなし)にする
    const scope = this.el['scope'];
    if (scope) {
      scope.hidden = true;
      this.scopeOn = false;
    }
  }

  /** ファイナルキルカム終了: オーバーレイを隠す。スコープが残っていたら消す */
  hideFinalKillcam(): void {
    this.fkcRoot.classList.remove('fkc-active');
    // キルカム終了時にスコープオーバーレイを確実に閉じる
    const scope = this.el['scope'];
    if (scope) {
      scope.hidden = true;
      this.scopeOn = false;
    }
  }

  /**
   * フラッシュ強度(0..1)を毎フレーム更新する。
   * R48でファイナルキルカムは三人称固定になったため、R53でスコープオーバーレイ
   * 駆動(adsRatio/isScope引数・hud-scope要素の開閉)を撤去した(表示経路が恒久的に
   * 死んでいたため)。killcam開始時にスコープが開いていた場合の強制クローズは
   * hideFinalKillcam() 側の安全策としてそのまま残す。
   */
  updateFinalKillcam(flash: number): void {
    this.fkcFlashEl.style.opacity = String(flash > 0.001 ? flash : 0);
  }

  /**
   * R55 ④: ファイナルキルカムが一人称(killer=プレイヤー)かを通知する。killcam開始直後に
   * main.ts から一度だけ呼ばれる(Hud2限定 — classic hud.ts は三人称固定のまま対象外)。
   * hud.update() は killcam 再生中呼ばれない(main.ts の二重update防止ゲート)ため、
   * クロスヘアは直近の 'playing' フレームの状態で凍結される。一人称時は「きちんとエイム
   * して当てた」ことを見せるため、画面中央のクロスヘアを明示的に可視化して固定する
   * (ADSで消えていた/フェードしていた場合の上書きも兼ねる)。三人称時は何もしない
   * (既存の凍結挙動を変えない)。
   */
  setFinalKillcamFirstPerson(firstPerson: boolean): void {
    if (!firstPerson) return;
    const crosshair = this.el['crosshair'];
    if (!crosshair) return;
    crosshair.style.opacity = '1';
    crosshair.style.setProperty('--ads', '0');
  }

  private updateZombieShopHud(snap: MatchSnapshot): void {
    const inZombie = snap.zombieRound !== undefined;

    // ── パーク所持アイコン ──
    const zperks = this.el['zperks'];
    if (zperks) {
      zperks.hidden = !inZombie;
      const stacks = snap.zombiePerkStacks ?? {};
      // V23: quick-reviveはスタックMapに入らない(チャージ制)ため、チャージ数をキー/描画に含める
      const revCharges = snap.zombieQuickReviveCharges ?? 0;
      const key =
        (snap.zombiePerks ?? []).map((pid) => `${pid}:${stacks[pid] ?? 1}`).join(',') +
        `|rev:${revCharges}`;
      if (inZombie && key !== this.lastZombiePerks) {
        this.lastZombiePerks = key;
        zperks.innerHTML = '';
        const PERK_COLORS: Record<string, string> = {
          juggernog: '#ff3333',
          'speed-cola': '#33ffee',
          'double-tap': '#ff9933',
          'stamin-up': '#ffee33',
          'quick-revive': '#3355ff',
          'ext-mag': '#88ff44',
        };
        const PERK_LABELS: Record<string, string> = {
          juggernog: 'JUG',
          'speed-cola': 'SPD',
          'double-tap': 'DBL',
          'stamin-up': 'STM',
          'quick-revive': 'REV',
          'ext-mag': 'MAG',
        };
        const PERK_ARIA: Record<string, string> = {
          juggernog: 'ジャガーノグ: 最大HP増加',
          'speed-cola': 'スピードコーラ: リロード速度上昇',
          'double-tap': 'ダブルタップ: 射速2倍',
          'stamin-up': 'スタミンアップ: 移動速度上昇',
          'quick-revive': 'クイックリバイブ: 高速復活',
          'ext-mag': '拡張マガジン: 装弾数増加',
        };
        for (const pid of snap.zombiePerks ?? []) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = PERK_ARIA[pid] ?? pid;
          chip.setAttribute('aria-label', PERK_ARIA[pid] ?? pid);
          chip.style.setProperty('--zp-color', PERK_COLORS[pid] ?? '#fff');
          const abbr = document.createElement('span');
          abbr.textContent = PERK_LABELS[pid] ?? pid.slice(0, 3).toUpperCase();
          chip.appendChild(abbr);
          const n = stacks[pid] ?? 1;
          if (n > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${n}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
        // V23: quick-revive所持チップ(チャージ制のためスタックMap外。所持中のみ表示)
        if (revCharges > 0) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = 'クイックリバイブ: 高速復活';
          chip.setAttribute('aria-label', 'クイックリバイブ: 高速復活');
          chip.style.setProperty('--zp-color', '#3355ff');
          const abbr = document.createElement('span');
          abbr.textContent = 'REV';
          chip.appendChild(abbr);
          if (revCharges > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${revCharges}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
      }
    }

    // ── 購入プロンプト ──
    const zbuy = this.el['zbuy'];
    if (zbuy) {
      const prompt = snap.zombieShopPrompt;
      zbuy.hidden = !inZombie || !prompt;
      if (inZombie && prompt) {
        const text = prompt.label;
        if (zbuy.dataset.label !== text || zbuy.dataset.afford !== String(prompt.canAfford)) {
          zbuy.dataset.label = text;
          zbuy.dataset.afford = String(prompt.canAfford);
          zbuy.replaceChildren();
          const key = document.createElement('span');
          key.className = 'u2h-zbuy-key';
          key.textContent = 'E';
          const label = document.createElement('span');
          label.className = 'u2h-zbuy-label';
          label.textContent = text;
          zbuy.append(key, label);
          zbuy.classList.toggle('zbuy-broke', !prompt.canAfford);
        }
      }
    }
  }

  private pushZombiePointFloats(snap: MatchSnapshot, project: Project): void {
    if (!snap.zombiePointFloats?.length) return;
    const layer = this.el['dmg'];
    if (!layer) return;
    for (const pf of snap.zombiePointFloats) {
      const pt = project(pf.world);
      if (pt.behind) continue;
      const node = document.createElement('span');
      node.className = 'hud-zpfloat';
      node.textContent = `+${pf.amount}`;
      node.style.left = `${pt.x}px`;
      node.style.top = `${pt.y - 30}px`;
      layer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('rise'));
      window.setTimeout(() => node.remove(), 900);
    }
  }

  private updateZombieReviveFlash(snap: MatchSnapshot): void {
    const el = this.el['zreviveflash'];
    if (!el) return;
    const v = snap.zombieReviveFlash ?? 0;
    el.style.opacity = v > 0.001 ? String(v) : '0';
  }

  private updateZombieBossFlash(snap: MatchSnapshot): void {
    const el = this.el['zbossflash'];
    if (!el) return;
    const v = snap.zombieBossFlash ?? 0;
    el.style.opacity = v > 0.001 ? String(v) : '0';
  }

  private updateDarkEmperorHud(snap: MatchSnapshot): void {
    const el = this.el['darkemperor'];
    if (!el) return;
    const secs = snap.darkEmperorS ?? 0;
    // 黒雷帝が最上位: 黒雷帝発動中は黒帝バッジを隠す(黒雷帝バッジが単独表示)
    const active = secs > 0 && !snap.kokuraiteiMode;
    el.hidden = !active;
    if (active) {
      const timerEl = this.el['detimer'];
      if (snap.darkEmperorPermanent) {
        if (timerEl) timerEl.hidden = true;
      } else {
        if (timerEl) timerEl.hidden = false;
        const mm = Math.floor(secs / 60);
        const ss = Math.floor(secs % 60);
        this.text('detimer', `${mm}:${String(ss).padStart(2, '0')}`);
      }
    }
  }

  private updateRaiteiHud(snap: MatchSnapshot): void {
    const el = this.el['raitei'];
    if (!el) return;
    // バッジ優先度: 黒雷帝 > 黒帝 > 雷帝。上位モード発動中は雷帝バッジを隠す
    const darkActive = (snap.darkEmperorS ?? 0) > 0;
    el.hidden = !(snap.raiteiMode && !snap.kokuraiteiMode && !darkActive);
  }

  private updateKokuraiteiHud(snap: MatchSnapshot): void {
    const el = this.el['kokuraitei'];
    if (!el) return;
    el.hidden = !snap.kokuraiteiMode;
  }

  private updateChargeGauge(snap: MatchSnapshot): void {
    const el = this.el['chargegauge'];
    if (!el) return;
    const ratio = snap.chargeRatio ?? 0;
    el.hidden = ratio <= 0;
    if (ratio > 0) {
      const fill = this.el['chargefill'];
      if (fill) {
        (fill as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
        fill.classList.toggle('charge-full', ratio >= 1);
        fill.classList.toggle('charge-kokuraitei', !!snap.kokuraiteiMode);
      }
    }
  }

  // 修羅スピンアップRPMゲージ(hud-charge-gauge流儀の小ゲージ)。minigun装備+スピン>0のみ表示。
  // 発射開始しきい(400rpm≒0.22)まで緑、以降は黄、フルスピン間近(≥0.85)で赤
  private updateSpinGauge(snap: MatchSnapshot): void {
    const el = this.el['spingauge'];
    if (!el) return;
    const spin = snap.minigunSpin01 ?? 0;
    el.hidden = spin <= 0;
    if (spin > 0) {
      const fill = this.el['spinfill'];
      if (fill) {
        (fill as HTMLElement).style.width = `${Math.round(spin * 100)}%`;
        fill.classList.toggle('spin-mid', spin >= 0.22 && spin < 0.85);
        fill.classList.toggle('spin-hot', spin >= 0.85);
      }
    }
  }

  // ── ガンゲーム HUD ──────────────────────────────────────────────────────────────────────
  private updateGunGameHud(snap: MatchSnapshot): void {
    const el = this.el['gg'];
    if (!el) return;
    const inGG = snap.ggRank !== undefined;
    el.hidden = !inGG;
    if (!inGG) return;

    const rank = snap.ggRank!;
    this.text('ggrank', `${rank} / ${GG_LADDER.length}`);
    this.text('ggweapon', snap.ggWeaponName ?? '');

    // ランクアップフラッシュ(1フレームだけ演出クラスを付与)。連続発火時は既存タイマーを
    // clearTimeoutしてから張り直す(他イベントのタイマーに巻き込まれて早期消灯しないように
    // ハンドルを個別保持する)
    if (snap.ggRankUpFlash) {
      el.classList.add('gg-rankup');
      if (this.ggFlashTimerId) clearTimeout(this.ggFlashTimerId);
      this.ggFlashTimerId = window.setTimeout(() => {
        el.classList.remove('gg-rankup');
        this.ggFlashTimerId = 0;
      }, 600);
    }
    if (snap.ggSetback) {
      el.classList.add('gg-setback');
      if (this.ggSetbackTimerId) clearTimeout(this.ggSetbackTimerId);
      this.ggSetbackTimerId = window.setTimeout(() => {
        el.classList.remove('gg-setback');
        this.ggSetbackTimerId = 0;
      }, 600);
    }

    // トップ3リーダーボード
    const top3El = this.el['ggtop3'];
    if (top3El && snap.ggTop3) {
      top3El.innerHTML = snap.ggTop3.map((e, i) =>
        `<div class="gg-top3-row${e.isPlayer ? ' gg-top3-you' : ''}">` +
        `<span class="gg-top3-pos">${i + 1}</span>` +
        `<span class="gg-top3-name">${e.isPlayer ? 'YOU' : e.name}</span>` +
        `<span class="gg-top3-rank">${e.rank}</span>` +
        `</div>`
      ).join('');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // R53-W2: match.ts(M2a/M2b)配線待ちの拡張HUD。全て snap.<field> が undefined の間は
  // 自然に非表示のまま(既存モードの見た目・挙動に一切影響しない)。
  // ══════════════════════════════════════════════════════════════════════

  // PaP(Pack-a-Punch)段数ピップ。武器名の隣に橙の小菱形×tier(papTier=0/undefinedで非表示)
  private updatePapPips(snap: R53W2Snapshot): void {
    const host = this.el['pappips'];
    if (!host) return;
    const tier = clampPapTier(snap.papTier);
    if (tier === this.lastPapTier) return;
    this.lastPapTier = tier;
    host.innerHTML = '';
    for (let i = 0; i < tier; i += 1) {
      const pip = document.createElement('i');
      pip.className = 'w2-pap-pip';
      host.appendChild(pip);
    }
  }

  // アクティブパワーアップの横並びチップ(insta/double/nuke/maxammo/carpenter、5種色分け)。
  // kind集合が変化した時だけDOM再構築し、残秒は毎フレームテキストのみ更新(BO2ストリーク流儀)。
  // 残3s未満のみ点滅(reduceMotion時は非点滅)。zombiePowerUps(ワールドドロップ)は
  // 3Dビーコンで視認できるためHUDマーカーは実装しない(意図的な不実装)。
  private updatePowerUps(snap: R53W2Snapshot): void {
    const host = this.el['powerups'];
    if (!host) return;
    const list = snap.activePowerUps ?? [];
    if (list.length === 0) {
      if (this.lastPowerUpKey !== '') {
        this.lastPowerUpKey = '';
        this.powerUpEls.clear();
        host.innerHTML = '';
      }
      return;
    }
    const key = list.map((p) => p.kind).join(',');
    if (key !== this.lastPowerUpKey) {
      this.lastPowerUpKey = key;
      host.innerHTML = '';
      this.powerUpEls.clear();
      for (const p of list) {
        const spec = POWERUP_CHIP_SPECS[p.kind];
        const chip = document.createElement('div');
        chip.className = 'w2-pu-chip';
        chip.style.setProperty('--pu-color', spec.color);
        chip.title = spec.label;
        chip.setAttribute('aria-label', spec.label);
        chip.innerHTML = `<span class="w2-pu-icon">${spec.icon}</span><span class="w2-pu-time"></span>`;
        host.appendChild(chip);
        const timeEl = chip.querySelector('.w2-pu-time') as HTMLElement;
        this.powerUpEls.set(p.kind, { root: chip, timeEl });
      }
    }
    for (const p of list) {
      const ref = this.powerUpEls.get(p.kind);
      if (!ref) continue;
      const txt = String(Math.max(0, Math.ceil(p.remainS)));
      if (ref.timeEl.textContent !== txt) ref.timeEl.textContent = txt;
      ref.root.classList.toggle('w2-pu-blink', isPowerUpBlinking(p.remainS, snap.reduceMotion));
    }
  }

  // 毒霧ビネット: 緑の縁オーバーレイ。.hud-vignette(被弾/低HP=赤)とは別要素・別z層のため、
  // 双方が同時に出ても色が混線せず both が独立に見える(opacity/色のみで駆動しDOM競合なし)
  private updatePoisonVignette(snap: R53W2Snapshot): void {
    const el = this.el['poisonvign'];
    if (!el) return;
    const p01 = clampN(snap.poison01 ?? 0, 0, 1);
    el.style.opacity = p01 > 0.001 ? String(p01 * 0.6) : '0';
  }

  // 特殊ラウンド(餓鬼の大群)突入バナー: 'rush'へ遷移した瞬間だけ一発表示(CONFIRMEDバナー流儀)。
  // ラウンド数字はspecialRound中ずっと赤色化(バナーとは独立に持続)
  private updateSpecialRound(snap: R53W2Snapshot): void {
    const special = snap.specialRound ?? null;
    if (isSpecialRoundEntering(this.lastSpecialRound, special)) {
      const banner = this.el['specialbanner'];
      if (banner) {
        const reduceMotion = snap.reduceMotion;
        banner.classList.remove('w2-show', 'w2-out');
        banner.hidden = false;
        if (!reduceMotion) {
          void banner.offsetWidth; // reflow でスラムインを再起動
          banner.classList.add('w2-show');
        }
        window.setTimeout(() => {
          if (reduceMotion) {
            banner.hidden = true;
          } else {
            banner.classList.add('w2-out');
            window.setTimeout(() => {
              banner.hidden = true;
              banner.classList.remove('w2-show', 'w2-out');
            }, 500);
          }
        }, 2200);
      }
    }
    this.lastSpecialRound = special;
    const zroundEl = this.el['zround'];
    if (zroundEl) {
      const active = special === 'rush';
      zroundEl.classList.toggle('w2-round-special', active);
      // 点滅/脈動はreduceMotion時に付与しない(JS側ゲート。CSS側の@mediaと二重で止める)
      zroundEl.classList.toggle('w2-round-pulse', active && !snap.reduceMotion);
    }
  }

  // 無線字幕: 話者名+本文。クロスヘア聖域外(下部)・キルフィード(右上)と非衝突。
  // radioLine非null→表示(フェードイン)、null→フェードアウト。長文はCSSで2行clamp
  private updateRadioLine(snap: R53W2Snapshot): void {
    const el = this.el['radio'];
    if (!el) return;
    const line = snap.radioLine ?? null;
    const key = line ? `${line.speaker}:${line.text}` : null;
    if (key === this.lastRadioLine) return;
    this.lastRadioLine = key;
    if (line) {
      this.text('radiotext', line.text);
      const speakerEl = this.el['radiospeaker'];
      const color = radioSpeakerColor(line.speaker);
      if (speakerEl) {
        speakerEl.textContent = RADIO_SPEAKER_NAMES[line.speaker];
        speakerEl.style.color = color;
      }
      el.style.setProperty('--radio-color', color); // 左端バーの話者色(CSS側 border-left が参照)
      el.hidden = false;
      el.classList.remove('w2-out');
      void el.offsetWidth;
      el.classList.add('w2-show');
    } else {
      el.classList.remove('w2-show');
      el.classList.add('w2-out');
      window.setTimeout(() => {
        // フェード待機中に新しい無線が来ていたら(lastRadioLineが非null)隠さない
        if (!this.lastRadioLine) el.hidden = true;
      }, 320);
    }
  }

  // 潜入検知メーター: 目アイコン+半円弧ゲージ。0=白/0.5+=黄/0.9+=赤点滅(detect01未定義で非表示)
  private updateDetectMeter(snap: R53W2Snapshot): void {
    const el = this.el['detect'];
    if (!el) return;
    const shown = snap.detect01 !== undefined;
    el.hidden = !shown;
    if (!shown) return;
    const d01 = clampN(snap.detect01 ?? 0, 0, 1);
    const tier = detectMeterTier(d01);
    el.classList.toggle('w2-tier-wary', tier === 'wary');
    el.classList.toggle('w2-tier-alert', tier === 'alert');
    el.classList.toggle('w2-detect-blink', detectMeterBlinking(d01, snap.reduceMotion));
    const arc = this.el['detectarc'];
    if (arc) {
      arc.setAttribute('stroke-dasharray', String(DETECT_ARC_LEN));
      arc.setAttribute('stroke-dashoffset', String(DETECT_ARC_LEN * (1 - d01)));
    }
  }

  // ボスフェーズ菱形pips: 既存ボスHPバーの近くにidx/totalを表示(bossPhase未定義で非表示)
  private updateBossPhases(snap: R53W2Snapshot): void {
    const host = this.el['bossphases'];
    if (!host) return;
    const bp = snap.bossPhase ?? null;
    host.hidden = !bp;
    if (!bp) return;
    if (bp.total !== this.lastBossPhaseTotal) {
      this.lastBossPhaseTotal = bp.total;
      host.innerHTML = '';
      const n = clampN(Math.round(bp.total), 1, 12);
      for (let i = 0; i < n; i += 1) {
        const pip = document.createElement('i');
        pip.className = 'w2-boss-phase-pip';
        host.appendChild(pip);
      }
    }
    const states = bossPhasePipStates(bp.idx, bp.total);
    const pips = host.children;
    for (let i = 0; i < pips.length; i += 1) {
      const state = states[i] ?? 'pending';
      const pip = pips[i] as HTMLElement;
      pip.classList.toggle('w2-pip-done', state === 'done');
      pip.classList.toggle('w2-pip-active', state === 'active');
    }
  }

  // S&D HUD: ラウンドピップ(先取4・チーム色)/フェーズチップ/設置後ボム大カウントダウン/
  // 設置・解除プログレスバー/所持アイコン。sndPhase未定義で非表示(非S&Dモードは無影響)
  private updateSndHud(snap: R53W2Snapshot): void {
    const host = this.el['snd'];
    if (!host) return;
    const active = snap.sndPhase !== undefined;
    host.hidden = !active;
    if (!active) return;

    if (this.lastSndPipTarget !== SND_WIN_TARGET) {
      this.lastSndPipTarget = SND_WIN_TARGET;
      for (const id of ['sndpipsmine', 'sndpipsenemy'] as const) {
        const row = this.el[id];
        if (!row) continue;
        row.innerHTML = '';
        for (let i = 0; i < SND_WIN_TARGET; i += 1) {
          const pip = document.createElement('i');
          pip.className = 'w2-snd-pip';
          row.appendChild(pip);
        }
      }
    }
    const score: [number, number] = snap.sndScore ?? [0, 0];
    const mineStates = sndPipStates(score[0]);
    const enemyStates = sndPipStates(score[1]);
    const mineRow = this.el['sndpipsmine'];
    if (mineRow) {
      const pips = mineRow.children;
      for (let i = 0; i < pips.length; i += 1) {
        (pips[i] as HTMLElement).classList.toggle('w2-snd-pip-lit', mineStates[i] ?? false);
      }
    }
    const enemyRow = this.el['sndpipsenemy'];
    if (enemyRow) {
      const pips = enemyRow.children;
      for (let i = 0; i < pips.length; i += 1) {
        (pips[i] as HTMLElement).classList.toggle('w2-snd-pip-lit', enemyStates[i] ?? false);
      }
    }

    this.text('sndphase', sndPhaseLabel(snap.sndPhase));

    const bombEl = this.el['sndbomb'];
    if (bombEl) {
      const showBomb = snap.sndPhase === 'planted' && snap.sndBombTimer !== undefined;
      bombEl.hidden = !showBomb;
      if (showBomb) this.text('sndbombtime', Math.max(0, snap.sndBombTimer ?? 0).toFixed(1));
    }

    const progEl = this.el['sndprogress'];
    if (progEl) {
      const showProg = snap.sndProgress01 !== undefined;
      progEl.hidden = !showProg;
      if (showProg) {
        this.text('sndprogresslabel', sndProgressLabel(snap.sndProgressKind));
        const fill = this.el['sndprogressfill'];
        if (fill) fill.style.transform = `scaleX(${clampN(snap.sndProgress01 ?? 0, 0, 1)})`;
      }
    }

    const carrierEl = this.el['sndcarrier'];
    if (carrierEl) carrierEl.hidden = !snap.sndCarrierIsPlayer;
  }

  // ══ R53-W3 MK.III「LIVING INSTRUMENT」════════════════════════════════════
  // per-frame DOM書込みの規律: dataset/hidden/クラスは「変化フレームのみ」。
  // 毎フレーム走るのはカウントアップ中のtext()(同値スキップ)とチャージ弧の
  // dashoffset(直近値スキップ)のみ。
  private updateMk3(snap: Mk3Snapshot): void {
    const now = performance.now();
    const dt = this.mk3PrevT === null ? 0 : clampN((now - this.mk3PrevT) / 1000, 0, 0.1);
    this.mk3PrevT = now;

    // ── P0-1 Adaptive Presence(calm時に計器が沈む) ──
    const hpRatio = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
    this.mk3Calm = stepCalmLatch(this.mk3Calm, snap.uiHeat, hpRatio, snap.alive, dt);
    if (this.mk3Calm.calm !== this.mk3CalmApplied) {
      this.mk3CalmApplied = this.mk3Calm.calm;
      if (this.mk3Calm.calm) this.root.dataset.calm = '';
      else delete this.root.dataset.calm;
    }

    // ── P0-2 モーメント帯 ──
    const suppressed = snap.adsProgress > 0.5 || snap.killcamCamActive || !snap.alive;
    const step = stepMomentQueue(this.mk3Moments, snap.moments, suppressed, dt);
    this.mk3Moments = step.state;
    const momentEl = this.el['mk3moment'];
    if (momentEl) {
      if (step.change === 'show' && step.state.current) {
        const m = step.state.current;
        momentEl.dataset.tone = momentTone(m);
        this.text('mk3momentmark', momentWatermark(m));
        const sub = this.el['mk3momentsub'];
        if (sub) {
          sub.textContent = m.sub ?? '';
          sub.hidden = !m.sub;
        }
        const n = Number(m.title);
        this.mk3CountUpTarget = m.title !== '' && Number.isFinite(n) && n > 0 ? n : null;
        this.text('mk3momenttitle', this.mk3CountUpTarget !== null ? '0' : m.title);
        momentEl.hidden = false;
        momentEl.classList.remove('mk3-leave');
        this.restartAnimation('mk3moment', 'mk3-show');
      } else if (step.change === 'hide') {
        momentEl.classList.add('mk3-leave');
        this.mk3CountUpTarget = null;
      } else if (step.change === 'end') {
        momentEl.hidden = true;
        momentEl.classList.remove('mk3-leave', 'mk3-show');
      }
      // 数値タイトルのカウントアップ(表示開始0.5sのみ。text()は同値書込みをスキップする)
      if (this.mk3CountUpTarget !== null && step.state.phase === 'show') {
        const k = Math.min(1, step.state.t / 0.5);
        this.text('mk3momenttitle', String(Math.round(this.mk3CountUpTarget * k)));
        if (k >= 1) this.mk3CountUpTarget = null;
      }
    }

    // ── P1-1 帝王プレゼンス枠 ──
    const emperor = deriveEmperorState(snap);
    const empKey = emperor ?? '';
    if (empKey !== this.mk3EmperorApplied) {
      this.mk3EmperorApplied = empKey;
      const frame = this.el['mk3emperor'];
      if (frame) {
        frame.hidden = empKey === '';
        if (empKey !== '') frame.dataset.state = empKey;
      }
      // UI全転調(enza-core契約): :root[data-emperor] を状態変化フレームのみ書換
      if (empKey === '') delete document.documentElement.dataset.emperor;
      else document.documentElement.dataset.emperor = emperorThemeAttr(empKey as EmperorState);
    }

    // ── チャージ弧(旧hud-charge-gauge棒はmk3レイヤCSSで非表示化=同一データの二重表示回避) ──
    const arcWrap = this.el['mk3arc'];
    const arcFill = this.el['mk3arcfill'];
    if (arcWrap && arcFill) {
      const ratio = snap.chargeRatio ?? 0;
      const visible = ratio > 0 && snap.alive;
      if (visible !== this.mk3ArcVisible) {
        this.mk3ArcVisible = visible;
        arcWrap.hidden = !visible;
        if (!visible) this.mk3LastArcOffset = '';
      }
      if (visible) {
        const off = chargeArcDashoffset(ratio).toFixed(1);
        if (off !== this.mk3LastArcOffset) {
          this.mk3LastArcOffset = off;
          arcFill.style.strokeDashoffset = off;
          arcWrap.classList.toggle('mk3-arc-full', ratio >= 1);
        }
        if (arcWrap.dataset.state !== empKey) arcWrap.dataset.state = empKey;
      }
    }
  }
}
