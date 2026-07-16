import { describe, expect, it, vi } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ColliderTag, TrainingTarget } from './match-contracts';
import { TrainingRange } from './training-range';

class FakeBody {
  private next = { x: 0, y: 0, z: 0 };

  translation(): { x: number; y: number; z: number } {
    return this.next;
  }

  setNextKinematicTranslation(next: { x: number; y: number; z: number }): void {
    this.next = { ...next };
  }
}

class FakeCollider {
  enabled = true;

  constructor(readonly handle: number) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

function targetsIn(tags: Map<number, ColliderTag>): TrainingTarget[] {
  const targets = new Set<TrainingTarget>();
  for (const tag of tags.values()) {
    if (tag.kind === 'trainingTarget') targets.add(tag.target);
  }
  return [...targets];
}

describe('TrainingRange', () => {
  it('12基を生成し、ダウン後2秒で復帰し、物理・描画資源を全て破棄する', () => {
    let nextHandle = 1;
    const bodies: FakeBody[] = [];
    const removeRigidBody = vi.fn();
    const physics = {
      createRigidBody: () => {
        const body = new FakeBody();
        bodies.push(body);
        return body;
      },
      createCollider: () => new FakeCollider(nextHandle++),
      removeRigidBody,
    } as unknown as RAPIER.World;
    const scene = new THREE.Scene();
    const tags = new Map<number, ColliderTag>();
    const onImpact = vi.fn();
    const range = new TrainingRange({
      scene,
      physics,
      tags,
      playerSpawns: [new THREE.Vector3(12, 0, 12)],
      onImpact,
    });

    range.spawn();
    const targets = targetsIn(tags);
    expect(targets).toHaveLength(12);
    expect(tags).toHaveLength(24);
    expect(scene.children).toHaveLength(12);
    expect(bodies).toHaveLength(12);

    const target = targets[0]!;
    range.applyDamage(target, 40, true, new THREE.Vector3(1, 2, 3));
    expect(target.hp).toBe(60);
    expect(onImpact).toHaveBeenCalledWith(40, true, expect.any(THREE.Vector3));

    range.applyDamage(target, 70, false, new THREE.Vector3());
    expect(target.isDown).toBe(true);
    expect((target.bodyCollider as unknown as FakeCollider).enabled).toBe(false);
    expect((target.headCollider as unknown as FakeCollider).enabled).toBe(false);

    range.update(2.01);
    expect(target.hp).toBe(100);
    expect(target.isDown).toBe(false);
    expect(target.group.rotation.z).toBe(0);
    expect((target.bodyCollider as unknown as FakeCollider).enabled).toBe(true);
    expect((target.headCollider as unknown as FakeCollider).enabled).toBe(true);

    range.dispose();
    expect(tags).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(removeRigidBody).toHaveBeenCalledTimes(12);
  });
});
