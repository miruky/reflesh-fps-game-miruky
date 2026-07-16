import type { MissionDef } from './campaign';

// ストーリー章番号から「帝王の指紋」動機の重みを決める軽量な純関数。
// StoryEngine本体を初期メニューへ混入させないため独立モジュールに置く。
export function motifWeightForMission(mission: MissionDef | null | undefined): number {
  const match = /^ch(\d+)/.exec(mission?.chapterId ?? '');
  const chapter = match ? Number(match[1]) : 0;
  if (chapter >= 7) return 0.8;
  if (chapter >= 4) return 0.4;
  return 0;
}
