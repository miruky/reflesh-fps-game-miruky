// surface-kit.ts のユニットテスト。
// - 実 WebGL コンテキストは使わず、THREE r170 のチャンク順を模したモックshaderオブジェクトへ
//   onBeforeCompile を通し、例外なく完走 & 想定アンカーが正しく置換されることを確認する。
// - customProgramCacheKey がキットごとに分離されることを検証する。
// - floorDetailGlsl() は静的な構文健全性(括弧/セミコロンの釣り合い)のみを検証する
//   (実コンパイルは M2c が match.ts へ合成した後の統合テスト/ゲート側の責務)。

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applySurfaceKit,
  floorDetailGlsl,
  floorDetailGlslCommon,
  SURFACE_KIT_IDS,
  type SurfaceKitId,
} from './surface-kit';

// THREE MeshStandardMaterial の実フラグメント/バーテックスシェーダの主要アンカー順を
// 模した最小モック。onBeforeCompile 内の .replace() が実際に効くことを検証する。
function mockShader(): {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
} {
  return {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      'void main() {',
      '  vec3 transformed = vec3(position);',
      '  #include <begin_vertex>',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '  vec4 diffuseColor = vec4(diffuse, opacity);',
      '  #include <color_fragment>',
      '  #include <roughnessmap_fragment>',
      '  #include <metalnessmap_fragment>',
      '  gl_FragColor = diffuseColor;',
      '}',
    ].join('\n'),
  };
}

// mat.onBeforeCompile を呼ぶための型は WebGLProgramParametersWithUniforms/WebGLRenderer だが、
// このモジュールの実装は uniforms/vertexShader/fragmentShader の3プロパティしか触れない。
// 実描画を伴わない単体テストなので、必要最小限の形へキャストして呼び出す。
function runOnBeforeCompile(
  mat: THREE.MeshStandardMaterial,
  shader: ReturnType<typeof mockShader>,
): void {
  expect(mat.onBeforeCompile).toBeTypeOf('function');
  mat.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
}

// 括弧/波括弧/セミコロンの粗い釣り合いを見る静的チェック(構文解析ではなく健全性検知)。
function bracesBalanced(glsl: string): boolean {
  let curly = 0;
  let paren = 0;
  for (const ch of glsl) {
    if (ch === '{') curly += 1;
    else if (ch === '}') curly -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    if (curly < 0 || paren < 0) return false;
  }
  return curly === 0 && paren === 0;
}

describe('SURFACE_KIT_IDS', () => {
  it('5キットを網羅する', () => {
    expect(SURFACE_KIT_IDS).toHaveLength(5);
    expect(new Set(SURFACE_KIT_IDS)).toEqual(
      new Set<SurfaceKitId>(['metal', 'wood', 'stone', 'paint', 'foliage']),
    );
  });

  it('重複がない', () => {
    expect(new Set(SURFACE_KIT_IDS).size).toBe(SURFACE_KIT_IDS.length);
  });
});

describe('applySurfaceKit — 基準roughness/metalness', () => {
  it.each<[SurfaceKitId, number, number]>([
    ['metal', 0.45, 0.6],
    ['wood', 0.7, 0.0],
    ['stone', 0.85, 0.0],
    ['paint', 0.6, 0.15],
    ['foliage', 0.9, 0.0],
  ])('%s は roughness=%f / metalness=%f を設定する', (kit, roughness, metalness) => {
    const mat = new THREE.MeshStandardMaterial();
    applySurfaceKit(mat, kit);
    expect(mat.roughness).toBeCloseTo(roughness, 6);
    expect(mat.metalness).toBeCloseTo(metalness, 6);
    mat.dispose();
  });
});

describe('applySurfaceKit — customProgramCacheKey 分離', () => {
  it('5キットすべてで異なるキーを返す', () => {
    const keys = new Set<string>();
    for (const kit of SURFACE_KIT_IDS) {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      expect(mat.customProgramCacheKey).toBeTypeOf('function');
      const key = mat.customProgramCacheKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      keys.add(key);
      mat.dispose();
    }
    expect(keys.size).toBe(SURFACE_KIT_IDS.length);
  });

  it('同一キットは同一キーを返す(冪等)', () => {
    const matA = new THREE.MeshStandardMaterial();
    const matB = new THREE.MeshStandardMaterial();
    applySurfaceKit(matA, 'metal');
    applySurfaceKit(matB, 'metal');
    expect(matA.customProgramCacheKey()).toBe(matB.customProgramCacheKey());
    matA.dispose();
    matB.dispose();
  });
});

