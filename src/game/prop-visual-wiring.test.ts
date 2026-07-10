// R53-W2 M2c: プロップ超リアル化v2の match.ts 配線ロジックのテスト。
// - buildStageScene 自体は THREE.WebGLRenderer/RAPIER の実初期化を要するため
//   (このリポジトリに Match を直接構築するテストは無い。他の match.ts テストと同様、
//   配線ロジックを純関数として抽出しユニット/実データ統合の両面で検証する)。
// - planPropVisualsV2: boxes↔propPlacements の突き合わせ(v2適用判定/breakable除外)。
// - buildPropVisualFamilyGeometries: family別1メッシュ化・DC予算(<=7)・shadow itemSize分離。
// - buildPropFamilyMaterial / propFamilyShadowFlags: family→マテリアル/シャドウフラグの分岐。
// - prewarmSurfaceKitVariants: R11 dissolve教訓のプリウォーム(モックrendererで呼び出し検証)。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  planPropVisualsV2,
  buildPropVisualFamilyGeometries,
  buildPropFamilyMaterial,
  floorDetailEligible,
  propFamilyShadowFlags,
  prewarmSurfaceKitVariants,
  type PrewarmRenderer,
} from './match';
import { buildProp, generateStage, type PropPlacement, type StagePalette } from './stage';
import { STAGES } from './stages';
import { PROP_VISUAL_KINDS, type PropMatFamily } from '../render/prop-visuals';
import { SURFACE_KIT_IDS } from '../render/surface-kit';
import { mulberry32 } from '../core/rng';

const PALETTE: StagePalette = {
  sky: '#88aacc',
  fog: '#556677',
  floor: '#3a3a3a',
  wall: '#666666',
  obstacle: '#7a6a55',
  accent: '#ffaa33',
  lightColor: '#ffffff',
  lightIntensity: 1,
  ambientIntensity: 0.4,
  fogDensity: 0.012,
  emissiveAccent: true,
};

const PALETTE_NO_GLOW: StagePalette = { ...PALETTE, emissiveAccent: false };

describe('planPropVisualsV2: 合成フィクスチャでの厳密な対応付け', () => {
  it('breakableが無ければ全インスタンスがv2対象になり、全boxがskip対象になる', () => {
    const rockBoxes = buildProp('rock', 10, 10, 0, () => 0, PALETTE); // 1箱
    const toriiBoxes = buildProp('torii', -20, -20, 1, () => 0, PALETTE); // 3箱
    const placements: PropPlacement[] = [
      { kind: 'rock', cx: 10, cz: 10, rotRad: 0, scaleJitter: 1 },
      // rotSteps=1 は π/2+0.3(ジッタ込み想定) からも正しく復元できることを確認
      { kind: 'torii', cx: -20, cz: -20, rotRad: Math.PI / 2 + 0.3, scaleJitter: 1 },
    ];
    const boxes = [...rockBoxes, ...toriiBoxes];
    const { v2Placements, skipBoxes } = planPropVisualsV2(placements, boxes, PALETTE);
    expect(v2Placements).toEqual(placements);
    expect(skipBoxes.size).toBe(4);
    for (const b of boxes) expect(skipBoxes.has(b)).toBe(true);
  });

  it('1箱でもbreakableが付与されたインスタンスは丸ごとv2対象外(旧経路のまま)', () => {
    const rockBoxes = buildProp('rock', 10, 10, 0, () => 0, PALETTE);
    const toriiBoxes = buildProp('torii', -20, -20, 1, () => 0, PALETTE);
    toriiBoxes[0]!.breakable = { hp: 150 }; // 柱の1本を破壊可能化(実ゲームのstep⑥相当を模擬)
    const placements: PropPlacement[] = [
      { kind: 'rock', cx: 10, cz: 10, rotRad: 0, scaleJitter: 1 },
      { kind: 'torii', cx: -20, cz: -20, rotRad: Math.PI / 2, scaleJitter: 1 },
    ];
    const boxes = [...rockBoxes, ...toriiBoxes];
    const { v2Placements, skipBoxes } = planPropVisualsV2(placements, boxes, PALETTE);
    expect(v2Placements).toEqual([placements[0]]);
    expect(skipBoxes.size).toBe(1);
    expect(skipBoxes.has(rockBoxes[0]!)).toBe(true);
    for (const b of toriiBoxes) expect(skipBoxes.has(b)).toBe(false);
  });

  it('未実装kind(将来拡張の防御的フォールバック)はv2対象外', () => {
    const boxes = buildProp('rock', 0, 0, 0, () => 0, PALETTE);
    const placements = [
      { kind: 'not-a-real-kind' as PropPlacement['kind'], cx: 0, cz: 0, rotRad: 0, scaleJitter: 1 },
    ];
    // buildProp('not-a-real-kind', ...) は switch default で [] を返す想定だが、
    // ここでは PROP_VISUAL_KINDS 側の判定のみを確かめたいので実際のboxesは無関係。
    const { v2Placements, skipBoxes } = planPropVisualsV2(placements, boxes, PALETTE);
    expect(v2Placements).toEqual([]);
    expect(skipBoxes.size).toBe(0);
  });

  it('空配列を渡せば何も起きない', () => {
    const { v2Placements, skipBoxes } = planPropVisualsV2([], [], PALETTE);
    expect(v2Placements).toEqual([]);
    expect(skipBoxes.size).toBe(0);
  });
});

