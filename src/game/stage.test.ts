import { describe, expect, it } from 'vitest';
import { generateStage } from './stage';
import { STAGES } from './stages';

describe('generateStage', () => {
  it('同じ定義からは常に同じレイアウトが出る', () => {
    for (const def of STAGES) {
      const a = generateStage(def);
      const b = generateStage(def);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('全ステージで不可視境界壁4枚(ghost=true)とスポーン地点が揃う', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      // ghost=true の壁が 4 枚あること(不可視境界コライダーリング)
      const ghostWalls = layout.boxes.filter((box) => box.ghost === true);
      expect(ghostWalls.length).toBeGreaterThanOrEqual(4);
      // 色は palette.wall で識別可能であること
      const wallColorBoxes = layout.boxes.filter((box) => box.color === def.palette.wall);
      expect(wallColorBoxes.length).toBeGreaterThanOrEqual(4);
      expect(layout.playerSpawns).toHaveLength(4);
      expect(layout.botSpawns.length).toBeGreaterThanOrEqual(def.botCount);
    }
  });

  it('通常障害物と建造物はステージ境界の内側に収まる', () => {
    for (const def of STAGES) {
      const half = def.size / 2;
      const layout = generateStage(def);
      for (const box of layout.boxes) {
        // ghost(不可視境界壁)と decor(装飾)はチェック対象外
        if (box.ghost || box.decor) continue;
        expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(half + 1);
        expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(half + 1);
      }
    }
  });

  it('ステージは30個あり、idが重複しない', () => {
    expect(STAGES).toHaveLength(30);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(30);
  });

  it('seedが重複しない(レイアウトの独自性を保証)', () => {
    expect(new Set(STAGES.map((s) => s.seed)).size).toBe(STAGES.length);
  });

  it('パレットの全色が #rrggbb 形式', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const def of STAGES) {
      const { sky, fog, floor, wall, obstacle, accent, lightColor } = def.palette;
      for (const color of [sky, fog, floor, wall, obstacle, accent, lightColor]) {
        expect(color, `${def.id}: ${color}`).toMatch(hex);
      }
    }
  });

  it('日差しが安全域に収まる(elevation 12〜62 / exposure 0.85〜1.15 / fogDensity>0)', () => {
    for (const def of STAGES) {
      const { elevation, exposure, fogDensity } = def.palette;
      expect(elevation, `${def.id}: elevation`).toBeGreaterThanOrEqual(12);
      expect(elevation, `${def.id}: elevation`).toBeLessThanOrEqual(62);
      expect(exposure, `${def.id}: exposure`).toBeGreaterThanOrEqual(0.85);
      expect(exposure, `${def.id}: exposure`).toBeLessThanOrEqual(1.15);
      expect(fogDensity, `${def.id}: fogDensity`).toBeGreaterThan(0);
    }
  });

  it('size は 280〜360 の範囲(R21 エリア超拡大)', () => {
    for (const def of STAGES) {
      expect(def.size, `${def.id}: size`).toBeGreaterThanOrEqual(280);
      expect(def.size, `${def.id}: size`).toBeLessThanOrEqual(360);
    }
  });

  it('プレイヤー・BOTどちらのスポーン地点付近にも通常障害物を置かない', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
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
  });

  it('recipe を持つステージは theme が文字列で buildings が 1〜4 棟', () => {
    for (const def of STAGES) {
      if (!def.recipe) continue;
      expect(typeof def.recipe.theme).toBe('string');
      expect(def.recipe.buildings.length).toBeGreaterThanOrEqual(1);
      expect(def.recipe.buildings.length).toBeLessThanOrEqual(4);
    }
  });
});
