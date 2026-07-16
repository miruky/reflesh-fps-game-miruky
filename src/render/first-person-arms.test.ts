import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFirstPersonArms, disposeFirstPersonArmSkeletons } from './first-person-arms';

function materials(): {
  sleeve: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  glovePalm: THREE.MeshStandardMaterial;
  gloveArmor: THREE.MeshStandardMaterial;
  gloveStitch: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
} {
  return {
    sleeve: new THREE.MeshStandardMaterial({ color: 0x30343a }),
    glove: new THREE.MeshStandardMaterial({ color: 0x111318 }),
    glovePalm: new THREE.MeshStandardMaterial({ color: 0x756957 }),
    gloveArmor: new THREE.MeshStandardMaterial({ color: 0x25292e }),
    gloveStitch: new THREE.MeshStandardMaterial({ color: 0xb88950 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb87958 }),
  };
}

function disposeRig(root: THREE.Object3D, mats: ReturnType<typeof materials>): void {
  disposeFirstPersonArmSkeletons(root);
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) node.geometry.dispose();
  });
  for (const material of Object.values(mats)) material.dispose();
}

const options = {
  right: {
    arm: [0.03, -0.22, 0.3, 0.62, -0.1, 0] as const,
    hand: [0, -0.11, 0.11, 0.3, 0, 0] as const,
  },
  left: {
    arm: [-0.03, -0.13, -0.04, 0.5, 0.2, 0.12] as const,
    hand: [0, -0.05, -0.16, 0.2, 0, 0] as const,
  },
};

describe('first-person arms', () => {
  it('左右2本の3ボーンSkinnedMeshと左右の立体グローブを生成する', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    const skins: THREE.SkinnedMesh[] = [];
    rig.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) skins.push(node);
    });
    expect(skins).toHaveLength(2);
    expect(skins.every((skin) => skin.skeleton.bones.length === 3)).toBe(true);
    expect(rig.getObjectByName('vm:leftHand')).toBeDefined();
    expect(rig.getObjectByName('vm:rightHand')).toBeDefined();
    expect(rig.getObjectByName('vm:leftGloveSkin')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightGloveSkin')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:leftHand:skin')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:palm')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:armor')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:stitch')).toBeInstanceOf(THREE.Mesh);
    disposeRig(rig, mats);
  });

  it('旧来の直方体腕を生成せず、滑らかな円筒袖と指を使う', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    let boxes = 0;
    let vertices = 0;
    rig.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.geometry instanceof THREE.BoxGeometry) boxes += 1;
      vertices += node.geometry.getAttribute('position').count;
    });
    expect(boxes).toBe(0);
    expect(vertices).toBeGreaterThan(3_000);
    disposeRig(rig, mats);
  });

  it('クナイ用の既存FIST_POSESノード名を維持する', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, { ...options, fists: true });
    for (const name of ['vm:fistRArm', 'vm:fistRHand', 'vm:fistLArm', 'vm:fistLHand']) {
      expect(rig.getObjectByName(name), name).toBeDefined();
    }
    disposeRig(rig, mats);
  });
});
