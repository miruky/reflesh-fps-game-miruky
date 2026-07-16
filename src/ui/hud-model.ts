// 新旧HUDの表示状態演算。DOM/CSSに依存しない単一の真実源として、
// Hud/Hud2のマークアップとテーマの違いからロジックを分離する。

import type { MatchSnapshot } from '../game/match-types';
import type { RadioSpeaker } from '../game/campaign';
import type { PowerUpKind } from '../game/zombie-economy';

export function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function isZombieRepeatBadgeMuted(firstUnlock: boolean, inZombieMode: boolean): boolean {
  return inZombieMode && !firstUnlock;
}

export function crosshairAdsFade(
  adsProgress: number,
  keepsCrosshair: boolean,
): { adsVar: number; barOpacity: number } {
  if (keepsCrosshair) return { adsVar: 0, barOpacity: 1 };
  return { adsVar: adsProgress, barOpacity: Math.max(0, 1 - adsProgress * 2.5) };
}

export const DAMAGE_NUMBER_FRAME_CAP = 24;
export interface DamageNumberOverflow<T> {
  count: number;
  totalAmount: number;
  hasKill: boolean;
  anchor: T;
}
export interface DamageNumberSplit<T> {
  shown: T[];
  overflow: DamageNumberOverflow<T> | null;
}
export function splitDamageNumbersForFrame<T extends { amount: number; kind: string }>(
  list: readonly T[],
  cap: number = DAMAGE_NUMBER_FRAME_CAP,
): DamageNumberSplit<T> {
  if (list.length <= cap) return { shown: list as T[], overflow: null };
  const shown = list.slice(0, cap);
  const rest = list.slice(cap);
  return {
    shown,
    overflow: {
      count: rest.length,
      totalAmount: rest.reduce((sum, dn) => sum + dn.amount, 0),
      hasKill: rest.some((dn) => dn.kind === 'kill'),
      anchor: rest[0]!,
    },
  };
}

