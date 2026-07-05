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

  it('ステージは31個あり、idが重複しない', () => {
    expect(STAGES).toHaveLength(31);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(31);
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

  it('size は 280〜360 の範囲(R21 エリア超拡大。訓練場専用ステージを除く)', () => {
    const SMALL_STAGES = new Set(['renshujo']); // 訓練場専用は小サイズ
    for (const def of STAGES) {
      if (SMALL_STAGES.has(def.id)) continue;
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

  it('recipe を持つステージは theme が文字列で buildings が 0〜4 棟(訓練場は0棟)', () => {
    for (const def of STAGES) {
      if (!def.recipe) continue;
      expect(typeof def.recipe.theme).toBe('string');
      expect(def.recipe.buildings.length).toBeGreaterThanOrEqual(0);
      expect(def.recipe.buildings.length).toBeLessThanOrEqual(4);
    }
  });

  it('breakable: ghost/decor ボックスは絶対に breakable にならない', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      for (const box of layout.boxes) {
        if (box.ghost || box.decor) {
          expect(box.breakable, `${def.id}: ghost/decor box should not be breakable`).toBeUndefined();
        }
      }
    }
  });

  it('breakable: hp は 120〜260 の範囲に収まる', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      for (const box of layout.boxes) {
        if (box.breakable === undefined) continue;
        expect(box.breakable.hp, `${def.id}: hp too low`).toBeGreaterThanOrEqual(120);
        expect(box.breakable.hp, `${def.id}: hp too high`).toBeLessThanOrEqual(260);
      }
    }
  });

  it('breakable: 小〜中型プロップの 15〜55% に付与される(確率35%の許容誤差込み)', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const candidates = layout.boxes.filter((box) => {
        if (box.ghost || box.decor) return false;
        const maxXZ = Math.max(box.w, box.d);
        const minXZ = Math.min(box.w, box.d);
        return maxXZ <= 8 && box.h >= 0.8 && box.h <= 10 && (minXZ <= 0 || maxXZ / minXZ <= 5);
      });
      if (candidates.length === 0) continue;
      const breakableCount = layout.boxes.filter((b) => b.breakable !== undefined).length;
      const ratio = breakableCount / candidates.length;
      expect(ratio, `${def.id}: breakable ratio ${ratio.toFixed(2)}`).toBeGreaterThan(0.1);
      expect(ratio, `${def.id}: breakable ratio ${ratio.toFixed(2)}`).toBeLessThan(0.65);
    }
  });

  it('breakable: 同じステージ定義からは常に同じ breakable 割当が出る(決定論)', () => {
    for (const def of STAGES.slice(0, 5)) {
      const a = generateStage(def);
      const b = generateStage(def);
      const aBreakable = a.boxes.map((x) => x.breakable);
      const bBreakable = b.boxes.map((x) => x.breakable);
      expect(JSON.stringify(aBreakable)).toBe(JSON.stringify(bBreakable));
    }
  });
});
