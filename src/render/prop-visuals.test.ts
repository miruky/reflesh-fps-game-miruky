import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPropVisual, PROP_VISUAL_KINDS } from './prop-visuals';
import type { PropMatFamily, PropVisualPalette } from './prop-visuals';
import { mulberry32 } from '../core/rng';

// R53-W2 (B-ENV1+B-ENV2): prop-visuals.ts の基盤+全36種テスト。
// 主眼: (1) 全kindが例外なく生成される (2) family毎に属性構成が完全一致(shadowのみitemSize4)
// (3) 頂点予算内 (4) 決定論(同seed同出力) (5) groundSkirt/radialShadowの構造(色/アルファ勾配)。

const PALETTE: PropVisualPalette = {
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

function build(kind: string, seed = 1234) {
  const rand = mulberry32(seed);
  return buildPropVisual(kind, 5, -3, 0.1, 0.7, 1.05, rand, PALETTE);
}

describe('PROP_VISUAL_KINDS', () => {
  it('全36種が実装済みで重複なし', () => {
    expect(PROP_VISUAL_KINDS).toHaveLength(36);
    expect(new Set(PROP_VISUAL_KINDS).size).toBe(36);
  });

  it('前半18種(配置数上位)+後半18種(残り)を全て含む(=stage.ts PropKind全網羅)', () => {
    const expected = [
      // 前半18種(B-ENV1)
      'rock', 'concretebarrier', 'rubble', 'fence', 'stonelantern', 'bench', 'streetlight', 'deadtree',
      'derelictcar', 'truck', 'signboard', 'conifer', 'drumgroup', 'broadleaf', 'barricadecar',
      'gasbottlegroup', 'pier', 'vendingmachine',
      // 後半18種(B-ENV2)
      'sakura', 'bamboo', 'towercrane', 'portalkrane', 'smokestack', 'gastank', 'watertower',
      'transformer', 'antenna', 'forklift', 'watchpost', 'tankhull', 'scaffold', 'pallet', 'torii',
      'well', 'utilitypole', 'supplycrate',
    ];
    expect(new Set(PROP_VISUAL_KINDS)).toEqual(new Set(expected));
  });
});

describe('buildPropVisual: 未知kindはnull', () => {
  it('完全に未知のkind文字列はnull(既存の箱ビジュアルへフォールバックする契約)', () => {
    expect(build('totally-unknown-kind-xyz')).toBeNull();
    expect(build('')).toBeNull();
  });
});

describe('buildPropVisual: 全36種 個別検証', () => {
  const vertexTotals: number[] = [];

  for (const kind of PROP_VISUAL_KINDS) {
    it(`${kind}: 例外なく生成・非nullファミリを1つ以上返す`, () => {
      expect(() => build(kind)).not.toThrow();
      const result = build(kind);
      expect(result).not.toBeNull();
      const families = Object.keys(result ?? {});
      expect(families.length).toBeGreaterThan(0);
    });

    it(`${kind}: 全ジオメトリが非インデックス化済み・position/normal/uv/colorを持つ・itemSizeがfamily規約どおり`, () => {
      const result = build(kind);
      if (!result) throw new Error('unreachable: result must not be null for implemented kind');
      let total = 0;
      for (const familyKey of Object.keys(result) as PropMatFamily[]) {
        const geos = result[familyKey] ?? [];
        expect(geos.length).toBeGreaterThan(0);
        for (const g of geos) {
          expect(g.index).toBeNull();
          expect(g.getAttribute('position')).toBeDefined();
          expect(g.getAttribute('normal')).toBeDefined();
          expect(g.getAttribute('uv')).toBeDefined();
          const color = g.getAttribute('color');
          expect(color).toBeDefined();
          const expectedItemSize = familyKey === 'shadow' ? 4 : 3;
          expect(color.itemSize).toBe(expectedItemSize);
          expect(color.count).toBe(g.getAttribute('position').count);
          total += g.getAttribute('position').count;
        }
      }
      vertexTotals.push(total);
      // 単体最大予算: 1200 verts
      expect(total).toBeLessThanOrEqual(1200);
    });

    it(`${kind}: 決定論(同seedで2回生成すると全頂点位置が完全一致)`, () => {
      const a = build(kind, 777);
      const b = build(kind, 777);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (!a || !b) throw new Error('unreachable');
      const familiesA = Object.keys(a).sort();
      const familiesB = Object.keys(b).sort();
      expect(familiesA).toEqual(familiesB);
      for (const familyKey of familiesA as PropMatFamily[]) {
        const geosA = a[familyKey] ?? [];
        const geosB = b[familyKey] ?? [];
        expect(geosA.length).toBe(geosB.length);
        for (let i = 0; i < geosA.length; i += 1) {
          const pa = geosA[i]?.getAttribute('position') as THREE.BufferAttribute;
          const pb = geosB[i]?.getAttribute('position') as THREE.BufferAttribute;
          expect(Array.from(pa.array)).toEqual(Array.from(pb.array));
          const ca = geosA[i]?.getAttribute('color') as THREE.BufferAttribute;
          const cb = geosB[i]?.getAttribute('color') as THREE.BufferAttribute;
          expect(Array.from(ca.array)).toEqual(Array.from(cb.array));
        }
      }
    });

    it(`${kind}: rotが異なれば位置が変わる(ワールド焼き込みが効いている)`, () => {
      const rand1 = mulberry32(42);
      const rand2 = mulberry32(42);
      const r1 = buildPropVisual(kind, 0, 0, 0, 0, 1, rand1, PALETTE);
      const r2 = buildPropVisual(kind, 0, 0, 0, Math.PI / 2, 1, rand2, PALETTE);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      if (!r1 || !r2) throw new Error('unreachable');
      const family = (Object.keys(r1) as PropMatFamily[])[0];
      expect(family).toBeDefined();
      if (!family) throw new Error('unreachable');
      const g1 = r1[family]?.[0];
      const g2 = r2[family]?.[0];
      expect(g1).toBeDefined();
      expect(g2).toBeDefined();
      if (!g1 || !g2) throw new Error('unreachable');
      const p1 = Array.from((g1.getAttribute('position') as THREE.BufferAttribute).array);
      const p2 = Array.from((g2.getAttribute('position') as THREE.BufferAttribute).array);
      expect(p1).not.toEqual(p2);
    });
  }

  it('頂点予算: 36種平均が概ね~600(800以下)に収まる', () => {
    expect(vertexTotals).toHaveLength(36);
    const avg = vertexTotals.reduce((a, b) => a + b, 0) / vertexTotals.length;
    expect(avg).toBeLessThanOrEqual(800);
  });
});

describe('属性構成の統一性(R51回帰防止): family横断で全kindのジオメトリが同一attribute set', () => {
  it('shadow以外のfamilyはposition/normal/uv/color(itemSize3)で統一、shadowはcolor itemSize4で統一', () => {
    const attrSetByFamily = new Map<PropMatFamily, string>();
    for (const kind of PROP_VISUAL_KINDS) {
      const result = build(kind, 99);
      if (!result) throw new Error('unreachable');
      for (const familyKey of Object.keys(result) as PropMatFamily[]) {
        const geos = result[familyKey] ?? [];
        for (const g of geos) {
          const names = Object.keys(g.attributes).sort();
          const itemSizes = names.map((n) => `${n}:${g.getAttribute(n).itemSize}`).join(',');
          const signature = `${names.join(',')}|${itemSizes}|indexed:${g.index !== null}`;
          const existing = attrSetByFamily.get(familyKey);
          if (existing === undefined) {
            attrSetByFamily.set(familyKey, signature);
          } else {
            expect(signature).toBe(existing);
          }
        }
      }
    }
    // shadowファミリのシグネチャにはcolor:4が含まれる(他は含まれない)
    const shadowSig = attrSetByFamily.get('shadow');
    expect(shadowSig).toBeDefined();
    expect(shadowSig).toContain('color:4');
    for (const [family, sig] of attrSetByFamily) {
      if (family === 'shadow') continue;
      expect(sig).toContain('color:3');
      expect(sig).not.toContain('color:4');
    }
  });
});

describe('groundSkirt / radialShadow の構造(rock経由で検証)', () => {
  it('radialShadow: shadowファミリは1枚・RGBは黒・アルファに勾配があり最小値は0付近', () => {
    const result = build('rock', 55);
    if (!result) throw new Error('unreachable');
    const shadows = result.shadow ?? [];
    expect(shadows.length).toBe(1);
    const g = shadows[0];
    if (!g) throw new Error('unreachable');
    const color = g.getAttribute('color') as THREE.BufferAttribute;
    expect(color.itemSize).toBe(4);
    let minA = Infinity;
    let maxA = -Infinity;
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getX(i)).toBeCloseTo(0, 5); // R
      expect(color.getY(i)).toBeCloseTo(0, 5); // G
      expect(color.getZ(i)).toBeCloseTo(0, 5); // B
      const a = color.getW(i);
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
    }
    expect(minA).toBeLessThan(0.05);
    expect(maxA).toBeGreaterThan(0.15);
    expect(maxA).toBeGreaterThan(minA);
  });

  it('groundSkirt: stoneファミリ中の最も平坦(Y範囲最小)なジオメトリの頂点色が一様でない(床色ブレンド)', () => {
    const result = build('rock', 55);
    if (!result) throw new Error('unreachable');
    const stones = result.stone ?? [];
    expect(stones.length).toBeGreaterThanOrEqual(2);
    let flattest: THREE.BufferGeometry | undefined;
    let flattestRange = Infinity;
    for (const g of stones) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < pos.count; i += 1) {
        const y = pos.getY(i);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
      const range = yMax - yMin;
      if (range < flattestRange) {
        flattestRange = range;
        flattest = g;
      }
    }
    expect(flattest).toBeDefined();
    expect(flattestRange).toBeLessThan(0.3); // 円盤状(接地スカート)であることの間接確認
    const color = flattest?.getAttribute('color') as THREE.BufferAttribute;
    let minC = Infinity;
    let maxC = -Infinity;
    for (let i = 0; i < color.count; i += 1) {
      minC = Math.min(minC, color.getX(i), color.getY(i), color.getZ(i));
      maxC = Math.max(maxC, color.getX(i), color.getY(i), color.getZ(i));
    }
    expect(maxC - minC).toBeGreaterThan(0.01); // 中心→外周で色が変化(単色ではない)
  });
});

describe('コライダー非関与(視覚のみ)の確認', () => {
  it('同一kindでscaleを変えても常に例外なく生成できる(コライダーAPIに依存しない純関数)', () => {
    for (const kind of PROP_VISUAL_KINDS) {
      const rand = mulberry32(1);
      expect(() => buildPropVisual(kind, 0, 0, 0, 0, 0.88, rand, PALETTE)).not.toThrow();
    }
  });
});
