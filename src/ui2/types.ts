// W-ENZA2 契約(F1所有)。他画面オーナーはこの型に対して実装する。
// 方針: 旧UI(src/ui/menu.ts)の公開契約を型レベルで再利用し、main.tsの1行スワップを保証する。
import type { Input, UiNav } from '../core/input';
import type { Settings } from '../core/settings';
import type { Difficulty } from '../game/bot';
import type { GrenadeKind } from '../game/grenades';
import type { MissionDef } from '../game/campaign';
import type { MatchResult } from '../game/match-types';
import type { GameMode } from '../game/modes';
import type { CampaignProgress, MatchProgress, Profile } from '../game/progression';
import type { MenuCallbacks, MenuSelection } from '../ui/menu-contracts';
import type { SpaceBg } from '../ui/menu-bg';

export type Screen2Id =
  | 'title'
  | 'hub'
  | 'deploy'
  | 'armory'
  | 'campaign'
  | 'options'
  | 'pause'
  | 'briefing'
  | 'result'
  | 'mission-result';

// open()に渡す画面別ペイロード。増やす場合はF1へ申請(このファイルの追記はF1のみ)
export interface ScreenOpenOpts {
  // deploy: 開いた直後にフォーカスする節(ステージ選択/ゾンビ設定)。options: 'controls'=操作ガイド
  section?: 'stages' | 'zombie' | 'controls';
  mission?: MissionDef;
  result?: MatchResult;
  progress?: MatchProgress;
  campaignProgress?: CampaignProgress;
}

export interface Screen2Handle {
  dispose(): void;
  // 画面固有のパッド処理。trueを返すとコーディネータの既定処理を抑止
  onGamepad?(nav: UiNav): boolean;
}

export type ScreenMount = (host: Ui2Host, root: HTMLElement, opts?: ScreenOpenOpts) => Screen2Handle;

// 兵装/出撃の選択状態(旧menu.tsのMenuSelectionと同一シリアライズ=localStorage互換)
export type LoadoutState = MenuSelection;

export interface Ui2Host {
  readonly settings: Settings;
  readonly profile: Profile;
  readonly callbacks: MenuCallbacks;
  readonly input: Input;
  readonly buildLabel: string;
  reducedMotion(): boolean;
  // 画面遷移(コーディネータ実装)。backはhubへ(title/hubでは無操作)
  open(id: Screen2Id, opts?: ScreenOpenOpts): void;
  back(): void;
  // 兵装選択(deploy/armoryが読み書き。save呼び出しで永続化)
  readonly loadout: LoadoutState;
  saveLoadout(): void;
  // ARMORY 3Dプレビュー(旧mountWeaponPreview互換。canvasは[data-id="weapon-canvas"])
  mountWeaponPreview(): void;
  teardownWeaponPreview(): void;
  previewWeaponId(id: string): void;
  // W-C3[21]: 投擲物ビュー等、プレビューを表示しない間はRAFを止める(disposeはしない=再開が速い)
  suspendWeaponPreview(): void;
  resumeWeaponPreview(): void;
}

// main.tsが消費するメニューの公開面(旧Menuと同一。1行スワップの根拠)
export interface MenuApi {
  showMain(): void;
  showPause(): void;
  showResult(result: MatchResult, progress: MatchProgress): void;
  showMissionResult(result: MatchResult, progress: CampaignProgress): void;
  showBriefing(mission: MissionDef): void;
  handleGamepad(nav: UiNav): void;
  hide(): void;
  attachBg(bg: SpaceBg): void;
}

// 既知の負債(旧UI退役時に移設必須):
// - deploy/armoryの継承パーク解決は軽量な menu-contracts から読む
// - 1920×1080ステージfitユーティリティが画面ごとに重複実装(共有化候補)
// 再エクスポート(画面オーナーがtypes.tsだけをimportすれば足りるように)
export type {
  CampaignProgress,
  Difficulty,
  GameMode,
  GrenadeKind,
  Input,
  MatchProgress,
  MatchResult,
  MenuCallbacks,
  MenuSelection,
  MissionDef,
  Profile,
  Settings,
  UiNav,
};
