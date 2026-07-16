import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BoxSpec } from '../game/stage';
import { STAGES } from '../game/stages';
import {
  buildCinematicEnvironment,
  resolveScenicProfile,
} from './cinematic-environment';
import { resolveStageVisualIdentity } from './cinematic-stage-kit';

const boxes: BoxSpec[] = [
  { x: -10, y: 4, z: 4, w: 16, h: 8, d: 8, color: '#606872', emissive: false },
  { x: 15, y: 6, z: -12, w: 10, h: 12, d: 14, color: '#737a81', emissive: false },
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

describe('cinematic environment', () => {
  it('参考美術の主要要素をステージ系統へ割り当てる', () => {
    const heritage = STAGES.find((stage) => stage.id === 'nakaniwa')!;
    const arctic = STAGES.find((stage) => stage.id === 'setsugen')!;
    const undead = STAGES.find((stage) => stage.id === 'z01')!;
    expect(resolveScenicProfile(heritage, 'heritage')).toMatchObject({
      vegetation: 'lush',
      glass: true,
    });
    expect(resolveScenicProfile(arctic, 'arctic')).toMatchObject({
      vegetation: 'conifer',
      rocks: true,
    });
    expect(resolveScenicProfile(undead, 'undead')).toMatchObject({
      vegetation: 'dead',
      practicalLights: true,
    });
  });

  it('全固定ステージを少数draw callで決定論的に構築できる', () => {
    for (const stage of STAGES) {
      const family = resolveStageVisualIdentity(stage).family;
      const a = buildCinematicEnvironment({ stage, family, tier: 'medium', boxes });
      const b = buildCinematicEnvironment({ stage, family, tier: 'medium', boxes });
      let drawCalls = 0;
      a.traverse((node) => {
        if (node instanceof THREE.Mesh) drawCalls += 1;
      });
      expect(drawCalls, stage.id).toBeLessThanOrEqual(6);
      const aTree = a.getObjectByName('aaa:tree-trunks') as THREE.InstancedMesh | undefined;
      const bTree = b.getObjectByName('aaa:tree-trunks') as THREE.InstancedMesh | undefined;
      if (aTree && bTree) {
        expect(Array.from(aTree.instanceMatrix.array), stage.id).toEqual(Array.from(bTree.instanceMatrix.array));
      }
      dispose(a);
      dispose(b);
    }
  });
});
