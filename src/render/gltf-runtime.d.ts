import type * as THREE from 'three';

export interface GltfRuntimeOptions {
  readonly ktx2TranscoderPath?: string;
  readonly dracoDecoderPath?: string;
}

export interface GltfRuntime {
  loadScene(url: string): Promise<THREE.Object3D>;
  clone(source: THREE.Object3D): THREE.Object3D;
  dispose(): void;
}

export function createGltfRuntime(
  renderer: THREE.WebGLRenderer,
  base: string,
  options: GltfRuntimeOptions,
): GltfRuntime;