describe('planPropVisualsV2: 実ステージ31種での不変条件', () => {
  it('skipBoxesに breakable な箱は一つも含まれない(破壊時メッシュ除去が必要なため除外済み)', () => {
    let checked = 0;
    for (const def of STAGES) {
      const layout = generateStage(def);
      const { skipBoxes } = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
      for (const b of skipBoxes) {
        expect(b.breakable, `${def.id}: breakable box leaked into skipBoxes`).toBeUndefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0); // 何もチェックせず素通りしていないことの保証
  });

  it('skipBoxesはprop:trueな箱のみ・全箱数を超えない(取り違えなし)', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const { skipBoxes } = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
      const propBoxCount = layout.boxes.filter((b) => b.prop === true).length;
      expect(skipBoxes.size).toBeLessThanOrEqual(propBoxCount);
      for (const b of skipBoxes) expect(b.prop).toBe(true);
    }
  });

  it('v2Placementsは常にpropPlacementsの部分集合', () => {
    for (const def of STAGES) {
      const layout = generateStage(def);
      const { v2Placements } = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
      for (const p of v2Placements) expect(layout.propPlacements).toContain(p);
      expect(v2Placements.length).toBeLessThanOrEqual(layout.propPlacements.length);
    }
  });

  it('同じ入力からは常に同じ結果(決定論)', () => {
    const def = STAGES[0]!;
    const layout = generateStage(def);
    const a = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
    const b = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
    expect(a.v2Placements).toEqual(b.v2Placements);
    expect(a.skipBoxes.size).toBe(b.skipBoxes.size);
  });
});

