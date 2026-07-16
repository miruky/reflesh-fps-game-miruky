import { describe, expect, it } from 'vitest';
import {
  isN8aoProblemRendererLabel,
  isSoftwareRendererLabel,
  resolveRenderPixelRatio,
} from './render-budget';

describe('render pixel budget', () => {
  it('1080p Retinaで過剰4K描画を避けつつhighをmediumより高密度に保つ', () => {
    const medium = resolveRenderPixelRatio(1920, 1080, 2, 'medium');
    const high = resolveRenderPixelRatio(1920, 1080, 2, 'high');
    expect(medium).toBeGreaterThan(1.2);
    expect(medium).toBeLessThanOrEqual(1.35);
    expect(high).toBeGreaterThan(medium);
    expect(high).toBeLessThanOrEqual(1.6);
    expect(1920 * 1080 * high * high).toBeLessThanOrEqual(4_200_001);
  });

  it('小画面は端末DPRとティア上限まで解像度を維持する', () => {
    expect(resolveRenderPixelRatio(390, 844, 3, 'high')).toBe(1.6);
    expect(resolveRenderPixelRatio(390, 844, 3, 'medium')).toBe(1.35);
    expect(resolveRenderPixelRatio(390, 844, 3, 'low')).toBe(1);
  });

  it('4Kでもティア別の最低鮮明度を下回らない', () => {
    expect(resolveRenderPixelRatio(3840, 2160, 1, 'high')).toBe(0.9);
    expect(resolveRenderPixelRatio(3840, 2160, 1, 'medium')).toBe(0.8);
    expect(resolveRenderPixelRatio(3840, 2160, 1, 'low')).toBe(0.72);
  });

  it('不正DPRは1として安全に扱う', () => {
    expect(resolveRenderPixelRatio(1280, 720, Number.NaN, 'medium')).toBe(1);
  });
});

describe('advanced renderer compatibility', () => {
  it.each(['Google SwiftShader', 'ANGLE (LLVMpipe)', 'Mesa softpipe', 'Vulkan lavapipe'])(
    '%s をソフトウェア描画として検出する',
    (label) => expect(isSoftwareRendererLabel(label)).toBe(true),
  );

  it.each(['Apple M3', 'ANGLE (NVIDIA RTX 4070)', 'AMD Radeon Pro', 'Intel Iris Xe'])(
    '%s は実GPUとして扱う',
    (label) => expect(isSoftwareRendererLabel(label)).toBe(false),
  );

  it('ANGLE MetalはN8AO互換チェーンへ切り替える', () => {
    expect(
      isN8aoProblemRendererLabel('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)'),
    ).toBe(true);
    expect(isN8aoProblemRendererLabel('ANGLE (NVIDIA RTX 4070 Direct3D11)')).toBe(false);
  });
});
