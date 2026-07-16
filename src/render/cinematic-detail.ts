import * as THREE from 'three';

/**
 * 視覚専用オブジェクトの重要度。0 はゲームの画作りに不可欠、3 は最初に省略できる微細物。
 * 物理・AI・弾道へ関与するオブジェクトには設定しない。
 */
export type CinematicDetailPriority = 0 | 1 | 2 | 3;

export function markCinematicDetail(
  object: THREE.Object3D,
  priority: CinematicDetailPriority,
): void {
  object.userData.cinematicDetailPriority = priority;
}

export function maxCinematicDetailPriority(scale: number): CinematicDetailPriority {
  if (scale >= 0.94) return 3;
  if (scale >= 0.82) return 2;
  if (scale >= 0.72) return 1;
  return 0;
}

/**
 * 適応解像度と同じ低頻度タイミングで呼ぶ装飾LOD。
 * InstancedMesh の count やGPUバッファは変更せず visibility だけを切り替えるため、
 * 戦闘中の再確保・シェーダ再コンパイル・GCを発生させない。
 */
export function applyCinematicDetailScale(
  roots: readonly THREE.Object3D[],
  scale: number,
): void {
  const maxPriority = maxCinematicDetailPriority(scale);
  for (const root of roots) {
    root.traverse((object) => {
      const priority = object.userData.cinematicDetailPriority as
        | CinematicDetailPriority
        | undefined;
      if (priority === undefined) return;
      object.visible = priority <= maxPriority;
    });
  }
}
