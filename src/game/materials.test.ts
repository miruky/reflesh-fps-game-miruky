import { describe, expect, it } from 'vitest';
import { BIOMES, generateStageDef } from './biomes';
import { deriveSurfaceMaterials, type SurfaceMaterial } from './materials';
import type { StagePalette } from './stage';
import { STAGES, stageById } from './stages';

const ALL_MATERIALS: readonly SurfaceMaterial[] = [
  'concrete',
  'metal',
  'sand',
  'dirt',
  'snow',
  'grass',
  'wood',
];

// フォールバック検証用の最小パレット。floor/obstacle 以外は判定に使われない。
function paletteWith(floor: string, obstacle: string): StagePalette {
  return {
    sky: '#000000',
    fog: '#000000',
    floor,
    wall: '#444444',
    obstacle,
    accent: '#ff0000',
    lightColor: '#ffffff',
    lightIntensity: 1,
    ambientIntensity: 1,
    fogDensity: 0.01,
    emissiveAccent: false,
  };
}

describe('deriveSurfaceMaterials 代表ステージ', () => {
  // 実パレット(stages.ts)に対して材質ヒューリスティックが意図通りに働くこと。
  // 閾値を変えたときの回帰検知が目的なので、実データをそのまま通す。
  it('setsugen の床は snow', () => {
    expect(deriveSurfaceMaterials(stageById('setsugen').palette).floor).toBe('snow');
  });

  it('sakyuu の床は sand', () => {
    expect(deriveSurfaceMaterials(stageById('sakyuu').palette).floor).toBe('sand');
  });

  it('nakaniwa の床は grass', () => {
    expect(deriveSurfaceMaterials(stageById('nakaniwa').palette).floor).toBe('grass');
  });

  it('koushou の床は metal', () => {
    expect(deriveSurfaceMaterials(stageById('koushou').palette).floor).toBe('metal');
  });
});

describe('deriveSurfaceMaterials 全域の健全性', () => {
  it('全30ステージで floor/wall が7材質のいずれかに落ちる', () => {
    expect(STAGES).toHaveLength(30);
    for (const stage of STAGES) {
      const set = deriveSurfaceMaterials(stage.palette);
      expect(ALL_MATERIALS).toContain(set.floor);
      expect(ALL_MATERIALS).toContain(set.wall);
    }
  });

  it('全8バイオーム×代表シード3種の生成パレットでも例外なく判定できる', () => {
    for (const biome of BIOMES) {
      for (const seed of [7, 42, 31337]) {
        const def = generateStageDef(seed, biome);
        const set = deriveSurfaceMaterials(def.palette);
        expect(ALL_MATERIALS).toContain(set.floor);
        expect(ALL_MATERIALS).toContain(set.wall);
      }
    }
  });
});

describe('deriveSurfaceMaterials 不正入力フォールバック', () => {
  it('短縮hex(#fff)は concrete に落ちる', () => {
    const set = deriveSurfaceMaterials(paletteWith('#fff', '#fff'));
    expect(set.floor).toBe('concrete');
    expect(set.wall).toBe('concrete');
  });

  it('hexでない文字列・空文字でも例外を投げず concrete に落ちる', () => {
    for (const bad of ['red', '', '#gggggg', 'rgb(1,2,3)', '#12345']) {
      const set = deriveSurfaceMaterials(paletteWith(bad, bad));
      expect(set.floor).toBe('concrete');
      expect(set.wall).toBe('concrete');
    }
  });
});
