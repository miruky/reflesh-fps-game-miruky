import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  AaaStageAssetPipeline,
  parseAaaAssetManifest,
  tuneImportedStageMaterial,
} from './aaa-asset-pipeline';

describe('AAA asset manifest', () => {
  it('安全な相対URL・LOD・instanceを正規化する', () => {
    const manifest = parseAaaAssetManifest({
      version: 1,
      ktx2TranscoderPath: 'transcoders/basis',
      assets: [{
        id: 'hero-crate',
        url: 'props/hero-crate.glb',
        minTier: 'high',
        replacesDistantMatte: true,
        replacesProceduralProps: true,
        instances: [{ position: [1, 0, 2], rotation: [0, 1, 0], scale: 1.2 }],
        lods: [{ url: 'props/hero-crate-lod1.glb', distance: 28 }],
      }],
    });
    expect(manifest.ktx2TranscoderPath).toBe('transcoders/basis/');
    expect(manifest.assets[0]?.lods?.[0]?.distance).toBe(28);
    expect(manifest.assets[0]?.replacesDistantMatte).toBe(true);
    expect(manifest.assets[0]?.replacesProceduralProps).toBe(true);
  });

  it('遠景置換フラグはboolean以外を拒否する', () => {
    expect(() => parseAaaAssetManifest({
      version: 1,
      assets: [{ id: 'bad-flag', url: 'stage.glb', replacesDistantMatte: 'yes' }],
    })).toThrow(/replacesDistantMatte/);
  });

  it('プロシージャルプロップ置換フラグはboolean以外を拒否する', () => {
    expect(() => parseAaaAssetManifest({
      version: 1,
      assets: [{ id: 'bad-prop-flag', url: 'stage.glb', replacesProceduralProps: 1 }],
    })).toThrow(/replacesProceduralProps/);
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
    expect(pipeline.hasProceduralPropReplacement).toBe(false);
    pipeline.dispose();
    expect(scene.getObjectByName('aaa:external-stage-assets')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('Blender stage PBR material tuning', () => {
  it('水面を追加反射パス無しの透明PBRに正規化する', () => {
    const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    const roughness = new THREE.DataTexture(new Uint8Array([32, 32, 32, 255]), 1, 1);
    const material = new THREE.MeshStandardMaterial({ normalMap: normal, roughnessMap: roughness });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.userData.hibanaMaterial = 'water';

    tuneImportedStageMaterial(mesh);

    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.72);
    expect(material.depthWrite).toBe(false);
    expect(material.roughness).toBeCloseTo(0.072);
    expect(material.envMapIntensity).toBeCloseTo(1.9);
    expect(material.normalScale.x).toBeCloseTo(0.52);
    expect(normal.wrapS).toBe(THREE.RepeatWrapping);
    expect(roughness.wrapT).toBe(THREE.RepeatWrapping);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.renderOrder).toBe(1);
  });
});