describe('buildPropVisualFamilyGeometries: family別マージ + DC予算', () => {
  it('空のplacementsは空オブジェクトを返す', () => {
    const result = buildPropVisualFamilyGeometries([], PALETTE, mulberry32(1));
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('全PropMatFamily(最大7種)以内に収まる — DC予算+8以内をmesh数で固定(プランナー#7)', () => {
    // ?perfhud=1 でランタイムのdraw call実測も確認できる。ここではfamily数の上限
    // (=v2が生成するmesh数の上限)を静的に固定する。7 = metal/wood/stone/foliage/paint/
    // accent/shadow の全種。旧経路(色キー毎のマージ+shadowCaster個別メッシュ)を丸ごと
    // 置き換える側なので、正味のDC変化は+7以下(実際は旧draw call削減により通常マイナス)。
    for (const def of STAGES) {
      const layout = generateStage(def);
      const { v2Placements } = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
      const rand = mulberry32(def.seed ^ 0x53a1e42c);
      const families = buildPropVisualFamilyGeometries(v2Placements, def.palette, rand);
      const keys = Object.keys(families);
      expect(keys.length, def.id).toBeLessThanOrEqual(7);
      const allowed = new Set(['metal', 'wood', 'stone', 'foliage', 'paint', 'accent', 'shadow']);
      for (const k of keys) expect(allowed.has(k), `${def.id}: unexpected family ${k}`).toBe(true);
    }
  });

  it('shadowファミリのみ頂点色itemSize=4(RGBA)、他は3(RGB) — 属性不一致マージ事故の防止', () => {
    let sawShadow = false;
    let sawOther = false;
    for (const def of STAGES) {
      const layout = generateStage(def);
      const { v2Placements } = planPropVisualsV2(layout.propPlacements, layout.boxes, def.palette);
      const rand = mulberry32(def.seed ^ 0x53a1e42c);
      const families = buildPropVisualFamilyGeometries(v2Placements, def.palette, rand);
      for (const key of Object.keys(families) as PropMatFamily[]) {
        const geo = families[key];
        if (!geo) continue;
        const color = geo.getAttribute('color');
        expect(color).toBeDefined();
        if (key === 'shadow') {
          expect(color.itemSize).toBe(4);
          sawShadow = true;
        } else {
          expect(color.itemSize).toBe(3);
          sawOther = true;
        }
      }
    }
    expect(sawShadow).toBe(true);
    expect(sawOther).toBe(true);
  });

  it('各ファミリのジオメトリは非インデックス化・position属性を持つ(mergeGeometries安全性)', () => {
    const placements: PropPlacement[] = [
      { kind: 'rock', cx: 0, cz: 0, rotRad: 0, scaleJitter: 1 },
      { kind: 'conifer', cx: 20, cz: 5, rotRad: 0.4, scaleJitter: 1.05 },
    ];
    const families = buildPropVisualFamilyGeometries(placements, PALETTE, mulberry32(77));
    expect(Object.keys(families).length).toBeGreaterThan(0);
    for (const key of Object.keys(families) as PropMatFamily[]) {
      const geo = families[key]!;
      expect(geo.index).toBeNull();
      expect(geo.getAttribute('position')).toBeDefined();
    }
  });

  it('同一seed・同一placementsなら決定論的に同じ頂点総数になる', () => {
    const placements: PropPlacement[] = [
      { kind: 'truck', cx: 5, cz: -5, rotRad: 0.2, scaleJitter: 0.97 },
      { kind: 'bench', cx: -8, cz: 8, rotRad: 1.1, scaleJitter: 1.03 },
    ];
    const totalVerts = (fam: Partial<Record<PropMatFamily, THREE.BufferGeometry>>): number =>
      Object.values(fam).reduce((sum, g) => sum + (g ? g.getAttribute('position').count : 0), 0);
    const a = buildPropVisualFamilyGeometries(placements, PALETTE, mulberry32(999));
    const b = buildPropVisualFamilyGeometries(placements, PALETTE, mulberry32(999));
    expect(totalVerts(a)).toBe(totalVerts(b));
    expect(totalVerts(a)).toBeGreaterThan(0);
  });

  it('全36 PROP_VISUAL_KINDS を1個ずつ渡しても例外なく完走する', () => {
    const placements: PropPlacement[] = PROP_VISUAL_KINDS.map((kind, i) => ({
      kind: kind as PropPlacement['kind'],
      cx: (i % 6) * 12,
      cz: Math.floor(i / 6) * 12,
      rotRad: (i * 0.37) % (Math.PI * 2),
      scaleJitter: 1 + ((i % 5) - 2) * 0.03,
    }));
    expect(() => buildPropVisualFamilyGeometries(placements, PALETTE, mulberry32(42))).not.toThrow();
  });
});

describe('buildPropFamilyMaterial: family→マテリアルの分岐', () => {
  it('shadowはMeshBasicMaterial(vertexColors/transparent/depthWrite:false)', () => {
    const mat = buildPropFamilyMaterial('shadow', PALETTE);
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    const basic = mat as THREE.MeshBasicMaterial;
    expect(basic.vertexColors).toBe(true);
    expect(basic.transparent).toBe(true);
    expect(basic.depthWrite).toBe(false);
    mat.dispose();
  });

  it.each<PropMatFamily>(['metal', 'wood', 'stone', 'foliage', 'paint'])(
    '%s はapplySurfaceKitへ委譲される(customProgramCacheKeyがhibana-surfacekit-*)',
    (family) => {
      const mat = buildPropFamilyMaterial(family, PALETTE);
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      const std = mat as THREE.MeshStandardMaterial;
      expect(std.vertexColors).toBe(true);
      expect(std.customProgramCacheKey()).toBe(`hibana-surfacekit-${family}`);
      mat.dispose();
    },
  );

  it('accentはpalette.emissiveAccent=trueの時のみ発光する(bloom閾値0.9未満の0.45)', () => {
    const glow = buildPropFamilyMaterial('accent', PALETTE) as THREE.MeshStandardMaterial;
    expect(glow.emissive.getHex()).toBe(new THREE.Color(PALETTE.accent).getHex());
    expect(glow.emissiveIntensity).toBeCloseTo(0.45, 6);
    expect(glow.emissiveIntensity).toBeLessThan(0.9);
    glow.dispose();

    const noGlow = buildPropFamilyMaterial('accent', PALETTE_NO_GLOW) as THREE.MeshStandardMaterial;
    expect(noGlow.emissive.getHex()).toBe(0x000000); // 既定値のまま(未設定)
    noGlow.dispose();
  });

  it('accentはキット無し(applySurfaceKitのcustomProgramCacheKeyを持たない)', () => {
    const mat = buildPropFamilyMaterial('accent', PALETTE) as THREE.MeshStandardMaterial;
    expect(mat.customProgramCacheKey()).not.toMatch(/^hibana-surfacekit-/);
    mat.dispose();
  });

  // ── R54-W1 Q6: low tierはapplySurfaceKitを適用しない(素のroughness基準) ──
  it.each<PropMatFamily>(['metal', 'wood', 'stone', 'foliage', 'paint'])(
    'tier省略(既定)は%sもapplySurfaceKitへ委譲される(非回帰)',
    (family) => {
      const mat = buildPropFamilyMaterial(family, PALETTE) as THREE.MeshStandardMaterial;
      expect(mat.customProgramCacheKey()).toBe(`hibana-surfacekit-${family}`);
      mat.dispose();
    },
  );

  it.each<PropMatFamily>(['metal', 'wood', 'stone', 'foliage', 'paint'])(
    "tier==='low'は%sでもapplySurfaceKitを適用しない(customProgramCacheKeyがhibana-surfacekit-*でない)",
    (family) => {
      const mat = buildPropFamilyMaterial(family, PALETTE, 'low') as THREE.MeshStandardMaterial;
      expect(mat.customProgramCacheKey()).not.toMatch(/^hibana-surfacekit-/);
      // applySurfaceKitのroughness/metalness基準値も適用されない(素のMeshStandardMaterial既定)
      expect(mat.roughness).toBe(1);
      expect(mat.metalness).toBe(0);
      mat.dispose();
    },
  );

  it("tier==='medium'/'high'は従来どおりapplySurfaceKitを適用する", () => {
    for (const tier of ['medium', 'high'] as const) {
      const mat = buildPropFamilyMaterial('metal', PALETTE, tier) as THREE.MeshStandardMaterial;
      expect(mat.customProgramCacheKey()).toBe('hibana-surfacekit-metal');
      mat.dispose();
    }
  });
});

describe('propFamilyShadowFlags: family→cast/receiveの分岐', () => {
  it('metal/wood/stone/foliage/paint はcastShadow=true(旧shadowCaster個別メッシュ経路の肩代わり)', () => {
    for (const f of ['metal', 'wood', 'stone', 'foliage', 'paint'] as const) {
      expect(propFamilyShadowFlags(f)).toEqual({ castShadow: true, receiveShadow: true });
    }
  });

  it('accentはcastShadow=false/receiveShadow=true(旧mergedPropMeshと同じ扱い)', () => {
    expect(propFamilyShadowFlags('accent')).toEqual({ castShadow: false, receiveShadow: true });
  });

  it('shadow(接地デカール)はcast/receiveとも false', () => {
    expect(propFamilyShadowFlags('shadow')).toEqual({ castShadow: false, receiveShadow: false });
  });
});

describe('prewarmSurfaceKitVariants: R11 dissolve教訓のプリウォーム', () => {
  it('SURFACE_KIT_IDS(5種)ぶんの一時メッシュを追加した状態でrenderer.compileを1回呼ぶ', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    let meshCountDuringCompile = -1;
    let callCount = 0;
    const renderer: PrewarmRenderer = {
      compile: (s, c) => {
        callCount += 1;
        meshCountDuringCompile = (s as THREE.Scene).children.filter((o) => o instanceof THREE.Mesh).length;
        expect(s).toBe(scene);
        expect(c).toBe(camera);
        return new Set();
      },
    };
    prewarmSurfaceKitVariants(scene, renderer, camera);
    expect(callCount).toBe(1);
    expect(meshCountDuringCompile).toBe(SURFACE_KIT_IDS.length);
  });

  it('呼び出し後は一時メッシュをsceneから除去する(試合dispose契約を汚さない)', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer: PrewarmRenderer = { compile: () => new Set() };
    prewarmSurfaceKitVariants(scene, renderer, camera);
    expect(scene.children).toHaveLength(0);
  });

  it('実際に使うv2家族メッシュが先にscene追加済みなら同じcompile呼び出しで一緒に暖機される', () => {
    // buildStageScene は v2家族メッシュを scene.add した後にこの関数を呼ぶ設計。
    // ここでは「既存のscene内容に手を加えない(除去しない)」ことだけを検証する。
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const permanentMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const permanentMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), permanentMat);
    scene.add(permanentMesh);
    let meshCountDuringCompile = -1;
    const renderer: PrewarmRenderer = {
      compile: (s) => {
        meshCountDuringCompile = (s as THREE.Scene).children.length;
        return new Set();
      },
    };
    prewarmSurfaceKitVariants(scene, renderer, camera);
    // 1(実メッシュ) + 5(一時kitメッシュ) がcompile時点のscene内訳
    expect(meshCountDuringCompile).toBe(1 + SURFACE_KIT_IDS.length);
    // 呼び出し後は一時メッシュだけが除去され、実メッシュは残る
    expect(scene.children).toEqual([permanentMesh]);
    permanentMesh.geometry.dispose();
    permanentMat.dispose();
  });

  // ── R54-W1 Q6: low tierは5variant分の一時メッシュ生成/compileを完全に省く ──
  it("tier==='low'は一時kitメッシュを1つも追加せずcompileを呼ぶ(SurfaceKitは低tierで不使用のため)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    let meshCountDuringCompile = -1;
    let callCount = 0;
    const renderer: PrewarmRenderer = {
      compile: (s) => {
        callCount += 1;
        meshCountDuringCompile = (s as THREE.Scene).children.filter((o) => o instanceof THREE.Mesh).length;
        return new Set();
      },
    };
    prewarmSurfaceKitVariants(scene, renderer, camera, 'low');
    expect(callCount).toBe(1); // compile自体は呼ぶ(実メッシュがあれば一緒に暖機する契約は維持)
    expect(meshCountDuringCompile).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("tier省略(既定)/'medium'/'high'は従来どおり5variant分の一時メッシュを追加する(非回帰)", () => {
    for (const tier of [undefined, 'medium', 'high'] as const) {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      let meshCountDuringCompile = -1;
      const renderer: PrewarmRenderer = {
        compile: (s) => {
          meshCountDuringCompile = (s as THREE.Scene).children.filter((o) => o instanceof THREE.Mesh).length;
          return new Set();
        },
      };
      if (tier === undefined) prewarmSurfaceKitVariants(scene, renderer, camera);
      else prewarmSurfaceKitVariants(scene, renderer, camera, tier);
      expect(meshCountDuringCompile).toBe(SURFACE_KIT_IDS.length);
    }
  });
});

// ── R54-W1 Q6: 床floorDetailGlsl(亀裂/オイル染み/タイヤ痕)のtierゲート(純関数) ──
describe('floorDetailEligible: low tierは床の重量級ディテールを合成しない', () => {
  it("tier==='low'はfalse(macroWearの基礎汚れ変調のみに留める)", () => {
    expect(floorDetailEligible('low')).toBe(false);
  });

  it("tier==='medium'/'high'はtrue(従来どおりfloorDetailGlslを合成)", () => {
    expect(floorDetailEligible('medium')).toBe(true);
    expect(floorDetailEligible('high')).toBe(true);
  });
});
