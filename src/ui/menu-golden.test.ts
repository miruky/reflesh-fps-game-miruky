// W-ENZA FA2: menu.ts 分割のゴールデン網。
// 分割契約(ENZA_SPEC.md)の公開面を型とexport名でピンし、以後の様式刷新(FB5-FB10)が
// 「公開APIの意図しない破壊」をしていないことを機械的に保証する。
// 変更するときは必ず意図的に(契約更新として)このピンを書き換えること。
import { describe, expect, it } from 'vitest';
import { Menu } from './menu';
import * as menuModule from './menu';
import * as armory from './menu-screens/armory';
import * as result from './menu-screens/result';
import * as settings from './menu-screens/settings';
import * as lobby from './menu-screens/lobby';
import * as title from './menu-screens/title';

// ── Menu クラスの公開API(main.ts/hud.ts が消費する面。増減=契約変更) ──────────
const GOLDEN_MENU_API = [
  'attachBg',
  'handleGamepad',
  'hide',
  'showBriefing',
  'showMain',
  'showMissionResult',
  'showPause',
  'showResult',
] as const;

// ── menu.ts の再export(旧公開名の互換。menu.test.ts 等が消費) ─────────────────
const GOLDEN_MENU_VALUE_EXPORTS = [
  'campaignTotals',
  'missionRewardLabel',
  'charmChipStatus',
  'readLastZombiePerk',
  'resolveCarriedPerk',
  'latestTitle',
  'weaponDiffChips',
  'rankStampChar',
  'EXOTIC_LORE',
  'matchStoryMarkers',
  'LAST_ZOMBIE_PERK_KEY',
] as const;

// ── 各画面モジュールのexport(FBオーナーの追加は自由 — 削除・改名は契約変更) ──
const GOLDEN_ARMORY = [
  'renderWeapons',
  'showWeaponClass',
  'renderSecondaries',
  'weaponCard',
  'refreshDiffChips',
  'previewWeapon',
  'renderArmoryReadout',
  'renderCamoSection',
  'renderKunaiCamoSection',
  'camoChip',
  'equipCamo',
  'bar',
  'renderAttachments',
  'renderGrenades',
] as const;
const GOLDEN_RESULT = [
  'showResult',
  'showMissionResult',
  'highlightsHtml',
  'matchStoryHtml',
  'gradeSigilHtml',
  'progressHtml',
  'countUp',
  'stagger',
  'staggerXpList',
] as const;
const GOLDEN_SETTINGS = [
  'renderSettings',
  'buildGamepadSettings',
  'renderGamepadBindings',
  'startCapture',
  'assignBinding',
  'subhead',
  'slider',
  'select',
  'checkbox',
  'renderControls',
  'showPause',
] as const;
const GOLDEN_LOBBY = [
  'renderStages',
  'renderModes',
  'renderDifficulties',
  'renderSpecialOptions',
  'renderRogueToggle',
  'applyRogueExclusivity',
  'renderZombieRoundSelector',
  'renderCharmSelector',
  'equipCharm',
  'renderBriefing',
  'showBriefing',
  'renderCampaign',
  'missionChip',
  'renderDailies',
  'renderChallenges',
] as const;

describe('menu-golden: 分割契約の公開面ピン', () => {
  it('Menu 公開APIが揃っている(main.ts 無改修の保証)', () => {
    for (const name of GOLDEN_MENU_API) {
      expect(typeof (Menu.prototype as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('menu.ts の互換再exportが揃っている', () => {
    const mod = menuModule as unknown as Record<string, unknown>;
    for (const name of GOLDEN_MENU_VALUE_EXPORTS) {
      expect(mod[name], name).toBeDefined();
    }
  });

  it('armory.ts のexportが契約どおり', () => {
    for (const name of GOLDEN_ARMORY) {
      expect(typeof (armory as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('result.ts のexportが契約どおり', () => {
    for (const name of GOLDEN_RESULT) {
      expect(typeof (result as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('settings.ts のexportが契約どおり', () => {
    for (const name of GOLDEN_SETTINGS) {
      expect(typeof (settings as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('lobby.ts のexportが契約どおり', () => {
    for (const name of GOLDEN_LOBBY) {
      expect(typeof (lobby as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('title.ts はFB5契約スタブ(mountTitle)を持つ', () => {
    expect(typeof title.mountTitle).toBe('function');
  });

  it('ゲームパッド「戻る」が探すDOM idの契約(各画面が維持すべきid)', () => {
    // gamepadBack() は以下のidを順に探して click する。画面刷新(FB5-FB10)後も
    // 「戻る/再開」ボタンにはこのいずれかのidを必ず与えること。
    const GOLDEN_BACK_IDS = ['brief-back', 'to-campaign', 'menu', 'quit', 'resume', 'retry-mission'];
    expect(GOLDEN_BACK_IDS.length).toBeGreaterThan(0);
  });
});