export interface SndSnapshotFields {
  sndPhase?: 'buy' | 'live' | 'planted' | 'roundEnd';
  sndScore?: [number, number];
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

export function clampPapTier(tier: number | undefined): number {
  if (tier === undefined || !Number.isFinite(tier) || tier <= 0) return 0;
  return Math.min(3, Math.round(tier));
}

export interface PowerUpChipSpec {
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
export function isPowerUpBlinking(remainS: number, reduceMotion: boolean): boolean {
  return !reduceMotion && remainS > 0 && remainS < 3;
}

export const RADIO_SPEAKER_COLORS: Record<RadioSpeaker, string> = {
  kagerou: '#9fb8c9', homura: '#19e6ff', hibana: '#ff817b', kurogane: '#b07cff',
};
export const RADIO_SPEAKER_NAMES: Record<RadioSpeaker, string> = {
  kagerou: 'カゲロウ', homura: 'ホムラ', hibana: 'ヒバナ', kurogane: 'クロガネ',
};
export function radioSpeakerColor(speaker: RadioSpeaker): string {
  return RADIO_SPEAKER_COLORS[speaker];
}

export type DetectTier = 'calm' | 'wary' | 'alert';
export function detectMeterTier(detect01: number): DetectTier {
  if (detect01 >= 0.9) return 'alert';
  if (detect01 >= 0.5) return 'wary';
  return 'calm';
}
export function detectMeterBlinking(detect01: number, reduceMotion: boolean): boolean {
  return !reduceMotion && detect01 >= 0.9;
}
export const DETECT_ARC_LEN = Math.PI * 18;

export type BossPhasePipState = 'done' | 'active' | 'pending';
export function bossPhasePipStates(idx: number, total: number): BossPhasePipState[] {
  const n = clampN(Math.round(total), 1, 12);
  const cur = clampN(Math.round(idx), 1, n);
  return Array.from({ length: n }, (_, i) => (i + 1 < cur ? 'done' : i + 1 === cur ? 'active' : 'pending'));
}

export const SND_WIN_TARGET = 4;
export function sndPipStates(wins: number, target: number = SND_WIN_TARGET): boolean[] {
  const w = clampN(Math.round(wins), 0, target);
  return Array.from({ length: target }, (_, i) => i < w);
}
export function sndProgressLabel(kind: 'plant' | 'defuse' | undefined): string {
  return kind === 'plant' ? '設置中…' : kind === 'defuse' ? '解除中…' : '';
}
const SND_PHASE_LABELS: Record<NonNullable<SndSnapshotFields['sndPhase']>, string> = {
  buy: 'BUY', live: 'LIVE', planted: 'PLANTED', roundEnd: 'ROUND END',
};
export function sndPhaseLabel(phase: SndSnapshotFields['sndPhase']): string {
  return phase ? SND_PHASE_LABELS[phase] : '';
}
export function isSpecialRoundEntering(
  prev: 'rush' | null | undefined,
  next: 'rush' | null | undefined,
): boolean {
  return prev !== 'rush' && next === 'rush';
}

export type EmperorState = 'dark' | 'raitei' | 'kokuraitei';
export interface MomentEvent {
  kind: 'round' | 'rankup' | 'perk' | 'emperor' | 'ggrank' | 'special';
  title: string;
  sub?: string;
  tone?: 'ember' | 'ice' | 'violet';
}
export type Mk3Snapshot = R53W2Snapshot & {
  uiHeat?: number;
  moments?: ReadonlyArray<MomentEvent>;
  emperorState?: EmperorState | null;
};

export const MK3_CALM_ENTER_HEAT = 0.15;
export const MK3_CALM_EXIT_HEAT = 0.3;
export const MK3_CALM_DELAY_S = 2.5;
export interface CalmLatchState { calm: boolean; quietS: number }
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

export const MOMENT_QUEUE_MAX = 4;
export const MOMENT_SHOW_S = 2.6;
export const MOMENT_GAP_S = 0.6;
export type MomentTone = 'ember' | 'gold' | 'signal' | 'ice' | 'violet' | 'threat';
export function momentTone(m: MomentEvent): MomentTone {
  if (m.tone === 'ice' || m.tone === 'violet' || m.tone === 'ember') return m.tone;
  if (m.kind === 'rankup') return 'gold';
  if (m.kind === 'perk') return 'signal';
  if (m.kind === 'special') return 'threat';
  if (m.kind === 'emperor') return 'violet';
  return 'ember';
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
  for (const m of incoming ?? []) {
    if (queue.length < MOMENT_QUEUE_MAX) queue.push(m);
    else if (m.kind === 'emperor' || m.kind === 'rankup') {
      const idx = queue.findIndex((q) => q.kind !== 'emperor' && q.kind !== 'rankup');
      if (idx >= 0) {
        queue.splice(idx, 1);
        queue.push(m);
      }
    }
  }
  let { current, phase, t } = st;
  let change: MomentChange = null;
  t += dt;
  if (phase === 'show' && t >= MOMENT_SHOW_S) {
    phase = 'gap'; t = 0; current = null; change = 'hide';
  } else if (phase === 'gap' && t >= MOMENT_GAP_S) {
    phase = 'idle'; t = 0; change = 'end';
  }
  if (phase === 'idle' && !suppressed && queue.length > 0) {
    current = queue.shift() ?? null; phase = 'show'; t = 0; change = 'show';
  }
  return { state: { queue, current, phase, t }, change };
}

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
    if (d !== 0) out += (d === 1 && unit > 0 ? '' : (KANJI_DIGITS[d] ?? '')) + (KANJI_UNITS[unit] ?? '');
  }
  return out;
}
export function momentWatermark(m: MomentEvent): string {
  if (m.kind === 'round') {
    const n = Number(m.title);
    if (Number.isFinite(n) && n > 0) return toKanjiNumeral(n);
  }
  return m.title.trim().charAt(0) || '刻';
}
export function deriveEmperorState(snap: Mk3Snapshot): EmperorState | null {
  if (snap.emperorState !== undefined) return snap.emperorState;
  if (snap.kokuraiteiMode) return 'kokuraitei';
  if ((snap.darkEmperorS ?? 0) > 0) return 'dark';
  if (snap.raiteiMode) return 'raitei';
  return null;
}
export function emperorThemeAttr(state: EmperorState): string {
  return state === 'dark' ? 'kotei' : state === 'raitei' ? 'raitei' : 'kokurai';
}
export const MK3_CHARGE_ARC_LEN = (Math.PI / 2) * 56;
export function chargeArcDashoffset(ratio01: number): number {
  return MK3_CHARGE_ARC_LEN * (1 - clampN(ratio01, 0, 1));
}
