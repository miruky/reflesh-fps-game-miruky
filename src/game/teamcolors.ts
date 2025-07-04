// 色覚サポート: 敵・味方の表示色パレット。モデル本体とトレーサーで
// 同系統の色を使い、所属の判別が常に色だけに頼らず明度差でも付くようにする

export interface TeamPalette {
  id: string;
  name: string;
  enemy: number;
  enemyTracer: number;
  ally: number;
  allyTracer: number;
}

export const TEAM_PALETTES: TeamPalette[] = [
  {
    id: 'standard',
    name: '標準(赤 / 青)',
    enemy: 0xc84b3c,
    enemyTracer: 0xff7a6b,
    ally: 0x3f7fd4,
    allyTracer: 0x7fa8ff,
  },
  {
    id: 'orange-blue',
    name: 'オレンジ / 青',
    enemy: 0xe07b28,
    enemyTracer: 0xffb066,
    ally: 0x3f7fd4,
    allyTracer: 0x7fa8ff,
  },
  {
    id: 'magenta-green',
    name: 'マゼンタ / 緑',
    enemy: 0xc8409a,
    enemyTracer: 0xff7ad1,
    ally: 0x3f9d62,
    allyTracer: 0x84e0ae,
  },
  {
    id: 'yellow-blue',
    name: '黄 / 青',
    enemy: 0xd1a52a,
    enemyTracer: 0xffd866,
    ally: 0x3f7fd4,
    allyTracer: 0x7fa8ff,
  },
];

export function teamPalette(id: string): TeamPalette {
  return TEAM_PALETTES.find((palette) => palette.id === id) ?? TEAM_PALETTES[0]!;
}
