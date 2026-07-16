// 描画/HUDも参照する移動速度の軽量な単一真実源。
// Rapier依存のPlayer本体から分離し、メニュー起動時に物理エンジンを先読みさせない。
export const MOVE_SPEEDS = {
  walk: 9.2,
  sprint: 12.8,
  slide: 92,
  airMax: 40,
} as const;
