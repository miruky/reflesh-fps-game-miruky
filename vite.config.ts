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
