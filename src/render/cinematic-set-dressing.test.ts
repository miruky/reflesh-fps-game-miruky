import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCinematicSetDressing } from './cinematic-set-dressing';
import type { StagePalette } from '../game/stage';

const palette: StagePalette = {
  sky: '#7890a0',
  fog: '#6b747d',
  floor: '#34383a',
  wall: '#74706a',
  obstacle: '#4f5355',
  accent: '#ca6b2a',
  lightColor: '#ffe0ba',
  lightIntensity: 1.4,
  ambientIntensity: 0.6,
  fogDensity: 0.004,
  emissiveAccent: false,
  mood: 'overcast',
};

function dispose(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) mat.dispose();
    if (node instanceof THREE.InstancedMesh) node.dispose();
  });
}

function build(tier: 'low' | 'medium' | 'high', seed = 1234): THREE.Group {
  return buildCinematicSetDressing({
    size: 120,
    seed,
    tier,
    palette,
    boxes: [],
    propPlacements: [
      { kind: 'supplycrate', cx: 4, cz: -7, rotRad: 0.3, scaleJitter: 1 },
    ],
  });
}

describe('cinematic set dressing', () => {
  it('highは最大密度を4 draw callへ集約する', () => {
    const root = build('high');
    expect(root.children).toHaveLength(4);
    expect((root.getObjectByName('aaa:micro-debris') as THREE.InstancedMesh).count).toBe(420);
    expect((root.getObjectByName('aaa:ground-shards') as THREE.InstancedMesh).count).toBe(108);
    expect((root.getObjectByName('aaa:stains-and-puddles') as THREE.InstancedMesh).count).toBe(20);
    expect(root.getObjectByName('aaa:ground-cables')).toBeInstanceOf(THREE.Mesh);
    dispose(root);
  });

  it('lowはケーブルを省略し、3 draw callに抑える', () => {
    const root = build('low');
    expect(root.children).toHaveLength(3);
    expect(root.getObjectByName('aaa:ground-cables')).toBeUndefined();
    expect((root.getObjectByName('aaa:micro-debris') as THREE.InstancedMesh).count).toBe(48);
    dispose(root);
  });

  it('同じseedなら全instance matrixが一致する', () => {
    const a = build('medium', 0x51ab);
    const b = build('medium', 0x51ab);
    const am = a.getObjectByName('aaa:micro-debris') as THREE.InstancedMesh;
    const bm = b.getObjectByName('aaa:micro-debris') as THREE.InstancedMesh;
    expect(Array.from(am.instanceMatrix.array)).toEqual(Array.from(bm.instanceMatrix.array));
    dispose(a);
    dispose(b);
  });
});
