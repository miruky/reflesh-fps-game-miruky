// Runtime-only glTF facade. Its sibling .d.ts deliberately exposes a very small type surface:
// @types/three's Meshopt declaration recursively re-exports meshoptimizer and makes TS 5.6 spend
// excessive time expanding the loader module. Vite still bundles the official implementations.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function createGltfRuntime(renderer, base, options) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let ktx2 = null;
  let draco = null;
  if (options.ktx2TranscoderPath) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(`${base}${options.ktx2TranscoderPath}`);
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
  if (options.dracoDecoderPath) {
    draco = new DRACOLoader();
    draco.setDecoderPath(`${base}${options.dracoDecoderPath}`);
    loader.setDRACOLoader(draco);
  }
  return {
    async loadScene(url) {
      const result = await loader.loadAsync(url);
      return result.scene;
    },
    clone(source) {
      return clone(source);
    },
    dispose() {
      ktx2?.dispose();
      draco?.dispose();
    },
  };
}
