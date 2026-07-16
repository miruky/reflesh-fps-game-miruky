import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BIOMES, generateStageDef } from '../game/biomes';
import { STAGES } from '../game/stages';
import type { BoxSpec } from '../game/stage';
import { buildCinematicStageKit, resolveStageVisualIdentity } from './cinematic-stage-kit';

const boxes: BoxSpec[] = [
  { x: -12, y: 5, z: 4, w: 18, h: 10, d: 8, color: '#606872', emissive: false, structural: true },
  { x: 18, y: 7, z: -15, w: 9, h: 14, d: 16, color: '#737a81', emissive: false, structural: true },
  { x: 0, y: 1, z: 0, w: 4, h: 2, d: 4, color: '#555b60', emissive: false },
];

function dispose(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
    if (node instanceof THREE.InstancedMesh) node.dispose();
  });
}

describe('cinematic stage kit', () => {
  it('全固定ステージに固有の美術ファミリーとヒーローランドマークを割り当てる', () => {
    for (const stage of STAGES) {
      const identity = resolveStageVisualIdentity(stage);
      expect(identity.family, stage.id).toBeTruthy();
      expect(identity.landmark, stage.id).toBeTruthy();
    }
    expect(resolveStageVisualIdentity(STAGES.find((stage) => stage.id === 'kuko')!).landmark).toBe('airport-control');
    expect(resolveStageVisualIdentity(STAGES.find((stage) => stage.id === 'z09')!).landmark).toBe('broken-ferris-wheel');
  });

  it('8種の生成バイオームも固定ステージと同じ品質レイヤへ解決する', () => {
    for (const [index, biome] of BIOMES.entries()) {
      const stage = generateStageDef(8000 + index, biome);
      const identity = resolveStageVisualIdentity(stage);
      expect(identity.family, biome).toBeTruthy();
      expect(identity.landmark, biome).toBeTruthy();
    }
  });

  it('全ランドマーク分岐が描画可能なメッシュを生成する', () => {
    for (const stage of STAGES) {
      const root = buildCinematicStageKit({ stage, tier: 'low', boxes, propPlacements: [] });
      const identity = resolveStageVisualIdentity(stage);
      const hero = root.getObjectByName(`aaa:hero-landmark:${identity.landmark}`);
      let meshes = 0;
      hero?.traverse((node) => {
        if (node instanceof THREE.Mesh) meshes += 1;
      });
      expect(meshes, stage.id).toBeGreaterThan(0);
      dispose(root);
    }
  });

  it('highは密度を増やしつつステージ全体を少数draw callへ集約する', () => {
    const stage = STAGES.find((entry) => entry.id === 'kunren')!;
    const root = buildCinematicStageKit({ stage, tier: 'high', boxes, propPlacements: [] });
    expect((root.getObjectByName('aaa:macro-routes') as THREE.InstancedMesh).count).toBe(7);
    expect((root.getObjectByName('aaa:route-markings-and-drains') as THREE.InstancedMesh).count).toBe(56);
    expect((root.getObjectByName('aaa:ground-surface-patches') as THREE.InstancedMesh).count).toBe(36);
    expect((root.getObjectByName('aaa:macro-rubble-clusters') as THREE.InstancedMesh).count).toBe(120);
    expect((root.getObjectByName('aaa:distant-skyline') as THREE.InstancedMesh).count).toBe(42);
    let drawCalls = 0;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) drawCalls += 1;
    });
    expect(drawCalls).toBeLessThanOrEqual(14);
    dispose(root);
  });

  it('同じstage seedとtierでは主要instance matrixが完全一致する', () => {
    const stage = STAGES.find((entry) => entry.id === 'koushou')!;
    const a = buildCinematicStageKit({ stage, tier: 'medium', boxes, propPlacements: [] });
    const b = buildCinematicStageKit({ stage, tier: 'medium', boxes, propPlacements: [] });
    for (const name of ['aaa:macro-routes', 'aaa:macro-rubble-clusters', 'aaa:distant-skyline']) {
      const am = a.getObjectByName(name) as THREE.InstancedMesh;
      const bm = b.getObjectByName(name) as THREE.InstancedMesh;
      expect(Array.from(am.instanceMatrix.array), name).toEqual(Array.from(bm.instanceMatrix.array));
    }
    dispose(a);
    dispose(b);
  });
});
