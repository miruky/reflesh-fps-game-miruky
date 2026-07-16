import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AaaStageAssetPipeline, parseAaaAssetManifest } from './aaa-asset-pipeline';

describe('AAA asset manifest', () => {
  it('安全な相対URL・LOD・instanceを正規化する', () => {
    const manifest = parseAaaAssetManifest({
      version: 1,
      ktx2TranscoderPath: 'transcoders/basis',
      assets: [{
        id: 'hero-crate',
        url: 'props/hero-crate.glb',
        minTier: 'high',
        instances: [{ position: [1, 0, 2], rotation: [0, 1, 0], scale: 1.2 }],
        lods: [{ url: 'props/hero-crate-lod1.glb', distance: 28 }],
      }],
    });
    expect(manifest.ktx2TranscoderPath).toBe('transcoders/basis/');
    expect(manifest.assets[0]?.lods?.[0]?.distance).toBe(28);
  });

  it.each([
    'https://example.com/model.glb',
    '../private/model.glb',
    '/absolute/model.glb',
    'data:model/gltf-binary;base64,AAAA',
  ])('外部・親参照・absolute URLを拒否する: %s', (url) => {
    expect(() => parseAaaAssetManifest({
      version: 1,
      assets: [{ id: 'bad', url }],
    })).toThrow();
  });

  it('asset 0件ならThree loader chunkを要求せずfail-openする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1, assets: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const scene = new THREE.Scene();
    const pipeline = new AaaStageAssetPipeline(
      scene,
      {} as THREE.WebGLRenderer,
      new THREE.PerspectiveCamera(),
    );
    const report = await pipeline.load({
      stageId: 'test',
      tier: 'high',
      propPlacements: [],
      manifestUrl: '/manifest.json',
    });
    expect(report).toEqual({ requested: 0, loaded: 0, failed: 0, errors: [] });
    expect(scene.getObjectByName('aaa:external-stage-assets')).toBe(pipeline.root);
    pipeline.dispose();
    expect(scene.getObjectByName('aaa:external-stage-assets')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
