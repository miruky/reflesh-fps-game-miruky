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

  it('全ステージで外周壁4枚とスポーン地点が揃う', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const walls = layout.boxes.filter((box) => box.color === def.palette.wall);
      expect(walls.length).toBeGreaterThanOrEqual(4);
      expect(layout.playerSpawns).toHaveLength(4);
      expect(layout.botSpawns.length).toBeGreaterThanOrEqual(def.botCount);
    }
  });

  it('障害物はステージ境界の内側に収まる', () => {
    for (const def of STAGES) {
      const half = def.size / 2;
      const layout = generateStage(def);
      for (const box of layout.boxes) {
        // 外周壁は境界上にあるので除く
        if (box.color === def.palette.wall && box.h >= 5) continue;
        expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(half + 1);
        expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(half + 1);
      }
    }
  });

  it('ステージは10個あり、idが重複しない', () => {
    expect(STAGES).toHaveLength(10);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(10);
  });

  it('プレイヤー・BOTどちらのスポーン地点付近にも障害物を置かない', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const spawns = [...layout.playerSpawns, ...layout.botSpawns];
      for (const [sx, , sz] of spawns) {
        for (const box of layout.boxes) {
          if (box.color === def.palette.wall && box.h >= 5) continue;
          const dx = Math.max(0, Math.abs(box.x - sx) - box.w / 2);
          const dz = Math.max(0, Math.abs(box.z - sz) - box.d / 2);
          expect(Math.hypot(dx, dz)).toBeGreaterThan(1);
        }
      }
    }
  });
});
