import type * as THREE from 'three';
import type { GraphicsQuality } from '../core/settings';

const PIXEL_BUDGET: Record<GraphicsQuality, number> = {
  low: 2_100_000,
  medium: 3_200_000,
  high: 4_200_000,
};

const DPR_CAP: Record<GraphicsQuality, number> = {
  low: 1,
  medium: 1.35,
  high: 1.6,
};

const DPR_FLOOR: Record<GraphicsQuality, number> = {
  low: 0.72,
  medium: 0.8,
  high: 0.9,
};

/**
 * Retina倍率をそのまま採用せず、画面全体の実ピクセル数を上限にする。
 * 小画面では高密度を保ち、1440p/4Kでは過剰な8M〜33Mpx描画を避ける。
 */
export function resolveRenderPixelRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
  tier: GraphicsQuality,
): number {
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const budgetRatio = Math.sqrt(PIXEL_BUDGET[tier] / cssPixels);
  const safeDeviceRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.max(
    DPR_FLOOR[tier],
    Math.min(safeDeviceRatio, DPR_CAP[tier], budgetRatio),
  );
}

export function isSoftwareRendererLabel(label: string): boolean {
  return /swiftshader|software|llvmpipe|softpipe|lavapipe/i.test(label);
}

export function isN8aoProblemRendererLabel(label: string): boolean {
  // n8ao 1.10.2 はANGLE Metalでbeauty targetが黒くなる組合せがある。RenderPassを
  // 基幹にした高画質互換チェーンへ切り替え、画面全体の消失を最優先で防ぐ。
  return isSoftwareRendererLabel(label) || /angle metal renderer/i.test(label);
}

export function rendererLabel(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  if (debug) {
    const unmasked = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    if (typeof unmasked === 'string') return unmasked;
  }
  const fallback = gl.getParameter(gl.RENDERER);
  return typeof fallback === 'string' ? fallback : '';
}

/**
 * N8AO/PCSS/GodRaysを安全に使えるレンダラか。高画質設定そのものは保持し、
 * ソフトウェア描画時だけシーンを描く基幹パスを堅牢なRenderPassへ切り替える。
 */
export function supportsAdvancedRendering(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && !isSoftwareRendererLabel(rendererLabel(renderer));
}

export function supportsN8aoRendering(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && !isN8aoProblemRendererLabel(rendererLabel(renderer));
}
