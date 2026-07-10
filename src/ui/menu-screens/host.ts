// W-ENZA FA2: menu.ts 分割 — 画面モジュールへの遅延クロージャDI(ZombieHost方式)。
// Menu の私有状態へのアクセスは全てこのインターフェイス経由(逆参照/循環importなし)。
// getterで遅延評価、代入が必要なフィールドのみ非readonly。
import type { Input } from '../../core/input';
import type { GamepadBinding, PadAction } from '../../core/gamepad';
import type { Settings } from '../../core/settings';
import type { Profile, MatchProgress } from '../../game/progression';
import type { MatchResult } from '../../game/match';
import type { MissionDef } from '../../game/campaign';
import type { WeaponDef, WeaponClass } from '../../game/weapons';
import type { AttachmentSlot } from '../../game/attachments';
import type { CamoId } from '../../game/camo';
import type { CharmId } from '../../game/progression';
import type { SpaceBg } from '../menu-bg';
import type { WeaponPreview } from '../../render/weapon-preview';
import type { MenuSelection, MenuCallbacks, GradeInfo } from './shared';

export interface MenuScreenHost {
  readonly attachmentBySlot: Record<AttachmentSlot, string | null>;
  readonly bg: SpaceBg | null;
  bindNote: string;
  readonly callbacks: MenuCallbacks;
  captureCleanup: (() => void) | null;
  capturingAction: PadAction | null;
  gradeSeq: number;
  readonly input: Input;
  readonly profile: Profile;
  readonly root: HTMLElement;
  readonly selection: MenuSelection;
  readonly settings: Settings;
  readonly weaponPreview: WeaponPreview | null;
  applyRogueExclusivity(): void;
  assignBinding(action: PadAction, binding: GamepadBinding): void;
  bar(label: string, value: number): string;
  buildGamepadSettings(): HTMLElement;
  camoChip(
    def: WeaponDef,
    camoId: CamoId | null,
    equipped: string | null,
    mastery?: boolean,
    kunai?: boolean,
  ): HTMLButtonElement;
  checkbox(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement;
  clearBgTransition(): void;
  countUp(el: HTMLElement, to: number, durationMs?: number): void;
  currentPrimaryDef(): WeaponDef;
  endCapture(): void;
  equipCamo(def: WeaponDef, camoId: CamoId | null): void;
  equipCharm(id: CharmId | null): void;
  gradeSigilHtml(grade: GradeInfo): string;
  highlightsHtml(result: MatchResult): string;
  markSelected(container: HTMLElement, key: string, value: string): void;
  matchStoryHtml(result: MatchResult, progress: MatchProgress): string;
  missionChip(mission: MissionDef): HTMLElement;
  playerLevel(): number;
  readonly prefersReducedMotion: boolean;
  previewWeapon(def: WeaponDef): void;
  progressHtml(progress: MatchProgress): string;
  query(id: string): HTMLElement;
  refreshDiffChips(slot: 'primary' | 'secondary'): void;
  renderArmoryReadout(def: WeaponDef): void;
  renderAttachments(): void;
  renderBriefing(): void;
  renderCamoSection(def: WeaponDef): void;
  renderCharmSelector(): void;
  renderGamepadBindings(host: HTMLElement, layoutSelect: HTMLSelectElement): void;
  renderKunaiCamoSection(def: WeaponDef, host: HTMLElement): void;
  renderRogueToggle(): void;
  renderSettings(container: HTMLElement): void;
  renderStages(): void;
  renderZombieRoundSelector(): void;
  saveLoadout(): void;
  select(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    apply: (v: string) => void,
  ): HTMLElement;
  setMfdPage(page: string): void;
  showBriefing(mission: MissionDef): void;
  showMain(): void;
  showWeaponClass(cls: WeaponClass): void;
  slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
  ): HTMLElement;
  stagger(container: HTMLElement): void;
  staggerXpList(): void;
  startCapture(action: PadAction, host: HTMLElement, layoutSelect: HTMLSelectElement): void;
  subhead(label: string, code: string): HTMLElement;
  syncAttachments(): void;
  teardownPreview(): void;
  weaponCard(id: string, slot: 'primary' | 'secondary'): HTMLButtonElement;
}