describe('applySurfaceKit — onBeforeCompile が例外なく完走する', () => {
  for (const kit of SURFACE_KIT_IDS) {
    it(`${kit}: モックshaderに対して例外を投げない`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      expect(() => runOnBeforeCompile(mat, shader)).not.toThrow();
      mat.dispose();
    });

    it(`${kit}: 頂点シェーダへ vSkWorldPos が挿入される`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      runOnBeforeCompile(mat, shader);
      expect(shader.vertexShader).toContain('varying vec3 vSkWorldPos;');
      expect(shader.vertexShader).toContain('vSkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      mat.dispose();
    });

    it(`${kit}: フラグメントシェーダへ #define ${
      { metal: 'SK_METAL', wood: 'SK_WOOD', stone: 'SK_STONE', paint: 'SK_PAINT', foliage: 'SK_FOLIAGE' }[
        kit
      ]
    } が挿入される`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      runOnBeforeCompile(mat, shader);
      const defineName = {
        metal: 'SK_METAL',
        wood: 'SK_WOOD',
        stone: 'SK_STONE',
        paint: 'SK_PAINT',
        foliage: 'SK_FOLIAGE',
      }[kit];
      expect(shader.fragmentShader).toContain(`#define ${defineName}`);
      mat.dispose();
    });

    it(`${kit}: color_fragment / roughnessmap_fragment 挿入点の両方に質感GLSLが乗る`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      runOnBeforeCompile(mat, shader);
      expect(shader.fragmentShader).toContain('vec3 skOrig');
      expect(shader.fragmentShader).toContain('sk_rustAmt');
      const roughIdx = shader.fragmentShader.indexOf('#include <roughnessmap_fragment>');
      const metalIfIdx = shader.fragmentShader.indexOf('#ifdef SK_METAL\n    roughnessFactor');
      expect(roughIdx).toBeGreaterThan(-1);
      expect(metalIfIdx).toBeGreaterThan(roughIdx);
      mat.dispose();
    });

    it(`${kit}: 白飛び安全クランプ(skOrig*0.85..skOrig*1.05)が必ず入る`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      runOnBeforeCompile(mat, shader);
      expect(shader.fragmentShader).toContain('clamp(diffuseColor.rgb, skOrig * 0.85, skOrig * 1.05)');
      mat.dispose();
    });

    it(`${kit}: per-frame uniform(uTime系)を追加しない`, () => {
      const mat = new THREE.MeshStandardMaterial();
      applySurfaceKit(mat, kit);
      const shader = mockShader();
      runOnBeforeCompile(mat, shader);
      expect(Object.keys(shader.uniforms)).toHaveLength(0);
      expect(shader.fragmentShader).not.toMatch(/uniform\s+float\s+uTime/i);
      mat.dispose();
    });
  }

  it('2重適用(onBeforeCompile再実行)でも例外を投げない', () => {
    const mat = new THREE.MeshStandardMaterial();
    applySurfaceKit(mat, 'metal');
    const shader1 = mockShader();
    const shader2 = mockShader();
    expect(() => runOnBeforeCompile(mat, shader1)).not.toThrow();
    expect(() => runOnBeforeCompile(mat, shader2)).not.toThrow();
    mat.dispose();
  });
});

describe('floorDetailGlsl', () => {
  it('文字列を返す', () => {
    expect(typeof floorDetailGlsl()).toBe('string');
    expect(floorDetailGlsl().length).toBeGreaterThan(0);
  });

  it('括弧・波括弧が釣り合っている(静的構文健全性)', () => {
    expect(bracesBalanced(floorDetailGlsl())).toBe(true);
  });

  it('全行がセミコロン・波括弧・プリプロセッサのいずれかで終端する(粗い文健全性)', () => {
    const lines = floorDetailGlsl()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      const ok =
        line.endsWith(';') ||
        line.endsWith('{') ||
        line.endsWith('}') ||
        line.startsWith('//') ||
        line.startsWith('#');
      expect(ok, `unexpected line ending: "${line}"`).toBe(true);
    }
  });

  it('vWorldXZ / diffuseColor(applyMacroFloor側の既存シンボル)を前提として参照する', () => {
    const glsl = floorDetailGlsl();
    expect(glsl).toContain('vWorldXZ');
    expect(glsl).toContain('diffuseColor.rgb');
  });

  it('独自ヘルパーは fd_ 接頭辞で match.ts の macro* / このファイルの sk_* と衝突しない', () => {
    const glsl = floorDetailGlslCommon() + floorDetailGlsl();
    expect(glsl).toContain('fd_hash');
    expect(glsl).toContain('fd_vnoise');
    expect(glsl).toContain('fd_fbm');
    expect(glsl).not.toContain('macroHash');
    expect(glsl).not.toContain('macroFbm(');
    expect(glsl).not.toMatch(/\bsk_/);
  });

  // ★V-C CRITICAL回帰防止: GLSL ES 3.00 は main() 内の関数定義(ネスト関数)を許可しない。
  // fd_* の「定義」は common(グローバル)側にのみ存在し、color_fragment へ挿入される本体
  // ブロックには関数定義が一切含まれないことを構造的に固定する。
  it('関数定義はcommon側のみ・本体ブロックには関数定義を含まない(ネスト関数のGLSL違反防止)', () => {
    const common = floorDetailGlslCommon();
    const body = floorDetailGlsl();
    const fnDefRe = /float\s+fd_\w+\s*\(/;
    expect(fnDefRe.test(common)).toBe(true); // 定義はcommonに存在
    expect(common).toContain('fd_hash(vec2 p)');
    expect(common).toContain('fd_vnoise(vec2 p)');
    expect(common).toContain('fd_fbm(vec2 p)');
    // 本体は「呼び出し」のみ(引数型付きのシグネチャ=定義が現れない)
    expect(body).not.toContain('fd_hash(vec2 p)');
    expect(body).not.toContain('fd_vnoise(vec2 p)');
    expect(body).not.toContain('fd_fbm(vec2 p)');
    expect(body).toContain('fd_fbm('); // 呼び出しはある
    // commonの括弧釣り合いも独立に健全
    expect(bracesBalanced(common)).toBe(true);
  });

  it('輝度規律 0.90..1.045 の乗算クランプで終わる(既存applyMacroFloorと同域)', () => {
    expect(floorDetailGlsl()).toContain('clamp(mix(1.045, 0.90, fdMask), 0.90, 1.045)');
  });

  it('呼び出すたびに同じ文字列を返す(静的・決定論)', () => {
    expect(floorDetailGlsl()).toBe(floorDetailGlsl());
  });
});
