import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.HIBANA_BASE ?? '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // 物理エンジンと3Dライブラリは重いので別チャンクへ切り出す。
        // Vite 8(rolldown)では manualChunks は関数で指定する。
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier';
          // glTF/KTX2/Draco/Meshoptはmanifestに高密度assetがある時だけ動的ロードする。
          // 汎用three chunkへ吸収するとasset 0件でも約150KB増えるため、専用chunkへ隔離。
          if (
            id.includes('node_modules/three/examples/jsm/loaders/GLTFLoader') ||
            id.includes('node_modules/three/examples/jsm/loaders/KTX2Loader') ||
            id.includes('node_modules/three/examples/jsm/loaders/DRACOLoader') ||
            id.includes('node_modules/three/examples/jsm/libs/meshopt_decoder') ||
            id.includes('node_modules/three/examples/jsm/libs/zstddec') ||
            id.includes('node_modules/three/examples/jsm/utils/SkeletonUtils') ||
            id.includes('node_modules/three/examples/jsm/utils/WorkerPool') ||
            id.includes('node_modules/three/examples/jsm/math/ColorSpaces')
          ) return 'three-assets';
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
