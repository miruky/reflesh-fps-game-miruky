// 新旧UIが共有するメニュー契約。レンダラ、CSS、プレビューを読まないため、
// UI2から参照してもクラシックMenu全体が本番バンドルへ混入しない。

import type { Difficulty } from '../game/bot';
import type { GrenadeKind } from '../game/grenades';
import type { GameMode } from '../game/modes';
import type { CharmId } from '../game/progression';
import {
  LAST_ZOMBIE_PERK_KEY,
  PERKS,
  type ZombiePerkId,
} from '../game/zombie-economy';

export interface MenuSelection {
  stageId: string;
  mode: GameMode;
  primaryId: string;
  attachments: string[];
  grenade: GrenadeKind;
  difficulty: Difficulty;
  secondaryId: string;
  zombieStartRound?: number;
  hellMode?: boolean;
  allGiantMode?: boolean;
  rogueRun?: boolean;
  missionDifficulty?: Difficulty;
  charm?: CharmId;
  carriedPerk?: ZombiePerkId;
}

export interface MenuCallbacks {
  onStart: (selection: MenuSelection) => void;
  onStartMission: (missionId: string, primaryId?: string, missionDifficulty?: Difficulty) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChanged: () => void;
  onPhoto: () => void;
}

export { LAST_ZOMBIE_PERK_KEY };

export function readLastZombiePerk(
  storage: Pick<Storage, 'getItem'> = localStorage,
): ZombiePerkId | null {
  try {
    const raw = storage.getItem(LAST_ZOMBIE_PERK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' && Object.prototype.hasOwnProperty.call(PERKS, parsed)
      ? (parsed as ZombiePerkId)
      : null;
  } catch {
    return null;
  }
}

export function resolveCarriedPerk(
  charm: CharmId | undefined,
  stored: ZombiePerkId | null,
): ZombiePerkId | undefined {
  return charm === 'perkcarry' ? (stored ?? undefined) : undefined;
}
