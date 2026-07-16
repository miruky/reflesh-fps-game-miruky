import { describe, expect, it } from 'vitest';
import type { GradeParams } from '../game/stage';
import { createGradePass, GRADE_SHADER } from './grade';

const params: GradeParams = {
  tint: [1, 1, 1],
  contrast: 1,
  saturation: 1,
  vignette: 0.1,
  vignetteR: 0.8,
  grain: 0.01,
  chroma: 0.2,
};

describe('cinematic grade', () => {
  it('Teal & Orangeを既存Grade shaderへ統合し、追加常時パスを不要にする', () => {
    expect(GRADE_SHADER.fragmentShader).toContain('uniform float uTealOrange');
    expect(GRADE_SHADER.fragmentShader).toContain('shadowMask');
    expect(GRADE_SHADER.fragmentShader).toContain('lightMask');
  });

  it('強度を0..1へクランプする', () => {
    const low = createGradePass(params, { tealOrange: -1 });
    const high = createGradePass(params, { tealOrange: 2 });
    expect(low.uniforms.uTealOrange?.value).toBe(0);
    expect(high.uniforms.uTealOrange?.value).toBe(1);
    low.dispose();
    high.dispose();
  });
});
