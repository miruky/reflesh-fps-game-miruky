/**
 * Minimal TypeScript ambient declaration for the n8ao package (v1.10.2).
 * Only the surface area used by match.ts is declared.
 */
declare module 'n8ao' {
  import type * as THREE from 'three';
  import type { Pass } from 'three/addons/postprocessing/Pass.js';

  interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    transparencyAware: boolean;
    gammaCorrection: boolean;
    [key: string]: unknown;
  }

  /** FullScreenTriangle from n8ao (exposes .material and .dispose) */
  interface FSTQuad {
    material?: THREE.ShaderMaterial;
    dispose(): void;
  }

  export class N8AOPass extends Pass {
    configuration: N8AOConfiguration;
    beautyRenderTarget: THREE.WebGLRenderTarget;
    // internal resources — N8AOPass has no dispose(); match.ts destroys these manually
    writeTargetInternal?: THREE.WebGLRenderTarget;
    readTargetInternal?: THREE.WebGLRenderTarget;
    accumulationRenderTarget?: THREE.WebGLRenderTarget;
    depthDownsampleTarget?: { dispose(): void };
    transparencyRenderTargetDWFalse?: THREE.WebGLRenderTarget;
    transparencyRenderTargetDWTrue?: THREE.WebGLRenderTarget;
    effectShaderQuad?: FSTQuad;
    poissonBlurQuad?: FSTQuad;
    effectCompositerQuad?: FSTQuad;
    accumulationQuad?: FSTQuad;
    depthDownsampleQuad?: FSTQuad;
    depthCopyPass?: FSTQuad;
    bluenoise?: THREE.DataTexture;
    constructor(
      scene: THREE.Scene,
      camera: THREE.Camera,
      width: number,
      height: number,
    );
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
