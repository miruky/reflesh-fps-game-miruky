import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { BIOMES, generatePalette, generateStageDef, hslToHex, stageDefFromId } from './biomes';
import { generateStage } from './stage';

const HEX = /^#[0-9a-f]{6}$/;
const COLOR_KEYS = ['sky', 'fog', 'floor', 'wall', 'obstacle', 'accent', 'lightColor'] as const;

// hex から HSL の明度 L=(max+min)/2 を取り出す(色相・彩度に依らず入力Lを復元する)
function hexLightness(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

describe('generateStageDef 決定論', () => {
  it('同じ seed/biome からは常に同じ定義が出る', () => {
    for (const b of BIOMES) {
      for (const seed of [1, 7, 42, 1000, 99999]) {
        expect(JSON.stringify(generateStageDef(seed, b))).toBe(
          JSON.stringify(generateStageDef(seed, b)),
        );
      }
    }
  });

  it('biome省略でも seed のみで安定する', () => {
    for (const seed of [1, 7, 42, 1000]) {
      expect(JSON.stringify(generateStageDef(seed))).toBe(JSON.stringify(generateStageDef(seed)));
    }
  });
});

describe('generatePalette', () => {
  it('全バイオームの色が #rrggbb で emissiveAccent が boolean', () => {
    for (const b of BIOMES) {
      const pal = generatePalette(mulberry32(123), b);
      for (const key of COLOR_KEYS) {
        expect(pal[key]).toMatch(HEX);
      }
      expect(typeof pal.emissiveAccent).toBe('boolean');
    }
  });

  it('floor と obstacle の明度差が常に 0.08 以上(可読性)', () => {
    for (const b of BIOMES) {
      for (const seed of [1, 5, 17, 256, 4096, 65535]) {
        const pal = generatePalette(mulberry32(seed), b);
        const diff = Math.abs(hexLightness(pal.floor) - hexLightness(pal.obstacle));
        expect(diff).toBeGreaterThanOrEqual(0.08);
      }
    }
  });
});

describe('hslToHex', () => {
  it('既知値', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });

  it('h<0 / h>360 はラップする', () => {
    expect(hslToHex(-240, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(480, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(360, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(-120, 1, 0.5)).toBe('#0000ff');
  });
});

describe('生成パイプライン', () => {
  it('全バイオーム×複数シードで生成レイアウトが整合する', () => {
    for (const b of BIOMES) {
      for (const seed of [3, 19, 77, 512, 31337]) {
        const def = generateStageDef(seed, b);
        const layout = generateStage(def);
        const half = def.size / 2;

        // ghost=true の境界壁が 4 枚あること
        const ghostWalls = layout.boxes.filter((box) => box.ghost === true);
        expect(ghostWalls.length).toBeGreaterThanOrEqual(4);
        expect(layout.playerSpawns).toHaveLength(4);
        expect(layout.botSpawns.length).toBeGreaterThanOrEqual(def.botCount);

        for (const box of layout.boxes) {
          // ghost(不可視境界壁)と decor(装飾)はチェック対象外
          if (box.ghost || box.decor) continue;
          expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(half + 1);
          expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(half + 1);
        }

        const spawns = [...layout.playerSpawns, ...layout.botSpawns];
        for (const [sx, , sz] of spawns) {
          for (const box of layout.boxes) {
            // ghost(境界壁)と decor(装飾) は対象外
            if (box.ghost || box.decor) continue;
            const dx = Math.max(0, Math.abs(box.x - sx) - box.w / 2);
            const dz = Math.max(0, Math.abs(box.z - sz) - box.d / 2);
            expect(Math.hypot(dx, dz)).toBeGreaterThan(1);
          }
        }
      }
    }
  });
});

describe('botSpawns の追加', () => {
  it('botCount=8 で全点が境界内・GRID整列のまま増える', () => {
    for (const seed of [10, 200, 3000]) {
      // size=64 を合成 → half=32, edge=28, edge/2=14 で既存6点も2の倍数
      const def = { ...generateStageDef(seed, 'industrial'), size: 64, botCount: 8 };
      const layout = generateStage(def);
      const half = def.size / 2;
      expect(layout.botSpawns.length).toBeGreaterThanOrEqual(8);
      for (const [x, , z] of layout.botSpawns) {
        expect(Math.abs(x)).toBeLessThanOrEqual(half);
        expect(Math.abs(z)).toBeLessThanOrEqual(half);
        expect(x % 2 === 0).toBe(true);
        expect(z % 2 === 0).toBe(true);
      }
    }
  });

  it('botCount<=6 では従来の6点から変化しない', () => {
    const def = { ...generateStageDef(123, 'urban'), botCount: 5 };
    const layout = generateStage(def);
    const edge = def.size / 2 - 4;
    expect(layout.botSpawns).toEqual([
      [0, 0, edge],
      [0, 0, -edge],
      [edge, 0, 0],
      [-edge, 0, 0],
      [edge / 2, 0, -edge / 2],
      [-edge / 2, 0, edge / 2],
    ]);
  });
});

describe('stageDefFromId', () => {
  it('gen-<biome>-<seed> を generateStageDef と一致させる', () => {
    expect(stageDefFromId('gen-neon-97')).toEqual(generateStageDef(97, 'neon'));
    expect(stageDefFromId('gen-desert-12345')).toEqual(generateStageDef(12345, 'desert'));
  });

  it('不正なidでは null を返す', () => {
    expect(stageDefFromId('kunren')).toBeNull();
    expect(stageDefFromId('gen-xxx-')).toBeNull();
    expect(stageDefFromId('gen-neon-')).toBeNull();
    expect(stageDefFromId('gen-mars-12')).toBeNull();
    expect(stageDefFromId('gen-neon-1a')).toBeNull();
  });
});
