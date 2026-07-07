import { describe, expect, it } from 'vitest';
import { buildProp, generateStage, generateThemeObjects } from './stage';
import type { PropKind } from './stage';
import { mulberry32 } from '../core/rng';
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

// ── buildProp / generateThemeObjects テスト ────────────────────────────────

const ALL_PROP_KINDS: PropKind[] = [
  'conifer', 'broadleaf', 'deadtree', 'sakura', 'bamboo',
  'rock', 'towercrane', 'portalkrane', 'smokestack', 'gastank',
  'watertower', 'transformer', 'antenna', 'truck', 'derelictcar',
  'forklift', 'barricadecar', 'concretebarrier', 'fence', 'watchpost',
  'tankhull', 'scaffold', 'streetlight', 'signboard', 'bench',
  'vendingmachine', 'drumgroup', 'pallet', 'torii', 'stonelantern',
  'well', 'pier', 'utilitypole', 'rubble', 'gasbottlegroup', 'supplycrate',
];

describe('buildProp', () => {
  const PALETTE = STAGES[0]!.palette;
  const RAND = mulberry32(42);

  it('全36種が定義されており1個以上のBoxSpecを返す', () => {
    expect(ALL_PROP_KINDS).toHaveLength(36);
    for (const kind of ALL_PROP_KINDS) {
      const boxes = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      expect(boxes.length, `${kind}: ≥1 box`).toBeGreaterThanOrEqual(1);
    }
  });

  it('全ボックスに prop:true が付く', () => {
    for (const kind of ALL_PROP_KINDS) {
      const boxes = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      for (const box of boxes) {
        expect(box.prop, `${kind}: prop`).toBe(true);
      }
    }
  });

  it('h>3 のボックスに shadowCaster:true が付く / h<=3 には付かない', () => {
    for (const kind of ALL_PROP_KINDS) {
      const boxes = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      for (const box of boxes) {
        if (box.h > 3) {
          expect(box.shadowCaster, `${kind} h=${box.h}: shadowCaster`).toBe(true);
        } else {
          expect(box.shadowCaster, `${kind} h=${box.h}: no shadowCaster`).toBeUndefined();
        }
      }
    }
  });

  it('全ボックスの寸法が正の数', () => {
    for (const kind of ALL_PROP_KINDS) {
      const boxes = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      for (const box of boxes) {
        expect(box.w, `${kind}: w>0`).toBeGreaterThan(0);
        expect(box.h, `${kind}: h>0`).toBeGreaterThan(0);
        expect(box.d, `${kind}: d>0`).toBeGreaterThan(0);
      }
    }
  });

  it('大型プロップ(smokestack/towercrane/antenna/utilitypole/watertower)は少なくとも1ボックスにshadowCaster', () => {
    const large: PropKind[] = ['smokestack', 'towercrane', 'antenna', 'utilitypole', 'watertower'];
    for (const kind of large) {
      const boxes = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      expect(boxes.some((b) => b.shadowCaster === true), `${kind}: shadowCaster`).toBe(true);
    }
  });

  it('rot=0 と rot=2 で同じbox数を返す(回転対称)', () => {
    for (const kind of ALL_PROP_KINDS) {
      const b0 = buildProp(kind, 0, 0, 0, RAND, PALETTE);
      const b2 = buildProp(kind, 0, 0, 2, RAND, PALETTE);
      expect(b0.length, `${kind}: box count same for rot 0 and 2`).toBe(b2.length);
    }
  });
});

describe('generateThemeObjects', () => {
  it('同じdef+buildingPlacedからは常に同じ結果(決定論)', () => {
    for (const def of STAGES.slice(0, 6)) {
      const r1 = mulberry32(def.seed ^ 0x7e57ab1e);
      const r2 = mulberry32(def.seed ^ 0x7e57ab1e);
      const a = generateThemeObjects(def, [], r1);
      const b = generateThemeObjects(def, [], r2);
      expect(JSON.stringify(a), `${def.id}: determinism`).toBe(JSON.stringify(b));
    }
  });

  it('生成されたプロップは全て prop:true を持つ', () => {
    for (const def of STAGES) {
      const rand = mulberry32(def.seed ^ 0x7e57ab1e);
      const boxes = generateThemeObjects(def, [], rand);
      for (const box of boxes) {
        expect(box.prop, `${def.id}: prop`).toBe(true);
      }
    }
  });

  it('パイロット段階: 全ステージのプロップbox数が80以下', () => {
    // R41a: prop mergeにより実DC=1/ステージのため上限を80(旧40×2)へ緩和
    for (const def of STAGES) {
      const rand = mulberry32(def.seed ^ 0x7e57ab1e);
      const boxes = generateThemeObjects(def, [], rand);
      expect(boxes.length, `${def.id}: DC budget (${boxes.length} boxes)`).toBeLessThanOrEqual(80);
    }
  });

  it('プロップ(decorを除く)はステージ境界+2m以内に収まる', () => {
    for (const def of STAGES) {
      const half = def.size / 2;
      const rand = mulberry32(def.seed ^ 0x7e57ab1e);
      const boxes = generateThemeObjects(def, [], rand);
      for (const box of boxes) {
        if (box.decor) continue;
        expect(Math.abs(box.x) + box.w / 2, `${def.id}: x bound`).toBeLessThanOrEqual(half + 2);
        expect(Math.abs(box.z) + box.d / 2, `${def.id}: z bound`).toBeLessThanOrEqual(half + 2);
      }
    }
  });

  it('generateStage に統合後も全体の決定論は保たれる', () => {
    for (const def of STAGES.slice(0, 5)) {
      const a = generateStage(def);
      const b = generateStage(def);
      expect(JSON.stringify(a), `${def.id}: generateStage determinism`).toBe(JSON.stringify(b));
    }
  });

  it('objects未設定ステージも含め全ステージで0エラー', () => {
    for (const def of STAGES) {
      const rand = mulberry32(def.seed ^ 0x7e57ab1e);
      expect(() => generateThemeObjects(def, [], rand)).not.toThrow();
    }
  });
});
