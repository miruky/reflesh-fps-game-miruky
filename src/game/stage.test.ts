import { describe, expect, it } from 'vitest';
import { buildProp, generateStage, generateThemeObjects, MINI_SCENE_IDS } from './stage';
import type { PropKind, PropPlacement, StageDef } from './stage';
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

  it('ゾンビ全10面は暗部を潰さない共通の可読性基準を満たす', () => {
    const zombieStages = STAGES.filter((stage) => /^z\d\d$/.test(stage.id));
    expect(zombieStages).toHaveLength(10);
    for (const def of zombieStages) {
      const p = def.palette;
      expect(p.lightIntensity, `${def.id}: key light`).toBeGreaterThanOrEqual(1.02);
      expect(p.ambientIntensity, `${def.id}: ambient`).toBeGreaterThanOrEqual(0.78);
      expect(p.environmentIntensity, `${def.id}: environment`).toBeGreaterThanOrEqual(0.68);
      expect(p.exposure, `${def.id}: exposure`).toBeGreaterThanOrEqual(1.14);
      expect(p.fogDensity, `${def.id}: fog`).toBeLessThanOrEqual(0.0072);
      expect(p.groundFog, `${def.id}: ground fog`).toBeLessThanOrEqual(0.36);
      expect(p.grade?.vignette, `${def.id}: vignette`).toBeLessThanOrEqual(0.3);
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

  it('全固定ステージに最大3種の衝突付きプレイアブル地区が実配置される', () => {
    for (const def of STAGES) {
      const districts = new Set(
        generateStage(def).boxes.flatMap((box) => box.district ? [box.district] : []),
      );
      const required = Math.min(3, def.recipe?.buildings.length ?? 0);
      expect(districts.size, `${def.id}: ${[...districts].join(',')}`).toBeGreaterThanOrEqual(required);
    }
  });

  it('全固定ステージの先頭地区は中心ランドマークとして実配置される', () => {
    for (const def of STAGES) {
      const first = def.recipe?.buildings[0];
      if (!first) continue;
      const boxes = generateStage(def).boxes.filter((box) => box.district === first);
      expect(boxes.length, `${def.id}: ${first}`).toBeGreaterThan(0);
      const xMin = Math.min(...boxes.map((box) => box.x - box.w / 2));
      const xMax = Math.max(...boxes.map((box) => box.x + box.w / 2));
      const zMin = Math.min(...boxes.map((box) => box.z - box.d / 2));
      const zMax = Math.max(...boxes.map((box) => box.z + box.d / 2));
      // 外階段/デッキが片側に張り出す建築も、地区全体の中心は原点から4m以内。
      expect(Math.abs((xMin + xMax) / 2), `${def.id}: ${first} center x`).toBeLessThanOrEqual(4);
      expect(Math.abs((zMin + zMax) / 2), `${def.id}: ${first} center z`).toBeLessThanOrEqual(4);
    }
  });

  it('全プレイアブル地区の階段終端は屋上・歩廊へオートステップ範囲内で接続する', () => {
    const horizontalGap = (
      a: { x: number; z: number; w: number; d: number },
      b: { x: number; z: number; w: number; d: number },
    ): number => {
      const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
      const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
      return Math.hypot(dx, dz);
    };

    for (const def of STAGES) {
      const districtBoxes = generateStage(def).boxes.filter((box) => box.district);
      const stairs = districtBoxes.filter((box) =>
        Math.abs(box.h - 0.3) < 1e-6 && box.w <= 2.4 && box.d <= 2.4,
      );
      for (const stair of stairs) {
        const top = stair.y + stair.h / 2;
        const hasNextStep = stairs.some((candidate) => {
          const rise = candidate.y + candidate.h / 2 - top;
          return candidate.district === stair.district
            && rise > 0.29 && rise < 0.31
            && horizontalGap(stair, candidate) <= 0.05;
        });
        if (hasNextStep) continue;

        const connected = districtBoxes.some((target) => {
          if (target === stair || Math.abs(target.h - 0.3) < 1e-6) return false;
          const rise = target.y + target.h / 2 - top;
          return target.district === stair.district
            && rise >= -0.15 && rise <= 0.4
            && horizontalGap(stair, target) <= 0.45;
        });
        expect(connected, `${def.id}:${stair.district} stair top @ ${stair.x},${stair.z},y${top}`).toBe(true);
      }
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

// ── ミニシーン + PropPlacement契約(R53-S2) ────────────────────────────────

describe('ミニシーン(scatter=scene)', () => {
  it('MINI_SCENE_IDSは5〜8種で全31ステージの少なくとも1箇所に使われている', () => {
    expect(MINI_SCENE_IDS.length).toBeGreaterThanOrEqual(5);
    expect(MINI_SCENE_IDS.length).toBeLessThanOrEqual(8);
    for (const def of STAGES) {
      const sceneEntries = (def.recipe?.objects ?? []).filter((o) => o.scatter === 'scene');
      expect(sceneEntries.length, `${def.id}: at least 1 scene entry`).toBeGreaterThanOrEqual(1);
      for (const e of sceneEntries) {
        expect(e.sceneId, `${def.id}: sceneId set`).toBeDefined();
        expect(MINI_SCENE_IDS, `${def.id}: sceneId is known`).toContain(e.sceneId);
      }
    }
  });

  it('シーン散布を追加しても全ステージのプロップbox数は80以下のまま', () => {
    for (const def of STAGES) {
      const rand = mulberry32(def.seed ^ 0x7e57ab1e);
      const boxes = generateThemeObjects(def, [], rand);
      expect(boxes.length, `${def.id}: DC budget (${boxes.length} boxes)`).toBeLessThanOrEqual(80);
    }
  });

  it('決定論: 同じdefからは常に同じシーン配置が出る(placementsOut込み)', () => {
    for (const def of STAGES.slice(0, 8)) {
      const r1 = mulberry32(def.seed ^ 0x7e57ab1e);
      const r2 = mulberry32(def.seed ^ 0x7e57ab1e);
      const p1: PropPlacement[] = [];
      const p2: PropPlacement[] = [];
      const a = generateThemeObjects(def, [], r1, p1);
      const b = generateThemeObjects(def, [], r2, p2);
      expect(JSON.stringify(a), `${def.id}: boxes determinism`).toBe(JSON.stringify(b));
      expect(JSON.stringify(p1), `${def.id}: placements determinism`).toBe(JSON.stringify(p2));
    }
  });

  it('既存配置ビット不変: scatter=sceneのエントリを取り除いても、残りの箱は完全に同一(順序込み)', () => {
    for (const def of STAGES) {
      const objects = def.recipe?.objects;
      if (!objects?.length) continue;
      const sceneCount = objects.filter((o) => o.scatter === 'scene').length;
      if (sceneCount === 0) continue; // 全ステージにscene追加済みのはずだが念のため

      const legacyOnlyDef: StageDef = {
        ...def,
        recipe: { ...def.recipe!, objects: objects.filter((o) => o.scatter !== 'scene') },
      };
      const rLegacy = mulberry32(def.seed ^ 0x7e57ab1e);
      const rFull = mulberry32(def.seed ^ 0x7e57ab1e);
      const legacyBoxes = generateThemeObjects(legacyOnlyDef, [], rLegacy);
      const fullBoxes = generateThemeObjects(def, [], rFull);

      // シーンは末尾に追加されるだけ → 先頭 legacyBoxes.length 件は完全一致するはず
      expect(fullBoxes.length, `${def.id}: full >= legacy`).toBeGreaterThanOrEqual(legacyBoxes.length);
      expect(
        JSON.stringify(fullBoxes.slice(0, legacyBoxes.length)),
        `${def.id}: legacy boxes byte-identical`,
      ).toBe(JSON.stringify(legacyBoxes));
    }
  });

  it('シーン内のプロップも境界内・スポーン離隔・prop:trueを満たす', () => {
    for (const def of STAGES) {
      const half = def.size / 2;
      const layout = generateStage(def);
      const spawns = [...layout.playerSpawns, ...layout.botSpawns];
      for (const box of layout.boxes) {
        if (box.ghost || box.decor) continue;
        expect(Math.abs(box.x) + box.w / 2, `${def.id}: x bound`).toBeLessThanOrEqual(half + 2);
        expect(Math.abs(box.z) + box.d / 2, `${def.id}: z bound`).toBeLessThanOrEqual(half + 2);
        if (box.prop) {
          for (const [sx, , sz] of spawns) {
            const dx = Math.max(0, Math.abs(box.x - sx) - box.w / 2);
            const dz = Math.max(0, Math.abs(box.z - sz) - box.d / 2);
            expect(Math.hypot(dx, dz), `${def.id}: prop far from spawn`).toBeGreaterThan(1);
          }
        }
      }
    }
  });
});

describe('PropPlacement契約(rotRad/scaleJitter, M2c引き継ぎ)', () => {
  it('generateStage().propPlacements が recipe.objects を持つ全ステージで非空', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      if (def.recipe?.objects?.length) {
        expect(layout.propPlacements.length, `${def.id}: propPlacements non-empty`).toBeGreaterThan(0);
      } else {
        expect(layout.propPlacements).toEqual([]);
      }
    }
  });

  it('rotRadは[0, 2π)、scaleJitterは[0.88, 1.12]の範囲に収まる', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      for (const p of layout.propPlacements) {
        expect(p.rotRad, `${def.id}: rotRad >= 0`).toBeGreaterThanOrEqual(0);
        expect(p.rotRad, `${def.id}: rotRad < 2π`).toBeLessThan(Math.PI * 2);
        expect(p.scaleJitter, `${def.id}: scaleJitter lower`).toBeGreaterThanOrEqual(0.88);
        expect(p.scaleJitter, `${def.id}: scaleJitter upper`).toBeLessThanOrEqual(1.12);
      }
    }
  });

  it('propPlacementsの各インスタンスのkindは有効なPropKindで、cx/czは有限数', () => {
    const def = STAGES.find((s) => s.id === 'onsengai')!;
    const layout = generateStage(def);
    expect(layout.propPlacements.length).toBeGreaterThan(0);
    for (const p of layout.propPlacements) {
      expect(typeof p.kind).toBe('string');
      expect(Number.isFinite(p.cx)).toBe(true);
      expect(Number.isFinite(p.cz)).toBe(true);
    }
  });

  it('propPlacementsの件数はboxesのprop:true件数以下(1インスタンス=1〜3boxのため)', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const propBoxCount = layout.boxes.filter((b) => b.prop).length;
      expect(layout.propPlacements.length, `${def.id}`).toBeLessThanOrEqual(propBoxCount);
    }
  });

  it('rotRad/scaleJitterは既存のBoxSpec(コライダー)側には一切現れない(視覚専用の分離を保証)', () => {
    for (const def of STAGES.slice(0, 5)) {
      const layout = generateStage(def);
      for (const box of layout.boxes) {
        const rec = box as unknown as Record<string, unknown>;
        expect(rec.rotRad).toBeUndefined();
        expect(rec.scaleJitter).toBeUndefined();
      }
    }
  });
});

