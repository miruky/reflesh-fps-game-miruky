import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { BIOMES, generatePalette } from '../game/biomes';
import { STAGES } from '../game/stages';
import type { BoxSpec, MoodId, StagePalette } from '../game/stage';
import {
  Atmosphere,
  MOOD_PRESETS,
  insideBox,
  placeGrass,
  resolveGrade,
  resolveMood,
} from './atmosphere';

// 必須フィールドだけ与えて分類器の分岐を検証するためのパレット合成
function makePalette(over: Partial<StagePalette>): StagePalette {
  return {
    sky: '#bfe3ee',
    fog: '#c8e6e8',
    floor: '#7ba05f',
    wall: '#4e5f42',
    obstacle: '#96ad5a',
    accent: '#c94f36',
    lightColor: '#fff2cf',
    lightIntensity: 1.5,
    ambientIntensity: 0.85,
    fogDensity: 0.011,
    emissiveAccent: false,
    ...over,
  };
}

// 設計 適用マップに沿ってオーサリングした 30 ステージの期待ムード(回帰ロック)。
// z01-z10 は R16 ゾンビステージ(荒廃した溶岩/灰の戦域): z03/z09 は曇天、他は夜。
const STAGE_MOOD: Record<string, MoodId> = {
  kunren: 'day',
  souko: 'overcast',
  nakaniwa: 'day',
  kairou: 'overcast',
  kouwan: 'overcast',
  takadai: 'dusk',
  sakyuu: 'day',
  setsugen: 'snow',
  koushou: 'night',
  yoichi: 'night',
  okujou: 'day',
  saisekiba: 'overcast',
  chikurin: 'day',
  tanada: 'dusk',
  misaki: 'day',
  haieki: 'overcast',
  kyokoku: 'day',
  kohan: 'overcast',
  kuko: 'dusk',
  onsengai: 'dusk',
  z01: 'night',
  z02: 'night',
  z03: 'overcast',
  z04: 'night',
  z05: 'night',
  z06: 'night',
  z07: 'night',
  z08: 'night',
  z09: 'overcast',
  z10: 'night',
};

const BIOME_MOOD: Record<string, MoodId> = {
  urban: 'day',
  industrial: 'overcast',
  desert: 'day',
  snow: 'snow',
  neon: 'night',
  verdant: 'day',
  harbor: 'overcast',
  dusk: 'dusk',
};

describe('resolveMood 分類の決定性', () => {
  it('明示ムードを最優先する', () => {
    const moods: MoodId[] = ['day', 'dusk', 'night', 'overcast', 'snow'];
    for (const m of moods) {
      expect(resolveMood(makePalette({ mood: m }))).toBe(m);
      // 明示ムードは他のシグナルを無視する(暗い空でも明示 day は day)
      expect(resolveMood(makePalette({ mood: m, sky: '#050508' }))).toBe(m);
    }
  });

  it('分類分岐: 雪 > 夜 > 夕 > 曇 > 昼', () => {
    // 雪: 深フォグ + 高明度の床
    expect(resolveMood(makePalette({ floor: '#f0f4f8', fogDensity: 0.03 }))).toBe('snow');
    // 夜(暗い空)
    expect(resolveMood(makePalette({ sky: '#101018', fogDensity: 0.02 }))).toBe('night');
    // 夜(発光アクセント + 低光量)
    expect(
      resolveMood(makePalette({ sky: '#556070', emissiveAccent: true, lightIntensity: 0.7 })),
    ).toBe('night');
    // 夕(低い太陽)
    expect(resolveMood(makePalette({ sky: '#a0b0c0', fogDensity: 0.01, elevation: 10 }))).toBe(
      'dusk',
    );
    // 曇(濁り高 + 青散乱低)
    expect(
      resolveMood(
        makePalette({ sky: '#889098', fogDensity: 0.015, elevation: 30, turbidity: 12, rayleigh: 1.0 }),
      ),
    ).toBe('overcast');
    // 昼(既定)
    expect(resolveMood(makePalette({ elevation: 50, turbidity: 4, rayleigh: 1.5 }))).toBe('day');
  });

  it('同じ入力で常に同じムード(純関数)', () => {
    for (const def of STAGES) {
      expect(resolveMood(def.palette)).toBe(resolveMood(def.palette));
    }
  });

  it('20ステージが 適用マップ通りのムードへ落ちる', () => {
    for (const def of STAGES) {
      expect(resolveMood(def.palette), def.id).toBe(STAGE_MOOD[def.id]);
    }
    // マップの網羅性(取りこぼし検出)
    expect(Object.keys(STAGE_MOOD).sort()).toEqual(STAGES.map((s) => s.id).sort());
  });

  it('mood未設定でもパレット値から既定ムードを導ける(後方互換)', () => {
    for (const def of STAGES) {
      const rest: StagePalette = { ...def.palette };
      delete rest.mood;
      const derived = resolveMood(rest);
      expect(['day', 'dusk', 'night', 'overcast', 'snow']).toContain(derived);
    }
  });

  it('8バイオームが 導出通りのムードへ落ちる(全シード決定的)', () => {
    for (const b of BIOMES) {
      for (const seed of [1, 7, 42, 1000, 65535]) {
        expect(resolveMood(generatePalette(mulberry32(seed), b)), b).toBe(BIOME_MOOD[b]);
      }
    }
  });
});

