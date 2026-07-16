// 訓練場の的の生成・往復運動・ダウン/復帰・破棄を単独所有する。
// Matchは射撃集計とHUDイベントのみ担当し、的のライフサイクルを持たない。

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ColliderTag, TrainingTarget } from './match-contracts';

export interface TrainingRangeHost {
  scene: THREE.Scene;
  physics: RAPIER.World;
  tags: Map<number, ColliderTag>;
  playerSpawns: readonly THREE.Vector3[];
  onImpact(damage: number, headshot: boolean, point: THREE.Vector3): void;
}

export class TrainingRange {
  private readonly targets: TrainingTarget[] = [];

  constructor(private readonly h: TrainingRangeHost) {}

  spawn(): void {
    for (const [i, dist] of [5, 10, 20, 30, 50].entries()) {
      this.create('static', (i - 2) * 3, dist, 0);
    }
    for (const [i, speed] of [1, 2, 3].entries()) {
      this.create('moving', (i - 1) * 4, 15, speed);
    }
    for (let i = 0; i < 4; i += 1) this.create('popup', (i - 1.5) * 2, 8, 0);
  }

  update(dt: number): void {
    for (const t of this.targets) {
      if (t.isDown) {
        t.group.rotation.z = Math.min(Math.PI / 2, t.group.rotation.z + dt * 3);
        t.downTimer -= dt;
        if (t.downTimer <= 0) this.revive(t);
        continue;
      }
      if (t.kind !== 'moving' || t.moveSpeed <= 0) continue;
      const cur = t.body.translation();
      const step = t.moveDir * t.moveSpeed * dt;
      const nextX = cur.x + step * t.moveRightX;
      const nextZ = cur.z + step * t.moveRightZ;
      const projected =
        (nextX - t.moveOriginX) * t.moveRightX + (nextZ - t.moveOriginZ) * t.moveRightZ;
      if (Math.abs(projected) >= t.moveRange) t.moveDir *= -1;
      t.body.setNextKinematicTranslation({ x: nextX, y: cur.y, z: nextZ });
      t.group.position.x = nextX;
      t.group.position.z = nextZ;
    }
  }

  applyDamage(target: TrainingTarget, damage: number, headshot: boolean, point: THREE.Vector3): void {
    if (target.isDown) return;
    target.hp -= damage;
    this.h.onImpact(damage, headshot, point);
    if (target.hp > 0) return;
    target.hp = 0;
    target.isDown = true;
    target.downTimer = 2;
    target.bodyCollider.setEnabled(false);
    target.headCollider.setEnabled(false);
  }

  dispose(): void {
    for (const t of this.targets) {
      this.h.tags.delete(t.bodyCollider.handle);
      this.h.tags.delete(t.headCollider.handle);
      this.h.scene.remove(t.group);
      this.h.physics.removeRigidBody(t.body);
      t.group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of mats) material.dispose();
      });
    }
    this.targets.length = 0;
  }

  private create(
    kind: TrainingTarget['kind'],
    offsetX: number,
    dist: number,
    speed: number,
  ): void {
    const spawn = this.h.playerSpawns[0] ?? new THREE.Vector3();
    const toCenter = new THREE.Vector3(-spawn.x, 0, -spawn.z);
    const fwd = toCenter.length() > 0.01
      ? toCenter.normalize()
      : new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const cx = spawn.x + fwd.x * dist + right.x * offsetX;
    const cz = spawn.z + fwd.z * dist + right.z * offsetX;

    const group = new THREE.Group();
    const bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.3, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.8 }),
    );
    bodyMesh.position.y = 0.65;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.8 }),
    );
    headMesh.position.y = 1.55;
    headMesh.castShadow = true;
    group.add(headMesh);
    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.28, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.9 }),
    );
    baseMesh.position.y = 0.03;
    group.add(baseMesh);
    group.position.set(cx, spawn.y, cz);
    this.h.scene.add(group);

    const body = this.h.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, spawn.y, cz),
    );
    const bodyCollider = this.h.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.65, 0.025).setTranslation(0, 0.65, 0), body,
    );
    const headCollider = this.h.physics.createCollider(
      RAPIER.ColliderDesc.ball(0.18).setTranslation(0, 1.55, 0), body,
    );
    const target: TrainingTarget = {
      group, body, bodyCollider, headCollider,
      hp: 100, isDown: false, downTimer: 0, kind,
      moveDir: 1, moveSpeed: speed, moveRange: 3.5,
      moveOriginX: cx, moveOriginZ: cz,
      moveRightX: right.x, moveRightZ: right.z,
    };
    this.h.tags.set(bodyCollider.handle, { kind: 'trainingTarget', target, part: 'body' });
    this.h.tags.set(headCollider.handle, { kind: 'trainingTarget', target, part: 'head' });
    this.targets.push(target);
  }

  private revive(target: TrainingTarget): void {
    target.hp = 100;
    target.isDown = false;
    target.downTimer = 0;
    target.group.rotation.z = 0;
    target.bodyCollider.setEnabled(true);
    target.headCollider.setEnabled(true);
  }
}