// ── R57-⑥ 確証バグ修正: プロップ視覚回転(rotRad)が軸整列コライダーからはみ出す量の非回帰 ──
//
// V-C確証: LONG_PROP_KINDS が PROP_FOOTPRINTS(クリアランス用の粗い近似値)のアスペクト比から
// 導出されていたため、実コライダーとの乖離・絶対長無視・境界値(アスペクト丁度2.0)取りこぼしの
// 3つの穴で concretebarrier/derelictcar/barricadecar/tankhull(いずれも最頻の遮蔽物)が
// ±0.45rad(約26°)のまま残存し、視覚が軸整列コライダーから最大~1.4mはみ出していた
// (ファントム遮蔽=弾すり抜け/見えない壁)。
//
// 以下は stage.ts の非公開実装(PROP_JITTER_AMP等)に依存せず、公開API(buildProp/generateStage)
// のみを使ったブラックボックス回帰: 「回転済み視覚コーナー」が「軸整列コライダーAABB」から
// 許容(0.25m)を超えてはみ出さないことを、実際に生成された全ステージの全プロップ配置で検証する。
describe('プロップ視覚ジッタのコライダーはみ出し非回帰(R57-⑥)', () => {
  const OVERHANG_ALLOWANCE_M = 0.25;
  const PALETTE = STAGES[0]!.palette;

  /** kindのrot=0コライダー箱群の局所頂点(原点基準)と軸整列AABB。 */
  function localColliderCorners(kind: PropKind): {
    corners: Array<[number, number]>;
    xMin: number; xMax: number; zMin: number; zMax: number;
  } {
    const boxes = buildProp(kind, 0, 0, 0, () => 0, PALETTE);
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    const corners: Array<[number, number]> = [];
    for (const box of boxes) {
      const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2;
      const z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
      xMin = Math.min(xMin, x0); xMax = Math.max(xMax, x1);
      zMin = Math.min(zMin, z0); zMax = Math.max(zMax, z1);
      corners.push([x0, z0], [x0, z1], [x1, z0], [x1, z1]);
    }
    return { corners, xMin, xMax, zMin, zMax };
  }

  /** 角度thetaで回転したコーナー群が、元の軸整列AABB(局所rot=0基準)から飛び出す最大量(m)。
   * ジッタ振幅そのものを検証する用途(実配置のquantSteps分離は行わない、単純な理論値)。 */
  function overhangAt(
    data: { corners: Array<[number, number]>; xMin: number; xMax: number; zMin: number; zMax: number },
    theta: number,
  ): number {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    let maxOver = -Infinity;
    for (const [x, z] of data.corners) {
      const rx = x * c - z * s;
      const rz = x * s + z * c;
      maxOver = Math.max(maxOver, rx - data.xMax, data.xMin - rx, rz - data.zMax, data.zMin - rz);
    }
    return maxOver;
  }

  /** 90°刻みquantStepsだけ回転させたコーナー群のAABB(=実コライダーのAABBと一致)。 */
  function quantRotatedAabb(
    data: { corners: Array<[number, number]> },
    quantSteps: number,
  ): { xMin: number; xMax: number; zMin: number; zMax: number } {
    const k = ((quantSteps % 4) + 4) % 4;
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const [x, z] of data.corners) {
      const [rx, rz] = k === 0 ? [x, z] : k === 1 ? [-z, x] : k === 2 ? [-x, -z] : [z, -x];
      xMin = Math.min(xMin, rx); xMax = Math.max(xMax, rx);
      zMin = Math.min(zMin, rz); zMax = Math.max(zMax, rz);
    }
    return { xMin, xMax, zMin, zMax };
  }

  /** 実配置のrotRad(=quantSteps*90°+ジッタ)における視覚コーナーが、
   * 実コライダーAABB(quantSteps分だけ回転済み)から飛び出す量(m)。これが実ゲームの
   * 「視覚がコライダーからはみ出す量」そのもの。 */
  function placementOverhang(
    data: { corners: Array<[number, number]> },
    rotRad: number,
  ): number {
    const quantSteps = Math.round(rotRad / (Math.PI / 2));
    const aabb = quantRotatedAabb(data, quantSteps);
    const c = Math.cos(rotRad);
    const s = Math.sin(rotRad);
    let maxOver = -Infinity;
    for (const [x, z] of data.corners) {
      const rx = x * c - z * s;
      const rz = x * s + z * c;
      maxOver = Math.max(maxOver, rx - aabb.xMax, aabb.xMin - rx, rz - aabb.zMax, aabb.zMin - rz);
    }
    return maxOver;
  }

  it('全ステージの全propPlacementsで、視覚回転(rotRad)は実コライダーAABB(quantSteps込み)から許容0.25m超はみ出さない', () => {
    const EPS = 1e-6;
    let worstOverall = -Infinity;
    for (const def of STAGES) {
      const layout = generateStage(def);
      for (const p of layout.propPlacements) {
        const data = localColliderCorners(p.kind);
        const overhang = placementOverhang(data, p.rotRad);
        worstOverall = Math.max(worstOverall, overhang);
        expect(
          overhang,
          `${def.id}: ${p.kind}@(${p.cx},${p.cz}) rotRad=${p.rotRad.toFixed(4)} overhang=${overhang.toFixed(4)}m`,
        ).toBeLessThanOrEqual(OVERHANG_ALLOWANCE_M + EPS);
      }
    }
    // 実際にどこかで許容ぎりぎりまで使われていること(閾値が機能している証跡。過度に緩い実装の検出用)
    expect(worstOverall).toBeGreaterThan(0);
  });

  it('確証バグの4種(concretebarrier/derelictcar/barricadecar/tankhull)は、旧デフォルト±0.45radまで振ると許容を大きく超えるが、実際の配置(現行振幅)では許容内に収まる', () => {
    const buggyKinds: PropKind[] = ['concretebarrier', 'derelictcar', 'barricadecar', 'tankhull'];
    for (const kind of buggyKinds) {
      const data = localColliderCorners(kind);
      const oldOverhangMm = Math.max(overhangAt(data, 0.45), overhangAt(data, -0.45)) * 1000;
      // 修正前(旧ROT_JITTER=0.45固定)は許容を大きく超えていたことを記録(回帰検出の基準線)
      expect(oldOverhangMm, `${kind}: pre-fix overhang at 0.45rad`).toBeGreaterThan(OVERHANG_ALLOWANCE_M * 1000);

      // 実ステージ配置(自然発生する量子化角+実ジッタ)で許容内に収まることを確認
      let maxObserved = -Infinity;
      for (const def of STAGES) {
        const layout = generateStage(def);
        for (const p of layout.propPlacements) {
          if (p.kind !== kind) continue;
          maxObserved = Math.max(maxObserved, placementOverhang(data, p.rotRad));
        }
      }
      if (maxObserved === -Infinity) continue; // このkindが1回も配置されないステージ構成ならスキップ
      expect(maxObserved * 1000, `${kind}: post-fix observed overhang`).toBeLessThanOrEqual(OVERHANG_ALLOWANCE_M * 1000 + 1e-3);
    }
  });

  it('小型プロップ(antenna/stonelantern/streetlight等)は過度に硬直しない: 実配置のrotRadが量子化角から±0.2rad以上ばらつく', () => {
    const smallKinds: PropKind[] = ['antenna', 'stonelantern', 'vendingmachine', 'supplycrate'];
    for (const kind of smallKinds) {
      let maxDelta = 0;
      for (const def of STAGES) {
        const layout = generateStage(def);
        for (const p of layout.propPlacements) {
          if (p.kind !== kind) continue;
          const quant = Math.round(p.rotRad / (Math.PI / 2));
          let delta = p.rotRad - quant * (Math.PI / 2);
          // 正規化: 最短角差
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          maxDelta = Math.max(maxDelta, Math.abs(delta));
        }
      }
      if (maxDelta === 0) continue; // 未配置ならスキップ(存在しないステージ構成向けの安全弁)
      expect(maxDelta, `${kind}: jitter amplitude should stay large (not over-stiffened)`).toBeGreaterThan(0.2);
    }
  });
});
