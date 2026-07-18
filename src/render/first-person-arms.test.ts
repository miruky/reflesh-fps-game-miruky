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
  it('左右の手・手首・前腕を同じhand階層へ接続し、独立SkinnedMeshを生成しない', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    const skins: THREE.SkinnedMesh[] = [];
    rig.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) skins.push(node);
    });
    expect(skins).toHaveLength(0);
    expect(rig.getObjectByName('vm:leftHand')).toBeDefined();
    expect(rig.getObjectByName('vm:rightHand')).toBeDefined();
    expect(rig.getObjectByName('vm:leftGloveSkin')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightGloveSkin')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:palm')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:armor')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:rightHand:stitch')).toBeInstanceOf(THREE.Mesh);
    const leftHand = rig.getObjectByName('vm:leftHand');
    const rightHand = rig.getObjectByName('vm:rightHand');
    expect(leftHand?.getObjectByName('vm:leftSleeveConnected')).toBeInstanceOf(THREE.Mesh);
    expect(rightHand?.getObjectByName('vm:rightSleeveConnected')).toBeInstanceOf(THREE.Mesh);
    expect(rig.getObjectByName('vm:leftArm')?.children).toHaveLength(0);
    expect(rig.getObjectByName('vm:rightArm')?.children).toHaveLength(0);
    expect(rig.getObjectByName('vm:leftHand')?.userData.palmFacesWeapon).toBe(true);
    expect(rig.getObjectByName('vm:rightHand')?.userData.palmFacesWeapon).toBe(false);
    disposeRig(rig, mats);
  });

  it('左支持手の掌面を銃側へ返し、右射撃手の掌面は従来向きを保つ', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    const leftPalm = rig.getObjectByName('vm:leftHand:palm') as THREE.Mesh;
    const rightPalm = rig.getObjectByName('vm:rightHand:palm') as THREE.Mesh;
    leftPalm.geometry.computeBoundingBox();
    rightPalm.geometry.computeBoundingBox();
    expect(leftPalm.geometry.boundingBox!.getCenter(new THREE.Vector3()).y).toBeGreaterThan(0);
    expect(rightPalm.geometry.boundingBox!.getCenter(new THREE.Vector3()).y).toBeLessThan(0);
    expect(leftPalm.geometry.userData.palmFacesWeapon).toBe(true);
    expect(rightPalm.geometry.userData.palmFacesWeapon).toBeUndefined();
    disposeRig(rig, mats);
  });

  it('支持手の指は掌から連続するコンパクトな握りに収まり、棒状に飛び出さない', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    for (const side of ['left', 'right'] as const) {
      const glove = rig.getObjectByName(`vm:${side}GloveSkin`) as THREE.Mesh;
      const palm = rig.getObjectByName(`vm:${side}Hand:palm`) as THREE.Mesh;
      glove.geometry.computeBoundingBox();
      palm.geometry.computeBoundingBox();
      const gloveSize = glove.geometry.boundingBox!.getSize(new THREE.Vector3());
      const palmSize = palm.geometry.boundingBox!.getSize(new THREE.Vector3());
      // 5指+掌+手首の手形だけの範囲。袖は別メッシュなのでこの大きさに混ざらない。
      expect(gloveSize.x, side).toBeLessThan(0.12);
      expect(gloveSize.y, side).toBeLessThan(0.13);
      expect(gloveSize.z, side).toBeLessThan(0.22);
      expect(palmSize.x, side).toBeLessThan(0.12);
      expect(palmSize.y, side).toBeLessThan(0.13);
      expect(palmSize.z, side).toBeLessThan(0.16);
    }
    disposeRig(rig, mats);
  });

  it('旧来の直方体腕を生成せず、軽量な連続袖と立体指を使う', () => {
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
    expect(vertices).toBeGreaterThan(1_500);
    expect(vertices).toBeLessThan(8_000);
    disposeRig(rig, mats);
  });

  it('片腕は袖1DC+手袋4DCに固定し、袖は必ずhandの子にある', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    for (const side of ['left', 'right'] as const) {
      const hand = rig.getObjectByName(`vm:${side}Hand`);
      expect(hand).toBeDefined();
      const meshes: THREE.Mesh[] = [];
      hand!.traverse((node) => {
        if (node instanceof THREE.Mesh) meshes.push(node);
      });
      expect(meshes).toHaveLength(5);
      expect(meshes.filter((mesh) => mesh.userData.connectedToHand === true)).toHaveLength(1);
    }
    disposeRig(rig, mats);
  });

  it('武器別armアンカーへ袖の肘端を戻し、手首回転だけで腕方向を決めない', () => {
    const mats = materials();
    const rig = buildFirstPersonArms(mats, options);
    rig.updateWorldMatrix(true, true);
    for (const side of ['left', 'right'] as const) {
      const sleeve = rig.getObjectByName(`vm:${side}SleeveConnected`) as THREE.Mesh;
      const arm = options[side].arm;
      const anchor = new THREE.Vector3(arm[0], arm[1], arm[2]);
      const position = sleeve.geometry.getAttribute('position') as THREE.BufferAttribute;
      let nearest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < position.count; i += 1) {
        const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
          .applyMatrix4(sleeve.matrixWorld);
        nearest = Math.min(nearest, point.distanceTo(anchor));
      }
      expect(nearest, side).toBeLessThan(0.065);
    }
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