describe('resolveGrade', () => {
  it('ムード既定を返し、パレット上書きをマージする', () => {
    expect(resolveGrade('day', makePalette({}))).toEqual(MOOD_PRESETS.day.grade);
    const merged = resolveGrade('night', makePalette({ grade: { vignette: 0.55, chroma: 1.4 } }));
    expect(merged.vignette).toBe(0.55);
    expect(merged.chroma).toBe(1.4);
    // 上書きしていない項目はムード既定のまま
    expect(merged.contrast).toBe(MOOD_PRESETS.night.grade.contrast);
    expect(merged.tint).toEqual(MOOD_PRESETS.night.grade.tint);
  });
});

describe('MOOD_PRESETS', () => {
  it('5ムード全てが有効な grade を持つ', () => {
    for (const m of ['day', 'dusk', 'night', 'overcast', 'snow'] as MoodId[]) {
      const g = MOOD_PRESETS[m].grade;
      expect(g.tint).toHaveLength(3);
      expect(g.contrast).toBeGreaterThan(0);
      expect(g.saturation).toBeGreaterThan(0);
      expect(g.vignetteR).toBeGreaterThanOrEqual(0.72); // 中央を広く残す(可読性)
    }
  });
});

describe('insideBox', () => {
  const box: BoxSpec = { x: 0, y: 1, z: 0, w: 4, h: 2, d: 4, color: '#fff', emissive: false };
  it('AABB(+margin)内外を正しく判定する', () => {
    expect(insideBox(0, 0, box, 0)).toBe(true);
    expect(insideBox(1.9, 1.9, box, 0)).toBe(true);
    expect(insideBox(3, 3, box, 0)).toBe(false);
    // margin で外周が広がる
    expect(insideBox(2.4, 0, box, 0.6)).toBe(true);
    expect(insideBox(2.7, 0, box, 0.6)).toBe(false);
  });
});

describe('placeGrass', () => {
  const boxes: BoxSpec[] = [
    { x: 0, y: 1, z: 0, w: 10, h: 2, d: 10, color: '#fff', emissive: false },
    { x: 12, y: 1, z: -8, w: 6, h: 2, d: 6, color: '#fff', emissive: false },
    { x: -14, y: 1, z: 10, w: 8, h: 3, d: 4, color: '#fff', emissive: false },
  ];
  const half = 30;
  const margin = 0.6;

  it('全タフトが箱のAABB(+margin)を避ける', () => {
    const pts = placeGrass(mulberry32(0x6a55), half, 1500, boxes, margin);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      for (const b of boxes) {
        expect(insideBox(p.x, p.z, b, margin)).toBe(false);
      }
    }
  });

  it('全タフトが散布範囲 [-half+2, half-2] に収まる', () => {
    const pts = placeGrass(mulberry32(99), half, 800, boxes, margin);
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(half - 2 + 1e-9);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(half - 2 + 1e-9);
      expect(p.scale).toBeGreaterThanOrEqual(0.7);
      expect(p.scale).toBeLessThanOrEqual(1.3 + 1e-9);
    }
  });

  it('同じシードで同一配置(決定論)', () => {
    const a = placeGrass(mulberry32(7), half, 500, boxes, margin);
    const b = placeGrass(mulberry32(7), half, 500, boxes, margin);
    expect(a).toEqual(b);
  });

  it('要求本数を超えない', () => {
    const pts = placeGrass(mulberry32(3), half, 200, boxes, margin);
    expect(pts.length).toBeLessThanOrEqual(200);
  });
});

describe('Atmosphere API', () => {
  it('クラスとして export されている', () => {
    expect(typeof Atmosphere).toBe('function');
  });
});
